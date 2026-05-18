#!/usr/bin/env bash
set -euo pipefail

RPC_URL="${BASE_RPC_URL:-https://mainnet.base.org}"
VERIFY_CONTRACTS="${BUG_INDEX_VERIFY_CONTRACTS:-1}"
BROADCAST_REQUESTED=0
VERIFY_REQUESTED_BY_ARGS=0

for arg in "$@"; do
  if [[ "$arg" == "--broadcast" ]]; then
    BROADCAST_REQUESTED=1
  fi
  if [[ "$arg" == "--verify" ]]; then
    VERIFY_REQUESTED_BY_ARGS=1
  fi
done

if [[ "$BROADCAST_REQUESTED" != "1" ]]; then
  export BUG_INDEX_DEPLOYER_PRIVATE_KEY="${BUG_INDEX_DEPLOYER_PRIVATE_KEY:-0x0000000000000000000000000000000000000000000000000000000000000001}"
fi

VERIFY_ARGS=()
if [[ "$BROADCAST_REQUESTED" == "1" && "$VERIFY_CONTRACTS" != "0" && "$VERIFY_REQUESTED_BY_ARGS" != "1" ]]; then
  ETHERSCAN_KEY="${ETHERSCAN_API_KEY:-${BASESCAN_API_KEY:-}}"
  if [[ -z "$ETHERSCAN_KEY" ]]; then
    echo "Missing ETHERSCAN_API_KEY or BASESCAN_API_KEY for contract verification." >&2
    echo "Set BUG_INDEX_VERIFY_CONTRACTS=0 only when intentionally deploying without explorer verification." >&2
    exit 1
  fi

  export ETHERSCAN_API_KEY="$ETHERSCAN_KEY"
  VERIFY_ARGS=(--verify --verifier etherscan)
  if [[ -n "${ETHERSCAN_API_VERSION:-}" ]]; then
    VERIFY_ARGS+=(--etherscan-api-version "$ETHERSCAN_API_VERSION")
  fi
fi

forge script script/LaunchBugIndex.s.sol:LaunchBugIndex --rpc-url "$RPC_URL" "${VERIFY_ARGS[@]}" "$@"
