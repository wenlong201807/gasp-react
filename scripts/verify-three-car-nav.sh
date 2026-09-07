#!/bin/bash
# three-car-nav 全链验证闸门（计划 Task 9 Step 3）：
# pnpm lint → pnpm build → Playwright 套件 TC-01..TC-12 → 打印 artifacts 证据目录。
# 任一环节失败即停（set -euo pipefail），全部通过 exit 0。
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== [verify 1/3] pnpm lint ==="
pnpm lint

echo
echo "=== [verify 2/3] pnpm build ==="
pnpm build

echo
echo "=== [verify 3/3] Playwright 套件 TC-01..TC-12 ==="
node script/three-car-nav/run.mjs

echo
echo "=== verify 全链通过 ✅ 证据目录 ==="
latest="$(ls -t artifacts/three-car-nav | head -1)"
echo "artifacts/three-car-nav/${latest}"
