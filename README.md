# DAOGE Skills

面向中文工作流的 DAOGE Skill 系列。每个 Skill 都是可独立安装、独立使用、独立演进的能力包：Skill 负责把自然语言需求转化为可执行的标准流程，附带的脚本、参考资料和本地工作台负责让关键过程可检查、可恢复、可交付。

当前仓库包含两项彼此独立的能力：

| Skill | 解决的问题 | 主要使用者 | 独立说明 |
| --- | --- | --- | --- |
| [`daoge-pic`](./skills/daoge-pic/README.md) | 将批量生图需求整理为可审阅任务，执行或回填结果，并在本地工作台完成筛选、问题处理与导出 | 内容团队、设计师、运营人员、图像工作流开发者 | [进入生图 Skill](./skills/daoge-pic/README.md) |
| [`daoge-docs`](./skills/daoge-docs/README.md) | 建立中文文档驱动开发体系，生成开发执行工作台和受控 Goal 输入 | 产品、研发、架构与使用编程智能体的团队 | [进入文档 Skill](./skills/daoge-docs/README.md) |

## 选择 Skill

如果你的目标是“规划和交付一个软件项目”，选择 `daoge-docs`：它负责产品蓝图、版本 PRD、功能规格、架构、测试、门禁、证据、开发者工作台与 Goal 输入。

如果你的目标是“批量生成、管理或回填图片资产”，选择 `daoge-pic`：它负责把 brief 整理为 `task_spec.json`、提示词、批次计划、问题队列和本地资产工作台。

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

### 批量生图与资产管理

在 `daoge-pic` 目录准备一个任务说明后，先生成可审阅工作区：

```bash
node scripts/daoge.js prepare \
  --task-spec references/examples/task_spec.minimal.json \
  --output-dir out
node scripts/daoge.js open --output-dir out
```

`prepare` 不调用图片 provider；先在本地工作台检查任务、提示词和素材，再决定使用本地 provider 执行，或让其他宿主工具生成图片后再回填结果。完整流程见 [DAOGE Pic README](./skills/daoge-pic/README.md)。

## 系列原则

- **中文优先**：面向用户的对话、手册、工作台与业务文档默认使用中文；保留必要的代码标识、协议和专业术语。
- **单一入口**：每项能力都有明确的 Skill 名称、脚本入口和用户手册，不要求用户从内部临时文件或历史脚本开始。
- **可检查的中间态**：文档 Skill 以权威 Markdown、门禁和证据约束流程；生图 Skill 以任务规格、提示词、问题队列和工作台约束流程。
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
        ├── README.md                 # 生图工作流使用手册
        ├── SKILL.md                  # Codex 执行规范
        ├── scripts/daoge.js
        ├── app/                      # 本地工作台
        ├── src/                      # CLI、契约与运行逻辑
        └── references/               # 示例、模板与接入契约
```

`SKILL.md` 供 Codex 在任务触发时读取，README 面向使用者与维护者。请优先从各 Skill 自己的 README 进入具体流程。

## 发布与反馈

每个 Skill 独立维护版本和发布说明。更新某个 Skill 时，应只修改其自身范围内的代码、模板、测试和 README，并运行相应验证；不要因为两个 Skill 位于同一仓库而假设它们共享运行时或发布条件。

- 贡献方式见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
- 安全问题请按 [SECURITY.md](./SECURITY.md) 的私密报告方式提交。
- 系列级变更记录见 [CHANGELOG.md](./CHANGELOG.md)。
- `daoge-docs` 的平台与发布矩阵见 [兼容性与安装契约](./skills/daoge-docs/references/compatibility.md)。

本项目使用 [MIT License](./LICENSE)。
