# DAOGE Skills

DAOGE Skills 提供两项可独立安装的中文工作流能力：

- [`skills/interactive-image-batch`](./skills/interactive-image-batch/README.md)
- [`skills/daoge-docs`](./skills/daoge-docs/README.md)

## 选择 Skill

| Skill | 用途 | 最短入口 |
| --- | --- | --- |
| `interactive-image-batch` | 把批量生图需求整理为可执行任务，并在本地工作台管理结果与问题 | `node scripts/daoge.js open --output-dir out` |
| `daoge-docs` | 建立中文文档驱动开发体系、开发执行工作台与可恢复 Goal | `python3 .daoge-docs/daoge_docs.py init --root . --project-name <名称> --project-code <代码> --version V1 --profile strict` |

生图工作流的最短入口：

```bash
cd skills/interactive-image-batch
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
node scripts/daoge.js execute --output-dir out --env-file .env
open out/workspace/index.html
```

`workspace/index.html` 是唯一推荐工作台入口。准备、结果、问题和记录页都从这里进入。

## 安装

项目级安装 `daoge-docs`：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s daoge-docs
```

项目级安装生图 Skill：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s interactive-image-batch
```

全局安装 `daoge-docs`：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s daoge-docs -g
```

全局安装生图 Skill：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s interactive-image-batch -g
```

也可以直接从单个 Skill 路径安装：

```bash
npx skills add https://github.com/ccnuzw/daoge-skills/tree/main/skills/interactive-image-batch -a codex
npx skills add https://github.com/ccnuzw/daoge-skills/tree/main/skills/daoge-docs -a codex
```

安装后重启 Codex。

## 生图运行配置

在执行任务的项目里准备 `.env`：

```env
OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-image-2
OPENAI_RESPONSES_MODEL=gpt-5.4
```

必填：

- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`

## 仓库结构

```text
.
├── README.md
├── docs/
└── skills/
    ├── interactive-image-batch/
    │   ├── README.md
    │   ├── SKILL.md
    │   ├── scripts/daoge.js
    │   ├── src/
    │   └── references/
    └── daoge-docs/
        ├── README.md
        ├── SKILL.md
        ├── scripts/daoge_docs.py
        ├── assets/
        └── references/
```

完整使用说明见 [`skills/interactive-image-batch/README.md`](./skills/interactive-image-batch/README.md) 和 [`skills/daoge-docs/README.md`](./skills/daoge-docs/README.md)。
