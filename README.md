# DAOGE Skills

面向中文工作流的 DAOGE Skill 系列。每个 Skill 都是**可独立安装、独立使用、独立演进**的能力包：Skill 把自然语言需求转成可执行的标准流程，附带的脚本、参考资料和本地工作台让关键过程可检查、可恢复、可交付。

> **版本状态**：`daoge-pic` 当前稳定正式版本为 [6.2.0](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v6.2.0)——这是一次 **agent 效率小版本**（响应投影、`daoge wait`、校验前移、写侧合并）；发布说明见 [`6.2.0 发布说明`](./docs/daoge_pic_6.2.0_release_notes_zh.md)，`6.1.1`、`6.1.0`、`6.0.0`、`5.14.2` 及更早版本保持为不可变历史发布。

当前仓库包含三项彼此独立的能力：

| Skill | 解决的问题 | 主要使用者 | 独立说明 |
| --- | --- | --- | --- |
| [`daoge-pic`](./skills/daoge-pic/README.md) | 会话优先的本地图像创作管理：Agent 收敛需求、写计划、受控执行；Studio Workbench 管项目 / 任务 / 批次、Provider、创作画布、生成历史、选片评审与资产交付 | 内容团队、设计师、运营人员、图像工作流开发者 | [进入图像创作 Skill](./skills/daoge-pic/README.md) |
| [`daoge-docs`](./skills/daoge-docs/README.md) | 建立中文文档驱动开发体系，生成开发执行工作台和受控 Goal 输入 | 产品、研发、架构与使用编程智能体的团队 | [进入文档 Skill](./skills/daoge-docs/README.md) |
| [`spec-docs`](./skills/spec-docs/README.md) | 以 Markdown 规格、稳定需求 ID、结构检查和证据门禁建立轻量、可移植的文档驱动开发流程 | 希望复用规格模板、治理方法和 Node.js 检查脚本的个人与团队 | [进入 Spec Docs Skill](./skills/spec-docs/README.md) |

## 选择 Skill

如果你需要**完整的软件项目执行工作流**，选择 `daoge-docs`：它负责产品蓝图、版本 PRD、功能规格、架构、测试、门禁、证据、开发者工作台与受控 Goal 输入。

如果你需要**可独立复制的文档规范与检查工具**，选择 `spec-docs`：它提供 S/M/L 分档文档骨架、功能规格和需求追踪方法、结构检查与交付证据门禁，适合希望直接维护 Markdown 文档和脚本的项目。它不生成 DAOGE Docs 工作台或 Goal 系统。

如果你的目标是**规划、生成、管理或交付图片资产**，选择 `daoge-pic`：它会先在稳定工作区自动打开或复用 Studio，再为当前会话建立独立 Session 和项目上下文，然后澄清 brief、确认创作计划并管理受控生成与交付。

两者可以在同一产品里配合，但**不互相依赖**：

```text
daoge-docs
  提供项目文档治理、开发工作台与受控 Goal 执行流程

spec-docs
  提供可移植的文档骨架、规格方法、结构检查与证据门禁

daoge-pic
  管理项目中需要批量生成或审阅的图像资产
```

例如，产品团队可以用 `daoge-docs` 规划一个电商内容系统，再用 `daoge-pic` 为其中的营销素材、商品图或活动海报建立批量生图工作区。轻量项目也可以单独使用 `spec-docs`，不依赖 DAOGE Docs 的工作台或 Goal 工具。

## 安装

可以只装一个 Skill，也可以按需装多个。`daoge-docs` 和 `spec-docs` 通过 `npx skills add` 安装；`daoge-pic` 稳定版必须使用对应 GitHub Release 的不可变 `.tgz` 制品。对 `daoge-pic` 而言，npm 安装负责提供 `daoge` CLI 和运行时，link/junction 步骤负责把同一个已安装包注册为宿主 Skill；**两步缺一不可**。

`daoge-pic` 实际运行下限为 Node.js `22.17.0`：Studio 搜索要求内置 SQLite 启用 FTS5，Windows 安全媒体读取还要求 libuv 1.51.0 修复后的路径 / 句柄文件身份一致性。Windows 建议使用同一普通用户在本地 NTFS 目录完成项目级安装和运行；PowerShell 执行策略阻止 `.ps1` shim 时使用 `npm.cmd`、`npx.cmd` 或 `daoge.cmd`，不要放宽全局执行策略。Studio 工作区不得放在 OneDrive/同步盘、UNC/网络共享、移动盘、WSL 挂载路径或 junction/symlink 根上。

安装 `daoge-docs`：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s daoge-docs
```

安装 `spec-docs`：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s spec-docs
```

安装 `daoge-pic` 当前稳定版（`6.2.0`）：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v6.2.0/daoge-pic-6.2.0.tgz"
npx daoge register-skill --scope project --workspace /absolute/workspace
npx daoge doctor --workspace /absolute/workspace
```

Windows PowerShell 使用 `.cmd` shim，不需要放宽执行策略：

```powershell
npm.cmd install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v6.2.0/daoge-pic-6.2.0.tgz"
npx.cmd daoge register-skill --scope project --workspace "C:\Users\<用户名>\source\<项目名>"
npx.cmd daoge doctor --workspace "C:\Users\<用户名>\source\<项目名>"
```

`register-skill` 跨 macOS、Linux 和 Windows 创建项目级 Skill 注册：Windows 使用 junction，其他平台使用目录符号链接。目标已存在时直接失败，不删除或覆盖已有目录。`doctor` 不调用图片 Provider；它在初始化 Studio 前检查目录、SQLite、权限、原生 `sharp`，并在 Windows 通过系统 PowerShell/.NET 检查本地固定 NTFS 磁盘和默认浏览器关联。

需要全局安装时：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v6.2.0/daoge-pic-6.2.0.tgz"
daoge register-skill --scope user
```

Windows PowerShell：

```powershell
npm.cmd install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v6.2.0/daoge-pic-6.2.0.tgz"
daoge.cmd register-skill --scope user
```

完成注册后重启对应宿主（Codex 等），使其重建 Skill registry。GitHub Release `.tgz` 资产不表示该包已发布到 npm registry；安装应继续使用上述不可变 Release URL。

如需直接试用 `main` 分支的开发源码，可使用 `npx skills add` 明确安装 Skill 路径；该方式不等同于固定版本的 GitHub Release 制品：

```bash
npx skills add https://github.com/ccnuzw/daoge-skills/tree/main/skills/daoge-pic -a codex
```

安装 Skill 后需重启宿主，使其重新加载 Skill registry。安装一个能力不会自动安装仓库中的其他能力。

## 三条起步路径

### 软件项目与文档驱动开发

在一个新软件项目中，可以直接对智能体说：

```text
使用 daoge-docs 为我启动一个新项目。
先完成产品规划、V1 文档体系和开发执行工作台；
所有未知业务规则都标为待确认，先不要写业务代码。
```

详细流程、工作台、门禁与 Goal 说明见 [DAOGE Docs README](./skills/daoge-docs/README.md)。

### 规格模板与文档门禁

`spec-docs` 适合希望直接维护项目 Markdown、复用规格模板并运行结构与交付证据检查的项目。可以对智能体说：

```text
使用 spec-docs 按当前项目规模建立或维护文档体系；先检查现有仓库，未知业务规则标为待确认，完成后运行结构检查。
```

初始化选项、S/M/L 分档和脚本说明见 [Spec Docs README](./skills/spec-docs/README.md)。

### 本地图像创作与资产管理

`daoge-pic` 的主入口是**会话**。执行型请求会先解析已绑定的稳定工作区，自动执行普通 `open` 以打开或复用 Studio，再用当前真实 conversation ID 建立独立 Session 和项目 / 任务 / 批次上下文，随后才澄清创作目标、数量、画幅、风格、限制、参考素材与交付用途。咨询架构、配置、源码、文档或测试时不会启动 Studio。

```bash
node skills/daoge-pic/scripts/daoge.js open --workspace /absolute/workspace
```

6.0.0 起，**界面承担过程、会话负责决策**，动线固定为五步：

| 步骤 | 在哪做 | 发生什么 |
| --- | --- | --- |
| 建立项目 | 项目首页 | 只写 Studio 结构化上下文，不触发 Provider |
| 提出需求 | 底栏输入框（可先圈选画布上的图） | 请求进共享队列，Agent 接单、澄清、写出版本化计划 |
| 生成运行 | 卡片「就这么出」 | 人确认 → 预检 → 该批次唯一运行 |
| 选片评审 | 创作画布 / 放大查看 | 评审写入业务关系；重试 / 恢复走队列再花钱 |
| 资产交付 | 交付页 | 冻结选片与评审，导出三件套 |

同一工作区的多个会话共享唯一 daemon 与 Workbench：presence / open-claim 只允许首个调用触发系统 opener，其余调用返回复用结果。每个会话的 Studio Session、项目与 Run 归属保持隔离。真实生成只读取 `<workspace>/daoge-studio/Provider.db` 中已激活的 Profile、密钥引用与 write-only 摘要，并按配置读取系统密钥后端；既有 `provider.env` 仅用于首次迁移或显式 import，不再是运行时配置源。

Workbench **不提供开放式对话**，只提供一个受限请求入口：用户说的话进入与 Agent 共享的请求队列，由在场 Agent 接单；**暂停 / 取消**等止损动作可直达，**重试 / 恢复**等会花钱的动作走队列。它不读取 `task_spec.json`、旧静态工作区或旧目录状态。完整协议、五步动线、Workbench 与安全边界见 [DAOGE Pic vNext README](./skills/daoge-pic/README.md)。

## 系列原则

- **中文优先**：面向用户的对话、手册、工作台与业务文档默认使用中文；保留必要的代码标识、协议和专业术语。
- **单一入口**：每项能力都有明确的 Skill 名称、脚本入口和用户手册，不要求用户从内部临时文件或历史脚本开始。
- **可检查的中间态**：文档 Skill 以权威 Markdown、门禁和证据约束流程；图像创作 Skill 以可确认的创作计划、干跑证据、SQLite Studio 事件和 Workbench 约束运行与交付。
- **边界清晰**：Skill 不把未知输入伪造成结论，也不把预览、结构检查或局部验证冒充最终交付。
- **独立演进**：不同 Skill 的依赖、运行时、工作区和版本标签独立管理，新增 Skill 不应破坏现有 Skill 的安装和使用。

## 仓库结构

```text
.
├── README.md                         # DAOGE 系列入口
├── LICENSE
├── CONTRIBUTING.md
├── SECURITY.md
├── CHANGELOG.md
├── docs/                             # 系列资料、发布说明、历史证据
│   ├── daoge_pic_6.2.0_release_notes_zh.md
│   ├── daoge_pic_6.1.0_release_notes_zh.md
│   ├── daoge_pic_6.0.0_release_notes_zh.md
│   ├── release_sop_zh.md
│   └── plans/                        # 重构方案、规格书与批次施工单
└── skills/
    ├── daoge-docs/
    │   ├── README.md                 # 开发者使用手册
    │   ├── SKILL.md                  # 宿主执行规范
    │   ├── scripts/daoge_docs.py
    │   ├── assets/
    │   └── references/
    ├── spec-docs/
    │   ├── README.md                 # 使用说明与安装方法
    │   ├── SKILL.md                  # 宿主执行规范
    │   ├── scripts/                  # 文档初始化、结构检查与证据门禁
    │   ├── assets/skeleton/          # 可复制的文档骨架
    │   ├── references/               # 方法论、规格、治理与证据规范
    │   └── evals/                    # 可判定的 Skill 评测场景
    └── daoge-pic/
        ├── README.md                 # vNext Studio 使用手册与版本状态
        ├── SKILL.md                  # 宿主执行规范
        ├── scripts/daoge.js          # Studio CLI 入口
        ├── src/vnext/                # SQLite Studio、运行、媒体与安全逻辑
        ├── web/src/                  # React Workbench 源码（app / views / canvas / styles / tokens）
        ├── docs/                     # vNext 规格与验证证据
        └── references/               # SKILL.md 的按需附录（agent 在执行时按触发条件读取）
```

`SKILL.md` 供智能体在任务触发时读取，README 面向使用者与维护者。请优先从各 Skill 自己的 README 进入具体流程。`skills/daoge-pic/SKILL.md` 是常驻执行协议（约 10.6 KB / 约 3.2k tokens），长尾策略放在 `references/` 目录并在主文件里逐条给出触发条件：命令总表与高风险签名、运行恢复、交付、状态模型、Provider/密钥、Workbench 边界。

## 发布与反馈

每个 Skill 独立维护版本和发布说明。更新某个 Skill 时，应只修改其自身范围内的代码、模板、测试和 README，并运行相应验证；不要因为多个 Skill 位于同一仓库而假设它们共享运行时或发布条件。

- `daoge-pic` 当前稳定正式版本为 [v6.2.0](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v6.2.0)；`v6.1.1`、`v6.1.0`、`v6.0.0` 及更早为不可变历史发布。发布验证与历次版本证据在 [vNext 验证记录](./skills/daoge-pic/docs/vnext_verification_evidence_zh.md) 中分章记录。
- `spec-docs` 当前版本为 [1.1.0](https://github.com/ccnuzw/daoge-skills/releases/tag/spec-docs-v1.1.0)，使用 `spec-docs-vX.Y.Z` 独立标记和发布；安装方法见 [Spec Docs README](./skills/spec-docs/README.md)。
- 贡献方式见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
- 安全问题请按 [SECURITY.md](./SECURITY.md) 的私密报告方式提交。
- 系列级变更记录见 [CHANGELOG.md](./CHANGELOG.md)。
- `daoge-docs` 的平台与发布矩阵见 [兼容性与安装契约](./skills/daoge-docs/references/compatibility.md)。

本项目使用 [MIT License](./LICENSE)。
