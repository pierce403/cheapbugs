"""Core broker bot orchestration."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import replace
from datetime import datetime, timezone
from decimal import Decimal

from .bugbundle import BugBundleError, VerifiedBugBundle, verify_authorized_bug_bundle
from .bug_index import BugIndexPublishError, BugIndexPublishResult
from .commands import (
    CommandError,
    SUBMISSION_SCHEMA,
    UnknownCommandError,
    command_help,
    parse_command,
    validate_submission_target,
)
from .config import BrokerConfig
from .models import AccessCommand, PinnedBugBundle, SubmissionCommand
from .rewards import reward_tokens, tokens_to_wei
from .signal_cli import SignalCli, extract_reaction_events
from .store import BrokerStore
from .token import BugzTokenClient


ReplyFn = Callable[[str], Awaitable[None]]
BUG_INDEX_JUDGMENT_PERIOD_SECONDS = 7 * 24 * 60 * 60
BUG_INDEX_REVEAL_PREFLIGHT_BUFFER_SECONDS = 60


class BrokerBot:
    def __init__(
        self,
        config: BrokerConfig,
        store: BrokerStore,
        signal: SignalCli | None,
        token: BugzTokenClient,
        ipfs=None,
        bug_index=None,
        logger: logging.Logger | None = None,
    ):
        self.config = config
        self.store = store
        self.signal = signal
        self.token = token
        self.ipfs = ipfs
        self.bug_index = bug_index
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
        except UnknownCommandError:
            self.logger.info("xmtp message unrecognized message_id=%s; replying with liveness hello", message_id)
            await self._reply(reply, message_id, "hello", "hello.")
            self.store.mark_message_processed(message_id, "hello")
            return
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
            "submission command parsed message_id=%s reporter=%s bug_type=%s severity=%s target_interest=%s title=%r target=%s:%s bugbundle=%s",
            message_id,
            command.reporter_address,
            command.bug_type,
            command.severity,
            command.target_interest,
            command.title,
            command.target_kind,
            command.target_ref,
            "present" if command.bug_bundle else "missing",
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

        configured_broker_address = self.config.broker_address
        if configured_broker_address and command.broker_address != configured_broker_address:
            self.logger.info(
                "submission broker address invalid message_id=%s expected=%s actual=%s",
                message_id,
                configured_broker_address,
                command.broker_address,
            )
            await self._reply(
                reply,
                message_id,
                "bugbundle_invalid",
                "BugBundle is invalid: broker_address does not match this broker.",
            )
            self.store.mark_message_processed(message_id, "bugbundle_invalid")
            return
        try:
            verified_bundle = verify_authorized_bug_bundle(
                command,
                chain_id=self.config.chain_id,
                bug_index_address=self.config.bug_index_address,
                configured_broker_address=configured_broker_address,
            )
        except BugBundleError as exc:
            self.logger.info(
                "submission bugbundle invalid message_id=%s reporter=%s reason=%s",
                message_id,
                command.reporter_address,
                exc,
            )
            await self._reply(reply, message_id, "bugbundle_invalid", f"BugBundle is invalid: {exc}")
            self.store.mark_message_processed(message_id, "bugbundle_invalid")
            return
        command = replace(
            command,
            details=verified_bundle.details,
            repro_steps=verified_bundle.repro_steps,
            evidence=verified_bundle.evidence,
            contact_hints=verified_bundle.contact_hints,
            body=verified_bundle.body,
        )
        await self._reply(
            reply,
            message_id,
            "bugbundle_valid",
            "Publish authorization is valid and encrypted BugBundle details decrypt cleanly.",
        )
        if not self.config.dry_run:
            try:
                self._validate_publish_reveal_window(verified_bundle)
            except CommandError as exc:
                self.logger.info("submission reveal window invalid message_id=%s reason=%s", message_id, exc)
                await self._reply(reply, message_id, "bugbundle_invalid", f"BugBundle is invalid: {exc}")
                self.store.mark_message_processed(message_id, "bugbundle_invalid")
                return

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
            bug_bundle = self._pin_bug_bundle(command, verified_bundle)
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

        try:
            publish_result = self._publish_bug_to_index(command, verified_bundle, bug_bundle)
        except Exception as exc:
            if isinstance(exc, BugIndexPublishError):
                self.logger.info(
                    "submission bug-index publish failed message_id=%s reporter=%s report_hash=%s bundle_cid=%s reason=%s",
                    message_id,
                    command.reporter_address,
                    verified_bundle.report_hash,
                    bug_bundle.cid,
                    exc,
                )
            else:
                self.logger.exception(
                    "submission bug-index publish crashed message_id=%s reporter=%s report_hash=%s bundle_cid=%s",
                    message_id,
                    command.reporter_address,
                    verified_bundle.report_hash,
                    bug_bundle.cid,
                )
            record = self.store.create_submission(
                command=command,
                xmtp_conversation_id=conversation_id,
                xmtp_message_id=message_id,
                signal_group_id=self.config.signal_group_id or "signal-disabled",
                signal_message_timestamp=0,
                review_window_seconds=0,
                status="index_failed",
                bug_bundle=bug_bundle,
                report_hash=verified_bundle.report_hash,
                error=str(exc),
            )
            self.store.mark_message_processed(message_id, "index_failed")
            await self._reply(
                reply,
                message_id,
                "index_failed",
                "Bug index publish failed: "
                f"{exc}. The encrypted BugBundle remains pinned at {bug_bundle.uri}. Broker id: {record.id}.",
            )
            return

        await self._reply(reply, message_id, "bug_index_published", _publish_progress_message(publish_result))

        if publish_result.dry_run:
            record = self.store.create_submission(
                command=command,
                xmtp_conversation_id=conversation_id,
                xmtp_message_id=message_id,
                signal_group_id="dry-run",
                signal_message_timestamp=0,
                review_window_seconds=0,
                status="dry_run",
                bug_bundle=bug_bundle,
                report_hash=publish_result.report_hash,
                index_tx_hash=publish_result.tx_hash,
                index_published_at=int(time.time()),
            )
            self.store.mark_message_processed(message_id, "submission_dry_run")
            await self._reply(
                reply,
                message_id,
                "submission_dry_run",
                "Submission complete: "
                f"{_publish_progress_message(publish_result)} No Signal relay was sent. "
                "Set BROKER_DRY_RUN=0 to publish live on Base. "
                f"Broker id: {record.id}.",
            )
            return

        if self.signal is None:
            self.logger.info(
                "submission published without signal message_id=%s reporter=%s report_hash=%s tx=%s bundle_cid=%s",
                message_id,
                command.reporter_address,
                publish_result.report_hash,
                publish_result.tx_hash,
                bug_bundle.cid,
            )
            record = self.store.create_submission(
                command=command,
                xmtp_conversation_id=conversation_id,
                xmtp_message_id=message_id,
                signal_group_id="signal-disabled",
                signal_message_timestamp=0,
                review_window_seconds=0,
                status="published",
                bug_bundle=bug_bundle,
                report_hash=publish_result.report_hash,
                index_tx_hash=publish_result.tx_hash,
                index_published_at=int(time.time()),
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
                "Submission complete: "
                f"{_publish_progress_message(publish_result)} Signal is not configured, so this submission was recorded locally "
                f"but not relayed to a reviewer channel. Broker id: {record.id}.",
            )
            return

        signal_message = format_signal_submission(command, bug_bundle)
        self.logger.info(
            "submission relay to signal message_id=%s reporter=%s report_hash=%s tx=%s bundle_cid=%s",
            message_id,
            command.reporter_address,
            publish_result.report_hash,
            publish_result.tx_hash,
            bug_bundle.cid,
        )
        try:
            sent = self.signal.send_group_message(signal_message)
        except Exception as exc:
            self.logger.exception("submission signal relay failed after index publish message_id=%s", message_id)
            record = self.store.create_submission(
                command=command,
                xmtp_conversation_id=conversation_id,
                xmtp_message_id=message_id,
                signal_group_id=self.config.signal_group_id,
                signal_message_timestamp=0,
                review_window_seconds=0,
                status="signal_failed",
                bug_bundle=bug_bundle,
                report_hash=publish_result.report_hash,
                index_tx_hash=publish_result.tx_hash,
                index_published_at=int(time.time()),
                error=str(exc),
            )
            self.store.mark_message_processed(message_id, "signal_failed")
            await self._reply(
                reply,
                message_id,
                "signal_failed",
                "Submission complete: "
                f"{_publish_progress_message(publish_result)} Signal relay failed after onchain publish: {exc}. "
                f"Broker id: {record.id}.",
            )
            return
        record = self.store.create_submission(
            command=command,
            xmtp_conversation_id=conversation_id,
            xmtp_message_id=message_id,
            signal_group_id=self.config.signal_group_id,
            signal_message_timestamp=sent.sent_timestamp,
            review_window_seconds=self.config.review_window_seconds,
            bug_bundle=bug_bundle,
            report_hash=publish_result.report_hash,
            index_tx_hash=publish_result.tx_hash,
            index_published_at=int(time.time()),
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
            "Submission complete: "
            f"{_publish_progress_message(publish_result)} Submission relayed to the private Signal channel. "
            f"BugBundle: {bug_bundle.uri}. Broker id: {record.id}. Reward window closes after "
            f"{self.config.review_window_seconds // 86400} days.",
        )

    def _pin_bug_bundle(self, command: SubmissionCommand, verified: VerifiedBugBundle) -> PinnedBugBundle:
        if self.ipfs is None:
            raise RuntimeError("IPFS client is not configured.")
        now = int(time.time())
        name = f"cheapbugs-{command.reporter_address}-{now}.bugbundle.json"
        added = self.ipfs.add_json(verified.payload, name)
        self.ipfs.prime_gateway(added.cid)
        self.logger.info(
            "bugbundle pinned reporter=%s cid=%s uri=%s sha256=%s encrypted_details_hash=%s",
            command.reporter_address,
            added.cid,
            added.uri,
            added.sha256,
            verified.encrypted_details_hash,
        )
        return PinnedBugBundle(
            cid=added.cid,
            uri=added.uri,
            gateway_url=added.gateway_url,
            sha256=added.sha256,
            details_key_b64=verified.details_key_b64,
            details_key_commitment=verified.details_key_commitment,
            encrypted_details_hash=verified.encrypted_details_hash,
            pinned_at=now,
        )

    def _publish_bug_to_index(
        self,
        command: SubmissionCommand,
        verified: VerifiedBugBundle,
        bug_bundle: PinnedBugBundle,
    ) -> BugIndexPublishResult:
        if self.bug_index is None:
            raise BugIndexPublishError("Bug index publisher is not configured in the broker runtime.")
        result = self.bug_index.publish_bug(command, verified, bug_bundle)
        self.logger.info(
            "bug published to index reporter=%s report_hash=%s tx=%s dry_run=%s already_published=%s",
            command.reporter_address,
            result.report_hash,
            result.tx_hash,
            result.dry_run,
            result.already_published,
        )
        return result

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

    def _validate_publish_reveal_window(self, verified: VerifiedBugBundle) -> None:
        reveal_after = _publish_authorization_uint(verified, "revealAfter")
        minimum = int(time.time()) + BUG_INDEX_JUDGMENT_PERIOD_SECONDS + BUG_INDEX_REVEAL_PREFLIGHT_BUFFER_SECONDS
        if reveal_after < minimum:
            raise CommandError(
                "revealAfter is too soon for live onchain publication: "
                f"{_format_timestamp(reveal_after)}. CheapBugsBugIndex requires revealAfter to be at least 7 days "
                "after the publish block, so resubmit from the updated frontend with a later reveal window."
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


def _publish_progress_message(result: BugIndexPublishResult) -> str:
    if result.dry_run:
        return (
            "Bug index dry-run complete: "
            f"report {result.report_hash} would publish to {result.index_address}; "
            "no onchain transaction was sent because BROKER_DRY_RUN=1."
        )
    if result.already_published:
        return f"Bug already exists onchain: report {result.report_hash}."
    block = f" block {result.block_number}" if result.block_number is not None else ""
    return f"Bug published onchain: report {result.report_hash} tx {result.tx_hash}{block}."


def _publish_authorization_uint(verified: VerifiedBugBundle, name: str) -> int:
    try:
        value = verified.publish_authorization["message"][name]
    except Exception as exc:
        raise CommandError(f"Publish authorization is missing {name}.") from exc
    if isinstance(value, bool):
        raise CommandError(f"Publish authorization {name} must be an unsigned integer.")
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str) and value.isdigit():
        parsed = int(value, 10)
    else:
        raise CommandError(f"Publish authorization {name} must be an unsigned integer.")
    if parsed < 0:
        raise CommandError(f"Publish authorization {name} must be an unsigned integer.")
    return parsed


def _format_timestamp(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


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
