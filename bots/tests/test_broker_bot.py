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

from cheapbugs_broker.commands import (
    SUBMISSION_SIGNATURE_SCHEME,
    CommandError,
    build_submission_signature_message,
    parse_command,
    validate_submission_target,
    verify_submission_signature,
)
from cheapbugs_broker.config import BrokerConfig
from cheapbugs_broker.ipfs import IpfsAddResult
from cheapbugs_broker.models import SignalReactionEvent, SubmissionCommand
from cheapbugs_broker.rewards import reward_tokens, tokens_to_wei
from cheapbugs_broker.service import BrokerBot
from cheapbugs_broker.signal_cli import extract_reaction_events, parse_signal_timestamp
from cheapbugs_broker.store import BrokerStore


WALLET = "0x1111111111111111111111111111111111111111"
BROKER = "0x2222222222222222222222222222222222222222"


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
        self.assertIsNotNone(command.signature)
        self.assertEqual(command.signature.signer, WALLET)

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
        del payload["details"]

        with self.assertRaisesRegex(CommandError, "details"):
            parse_command(json.dumps(payload))

    def test_reject_signature_payload_hash_mismatch(self) -> None:
        payload = valid_submission_payload()
        signature = dict(payload["signature"])
        signature["payload_sha256"] = "0x" + "9" * 64
        payload["signature"] = signature

        with self.assertRaisesRegex(CommandError, "payload hash"):
            parse_command(json.dumps(payload))

    def test_verify_real_eip191_submission_signature(self) -> None:
        try:
            from eth_account import Account
            from eth_account.messages import encode_defunct
        except ImportError:
            self.skipTest("eth_account is only installed in the broker runtime environment")

        account = Account.from_key("0x" + "1" * 64)
        payload = valid_submission_payload(reporter_address=str(account.address).lower())
        unsigned_payload = {key: value for key, value in payload.items() if key != "signature"}
        payload_sha256 = canonical_sha256(unsigned_payload)
        message = build_submission_signature_message(unsigned_payload, payload_sha256)
        signed = account.sign_message(encode_defunct(text=message))
        payload["signature"] = {
            "scheme": SUBMISSION_SIGNATURE_SCHEME,
            "signer": str(account.address).lower(),
            "payload_sha256": payload_sha256,
            "message": message,
            "value": "0x" + signed.signature.hex().removeprefix("0x"),
        }

        command = parse_command(json.dumps(payload))

        self.assertIsInstance(command, SubmissionCommand)
        verify_submission_signature(command)

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
            )

            async def reply(_message: str) -> None:
                return None

            with self.assertLogs("cheapbugs_broker.service", level="INFO") as logs:
                with patch("cheapbugs_broker.service.verify_submission_signature", return_value=None):
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
        self.assertIn("Private details go here.", output)

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
            )

            async def reply(message: str) -> None:
                replies.append(message)

            with patch("cheapbugs_broker.service.verify_submission_signature", return_value=None):
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
            self.assertEqual(replies[2], "Submission reporter signature is valid.")
            self.assertIn("Submission target is valid", replies[3])
            self.assertIn("Submission credentials are valid", replies[4])
            self.assertIn("Encrypted BugBundle pinned to IPFS", replies[5])
            self.assertIn("Submission relayed", replies[6])
            self.assertIn("BugBundle: ipfs://bafyfakebugbundle", signal.last_message)

    def test_submission_stops_when_signature_fails(self) -> None:
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
            )

            async def reply(message: str) -> None:
                replies.append(message)

            with patch(
                "cheapbugs_broker.service.verify_submission_signature",
                side_effect=CommandError("signature does not recover"),
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

            self.assertIn("Submission reporter signature is invalid", replies[-1])
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
            )

            async def reply(message: str) -> None:
                replies.append(message)

            with patch("cheapbugs_broker.service.verify_submission_signature", return_value=None):
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
            )

            async def reply(message: str) -> None:
                replies.append(message)

            with patch("cheapbugs_broker.service.verify_submission_signature", return_value=None):
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
            self.assertIn("Signal is not configured", replies[6])
            self.assertTrue(store.message_seen("message"))
            with store.session() as conn:
                row = conn.execute("SELECT * FROM submissions WHERE xmtp_message_id = ?", ("message",)).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row["bundle_cid"], "bafyfakebugbundle")
            self.assertEqual(row["bundle_uri"], "ipfs://bafyfakebugbundle")
            self.assertTrue(str(row["details_key_b64"]))
            self.assertTrue(str(row["details_key_commitment"]).startswith("0x"))
            self.assertIsNotNone(ipfs.last_payload)
            assert isinstance(ipfs.last_payload, dict)
            self.assertEqual(ipfs.last_payload["broker_status"]["reporter_signature"], "verified")
            self.assertEqual(ipfs.last_payload["signature"]["scheme"], SUBMISSION_SIGNATURE_SCHEME)
            self.assertEqual(ipfs.last_payload["signature"]["signer"], WALLET)
            records = store.mature_unpaid_submissions(now=10_000)
            self.assertEqual(records, [])

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
        "details": "Private details go here.",
        "repro_steps": "Run the attached proof of concept.",
        "evidence": "Crash trace",
        "severity": "high",
        "target_interest": "critical",
        "target": {"kind": "repo", "reference": "pierce403/cheapbugs"},
        "disclosure_mode": "private",
        "tags": ["parser", "memory"],
        "contact_hints": "",
        "client": {"name": "cheapbugs-web", "sent_at": "2026-05-17T00:00:00.000Z"},
    }
    payload.update(overrides)
    payload["signature"] = submission_signature(payload)
    return payload


def minimal_submission_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "schema": "cheapbugs.bug_submission.v1",
        "type": "submission",
        "version": 1,
        "reporter_address": WALLET,
        "broker_address": BROKER,
        "bug_type": "web",
        "title": "Parser overflow",
        "public_summary": "Public safe summary for reviewers.",
        "details": "Private details go here.",
        "severity": "medium",
        "target_interest": "high",
        "client": {"name": "cheapbugs-web", "sent_at": "2026-05-17T00:00:00.000Z"},
    }
    payload.update(overrides)
    payload["signature"] = submission_signature(payload)
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


def submission_signature(payload: dict[str, object]) -> dict[str, str]:
    unsigned_payload = {key: value for key, value in payload.items() if key != "signature"}
    payload_sha256 = canonical_sha256(unsigned_payload)
    return {
        "scheme": SUBMISSION_SIGNATURE_SCHEME,
        "signer": str(unsigned_payload["reporter_address"]).lower(),
        "payload_sha256": payload_sha256,
        "message": build_submission_signature_message(unsigned_payload, payload_sha256),
        "value": "0x" + "1" * 130,
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


if __name__ == "__main__":
    unittest.main()
