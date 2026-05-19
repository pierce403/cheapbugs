"""Treasury vault reads used for detail-key sale verification."""

from __future__ import annotations


TREASURY_ABI = [
    {
        "name": "calculateRewardAmount",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "multiplier", "type": "uint8"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "detailKeyPayments",
        "type": "function",
        "stateMutability": "view",
        "inputs": [
            {"name": "reportHash", "type": "bytes32"},
            {"name": "buyer", "type": "address"},
        ],
        "outputs": [{"name": "", "type": "uint256"}],
    },
]


class TreasuryVaultClient:
    def __init__(self, rpc_url: str, treasury_address: str):
        self.rpc_url = rpc_url
        self.treasury_address = treasury_address
        self._web3 = None
        self._contract = None

    @property
    def web3(self):
        if self._web3 is None:
            try:
                from web3 import Web3
            except ImportError as exc:
                raise RuntimeError("Install bot dependencies with: pip install -r requirements-broker.txt") from exc
            self._web3 = Web3(Web3.HTTPProvider(self.rpc_url))
        return self._web3

    @property
    def contract(self):
        if self._contract is None:
            self._contract = self.web3.eth.contract(
                address=self.web3.to_checksum_address(self.treasury_address),
                abi=TREASURY_ABI,
            )
        return self._contract

    def base_reward(self) -> int:
        return int(self.contract.functions.calculateRewardAmount(1).call())

    def detail_key_payment_total(self, report_hash: str, buyer_address: str) -> int:
        buyer = self.web3.to_checksum_address(buyer_address)
        return int(self.contract.functions.detailKeyPayments(report_hash, buyer).call())

    def verify_successful_payment_tx(self, tx_hash: str, buyer_address: str) -> None:
        receipt = self.web3.eth.get_transaction_receipt(tx_hash)
        if receipt is None:
            raise ValueError("transaction receipt was not found")
        if int(receipt.get("status", 0)) != 1:
            raise ValueError("transaction did not succeed")
        tx = self.web3.eth.get_transaction(tx_hash)
        expected_buyer = self.web3.to_checksum_address(buyer_address)
        expected_treasury = self.web3.to_checksum_address(self.treasury_address)
        actual_from = self.web3.to_checksum_address(str(tx.get("from")))
        actual_to_raw = tx.get("to")
        actual_to = self.web3.to_checksum_address(str(actual_to_raw)) if actual_to_raw else ""
        if actual_from != expected_buyer:
            raise ValueError("transaction sender does not match the unlock buyer")
        if actual_to != expected_treasury:
            raise ValueError("transaction recipient is not the configured treasury vault")
