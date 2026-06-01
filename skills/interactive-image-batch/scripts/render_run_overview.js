const fs = require('fs');
const path = require('path');
const { parseArgs, readJson, fileExists } = require('./script_utils');
const {
  renderPortalTopLinks,
  renderPortalContextBar,
  renderPortalModeSwitch,
  renderPortalProgressRail,
  renderPortalRouteCompass,
  renderPortalWorkbench,
} = require('./portal_shared');
const { renderPortalHeadAssets } = require('./portal_ui_shared');
const {
  relativeFile,
  renderMetricCard,
  renderEntryCard,
  renderList,
  renderWorkspaceStyles,
} = require('./workspace_page_shared');
const { deriveTaskLabel } = require('./task_label_utils');
const { loadWorkbenchState } = require('./workbench_state_shared');
const { resolveWorkspaceRouteFile } = require('./workspace_storyboard_shared');

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

function renderDistribution(items, emptyText = '无') {
  if (!items.length) return `<div class="empty-state">${emptyText}</div>`;
  return `<ul class="info-list">${items.map((item) => `<li>${item.name}: ${item.count}</li>`).join('')}</ul>`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['manifest-file']) throw new Error('Missing required flag: --manifest-file');

  const manifestPath = path.resolve(args['manifest-file']);
  const manifest = readJson(manifestPath);
  const outputDir = path.resolve(manifest.outputDir || path.dirname(manifestPath));
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'run_overview.html'));
  const workbenchState = loadWorkbenchState(outputDir);
  const pageState = workbenchState.pageState || workbenchState.workspaceState || {};

  const operationsReportPath = path.join(outputDir, 'operations_report.json');
  const operationsReport = fileExists(operationsReportPath) ? readJson(operationsReportPath) : null;
  const batchManifests = Array.isArray(manifest.batches) ? manifest.batches : [];
  const allResults = batchManifests.flatMap((batch) => batch.results || []);
  const skippedCount = allResults.filter((item) => item.skipped).length;
  const successResults = allResults.filter((item) => item.ok && !item.skipped);
  const requestModeDistribution = operationsReport?.distributions?.requestMode || countBy(successResults, 'requestMode').slice(0, 10);
  const slotRoleDistribution = operationsReport?.distributions?.slotRole || countBy(successResults, 'slotRole').slice(0, 10);
  const styleFamilyDistribution = operationsReport?.distributions?.styleFamily || countBy(successResults, 'styleFamily').slice(0, 10);

  const workspaceHomePath = resolveWorkspaceRouteFile(outputDir, pageState, 'home', path.join(outputDir, 'workspace_home.html'));
  const resultWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'result', path.join(outputDir, 'result_workspace.html'));
  const exceptionWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'exception', path.join(outputDir, 'exception_workspace.html'));
  const successCount = Number(pageState?.counts?.success || manifest.success || 0);
  const failedCount = Number(pageState?.counts?.failed || manifest.failed || 0);
  const selectedCount = Number(pageState?.counts?.selected || manifest.selectedCount || successCount + failedCount || 0);
  const batchCount = Number(pageState?.counts?.batches || manifest.batchCount || batchManifests.length);
  const taskLabel = deriveTaskLabel({
    taskLabel: String(pageState?.taskLabel || '').trim(),
    selectedCount,
    sampleSize: Number(manifest?.sampleSize || 0),
    pauseReason: manifest?.pauseReason || '',
    resumeManifest: manifest?.resumeManifest || null,
  }, outputDir);
  const phaseLabel = String(pageState?.status?.phase || '').trim() || '运行概览补充页';
  const statusHeadline = String(pageState?.status?.headline || '').trim() || '运行概览页更适合在怀疑执行问题时再打开';
  const statusSummary = String(pageState?.status?.summary || '').trim()
    || (failedCount > 0
      ? `当前有 ${failedCount} 个失败项，先回异常工作台统一处理，再决定是否留在这页排查执行细节。`
      : '当前执行层已经完成，普通流程请先回结果工作台继续判断。');
  const nextActionLabel = String(pageState?.nextAction?.label || '').trim()
    || (fileExists(resultWorkspacePath) ? '回结果工作台' : '回工作台首页');
  const nextActionReason = String(pageState?.nextAction?.reason || '').trim() || statusSummary;

  const contextBar = renderPortalContextBar({
    runLabel: path.basename(outputDir),
    phaseLabel,
    flowLabel: '工作台首页 -> 结果工作台 -> 运行补充页',
    counts: [
      { label: '成功', value: successCount },
      { label: '失败', value: failedCount },
      { label: '跳过', value: skippedCount },
      { label: '批次', value: batchCount },
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
  <title>DAOGE 运行概览补充页</title>
${renderPortalHeadAssets()}
  <style>
    :root {
      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --page-glow: rgba(136,185,255,0.18);
      --hero-tint: rgba(136,185,255,0.15);
    }
${renderWorkspaceStyles()}
  </style>
</head>
<body data-portal-page="run_overview.html">
  <div class="shell">
    <section class="hero">
      <div class="top-links">
        ${renderPortalTopLinks(outputDir, { currentPage: 'run_overview.html' })}
      </div>
      <div class="eyebrow">运行概览补充页</div>
      <h1>${taskLabel} · DAOGE 运行概览补充页</h1>
      <p class="hero-copy">${statusSummary}</p>
      ${renderPortalModeSwitch({
        title: '运行页定位',
        copy: '执行细节保留，但入口层已经迁移到新的工作台主链。',
        newcomerLabel: '回工作台首页',
        proLabel: '查看运行详情',
      })}
      ${contextBar}
      <div class="hero-grid">
        ${renderMetricCard('当前任务', taskLabel, 'info', phaseLabel)}
        ${renderMetricCard('当前定位', '执行细节页', 'warn', statusHeadline)}
        ${renderMetricCard('推荐入口', nextActionLabel, 'good', nextActionReason)}
        ${renderMetricCard('运行规模', `${batchCount} 批`, 'info', `${successCount} 成功 / ${skippedCount} 跳过`)}
      </div>
    </section>

    ${renderPortalProgressRail(outputDir, {
      currentPage: 'run_overview.html',
      title: '工作台主链',
      copy: '运行概览页已经降到补充页层，主链判断请回工作台首页、结果工作台和异常工作台。',
    })}

    ${renderPortalRouteCompass(outputDir, {
      title: '建议路线',
      copy: '先回主链做结果判断，只有明确要查执行问题时，才停留在这张补充页。',
      previous: {
        label: '工作台首页',
        summary: '回到新的总控入口。',
        file: workspaceHomePath,
        cta: '回工作台首页',
      },
      nextSteps: [
        {
          kicker: '默认入口',
          label: '结果工作台',
          summary: nextActionReason,
          file: resultWorkspacePath,
          cta: '回结果工作台',
        },
        failedCount > 0 ? {
          kicker: '如果存在异常',
          label: '异常工作台',
          summary: '统一处理失败项和待复核项。',
          file: exceptionWorkspacePath,
          cta: '进入异常工作台',
        } : null,
      ],
    })}

    ${renderPortalWorkbench(outputDir, {
      title: '运行补充页入口',
      copy: '这页只保留回主链的少量动作；审阅、完成摘要和 Markdown 选择板不再从这里堆入口。',
      cards: [
        { label: '回结果工作台', value: fileExists(resultWorkspacePath) ? '推荐入口' : '待生成', summary: nextActionReason, file: resultWorkspacePath, cta: '回结果工作台', tone: 'good' },
        { label: '回异常工作台', value: fileExists(exceptionWorkspacePath) ? '按需进入' : '待生成', summary: '如果执行问题已经影响结果，回异常主链统一处理。', file: exceptionWorkspacePath, cta: '回异常工作台', tone: failedCount > 0 ? 'warn' : 'neutral' },
      ],
    })}

    <section class="section">
      <h2>运行参数</h2>
      <p class="section-copy">这里保留执行层关心的参数，但不再把它包装成主控内容。</p>
      <div class="entry-grid">
        ${renderEntryCard({ kicker: '模型', title: String(manifest.model || '未记录'), copy: `默认尺寸 ${String(manifest.defaultSize || '未记录')}`, tone: 'info' })}
        ${renderEntryCard({ kicker: '批次规模', title: `${batchCount} 批`, copy: `每批 ${Number(manifest.batchSize || 0)} 张`, tone: 'good' })}
        ${renderEntryCard({ kicker: '运行状态', title: manifest.paused ? '曾暂停' : '未暂停', copy: manifest.paused ? String(manifest.pauseReason || '待确认原因') : '当前运行过程没有暂停记录。', tone: manifest.paused ? 'warn' : 'good' })}
      </div>
    </section>

    <section class="section">
      <h2>批次与分布</h2>
      <p class="section-copy">这些是专业用户常用的执行诊断信息，保留，但不再放到主链前面。</p>
      <div class="entry-grid">
        <article class="entry-card">
          <div class="entry-kicker">Request Mode 分布</div>
          ${renderDistribution(requestModeDistribution, '无')}
        </article>
        <article class="entry-card">
          <div class="entry-kicker">Style Family 分布</div>
          ${renderDistribution(styleFamilyDistribution, '无')}
        </article>
        <article class="entry-card">
          <div class="entry-kicker">Slot Role 分布</div>
          ${renderDistribution(slotRoleDistribution, '无')}
        </article>
      </div>
    </section>
  </div>
</body>
</html>`;

  fs.writeFileSync(outputPath, html);
}

main();
