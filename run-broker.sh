#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${BROKER_ENV_FILE:-.env}"
VENV_DIR="${BROKER_VENV_DIR:-.venv-broker}"
COMMAND="${1:-run}"

case "$COMMAND" in
  run|init-db|sync-signal|settle)
    if [[ $# -gt 0 ]]; then
      shift
    fi
    ;;
  -*)
    COMMAND="run"
    ;;
  *)
    echo "Unknown broker command: $COMMAND" >&2
    echo "Usage: ./run-broker.sh [run|init-db|sync-signal|settle] [--log-level LEVEL]" >&2
    exit 2
    ;;
esac

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE." >&2
  echo "Create a shell-compatible .env with the required broker variables before running this script." >&2
  exit 2
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

copy_if_empty() {
  local target="$1"
  shift
  local current="${!target:-}"
  if [[ -n "${current//[[:space:]]/}" ]]; then
    return
  fi

  local source
  for source in "$@"; do
    local value="${!source:-}"
    if [[ -n "${value//[[:space:]]/}" ]]; then
      export "$target=$value"
      return
    fi
  done
}

is_truthy() {
  case "${1,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

is_falsey() {
  case "${1,,}" in
    0|false|no|off) return 0 ;;
    *) return 1 ;;
  esac
}

export BROKER_XMTP_ENV="${BROKER_XMTP_ENV:-${BOUNCER_XMTP_ENV:-${XMTP_ENV:-production}}}"
export BROKER_XMTP_DB_PATH="${BROKER_XMTP_DB_PATH:-${BOUNCER_XMTP_DB_PATH:-.broker/xmtp.db3}}"
export BROKER_DB_PATH="${BROKER_DB_PATH:-${BOUNCER_DB_PATH:-.broker/broker.sqlite}}"
export BROKER_DRY_RUN="${BROKER_DRY_RUN:-${BOUNCER_DRY_RUN:-1}}"
export BROKER_SIGNAL_CLI="${BROKER_SIGNAL_CLI:-${BOUNCER_SIGNAL_CLI:-}}"

copy_if_empty BROKER_SIGNAL_ACCOUNT BOUNCER_SIGNAL_ACCOUNT
copy_if_empty BROKER_SIGNAL_GROUP_ID BOUNCER_SIGNAL_GROUP_ID
copy_if_empty BASE_RPC_URL VITE_CHAIN_RPC_URL
copy_if_empty BUGZ_TOKEN_ADDRESS VITE_BUGZ_TOKEN_ADDRESS

missing=()
require_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "${value//[[:space:]]/}" ]]; then
    missing+=("$name")
  fi
}

if [[ "$COMMAND" != "init-db" ]]; then
  require_env XMTP_WALLET_KEY
  require_env XMTP_DB_ENCRYPTION_KEY
  require_env BASE_RPC_URL
  require_env BUGZ_TOKEN_ADDRESS

  if ! is_truthy "$BROKER_DRY_RUN" && ! is_falsey "$BROKER_DRY_RUN"; then
    echo "BROKER_DRY_RUN must be one of 1, true, yes, on, 0, false, no, off." >&2
    exit 2
  fi

  if ! is_truthy "$BROKER_DRY_RUN"; then
    require_env BUGZ_PAYOUT_PRIVATE_KEY
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "Missing required broker env var(s): ${missing[*]}" >&2
    echo "Set them in $ENV_FILE. BROKER_DRY_RUN defaults to 1; set BROKER_DRY_RUN=0 only with BUGZ_PAYOUT_PRIVATE_KEY." >&2
    exit 2
  fi

  if [[ -z "${BROKER_SIGNAL_CLI//[[:space:]]/}" ]]; then
    red=""
    bold=""
    reset=""
    if [[ -t 2 ]]; then
      red="$(printf '\033[31m')"
      bold="$(printf '\033[1m')"
      reset="$(printf '\033[0m')"
    fi
    {
      echo "${red}${bold}================================================================${reset}"
      echo "${red}${bold}WARNING: SIGNAL IS NOT CONFIGURED${reset}"
      echo "${red}${bold}================================================================${reset}"
      echo "BROKER_SIGNAL_CLI is not set, so the broker will run without Signal support."
      echo "Submissions can still be received, validated, credential-checked, and recorded locally."
      echo "They will NOT be relayed to Signal, Signal reactions will not be synced, and rewards will not settle."
      echo
      echo "To enable Signal support, set these in $ENV_FILE:"
      echo "  BROKER_SIGNAL_CLI=/path/to/signal-cli"
      echo "  BROKER_SIGNAL_ACCOUNT=+15555550123"
      echo "  BROKER_SIGNAL_GROUP_ID=<signal group id>"
      echo "${red}${bold}================================================================${reset}"
    } >&2
  else
    require_env BROKER_SIGNAL_ACCOUNT
    require_env BROKER_SIGNAL_GROUP_ID

    if [[ ${#missing[@]} -gt 0 ]]; then
      echo "Missing required Signal env var(s): ${missing[*]}" >&2
      echo "Set BROKER_SIGNAL_ACCOUNT and BROKER_SIGNAL_GROUP_ID in $ENV_FILE, or unset BROKER_SIGNAL_CLI to run without Signal support." >&2
      exit 2
    fi

    if [[ "$BROKER_SIGNAL_CLI" == */* ]]; then
      if [[ ! -x "$BROKER_SIGNAL_CLI" ]]; then
        echo "BROKER_SIGNAL_CLI is not executable: $BROKER_SIGNAL_CLI" >&2
        exit 2
      fi
    elif ! command -v "$BROKER_SIGNAL_CLI" >/dev/null 2>&1; then
      echo "BROKER_SIGNAL_CLI command was not found on PATH: $BROKER_SIGNAL_CLI" >&2
      exit 2
    fi
  fi
fi

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  python3 -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
. "$VENV_DIR/bin/activate"

install_stamp="$VENV_DIR/.cheapbugs-broker-installed"
if [[ ! -f "$install_stamp" || requirements-broker.txt -nt "$install_stamp" ]]; then
  python -m pip install -r requirements-broker.txt
  touch "$install_stamp"
fi

mkdir -p "$(dirname "$BROKER_DB_PATH")" "$(dirname "$BROKER_XMTP_DB_PATH")"

if [[ "$COMMAND" == "run" ]]; then
  python scripts/broker-bot.py init-db
fi

exec python scripts/broker-bot.py "$COMMAND" "$@"
