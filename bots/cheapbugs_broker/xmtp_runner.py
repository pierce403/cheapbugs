"""Runtime glue between xmtp-py and the broker service."""

from __future__ import annotations

import asyncio
import inspect
import logging
import os
from typing import Any

from .config import BrokerConfig
from .service import BrokerBot


def patch_xmtp_backend_connector(native_bindings: Any) -> bool:
    """Bridge xmtp 0.1.6's client wrapper to the updated bindings connector."""

    original = getattr(native_bindings, "connect_to_backend", None)
    if original is None:
        return False

    try:
        parameter_count = len(inspect.signature(original).parameters)
    except (TypeError, ValueError):
        return False
    if parameter_count != 6:
        return False

    async def connect_to_backend_compat(*args: Any) -> Any:
        if len(args) == 7:
            host, gateway_host, _is_secure, client_mode, app_version, auth_callback, auth_handle = args
            if client_mode is None and hasattr(native_bindings, "FfiClientMode"):
                client_mode = native_bindings.FfiClientMode.DEFAULT
            return await original(host, gateway_host, client_mode, app_version, auth_callback, auth_handle)
        return await original(*args)

    setattr(native_bindings, "connect_to_backend", connect_to_backend_compat)
    return True


def patch_xmtp_client_factory(native_bindings: Any) -> bool:
    """Bridge xmtp 0.1.6's client wrapper to the updated create_client binding."""

    patched = False
    if not hasattr(native_bindings, "FfiSyncWorkerMode") and hasattr(native_bindings, "FfiDeviceSyncMode"):
        setattr(native_bindings, "FfiSyncWorkerMode", native_bindings.FfiDeviceSyncMode)
        patched = True

    original = getattr(native_bindings, "create_client", None)
    if original is None:
        return patched

    try:
        parameter_count = len(inspect.signature(original).parameters)
    except (TypeError, ValueError):
        return patched
    if parameter_count != 10 or not hasattr(native_bindings, "DbOptions"):
        return patched

    async def create_client_compat(*args: Any) -> Any:
        if len(args) == 12:
            (
                api,
                sync_api,
                db_path,
                encryption_key,
                inbox_id,
                account_identifier,
                nonce,
                legacy_signed_private_key_proto,
                _device_sync_server_url,
                device_sync_mode,
                allow_offline,
                fork_recovery_opts,
            ) = args
            db_options = native_bindings.DbOptions(
                db=db_path,
                encryption_key=encryption_key,
                max_db_pool_size=None,
                min_db_pool_size=None,
            )
            return await original(
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
        return await original(*args)

    setattr(native_bindings, "create_client", create_client_compat)
    return True


def patch_xmtp_native_compat(native_bindings: Any) -> bool:
    connector_patched = patch_xmtp_backend_connector(native_bindings)
    factory_patched = patch_xmtp_client_factory(native_bindings)
    return connector_patched or factory_patched


def plain_text_status_sender(ctx):
    """Return a broker status sender that avoids XMTP reply-content encoding."""

    async def send_status(text: str) -> None:
        await ctx.send_text(text)

    return send_status


async def run_xmtp_broker(config: BrokerConfig, bot: BrokerBot) -> None:
    logger = logging.getLogger(__name__)
    try:
        from xmtp.bindings import NativeBindings
        from xmtp.types import ClientOptions, LogLevel
        from xmtp_agent import Agent
    except ImportError as exc:
        raise RuntimeError("Install bot dependencies with: pip install -r requirements-broker.txt") from exc

    if patch_xmtp_native_compat(NativeBindings):
        logger.info("installed xmtp native compatibility shim")

    options = ClientOptions(
        env=config.xmtp_env,
        db_path=config.xmtp_db_path,
        disable_history_sync=True,
        logging_level=LogLevel.WARN,
    )
    os.environ["XMTP_WALLET_KEY"] = config.broker_key
    logger.info("creating xmtp agent env=%s db_path=%s", config.xmtp_env, config.xmtp_db_path or "default")
    agent = await Agent.create_from_env(options)

    @agent.on("text")
    async def on_text(ctx) -> None:
        sender_address = await ctx.get_sender_address()
        logger.info(
            "xmtp text event conversation_id=%s message_id=%s sender=%s",
            ctx.message.conversation_id.hex(),
            ctx.message.id.hex(),
            sender_address or "unknown",
        )
        await bot.handle_xmtp_text(
            text=str(ctx.message.content),
            sender_address=sender_address,
            conversation_id=ctx.message.conversation_id.hex(),
            message_id=ctx.message.id.hex(),
            reply=plain_text_status_sender(ctx),
        )

    logger.info("starting xmtp broker agent env=%s", config.xmtp_env)
    await agent.start()
    if config.signal_enabled:
        logger.info("starting signal poll and settlement loops")
        await asyncio.gather(bot.poll_signal_forever(), bot.settle_forever())
    else:
        logger.warning(
            "Signal is not configured; broker will validate XMTP submissions without Signal relay or reward settlement."
        )
        await asyncio.Event().wait()
