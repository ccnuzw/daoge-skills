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
  if (!href) return '<span>尚未生成</span>';
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function renderPortalCard(title, copy, href, tone = 'info') {
  return `
    <article class="portal-card portal-${escapeHtml(tone)}">
      <div class="portal-card-label">${escapeHtml(title)}</div>
      <div class="portal-card-copy">${escapeHtml(copy)}</div>
      <div class="portal-card-link">${renderLink('打开入口', href)}</div>
    </article>
  `;
}

function renderQuickTarget(title, copy, links = []) {
  return `
    <article class="target-card">
      <div class="target-card-label">${escapeHtml(title)}</div>
      <div class="target-card-copy">${escapeHtml(copy)}</div>
      <div class="target-card-links">
        ${links.length ? links.map((item) => item.href ? `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>` : `<span>${escapeHtml(item.label)}</span>`).join('') : '<span>暂无入口</span>'}
      </div>
    </article>
  `;
}

function portableRunnerPreambleLines() {
  return [
    'DAOGE_RUNNER="${DAOGE_RUNNER_PATH:-./.codex/skills/interactive-image-batch/scripts/run_batch.js}"',
    'if [ ! -f "$DAOGE_RUNNER" ]; then DAOGE_RUNNER="${CODEX_HOME:-$HOME/.codex}/skills/interactive-image-batch/scripts/run_batch.js"; fi',
  ];
}

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;
}

function topSuccessful(results, limit = 6) {
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['manifest-file']) throw new Error('Missing required flag: --manifest-file');

  const manifestPath = path.resolve(args['manifest-file']);
  const manifest = readJson(manifestPath);
  const outputDir = path.resolve(manifest.outputDir || path.dirname(manifestPath));
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'result_hub.html'));

  const completionBoardPath = path.join(outputDir, 'completion_board.html');
  const completionReportPath = path.join(outputDir, 'daoge_completion_report.md');
  const reviewBoardPath = path.join(outputDir, 'review_board.html');
  const storyboardBoardPath = path.join(outputDir, 'storyboard_board.html');
  const runOverviewPath = path.join(outputDir, 'run_overview.html');
  const rerunBoardPath = path.join(outputDir, 'rerun_board.html');
  const selectionBoardPath = path.join(outputDir, 'selection_board.md');
  const operationsReportPath = path.join(outputDir, 'operations_report.md');
  const promptPreviewPath = path.join(outputDir, 'prompt_preview.html');
  const promptPreviewMdPath = path.join(outputDir, 'prompt_preview.md');
  const preflightBoardPath = path.join(outputDir, 'preflight_board.html');
  const preflightMdPath = path.join(outputDir, 'daoge_preflight_dashboard.md');
  const assetsBoardPath = path.join(outputDir, 'assets_board.html');
  const runIndexPath = path.join(path.dirname(outputDir), 'daoge_run_index.md');
  const resultHubMarkdownPath = path.join(outputDir, 'daoge_result_hub.md');

  const batchManifests = Array.isArray(manifest.batches) ? manifest.batches : [];
  const allResults = batchManifests.flatMap((batch) => batch.results || []);
  const successful = topSuccessful(allResults);
  const executed = allResults.filter((item) => !item.skipped);
  const attemptedLocalEdits = executed.filter(isLocalEditResult);
  const successfulLocalEdits = successful.filter(isLocalEditResult);
  const generatedSlotIds = uniqueSlotIds(executed);
  const attemptedLocalEditSlotIds = uniqueSlotIds(attemptedLocalEdits);
  const successfulLocalEditSlotIds = uniqueSlotIds(successfulLocalEdits);
  const hasFailures = Number(manifest.failed || 0) > 0;

  const rerunCommand = [
    ...portableRunnerPreambleLines(),
    'node "$DAOGE_RUNNER" \\',
    `  --prompts-file ${shellQuote(resolvePromptFileForRerun(manifest, outputDir))} \\`,
    `  --resume-manifest ${shellQuote(manifestPath)} \\`,
    '  --failed-only true',
  ].join('\n');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DAOGE Result Hub</title>
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
      max-width: 76ch;
    }
    .hero-grid, .section-grid, .card-grid {
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
    .card-grid {
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    }
    .metric-card,
    .info-card,
    .portal-card {
      border-radius: 20px;
      padding: 18px 18px 20px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .metric-label,
    .info-card h3,
    .portal-card-label {
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
    .metric-slot .metric-value { color: var(--review); }
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
    .portal-review { border-color: rgba(124,197,163,0.18); }
    .portal-storyboard { border-color: rgba(226,192,112,0.18); }
    .portal-report { border-color: rgba(136,185,255,0.18); }
    .portal-rerun { border-color: rgba(255,140,122,0.18); }
    .portal-card-copy {
      color: var(--text-sub);
      font-size: 13px;
      line-height: 1.6;
      min-height: 64px;
    }
    .portal-card-link {
      margin-top: 14px;
    }
    .portal-card-link a {
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px solid rgba(217,179,109,0.35);
      padding-bottom: 1px;
      font-size: 13px;
    }
    .portal-card-link span,
    .empty-state {
      color: var(--text-sub);
      font-size: 13px;
      line-height: 1.6;
    }
    .target-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }
    .target-card {
      border-radius: 20px;
      padding: 18px 18px 20px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)),
        rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .target-card-label {
      color: var(--accent);
      font-size: 13px;
      margin-bottom: 10px;
    }
    .target-card-copy {
      color: var(--text-sub);
      font-size: 13px;
      line-height: 1.65;
      min-height: 62px;
    }
    .target-card-links {
      margin-top: 14px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .target-card-links a {
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px solid rgba(217,179,109,0.35);
      padding-bottom: 1px;
      font-size: 13px;
    }
    .target-card-links span {
      color: var(--text-sub);
      font-size: 13px;
    }
    .info-list {
      margin: 0;
      padding-left: 18px;
      color: var(--text-sub);
      line-height: 1.7;
    }
    pre.command-block {
      margin: 0;
      padding: 16px 18px;
      border-radius: 18px;
      background: rgba(10,15,19,0.72);
      border: 1px solid rgba(255,255,255,0.08);
      color: var(--text-main);
      overflow: auto;
      line-height: 1.6;
      font-size: 13px;
    }
    @media (max-width: 1080px) {
      .hero-grid, .section-grid, .target-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 720px) {
      .shell {
        padding: 18px 14px 44px;
      }
      .hero-grid, .section-grid, .card-grid, .target-grid {
        grid-template-columns: 1fr;
      }
      h1 { font-size: 28px; }
    }
  </style>
</head>
<body data-portal-page="result_hub.html">
  <div class="shell">
    <section class="hero">
      <div class="top-links">
        ${renderPortalTopLinks(outputDir, {
          currentPage: 'result_hub.html',
          extraLinks: [
            { label: '结果总入口 Markdown', file: resultHubMarkdownPath },
          ],
        })}
      </div>
      <div class="eyebrow">DAOGE Result Hub</div>
      <h1>DAOGE 结果总入口</h1>
      <p class="hero-copy">这一页只负责把当前 run 最常用的入口收成一个完整门户，不让你在目录里自己猜先开哪个文件。默认浏览路径是：先看审阅看板，再看 Storyboard 装板，再回完成报告确认执行上下文，最后处理补跑。</p>
      <div class="hero-grid">
        <div class="metric-card metric-success">
          <div class="metric-label">成功张数</div>
          <div class="metric-value">${Number(manifest.success || 0)}</div>
        </div>
        <div class="metric-card metric-failed">
          <div class="metric-label">失败张数</div>
          <div class="metric-value">${Number(manifest.failed || 0)}</div>
        </div>
        <div class="metric-card metric-batch">
          <div class="metric-label">批次数量</div>
          <div class="metric-value">${Number(manifest.batchCount || batchManifests.length)}</div>
        </div>
        <div class="metric-card metric-slot">
          <div class="metric-label">参与槽位</div>
          <div class="metric-value">${generatedSlotIds.length}</div>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>推荐浏览顺序</h2>
      <p class="section-copy">结果层主链路已经打通。你可以先筛图，再跳整板，再回报告看执行背景。</p>
      <div class="card-grid">
        ${renderPortalCard('第 1 步：先看审阅看板', '先用审阅模式或画廊模式看结果分组、风险标签和优先级。', fileExists(reviewBoardPath) ? relativeFile(outputDir, reviewBoardPath) : null, 'review')}
        ${renderPortalCard('第 2 步：再看 Storyboard 装板', '从审阅卡片跳到整板对应槽位，看它在整板里的上下文和焦点位置。', fileExists(storyboardBoardPath) ? relativeFile(outputDir, storyboardBoardPath) : null, 'storyboard')}
        ${renderPortalCard('第 3 步：回完成报告', '确认本轮执行路径、槽位覆盖、成功样例和失败样例。', fileExists(completionBoardPath) ? relativeFile(outputDir, completionBoardPath) : null, 'report')}
        ${renderPortalCard('第 4 步：最后处理补跑', '如果有失败项或待复核项，最后再看失败补跑看板，不要一开始就回执行层。', fileExists(rerunBoardPath) ? relativeFile(outputDir, rerunBoardPath) : (fileExists(selectionBoardPath) ? relativeFile(outputDir, selectionBoardPath) : null), 'rerun')}
      </div>
    </section>

    <section class="section">
      <h2>四个最常用入口</h2>
      <p class="section-copy">如果你只想最快知道该打开哪个文件，就从这里点，不用自己翻目录。</p>
      <div class="card-grid">
        ${renderPortalCard('审阅入口', '先做筛图、看风险标签、看优先级。', fileExists(reviewBoardPath) ? relativeFile(outputDir, reviewBoardPath) : null, 'review')}
        ${renderPortalCard('整板入口', '确认单张图在整板里的位置和上下文。', fileExists(storyboardBoardPath) ? relativeFile(outputDir, storyboardBoardPath) : null, 'storyboard')}
        ${renderPortalCard('报告入口', '查看执行路径、批次信息和完成摘要。', fileExists(completionBoardPath) ? relativeFile(outputDir, completionBoardPath) : null, 'report')}
        ${renderPortalCard('图片目录', '直接回到输出目录看最终图片和元数据。', '.', 'info')}
      </div>
    </section>

    <section class="section">
      <h2>本轮结果摘要</h2>
      <p class="section-copy">这块只保留最常用的 run 级信息，方便你判断当前结果规模和后续动作。</p>
      <div class="section-grid">
        <article class="info-card">
          <h3>执行概览</h3>
          <ul class="info-list">
            <li>默认尺寸: ${escapeHtml(manifest.defaultSize || '未记录')}</li>
            <li>是否暂停: ${manifest.paused ? '是' : '否'}</li>
            <li>暂停原因: ${escapeHtml(manifest.pauseReason || '无')}</li>
            <li>输出目录: ${escapeHtml(outputDir)}</li>
          </ul>
        </article>
        <article class="info-card">
          <h3>槽位与局部编辑</h3>
          <ul class="info-list">
            <li>参与生成槽位: ${generatedSlotIds.length ? escapeHtml(generatedSlotIds.join(', ')) : '未记录'}</li>
            <li>尝试局部编辑槽位: ${attemptedLocalEditSlotIds.length ? escapeHtml(attemptedLocalEditSlotIds.join(', ')) : '无'}</li>
            <li>成功局部编辑槽位: ${successfulLocalEditSlotIds.length ? escapeHtml(successfulLocalEditSlotIds.join(', ')) : '无'}</li>
          </ul>
        </article>
      </div>
    </section>

    <section class="section">
      <h2>看板与报告入口</h2>
      <p class="section-copy">HTML 入口优先，Markdown 入口只作为补充归档。</p>
      <div class="section-grid">
        <article class="info-card">
          <h3>HTML 主入口</h3>
          <ul class="info-list">
            <li>${fileExists(reviewBoardPath) ? `<a href="${escapeHtml(relativeFile(outputDir, reviewBoardPath))}">HTML 审阅看板</a>` : 'HTML 审阅看板：未生成'}</li>
            <li>${fileExists(storyboardBoardPath) ? `<a href="${escapeHtml(relativeFile(outputDir, storyboardBoardPath))}">Storyboard 装板</a>` : 'Storyboard 装板：未生成'}</li>
            <li>${fileExists(completionBoardPath) ? `<a href="${escapeHtml(relativeFile(outputDir, completionBoardPath))}">完成报告</a>` : '完成报告：未生成'}</li>
            <li>${fileExists(runOverviewPath) ? `<a href="${escapeHtml(relativeFile(outputDir, runOverviewPath))}">运行概览</a>` : '运行概览：未生成'}</li>
            <li>${fileExists(rerunBoardPath) ? `<a href="${escapeHtml(relativeFile(outputDir, rerunBoardPath))}">失败补跑看板</a>` : '失败补跑看板：未生成'}</li>
          </ul>
        </article>
        <article class="info-card">
          <h3>准备与资产入口</h3>
          <ul class="info-list">
            <li>${fileExists(promptPreviewPath) ? `<a href="${escapeHtml(relativeFile(outputDir, promptPreviewPath))}">Prompt 预览</a>` : 'Prompt 预览：未生成'}</li>
            <li>${fileExists(preflightBoardPath) ? `<a href="${escapeHtml(relativeFile(outputDir, preflightBoardPath))}">预检总览</a>` : '预检总览：未生成'}</li>
            <li>${fileExists(assetsBoardPath) ? `<a href="${escapeHtml(relativeFile(outputDir, assetsBoardPath))}">资产看板</a>` : '资产看板：未生成'}</li>
            <li>${fileExists(promptPreviewMdPath) ? `<a href="${escapeHtml(relativeFile(outputDir, promptPreviewMdPath))}">Prompt 预览 Markdown</a>` : 'Prompt 预览 Markdown：未生成'}</li>
            <li>${fileExists(preflightMdPath) ? `<a href="${escapeHtml(relativeFile(outputDir, preflightMdPath))}">预检 Markdown</a>` : '预检 Markdown：未生成'}</li>
          </ul>
        </article>
      </div>
    </section>

    <section class="section">
      <h2>先看什么，取决于你的目标</h2>
      <div class="section-grid">
        <article class="info-card">
          <h3>如果你要选图</h3>
          <ul class="info-list">
            <li>先看 HTML 审阅看板</li>
            <li>如果是 storyboard 任务，再跳到整板位置看上下文</li>
            <li>最后回完成报告看执行背景</li>
          </ul>
        </article>
        <article class="info-card">
          <h3>如果你要处理失败</h3>
          <ul class="info-list">
            <li>最后再看失败补跑看板</li>
            <li>先确认失败项数量和错误类型</li>
            <li>尽量只补跑失败项，不要整批重跑</li>
          </ul>
        </article>
      </div>
    </section>

    <section class="section">
      <h2>看完这一页后，下一步去哪</h2>
      <p class="section-copy">如果你已经确定当前目标，就直接从这里进入下一页，不需要再回门户首页重选一次。</p>
      <div class="target-grid">
        ${renderQuickTarget('我要继续筛图', '先去审阅看板。如果结果分散很多，优先用审阅模式；如果只是想快速扫缩略图，先切画廊模式。', [
          { label: '审阅看板', href: fileExists(reviewBoardPath) ? relativeFile(outputDir, reviewBoardPath) : null },
        ])}
        ${renderQuickTarget('我要确认整板上下文', '先去 Storyboard 装板。尤其是 storyboard 项目，单张图判断完以后，最好都回整板看一眼镜头之间的关系。', [
          { label: 'Storyboard 装板', href: fileExists(storyboardBoardPath) ? relativeFile(outputDir, storyboardBoardPath) : null },
          { label: '完成报告', href: fileExists(completionBoardPath) ? relativeFile(outputDir, completionBoardPath) : null },
        ])}
        ${renderQuickTarget('我要处理失败和补跑', '如果这轮已经确认有失败项或待复核项，就直接去失败补跑看板，不要在结果总入口里停留太久。', [
          { label: '失败补跑看板', href: fileExists(rerunBoardPath) ? relativeFile(outputDir, rerunBoardPath) : null },
          { label: '失败补跑入口', href: fileExists(selectionBoardPath) ? relativeFile(outputDir, selectionBoardPath) : null },
        ])}
      </div>
    </section>

    <section class="section">
      <h2>成功样例</h2>
      <p class="section-copy">这里只保留少量高信号样例，方便你确认“这一轮大概出了什么”。</p>
      ${successful.length ? `
        <ul class="info-list">
          ${successful.map((item) => `<li>${escapeHtml(item.index)} / ${escapeHtml(item.title || item.slug || '未命名结果')}: ${escapeHtml(item.output || '未记录输出')}</li>`).join('')}
        </ul>
      ` : '<div class="empty-state">暂无成功样例</div>'}
    </section>

    <section class="section">
      <h2>失败补跑</h2>
      <p class="section-copy">这里只给你最小必要信息。真正处理失败时，优先回失败补跑看板。</p>
      ${hasFailures ? `
        <div class="section-grid">
          <article class="info-card">
            <h3>失败提示</h3>
            <ul class="info-list">
              <li>本轮存在失败项，建议优先使用失败续跑，不要整批重跑。</li>
              <li>如果你已经完成筛图，再回补跑页处理失败即可。</li>
            </ul>
          </article>
          <article class="info-card">
            <h3>推荐命令</h3>
            <pre class="command-block">${escapeHtml(rerunCommand)}</pre>
          </article>
        </div>
      ` : '<div class="empty-state">本轮没有失败项，当前不需要补跑。</div>'}
    </section>
  </div>
</body>
</html>`;

  fs.writeFileSync(outputPath, html);
  console.log(JSON.stringify({
    outputPath,
    outputDir,
    success: manifest.success ?? 0,
    failed: manifest.failed ?? 0,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
