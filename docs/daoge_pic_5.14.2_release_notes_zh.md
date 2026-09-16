# DAOGE Pic v5.14.2 发布说明

- 发布日期：2026-09-16
- Git 标签：`daoge-pic-v5.14.2`
- 状态：正式发布
- 影响 Skill：`daoge-pic`。
- package/runtime 版本：`5.14.2`。
- Skill protocol：`daoge-pic-skill-protocol/2.0.0`（独立于制品版本）。
- 运行时兼容范围：`>=5.14.2 <6.0.0`。
- Studio schema：`34`（本版本无 schema 变更）。
- 分发渠道：GitHub Release 不可变 `.tgz` 资产；不发布到 npm registry。

## 本次更新

本次是补丁发布：新增一个以只读为主的「疑难处理」页，收口术语守卫，并修掉让 Windows 门禁连续两个版本全红的几处平台断言。不引入新的 Provider 契约或 Studio schema 变更。

### Studio 疑难处理页（新增）

- **出事时从这里开始**。左侧栏「辅助」区新增入口，页面分三块：后台现在什么状态、数据还在不在、怎么把数据找回来。
- **数据体检**：只读数一遍 Studio 里的素材与已交付文件，导出一份清单（不含图片内容、不含密钥），并给出一句汇总——「这个 Studio 现在有 N 个素材、M 份已交付文件，加起来 X」。清单可用于核对数据是否完整，或在迁移、请人排查时交出去。
- **恢复只在本机命令行做，界面里写明了原因**：恢复会重写整个 Studio 的数据，服务端该路由只接受本机命令行身份；浏览器带会话 cookie 调用会拿到 `403 forbidden`（已实测确认）。所以界面不放置恢复按钮——一次误点的代价太大——只给出「导出清单 → 预演 → 恢复」的路径、命令与每步说明。界面上的指引不写死参数（那些因机器而异），命令名由测试对着 CLI 命令表锁住，防指引腐烂。
- 运行状态、复制隐去隐私的诊断、安全重启三个动作收在同一页；安全重启只在后台任务真的卡住时才出现。

### 术语治理收口

- **`scope` 字段从「只检查取值合法」变成真规则**：配置面专属术语不再能飘进创作者面。此前该字段只有声明、没有任何断言执行它，于是左侧栏一直挂着「请先创建并激活 Profile」而测试全绿。
- **「处理池」进术语单**（收回级）。运行状态相关文案里的同批工程词一并换成人话：`HTTP 服务` → 页面服务、`权威快照` → 最新数据、`子进程` → 后台任务、「按需启动后台处理」→「按需启动后台任务」。
- **设置页限额项改为纯人话**：「运行并发上限 / 请求超时 ms / 自动重试上限」→「同时最多出几张 / 等多久算超时（毫秒）/ 失败后最多重试几次」。判据是**这个词在别处有没有权威来源**：要照着服务商文档一栏一栏抄的（`Base URL` / `API Key` / `Provider` / `模型`）保留原文，翻成中文反而让人不知道该抄哪栏；本系统自己的旋钮别处从没见过，也没有文档要抄，说人话比留术语省认知。
- 顺带接回一处断掉的单一来源：`LIMIT_FIELDS` 早已写好人话名字（校验消息一直在用），表单 label 却硬编码旧文案，两边并存了很久。

### Windows 门禁

声明支持的 4 个 Windows 组合（`windows-2022` / `windows-2025` × Node `22.17.0` / `24`）此前连续两个版本全红。本版本修掉根因，四个组合首次全部通过：

- **备份清单的路径判定顺序**：Windows 绝对路径（`D:\a\b`）既是绝对路径又含反斜杠，而反斜杠判定排在前面，于是被报成「path is invalid」而不是「必须是相对路径」——这两句话对调用方意思完全不同。绝对路径判定提前，并补一条平台无关的盘符正则。
- **待恢复记录的路径比较改用 `sameWorkspaceRoot()`**：原先手写 `fs.realpathSync.native(dir) !== root`，少了 win32 的大小写归一，同一份完好的待恢复记录在 Windows 上会被判成损坏，而原文其实好端端躺在暂存目录里。
- **daemon identity 的 `0600` 断言改为仅 POSIX 成立**：Windows 没有 POSIX 权限位，`fs.chmod` 在那边只动只读位。那份身份文件在 Windows 上的保护来自用户目录自身的 ACL。
- **前端源码守卫归一 `path.relative`**：Windows 上它返回 `web\src\…`（反斜杠），而断言按 `/` 写。
- **恢复 `test:package` 里被误删的 `npm pack`**：`--require-release-artifact` 后来变成在要求一个脚本自己已不再生成的制品；本地靠仓库里的历史 tarball 蒙混过关，CI 是干净 checkout（tarball 被 gitignore），必然失败。

## 发布制品

- 文件：`daoge-pic-5.14.2.tgz`
- 大小：623,346 bytes
- npm shasum：`f880aa826cab5a7efb85d542da3b484a99e545a1`
- SHA-256：`6e38ff8a208048c163575051d494cb5856df2e6325b8e9ca31ccbc166ad3bdf3`
- GitHub Release 资产：https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.14.2/daoge-pic-5.14.2.tgz
- checksum sidecar：`skills/daoge-pic/daoge-pic-5.14.2.tgz.sha256`

## 验证结果

- `npm run typecheck:vnext`：通过。
- `npm run build`：vNext TypeScript 与 Vite Workbench 构建通过；Vite 转换 1636 个模块，Workbench 产物 JS 659.57 kB、CSS 223.33 kB，只有非阻断大小提示。
- `npm test`：全量 vNext 回归 656 项，654 通过、0 失败、0 取消、2 项仅 Windows 实机用例跳过。
- `npm run test:package`：发布清单 170 个文件，`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`；临时 consumer 安装、真实 bin、help、register-skill、doctor 与 `sharp` 全部通过。
- Windows CI：`windows-2022` / `windows-2025` × Node `22.17.0` / `24` 四个组合全部通过。
- 实机复验：本机 Studio daemon 重启后，疑难处理页的数据体检清单返回 `200`（5.8 秒、1274 个条目），数据恢复路由对浏览器身份返回 `403 forbidden`。
- 所有本地验证均未调用真实图片 Provider，未产生计费生成请求。

## 安装

项目级安装：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.14.2/daoge-pic-5.14.2.tgz"
npx daoge register-skill --scope project --workspace /absolute/workspace
npx daoge doctor --workspace /absolute/workspace
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.14.2/daoge-pic-5.14.2.tgz"
daoge register-skill --scope user
daoge doctor --workspace /absolute/workspace
```

Windows PowerShell 使用 `npm.cmd`、`npx.cmd` 和 `daoge.cmd`。`register-skill` 在目标已存在时失败，不删除或覆盖已有 Skill 目录。`doctor` 不读取 Provider 密钥、不连接 Provider、不产生计费请求。安装和注册完成后必须完整重启 Codex，使 Skill registry 重新加载。

## 升级建议

1. 5.14.2 与 5.14.1 及更早版本的 daemon 不兼容；不要让旧 daemon、旧 CLI 与本版本运行时混用。升级前确认旧进程已按受控流程停止，并为现有 Studio 保留可验证备份。
2. 本版本无 Studio schema 变更，已运行 5.14.1 的 Studio 可以直接沿用；仍建议按备份/恢复文档先取 `backup-manifest` 作为升级前锚点。
3. 安装包、注册 Skill 并重启 Codex 后，再用当前会话和当前 Workbench 建立 Studio Session；不要把浏览器缓存、旧目录文件或旧 SSE 状态当作业务事实。
4. 本版本是 vNext 工作流，不读取或迁移旧 `task_spec.json`、旧 `prepare` / `execute` / `ingest` 命令、旧静态工作区、`results.html` 或旧运行记录。生成仍必须经过计划、人工确认、preflight 和 daemon `confirm_token`。
5. 再次生成必须创建新的 `variation`、`refinement` 或 `fill` 轮次；不能在已有轮次静默创建第二个初始 Generation Run。

## .env 与 Provider 密钥

- 新工作区不会创建 Provider `.env` 文件。既有工作区的 `provider.env` 只作为一次性迁移输入；迁移完成后，Provider Profile、密钥引用和 write-only 摘要以 `daoge-studio/Provider.db` 或显式系统凭据后端为事实源。
- 不要把真实 API key、完整 Base URL、Cookie、token、runtime 文件或 Provider.db 加入提交、制品、日志、诊断、导出或 release notes；不要把密钥作为命令参数传递。
- 默认 secret backend 优先使用平台系统凭据存储；显式选择 `system` 时后端不可用必须 fail-closed。测试使用的 `tests/vnext/test.env` 只是回归夹具，不是生产配置，也不应包含真实凭据。
- 疑难处理页导出的数据体检清单只含文件的相对路径、类别、大小与内容哈希，不含图片本身、不含密钥、不含本机绝对路径。同源 Workbench 访问仍要求携带本机 Studio Cookie 且 `Origin` 等于本地 origin；跨源写请求继续返回 403。

## 不兼容变化摘要

- 运行时兼容范围从 `>=5.14.1 <6.0.0` 提升到 `>=5.14.2 <6.0.0`；5.14.1 及更早 daemon 不得与本版本混用。
- Skill protocol 仍为 `daoge-pic-skill-protocol/2.0.0`；协议版本不是 `5.14.2`。
- Studio schema 保持 `34`，本版本没有迁移步骤。
- 旧 `prepare` / `execute` / `ingest`、`task_spec.json`、旧静态工作区和 `results.html` 不是当前入口；公开运行流程使用会话计划、`confirm-challenge`、`preflight`、`run` 和 Generation History。
- 运行恢复、重试、取消和 unknown 结案必须使用当前 Bearer Skill/CLI 边界；Workbench Cookie 不能绕过 Agent 确认与预检。数据恢复同样只接受本机命令行身份。

## 发布完成后的包外记录

发布完成后，维护者应在 GitHub Release 附件和仓库包外记录中核对：

- `daoge-pic-5.14.2.tgz` 与同名 `.sha256` sidecar 均存在；
- package、protocol manifest、编译 runtime、Workbench 入口、bin 和 `sharp` consumer smoke 均通过；
- Release tag 为 `daoge-pic-v5.14.2`，安装 URL 与 tag/文件名一致；
- Windows CI 的 `windows-2022` / `windows-2025` × Node `22.17.0` / `24` 四个组合全部通过；
- SHA-256 只记录在 sidecar、Release 元数据或外部发布说明中，不写回会改变自身哈希的包内验证文档。
