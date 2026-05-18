"""CheapBugsBugIndex publishing adapter for broker-accepted submissions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .models import PinnedBugBundle, SubmissionCommand


BUG_INDEX_ABI = [
    {
        "name": "brokers",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "", "type": "address"}],
        "outputs": [{"name": "", "type": "bool"}],
    },
    {
        "name": "exists",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "", "type": "bytes32"}],
        "outputs": [{"name": "", "type": "bool"}],
    },
    {
        "name": "publishBug",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {
                "name": "input",
                "type": "tuple",
                "components": [
                    {"name": "reportHash", "type": "bytes32"},
                    {"name": "reportId", "type": "string"},
                    {"name": "reporter", "type": "address"},
                    {"name": "createdAt", "type": "uint64"},
                    {"name": "disclosureMode", "type": "uint8"},
                    {"name": "publicSummary", "type": "string"},
                    {"name": "bugBundleCid", "type": "string"},
                    {"name": "targetKind", "type": "uint8"},
                    {"name": "targetRefHash", "type": "bytes32"},
                    {"name": "tags", "type": "string"},
                    {"name": "contentHash", "type": "bytes32"},
                    {"name": "bugBundleHash", "type": "bytes32"},
                    {"name": "encryptedDetailsHash", "type": "bytes32"},
                    {"name": "detailsKeyCommitment", "type": "bytes32"},
                    {"name": "revealAfter", "type": "uint64"},
                ],
            },
            {"name": "nonce", "type": "uint256"},
            {"name": "deadline", "type": "uint64"},
            {"name": "reporterSignature", "type": "bytes"},
        ],
        "outputs": [],
    },
]


@dataclass(frozen=True)
class BugIndexPublishResult:
    report_hash: str
    tx_hash: str
    dry_run: bool = False
    already_published: bool = False
    block_number: int | None = None
    index_address: str = ""


class BugIndexPublishError(RuntimeError):
    pass


class BugIndexClient:
    def __init__(
        self,
        rpc_url: str,
        index_address: str,
        broker_key: str,
        chain_id: int,
        *,
        dry_run: bool = False,
        receipt_timeout_seconds: int = 120,
    ):
        self.rpc_url = rpc_url
        self.index_address = index_address
        self.broker_key = broker_key
        self.chain_id = chain_id
        self.dry_run = dry_run
        self.receipt_timeout_seconds = receipt_timeout_seconds
        self._web3 = None
        self._contract = None
        self._account = None

    @property
    def web3(self):
        if self._web3 is None:
            try:
                from web3 import Web3
            except ImportError as exc:
                raise BugIndexPublishError("Install broker dependencies with: pip install -r requirements-broker.txt") from exc
            self._web3 = Web3(Web3.HTTPProvider(self.rpc_url))
        return self._web3

    @property
    def contract(self):
        if self._contract is None:
            if not self.index_address:
                raise BugIndexPublishError("BROKER_BUG_INDEX_ADDRESS or VITE_BUG_INDEX_ADDRESS is required for bug-index publishing.")
            self._contract = self.web3.eth.contract(
                address=self.web3.to_checksum_address(self.index_address),
                abi=BUG_INDEX_ABI,
            )
        return self._contract

    @property
    def account(self):
        if self._account is None:
            if not self.broker_key:
                raise BugIndexPublishError("BROKER_KEY is required for bug-index publishing.")
            self._account = self.web3.eth.account.from_key(self.broker_key)
        return self._account

    def publish_bug(
        self,
        command: SubmissionCommand,
        verified: Any,
        bug_bundle: PinnedBugBundle,
    ) -> BugIndexPublishResult:
        bug_input, nonce, deadline, signature = build_publish_bug_call_args(command, verified, bug_bundle)
        report_hash = str(bug_input[0])

        if not self.index_address:
            raise BugIndexPublishError("BROKER_BUG_INDEX_ADDRESS or VITE_BUG_INDEX_ADDRESS is required for bug-index publishing.")
        if self.dry_run:
            return BugIndexPublishResult(
                report_hash=report_hash,
                tx_hash=f"dry-run:publishBug:{report_hash}",
                dry_run=True,
                index_address=self.index_address,
            )

        account = self.account
        try:
            chain_id = int(self.web3.eth.chain_id)
        except Exception as exc:
            raise BugIndexPublishError(f"Could not read Base chain id from RPC {self.rpc_url}: {_rpc_error(exc)}") from exc
        if chain_id != self.chain_id:
            raise BugIndexPublishError(f"RPC chain id mismatch: expected {self.chain_id}, got {chain_id}. Check BASE_RPC_URL.")
        bug_input = checksum_publish_bug_input(self.web3, bug_input)

        try:
            if self.contract.functions.exists(report_hash).call():
                return BugIndexPublishResult(
                    report_hash=report_hash,
                    tx_hash="already-published",
                    already_published=True,
                    index_address=self.index_address,
                )
        except Exception as exc:
            raise BugIndexPublishError(f"Could not check whether report {report_hash} already exists on the bug index: {_rpc_error(exc)}") from exc

        broker_address = self.web3.to_checksum_address(account.address)
        try:
            if not self.contract.functions.brokers(broker_address).call():
                raise BugIndexPublishError(
                    f"Broker wallet {broker_address} is not authorized on CheapBugsBugIndex {self.index_address}. "
                    "Ask the contract owner to call addBroker before running live submissions."
                )
        except BugIndexPublishError:
            raise
        except Exception as exc:
            raise BugIndexPublishError(f"Could not check broker authorization on CheapBugsBugIndex: {_rpc_error(exc)}") from exc

        function = self.contract.functions.publishBug(bug_input, nonce, deadline, signature)
        try:
            gas_estimate = int(function.estimate_gas({"from": broker_address}))
        except Exception as exc:
            raise BugIndexPublishError(
                "publishBug gas estimation failed. The index likely rejected the reporter signature, broker role, nonce, "
                f"reveal window, or duplicate report hash. RPC said: {_rpc_error(exc)}"
            ) from exc

        gas_limit = max(100_000, int(gas_estimate * 1.25))
        gas_price = int(self.web3.eth.gas_price)
        balance = int(self.web3.eth.get_balance(broker_address))
        required = gas_limit * gas_price
        if balance < required:
            raise BugIndexPublishError(
                "Broker wallet has insufficient Base ETH for publishBug gas: "
                f"balance={balance} wei, estimated_required={required} wei. Fund {broker_address} on Base or run with BROKER_DRY_RUN=1."
            )

        try:
            tx = function.build_transaction(
                {
                    "from": broker_address,
                    "nonce": self.web3.eth.get_transaction_count(broker_address),
                    "chainId": chain_id,
                    "gas": gas_limit,
                    "gasPrice": gas_price,
                }
            )
            signed = account.sign_transaction(tx)
            raw_tx = getattr(signed, "raw_transaction", None) or getattr(signed, "rawTransaction")
            tx_hash_bytes = self.web3.eth.send_raw_transaction(raw_tx)
            tx_hash = self.web3.to_hex(tx_hash_bytes)
        except Exception as exc:
            raise BugIndexPublishError(f"Failed to broadcast publishBug transaction: {_rpc_error(exc)}") from exc

        try:
            receipt = self.web3.eth.wait_for_transaction_receipt(tx_hash, timeout=self.receipt_timeout_seconds)
        except Exception as exc:
            raise BugIndexPublishError(
                f"publishBug transaction {tx_hash} was broadcast but no receipt arrived within "
                f"{self.receipt_timeout_seconds}s: {_rpc_error(exc)}"
            ) from exc
        status = int(_receipt_value(receipt, "status") or 0)
        block_number = _receipt_value(receipt, "blockNumber")
        if status != 1:
            raise BugIndexPublishError(f"publishBug transaction {tx_hash} reverted onchain. Check BaseScan for the revert reason.")
        return BugIndexPublishResult(
            report_hash=report_hash,
            tx_hash=tx_hash,
            block_number=int(block_number) if block_number is not None else None,
            index_address=self.index_address,
        )


def build_publish_bug_call_args(
    command: SubmissionCommand,
    verified: Any,
    bug_bundle: PinnedBugBundle,
) -> tuple[tuple[Any, ...], int, int, str]:
    auth = verified.publish_authorization
    message = _dict(auth, "message")
    core = _dict(verified.payload, "core")
    submission = _dict(core, "submission")
    tags = submission.get("tags") or []
    if not isinstance(tags, list):
        raise BugIndexPublishError("BugBundle submission tags must be an array before bug-index publishing.")

    report_hash = _hex32(message, "reportHash")
    bug_input = (
        report_hash,
        _report_id(report_hash),
        _address(message, "reporter"),
        _uint(message, "createdAt"),
        _uint(message, "disclosureMode"),
        _string(submission, "public_summary"),
        bug_bundle.uri,
        _uint(message, "targetKind"),
        _hex32(message, "targetRefHash"),
        ",".join(str(tag) for tag in tags),
        _hex32(message, "contentHash"),
        _hex32(message, "bugBundleHash"),
        _hex32(message, "encryptedDetailsHash"),
        _hex32(message, "detailsKeyCommitment"),
        _uint(message, "revealAfter"),
    )
    if bug_input[2].lower() != command.reporter_address.lower():
        raise BugIndexPublishError("Publish authorization reporter does not match the parsed submission reporter.")
    return (
        bug_input,
        _uint(message, "nonce"),
        _uint(message, "deadline"),
        _string(auth, "value"),
    )


def checksum_publish_bug_input(web3: Any, bug_input: tuple[Any, ...]) -> tuple[Any, ...]:
    """Return publishBug tuple args with ABI address fields in web3.py-safe checksum form."""

    values = list(bug_input)
    try:
        values[2] = web3.to_checksum_address(values[2])
    except Exception as exc:
        raise BugIndexPublishError("Publish authorization reporter is not a valid EVM address.") from exc
    return tuple(values)


def _report_id(report_hash: str) -> str:
    return f"cb-{report_hash[2:10]}"


def _dict(data: dict[str, Any], name: str) -> dict[str, Any]:
    value = data.get(name)
    if not isinstance(value, dict):
        raise BugIndexPublishError(f"{name} must be an object before bug-index publishing.")
    return value


def _string(data: dict[str, Any], name: str) -> str:
    value = data.get(name)
    if not isinstance(value, str) or not value.strip():
        raise BugIndexPublishError(f"{name} must be a non-empty string before bug-index publishing.")
    return value.strip()


def _uint(data: dict[str, Any], name: str) -> int:
    value = data.get(name)
    if isinstance(value, bool):
        raise BugIndexPublishError(f"{name} must be an unsigned integer before bug-index publishing.")
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str) and value.isdigit():
        parsed = int(value, 10)
    else:
        raise BugIndexPublishError(f"{name} must be an unsigned integer before bug-index publishing.")
    if parsed < 0:
        raise BugIndexPublishError(f"{name} must be an unsigned integer before bug-index publishing.")
    return parsed


def _hex32(data: dict[str, Any], name: str) -> str:
    value = _string(data, name).lower()
    if not value.startswith("0x") or len(value) != 66:
        raise BugIndexPublishError(f"{name} must be a 32-byte hex value before bug-index publishing.")
    try:
        int(value[2:], 16)
    except ValueError as exc:
        raise BugIndexPublishError(f"{name} must be a 32-byte hex value before bug-index publishing.") from exc
    return value


def _address(data: dict[str, Any], name: str) -> str:
    value = _string(data, name).lower()
    if not value.startswith("0x") or len(value) != 42:
        raise BugIndexPublishError(f"{name} must be an EVM address before bug-index publishing.")
    try:
        int(value[2:], 16)
    except ValueError as exc:
        raise BugIndexPublishError(f"{name} must be an EVM address before bug-index publishing.") from exc
    return value


def _rpc_error(exc: Exception) -> str:
    if isinstance(exc, ValueError) and exc.args:
        payload = exc.args[0]
        if isinstance(payload, dict):
            message = payload.get("message") or payload.get("data") or payload
            return str(message)
    return str(exc)


def _receipt_value(receipt: Any, key: str) -> Any:
    if isinstance(receipt, dict):
        return receipt.get(key)
    return getattr(receipt, key, None)
