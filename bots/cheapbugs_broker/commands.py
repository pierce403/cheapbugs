"""Parse and validate broker commands received over XMTP."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any
from urllib.parse import urlparse

from .models import AccessCommand, IncomingCommand, SubmissionCommand, SubmissionSignature


ADDRESS_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
DOMAIN_RE = re.compile(
    r"^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(?:\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$"
)
PACKAGE_RE = re.compile(r"^(?:@[a-z0-9][a-z0-9._-]{0,63}/)?[a-z0-9][a-z0-9._-]{0,213}$")
REPO_SHORTHAND_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")
TAG_RE = re.compile(r"^[a-z0-9][a-z0-9+.#_-]{0,31}$")
HEX_32_RE = re.compile(r"^0x[a-fA-F0-9]{64}$")
SIGNATURE_RE = re.compile(r"^0x[a-fA-F0-9]{130}$")

SUBMISSION_SCHEMA = "cheapbugs.bug_submission.v1"
SUBMISSION_VERSION = 1
SUBMISSION_SIGNATURE_SCHEME = "eip191_canonical_submission_v1"
BUG_TYPES = {"0day", "nday", "web", "net", "intel"}
RATING_VALUES = {"low", "medium", "high", "critical"}
TARGET_KINDS = {"repo", "package", "domain", "contract", "protocol", "other"}
DISCLOSURE_MODES = {"private", "embargoed", "public"}
SUBMISSION_ALLOWED_KEYS = {
    "schema",
    "type",
    "version",
    "reporter_address",
    "broker_address",
    "signal_recipient",
    "bug_type",
    "title",
    "public_summary",
    "details",
    "repro_steps",
    "evidence",
    "severity",
    "target_interest",
    "target",
    "disclosure_mode",
    "tags",
    "contact_hints",
    "client",
    "signature",
}
SUBMISSION_REQUIRED_KEYS = {
    "schema",
    "type",
    "version",
    "reporter_address",
    "broker_address",
    "bug_type",
    "title",
    "public_summary",
    "details",
    "severity",
    "target_interest",
    "signature",
}
CLIENT_ALLOWED_KEYS = {"name", "sent_at"}
SIGNATURE_ALLOWED_KEYS = {"scheme", "signer", "payload_sha256", "message", "value"}


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
    raise CommandError("Command must be a submission or access request.")


def _string_field(data: dict[str, Any], *names: str, required: bool = True) -> str:
    for name in names:
        value = data.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    if required:
        raise CommandError(f"Missing required field: {names[0]}.")
    return ""


def _strict_string(data: dict[str, Any], name: str, *, min_length: int = 1, max_length: int = 10_000) -> str:
    if name not in data:
        raise CommandError(f"Missing required field: {name}.")
    value = data[name]
    if not isinstance(value, str):
        raise CommandError(f"Field {name} must be a string.")
    normalized = value.strip()
    if len(normalized) < min_length:
        raise CommandError(f"Field {name} is too short.")
    if len(normalized) > max_length:
        raise CommandError(f"Field {name} is too long.")
    return normalized


def _strict_string_present(data: dict[str, Any], name: str, *, max_length: int = 10_000) -> str:
    if name not in data:
        raise CommandError(f"Missing required field: {name}.")
    value = data[name]
    if not isinstance(value, str):
        raise CommandError(f"Field {name} must be a string.")
    normalized = value.strip()
    if len(normalized) > max_length:
        raise CommandError(f"Field {name} is too long.")
    return normalized


def _strict_choice(data: dict[str, Any], name: str, choices: set[str]) -> str:
    value = _strict_string(data, name, max_length=40).lower()
    if value not in choices:
        expected = ", ".join(sorted(choices))
        raise CommandError(f"Field {name} must be one of: {expected}.")
    return value


def _strict_tags(data: dict[str, Any]) -> tuple[str, ...]:
    if "tags" not in data:
        return tuple()
    value = data["tags"]
    if not isinstance(value, list):
        raise CommandError("Field tags must be an array of strings.")
    if len(value) > 10:
        raise CommandError("Field tags may include at most 10 tags.")

    tags: list[str] = []
    for tag in value:
        if not isinstance(tag, str):
            raise CommandError("Field tags must be an array of strings.")
        normalized = tag.strip().lower()
        if not TAG_RE.match(normalized):
            raise CommandError(f"Invalid tag: {tag}.")
        tags.append(normalized)
    return tuple(tags)


def _strict_target(data: dict[str, Any]) -> tuple[str, str]:
    if "target" not in data:
        return "other", "broker triage"
    target = data["target"]
    if not isinstance(target, dict):
        raise CommandError("Field target must be an object.")

    kind = _strict_string(target, "kind", max_length=40).lower()
    if kind not in TARGET_KINDS:
        raise CommandError(f"Unsupported target kind: {kind}.")
    reference = _strict_string(target, "reference", min_length=2, max_length=500)
    return kind, reference


def _validate_optional_client(data: dict[str, Any]) -> None:
    if "client" not in data:
        return
    client = data["client"]
    if not isinstance(client, dict):
        raise CommandError("Field client must be an object when present.")
    unknown_keys = sorted(set(client.keys()) - CLIENT_ALLOWED_KEYS)
    if unknown_keys:
        raise CommandError(f"Unexpected client field(s): {', '.join(unknown_keys)}.")
    _strict_string(client, "name", max_length=80)
    _strict_string(client, "sent_at", max_length=80)


def _canonicalize(value: Any) -> Any:
    if isinstance(value, list):
        return [_canonicalize(item) for item in value]
    if isinstance(value, dict):
        return {key: _canonicalize(value[key]) for key in sorted(value) if value[key] is not None}
    return value


def _canonical_json(value: Any) -> str:
    return json.dumps(_canonicalize(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _canonical_sha256(value: Any) -> str:
    return f"0x{hashlib.sha256(_canonical_json(value).encode('utf-8')).hexdigest()}"


def build_submission_signature_message(unsigned_payload: dict[str, Any], payload_sha256: str) -> str:
    return "\n".join(
        [
            "CheapBugs broker submission authorization",
            "",
            "This signature authorizes the configured CheapBugs broker to validate and pin one encrypted BugBundle for this submission.",
            "",
            f"schema: {unsigned_payload.get('schema')}",
            f"version: {unsigned_payload.get('version')}",
            f"reporter: {normalize_address(str(unsigned_payload.get('reporter_address', '')))}",
            f"broker: {normalize_address(str(unsigned_payload.get('broker_address', '')))}",
            f"payload_sha256: {payload_sha256}",
        ]
    )


def _strict_signature(data: dict[str, Any], unsigned_payload: dict[str, Any]) -> SubmissionSignature:
    raw_signature = data.get("signature")
    if not isinstance(raw_signature, dict):
        raise CommandError("Field signature must be an object.")
    unknown_keys = sorted(set(raw_signature.keys()) - SIGNATURE_ALLOWED_KEYS)
    if unknown_keys:
        raise CommandError(f"Unexpected signature field(s): {', '.join(unknown_keys)}.")

    scheme = _strict_string(raw_signature, "scheme", max_length=80)
    if scheme != SUBMISSION_SIGNATURE_SCHEME:
        raise CommandError(f"Submission signature scheme must be {SUBMISSION_SIGNATURE_SCHEME}.")
    signer = normalize_address(_strict_string(raw_signature, "signer", max_length=42))
    payload_sha256 = _strict_string(raw_signature, "payload_sha256", max_length=66).lower()
    if not HEX_32_RE.match(payload_sha256):
        raise CommandError("Submission signature payload_sha256 must be a 32-byte hex value.")
    expected_payload_sha256 = _canonical_sha256(unsigned_payload)
    if payload_sha256 != expected_payload_sha256:
        raise CommandError("Submission signature payload hash does not match the command JSON.")

    message = _strict_string(raw_signature, "message", min_length=20, max_length=2_000)
    expected_message = build_submission_signature_message(unsigned_payload, payload_sha256)
    if message != expected_message:
        raise CommandError("Submission signature message does not match the command JSON.")
    value = _strict_string(raw_signature, "value", max_length=132)
    if not SIGNATURE_RE.match(value):
        raise CommandError("Submission signature value must be a 65-byte hex signature.")
    return SubmissionSignature(
        scheme=scheme,
        signer=signer,
        payload_sha256=payload_sha256,
        message=message,
        value=value,
    )


def verify_submission_signature(command: SubmissionCommand) -> None:
    signature = command.signature
    if signature is None:
        raise CommandError("Submission reporter signature is missing.")
    if signature.signer != command.reporter_address:
        raise CommandError("Submission signature signer must match reporter_address.")

    try:
        from eth_account import Account
        from eth_account.messages import encode_defunct
    except ImportError as exc:  # pragma: no cover - covered in broker runtime environment
        raise CommandError("Submission reporter signature cannot be verified because eth_account is not installed.") from exc

    try:
        recovered = str(Account.recover_message(encode_defunct(text=signature.message), signature=signature.value)).lower()
    except Exception as exc:
        raise CommandError("Submission reporter signature could not be recovered.") from exc
    if recovered != command.reporter_address:
        raise CommandError("Submission reporter signature does not recover to reporter_address.")


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

    return _parse_submission_json(data)


def _parse_submission_json(data: dict[str, Any]) -> SubmissionCommand:
    missing_keys = sorted(SUBMISSION_REQUIRED_KEYS - set(data.keys()))
    if missing_keys:
        raise CommandError(f"Missing required submission field(s): {', '.join(missing_keys)}.")

    unknown_keys = sorted(set(data.keys()) - SUBMISSION_ALLOWED_KEYS)
    if unknown_keys:
        raise CommandError(f"Unexpected submission field(s): {', '.join(unknown_keys)}.")
    _validate_optional_client(data)
    unsigned_payload = {key: value for key, value in data.items() if key != "signature"}
    signature = _strict_signature(data, unsigned_payload)

    schema = _strict_string(data, "schema", max_length=80)
    if schema != SUBMISSION_SCHEMA:
        raise CommandError(f"Submission schema must be {SUBMISSION_SCHEMA}.")
    if data.get("version") != SUBMISSION_VERSION:
        raise CommandError(f"Submission version must be {SUBMISSION_VERSION}.")

    command_type = _coerce_type(_strict_string(data, "type", max_length=40))
    if command_type != "submission":
        raise CommandError("Submission JSON must use type: submission.")

    target_kind, target_ref = _strict_target(data)
    disclosure_mode = (
        _strict_string(data, "disclosure_mode", max_length=40).lower()
        if "disclosure_mode" in data
        else "private"
    )
    if disclosure_mode not in DISCLOSURE_MODES:
        raise CommandError(f"Unsupported disclosure mode: {disclosure_mode}.")

    reporter_address = normalize_address(_strict_string(data, "reporter_address", max_length=42))
    broker_address = normalize_address(_strict_string(data, "broker_address", max_length=42))
    if signature.signer != reporter_address:
        raise CommandError("Submission signature signer must match reporter_address.")
    signal_recipient = (
        _strict_string(data, "signal_recipient", min_length=3, max_length=128)
        if "signal_recipient" in data
        else "broker-managed"
    )
    title = _strict_string(data, "title", min_length=3, max_length=120)
    summary = _strict_string(data, "public_summary", min_length=10, max_length=2_000)
    details = _strict_string(data, "details", min_length=10, max_length=12_000)
    bug_type = _strict_choice(data, "bug_type", BUG_TYPES)
    severity = _strict_choice(data, "severity", RATING_VALUES)
    target_interest = _strict_choice(data, "target_interest", RATING_VALUES)
    repro_steps = _strict_string_present(data, "repro_steps", max_length=8_000) if "repro_steps" in data else ""
    evidence = _strict_string_present(data, "evidence", max_length=8_000) if "evidence" in data else ""
    contact_hints = _strict_string_present(data, "contact_hints", max_length=1_000) if "contact_hints" in data else ""
    tags = _strict_tags(data)

    body_parts = [details]
    if repro_steps:
        body_parts.append(f"Repro steps:\n{repro_steps}")
    if evidence:
        body_parts.append(f"Evidence:\n{evidence}")
    if contact_hints:
        body_parts.append(f"Contact hints:\n{contact_hints}")

    return SubmissionCommand(
        reporter_address=reporter_address,
        signal_recipient=signal_recipient,
        bug_type=bug_type,
        title=title,
        summary=summary,
        severity=severity,
        target_interest=target_interest,
        body="\n\n".join(body_parts),
        broker_address=broker_address,
        target_kind=target_kind,
        target_ref=target_ref,
        disclosure_mode=disclosure_mode,
        tags=tags,
        details=details,
        repro_steps=repro_steps,
        evidence=evidence,
        contact_hints=contact_hints,
        signature=signature,
    )


def _parse_keyed_text(text: str) -> tuple[str, dict[str, str]]:
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
    for line in lines:
        if ":" in line:
            key, value = line.split(":", 1)
            fields[key.strip().lower().replace(" ", "_")] = value.strip()
    return command_type, fields


def parse_command(text: str, fallback_sender_address: str | None = None) -> IncomingCommand:
    json_command = _parse_json_command(text, fallback_sender_address)
    if json_command is not None:
        return json_command

    command_type, fields = _parse_keyed_text(text)
    if command_type == "submission":
        raise CommandError("Bug submissions must use the strict CheapBugs JSON schema.")

    wallet = fields.get("wallet") or fields.get("wallet_address") or fallback_sender_address
    if not wallet:
        raise CommandError("Missing wallet address.")
    signal = fields.get("signal") or fields.get("signal_recipient") or fields.get("phone") or fields.get("username")
    if not signal:
        raise CommandError("Missing Signal recipient.")
    return AccessCommand(wallet_address=normalize_address(wallet), signal_recipient=signal)


def validate_submission_target(command: SubmissionCommand) -> None:
    kind = command.target_kind
    reference = command.target_ref.strip()

    if kind == "contract":
        normalize_address(reference)
        return

    if kind == "domain":
        parsed = urlparse(reference if "://" in reference else f"https://{reference}")
        host = parsed.hostname or ""
        if DOMAIN_RE.match(host):
            return
        raise CommandError("Target domain must be a valid DNS hostname.")

    if kind == "repo":
        parsed = urlparse(reference)
        if parsed.scheme in {"http", "https"} and parsed.hostname in {"github.com", "www.github.com"}:
            parts = [part for part in parsed.path.split("/") if part]
            if len(parts) >= 2:
                return
        if REPO_SHORTHAND_RE.match(reference):
            return
        raise CommandError("Target repo must be a GitHub URL or owner/repo reference.")

    if kind == "package":
        if PACKAGE_RE.match(reference.lower()):
            return
        raise CommandError("Target package must be a package-style name.")

    if kind in {"protocol", "other"} and len(reference) >= 3:
        return

    raise CommandError("Submission target is not valid.")


def command_help() -> str:
    return (
        "Send bug submissions as JSON using schema cheapbugs.bug_submission.v1.\n\n"
        "{\n"
        '  "schema": "cheapbugs.bug_submission.v1",\n'
        '  "type": "submission",\n'
        '  "version": 1,\n'
        '  "reporter_address": "0x...",\n'
        '  "broker_address": "0x...",\n'
        '  "bug_type": "0day",\n'
        '  "title": "Short report title",\n'
        '  "public_summary": "Public-safe summary",\n'
        '  "details": "Private details",\n'
        '  "severity": "high",\n'
        '  "target_interest": "medium",\n'
        '  "signature": {"scheme": "eip191_canonical_submission_v1", "...": "..."}\n'
        "}\n\n"
        "The broker fills omitted workflow metadata during triage. "
        "Signal access requests may still use !access with wallet and signal fields."
    )
