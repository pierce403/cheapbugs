#!/usr/bin/env bash
set -u -o pipefail

REPO_DIR="/home/user/cheapbugs"
SESSION="cheapbugs-broker"
WINDOW="cheapbugs-broker"
HEALTH_LOG="$REPO_DIR/.broker/health.log"
PATH="/home/user/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
IPFS_PATH="/home/user/.local/share/cheapbugs/ipfs"
export PATH IPFS_PATH IPFS_TELEMETRY=off

mkdir -p "$REPO_DIR/.broker"

log() {
  printf '%s %s\n' "$(date -Is)" "$*" >> "$HEALTH_LOG"
}

pane_exists() {
  tmux has-session -t "$SESSION" 2>/dev/null && tmux list-panes -t "$SESSION:$WINDOW" -F '#{pane_index}' 2>/dev/null | grep -qx "$1"
}

ensure_tmux_layout() {
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    tmux new-session -d -s "$SESSION" -n "$WINDOW" -c "$REPO_DIR"
    tmux split-window -h -t "$SESSION:$WINDOW" -c "$REPO_DIR"
    log "created tmux session/window $SESSION:$WINDOW"
    return
  fi

  if ! tmux list-windows -t "$SESSION" -F '#W' 2>/dev/null | grep -qx "$WINDOW"; then
    tmux new-window -d -t "$SESSION" -n "$WINDOW" -c "$REPO_DIR"
    tmux split-window -h -t "$SESSION:$WINDOW" -c "$REPO_DIR"
    log "created tmux window $SESSION:$WINDOW"
    return
  fi

  if ! pane_exists 1; then
    tmux split-window -h -t "$SESSION:$WINDOW" -c "$REPO_DIR"
    log "created missing broker pane"
  fi
}

start_ipfs() {
  ensure_tmux_layout
  tmux send-keys -t "$SESSION:$WINDOW.0" C-c 2>/dev/null || true
  tmux send-keys -t "$SESSION:$WINDOW.0" -l -- 'cd /home/user/cheapbugs; export PATH=/home/user/.local/bin:$PATH; export IPFS_PATH=/home/user/.local/share/cheapbugs/ipfs; export IPFS_TELEMETRY=off; ipfs config Plugins.Plugins.telemetry.Config.Mode off >/dev/null 2>&1 || true; ipfs daemon 2>&1 | tee -a /home/user/cheapbugs/ipfs.log'
  tmux send-keys -t "$SESSION:$WINDOW.0" Enter
  log "started IPFS daemon in tmux pane 0"
}

start_broker() {
  ensure_tmux_layout
  tmux send-keys -t "$SESSION:$WINDOW.1" C-c 2>/dev/null || true
  tmux send-keys -t "$SESSION:$WINDOW.1" -l -- 'cd /home/user/cheapbugs; export PATH=/home/user/.local/bin:$PATH; ./run-broker.sh 2>&1 | tee -a /home/user/cheapbugs/broker-console.log'
  tmux send-keys -t "$SESSION:$WINDOW.1" Enter
  log "started broker in tmux pane 1"
}

ensure_tmux_layout

if ! pgrep -f 'ipfs daemon' >/dev/null 2>&1; then
  log "IPFS daemon missing"
  start_ipfs
  sleep 5
fi

if ! curl -fsS -X POST --max-time 5 'http://127.0.0.1:5001/api/v0/version' >/dev/null 2>&1; then
  log "IPFS API unhealthy; attempting restart"
  start_ipfs
  sleep 8
fi

if ! pgrep -f 'python scripts/broker-bot.py run' >/dev/null 2>&1; then
  log "broker process missing"
  start_broker
  sleep 8
fi

if ! pgrep -f 'python scripts/broker-bot.py run' >/dev/null 2>&1; then
  log "UNHEALTHY broker did not start"
  exit 2
fi

if ! curl -fsS -X POST --max-time 5 'http://127.0.0.1:5001/api/v0/version' >/dev/null 2>&1; then
  log "UNHEALTHY IPFS API still unreachable"
  exit 2
fi

if ! grep -q '^BROKER_DRY_RUN=0$' "$REPO_DIR/.env"; then
  log "UNHEALTHY BROKER_DRY_RUN is not 0"
  exit 2
fi

if ! grep -q '^BROKER_SIGNAL_CLI=http://127\.0\.0\.1:8080/api/v1/rpc$' "$REPO_DIR/.env"; then
  log "UNHEALTHY Signal JSON-RPC is not configured"
  exit 2
fi

if ! grep -q '^BROKER_SIGNAL_GROUP_ID=KItrFoAN/DrZJV6ltPyUwkIZBjNZxm6xGcR3xG5Wmho=$' "$REPO_DIR/.env"; then
  log "UNHEALTHY CheapBugs Signal group is not configured"
  exit 2
fi

if ! curl -fsS --max-time 5 'http://127.0.0.1:8080/api/v1/check' >/dev/null 2>&1; then
  log "UNHEALTHY signal-cli HTTP daemon is unreachable"
  exit 2
fi

recent_errors="$(tail -200 "$REPO_DIR/broker.log" 2>/dev/null | grep -E 'Traceback|ERROR|CRITICAL' | tail -5 || true)"
if [[ -n "$recent_errors" ]]; then
  log "recent broker errors: ${recent_errors//$'\n'/ | }"
fi

log "healthy broker_pid=$(pgrep -f 'python scripts/broker-bot.py run' | head -1) ipfs_pid=$(pgrep -f 'ipfs daemon' | head -1)"
