#!/usr/bin/env python3
"""Run the CheapBugs XMTP-to-Signal broker bot."""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "bots"))

from cheapbugs_broker.config import BrokerConfig
from cheapbugs_broker.bug_index import BugIndexClient
from cheapbugs_broker.ipfs import KuboIpfsClient
from cheapbugs_broker.logging_setup import configure_logging
from cheapbugs_broker.service import BrokerBot
from cheapbugs_broker.signal_cli import SignalCli
from cheapbugs_broker.store import BrokerStore
from cheapbugs_broker.token import BugzTokenClient
from cheapbugs_broker.treasury import TreasuryVaultClient
from cheapbugs_broker.xmtp_runner import run_xmtp_broker


def build_bot(config: BrokerConfig, *, ipfs: KuboIpfsClient | None = None) -> BrokerBot:
    store = BrokerStore(config.database_path)
    store.init()
    signal = (
        SignalCli(config.signal_cli_path, config.signal_account, config.signal_group_id)
        if config.signal_enabled
        else None
    )
    token = BugzTokenClient(
        rpc_url=config.base_rpc_url,
        token_address=config.bugz_token_address,
        broker_key=config.broker_key,
        dry_run=config.dry_run,
    )
    bug_index = BugIndexClient(
        rpc_url=config.base_rpc_url,
        index_address=config.bug_index_address,
        broker_key=config.broker_key,
        chain_id=config.chain_id,
        dry_run=config.dry_run,
        receipt_timeout_seconds=config.tx_receipt_timeout_seconds,
    )
    treasury = TreasuryVaultClient(config.base_rpc_url, config.treasury_vault_address)
    return BrokerBot(
        config=config,
        store=store,
        signal=signal,
        token=token,
        ipfs=ipfs,
        bug_index=bug_index,
        treasury=treasury,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", default="run", choices=["run", "init-db", "sync-signal", "settle"])
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()

    config = BrokerConfig.from_env()
    logger = configure_logging(config.log_path, args.log_level)
    store = BrokerStore(config.database_path)

    if args.command == "init-db":
        store.init()
        logger.info("initialized broker database path=%s", config.database_path)
        print(f"Initialized {config.database_path}")
        return 0

    try:
        config.require_runtime()
    except ValueError as exc:
        logger.error("runtime configuration invalid: %s", exc)
        print(str(exc), file=sys.stderr)
        return 2

    ipfs = None
    if args.command == "run":
        ipfs = KuboIpfsClient(
            config.ipfs_api_url,
            gateway_url=config.ipfs_gateway_url,
            prime_gateway=config.ipfs_prime_gateway,
            timeout_seconds=config.ipfs_timeout_seconds,
        )
        try:
            version = ipfs.verify_writable()
        except Exception as exc:
            logger.error("IPFS Kubo startup check failed: %s", exc)
            print(
                "IPFS Kubo startup check failed. Start a local Kubo node with its HTTP API enabled "
                f"at {config.ipfs_api_url}, or set BROKER_IPFS_API_URL. Error: {exc}",
                file=sys.stderr,
            )
            return 2
        logger.info(
            "IPFS Kubo startup check passed api_url=%s version=%s gateway_url=%s prime_gateway=%s",
            config.ipfs_api_url,
            version,
            config.ipfs_gateway_url,
            config.ipfs_prime_gateway,
        )

    bot = build_bot(config, ipfs=ipfs)
    logger.info(
        "broker command starting command=%s xmtp_env=%s db_path=%s signal_enabled=%s dry_run=%s",
        args.command,
        config.xmtp_env,
        config.database_path,
        config.signal_enabled,
        config.dry_run,
    )
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
