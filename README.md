# DAOGE Skills

DAOGE is a Chinese-first interactive batch image generation skill for Codex.

This repository currently distributes one Codex skill:

- `interactive-image-batch`

It is designed for guided, repeatable, large-batch image generation runs driven by dialogue, optional markdown prompt libraries, and a local `.env` for provider credentials.

## What DAOGE does

- Chinese-first guided intake for batch image generation
- Prompt preview before execution
- Native size image generation
- Batch, staged-run, sample-run, and auto-pause controls
- Retry, timeout, concurrency, and skip-existing controls
- Failure rerun workflow with manifests and reports
- Project-level and global Codex installation compatibility

## Repository layout

```text
skills/
  interactive-image-batch/
    SKILL.md
    agents/openai.yaml
    scripts/
    references/
```

## Install with `npx skills`

Install project-level for Codex:

```bash
npx skills add ccnuzw/daoge-skills -a codex -s interactive-image-batch
```

Install global for Codex:

```bash
npx skills add ccnuzw/daoge-skills -a codex -s interactive-image-batch -g
```

Install directly from the skill path:

```bash
npx skills add https://github.com/ccnuzw/daoge-skills/tree/main/skills/interactive-image-batch -a codex
```

After installation, restart Codex so the new skill is picked up cleanly.

## Manual install

If you do not want to use `npx skills`, copy the `interactive-image-batch` folder into one of these locations:

- Project-level: `.agents/skills/interactive-image-batch/`
- Global: `~/.codex/skills/interactive-image-batch/`

DAOGE rerun commands also tolerate these fallback runner locations:

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

Required:

- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`

Optional:

- `OPENAI_MODEL`

If `OPENAI_MODEL` is omitted, DAOGE defaults to `gpt-image-2`.

Runtime controls such as total count, batch size, concurrency, retry count, timeout, size, aspect ratio, preview mode, staged execution, and prompt source are injected through dialogue instead of `.env`.

## Basic usage

Wake up DAOGE in Chinese and let it guide the run:

- `刀哥，我来了`
- `刀哥，来跑批`
- `刀哥，生图`
- `刀哥，起来干活`
- `刀哥，开始批量生图`
- `DAOGE，开工`

You can provide:

- direct creative requirements
- a markdown prompt library path
- target total count
- output mode such as poster, e-commerce visual, illustration, or other
- explicit runtime requirements such as 2K, 9:16, concurrency, retries, timeout, staged execution, and preview preference

## Recommended verification after install

Use one of these checks:

1. Restart Codex and ask for:

```text
刀哥，我来了
```

2. Or ask Codex to use the skill explicitly:

```text
使用 interactive-image-batch，先帮我确认这次批量生图参数
```

If the skill is discovered correctly, DAOGE should answer in Chinese and enter the guided intake flow.

## Updating

Project-level reinstall:

```bash
npx skills add ccnuzw/daoge-skills -a codex -s interactive-image-batch
```

Global reinstall:

```bash
npx skills add ccnuzw/daoge-skills -a codex -s interactive-image-batch -g
```

If you install manually, overwrite the local skill folder with the updated `interactive-image-batch` directory and restart Codex.

## Notes

- DAOGE is optimized for Codex usage.
- The skill itself does not store provider secrets; `.env` stays in your project.
- Large runs are expected. DAOGE includes preview, staging, pause, rerun, and reporting workflows to keep batch generation stable.

## Maintainer docs

- Release notes template: `docs/release_notes_template_zh.md`
- Release SOP: `docs/release_sop_zh.md`
