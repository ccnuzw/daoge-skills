# 机器强制执行边界

以下边界同时由 daemon/API/测试与本 Skill 约束；Agent 不得尝试绕过。SKILL.md 只保留红线摘要，这里是不许打折扣的全量。

- 不得执行或建议旧 `prepare`、`execute`、`ingest`，不得创建 `task_spec.json`，不得把旧 `workspace/*.html` 或 `results.html` 当作当前入口。
- 运行必须携带 daemon 签发的 `confirm_token`。令牌绑定 `plan_hash + preflight_id + conversation_id`；缺失、伪造、过期、跨计划、跨预检或跨 conversation 一律拒绝，不触发 Provider。
- 确认挑战只可由当前 Workbench 的授权 Cookie 提交；Workbench 的确认闸门只激活计划，不执行预检、不创建 Generation Run。
- `preflight` 与 `run` 只接受 Bearer Skill/CLI；`preflight` 不调用 Provider、不计费、不创建正式资产，`run` 才会触发 Provider。
- 每个创作轮次只允许当前已确认计划创建一个 Generation Run。已有运行时必须显式选择并处理该运行；再次生成必须新建 `variation`、`refinement` 或 `fill` 轮次。
- 参考图和遮罩只能来自当前项目资产，或当前 Studio 明确 `shared_across_projects` 的共享素材；计划写入、确认、预检、排队和 Worker 读取前都必须重复校验。
- 计划声明了 `referenceAssetIds` 或 `maskAssetId` 时必须使用 `operation: "edit"`。`generate` 请求体不携带参考图与遮罩，Provider 收到的只有提示词；预检会以 `reference_requires_edit` 拒绝这类计划。要做角色、产品或风格一致性时，参考图必须走 `edit`。
- Provider Profile、密钥引用和 write-only 摘要以 `Provider.db` v3 为唯一运行时事实源；secret 默认可存于受权限保护的 SQLite plaintext，显式 system backend 时使用 macOS Keychain、Windows DPAPI sidecar 或 Linux libsecret；system backend 不可用必须 fail-closed，不得静默退回明文。API Key 与完整 Base URL 不得进入 Studio DB、事件、日志、导出、诊断或回复。
- 不得直接写 Studio 文件、SQLite、manifest、journal、runs、SSE 状态或媒体目录；只使用受控 CLI 或当前源码明确列出的同源 Studio API。
- 大 JSON 用 CLI 的 `--plan @-` 等 stdin 标记传输；每次命令最多一个 `@-`，stdin 必须是 JSON 对象。
- 不得输出、记录、复制或要求用户粘贴 capability、bootstrap URL、Cookie、session token、claim token、完整 Provider 请求、内部路径或 API Key。
