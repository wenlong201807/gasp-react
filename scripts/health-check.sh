#!/bin/bash
set -euo pipefail

ENDPOINT="${1:-http://localhost:80/health}"
TIMEOUT=5

check_http() {
    if curl -sf --max-time "$TIMEOUT" "$ENDPOINT" > /dev/null; then
        echo "✅ HTTP health check passed"
        return 0
    else
        echo "❌ HTTP health check failed"
        return 1
    fi
}

check_process() {
    if docker ps --format '{{.Names}}' | grep -q "gsap-react"; then
        echo "✅ Container is running"
        return 0
    else
        echo "❌ Container is not running"
        return 1
    fi
}

check_logs() {
    local errors
    errors=$(docker compose -f docker/docker-compose.yml logs --tail=50 2>&1 | grep -i "error\|fatal" || true)

    if [ -n "$errors" ]; then
        echo "⚠️  Found error logs:"
        echo "$errors"
        return 1
    else
        echo "✅ No errors in logs"
        return 0
    fi
}

main() {
    echo "=========================================="
    echo "🏥 Health Check"
    echo "=========================================="

    local result=0

    check_http || result=1
    check_process || result=1
    check_logs || result=1

    echo "=========================================="

    if [ $result -eq 0 ]; then
        echo "✅ All checks passed"
        exit 0
    else
        echo "❌ Some checks failed"
        exit 1
    fi
}

main "$@"
