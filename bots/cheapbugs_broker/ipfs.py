"""Kubo IPFS HTTP API client for broker-side BugBundle pinning."""

from __future__ import annotations

import hashlib
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from .bugbundle import canonical_json_bytes


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class IpfsAddResult:
    cid: str
    uri: str
    name: str
    size: int
    sha256: str
    gateway_url: str


class KuboIpfsClient:
    def __init__(
        self,
        api_url: str,
        *,
        gateway_url: str,
        prime_gateway: bool = False,
        timeout_seconds: int = 10,
    ):
        self.api_url = api_url.rstrip("/")
        self.gateway_url = gateway_url.rstrip("/")
        self.prime_gateway_enabled = prime_gateway
        self.timeout_seconds = timeout_seconds

    def verify_writable(self) -> str:
        version = self._post_json("/api/v0/version", {})
        version_text = str(version.get("Version") or "unknown")
        probe = {"schema": "cheapbugs.ipfs_probe.v1", "ok": True}
        self._add_bytes(
            canonical_json_bytes(probe),
            "cheapbugs-ipfs-probe.json",
            pin=False,
            only_hash=False,
        )
        return version_text

    def add_json(self, payload: Any, name: str) -> IpfsAddResult:
        body = canonical_json_bytes(payload)
        result = self._add_bytes(body, name, pin=True, only_hash=False)
        cid = str(result["Hash"])
        return IpfsAddResult(
            cid=cid,
            uri=f"ipfs://{cid}",
            name=str(result.get("Name") or name),
            size=int(result.get("Size") or len(body)),
            sha256=f"0x{hashlib.sha256(body).hexdigest()}",
            gateway_url=self.to_gateway_url(cid),
        )

    def prime_gateway(self, cid: str) -> bool:
        if not self.prime_gateway_enabled:
            return False
        url = self.to_gateway_url(cid)
        try:
            request = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                response.read(1)
            logger.info("ipfs gateway prime succeeded cid=%s gateway_url=%s", cid, url)
            return True
        except Exception as exc:
            logger.warning("ipfs gateway prime failed cid=%s gateway_url=%s error=%s", cid, url, exc)
            return False

    def to_gateway_url(self, cid: str) -> str:
        return f"{self.gateway_url}/{cid}"

    def _post_json(self, path: str, params: dict[str, str]) -> dict[str, Any]:
        query = urllib.parse.urlencode(params)
        url = f"{self.api_url}{path}{'?' + query if query else ''}"
        request = urllib.request.Request(url, data=b"", method="POST")
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Kubo IPFS API is not reachable at {self.api_url}: {exc}") from exc

    def _add_bytes(self, body: bytes, name: str, *, pin: bool, only_hash: bool) -> dict[str, Any]:
        boundary = "cheapbugs-ipfs-boundary"
        multipart = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{name}"\r\n'
            "Content-Type: application/json\r\n\r\n"
        ).encode("utf-8") + body + f"\r\n--{boundary}--\r\n".encode("utf-8")
        params = {
            "cid-version": "1",
            "hash": "sha2-256",
            "pin": "true" if pin else "false",
            "only-hash": "true" if only_hash else "false",
            "wrap-with-directory": "false",
        }
        url = f"{self.api_url}/api/v0/add?{urllib.parse.urlencode(params)}"
        request = urllib.request.Request(
            url,
            data=multipart,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                lines = [line for line in response.read().decode("utf-8").splitlines() if line.strip()]
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Kubo IPFS add failed at {self.api_url}: {exc}") from exc
        if not lines:
            raise RuntimeError("Kubo IPFS add returned an empty response.")
        parsed = json.loads(lines[-1])
        if "Hash" not in parsed:
            raise RuntimeError(f"Kubo IPFS add response did not include a CID: {parsed!r}")
        return parsed
