# DAOGE Pic vNext

DAOGE Pic 是面向智能体会话的本地图像创作管理平台。会话负责澄清、规划、确认和汇报；本地 Studio Workbench 负责查看项目上下文、Generation History（生成历史）、运行、资产、选择、复核和交付。

> **版本状态**：当前包版本和稳定正式版本为 [`5.7.0`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.7.0)。

vNext 是一次不兼容替换，不读取或迁移旧 `task_spec.json`、`prepare` / `execute` / `ingest` 命令、旧静态工作区、`results.html`、旧目录状态或旧运行记录。

## 安装版本

安装稳定正式版 `5.7.0` 时，使用 `daoge-pic-v5.7.0` GitHub Release 中的不可变 `.tgz` 制品，避免默认分支后续变化影响安装内容。npm 安装提供 `daoge` CLI 和运行时；link/junction 注册让 Codex 发现 `daoge-pic` Skill，两步缺一不可。

在项目根目录执行：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.7.0/daoge-pic-5.7.0.tgz"
node -e "const fs=require('node:fs'),path=require('node:path');const source=path.resolve('node_modules/daoge-pic'),dest=path.resolve('.agents/skills/daoge-pic');if(fs.existsSync(dest))throw new Error('Skill destination already exists: '+dest);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.symlinkSync(source,dest,process.platform==='win32'?'junction':'dir')"
```

注册命令跨 macOS、Linux 和 Windows：Windows 创建 junction，其他平台创建目录符号链接。它在 `.agents/skills/daoge-pic` 已存在时直接失败，不删除或覆盖已有目录。完成后重启 Codex，再通过 `npx daoge` 或 `./node_modules/.bin/daoge` 使用项目安装的 CLI：

```bash
npx daoge studio --workspace /absolute/workspace
```

需要全局安装稳定版时，安装同一个 Release `.tgz`，再由 Node 标准库调用 `npm root -g` 定位已安装包并注册到当前用户的 Codex Skill 目录：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.7.0/daoge-pic-5.7.0.tgz"
node -e "const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');const source=path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'daoge-pic'),dest=path.join(os.homedir(),'.codex','skills','daoge-pic');if(fs.existsSync(dest))throw new Error('Skill destination already exists: '+dest);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.symlinkSync(source,dest,process.platform==='win32'?'junction':'dir')"
```

全局注册同样采用 fail-if-exists，不会覆盖 `~/.codex/skills/daoge-pic`。完成后重启 Codex，CLI 可直接通过 `daoge` 调用。

需要直接试用 `main` 分支开发源码时，可继续使用 `npx skills add`：

```bash
npx skills add https://github.com/ccnuzw/daoge-skills/tree/main/skills/daoge-pic -a codex
```

这条开发命令不安装 npm 发布包、Git 标签、GitHub Release 或稳定发布包；执行后也需重启 Codex。

## 运行条件

- Node.js 22 LTS 或更高版本，使用 `node:sqlite`。
- 一个稳定、可写的工作区根目录；不得把不稳定的当前目录当作隐式工作区。
- 真实生成时，在 `<workspace>/daoge-studio/provider.env` 配置一个 Provider。

正式发布包包含编译后的运行时和 Workbench，安装后无需手动构建。以下命令只用于包含 `src/`、`web/`、`tests/` 和构建配置的源码仓库检出：

```bash
npm install
npm run build
```

## 启动 Studio 与本地授权

在源码检出中使用：

```bash
node scripts/daoge.js studio --workspace /absolute/workspace
node scripts/daoge.js open --workspace /absolute/workspace
```

`studio` 确保当前工作区 daemon 可用并返回 Workbench 地址；`open` 会执行安全 bootstrap 并用系统默认浏览器打开 Workbench：macOS 使用 `open`，Linux 使用 `xdg-open`，Windows 使用 `rundll32.exe url.dll,FileProtocolHandler`。不支持的平台会明确失败，不拼接 shell 命令或静默退回手工执行。

每个 daemon 都生成高熵 local capability。`open` 把 capability 临时放入 URL fragment；Workbench 用它换取 `HttpOnly`、`SameSite=Strict` 本地会话 Cookie 后立即清除 fragment。CLI API 请求使用 Bearer capability。除最小健康检查外，API、媒体、ZIP 和 SSE 都要求当前 Studio 授权，写入还校验 Host、Origin 与 Content-Type。不要复制、记录或分享 bootstrap URL、capability、Cookie 或 runtime 私密文件；`status` 不输出 capability。

首次初始化会先验证随包 Provider 模板以及已有 manifest 的工作区身份。模板缺失、manifest 无效或其规范化 `workspaceRoot` 与请求根目录不一致时，初始化失败且不留下部分目录、manifest、数据库、配置或 `.gitignore` 变更。成功初始化后只建立 Studio 必需内容；资产、交付、缓存与运行目录按需创建。

Studio daemon 是当前工作区的单实例后台进程。浏览器或终端关闭不会中断已开始的工作；运行由 daemon 内的持久 Worker 和 SQLite 队列驱动，不存在需要用户单独启动的 Node worker 服务。

## Provider 配置与下载安全

Studio 只使用工作区内的 `daoge-studio/provider.env`，模板为 `references/provider.env.example`。已有配置绝不覆盖。文件只保存当前 Provider、端点、密钥、模型与 Provider 固有能力开关，不保存画幅、尺寸、数量或运行并发。支持：

- `openai-images`
- `gemini-image`
- `gemini-openai-compatible`
- `xai-grok-image`

密钥不进入 SQLite、事件、导出物、运行记录、Workbench 或聊天回复。`provider.env` 使用受限文件权限并加入工作区 `.gitignore`；安装路径、用户主目录和任意当前目录不是默认状态位置。

Provider API 请求携带凭据时拒绝重定向。Provider 返回远程图片 URL 时，下载器只接受无内嵌凭据的 HTTP/HTTPS 公网地址，对每次 DNS 解析和重定向重新执行 SSRF 校验，把连接固定到已验证地址并确认实际远端地址，且对远程响应和 base64 图片执行有界大小与格式检查。私网、loopback、链路本地、保留地址、DNS rebinding、超限响应、无效图片和下载中断都不会形成正式资产。

工作区并发上限默认是 `30`，接受 `1` 到 `30` 的整数，由 Studio 数据库存储而不是 `provider.env`：

```bash
node scripts/daoge.js config --workspace /absolute/workspace --worker-concurrency 30
node scripts/daoge.js restart --workspace /absolute/workspace
```

单次运行也可请求 `1` 到 `30` 路并发，但不会超过 daemon 当前生效的工作区上限：

```bash
node scripts/daoge.js run --workspace /absolute/workspace --round <round-id> --preflight <dry-run-id> --concurrency 12
```

修改 `provider.env` 或工作区并发上限后必须 `restart`，后续调度才会使用新快照；已经启动的运行继续使用冻结配置。

## 会话、Schema 与运行语义

1. 智能体把当前会话绑定为 Studio Session，再建立项目、创作任务和创作轮次。
2. 每个轮次保存版本化计划与提示词证据。未得到用户明确确认前，不得调用外部 Provider。
3. 确认后执行不产生外部调用的预检；预检冻结计划、输出规格、素材关系、Provider 安全快照和运行项预览。
4. 只有预检仍与当前计划和 daemon 配置匹配时才能创建持久 Generation Run。画幅、尺寸、分辨率和数量由会话动态指定；不使用 Provider 名称硬编码比例白名单，也不回退为方图。
5. Workbench 通过 SSE 展示状态与受管理资产；事件窗口不连续或本地批次溢出时，先恢复完整快照，再从新 cursor 继续。

`studio.json` 只保存 Studio 身份、manifest schema 和严格匹配的规范工作区根，不是业务事实源。`studio.db` 是项目、任务、轮次、计划、运行、资产关系、评审和交付的唯一业务事实源，并通过版本化 migration 演进。客户端不得直接写 manifest、SQLite、journal 或运行状态文件。

Generation Run 与 Run Item 是不同层级。运行可以排队、执行、暂停、等待恢复确认或收敛为完成/部分/失败/取消；单项从待领取进入外部请求、接收、持久化和成功，也可能进入有界重试、阻塞或 `outcome_unknown`。`outcome_unknown` 表示外部副作用不明，绝不自动重放。

Workbench 的 **Generation History（生成历史）** 按当前轮次列出全部持久运行，并要求显式选择具体运行；它不会把“活跃运行”或“最新运行”静默冒充用户正在查看的历史项。选择后显示计划版本、创建时间、短 ID、运行状态、运行项及其结果资产。

## 幂等恢复

所有通过 CLI 发出的 `POST` / `PUT` mutation 都接受可选的全局参数：

```bash
--idempotency-key <stable-key>
```

若同一操作在网络断开、CLI 中断或响应不明后需要恢复，必须用**完全相同的命令、参数和同一个 key**重试，例如：

```bash
node scripts/daoge.js resume --workspace /absolute/workspace --run <run-id> --session <session-id> --idempotency-key <same-key>
node scripts/daoge.js resume --workspace /absolute/workspace --run <run-id> --session <session-id> --idempotency-key <same-key>
```

同一个 key 不能用于不同命令或不同 payload；冲突会被拒绝。未显式提供时，CLI 会为本次 mutation 生成新 key，因此只有显式保存并复用 key 才能把跨进程重试识别为同一操作。`status`、`studio`、`open` 和 `restart` 不发送该参数；`config` 是 `PUT` mutation，支持该参数。

## 恢复、媒体与交付

- Provider 限流与临时错误进入有界重试；认证、模型和参数错误不会自动重试。
- daemon 重启后，不安全的在途外部调用进入 `resume_pending`，必须在会话中再次确认并记录 Studio Session；Workbench 不能绕过确认。
- `failed`、`blocked` 和 `retry_wait` 可受控重试；`outcome_unknown` 只能在用户核实无结果后显式结案。
- 导入、生成、回收与恢复使用 staging、原子移动、持久 journal 和启动对账。只有路径仍在当前 Studio 受管理根内，且媒体类型、哈希、大小、资产与操作身份全部一致时才恢复；冲突或歧义会拒绝，不会猜测提交。
- 下载、复制、交付导出与 ZIP 从受验证 snapshot 流式读取，拒绝符号链接、路径穿越、文件替换和跨 Studio/跨项目对象；ZIP 在输出前检查条目与聚合上限，支持背压和断连取消，并关闭临时 snapshot。

项目当前选片是数据库中的业务关系，不是浏览器筛选或文件夹。交付权威状态机是 `draft -> ready -> exported`；准备阶段冻结资产来源和评审事实，导出阶段建立冻结实体图片。源资产后来进入回收站，不会破坏已导出的交付文件。

Workbench 的“完成交付”使用内部同源 API `/api/deliveries/complete`，按 `draft`、`prepare`、`export` 三个幂等阶段从已提交位置恢复；**它不是公开的 `delivery-complete` CLI 命令**。公开 CLI 提供 `delivery`、`delivery-update`、`delivery-ready`、`delivery-draft`、`delivery-export` 以及交付批次命令，适合受控高级操作。

## Workbench 能力边界

Workbench 用于项目/任务/轮次导航、Generation History、SSE 实时状态、素材批量导入、范围筛选、搜索、放大/双图对比、选择、批注、来源检查、共享、回收、恢复、交付历史、下载/复制和 ZIP。图片放大预览可直接选为成果或取消成果，当前选片缩略卡片会为长标题和独立移除按钮保留空间。项目资产采用服务端分页，默认每页 24 张，可切换 16/24/32/48/64/96，并提供只作用于当前页的全选/取消全选；交付图片提供明确的全选/取消全选。项目首页和项目任务列表提供搜索、生命周期筛选与分页，避免项目或任务无限向下堆叠。项目资产和已导出交付 ZIP 使用项目名、交付名及下载时间生成可区分文件名。交付失败会保留当前阶段，可安全重试；已导出交付按冻结文件领取。

键盘和辅助技术契约包括可见焦点、搜索组合框语义、状态/错误 live region，以及模态图片查看器的初始焦点、Tab 焦点约束、Escape 关闭和关闭后焦点返回。

Workbench 不提供自然语言对话，不绕过会话确认，不显示 Provider 密钥，不接受任意绝对文件路径，也不把浏览器状态、目录或 SSE 当业务事实源。

受控 CLI 的完整列表与会话执行规则见 [SKILL.md](SKILL.md)。详细权威需求见 [vNext 升级规格](docs/daoge_pic_vnext_upgrade_spec_zh.md)。已发布历史证据与待发布候选证据分章记录在 [验证记录](docs/vnext_verification_evidence_zh.md)。
