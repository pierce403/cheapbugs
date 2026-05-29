"""Core broker bot orchestration."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import math
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
    normalize_address,
    parse_command,
    validate_submission_target,
)
from .config import BrokerConfig
from .models import AccessCommand, DetailUnlockCommand, PinnedBugBundle, SubmissionCommand
from .rewards import reward_tokens, tokens_to_wei
from .signal_cli import SignalCli, extract_reaction_events
from .store import BrokerStore
from .token import BugzTokenClient


ReplyFn = Callable[[str], Awaitable[None]]
BUG_INDEX_JUDGMENT_PERIOD_SECONDS = 7 * 24 * 60 * 60
BUG_INDEX_REVEAL_PREFLIGHT_BUFFER_SECONDS = 60
DETAIL_UNLOCK_QUOTE_TTL_SECONDS = 15 * 60
UNFLAGGED_PAYOUT_ALERT_WINDOW_SECONDS = 24 * 60 * 60
BUG_INDEX_STATUS_UNREVIEWED = 0
BUG_INDEX_STATUS_VALID = 1
BUG_INDEX_STATUS_INVALID = 2
BUG_INDEX_STATUS_SPAM = 3


def _is_transient_settlement_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(
        marker in text
        for marker in (
            "429",
            "too many requests",
            "rate limit",
            "timeout",
            "timed out",
            "temporarily unavailable",
            "connection aborted",
            "connection reset",
            "max retries exceeded",
            "502 bad gateway",
            "503 service unavailable",
            "504 gateway timeout",
        )
    )


class BrokerBot:
    def __init__(
        self,
        config: BrokerConfig,
        store: BrokerStore,
        signal: SignalCli | None,
        token: BugzTokenClient,
        ipfs=None,
        bug_index=None,
        treasury=None,
        logger: logging.Logger | None = None,
    ):
        self.config = config
        self.store = store
        self.signal = signal
        self.token = token
        self.ipfs = ipfs
        self.bug_index = bug_index
        self.treasury = treasury
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
        if isinstance(command, DetailUnlockCommand):
            self.logger.info(
                "detail unlock command parsed message_id=%s action=%s buyer=%s report_hash=%s request_id=%s",
                message_id,
                command.action,
                command.buyer_address,
                command.report_hash,
                command.request_id,
            )
            await self._handle_detail_unlock(command, message_id, reply)
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
        await self._handle_submission(command, conversation_id, message_id, reply, sender_address)

    async def _handle_detail_unlock(self, command: DetailUnlockCommand, message_id: str, reply: ReplyFn) -> None:
        try:
            self._validate_detail_unlock_command(command)
            if command.action == "quote":
                await self._handle_detail_unlock_quote(command, message_id, reply)
            else:
                await self._handle_detail_unlock_paid(command, message_id, reply)
        except CommandError as exc:
            self.logger.info(
                "detail unlock rejected message_id=%s action=%s buyer=%s report_hash=%s reason=%s",
                message_id,
                command.action,
                command.buyer_address,
                command.report_hash,
                exc,
            )
            await self._reply(reply, message_id, "detail_unlock_rejected", f"Detail unlock rejected: {exc}")
            self.store.mark_message_processed(message_id, f"detail_unlock_{command.action}_rejected")
        except Exception as exc:
            self.logger.exception(
                "detail unlock failed message_id=%s action=%s buyer=%s report_hash=%s",
                message_id,
                command.action,
                command.buyer_address,
                command.report_hash,
            )
            await self._reply(reply, message_id, "detail_unlock_failed", f"Detail unlock failed: {exc}")
            self.store.mark_message_processed(message_id, f"detail_unlock_{command.action}_failed")

    async def _handle_detail_unlock_quote(
        self,
        command: DetailUnlockCommand,
        message_id: str,
        reply: ReplyFn,
    ) -> None:
        if self.treasury is None:
            raise CommandError("treasury verifier is not configured.")
        submission = self.store.find_submission_by_report_hash(command.report_hash)
        if submission is None:
            raise CommandError("report hash is not known to this broker.")
        if not _has_live_index_record(submission):
            raise CommandError("report hash has not been published live onchain by this broker.")
        if not submission.details_key_b64:
            raise CommandError("this broker does not have the detail key for that report.")

        now = int(time.time())
        reveal_at = (submission.index_published_at or submission.created_at) + BUG_INDEX_JUDGMENT_PERIOD_SECONDS
        seconds_remaining = reveal_at - now
        if seconds_remaining <= 0:
            raise CommandError("the public reveal window has ended; wait for public details.")
        days_remaining = max(1, math.ceil(seconds_remaining / 86_400))
        base_reward = int(self.treasury.base_reward())
        price_wei = base_reward * days_remaining
        if price_wei <= 0:
            raise CommandError("treasury base detail price is currently zero.")

        paid_total = int(self.treasury.detail_key_payment_total(command.report_hash, command.buyer_address))
        if paid_total >= price_wei:
            self.store.mark_message_processed(message_id, "detail_unlock_already_paid")
            self.logger.info(
                "detail unlock already paid message_id=%s buyer=%s report_hash=%s paid_wei=%s required_wei=%s",
                message_id,
                command.buyer_address,
                command.report_hash,
                paid_total,
                price_wei,
            )
            await self._reply(
                reply,
                message_id,
                "detail_unlock_already_paid",
                f"Detail key: report {command.report_hash} request {command.request_id} key {submission.details_key_b64}",
            )
            return

        expires_at = now + DETAIL_UNLOCK_QUOTE_TTL_SECONDS
        self.store.create_detail_unlock_quote(
            request_id=command.request_id,
            report_hash=command.report_hash,
            buyer_address=command.buyer_address,
            price_wei=price_wei,
            days_remaining=days_remaining,
            expires_at=expires_at,
            now=now,
        )
        self.store.mark_message_processed(message_id, "detail_unlock_quote")
        await self._reply(
            reply,
            message_id,
            "detail_unlock_quote",
            "Detail unlock quote: "
            f"report {command.report_hash} request {command.request_id} price_wei {price_wei} "
            f"days_remaining {days_remaining} expires_at {_format_timestamp(expires_at)}.",
        )

    async def _handle_detail_unlock_paid(
        self,
        command: DetailUnlockCommand,
        message_id: str,
        reply: ReplyFn,
    ) -> None:
        if self.treasury is None:
            raise CommandError("treasury verifier is not configured.")
        quote = self.store.get_detail_unlock_quote(command.request_id)
        if quote is None:
            raise CommandError("unlock quote request id is unknown or expired.")
        if quote.report_hash.lower() != command.report_hash or quote.buyer_address.lower() != command.buyer_address:
            raise CommandError("unlock payment does not match the quoted report and buyer.")
        now = int(time.time())
        if quote.expires_at < now:
            raise CommandError("unlock quote has expired; request a fresh quote.")
        submission = self.store.find_submission_by_report_hash(command.report_hash)
        if submission is None or not submission.details_key_b64:
            raise CommandError("this broker does not have the detail key for that report.")
        if not _has_live_index_record(submission):
            raise CommandError("report hash has not been published live onchain by this broker.")

        self.treasury.verify_successful_payment_tx(command.tx_hash, command.buyer_address)
        paid_total = int(self.treasury.detail_key_payment_total(command.report_hash, command.buyer_address))
        if paid_total < quote.price_wei:
            raise CommandError(
                "treasury payment is below the quoted price: "
                f"paid {paid_total} wei, required {quote.price_wei} wei."
            )
        self.store.mark_detail_unlock_fulfilled(command.request_id, command.tx_hash, now=now)
        self.store.mark_message_processed(message_id, "detail_unlock_paid")
        await self._reply(
            reply,
            message_id,
            "detail_unlock_paid",
            f"Detail key: report {command.report_hash} request {command.request_id} key {submission.details_key_b64}",
        )

    def _validate_detail_unlock_command(self, command: DetailUnlockCommand) -> None:
        configured_broker_address = self.config.broker_address
        if configured_broker_address and command.broker_address != configured_broker_address:
            raise CommandError("broker_address does not match this broker.")
        if command.chain_id != self.config.chain_id:
            raise CommandError("chain_id does not match this broker.")
        if command.bug_index_address != self.config.bug_index_address.lower():
            raise CommandError("bug_index does not match this broker.")
        if command.treasury_vault_address != self.config.treasury_vault_address.lower():
            raise CommandError("treasury_vault does not match this broker.")

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
        sender_address: str | None,
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
        try:
            verified_reporter = _verified_reporter_address(verified_bundle)
            if verified_reporter != command.reporter_address:
                raise CommandError("verified PublishBug reporter does not match reporter_address.")
            if sender_address and verified_reporter != normalize_address(sender_address):
                raise CommandError("reporter_address must match the authenticated XMTP sender address.")
        except CommandError as exc:
            self.logger.info(
                "submission identity invalid message_id=%s reporter=%s sender=%s reason=%s",
                message_id,
                command.reporter_address,
                sender_address or "unknown",
                exc,
            )
            await self._reply(reply, message_id, "bugbundle_invalid", f"BugBundle is invalid: {exc}")
            self.store.mark_message_processed(message_id, "bugbundle_invalid")
            return
        command = replace(
            command,
            reporter_address=verified_reporter,
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

        if self.config.submission_min_balance_tokens <= Decimal("0"):
            self.logger.info(
                "submission credential check reporter=%s no_min_balance_configured=true",
                command.reporter_address,
            )
            return "no BUGZ minimum configured; reputation checks passed"

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

    def alert_unflagged_payouts_once(self) -> int:
        if self.signal is None:
            self.logger.warning("Signal is not configured; skipping unflagged payout alerts.")
            return 0
        if self.bug_index is None or not hasattr(self.bug_index, "report_status"):
            self.logger.warning("Bug index is not configured; skipping unflagged payout alerts.")
            return 0
        alerted = 0
        now = int(time.time())
        for submission in self.store.pending_flag_alert_candidates(
            now=now,
            window_seconds=UNFLAGGED_PAYOUT_ALERT_WINDOW_SECONDS,
        ):
            if not submission.report_hash:
                continue
            try:
                status = int(self.bug_index.report_status(submission.report_hash))
            except Exception:
                self.logger.exception("Failed to check onchain flag status for submission %s", submission.id)
                continue
            if status != BUG_INDEX_STATUS_UNREVIEWED:
                continue
            sent = self.signal.send_group_message(_unflagged_payout_alert_message(submission, now))
            self.store.mark_flag_alert_sent(submission.id, now=now)
            alerted += 1
            self.logger.warning(
                "Sent unflagged payout alert submission=%s report_hash=%s signal_timestamp=%s",
                submission.id,
                submission.report_hash,
                sent.sent_timestamp,
            )
        return alerted

    def settle_matured_once(self) -> int:
        if self.signal is None:
            self.logger.warning("Signal is not configured; skipping reward settlement.")
            return 0
        paid = 0
        decimals = self.token.decimals()
        base_reward_tokens = self._settlement_base_reward_tokens(decimals)
        for submission in self.store.mature_unpaid_submissions():
            support_score = self.store.support_score(
                submission.signal_group_id,
                submission.signal_message_timestamp,
            )
            reward = reward_tokens(
                base_reward_tokens,
                self.config.reward_per_reaction_tokens,
                self.config.reward_max_tokens,
                support_score,
            )
            amount_wei = tokens_to_wei(reward, decimals)
            try:
                if self._use_index_treasury_payout():
                    report_hash = str(submission.report_hash)
                    if hasattr(self.bug_index, "report_reveal_after"):
                        reveal_after = int(self.bug_index.report_reveal_after(report_hash))
                        now = int(time.time())
                        if now < reveal_after:
                            self.logger.info(
                                "Skipping payout before onchain reveal time submission=%s report_hash=%s reveal_after=%s now=%s",
                                submission.id,
                                submission.report_hash,
                                reveal_after,
                                now,
                            )
                            continue
                    status = int(self.bug_index.report_status(report_hash))
                    if status == BUG_INDEX_STATUS_UNREVIEWED:
                        self.logger.warning(
                            "Skipping payout for unreviewed submission %s report_hash=%s",
                            submission.id,
                            submission.report_hash,
                        )
                        continue
                    if status not in (BUG_INDEX_STATUS_INVALID, BUG_INDEX_STATUS_SPAM) and hasattr(
                        self.bug_index,
                        "report_vote_score",
                    ):
                        support_score = max(support_score, int(self.bug_index.report_vote_score(report_hash)))
                    multiplier = self._settlement_multiplier(support_score, status=status)
                    amount_wei = int(self.treasury.reward_amount(multiplier))
                    details_key = _decode_details_key(str(submission.details_key_b64 or ""))
                    _verify_details_key_commitment(
                        details_key,
                        submission.details_key_commitment,
                        "stored submission details_key_commitment",
                    )
                    if (
                        hasattr(self.bug_index, "report_details_key_commitment")
                        and not bool(getattr(self.bug_index, "dry_run", False))
                    ):
                        _verify_details_key_commitment(
                            details_key,
                            str(self.bug_index.report_details_key_commitment(report_hash)),
                            "onchain CheapBugsBugIndex detailsKeyCommitment",
                        )
                    tx_hash = self.bug_index.complete_payout(
                        report_hash,
                        multiplier,
                        details_key,
                    )
                else:
                    tx_hash = self.token.transfer(submission.reporter_address, amount_wei)
            except Exception as exc:
                if _is_transient_settlement_error(exc):
                    self.logger.exception(
                        "Transient settlement error for submission %s; leaving payout retryable",
                        submission.id,
                    )
                    continue
                self.store.mark_failed(submission.id, support_score, str(exc))
                self.logger.exception("Failed to pay submission %s", submission.id)
                continue
            self.store.mark_paid(submission.id, support_score, amount_wei, tx_hash)
            try:
                self.signal.send_group_message(
                    _payout_completed_message(
                        submission,
                        amount_wei,
                        decimals,
                        tx_hash,
                        status=status if self._use_index_treasury_payout() else None,
                    )
                )
            except Exception:
                self.logger.exception("Failed to send payout notification for submission %s", submission.id)
            paid += 1
            self.logger.info(
                "Paid submission %s score=%s amount_wei=%s tx=%s",
                submission.id,
                support_score,
                amount_wei,
                tx_hash,
            )
        return paid

    def _settlement_base_reward_tokens(self, decimals: int) -> Decimal:
        if self.config.reward_base_tokens_configured or self.treasury is None:
            return self.config.reward_base_tokens
        base_reward_wei = int(self.treasury.base_reward())
        return Decimal(base_reward_wei) / (Decimal(10) ** decimals)

    def _use_index_treasury_payout(self) -> bool:
        return (
            not self.config.reward_base_tokens_configured
            and self.bug_index is not None
            and self.treasury is not None
            and hasattr(self.bug_index, "complete_payout")
            and hasattr(self.treasury, "reward_amount")
        )

    def _settlement_multiplier(self, support_score: int, *, status: int | None = None) -> int:
        if status in (BUG_INDEX_STATUS_INVALID, BUG_INDEX_STATUS_SPAM):
            return 0
        if support_score > 0:
            return 10
        return 1

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
                self.alert_unflagged_payouts_once()
            except Exception:
                self.logger.exception("Unflagged payout alert check failed.")
            try:
                self.settle_matured_once()
            except Exception:
                self.logger.exception("Settlement sweep failed.")
            await asyncio.sleep(max(self.config.poll_seconds, 60))


def _payout_completed_message(
    submission,
    amount_wei: int,
    decimals: int,
    tx_hash: str,
    *,
    status: int | None = None,
) -> str:
    amount = Decimal(amount_wei) / (Decimal(10) ** decimals)
    amount_text = format(amount.normalize(), "f") if amount else "0"
    lines = [
        "✅ CheapBugs report completed",
        f"Report: {submission.title}",
        f"Amount: {amount_text} BUGZ",
    ]
    if amount_wei == 0:
        if status == BUG_INDEX_STATUS_INVALID:
            lines.append("Result: invalid — zero payout; details key revealed")
        elif status == BUG_INDEX_STATUS_SPAM:
            lines.append("Result: spam — zero payout; details key revealed")
        else:
            lines.append("Result: zero payout; details key revealed")
    lines.append(f"Report hash: {submission.report_hash}")
    if tx_hash.startswith("0x") and len(tx_hash) == 66:
        lines.append(f"Tx: https://basescan.org/tx/{tx_hash}")
    else:
        lines.append(f"Tx: {tx_hash}")
    return "\n".join(lines)


def _unflagged_payout_alert_message(submission, now: int) -> str:
    seconds_until = max(0, int(submission.matures_at) - now)
    hours_until = math.ceil(seconds_until / 3600) if seconds_until else 0
    return (
        "⚠️ CheapBugs review needed before payout\n"
        f"Report `{submission.title}` is due for payout in ~{hours_until}h but is still unflagged on-chain.\n"
        f"Report hash: {submission.report_hash}\n"
        "Please flag it Valid, Invalid, or Spam before the payout window so settlement is not blocked."
    )


def _decode_details_key(value: str) -> bytes:
    if not value:
        raise CommandError("submission is missing details key for payout completion.")
    padded = value + "=" * (-len(value) % 4)
    key = base64.urlsafe_b64decode(padded.encode("ascii"))
    if len(key) != 32:
        raise CommandError("submission details key is not 32 bytes.")
    return key


def _details_key_commitment(details_key: bytes) -> str:
    return f"0x{hashlib.sha256(details_key).hexdigest()}"


def _verify_details_key_commitment(details_key: bytes, expected_commitment: str | None, source: str) -> None:
    if not expected_commitment:
        raise CommandError(f"submission is missing {source} for payout completion.")
    expected = expected_commitment.lower()
    if not expected.startswith("0x") or len(expected) != 66:
        raise CommandError(f"{source} is not a 32-byte hex value.")
    try:
        int(expected[2:], 16)
    except ValueError as exc:
        raise CommandError(f"{source} is not a 32-byte hex value.") from exc
    actual = _details_key_commitment(details_key)
    if actual != expected:
        raise CommandError(
            "submission details key does not match "
            f"{source}; refusing to submit completePayout. expected={expected} actual={actual}"
        )


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


def _has_live_index_record(submission) -> bool:
    tx_hash = submission.index_tx_hash or ""
    return bool(tx_hash.startswith("0x") and len(tx_hash) == 66)


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


def _verified_reporter_address(verified: VerifiedBugBundle) -> str:
    try:
        reporter = verified.publish_authorization["message"]["reporter"]
    except Exception as exc:
        raise CommandError("verified PublishBug authorization is missing reporter.") from exc
    return normalize_address(str(reporter))


def _format_timestamp(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def format_signal_submission(command: SubmissionCommand, bug_bundle: PinnedBugBundle | None = None) -> str:
    title = _compact(command.title, 140)
    summary = _compact(command.summary, 600)
    details = _compact(command.details or command.body, 4_000)
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
    body_sections = [
        f"Summary:\n{summary}",
        f"Details:\n{details}",
    ]
    return "\n".join(heading_lines) + "\n\n" + "\n\n".join(body_sections)


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
