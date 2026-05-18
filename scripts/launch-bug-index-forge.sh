#!/usr/bin/env bash
set -euo pipefail

load_env_file() {
  local file_path="$1"
  [[ -f "$file_path" ]] || return 0

  local line normalized key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue

    normalized="$line"
    if [[ "$normalized" == export[[:space:]]* ]]; then
      normalized="${normalized#export }"
    fi
    [[ "$normalized" == *=* ]] || continue

    key="${normalized%%=*}"
    value="${normalized#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    [[ -n "${!key+x}" ]] && continue

    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi

    export "$key=$value"
  done < "$file_path"
}

load_env_file ".env"
load_env_file ".env.local"

RPC_URL="${BASE_RPC_URL:-https://mainnet.base.org}"
VERIFY_CONTRACTS="${BUG_INDEX_VERIFY_CONTRACTS:-1}"
DEFAULT_CONTRACT_OWNER="0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3"
export BUG_INDEX_OWNER="${BUG_INDEX_OWNER:-$DEFAULT_CONTRACT_OWNER}"
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
