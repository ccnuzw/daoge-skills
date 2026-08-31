# DAOGE Pic vNext

DAOGE Pic 是面向智能体会话的本地图像创作管理平台。会话负责澄清、规划、确认和汇报；本地 Studio Workbench 负责查看项目上下文、生成运行、资产、选择、复核和交付。

当前包版本：5.4.0。它是一次不兼容的 vNext 替换，不读取或迁移旧任务 JSON、旧静态工作区、旧目录状态或旧运行记录。

## 运行条件

- Node.js 22 LTS 或更高版本，使用 node:sqlite。
- 一个稳定、可写的工作区根目录。
- 真实生成时，在 <workspace>/daoge-studio/provider.env 配置一个 Provider。

发布包已包含编译后的运行时和 Workbench；安装后可直接使用，无需为正常使用手动构建。以下构建与完整测试命令只在包含 `src/`、`tests/` 和构建配置的源码仓库检出中执行：

```bash
npm install
npm run build
```

## 启动 Studio

```bash
node scripts/daoge.js studio --workspace /absolute/workspace
node scripts/daoge.js open --workspace /absolute/workspace
```

首次启动仅创建 daoge-studio 和 provider.env；资产、交付、缓存与运行目录按需建立。Studio daemon 是单实例后台进程，浏览器或终端关闭不会中断已开始的工作。

## Provider 配置

只使用工作区内的 daoge-studio/provider.env。模板文件是 references/provider.env.example。支持：

- openai-images
- gemini-image
- gemini-openai-compatible
- xai-grok-image

密钥不进入 SQLite、事件、导出物、运行记录或 Workbench。安装路径、用户主目录和任意当前目录不是默认状态位置。

Worker 并发默认是 `2`，只接受 `1`、`2`、`4`：

```bash
node scripts/daoge.js config --workspace /absolute/workspace --worker-concurrency 4
node scripts/daoge.js restart --workspace /absolute/workspace
```

配置命令不会启动或重启 daemon；重启会优雅停止同工作区进程、保留恢复语义并复用原端口。`status` 的 runtime 记录会显示实际生效的并发值。

## 会话流程

1. 智能体把当前会话绑定为 Studio Session。
2. 它从用户需求建立项目、创作任务和创作轮次。
3. 它提交可确认的版本化计划与提示词证据。
4. 用户确认后进行无外部调用的预检，并保存干跑运行项预览。
5. 预检证据与当前安全 Provider 快照一致时，才创建持久运行；显式画幅会按当前 Provider 能力验证，不支持或不一致时拒绝而不回退为方图；daemon 从 SQLite 队列领取运行项。
6. Workbench 通过 SSE 显示状态和受管理资产，供拖放/粘贴导入、检查、对比、筛选、批注、衍生、回收、恢复和交付。

命令接口见 SKILL.md。Skill 或客户端不得直接写数据库和状态文件。

## 恢复安全

- Provider 限流与临时错误有边界重试。
- outcome_unknown 绝不自动重放；仅在用户确认无结果后，显式处理指定运行项，才能恢复其余安全项。
- 重启时，外部调用中的运行转入 resume_pending，必须在会话中再次确认并记录 Studio Session；Workbench 不能绕过该确认。
- failed、blocked 和 retry_wait 运行项可以受控地重试单项或整轮；outcome_unknown 永远不能被重试。
- 项目归档会拒绝存在未完成生成的项目，并在同一事务中归档项目、任务和轮次。
- daemon 在启动时固定 Provider 配置和 Worker 并发；修改 provider.env 或通过受控 config 命令更新并发，都必须使用 restart 才能影响后续调度。
- 运行快照不记录 Key 或完整 Provider URL；Worker 只处理匹配当前内存配置的会话。

## 验证

```bash
npm run test:vnext
npm run test:package
npm pack --dry-run --json
```

测试会构建 TypeScript 运行时和 React Workbench，并验证 Provider 适配、干跑证据绑定、SQLite 队列、显式恢复与重试、FTS5 检索、媒体归档与恢复、HTTP/SSE、资产版本化反馈与静态 Workbench 托管。

详细技术规格见 docs/daoge_pic_vnext_upgrade_spec_zh.md。
