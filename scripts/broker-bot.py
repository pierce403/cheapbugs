#!/usr/bin/env python3
"""Run the CheapBugs XMTP-to-Signal broker bot."""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "bots"))

from cheapbugs_broker.config import BrokerConfig
from cheapbugs_broker.service import BrokerBot
from cheapbugs_broker.signal_cli import SignalCli
from cheapbugs_broker.store import BrokerStore
from cheapbugs_broker.token import BugzTokenClient
from cheapbugs_broker.xmtp_runner import run_xmtp_broker


def build_bot(config: BrokerConfig) -> BrokerBot:
    store = BrokerStore(config.database_path)
    store.init()
    signal = SignalCli(config.signal_cli_path, config.signal_account, config.signal_group_id)
    token = BugzTokenClient(
        rpc_url=config.base_rpc_url,
        token_address=config.bugz_token_address,
        payout_private_key=config.bugz_payout_private_key,
        dry_run=config.dry_run,
    )
    return BrokerBot(config=config, store=store, signal=signal, token=token)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", default="run", choices=["run", "init-db", "sync-signal", "settle"])
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()

    logging.basicConfig(level=getattr(logging, args.log_level.upper(), logging.INFO), format="%(levelname)s %(message)s")
    config = BrokerConfig.from_env()
    store = BrokerStore(config.database_path)

    if args.command == "init-db":
        store.init()
        print(f"Initialized {config.database_path}")
        return 0

    try:
        config.require_runtime()
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    bot = build_bot(config)
    if args.command == "sync-signal":
        print(f"Recorded {bot.sync_signal_once()} Signal reaction event(s).")
        return 0
    if args.command == "settle":
        print(f"Settled {bot.settle_matured_once()} matured submission(s).")
        return 0

    try:
        asyncio.run(run_xmtp_broker(config, bot))
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
