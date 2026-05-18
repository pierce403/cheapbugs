from __future__ import annotations

import unittest
from unittest.mock import patch

from cheapbugs_broker.ipfs import KuboIpfsClient


class FakeHttpResponse:
    def __init__(self, body: bytes):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc, _tb) -> None:
        return None

    def read(self, _size: int | None = None) -> bytes:
        return self.body


class KuboIpfsClientTest(unittest.TestCase):
    def test_verify_writable_and_add_json_use_kubo_add_api(self) -> None:
        urls: list[str] = []

        def fake_urlopen(request, timeout: int):
            urls.append(request.full_url)
            if request.full_url.endswith("/api/v0/version"):
                return FakeHttpResponse(b'{"Version":"0.31.0"}')
            self.assertIn("/api/v0/add?", request.full_url)
            self.assertIn("multipart/form-data", request.headers["Content-type"])
            return FakeHttpResponse(b'{"Name":"bundle.json","Hash":"bafytest","Size":"42"}\n')

        client = KuboIpfsClient(
            "http://127.0.0.1:5001",
            gateway_url="https://ipfs.io/ipfs",
            timeout_seconds=3,
        )
        with patch("urllib.request.urlopen", fake_urlopen):
            self.assertEqual(client.verify_writable(), "0.31.0")
            result = client.add_json({"hello": "world"}, "bundle.json")

        self.assertTrue(any("only-hash=false" in url and "pin=false" in url for url in urls))
        self.assertTrue(any("only-hash=false" in url and "pin=true" in url for url in urls))
        self.assertEqual(result.cid, "bafytest")
        self.assertEqual(result.uri, "ipfs://bafytest")
        self.assertEqual(result.gateway_url, "https://ipfs.io/ipfs/bafytest")


if __name__ == "__main__":
    unittest.main()
