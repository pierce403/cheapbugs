#!/usr/bin/env python3
"""Legacy alias for scripts/broker-bot.py."""

from __future__ import annotations

import runpy
from pathlib import Path


if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).with_name("broker-bot.py")), run_name="__main__")
