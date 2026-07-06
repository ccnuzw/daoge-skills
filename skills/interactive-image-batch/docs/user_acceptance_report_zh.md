# DAOGE 发布前用户入口验收报告

本文按普通用户视角验收 `interactive-image-batch` 的第一轮任务入口。目标是确认用户只需理解少量命令和一个工作台入口。

## 验收路径 1：本地 dry-run

命令：

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
node scripts/daoge.js execute --output-dir out --env-file .env --dry-run true --batch-size 1
open out/workspace/index.html
```

用户可见产物：

- `workspace/index.html`
- `workspace/prepare.html`
- `workspace/results.html`
- `workspace/issues.html`
- `workspace/record.html`
- `assets/`

用户下一步：打开 `workspace/index.html`。页面会显示当前阶段、主动作和可回复句子。

验收结论：通过。该路径不调用 provider，可从零验证 prepare、execute、workspace 刷新、record 生成和 debug 文件隔离。

## 验收路径 2：真实 provider 小样本

命令：

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
node scripts/daoge.js execute --output-dir out --env-file .env --batch-size 1 --concurrency 1
open out/workspace/results.html
```

用户可见产物：

- `workspace/results.html`
- `assets/results/`
- `assets/selected/`
- `assets/exports/`
- `workspace/record.html`

用户下一步：先看 `workspace/results.html` 筛选结果；需要回看时打开 `workspace/record.html`。

验收结论：通过可执行脚本和 mock-provider smoke。真实 OpenAI provider 需要 `.env` 中的有效 `OPENAI_API_KEY`；没有 key 时不强跑真实网络请求。

## 验收路径 3：host-native 回填

命令：

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
# 宿主侧生成 host_native_results.json
node scripts/daoge.js ingest --results-file host_native_results.json --output-dir out
open out/workspace/index.html
```

如果宿主侧另有交接包，可额外传 `--prompt-pack-file host_native_prompt_pack.json`。`host_native_results.json` 里的相对 `output` 路径按该文件所在目录解析。

用户可见产物：

- `workspace/index.html`
- `workspace/results.html`
- `workspace/issues.html`
- `workspace/record.html`
- `assets/results/`
- `assets/review/`
- `assets/issues/`

用户下一步：从 `workspace/index.html` 进入结果或问题页。成功结果进 `results`，待复核进 `review`，失败进 `issues`。

验收结论：通过。ingest 前会校验 `host_native_results.json`，无效结果不会进入工作台。

## 已补测试与 fixtures

- `tests/integration/user_acceptance_paths.test.js`：覆盖 README 第一入口、本地 dry-run、mock provider 小样本、host-native ingest、缺素材落 issues。
- `scripts/run_smoke_tests.sh`：覆盖 prepare、dry-run、mock provider、host-native、缺素材、问题页、旧路径和内部术语泄露检查。
- `tests/fixtures/task_spec.provider_small.json`：真实 provider 小样本。
- `tests/fixtures/task_spec.with_reference.json`：带参考图任务。
- `tests/fixtures/task_spec.missing_material.json`：缺素材任务。
- `tests/fixtures/host_native_results.mixed.json`：host-native 成功、失败、待复核混合结果。

## 已修复问题

- README 补充 dry-run 和真实小样本命令。
- README 明确 `internal/`、`debug/` 不是普通用户入口。
- smoke 增加非 dry-run provider 路径，使用本地 mock endpoint，避免依赖真实 API key。
- host-native smoke 改为先 prepare，再 ingest 宿主结果。

## 下一阶段风险

- 真实 provider 端到端仍依赖有效 `.env` 和网络环境；本轮用 mock-provider 锁住 CLI 与工作台链路。
- `references/examples/examples_catalog.html` 是入口页面契约，但当前验收重点是 run 内工作台路径。
