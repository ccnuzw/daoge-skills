#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[smoke] syntax"
find "$SKILL_ROOT/src" -name '*.js' -print0 | xargs -0 -I{} node --check '{}'
find "$SKILL_ROOT/scripts" -maxdepth 1 -name '*.js' -print0 | xargs -0 -I{} node --check '{}'

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cat > "$tmp_dir/.env" <<'ENV'
OPENAI_BASE_URL=https://example.com/v1
OPENAI_API_KEY=test-key
OPENAI_MODEL=gpt-image-2
ENV

echo "[smoke] prepare"
prepare_dir="$tmp_dir/prepare"
node "$SKILL_ROOT/scripts/daoge.js" prepare \
  --task-spec "$SKILL_ROOT/tests/fixtures/task_spec.minimal.json" \
  --output-dir "$prepare_dir" \
  --batch-size 1 > /dev/null
test -f "$prepare_dir/workspace/index.html"
test -f "$prepare_dir/internal/workspace_state.json"
test -f "$prepare_dir/internal/view_models/prepare.json"
test -f "$prepare_dir/debug/prompts.generated.json"
! test -f "$prepare_dir/manifest.json"

echo "[smoke] execute dry-run after prepare"
node "$SKILL_ROOT/scripts/daoge.js" execute \
  --env-file "$tmp_dir/.env" \
  --dry-run true \
  --output-dir "$prepare_dir" \
  --batch-size 1 \
  --concurrency 1 > /dev/null
test -f "$prepare_dir/workspace/results.html"
test -f "$prepare_dir/internal/local_execution_raw.json"
test -f "$prepare_dir/assets/exports/report.html"

echo "[smoke] relative reference and mask"
prompt_dir="$tmp_dir/prompt_pack"
mkdir -p "$prompt_dir/refs" "$prompt_dir/masks"
node -e "require('fs').writeFileSync('$prompt_dir/refs/base.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pS3FoAAAAAASUVORK5CYII=', 'base64')); require('fs').writeFileSync('$prompt_dir/masks/mask.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pS3FoAAAAAASUVORK5CYII=', 'base64'))"
cat > "$prompt_dir/prompts.json" <<JSON
[
  { "index": 1, "title": "相对参考图", "generation_prompt": "reference assisted image", "reference_images": ["refs/base.png"] },
  { "index": 2, "title": "相对遮罩", "generation_prompt": "masked edit image", "reference_images": ["refs/base.png"], "edit_mask": "masks/mask.png" }
]
JSON
relative_dir="$tmp_dir/relative"
(cd "$tmp_dir" && node "$SKILL_ROOT/scripts/daoge.js" execute \
  --prompts-file "$prompt_dir/prompts.json" \
  --env-file "$tmp_dir/.env" \
  --dry-run true \
  --output-dir "$relative_dir" \
  --batch-size 1 > /dev/null)
node -e "const m=require('$relative_dir/internal/local_execution_raw.json'); if(m.failed!==0||m.skipped!==2) process.exit(1)"

echo "[smoke] missing material issue"
missing_dir="$tmp_dir/missing"
cat > "$prompt_dir/missing_prompts.json" <<JSON
[
  { "index": 1, "title": "缺参考图", "generation_prompt": "reference assisted image", "reference_images": ["refs/missing.png"] }
]
JSON
node "$SKILL_ROOT/scripts/daoge.js" execute \
  --prompts-file "$prompt_dir/missing_prompts.json" \
  --env-file "$tmp_dir/.env" \
  --dry-run true \
  --output-dir "$missing_dir" \
  --batch-size 1 > /dev/null
node -e "const q=require('$missing_dir/internal/issue_queue.json'); if(!q.items.some(i=>i.type==='hard_failure')) process.exit(1)"

echo "[smoke] host ingest"
host_dir="$tmp_dir/host"
node -e "require('fs').writeFileSync('$tmp_dir/host.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pS3FoAAAAAASUVORK5CYII=', 'base64'))"
cat > "$tmp_dir/host_pack.json" <<JSON
{
  "runtime_mode": "host-native-image-tool",
  "prompt_count": 1,
  "task_summary": { "content_brief": "人物主视觉", "batch_size": 1, "width": 1024, "height": 1024 }
}
JSON
host_source_dir="$tmp_dir/host_source"
mkdir -p "$host_source_dir"
cp "$tmp_dir/host.png" "$host_source_dir/host.png"
cat > "$host_source_dir/host_results.json" <<JSON
[
  { "index": "001", "title": "人物主视觉", "requestMode": "prompt-only", "output": "host.png", "status": "success" }
]
JSON
node "$SKILL_ROOT/scripts/daoge.js" ingest \
  --prompt-pack-file "$tmp_dir/host_pack.json" \
  --results-file "$host_source_dir/host_results.json" \
  --output-dir "$host_dir" > /dev/null
test -f "$host_dir/workspace/results.html"
test -f "$host_dir/internal/execution_manifest.json"
test "$(find "$host_dir/assets/selected" -type f | wc -l | tr -d ' ')" -ge 1

echo "[smoke] issue page"
issue_dir="$tmp_dir/issues"
cat > "$tmp_dir/issue_manifest.json" <<JSON
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
node "$SKILL_ROOT/scripts/daoge.js" refresh \
  --output-dir "$issue_dir" \
  --manifest-file "$tmp_dir/issue_manifest.json" > /dev/null
test -f "$issue_dir/workspace/issues.html"
node -e "const q=require('$issue_dir/internal/issue_queue.json'); if(!q.items.some(i=>i.type==='rerun_candidate')) process.exit(1)"

if grep -R -E "template|variant|manifest|registry|runtime|artifact|slot" "$prepare_dir/workspace" "$host_dir/workspace" "$issue_dir/workspace" >/dev/null; then
  echo "[smoke] user-facing internal term leak" >&2
  exit 1
fi

legacy_files="workspace_home.html prepare_workspace.html result_workspace.html exception_workspace.html run_record.html review_board.html completion_board.html run_overview.html rerun_board.html preflight_board.html prompt_preview.html"
for dir in "$prepare_dir" "$host_dir" "$issue_dir"; do
  for file in $legacy_files; do
    if test -f "$dir/$file" || test -f "$dir/workspace/$file"; then
      echo "[smoke] retired workspace page generated: $dir/$file" >&2
      exit 1
    fi
  done
done

if grep -R -E "workspace_home\.html|prepare_workspace\.html|result_workspace\.html|exception_workspace\.html|run_record\.html" "$prepare_dir/workspace" "$host_dir/workspace" "$issue_dir/workspace" >/dev/null; then
  echo "[smoke] retired workspace page leaked into user page" >&2
  exit 1
fi

echo "[smoke] done"
