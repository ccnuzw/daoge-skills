const fs = require('fs');
const path = require('path');
const { parseArgs, readJson, fileExists } = require('./script_utils');
const { renderPortalTopLinks, renderPortalContextBar, renderPortalModeSwitch, renderPortalProgressRail, renderPortalRouteCompass } = require('./portal_shared');
const { renderPortalHeadAssets } = require('./portal_ui_shared');

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPercent(value, total) {
  const numericValue = Number(value || 0);
  const numericTotal = Number(total || 0);
  if (!numericTotal) return '0%';
  return `${((numericValue / numericTotal) * 100).toFixed(4)}%`;
}

function regionStyle(region, canvas) {
  const canvasWidth = Number(canvas?.width || 0);
  const canvasHeight = Number(canvas?.height || 0);
  return [
    `left:${formatPercent(region.x, canvasWidth)}`,
    `top:${formatPercent(region.y, canvasHeight)}`,
    `width:${formatPercent(region.width, canvasWidth)}`,
    `height:${formatPercent(region.height, canvasHeight)}`,
  ].join(';');
}

function findSlotImage(slotId, results) {
  const hit = results.find((item) => String(item.slotId || item.slot_id || '').trim() === String(slotId || '').trim() && item.ok !== false);
  return hit ? hit.output || null : null;
}

function findSlotResult(slotId, results) {
  return results.find((item) => String(item.slotId || item.slot_id || '').trim() === String(slotId || '').trim()) || null;
}

function getReviewState(result, relativeImage) {
  if (result?.ok === false) return 'failed';
  if (result?.requestMode === 'masked-edit' || result?.editSource === 'previous-output') return 'needs-review';
  if (relativeImage) return 'ready';
  return 'missing';
}

function getReviewLabel(reviewState) {
  if (reviewState === 'failed') return '执行失败';
  if (reviewState === 'needs-review') return '待复核';
  if (reviewState === 'ready') return '已出图';
  return '缺图';
}

function renderBrandPanel(region, content, canvas) {
  const titleLines = ensureArray(content?.brand_panel?.title_lines);
  return `
    <div class="panel panel-brand" style="${regionStyle(region, canvas)}">
      <div class="panel-brand-inner">
        ${titleLines.length ? titleLines.map((item) => `<div class="brand-line">${escapeHtml(item)}</div>`).join('') : '<div class="brand-line muted">Brand panel</div>'}
        <div class="brand-meta">${escapeHtml(content?.board_theme || '')}</div>
      </div>
    </div>
  `;
}

function renderImageRegion(region, slot, result, outputDir, canvas) {
  const outputPath = result?.output || null;
  const relativeImage = outputPath ? path.relative(outputDir, outputPath) : null;
  const reviewState = getReviewState(result, relativeImage);
  const reviewLabel = getReviewLabel(reviewState);
  const anchorId = `slot-${String(slot?.slot_id || region.id || '').trim()}`;
  return `
    <div id="${escapeHtml(anchorId)}" class="panel panel-shot state-${escapeHtml(reviewState)}" style="${regionStyle(region, canvas)}">
      <div class="panel-frame ${relativeImage ? 'has-image' : 'missing-image'}">
        ${relativeImage ? `<img src="${escapeHtml(relativeImage)}" alt="${escapeHtml(slot?.shot_label || slot?.slot_id || region.id)}" />` : '<div class="placeholder">No image</div>'}
        <div class="panel-state">${escapeHtml(reviewLabel)}</div>
      </div>
      <div class="panel-caption">
        <div class="panel-title">${escapeHtml(slot?.shot_label || slot?.slot_id || region.id)}</div>
        <div class="panel-meta">${escapeHtml(slot?.timecode || slot?.slot_role || slot?.role || '')}</div>
        <div class="panel-scene">${escapeHtml(slot?.scene || '')}</div>
      </div>
    </div>
  `;
}

function buildSlotMap(storyboard) {
  const slotBlueprint = ensureArray(storyboard.slot_blueprint);
  return new Map(slotBlueprint.map((item) => [item.slot_id, item]));
}

function buildBindingMap(layout) {
  const map = new Map();
  ensureArray(layout.bindings).forEach((binding) => {
    if (binding.region_id && binding.slot_id) map.set(binding.region_id, binding.slot_id);
  });
  return map;
}

function buildBoardSummary(regions, bindingMap, slotMap, content, results, outputDir) {
  const slotSummaries = [];
  const counts = { ready: 0, 'needs-review': 0, failed: 0, missing: 0 };

  regions.forEach((region) => {
    const slotId = bindingMap.get(region.id) || region.id;
    const slot = slotMap.get(slotId) || content.slots?.find((item) => item.slot_id === slotId) || null;
    if (String(region.role || slot?.role || '').trim() === 'brand_panel') return;

    const result = findSlotResult(slotId, results);
    const outputPath = result?.output || null;
    const relativeImage = outputPath ? path.relative(outputDir, outputPath) : null;
    const reviewState = getReviewState(result, relativeImage);
    counts[reviewState] += 1;
    slotSummaries.push({
      slotId,
      shotLabel: slot?.shot_label || slotId || region.id,
      timecode: slot?.timecode || '',
      scene: slot?.scene || '',
      reviewState,
      reviewLabel: getReviewLabel(reviewState),
      hasImage: Boolean(relativeImage),
    });
  });

  return {
    totalSlots: slotSummaries.length,
    readyCount: counts.ready,
    needsReviewCount: counts['needs-review'],
    failedCount: counts.failed,
    missingCount: counts.missing,
    slotSummaries,
  };
}

function splitThemeParts(themeText) {
  return String(themeText || '')
    .split(/[，,、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildBoardHero(content, boardSummary) {
  const themeParts = splitThemeParts(content?.board_theme || '');
  const heroTags = themeParts.slice(0, 6);
  const boardType = themeParts[0] || '整板分镜';
  const duration = themeParts.find((item) => /秒/.test(item)) || '';
  const narrative = themeParts.find((item) => /为什么|核心|主题|问题|转折/.test(item)) || '';
  const shotCount = boardSummary.totalSlots ? `${boardSummary.totalSlots} 格镜头` : '';
  const summaryBits = [boardType, duration, shotCount, narrative].filter(Boolean);
  return {
    summary: summaryBits.length
      ? `${summaryBits.join('，')}，适合先看整板节奏，再回到审阅和完成页做收口。`
      : '这一页更适合先看整板节奏、主画面关系和镜头回到上下文后的观感。',
    tags: heroTags,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['storyboard-file']) throw new Error('Missing required flag: --storyboard-file');
  if (!args['results-file']) throw new Error('Missing required flag: --results-file');

  const storyboardFile = path.resolve(args['storyboard-file']);
  const resultsFile = path.resolve(args['results-file']);
  const storyboard = readJson(storyboardFile);
  const results = readJson(resultsFile);
  const outputDir = path.resolve(args['output-dir'] || path.dirname(resultsFile));
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'storyboard_board.html'));
  const workspaceHomePath = path.join(outputDir, 'workspace_home.html');
  const resultWorkspacePath = path.join(outputDir, 'result_workspace.html');
  const exceptionWorkspacePath = path.join(outputDir, 'exception_workspace.html');
  const layout = storyboard.layout || {};
  const content = storyboard.content || {};
  const canvas = layout.canvas || {};
  const regions = ensureArray(layout.regions);
  const bindingMap = buildBindingMap(layout);
  const slotMap = buildSlotMap(storyboard);
  const boardSummary = buildBoardSummary(regions, bindingMap, slotMap, content, results, outputDir);
  const boardHero = buildBoardHero(content, boardSummary);
  const boardContextBar = renderPortalContextBar({
    runLabel: path.basename(outputDir),
    boardLabel: content.board_id || content.board_title || '',
    phaseLabel: '整板审阅',
    flowLabel: '结果工作台 -> 整板页 -> 异常 / 回首页',
    counts: [
      { label: '已出图', value: boardSummary.readyCount },
      { label: '待复核', value: boardSummary.needsReviewCount },
      { label: '失败', value: boardSummary.failedCount },
      { label: '缺图', value: boardSummary.missingCount },
    ],
    hints: [
      boardSummary.failedCount || boardSummary.missingCount ? '先处理失败 / 缺图，再看镜头节奏' : '当前整板可优先检查镜头节奏与品牌区关系',
      boardSummary.needsReviewCount ? `${boardSummary.needsReviewCount} 个镜头需要重点复核局部编辑或衔接感` : '当前没有局部编辑高风险镜头',
    ],
  });

  const body = regions.map((region) => {
    const slotId = bindingMap.get(region.id) || region.id;
    const slot = slotMap.get(slotId) || content.slots?.find((item) => item.slot_id === slotId) || null;
    if (String(region.role || slot?.role || '').trim() === 'brand_panel') {
      return renderBrandPanel(region, content, canvas);
    }
    const result = findSlotResult(slotId, results);
    return renderImageRegion(region, slot, result, outputDir, canvas);
  }).join('\n');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(content.board_title || content.board_id || 'Storyboard Board')}</title>
${renderPortalHeadAssets()}
  <style>
    :root {
      --board-bg: ${canvas.background || '#0f1115'};
      --panel-bg: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.12);
      --text-main: #f4f0e8;
      --text-sub: rgba(244,240,232,0.7);
      --accent: #d7b56d;
      --ready: #7cc5a3;
      --review: #e2c070;
      --failed: #ff8c7a;
      --summary-shadow: 0 18px 48px rgba(0,0,0,0.24);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at top left, rgba(215,181,109,0.18), transparent 28%),
        linear-gradient(135deg, #0b0d11 0%, #171c23 48%, #0f1115 100%);
      color: var(--text-main);
      font-family: "Noto Serif SC", "PingFang SC", "Hiragino Sans GB", serif;
      padding: 24px;
    }
    .board-shell {
      max-width: min(100vw - 48px, ${canvas.width || 1920}px);
      margin: 0 auto;
    }
    .board-hero {
      margin: 20px 0 24px;
      display: grid;
      gap: 14px;
    }
    .board-kicker {
      display: inline-flex;
      width: fit-content;
      align-items: center;
      padding: 7px 12px;
      border-radius: 999px;
      border: 1px solid rgba(215,181,109,0.22);
      background: rgba(255,255,255,0.04);
      color: var(--accent);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .board-hero-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .board-hero-tag {
      display: inline-flex;
      align-items: center;
      padding: 7px 11px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.04);
      color: var(--text-sub);
      font-size: 12px;
      line-height: 1;
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
    .board-overview {
      display: grid;
      grid-template-columns: minmax(0, 1.12fr) minmax(360px, 0.88fr);
      gap: 24px;
      margin: 30px 0 24px;
      align-items: start;
    }
    .overview-card {
      min-width: 0;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 24px;
      background:
        linear-gradient(180deg, rgba(215,181,109,0.10), transparent 42%),
        rgba(255,255,255,0.04);
      backdrop-filter: blur(10px);
      padding: 22px 20px 20px;
      box-shadow: var(--summary-shadow);
    }
    .overview-title {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: var(--accent);
      margin-bottom: 14px;
    }
    .overview-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .overview-metric {
      border-radius: 18px;
      padding: 16px 16px 18px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      min-height: 96px;
    }
    .overview-metric-label {
      color: var(--text-sub);
      font-size: 12px;
      margin-bottom: 10px;
    }
    .overview-metric-value {
      font-size: 28px;
      font-weight: 700;
    }
    .overview-metric-note {
      margin-top: 10px;
      color: var(--text-sub);
      font-size: 12px;
      line-height: 1.4;
    }
    .board-meta-list {
      display: grid;
      gap: 10px;
    }
    .board-meta-item {
      display: grid;
      grid-template-columns: 88px 1fr;
      gap: 12px;
      align-items: start;
      color: var(--text-sub);
      font-size: 13px;
      line-height: 1.5;
    }
    .board-meta-item strong {
      color: var(--text-main);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .slot-nav {
      display: grid;
      gap: 10px;
    }
    .slot-nav-item {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 12px;
      align-items: center;
      border-radius: 18px;
      padding: 10px 12px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .slot-nav-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 72px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(14,19,24,0.72);
      border: 1px solid rgba(255,255,255,0.12);
      font-size: 12px;
      font-weight: 700;
    }
    .slot-nav-pill.state-ready { color: var(--ready); }
    .slot-nav-pill.state-needs-review { color: var(--review); }
    .slot-nav-pill.state-failed { color: var(--failed); }
    .slot-nav-pill.state-missing { color: var(--text-sub); }
    .slot-nav-main {
      min-width: 0;
    }
    .slot-nav-title {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .slot-nav-sub {
      color: var(--text-sub);
      font-size: 12px;
      line-height: 1.45;
    }
    .slot-nav-item {
      color: inherit;
      text-decoration: none;
    }
    .slot-nav-item:hover {
      border-color: rgba(255,255,255,0.18);
      background: rgba(255,255,255,0.06);
    }
    .slot-nav-side {
      text-align: right;
      color: var(--text-sub);
      font-size: 12px;
      line-height: 1.45;
    }
    .slot-nav-links {
      margin-top: 6px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .slot-nav-links a {
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px solid rgba(215,181,109,0.35);
      padding-bottom: 1px;
      font-size: 12px;
    }
    .board-title {
      margin: 0;
      max-width: 100%;
      font-size: clamp(24px, 2.15vw, 40px);
      line-height: 1.16;
      letter-spacing: 0.01em;
      white-space: nowrap;
    }
    .board-subtitle {
      margin: 0;
      color: var(--text-sub);
      max-width: 980px;
      font-size: 15px;
      line-height: 1.75;
    }
    body[data-portal-page="storyboard_board.html"] .portal-actions {
      margin: 22px 0 30px;
      padding: 18px;
    }
    body[data-portal-page="storyboard_board.html"] .portal-actions-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      align-items: stretch;
    }
    body[data-portal-page="storyboard_board.html"] .portal-action-card {
      min-width: 0;
      min-height: 176px;
      padding: 18px 20px 16px;
      gap: 10px;
      align-content: start;
    }
    body[data-portal-page="storyboard_board.html"] .portal-action-label {
      font-size: 15px;
      line-height: 1.35;
    }
    body[data-portal-page="storyboard_board.html"] .portal-action-summary {
      min-height: 0;
      max-width: 28ch;
      font-size: 13px;
      line-height: 1.68;
    }
    body[data-portal-page="storyboard_board.html"] .portal-action-link {
      margin-top: auto;
      padding-top: 10px;
    }
    body[data-portal-page="storyboard_board.html"] .portal-action-link a,
    body[data-portal-page="storyboard_board.html"] .portal-action-link span {
      font-size: 13px;
    }
    @media (max-width: 1180px) {
      .board-title {
        font-size: clamp(24px, 4.8vw, 36px);
        white-space: normal;
        text-wrap: balance;
      }
      .board-overview {
        grid-template-columns: 1fr;
      }
      body[data-portal-page="storyboard_board.html"] .portal-actions-grid {
        grid-template-columns: 1fr;
      }
      body[data-portal-page="storyboard_board.html"] .portal-action-card {
        min-height: 0;
      }
    }
    .focus-banner {
      display: none;
      align-items: center;
      gap: 10px;
      margin: 0 0 18px;
      padding: 12px 14px;
      border-radius: 16px;
      border: 1px solid rgba(215,181,109,0.24);
      background:
        linear-gradient(180deg, rgba(215,181,109,0.12), rgba(255,255,255,0.02)),
        rgba(255,255,255,0.04);
      color: var(--text-main);
      box-shadow: var(--summary-shadow);
    }
    .focus-banner.show {
      display: flex;
    }
    .focus-banner-label {
      color: var(--accent);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      flex: 0 0 auto;
    }
    .focus-banner-text {
      font-size: 14px;
      color: var(--text-sub);
      line-height: 1.5;
    }
    .board {
      position: relative;
      width: 100%;
      aspect-ratio: ${(canvas.width || 16)} / ${(canvas.height || 9)};
      background: var(--board-bg);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 20px 80px rgba(0,0,0,0.35);
    }
    .panel {
      position: absolute;
      border: 1px solid var(--panel-border);
      background: var(--panel-bg);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      overflow: hidden;
    }
    .panel-shot {
      display: flex;
      flex-direction: column;
    }
    .panel-frame {
      width: 100%;
      flex: 1 1 auto;
      min-height: 0;
      background: rgba(255,255,255,0.04);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }
    .panel-frame img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .panel-frame.missing-image {
      background:
        linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)),
        repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0, rgba(255,255,255,0.04) 8px, transparent 8px, transparent 16px);
    }
    .placeholder {
      color: var(--text-sub);
      font-size: 14px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .panel-state {
      position: absolute;
      left: 12px;
      top: 12px;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      background: rgba(15,17,21,0.75);
      border: 1px solid rgba(255,255,255,0.1);
    }
    .state-ready .panel-state {
      color: var(--ready);
    }
    .state-needs-review .panel-state {
      color: var(--review);
    }
    .state-failed .panel-state {
      color: var(--failed);
    }
    .state-failed {
      border-color: rgba(255,140,122,0.45);
    }
    .state-needs-review {
      border-color: rgba(226,192,112,0.4);
    }
    .panel-shot.is-focused {
      box-shadow:
        0 0 0 2px rgba(215,181,109,0.42),
        0 0 0 8px rgba(215,181,109,0.10),
        0 20px 50px rgba(0,0,0,0.28);
      border-color: rgba(215,181,109,0.48);
    }
    .panel-caption {
      flex: 0 0 auto;
      padding: 14px 14px 16px;
    }
    .panel-title {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.35;
      margin-bottom: 8px;
    }
    .panel-meta {
      color: var(--accent);
      font-size: 12px;
      margin-bottom: 8px;
    }
    .panel-scene {
      color: var(--text-sub);
      font-size: 12px;
      line-height: 1.55;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      overflow: hidden;
    }
    .panel-brand {
      display: flex;
      align-items: stretch;
    }
    .panel-brand-inner {
      padding: 32px 28px;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      gap: 12px;
      width: 100%;
      background:
        linear-gradient(180deg, rgba(215,181,109,0.14), transparent 38%),
        rgba(255,255,255,0.02);
    }
    .brand-line {
      font-size: 36px;
      line-height: 1.1;
      letter-spacing: 0.05em;
    }
    .brand-line.muted {
      color: var(--text-sub);
      font-size: 18px;
    }
    .brand-meta {
      margin-top: auto;
      font-size: 13px;
      color: var(--text-sub);
      line-height: 1.5;
    }
  </style>
</head>
<body data-portal-page="storyboard_board.html">
  <div class="board-shell">
    <div class="top-links">
      ${renderPortalTopLinks(outputDir, {
        currentPage: 'storyboard_board.html',
      })}
    </div>
    ${renderPortalModeSwitch({
      title: '整板页浏览模式',
      copy: '这里专门用来回看整板节奏与镜头关系，看完后回结果层或异常层继续主链判断。',
    })}
    ${renderPortalProgressRail(outputDir, {
      currentPage: 'storyboard_board.html',
      title: '新的主链',
      copy: '整板页已经降成按需页面，只有分镜任务才需要进入这里回看上下文。',
    })}
    ${renderPortalRouteCompass(outputDir, {
      title: '看完整板后，通常这样走',
      copy: '当你已经确认镜头衔接和品牌区关系，就回结果层继续收口；如果已经看到缺图或异常，再进异常层。',
      previous: {
        label: '回结果工作台',
        summary: '如果你已经看完整板，回统一结果页继续判断是否收口。',
        file: resultWorkspacePath,
        cta: '回结果层',
      },
      nextSteps: [
        {
          kicker: '推荐下一步',
          label: '回工作台首页',
          summary: '如果这一轮已经判断清楚，可以回首页继续下一轮任务或重新开题。',
          file: workspaceHomePath,
          cta: '回首页',
          audience: 'newcomer',
        },
        {
          kicker: '专业下一站',
          label: '去异常工作台',
          summary: '如果整板里已经明确看到缺图或异常，直接去异常层最小范围处理。',
          file: exceptionWorkspacePath,
          cta: '去异常层',
          audience: 'pro',
        },
        ],
      })}
    <section class="board-hero">
      <div class="board-kicker">Storyboard Workbench</div>
      <h1 class="board-title">${escapeHtml(content.board_title || content.board_id || 'Storyboard Board')}</h1>
      <p class="board-subtitle">${escapeHtml(boardHero.summary)}</p>
      ${boardHero.tags.length ? `
        <div class="board-hero-tags">
          ${boardHero.tags.map((item) => `<span class="board-hero-tag">${escapeHtml(item)}</span>`).join('')}
        </div>
      ` : ''}
    </section>
    ${boardContextBar}
    <div class="focus-banner" id="focus-banner">
      <div class="focus-banner-label">当前焦点</div>
      <div class="focus-banner-text" id="focus-banner-text">当前没有聚焦的分镜槽位。</div>
    </div>
    <div class="board-overview">
      <section class="overview-card">
        <div class="overview-title">结果摘要</div>
        <div class="overview-grid">
          <div class="overview-metric">
            <div class="overview-metric-label">总镜头</div>
            <div class="overview-metric-value">${boardSummary.totalSlots}</div>
            <div class="overview-metric-note">本板实际参与审阅的分镜槽位数</div>
          </div>
          <div class="overview-metric">
            <div class="overview-metric-label">已出图</div>
            <div class="overview-metric-value">${boardSummary.readyCount}</div>
            <div class="overview-metric-note">可以先进入整板观感检查</div>
          </div>
          <div class="overview-metric">
            <div class="overview-metric-label">待复核</div>
            <div class="overview-metric-value">${boardSummary.needsReviewCount}</div>
            <div class="overview-metric-note">优先看局部编辑、续跑和衔接感</div>
          </div>
          <div class="overview-metric">
            <div class="overview-metric-label">失败 / 缺图</div>
            <div class="overview-metric-value">${boardSummary.failedCount + boardSummary.missingCount}</div>
            <div class="overview-metric-note">失败 ${boardSummary.failedCount}，缺图 ${boardSummary.missingCount}</div>
          </div>
        </div>
        <div class="board-meta-list" style="margin-top:14px;">
          <div class="board-meta-item portal-audience-pro"><strong>Board ID</strong><span>${escapeHtml(content.board_id || '未设置')}</span></div>
          <div class="board-meta-item"><strong>主题</strong><span>${escapeHtml(content.board_theme || '未设置')}</span></div>
          <div class="board-meta-item"><strong>先看哪里</strong><span>先看“失败 / 缺图”，再看“待复核”，最后回到整板检查镜头节奏、品牌区与主画面关系。</span></div>
        </div>
      </section>
      <section class="overview-card">
        <div class="overview-title">分组导航</div>
        <div class="slot-nav">
          ${boardSummary.slotSummaries.map((item) => `
            <a class="slot-nav-item" href="#slot-${escapeHtml(item.slotId)}">
              <div class="slot-nav-pill state-${escapeHtml(item.reviewState)}">${escapeHtml(item.reviewLabel)}</div>
              <div class="slot-nav-main">
                <div class="slot-nav-title">${escapeHtml(item.shotLabel)}</div>
                <div class="slot-nav-sub">${escapeHtml(item.slotId)}${item.scene ? ` · ${escapeHtml(item.scene)}` : ''}</div>
              </div>
              <div class="slot-nav-side">
                <div>${escapeHtml(item.timecode || '未标时间码')}</div>
                <div>${item.hasImage ? '已有画面' : '暂无画面'}</div>
              </div>
            </a>
          `).join('')}
        </div>
      </section>
    </div>
    <div class="board">
      ${body}
    </div>
  </div>
  <script>
    (() => {
      const focusBanner = document.getElementById('focus-banner');
      const focusBannerText = document.getElementById('focus-banner-text');

      function clearFocus() {
        document.querySelectorAll('.panel-shot.is-focused').forEach((node) => node.classList.remove('is-focused'));
      }

      function applyFocusFromHash() {
        const hash = window.location.hash || '';
        clearFocus();
        if (!hash || !hash.startsWith('#slot-')) {
          focusBanner.classList.remove('show');
          return;
        }
        const target = document.querySelector(hash);
        if (!target) {
          focusBanner.classList.remove('show');
          return;
        }
        target.classList.add('is-focused');
        const title = target.querySelector('.panel-title')?.textContent?.trim() || hash.replace(/^#slot-/, '');
        const meta = target.querySelector('.panel-meta')?.textContent?.trim() || '未标时间码';
        focusBannerText.textContent = '当前定位到 ' + title + ' · ' + meta + '。你可以先看该格，再回看整板上下文。';
        focusBanner.classList.add('show');
      }

      window.addEventListener('hashchange', applyFocusFromHash);
      applyFocusFromHash();
    })();
  </script>
</body>
</html>`;

  fs.writeFileSync(outputPath, html);
  console.log(JSON.stringify({
    outputPath,
    regionCount: regions.length,
    renderedImageSlots: regions.filter((region) => {
      const slotId = bindingMap.get(region.id) || region.id;
      return Boolean(findSlotImage(slotId, results));
    }).length,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
