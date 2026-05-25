"""Environment configuration for the CheapBugs broker bot."""

from __future__ import annotations

import os
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path


DEFAULT_BASE_RPC_URL = "https://mainnet.base.org"
DEFAULT_BUGZ_TOKEN_ADDRESS = "0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07"
DEFAULT_BUG_INDEX_ADDRESS = "0x515FDbc9876aC26870794E26605c7DD04c18679b"
DEFAULT_TREASURY_VAULT_ADDRESS = "0x4A080668d9848928dc6D48921cbDc4273fe27A9d"
DEFAULT_IPFS_API_URL = "http://127.0.0.1:5001"
DEFAULT_IPFS_GATEWAY_URL = "https://ipfs.io/ipfs"


def _env_first(*names: str, default: str = "") -> str:
    for name in names:
        value = os.getenv(name)
        if value is not None and value.strip():
            return value.strip()
    return default


def _env_bool_any(names: tuple[str, ...], default: bool = False) -> bool:
    value = _env_first(*names)
    if not value:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def _env_decimal_any(names: tuple[str, ...], default: str) -> Decimal:
    value = _env_first(*names, default=default)
    try:
        return Decimal(value)
    except Exception as exc:
        raise ValueError(f"{names[0]} must be a decimal token amount.") from exc


def _env_int_any(names: tuple[str, ...], default: int) -> int:
    value = _env_first(*names)
    if not value:
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"{names[0]} must be an integer.") from exc


def _env_address_set_any(names: tuple[str, ...]) -> frozenset[str]:
    return frozenset(
        entry.strip().lower()
        for entry in _env_first(*names).split(",")
        if entry.strip()
    )


@dataclass(frozen=True)
class BrokerConfig:
    database_path: Path
    log_path: Path
    xmtp_env: str
    xmtp_db_path: str | None
    broker_key: str
    signal_cli_path: str
    signal_account: str
    signal_group_id: str
    base_rpc_url: str
    bugz_token_address: str
    chain_id: int
    bug_index_address: str
    treasury_vault_address: str
    ipfs_api_url: str
    ipfs_gateway_url: str
    ipfs_prime_gateway: bool
    ipfs_timeout_seconds: int
    access_min_balance_tokens: Decimal
    submission_min_balance_tokens: Decimal
    reputation_blocklist: frozenset[str]
    reward_base_tokens: Decimal
    reward_base_tokens_configured: bool
    reward_per_reaction_tokens: Decimal
    reward_max_tokens: Decimal
    review_window_seconds: int
    poll_seconds: int
    dry_run: bool
    tx_receipt_timeout_seconds: int

    @property
    def signal_enabled(self) -> bool:
        return bool(self.signal_cli_path)

    @property
    def broker_address(self) -> str:
        try:
            from eth_account import Account

            return str(Account.from_key(self.broker_key).address).lower()
        except Exception:
            return ""

    @classmethod
    def from_env(cls) -> "BrokerConfig":
        xmtp_db_path = _env_first("BROKER_XMTP_DB_PATH") or None
        reward_base_raw = _env_first("BROKER_BUGZ_BASE_REWARD")
        return cls(
            database_path=Path(_env_first("BROKER_DB_PATH", default=".broker/broker.sqlite")),
            log_path=Path(_env_first("BROKER_LOG_PATH", default="broker.log")),
            xmtp_env=_env_first("BROKER_XMTP_ENV", default="production"),
            xmtp_db_path=xmtp_db_path,
            broker_key=_env_first("BROKER_KEY"),
            signal_cli_path=_env_first("BROKER_SIGNAL_CLI"),
            signal_account=_env_first("BROKER_SIGNAL_ACCOUNT"),
            signal_group_id=_env_first("BROKER_SIGNAL_GROUP_ID"),
            base_rpc_url=_env_first("BASE_RPC_URL", default=DEFAULT_BASE_RPC_URL),
            bugz_token_address=_env_first("BUGZ_TOKEN_ADDRESS", default=DEFAULT_BUGZ_TOKEN_ADDRESS),
            chain_id=_env_int_any(("BROKER_CHAIN_ID", "CHAIN_ID"), 8453),
            bug_index_address=_env_first("BROKER_BUG_INDEX_ADDRESS", "VITE_BUG_INDEX_ADDRESS", default=DEFAULT_BUG_INDEX_ADDRESS),
            treasury_vault_address=_env_first(
                "BROKER_TREASURY_VAULT_ADDRESS",
                "VITE_BUG_TREASURY_VAULT_ADDRESS",
                "VITE_BUGZ_TREASURY_ADDRESS",
                default=DEFAULT_TREASURY_VAULT_ADDRESS,
            ),
            ipfs_api_url=_env_first("BROKER_IPFS_API_URL", default=DEFAULT_IPFS_API_URL),
            ipfs_gateway_url=_env_first("BROKER_IPFS_GATEWAY_URL", default=DEFAULT_IPFS_GATEWAY_URL),
            ipfs_prime_gateway=_env_bool_any(("BROKER_IPFS_PRIME_GATEWAY",), False),
            ipfs_timeout_seconds=_env_int_any(("BROKER_IPFS_TIMEOUT_SECONDS",), 10),
            access_min_balance_tokens=_env_decimal_any(("BROKER_ACCESS_MIN_BUGZ",), "1"),
            submission_min_balance_tokens=_env_decimal_any(("BROKER_SUBMISSION_MIN_BUGZ",), "0"),
            reputation_blocklist=_env_address_set_any(("BROKER_REPUTATION_BLOCKLIST",)),
            reward_base_tokens=_env_decimal_any(("BROKER_BUGZ_BASE_REWARD",), "0"),
            reward_base_tokens_configured=bool(reward_base_raw),
            reward_per_reaction_tokens=_env_decimal_any(("BROKER_BUGZ_PER_REACTION",), "100"),
            reward_max_tokens=_env_decimal_any(("BROKER_BUGZ_MAX_REWARD",), "5000"),
            review_window_seconds=_env_int_any(("BROKER_REVIEW_WINDOW_SECONDS",), 7 * 24 * 60 * 60),
            poll_seconds=_env_int_any(("BROKER_POLL_SECONDS",), 30),
            dry_run=_env_bool_any(("BROKER_DRY_RUN",), False),
            tx_receipt_timeout_seconds=_env_int_any(("BROKER_TX_RECEIPT_TIMEOUT_SECONDS",), 120),
        )

    def require_runtime(self) -> None:
        missing: list[str] = []
        if not self.broker_key:
            missing.append("BROKER_KEY")
        if not self.dry_run and not self.bug_index_address:
            missing.append("BROKER_BUG_INDEX_ADDRESS")
        if not self.dry_run and not self.treasury_vault_address:
            missing.append("BROKER_TREASURY_VAULT_ADDRESS")
        if self.signal_enabled and not self.signal_account:
            missing.append("BROKER_SIGNAL_ACCOUNT")
        if self.signal_enabled and not self.signal_group_id:
            missing.append("BROKER_SIGNAL_GROUP_ID")
        if missing:
            raise ValueError(f"Missing required broker env vars: {', '.join(missing)}")
