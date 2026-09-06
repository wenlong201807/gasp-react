#!/bin/bash
set -euo pipefail

ENDPOINT="${1:-http://127.0.0.1:18080/health}"
COMPOSE_PROJECT_NAME="${2:-}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/docker-compose.yml}"
TIMEOUT="${TIMEOUT:-5}"

curl -fsS --max-time "$TIMEOUT" "$ENDPOINT" >/dev/null || { echo "❌ HTTP health check failed: $ENDPOINT"; exit 1; }
echo "✅ HTTP health check passed: $ENDPOINT"
if [ -n "$COMPOSE_PROJECT_NAME" ]; then
  docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" ps --status running --services | grep -qx production || { echo "❌ production service is not running"; exit 1; }
  echo "✅ Compose service is running: $COMPOSE_PROJECT_NAME"
fi
