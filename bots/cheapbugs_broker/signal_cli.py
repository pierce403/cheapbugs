"""signal-cli bridge for relaying reports and collecting reactions."""

from __future__ import annotations

import json
import re
import subprocess
import time
import urllib.error
import urllib.request
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

    @property
    def _http_rpc_url(self) -> str | None:
        if self.cli_path.startswith("http://") or self.cli_path.startswith("https://"):
            return self.cli_path.rstrip("/")
        return None

    def send_group_message(self, message: str) -> SignalSendResult:
        if self._http_rpc_url:
            result = self._json_rpc(
                "send",
                {
                    "account": self.account,
                    "message": message,
                    "groupId": [self.group_id],
                },
            )
            stdout = json.dumps(result)
            return SignalSendResult(
                sent_timestamp=_find_timestamp(result) or int(time.time() * 1000),
                stdout=stdout,
            )

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
        if self._http_rpc_url:
            result = self._json_rpc(
                "updateGroup",
                {
                    "account": self.account,
                    "groupId": self.group_id,
                    "member": [signal_recipient],
                },
            )
            return json.dumps(result)

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
        if self._http_rpc_url:
            return self._receive_sse(timeout_seconds)

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

    def _json_rpc(self, method: str, params: dict[str, Any]) -> Any:
        assert self._http_rpc_url is not None
        request_id = f"cheapbugs-{method}-{int(time.time() * 1000)}"
        body = json.dumps({"jsonrpc": "2.0", "method": method, "id": request_id, "params": params}).encode("utf-8")
        request = urllib.request.Request(
            self._http_rpc_url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            value = json.loads(response.read().decode("utf-8"))
        if isinstance(value, dict) and value.get("error"):
            raise RuntimeError(f"signal-cli JSON-RPC {method} failed: {value['error']}")
        return value.get("result") if isinstance(value, dict) else value

    def _receive_sse(self, timeout_seconds: int) -> list[dict[str, Any]]:
        url = self._http_rpc_url.rsplit("/api/v1/rpc", 1)[0] + "/api/v1/events"
        request = urllib.request.Request(url, headers={"Accept": "text/event-stream"}, method="GET")
        events: list[dict[str, Any]] = []
        deadline = time.monotonic() + max(1, timeout_seconds)
        try:
            with urllib.request.urlopen(request, timeout=max(1, timeout_seconds)) as response:
                while time.monotonic() < deadline:
                    line = response.readline()
                    if not line:
                        break
                    stripped = line.decode("utf-8", errors="replace").strip()
                    if not stripped.startswith("data:"):
                        continue
                    payload = stripped.removeprefix("data:").strip()
                    if not payload:
                        continue
                    try:
                        value = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(value, dict):
                        events.append(value)
        except TimeoutError:
            pass
        except urllib.error.URLError as exc:
            if not isinstance(exc.reason, TimeoutError):
                raise
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
        event = raw
        params = raw.get("params")
        if isinstance(params, dict):
            result = params.get("result")
            event = result if isinstance(result, dict) else params
        envelope = event.get("envelope")
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
