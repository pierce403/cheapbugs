from __future__ import annotations

import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from cheapbugs_bouncer.commands import parse_command
from cheapbugs_bouncer.models import SignalReactionEvent, SubmissionCommand
from cheapbugs_bouncer.rewards import reward_tokens, tokens_to_wei
from cheapbugs_bouncer.signal_cli import extract_reaction_events, parse_signal_timestamp
from cheapbugs_bouncer.store import BouncerStore


WALLET = "0x1111111111111111111111111111111111111111"


class CommandParsingTest(unittest.TestCase):
    def test_parse_text_submission(self) -> None:
        command = parse_command(
            f"""!submit
wallet: {WALLET}
signal: +15551234567
title: Parser overflow
summary: Public safe summary
severity: high

Private details go here.""",
        )

        self.assertIsInstance(command, SubmissionCommand)
        self.assertEqual(command.reporter_address, WALLET)
        self.assertEqual(command.signal_recipient, "+15551234567")
        self.assertEqual(command.title, "Parser overflow")
        self.assertEqual(command.body, "Private details go here.")

    def test_parse_json_access_uses_sender_wallet(self) -> None:
        command = parse_command('{"type":"access","signal":"u:alice.01"}', fallback_sender_address=WALLET)

        self.assertEqual(command.wallet_address, WALLET)
        self.assertEqual(command.signal_recipient, "u:alice.01")


class RewardTest(unittest.TestCase):
    def test_reward_cap(self) -> None:
        reward = reward_tokens(Decimal("10"), Decimal("7.5"), Decimal("25"), 4)

        self.assertEqual(reward, Decimal("25"))
        self.assertEqual(tokens_to_wei(Decimal("1.25")), 1_250_000_000_000_000_000)


class SignalParsingTest(unittest.TestCase):
    def test_parse_send_timestamp_from_json(self) -> None:
        self.assertEqual(parse_signal_timestamp('{"timestamp":1760000000123}'), 1760000000123)

    def test_extract_reaction_events(self) -> None:
        raw = [
            {
                "envelope": {
                    "sourceUuid": "reactor-1",
                    "dataMessage": {
                        "groupInfo": {"groupId": "group-1"},
                        "reaction": {
                            "emoji": "\U0001f44d",
                            "targetSentTimestamp": 1760000000123,
                            "isRemove": False,
                        },
                    },
                }
            }
        ]

        events = extract_reaction_events(raw, "fallback")

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].group_id, "group-1")
        self.assertEqual(events[0].emoji, "\U0001f44d")


class StoreTest(unittest.TestCase):
    def test_reaction_count_and_maturity(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BouncerStore(Path(tmp) / "bouncer.sqlite")
            store.init()
            command = SubmissionCommand(
                reporter_address=WALLET,
                signal_recipient="+15551234567",
                title="Title",
                summary="Summary",
                severity="high",
                body="Details",
            )
            record = store.create_submission(
                command=command,
                xmtp_conversation_id="conversation",
                xmtp_message_id="message",
                signal_group_id="group",
                signal_message_timestamp=1760000000123,
                review_window_seconds=7,
                now=100,
            )
            store.upsert_reaction(
                SignalReactionEvent(
                    group_id="group",
                    target_sent_timestamp=1760000000123,
                    reactor_id="reactor",
                    emoji="\U0001f44d",
                    is_remove=False,
                    observed_at=101,
                )
            )

            self.assertEqual(store.support_score("group", 1760000000123), 1)
            self.assertEqual(store.mature_unpaid_submissions(now=106), [])
            self.assertEqual([item.id for item in store.mature_unpaid_submissions(now=107)], [record.id])


if __name__ == "__main__":
    unittest.main()
