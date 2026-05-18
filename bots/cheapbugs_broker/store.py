"""SQLite persistence for broker bot state."""

from __future__ import annotations

import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterable
from uuid import uuid4

from .models import PinnedBugBundle, SignalReactionEvent, SubmissionCommand, SubmissionRecord


SCHEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS processed_xmtp_messages (
  message_id TEXT PRIMARY KEY,
  command_type TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  reporter_address TEXT NOT NULL,
  reporter_signal TEXT NOT NULL,
  bug_type TEXT NOT NULL DEFAULT '0day',
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  severity TEXT NOT NULL,
  target_interest TEXT NOT NULL DEFAULT 'medium',
  body TEXT NOT NULL,
  xmtp_conversation_id TEXT NOT NULL,
  xmtp_message_id TEXT NOT NULL UNIQUE,
  signal_group_id TEXT NOT NULL,
  signal_message_timestamp INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  matures_at INTEGER NOT NULL,
  support_score INTEGER NOT NULL DEFAULT 0,
  payout_amount_wei TEXT,
  payout_tx_hash TEXT,
  bundle_cid TEXT,
  bundle_uri TEXT,
  bundle_gateway_url TEXT,
  bundle_sha256 TEXT,
  details_key_b64 TEXT,
  details_key_commitment TEXT,
  encrypted_details_hash TEXT,
  bundle_pinned_at INTEGER,
  report_hash TEXT,
  index_tx_hash TEXT,
  index_published_at INTEGER,
  error TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submissions_matures_at
  ON submissions(status, matures_at);
CREATE INDEX IF NOT EXISTS idx_submissions_signal_message
  ON submissions(signal_group_id, signal_message_timestamp);

CREATE TABLE IF NOT EXISTS signal_reactions (
  signal_group_id TEXT NOT NULL,
  target_sent_timestamp INTEGER NOT NULL,
  reactor_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  active INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (signal_group_id, target_sent_timestamp, reactor_id, emoji)
);
"""


class BrokerStore:
    def __init__(self, path: Path | str):
        self.path = Path(path)

    def connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    @contextmanager
    def session(self):
        conn = self.connect()
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def init(self) -> None:
        with self.session() as conn:
            conn.executescript(SCHEMA)
            _ensure_submission_columns(conn)

    def message_seen(self, message_id: str) -> bool:
        with self.session() as conn:
            row = conn.execute(
                "SELECT 1 FROM processed_xmtp_messages WHERE message_id = ?",
                (message_id,),
            ).fetchone()
        return row is not None

    def mark_message_processed(self, message_id: str, command_type: str, now: int | None = None) -> None:
        observed_at = now or int(time.time())
        with self.session() as conn:
            conn.execute(
                """
                INSERT OR IGNORE INTO processed_xmtp_messages (message_id, command_type, processed_at)
                VALUES (?, ?, ?)
                """,
                (message_id, command_type, observed_at),
            )

    def create_submission(
        self,
        command: SubmissionCommand,
        xmtp_conversation_id: str,
        xmtp_message_id: str,
        signal_group_id: str,
        signal_message_timestamp: int,
        review_window_seconds: int,
        status: str = "relayed",
        bug_bundle: PinnedBugBundle | None = None,
        report_hash: str | None = None,
        index_tx_hash: str | None = None,
        index_published_at: int | None = None,
        error: str | None = None,
        now: int | None = None,
    ) -> SubmissionRecord:
        created_at = now or int(time.time())
        index_published = index_published_at if index_published_at is not None else (created_at if index_tx_hash else None)
        record_id = uuid4().hex
        with self.session() as conn:
            conn.execute(
                """
                INSERT INTO submissions (
                  id, reporter_address, reporter_signal, bug_type, title, summary, severity, target_interest, body,
                  xmtp_conversation_id, xmtp_message_id, signal_group_id,
                  signal_message_timestamp, status, created_at, matures_at,
                  bundle_cid, bundle_uri, bundle_gateway_url, bundle_sha256,
                  details_key_b64, details_key_commitment, encrypted_details_hash, bundle_pinned_at,
                  report_hash, index_tx_hash, index_published_at, error,
                  updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record_id,
                    command.reporter_address,
                    command.signal_recipient,
                    command.bug_type,
                    command.title,
                    command.summary,
                    command.severity,
                    command.target_interest,
                    command.body,
                    xmtp_conversation_id,
                    xmtp_message_id,
                    signal_group_id,
                    signal_message_timestamp,
                    status,
                    created_at,
                    created_at + review_window_seconds,
                    bug_bundle.cid if bug_bundle else None,
                    bug_bundle.uri if bug_bundle else None,
                    bug_bundle.gateway_url if bug_bundle else None,
                    bug_bundle.sha256 if bug_bundle else None,
                    bug_bundle.details_key_b64 if bug_bundle else None,
                    bug_bundle.details_key_commitment if bug_bundle else None,
                    bug_bundle.encrypted_details_hash if bug_bundle else None,
                    bug_bundle.pinned_at if bug_bundle else None,
                    report_hash,
                    index_tx_hash,
                    index_published,
                    error,
                    created_at,
                ),
            )
        record = self.get_submission(record_id)
        if record is None:
            raise RuntimeError("Failed to load created submission.")
        return record

    def get_submission(self, record_id: str) -> SubmissionRecord | None:
        with self.session() as conn:
            row = conn.execute("SELECT * FROM submissions WHERE id = ?", (record_id,)).fetchone()
        return _record_from_row(row) if row is not None else None

    def find_submission_by_signal_timestamp(
        self,
        signal_group_id: str,
        signal_message_timestamp: int,
    ) -> SubmissionRecord | None:
        with self.session() as conn:
            row = conn.execute(
                """
                SELECT * FROM submissions
                WHERE signal_group_id = ? AND signal_message_timestamp = ?
                """,
                (signal_group_id, signal_message_timestamp),
            ).fetchone()
        return _record_from_row(row) if row is not None else None

    def upsert_reaction(self, event: SignalReactionEvent) -> None:
        with self.session() as conn:
            conn.execute(
                """
                INSERT INTO signal_reactions (
                  signal_group_id, target_sent_timestamp, reactor_id, emoji, active, observed_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(signal_group_id, target_sent_timestamp, reactor_id, emoji)
                DO UPDATE SET active = excluded.active, observed_at = excluded.observed_at
                """,
                (
                    event.group_id,
                    event.target_sent_timestamp,
                    event.reactor_id,
                    event.emoji,
                    0 if event.is_remove else 1,
                    event.observed_at,
                ),
            )

    def upsert_reactions(self, events: Iterable[SignalReactionEvent]) -> int:
        count = 0
        for event in events:
            self.upsert_reaction(event)
            count += 1
        return count

    def support_score(self, signal_group_id: str, signal_message_timestamp: int) -> int:
        with self.session() as conn:
            row = conn.execute(
                """
                SELECT COUNT(*) AS support_score
                FROM signal_reactions
                WHERE signal_group_id = ?
                  AND target_sent_timestamp = ?
                  AND active = 1
                """,
                (signal_group_id, signal_message_timestamp),
            ).fetchone()
        return int(row["support_score"] if row is not None else 0)

    def mature_unpaid_submissions(self, now: int | None = None) -> list[SubmissionRecord]:
        cutoff = now or int(time.time())
        with self.session() as conn:
            rows = conn.execute(
                """
                SELECT * FROM submissions
                WHERE status = 'relayed' AND matures_at <= ?
                ORDER BY matures_at ASC
                """,
                (cutoff,),
            ).fetchall()
        return [_record_from_row(row) for row in rows]

    def mark_paid(self, record_id: str, support_score: int, payout_amount_wei: int, tx_hash: str) -> None:
        now = int(time.time())
        with self.session() as conn:
            conn.execute(
                """
                UPDATE submissions
                SET status = 'paid',
                    support_score = ?,
                    payout_amount_wei = ?,
                    payout_tx_hash = ?,
                    error = NULL,
                    updated_at = ?
                WHERE id = ?
                """,
                (support_score, str(payout_amount_wei), tx_hash, now, record_id),
            )

    def mark_failed(self, record_id: str, support_score: int, error: str) -> None:
        now = int(time.time())
        with self.session() as conn:
            conn.execute(
                """
                UPDATE submissions
                SET status = 'failed',
                    support_score = ?,
                    error = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (support_score, error, now, record_id),
            )


def _record_from_row(row: sqlite3.Row) -> SubmissionRecord:
    return SubmissionRecord(
        id=str(row["id"]),
        reporter_address=str(row["reporter_address"]),
        reporter_signal=str(row["reporter_signal"]),
        bug_type=str(row["bug_type"]),
        title=str(row["title"]),
        summary=str(row["summary"]),
        severity=str(row["severity"]),
        target_interest=str(row["target_interest"]),
        body=str(row["body"]),
        xmtp_conversation_id=str(row["xmtp_conversation_id"]),
        xmtp_message_id=str(row["xmtp_message_id"]),
        signal_group_id=str(row["signal_group_id"]),
        signal_message_timestamp=int(row["signal_message_timestamp"]),
        status=str(row["status"]),
        created_at=int(row["created_at"]),
        matures_at=int(row["matures_at"]),
        support_score=int(row["support_score"]),
        payout_amount_wei=str(row["payout_amount_wei"]) if row["payout_amount_wei"] is not None else None,
        payout_tx_hash=str(row["payout_tx_hash"]) if row["payout_tx_hash"] is not None else None,
        bundle_cid=str(row["bundle_cid"]) if row["bundle_cid"] is not None else None,
        bundle_uri=str(row["bundle_uri"]) if row["bundle_uri"] is not None else None,
        bundle_gateway_url=str(row["bundle_gateway_url"]) if row["bundle_gateway_url"] is not None else None,
        bundle_sha256=str(row["bundle_sha256"]) if row["bundle_sha256"] is not None else None,
        details_key_b64=str(row["details_key_b64"]) if row["details_key_b64"] is not None else None,
        details_key_commitment=str(row["details_key_commitment"]) if row["details_key_commitment"] is not None else None,
        encrypted_details_hash=str(row["encrypted_details_hash"]) if row["encrypted_details_hash"] is not None else None,
        bundle_pinned_at=int(row["bundle_pinned_at"]) if row["bundle_pinned_at"] is not None else None,
        report_hash=str(row["report_hash"]) if row["report_hash"] is not None else None,
        index_tx_hash=str(row["index_tx_hash"]) if row["index_tx_hash"] is not None else None,
        index_published_at=int(row["index_published_at"]) if row["index_published_at"] is not None else None,
        error=str(row["error"]) if row["error"] is not None else None,
    )


def _ensure_submission_columns(conn: sqlite3.Connection) -> None:
    columns = {str(row["name"]) for row in conn.execute("PRAGMA table_info(submissions)").fetchall()}
    if "bug_type" not in columns:
        conn.execute("ALTER TABLE submissions ADD COLUMN bug_type TEXT NOT NULL DEFAULT '0day'")
    if "target_interest" not in columns:
        conn.execute("ALTER TABLE submissions ADD COLUMN target_interest TEXT NOT NULL DEFAULT 'medium'")
    if "bundle_cid" not in columns:
        conn.execute("ALTER TABLE submissions ADD COLUMN bundle_cid TEXT")
    if "bundle_uri" not in columns:
        conn.execute("ALTER TABLE submissions ADD COLUMN bundle_uri TEXT")
    if "bundle_gateway_url" not in columns:
        conn.execute("ALTER TABLE submissions ADD COLUMN bundle_gateway_url TEXT")
    if "bundle_sha256" not in columns:
        conn.execute("ALTER TABLE submissions ADD COLUMN bundle_sha256 TEXT")
    if "details_key_b64" not in columns:
        conn.execute("ALTER TABLE submissions ADD COLUMN details_key_b64 TEXT")
    if "details_key_commitment" not in columns:
        conn.execute("ALTER TABLE submissions ADD COLUMN details_key_commitment TEXT")
    if "encrypted_details_hash" not in columns:
        conn.execute("ALTER TABLE submissions ADD COLUMN encrypted_details_hash TEXT")
    if "bundle_pinned_at" not in columns:
        conn.execute("ALTER TABLE submissions ADD COLUMN bundle_pinned_at INTEGER")
    if "report_hash" not in columns:
        conn.execute("ALTER TABLE submissions ADD COLUMN report_hash TEXT")
    if "index_tx_hash" not in columns:
        conn.execute("ALTER TABLE submissions ADD COLUMN index_tx_hash TEXT")
    if "index_published_at" not in columns:
        conn.execute("ALTER TABLE submissions ADD COLUMN index_published_at INTEGER")
