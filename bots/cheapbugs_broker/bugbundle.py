"""BugBundle construction for broker-pinned IPFS submissions."""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .models import SubmissionCommand


BUG_BUNDLE_SCHEMA = "cheapbugs.bug_bundle.v1"
BUG_BUNDLE_VERSION = 1


@dataclass(frozen=True)
class BuiltBugBundle:
    payload: dict[str, Any]
    details_key_b64: str
    details_key_commitment: str
    encrypted_details_hash: str


def build_unsigned_encrypted_bug_bundle(
    command: SubmissionCommand,
    *,
    broker_address: str,
    chain_id: int,
    bug_index_address: str,
    created_at: int,
    reveal_after: int,
) -> BuiltBugBundle:
    """Build an interim encrypted BugBundle from the current plaintext XMTP command.

    The final product path should receive this encrypted bundle already built and
    signed by the submitter. Until that exists, the broker encrypts details before
    IPFS so plaintext private details are not pinned.
    """

    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError as exc:  # pragma: no cover - covered by dependency install in runtime
        raise RuntimeError("Install broker dependencies with: pip install -r requirements-broker.txt") from exc

    created_iso = _timestamp_to_iso(created_at)
    reveal_iso = _timestamp_to_iso(reveal_after)
    submission = {
        "bug_type": command.bug_type,
        "severity": command.severity,
        "target_interest": command.target_interest,
        "title": command.title,
        "public_summary": command.summary,
        "target": {
            "kind": command.target_kind,
            "reference": command.target_ref,
        },
        "disclosure_mode": command.disclosure_mode,
        "tags": list(command.tags),
    }
    aad_object = {
        "schema": BUG_BUNDLE_SCHEMA,
        "version": BUG_BUNDLE_VERSION,
        "type": "publisher_submission",
        "reporter": command.reporter_address,
        "broker": broker_address,
        "chain_id": chain_id,
        "bug_index": bug_index_address,
        "created_at": created_iso,
        "reveal_after": reveal_iso,
        "submission": submission,
    }
    aad = canonical_json_bytes(aad_object)

    details_plaintext = canonical_json_bytes(
        {
            "details": command.details,
            "repro_steps": command.repro_steps,
            "evidence": command.evidence,
            "contact_hints": command.contact_hints,
        }
    )
    details_key = secrets.token_bytes(32)
    iv = secrets.token_bytes(12)
    ciphertext = AESGCM(details_key).encrypt(iv, details_plaintext, aad)
    details_key_commitment = f"0x{hashlib.sha256(details_key).hexdigest()}"
    encrypted_details_hash = f"0x{hashlib.sha256(ciphertext).hexdigest()}"

    core = {
        **aad_object,
        "details": {
            "encrypted": True,
            "alg": "AES-256-GCM",
            "iv": _b64url(iv),
            "aad": _b64url(aad),
            "ciphertext": _b64url(ciphertext),
        },
        "commitments": {
            "encrypted_details_sha256": encrypted_details_hash,
            "details_key_commitment": details_key_commitment,
            "details_key_commitment_alg": "sha256",
        },
    }
    signature_payload = None
    if command.signature is not None:
        signature_payload = {
            "scheme": command.signature.scheme,
            "signer": command.signature.signer,
            "payload_sha256": command.signature.payload_sha256,
            "message": command.signature.message,
            "value": command.signature.value,
            "verified_by_broker": True,
        }

    payload = {
        "schema": BUG_BUNDLE_SCHEMA,
        "version": BUG_BUNDLE_VERSION,
        "core": core,
        "signature": signature_payload,
        "broker_status": {
            "reporter_signature": "verified" if signature_payload else "missing",
            "note": (
                "Interim broker-encrypted bundle; reporter signature verified over the canonical XMTP submission payload."
                if signature_payload
                else "Interim broker-encrypted bundle; reporter signature missing."
            ),
        },
    }
    return BuiltBugBundle(
        payload=payload,
        details_key_b64=_b64url(details_key),
        details_key_commitment=details_key_commitment,
        encrypted_details_hash=encrypted_details_hash,
    )


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _timestamp_to_iso(value: int) -> str:
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")
