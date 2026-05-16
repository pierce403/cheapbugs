"""signal-cli bridge for relaying reports and collecting reactions."""

from __future__ import annotations

import json
import re
import subprocess
import time
from dataclasses import dataclass
from typing import Any

from .models import SignalReactionEvent


TIMESTAMP_RE = re.compile(r"\b\d{12,}\b")


@dataclass(frozen=True)
class SignalSendResult:
    sent_timestamp: int
    stdout: str


class SignalCli:
    def __init__(self, cli_path: str, account: str, group_id: str):
        self.cli_path = cli_path
        self.account = account
        self.group_id = group_id

    def send_group_message(self, message: str) -> SignalSendResult:
        completed = subprocess.run(
            [
                self.cli_path,
                "-a",
                self.account,
                "-o",
                "json",
                "send",
                "--message-from-stdin",
                "-g",
                self.group_id,
            ],
            input=message,
            capture_output=True,
            check=True,
            text=True,
        )
        return SignalSendResult(
            sent_timestamp=parse_signal_timestamp(completed.stdout) or int(time.time() * 1000),
            stdout=completed.stdout,
        )

    def add_group_member(self, signal_recipient: str) -> str:
        completed = subprocess.run(
            [
                self.cli_path,
                "-a",
                self.account,
                "updateGroup",
                "-g",
                self.group_id,
                "-m",
                signal_recipient,
            ],
            capture_output=True,
            check=True,
            text=True,
        )
        return completed.stdout

    def receive_json(self, timeout_seconds: int) -> list[dict[str, Any]]:
        completed = subprocess.run(
            [
                self.cli_path,
                "-a",
                self.account,
                "-o",
                "json",
                "receive",
                "-t",
                str(timeout_seconds),
                "--ignore-attachments",
            ],
            capture_output=True,
            check=True,
            text=True,
        )
        events: list[dict[str, Any]] = []
        for line in completed.stdout.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            try:
                value = json.loads(stripped)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                events.append(value)
        return events


def parse_signal_timestamp(stdout: str) -> int | None:
    try:
        value = json.loads(stdout)
    except json.JSONDecodeError:
        value = None

    timestamp = _find_timestamp(value)
    if timestamp is not None:
        return timestamp

    match = TIMESTAMP_RE.search(stdout)
    return int(match.group(0)) if match else None


def extract_reaction_events(raw_events: list[dict[str, Any]], fallback_group_id: str) -> list[SignalReactionEvent]:
    events: list[SignalReactionEvent] = []
    observed_at = int(time.time())
    for raw in raw_events:
        envelope = raw.get("envelope")
        if not isinstance(envelope, dict):
            continue
        data_message = envelope.get("dataMessage")
        if not isinstance(data_message, dict):
            continue
        reaction = data_message.get("reaction")
        if not isinstance(reaction, dict):
            continue
        emoji = str(reaction.get("emoji") or "").strip()
        target_sent_timestamp = _int_or_none(reaction.get("targetSentTimestamp"))
        if not emoji or target_sent_timestamp is None:
            continue

        group_id = _group_id_from_data_message(data_message) or fallback_group_id
        reactor_id = (
            str(envelope.get("sourceUuid") or "").strip()
            or str(envelope.get("sourceNumber") or "").strip()
            or str(envelope.get("source") or "").strip()
        )
        if not reactor_id:
            continue
        events.append(
            SignalReactionEvent(
                group_id=group_id,
                target_sent_timestamp=target_sent_timestamp,
                reactor_id=reactor_id,
                emoji=emoji,
                is_remove=bool(reaction.get("isRemove")),
                observed_at=observed_at,
            )
        )
    return events


def _group_id_from_data_message(data_message: dict[str, Any]) -> str | None:
    for key in ("groupInfo", "groupV2"):
        group = data_message.get(key)
        if isinstance(group, dict):
            group_id = group.get("groupId") or group.get("masterKey")
            if isinstance(group_id, str) and group_id.strip():
                return group_id.strip()
    return None


def _find_timestamp(value: Any) -> int | None:
    if isinstance(value, dict):
        for key in ("timestamp", "sentTimestamp", "targetSentTimestamp"):
            parsed = _int_or_none(value.get(key))
            if parsed is not None and parsed > 1_000_000_000_000:
                return parsed
        for child in value.values():
            parsed = _find_timestamp(child)
            if parsed is not None:
                return parsed
    if isinstance(value, list):
        for child in value:
            parsed = _find_timestamp(child)
            if parsed is not None:
                return parsed
    return None


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
