# DAOGE Pic v5.14.1 发布说明

- 发布日期：2026-09-15
- Git 标签：`daoge-pic-v5.14.1`
- 状态：正式发布
- 影响 Skill：`daoge-pic`。
- package/runtime 版本：`5.14.1`。
- Skill protocol：`daoge-pic-skill-protocol/2.0.0`（独立于制品版本）。
- 运行时兼容范围：`>=5.14.1 <6.0.0`。
- Studio schema：`34`（本版本无 schema 变更）。
- 分发渠道：GitHub Release 不可变 `.tgz` 资产；不发布到 npm registry。

## 本次更新

本次是补丁发布，只修复上一版本暴露的可用性缺陷，不引入新的产品行为、Provider 契约或 Studio schema 变更。

### Provider 设置面板

- 连接测试不再自相矛盾。面板原先把只接受 `POST` 的生成端点当探针，`GET` 必然返回 404，却把结果渲染成「端点可达（HTTP 404）」。现在按 Provider 是否声明模型列表选择探针：有列表时探测模型列表端点，没有列表时回退到生成端点，连通性回执如实反映真实探测结果。
- 「获取模型」返回真实模型清单。此前该动作只回显「Provider 细节已脱敏」这类占位文案，用户看不到也无法选择 Provider 实际提供的模型；现在从模型列表端点读取并展示真实结果，失败时按凭据或后端问题归类。
- 错误分类补齐：新增 `secret_backend` 分类，`400/422` 归入校验类，密钥后端冲突 `409` 单独提示，面板报错指向真正原因而不是笼统失败。
- 面板按钮在浏览器里可用。同源 Workbench 调用者恢复访问这些凭据端点（此前只接受 bearer 请求，导致「本地校验 / 连接测试 / 获取模型」三个按钮在 Workbench 页面上不可用），同时删除面板中提示这三个动作需要回命令行的说明块。

### 上下文与路由

- 修复误报「请先打开生成运行视图，再继续查看运行。」。根因是路由不变量只在部分入口生效：`normalizeRoute` 在计划、结果、轮次对比、资产与概览视图上仍保留 `runId`，而上下文加载器把「视图不渲染运行却携带 `runId`」判定为错误，于是上下文栏一半以上的标签都会亮出无法消除的错误横幅。现在 `runId` 的保留与丢弃由唯一的 `normalizeRoute` 决定，手改 URL 或打开旧书签同样被收口。
- 缺失的层级上下文自动降级。请求的上下文层级（轮次 / 任务）背后没有实际对象时不再保留，避免资产刷新路径返回空值、资产列表静默停留在错误范围。

## 发布制品

- 文件：`daoge-pic-5.14.1.tgz`
- 大小：605,624 bytes
- npm shasum：`30ae270012683d90528f18019f50f38a142acdbb`
- SHA-256：`41eb6d6a39caa976d4cf0e059cf1b66239de77ea0d2909cefb9743cace3cf258`
- GitHub Release 资产：https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.14.1/daoge-pic-5.14.1.tgz
- checksum sidecar：`skills/daoge-pic/daoge-pic-5.14.1.tgz.sha256`

## 验证结果

- `npm run typecheck:vnext`：通过。
- `npm run build`：vNext TypeScript 与 Vite Workbench 构建通过；Vite 转换 1624 个模块，Workbench JS 642.60 kB、CSS 218.85 kB；chunk size 提示为非阻断 warning。
- `npm test`：576 项测试，574 通过、0 失败、0 取消、2 项仅 Windows 实机用例跳过。
- `npm run test:package`：发布清单 164 个文件，`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`；临时 consumer 安装、真实 bin、register-skill、doctor 和 `sharp` 全部通过。
- 实机复验：本机 Studio daemon 重启后，Provider 面板的本地校验、连接测试与获取模型均按真实结果返回；上下文栏在各标签间切换不再触发上下文错误横幅。
- 所有本地验证均未调用真实图片 Provider，未产生计费生成请求。

## 安装

项目级安装：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.14.1/daoge-pic-5.14.1.tgz"
npx daoge register-skill --scope project --workspace /absolute/workspace
npx daoge doctor --workspace /absolute/workspace
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.14.1/daoge-pic-5.14.1.tgz"
daoge register-skill --scope user
daoge doctor --workspace /absolute/workspace
```

Windows PowerShell 使用 `npm.cmd`、`npx.cmd` 和 `daoge.cmd`。`register-skill` 在目标已存在时失败，不删除或覆盖已有 Skill 目录。`doctor` 不读取 Provider 密钥、不连接 Provider、不产生计费请求。安装和注册完成后必须完整重启 Codex，使 Skill registry 重新加载。

## 升级建议

1. 5.14.1 与 5.14.0 及更早版本的 daemon 不兼容；不要让旧 daemon、旧 CLI 与本版本运行时混用。升级前确认旧进程已按受控流程停止，并为现有 Studio 保留可验证备份。
2. 本版本无 Studio schema 变更，已运行 5.14.0 的 Studio 可以直接沿用；仍建议按备份/恢复文档先取 `backup-manifest` 作为升级前锚点。
3. 安装包、注册 Skill 并重启 Codex 后，再用当前会话和当前 Workbench 建立 Studio Session；不要把浏览器缓存、旧目录文件或旧 SSE 状态当作业务事实。
4. 本版本是 vNext 工作流，不读取或迁移旧 `task_spec.json`、旧 `prepare` / `execute` / `ingest` 命令、旧静态工作区、`results.html` 或旧运行记录。生成仍必须经过计划、人工确认、preflight 和 daemon `confirm_token`。
5. 再次生成必须创建新的 `variation`、`refinement` 或 `fill` 轮次；不能在已有轮次静默创建第二个初始 Generation Run。

## .env 与 Provider 密钥

- 新工作区不会创建 Provider `.env` 文件。既有工作区的 `provider.env` 只作为一次性迁移输入；迁移完成后，Provider Profile、密钥引用和 write-only 摘要以 `daoge-studio/Provider.db` 或显式系统凭据后端为事实源。
- 不要把真实 API key、完整 Base URL、Cookie、token、runtime 文件或 Provider.db 加入提交、制品、日志、诊断、导出或 release notes；不要把密钥作为命令参数传递。
- 默认 secret backend 优先使用平台系统凭据存储；显式选择 `system` 时后端不可用必须 fail-closed。测试使用的 `tests/vnext/test.env` 只是回归夹具，不是生产配置，也不应包含真实凭据。
- 本次恢复 Workbench 同源访问的是「本地校验 / 连接测试 / 获取模型」三个只读凭据动作，仍然只允许携带本机 Studio Cookie 且 `Origin` 等于本地 origin 的同源请求；跨源写请求继续返回 403。

## 不兼容变化摘要

- 运行时兼容范围从 `>=5.14.0 <6.0.0` 提升到 `>=5.14.1 <6.0.0`；5.14.0 及更早 daemon 不得与本版本混用。
- Skill protocol 仍为 `daoge-pic-skill-protocol/2.0.0`；协议版本不是 `5.14.1`。
- Studio schema 保持 `34`，本版本没有迁移步骤。
- 旧 `prepare` / `execute` / `ingest`、`task_spec.json`、旧静态工作区和 `results.html` 不是当前入口；公开运行流程使用会话计划、`confirm-challenge`、`preflight`、`run` 和 Generation History。
- 运行恢复、重试、取消和 unknown 结案必须使用当前 Bearer Skill/CLI 边界；Workbench Cookie 不能绕过 Agent 确认与预检。

## 发布完成后的包外记录

发布完成后，维护者应在 GitHub Release 附件和仓库包外记录中核对：

- `daoge-pic-5.14.1.tgz` 与同名 `.sha256` sidecar 均存在；
- package、protocol manifest、编译 runtime、Workbench 入口、bin 和 `sharp` consumer smoke 均通过；
- Release tag 为 `daoge-pic-v5.14.1`，安装 URL 与 tag/文件名一致；
- SHA-256 只记录在 sidecar、Release 元数据或外部发布说明中，不写回会改变自身哈希的包内验证文档。
