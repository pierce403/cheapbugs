from __future__ import annotations

import asyncio
import hashlib
import json
import tempfile
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
from cheapbugs_broker.bug_index import BugIndexPublishError, BugIndexPublishResult, build_publish_bug_call_args
from cheapbugs_broker.commands import CommandError, parse_command, validate_submission_target
from cheapbugs_broker.config import BrokerConfig
from cheapbugs_broker.ipfs import IpfsAddResult
from cheapbugs_broker.models import SignalReactionEvent, SubmissionCommand
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
        self.assertEqual(deadline, 1768694400)
        self.assertTrue(signature.startswith("0x"))


class BrokerServiceTest(unittest.TestCase):
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

    def test_submission_stops_when_credentials_fail(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = BrokerStore(Path(tmp) / "broker.sqlite")
            store.init()
            replies: list[str] = []
            bot = BrokerBot(
                config=test_config(Path(tmp) / "broker.sqlite"),
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
            bot = BrokerBot(
                config=config,
                store=store,
                signal=None,
                token=FakeToken(balance=2 * 10**18),
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
            "createdAt": 1768608000,
            "disclosureMode": 0,
            "publicSummaryHash": "0x" + "3" * 64,
            "targetKind": 5,
            "targetRefHash": "0x" + "4" * 64,
            "tagsHash": "0x" + "5" * 64,
            "contentHash": "0x" + "6" * 64,
            "bugBundleHash": canonical_sha256(core),
            "encryptedDetailsHash": commitments["encrypted_details_sha256"],
            "detailsKeyCommitment": commitments["details_key_commitment"],
            "revealAfter": 1769212800,
            "nonce": 7,
            "deadline": 1768694400,
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
        "createdAt": 1768608000,
        "disclosureMode": 0,
        "publicSummaryHash": f"0x{keccak(text=submission['public_summary']).hex()}",
        "targetKind": 0,
        "targetRefHash": f"0x{keccak(text=target['reference'].lower()).hex()}",
        "tagsHash": f"0x{keccak(text=','.join(submission['tags'])).hex()}",
        "contentHash": content_hash,
        "bugBundleHash": core_sha256,
        "encryptedDetailsHash": core["commitments"]["encrypted_details_sha256"],
        "detailsKeyCommitment": core["commitments"]["details_key_commitment"],
        "revealAfter": 1769212800,
        "nonce": 42,
        "deadline": 1768694400,
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


def test_config(path: Path, signal_enabled: bool = True) -> BrokerConfig:
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
        ipfs_api_url="http://127.0.0.1:5001",
        ipfs_gateway_url="https://ipfs.io/ipfs",
        ipfs_prime_gateway=False,
        ipfs_timeout_seconds=10,
        access_min_balance_tokens=Decimal("1"),
        submission_min_balance_tokens=Decimal("1"),
        reputation_blocklist=frozenset(),
        reward_base_tokens=Decimal("0"),
        reward_per_reaction_tokens=Decimal("100"),
        reward_max_tokens=Decimal("5000"),
        review_window_seconds=7,
        poll_seconds=30,
        dry_run=True,
        tx_receipt_timeout_seconds=120,
    )


class FakeToken:
    def __init__(self, balance: int):
        self.balance = balance

    def decimals(self) -> int:
        return 18

    def balance_of(self, address: str) -> int:
        self.last_balance_address = address
        return self.balance

    def transfer(self, to_address: str, amount_wei: int) -> str:
        return f"dry-run:transfer:{to_address}:{amount_wei}"


@dataclass(frozen=True)
class FakeSentMessage:
    sent_timestamp: int


class FakeSignal:
    def send_group_message(self, message: str) -> FakeSentMessage:
        self.last_message = message
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
    def __init__(self, *, dry_run: bool = False, error: Exception | None = None):
        self.dry_run = dry_run
        self.error = error
        self.last_command: SubmissionCommand | None = None
        self.last_bundle: object | None = None

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


if __name__ == "__main__":
    unittest.main()
