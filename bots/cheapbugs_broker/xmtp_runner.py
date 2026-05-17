"""Runtime glue between xmtp-py and the broker service."""

from __future__ import annotations

import asyncio
import logging
import os

from .config import BrokerConfig
from .service import BrokerBot


def plain_text_status_sender(ctx):
    """Return a broker status sender that avoids XMTP reply-content encoding."""

    async def send_status(text: str) -> None:
        await ctx.send_text(text)

    return send_status


async def run_xmtp_broker(config: BrokerConfig, bot: BrokerBot) -> None:
    logger = logging.getLogger(__name__)
    try:
        from xmtp.types import ClientOptions, LogLevel
        from xmtp_agent import Agent
    except ImportError as exc:
        raise RuntimeError("Install bot dependencies with: pip install -r requirements-broker.txt") from exc

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
