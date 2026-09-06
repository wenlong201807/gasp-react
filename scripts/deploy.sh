#!/bin/bash
set -euo pipefail

APP_NAME="${APP_NAME:-gsap-react}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/docker-compose.yml}"
STATE_DIR="${STATE_DIR:-/opt/${APP_NAME}}"
STATE_FILE="${STATE_FILE:-${STATE_DIR}/active.env}"
NGINX_CONFIG_TARGET="${NGINX_CONFIG_TARGET:-/etc/nginx/conf.d/${APP_NAME}.conf}"
BLUE_PORT="${BLUE_PORT:-18080}"
GREEN_PORT="${GREEN_PORT:-18081}"
IMAGE_TAG="${1:-latest}"
LOCK_FILE="${STATE_DIR}/deploy.lock"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { log "ERROR: $*"; exit 1; }
port_for_color() { [ "$1" = blue ] && printf '%s\n' "$BLUE_PORT" || printf '%s\n' "$GREEN_PORT"; }
project_for_color() { printf '%s-%s\n' "$APP_NAME" "$1"; }
other_color() { [ "$1" = blue ] && printf '%s\n' green || printf '%s\n' blue; }
load_state() { ACTIVE_COLOR=; [ -r "$STATE_FILE" ] && . "$STATE_FILE"; }
compose() { local c="$1"; shift; HOST_PORT="$(port_for_color "$c")" docker compose -p "$(project_for_color "$c")" -f "$COMPOSE_FILE" "$@"; }

health() {
  local port="$1" n=20
  while [ "$n" -gt 0 ]; do curl -fsS --max-time 5 "http://127.0.0.1:${port}/health" >/dev/null && return 0; n=$((n-1)); sleep 3; done
  return 1
}

cleanup_candidate() {
  compose "$CANDIDATE_COLOR" down --remove-orphans >/dev/null 2>&1 || true
}

confirm_switch() {
  if [ "${DEPLOY_AUTO_APPROVE:-false}" = true ]; then
    log "DEPLOY_AUTO_APPROVE=true; proceeding with proxy switch"
    return 0
  fi
  if [ ! -t 0 ]; then
    log "ERROR: interactive confirmation is required; refusing to switch traffic from a non-interactive terminal"
    return 1
  fi
  printf '\n'
  log "Candidate ${CANDIDATE_COLOR} is healthy on port ${CANDIDATE_PORT}."
  log "Active ${ACTIVE_COLOR} remains live on port ${ACTIVE_PORT}."
  read -r -p "Switch production traffic to ${CANDIDATE_COLOR}? [y/N] " answer
  case "$answer" in
    y|Y|yes|YES|Yes) return 0 ;;
    *) return 1 ;;
  esac
}

write_state() {
  local color="$1" previous="$2" tmp
  tmp=$(mktemp "${STATE_FILE}.XXXXXX")
  printf 'ACTIVE_COLOR=%q\nPREVIOUS_COLOR=%q\n' "$color" "$previous" > "$tmp"
  mv -f "$tmp" "$STATE_FILE"
}

switch_proxy() {
  local port="$1" backup="$2" tmp
  tmp=$(mktemp "${NGINX_CONFIG_TARGET}.XXXXXX")
  sed "s/__BACKEND_PORT__/${port}/g" docker/gsap-react.nginx.conf > "$tmp"
  nginx -t >/dev/null || { rm -f "$tmp"; return 1; }
  [ -f "$NGINX_CONFIG_TARGET" ] && cp -p "$NGINX_CONFIG_TARGET" "$backup"
  install -m 0644 "$tmp" "$NGINX_CONFIG_TARGET"; rm -f "$tmp"
  if ! nginx -t >/dev/null || ! systemctl reload nginx; then
    [ -f "$backup" ] && install -m 0644 "$backup" "$NGINX_CONFIG_TARGET"
    nginx -t >/dev/null && systemctl reload nginx || true
    return 1
  fi
}

mkdir -p "$STATE_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || fail "another deployment is already running"
load_state
if [ "${ACTIVE_COLOR:-}" != blue ] && [ "${ACTIVE_COLOR:-}" != green ]; then
  if curl -fsS --max-time 3 "http://127.0.0.1:${BLUE_PORT}/health" >/dev/null; then ACTIVE_COLOR=blue
  elif curl -fsS --max-time 3 "http://127.0.0.1:${GREEN_PORT}/health" >/dev/null; then ACTIVE_COLOR=green
  else ACTIVE_COLOR=blue; fi
fi
CANDIDATE_COLOR="$(other_color "$ACTIVE_COLOR")"
CANDIDATE_PORT="$(port_for_color "$CANDIDATE_COLOR")"
ACTIVE_PORT="$(port_for_color "$ACTIVE_COLOR")"
BACKUP="${STATE_DIR}/nginx.conf.$(date +%Y%m%d-%H%M%S).bak"

log "Deploying ${IMAGE_TAG} to ${CANDIDATE_COLOR} on port ${CANDIDATE_PORT}; active ${ACTIVE_COLOR} remains running"
docker build --tag "${APP_NAME}:${IMAGE_TAG}" --tag "${APP_NAME}:latest" --file docker/Dockerfile .
compose "$CANDIDATE_COLOR" --profile prod up -d --build || fail "candidate startup failed"
if ! health "$CANDIDATE_PORT"; then cleanup_candidate; fail "candidate health check failed; active service was not changed"; fi
if ! confirm_switch; then
  cleanup_candidate
  if [ -t 0 ]; then
    log "Deployment cancelled; active ${ACTIVE_COLOR} service and proxy were not changed"
    exit 0
  fi
  fail "deployment cancelled because interactive confirmation was unavailable; active service was not changed"
fi
switch_proxy "$CANDIDATE_PORT" "$BACKUP" || { cleanup_candidate; fail "proxy switch failed; active service remains unchanged"; }
if ! curl -fsS --max-time 10 "http://127.0.0.1/health" >/dev/null; then
  [ -f "$BACKUP" ] && install -m 0644 "$BACKUP" "$NGINX_CONFIG_TARGET" && nginx -t >/dev/null && systemctl reload nginx || true
  cleanup_candidate
  fail "post-switch validation failed; proxy restored"
fi
write_state "$CANDIDATE_COLOR" "$ACTIVE_COLOR"
log "Deployment complete; old ${ACTIVE_COLOR} instance retained for rollback"
