const fs = require('fs');
const path = require('path');
const { parseArgs, readJson, fileExists, resolvePromptFileForRerun } = require('./script_utils');
const { renderPortalTopLinks } = require('./portal_shared');
const { renderPortalHeadAssets } = require('./portal_ui_shared');

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

function renderLink(label, href) {
  if (!href) return '';
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function renderList(items, emptyText = '无') {
  if (!items.length) return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  return `<ul class="info-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
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

function renderFailedCard(item) {
  return `
    <article class="issue-card issue-failed">
      <h3 class="issue-title">${escapeHtml(item.title || item.slug || item.index || '未命名失败项')}</h3>
      <div class="issue-pills">
        <span class="pill pill-failed">失败</span>
        ${item.requestMode ? `<span class="pill pill-mode">${escapeHtml(item.requestMode)}</span>` : ''}
        ${item.slotId ? `<span class="pill pill-slot">${escapeHtml(item.slotId)}</span>` : ''}
      </div>
      <div class="meta-list">
        ${renderMetaRow('Index', item.index || '未记录')}
        ${renderMetaRow('Slug', item.slug || '未记录')}
        ${renderMetaRow('Slot', item.slotId || '未记录')}
        ${renderMetaRow('Mode', item.requestMode || '未记录')}
        ${renderMetaRow('错误', item.error || '未知错误')}
      </div>
    </article>
  `;
}

function renderReviewCard(item) {
  return `
    <article class="issue-card issue-review">
      <h3 class="issue-title">${escapeHtml(item.title || item.slug || item.index || '未命名待复核项')}</h3>
      <div class="issue-pills">
        <span class="pill pill-review">待复核</span>
        ${item.requestMode ? `<span class="pill pill-mode">${escapeHtml(item.requestMode)}</span>` : ''}
        ${item.slotId ? `<span class="pill pill-slot">${escapeHtml(item.slotId)}</span>` : ''}
      </div>
      <div class="meta-list">
        ${renderMetaRow('Index', item.index || '未记录')}
        ${renderMetaRow('Slug', item.slug || '未记录')}
        ${renderMetaRow('Slot', item.slotId || '未记录')}
        ${renderMetaRow('Mode', item.requestMode || '未记录')}
        ${renderMetaRow('修订提示', item.revisedPrompt || item.revised_prompt || '未记录')}
      </div>
    </article>
  `;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['manifest-file']) throw new Error('Missing required flag: --manifest-file');

  const manifestPath = path.resolve(args['manifest-file']);
  const manifest = readJson(manifestPath);
  const outputDir = path.resolve(manifest.outputDir || path.dirname(manifestPath));
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'rerun_board.html'));

  const failedFile = path.join(outputDir, 'failed.json');
  const needsReviewFile = path.join(outputDir, 'needs_review.json');
  const rerunCandidatesFile = path.join(outputDir, 'rerun_candidates.json');
  const failed = fileExists(failedFile) ? readJson(failedFile) : [];
  const needsReview = fileExists(needsReviewFile) ? readJson(needsReviewFile) : [];
  const rerunCandidates = fileExists(rerunCandidatesFile) ? readJson(rerunCandidatesFile) : [];

  const runOverviewPath = path.join(outputDir, 'run_overview.html');
  const reviewBoardPath = path.join(outputDir, 'review_board.html');
  const completionBoardPath = path.join(outputDir, 'completion_board.html');
  const selectionBoardPath = path.join(outputDir, 'selection_board.md');
  const runnerCommand = `node "$DAOGE_RUNNER" --prompts-file '${resolvePromptFileForRerun(manifest, outputDir)}' --resume-manifest '${manifestPath}' --failed-only true`;

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DAOGE Rerun Board</title>
${renderPortalHeadAssets()}
  <style>
    :root {
      --bg: #0e1318;
      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --review: #e2c070;
      --danger: #ff8c7a;
      --info: #88b9ff;
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
    .hero, .section, .issue-card {
      border: 1px solid var(--panel-border);
      background: var(--panel);
      backdrop-filter: blur(12px);
      border-radius: 24px;
      box-shadow: 0 18px 48px rgba(0,0,0,0.24);
    }
    .hero {
      padding: 28px 28px 24px;
      background:
        linear-gradient(160deg, rgba(255,140,122,0.16), transparent 38%),
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
    .hero-grid, .section-grid, .issue-grid {
      display: grid;
      gap: 16px;
    }
    .hero-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      margin-top: 20px;
    }
    .section-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .issue-grid {
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    }
    .metric-value {
    }
    .metric-failed .metric-value { color: var(--danger); }
    .metric-review .metric-value { color: var(--review); }
    .metric-info .metric-value { color: var(--info); }
    .issue-card {
      padding: 18px;
    }
    .issue-title {
      margin: 0 0 10px;
      font-size: 18px;
    }
    .issue-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 12px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .pill-failed { color: var(--danger); background: rgba(255,140,122,0.12); }
    .pill-review { color: var(--review); background: rgba(226,192,112,0.12); }
    .pill-mode { color: var(--info); background: rgba(136,185,255,0.12); }
    .pill-slot { color: var(--accent); background: rgba(217,179,109,0.12); }
    .meta-list {
      display: grid;
      gap: 10px;
    }
    .meta-row {
      display: grid;
      grid-template-columns: 72px 1fr;
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
    .command-block {
      border-radius: 18px;
      background: rgba(0,0,0,0.28);
      border: 1px solid rgba(255,255,255,0.08);
      padding: 14px 16px;
      overflow-x: auto;
      color: #f7f4ed;
      font-size: 13px;
      line-height: 1.7;
      white-space: pre-wrap;
    }
    @media (max-width: 1080px) {
      .hero-grid, .section-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 720px) {
      .shell { padding: 18px 14px 44px; }
      h1 { font-size: 28px; }
      .hero-grid, .section-grid, .issue-grid { grid-template-columns: 1fr; }
      .meta-row { grid-template-columns: 1fr; gap: 6px; }
    }
  </style>
</head>
<body data-portal-page="rerun_board.html">
  <div class="shell">
    <section class="hero">
      <div class="top-links">
        ${renderPortalTopLinks(outputDir, {
          currentPage: 'rerun_board.html',
          extraLinks: [
            { label: 'Markdown 失败补跑入口', href: relativeFile(outputDir, selectionBoardPath) },
          ],
        })}
      </div>
      <div class="eyebrow">DAOGE Rerun Board</div>
      <h1>DAOGE 失败补跑看板</h1>
      <p class="hero-copy">这一页负责把失败项、待复核项和补跑建议收在一起。你可以先确认失败集中在哪些 slot 和模式，再决定是只补跑失败项，还是先回到审阅板或完成报告确认问题范围。</p>
      <div class="hero-grid">
        <div class="metric-card metric-failed">
          <div class="metric-label">失败项数量</div>
          <div class="metric-value">${ensureArray(failed).length}</div>
        </div>
        <div class="metric-card metric-review">
          <div class="metric-label">待复核数量</div>
          <div class="metric-value">${ensureArray(needsReview).length}</div>
        </div>
        <div class="metric-card metric-info">
          <div class="metric-label">补跑候选</div>
          <div class="metric-value">${ensureArray(rerunCandidates).length}</div>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>先看什么</h2>
      <p class="section-copy">先看失败项，再看待复核项，最后再决定是否直接走 failed-only 补跑。如果失败集中在少数 slot，就优先用最小范围的补跑方式，不要整批回滚重跑。</p>
      <div class="section-grid">
        <article class="info-card">
          <h3>建议动作</h3>
          ${renderList([
            ensureArray(failed).length ? '先处理失败项，再考虑下一轮扩图。' : null,
            ensureArray(needsReview).length ? '局部编辑成功但仍需人工复核边界和融合感。' : null,
            ensureArray(rerunCandidates).length ? '当前已经生成 rerun candidates，可以直接按候选清单缩小范围。' : null,
          ].filter(Boolean), '当前没有补跑压力')}
        </article>
        <article class="info-card">
          <h3>推荐命令</h3>
          <div class="command-block">${escapeHtml(runnerCommand)}</div>
        </article>
      </div>
    </section>

    <section class="section">
      <h2>失败项</h2>
      <p class="section-copy">这一块只展示真正执行失败的结果，便于你快速看到具体错误、所属 slot 和 request mode。</p>
      <div class="issue-grid">
        ${ensureArray(failed).length ? ensureArray(failed).map((item) => renderFailedCard(item)).join('') : '<div class="empty-state">当前没有失败项。</div>'}
      </div>
    </section>

    <section class="section">
      <h2>待复核项</h2>
      <p class="section-copy">这一块主要收 masked-edit 或复用上一轮结果的成功项。它们虽然执行成功，但通常仍然需要人工检查边界、主体一致性和局部改动的自然程度。</p>
      <div class="issue-grid">
        ${ensureArray(needsReview).length ? ensureArray(needsReview).map((item) => renderReviewCard(item)).join('') : '<div class="empty-state">当前没有待复核项。</div>'}
      </div>
    </section>

    <section class="section">
      <h2>关键入口</h2>
      <p class="section-copy">失败补跑看板不替代运行概览、审阅板和完成报告，它负责把“哪里失败了、哪里还要复核、下一步该怎么补跑”先说清楚。</p>
      <article class="info-card">
        <h3>文件入口</h3>
        <div class="link-row">
          ${fileExists(runOverviewPath) ? renderLink('运行概览', relativeFile(outputDir, runOverviewPath)) : ''}
          ${fileExists(reviewBoardPath) ? renderLink('审阅看板', relativeFile(outputDir, reviewBoardPath)) : ''}
          ${fileExists(completionBoardPath) ? renderLink('完成报告', relativeFile(outputDir, completionBoardPath)) : ''}
          ${renderLink('Markdown 失败补跑入口', relativeFile(outputDir, selectionBoardPath))}
        </div>
      </article>
    </section>
  </div>
</body>
</html>`;

  fs.writeFileSync(outputPath, html);
  console.log(JSON.stringify({
    outputPath,
    failedCount: ensureArray(failed).length,
    needsReviewCount: ensureArray(needsReview).length,
    rerunCandidateCount: ensureArray(rerunCandidates).length,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
