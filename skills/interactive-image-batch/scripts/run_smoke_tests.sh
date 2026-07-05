#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[smoke] syntax check"
find "$SKILL_ROOT/scripts" -maxdepth 1 -name '*.js' -print0 | xargs -0 -I{} node --check '{}'

echo "[smoke] v2 workspace refresh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
cat > "$tmp_dir/manifest.json" <<'JSON'
{
  "runtimeMode": "prepare-only",
  "selectedCount": 0,
  "batchCount": 0,
  "defaultSize": "1024x1024"
}
JSON
node "$SKILL_ROOT/scripts/refresh_workspace_v2.js" \
  --output-dir "$tmp_dir" \
  --manifest-file "$tmp_dir/manifest.json" > /dev/null

test -f "$tmp_dir/workspace/index.html"
test -f "$tmp_dir/workspace/prepare.html"
test -f "$tmp_dir/workspace/results.html"
test -f "$tmp_dir/workspace/issues.html"
test -f "$tmp_dir/workspace/record.html"
test -f "$tmp_dir/internal/workspace_state.json"
test -f "$tmp_dir/internal/view_models/index.json"
test -f "$tmp_dir/debug/compat/manifest.json"
! test -f "$tmp_dir/manifest.json"

if grep -R -E "template|variant|manifest|registry|runtime|artifact|slot" "$tmp_dir/workspace" >/dev/null; then
  echo "[smoke] user-facing internal term leak" >&2
  exit 1
fi

echo "[smoke] done"

echo "[smoke] prepare -> execute workspace chain"
chain_dir="$tmp_dir/chain"
cat > "$tmp_dir/.env" <<'ENV'
OPENAI_BASE_URL=https://example.com/v1
OPENAI_API_KEY=test-key
OPENAI_MODEL=gpt-image-2
ENV
node "$SKILL_ROOT/scripts/daoge_prepare_run.js" \
  --task-spec "$SKILL_ROOT/tests/fixtures/task_spec.minimal.json" \
  --strategy-file "$SKILL_ROOT/tests/fixtures/prompt_strategy.minimal.json" \
  --prompts-file "$SKILL_ROOT/tests/fixtures/prompts.minimal.json" \
  --output-dir "$chain_dir" \
  --batch-size 1 > /dev/null
node "$SKILL_ROOT/scripts/run_batch.js" \
  --prompts-file "$SKILL_ROOT/tests/fixtures/prompts.minimal.json" \
  --env-file "$tmp_dir/.env" \
  --dry-run true \
  --output-dir "$chain_dir" \
  --batch-size 1 \
  --concurrency 1 > /dev/null
test -f "$chain_dir/workspace/index.html"
test -f "$chain_dir/internal/run_plan.json"
test -f "$chain_dir/internal/asset_library.json"
test -f "$chain_dir/assets/exports/report.html"

echo "[smoke] host-native ingest workspace chain"
host_dir="$tmp_dir/host"
node -e "require('fs').writeFileSync('$tmp_dir/host.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pS3FoAAAAAASUVORK5CYII=', 'base64'))"
cat > "$tmp_dir/host_pack.json" <<JSON
{
  "runtime_mode": "host-native-image-tool",
  "prompt_count": 1,
  "task_summary": { "content_brief": "人物主视觉", "batch_size": 1, "width": 1024, "height": 1024 }
}
JSON
cat > "$tmp_dir/host_results.json" <<JSON
[
  { "index": "001", "title": "人物主视觉", "requestMode": "prompt-only", "output": "$tmp_dir/host.png", "status": "success" }
]
JSON
node "$SKILL_ROOT/scripts/ingest_host_native_results.js" \
  --prompt-pack-file "$tmp_dir/host_pack.json" \
  --results-file "$tmp_dir/host_results.json" \
  --output-dir "$host_dir" > /dev/null
test -f "$host_dir/workspace/results.html"
test -f "$host_dir/internal/execution_manifest.json"
test "$(find "$host_dir/assets/selected" -type f | wc -l | tr -d ' ')" -ge 1

echo "[smoke] exception and rerun candidate chain"
issue_dir="$tmp_dir/issues"
cat > "$issue_dir.manifest.json" <<JSON
{
  "runtimeMode": "local-batch-runner",
  "selectedCount": 1,
  "success": 0,
  "failed": 1,
  "batches": [
    { "batchNumber": 1, "results": [
      { "index": 1, "ok": false, "error": "timeout", "worthRerun": true, "rerunReason": "关键镜头失败" }
    ] }
  ]
}
JSON
node "$SKILL_ROOT/scripts/refresh_workspace_v2.js" \
  --output-dir "$issue_dir" \
  --manifest-file "$issue_dir.manifest.json" > /dev/null
test -f "$issue_dir/workspace/issues.html"
node -e "const q=require('$issue_dir/internal/issue_queue.json'); if(!q.items.some(i=>i.type==='rerun_candidate')) process.exit(1)"

for dir in "$tmp_dir" "$chain_dir" "$host_dir" "$issue_dir"; do
  for file in workspace_home.html prepare_workspace.html result_workspace.html exception_workspace.html run_record.html completion_board.html rerun_board.html review_board.html prompt_preview.html preflight_board.html assets_board.html storyboard_board.html; do
    if test -f "$dir/$file"; then
      echo "[smoke] legacy root page still generated: $dir/$file" >&2
      exit 1
    fi
  done
done

legacy_entry_pattern="workspace_home\\.html|prepare_workspace\\.html|result_workspace\\.html|exception_workspace\\.html|run_record\\.html"
for file in \
  "$tmp_dir/task_center.html" \
  "$tmp_dir/task_center_state.json" \
  "$tmp_dir/daoge_run_index.md" \
  "$chain_dir/entry_state.json" \
  "$chain_dir/selection_board.md" \
  "$host_dir/entry_state.json" \
  "$host_dir/selection_board.md" \
  "$issue_dir/entry_state.json" \
  "$issue_dir/selection_board.md"; do
  if test -f "$file" && grep -E "$legacy_entry_pattern" "$file" >/dev/null; then
    echo "[smoke] retired workspace page leaked into user next step: $file" >&2
    exit 1
  fi
done

echo "[smoke] done"
