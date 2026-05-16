"""Environment configuration for the CheapBugs bouncer bot."""

from __future__ import annotations

import os
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_decimal(name: str, default: str) -> Decimal:
    value = os.getenv(name, default).strip()
    try:
        return Decimal(value)
    except Exception as exc:
        raise ValueError(f"{name} must be a decimal token amount.") from exc


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer.") from exc


@dataclass(frozen=True)
class BouncerConfig:
    database_path: Path
    xmtp_env: str
    xmtp_db_path: str | None
    signal_cli_path: str
    signal_account: str
    signal_group_id: str
    base_rpc_url: str
    bugz_token_address: str
    bugz_payout_private_key: str
    access_min_balance_tokens: Decimal
    reward_base_tokens: Decimal
    reward_per_reaction_tokens: Decimal
    reward_max_tokens: Decimal
    review_window_seconds: int
    poll_seconds: int
    dry_run: bool

    @classmethod
    def from_env(cls) -> "BouncerConfig":
        xmtp_db_path = os.getenv("BOUNCER_XMTP_DB_PATH", "").strip() or None
        return cls(
            database_path=Path(os.getenv("BOUNCER_DB_PATH", ".bouncer/bouncer.sqlite")),
            xmtp_env=os.getenv("BOUNCER_XMTP_ENV", os.getenv("XMTP_ENV", "production")),
            xmtp_db_path=xmtp_db_path,
            signal_cli_path=os.getenv("BOUNCER_SIGNAL_CLI", "signal-cli"),
            signal_account=os.getenv("BOUNCER_SIGNAL_ACCOUNT", "").strip(),
            signal_group_id=os.getenv("BOUNCER_SIGNAL_GROUP_ID", "").strip(),
            base_rpc_url=os.getenv("BASE_RPC_URL", os.getenv("VITE_CHAIN_RPC_URL", "")).strip(),
            bugz_token_address=os.getenv("BUGZ_TOKEN_ADDRESS", os.getenv("VITE_BUGZ_TOKEN_ADDRESS", "")).strip(),
            bugz_payout_private_key=os.getenv("BUGZ_PAYOUT_PRIVATE_KEY", "").strip(),
            access_min_balance_tokens=_env_decimal("BOUNCER_ACCESS_MIN_BUGZ", "1"),
            reward_base_tokens=_env_decimal("BOUNCER_BUGZ_BASE_REWARD", "0"),
            reward_per_reaction_tokens=_env_decimal("BOUNCER_BUGZ_PER_REACTION", "100"),
            reward_max_tokens=_env_decimal("BOUNCER_BUGZ_MAX_REWARD", "5000"),
            review_window_seconds=_env_int("BOUNCER_REVIEW_WINDOW_SECONDS", 7 * 24 * 60 * 60),
            poll_seconds=_env_int("BOUNCER_POLL_SECONDS", 30),
            dry_run=_env_bool("BOUNCER_DRY_RUN", False),
        )

    def require_runtime(self) -> None:
        missing: list[str] = []
        if not os.getenv("XMTP_WALLET_KEY", "").strip():
            missing.append("XMTP_WALLET_KEY")
        if not self.signal_account:
            missing.append("BOUNCER_SIGNAL_ACCOUNT")
        if not self.signal_group_id:
            missing.append("BOUNCER_SIGNAL_GROUP_ID")
        if not self.base_rpc_url:
            missing.append("BASE_RPC_URL")
        if not self.bugz_token_address:
            missing.append("BUGZ_TOKEN_ADDRESS")
        if not self.dry_run and not self.bugz_payout_private_key:
            missing.append("BUGZ_PAYOUT_PRIVATE_KEY")
        if missing:
            raise ValueError(f"Missing required bouncer env vars: {', '.join(missing)}")
