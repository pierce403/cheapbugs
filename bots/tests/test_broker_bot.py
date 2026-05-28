from __future__ import annotations

import asyncio
import hashlib
import json
import tempfile
import time
import unittest
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from cheapbugs_broker.bugbundle import (
    BUG_BUNDLE_SCHEMA,
    BUG_BUNDLE_VERSION,
    PUBLISH_AUTHORIZATION_SCHEME,
    PUBLISH_BUG_TYPES,
    BugBundleError,
    VerifiedBugBundle,
    canonical_json_bytes,
    verify_authorized_bug_bundle,
)
from cheapbugs_broker.bug_index import (
    BugIndexClient,
    BugIndexPublishError,
    BugIndexPublishResult,
    build_publish_bug_call_args,
    checksum_publish_bug_input,
)
from cheapbugs_broker.commands import CommandError, parse_command, validate_submission_target
from cheapbugs_broker.config import BrokerConfig
from cheapbugs_broker.ipfs import IpfsAddResult
from cheapbugs_broker.models import AccessCommand, DetailUnlockCommand, SignalReactionEvent, SubmissionCommand
from cheapbugs_broker.rewards import reward_tokens, tokens_to_wei
from cheapbugs_broker.service import BrokerBot
from cheapbugs_broker.signal_cli import extract_reaction_events, parse_signal_timestamp
from cheapbugs_broker.store import BrokerStore


WALLET = "0x1111111111111111111111111111111111111111"
BROKER = "0x2222222222222222222222222222222222222222"
DETAILS_KEY = bytes(range(32))
DETAILS_KEY_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"


class CommandParsingTest(unittest.TestCase):
    def test_parse_strict_json_submission(self) -> None:
        command = parse_command(json.dumps(valid_submission_payload()))

        self.assertIsInstance(command, SubmissionCommand)
        self.assertEqual(command.reporter_address, WALLET)
        self.assertEqual(command.signal_recipient, "+15551234567")
        self.assertEqual(command.bug_type, "0day")
        self.assertEqual(command.title, "Parser overflow")
        self.assertEqual(command.severity, "high")
        self.assertEqual(command.target_interest, "critical")
        self.assertEqual(command.target_kind, "repo")
        self.assertEqual(command.target_ref, "pierce403/cheapbugs")
        self.assertEqual(command.tags, ("parser", "memory"))
        self.assertIsNotNone(command.bug_bundle)
        self.assertIsNotNone(command.publish_authorization)
        self.assertEqual(command.details_key_b64, DETAILS_KEY_B64)

    def test_parse_minimal_json_submission_defaults_broker_fields(self) -> None:
        command = parse_command(json.dumps(minimal_submission_payload()))

        self.assertIsInstance(command, SubmissionCommand)
        self.assertEqual(command.signal_recipient, "broker-managed")
        self.assertEqual(command.target_kind, "other")
        self.assertEqual(command.target_ref, "broker triage")
        self.assertEqual(command.disclosure_mode, "private")
        self.assertEqual(command.tags, tuple())
        self.assertEqual(command.bug_type, "web")
        self.assertEqual(command.severity, "medium")
        self.assertEqual(command.target_interest, "high")
        self.assertEqual(command.repro_steps, "")

    def test_parse_web3_submission_category(self) -> None:
        payload = valid_submission_payload(bug_type="web3")
        assert isinstance(payload["bug_bundle"], dict)
        payload["bug_bundle"] = fake_bug_bundle(
            reporter=WALLET,
            broker=BROKER,
            bug_type="web3",
            severity="high",
            target_interest="critical",
            title="Parser overflow",
            public_summary="Public safe summary for reviewers.",
            target={"kind": "repo", "reference": "pierce403/cheapbugs"},
            tags=["parser", "memory"],
        )
        payload["publish_authorization"] = fake_publish_authorization(payload["bug_bundle"]["core"])

        command = parse_command(json.dumps(payload))

        self.assertIsInstance(command, SubmissionCommand)
        self.assertEqual(command.bug_type, "web3")

    def test_reject_text_submission(self) -> None:
        with self.assertRaisesRegex(CommandError, "strict CheapBugs JSON schema"):
            parse_command(
                f"""!submit
wallet: {WALLET}
signal: +15551234567
title: Parser overflow
summary: Public safe summary
severity: high

Private details go here.""",
            )

    def test_reject_missing_submission_fields(self) -> None:
        payload = valid_submission_payload()
        del payload["details_key"]

        with self.assertRaisesRegex(CommandError, "details_key"):
            parse_command(json.dumps(payload))

    def test_reject_bad_details_key_shape(self) -> None:
        payload = valid_submission_payload()
        payload["details_key"] = "not-a-32-byte-key"

        with self.assertRaisesRegex(CommandError, "details_key"):
            parse_command(json.dumps(payload))

    def test_reject_missing_publish_authorization(self) -> None:
        payload = valid_submission_payload()
        del payload["publish_authorization"]

        with self.assertRaisesRegex(CommandError, "publish_authorization"):
            parse_command(json.dumps(payload))

    def test_verify_real_authorized_bugbundle(self) -> None:
        try:
            from eth_account import Account
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        except ImportError:
            self.skipTest("broker crypto dependencies are only installed in the broker runtime environment")

        account = Account.from_key("0x" + "1" * 64)
        payload = real_signed_submission_payload(str(account.address).lower(), account, AESGCM)

        command = parse_command(json.dumps(payload))

        self.assertIsInstance(command, SubmissionCommand)
        verified = verify_authorized_bug_bundle(
            command,
            chain_id=8453,
            bug_index_address=WALLET,
        )
        self.assertEqual(verified.details, "Private details go here.")
        self.assertEqual(verified.details_key_b64, DETAILS_KEY_B64)
        self.assertEqual(verified.publish_authorization["scheme"], PUBLISH_AUTHORIZATION_SCHEME)

    def test_reject_real_authorized_bugbundle_mangled_details_key_before_pin(self) -> None:
        try:
            from eth_account import Account
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        except ImportError:
            self.skipTest("broker crypto dependencies are only installed in the broker runtime environment")

        account = Account.from_key("0x" + "1" * 64)
        payload = real_signed_submission_payload(str(account.address).lower(), account, AESGCM)
        payload["details_key"] = b64url(bytes(reversed(range(32))))
        command = parse_command(json.dumps(payload))

        with self.assertRaisesRegex(BugBundleError, "details key does not match details_key_commitment"):
            verify_authorized_bug_bundle(command, chain_id=8453, bug_index_address=WALLET)

    def test_reject_altered_publish_authorization_bundle_hash(self) -> None:
        payload = valid_submission_payload()
        assert isinstance(payload["publish_authorization"], dict)
        authorization = dict(payload["publish_authorization"])
        message = dict(authorization["message"])
        message["bugBundleHash"] = "0x" + "9" * 64
        authorization["message"] = message
        payload["publish_authorization"] = authorization
        command = parse_command(json.dumps(payload))

        with self.assertRaisesRegex(BugBundleError, "bugBundleHash"):
            verify_authorized_bug_bundle(command, chain_id=8453, bug_index_address=WALLET)

    def test_reject_invalid_submission_guidance(self) -> None:
        with self.assertRaisesRegex(CommandError, "bug_type"):
            parse_command(json.dumps(valid_submission_payload(bug_type="malware")))
        with self.assertRaisesRegex(CommandError, "target_interest"):
            parse_command(json.dumps(valid_submission_payload(target_interest="spicy")))

    def test_validate_submission_target(self) -> None:
        command = parse_command(json.dumps(valid_submission_payload(target={"kind": "contract", "reference": WALLET})))

        self.assertIsInstance(command, SubmissionCommand)
        validate_submission_target(command)

    def test_reject_invalid_submission_target(self) -> None:
        command = parse_command(json.dumps(valid_submission_payload(target={"kind": "repo", "reference": "not a repo"})))

        self.assertIsInstance(command, SubmissionCommand)
        with self.assertRaisesRegex(CommandError, "GitHub URL"):
            validate_submission_target(command)

    def test_parse_json_access_uses_sender_wallet(self) -> None:
        command = parse_command('{"type":"access","signal":"u:alice.01"}', fallback_sender_address=WALLET)

        self.assertIsInstance(command, AccessCommand)
        self.assertEqual(command.wallet_address, WALLET)
        self.assertEqual(command.signal_recipient, "u:alice.01")

    def test_parse_access_rejects_spoofed_json_wallet(self) -> None:
        with self.assertRaisesRegex(CommandError, "authenticated XMTP sender"):
            parse_command(
                f'{{"type":"access","wallet":"{BROKER}","signal":"u:alice.01"}}',
                fallback_sender_address=WALLET,
            )

    def test_parse_access_rejects_spoofed_keyed_wallet(self) -> None:
        with self.assertRaisesRegex(CommandError, "authenticated XMTP sender"):
            parse_command(
                f"""!access
wallet: {BROKER}
signal: u:alice.01
""",
                fallback_sender_address=WALLET,
            )

    def test_parse_access_requires_authenticated_sender(self) -> None:
        with self.assertRaisesRegex(CommandError, "authenticated XMTP sender"):
            parse_command(f'{{"type":"access","wallet":"{WALLET}","signal":"u:alice.01"}}')

    def test_parse_access_accepts_matching_claimed_wallet(self) -> None:
        mixed_case_wallet = WALLET[:2] + WALLET[2:].upper()
        command = parse_command(
            f'{{"type":"access","wallet":"{mixed_case_wallet}","signal":"u:alice.01"}}',
            fallback_sender_address=WALLET,
        )

        self.assertIsInstance(command, AccessCommand)
        self.assertEqual(command.wallet_address, WALLET)

    def test_parse_detail_unlock_quote_requires_authenticated_buyer(self) -> None:
        command = parse_command(json.dumps(detail_unlock_payload()), fallback_sender_address=WALLET)

        self.assertIsInstance(command, DetailUnlockCommand)
        self.assertEqual(command.action, "quote")
        self.assertEqual(command.buyer_address, WALLET)
        self.assertEqual(command.treasury_vault_address, BROKER)

    def test_parse_detail_unlock_rejects_spoofed_buyer(self) -> None:
        payload = detail_unlock_payload(buyer_address=BROKER)

        with self.assertRaisesRegex(CommandError, "authenticated XMTP sender"):
            parse_command(json.dumps(payload), fallback_sender_address=WALLET)

    def test_parse_detail_unlock_requires_authenticated_sender(self) -> None:
        with self.assertRaisesRegex(CommandError, "authenticated XMTP sender"):
            parse_command(json.dumps(detail_unlock_payload()))

    def test_parse_detail_unlock_paid_requires_tx_hash(self) -> None:
        payload = detail_unlock_payload(type="detail_unlock_paid")

        with self.assertRaisesRegex(CommandError, "tx_hash"):
            parse_command(json.dumps(payload), fallback_sender_address=WALLET)


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


class ConfigTest(unittest.TestCase):
    def test_runtime_requirements_allow_signal_disabled(self) -> None:
        config = test_config(Path("broker.sqlite"), signal_enabled=False)

        with patch.dict("os.environ", {}, clear=True):
            config.require_runtime()

    def test_runtime_requirements_require_signal_details_when_enabled(self) -> None:
        config = test_config(Path("broker.sqlite"), signal_enabled=True)
        config = BrokerConfig(
            **{
                **config.__dict__,
                "signal_account": "",
                "signal_group_id": "",
            }
        )

        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(ValueError, "BROKER_SIGNAL_ACCOUNT"):
                config.require_runtime()

    def test_from_env_uses_single_broker_key_and_static_defaults(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "BROKER_KEY": "0xbroker",
            },
            clear=True,
        ):
            config = BrokerConfig.from_env()

        self.assertEqual(config.broker_key, "0xbroker")
        self.assertEqual(config.base_rpc_url, "https://mainnet.base.org")
        self.assertEqual(config.bugz_token_address, "0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07")
        self.assertEqual(config.bug_index_address, "0x515FDbc9876aC26870794E26605c7DD04c18679b")
        self.assertEqual(config.ipfs_api_url, "http://127.0.0.1:5001")
        self.assertEqual(config.ipfs_gateway_url, "https://ipfs.io/ipfs")
        self.assertFalse(config.ipfs_prime_gateway)
        self.assertEqual(config.submission_min_balance_tokens, Decimal("0"))
        self.assertFalse(config.reward_base_tokens_configured)

    def test_from_env_marks_explicit_base_reward_override(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "BROKER_KEY": "0xbroker",
                "BROKER_BUGZ_BASE_REWARD": "42.5",
            },
            clear=True,
        ):
            config = BrokerConfig.from_env()

        self.assertEqual(config.reward_base_tokens, Decimal("42.5"))
        self.assertTrue(config.reward_base_tokens_configured)


class StoreTest(unittest.TestCase):
    def test_reaction_count_and_maturity(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            command = SubmissionCommand(
                reporter_address=WALLET,
                signal_recipient="+15551234567",
                bug_type="0day",
                title="Title",
                summary="Summary",
                severity="high",
                target_interest="critical",
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


class SettlementRewardTest(unittest.TestCase):
    def test_unflagged_payout_alert_warns_once_inside_24h_window(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            command = SubmissionCommand(
                reporter_address=WALLET,
                signal_recipient="+15551234567",
                bug_type="0day",
                title="Needs review",
                summary="Summary",
                severity="high",
                target_interest="critical",
                body="Details",
            )
            record = store.create_submission(
                command=command,
                xmtp_conversation_id="conversation",
                xmtp_message_id="message",
                signal_group_id="group",
                signal_message_timestamp=1760000000123,
                review_window_seconds=24 * 60 * 60,
                report_hash="0x" + "8" * 64,
                now=100,
            )
            signal = FakeSignal()
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite"),
                store=store,
                signal=signal,
                token=FakeToken(balance=0),
                bug_index=FakeBugIndex(report_status=0),
            )

            self.assertEqual(bot.alert_unflagged_payouts_once(), 1)
            self.assertEqual(len(signal.messages), 1)
            self.assertIn("still unflagged on-chain", signal.messages[0])
            self.assertIn(record.report_hash, signal.messages[0])
            self.assertEqual(bot.alert_unflagged_payouts_once(), 0)
            self.assertEqual(len(signal.messages), 1)

    def test_unflagged_payout_alert_skips_already_flagged_reports(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            command = SubmissionCommand(
                reporter_address=WALLET,
                signal_recipient="+15551234567",
                bug_type="0day",
                title="Already reviewed",
                summary="Summary",
                severity="high",
                target_interest="critical",
                body="Details",
            )
            store.create_submission(
                command=command,
                xmtp_conversation_id="conversation",
                xmtp_message_id="message",
                signal_group_id="group",
                signal_message_timestamp=1760000000123,
                review_window_seconds=24 * 60 * 60,
                report_hash="0x" + "9" * 64,
                now=100,
            )
            signal = FakeSignal()
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite"),
                store=store,
                signal=signal,
                token=FakeToken(balance=0),
                bug_index=FakeBugIndex(report_status=1),
            )

            self.assertEqual(bot.alert_unflagged_payouts_once(), 0)
            self.assertEqual(signal.messages, [])

    def test_settlement_uses_treasury_base_reward_when_no_env_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            command = SubmissionCommand(
                reporter_address=WALLET,
                signal_recipient="+15551234567",
                bug_type="0day",
                title="Title",
                summary="Summary",
                severity="high",
                target_interest="critical",
                body="Details",
            )
            record = store.create_submission(
                command=command,
                xmtp_conversation_id="conversation",
                xmtp_message_id="message",
                signal_group_id="group",
                signal_message_timestamp=1760000000123,
                review_window_seconds=1,
                now=100,
            )
            token = FakeToken(balance=0)
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite"),
                store=store,
                signal=FakeSignal(),
                token=token,
                treasury=FakeTreasury(base_reward=123 * 10**18),
            )

            self.assertEqual(bot.settle_matured_once(), 1)
            self.assertEqual(token.transfers, [(WALLET, 123 * 10**18)])
            self.assertEqual(len(bot.signal.messages), 1)
            self.assertIn("✅ CheapBugs report completed", bot.signal.messages[0])
            self.assertIn("Amount: 123 BUGZ", bot.signal.messages[0])
            self.assertIn("dry-run:transfer", bot.signal.messages[0])
            updated = store.get_submission(record.id)
            self.assertIsNotNone(updated)
            assert updated is not None
            self.assertEqual(updated.status, "paid")
            self.assertEqual(updated.payout_amount_wei, str(123 * 10**18))

    def test_settlement_completes_index_treasury_payout_when_available(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            command = SubmissionCommand(
                reporter_address=WALLET,
                signal_recipient="+15551234567",
                bug_type="0day",
                title="Title",
                summary="Summary",
                severity="high",
                target_interest="critical",
                body="Details",
            )
            record = store.create_submission(
                command=command,
                xmtp_conversation_id="conversation",
                xmtp_message_id="message",
                signal_group_id="group",
                signal_message_timestamp=1760000000123,
                review_window_seconds=1,
                bug_bundle=fake_pinned_bundle(FakeIpfs().add_json({"ok": True}, "bundle.json")),
                report_hash="0x" + "7" * 64,
                now=100,
            )
            bug_index = FakeBugIndex()
            token = FakeToken(balance=0)
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite"),
                store=store,
                signal=FakeSignal(),
                token=token,
                bug_index=bug_index,
                treasury=FakeTreasury(base_reward=123 * 10**18),
            )

            self.assertEqual(bot.settle_matured_once(), 1)
            self.assertEqual(token.transfers, [])
            self.assertEqual(bug_index.completed_payouts, [("0x" + "7" * 64, 1, DETAILS_KEY)])
            self.assertEqual(len(bot.signal.messages), 1)
            self.assertIn("✅ CheapBugs report completed", bot.signal.messages[0])
            self.assertIn("Amount: 123 BUGZ", bot.signal.messages[0])
            self.assertIn("https://basescan.org/tx/0x" + "b" * 64, bot.signal.messages[0])
            updated = store.get_submission(record.id)
            self.assertIsNotNone(updated)
            assert updated is not None
            self.assertEqual(updated.status, "paid")
            self.assertEqual(updated.payout_amount_wei, str(123 * 10**18))
            self.assertEqual(updated.payout_tx_hash, "0x" + "b" * 64)

    def test_settlement_refuses_index_payout_when_stored_details_key_commitment_mismatches(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            command = SubmissionCommand(
                reporter_address=WALLET,
                signal_recipient="+15551234567",
                bug_type="0day",
                title="Title",
                summary="Summary",
                severity="high",
                target_interest="critical",
                body="Details",
            )
            pinned = fake_pinned_bundle(FakeIpfs().add_json({"ok": True}, "bundle.json"))
            pinned.details_key_commitment = "0x" + "9" * 64
            record = store.create_submission(
                command=command,
                xmtp_conversation_id="conversation",
                xmtp_message_id="message",
                signal_group_id="group",
                signal_message_timestamp=1760000000123,
                review_window_seconds=1,
                bug_bundle=pinned,
                report_hash="0x" + "7" * 64,
                now=100,
            )
            bug_index = FakeBugIndex()
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite"),
                store=store,
                signal=FakeSignal(),
                token=FakeToken(balance=0),
                bug_index=bug_index,
                treasury=FakeTreasury(base_reward=123 * 10**18),
            )

            self.assertEqual(bot.settle_matured_once(), 0)
            self.assertEqual(bug_index.completed_payouts, [])
            updated = store.get_submission(record.id)
            self.assertIsNotNone(updated)
            assert updated is not None
            self.assertEqual(updated.status, "failed")
            self.assertIn("stored submission details_key_commitment", str(updated.error))
            self.assertIn("refusing to submit completePayout", str(updated.error))

    def test_settlement_refuses_index_payout_when_onchain_details_key_commitment_mismatches(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            command = SubmissionCommand(
                reporter_address=WALLET,
                signal_recipient="+15551234567",
                bug_type="0day",
                title="Title",
                summary="Summary",
                severity="high",
                target_interest="critical",
                body="Details",
            )
            record = store.create_submission(
                command=command,
                xmtp_conversation_id="conversation",
                xmtp_message_id="message",
                signal_group_id="group",
                signal_message_timestamp=1760000000123,
                review_window_seconds=1,
                bug_bundle=fake_pinned_bundle(FakeIpfs().add_json({"ok": True}, "bundle.json")),
                report_hash="0x" + "7" * 64,
                now=100,
            )
            bug_index = FakeBugIndex(details_key_commitment="0x" + "9" * 64)
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite"),
                store=store,
                signal=FakeSignal(),
                token=FakeToken(balance=0),
                bug_index=bug_index,
                treasury=FakeTreasury(base_reward=123 * 10**18),
            )

            self.assertEqual(bot.settle_matured_once(), 0)
            self.assertEqual(bug_index.completed_payouts, [])
            self.assertEqual(bug_index.last_details_key_commitment_report_hash, "0x" + "7" * 64)
            updated = store.get_submission(record.id)
            self.assertIsNotNone(updated)
            assert updated is not None
            self.assertEqual(updated.status, "failed")
            self.assertIn("onchain CheapBugsBugIndex detailsKeyCommitment", str(updated.error))
            self.assertIn("refusing to submit completePayout", str(updated.error))

    def test_settlement_keeps_transient_rpc_errors_retryable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            command = SubmissionCommand(
                reporter_address=WALLET,
                signal_recipient="+15551234567",
                bug_type="0day",
                title="Title",
                summary="Summary",
                severity="high",
                target_interest="critical",
                body="Details",
            )
            record = store.create_submission(
                command=command,
                xmtp_conversation_id="conversation",
                xmtp_message_id="message",
                signal_group_id="group",
                signal_message_timestamp=1760000000123,
                review_window_seconds=1,
                bug_bundle=fake_pinned_bundle(FakeIpfs().add_json({"ok": True}, "bundle.json")),
                report_hash="0x" + "7" * 64,
                now=100,
            )
            bug_index = FakeBugIndex(error=RuntimeError("429 Client Error: Too Many Requests"))
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite"),
                store=store,
                signal=FakeSignal(),
                token=FakeToken(balance=0),
                bug_index=bug_index,
                treasury=FakeTreasury(base_reward=123 * 10**18),
            )

            self.assertEqual(bot.settle_matured_once(), 0)
            self.assertEqual(bug_index.completed_payouts, [])
            updated = store.get_submission(record.id)
            self.assertIsNotNone(updated)
            assert updated is not None
            self.assertEqual(updated.status, "relayed")
            self.assertIsNone(updated.error)

    def test_settlement_uses_zero_multiplier_for_invalid_index_reports(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            command = SubmissionCommand(
                reporter_address=WALLET,
                signal_recipient="+15551234567",
                bug_type="0day",
                title="Invalid Title",
                summary="Summary",
                severity="high",
                target_interest="critical",
                body="Details",
            )
            record = store.create_submission(
                command=command,
                xmtp_conversation_id="conversation",
                xmtp_message_id="message",
                signal_group_id="group",
                signal_message_timestamp=1760000000123,
                review_window_seconds=1,
                bug_bundle=fake_pinned_bundle(FakeIpfs().add_json({"ok": True}, "bundle.json")),
                report_hash="0x" + "6" * 64,
                now=100,
            )
            bug_index = FakeBugIndex(report_status=2)
            token = FakeToken(balance=0)
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite"),
                store=store,
                signal=FakeSignal(),
                token=token,
                bug_index=bug_index,
                treasury=FakeTreasury(base_reward=123 * 10**18),
            )

            self.assertEqual(bot.settle_matured_once(), 1)
            self.assertEqual(bug_index.completed_payouts, [("0x" + "6" * 64, 0, DETAILS_KEY)])
            self.assertEqual(len(bot.signal.messages), 1)
            self.assertIn("Amount: 0 BUGZ", bot.signal.messages[0])
            self.assertIn("invalid — zero payout; details key revealed", bot.signal.messages[0])
            updated = store.get_submission(record.id)
            self.assertIsNotNone(updated)
            assert updated is not None
            self.assertEqual(updated.status, "paid")
            self.assertEqual(updated.payout_amount_wei, "0")

    def test_settlement_skips_before_onchain_reveal_time_without_marking_failed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            command = SubmissionCommand(
                reporter_address=WALLET,
                signal_recipient="+15551234567",
                bug_type="0day",
                title="Not Ready Title",
                summary="Summary",
                severity="high",
                target_interest="critical",
                body="Details",
            )
            record = store.create_submission(
                command=command,
                xmtp_conversation_id="conversation",
                xmtp_message_id="message",
                signal_group_id="group",
                signal_message_timestamp=1760000000123,
                review_window_seconds=1,
                bug_bundle=fake_pinned_bundle(FakeIpfs().add_json({"ok": True}, "bundle.json")),
                report_hash="0x" + "4" * 64,
                now=100,
            )
            bug_index = FakeBugIndex(report_status=1, reveal_after=int(time.time()) + 60)
            token = FakeToken(balance=0)
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite"),
                store=store,
                signal=FakeSignal(),
                token=token,
                bug_index=bug_index,
                treasury=FakeTreasury(base_reward=123 * 10**18),
            )

            self.assertEqual(bot.settle_matured_once(), 0)
            self.assertEqual(bug_index.completed_payouts, [])
            updated = store.get_submission(record.id)
            self.assertIsNotNone(updated)
            assert updated is not None
            self.assertEqual(updated.status, "relayed")
            self.assertIsNone(updated.error)

    def test_settlement_skips_unreviewed_index_reports_without_marking_failed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            command = SubmissionCommand(
                reporter_address=WALLET,
                signal_recipient="+15551234567",
                bug_type="0day",
                title="Unreviewed Title",
                summary="Summary",
                severity="high",
                target_interest="critical",
                body="Details",
            )
            record = store.create_submission(
                command=command,
                xmtp_conversation_id="conversation",
                xmtp_message_id="message",
                signal_group_id="group",
                signal_message_timestamp=1760000000123,
                review_window_seconds=1,
                bug_bundle=fake_pinned_bundle(FakeIpfs().add_json({"ok": True}, "bundle.json")),
                report_hash="0x" + "5" * 64,
                now=100,
            )
            bug_index = FakeBugIndex(report_status=0)
            token = FakeToken(balance=0)
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite"),
                store=store,
                signal=FakeSignal(),
                token=token,
                bug_index=bug_index,
                treasury=FakeTreasury(base_reward=123 * 10**18),
            )

            self.assertEqual(bot.settle_matured_once(), 0)
            self.assertEqual(bug_index.completed_payouts, [])
            updated = store.get_submission(record.id)
            self.assertIsNotNone(updated)
            assert updated is not None
            self.assertEqual(updated.status, "relayed")
            self.assertIsNone(updated.error)

    def test_settlement_honors_explicit_base_reward_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            command = SubmissionCommand(
                reporter_address=WALLET,
                signal_recipient="+15551234567",
                bug_type="0day",
                title="Title",
                summary="Summary",
                severity="high",
                target_interest="critical",
                body="Details",
            )
            store.create_submission(
                command=command,
                xmtp_conversation_id="conversation",
                xmtp_message_id="message",
                signal_group_id="group",
                signal_message_timestamp=1760000000123,
                review_window_seconds=1,
                now=100,
            )
            config = BrokerConfig(
                **{
                    **test_config(Path(tmp) / "broker.sqlite").__dict__,
                    "reward_base_tokens": Decimal("5"),
                    "reward_base_tokens_configured": True,
                }
            )
            token = FakeToken(balance=0)
            bot = BrokerBot(
                config=config,
                store=store,
                signal=FakeSignal(),
                token=token,
                treasury=FakeTreasury(base_reward=123 * 10**18),
            )

            self.assertEqual(bot.settle_matured_once(), 1)
            self.assertEqual(token.transfers, [(WALLET, 5 * 10**18)])


class BugIndexPublishTest(unittest.TestCase):
    def test_publish_bug_call_args_match_verified_authorization(self) -> None:
        command = parse_command(json.dumps(valid_submission_payload()))
        self.assertIsInstance(command, SubmissionCommand)
        verified = fake_verified_bundle()
        bug_bundle = FakeIpfs().add_json(verified.payload, "bundle.json")
        pinned = fake_pinned_bundle(bug_bundle)

        bug_input, nonce, deadline, signature = build_publish_bug_call_args(command, verified, pinned)

        self.assertEqual(bug_input[0], verified.report_hash)
        self.assertEqual(bug_input[1], f"cb-{verified.report_hash[2:10]}")
        self.assertEqual(bug_input[2], WALLET)
        self.assertEqual(bug_input[5], "Public safe summary for reviewers.")
        self.assertEqual(bug_input[6], "ipfs://bafyfakebugbundle")
        self.assertEqual(bug_input[9], "")
        self.assertEqual(bug_input[13], verified.details_key_commitment)
        self.assertEqual(nonce, 7)
        self.assertEqual(deadline, 1779062400)
        self.assertTrue(signature.startswith("0x"))

    def test_publish_bug_call_args_checksum_reporter_for_web3(self) -> None:
        reporter = "0x7ab874eeef0169ada0d225e9801a3ffffa26aac3"
        bug_bundle = fake_bug_bundle(
            reporter=reporter,
            bug_type="web",
            severity="medium",
            target_interest="high",
            title="Parser overflow",
            public_summary="Public safe summary for reviewers.",
        )
        payload = minimal_submission_payload(
            reporter_address=reporter,
            bug_bundle=bug_bundle,
            publish_authorization=fake_publish_authorization(bug_bundle["core"]),
        )
        command = parse_command(json.dumps(payload))
        self.assertIsInstance(command, SubmissionCommand)
        verified = fake_verified_bundle(payload["bug_bundle"])
        bug_bundle = FakeIpfs().add_json(verified.payload, "bundle.json")
        pinned = fake_pinned_bundle(bug_bundle)

        bug_input, _, _, _ = build_publish_bug_call_args(command, verified, pinned)
        checked = checksum_publish_bug_input(FakeWeb3(), bug_input)

        self.assertEqual(checked[2], "0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3")

    def test_publish_bug_checksums_reporter_before_gas_estimation(self) -> None:
        reporter = "0x7ab874eeef0169ada0d225e9801a3ffffa26aac3"
        bug_bundle_payload = fake_bug_bundle(
            reporter=reporter,
            bug_type="web",
            severity="medium",
            target_interest="high",
            title="Parser overflow",
            public_summary="Public safe summary for reviewers.",
        )
        payload = minimal_submission_payload(
            reporter_address=reporter,
            bug_bundle=bug_bundle_payload,
            publish_authorization=fake_publish_authorization(bug_bundle_payload["core"]),
        )
        command = parse_command(json.dumps(payload))
        self.assertIsInstance(command, SubmissionCommand)
        verified = fake_verified_bundle(payload["bug_bundle"])
        bug_bundle = FakeIpfs().add_json(verified.payload, "bundle.json")
        pinned = fake_pinned_bundle(bug_bundle)
        web3 = FakePublishWeb3()
        contract = FakeBugIndexContract()
        client = BugIndexClient("http://localhost:8545", WALLET, "0xabc", 8453)
        client._web3 = web3
        client._contract = contract
        client._account = FakeAccount(BROKER)

        with patch("cheapbugs_broker.bug_index.time.time", return_value=1778976000):
            result = client.publish_bug(command, verified, pinned)

        self.assertEqual(result.tx_hash, "0x" + "a" * 64)
        self.assertEqual(contract.publish_function.bug_input[2], "0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3")

    def test_publish_bug_decodes_invalid_reveal_after_revert(self) -> None:
        command = parse_command(json.dumps(valid_submission_payload()))
        self.assertIsInstance(command, SubmissionCommand)
        verified = fake_verified_bundle()
        bug_bundle = FakeIpfs().add_json(verified.payload, "bundle.json")
        pinned = fake_pinned_bundle(bug_bundle)
        revert_data = "0xe5ee267f" + f"{1779580800:064x}"
        client = BugIndexClient("http://localhost:8545", WALLET, "0xabc", 8453)
        client._web3 = FakePublishWeb3()
        client._contract = FakeBugIndexContract(gas_error=ValueError((revert_data, revert_data)))
        client._account = FakeAccount(BROKER)

        with patch("cheapbugs_broker.bug_index.time.time", return_value=1778976000):
            with self.assertRaisesRegex(BugIndexPublishError, "InvalidRevealAfter.*2026-05-24"):
                client.publish_bug(command, verified, pinned)


class BrokerServiceTest(unittest.TestCase):
    def test_unrecognized_xmtp_text_gets_liveness_hello(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            replies: list[str] = []
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite", signal_enabled=False),
                store=store,
                signal=None,
                token=FakeToken(balance=0),
                ipfs=FakeIpfs(),
                bug_index=FakeBugIndex(),
            )

            async def reply(message: str) -> None:
                replies.append(message)

            asyncio.run(
                bot.handle_xmtp_text(
                    "gm cheapbugs",
                    sender_address=WALLET,
                    conversation_id="conversation",
                    message_id="hello-message",
                    reply=reply,
                )
            )

            self.assertEqual(replies, ["hello."])
            self.assertTrue(store.message_seen("hello-message"))

    def test_unrecognized_json_flow_gets_liveness_hello(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            replies: list[str] = []
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite", signal_enabled=False),
                store=store,
                signal=None,
                token=FakeToken(balance=0),
                ipfs=FakeIpfs(),
                bug_index=FakeBugIndex(),
            )

            async def reply(message: str) -> None:
                replies.append(message)

            asyncio.run(
                bot.handle_xmtp_text(
                    '{"type":"ping"}',
                    sender_address=WALLET,
                    conversation_id="conversation",
                    message_id="json-hello-message",
                    reply=reply,
                )
            )

            self.assertEqual(replies, ["hello."])
            self.assertTrue(store.message_seen("json-hello-message"))

    def test_access_rejects_spoofed_wallet_before_balance_or_invite(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            replies: list[str] = []
            token = FakeToken(balance=2 * 10**18)
            signal = FakeSignal()
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite"),
                store=store,
                signal=signal,
                token=token,
                ipfs=FakeIpfs(),
                bug_index=FakeBugIndex(),
            )

            async def reply(message: str) -> None:
                replies.append(message)

            asyncio.run(
                bot.handle_xmtp_text(
                    f'{{"type":"access","wallet":"{BROKER}","signal":"+15551234567"}}',
                    sender_address=WALLET,
                    conversation_id="conversation",
                    message_id="spoofed-access",
                    reply=reply,
                )
            )

            self.assertIn("Access request wallet must match", replies[0])
            self.assertFalse(hasattr(token, "last_balance_address"))
            self.assertFalse(hasattr(signal, "last_member"))
            self.assertTrue(store.message_seen("spoofed-access"))

    def test_submission_logs_broker_actions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite", signal_enabled=False),
                store=store,
                signal=None,
                token=FakeToken(balance=2 * 10**18),
                ipfs=FakeIpfs(),
                bug_index=FakeBugIndex(),
            )

            async def reply(_message: str) -> None:
                return None

            with self.assertLogs("cheapbugs_broker.service", level="INFO") as logs:
                with patch("cheapbugs_broker.service.verify_authorized_bug_bundle", return_value=fake_verified_bundle()):
                    asyncio.run(
                        bot.handle_xmtp_text(
                            json.dumps(valid_submission_payload()),
                            sender_address=WALLET,
                            conversation_id="conversation",
                            message_id="logged-message",
                            reply=reply,
                        )
                    )

        output = "\n".join(logs.output)
        self.assertIn("xmtp message received", output)
        self.assertIn(f"NEW SUBMISSION from {WALLET}", output)
        self.assertIn("NEW SUBMISSION full_json", output)
        self.assertIn("submission command parsed", output)
        self.assertIn("submission recorded", output)
        self.assertIn("bug_bundle", output)

    def test_submission_rejects_reporter_that_differs_from_xmtp_sender(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            replies: list[str] = []
            token = FakeToken(balance=2 * 10**18)
            ipfs = FakeIpfs()
            bug_index = FakeBugIndex()
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite", signal_enabled=False),
                store=store,
                signal=None,
                token=token,
                ipfs=ipfs,
                bug_index=bug_index,
            )

            async def reply(message: str) -> None:
                replies.append(message)

            with patch("cheapbugs_broker.service.verify_authorized_bug_bundle", return_value=fake_verified_bundle()):
                asyncio.run(
                    bot.handle_xmtp_text(
                        json.dumps(valid_submission_payload()),
                        sender_address=BROKER,
                        conversation_id="conversation",
                        message_id="spoofed-submission",
                        reply=reply,
                    )
                )

            self.assertIn("BugBundle is invalid", replies[-1])
            self.assertIn("authenticated XMTP sender", replies[-1])
            self.assertFalse(hasattr(token, "last_balance_address"))
            self.assertIsNone(ipfs.last_payload)
            self.assertIsNone(bug_index.last_command)
            self.assertTrue(store.message_seen("spoofed-submission"))

    def test_submission_rejects_verified_reporter_mismatch_before_payout_identity_persists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            replies: list[str] = []
            token = FakeToken(balance=2 * 10**18)
            ipfs = FakeIpfs()
            bug_index = FakeBugIndex()
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite", signal_enabled=False),
                store=store,
                signal=None,
                token=token,
                ipfs=ipfs,
                bug_index=bug_index,
            )
            mismatched_bundle = fake_bug_bundle(reporter=BROKER)

            async def reply(message: str) -> None:
                replies.append(message)

            with patch(
                "cheapbugs_broker.service.verify_authorized_bug_bundle",
                return_value=fake_verified_bundle(mismatched_bundle),
            ):
                asyncio.run(
                    bot.handle_xmtp_text(
                        json.dumps(valid_submission_payload()),
                        sender_address=None,
                        conversation_id="conversation",
                        message_id="verified-reporter-mismatch",
                        reply=reply,
                    )
                )

            self.assertIn("verified PublishBug reporter", replies[-1])
            self.assertFalse(hasattr(token, "last_balance_address"))
            self.assertIsNone(ipfs.last_payload)
            self.assertIsNone(bug_index.last_command)
            with store.session() as conn:
                row = conn.execute(
                    "SELECT * FROM submissions WHERE xmtp_message_id = ?",
                    ("verified-reporter-mismatch",),
                ).fetchone()
            self.assertIsNone(row)

    def test_submission_replies_with_validation_stages_before_relay(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            replies: list[str] = []
            signal = FakeSignal()
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite"),
                store=store,
                signal=signal,
                token=FakeToken(balance=2 * 10**18),
                ipfs=FakeIpfs(),
                bug_index=FakeBugIndex(),
            )

            async def reply(message: str) -> None:
                replies.append(message)

            with patch("cheapbugs_broker.service.verify_authorized_bug_bundle", return_value=fake_verified_bundle()):
                asyncio.run(
                    bot.handle_xmtp_text(
                        json.dumps(valid_submission_payload()),
                        sender_address=WALLET,
                        conversation_id="conversation",
                        message_id="message",
                        reply=reply,
                    )
                )

            self.assertIn("Submission JSON is valid", replies[0])
            self.assertEqual(replies[1], "Submission fields are present and well formed.")
            self.assertEqual(replies[2], "Publish authorization is valid and encrypted BugBundle details decrypt cleanly.")
            self.assertIn("Submission target is valid", replies[3])
            self.assertIn("Submission credentials are valid", replies[4])
            self.assertIn("Encrypted BugBundle pinned to IPFS", replies[5])
            self.assertIn("Bug published onchain", replies[6])
            self.assertIn("Submission complete", replies[7])
            self.assertIn("Submission relayed", replies[7])
            self.assertIn("BugBundle: ipfs://bafyfakebugbundle", signal.last_message)
            self.assertNotIn("Repro steps:", signal.last_message)
            self.assertNotIn("Evidence:", signal.last_message)
            self.assertNotIn("Contact hints:", signal.last_message)

    def test_submission_stops_when_bugbundle_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            replies: list[str] = []
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite"),
                store=store,
                signal=FakeSignal(),
                token=FakeToken(balance=2 * 10**18),
                ipfs=FakeIpfs(),
                bug_index=FakeBugIndex(),
            )

            async def reply(message: str) -> None:
                replies.append(message)

            with patch(
                "cheapbugs_broker.service.verify_authorized_bug_bundle",
                side_effect=BugBundleError("signature does not recover"),
            ):
                asyncio.run(
                    bot.handle_xmtp_text(
                        json.dumps(valid_submission_payload()),
                        sender_address=WALLET,
                        conversation_id="conversation",
                        message_id="message",
                        reply=reply,
                    )
                )

            self.assertIn("BugBundle is invalid", replies[-1])
            self.assertFalse(any("Encrypted BugBundle pinned" in reply for reply in replies))

    def test_live_submission_stops_when_reveal_window_is_too_close(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            replies: list[str] = []
            ipfs = FakeIpfs()
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite", signal_enabled=False, dry_run=False),
                store=store,
                signal=None,
                token=FakeToken(balance=2 * 10**18),
                ipfs=ipfs,
                bug_index=FakeBugIndex(),
            )

            async def reply(message: str) -> None:
                replies.append(message)

            with patch("cheapbugs_broker.service.verify_authorized_bug_bundle", return_value=fake_verified_bundle()):
                with patch("cheapbugs_broker.service.time.time", return_value=1778976001):
                    asyncio.run(
                        bot.handle_xmtp_text(
                            json.dumps(valid_submission_payload()),
                            sender_address=WALLET,
                            conversation_id="conversation",
                            message_id="reveal-too-close",
                            reply=reply,
                        )
                    )

            self.assertIn("revealAfter is too soon", replies[-1])
            self.assertFalse(any("Encrypted BugBundle pinned" in reply for reply in replies))
            self.assertIsNone(ipfs.last_payload)
            self.assertTrue(store.message_seen("reveal-too-close"))

    def test_submission_stops_when_configured_credentials_fail(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            replies: list[str] = []
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite", submission_min_balance_tokens=Decimal("1")),
                store=store,
                signal=FakeSignal(),
                token=FakeToken(balance=0),
                ipfs=FakeIpfs(),
                bug_index=FakeBugIndex(),
            )

            async def reply(message: str) -> None:
                replies.append(message)

            with patch("cheapbugs_broker.service.verify_authorized_bug_bundle", return_value=fake_verified_bundle()):
                asyncio.run(
                    bot.handle_xmtp_text(
                        json.dumps(valid_submission_payload()),
                        sender_address=WALLET,
                        conversation_id="conversation",
                        message_id="message",
                        reply=reply,
                    )
                )

            self.assertIn("Submission credentials are invalid", replies[-1])
            self.assertFalse(any("Submission relayed" in reply for reply in replies))

    def test_submission_records_without_signal_support(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            replies: list[str] = []
            config = test_config(Path(tmp) / "broker.sqlite", signal_enabled=False)
            ipfs = FakeIpfs()
            token = FakeToken(balance=0)
            bot = BrokerBot(
                config=config,
                store=store,
                signal=None,
                token=token,
                ipfs=ipfs,
                bug_index=FakeBugIndex(),
            )

            async def reply(message: str) -> None:
                replies.append(message)

            with patch("cheapbugs_broker.service.verify_authorized_bug_bundle", return_value=fake_verified_bundle()):
                asyncio.run(
                    bot.handle_xmtp_text(
                        json.dumps(valid_submission_payload()),
                        sender_address=WALLET,
                        conversation_id="conversation",
                        message_id="message",
                        reply=reply,
                    )
                )

            self.assertIn("Submission credentials are valid", replies[4])
            self.assertIn("no BUGZ minimum configured", replies[4])
            self.assertFalse(hasattr(token, "last_balance_address"))
            self.assertIn("Encrypted BugBundle pinned to IPFS", replies[5])
            self.assertIn("Bug published onchain", replies[6])
            self.assertIn("Signal is not configured", replies[7])
            self.assertTrue(store.message_seen("message"))
            with store.session() as conn:
                row = conn.execute("SELECT * FROM submissions WHERE xmtp_message_id = ?", ("message",)).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row["bundle_cid"], "bafyfakebugbundle")
            self.assertEqual(row["bundle_uri"], "ipfs://bafyfakebugbundle")
            self.assertEqual(row["status"], "published")
            self.assertEqual(row["report_hash"], fake_verified_bundle().report_hash)
            self.assertEqual(row["index_tx_hash"], "0x" + "a" * 64)
            self.assertTrue(str(row["details_key_b64"]))
            self.assertTrue(str(row["details_key_commitment"]).startswith("0x"))
            self.assertIsNotNone(ipfs.last_payload)
            assert isinstance(ipfs.last_payload, dict)
            self.assertNotIn("broker_status", ipfs.last_payload)
            self.assertNotIn("signature", ipfs.last_payload)
            self.assertEqual(ipfs.last_payload["core"]["reporter"], WALLET)
            records = store.mature_unpaid_submissions(now=10_000)
            self.assertEqual(records, [])

    def test_submission_records_index_publish_failure_with_pinned_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            replies: list[str] = []
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite"),
                store=store,
                signal=FakeSignal(),
                token=FakeToken(balance=2 * 10**18),
                ipfs=FakeIpfs(),
                bug_index=FakeBugIndex(error=BugIndexPublishError("broker wallet is not authorized")),
            )

            async def reply(message: str) -> None:
                replies.append(message)

            with patch("cheapbugs_broker.service.verify_authorized_bug_bundle", return_value=fake_verified_bundle()):
                asyncio.run(
                    bot.handle_xmtp_text(
                        json.dumps(valid_submission_payload()),
                        sender_address=WALLET,
                        conversation_id="conversation",
                        message_id="index-failure",
                        reply=reply,
                    )
                )

            self.assertIn("Encrypted BugBundle pinned to IPFS", replies[5])
            self.assertIn("Bug index publish failed", replies[-1])
            self.assertIn("broker wallet is not authorized", replies[-1])
            self.assertFalse(any("Submission relayed" in reply for reply in replies))
            with store.session() as conn:
                row = conn.execute("SELECT * FROM submissions WHERE xmtp_message_id = ?", ("index-failure",)).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row["status"], "index_failed")
            self.assertEqual(row["bundle_cid"], "bafyfakebugbundle")
            self.assertIn("broker wallet is not authorized", row["error"])

    def test_submission_dry_run_skips_signal_relay(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            replies: list[str] = []
            signal = FakeSignal()
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite"),
                store=store,
                signal=signal,
                token=FakeToken(balance=2 * 10**18),
                ipfs=FakeIpfs(),
                bug_index=FakeBugIndex(dry_run=True),
            )

            async def reply(message: str) -> None:
                replies.append(message)

            with patch("cheapbugs_broker.service.verify_authorized_bug_bundle", return_value=fake_verified_bundle()):
                asyncio.run(
                    bot.handle_xmtp_text(
                        json.dumps(valid_submission_payload()),
                        sender_address=WALLET,
                        conversation_id="conversation",
                        message_id="dry-run",
                        reply=reply,
                    )
                )

            self.assertIn("Bug index dry-run complete", replies[6])
            self.assertIn("Submission complete", replies[7])
            self.assertFalse(hasattr(signal, "last_message"))
            with store.session() as conn:
                row = conn.execute("SELECT * FROM submissions WHERE xmtp_message_id = ?", ("dry-run",)).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row["status"], "dry_run")
            self.assertTrue(str(row["index_tx_hash"]).startswith("dry-run:publishBug:"))

    def test_access_request_replies_without_signal_support(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            replies: list[str] = []
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite", signal_enabled=False),
                store=store,
                signal=None,
                token=FakeToken(balance=2 * 10**18),
                ipfs=FakeIpfs(),
                bug_index=FakeBugIndex(),
            )

            async def reply(message: str) -> None:
                replies.append(message)

            asyncio.run(
                bot.handle_xmtp_text(
                    '{"type":"access","signal":"+15551234567"}',
                    sender_address=WALLET,
                    conversation_id="conversation",
                    message_id="access-message",
                    reply=reply,
                )
            )

            self.assertIn("Signal is not configured", replies[0])
            self.assertTrue(store.message_seen("access-message"))

    def test_detail_unlock_quote_prices_days_remaining_from_treasury_base_reward(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            report_hash = "0x" + "4" * 64
            store.create_submission(
                command=SubmissionCommand(
                    reporter_address=WALLET,
                    signal_recipient="broker-managed",
                    bug_type="web",
                    title="Title",
                    summary="Public summary",
                    severity="high",
                    target_interest="high",
                    body="Details",
                ),
                xmtp_conversation_id="conversation",
                xmtp_message_id="submission-message",
                signal_group_id="signal-disabled",
                signal_message_timestamp=0,
                review_window_seconds=0,
                status="published",
                bug_bundle=fake_pinned_bundle(
                    IpfsAddResult(
                        cid="bafyfakebugbundle",
                        uri="ipfs://bafyfakebugbundle",
                        name="bugbundle",
                        size=1,
                        sha256="0x" + "2" * 64,
                        gateway_url="https://ipfs.io/ipfs/bafyfakebugbundle",
                    )
                ),
                report_hash=report_hash,
                index_tx_hash="0x" + "a" * 64,
                index_published_at=1_000,
                now=1_000,
            )
            replies: list[str] = []
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite", signal_enabled=False),
                store=store,
                signal=None,
                token=FakeToken(balance=0),
                ipfs=FakeIpfs(),
                bug_index=FakeBugIndex(),
                treasury=FakeTreasury(base_reward=100),
            )

            async def reply(message: str) -> None:
                replies.append(message)

            with patch("cheapbugs_broker.service.time.time", return_value=1_000):
                asyncio.run(
                    bot.handle_xmtp_text(
                        json.dumps(detail_unlock_payload(report_hash=report_hash)),
                        sender_address=WALLET,
                        conversation_id="conversation",
                        message_id="unlock-quote",
                        reply=reply,
                    )
                )

            self.assertIn("Detail unlock quote", replies[-1])
            self.assertIn("price_wei 700", replies[-1])
            self.assertIn("days_remaining 7", replies[-1])
            quote = store.get_detail_unlock_quote("0x" + "3" * 32)
            self.assertIsNotNone(quote)
            assert quote is not None
            self.assertEqual(quote.price_wei, 700)

    def test_detail_unlock_quote_returns_key_when_authenticated_buyer_already_paid(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            report_hash = "0x" + "4" * 64
            store.create_submission(
                command=SubmissionCommand(
                    reporter_address=WALLET,
                    signal_recipient="broker-managed",
                    bug_type="web",
                    title="Title",
                    summary="Public summary",
                    severity="high",
                    target_interest="high",
                    body="Details",
                ),
                xmtp_conversation_id="conversation",
                xmtp_message_id="submission-message",
                signal_group_id="signal-disabled",
                signal_message_timestamp=0,
                review_window_seconds=0,
                status="published",
                bug_bundle=fake_pinned_bundle(
                    IpfsAddResult(
                        cid="bafyfakebugbundle",
                        uri="ipfs://bafyfakebugbundle",
                        name="bugbundle",
                        size=1,
                        sha256="0x" + "2" * 64,
                        gateway_url="https://ipfs.io/ipfs/bafyfakebugbundle",
                    )
                ),
                report_hash=report_hash,
                index_tx_hash="0x" + "a" * 64,
                index_published_at=1_000,
                now=1_000,
            )
            replies: list[str] = []
            treasury = FakeTreasury(base_reward=100, paid_total=700)
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite", signal_enabled=False),
                store=store,
                signal=None,
                token=FakeToken(balance=0),
                ipfs=FakeIpfs(),
                bug_index=FakeBugIndex(),
                treasury=treasury,
            )

            async def reply(message: str) -> None:
                replies.append(message)

            with patch("cheapbugs_broker.service.time.time", return_value=1_000):
                asyncio.run(
                    bot.handle_xmtp_text(
                        json.dumps(detail_unlock_payload(report_hash=report_hash)),
                        sender_address=WALLET,
                        conversation_id="conversation",
                        message_id="unlock-already-paid",
                        reply=reply,
                    )
                )

            self.assertEqual(treasury.payment_lookup, (report_hash, WALLET))
            self.assertIn(f"key {DETAILS_KEY_B64}", replies[-1])
            self.assertTrue(store.message_seen("unlock-already-paid"))
            self.assertIsNone(store.get_detail_unlock_quote("0x" + "3" * 32))

    def test_detail_unlock_paid_verifies_onchain_total_before_releasing_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            report_hash = "0x" + "4" * 64
            request_id = "0x" + "3" * 32
            store.create_submission(
                command=SubmissionCommand(
                    reporter_address=WALLET,
                    signal_recipient="broker-managed",
                    bug_type="web",
                    title="Title",
                    summary="Public summary",
                    severity="high",
                    target_interest="high",
                    body="Details",
                ),
                xmtp_conversation_id="conversation",
                xmtp_message_id="submission-message",
                signal_group_id="signal-disabled",
                signal_message_timestamp=0,
                review_window_seconds=0,
                status="published",
                bug_bundle=fake_pinned_bundle(
                    IpfsAddResult(
                        cid="bafyfakebugbundle",
                        uri="ipfs://bafyfakebugbundle",
                        name="bugbundle",
                        size=1,
                        sha256="0x" + "2" * 64,
                        gateway_url="https://ipfs.io/ipfs/bafyfakebugbundle",
                    )
                ),
                report_hash=report_hash,
                index_tx_hash="0x" + "a" * 64,
                index_published_at=1_000,
                now=1_000,
            )
            store.create_detail_unlock_quote(
                request_id=request_id,
                report_hash=report_hash,
                buyer_address=WALLET,
                price_wei=700,
                days_remaining=7,
                expires_at=2_000,
                now=1_000,
            )
            replies: list[str] = []
            treasury = FakeTreasury(base_reward=100, paid_total=700)
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite", signal_enabled=False),
                store=store,
                signal=None,
                token=FakeToken(balance=0),
                ipfs=FakeIpfs(),
                bug_index=FakeBugIndex(),
                treasury=treasury,
            )

            async def reply(message: str) -> None:
                replies.append(message)

            with patch("cheapbugs_broker.service.time.time", return_value=1_100):
                asyncio.run(
                    bot.handle_xmtp_text(
                        json.dumps(
                            detail_unlock_payload(
                                type="detail_unlock_paid",
                                report_hash=report_hash,
                                tx_hash="0x" + "5" * 64,
                            )
                        ),
                        sender_address=WALLET,
                        conversation_id="conversation",
                        message_id="unlock-paid",
                        reply=reply,
                    )
                )

            self.assertEqual(treasury.verified_tx, "0x" + "5" * 64)
            self.assertIn(f"key {DETAILS_KEY_B64}", replies[-1])
            quote = store.get_detail_unlock_quote(request_id)
            self.assertIsNotNone(quote)
            assert quote is not None
            self.assertEqual(quote.paid_tx_hash, "0x" + "5" * 64)

    def test_detail_unlock_paid_rejects_underpayment_without_releasing_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            report_hash = "0x" + "4" * 64
            store.create_submission(
                command=SubmissionCommand(
                    reporter_address=WALLET,
                    signal_recipient="broker-managed",
                    bug_type="web",
                    title="Title",
                    summary="Public summary",
                    severity="high",
                    target_interest="high",
                    body="Details",
                ),
                xmtp_conversation_id="conversation",
                xmtp_message_id="submission-message",
                signal_group_id="signal-disabled",
                signal_message_timestamp=0,
                review_window_seconds=0,
                status="published",
                bug_bundle=fake_pinned_bundle(
                    IpfsAddResult(
                        cid="bafyfakebugbundle",
                        uri="ipfs://bafyfakebugbundle",
                        name="bugbundle",
                        size=1,
                        sha256="0x" + "2" * 64,
                        gateway_url="https://ipfs.io/ipfs/bafyfakebugbundle",
                    )
                ),
                report_hash=report_hash,
                index_tx_hash="0x" + "a" * 64,
                index_published_at=1_000,
                now=1_000,
            )
            store.create_detail_unlock_quote(
                request_id="0x" + "3" * 32,
                report_hash=report_hash,
                buyer_address=WALLET,
                price_wei=700,
                days_remaining=7,
                expires_at=2_000,
                now=1_000,
            )
            replies: list[str] = []
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite", signal_enabled=False),
                store=store,
                signal=None,
                token=FakeToken(balance=0),
                ipfs=FakeIpfs(),
                bug_index=FakeBugIndex(),
                treasury=FakeTreasury(base_reward=100, paid_total=699),
            )

            async def reply(message: str) -> None:
                replies.append(message)

            with patch("cheapbugs_broker.service.time.time", return_value=1_100):
                asyncio.run(
                    bot.handle_xmtp_text(
                        json.dumps(
                            detail_unlock_payload(
                                type="detail_unlock_paid",
                                report_hash=report_hash,
                                tx_hash="0x" + "5" * 64,
                            )
                        ),
                        sender_address=WALLET,
                        conversation_id="conversation",
                        message_id="unlock-underpaid",
                        reply=reply,
                    )
                )

            self.assertIn("below the quoted price", replies[-1])
            self.assertNotIn("Detail key", replies[-1])


def valid_submission_payload(**overrides: object) -> dict[str, object]:
    bug_bundle = fake_bug_bundle(
        reporter=WALLET,
        broker=BROKER,
        bug_type="0day",
        severity="high",
        target_interest="critical",
        title="Parser overflow",
        public_summary="Public safe summary for reviewers.",
        target={"kind": "repo", "reference": "pierce403/cheapbugs"},
        tags=["parser", "memory"],
    )
    payload: dict[str, object] = {
        "schema": "cheapbugs.bug_submission.v1",
        "type": "submission",
        "version": 1,
        "reporter_address": WALLET,
        "broker_address": BROKER,
        "signal_recipient": "+15551234567",
        "bug_type": "0day",
        "title": "Parser overflow",
        "public_summary": "Public safe summary for reviewers.",
        "severity": "high",
        "target_interest": "critical",
        "target": {"kind": "repo", "reference": "pierce403/cheapbugs"},
        "disclosure_mode": "private",
        "tags": ["parser", "memory"],
        "bug_bundle": bug_bundle,
        "publish_authorization": fake_publish_authorization(bug_bundle["core"]),
        "details_key": DETAILS_KEY_B64,
        "client": {"name": "cheapbugs-web", "sent_at": "2026-05-17T00:00:00.000Z"},
    }
    payload.update(overrides)
    return payload


def detail_unlock_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "schema": "cheapbugs.detail_unlock.v1",
        "type": "detail_unlock_quote",
        "version": 1,
        "request_id": "0x" + "3" * 32,
        "buyer_address": WALLET,
        "broker_address": BROKER,
        "chain_id": 8453,
        "bug_index": WALLET,
        "treasury_vault": BROKER,
        "report_hash": "0x" + "4" * 64,
        "client": {"name": "cheapbugs-web", "sent_at": "2026-05-17T00:00:00.000Z"},
    }
    payload.update(overrides)
    return payload


def minimal_submission_payload(**overrides: object) -> dict[str, object]:
    bug_bundle = fake_bug_bundle(
        reporter=WALLET,
        broker=BROKER,
        bug_type="web",
        severity="medium",
        target_interest="high",
        title="Parser overflow",
        public_summary="Public safe summary for reviewers.",
    )
    payload: dict[str, object] = {
        "schema": "cheapbugs.bug_submission.v1",
        "type": "submission",
        "version": 1,
        "reporter_address": WALLET,
        "broker_address": BROKER,
        "bug_type": "web",
        "title": "Parser overflow",
        "public_summary": "Public safe summary for reviewers.",
        "severity": "medium",
        "target_interest": "high",
        "bug_bundle": bug_bundle,
        "publish_authorization": fake_publish_authorization(bug_bundle["core"]),
        "details_key": DETAILS_KEY_B64,
        "client": {"name": "cheapbugs-web", "sent_at": "2026-05-17T00:00:00.000Z"},
    }
    payload.update(overrides)
    return payload


def canonicalize(value: object) -> object:
    if isinstance(value, list):
        return [canonicalize(item) for item in value]
    if isinstance(value, dict):
        return {key: canonicalize(value[key]) for key in sorted(value) if value[key] is not None}
    return value


def canonical_sha256(value: object) -> str:
    canonical = json.dumps(canonicalize(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return f"0x{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def b64url(value: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def fake_bug_bundle(
    *,
    reporter: str = WALLET,
    broker: str = BROKER,
    bug_type: str = "0day",
    severity: str = "high",
    target_interest: str = "critical",
    title: str = "Parser overflow",
    public_summary: str = "Public safe summary for reviewers.",
    target: dict[str, str] | None = None,
    tags: list[str] | None = None,
) -> dict[str, object]:
    target = target or {"kind": "other", "reference": "broker triage"}
    tags = tags or []
    aad_object = {
        "schema": BUG_BUNDLE_SCHEMA,
        "version": BUG_BUNDLE_VERSION,
        "type": "publisher_submission",
        "reporter": reporter,
        "broker": broker,
        "chain_id": 8453,
        "bug_index": WALLET,
        "created_at": "2026-05-17T00:00:00.000Z",
        "reveal_after": "2026-05-24T00:00:00.000Z",
        "submission": {
            "bug_type": bug_type,
            "severity": severity,
            "target_interest": target_interest,
            "title": title,
            "public_summary": public_summary,
            "target": target,
            "disclosure_mode": "private",
            "tags": tags,
        },
    }
    ciphertext = b"fake-ciphertext"
    core = {
        **aad_object,
        "details": {
            "encrypted": True,
            "alg": "AES-256-GCM",
            "iv": b64url(bytes(range(12))),
            "aad": b64url(canonical_json_bytes(aad_object)),
            "ciphertext": b64url(ciphertext),
        },
        "commitments": {
            "encrypted_details_sha256": f"0x{hashlib.sha256(ciphertext).hexdigest()}",
            "details_key_commitment": f"0x{hashlib.sha256(DETAILS_KEY).hexdigest()}",
            "details_key_commitment_alg": "sha256",
        },
    }
    return {
        "schema": BUG_BUNDLE_SCHEMA,
        "version": BUG_BUNDLE_VERSION,
        "core": core,
    }


def fake_publish_authorization(core: object) -> dict[str, object]:
    assert isinstance(core, dict)
    commitments = core["commitments"]
    assert isinstance(commitments, dict)
    return {
        "scheme": PUBLISH_AUTHORIZATION_SCHEME,
        "signer": core["reporter"],
        "domain": {
            "name": "CheapBugsBugIndex",
            "version": "1",
            "chainId": 8453,
            "verifyingContract": WALLET,
        },
        "types": PUBLISH_BUG_TYPES,
        "primaryType": "PublishBug",
        "message": {
            "reportHash": "0x" + "1" * 64,
            "reportIdHash": "0x" + "2" * 64,
            "reporter": core["reporter"],
            "createdAt": 1778976000,
            "disclosureMode": 0,
            "publicSummaryHash": "0x" + "3" * 64,
            "targetKind": 5,
            "targetRefHash": "0x" + "4" * 64,
            "tagsHash": "0x" + "5" * 64,
            "contentHash": "0x" + "6" * 64,
            "bugBundleHash": canonical_sha256(core),
            "encryptedDetailsHash": commitments["encrypted_details_sha256"],
            "detailsKeyCommitment": commitments["details_key_commitment"],
            "revealAfter": 1779580800,
            "nonce": 7,
            "deadline": 1779062400,
            "broker": core["broker"],
        },
        "value": "0x" + "1" * 130,
    }


def fake_verified_bundle(payload: dict[str, object] | None = None) -> VerifiedBugBundle:
    bundle = payload or fake_bug_bundle()
    auth = fake_publish_authorization(bundle["core"])
    return VerifiedBugBundle(
        payload=bundle,
        details_key_b64=DETAILS_KEY_B64,
        publish_authorization=auth,
        report_hash=str(auth["message"]["reportHash"]),
        details_key_commitment=f"0x{hashlib.sha256(DETAILS_KEY).hexdigest()}",
        encrypted_details_hash="0x" + "2" * 64,
        details="Private details go here.",
        repro_steps="Run the attached proof of concept.",
        evidence="Crash trace",
        contact_hints="",
    )


def real_signed_submission_payload(reporter: str, account: object, aesgcm_cls: object) -> dict[str, object]:
    from eth_account.messages import encode_typed_data
    from eth_utils import keccak

    target = {"kind": "repo", "reference": "pierce403/cheapbugs"}
    submission = {
        "bug_type": "0day",
        "severity": "high",
        "target_interest": "critical",
        "title": "Parser overflow",
        "public_summary": "Public safe summary for reviewers.",
        "target": target,
        "disclosure_mode": "private",
        "tags": ["parser", "memory"],
    }
    aad_object = {
        "schema": BUG_BUNDLE_SCHEMA,
        "version": BUG_BUNDLE_VERSION,
        "type": "publisher_submission",
        "reporter": reporter,
        "broker": BROKER,
        "chain_id": 8453,
        "bug_index": WALLET,
        "created_at": "2026-05-17T00:00:00.000Z",
        "reveal_after": "2026-05-24T00:00:00.000Z",
        "submission": submission,
    }
    aad = canonical_json_bytes(aad_object)
    iv = bytes(range(12))
    details_plaintext = canonical_json_bytes(
        {
            "details": "Private details go here.",
            "repro_steps": "Run the attached proof of concept.",
            "evidence": "Crash trace",
            "contact_hints": "",
        }
    )
    ciphertext = aesgcm_cls(DETAILS_KEY).encrypt(iv, details_plaintext, aad)
    core = {
        **aad_object,
        "details": {
            "encrypted": True,
            "alg": "AES-256-GCM",
            "iv": b64url(iv),
            "aad": b64url(aad),
            "ciphertext": b64url(ciphertext),
        },
        "commitments": {
            "encrypted_details_sha256": f"0x{hashlib.sha256(ciphertext).hexdigest()}",
            "details_key_commitment": f"0x{hashlib.sha256(DETAILS_KEY).hexdigest()}",
            "details_key_commitment_alg": "sha256",
        },
    }
    core_sha256 = canonical_sha256(core)
    report_hash = f"0x{keccak(canonical_json_bytes({
        'reporter': core['reporter'],
        'broker': core['broker'],
        'chain_id': core['chain_id'],
        'bug_index': core['bug_index'],
        'created_at': core['created_at'],
        'reveal_after': core['reveal_after'],
        'submission': submission,
        'encrypted_details_sha256': core['commitments']['encrypted_details_sha256'],
        'details_key_commitment': core['commitments']['details_key_commitment'],
    })).hex()}"
    report_id = f"cb-{report_hash[2:10]}"
    content_hash = f"0x{keccak(canonical_json_bytes({
        'submission': submission,
        'encrypted_details_sha256': core['commitments']['encrypted_details_sha256'],
        'details_key_commitment': core['commitments']['details_key_commitment'],
    })).hex()}"
    message = {
        "reportHash": report_hash,
        "reportIdHash": f"0x{keccak(text=report_id).hex()}",
        "reporter": reporter,
        "createdAt": 1778976000,
        "disclosureMode": 0,
        "publicSummaryHash": f"0x{keccak(text=submission['public_summary']).hex()}",
        "targetKind": 0,
        "targetRefHash": f"0x{keccak(text=target['reference'].lower()).hex()}",
        "tagsHash": f"0x{keccak(text=','.join(submission['tags'])).hex()}",
        "contentHash": content_hash,
        "bugBundleHash": core_sha256,
        "encryptedDetailsHash": core["commitments"]["encrypted_details_sha256"],
        "detailsKeyCommitment": core["commitments"]["details_key_commitment"],
        "revealAfter": 1779580800,
        "nonce": 42,
        "deadline": 1779062400,
        "broker": BROKER,
    }
    domain = {
        "name": "CheapBugsBugIndex",
        "version": "1",
        "chainId": 8453,
        "verifyingContract": WALLET,
    }
    signed = account.sign_message(
        encode_typed_data(
            full_message={
                "domain": domain,
                "types": PUBLISH_BUG_TYPES,
                "primaryType": "PublishBug",
                "message": message,
            }
        )
    )
    return {
        "schema": "cheapbugs.bug_submission.v1",
        "type": "submission",
        "version": 1,
        "reporter_address": reporter,
        "broker_address": BROKER,
        "signal_recipient": "+15551234567",
        **submission,
        "bug_bundle": {
            "schema": BUG_BUNDLE_SCHEMA,
            "version": BUG_BUNDLE_VERSION,
            "core": core,
        },
        "publish_authorization": {
            "scheme": PUBLISH_AUTHORIZATION_SCHEME,
            "signer": reporter,
            "domain": domain,
            "types": PUBLISH_BUG_TYPES,
            "primaryType": "PublishBug",
            "message": message,
            "value": "0x" + signed.signature.hex().removeprefix("0x"),
        },
        "details_key": DETAILS_KEY_B64,
        "client": {"name": "cheapbugs-web", "sent_at": "2026-05-17T00:00:00.000Z"},
    }


def test_config(
    path: Path,
    signal_enabled: bool = True,
    dry_run: bool = True,
    submission_min_balance_tokens: Decimal = Decimal("0"),
) -> BrokerConfig:
    return BrokerConfig(
        database_path=path,
        log_path=Path("broker.log"),
        xmtp_env="production",
        xmtp_db_path=None,
        broker_key="0xabc",
        signal_cli_path="signal-cli" if signal_enabled else "",
        signal_account="+15550000000" if signal_enabled else "",
        signal_group_id="group" if signal_enabled else "",
        base_rpc_url="http://localhost:8545",
        bugz_token_address=WALLET,
        chain_id=8453,
        bug_index_address=WALLET,
        treasury_vault_address=BROKER,
        ipfs_api_url="http://127.0.0.1:5001",
        ipfs_gateway_url="https://ipfs.io/ipfs",
        ipfs_prime_gateway=False,
        ipfs_timeout_seconds=10,
        access_min_balance_tokens=Decimal("1"),
        submission_min_balance_tokens=submission_min_balance_tokens,
        reputation_blocklist=frozenset(),
        reward_base_tokens=Decimal("0"),
        reward_base_tokens_configured=False,
        reward_per_reaction_tokens=Decimal("100"),
        reward_max_tokens=Decimal("5000"),
        review_window_seconds=7,
        poll_seconds=30,
        dry_run=dry_run,
        tx_receipt_timeout_seconds=120,
    )


class FakeToken:
    def __init__(self, balance: int):
        self.balance = balance
        self.transfers: list[tuple[str, int]] = []

    def decimals(self) -> int:
        return 18

    def balance_of(self, address: str) -> int:
        self.last_balance_address = address
        return self.balance

    def transfer(self, to_address: str, amount_wei: int) -> str:
        self.transfers.append((to_address, amount_wei))
        return f"dry-run:transfer:{to_address}:{amount_wei}"


@dataclass(frozen=True)
class FakeSentMessage:
    sent_timestamp: int


class FakeSignal:
    def __init__(self) -> None:
        self.messages: list[str] = []

    def send_group_message(self, message: str) -> FakeSentMessage:
        self.last_message = message
        self.messages.append(message)
        return FakeSentMessage(sent_timestamp=1760000000123)

    def add_group_member(self, recipient: str) -> None:
        self.last_member = recipient


class FakeIpfs:
    def __init__(self):
        self.last_payload: object | None = None
        self.last_name = ""
        self.primed_cid = ""

    def add_json(self, payload: object, name: str) -> IpfsAddResult:
        self.last_payload = payload
        self.last_name = name
        raw = json.dumps(payload)
        if "Private details go here." in raw:
            raise AssertionError("BugBundle payload must not contain plaintext private details.")
        return IpfsAddResult(
            cid="bafyfakebugbundle",
            uri="ipfs://bafyfakebugbundle",
            name=name,
            size=len(raw),
            sha256="0x" + "2" * 64,
            gateway_url="https://ipfs.io/ipfs/bafyfakebugbundle",
        )

    def prime_gateway(self, cid: str) -> bool:
        self.primed_cid = cid
        return False


def fake_pinned_bundle(added: IpfsAddResult) -> object:
    return type(
        "FakePinnedBundle",
        (),
        {
            "cid": added.cid,
            "uri": added.uri,
            "gateway_url": added.gateway_url,
            "sha256": added.sha256,
            "details_key_b64": DETAILS_KEY_B64,
            "details_key_commitment": f"0x{hashlib.sha256(DETAILS_KEY).hexdigest()}",
            "encrypted_details_hash": "0x" + "2" * 64,
            "pinned_at": 100,
        },
    )()


class FakeBugIndex:
    def __init__(
        self,
        *,
        dry_run: bool = False,
        error: Exception | None = None,
        report_status: int = 1,
        reveal_after: int = 0,
        details_key_commitment: str | None = None,
    ):
        self.dry_run = dry_run
        self.error = error
        self._report_status = report_status
        self._reveal_after = reveal_after
        self._details_key_commitment = details_key_commitment or f"0x{hashlib.sha256(DETAILS_KEY).hexdigest()}"
        self.last_command: SubmissionCommand | None = None
        self.last_bundle: object | None = None
        self.completed_payouts: list[tuple[str, int, bytes]] = []

    def publish_bug(self, command: SubmissionCommand, verified: VerifiedBugBundle, bug_bundle: object) -> BugIndexPublishResult:
        self.last_command = command
        self.last_bundle = bug_bundle
        if self.error is not None:
            raise self.error
        return BugIndexPublishResult(
            report_hash=verified.report_hash,
            tx_hash=f"dry-run:publishBug:{verified.report_hash}" if self.dry_run else "0x" + "a" * 64,
            dry_run=self.dry_run,
            block_number=None if self.dry_run else 12345,
            index_address=WALLET,
        )

    def complete_payout(self, report_hash: str, multiplier: int, details_key: bytes) -> str:
        self.completed_payouts.append((report_hash, multiplier, details_key))
        if self.error is not None:
            raise self.error
        return "0x" + "b" * 64

    def report_status(self, report_hash: str) -> int:
        if self.error is not None:
            raise self.error
        self.last_status_report_hash = report_hash
        return self._report_status

    def report_reveal_after(self, report_hash: str) -> int:
        if self.error is not None:
            raise self.error
        self.last_reveal_after_report_hash = report_hash
        return self._reveal_after

    def report_details_key_commitment(self, report_hash: str) -> str:
        if self.error is not None:
            raise self.error
        self.last_details_key_commitment_report_hash = report_hash
        return self._details_key_commitment


class FakeTreasury:
    def __init__(self, *, base_reward: int, paid_total: int = 0):
        self._base_reward = base_reward
        self._paid_total = paid_total
        self.verified_tx = ""
        self.payment_lookup: tuple[str, str] | None = None

    def reward_amount(self, multiplier: int) -> int:
        return self._base_reward * multiplier

    def base_reward(self) -> int:
        return self.reward_amount(1)

    def verify_successful_payment_tx(self, tx_hash: str, buyer_address: str) -> None:
        self.verified_tx = tx_hash
        self.verified_buyer = buyer_address

    def detail_key_payment_total(self, report_hash: str, buyer_address: str) -> int:
        self.payment_lookup = (report_hash, buyer_address)
        return self._paid_total


class FakeWeb3:
    def to_checksum_address(self, address: str) -> str:
        if address == "0x7ab874eeef0169ada0d225e9801a3ffffa26aac3":
            return "0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3"
        raise ValueError(f"unexpected address: {address}")


class FakePublishWeb3:
    def __init__(self) -> None:
        self.eth = FakeEth()

    def to_checksum_address(self, address: str) -> str:
        normalized = address.lower()
        if normalized == "0x7ab874eeef0169ada0d225e9801a3ffffa26aac3":
            return "0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3"
        if normalized == BROKER:
            return BROKER
        if normalized == WALLET:
            return WALLET
        raise ValueError(f"unexpected address: {address}")

    def to_hex(self, value: bytes) -> str:
        return "0x" + value.hex()


class FakeEth:
    chain_id = 8453
    gas_price = 1

    def get_balance(self, address: str) -> int:
        return 1_000_000

    def get_transaction_count(self, address: str) -> int:
        return 4

    def send_raw_transaction(self, raw_tx: bytes) -> bytes:
        self.raw_tx = raw_tx
        return bytes.fromhex("a" * 64)

    def wait_for_transaction_receipt(self, tx_hash: str, timeout: int) -> dict[str, int]:
        return {"status": 1, "blockNumber": 12345}


class FakeAccount:
    def __init__(self, address: str) -> None:
        self.address = address

    def sign_transaction(self, tx: dict[str, object]) -> object:
        return type("FakeSignedTransaction", (), {"raw_transaction": b"signed"})()


class FakeBugIndexContract:
    def __init__(self, gas_error: Exception | None = None) -> None:
        self.gas_error = gas_error
        self.publish_function: FakePublishFunction | None = None
        self.functions = FakeBugIndexFunctions(self)


class FakeBugIndexFunctions:
    def __init__(self, contract: FakeBugIndexContract) -> None:
        self.contract = contract

    def exists(self, report_hash: str) -> object:
        return FakeCall(False)

    def brokers(self, broker_address: str) -> object:
        return FakeCall(True)

    def publishBug(self, bug_input: tuple[object, ...], nonce: int, deadline: int, signature: str) -> object:
        self.contract.publish_function = FakePublishFunction(
            bug_input,
            nonce,
            deadline,
            signature,
            gas_error=self.contract.gas_error,
        )
        return self.contract.publish_function


class FakeCall:
    def __init__(self, value: bool) -> None:
        self.value = value

    def call(self) -> bool:
        return self.value


class FakePublishFunction:
    def __init__(
        self,
        bug_input: tuple[object, ...],
        nonce: int,
        deadline: int,
        signature: str,
        *,
        gas_error: Exception | None = None,
    ) -> None:
        self.bug_input = bug_input
        self.nonce = nonce
        self.deadline = deadline
        self.signature = signature
        self.gas_error = gas_error

    def estimate_gas(self, tx: dict[str, object]) -> int:
        if self.gas_error is not None:
            raise self.gas_error
        if self.bug_input[2] != "0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3":
            raise ValueError("reporter was not checksummed")
        return 100_000

    def build_transaction(self, tx: dict[str, object]) -> dict[str, object]:
        return tx


if __name__ == "__main__":
    unittest.main()
