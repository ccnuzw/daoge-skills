# DAOGE Skills

This repository distributes the DAOGE interactive batch image generation skill for Codex.

## Included skill

- `interactive-image-batch`

Repository layout:

```text
skills/
  interactive-image-batch/
    SKILL.md
    agents/openai.yaml
    scripts/
    references/
```

## Install with `npx skills`

Project-level install for Codex:

```bash
npx skills add <owner>/<repo> -a codex -s interactive-image-batch
```

Global install for Codex:

```bash
npx skills add <owner>/<repo> -a codex -s interactive-image-batch -g
```

You can also install from the direct GitHub path:

```bash
npx skills add https://github.com/<owner>/<repo>/tree/main/skills/interactive-image-batch -a codex
```

## Codex locations

- Project-level: `.agents/skills/interactive-image-batch/`
- Global: `~/.codex/skills/interactive-image-batch/`

The DAOGE rerun command also tolerates these fallback locations:

- `./.agents/skills/interactive-image-batch/`
- `./.codex/skills/interactive-image-batch/`
- `~/.codex/skills/interactive-image-batch/`

## Runtime config

Create `.env` in your project root:

```env
OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-image-2
```

Only `OPENAI_BASE_URL` and `OPENAI_API_KEY` are required. Runtime controls such as total count, batch size, concurrency, retry count, timeout, size, aspect ratio, preview mode, staged execution, and prompt source are provided through DAOGE dialogue.

## Wake-up examples

- `刀哥，我来了`
- `刀哥，来跑批`
- `刀哥，生图`
- `刀哥，起来干活`
- `DAOGE，开工`
