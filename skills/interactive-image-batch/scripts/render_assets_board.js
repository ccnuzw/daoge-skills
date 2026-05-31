const fs = require('fs');
const path = require('path');
const { parseArgs, readJson, fileExists } = require('./script_utils');
const { renderPortalTopLinks, renderPortalContextBar, renderPortalModeSwitch, renderPortalProgressRail, renderPortalRouteCompass, renderPortalWorkbench } = require('./portal_shared');
const { renderPortalHeadAssets } = require('./portal_ui_shared');
const { deriveTaskLabel } = require('./task_label_utils');
const { loadWorkbenchState } = require('./workbench_state_shared');
const { resolveWorkspaceRouteFile } = require('./workspace_storyboard_shared');

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

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function basenameSafe(filePath) {
  return filePath ? path.basename(String(filePath)) : '未提供';
}

function renderLink(label, href) {
  if (!href) return '';
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function countBy(items, selector) {
  const counts = {};
  for (const item of items) {
    const key = selector(item) || '未设置';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
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

function renderAssetTile(asset, analysisMap, slotAssignmentsByAsset, outputDir) {
  const absolutePath = path.resolve(outputDir, asset.path);
  const relativeImagePath = relativeFile(outputDir, absolutePath);
  const analysis = analysisMap.get(absolutePath) || null;
  const slotAssignments = slotAssignmentsByAsset.get(asset.asset_id) || [];
  const vision = analysis?.vision_recommendation || null;
  const slotSummary = slotAssignments.length
    ? slotAssignments.map((item) => item.slot_id).join(', ')
    : '未绑定';

  return `
    <article id="asset-${escapeHtml(asset.asset_id || 'unknown')}" class="asset-tile asset-${escapeHtml(asset.asset_type || 'reference')}">
      <div class="asset-preview-wrap">
        <img class="asset-preview" src="${escapeHtml(relativeImagePath)}" alt="${escapeHtml(asset.label || asset.asset_id || 'asset')}" />
      </div>
      <h3 class="asset-title">${escapeHtml(asset.label || asset.asset_id || basenameSafe(asset.path))}</h3>
      <div class="asset-pills">
        <span class="pill pill-type">${escapeHtml(asset.asset_type || 'reference')}</span>
        ${slotAssignments.length ? `<span class="pill pill-slot">${escapeHtml(slotAssignments.map((item) => item.slot_id).join(', '))}</span>` : '<span class="pill pill-missing">未绑定</span>'}
      </div>
      <div class="meta-list">
        ${renderMetaRow('文件名', basenameSafe(asset.path))}
        ${renderMetaRow('当前绑定', slotSummary)}
        ${renderMetaRow('规则判断', analysis?.inference?.reason || '未记录')}
        ${renderMetaRow('建议槽位', analysis?.inferred_slot_id || '未记录')}
        ${renderMetaRow('视觉建议', vision ? `${vision.slot_id || '未推荐'} / ${vision.type || '未设置'}` : '未启用')}
        ${renderMetaRow('备注', asset.notes || '未提供')}
      </div>
      <div class="meta-list portal-audience-pro" style="margin-top:12px;">
        ${renderMetaRow('Asset ID', asset.asset_id || '未设置')}
        ${renderMetaRow('规则类型', analysis?.inferred_type || '未记录')}
        ${renderMetaRow('视觉置信度', vision ? Number(vision.confidence || 0).toFixed(2) : '未启用')}
      </div>
    </article>
  `;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['bindings-file']) throw new Error('Missing required flag: --bindings-file');
  if (!args['analysis-file']) throw new Error('Missing required flag: --analysis-file');

  const bindingsPath = path.resolve(args['bindings-file']);
  const analysisPath = path.resolve(args['analysis-file']);
  const bindings = readJson(bindingsPath);
  const analysis = readJson(analysisPath);
  const outputDir = path.dirname(bindingsPath);
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'assets_board.html'));
  const workbenchState = loadWorkbenchState(outputDir);
  const pageState = workbenchState.pageState || workbenchState.workspaceState || {};

  const preflightBoardPath = path.join(outputDir, 'preflight_board.html');
  const promptPreviewBoardPath = path.join(outputDir, 'prompt_preview.html');
  const runOverviewPath = path.join(outputDir, 'run_overview.html');

  const referenceAssets = ensureArray(bindings.reference_assets);
  const slotAssignments = ensureArray(bindings.slot_assignments);
  const ruleAssignments = ensureArray(analysis.ruleAssignments);
  const naturalLanguageBindings = analysis.naturalLanguageBindings || null;
  const visionAnalysis = analysis.visionAnalysis || {};

  const analysisMap = new Map(ruleAssignments.map((item) => [path.resolve(item.path), item]));
  const slotAssignmentsByAsset = new Map();
  slotAssignments.forEach((slot) => {
    ensureArray(slot.asset_ids).forEach((assetId) => {
      if (!slotAssignmentsByAsset.has(assetId)) slotAssignmentsByAsset.set(assetId, []);
      slotAssignmentsByAsset.get(assetId).push(slot);
    });
    ensureArray(slot.mask_asset_ids).forEach((assetId) => {
      if (!slotAssignmentsByAsset.has(assetId)) slotAssignmentsByAsset.set(assetId, []);
      slotAssignmentsByAsset.get(assetId).push(slot);
    });
  });

  const referenceCount = referenceAssets.filter((item) => item.asset_type === 'reference').length;
  const maskCount = referenceAssets.filter((item) => item.asset_type === 'mask').length;
  const unassignedAssets = referenceAssets.filter((asset) => !slotAssignmentsByAsset.has(asset.asset_id));
  const promptOnlySlots = slotAssignments.filter((slot) => String(slot.reference_mode || '').trim() === 'prompt-only');
  const slotModeCounts = countBy(slotAssignments, (slot) => slot.reference_mode || 'prompt-only');
  const unresolvedNaturalLanguage = ensureArray(naturalLanguageBindings?.unassignedIndexes).length;
  const taskLabel = deriveTaskLabel({
    taskLabel: String(pageState?.taskLabel || '').trim(),
    selectedCount: Number(pageState?.counts?.selected || slotAssignments.length || 0),
    sampleSize: 0,
    pauseReason: '',
    resumeManifest: null,
  }, outputDir);
  const phaseLabel = String(pageState?.status?.phase || '').trim() || '准备阶段';
  const statusHeadline = String(pageState?.status?.headline || '').trim() || '当前处于素材与绑定确认阶段';
  const statusSummary = String(pageState?.status?.summary || '').trim()
    || '素材看板已经降为准备补充页，只负责确认素材、槽位和绑定关系有没有明显偏差；确认干净后就回准备工作台继续推进。';
  const nextActionTarget = pageState?.nextAction?.target
    ? path.join(outputDir, pageState.nextAction.target)
    : (fileExists(path.join(outputDir, 'prepare_workspace.html'))
      ? path.join(outputDir, 'prepare_workspace.html')
      : preflightBoardPath);
  const nextActionLabel = String(pageState?.nextAction?.label || '').trim()
    || (fileExists(path.join(outputDir, 'prepare_workspace.html')) ? '回准备工作台' : '回预检总览');
  const nextActionReason = String(pageState?.nextAction?.reason || '').trim() || statusSummary;
  const workspaceHomePath = resolveWorkspaceRouteFile(outputDir, pageState, 'home', path.join(outputDir, 'workspace_home.html'));
  const prepareWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'prepare', path.join(outputDir, 'prepare_workspace.html'));
  const resultWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'result', path.join(outputDir, 'result_workspace.html'));
  const assetsContextBar = renderPortalContextBar({
    runLabel: taskLabel,
    boardLabel: bindings.board_id || analysis.boardId || analysis.board_id || '',
    phaseLabel,
    flowLabel: '工作台首页 -> 准备工作台 -> 素材补充页 -> 回准备主链',
    counts: [
      { label: '参考图', value: referenceCount },
      { label: '遮罩图', value: maskCount },
      { label: '槽位', value: slotAssignments.length },
      { label: '未绑定', value: unassignedAssets.length },
    ],
    hints: [
      statusHeadline,
      nextActionReason,
    ],
  });
  const slotBindingRows = slotAssignments.map((item) => {
    const referenceLinks = ensureArray(item.asset_ids).map((assetId) => {
      const asset = referenceAssets.find((entry) => entry.asset_id === assetId);
      const label = asset?.label || assetId;
      return `<a href="#asset-${escapeHtml(assetId)}">${escapeHtml(label)}</a>`;
    });
    const maskLinks = ensureArray(item.mask_asset_ids).map((assetId) => {
      const asset = referenceAssets.find((entry) => entry.asset_id === assetId);
      const label = asset?.label || assetId;
      return `<a href="#asset-${escapeHtml(assetId)}">${escapeHtml(label)}</a>`;
    });
    return `
      <div id="slot-${escapeHtml(item.slot_id)}" class="slot-binding-row">
        <div class="slot-binding-title">${escapeHtml(item.slot_id)}</div>
        <div class="slot-binding-mode">${escapeHtml(item.reference_mode || 'prompt-only')}</div>
        <div class="slot-binding-links">
          ${referenceLinks.length ? `<div><strong>参考图</strong> ${referenceLinks.join('、')}</div>` : '<div><strong>参考图</strong> 无</div>'}
          ${maskLinks.length ? `<div><strong>遮罩图</strong> ${maskLinks.join('、')}</div>` : '<div><strong>遮罩图</strong> 无</div>'}
        </div>
      </div>
    `;
  });

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DAOGE 素材补充页</title>
${renderPortalHeadAssets()}
  <style>
    :root {
      --bg: #0e1318;
      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --ref: #7cc5a3;
      --mask: #e2c070;
      --warn: #ff8c7a;
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
    .hero, .section, .asset-tile {
      border: 1px solid var(--panel-border);
      background: var(--panel);
      backdrop-filter: blur(12px);
      border-radius: 24px;
      box-shadow: 0 18px 48px rgba(0,0,0,0.24);
    }
    .hero {
      padding: 28px 28px 24px;
      background:
        linear-gradient(160deg, rgba(124,197,163,0.14), transparent 38%),
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
    .hero-grid, .section-grid, .asset-grid {
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
    .asset-grid {
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    }
    .metric-value {
    }
    .metric-ref .metric-value { color: var(--ref); }
    .metric-mask .metric-value { color: var(--mask); }
    .metric-info .metric-value { color: var(--info); }
    .metric-warn .metric-value { color: var(--warn); }
    .asset-tile {
      padding: 18px;
    }
    .asset-preview-wrap {
      border-radius: 18px;
      overflow: hidden;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      aspect-ratio: 1 / 1;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 14px;
    }
    .asset-preview {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .asset-title {
      font-size: 18px;
      margin: 0 0 10px;
    }
    .asset-pills {
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
    .pill-type { color: var(--ref); background: rgba(124,197,163,0.12); }
    .pill-slot { color: var(--info); background: rgba(136,185,255,0.12); }
    .pill-missing { color: var(--warn); background: rgba(255,140,122,0.12); }
    .meta-row {
      display: grid;
      grid-template-columns: 92px 1fr;
      gap: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .meta-row:last-child { border-bottom: none; padding-bottom: 0; }
    .slot-binding-list {
      display: grid;
      gap: 12px;
    }
    .slot-binding-row {
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04);
      border-radius: 16px;
      padding: 14px;
    }
    .slot-binding-title {
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .slot-binding-mode {
      color: var(--text-sub);
      font-size: 12px;
      margin-bottom: 10px;
    }
    .slot-binding-links {
      display: grid;
      gap: 8px;
      color: var(--text-sub);
      font-size: 13px;
      line-height: 1.6;
    }
    .slot-binding-links a {
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px solid rgba(217,179,109,0.35);
      padding-bottom: 1px;
    }
    @media (max-width: 1080px) {
      .hero-grid, .section-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 720px) {
      .shell { padding: 18px 14px 44px; }
      h1 { font-size: 28px; }
      .hero-grid, .section-grid, .asset-grid { grid-template-columns: 1fr; }
      .meta-row { grid-template-columns: 1fr; gap: 6px; }
    }
  </style>
</head>
<body data-portal-page="assets_board.html">
  <div class="shell">
    <section class="hero">
      <div class="top-links">
        ${renderPortalTopLinks(outputDir, {
          currentPage: 'assets_board.html',
          extraLinks: [
            { label: '回工作台首页', file: workspaceHomePath },
            { label: '回准备工作台', file: prepareWorkspacePath },
          ],
        })}
      </div>
      <div class="eyebrow">素材绑定补充页</div>
      <h1>${escapeHtml(taskLabel)} · DAOGE 素材补充页</h1>
      <p class="hero-copy">素材看板已经退到准备补充页层。普通流程先回准备工作台；只有需要核对素材、槽位和绑定关系时，才停留在这里。</p>
      <p class="hero-copy">${escapeHtml(statusSummary)}</p>
      ${assetsContextBar}
      ${renderPortalModeSwitch({
        title: '素材补充页浏览模式',
        copy: '新手确认素材放对位置后就回准备工作台；专业用户再看规则判断、视觉建议和绑定细节。',
      })}
      <div class="hero-grid">
        <div class="metric-card metric-info">
          <div class="metric-label">当前任务</div>
          <div class="metric-value">${escapeHtml(taskLabel)}</div>
        </div>
        <div class="metric-card metric-ref">
          <div class="metric-label">参考图数量</div>
          <div class="metric-value">${referenceCount}</div>
        </div>
        <div class="metric-card metric-mask">
          <div class="metric-label">遮罩图数量</div>
          <div class="metric-value">${maskCount}</div>
        </div>
        <div class="metric-card metric-info">
          <div class="metric-label">已绑定槽位</div>
          <div class="metric-value">${slotAssignments.length}</div>
        </div>
        <div class="metric-card metric-warn">
          <div class="metric-label">推荐下一步</div>
          <div class="metric-value">${escapeHtml(nextActionLabel)}</div>
        </div>
      </div>
      ${renderPortalProgressRail(outputDir, {
        currentPage: 'assets_board.html',
        title: '准备主链进度',
        copy: '素材页只做准备补充核对，不再承担准备主控。通常看完这里就回准备工作台收口。',
      })}
      ${renderPortalRouteCompass(outputDir, {
        title: '素材补充页看完后，回准备主链',
        copy: '这里负责深看素材绑定，不再承担准备总控。把绑定结论送回准备工作台，再决定预检或执行。',
        previous: {
          label: fileExists(prepareWorkspacePath) ? '回准备工作台' : '回 Prompt 预览',
          summary: fileExists(prepareWorkspacePath) ? '回准备主链重新看路线、放行状态和页间交接。' : '如果你怀疑槽位角色或方向本身有偏差，回 Prompt 预览重新对照最省时间。',
          file: fileExists(prepareWorkspacePath) ? prepareWorkspacePath : promptPreviewBoardPath,
          cta: fileExists(prepareWorkspacePath) ? '回准备工作台' : '回 Prompt 预览',
        },
        nextSteps: [
          {
            kicker: '新手下一站',
            label: nextActionLabel,
            summary: nextActionReason,
            file: nextActionTarget,
            cta: nextActionLabel,
            audience: 'newcomer',
          },
          {
            kicker: '专业下一站',
            label: fileExists(runOverviewPath) ? '去运行概览' : (fileExists(resultWorkspacePath) ? '去结果工作台' : '回预检总览'),
            summary: fileExists(runOverviewPath) ? '如果本轮已经开跑，可以按需去运行概览确认执行是否稳定。' : (fileExists(resultWorkspacePath) ? '如果结果层入口已经生成，可以直接回结果工作台继续。' : '如果还没有运行层产物，先回准备工作台做放行判断。'),
            file: fileExists(runOverviewPath) ? runOverviewPath : (fileExists(resultWorkspacePath) ? resultWorkspacePath : preflightBoardPath),
            cta: fileExists(runOverviewPath) ? '去运行概览' : (fileExists(resultWorkspacePath) ? '去结果工作台' : '回预检总览'),
            audience: 'pro',
          },
        ],
      })}
    </section>

    <section class="section">
      <h2>素材补充判断</h2>
      <p class="section-copy">这里只补充素材、槽位和绑定关系判断，不再承担准备主控。看完后回准备工作台决定预检、回 Prompt，还是继续进入运行层。</p>
      ${renderPortalWorkbench(outputDir, {
        title: '素材补充页，先看这里',
        copy: '只先回答素材有没有对上、有没有明显异常，再把结论带回准备主链。',
        cards: [
          {
            label: '绑定状态',
            value: unassignedAssets.length ? '还有未绑定素材' : '素材已基本对齐',
            summary: unassignedAssets.length ? `当前还有 ${unassignedAssets.length} 个未绑定素材。` : '当前没有明显未绑定素材。',
            tone: unassignedAssets.length ? 'rerun' : 'prepare',
          },
          {
            label: '槽位状态',
            value: promptOnlySlots.length ? `仍有 ${promptOnlySlots.length} 个 prompt-only` : '槽位已完成素材分配',
            summary: promptOnlySlots.length ? '如果这些槽位本来就需要参考图或遮罩图，先不要直接开跑。' : '当前槽位分配比较完整。',
            tone: promptOnlySlots.length ? 'report' : 'prepare',
          },
          {
            label: '中文理解',
            value: unresolvedNaturalLanguage ? '还有未消化指令' : '当前理解正常',
            summary: unresolvedNaturalLanguage ? `中文绑定里还有 ${unresolvedNaturalLanguage} 个未消化索引。` : '当前自然语言绑定没有明显冲突。',
            tone: unresolvedNaturalLanguage ? 'rerun' : 'prepare',
            file: promptPreviewBoardPath,
            cta: '回 Prompt 预览',
          },
          {
            label: '推荐下一步',
            value: nextActionLabel,
            summary: nextActionReason,
            tone: 'review',
            file: nextActionTarget || (fileExists(preflightBoardPath) ? preflightBoardPath : runOverviewPath),
            cta: '打开下一站',
          },
        ],
      })}
    </section>

    <section class="section">
      <h2>素材概览</h2>
      <p class="section-copy">先把这轮素材层的总状态看清楚，再决定是否继续逐张核对。</p>
      <div class="section-grid">
        <article class="info-card">
          <h3>绑定总览</h3>
          ${renderList(slotModeCounts.map((item) => `${item.name}: ${item.count}`), '未生成 slot 绑定')}
        </article>
        <article class="info-card">
          <h3>需要注意</h3>
          ${renderList([
            unassignedAssets.length ? `当前有 ${unassignedAssets.length} 个未绑定资产` : null,
            promptOnlySlots.length ? `当前仍有 ${promptOnlySlots.length} 个 prompt-only 槽位` : null,
            unresolvedNaturalLanguage ? `中文绑定里还有 ${unresolvedNaturalLanguage} 个未消化索引` : null,
            visionAnalysis.enabled ? `视觉分析已启用：${visionAnalysis.reason || '已返回建议'}` : '视觉分析未启用，当前只展示规则推断结果',
          ].filter(Boolean), '当前没有明显异常')}
        </article>
      </div>
    </section>

    <section class="section">
      <h2>绑定关系</h2>
      <p class="section-copy">这里帮助你快速看清每个 slot 现在拿到了什么素材，是纯参考图、遮罩编辑，还是仍然 prompt-only。</p>
      <div class="section-grid">
        <article class="info-card">
          <h3>Slot -> Asset</h3>
          ${slotBindingRows.length ? `<div class="slot-binding-list">${slotBindingRows.join('')}</div>` : '<div class="empty-state">未生成绑定</div>'}
        </article>
        <article class="info-card">
          <h3>中文理解摘要</h3>
          ${renderList(ensureArray(naturalLanguageBindings?.explicitAssignments).map((item) => `第 ${Number(item.asset_index) + 1} 张 -> ${item.slot_id} (${item.type === 'mask' ? '遮罩图' : '参考图'})`), '没有自然语言绑定记录')}
        </article>
      </div>
    </section>

    <section class="section">
      <h2>资产卡片</h2>
      <p class="section-copy">每张素材卡都同时展示素材本身、当前绑定槽位、规则推断和视觉推荐。这样你不需要再去翻 JSON 才知道哪张图到底会喂给哪个镜头。</p>
      <div class="asset-grid">
        ${referenceAssets.map((asset) => renderAssetTile(asset, analysisMap, slotAssignmentsByAsset, outputDir)).join('')}
      </div>
    </section>

    <section class="section">
      <h2>继续下一步</h2>
      <p class="section-copy">素材页看完后，通常回准备主线继续放行；绑定 Markdown 和 JSON 只留在内部状态层，不再作为普通入口。</p>
      <article class="info-card">
        <h3>常用入口</h3>
        <div class="link-row">
          ${renderLink('回准备工作台', relativeFile(outputDir, prepareWorkspacePath))}
          ${renderLink('回工作台首页', relativeFile(outputDir, workspaceHomePath))}
        </div>
      </article>
    </section>
  </div>
</body>
</html>`;

  fs.writeFileSync(outputPath, html);
  console.log(JSON.stringify({
    outputPath,
    referenceCount,
    maskCount,
    slotAssignmentCount: slotAssignments.length,
    unassignedAssetCount: unassignedAssets.length,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
