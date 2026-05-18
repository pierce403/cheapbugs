"""BugBundle validation for broker-pinned IPFS submissions."""

from __future__ import annotations

import base64
import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any

from .models import SubmissionCommand


BUG_BUNDLE_SCHEMA = "cheapbugs.bug_bundle.v1"
BUG_BUNDLE_VERSION = 1
BUG_BUNDLE_SIGNATURE_SCHEME = "eip191_bugbundle_core_v1"

ADDRESS_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
HEX_32_RE = re.compile(r"^0x[a-fA-F0-9]{64}$")
SIGNATURE_RE = re.compile(r"^0x[a-fA-F0-9]{130}$")
B64URL_RE = re.compile(r"^[A-Za-z0-9_-]+$")


@dataclass(frozen=True)
class VerifiedBugBundle:
    payload: dict[str, Any]
    details_key_b64: str
    details_key_commitment: str
    encrypted_details_hash: str
    details: str
    repro_steps: str
    evidence: str
    contact_hints: str

    @property
    def body(self) -> str:
        parts = [self.details]
        if self.repro_steps:
            parts.append(f"Repro steps:\n{self.repro_steps}")
        if self.evidence:
            parts.append(f"Evidence:\n{self.evidence}")
        if self.contact_hints:
            parts.append(f"Contact hints:\n{self.contact_hints}")
        return "\n\n".join(parts)


class BugBundleError(ValueError):
    pass


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(_canonicalize(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def build_bug_bundle_signature_message(core: dict[str, Any], core_sha256: str) -> str:
    commitments = _dict_field(core, "commitments")
    return "\n".join(
        [
            "CheapBugs BugBundle authorization",
            "",
            "This signature authorizes the configured CheapBugs broker to verify and pin one encrypted BugBundle.",
            "",
            f"schema: {core.get('schema')}",
            f"version: {core.get('version')}",
            f"reporter: {_normalize_address(str(core.get('reporter', '')))}",
            f"broker: {_normalize_address(str(core.get('broker', '')))}",
            f"chain_id: {core.get('chain_id')}",
            f"bug_index: {_optional_address(str(core.get('bug_index', '')))}",
            f"core_sha256: {core_sha256}",
            f"encrypted_details_sha256: {commitments.get('encrypted_details_sha256')}",
            f"details_key_commitment: {commitments.get('details_key_commitment')}",
            f"reveal_after: {core.get('reveal_after')}",
        ]
    )


def verify_signed_bug_bundle(
    command: SubmissionCommand,
    *,
    chain_id: int,
    bug_index_address: str,
    configured_broker_address: str = "",
) -> VerifiedBugBundle:
    payload = command.bug_bundle
    if not isinstance(payload, dict):
        raise BugBundleError("BugBundle is missing.")
    _require_keys(payload, {"schema", "version", "core", "signature"}, "BugBundle")
    _reject_unknown_keys(payload, {"schema", "version", "core", "signature"}, "BugBundle")
    if payload["schema"] != BUG_BUNDLE_SCHEMA:
        raise BugBundleError(f"BugBundle schema must be {BUG_BUNDLE_SCHEMA}.")
    if payload["version"] != BUG_BUNDLE_VERSION:
        raise BugBundleError(f"BugBundle version must be {BUG_BUNDLE_VERSION}.")

    core = _dict_field(payload, "core")
    signature = _dict_field(payload, "signature")
    _validate_core_matches_submission(command, core, chain_id, bug_index_address, configured_broker_address)
    _verify_signature(command, core, signature)

    details_key = _b64url_decode(command.details_key_b64, field_name="details_key")
    if len(details_key) != 32:
        raise BugBundleError("BugBundle details key must decode to 32 bytes.")

    commitments = _dict_field(core, "commitments")
    details_key_commitment = _strict_hex32(commitments, "details_key_commitment")
    actual_key_commitment = f"0x{hashlib.sha256(details_key).hexdigest()}"
    if details_key_commitment.lower() != actual_key_commitment:
        raise BugBundleError("BugBundle details key does not match details_key_commitment.")

    details = _dict_field(core, "details")
    aad = _validate_aad(core, details)
    iv = _b64url_decode(_strict_string(details, "iv", max_length=80), field_name="details.iv")
    ciphertext = _b64url_decode(_strict_string(details, "ciphertext", max_length=50_000), field_name="details.ciphertext")
    encrypted_details_hash = _strict_hex32(commitments, "encrypted_details_sha256")
    actual_ciphertext_hash = f"0x{hashlib.sha256(ciphertext).hexdigest()}"
    if encrypted_details_hash.lower() != actual_ciphertext_hash:
        raise BugBundleError("BugBundle encrypted details hash does not match ciphertext.")

    decrypted = _decrypt_details(details_key, iv, ciphertext, aad)
    return VerifiedBugBundle(
        payload=payload,
        details_key_b64=command.details_key_b64,
        details_key_commitment=details_key_commitment.lower(),
        encrypted_details_hash=encrypted_details_hash.lower(),
        details=_strict_decrypted_string(decrypted, "details", min_length=10, max_length=12_000),
        repro_steps=_strict_decrypted_string(decrypted, "repro_steps", max_length=8_000, required=False),
        evidence=_strict_decrypted_string(decrypted, "evidence", max_length=8_000, required=False),
        contact_hints=_strict_decrypted_string(decrypted, "contact_hints", max_length=1_000, required=False),
    )


def _validate_core_matches_submission(
    command: SubmissionCommand,
    core: dict[str, Any],
    chain_id: int,
    bug_index_address: str,
    configured_broker_address: str,
) -> None:
    _require_keys(
        core,
        {
            "schema",
            "version",
            "type",
            "reporter",
            "broker",
            "chain_id",
            "bug_index",
            "created_at",
            "reveal_after",
            "submission",
            "details",
            "commitments",
        },
        "BugBundle core",
    )
    _reject_unknown_keys(
        core,
        {
            "schema",
            "version",
            "type",
            "reporter",
            "broker",
            "chain_id",
            "bug_index",
            "created_at",
            "reveal_after",
            "submission",
            "details",
            "commitments",
        },
        "BugBundle core",
    )
    if core["schema"] != BUG_BUNDLE_SCHEMA:
        raise BugBundleError(f"BugBundle core schema must be {BUG_BUNDLE_SCHEMA}.")
    if core["version"] != BUG_BUNDLE_VERSION:
        raise BugBundleError(f"BugBundle core version must be {BUG_BUNDLE_VERSION}.")
    if core["type"] != "publisher_submission":
        raise BugBundleError("BugBundle core type must be publisher_submission.")
    if _normalize_address(str(core["reporter"])) != command.reporter_address:
        raise BugBundleError("BugBundle reporter does not match reporter_address.")
    if _normalize_address(str(core["broker"])) != command.broker_address:
        raise BugBundleError("BugBundle broker does not match broker_address.")
    if configured_broker_address and _normalize_address(str(core["broker"])) != configured_broker_address:
        raise BugBundleError("BugBundle broker does not match this broker.")
    if core["chain_id"] != chain_id:
        raise BugBundleError("BugBundle chain_id does not match this broker.")
    bundle_bug_index = _optional_address(str(core["bug_index"]))
    configured_bug_index = _optional_address(bug_index_address)
    if configured_bug_index and bundle_bug_index != configured_bug_index:
        raise BugBundleError("BugBundle bug_index does not match this broker.")
    _strict_string(core, "created_at", max_length=80)
    _strict_string(core, "reveal_after", max_length=80)

    submission = _dict_field(core, "submission")
    _reject_unknown_keys(
        submission,
        {"bug_type", "severity", "target_interest", "title", "public_summary", "target", "disclosure_mode", "tags"},
        "BugBundle submission",
    )
    if submission.get("bug_type") != command.bug_type:
        raise BugBundleError("BugBundle bug_type does not match submission command.")
    if submission.get("severity") != command.severity:
        raise BugBundleError("BugBundle severity does not match submission command.")
    if submission.get("target_interest") != command.target_interest:
        raise BugBundleError("BugBundle target_interest does not match submission command.")
    if submission.get("title") != command.title:
        raise BugBundleError("BugBundle title does not match submission command.")
    if submission.get("public_summary") != command.summary:
        raise BugBundleError("BugBundle public_summary does not match submission command.")
    if submission.get("disclosure_mode") != command.disclosure_mode:
        raise BugBundleError("BugBundle disclosure_mode does not match submission command.")
    if tuple(submission.get("tags") or ()) != command.tags:
        raise BugBundleError("BugBundle tags do not match submission command.")
    target = _dict_field(submission, "target")
    if target.get("kind") != command.target_kind or target.get("reference") != command.target_ref:
        raise BugBundleError("BugBundle target does not match submission command.")

    details = _dict_field(core, "details")
    _reject_unknown_keys(details, {"encrypted", "alg", "iv", "aad", "ciphertext"}, "BugBundle details")
    if details.get("encrypted") is not True:
        raise BugBundleError("BugBundle details must be encrypted.")
    if details.get("alg") != "AES-256-GCM":
        raise BugBundleError("BugBundle details alg must be AES-256-GCM.")

    commitments = _dict_field(core, "commitments")
    _reject_unknown_keys(
        commitments,
        {"encrypted_details_sha256", "details_key_commitment", "details_key_commitment_alg"},
        "BugBundle commitments",
    )
    _strict_hex32(commitments, "encrypted_details_sha256")
    _strict_hex32(commitments, "details_key_commitment")
    if commitments.get("details_key_commitment_alg") != "sha256":
        raise BugBundleError("BugBundle details key commitment alg must be sha256.")


def _verify_signature(command: SubmissionCommand, core: dict[str, Any], signature: dict[str, Any]) -> None:
    _reject_unknown_keys(signature, {"scheme", "signer", "core_sha256", "message", "value"}, "BugBundle signature")
    if signature.get("scheme") != BUG_BUNDLE_SIGNATURE_SCHEME:
        raise BugBundleError(f"BugBundle signature scheme must be {BUG_BUNDLE_SIGNATURE_SCHEME}.")
    signer = _normalize_address(_strict_string(signature, "signer", max_length=42))
    if signer != command.reporter_address:
        raise BugBundleError("BugBundle signature signer must match reporter_address.")
    core_sha256 = _strict_hex32(signature, "core_sha256")
    expected_core_sha256 = f"0x{hashlib.sha256(canonical_json_bytes(core)).hexdigest()}"
    if core_sha256.lower() != expected_core_sha256:
        raise BugBundleError("BugBundle signature core hash does not match the bundle core.")
    message = _strict_string(signature, "message", min_length=20, max_length=2_000)
    if message != build_bug_bundle_signature_message(core, core_sha256.lower()):
        raise BugBundleError("BugBundle signature message does not match the bundle core.")
    value = _strict_string(signature, "value", max_length=132)
    if not SIGNATURE_RE.match(value):
        raise BugBundleError("BugBundle signature value must be a 65-byte hex signature.")

    try:
        from eth_account import Account
        from eth_account.messages import encode_defunct
    except ImportError as exc:  # pragma: no cover - covered in broker runtime environment
        raise BugBundleError("BugBundle signature cannot be verified because eth_account is not installed.") from exc
    try:
        recovered = str(Account.recover_message(encode_defunct(text=message), signature=value)).lower()
    except Exception as exc:
        raise BugBundleError("BugBundle signature could not be recovered.") from exc
    if recovered != command.reporter_address:
        raise BugBundleError("BugBundle signature does not recover to reporter_address.")


def _validate_aad(core: dict[str, Any], details: dict[str, Any]) -> bytes:
    aad = _b64url_decode(_strict_string(details, "aad", max_length=50_000), field_name="details.aad")
    expected_object = {
        key: core[key]
        for key in (
            "schema",
            "version",
            "type",
            "reporter",
            "broker",
            "chain_id",
            "bug_index",
            "created_at",
            "reveal_after",
            "submission",
        )
    }
    expected = canonical_json_bytes(expected_object)
    if aad != expected:
        raise BugBundleError("BugBundle details AAD does not match the signed core metadata.")
    return aad


def _decrypt_details(details_key: bytes, iv: bytes, ciphertext: bytes, aad: bytes) -> dict[str, Any]:
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError as exc:  # pragma: no cover - covered by dependency install in runtime
        raise BugBundleError("Install broker dependencies with: pip install -r requirements-broker.txt") from exc
    try:
        plaintext = AESGCM(details_key).decrypt(iv, ciphertext, aad)
        decoded = json.loads(plaintext.decode("utf-8"))
    except Exception as exc:
        raise BugBundleError("BugBundle details could not be decrypted with the supplied key.") from exc
    if not isinstance(decoded, dict):
        raise BugBundleError("BugBundle decrypted details must be a JSON object.")
    _reject_unknown_keys(decoded, {"details", "repro_steps", "evidence", "contact_hints"}, "BugBundle decrypted details")
    return decoded


def _canonicalize(value: Any) -> Any:
    if isinstance(value, list):
        return [_canonicalize(item) for item in value]
    if isinstance(value, dict):
        return {key: _canonicalize(value[key]) for key in sorted(value) if value[key] is not None}
    return value


def _dict_field(data: dict[str, Any], name: str) -> dict[str, Any]:
    value = data.get(name)
    if not isinstance(value, dict):
        raise BugBundleError(f"{name} must be an object.")
    return value


def _strict_string(
    data: dict[str, Any],
    name: str,
    *,
    min_length: int = 1,
    max_length: int = 10_000,
) -> str:
    value = data.get(name)
    if not isinstance(value, str):
        raise BugBundleError(f"{name} must be a string.")
    if len(value) < min_length:
        raise BugBundleError(f"{name} is too short.")
    if len(value) > max_length:
        raise BugBundleError(f"{name} is too long.")
    return value


def _strict_decrypted_string(
    data: dict[str, Any],
    name: str,
    *,
    min_length: int = 0,
    max_length: int,
    required: bool = True,
) -> str:
    if name not in data:
        if required:
            raise BugBundleError(f"BugBundle decrypted details missing {name}.")
        return ""
    value = data[name]
    if not isinstance(value, str):
        raise BugBundleError(f"BugBundle decrypted details field {name} must be a string.")
    normalized = value.strip()
    if len(normalized) < min_length:
        raise BugBundleError(f"BugBundle decrypted details field {name} is too short.")
    if len(normalized) > max_length:
        raise BugBundleError(f"BugBundle decrypted details field {name} is too long.")
    return normalized


def _strict_hex32(data: dict[str, Any], name: str) -> str:
    value = _strict_string(data, name, max_length=66).lower()
    if not HEX_32_RE.match(value):
        raise BugBundleError(f"{name} must be a 32-byte hex value.")
    return value


def _b64url_decode(value: str, *, field_name: str) -> bytes:
    if not value or not B64URL_RE.match(value):
        raise BugBundleError(f"{field_name} must be base64url without padding.")
    padded = value + "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(padded.encode("ascii"))
    except Exception as exc:
        raise BugBundleError(f"{field_name} is not valid base64url.") from exc


def _normalize_address(address: str) -> str:
    value = address.strip()
    if not ADDRESS_RE.match(value):
        raise BugBundleError("Expected an EVM address like 0x....")
    return value.lower()


def _optional_address(address: str) -> str:
    value = address.strip()
    return _normalize_address(value) if value else ""


def _require_keys(data: dict[str, Any], required: set[str], label: str) -> None:
    missing = sorted(required - set(data.keys()))
    if missing:
        raise BugBundleError(f"{label} missing required field(s): {', '.join(missing)}.")


def _reject_unknown_keys(data: dict[str, Any], allowed: set[str], label: str) -> None:
    unknown = sorted(set(data.keys()) - allowed)
    if unknown:
        raise BugBundleError(f"{label} has unexpected field(s): {', '.join(unknown)}.")
