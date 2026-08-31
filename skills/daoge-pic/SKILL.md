---
name: daoge-pic
description: 会话优先的本地图像创作管理 Skill。把用户需求收敛为可确认的创作计划，启动受控的生成运行，并通过本地 DAOGE Pic Studio Workbench 管理资产、选择、复核和交付。
---

# DAOGE Pic vNext

用户可见沟通使用中文。主入口始终是智能体会话；Workbench 只提供项目、轮次、运行和资产的可视管理，不提供第二个聊天界面。

## 会话工作法

1. 先澄清目标、受众、数量、画幅、风格、限制条件、参考素材与交付用途。
2. 用 Studio Session 将当前会话绑定到稳定工作区。
3. 创建项目、创作任务和创作轮次，给出用户可审阅的计划：提示词、数量、输出规格、引用素材与风险。
4. 未得到用户明确确认前，不得发起任何外部 Provider 调用。
5. 确认后执行预检；预检只验证配置、能力、素材和数量，绝不调用 Provider。
6. 预检通过后创建运行。运行由本地 daemon 在后台处理，即使浏览器或终端关闭也可继续。
7. 用会话汇报状态和异常。Workbench 用于查看实时结果、导入素材、保留/复核/淘汰、回收和交付。

不得把用户需求写成遗留 JSON 任务文件，也不得把目录名当作选择、复核、问题或交付状态。

## 工作区与密钥

每次必须使用稳定工作区根目录，传入 --workspace <path> 或明确设置 DAOGE_WORKSPACE_ROOT。没有稳定根目录时停止并向用户索取，不得回退到任意当前目录。

Studio 在工作区内维护：

```text
<workspace>/
  daoge-studio/
    studio.db
    studio.json
    provider.env
    runtime/
    runs/
    cache/
    evidence/
  daoge-assets/
    imports/
    generated/
    exports/
    trash/
  daoge-deliveries/
```

首次启动会从 references/provider.env.example 创建 daoge-studio/provider.env，已有文件绝不覆盖。用户只在此文件配置一个活动 Provider。密钥仅在 daemon/Worker 内存中出现，绝不能写入数据库、事件、导出物、聊天内容或 Workbench 页面。

支持的 IMAGE_PROVIDER：openai-images、gemini-image、gemini-openai-compatible、xai-grok-image。

## 受控命令

统一入口：

```bash
node scripts/daoge.js <command> --workspace <stable-workspace>
```

常用命令：

```bash
node scripts/daoge.js studio --workspace <path>
node scripts/daoge.js open --workspace <path>
node scripts/daoge.js session --workspace <path> --conversation <conversation-id>
node scripts/daoge.js project --workspace <path> --session <session-id> --name "项目名称"
node scripts/daoge.js archive-project --workspace <path> --project <project-id>
node scripts/daoge.js config --workspace <path> --worker-concurrency <1|2|4>
node scripts/daoge.js restart --workspace <path>
node scripts/daoge.js task --workspace <path> --project <project-id> --session <session-id> --name "创作任务" --intent '{"goal":"..."}'
node scripts/daoge.js task-type --workspace <path> --name "自定义任务类型" --definition '{"summary":"..."}'
node scripts/daoge.js style-kit --workspace <path> --name "风格包" --assets <asset-id,...> --definition '{"lighting":"..."}'
node scripts/daoge.js brand-kit --workspace <path> --name "品牌包" --assets <asset-id,...> --definition '{"palette":["..."]}'
node scripts/daoge.js delivery --workspace <path> --project <project-id> --name "交付包" --assets <asset-id,...>
node scripts/daoge.js delivery --workspace <path> --project <project-id> --name "审计交付" --assets <asset-id,...> --creative-record true
node scripts/daoge.js delivery-export --workspace <path> --delivery <delivery-id>
node scripts/daoge.js round --workspace <path> --task <task-id> --session <session-id> --purpose exploration
node scripts/daoge.js session-context --workspace <path> --session <session-id> --project <project-id> --task <task-id> --round <round-id>
node scripts/daoge.js plan --workspace <path> --round <round-id> --version <n> --plan '{"operation":"generate","itemCount":4,"prompt":"..."}'
node scripts/daoge.js confirm --workspace <path> --round <round-id> --version <n>
node scripts/daoge.js preflight --workspace <path> --round <round-id>
node scripts/daoge.js run --workspace <path> --round <round-id> --preflight <dry-run-id>
node scripts/daoge.js pause --workspace <path> --run <run-id>
node scripts/daoge.js resume --workspace <path> --run <run-id> --session <session-id>
node scripts/daoge.js cancel --workspace <path> --run <run-id>
node scripts/daoge.js retry --workspace <path> --run <run-id> [--items <item-id,...>]
node scripts/daoge.js resolve-unknown --workspace <path> --run <run-id> --items <run-item-id,...>
node scripts/daoge.js status --workspace <path>
```

Skill 只能使用这些受控 Studio 命令或同源 Studio API；不得直接写 Studio 文件、SQLite 或运行状态文件。

## 恢复与异常

- Provider 限流或临时故障进入有界重试，不创建重复资产。
- 外部请求的结果不明时，运行项进入 outcome_unknown，绝不自动重放。用户核实无结果后，才可用 resolve-unknown 将指定运行项标记为失败，再确认恢复其余安全项。
- daemon 重启时，未完成运行进入 resume_pending；再次外部调用前必须在会话中得到用户确认，并以 resume --session <session-id> 记录该确认。Workbench 只能显示等待状态，不能绕过会话继续运行。
- retry 只允许对 failed、blocked 或 retry_wait 运行项重试；可指定 --items 做单项重试。outcome_unknown 只能先用 resolve-unknown 明确结案，绝不会作为重试输入。
- archive-project 会在未完成生成全部暂停、完成、失败或取消后，以事务方式归档项目、任务和轮次；不能通过文件夹变更表达归档状态。
- daemon 在启动时固定 Provider 配置、模型、端点身份和 Worker 并发；使用 `config --worker-concurrency <1|2|4>` 只会安全更新期望值，必须再用 `restart` 优雅重启才能生效。
- `restart` 只终止同工作区 daemon、等待其释放运行记录并复用既有启动流程；它不强制杀进程、不删除锁文件，也不绕过 `resume_pending` 的会话确认。
- Provider 配置快照包含模型、端点身份和能力，不包含 API Key、完整 URL 或 Worker 调度参数。Worker 只领取与当前内存配置匹配的运行。
- 预检会产生可审计的干跑预览和运行项计划，不调用 Provider、不创建正式生成资产。入队使用 --preflight 绑定该证据；计划或安全 Provider 快照变化后必须重新预检。显式画幅会按 Provider 规格验证；不支持或不一致的尺寸会在预检拒绝，绝不静默回退为方图。
- 媒体二进制使用提交恢复日志、暂存和原子归档；导入、生成、回收和恢复都在启动时对账，数据库和事件记录资产关系与决策。

## Workbench 边界

Workbench 可用于：查看项目上下文、运行状态、实时资产、导入参考图片、保留/复核/淘汰、回收和恢复。

Workbench 不可用于：自然语言对话、绕过会话确认、展示 Provider 密钥、直接指定任意绝对路径、把文件夹当业务状态。

## 回答规范

每次会话更新简要说明：当前项目/任务/轮次、计划是否待确认、预检结果、运行状态、成功/失败数量及下一步。不要暴露 API Key、完整 Provider 请求、内部 SQLite 细节或临时文件路径。
