"""Core broker bot orchestration."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from decimal import Decimal

from .commands import CommandError, SUBMISSION_SCHEMA, command_help, parse_command, validate_submission_target
from .config import BrokerConfig
from .models import AccessCommand, SubmissionCommand
from .rewards import reward_tokens, tokens_to_wei
from .signal_cli import SignalCli, extract_reaction_events
from .store import BrokerStore
from .token import BugzTokenClient


ReplyFn = Callable[[str], Awaitable[None]]


class BrokerBot:
    def __init__(
        self,
        config: BrokerConfig,
        store: BrokerStore,
        signal: SignalCli | None,
        token: BugzTokenClient,
        logger: logging.Logger | None = None,
    ):
        self.config = config
        self.store = store
        self.signal = signal
        self.token = token
        self.logger = logger or logging.getLogger(__name__)

    async def handle_xmtp_text(
        self,
        text: str,
        sender_address: str | None,
        conversation_id: str,
        message_id: str,
        reply: ReplyFn,
    ) -> None:
        if self.store.message_seen(message_id):
            return
        try:
            command = parse_command(text, sender_address)
        except CommandError as exc:
            await reply(f"{exc}\n\n{command_help()}")
            self.store.mark_message_processed(message_id, "invalid")
            return

        if isinstance(command, AccessCommand):
            await self._handle_access(command, message_id, reply)
            return
        await self._handle_submission(command, conversation_id, message_id, reply)

    async def _handle_access(self, command: AccessCommand, message_id: str, reply: ReplyFn) -> None:
        if self.signal is None:
            await reply(
                "Access request unavailable: Signal is not configured. "
                "Set BROKER_SIGNAL_CLI, BROKER_SIGNAL_ACCOUNT, and BROKER_SIGNAL_GROUP_ID on the broker."
            )
            self.store.mark_message_processed(message_id, "access_signal_disabled")
            return

        min_balance = tokens_to_wei(self.config.access_min_balance_tokens, self.token.decimals())
        balance = self.token.balance_of(command.wallet_address)
        if balance < min_balance:
            await reply(
                "Access request denied: wallet balance is below "
                f"{self.config.access_min_balance_tokens} BUGZ."
            )
            self.store.mark_message_processed(message_id, "access_denied")
            return

        self.signal.add_group_member(command.signal_recipient)
        self.store.mark_message_processed(message_id, "access_granted")
        await reply("Access request approved. I sent the Signal group invite/update.")

    async def _handle_submission(
        self,
        command: SubmissionCommand,
        conversation_id: str,
        message_id: str,
        reply: ReplyFn,
    ) -> None:
        await reply(f"Submission JSON is valid for {SUBMISSION_SCHEMA}.")
        await reply("Submission fields are present and well formed.")

        try:
            validate_submission_target(command)
        except CommandError as exc:
            await reply(f"Submission target is invalid: {exc}")
            self.store.mark_message_processed(message_id, "target_invalid")
            return
        if command.target_ref == "broker triage":
            await reply("Submission target is valid for broker triage.")
        else:
            await reply(f"Submission target is valid: {command.target_kind} {command.target_ref}.")

        try:
            credential_summary = self._validate_submission_credentials(command)
        except CommandError as exc:
            await reply(f"Submission credentials are invalid: {exc}")
            self.store.mark_message_processed(message_id, "credentials_invalid")
            return
        await reply(f"Submission credentials are valid: {credential_summary}.")

        if self.signal is None:
            record = self.store.create_submission(
                command=command,
                xmtp_conversation_id=conversation_id,
                xmtp_message_id=message_id,
                signal_group_id="signal-disabled",
                signal_message_timestamp=0,
                review_window_seconds=0,
                status="accepted",
            )
            self.store.mark_message_processed(message_id, "submission_signal_disabled")
            await reply(
                "Signal is not configured, so this submission was validated and recorded locally "
                f"but not relayed to a reviewer channel. Broker id: {record.id}."
            )
            return

        signal_message = format_signal_submission(command)
        sent = self.signal.send_group_message(signal_message)
        record = self.store.create_submission(
            command=command,
            xmtp_conversation_id=conversation_id,
            xmtp_message_id=message_id,
            signal_group_id=self.config.signal_group_id,
            signal_message_timestamp=sent.sent_timestamp,
            review_window_seconds=self.config.review_window_seconds,
        )
        self.store.mark_message_processed(message_id, "submission")
        await reply(
            "Submission relayed to the private Signal channel. "
            f"Broker id: {record.id}. Reward window closes after "
            f"{self.config.review_window_seconds // 86400} days."
        )

    def _validate_submission_credentials(self, command: SubmissionCommand) -> str:
        if command.reporter_address.lower() in self.config.reputation_blocklist:
            raise CommandError("reporter address is blocked by the local reputation list.")

        decimals = self.token.decimals()
        min_balance = tokens_to_wei(self.config.submission_min_balance_tokens, decimals)
        balance = self.token.balance_of(command.reporter_address)
        if balance < min_balance:
            raise CommandError(
                "reporter BUGZ balance is below "
                f"{self.config.submission_min_balance_tokens} BUGZ."
            )

        return (
            f"{_format_token_amount(balance, decimals)} BUGZ available; "
            "reputation checks passed"
        )

    def sync_signal_once(self) -> int:
        if self.signal is None:
            self.logger.warning("Signal is not configured; skipping Signal reaction sync.")
            return 0
        raw_events = self.signal.receive_json(self.config.poll_seconds)
        reactions = extract_reaction_events(raw_events, self.config.signal_group_id)
        count = self.store.upsert_reactions(reactions)
        if count:
            self.logger.info("Recorded %s Signal reaction event(s).", count)
        return count

    def settle_matured_once(self) -> int:
        if self.signal is None:
            self.logger.warning("Signal is not configured; skipping reward settlement.")
            return 0
        paid = 0
        decimals = self.token.decimals()
        for submission in self.store.mature_unpaid_submissions():
            support_score = self.store.support_score(
                submission.signal_group_id,
                submission.signal_message_timestamp,
            )
            reward = reward_tokens(
                self.config.reward_base_tokens,
                self.config.reward_per_reaction_tokens,
                self.config.reward_max_tokens,
                support_score,
            )
            amount_wei = tokens_to_wei(reward, decimals)
            try:
                tx_hash = self.token.transfer(submission.reporter_address, amount_wei)
            except Exception as exc:
                self.store.mark_failed(submission.id, support_score, str(exc))
                self.logger.exception("Failed to pay submission %s", submission.id)
                continue
            self.store.mark_paid(submission.id, support_score, amount_wei, tx_hash)
            paid += 1
            self.logger.info(
                "Paid submission %s score=%s amount_wei=%s tx=%s",
                submission.id,
                support_score,
                amount_wei,
                tx_hash,
            )
        return paid

    async def poll_signal_forever(self) -> None:
        while True:
            try:
                self.sync_signal_once()
            except Exception:
                self.logger.exception("Signal sync failed.")
            await asyncio.sleep(self.config.poll_seconds)

    async def settle_forever(self) -> None:
        while True:
            try:
                self.settle_matured_once()
            except Exception:
                self.logger.exception("Settlement sweep failed.")
            await asyncio.sleep(max(self.config.poll_seconds, 60))


BouncerBot = BrokerBot


def format_signal_submission(command: SubmissionCommand) -> str:
    title = _compact(command.title, 140)
    summary = _compact(command.summary, 600)
    details = _compact(command.details or command.body, 4_000)
    repro_steps = _compact(command.repro_steps or "-", 1_500)
    evidence = _compact(command.evidence or "-", 1_500)
    contact_hints = _compact(command.contact_hints or "-", 800)
    tags = ", ".join(command.tags) if command.tags else "-"
    heading_lines = [
        "[CheapBugs submission]",
        f"Reporter: {command.reporter_address}",
        f"Severity: {command.severity}",
    ]
    if command.signal_recipient != "broker-managed":
        heading_lines.append(f"Signal: {command.signal_recipient}")
    if command.target_ref != "broker triage":
        heading_lines.append(f"Target: {command.target_kind} {command.target_ref}")
    heading_lines.extend(
        [
            f"Disclosure: {command.disclosure_mode}",
            f"Tags: {tags}",
            f"Title: {title}",
        ]
    )
    return (
        "\n".join(heading_lines)
        + "\n\n"
        f"Summary:\n{summary}\n\n"
        f"Details:\n{details}\n\n"
        f"Repro steps:\n{repro_steps}\n\n"
        f"Evidence:\n{evidence}\n\n"
        f"Contact hints:\n{contact_hints}"
    )


def _compact(value: str, limit: int) -> str:
    normalized = "\n".join(line.rstrip() for line in value.strip().splitlines()).strip()
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3].rstrip() + "..."


def _format_token_amount(amount_wei: int, decimals: int) -> str:
    scale = Decimal(10) ** decimals
    value = Decimal(amount_wei) / scale
    return f"{value.normalize():f}"
