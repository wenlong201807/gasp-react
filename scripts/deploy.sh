#!/bin/bash
set -euo pipefail

# ============ Configuration ============
APP_NAME="gsap-react"
DEPLOY_DIR="/opt/${APP_NAME}"
BACKUP_DIR="/opt/${APP_NAME}/backups"
DOCKER_REGISTRY="${DOCKER_REGISTRY:-registry.example.com}"
IMAGE_TAG="${1:-latest}"
LOG_FILE="/var/log/${APP_NAME}/deploy.log"

# ============ Color Output ============
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
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
    log "📥 Pulling latest code..."

    if [ -d ".git" ]; then
        git pull origin main || error "Git pull failed"
        git checkout . || error "Git checkout failed"
    fi

    success "Code update completed"
}

# ============ Install Dependencies ============
install_deps() {
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
    log "🏗️  Building application..."

    pnpm run build || error "Build failed"

    success "Build completed"
}

# ============ Docker Build ============
docker_build() {
    log "🐳 Building Docker image..."

    docker build \
        --tag "${DOCKER_REGISTRY}/${APP_NAME}:${IMAGE_TAG}" \
        --tag "${DOCKER_REGISTRY}/${APP_NAME}:latest" \
        --file docker/Dockerfile \
        . || error "Docker build failed"

    success "Docker image built"
}

# ============ Docker Push ============
docker_push() {
    log "📤 Pushing Docker image..."

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
    docker compose -f docker/docker-compose.yml down || true

    # Start new containers
    docker compose -f docker/docker-compose.yml --profile prod up -d || error "Container startup failed"

    success "Deployment completed"
}

# ============ Health Check ============
health_check() {
    log "🏥 Running health check..."

    sleep 5

    local retries=10
    while [ $retries -gt 0 ]; do
        if curl -sf http://localhost:80/health > /dev/null; then
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
    log "🧹 Cleaning up build cache..."

    docker builder prune -f || true
    docker image prune -f || true

    success "Cleanup completed"
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
        health_check
    fi

    cleanup

    log "=========================================="
    success "${APP_NAME} Deployment Complete!"
    log "=========================================="
}

main "$@"
