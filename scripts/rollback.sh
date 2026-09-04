#!/bin/bash
set -euo pipefail

APP_NAME="gsap-react"
BACKUP_DIR="/opt/${APP_NAME}/backups"
MAX_BACKUPS=5

rollback() {
    echo "=========================================="
    echo "⏪ Rolling back ${APP_NAME}"
    echo "=========================================="

    # List available backups
    echo "📦 Available backups:"
    ls -1t "${BACKUP_DIR}" | head -n "$MAX_BACKUPS"

    # Get latest backup
    latest_backup=$(ls -1t "${BACKUP_DIR}" | head -1)

    if [ -z "$latest_backup" ]; then
        echo "❌ No backups available"
        exit 1
    fi

    echo ""
    echo "🔄 Rolling back to: ${latest_backup}"
    echo ""

    # Confirm
    read -p "Confirm rollback? (y/n) " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Rollback cancelled"
        exit 0
    fi

    # Stop current container
    docker compose -f docker/docker-compose.yml down

    # Restore backup
    rm -rf "/opt/${APP_NAME}"
    cp -r "${BACKUP_DIR}/${latest_backup}" "/opt/${APP_NAME}"

    # Restart
    docker compose -f docker/docker-compose.yml up -d

    echo ""
    echo "✅ Rollback completed"
    echo "=========================================="
}

rollback
