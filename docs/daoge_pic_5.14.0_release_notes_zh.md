# DAOGE Pic v5.14.0 发布说明

- 发布日期：2026-09-15
- Git 标签：`daoge-pic-v5.14.0`
- 状态：正式发布
- 影响 Skill：`daoge-pic`。
- package/runtime 版本：`5.14.0`。
- Skill protocol：`daoge-pic-skill-protocol/2.0.0`（独立于制品版本）。
- 运行时兼容范围：`>=5.14.0 <6.0.0`。
- Studio schema：`34`。
- 分发渠道：GitHub Release 不可变 `.tgz` 资产；不发布到 npm registry。

## 本次更新

- 预算估算在预检时冻结到 Generation Run，并按运行项记账；未知成本保持显式，不按零成本处理。重试路径也重新经过预算闸门。
- 参考图/遮罩与 `operation` 约束收紧：声明参考素材时必须使用 `edit`，避免 `generate` 请求静默丢失参考图；线协议回归同时验证 generate 与 edit 的请求形状。
- 备份 manifest、迁移和恢复链路增强：支持大资产集合分页、旧交付冻结清单兼容、Schema v33 provenance 版本冻结，以及 Schema v34 进行中运行的轮次级唯一约束。
- Provider 安全与网络边界增强：系统凭据后端优先、不可用时显式降级或 fail-closed；支持显式 `local_proxy` / 企业私有端点策略、代理和重试超时，不放行云元数据、链路本地、多播或保留地址。
- Worker、daemon 连续性和 Workbench 状态恢复增强；构建和验证证据改为机器产出，package smoke 检查安装后的 bin、注册、doctor 与 `sharp`。

## 发布制品

- 文件：`daoge-pic-5.14.0.tgz`
- 大小：599,181 bytes
- npm shasum：`262a83a071f744e62024d90cc8cc9aba49fa8fa2`
- SHA-256：`4113d15995c92c78d95b4777436c4071dcd06bdec315b6a59e57580838c9d43b`
- GitHub Release 资产：https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.14.0/daoge-pic-5.14.0.tgz
- checksum sidecar：`skills/daoge-pic/daoge-pic-5.14.0.tgz.sha256`

## 验证结果

- `npm run typecheck:vnext`：通过。
- `npm run build`：vNext TypeScript 与 Vite Workbench 构建通过；Vite 转换 1624 个模块，Workbench JS 640.33 kB、CSS 218.85 kB；chunk size 提示为非阻断 warning。
- `npm test`：571 项测试，569 通过、0 失败、0 取消、2 项仅 Windows 实机用例跳过。
- `npm run test:package`：发布清单 164 个文件，`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`；临时 consumer 安装、真实 bin、register-skill、doctor 和 `sharp` 全部通过。
- `npm audit --omit=dev`：0 vulnerabilities。
- 所有本地验证均未调用真实图片 Provider，未产生计费生成请求。

## 安装

项目级安装：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.14.0/daoge-pic-5.14.0.tgz"
npx daoge register-skill --scope project --workspace /absolute/workspace
npx daoge doctor --workspace /absolute/workspace
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.14.0/daoge-pic-5.14.0.tgz"
daoge register-skill --scope user
daoge doctor --workspace /absolute/workspace
```

Windows PowerShell 使用 `npm.cmd`、`npx.cmd` 和 `daoge.cmd`。`register-skill` 在目标已存在时失败，不删除或覆盖已有 Skill 目录。`doctor` 不读取 Provider 密钥、不连接 Provider、不产生计费请求。安装和注册完成后必须完整重启 Codex，使 Skill registry 重新加载。

## 升级建议

1. 5.14.0 与 5.13.0 及更早版本的 daemon 不兼容；不要让旧 daemon、旧 CLI 与本版本运行时混用。升级前确认旧进程已按受控流程停止，并为现有 Studio 保留可验证备份。
2. 对已有 Studio，先通过受控 CLI 执行 `backup-manifest` 和 `backup-upgrade-assess`，按备份/恢复文档完成 dry-run 或受控恢复；不要在运行中的 daemon 下直接替换 `studio.db`。
3. 安装包、注册 Skill 并重启 Codex 后，再用当前会话和当前 Workbench 建立 Studio Session；不要把浏览器缓存、旧目录文件或旧 SSE 状态当作业务事实。
4. 本版本是 vNext 工作流，不读取或迁移旧 `task_spec.json`、旧 `prepare` / `execute` / `ingest` 命令、旧静态工作区、`results.html` 或旧运行记录。生成仍必须经过计划、人工确认、preflight 和 daemon `confirm_token`。
5. 再次生成必须创建新的 `variation`、`refinement` 或 `fill` 轮次；不能在已有轮次静默创建第二个初始 Generation Run。

## .env 与 Provider 密钥

- 新工作区不会创建 Provider `.env` 文件。既有工作区的 `provider.env` 只作为一次性迁移输入；迁移完成后，Provider Profile、密钥引用和 write-only 摘要以 `daoge-studio/Provider.db` 或显式系统凭据后端为事实源。
- 不要把真实 API key、完整 Base URL、Cookie、token、runtime 文件或 Provider.db 加入提交、制品、日志、诊断、导出或 release notes；不要把密钥作为命令参数传递。
- 默认 secret backend 优先使用平台系统凭据存储；显式选择 `system` 时后端不可用必须 fail-closed。测试使用的 `tests/vnext/test.env` 只是回归夹具，不是生产配置，也不应包含真实凭据。
- 当前版本不要求用户为新工作区复制旧 `.env`；如已有旧 Provider 配置，按迁移和 Workbench Provider Profile 流程处理，不手工复制密钥到源码目录。

## 不兼容变化摘要

- 运行时兼容范围从历史版本提升到 `>=5.14.0 <6.0.0`；5.13.0 及更早 daemon 不得与本版本混用。
- Skill protocol 仍为 `daoge-pic-skill-protocol/2.0.0`；协议版本不是 `5.14.0`。
- 旧 `prepare` / `execute` / `ingest`、`task_spec.json`、旧静态工作区和 `results.html` 不是当前入口；公开运行流程使用会话计划、`confirm-challenge`、`preflight`、`run` 和 Generation History。
- 参考图或遮罩不能再挂在 `generate` 计划上；需要参考素材时必须声明 `edit`。
- 运行恢复、重试、取消和 unknown 结案必须使用当前 Bearer Skill/CLI 边界；Workbench Cookie 不能绕过 Agent 确认与预检。

## 发布完成后的包外记录

发布完成后，维护者应在 GitHub Release 附件和仓库包外记录中核对：

- `daoge-pic-5.14.0.tgz` 与同名 `.sha256` sidecar 均存在；
- package、protocol manifest、编译 runtime、Workbench 入口、bin 和 `sharp` consumer smoke 均通过；
- Release tag 为 `daoge-pic-v5.14.0`，安装 URL 与 tag/文件名一致；
- SHA-256 只记录在 sidecar、Release 元数据或外部发布说明中，不写回会改变自身哈希的包内验证文档。
