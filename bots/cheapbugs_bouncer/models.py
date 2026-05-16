"""Shared bouncer bot domain models."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SubmissionCommand:
    reporter_address: str
    signal_recipient: str
    title: str
    summary: str
    severity: str
    body: str


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
    title: str
    summary: str
    severity: str
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
    error: str | None


@dataclass(frozen=True)
class SignalReactionEvent:
    group_id: str
    target_sent_timestamp: int
    reactor_id: str
    emoji: str
    is_remove: bool
    observed_at: int
