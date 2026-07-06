# DAOGE 生图工作台架构

当前版本目标：一个入口、一个状态源、五个用户页面、四类目录。

## 分层

- `src/cli/`：命令入口，只解析参数并调用服务。
- `src/contracts/`：集中定义契约和基础校验。
- `src/domain/`：任务准备、执行计划、执行结果、问题队列、资产库、工作台状态。
- `src/providers/`：OpenAI Images 和宿主原生结果适配。
- `src/renderers/`：HTML 页面渲染。
- `src/shared/`：文件、路径、JSON、环境变量等通用能力。

## 输出目录

- `workspace/`：普通用户页面，只包含 `index.html`、`prepare.html`、`results.html`、`issues.html`、`record.html`。
- `assets/`：普通用户资产，按输入、参考、遮罩、结果、复核、问题、已选、交付、归档整理。
- `internal/`：机器状态和页面视图模型。
- `debug/`：维护诊断。

## 状态源

`internal/workspace_state.json` 是唯一工作台状态源。页面只读取 `internal/view_models/*.json`。

核心契约：

- `internal/run_plan.json`
- `internal/execution_manifest.json`
- `internal/issue_queue.json`
- `internal/asset_library.json`
- `internal/workspace_state.json`
- `internal/view_models/*.json`

关键 JSON 写入通过临时文件加 rename 完成。

## 主流程

准备：

1. 读取任务说明
2. 如果用户未提供提示词列表，自动生成可执行提示词
3. 按来源文件目录解析任务素材和提示词素材
4. 校验任务、策略和提示词
5. 生成准备阶段契约
6. 刷新工作台

执行：

1. 从命令参数、`debug/prompts.generated.json` 或准备记录中找到提示词列表
2. 按提示词文件目录解析参考图和遮罩
3. 按批次执行或干跑
4. provider 执行文生图、图生图或 mask 编辑
5. 生成执行记录
6. 构建问题队列和资产库
7. 刷新工作台

宿主回填：

1. 读取宿主结果
2. 按 `host_native_results` 契约校验字段名和状态值
3. 校验通过后才创建或刷新工作台
4. 按结果文件目录解析相对 output
5. 标准化为执行记录
6. 复用同一套问题队列、资产库和工作台刷新

失败复跑：

1. 读取上次执行记录
2. 选择失败项
3. 执行或干跑
4. 生成新工作台

复核刷新：

1. 读取已有准备或执行记录
2. 重建 `internal/` 核心契约
3. 重渲染五个 `workspace/` 页面
4. 移除旧工作台文件名残留

## provider 接口

所有 provider 适配只暴露：

- `generate(request)`
- `edit(request)`
- `capabilities()`

执行器不关心底层走 Images API、Responses 图像工具或宿主原生结果。

## 页面规则

每页只有一个主动作。普通用户页面不展示工程词；维护信息进入 `internal/` 或 `debug/`。

页面职责：

- `index.html`：当前任务、阶段、下一步
- `prepare.html`：开跑前检查
- `results.html`：结果筛选和资产入口
- `issues.html`：问题处理
- `record.html`：任务回看
