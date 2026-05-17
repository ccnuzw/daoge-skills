#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_ROOT/../.." && pwd)"

echo "[smoke] syntax check: scripts/*.js"
find "$SKILL_ROOT/scripts" -maxdepth 1 -name '*.js' -print0 | xargs -0 -I{} node --check '{}'

echo "[smoke] node tests: skills/interactive-image-batch/tests/smoke.test.js"
(
  cd "$REPO_ROOT"
  node --test skills/interactive-image-batch/tests/smoke.test.js
)

echo "[smoke] done"
