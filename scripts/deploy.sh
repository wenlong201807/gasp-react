#!/bin/bash
set -euo pipefail

APP_NAME="${APP_NAME:-gsap-react}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/docker-compose.yml}"
HOST_PORT="${HOST_PORT:-18080}"
ENDPOINT="${ENDPOINT:-http://127.0.0.1:${HOST_PORT}/health}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

compose() {
  docker compose -p "$APP_NAME" -f "$COMPOSE_FILE" "$@"
}

health() {
  local retries="${1:-20}"
  while [ "$retries" -gt 0 ]; do
    if curl -fsS --max-time 5 "$ENDPOINT" >/dev/null; then
      return 0
    fi
    retries=$((retries - 1))
    sleep 3
  done
  return 1
}

container_healthy() {
  [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${APP_NAME}-production-1" 2>/dev/null)" = healthy ]
}

wait_for_health() {
  local retries="${1:-20}"
  while [ "$retries" -gt 0 ]; do
    if health 1 && container_healthy; then
      return 0
    fi
    retries=$((retries - 1))
    sleep 3
  done
  return 1
}

log "Validating Compose configuration"
compose config >/dev/null

log "Building and starting ${APP_NAME}"
compose --profile prod up -d --build --force-recreate

if ! wait_for_health; then
  compose logs --tail=100 production >&2 || true
  fail "health check failed: ${ENDPOINT}"
fi

if ! compose ps --status running --services | grep -qx production; then
  compose logs --tail=100 production >&2 || true
  fail "production service is not running: ${APP_NAME}"
fi

compose ps
log "Deployment complete: ${ENDPOINT}"
