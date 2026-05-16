"""Parse bouncer commands received over XMTP."""

from __future__ import annotations

import json
import re
from typing import Any

from .models import AccessCommand, IncomingCommand, SubmissionCommand


ADDRESS_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")


class CommandError(ValueError):
    pass


def normalize_address(address: str) -> str:
    value = address.strip()
    if not ADDRESS_RE.match(value):
        raise CommandError("Expected an EVM address like 0x....")
    return value.lower()


def _coerce_type(value: str) -> str:
    normalized = value.strip().lower()
    if normalized in {"submit", "submission", "bug", "report"}:
        return "submission"
    if normalized in {"access", "access_request", "join", "channel"}:
        return "access"
    raise CommandError("Command must be !submit or !access.")


def _string_field(data: dict[str, Any], *names: str, required: bool = True) -> str:
    for name in names:
        value = data.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    if required:
        raise CommandError(f"Missing required field: {names[0]}.")
    return ""


def _parse_json_command(text: str, fallback_sender_address: str | None) -> IncomingCommand | None:
    stripped = text.strip()
    if not stripped.startswith("{"):
        return None

    try:
        data = json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise CommandError("Invalid JSON command.") from exc
    if not isinstance(data, dict):
        raise CommandError("JSON command must be an object.")

    command_type = _coerce_type(_string_field(data, "type", "command"))
    if command_type == "access":
        wallet = _string_field(data, "wallet", "wallet_address", required=False) or fallback_sender_address
        if not wallet:
            raise CommandError("Missing wallet address.")
        return AccessCommand(
            wallet_address=normalize_address(wallet),
            signal_recipient=_string_field(data, "signal", "signal_recipient", "phone", "username"),
        )

    reporter = _string_field(data, "wallet", "reporter", "reporter_address", required=False) or fallback_sender_address
    if not reporter:
        raise CommandError("Missing reporter wallet address.")
    return SubmissionCommand(
        reporter_address=normalize_address(reporter),
        signal_recipient=_string_field(data, "signal", "signal_recipient", "phone", "username"),
        title=_string_field(data, "title"),
        summary=_string_field(data, "summary", "public_summary"),
        severity=_string_field(data, "severity", "suggested_severity", required=False) or "unrated",
        body=_string_field(data, "body", "details"),
    )


def _parse_keyed_text(text: str) -> tuple[str, dict[str, str], str]:
    lines = [line.rstrip() for line in text.strip().splitlines()]
    if not lines:
        raise CommandError("Empty command.")

    command_line = lines[0].strip()
    if command_line.startswith("!"):
        command_type = _coerce_type(command_line[1:])
        lines = lines[1:]
    else:
        command_type = _coerce_type(command_line)
        lines = lines[1:]

    fields: dict[str, str] = {}
    body_lines: list[str] = []
    in_body = False
    for line in lines:
        if not in_body and not line.strip():
            in_body = True
            continue
        if not in_body and ":" in line:
            key, value = line.split(":", 1)
            fields[key.strip().lower().replace(" ", "_")] = value.strip()
            continue
        in_body = True
        body_lines.append(line)

    body = "\n".join(body_lines).strip()
    return command_type, fields, body


def parse_command(text: str, fallback_sender_address: str | None = None) -> IncomingCommand:
    json_command = _parse_json_command(text, fallback_sender_address)
    if json_command is not None:
        return json_command

    command_type, fields, body = _parse_keyed_text(text)
    if command_type == "access":
        wallet = fields.get("wallet") or fields.get("wallet_address") or fallback_sender_address
        if not wallet:
            raise CommandError("Missing wallet address.")
        signal = fields.get("signal") or fields.get("signal_recipient") or fields.get("phone") or fields.get("username")
        if not signal:
            raise CommandError("Missing Signal recipient.")
        return AccessCommand(wallet_address=normalize_address(wallet), signal_recipient=signal)

    reporter = fields.get("wallet") or fields.get("reporter") or fields.get("reporter_address") or fallback_sender_address
    if not reporter:
        raise CommandError("Missing reporter wallet address.")
    signal = fields.get("signal") or fields.get("signal_recipient") or fields.get("phone") or fields.get("username")
    title = fields.get("title", "")
    summary = fields.get("summary") or fields.get("public_summary") or ""
    if not signal:
        raise CommandError("Missing Signal recipient.")
    if not title:
        raise CommandError("Missing title.")
    if not summary:
        raise CommandError("Missing summary.")
    if not body:
        raise CommandError("Missing report body after a blank line.")

    return SubmissionCommand(
        reporter_address=normalize_address(reporter),
        signal_recipient=signal.strip(),
        title=title.strip(),
        summary=summary.strip(),
        severity=(fields.get("severity") or fields.get("suggested_severity") or "unrated").strip(),
        body=body,
    )


def command_help() -> str:
    return (
        "Send either !submit or !access.\n\n"
        "!submit\n"
        "wallet: 0x...\n"
        "signal: +15551234567 or u:username.01\n"
        "title: Short report title\n"
        "summary: Public-safe one-line summary\n"
        "severity: high\n\n"
        "Private details, repro steps, and evidence.\n\n"
        "!access\n"
        "wallet: 0x...\n"
        "signal: +15551234567 or u:username.01"
    )
