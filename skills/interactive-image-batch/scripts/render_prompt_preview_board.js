const path = require('path');
const { parseArgs, readJson, fileExists } = require('./script_utils');
const { renderPortalTopLinks } = require('./portal_shared');
const { renderPortalHeadAssets } = require('./portal_ui_shared');
const { topLabel, resolveProfile, buildDisplayDistributions, normalizeValue } = require('./template_display_profile');

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function relativeFile(outputDir, targetPath) {
  if (!targetPath) return null;
  return path.relative(outputDir, targetPath);
}

function getPromptText(item) {
  return item.generation_prompt || item.prompt || '';
}

function shorten(text, max = 280) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function renderLink(label, href) {
  if (!href) return '';
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function renderList(items, emptyText = '未提供') {
  if (!items.length) return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  return `<ul class="info-list">${items.map((item) => `<li>${escapeHtml(item.name)}: ${escapeHtml(item.count)}</li>`).join('')}</ul>`;
}

function renderMetaRow(label, value) {
  if (!value && value !== 0) return '';
  return `
    <div class="meta-row">
      <div class="meta-label">${escapeHtml(label)}</div>
      <div class="meta-value">${escapeHtml(value)}</div>
    </div>
  `;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['prompts-file']) throw new Error('Missing required flag: --prompts-file');

  const promptsFile = path.resolve(args['prompts-file']);
  const prompts = readJson(promptsFile);
  if (!Array.isArray(prompts)) throw new Error(`Prompt file must be a JSON array: ${promptsFile}`);

  const planPath = path.resolve(args['plan-file'] || path.join(path.dirname(promptsFile), 'batch_plan.json'));
  const summaryPath = path.resolve(args['summary-file'] || path.join(path.dirname(promptsFile), 'daoge_run_summary.md'));
  const markdownPath = path.resolve(args['markdown-file'] || path.join(path.dirname(promptsFile), 'prompt_preview.md'));
  const outputDir = path.dirname(promptsFile);
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'prompt_preview.html'));

  const batches = fileExists(planPath) ? readJson(planPath) : [];
  const previewCount = Math.min(Number(args['preview-count'] || 8), prompts.length);
  const previewItems = prompts.slice(0, previewCount);
  const storyboardMode = prompts.some((item) => item.slot_id || item.shot_id || item.layout_region_id);

  const displayProfile = resolveProfile(prompts);
  const displayDistributions = buildDisplayDistributions(prompts, displayProfile)
    .map((item) => ({ ...item, counts: item.counts.slice(0, 8) }));
  const styleFamily = displayDistributions.find((item) => item.key === 'style_family')?.counts || [];
  const purityGrade = buildDisplayDistributions(prompts, {
    distributionFields: [{ key: 'purity_grade', label: '强度等级', shortLabel: '强度等级分布' }],
  })[0]?.counts || [];
  const slotRole = buildDisplayDistributions(prompts, {
    distributionFields: [{ key: 'slot_role', label: '槽位角色', shortLabel: '槽位角色分布' }],
  })[0]?.counts || [];

  const preflightBoardPath = path.join(outputDir, 'preflight_board.html');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DAOGE Prompt Preview</title>
${renderPortalHeadAssets()}
  <style>
    :root {
      --bg: #0e1318;
      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --info: #88b9ff;
      --success: #7cc5a3;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at top left, rgba(217,179,109,0.18), transparent 26%),
        linear-gradient(135deg, #0a0f13 0%, #101720 45%, #0e1318 100%);
      color: var(--text-main);
      font-family: "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
    }
    .shell {
      max-width: 1480px;
      margin: 0 auto;
      padding: 28px 24px 56px;
    }
    .hero, .section, .prompt-card {
      border: 1px solid var(--panel-border);
      background: var(--panel);
      backdrop-filter: blur(12px);
      border-radius: 24px;
      box-shadow: 0 18px 48px rgba(0,0,0,0.24);
    }
    .hero {
      padding: 28px 28px 24px;
      background:
        linear-gradient(160deg, rgba(136,185,255,0.15), transparent 38%),
        rgba(255,255,255,0.04);
      margin-bottom: 20px;
    }
    .top-links {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin: 0 0 16px;
    }
    .top-links a {
      color: var(--text-main);
      text-decoration: none;
      padding: 10px 14px;
      border-radius: 14px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      font-size: 13px;
    }
    .eyebrow {
      display: inline-flex;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,0.08);
      color: var(--accent);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 14px;
    }
    h1 {
      margin: 0 0 12px;
      font-size: 34px;
      line-height: 1.1;
      letter-spacing: 0.02em;
    }
    .hero-copy {
      margin: 0;
      color: var(--text-sub);
      line-height: 1.7;
      max-width: 76ch;
    }
    .hero-grid, .section-grid, .prompt-grid {
      display: grid;
      gap: 16px;
    }
    .hero-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: 20px;
    }
    .section-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .prompt-grid {
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    }
    .metric-value {
    }
    .metric-info .metric-value { color: var(--info); }
    .metric-success .metric-value { color: var(--success); }
    .prompt-card {
      padding: 20px;
    }
    .prompt-card-title {
      font-size: 18px;
      margin: 0 0 10px;
    }
    .prompt-card-copy {
      color: var(--text-sub);
      line-height: 1.7;
      margin: 14px 0 0;
      font-size: 14px;
    }
    .meta-list {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }
    .meta-row {
      display: grid;
      grid-template-columns: 110px 1fr;
      gap: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .meta-row:last-child { border-bottom: none; padding-bottom: 0; }
    .meta-label {
      color: var(--text-sub);
      font-size: 12px;
    }
    .meta-value {
      font-size: 13px;
      line-height: 1.6;
    }
    @media (max-width: 1080px) {
      .hero-grid, .section-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 720px) {
      .shell { padding: 18px 14px 44px; }
      h1 { font-size: 28px; }
      .hero-grid, .section-grid, .prompt-grid { grid-template-columns: 1fr; }
      .meta-row { grid-template-columns: 1fr; gap: 6px; }
    }
  </style>
</head>
<body data-portal-page="prompt_preview.html">
  <div class="shell">
    <section class="hero">
      <div class="top-links">
        ${renderPortalTopLinks(outputDir, {
          currentPage: 'prompt_preview.html',
          extraLinks: [
            { label: 'Markdown Prompt 预览', href: relativeFile(outputDir, markdownPath) },
            { label: '运行摘要 Markdown', href: relativeFile(outputDir, summaryPath) },
          ],
        })}
      </div>
      <div class="eyebrow">DAOGE Prompt Preview</div>
      <h1>DAOGE Prompt 预览</h1>
      <p class="hero-copy">这是 prepare 阶段的 Prompt HTML 预览页。它负责把这一轮的分布摘要、批次计划和代表性 Prompt 样例收在一页里，${escapeHtml(displayProfile.heroSummary)}</p>
      <div class="hero-grid">
        <div class="metric-card metric-info">
          <div class="metric-label">提示词总数</div>
          <div class="metric-value">${prompts.length}</div>
        </div>
        <div class="metric-card metric-info">
          <div class="metric-label">批次数量</div>
          <div class="metric-value">${batches.length}</div>
        </div>
        <div class="metric-card metric-success">
          <div class="metric-label">当前预览样本</div>
          <div class="metric-value">${previewItems.length}</div>
        </div>
        <div class="metric-card metric-info">
          <div class="metric-label">主风格族</div>
          <div class="metric-value">${escapeHtml(topLabel(styleFamily))}</div>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>先看什么</h2>
      <p class="section-copy">${escapeHtml(displayProfile.firstLookCopy)}</p>
      <div class="section-grid">
        <article class="info-card">
          <h3>分布摘要</h3>
          <div class="meta-list">
            ${renderMetaRow('主风格族', topLabel(styleFamily))}
            ${renderMetaRow('主强度等级', topLabel(purityGrade))}
            ${displayProfile.summaryFields.map((field, index) => renderMetaRow(field.label, topLabel(displayDistributions[index + 1]?.counts || []))).join('')}
            ${storyboardMode ? renderMetaRow('主槽位角色', topLabel(slotRole)) : ''}
          </div>
        </article>
        <article class="info-card">
          <h3>当前建议</h3>
          <ul class="info-list">
            ${displayProfile.currentAdvice.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </article>
      </div>
    </section>

    <section class="section">
      <h2>分布概览</h2>
      <p class="section-copy">${escapeHtml(displayProfile.distributionOverviewCopy)}</p>
      <div class="section-grid">
        ${displayDistributions.map((item, index) => `
          <article class="info-card"${index >= 2 ? ' style="margin-top:16px;"' : ''}>
            <h3>${escapeHtml(item.label)}</h3>
            ${renderList(item.counts)}
          </article>
        `).join('')}
      </div>
    </section>

    <section class="section">
      <h2>批次计划</h2>
      <p class="section-copy">这里反映 prepare 阶段如何切批。先确认每批大小和总批次数，避免到了执行阶段才发现节奏过重或过碎。</p>
      <article class="info-card">
        <h3>批次概览</h3>
        ${batches.length ? `
          <ul class="info-list">
            ${batches.map((item) => `<li>第 ${escapeHtml(item.batchNumber)} 批: ${escapeHtml(item.promptCount)} 条 (${escapeHtml(item.firstIndex)} -> ${escapeHtml(item.lastIndex)})</li>`).join('')}
          </ul>
        ` : '<div class="empty-state">未生成批次计划</div>'}
      </article>
    </section>

    <section class="section">
      <h2>Prompt 样例</h2>
      <p class="section-copy">这里展示的是首批高代表性的 Prompt 样例，用于人工确认方向。首屏只保留高信号字段，长 Prompt 做收束，避免一开始就被大量文本淹没。</p>
      <div class="prompt-grid">
        ${previewItems.map((item, index) => `
          <article class="prompt-card">
            <h3 class="prompt-card-title">${escapeHtml(item.index || index + 1)}. ${escapeHtml(item.title || item.slug || `prompt-${index + 1}`)}</h3>
            <div class="meta-list">
              ${displayProfile.sampleFields.map((field) => renderMetaRow(field.label, normalizeValue(item[field.key]) || '未设置')).join('')}
              ${renderMetaRow('Slot', item.slot_id || item.shot_id || '未设置')}
              ${renderMetaRow('Mode', item.reference_mode || 'prompt-only')}
            </div>
            <p class="prompt-card-copy">${escapeHtml(shorten(getPromptText(item)))}</p>
          </article>
        `).join('')}
      </div>
    </section>

    <section class="section">
      <h2>关键入口</h2>
      <p class="section-copy">Prompt 预览页不是最终执行页，它负责把你带回 prepare 主线。你可以从这里回到预检总览，也可以继续看 Markdown 原文和运行摘要。</p>
      <article class="info-card">
        <h3>文件入口</h3>
        <div class="link-row">
          ${fileExists(preflightBoardPath) ? renderLink('返回预检总览', relativeFile(outputDir, preflightBoardPath)) : ''}
          ${renderLink('Markdown Prompt 预览', relativeFile(outputDir, markdownPath))}
          ${renderLink('运行摘要', relativeFile(outputDir, summaryPath))}
          ${renderLink('批次计划 JSON', relativeFile(outputDir, planPath))}
        </div>
      </article>
    </section>
  </div>
</body>
</html>`;

  require('fs').writeFileSync(outputPath, html);
  console.log(JSON.stringify({
    outputPath,
    promptCount: prompts.length,
    batchCount: batches.length,
    previewCount: previewItems.length,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
