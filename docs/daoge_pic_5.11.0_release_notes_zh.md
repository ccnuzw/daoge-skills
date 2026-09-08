# DAOGE Pic v5.11.0

本版本集中增强 Workbench 创作谱系、Generation History 大批量分页、项目资产打包、协议协商和本地敏感文件防护。

## 新增能力

- 新增创作谱系画布，覆盖项目、任务、轮次、计划、运行、运行项、资产、共享素材、交付、任务类型、风格包和品牌包节点。
- 创作谱系支持布局持久化、视口恢复、筛选、分组、人工软连线和只读导出摘要；业务事实仍以 Studio API/SQLite 为准。
- Generation History 运行项支持服务端分页、状态筛选、序号定位、精确状态计数、输出缩略图、可重试项本页选择和 URL 持久化。

## 优化项

- Generation History 改为全宽双栏工作区；中小屏使用横向历史条与单栏详情，减少三栏拥挤和无效留白。
- 统一提示词卡片、复制反馈、运行操作、危险操作和技术详情层级；长提示词保持可滚动，移动端主要操作维持 44px 触控高度。
- 项目资产 ZIP 按请求 `assetId` 做 scoped 查询和保序校验，选中图片不再受当前分页窗口限制。
- Lineage 视图完整翻页加载当前范围内所有 run items 与 assets，避免大批量历史只显示首批数据。

## 修复项

- Bearer Skill/CLI 请求必须声明 `x-daoge-skill-protocol: daoge-pic-skill-protocol/2.0.0`；CLI 复用 daemon 前校验协议、运行时兼容范围和 Studio ID。
- 创作谱系导出摘要过滤 Provider、完整 URL、路径、token、content hash、storage path、capability、cookie 和外部请求字段。
- Workbench 危险操作和 Provider 敏感操作统一使用 accessible dialog，保留焦点约束、Escape 关闭和关闭后焦点返回。
- 浏览器注入 diagnostics timer callback 的 `startTime` 异常被定向隔离，真实应用错误继续暴露。
- 仓库忽略嵌套 `daoge-studio` runtime、`Provider.db` 和 `provider.env`，降低误提交本地敏感运行文件风险。

## 兼容性说明

- Node.js：`>=22.17.0`
- Skill protocol：`daoge-pic-skill-protocol 2.0.0`
- Runtime compatibility：`>=5.11.0 <6.0.0`
- Studio Schema：v25
- Provider 配置：无需迁移；`Provider.db` 仍是受本地权限保护的明文 SQLite
- 安装来源：GitHub Release `.tgz` 资产，不表示包已发布到 npm registry

## 安装

以下命令固定使用本版本 GitHub Release 的不可变 `.tgz`，不会跟随 `main`。npm 安装提供 `daoge` CLI 和运行时，内置 `register-skill` 创建 link/junction 供 Codex 发现 Skill；两步缺一不可。

项目级安装：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.11.0/daoge-pic-5.11.0.tgz"
npx daoge register-skill --scope project --workspace /absolute/workspace
npx daoge doctor --workspace /absolute/workspace
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.11.0/daoge-pic-5.11.0.tgz"
daoge register-skill --scope user
```

Windows PowerShell 使用 `npm.cmd`、`npx.cmd` 与 `daoge.cmd`。注册命令在目标已存在时失败，不删除或覆盖已有 Skill 目录。安装和注册完成后重启 Codex。

## 验证与发布制品

- macOS `npm test`：332 项，330 通过、0 失败、2 项仅 Windows 实机用例跳过。
- `npm run test:package`：发布清单 124 个文件；清单、安装、真实 bin、注册、doctor 与 `sharp` 全部通过。
- 浏览器实测 1440×1000：临时 daemon 与 Workbench 授权成功，Lineage 路由显示测试项目/任务/轮次，渲染 4 个谱系节点且无 fatal/error alert；归档确认弹窗为 `role="dialog"` + `aria-modal="true"`，初始焦点在取消按钮。
- 最终发布制品：`daoge-pic-5.11.0.tgz`，403,432 bytes。
- SHA-256：`1deb7a92af0bbc0e3cbcd984d4f184043fc1bd08aa2c816713f917ff7c4a82ac`。
- 验证未调用真实图片 Provider，未产生计费生成请求。

## 升级建议

- 先安装 `.tgz`，再执行 `register-skill`；不要直接覆盖已有 `.agents/skills/daoge-pic` 或 `~/.codex/skills/daoge-pic`。
- 保持现有 Provider Profile；如 Workbench 显示需要重启，使用页面或 `daoge restart --workspace <path>` 完成受控重启。
- 升级并注册后完整重启 Codex，再执行一次 `daoge doctor --workspace <path>`。
