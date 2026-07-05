# DAOGE Skills

DAOGE Skills 当前主能力是中文批量生图工作台：

- [`skills/interactive-image-batch`](./skills/interactive-image-batch/README.md)

新用户只需要记住一个入口：

```bash
cd skills/interactive-image-batch
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
node scripts/daoge.js execute --output-dir out --env-file .env
open out/workspace/index.html
```

`workspace/index.html` 是唯一推荐工作台入口。准备、结果、问题和记录页都从这里进入。

## 安装

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

安装后重启 Codex。

## 运行配置

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
    └── interactive-image-batch/
        ├── README.md
        ├── SKILL.md
        ├── scripts/daoge.js
        ├── src/
        └── references/
```

完整使用说明见 [`skills/interactive-image-batch/README.md`](./skills/interactive-image-batch/README.md)。
