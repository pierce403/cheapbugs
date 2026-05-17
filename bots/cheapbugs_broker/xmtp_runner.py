"""Runtime glue between xmtp-py and the broker service."""

from __future__ import annotations

import asyncio
import logging

from .config import BrokerConfig
from .service import BrokerBot


async def run_xmtp_broker(config: BrokerConfig, bot: BrokerBot) -> None:
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
    agent = await Agent.create_from_env(options)

    @agent.on("text")
    async def on_text(ctx) -> None:
        sender_address = await ctx.get_sender_address()
        await bot.handle_xmtp_text(
            text=str(ctx.message.content),
            sender_address=sender_address,
            conversation_id=ctx.message.conversation_id.hex(),
            message_id=ctx.message.id.hex(),
            reply=ctx.send_text_reply,
        )

    logging.getLogger(__name__).info("Starting XMTP broker agent on %s.", config.xmtp_env)
    await agent.start()
    await asyncio.gather(bot.poll_signal_forever(), bot.settle_forever())


run_xmtp_bouncer = run_xmtp_broker
