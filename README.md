# DAOGE Skills

面向中文工作流的 DAOGE Skill 系列。每个 Skill 都是可独立安装、独立使用、独立演进的能力包：Skill 负责把自然语言需求转化为可执行的标准流程，附带的脚本、参考资料和本地工作台负责让关键过程可检查、可恢复、可交付。

当前仓库包含两项彼此独立的能力：

| Skill | 解决的问题 | 主要使用者 | 独立说明 |
| --- | --- | --- | --- |
| [`daoge-pic`](./skills/daoge-pic/README.md) | 会话优先的本地图像创作管理：确认创作计划后，以 SQLite Studio、后台运行与 Workbench 管理生成、资产与交付 | 内容团队、设计师、运营人员、图像工作流开发者 | [进入图像创作 Skill](./skills/daoge-pic/README.md) |
| [`daoge-docs`](./skills/daoge-docs/README.md) | 建立中文文档驱动开发体系，生成开发执行工作台和受控 Goal 输入 | 产品、研发、架构与使用编程智能体的团队 | [进入文档 Skill](./skills/daoge-docs/README.md) |

## 选择 Skill

如果你的目标是“规划和交付一个软件项目”，选择 `daoge-docs`：它负责产品蓝图、版本 PRD、功能规格、架构、测试、门禁、证据、开发者工作台与 Goal 输入。

如果你的目标是“规划、生成、管理或交付图片资产”，选择 `daoge-pic`：它负责在会话中澄清 brief、确认创作计划，并用本地 Studio 管理项目、轮次、受控生成运行、资产复核和交付。它不兼容旧任务 JSON、静态工作区或目录状态工作流。

两者可以在同一产品中共同使用，但不互相依赖：

```text
daoge-docs
  定义软件产品、版本、功能与开发任务边界

daoge-pic
  管理项目中需要批量生成或审阅的图像资产
```

例如，产品团队可以用 `daoge-docs` 规划一个电商内容系统，再用 `daoge-pic` 为其中的营销素材、商品图或活动海报建立批量生图工作区。二者的文档、数据、运行环境和发布节奏仍然独立。

## 安装

可以只安装一个 Skill，也可以按需安装多个。以下命令使用 `npx skills add` 为 Codex 安装指定能力。

安装 `daoge-docs`：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s daoge-docs
```

安装 `daoge-pic`：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s daoge-pic
```

需要全局安装时，加 `-g`：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s daoge-docs -g
npx skills add ccnuzw/daoge-skills -a codex -s daoge-pic -g
```

也可以直接从单个 Skill 的 GitHub 路径安装：

```bash
npx skills add https://github.com/ccnuzw/daoge-skills/tree/main/skills/daoge-docs -a codex
npx skills add https://github.com/ccnuzw/daoge-skills/tree/main/skills/daoge-pic -a codex
```

安装后重启 Codex，使新增 Skill 被重新发现。安装一个 Skill 不会自动安装仓库中的另一个 Skill。

## 两条起步路径

### 软件项目与文档驱动开发

在一个新软件项目中，可以直接对 Codex 说：

```text
使用 daoge-docs 为我启动一个新项目。
先完成产品规划、V1 文档体系和开发执行工作台；
所有未知业务规则都标为待确认，先不要写业务代码。
```

详细流程、工作台、门禁与 Goal 说明见 [DAOGE Docs README](./skills/daoge-docs/README.md)。

### 本地图像创作与资产管理

`daoge-pic` 的主入口是会话。先在会话中确认创作目标、数量、画幅、风格、限制、参考素材与交付用途；只有得到用户明确确认后，才可创建受控生成运行。为每个项目指定稳定工作区后，可启动 Studio：

```bash
node skills/daoge-pic/scripts/daoge.js studio --workspace /absolute/workspace
node skills/daoge-pic/scripts/daoge.js open --workspace /absolute/workspace
```

真实生成只从 `<workspace>/daoge-studio/provider.env` 读取 Provider 配置。Workbench 用于查看项目、轮次、运行、资产、复核和交付，不提供第二个聊天入口，也不读取 `task_spec.json`、旧静态工作区或旧目录状态。完整流程见 [DAOGE Pic v5 README](./skills/daoge-pic/README.md)。

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
├── docs/                             # 系列与历史补充资料
└── skills/
    ├── daoge-docs/
    │   ├── README.md                 # 开发者使用手册
    │   ├── SKILL.md                  # Codex 执行规范
    │   ├── scripts/daoge_docs.py
    │   ├── assets/
    │   └── references/
    └── daoge-pic/
        ├── README.md                 # v5 Studio 使用手册
        ├── SKILL.md                  # Codex 执行规范
        ├── scripts/daoge.js          # Studio CLI 入口
        ├── src/vnext/                # SQLite Studio、运行与媒体逻辑
        ├── web/                      # React Workbench 源码
        ├── docs/                     # vNext 规格与验证证据
        └── references/provider.env.example
```

`SKILL.md` 供 Codex 在任务触发时读取，README 面向使用者与维护者。请优先从各 Skill 自己的 README 进入具体流程。

## 发布与反馈

每个 Skill 独立维护版本和发布说明。更新某个 Skill 时，应只修改其自身范围内的代码、模板、测试和 README，并运行相应验证；不要因为两个 Skill 位于同一仓库而假设它们共享运行时或发布条件。`daoge-pic` 当前正式版本为 [v5.1.0](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.1.0)，其发布包、校验和和机器验证记录位于该 Release 与 [vNext 验证记录](./skills/daoge-pic/docs/vnext_verification_evidence_zh.md)。

- 贡献方式见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
- 安全问题请按 [SECURITY.md](./SECURITY.md) 的私密报告方式提交。
- 系列级变更记录见 [CHANGELOG.md](./CHANGELOG.md)。
- `daoge-docs` 的平台与发布矩阵见 [兼容性与安装契约](./skills/daoge-docs/references/compatibility.md)。

本项目使用 [MIT License](./LICENSE)。
