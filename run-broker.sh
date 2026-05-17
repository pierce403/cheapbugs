#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${BROKER_ENV_FILE:-.env}"
VENV_DIR="${BROKER_VENV_DIR:-.venv-broker}"
COMMAND="${1:-run}"
DEBUG_COMMAND=0

case "$COMMAND" in
  debug)
    DEBUG_COMMAND=1
    COMMAND="run"
    if [[ $# -gt 0 ]]; then
      shift
    fi
    ;;
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
    echo "Usage: ./run-broker.sh [run|debug|init-db|sync-signal|settle] [--log-level LEVEL]" >&2
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

has_log_level_arg() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --log-level|--log-level=*) return 0 ;;
    esac
  done
  return 1
}

debug_enabled=0
if [[ "$DEBUG_COMMAND" == "1" ]] || is_truthy "${BROKER_DEBUG:-0}"; then
  debug_enabled=1
fi

export BROKER_XMTP_ENV="${BROKER_XMTP_ENV:-production}"
export BROKER_XMTP_DB_PATH="${BROKER_XMTP_DB_PATH:-.broker/xmtp.db3}"
export BROKER_DB_PATH="${BROKER_DB_PATH:-.broker/broker.sqlite}"
if [[ "$debug_enabled" == "1" ]]; then
  export BROKER_LOG_PATH="${BROKER_LOG_PATH:-broker-debug.log}"
  export PYTHONFAULTHANDLER="${BROKER_PYTHONFAULTHANDLER:-1}"
  export RUST_BACKTRACE="${BROKER_RUST_BACKTRACE:-full}"
  export RUST_LOG="${BROKER_RUST_LOG:-debug}"
else
  export BROKER_LOG_PATH="${BROKER_LOG_PATH:-broker.log}"
fi
export BROKER_DRY_RUN="${BROKER_DRY_RUN:-1}"
export BROKER_SIGNAL_CLI="${BROKER_SIGNAL_CLI:-}"
export BASE_RPC_URL="${BASE_RPC_URL:-https://mainnet.base.org}"
export BUGZ_TOKEN_ADDRESS="${BUGZ_TOKEN_ADDRESS:-0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07}"

python_args=()
if [[ "$debug_enabled" == "1" ]]; then
  if ! has_log_level_arg "$@"; then
    python_args+=(--log-level DEBUG)
  fi
  {
    echo "Broker debug mode enabled."
    echo "  BROKER_LOG_PATH=$BROKER_LOG_PATH"
    echo "  PYTHONFAULTHANDLER=$PYTHONFAULTHANDLER"
    echo "  RUST_BACKTRACE=$RUST_BACKTRACE"
    echo "  RUST_LOG=$RUST_LOG"
  } >&2
fi

missing=()
require_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "${value//[[:space:]]/}" ]]; then
    missing+=("$name")
  fi
}

if [[ "$COMMAND" != "init-db" ]]; then
  require_env BROKER_KEY

  if ! is_truthy "$BROKER_DRY_RUN" && ! is_falsey "$BROKER_DRY_RUN"; then
    echo "BROKER_DRY_RUN must be one of 1, true, yes, on, 0, false, no, off." >&2
    exit 2
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "Missing required broker env var(s): ${missing[*]}" >&2
    echo "Set them in $ENV_FILE. BROKER_KEY is the broker XMTP identity and the BUGZ payout key." >&2
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

mkdir -p "$(dirname "$BROKER_DB_PATH")" "$(dirname "$BROKER_XMTP_DB_PATH")" "$(dirname "$BROKER_LOG_PATH")"

if [[ "$COMMAND" == "run" ]]; then
  python scripts/broker-bot.py init-db "${python_args[@]}"
fi

exec python scripts/broker-bot.py "$COMMAND" "${python_args[@]}" "$@"
