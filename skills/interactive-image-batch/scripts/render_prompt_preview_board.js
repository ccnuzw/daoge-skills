const path = require('path');
const { parseArgs, readJson, fileExists } = require('./script_utils');
const { renderPortalTopLinks, renderPortalContextBar, renderPortalModeSwitch, renderPortalProgressRail, renderPortalRouteCompass, renderPortalWorkbench } = require('./portal_shared');
const { ensurePortalUiAssets, renderPortalHeadAssets } = require('./portal_ui_shared');
const { topLabel, resolveProfile, buildDisplayDistributions, normalizeValue } = require('./template_display_profile');
const { deriveTaskLabel } = require('./task_label_utils');
const { loadWorkbenchState } = require('./workbench_state_shared');
const { resolveWorkspaceRouteFile } = require('./workspace_storyboard_shared');

function escapeHtml(text) {
  return String(text ?? '')
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

function displayTitle(item, fallbackIndex) {
  const shotLabel = String(item.shot_label || '').trim();
  if (shotLabel) return shotLabel;
  const scene = String(item.scene || '').trim();
  if (scene) return scene;
  return item.title || item.slug || `prompt-${fallbackIndex}`;
}

function findDistributionCounts(displayDistributions, key) {
  return displayDistributions.find((item) => item.key === key)?.counts || [];
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
  const workbenchState = loadWorkbenchState(outputDir);
  const pageState = workbenchState.pageState || workbenchState.workspaceState || {};
  const taskLabel = deriveTaskLabel({
    taskLabel: String(pageState?.taskLabel || '').trim(),
    selectedCount: Number(pageState?.counts?.selected || prompts.length || 0),
    sampleSize: 0,
    pauseReason: '',
    resumeManifest: null,
  }, outputDir);
  const phaseLabel = String(pageState?.status?.phase || '').trim() || '准备阶段';
  const statusHeadline = String(pageState?.status?.headline || '').trim() || `当前处于${phaseLabel}的方向确认阶段`;
  const statusSummary = String(pageState?.status?.summary || '').trim()
    || '提示词预览已经降为准备补充页，只负责深看方向、分布和样本质量；普通流程请回准备工作台继续。';
  const nextActionTarget = pageState?.nextAction?.target
    ? path.join(outputDir, pageState.nextAction.target)
    : path.join(outputDir, 'prepare_workspace.html');
  const nextActionLabel = String(pageState?.nextAction?.label || '').trim()
    || (fileExists(path.join(outputDir, 'prepare_workspace.html')) ? '回准备工作台' : '去预检总览');
  const nextActionReason = String(pageState?.nextAction?.reason || '').trim() || statusSummary;
  const workspaceHomePath = resolveWorkspaceRouteFile(outputDir, pageState, 'home', path.join(outputDir, 'workspace_home.html'));
  const prepareWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'prepare', path.join(outputDir, 'prepare_workspace.html'));
  const resultWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'result', path.join(outputDir, 'result_workspace.html'));

  const displayProfile = resolveProfile(prompts);
  const displayDistributions = buildDisplayDistributions(prompts, displayProfile)
    .map((item) => ({ ...item, counts: item.counts.slice(0, 8) }));
  const styleFamily = findDistributionCounts(displayDistributions, 'style_family');
  const purityGrade = buildDisplayDistributions(prompts, {
    distributionFields: [{ key: 'purity_grade', label: '强度等级', shortLabel: '强度等级分布' }],
  })[0]?.counts || [];
  const slotRole = buildDisplayDistributions(prompts, {
    distributionFields: [{ key: 'slot_role', label: '槽位角色', shortLabel: '槽位角色分布' }],
  })[0]?.counts || [];
  const showStyleFamily = styleFamily.length && topLabel(styleFamily) !== '未指定';
  const showPurityGrade = purityGrade.length && topLabel(purityGrade) !== '未指定';

  const preflightBoardPath = path.join(outputDir, 'preflight_board.html');
  const assetsBoardPath = path.join(outputDir, 'assets_board.html');
  const promptContextBar = renderPortalContextBar({
    runLabel: taskLabel,
    phaseLabel,
    flowLabel: '工作台首页 -> 准备工作台 -> 提示词补充页 -> 回准备主链',
    counts: [
      { label: '提示词', value: prompts.length },
      { label: '批次', value: batches.length },
      { label: '当前样本', value: previewItems.length },
    ],
    hints: [
      statusHeadline,
      nextActionReason,
    ],
  });

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DAOGE 提示词预览</title>
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
      padding: 24px 22px 48px;
    }
    .hero, .section, .prompt-card {
      border: 1px solid var(--panel-border);
      background: var(--panel);
      backdrop-filter: blur(12px);
      border-radius: 24px;
      box-shadow: 0 18px 48px rgba(0,0,0,0.24);
    }
    .hero {
      padding: 24px 24px 20px;
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
      line-height: 1.65;
      max-width: 68ch;
    }
    .hero-grid, .section-grid, .prompt-grid {
      display: grid;
      gap: 14px;
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
      padding: 18px;
    }
    .prompt-card-title {
      font-size: 17px;
      margin: 0 0 10px;
    }
    .prompt-card-copy {
      color: var(--text-sub);
      line-height: 1.6;
      margin: 12px 0 0;
      font-size: 13px;
    }
    .meta-list {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .meta-row {
      display: grid;
      grid-template-columns: 110px 1fr;
      gap: 10px;
      padding-bottom: 8px;
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
            { label: '回工作台首页', file: workspaceHomePath },
            { label: '回准备工作台', file: prepareWorkspacePath },
          ],
        })}
      </div>
      <div class="eyebrow">提示词预览补充页</div>
      <h1>${escapeHtml(taskLabel)} · DAOGE 提示词预览补充页</h1>
      <p class="hero-copy">提示词预览已经退到准备补充页层。普通流程先回准备工作台；只有需要逐条看 prompt、分布或样本覆盖时，才停留在这里。</p>
      <p class="hero-copy">${escapeHtml(statusSummary)}</p>
      ${promptContextBar}
      ${renderPortalModeSwitch({
        title: '提示词补充页浏览模式',
        copy: '新手看完方向摘要就回准备工作台；熟练用户才继续深看批次、分布和样本。',
      })}
      <div class="hero-grid">
        <div class="metric-card metric-info">
          <div class="metric-label">当前任务</div>
          <div class="metric-value">${escapeHtml(taskLabel)}</div>
        </div>
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
          <div class="metric-label">推荐下一步</div>
          <div class="metric-value">${escapeHtml(nextActionLabel)}</div>
        </div>
      </div>
      ${renderPortalProgressRail(outputDir, {
        currentPage: 'prompt_preview.html',
        title: '准备主链进度',
        copy: '提示词预览只做准备补充说明，不再承担准备主控。主判断回准备工作台完成。',
      })}
      ${renderPortalRouteCompass(outputDir, {
        title: '提示词补充页看完后，回准备主链',
        copy: '这里负责逐条深看 prompt，不再承担准备总控。方向结论要送回准备工作台，再决定预检或回退。',
        previous: {
          label: fileExists(prepareWorkspacePath) ? '回准备工作台' : '回中文模板展示板',
          summary: fileExists(prepareWorkspacePath) ? '回准备主链重新看当前阶段、路线和工作台建议。' : '当你发现任务类型、风格方向或任务意图一开始就选偏了，回这里重选更省时间。',
          file: fileExists(prepareWorkspacePath) ? prepareWorkspacePath : path.join(__dirname, '..', 'references', 'examples', 'examples_catalog.html'),
          cta: fileExists(prepareWorkspacePath) ? '回准备工作台' : '回展示板重选',
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
            label: storyboardMode ? '去资产看板' : (fileExists(resultWorkspacePath) ? '去结果工作台' : '去预检总览'),
            summary: storyboardMode ? '如果你主要关心素材和槽位绑定，直接去资产看板会更快。' : (fileExists(resultWorkspacePath) ? '如果这轮已经有结果层入口，可以直接回主链继续。' : '如果方向已经明确，就继续去预检总览做放行判断。'),
            file: storyboardMode ? assetsBoardPath : (fileExists(resultWorkspacePath) ? resultWorkspacePath : preflightBoardPath),
            cta: storyboardMode ? '去资产看板' : (fileExists(resultWorkspacePath) ? '去结果工作台' : '去预检总览'),
            audience: 'pro',
          },
        ],
      })}
    </section>

    <section class="section">
      <h2>提示词补充判断</h2>
      <p class="section-copy">${escapeHtml(displayProfile.firstLookCopy)}</p>
      ${renderPortalWorkbench(outputDir, {
        title: '提示词补充页，先看这里',
        copy: '先判断方向是否正确，再把结论带回准备主链。',
        cards: [
          {
            label: '主方向',
            value: topLabel(findDistributionCounts(displayDistributions, displayProfile.summaryFields[0]?.key) || []),
            summary: '这格只回答这轮提示词当前最主要的方向。',
            tone: 'prepare',
          },
          {
            label: '当前建议',
            value: nextActionLabel,
            summary: nextActionReason,
            tone: 'report',
            file: nextActionTarget,
            cta: nextActionLabel,
          },
          {
            label: '素材判断',
            value: storyboardMode ? '建议看素材页' : '可直接预检',
            summary: storyboardMode ? '这轮是 storyboard 类任务，最好再看一次槽位和素材绑定。' : '当前更适合直接进入预检放行。',
            tone: 'prepare',
            file: storyboardMode ? assetsBoardPath : preflightBoardPath,
            cta: storyboardMode ? '去资产看板' : '继续预检',
          },
          {
            label: '样本状态',
            value: `${previewItems.length} / ${prompts.length}`,
            summary: '先看样本是否已经覆盖主方向，再决定要不要继续逐条核对。',
            tone: 'status',
            file: markdownPath,
            cta: '打开文字版',
          },
        ],
      })}
    </section>

    <section class="section">
      <h2>准备概览</h2>
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
      <h2>批次概览</h2>
      <p class="section-copy">这里反映准备阶段如何切批。先确认每批大小和总批次数，避免到了执行阶段才发现节奏过重或过碎。</p>
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
      <h2>提示词样例</h2>
      <p class="section-copy">这里展示的是首批高代表性的提示词样例，用于人工确认方向。首屏只保留高信号字段，长提示词做收束，避免一开始就被大量文本淹没。</p>
      <div class="prompt-grid">
        ${previewItems.map((item, index) => `
          <article class="prompt-card">
            <h3 class="prompt-card-title">${escapeHtml(item.index || index + 1)}. ${escapeHtml(displayTitle(item, index + 1))}</h3>
            <div class="meta-list">
              ${displayProfile.sampleFields.map((field) => renderMetaRow(field.label, normalizeValue(item[field.key]) || '未设置')).join('')}
              ${renderMetaRow('槽位', item.slot_id || item.shot_id || '未设置')}
              ${renderMetaRow('生成方式', item.reference_mode || 'prompt-only')}
            </div>
            <p class="prompt-card-copy">${escapeHtml(shorten(getPromptText(item)))}</p>
          </article>
        `).join('')}
      </div>
    </section>

    <section class="section">
      <h2>继续下一步</h2>
      <p class="section-copy">提示词预览页不是最终执行页。看完这里以后，通常就回准备工作台；文字版和 JSON 只留给维护排查，不作为普通入口。</p>
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

  ensurePortalUiAssets(outputDir);
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
