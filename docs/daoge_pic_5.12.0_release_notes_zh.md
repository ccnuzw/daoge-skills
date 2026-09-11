# DAOGE Pic v5.12.0

本版本正式发布 DAOGE Pic vNext 的 5.12.0 运行时，重点收敛创作者手册、模板化创建、Provider 安全、模型发现、参考素材编排和可恢复配置生命周期。稳定安装来源为 GitHub Release 的不可变 `.tgz` 资产；本包不发布到 npm registry。

## 新增能力

- Workbench 学习中心升级为“DAOGE Pic 创作手册”：按建立项目、确认计划、观察运行、视觉选片、冻结交付五阶段组织内容，提供专题筛选、搜索、判断清单和“在 Studio 中 / 回到会话”的责任边界；手册标记当前 `v5.12.0`。
- 项目模板深度联动新建任务：模板可以提供默认任务目标、任务名、目标数量、画幅、首轮目的、素材需求、变化维度、精修目标和保持约束；创建项目、任务或轮次后直接进入当前上下文，不再弹出创建完成提示或推荐下一步卡片。
- Provider Descriptor 作为能力单一事实源，统一 Profile store、API、Workbench、预检、输出规格和 HTTP adapter；xAI/Grok 支持官方画幅、`1K` / `2K` resolution、质量选项和受限多图 JSON 参考输入。
- 新增显式 `provider-models` 命令和模型列表 API。模型列表只在用户明确点击时读取受限模型摘要，不自动联网、不触发图片生成。
- 当前计划和“继续创作”流程支持主体、风格、构图、色彩、品牌、遮罩和反例等参考用途编排；多图模板覆盖主图 + 风格 + 构图、多主体融合、主体 + 反例对照和局部编辑遮罩。

## 安全与可靠性

- `compatible_public` Provider 拒绝通过明文 HTTP 发送凭据；HTTP 只允许在显式 `local_proxy` 或 `enterprise_private` 信任模式下使用。
- macOS Keychain 写入通过 stdin 传递 secret，不再把密钥放进子进程 argv；system secret backend 不可用时 fail closed，不静默退回 SQLite 明文。
- Provider.db schema 升级到 v3：连接测试证据绑定 Profile `configVersion`，陈旧的异步测试结果不能覆盖新配置；外部 secret 删除失败会进入持久清理队列并在后续打开数据库时重试。
- Provider copy、activate、delete、validate、test 和 model-list 路由显式限制 HTTP method；错误方法不会执行数据库变更、连接探测或 Provider 调用。
- xAI/Grok、OpenAI GPT Image 的能力和提示词限制在预检阶段校验；旧配置、旧预检和旧测试证据不会静默套用到新 Profile。

## 兼容性说明

- Node.js：`>=22.17.0`
- Skill protocol：`daoge-pic-skill-protocol 2.0.0`
- Runtime compatibility：`>=5.12.0 <6.0.0`
- Studio Schema：v26
- Provider.db schema：v3
- 安装来源：GitHub Release `.tgz` 资产；不表示包已发布到 npm registry

## 安装

以下命令固定使用本版本 GitHub Release 的不可变 `.tgz`，不会跟随 `main`。npm 安装提供 `daoge` CLI 和运行时，内置 `register-skill` 创建 link/junction 供 Codex 发现 Skill；两步缺一不可。

项目级安装：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.12.0/daoge-pic-5.12.0.tgz"
npx daoge register-skill --scope project --workspace /absolute/workspace
npx daoge doctor --workspace /absolute/workspace
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.12.0/daoge-pic-5.12.0.tgz"
daoge register-skill --scope user
```

Windows PowerShell 使用 `npm.cmd`、`npx.cmd` 与 `daoge.cmd`。注册命令在目标已存在时失败，不删除或覆盖已有 Skill 目录。安装和注册完成后重启 Codex。

## 验证与发布制品

- 本地 macOS `npm test`：358 项测试，356 通过、0 失败、2 项按条件跳过。
- `npm run build`：vNext TypeScript 与 Vite Workbench 构建通过；Vite 报告约 594 kB 主 chunk 的非阻断大小提示。
- `npm run test:package`：发布清单 130 个文件；`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`，临时 consumer 安装、真实 bin、register-skill、doctor 与 `sharp` 全部通过。
- 发布制品：`daoge-pic-5.12.0.tgz`，482,468 bytes。
- npm shasum：`b2a75a2c7632418feadac8b9217887374dbbade7`。
- SHA-256：`1daf37155d643379accad5318b8e836cf928fcf49b75c54e22b33b110d5fc494`。
- 所有本地验证未调用真实图片 Provider，未产生计费生成请求。

## 升级建议

- 先安装 `.tgz`，再执行 `register-skill`；不要直接覆盖已有 `.agents/skills/daoge-pic` 或 `~/.codex/skills/daoge-pic`。
- `5.12.0` 不与 `5.11.0` daemon 混用；升级后重新启动 Codex，并执行一次 `daoge doctor --workspace <path>`。
- 现有 Provider Profile 会保留；如配置后端使用 system secret backend，请先确认对应系统密钥服务可用。
