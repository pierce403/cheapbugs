from __future__ import annotations

import asyncio
import unittest

from cheapbugs_broker.xmtp_runner import (
    patch_xmtp_agent_stream_stop,
    patch_xmtp_backend_connector,
    patch_xmtp_client_factory,
    patch_xmtp_register_identity,
    patch_xmtp_subscribe_error_type,
    plain_text_status_sender,
)


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


class BackendConnectorCompatTest(unittest.TestCase):
    def test_patch_bridges_old_client_call_to_new_bindings_signature(self) -> None:
        bindings = FakeBindings()

        self.assertTrue(patch_xmtp_backend_connector(bindings))
        result = asyncio.run(
            bindings.connect_to_backend(
                "https://grpc.production.xmtp.network",
                None,
                True,
                None,
                "cheapbugs-test",
                None,
                None,
            )
        )

        self.assertEqual(result, "api-client")
        self.assertEqual(
            bindings.calls,
            [
                (
                    "https://grpc.production.xmtp.network",
                    None,
                    FakeBindings.FfiClientMode.DEFAULT,
                    "cheapbugs-test",
                    None,
                    None,
                )
            ],
        )

    def test_patch_bridges_old_create_client_call_to_new_bindings_signature(self) -> None:
        bindings = FakeBindings()

        self.assertTrue(patch_xmtp_client_factory(bindings))
        result = asyncio.run(
            bindings.create_client(
                "api",
                "sync-api",
                ".broker/xmtp.db3",
                b"key",
                "inbox",
                "identifier",
                0,
                None,
                None,
                bindings.FfiSyncWorkerMode.DISABLED,
                None,
                None,
            )
        )

        self.assertEqual(result, "xmtp-client")
        self.assertIs(bindings.FfiSyncWorkerMode, FakeBindings.FfiDeviceSyncMode)
        self.assertEqual(len(bindings.client_calls), 1)
        self.assertEqual(bindings.client_calls[0][0:2], ("api", "sync-api"))
        self.assertEqual(bindings.client_calls[0][2].db, ".broker/xmtp.db3")
        self.assertEqual(bindings.client_calls[0][2].encryption_key, b"key")
        self.assertEqual(bindings.client_calls[0][3:], ("inbox", "identifier", 0, None, "disabled", None, None))

    def test_patch_adds_missing_subscribe_error_alias(self) -> None:
        bindings = FakeBindings()

        self.assertFalse(hasattr(bindings, "FfiSubscribeError"))
        self.assertTrue(patch_xmtp_subscribe_error_type(bindings))

        self.assertTrue(isinstance(FakeBindings.FfiError("stream failed"), bindings.FfiSubscribeError))
        self.assertTrue(isinstance(FakeBindings.InternalError("stream failed"), bindings.FfiSubscribeError))

    def test_patch_bridges_optional_register_identity_options(self) -> None:
        bindings = FakeBindings()

        self.assertTrue(patch_xmtp_register_identity(bindings))
        client = bindings.FfiXmtpClient()
        asyncio.run(client.register_identity("signature-request"))

        self.assertEqual(client.register_calls, [("signature-request", None)])

    def test_patch_stream_stop_does_not_cancel_current_stream_task(self) -> None:
        async def run_test() -> None:
            agent = FakeAgent()
            current_task = asyncio.current_task()
            other_task = asyncio.create_task(asyncio.sleep(60))
            agent._message_stream = current_task
            agent._conversation_stream = other_task
            agent._message_stream_handle = FakeStreamHandle()
            agent._conversation_stream_handle = FakeStreamHandle()

            self.assertTrue(patch_xmtp_agent_stream_stop(FakeAgent))
            await agent._stop_streams()

            self.assertFalse(current_task.cancelled())
            self.assertTrue(other_task.cancelled())
            self.assertIsNone(agent._message_stream)
            self.assertIsNone(agent._conversation_stream)
            self.assertEqual(agent.closed_handles, 2)

        asyncio.run(run_test())


class FakeBindings:
    def __init__(self) -> None:
        self.calls: list[tuple[object, ...]] = []
        self.client_calls: list[tuple[object, ...]] = []

    class FfiClientMode:
        DEFAULT = "default"

    class FfiDeviceSyncMode:
        ENABLED = "enabled"
        DISABLED = "disabled"

    class FfiError(Exception):
        pass

    class InternalError(Exception):
        pass

    class DbOptions:
        def __init__(
            self,
            *,
            db: str | None,
            encryption_key: bytes | None,
            max_db_pool_size: int | None,
            min_db_pool_size: int | None,
        ) -> None:
            self.db = db
            self.encryption_key = encryption_key
            self.max_db_pool_size = max_db_pool_size
            self.min_db_pool_size = min_db_pool_size

    class FfiXmtpClient:
        def __init__(self) -> None:
            self.register_calls: list[tuple[object, object]] = []

        async def register_identity(self, signature_request: object, visibility_confirmation_options: object) -> None:
            self.register_calls.append((signature_request, visibility_confirmation_options))

    async def connect_to_backend(
        self,
        host: str,
        gateway_host: str | None,
        client_mode: object,
        app_version: str | None,
        auth_callback: object,
        auth_handle: object,
    ) -> str:
        self.calls.append((host, gateway_host, client_mode, app_version, auth_callback, auth_handle))
        return "api-client"

    async def create_client(
        self,
        api: object,
        sync_api: object,
        db_options: DbOptions,
        inbox_id: str,
        account_identifier: object,
        nonce: int,
        legacy_signed_private_key_proto: bytes | None,
        device_sync_mode: object,
        allow_offline: bool | None,
        fork_recovery_opts: object,
    ) -> str:
        self.client_calls.append(
            (
                api,
                sync_api,
                db_options,
                inbox_id,
                account_identifier,
                nonce,
                legacy_signed_private_key_proto,
                device_sync_mode,
                allow_offline,
                fork_recovery_opts,
            )
        )
        return "xmtp-client"


class FakeStreamHandle:
    def __init__(self) -> None:
        self.closed = False

    async def close(self) -> None:
        self.closed = True


class FakeAgent:
    def __init__(self) -> None:
        self._conversation_stream = None
        self._message_stream = None
        self._conversation_stream_handle = None
        self._message_stream_handle = None
        self.closed_handles = 0

    async def _stop_streams(self) -> None:
        raise AssertionError("unpatched stream stop called")

    def __setattr__(self, name: str, value: object) -> None:
        if name.endswith("_stream_handle") and isinstance(getattr(self, name, None), FakeStreamHandle) and value is None:
            self.closed_handles += 1
        super().__setattr__(name, value)
