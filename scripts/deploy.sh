#!/bin/bash
set -euo pipefail

# ============ Configuration ============
APP_NAME="gsap-react"
DEPLOY_DIR="/opt/${APP_NAME}"
BACKUP_DIR="/opt/${APP_NAME}/backups"
MAX_BACKUPS=5
COMPOSE_FILE="docker/docker-compose.yml"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-${APP_NAME}}"
DOCKER_REGISTRY="${DOCKER_REGISTRY:-}"
IMAGE_TAG="${1:-latest}"
LOG_DIR="/var/log/${APP_NAME}"
LOG_FILE="${LOG_DIR}/deploy.log"
HOST_PORT="${HOST_PORT:-18080}"
NGINX_CONFIG_SOURCE="docker/gsap-react.nginx.conf"
NGINX_CONFIG_TARGET="/etc/nginx/conf.d/${APP_NAME}.conf"

# ============ Color Output ============
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    mkdir -p "$LOG_DIR"
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

success() { log "${GREEN}✅ $1${NC}"; }
warn() { log "${YELLOW}⚠️  $1${NC}"; }
error() { log "${RED}❌ $1${NC}"; exit 1; }

# ============ Pre-check ============
check_requirements() {
    log "🔍 Checking environment requirements..."

    command -v docker >/dev/null 2>&1 || error "Docker is not installed"
    command -v pnpm >/dev/null 2>&1 || error "pnpm is not installed"
    command -v curl >/dev/null 2>&1 || error "curl is not installed"
    command -v nginx >/dev/null 2>&1 || error "nginx is not installed"
    [ -f "$COMPOSE_FILE" ] || error "Compose file not found: $COMPOSE_FILE"
    [ -f "$NGINX_CONFIG_SOURCE" ] || error "Nginx config not found: $NGINX_CONFIG_SOURCE"

    if ss -lnt "( sport = :${HOST_PORT} )" 2>/dev/null | grep -q LISTEN; then
        error "Host port ${HOST_PORT} is already in use"
    fi

    if nginx -t 2>&1; then
        success "Existing Nginx configuration is valid"
    else
        error "Existing Nginx configuration is invalid"
    fi

    # Check Node version
    if [ -f ".nvmrc" ]; then
        REQUIRED_NODE=$(cat .nvmrc)
        CURRENT_NODE=$(node -v | cut -d'v' -f2)
        if [ "$CURRENT_NODE" != "$REQUIRED_NODE" ]; then
            warn "Node version mismatch! Required: $REQUIRED_NODE, Current: $CURRENT_NODE"
            warn "Run 'nvm use' to switch to the correct version"
        else
            success "Node version: $CURRENT_NODE"
        fi
    fi

    success "Environment check passed"
}

# ============ Code Pull ============
pull_code() {
    if [[ "${PULL_CODE:-false}" != "true" ]]; then
        log "📌 Using current checked-out source (set PULL_CODE=true to pull origin/main)"
        return 0
    fi

    log "📥 Pulling latest code..."

    if [ -d ".git" ]; then
        git pull origin main || error "Git pull failed"
        git checkout . || error "Git checkout failed"
    fi

    success "Code update completed"
}

# ============ Install Dependencies ============
install_deps() {
    if [[ "${SKIP_HOST_BUILD:-false}" == "true" ]]; then
        log "📦 Skipping host dependency installation (Docker build mode)"
        return 0
    fi

    log "📦 Installing dependencies..."

    pnpm install --frozen-lockfile || error "Dependency installation failed"

    success "Dependencies installed"
}

# ============ Code Check ============
lint_and_format() {
    log "🔍 Running code checks..."

    if pnpm run lint 2>/dev/null; then
        success "Lint check passed"
    else
        warn "Lint check found issues (fix with: pnpm run lint:fix)"
    fi

    success "Code checks completed"
}

# ============ Build ============
build() {
    if [[ "${SKIP_HOST_BUILD:-false}" == "true" ]]; then
        log "🏗️  Skipping host build (Docker build will validate and build the application)"
        return 0
    fi

    log "🏗️  Building application..."

    pnpm run build || error "Build failed"

    success "Build completed"
}

# ============ Docker Build ============
docker_build() {
    log "🐳 Building Docker image..."

    docker build \
        --tag "${APP_NAME}:${IMAGE_TAG}" \
        --tag "${APP_NAME}:latest" \
        --file docker/Dockerfile \
        . || error "Docker build failed"

    success "Docker image built"
}

# ============ Docker Push ============
docker_push() {
    if [ -z "$DOCKER_REGISTRY" ]; then
        warn "DOCKER_REGISTRY is not set; skipping image push (local build mode)"
        return 0
    fi

    log "📤 Pushing Docker image..."

    docker tag "${APP_NAME}:${IMAGE_TAG}" "${DOCKER_REGISTRY}/${APP_NAME}:${IMAGE_TAG}"
    docker tag "${APP_NAME}:latest" "${DOCKER_REGISTRY}/${APP_NAME}:latest"
    docker push "${DOCKER_REGISTRY}/${APP_NAME}:${IMAGE_TAG}" || error "Docker push failed"
    docker push "${DOCKER_REGISTRY}/${APP_NAME}:latest" || error "Docker push failed"

    success "Docker image pushed"
}

# ============ Deploy ============
deploy() {
    log "🚀 Starting deployment..."

    # Backup
    if [ -d "${DEPLOY_DIR}" ]; then
        BACKUP_NAME="backup-$(date +%Y%m%d-%H%M%S)"
        mkdir -p "${BACKUP_DIR}"
        cp -r "${DEPLOY_DIR}" "${BACKUP_DIR}/${BACKUP_NAME}"
        warn "Backup created at ${BACKUP_DIR}/${BACKUP_NAME}"
    fi

    # Stop old containers
    docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" down --remove-orphans || true

    # Start new containers
    docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --profile prod up -d --build || error "Container startup failed"

    success "Deployment completed"
}

configure_nginx() {
    log "🌐 Installing Nginx reverse-proxy configuration..."

    if [ -f "$NGINX_CONFIG_TARGET" ] && ! cmp -s "$NGINX_CONFIG_SOURCE" "$NGINX_CONFIG_TARGET"; then
        BACKUP_NAME="${NGINX_CONFIG_TARGET}.backup-$(date +%Y%m%d-%H%M%S)"
        cp "$NGINX_CONFIG_TARGET" "$BACKUP_NAME"
        warn "Existing gsap-react Nginx config backed up to $BACKUP_NAME"
    fi

    install -m 0644 "$NGINX_CONFIG_SOURCE" "$NGINX_CONFIG_TARGET"
    nginx -t || error "Nginx configuration validation failed"
    systemctl reload nginx || error "Nginx reload failed"
    success "Nginx configuration installed and reloaded"
}

# ============ Health Check ============
health_check() {
    log "🏥 Running health check..."

    sleep 5

    local retries=10
    while [ $retries -gt 0 ]; do
        if curl -sf http://127.0.0.1:18080/health > /dev/null; then
            success "Health check passed"
            return 0
        fi
        retries=$((retries - 1))
        sleep 3
    done

    error "Health check failed"
}

# ============ Cleanup ============
cleanup() {
    log "🧹 Skipping global Docker prune to avoid affecting other services"
}

# ============ Main ============
main() {
    log "=========================================="
    log "🚀 ${APP_NAME} Deployment Started"
    log "=========================================="

    check_requirements
    pull_code
    install_deps
    lint_and_format
    build

    if [[ "${SKIP_DOCKER:-false}" != "true" ]]; then
        docker_build
        docker_push
        deploy
        configure_nginx
        health_check
    fi

    cleanup

    log "=========================================="
    success "${APP_NAME} Deployment Complete!"
    log "=========================================="
}

main "$@"
