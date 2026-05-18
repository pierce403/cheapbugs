"""Core broker bot orchestration."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from decimal import Decimal

from .bugbundle import build_unsigned_encrypted_bug_bundle
from .commands import CommandError, SUBMISSION_SCHEMA, command_help, parse_command, validate_submission_target
from .config import BrokerConfig
from .models import AccessCommand, PinnedBugBundle, SubmissionCommand
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
        ipfs=None,
        logger: logging.Logger | None = None,
    ):
        self.config = config
        self.store = store
        self.signal = signal
        self.token = token
        self.ipfs = ipfs
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
            self.logger.info("xmtp message ignored duplicate message_id=%s", message_id)
            return
        self.logger.info(
            "xmtp message received message_id=%s conversation_id=%s sender=%s chars=%s",
            message_id,
            conversation_id,
            sender_address or "unknown",
            len(text),
        )
        try:
            command = parse_command(text, sender_address)
        except CommandError as exc:
            self.logger.warning("xmtp message rejected message_id=%s reason=%s", message_id, exc)
            await self._reply(reply, message_id, "invalid", f"{exc}\n\n{command_help()}")
            self.store.mark_message_processed(message_id, "invalid")
            return

        if isinstance(command, AccessCommand):
            self.logger.info(
                "access command parsed message_id=%s wallet=%s signal=%s",
                message_id,
                command.wallet_address,
                command.signal_recipient,
            )
            await self._handle_access(command, message_id, reply)
            return
        self.logger.info(
            "NEW SUBMISSION from %s message_id=%s conversation_id=%s xmtp_sender=%s title=%r",
            command.reporter_address,
            message_id,
            conversation_id,
            sender_address or "unknown",
            command.title,
        )
        self.logger.info(
            "NEW SUBMISSION full_json message_id=%s payload=%s",
            message_id,
            _json_blob_for_log(text),
        )
        self.logger.info(
            "submission command parsed message_id=%s reporter=%s bug_type=%s severity=%s target_interest=%s title=%r target=%s:%s details_chars=%s",
            message_id,
            command.reporter_address,
            command.bug_type,
            command.severity,
            command.target_interest,
            command.title,
            command.target_kind,
            command.target_ref,
            len(command.details or command.body),
        )
        await self._handle_submission(command, conversation_id, message_id, reply)

    async def _handle_access(self, command: AccessCommand, message_id: str, reply: ReplyFn) -> None:
        if self.signal is None:
            self.logger.info(
                "access unavailable signal_disabled message_id=%s wallet=%s",
                message_id,
                command.wallet_address,
            )
            await self._reply(
                reply,
                message_id,
                "access_signal_disabled",
                "Access request unavailable: Signal is not configured. "
                "Set BROKER_SIGNAL_CLI, BROKER_SIGNAL_ACCOUNT, and BROKER_SIGNAL_GROUP_ID on the broker.",
            )
            self.store.mark_message_processed(message_id, "access_signal_disabled")
            return

        min_balance = tokens_to_wei(self.config.access_min_balance_tokens, self.token.decimals())
        balance = self.token.balance_of(command.wallet_address)
        if balance < min_balance:
            self.logger.info(
                "access denied message_id=%s wallet=%s balance_wei=%s min_wei=%s",
                message_id,
                command.wallet_address,
                balance,
                min_balance,
            )
            await self._reply(
                reply,
                message_id,
                "access_denied",
                "Access request denied: wallet balance is below "
                f"{self.config.access_min_balance_tokens} BUGZ.",
            )
            self.store.mark_message_processed(message_id, "access_denied")
            return

        self.signal.add_group_member(command.signal_recipient)
        self.store.mark_message_processed(message_id, "access_granted")
        self.logger.info("access granted message_id=%s wallet=%s", message_id, command.wallet_address)
        await self._reply(
            reply,
            message_id,
            "access_granted",
            "Access request approved. I sent the Signal group invite/update.",
        )

    async def _handle_submission(
        self,
        command: SubmissionCommand,
        conversation_id: str,
        message_id: str,
        reply: ReplyFn,
    ) -> None:
        await self._reply(
            reply,
            message_id,
            "submission_json_valid",
            f"Submission JSON is valid for {SUBMISSION_SCHEMA}.",
        )
        await self._reply(reply, message_id, "submission_fields_valid", "Submission fields are present and well formed.")

        try:
            validate_submission_target(command)
        except CommandError as exc:
            self.logger.info("submission target invalid message_id=%s reason=%s", message_id, exc)
            await self._reply(reply, message_id, "target_invalid", f"Submission target is invalid: {exc}")
            self.store.mark_message_processed(message_id, "target_invalid")
            return
        if command.target_ref == "broker triage":
            await self._reply(reply, message_id, "target_valid", "Submission target is valid for broker triage.")
        else:
            await self._reply(
                reply,
                message_id,
                "target_valid",
                f"Submission target is valid: {command.target_kind} {command.target_ref}.",
            )

        try:
            credential_summary = self._validate_submission_credentials(command)
        except CommandError as exc:
            self.logger.info(
                "submission credentials invalid message_id=%s reporter=%s reason=%s",
                message_id,
                command.reporter_address,
                exc,
            )
            await self._reply(reply, message_id, "credentials_invalid", f"Submission credentials are invalid: {exc}")
            self.store.mark_message_processed(message_id, "credentials_invalid")
            return
        await self._reply(reply, message_id, "credentials_valid", f"Submission credentials are valid: {credential_summary}.")

        try:
            bug_bundle = self._pin_bug_bundle(command)
        except Exception as exc:
            self.logger.exception("submission ipfs pin failed message_id=%s reporter=%s", message_id, command.reporter_address)
            await self._reply(reply, message_id, "ipfs_failed", f"BugBundle IPFS publish failed: {exc}")
            self.store.mark_message_processed(message_id, "ipfs_failed")
            return
        await self._reply(
            reply,
            message_id,
            "bugbundle_pinned",
            f"Encrypted BugBundle pinned to IPFS: {bug_bundle.uri}.",
        )

        if self.signal is None:
            self.logger.info(
                "submission accepted without signal message_id=%s reporter=%s bundle_cid=%s",
                message_id,
                command.reporter_address,
                bug_bundle.cid,
            )
            record = self.store.create_submission(
                command=command,
                xmtp_conversation_id=conversation_id,
                xmtp_message_id=message_id,
                signal_group_id="signal-disabled",
                signal_message_timestamp=0,
                review_window_seconds=0,
                status="accepted",
                bug_bundle=bug_bundle,
            )
            self.store.mark_message_processed(message_id, "submission_signal_disabled")
            self.logger.info(
                "submission recorded message_id=%s broker_id=%s status=submission_signal_disabled",
                message_id,
                record.id,
            )
            await self._reply(
                reply,
                message_id,
                "submission_signal_disabled",
                "Signal is not configured, so this submission was validated and recorded locally "
                f"but not relayed to a reviewer channel. Broker id: {record.id}.",
            )
            return

        signal_message = format_signal_submission(command, bug_bundle)
        self.logger.info(
            "submission relay to signal message_id=%s reporter=%s bundle_cid=%s",
            message_id,
            command.reporter_address,
            bug_bundle.cid,
        )
        sent = self.signal.send_group_message(signal_message)
        record = self.store.create_submission(
            command=command,
            xmtp_conversation_id=conversation_id,
            xmtp_message_id=message_id,
            signal_group_id=self.config.signal_group_id,
            signal_message_timestamp=sent.sent_timestamp,
            review_window_seconds=self.config.review_window_seconds,
            bug_bundle=bug_bundle,
        )
        self.store.mark_message_processed(message_id, "submission")
        self.logger.info(
            "submission relayed message_id=%s broker_id=%s signal_timestamp=%s",
            message_id,
            record.id,
            sent.sent_timestamp,
        )
        await self._reply(
            reply,
            message_id,
            "submission",
            "Submission relayed to the private Signal channel. "
            f"BugBundle: {bug_bundle.uri}. Broker id: {record.id}. Reward window closes after "
            f"{self.config.review_window_seconds // 86400} days.",
        )

    def _pin_bug_bundle(self, command: SubmissionCommand) -> PinnedBugBundle:
        if self.ipfs is None:
            raise RuntimeError("IPFS client is not configured.")
        now = int(time.time())
        built = build_unsigned_encrypted_bug_bundle(
            command,
            broker_address=self.config.broker_address,
            chain_id=self.config.chain_id,
            bug_index_address=self.config.bug_index_address,
            created_at=now,
            reveal_after=now + self.config.review_window_seconds,
        )
        name = f"cheapbugs-{command.reporter_address}-{now}.bugbundle.json"
        added = self.ipfs.add_json(built.payload, name)
        self.ipfs.prime_gateway(added.cid)
        self.logger.info(
            "bugbundle pinned reporter=%s cid=%s uri=%s sha256=%s encrypted_details_hash=%s",
            command.reporter_address,
            added.cid,
            added.uri,
            added.sha256,
            built.encrypted_details_hash,
        )
        return PinnedBugBundle(
            cid=added.cid,
            uri=added.uri,
            gateway_url=added.gateway_url,
            sha256=added.sha256,
            details_key_b64=built.details_key_b64,
            details_key_commitment=built.details_key_commitment,
            encrypted_details_hash=built.encrypted_details_hash,
            pinned_at=now,
        )

    async def _reply(self, reply: ReplyFn, message_id: str, stage: str, message: str) -> None:
        self.logger.info("xmtp status queued message_id=%s stage=%s chars=%s", message_id, stage, len(message))
        await reply(message)

    def _validate_submission_credentials(self, command: SubmissionCommand) -> str:
        if command.reporter_address.lower() in self.config.reputation_blocklist:
            self.logger.info("reputation blocked reporter=%s", command.reporter_address)
            raise CommandError("reporter address is blocked by the local reputation list.")

        decimals = self.token.decimals()
        min_balance = tokens_to_wei(self.config.submission_min_balance_tokens, decimals)
        balance = self.token.balance_of(command.reporter_address)
        self.logger.info(
            "submission credential check reporter=%s balance_wei=%s min_wei=%s",
            command.reporter_address,
            balance,
            min_balance,
        )
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

def format_signal_submission(command: SubmissionCommand, bug_bundle: PinnedBugBundle | None = None) -> str:
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
        f"Bug type: {command.bug_type}",
        f"Severity: {command.severity}",
        f"Target interest: {command.target_interest}",
    ]
    if command.signal_recipient != "broker-managed":
        heading_lines.append(f"Signal: {command.signal_recipient}")
    if command.target_ref != "broker triage":
        heading_lines.append(f"Target: {command.target_kind} {command.target_ref}")
    if bug_bundle is not None:
        heading_lines.append(f"BugBundle: {bug_bundle.uri}")
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


def _json_blob_for_log(text: str) -> str:
    return json.dumps(text, ensure_ascii=True)
