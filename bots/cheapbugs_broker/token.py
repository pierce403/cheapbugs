"""BUGZ token reads and payouts for the broker bot."""

from __future__ import annotations


ERC20_ABI = [
    {
        "name": "balanceOf",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "decimals",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint8"}],
    },
    {
        "name": "transfer",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "to", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "outputs": [{"name": "", "type": "bool"}],
    },
]


class BugzTokenClient:
    def __init__(self, rpc_url: str, token_address: str, payout_private_key: str, dry_run: bool = False):
        self.rpc_url = rpc_url
        self.token_address = token_address
        self.payout_private_key = payout_private_key
        self.dry_run = dry_run
        self._web3 = None
        self._contract = None
        self._account = None
        self._decimals = None

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
                address=self.web3.to_checksum_address(self.token_address),
                abi=ERC20_ABI,
            )
        return self._contract

    @property
    def account(self):
        if self._account is None:
            if not self.payout_private_key:
                raise RuntimeError("BUGZ_PAYOUT_PRIVATE_KEY is required for live payouts.")
            self._account = self.web3.eth.account.from_key(self.payout_private_key)
        return self._account

    def decimals(self) -> int:
        if self._decimals is None:
            self._decimals = int(self.contract.functions.decimals().call())
        return self._decimals

    def balance_of(self, address: str) -> int:
        return int(self.contract.functions.balanceOf(self.web3.to_checksum_address(address)).call())

    def transfer(self, to_address: str, amount_wei: int) -> str:
        if amount_wei <= 0:
            return "no-op:zero-payout"
        to_checksum = self.web3.to_checksum_address(to_address)
        if self.dry_run:
            return f"dry-run:transfer:{to_checksum}:{amount_wei}"

        account = self.account
        nonce = self.web3.eth.get_transaction_count(account.address)
        tx = self.contract.functions.transfer(to_checksum, amount_wei).build_transaction(
            {
                "from": account.address,
                "nonce": nonce,
                "chainId": self.web3.eth.chain_id,
            }
        )
        try:
            estimate = self.web3.eth.estimate_gas(tx)
            tx["gas"] = int(estimate * 1.2)
        except Exception:
            tx.setdefault("gas", 100_000)
        tx.setdefault("gasPrice", self.web3.eth.gas_price)

        signed = account.sign_transaction(tx)
        raw_tx = getattr(signed, "raw_transaction", None) or getattr(signed, "rawTransaction")
        tx_hash = self.web3.eth.send_raw_transaction(raw_tx)
        return self.web3.to_hex(tx_hash)
