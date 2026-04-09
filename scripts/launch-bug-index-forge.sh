#!/usr/bin/env bash
set -euo pipefail

RPC_URL="${BASE_RPC_URL:-https://mainnet.base.org}"

forge script script/LaunchBugIndex.s.sol:LaunchBugIndex --rpc-url "$RPC_URL" "$@"
