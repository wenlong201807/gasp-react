#!/bin/bash
set -euo pipefail

APP_NAME="${APP_NAME:-gsap-react}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/docker-compose.yml}"
STATE_DIR="${STATE_DIR:-/opt/${APP_NAME}}"
STATE_FILE="${STATE_FILE:-${STATE_DIR}/active.env}"
BLUE_PORT="${BLUE_PORT:-18080}"
GREEN_PORT="${GREEN_PORT:-18081}"

[ -r "$STATE_FILE" ] || { echo "❌ No active deployment state: $STATE_FILE"; exit 1; }
# shellcheck disable=SC1090
. "$STATE_FILE"
case "${1:-}" in blue|green) TARGET_COLOR="$1" ;; *) TARGET_COLOR="${PREVIOUS_COLOR:-}" ;; esac
[ "$TARGET_COLOR" = blue ] || [ "$TARGET_COLOR" = green ] || { echo "❌ No rollback target available"; exit 1; }
[ "${TARGET_COLOR}" != "${ACTIVE_COLOR}" ] || { echo "❌ Rollback target is already active"; exit 1; }
TARGET_PORT="$([ "$TARGET_COLOR" = blue ] && printf '%s' "$BLUE_PORT" || printf '%s' "$GREEN_PORT")"
PROJECT="${APP_NAME}-${TARGET_COLOR}"

if ! curl -fsS --max-time 5 "http://127.0.0.1:${TARGET_PORT}/health" >/dev/null; then
  echo "❌ ${TARGET_COLOR} is not healthy; current service remains active"
  exit 1
fi

TARGET_CONFIG=$(mktemp)
sed "s/__BACKEND_PORT__/${TARGET_PORT}/g" docker/gsap-react.nginx.conf > "$TARGET_CONFIG"
CURRENT_CONFIG="/etc/nginx/conf.d/${APP_NAME}.conf"
BACKUP="${STATE_DIR}/nginx.rollback.$(date +%Y%m%d-%H%M%S).bak"
[ -f "$CURRENT_CONFIG" ] && cp -p "$CURRENT_CONFIG" "$BACKUP"
install -m 0644 "$TARGET_CONFIG" "$CURRENT_CONFIG"
rm -f "$TARGET_CONFIG"
if ! nginx -t >/dev/null || ! systemctl reload nginx; then
  [ -f "$BACKUP" ] && install -m 0644 "$BACKUP" "$CURRENT_CONFIG"
  nginx -t >/dev/null && systemctl reload nginx || true
  echo "❌ Rollback proxy switch failed; current service remains active"
  exit 1
fi

TMP=$(mktemp "${STATE_FILE}.XXXXXX")
printf 'ACTIVE_COLOR=%q\nPREVIOUS_COLOR=%q\n' "$TARGET_COLOR" "${ACTIVE_COLOR}" > "$TMP"
mv -f "$TMP" "$STATE_FILE"
echo "✅ Rolled back to ${TARGET_COLOR} (${TARGET_PORT}); both instances remain available"
