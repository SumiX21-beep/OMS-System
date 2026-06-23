#!/usr/bin/env bash
# Run API + worker + scheduler together in the foreground.
# Ctrl-C (or any exit) kills all three — no orphaned processes holding :3000.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▸ Freeing any stray app processes…"
pkill -f 'node dist/main' 2>/dev/null || true
sleep 1

echo "▸ Building…"
npm run build

pids=()
cleanup() {
  echo
  echo "▸ Stopping all processes…"
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "▸ Starting API (:3000), worker, scheduler…"
node dist/main.js &           pids+=($!)
node dist/main.worker.js &    pids+=($!)
node dist/main.scheduler.js & pids+=($!)

wait
