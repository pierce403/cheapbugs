"""Shared broker bot domain models."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class PinnedBugBundle:
    cid: str
    uri: str
    gateway_url: str
    sha256: str
    details_key_b64: str
    details_key_commitment: str
    encrypted_details_hash: str
    pinned_at: int


@dataclass(frozen=True)
class SubmissionCommand:
    reporter_address: str
    signal_recipient: str
    bug_type: str
    title: str
    summary: str
    severity: str
    target_interest: str
    body: str
    broker_address: str = ""
    target_kind: str = "other"
    target_ref: str = ""
    disclosure_mode: str = "private"
    tags: tuple[str, ...] = field(default_factory=tuple)
    details: str = ""
    repro_steps: str = ""
    evidence: str = ""
    contact_hints: str = ""
    bug_bundle: dict[str, Any] | None = None
    publish_authorization: dict[str, Any] | None = None
    details_key_b64: str = ""


@dataclass(frozen=True)
class AccessCommand:
    wallet_address: str
    signal_recipient: str


@dataclass(frozen=True)
class DetailUnlockCommand:
    action: str
    request_id: str
    buyer_address: str
    broker_address: str
    chain_id: int
    bug_index_address: str
    treasury_vault_address: str
    report_hash: str
    tx_hash: str = ""


@dataclass(frozen=True)
class DetailUnlockQuote:
    request_id: str
    report_hash: str
    buyer_address: str
    price_wei: int
    days_remaining: int
    expires_at: int
    created_at: int
    paid_tx_hash: str | None
    fulfilled_at: int | None


IncomingCommand = SubmissionCommand | AccessCommand | DetailUnlockCommand


@dataclass(frozen=True)
class SubmissionRecord:
    id: str
    reporter_address: str
    reporter_signal: str
    bug_type: str
    title: str
    summary: str
    severity: str
    target_interest: str
    body: str
    xmtp_conversation_id: str
    xmtp_message_id: str
    signal_group_id: str
    signal_message_timestamp: int
    status: str
    created_at: int
    matures_at: int
    support_score: int
    payout_amount_wei: str | None
    payout_tx_hash: str | None
    bundle_cid: str | None
    bundle_uri: str | None
    bundle_gateway_url: str | None
    bundle_sha256: str | None
    details_key_b64: str | None
    details_key_commitment: str | None
    encrypted_details_hash: str | None
    bundle_pinned_at: int | None
    report_hash: str | None
    index_tx_hash: str | None
    index_published_at: int | None
    error: str | None


@dataclass(frozen=True)
class SignalReactionEvent:
    group_id: str
    target_sent_timestamp: int
    reactor_id: str
    emoji: str
    is_remove: bool
    observed_at: int
