"""Environment configuration for the CheapBugs broker bot."""

from __future__ import annotations

import os
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path


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
    xmtp_env: str
    xmtp_db_path: str | None
    broker_key: str
    signal_cli_path: str
    signal_account: str
    signal_group_id: str
    base_rpc_url: str
    bugz_token_address: str
    access_min_balance_tokens: Decimal
    submission_min_balance_tokens: Decimal
    reputation_blocklist: frozenset[str]
    reward_base_tokens: Decimal
    reward_per_reaction_tokens: Decimal
    reward_max_tokens: Decimal
    review_window_seconds: int
    poll_seconds: int
    dry_run: bool

    @property
    def signal_enabled(self) -> bool:
        return bool(self.signal_cli_path)

    @classmethod
    def from_env(cls) -> "BrokerConfig":
        xmtp_db_path = _env_first("BROKER_XMTP_DB_PATH") or None
        return cls(
            database_path=Path(_env_first("BROKER_DB_PATH", default=".broker/broker.sqlite")),
            xmtp_env=_env_first("BROKER_XMTP_ENV", default="production"),
            xmtp_db_path=xmtp_db_path,
            broker_key=_env_first("BROKER_KEY"),
            signal_cli_path=_env_first("BROKER_SIGNAL_CLI"),
            signal_account=_env_first("BROKER_SIGNAL_ACCOUNT"),
            signal_group_id=_env_first("BROKER_SIGNAL_GROUP_ID"),
            base_rpc_url=_env_first("BASE_RPC_URL"),
            bugz_token_address=_env_first("BUGZ_TOKEN_ADDRESS"),
            access_min_balance_tokens=_env_decimal_any(("BROKER_ACCESS_MIN_BUGZ",), "1"),
            submission_min_balance_tokens=_env_decimal_any(("BROKER_SUBMISSION_MIN_BUGZ",), "1"),
            reputation_blocklist=_env_address_set_any(("BROKER_REPUTATION_BLOCKLIST",)),
            reward_base_tokens=_env_decimal_any(("BROKER_BUGZ_BASE_REWARD",), "0"),
            reward_per_reaction_tokens=_env_decimal_any(("BROKER_BUGZ_PER_REACTION",), "100"),
            reward_max_tokens=_env_decimal_any(("BROKER_BUGZ_MAX_REWARD",), "5000"),
            review_window_seconds=_env_int_any(("BROKER_REVIEW_WINDOW_SECONDS",), 7 * 24 * 60 * 60),
            poll_seconds=_env_int_any(("BROKER_POLL_SECONDS",), 30),
            dry_run=_env_bool_any(("BROKER_DRY_RUN",), False),
        )

    def require_runtime(self) -> None:
        missing: list[str] = []
        if not self.broker_key:
            missing.append("BROKER_KEY")
        if not os.getenv("XMTP_DB_ENCRYPTION_KEY", "").strip():
            missing.append("XMTP_DB_ENCRYPTION_KEY")
        if self.signal_enabled and not self.signal_account:
            missing.append("BROKER_SIGNAL_ACCOUNT")
        if self.signal_enabled and not self.signal_group_id:
            missing.append("BROKER_SIGNAL_GROUP_ID")
        if not self.base_rpc_url:
            missing.append("BASE_RPC_URL")
        if not self.bugz_token_address:
            missing.append("BUGZ_TOKEN_ADDRESS")
        if missing:
            raise ValueError(f"Missing required broker env vars: {', '.join(missing)}")
