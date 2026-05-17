from __future__ import annotations

import asyncio
import unittest

from cheapbugs_broker.xmtp_runner import plain_text_status_sender


class PlainTextStatusSenderTest(unittest.TestCase):
    def test_sender_uses_plain_text_not_reply_content_type(self) -> None:
        ctx = FakeContext()
        sender = plain_text_status_sender(ctx)

        asyncio.run(sender("Submission JSON is valid."))

        self.assertEqual(ctx.sent_text, ["Submission JSON is valid."])
        self.assertFalse(ctx.used_reply_content_type)


class FakeContext:
    def __init__(self) -> None:
        self.sent_text: list[str] = []
        self.used_reply_content_type = False

    async def send_text(self, text: str) -> None:
        self.sent_text.append(text)

    async def send_text_reply(self, text: str) -> None:
        self.used_reply_content_type = True
        raise AssertionError(f"unexpected reply-content send: {text}")
