#!/usr/bin/env bash
set -euo pipefail

RPC_URL="${BASE_RPC_URL:-https://mainnet.base.org}"

if [[ " $* " != *" --broadcast "* ]]; then
  export BUG_INDEX_DEPLOYER_PRIVATE_KEY="${BUG_INDEX_DEPLOYER_PRIVATE_KEY:-0x0000000000000000000000000000000000000000000000000000000000000001}"
fi

forge script script/LaunchBugIndex.s.sol:LaunchBugIndex --rpc-url "$RPC_URL" "$@"
