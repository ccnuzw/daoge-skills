const fs = require('fs');
const path = require('path');
const { parseArgs, readJson, fileExists } = require('./script_utils');
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

function topFailed(results, limit = 8) {
  return results.filter((item) => !item.ok).slice(0, limit);
}

function topSuccessful(results, limit = 8) {
  return results.filter((item) => item.ok && !item.skipped).slice(0, limit);
}

function uniqueSlotIds(items) {
  return Array.from(new Set((items || [])
    .map((item) => String(item.slotId || item.slot_id || '').trim())
    .filter(Boolean)));
}

function isLocalEditResult(item) {
  const requestMode = String(item.requestMode || item.request_mode || '').trim();
  const editSource = String(item.editSource || item.edit_source || '').trim();
  return requestMode === 'masked-edit' || editSource === 'previous-output';
}

function renderList(items, mapper, emptyText) {
  if (!items.length) return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  return `<ul class="info-list">${items.map((item) => `<li>${mapper(item)}</li>`).join('')}</ul>`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['manifest-file']) throw new Error('Missing required flag: --manifest-file');

  const manifestPath = path.resolve(args['manifest-file']);
  const manifest = readJson(manifestPath);
  const outputDir = path.resolve(manifest.outputDir || path.dirname(manifestPath));
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'completion_board.html'));

  const batchManifests = Array.isArray(manifest.batches) ? manifest.batches : [];
  const allResults = batchManifests.flatMap((batch) => batch.results || []);
  const failed = topFailed(allResults);
  const successful = topSuccessful(allResults);
  const skipped = allResults.filter((item) => item.skipped);
  const executed = allResults.filter((item) => !item.skipped);
  const attemptedLocalEdits = executed.filter(isLocalEditResult);
  const successfulLocalEdits = successful.filter(isLocalEditResult);
  const generatedSlotIds = uniqueSlotIds(executed);
  const attemptedLocalEditSlotIds = uniqueSlotIds(attemptedLocalEdits);
  const successfulLocalEditSlotIds = uniqueSlotIds(successfulLocalEdits);
  const reviewBoardPath = path.join(outputDir, 'review_board.html');
  const storyboardBoardPath = path.join(outputDir, 'storyboard_board.html');
  const rerunBoardPath = path.join(outputDir, 'rerun_board.html');
  const nextActionHints = [
    Number(manifest.failed || 0) > 0 ? '这轮存在失败项，先去失败补跑看板判断是否只补跑失败项。' : null,
    successfulLocalEditSlotIds.length ? `当前有 ${successfulLocalEditSlotIds.length} 个局部编辑成功槽位，最好回审阅板或整板再看一次边界与衔接感。` : null,
    Number(manifest.failed || 0) === 0 && !successfulLocalEditSlotIds.length ? '这轮整体比较稳定，可以直接从审阅板进入保留筛选，再回整板确认上下文。' : null,
  ].filter(Boolean);

  const resultHubPath = path.join(outputDir, 'result_hub.html');
  const resultHubMarkdownPath = path.join(outputDir, 'daoge_result_hub.md');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DAOGE Completion Board</title>
${renderPortalHeadAssets()}
  <style>
    :root {
      --bg: #0e1318;
      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --keep: #7cc5a3;
      --rerun: #ff8c7a;
      --review: #e2c070;
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
    .hero, .section {
      border: 1px solid var(--panel-border);
      background: var(--panel);
      backdrop-filter: blur(12px);
      border-radius: 24px;
      box-shadow: 0 18px 48px rgba(0,0,0,0.24);
    }
    .hero {
      padding: 28px 28px 24px;
      background:
        linear-gradient(160deg, rgba(217,179,109,0.15), transparent 38%),
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
    .hero-grid, .section-grid {
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
    .metric-value {
    }
    .metric-success .metric-value { color: var(--keep); }
    .metric-failed .metric-value { color: var(--rerun); }
    .metric-skipped .metric-value { color: var(--review); }
    .metric-batch .metric-value { color: var(--info); }
    @media (max-width: 1080px) {
      .hero-grid, .section-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 720px) {
      .shell {
        padding: 18px 14px 44px;
      }
      h1 { font-size: 28px; }
      .hero-grid, .section-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body data-portal-page="completion_board.html">
  <div class="shell">
    <section class="hero">
      <div class="top-links">
        ${renderPortalTopLinks(outputDir, {
          currentPage: 'completion_board.html',
          extraLinks: [
            { label: '结果总入口', file: resultHubPath },
            { label: '结果总入口 Markdown', file: resultHubMarkdownPath },
          ],
        })}
      </div>
      <div class="eyebrow">DAOGE Completion Board</div>
      <h1>DAOGE 完成报告</h1>
      <p class="hero-copy">这是本轮执行结果的 HTML 版总览。它负责把成功/失败/跳过、槽位覆盖、批次结果和下一步建议收在一页里，便于你从门户继续向下浏览。</p>
      <div class="hero-grid">
        <div class="metric-card metric-success">
          <div class="metric-label">成功张数</div>
          <div class="metric-value">${Number(manifest.success || 0)}</div>
        </div>
        <div class="metric-card metric-failed">
          <div class="metric-label">失败张数</div>
          <div class="metric-value">${Number(manifest.failed || 0)}</div>
        </div>
        <div class="metric-card metric-skipped">
          <div class="metric-label">跳过已完成</div>
          <div class="metric-value">${skipped.length}</div>
        </div>
        <div class="metric-card metric-batch">
          <div class="metric-label">批次数量</div>
          <div class="metric-value">${Number(manifest.batchCount || batchManifests.length)}</div>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>执行与槽位摘要</h2>
      <p class="section-copy">这一块先告诉你本轮执行范围、生成覆盖和局部编辑覆盖，方便快速判断结果分布。</p>
      <div class="section-grid">
        <article class="info-card">
          <h3>执行信息</h3>
          ${renderList([
            `输出目录: ${outputDir}`,
            `Prompt 来源: ${manifest.promptSource || '未记录'}`,
            `续跑来源: ${manifest.resumeManifest || '无'}`,
            `仅重跑失败项: ${manifest.failedOnly ? '是' : '否'}`,
            `默认尺寸: ${manifest.defaultSize || '未记录'}`,
            `模型: ${manifest.model || '未记录'}`,
          ], (line) => escapeHtml(line), '暂无执行信息')}
        </article>
        <article class="info-card">
          <h3>槽位覆盖</h3>
          ${renderList([
            `参与生成槽位: ${generatedSlotIds.length ? generatedSlotIds.join(', ') : '未记录'}`,
            `尝试局部编辑槽位: ${attemptedLocalEditSlotIds.length ? attemptedLocalEditSlotIds.join(', ') : '无'}`,
            `成功局部编辑槽位: ${successfulLocalEditSlotIds.length ? successfulLocalEditSlotIds.join(', ') : '无'}`,
          ], (line) => escapeHtml(line), '暂无槽位信息')}
        </article>
      </div>
    </section>

    <section class="section">
      <h2>样例与下一步</h2>
      <p class="section-copy">这里保留最常看的样例和判断建议，不再要求你回到 Markdown 报告里查。</p>
      <div class="section-grid">
        <article class="info-card">
          <h3>成功样例</h3>
          ${renderList(successful, (item) => `${escapeHtml(item.index)} / ${escapeHtml(item.title || item.slug || '未命名结果')}: ${escapeHtml(item.output || '无输出')}`, '没有成功样例')}
        </article>
        <article class="info-card">
          <h3>失败样例</h3>
          ${renderList(failed, (item) => `${escapeHtml(item.index)} / ${escapeHtml(item.title || item.slug || '未命名结果')}: ${escapeHtml(item.error || '未知错误')}`, '没有失败项')}
        </article>
      </div>
    </section>

    <section class="section">
      <h2>看完完成报告后，建议这样继续</h2>
      <p class="section-copy">完成报告不是最后一站，而是你确认“这轮整体情况到底怎么样”的地方。看完这里以后，通常就进入筛图、整板确认或补跑处理。</p>
      <div class="section-grid">
        <article class="info-card">
          <h3>下一步建议</h3>
          ${renderList(nextActionHints, (line) => escapeHtml(line), '当前没有额外建议')}
        </article>
        <article class="info-card">
          <h3>继续浏览入口</h3>
          <div class="link-row">
            ${fileExists(reviewBoardPath) ? `<a href="${escapeHtml(relativeFile(outputDir, reviewBoardPath))}">回审阅看板</a>` : ''}
            ${fileExists(storyboardBoardPath) ? `<a href="${escapeHtml(relativeFile(outputDir, storyboardBoardPath))}">去 Storyboard 装板</a>` : ''}
            ${fileExists(rerunBoardPath) ? `<a href="${escapeHtml(relativeFile(outputDir, rerunBoardPath))}">去失败补跑看板</a>` : ''}
            ${fileExists(resultHubPath) ? `<a href="${escapeHtml(relativeFile(outputDir, resultHubPath))}">回结果总入口</a>` : ''}
          </div>
        </article>
      </div>
    </section>
  </div>
</body>
</html>`;

  fs.writeFileSync(outputPath, html);
  console.log(JSON.stringify({
    outputPath,
    success: Number(manifest.success || 0),
    failed: Number(manifest.failed || 0),
    batchCount: Number(manifest.batchCount || batchManifests.length),
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
