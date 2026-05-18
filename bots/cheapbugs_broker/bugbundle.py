"""BugBundle validation for broker-pinned IPFS submissions."""

from __future__ import annotations

import base64
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .models import SubmissionCommand


BUG_BUNDLE_SCHEMA = "cheapbugs.bug_bundle.v1"
BUG_BUNDLE_VERSION = 1
PUBLISH_AUTHORIZATION_SCHEME = "eip712_publish_bug_v1"
PUBLISH_BUG_TYPES = {
    "PublishBug": [
        {"name": "reportHash", "type": "bytes32"},
        {"name": "reportIdHash", "type": "bytes32"},
        {"name": "reporter", "type": "address"},
        {"name": "createdAt", "type": "uint64"},
        {"name": "disclosureMode", "type": "uint8"},
        {"name": "publicSummaryHash", "type": "bytes32"},
        {"name": "targetKind", "type": "uint8"},
        {"name": "targetRefHash", "type": "bytes32"},
        {"name": "tagsHash", "type": "bytes32"},
        {"name": "contentHash", "type": "bytes32"},
        {"name": "bugBundleHash", "type": "bytes32"},
        {"name": "encryptedDetailsHash", "type": "bytes32"},
        {"name": "detailsKeyCommitment", "type": "bytes32"},
        {"name": "revealAfter", "type": "uint64"},
        {"name": "nonce", "type": "uint256"},
        {"name": "deadline", "type": "uint64"},
        {"name": "broker", "type": "address"},
    ]
}
DISCLOSURE_MODES = {"private": 0, "embargoed": 1, "public": 2}
TARGET_KINDS = {"repo": 0, "package": 1, "domain": 2, "contract": 3, "protocol": 4, "other": 5}

ADDRESS_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
HEX_32_RE = re.compile(r"^0x[a-fA-F0-9]{64}$")
SIGNATURE_RE = re.compile(r"^0x[a-fA-F0-9]{130}$")
B64URL_RE = re.compile(r"^[A-Za-z0-9_-]+$")


@dataclass(frozen=True)
class VerifiedBugBundle:
    payload: dict[str, Any]
    details_key_b64: str
    publish_authorization: dict[str, Any]
    report_hash: str
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


def verify_authorized_bug_bundle(
    command: SubmissionCommand,
    *,
    chain_id: int,
    bug_index_address: str,
    configured_broker_address: str = "",
) -> VerifiedBugBundle:
    payload = command.bug_bundle
    if not isinstance(payload, dict):
        raise BugBundleError("BugBundle is missing.")
    _require_keys(payload, {"schema", "version", "core"}, "BugBundle")
    _reject_unknown_keys(payload, {"schema", "version", "core"}, "BugBundle")
    if payload["schema"] != BUG_BUNDLE_SCHEMA:
        raise BugBundleError(f"BugBundle schema must be {BUG_BUNDLE_SCHEMA}.")
    if payload["version"] != BUG_BUNDLE_VERSION:
        raise BugBundleError(f"BugBundle version must be {BUG_BUNDLE_VERSION}.")

    core = _dict_field(payload, "core")
    _validate_core_matches_submission(command, core, chain_id, bug_index_address, configured_broker_address)
    publish_authorization = _verify_publish_authorization(
        command,
        core,
        chain_id=chain_id,
        bug_index_address=bug_index_address,
        configured_broker_address=configured_broker_address,
    )

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
        publish_authorization=publish_authorization,
        report_hash=str(publish_authorization["message"]["reportHash"]).lower(),
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


def _verify_publish_authorization(
    command: SubmissionCommand,
    core: dict[str, Any],
    *,
    chain_id: int,
    bug_index_address: str,
    configured_broker_address: str,
) -> dict[str, Any]:
    auth = command.publish_authorization
    if not isinstance(auth, dict):
        raise BugBundleError("Publish authorization is missing.")
    _reject_unknown_keys(
        auth,
        {"scheme", "signer", "domain", "types", "primaryType", "message", "value"},
        "Publish authorization",
    )
    if auth.get("scheme") != PUBLISH_AUTHORIZATION_SCHEME:
        raise BugBundleError(f"Publish authorization scheme must be {PUBLISH_AUTHORIZATION_SCHEME}.")
    signer = _normalize_address(_strict_string(auth, "signer", max_length=42))
    if signer != command.reporter_address:
        raise BugBundleError("Publish authorization signer must match reporter_address.")
    if auth.get("primaryType") != "PublishBug":
        raise BugBundleError("Publish authorization primaryType must be PublishBug.")
    if auth.get("types") != PUBLISH_BUG_TYPES:
        raise BugBundleError("Publish authorization types do not match CheapBugsBugIndex.")
    value = _strict_string(auth, "value", max_length=132)
    if not SIGNATURE_RE.match(value):
        raise BugBundleError("Publish authorization value must be a 65-byte hex signature.")

    domain = _dict_field(auth, "domain")
    _reject_unknown_keys(domain, {"name", "version", "chainId", "verifyingContract"}, "Publish authorization domain")
    if domain.get("name") != "CheapBugsBugIndex" or domain.get("version") != "1":
        raise BugBundleError("Publish authorization domain name/version does not match CheapBugsBugIndex.")
    domain_chain_id = _strict_uint(domain, "chainId")
    if domain_chain_id != chain_id:
        raise BugBundleError("Publish authorization chainId does not match this broker.")
    verifying_contract = _normalize_address(_strict_string(domain, "verifyingContract", max_length=42))
    if bug_index_address and verifying_contract != _normalize_address(bug_index_address):
        raise BugBundleError("Publish authorization verifyingContract does not match this broker.")

    message = _dict_field(auth, "message")
    _reject_unknown_keys(message, {field["name"] for field in PUBLISH_BUG_TYPES["PublishBug"]}, "Publish authorization message")
    normalized_message = _normalized_publish_message(message)

    expected_core_sha256 = f"0x{hashlib.sha256(canonical_json_bytes(core)).hexdigest()}"
    if normalized_message["bugBundleHash"] != expected_core_sha256:
        raise BugBundleError("Publish authorization bugBundleHash does not match the bundle core.")

    commitments = _dict_field(core, "commitments")
    if normalized_message["encryptedDetailsHash"] != _strict_hex32(commitments, "encrypted_details_sha256"):
        raise BugBundleError("Publish authorization encryptedDetailsHash does not match the bundle core.")
    if normalized_message["detailsKeyCommitment"] != _strict_hex32(commitments, "details_key_commitment"):
        raise BugBundleError("Publish authorization detailsKeyCommitment does not match the bundle core.")
    if normalized_message["reporter"] != command.reporter_address:
        raise BugBundleError("Publish authorization reporter does not match reporter_address.")
    broker = configured_broker_address or command.broker_address
    if normalized_message["broker"] != _normalize_address(broker):
        raise BugBundleError("Publish authorization broker does not match this broker.")
    if normalized_message["createdAt"] != _iso_to_unix_seconds(_strict_string(core, "created_at", max_length=80)):
        raise BugBundleError("Publish authorization createdAt does not match the bundle core.")
    if normalized_message["revealAfter"] != _iso_to_unix_seconds(_strict_string(core, "reveal_after", max_length=80)):
        raise BugBundleError("Publish authorization revealAfter does not match the bundle core.")

    try:
        from eth_account import Account
        from eth_account.messages import encode_typed_data
        from eth_utils import keccak
    except ImportError as exc:  # pragma: no cover - covered in broker runtime environment
        raise BugBundleError("Publish authorization cannot be verified because eth_account is not installed.") from exc

    submission = _dict_field(core, "submission")
    target = _dict_field(submission, "target")
    expected_report_hash = _keccak_json(
        {
            "reporter": core["reporter"],
            "broker": core["broker"],
            "chain_id": core["chain_id"],
            "bug_index": core["bug_index"],
            "created_at": core["created_at"],
            "reveal_after": core["reveal_after"],
            "submission": submission,
            "encrypted_details_sha256": commitments["encrypted_details_sha256"],
            "details_key_commitment": commitments["details_key_commitment"],
        },
        keccak,
    )
    expected_report_id = f"cb-{expected_report_hash[2:10]}"
    expected_content_hash = _keccak_json(
        {
            "submission": submission,
            "encrypted_details_sha256": commitments["encrypted_details_sha256"],
            "details_key_commitment": commitments["details_key_commitment"],
        },
        keccak,
    )
    expected_hashes = {
        "reportHash": expected_report_hash,
        "reportIdHash": _keccak_text(expected_report_id, keccak),
        "publicSummaryHash": _keccak_text(str(submission["public_summary"]), keccak),
        "targetRefHash": _keccak_text(str(target["reference"]).lower(), keccak),
        "tagsHash": _keccak_text(",".join(submission.get("tags") or []), keccak),
        "contentHash": expected_content_hash,
    }
    for field, expected in expected_hashes.items():
        if normalized_message[field] != expected:
            raise BugBundleError(f"Publish authorization {field} does not match the bundle core.")
    if normalized_message["disclosureMode"] != DISCLOSURE_MODES[str(submission["disclosure_mode"])]:
        raise BugBundleError("Publish authorization disclosureMode does not match the bundle core.")
    if normalized_message["targetKind"] != TARGET_KINDS[str(target["kind"])]:
        raise BugBundleError("Publish authorization targetKind does not match the bundle core.")

    typed_data = {
        "domain": {
            "name": domain["name"],
            "version": domain["version"],
            "chainId": domain_chain_id,
            "verifyingContract": verifying_contract,
        },
        "types": PUBLISH_BUG_TYPES,
        "primaryType": "PublishBug",
        "message": normalized_message,
    }
    try:
        recovered = str(Account.recover_message(encode_typed_data(full_message=typed_data), signature=value)).lower()
    except Exception as exc:
        raise BugBundleError("Publish authorization signature could not be recovered.") from exc
    if recovered != command.reporter_address:
        raise BugBundleError("Publish authorization signature does not recover to reporter_address.")

    result = dict(auth)
    result["domain"] = dict(domain)
    result["message"] = dict(normalized_message)
    return result


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


def _strict_uint(data: dict[str, Any], name: str) -> int:
    value = data.get(name)
    if isinstance(value, bool):
        raise BugBundleError(f"{name} must be an unsigned integer.")
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str) and value.isdigit():
        parsed = int(value, 10)
    else:
        raise BugBundleError(f"{name} must be an unsigned integer.")
    if parsed < 0:
        raise BugBundleError(f"{name} must be an unsigned integer.")
    return parsed


def _normalized_publish_message(message: dict[str, Any]) -> dict[str, Any]:
    return {
        "reportHash": _strict_hex32(message, "reportHash"),
        "reportIdHash": _strict_hex32(message, "reportIdHash"),
        "reporter": _normalize_address(_strict_string(message, "reporter", max_length=42)),
        "createdAt": _strict_uint(message, "createdAt"),
        "disclosureMode": _strict_uint(message, "disclosureMode"),
        "publicSummaryHash": _strict_hex32(message, "publicSummaryHash"),
        "targetKind": _strict_uint(message, "targetKind"),
        "targetRefHash": _strict_hex32(message, "targetRefHash"),
        "tagsHash": _strict_hex32(message, "tagsHash"),
        "contentHash": _strict_hex32(message, "contentHash"),
        "bugBundleHash": _strict_hex32(message, "bugBundleHash"),
        "encryptedDetailsHash": _strict_hex32(message, "encryptedDetailsHash"),
        "detailsKeyCommitment": _strict_hex32(message, "detailsKeyCommitment"),
        "revealAfter": _strict_uint(message, "revealAfter"),
        "nonce": _strict_uint(message, "nonce"),
        "deadline": _strict_uint(message, "deadline"),
        "broker": _normalize_address(_strict_string(message, "broker", max_length=42)),
    }


def _iso_to_unix_seconds(value: str) -> int:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise BugBundleError("BugBundle timestamp is not a valid ISO-8601 value.") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def _keccak_text(value: str, keccak_fn: Any) -> str:
    return f"0x{keccak_fn(text=value).hex()}"


def _keccak_json(value: Any, keccak_fn: Any) -> str:
    return f"0x{keccak_fn(canonical_json_bytes(value)).hex()}"


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
