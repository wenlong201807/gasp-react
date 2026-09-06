#!/bin/bash
set -euo pipefail

APP_NAME="${APP_NAME:-gsap-react}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/docker-compose.yml}"
STATE_DIR="${STATE_DIR:-/opt/${APP_NAME}}"
STATE_FILE="${STATE_FILE:-${STATE_DIR}/active.env}"
NGINX_CONFIG_TARGET="${NGINX_CONFIG_TARGET:-/etc/nginx/conf.d/${APP_NAME}.conf}"
BLUE_PORT="${BLUE_PORT:-18080}"
GREEN_PORT="${GREEN_PORT:-18081}"

port_for_color() {
    case "$1" in
        blue) printf '%s\n' "$BLUE_PORT" ;;
        green) printf '%s\n' "$GREEN_PORT" ;;
        *) return 1 ;;
    esac
}

other_color() {
    case "$1" in
        blue) printf '%s\n' green ;;
        green) printf '%s\n' blue ;;
        *) return 1 ;;
    esac
}

project_for_color() {
    printf '%s-%s\n' "$APP_NAME" "$1"
}

load_state() {
    ACTIVE_COLOR=""
    ACTIVE_PORT=""
    PREVIOUS_COLOR=""
    if [ -r "$STATE_FILE" ]; then
        # State is written by this script and contains only shell assignments.
        # shellcheck disable=SC1090
        . "$STATE_FILE"
    fi
}

save_state() {
    local color="$1" port="$2" previous="$3"
    mkdir -p "$STATE_DIR"
    umask 077
    local tmp
    tmp=$(mktemp "${STATE_FILE}.XXXXXX")
    printf 'ACTIVE_COLOR=%q\nACTIVE_PORT=%q\nPREVIOUS_COLOR=%q\n' "$color" "$port" "$previous" > "$tmp"
    mv -f "$tmp" "$STATE_FILE"
}

compose() {
    local color="$1"; shift
    HOST_PORT="$(port_for_color "$color")" \
    COMPOSE_PROJECT_NAME="$(project_for_color "$color")" \
    docker compose -p "$(project_for_color "$color")" -f "$COMPOSE_FILE" "$@"
}

wait_for_health() {
    local port="$1" retries="${2:-20}"
    local endpoint="http://127.0.0.1:${port}/health"
    while [ "$retries" -gt 0 ]; do
        if curl -fsS --max-time 5 "$endpoint" >/dev/null; then return 0; fi
        retries=$((retries - 1))
        sleep 3
    done
    return 1
}

render_nginx_config() {
    local port="$1" output="$2"
    sed "s/__BACKEND_PORT__/${port}/g" docker/gsap-react.nginx.conf > "$output"
}

switch_nginx() {
    local port="$1" backup="$2" tmp
    tmp=$(mktemp "${NGINX_CONFIG_TARGET}.XXXXXX")
    render_nginx_config "$port" "$tmp"
    nginx -t -c /etc/nginx/nginx.conf -q -g "daemon off;" 2>/dev/null || true
    if ! nginx -t >/dev/null; then rm -f "$tmp"; return 1; fi
    if [ -f "$NGINX_CONFIG_TARGET" ]; then cp -p "$NGINX_CONFIG_TARGET" "$backup"; fi
    install -m 0644 "$tmp" "$NGINX_CONFIG_TARGET"
    rm -f "$tmp"
    if ! nginx -t >/dev/null || ! systemctl reload nginx; then
        [ -f "$backup" ] && install -m 0644 "$backup" "$NGINX_CONFIG_TARGET"
        nginx -t >/dev/null && systemctl reload nginx || true
        return 1
    fi
}
