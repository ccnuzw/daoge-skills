#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_ROOT/../.." && pwd)"

echo "[smoke] syntax check: scripts/*.js"
find "$SKILL_ROOT/scripts" -maxdepth 1 -name '*.js' -print0 | xargs -0 -I{} node --check '{}'

echo "[smoke] template mainline validation"
(
  cd "$SKILL_ROOT"
  node scripts/detect_runtime_mode.js > /dev/null
  node scripts/validate_template_registry.js
  node scripts/render_template_registry_report.js \
    --report-file "$SKILL_ROOT/references/template_registry_validation_report.json"
)

echo "[smoke] host-native prompt pack fixture"
(
  cd "$REPO_ROOT"
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT
  cp "$SKILL_ROOT/tests/fixtures/prompts.minimal.json" "$tmp_dir/prompts.generated.json"
  cp "$SKILL_ROOT/tests/fixtures/task_spec.minimal.json" "$tmp_dir/task_spec.normalized.json"
  cat > "$tmp_dir/prompt_strategy.normalized.json" <<'JSON'
{
  "template_variant": {
    "id": "campaign-poster",
    "name": "Campaign Poster",
    "template_doc": "references/templates/poster-and-campaigns/campaign-poster.md"
  }
}
JSON
  cat > "$tmp_dir/runtime_mode.json" <<'JSON'
{
  "mode": "host-native-image-tool",
  "recommendation": "use-host-native-light-path",
  "summary": "检测到宿主原生图像工具信号，建议输出轻量 prompt 包后交给宿主执行。"
}
JSON
  node "$SKILL_ROOT/scripts/build_host_native_prompt_pack.js" \
    --prompts-file "$tmp_dir/prompts.generated.json" \
    --task-spec "$tmp_dir/task_spec.normalized.json" \
    --strategy-file "$tmp_dir/prompt_strategy.normalized.json" \
    --runtime-mode-file "$tmp_dir/runtime_mode.json" \
    --output-dir "$tmp_dir/out" > /dev/null
  test -f "$tmp_dir/out/host_native_prompt_pack.json"
  test -f "$tmp_dir/out/host_native_summary.md"
  test -f "$tmp_dir/out/host_native_summary.html"
)

echo "[smoke] host-native result ingest fixture"
(
  cd "$REPO_ROOT"
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT
  printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pS3FoAAAAAASUVORK5CYII=' | base64 -d > "$tmp_dir/host_result_1.png"
  printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pS3FoAAAAAASUVORK5CYII=' | base64 -d > "$tmp_dir/host_result_2.png"
  cat > "$tmp_dir/host_native_prompt_pack.json" <<JSON
{
  "runtime_mode": "host-native-image-tool",
  "recommendation": "use-host-native-light-path",
  "prompts_file": "$tmp_dir/prompts.generated.json",
  "prompt_count": 2,
  "task_summary": {
    "content_brief": "高端时尚竖版海报",
    "output_mode": "photoreal campaign poster",
    "batch_size": 1,
    "width": 1440,
    "height": 2560
  },
  "template": {
    "id": "campaign-poster",
    "name": "Campaign Poster"
  }
}
JSON
  cat > "$tmp_dir/host_native_results.json" <<JSON
[
  {
    "index": "001",
    "title": "Host Success",
    "output": "$tmp_dir/host_result_1.png",
    "slotId": "shot_1",
    "requestMode": "prompt-only",
    "status": "success",
    "scene": "studio",
    "composition": "full body",
    "styleFamily": "brand",
    "slotRole": "hero"
  },
  {
    "index": "002",
    "title": "Host Review",
    "output": "$tmp_dir/host_result_2.png",
    "slotId": "shot_2",
    "requestMode": "masked-edit",
    "status": "needs_review",
    "scene": "window",
    "composition": "medium shot",
    "textPolicy": "leave top and bottom clean for later typography",
    "styleFamily": "brand",
    "slotRole": "detail"
  },
  {
    "index": "003",
    "title": "Host Failed",
    "slotId": "shot_3",
    "requestMode": "reference-assisted",
    "status": "failed",
    "error": "provider timeout",
    "styleFamily": "brand",
    "slotRole": "detail"
  }
]
JSON
  node "$SKILL_ROOT/scripts/ingest_host_native_results.js" \
    --prompt-pack-file "$tmp_dir/host_native_prompt_pack.json" \
    --results-file "$tmp_dir/host_native_results.json" \
    --output-dir "$tmp_dir/out" > /dev/null
  test -f "$tmp_dir/out/manifest.json"
  test -f "$tmp_dir/out/workspace_home.html"
  test -f "$tmp_dir/out/result_workspace.html"
  test -f "$tmp_dir/out/exception_workspace.html"
  test ! -f "$tmp_dir/out/review_board.html"
  test ! -f "$tmp_dir/out/result_hub.html"
  test ! -f "$tmp_dir/out/completion_board.html"
)

echo "[smoke] host-native results schema fixture"
(
  cd "$REPO_ROOT"
  node "$SKILL_ROOT/scripts/validate_host_native_results.js" \
    --results-file "$SKILL_ROOT/references/examples/host-native/host_native_results.example.json" > /dev/null
)

echo "[smoke] node tests: skills/interactive-image-batch/tests/smoke.test.js"
(
  cd "$REPO_ROOT"
  node --test skills/interactive-image-batch/tests/smoke.test.js
)

echo "[smoke] done"
