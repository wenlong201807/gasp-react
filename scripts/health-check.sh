#!/bin/bash
set -euo pipefail

APP_NAME="${APP_NAME:-gsap-react}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/docker-compose.yml}"
HOST_PORT="${HOST_PORT:-18080}"
ENDPOINT="${1:-http://127.0.0.1:${HOST_PORT}/health}"
TIMEOUT="${TIMEOUT:-5}"

curl -fsS --max-time "$TIMEOUT" "$ENDPOINT" >/dev/null || {
  echo "❌ HTTP health check failed: $ENDPOINT" >&2
  exit 1
}
echo "✅ HTTP health check passed: $ENDPOINT"

docker compose -p "$APP_NAME" -f "$COMPOSE_FILE" ps --status running --services \
  | grep -qx production || {
    echo "❌ production service is not running: $APP_NAME" >&2
    exit 1
  }
echo "✅ Compose service is running: $APP_NAME"
