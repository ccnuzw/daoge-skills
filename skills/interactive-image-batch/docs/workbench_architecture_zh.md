# DAOGE 本地 Workbench 架构

## 目标

DAOGE 从静态 HTML 批量生图脚本升级为本地资产管理工作台：

- skills：智能入口，负责把需求转成任务和提示词。
- CLI：执行引擎，负责 `init`、`prepare`、`execute`、`ingest`、`rerun`、`review`、`open`、`export`。
- SQLite：状态中枢，保存项目、运行、提示词、资产索引、问题、选择、标签、导出、任务和事件。
- `assets/`：文件仓库，保存输入、参考图、结果、缩略图、导出包和归档。
- Workbench：固定前端应用，由 `daoge open` 启动本地 server 托管。
- `snapshots/`：可审计 JSON 快照，避免数据库成为黑盒。

## 项目目录

```text
project/
  daoge.db
  assets/
    inputs/
    references/
    results/
    thumbs/
    exports/
    archive/
  snapshots/
    run_*.json
    import_*.json
    export_*.json
  debug/
  internal/
  workspace/
```

`workspace/` 继续生成兼容静态页面，但新主入口是：

```bash
node scripts/daoge.js open --output-dir out
```

## SQLite schema 摘要

- `schema_migrations`：schema 版本记录。
- `projects`：项目根目录和项目名。
- `runs`：prepare、execute、ingest、rerun 的运行记录。
- `prompts`：提示词文本、编号、参数和来源。
- `run_items`：每个运行项的状态、输出路径和错误。
- `assets`：资产索引和元数据；不存图片二进制。
- `asset_links`：prompt、reference、result、thumb、export 的血缘关系。
- `issues`：失败、缺文件、待复核和补跑候选。
- `selections`：选择或不采用状态。
- `tags` / `asset_tags`：标签。
- `exports`：报告和资产包。
- `jobs`：补跑等本地任务。
- `events`：追加式事件日志。
- `settings`：项目设置。

事件类型包括：`project_created`、`run_prepared`、`prompt_generated`、`run_started`、`asset_created`、`issue_opened`、`issue_resolved`、`asset_selected`、`asset_rejected`、`rerun_requested`、`export_created`。

## HTTP API

本地 server 默认绑定 `127.0.0.1`，统一返回：

```json
{ "ok": true, "data": {} }
```

错误：

```json
{ "ok": false, "error": { "code": "CODE", "message": "中文错误", "nextAction": "下一步" } }
```

核心 API：

- `GET /api/health`
- `GET /api/project`
- `GET /api/runs`
- `GET /api/runs/:id`
- `GET /api/assets?kind=&status=&run_id=&tag=&q=`
- `GET /api/assets/:id`
- `GET /api/assets/:id/file`
- `GET /api/assets/:id/thumb`
- `GET /api/issues`
- `POST /api/issues/:id/resolve`
- `POST /api/selections`
- `DELETE /api/selections/:asset_id`
- `POST /api/assets/:id/tags`
- `GET /api/jobs`
- `POST /api/jobs/rerun`
- `GET /api/events`
- `GET /api/exports`
- `POST /api/exports/report`

资产文件必须通过 asset id 查 DB 后访问。server 会检查最终路径仍在当前 workspace 内，阻止 path traversal。

## Workbench UI

固定应用位于 `app/`：

- `app/index.html`
- `app/styles/workbench.css`
- `app/src/workbench.js`

页面：

- 总览：运行数、提示词数、资产数、问题数、已选数。
- 资产：网格、搜索、状态筛选、预览、选择、不采用、标签。
- 任务：运行记录。
- 问题：问题列表、处理状态、resolve。
- Prompt Lab：提示词列表、详情、复制。
- 模板：保留固定入口。
- 导出：报告和资产包记录。

## 兼容迁移

`daoge open` 若发现没有 `daoge.db`，会尝试从以下文件导入：

- `debug/task_spec.normalized.json`
- `debug/prompts.generated.json`
- `internal/execution_manifest.json`
- `internal/issue_queue.json`
- `internal/asset_library.json`
- `internal/workspace_state.json`

导入后写入 `snapshots/import_*.json`。旧 `review` 仍可刷新 `workspace/index.html` 等静态页面。
