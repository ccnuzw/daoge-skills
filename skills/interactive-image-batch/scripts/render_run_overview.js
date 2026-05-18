const fs = require('fs');
const path = require('path');
const { parseArgs, readJson, fileExists } = require('./script_utils');
const { renderPortalTopLinks, renderPortalContextBar } = require('./portal_shared');
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

function countBy(items, key) {
  const counts = {};
  items.forEach((item) => {
    const value = item[key];
    const label = value === undefined || value === null || value === '' ? '未记录' : String(value);
    counts[label] = (counts[label] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function renderList(items, emptyText = '无') {
  if (!items.length) return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  return `<ul class="info-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderDistribution(items, emptyText = '无') {
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

function buildTimeline(manifest) {
  const failed = Number(manifest.failed || 0);
  const paused = Boolean(manifest.paused);
  const failedOnly = Boolean(manifest.failedOnly);
  return [
    {
      key: 'prepare',
      label: '准备',
      state: 'done',
      note: manifest.promptSource ? `Prompt 来源 ${manifest.promptSource}` : '已完成参数与 Prompt 装配',
    },
    {
      key: 'preflight',
      label: '预检',
      state: 'done',
      note: '执行前校验与批次规划已完成',
    },
    {
      key: 'execute',
      label: '执行',
      state: paused ? 'warning' : (failed > 0 ? 'active' : 'done'),
      note: paused
        ? `运行暂停：${manifest.pauseReason || '待确认原因'}`
        : `成功 ${Number(manifest.success || 0)} / 失败 ${failed}`,
    },
    {
      key: 'review',
      label: '审阅',
      state: failed > 0 ? 'active' : 'done',
      note: failed > 0 ? '先看失败补跑与审阅看板' : '可以直接进入审阅与装板',
    },
    {
      key: 'rerun',
      label: '补跑',
      state: failedOnly || failed > 0 ? 'active' : 'pending',
      note: failedOnly ? '当前 run 为 failed-only 续跑' : (failed > 0 ? '存在失败项，建议准备补跑' : '当前无补跑压力'),
    },
  ];
}

function renderTimeline(items) {
  return `
    <section class="run-timeline">
      ${items.map((item) => `
        <article class="timeline-step timeline-${escapeHtml(item.state)}">
          <div class="timeline-step-top">
            <div class="timeline-step-label">${escapeHtml(item.label)}</div>
            <div class="timeline-step-state">${escapeHtml(item.state === 'done' ? '已完成' : item.state === 'active' ? '当前重点' : item.state === 'warning' ? '需关注' : '待进入')}</div>
          </div>
          <div class="timeline-step-note">${escapeHtml(item.note)}</div>
        </article>
      `).join('')}
    </section>
  `;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['manifest-file']) throw new Error('Missing required flag: --manifest-file');

  const manifestPath = path.resolve(args['manifest-file']);
  const manifest = readJson(manifestPath);
  const outputDir = path.resolve(manifest.outputDir || path.dirname(manifestPath));
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'run_overview.html'));

  const operationsReportPath = path.join(outputDir, 'operations_report.json');
  const operationsReport = fileExists(operationsReportPath) ? readJson(operationsReportPath) : null;
  const batchManifests = Array.isArray(manifest.batches) ? manifest.batches : [];
  const allResults = batchManifests.flatMap((batch) => batch.results || []);
  const skippedCount = allResults.filter((item) => item.skipped).length;
  const successResults = allResults.filter((item) => item.ok && !item.skipped);
  const requestModeDistribution = operationsReport?.distributions?.requestMode || countBy(successResults, 'requestMode').slice(0, 10);
  const slotRoleDistribution = operationsReport?.distributions?.slotRole || countBy(successResults, 'slotRole').slice(0, 10);
  const styleFamilyDistribution = operationsReport?.distributions?.styleFamily || countBy(successResults, 'styleFamily').slice(0, 10);

  const completionBoardPath = path.join(outputDir, 'completion_board.html');
  const reviewBoardPath = path.join(outputDir, 'review_board.html');
  const selectionBoardPath = path.join(outputDir, 'selection_board.md');
  const operationsReportMdPath = path.join(outputDir, 'operations_report.md');
  const timeline = buildTimeline(manifest);
  const runContextBar = renderPortalContextBar({
    runLabel: path.basename(outputDir),
    boardLabel: manifest.boardId || manifest.board_id || manifest.storyboardBoardId || '',
    phaseLabel: manifest.dryRun ? '执行阶段 / Dry Run' : '执行阶段',
    flowLabel: '准备 -> 预检 -> 执行 -> 审阅 -> 补跑',
    counts: [
      { label: '成功', value: Number(manifest.success || 0) },
      { label: '失败', value: Number(manifest.failed || 0) },
      { label: '跳过', value: skippedCount },
      { label: '批次', value: Number(manifest.batchCount || batchManifests.length) },
    ],
    hints: [
      manifest.paused ? `当前运行曾暂停：${manifest.pauseReason || '待确认原因'}` : '当前运行未暂停',
      manifest.failedOnly ? '当前是失败续跑链路' : '当前是常规运行链路',
    ],
  });

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DAOGE Run Overview</title>
${renderPortalHeadAssets()}
  <style>
    :root {
      --bg: #0e1318;
      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --success: #7cc5a3;
      --warn: #e2c070;
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
      max-width: 78ch;
    }
    .hero-grid, .section-grid {
      display: grid;
      gap: 16px;
    }
    .hero-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: 20px;
    }
    .run-timeline {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 12px;
      margin-top: 18px;
    }
    .timeline-step {
      border-radius: 18px;
      padding: 16px 16px 18px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      min-height: 120px;
    }
    .timeline-step-top {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
      margin-bottom: 10px;
    }
    .timeline-step-label {
      font-size: 15px;
      font-weight: 700;
    }
    .timeline-step-state {
      font-size: 11px;
      color: var(--text-sub);
      border-radius: 999px;
      padding: 5px 8px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.04);
      white-space: nowrap;
    }
    .timeline-step-note {
      color: var(--text-sub);
      font-size: 12px;
      line-height: 1.55;
    }
    .timeline-done { border-color: rgba(124,197,163,0.22); }
    .timeline-done .timeline-step-label { color: var(--success); }
    .timeline-active { border-color: rgba(136,185,255,0.22); }
    .timeline-active .timeline-step-label { color: var(--info); }
    .timeline-warning { border-color: rgba(226,192,112,0.24); }
    .timeline-warning .timeline-step-label { color: var(--warn); }
    .timeline-pending { border-color: rgba(255,255,255,0.1); }
    .section-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .metric-value {
    }
    .metric-success .metric-value { color: var(--success); }
    .metric-danger .metric-value { color: var(--danger); }
    .metric-warn .metric-value { color: var(--warn); }
    .metric-info .metric-value { color: var(--info); }
    .meta-row {
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .meta-row:last-child { border-bottom: none; padding-bottom: 0; }
    @media (max-width: 1080px) {
      .hero-grid, .section-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .run-timeline {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 720px) {
      .shell { padding: 18px 14px 44px; }
      h1 { font-size: 28px; }
      .hero-grid, .section-grid { grid-template-columns: 1fr; }
      .run-timeline { grid-template-columns: 1fr; }
      .meta-row { grid-template-columns: 1fr; gap: 6px; }
    }
  </style>
</head>
<body data-portal-page="run_overview.html">
  <div class="shell">
    <section class="hero">
      <div class="top-links">
        ${renderPortalTopLinks(outputDir, {
          currentPage: 'run_overview.html',
          extraLinks: [
            { label: '运营复盘 JSON', href: relativeFile(outputDir, operationsReportPath) },
            { label: '运营复盘 Markdown', href: relativeFile(outputDir, operationsReportMdPath) },
            { label: 'Markdown 失败补跑入口', href: relativeFile(outputDir, selectionBoardPath) },
          ],
        })}
      </div>
      <div class="eyebrow">DAOGE Run Overview</div>
      <h1>DAOGE 运行概览</h1>
      <p class="hero-copy">这一页负责把执行阶段的批次、状态、成功失败、暂停信息和模式分布收在一起。你可以先看这轮运行本身是否稳定，再决定去审阅板筛图、去完成报告看细节，还是去失败补跑入口处理异常。</p>
      ${runContextBar}
      <div class="hero-grid">
        <div class="metric-card metric-success">
          <div class="metric-label">成功张数</div>
          <div class="metric-value">${Number(manifest.success || 0)}</div>
        </div>
        <div class="metric-card metric-danger">
          <div class="metric-label">失败张数</div>
          <div class="metric-value">${Number(manifest.failed || 0)}</div>
        </div>
        <div class="metric-card metric-warn">
          <div class="metric-label">跳过已完成</div>
          <div class="metric-value">${skippedCount}</div>
        </div>
        <div class="metric-card metric-info">
          <div class="metric-label">批次数量</div>
          <div class="metric-value">${Number(manifest.batchCount || batchManifests.length)}</div>
        </div>
      </div>
      ${renderTimeline(timeline)}
    </section>

    <section class="section">
      <h2>先看什么</h2>
      <p class="section-copy">先看成功、失败和暂停状态，再看运行参数和批次分布。如果这轮运行本身就不稳定，先不要急着筛图，优先判断是否需要补跑或调整参数。</p>
      <div class="section-grid">
        <article class="info-card">
          <h3>运行状态</h3>
          ${renderList([
            `是否暂停: ${manifest.paused ? '是' : '否'}`,
            `暂停原因: ${manifest.pauseReason || '无'}`,
            `仅重跑失败项: ${manifest.failedOnly ? '是' : '否'}`,
            `Dry run: ${manifest.dryRun ? '是' : '否'}`,
          ])}
        </article>
        <article class="info-card">
          <h3>推荐动作</h3>
          ${renderList([
            Number(manifest.failed || 0) > 0 ? '当前存在失败项，先检查失败补跑入口。' : null,
            manifest.paused ? '当前运行曾暂停，先确认暂停原因再继续下一轮。' : null,
            Number(manifest.failed || 0) === 0 && !manifest.paused ? '这轮运行稳定，可以直接进入审阅板和完成报告。' : null,
          ].filter(Boolean), '当前没有明显异常')}
        </article>
      </div>
    </section>

    <section class="section">
      <h2>运行参数</h2>
      <p class="section-copy">这里集中展示本轮执行的规模和稳定性参数，方便你快速判断这轮是小样本尝试还是正式大批量运行。</p>
      <div class="section-grid">
        <article class="info-card">
          <h3>执行规模</h3>
          <div class="meta-list">
            ${renderMetaRow('Prompt 来源', manifest.promptSource || '未记录')}
            ${renderMetaRow('默认尺寸', manifest.defaultSize || '未记录')}
            ${renderMetaRow('模型', manifest.model || '未记录')}
            ${renderMetaRow('批次数量', manifest.batchCount ?? batchManifests.length)}
            ${renderMetaRow('每批数量', manifest.batchSize ?? '未记录')}
            ${renderMetaRow('阶段数量', manifest.stageCount ?? '未记录')}
          </div>
        </article>
        <article class="info-card">
          <h3>运行上下文</h3>
          <div class="meta-list">
            ${renderMetaRow('输出目录', outputDir)}
            ${renderMetaRow('生成时间', manifest.generatedAt || '未记录')}
            ${renderMetaRow('样本数量', manifest.sampleSize ?? 0)}
            ${renderMetaRow('续跑来源', manifest.resumeManifest || '无')}
            ${renderMetaRow('任务状态文件', manifest.jobState || '未记录')}
            ${renderMetaRow('检查点文件', manifest.checkpoint || '未记录')}
          </div>
        </article>
      </div>
    </section>

    <section class="section">
      <h2>批次与分布</h2>
      <p class="section-copy">这里优先看 request mode、slot role 和 style family 的分布，快速判断这轮执行主要在跑什么，以及批次是否均匀。</p>
      <div class="section-grid">
        <article class="info-card">
          <h3>Request Mode 分布</h3>
          ${renderDistribution(requestModeDistribution)}
        </article>
        <article class="info-card">
          <h3>Slot Role 分布</h3>
          ${renderDistribution(slotRoleDistribution)}
        </article>
      </div>
      <div class="section-grid" style="margin-top:16px;">
        <article class="info-card">
          <h3>Style Family 分布</h3>
          ${renderDistribution(styleFamilyDistribution)}
        </article>
        <article class="info-card">
          <h3>批次结果</h3>
          ${renderList(batchManifests.map((batch) => `第 ${batch.batchNumber} 批: 成功 ${batch.success} / 失败 ${batch.failed}`), '未生成批次结果')}
        </article>
      </div>
    </section>

    <section class="section">
      <h2>关键入口</h2>
      <p class="section-copy">运行概览页不替代审阅板和完成报告，它负责让你先判断这轮执行过程本身稳不稳。看完这里，再决定去看结果、查失败，还是回看运营复盘。</p>
      <article class="info-card">
        <h3>文件入口</h3>
        <div class="link-row">
          ${fileExists(reviewBoardPath) ? renderLink('审阅看板', relativeFile(outputDir, reviewBoardPath)) : ''}
          ${fileExists(completionBoardPath) ? renderLink('完成报告', relativeFile(outputDir, completionBoardPath)) : ''}
          ${fileExists(selectionBoardPath) ? renderLink('失败补跑入口', relativeFile(outputDir, selectionBoardPath)) : ''}
          ${renderLink('运营复盘 JSON', relativeFile(outputDir, operationsReportPath))}
          ${renderLink('运营复盘 Markdown', relativeFile(outputDir, operationsReportMdPath))}
        </div>
      </article>
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
