"""Runtime glue between xmtp-py and the broker service."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
import inspect
import logging
import os
from pathlib import Path
from typing import Any

from .config import BrokerConfig
from .service import BrokerBot


DEFAULT_XMTP_INSTALLATION_LIMIT = 10


def patch_xmtp_backend_connector(native_bindings: Any) -> bool:
    """Bridge old xmtp wrapper calls when bindings drift to a newer connector."""

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


def patch_xmtp_register_identity(native_bindings: Any) -> bool:
    """Bridge old xmtp wrapper calls when bindings add register options."""

    client_cls = getattr(native_bindings, "FfiXmtpClient", None)
    if client_cls is None:
        return False
    original = getattr(client_cls, "register_identity", None)
    if original is None or getattr(original, "_cheapbugs_patched", False):
        return False

    try:
        parameter_count = len(inspect.signature(original).parameters)
    except (TypeError, ValueError):
        return False
    if parameter_count != 3:
        return False

    async def register_identity_compat(self: Any, signature_request: Any, visibility_confirmation_options: Any = None) -> Any:
        return await original(self, signature_request, visibility_confirmation_options)

    register_identity_compat._cheapbugs_patched = True  # type: ignore[attr-defined]
    setattr(client_cls, "register_identity", register_identity_compat)
    return True


def patch_xmtp_client_factory(native_bindings: Any) -> bool:
    """Bridge old xmtp wrapper calls when bindings use DbOptions."""

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


def patch_xmtp_subscribe_error_type(native_bindings: Any) -> bool:
    """Bridge the old stream error name to the current bindings error classes."""

    if hasattr(native_bindings, "FfiSubscribeError"):
        return False

    error_types = tuple(
        error_type
        for error_type in (
            getattr(native_bindings, "FfiError", None),
            getattr(native_bindings, "InternalError", None),
        )
        if isinstance(error_type, type)
    )
    if not error_types:
        return False

    setattr(native_bindings, "FfiSubscribeError", error_types[0] if len(error_types) == 1 else error_types)
    return True


def patch_xmtp_native_compat(native_bindings: Any) -> bool:
    subscribe_error_patched = patch_xmtp_subscribe_error_type(native_bindings)
    connector_patched = patch_xmtp_backend_connector(native_bindings)
    factory_patched = patch_xmtp_client_factory(native_bindings)
    register_identity_patched = patch_xmtp_register_identity(native_bindings)
    return subscribe_error_patched or connector_patched or factory_patched or register_identity_patched


def patch_xmtp_agent_stream_stop(agent_cls: Any) -> bool:
    """Avoid recursive self-cancellation in xmtp_agent stream shutdown."""

    original = getattr(agent_cls, "_stop_streams", None)
    if original is None or getattr(original, "_cheapbugs_patched", False):
        return False

    async def stop_streams_without_self_cancel(self: Any) -> None:
        if self._conversation_stream_handle is not None:
            await self._conversation_stream_handle.close()
            self._conversation_stream_handle = None
        if self._message_stream_handle is not None:
            await self._message_stream_handle.close()
            self._message_stream_handle = None

        current_task = asyncio.current_task()
        tasks = [
            task
            for task in (self._conversation_stream, self._message_stream)
            if task is not None and task is not current_task
        ]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._conversation_stream = None
        self._message_stream = None

    stop_streams_without_self_cancel._cheapbugs_patched = True  # type: ignore[attr-defined]
    setattr(agent_cls, "_stop_streams", stop_streams_without_self_cancel)
    return True


@dataclass(frozen=True)
class XmtpInstallationSnapshot:
    total_installations: int
    installation_id: str | None
    most_recent_installation_id: str | None
    is_most_recent: bool
    installations: tuple[Any, ...]


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _installation_sort_key(installation: Any) -> int:
    timestamp = getattr(installation, "client_timestamp_ns", None)
    return int(timestamp or 0)


def _installation_hex(installation_id: bytes | None) -> str | None:
    return installation_id.hex() if isinstance(installation_id, bytes) else None


def _installation_ids_for_revocation(
    installations: tuple[Any, ...],
    current_installation_id: bytes | None,
) -> list[bytes]:
    current = _installation_hex(current_installation_id)
    ids: list[bytes] = []
    for installation in installations:
        installation_id = getattr(installation, "id", None)
        if not isinstance(installation_id, bytes):
            continue
        if current is not None and installation_id.hex() == current:
            continue
        ids.append(installation_id)
    return ids


def _snapshot_installation_ids(snapshot: XmtpInstallationSnapshot) -> tuple[str, ...]:
    return tuple(
        installation_hex
        for installation_hex in (
            _installation_hex(getattr(installation, "id", None))
            for installation in snapshot.installations
        )
        if installation_hex is not None
    )


def _snapshot_includes_current_installation(snapshot: XmtpInstallationSnapshot) -> bool:
    if snapshot.installation_id is None:
        return False
    return snapshot.installation_id in _snapshot_installation_ids(snapshot)


async def _installation_snapshot(client: Any) -> XmtpInstallationSnapshot:
    inbox_id = client.inbox_id
    installation_id = client.installation_id
    if inbox_id is None or installation_id is None:
        return XmtpInstallationSnapshot(0, None, None, False, tuple())

    inbox_state = await client.preferences.inbox_state(refresh_from_network=True)
    installations = tuple(
        sorted(getattr(inbox_state, "installations", ()) or (), key=_installation_sort_key, reverse=True)
    )
    installation_id_hex = installation_id.hex()
    most_recent = installations[0] if installations else None
    most_recent_id = getattr(most_recent, "id", None)
    most_recent_hex = most_recent_id.hex() if isinstance(most_recent_id, bytes) else None
    return XmtpInstallationSnapshot(
        total_installations=len(installations),
        installation_id=installation_id_hex,
        most_recent_installation_id=most_recent_hex,
        is_most_recent=most_recent_hex == installation_id_hex if most_recent_hex else False,
        installations=installations,
    )


def _xmtp_db_inbox_mismatch(error: BaseException) -> bool:
    message = str(error).lower()
    return "does not match the stored inboxid" in message or (
        "clientbuildererror::identity" in message and "stored inboxid" in message
    )


def _xmtp_installation_limit_error(error: BaseException) -> bool:
    message = str(error).lower()
    return "installation" in message and any(marker in message for marker in ("limit", "max", "maximum", "too many"))


def _archive_xmtp_db(db_path: str | None, logger: logging.Logger) -> bool:
    if not db_path:
        return False
    base = Path(db_path)
    candidates = [base, Path(f"{db_path}-wal"), Path(f"{db_path}-shm")]
    existing = [path for path in candidates if path.exists()]
    if not existing:
        return False

    archive_dir = base.parent / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    for path in existing:
        target = archive_dir / f"{path.name}.{timestamp}.bak"
        os.replace(path, target)
        logger.warning("archived stale XMTP database file path=%s archive=%s", path, target)
    return True


async def _sign_signature_request(signer: Any, signature_request: Any) -> None:
    signature_text_result = signature_request.signature_text()
    signature_text = await signature_text_result if inspect.isawaitable(signature_text_result) else signature_text_result
    signature = await signer.sign_message(str(signature_text).encode())

    signer_type = getattr(signer, "type", None)
    if getattr(signer_type, "value", signer_type) == "SCW":
        address = await signer.get_address()
        chain_id = await signer.get_chain_id()
        block_number = await signer.get_block_number()
        await signature_request.add_scw_signature(signature, address, chain_id, block_number)
        return

    await signature_request.add_ecdsa_signature(signature)


def _ffi_client(client: Any) -> Any:
    ffi_client = getattr(client, "_client", None)
    if ffi_client is None:
        raise RuntimeError("XMTP client is not initialized.")
    return ffi_client


async def _apply_signed_request(client: Any, signer: Any, signature_request: Any) -> None:
    await _sign_signature_request(signer, signature_request)
    await _ffi_client(client).apply_signature_request(signature_request)


async def _revoke_installations(client: Any, signer: Any, installation_ids: list[bytes], logger: logging.Logger) -> int:
    if not installation_ids:
        return 0
    signature_request = await _ffi_client(client).revoke_installations(installation_ids)
    await _apply_signed_request(client, signer, signature_request)
    logger.warning("revoked stale XMTP installations count=%s", len(installation_ids))
    return len(installation_ids)


async def _recover_installation_capacity(
    client: Any,
    signer: Any,
    logger: logging.Logger,
    *,
    limit: int,
) -> None:
    snapshot = await _installation_snapshot(client)
    if snapshot.total_installations < limit:
        return
    installation_ids = _installation_ids_for_revocation(snapshot.installations, client.installation_id)
    logger.warning(
        "XMTP installation count is at or above limit; revoking stale installations before registration "
        "count=%s limit=%s current_installation=%s",
        snapshot.total_installations,
        limit,
        snapshot.installation_id,
    )
    await _revoke_installations(client, signer, installation_ids, logger)


async def _prune_old_installations(client: Any, signer: Any, logger: logging.Logger) -> XmtpInstallationSnapshot:
    snapshot = await _installation_snapshot(client)
    logger.info(
        "xmtp installation state inbox_id=%s installation_id=%s total_installations=%s most_recent=%s "
        "is_most_recent=%s is_active=%s",
        client.inbox_id,
        snapshot.installation_id,
        snapshot.total_installations,
        snapshot.most_recent_installation_id,
        snapshot.is_most_recent,
        _snapshot_includes_current_installation(snapshot),
    )
    if not _snapshot_includes_current_installation(snapshot):
        logger.warning(
            "local XMTP installation is missing from network inbox state; current=%s network_installations=%s",
            snapshot.installation_id,
            ",".join(_snapshot_installation_ids(snapshot)) or "none",
        )
        return snapshot
    if snapshot.total_installations <= 1:
        return snapshot

    installation_ids = _installation_ids_for_revocation(snapshot.installations, client.installation_id)
    try:
        revoked = await _revoke_installations(client, signer, installation_ids, logger)
    except Exception:
        logger.exception(
            "failed to revoke stale XMTP installations; broker can continue with current installation, "
            "but operators should verify installation count"
        )
        return snapshot
    if revoked:
        return await _installation_snapshot(client)
    return snapshot


async def _create_xmtp_client_with_recovery(client_cls: Any, signer: Any, options: Any, logger: logging.Logger) -> Any:
    options.disable_auto_register = True
    for attempt in range(2):
        try:
            return await client_cls.create(signer, options)
        except Exception as exc:
            if attempt == 0 and _xmtp_db_inbox_mismatch(exc) and _env_bool("BROKER_XMTP_ARCHIVE_STALE_DB", True):
                if _archive_xmtp_db(options.db_path if isinstance(options.db_path, str) else None, logger):
                    logger.warning("retrying XMTP client creation after archiving inbox-mismatched database")
                    continue
            raise
    raise RuntimeError("XMTP client creation failed.")


async def _ensure_xmtp_registered(
    client: Any,
    signer: Any,
    logger: logging.Logger,
) -> XmtpInstallationSnapshot | None:
    auto_revoke = _env_bool("BROKER_XMTP_AUTO_REVOKE_OLD_INSTALLATIONS", True)
    installation_limit = _env_int("BROKER_XMTP_INSTALLATION_LIMIT", DEFAULT_XMTP_INSTALLATION_LIMIT)

    if not client.is_registered and auto_revoke:
        try:
            await _recover_installation_capacity(client, signer, logger, limit=installation_limit)
        except Exception:
            logger.warning("could not inspect XMTP installations before registration; continuing", exc_info=True)

    if not client.is_registered:
        try:
            await client.register()
        except Exception as exc:
            if not auto_revoke or not _xmtp_installation_limit_error(exc):
                raise
            logger.warning("XMTP registration hit installation limit; attempting stale installation revocation")
            await _recover_installation_capacity(client, signer, logger, limit=1)
            await client.register()

    if auto_revoke:
        try:
            snapshot = await _prune_old_installations(client, signer, logger)
        except Exception:
            logger.warning("could not inspect XMTP installations after registration; continuing", exc_info=True)
            return None
        if snapshot.total_installations > 1 and _snapshot_includes_current_installation(snapshot):
            logger.warning("XMTP still reports multiple installations after pruning count=%s", snapshot.total_installations)
        return snapshot
    else:
        try:
            snapshot = await _installation_snapshot(client)
        except Exception:
            logger.warning("could not inspect XMTP installations after registration; continuing", exc_info=True)
            return None
        if snapshot.total_installations > 1:
            logger.warning(
                "XMTP has multiple installations count=%s; set BROKER_XMTP_AUTO_REVOKE_OLD_INSTALLATIONS=1 to prune",
                snapshot.total_installations,
            )
        if not _snapshot_includes_current_installation(snapshot):
            logger.warning(
                "local XMTP installation is missing from network inbox state; current=%s network_installations=%s",
                snapshot.installation_id,
                ",".join(_snapshot_installation_ids(snapshot)) or "none",
            )
        return snapshot


async def create_xmtp_agent_with_recovery(options: Any, logger: logging.Logger) -> Any:
    try:
        from xmtp import Client
        from xmtp.env import load_client_options_from_env, load_signer_from_env
        from xmtp.types import LogLevel
        from xmtp_agent import Agent
    except ImportError as exc:
        raise RuntimeError("Install bot dependencies with: pip install -r requirements-broker.txt") from exc

    signer = load_signer_from_env()
    resolved_options = load_client_options_from_env(options)
    if resolved_options.app_version is None:
        resolved_options.app_version = "agent-sdk/alpha"
    if not resolved_options.disable_device_sync:
        resolved_options.disable_device_sync = True
    if os.getenv("XMTP_FORCE_DEBUG"):
        resolved_options.debug_events_enabled = True
        resolved_options.structured_logging = True
        level = os.getenv("XMTP_FORCE_DEBUG_LEVEL")
        try:
            resolved_options.logging_level = LogLevel(level) if level else LogLevel.WARN
        except ValueError:
            resolved_options.logging_level = LogLevel.WARN
    if resolved_options.db_path is None:
        logger.warning("XMTP db_path is unset; broker installations will not persist across restarts")

    for attempt in range(2):
        client = await _create_xmtp_client_with_recovery(Client, signer, resolved_options, logger)
        snapshot = await _ensure_xmtp_registered(client, signer, logger)
        if snapshot is not None and not _snapshot_includes_current_installation(snapshot):
            db_path = resolved_options.db_path if isinstance(resolved_options.db_path, str) else None
            if (
                attempt == 0
                and _env_bool("BROKER_XMTP_ARCHIVE_INACTIVE_DB", True)
                and _archive_xmtp_db(db_path, logger)
            ):
                logger.warning(
                    "retrying XMTP client creation with a fresh database because the local installation is inactive"
                )
                continue
            logger.warning(
                "continuing with inactive XMTP installation; incoming messages may not arrive until the DB is refreshed"
            )
        return Agent(client)
    raise RuntimeError("XMTP client creation failed after inactive-installation recovery.")


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
    if patch_xmtp_agent_stream_stop(Agent):
        logger.info("installed xmtp agent stream-stop compatibility shim")

    options = ClientOptions(
        env=config.xmtp_env,
        db_path=config.xmtp_db_path,
        disable_history_sync=True,
        logging_level=LogLevel.WARN,
    )
    os.environ["XMTP_WALLET_KEY"] = config.broker_key
    logger.info("creating xmtp agent env=%s db_path=%s", config.xmtp_env, config.xmtp_db_path or "default")
    agent = await create_xmtp_agent_with_recovery(options, logger)

    async def on_agent_error(error, context, next_handler) -> None:
        context_name = context.__class__.__name__
        if isinstance(error, BaseException):
            logger.error(
                "xmtp agent recovered error context=%s",
                context_name,
                exc_info=(type(error), error, error.__traceback__),
            )
        else:
            logger.error("xmtp agent recovered error context=%s error=%r", context_name, error)
        await next_handler()

    agent.errors.use(on_agent_error)

    @agent.on("unhandled_error")
    async def on_unhandled_error(error) -> None:
        if isinstance(error, BaseException):
            logger.error("xmtp agent unhandled error", exc_info=(type(error), error, error.__traceback__))
        else:
            logger.error("xmtp agent unhandled error: %r", error)

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
