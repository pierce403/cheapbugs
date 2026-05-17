"""Logging setup for broker runtime commands."""

from __future__ import annotations

import logging
import sys
from pathlib import Path


def configure_logging(log_path: Path, level_name: str = "INFO") -> logging.Logger:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    level = getattr(logging, level_name.upper(), logging.INFO)
    formatter = logging.Formatter(
        fmt="%(asctime)s %(levelname)s %(name)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )

    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setFormatter(formatter)

    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setFormatter(formatter)

    logging.basicConfig(
        level=level,
        handlers=[stdout_handler, file_handler],
        force=True,
    )
    logger = logging.getLogger("cheapbugs_broker")
    logger.info("broker logging initialized log_path=%s level=%s", log_path, logging.getLevelName(level))
    return logger
