# DAOGE Pic v6.1.1 发布说明

- 发布日期：2026-09-21
- Git 标签：`daoge-pic-v6.1.1`
- 状态：正式发布
- 影响 Skill：`daoge-pic`。
- package/runtime 版本：`6.1.1`。
- Skill protocol：`daoge-pic-skill-protocol/3.1.0`（本次未变）。
- 运行时兼容范围：`>=6.0.0 <7.0.0`（本次未变，6.1.0 / 6.0.0 daemon 可直接复用）。
- Studio schema：`41`（本次无迁移）。
- 分发渠道：GitHub Release 不可变 `.tgz` 资产；不发布到 npm registry。

## 本次更新

**补丁版本：首屏更快、Windows 按节读取修复；不改协议、不改 schema、不破坏兼容、无行为变化。**

### Workbench 首屏分包

- 八屏（含最重的创作平台 canvas 链）、创作对话框与 Provider 设置页改为按需加载（`React.lazy` + `Suspense`）。
- 首屏入口 JS 从 **708,483 B 降到 427,652 B（-40%）**；`lineage` 100.77 kB、`creation-dialogs` 49.06 kB、`provider-settings` 31.42 kB 等按需块只在打开对应界面/对话框时下载。
- 视图切换与对话框有兜底提示，不会白屏。

### Windows 修复

- `daoge reference <topic> --section <标题>` 现在兼容 CRLF 检出的附录文件。
- 此前在 Windows 上，逐行标题匹配会被行尾的 `\r` 打断，按节读取一律报「未找到章节：… 可用：」（列表为空）；6.1.0 的四个 Windows CI 组合都栽在这一条回归上。
- 归一化行尾后，同一断言在 macOS / Linux / Windows 一致；并新增一条「CRLF 也必须能取到同一节」的回归用例。

### 验证

- 正式制品 `daoge-pic-6.1.1.tgz` 为 728,343 bytes，npm shasum 为 `4a392515fdfa11caae68fa98ba3b0670ff453b9a`，SHA-256 为 `07015c4336fb1c75d8f6a519787759686a2393f92a66457e8d6b0da21d94a833`（以 GitHub Release 与 `.tgz.sha256` sidecar 为准）。
- 全量回归、构建与打包验证记录见 `skills/daoge-pic/docs/vnext_verification_evidence_zh.md` 的 6.1.1 章节。
- Windows CI（`windows-2022` / `windows-2025` × Node `22.17.0` / `24`）在本版本 push 后由 `.github/workflows/daoge-pic-windows.yml` 运行。
- 所有本地验证均未调用真实图片 Provider，也未产生计费生成请求。

## 兼容性说明

- 运行时兼容范围仍为 `>=6.0.0 <7.0.0`：本版本可与 6.1.0 / 6.0.0 daemon / Workbench 平滑共存，无需数据迁移。
- Skill protocol 仍为 `daoge-pic-skill-protocol/3.1.0`；`6.1.1` 是制品与运行时版本，不是协议版本。
- Studio schema 仍为 `41`，本次无迁移。

## 安装

以下命令固定使用本版本 GitHub Release 的不可变 `.tgz`，不会跟随 `main`。npm 安装提供 `daoge` CLI 和运行时，内置 `register-skill` 创建 link/junction 供 Codex 发现 Skill；两步缺一不可。

项目级安装：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v6.1.1/daoge-pic-6.1.1.tgz"
npx daoge register-skill --scope project --workspace /absolute/workspace
npx daoge doctor --workspace /absolute/workspace
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v6.1.1/daoge-pic-6.1.1.tgz"
daoge register-skill --scope user
```

Windows PowerShell 使用 `npm.cmd`、`npx.cmd` 与 `daoge.cmd`。注册命令在目标已存在时失败，不删除或覆盖已有 Skill 目录。安装和注册完成后重启 Codex。

## 升级建议

- 从 6.1.0 / 6.0.0 升级无需数据迁移；升级后建议新开一个 agent 会话，让 SKILL.md 重新加载。
- 若目标 Skill 目录已存在且来源不明，请先确认来源并自行处理，不要直接覆盖。
