"""Shared broker bot domain models."""

from __future__ import annotations

from dataclasses import dataclass, field


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
    signature: "SubmissionSignature | None" = None


@dataclass(frozen=True)
class SubmissionSignature:
    scheme: str
    signer: str
    payload_sha256: str
    message: str
    value: str


@dataclass(frozen=True)
class AccessCommand:
    wallet_address: str
    signal_recipient: str


IncomingCommand = SubmissionCommand | AccessCommand


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
    error: str | None


@dataclass(frozen=True)
class SignalReactionEvent:
    group_id: str
    target_sent_timestamp: int
    reactor_id: str
    emoji: str
    is_remove: bool
    observed_at: int
