# DAOGE Skills

DAOGE Skills 是一个面向 Codex 的技能仓库，目前主打中文工作流下的批量生图能力。

当前仓库包含的核心 skill：

- `skills/interactive-image-batch`

它适合需要下面这些能力的场景：

- 批量文生图
- 带参考图的图生图
- 带 mask 的局部重绘
- 口播分镜板 / 故事板 / 连续分镜任务
- 从 Markdown 提示词库生成成批 prompts
- 带预检、预览、分批执行、失败续跑、结果汇总的稳定工作流

---

## 这个仓库解决什么问题

很多“批量生图脚本”只做一件事：

- 读一个 prompts 文件
- 调一次接口
- 出错就结束

DAOGE 走的是另一条路线：

- 先把需求结构化
- 再把 prompt 分发策略显式化
- 再批量执行
- 最后把失败、复跑、看板、结果归档全部做出来

它更像一个完整生产工作流，而不是一个临时调用器。

---

## 当前包含的 skill

### `interactive-image-batch`

这是仓库当前的主 skill，能力包括：

- 中文优先的对话式 intake
- `task_spec.json` / `prompt_strategy.json` / `prompts.generated.json` 工作流
- prompt preview / preflight dashboard
- batch / staged run / sample run
- retry / timeout / concurrency / skip-existing
- failure rerun / resume manifest
- storyboard / reference bindings / slot-based generation
- 文生图 / 图生图 / 局部重绘

完整说明见：

- [`skills/interactive-image-batch/README.md`](./skills/interactive-image-batch/README.md)
- [`skills/interactive-image-batch/SKILL.md`](./skills/interactive-image-batch/SKILL.md)

---

## 安装

### 用 `npx skills` 安装

项目级安装：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s interactive-image-batch
```

全局安装：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s interactive-image-batch -g
```

也可以直接从 skill 路径安装：

```bash
npx skills add https://github.com/ccnuzw/daoge-skills/tree/main/skills/interactive-image-batch -a codex
```

安装后建议重启 Codex。

### 手动安装

把 `skills/interactive-image-batch` 复制到以下任一目录：

- 项目级：`.agents/skills/interactive-image-batch/`
- 全局：`~/.codex/skills/interactive-image-batch/`

---

## 运行时配置

在项目根目录准备 `.env`：

```env
OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-image-2
OPENAI_RESPONSES_MODEL=gpt-5.4
```

必填：

- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`

常用：

- `OPENAI_MODEL`
- `OPENAI_RESPONSES_MODEL`

其中：

- `OPENAI_MODEL` 是真正的出图模型
- `OPENAI_RESPONSES_MODEL` 是 Responses 路径下的顶层调度模型

---

## 路由策略

仓库当前采用“成功率优先”的策略，而不是强行把所有模式统一到一个 API。

### 文生图

- 默认走 `Images API`
- 如果 provider 更适合 `Responses`，可以开启 `Responses`
- 开启后失败会自动 fallback

### 无 mask 图生图

- 支持 `Responses` 优先
- 失败时自动回退到 `Images API edits`

### 带 mask 的局部重绘

- 固定走 `Images API edits`

这样设计的目的很明确：

- 保留现代路径
- 但不牺牲稳定性

---

## 仓库结构

```text
.
├── README.md
├── docs/
└── skills/
    └── interactive-image-batch/
        ├── README.md
        ├── SKILL.md
        ├── agents/
        ├── references/
        └── scripts/
```

- `README.md`
  - 仓库首页说明
- `docs/`
  - 维护和发布相关文档
- `skills/interactive-image-batch/README.md`
  - 这个 skill 的完整介绍与使用方式
- `skills/interactive-image-batch/SKILL.md`
  - skill 行为规范与内部工作流

---

## 推荐阅读顺序

如果你是第一次接触这个仓库，建议按这个顺序看：

1. 仓库首页 `README.md`
2. `skills/interactive-image-batch/README.md`
3. `skills/interactive-image-batch/SKILL.md`
4. `skills/interactive-image-batch/references/`
5. `skills/interactive-image-batch/scripts/`

---

## 维护说明

当前仓库以 `main` 作为默认主线。

如果你要看 skill 的完整展示页，请直接进入：

- [`skills/interactive-image-batch/README.md`](./skills/interactive-image-batch/README.md)

---

## Maintainer Docs

- [`docs/release_notes_template_zh.md`](./docs/release_notes_template_zh.md)
- [`docs/release_sop_zh.md`](./docs/release_sop_zh.md)
