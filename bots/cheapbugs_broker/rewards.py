"""Reward calculation helpers for the broker bot."""

from __future__ import annotations

from decimal import Decimal, ROUND_DOWN


def tokens_to_wei(tokens: Decimal, decimals: int = 18) -> int:
    if tokens <= 0:
        return 0
    scale = Decimal(10) ** decimals
    return int((tokens * scale).to_integral_value(rounding=ROUND_DOWN))


def wei_to_tokens(wei: int, decimals: int = 18) -> Decimal:
    if wei <= 0:
        return Decimal("0")
    return Decimal(wei) / (Decimal(10) ** decimals)


def reward_tokens(base: Decimal, per_reaction: Decimal, max_reward: Decimal, support_score: int) -> Decimal:
    if support_score < 0:
        support_score = 0
    total = base + (per_reaction * Decimal(support_score))
    if max_reward > 0:
        return min(total, max_reward)
    return total
