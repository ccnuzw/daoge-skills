const fs = require('fs');
const path = require('path');
const { parseArgs, readJson, fileExists } = require('./script_utils');
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

function renderLinkCard(title, description, href, tone) {
  return `
    <article class="portal-card portal-${escapeHtml(tone)}">
      <div class="portal-card-label">${escapeHtml(title)}</div>
      <div class="portal-card-copy">${escapeHtml(description)}</div>
      <div class="portal-card-link">${href ? `<a href="${escapeHtml(href)}">打开入口</a>` : '<span>尚未生成</span>'}</div>
    </article>
  `;
}

function renderGuideCard(title, copy, links = []) {
  return `
    <article class="guide-card">
      <div class="guide-card-label">${escapeHtml(title)}</div>
      <div class="guide-card-copy">${escapeHtml(copy)}</div>
      <div class="guide-card-links">
        ${links.length ? links.map((item) => item.href ? `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>` : `<span>${escapeHtml(item.label)}</span>`).join('') : '<span>暂无可用入口</span>'}
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
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'daoge_portal.html'));

  const reviewBoardPath = path.join(outputDir, 'review_board.html');
  const storyboardBoardPath = path.join(outputDir, 'storyboard_board.html');
  const completionBoardPath = path.join(outputDir, 'completion_board.html');
  const runOverviewPath = path.join(outputDir, 'run_overview.html');
  const preflightBoardPath = path.join(outputDir, 'preflight_board.html');
  const promptPreviewBoardPath = path.join(outputDir, 'prompt_preview.html');
  const assetsBoardPath = path.join(outputDir, 'assets_board.html');
  const resultHubPath = path.join(outputDir, 'result_hub.html');
  const resultHubMarkdownPath = path.join(outputDir, 'daoge_result_hub.md');
  const selectionBoardPath = path.join(outputDir, 'selection_board.md');
  const rerunBoardPath = path.join(outputDir, 'rerun_board.html');

  const success = Number(manifest.success || 0);
  const failed = Number(manifest.failed || 0);
  const selectedCount = Number(manifest.selectedCount || success + failed || 0);
  const batchCount = Number(manifest.batchCount || 0);

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DAOGE Portal</title>
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
      --review: #e2c070;
      --rerun: #ff8c7a;
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
      max-width: 74ch;
    }
    .hero-grid,
    .card-grid,
    .path-grid {
      display: grid;
      gap: 16px;
    }
    .hero-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: 20px;
    }
    .metric-card,
    .portal-card,
    .path-card {
      border-radius: 20px;
      padding: 18px 18px 20px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .metric-label,
    .portal-card-label,
    .path-card-label {
      color: var(--text-sub);
      font-size: 12px;
      margin-bottom: 10px;
    }
    .metric-value {
      font-size: 30px;
      font-weight: 700;
    }
    .metric-success .metric-value { color: var(--keep); }
    .metric-failed .metric-value { color: var(--rerun); }
    .metric-batch .metric-value { color: var(--info); }
    .metric-selected .metric-value { color: var(--review); }
    .section {
      padding: 22px;
      margin-top: 18px;
    }
    .section h2 {
      margin: 0 0 10px;
      font-size: 20px;
    }
    .section-copy {
      margin: 0 0 16px;
      color: var(--text-sub);
      line-height: 1.6;
    }
    .card-grid {
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    }
    .portal-review { border-color: rgba(124,197,163,0.18); }
    .portal-storyboard { border-color: rgba(226,192,112,0.18); }
    .portal-report { border-color: rgba(136,185,255,0.18); }
    .portal-rerun { border-color: rgba(255,140,122,0.18); }
    .portal-card-copy,
    .path-card-copy {
      color: var(--text-sub);
      font-size: 13px;
      line-height: 1.6;
      min-height: 64px;
    }
    .portal-card-link,
    .path-card-link {
      margin-top: 14px;
    }
    .portal-card-link a,
    .path-card-link a {
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px solid rgba(217,179,109,0.35);
      padding-bottom: 1px;
      font-size: 13px;
    }
    .portal-card-link span {
      color: var(--text-sub);
      font-size: 13px;
    }
    .path-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .path-card-label {
      color: var(--accent);
    }
    .guide-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }
    .guide-card {
      border-radius: 20px;
      padding: 18px 18px 20px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)),
        rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .guide-card-label {
      color: var(--accent);
      font-size: 13px;
      margin-bottom: 10px;
    }
    .guide-card-copy {
      color: var(--text-sub);
      font-size: 13px;
      line-height: 1.65;
      min-height: 62px;
    }
    .guide-card-links {
      margin-top: 14px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .guide-card-links a {
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px solid rgba(217,179,109,0.35);
      padding-bottom: 1px;
      font-size: 13px;
    }
    .guide-card-links span {
      color: var(--text-sub);
      font-size: 13px;
    }
    ul.portal-list {
      margin: 0;
      padding-left: 18px;
      color: var(--text-sub);
      line-height: 1.7;
    }
    @media (max-width: 1080px) {
      .hero-grid, .path-grid, .guide-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 720px) {
      .shell {
        padding: 18px 14px 44px;
      }
      .hero-grid, .path-grid, .card-grid, .guide-grid {
        grid-template-columns: 1fr;
      }
      h1 { font-size: 28px; }
    }
  </style>
</head>
<body data-portal-page="daoge_portal.html">
  <div class="shell">
    <section class="hero">
      <div class="eyebrow">DAOGE Portal</div>
      <h1>DAOGE 用户门户</h1>
      <p class="hero-copy">这是当前 run 的统一入口。准备阶段先看 Prompt 预览和预检总览；结果阶段默认浏览路径是：先看审阅板，再看 storyboard 整板，再回完成报告确认执行上下文。你不需要自己去猜先打开哪个文件。</p>
      <div class="hero-grid">
        <div class="metric-card metric-success">
          <div class="metric-label">成功张数</div>
          <div class="metric-value">${success}</div>
        </div>
        <div class="metric-card metric-failed">
          <div class="metric-label">失败张数</div>
          <div class="metric-value">${failed}</div>
        </div>
        <div class="metric-card metric-batch">
          <div class="metric-label">批次数量</div>
          <div class="metric-value">${batchCount}</div>
        </div>
        <div class="metric-card metric-selected">
          <div class="metric-label">参与生成</div>
          <div class="metric-value">${selectedCount}</div>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>推荐浏览顺序</h2>
      <p class="section-copy">准备阶段先确认 Prompt 和预检，再进入结果层做筛图、看整板和确认完成报告。</p>
      <div class="path-grid" style="grid-template-columns: repeat(4, minmax(0, 1fr));">
        <article class="path-card">
          <div class="path-card-label">第 0 步</div>
          <div class="path-card-copy">先看 Prompt 预览和预检总览，确认这轮任务方向、批次、尺寸和风险，再决定是否进入正式执行。</div>
          <div class="path-card-link">${fileExists(promptPreviewBoardPath) ? `<a href="${escapeHtml(relativeFile(outputDir, promptPreviewBoardPath))}">打开 Prompt 预览</a>` : (fileExists(preflightBoardPath) ? `<a href="${escapeHtml(relativeFile(outputDir, preflightBoardPath))}">打开预检总览</a>` : '<span>尚未生成</span>')}</div>
        </article>
        <article class="path-card">
          <div class="path-card-label">第 1 步</div>
          <div class="path-card-copy">先看 HTML 审阅看板，筛出保留、复核和重跑候选。</div>
          <div class="path-card-link">${fileExists(reviewBoardPath) ? `<a href="${escapeHtml(relativeFile(outputDir, reviewBoardPath))}">打开审阅看板</a>` : '<span>尚未生成</span>'}</div>
        </article>
        <article class="path-card">
          <div class="path-card-label">第 2 步</div>
          <div class="path-card-copy">再看 storyboard 装板，确认单张图放回整板后的上下文、节奏和品牌区关系。</div>
          <div class="path-card-link">${fileExists(storyboardBoardPath) ? `<a href="${escapeHtml(relativeFile(outputDir, storyboardBoardPath))}">打开 storyboard 装板</a>` : '<span>尚未生成</span>'}</div>
        </article>
        <article class="path-card">
          <div class="path-card-label">第 3 步</div>
          <div class="path-card-copy">最后看完成报告和结果总入口，补执行路径、目录结构和失败补跑信息。</div>
          <div class="path-card-link">${fileExists(resultHubPath) ? `<a href="${escapeHtml(relativeFile(outputDir, resultHubPath))}">打开结果总入口</a>` : (fileExists(resultHubMarkdownPath) ? `<a href="${escapeHtml(relativeFile(outputDir, resultHubMarkdownPath))}">打开结果总入口 Markdown</a>` : '<span>尚未生成</span>')}</div>
        </article>
      </div>
    </section>

    <section class="section">
      <h2>四个最常用入口</h2>
      <p class="section-copy">准备阶段、资产阶段和结果阶段最常用的入口都放在这里，避免你在目录里自己找文件。</p>
      <div class="card-grid">
        ${renderLinkCard('Prompt 预览', '准备阶段先看这一页，确认风格、场景、构图和批次分布，再决定要不要进入预检。', fileExists(promptPreviewBoardPath) ? relativeFile(outputDir, promptPreviewBoardPath) : null, 'review')}
        ${renderLinkCard('预检总览', '这里集中展示准备阶段的信号灯、阻塞项、执行参数和质量门禁，适合在正式开跑前最后确认。', fileExists(preflightBoardPath) ? relativeFile(outputDir, preflightBoardPath) : null, 'report')}
        ${renderLinkCard('资产看板', '这里集中展示参考图、遮罩图、绑定关系和分析结果，适合在正式执行前确认素材是否被正确理解和绑定。', fileExists(assetsBoardPath) ? relativeFile(outputDir, assetsBoardPath) : null, 'storyboard')}
        ${renderLinkCard('运行概览', '这里集中展示执行阶段的成功失败、暂停状态、批次与模式分布，适合先判断运行本身是否稳定。', fileExists(runOverviewPath) ? relativeFile(outputDir, runOverviewPath) : null, 'report')}
        ${renderLinkCard('HTML 审阅看板', '适合先筛图、切换审阅/画廊模式、定位到最值得优先看的结果。', fileExists(reviewBoardPath) ? relativeFile(outputDir, reviewBoardPath) : null, 'review')}
        ${renderLinkCard('Storyboard 装板', '适合把单张结果放回整板上下文，查看槽位位置、当前焦点和整板节奏。', fileExists(storyboardBoardPath) ? relativeFile(outputDir, storyboardBoardPath) : null, 'storyboard')}
        ${renderLinkCard('完成报告', '适合查看本轮执行摘要、成功失败样例、批次信息和下一步建议。', fileExists(completionBoardPath) ? relativeFile(outputDir, completionBoardPath) : null, 'report')}
        ${renderLinkCard('失败补跑看板', '这里集中展示失败项、待复核项和 failed-only 补跑建议，适合先判断是否需要补跑。', fileExists(path.join(outputDir, 'rerun_board.html')) ? relativeFile(outputDir, path.join(outputDir, 'rerun_board.html')) : null, 'rerun')}
        ${renderLinkCard('失败补跑入口', '适合在本轮存在失败项时，找到失败续跑入口和下一步操作提示。', fileExists(selectionBoardPath) ? relativeFile(outputDir, selectionBoardPath) : null, 'rerun')}
      </div>
    </section>

    <section class="section">
      <h2>这个门户现在已经打通了什么</h2>
      <ul class="portal-list">
        <li>总入口可以直接进入审阅板、整板、报告和失败补跑入口。</li>
        <li>审阅板里的结果卡可以直接跳到 storyboard 对应槽位。</li>
        <li>storyboard 页会显示当前焦点，并高亮跳转到的槽位。</li>
        <li>结果总入口页会明确告诉你先看什么、再看什么。</li>
      </ul>
    </section>

    <section class="section">
      <h2>如果你现在只想完成一件事</h2>
      <p class="section-copy">这一块把最常见的三种目标直接映射成下一步入口，尽量减少“这一页看完后还要想一下”的停顿。</p>
      <div class="guide-grid">
        ${renderGuideCard('我要先确认这轮方向对不对', '先看 Prompt 预览和预检总览。只有准备阶段方向没问题，后面的审阅和整板判断才有意义。', [
          { label: 'Prompt 预览', href: fileExists(promptPreviewBoardPath) ? relativeFile(outputDir, promptPreviewBoardPath) : null },
          { label: '预检总览', href: fileExists(preflightBoardPath) ? relativeFile(outputDir, preflightBoardPath) : null },
        ])}
        ${renderGuideCard('我要最快筛出值得保留的图', '先看审阅看板，再去 Storyboard 装板确认这些图放回整板后的上下文和镜头节奏。', [
          { label: '审阅看板', href: fileExists(reviewBoardPath) ? relativeFile(outputDir, reviewBoardPath) : null },
          { label: 'Storyboard 装板', href: fileExists(storyboardBoardPath) ? relativeFile(outputDir, storyboardBoardPath) : null },
        ])}
        ${renderGuideCard('我要知道接下来要不要补跑', '先看完成报告确认这轮整体情况，再去失败补跑看板或失败补跑入口决定下一步动作。', [
          { label: '完成报告', href: fileExists(completionBoardPath) ? relativeFile(outputDir, completionBoardPath) : null },
          { label: '失败补跑看板', href: fileExists(rerunBoardPath) ? relativeFile(outputDir, rerunBoardPath) : null },
        ])}
      </div>
    </section>
  </div>
</body>
</html>`;

  fs.writeFileSync(outputPath, html);
  console.log(JSON.stringify({
    outputPath,
    outputDir,
    success,
    failed,
    batchCount,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
