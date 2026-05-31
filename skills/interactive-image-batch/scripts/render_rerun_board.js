const fs = require('fs');
const path = require('path');
const { parseArgs, readJson, fileExists, resolvePromptFileForRerun } = require('./script_utils');
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

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['manifest-file']) throw new Error('Missing required flag: --manifest-file');

  const manifestPath = path.resolve(args['manifest-file']);
  const manifest = readJson(manifestPath);
  const outputDir = path.resolve(manifest.outputDir || path.dirname(manifestPath));
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'rerun_board.html'));
  const workbenchState = loadWorkbenchState(outputDir);
  const pageState = workbenchState.pageState || workbenchState.workspaceState || {};

  const failedFile = path.join(outputDir, 'failed.json');
  const needsReviewFile = path.join(outputDir, 'needs_review.json');
  const rerunCandidatesFile = path.join(outputDir, 'rerun_candidates.json');
  const failed = fileExists(failedFile) ? readJson(failedFile) : [];
  const needsReview = fileExists(needsReviewFile) ? readJson(needsReviewFile) : [];
  const rerunCandidates = fileExists(rerunCandidatesFile) ? readJson(rerunCandidatesFile) : [];

  const resultWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'result', path.join(outputDir, 'result_workspace.html'));
  const exceptionWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'exception', path.join(outputDir, 'exception_workspace.html'));
  const runnerCommand = `node "$DAOGE_RUNNER" --prompts-file '${resolvePromptFileForRerun(manifest, outputDir)}' --resume-manifest '${manifestPath}' --failed-only true`;
  const failedCount = Number(pageState?.counts?.failed || ensureArray(failed).length || manifest.failed || 0);
  const reviewCount = Number(pageState?.counts?.needsReview || ensureArray(needsReview).length || 0);
  const selectedCount = Number(pageState?.counts?.selected || manifest.selectedCount || manifest.success + manifest.failed || 0);
  const taskLabel = deriveTaskLabel({
    taskLabel: String(pageState?.taskLabel || '').trim(),
    selectedCount,
    sampleSize: Number(manifest?.sampleSize || 0),
    pauseReason: manifest?.pauseReason || '',
    resumeManifest: manifest?.resumeManifest || null,
  }, outputDir);
  const phaseLabel = String(pageState?.status?.phase || '').trim() || '补跑补充页';
  const statusHeadline = String(pageState?.status?.headline || '').trim() || '补跑判断已经迁移到异常工作台';
  const statusSummary = String(pageState?.status?.summary || '').trim()
    || (failedCount > 0
      ? `当前有 ${failedCount} 个失败项，建议先在异常工作台统一判断，再决定是否补跑。`
      : '当前没有明显失败压力，通常不需要继续停留在补跑页。');
  const nextActionLabel = String(pageState?.nextAction?.label || '').trim()
    || (fileExists(exceptionWorkspacePath) ? '回异常工作台' : '回结果工作台');
  const nextActionReason = String(pageState?.nextAction?.reason || '').trim() || statusSummary;

  const rerunContextBar = renderPortalContextBar({
    runLabel: path.basename(outputDir),
    phaseLabel,
    flowLabel: '结果工作台 -> 异常工作台 -> 补跑补充页',
    counts: [
      { label: '失败项', value: failedCount },
      { label: '待复核', value: reviewCount },
      { label: '候选', value: ensureArray(rerunCandidates).length },
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
  <title>DAOGE 失败补跑补充页</title>
${renderPortalHeadAssets()}
  <style>
    :root {
      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --page-glow: rgba(255,140,122,0.18);
      --hero-tint: rgba(255,140,122,0.15);
    }
${renderWorkspaceStyles()}
  </style>
</head>
<body data-portal-page="rerun_board.html">
  <div class="shell">
    <section class="hero">
      <div class="top-links">
        ${renderPortalTopLinks(outputDir, { currentPage: 'rerun_board.html' })}
      </div>
      <div class="eyebrow">失败补跑补充页</div>
      <h1>${taskLabel} · DAOGE 失败补跑补充页</h1>
      <p class="hero-copy">${statusSummary}</p>
      ${renderPortalModeSwitch({
        title: '补跑页定位',
        copy: '补跑信息保留，但默认异常入口已经迁移到异常工作台。',
        newcomerLabel: '回异常工作台',
        proLabel: '查看补跑详情',
      })}
      ${rerunContextBar}
      <div class="hero-grid">
        ${renderMetricCard('当前任务', taskLabel, 'info', phaseLabel)}
        ${renderMetricCard('当前定位', '异常补充页', 'warn', statusHeadline)}
        ${renderMetricCard('推荐入口', nextActionLabel, 'good', nextActionReason)}
        ${renderMetricCard('失败项', failedCount, failedCount ? 'bad' : 'good', failedCount ? '只有在确认需要处理时才补跑' : '当前没有失败项')}
      </div>
    </section>

    ${renderPortalProgressRail(outputDir, {
      currentPage: 'rerun_board.html',
      title: '异常主链',
      copy: '补跑页已经退到异常补充页层，是否补跑的主判断请先回异常工作台，再回结果工作台复核。',
    })}

    ${renderPortalRouteCompass(outputDir, {
      title: '补跑前，建议这样判断',
      copy: '先回异常工作台做统一判断，再决定是否真的需要补跑。',
      previous: {
        label: '异常工作台',
        summary: '新的异常处理主入口。',
        file: exceptionWorkspacePath,
        cta: '回异常工作台',
      },
      nextSteps: [
        {
          kicker: '如果只是要重新判断',
          label: '结果工作台',
          summary: nextActionReason,
          file: resultWorkspacePath,
          cta: '回结果工作台',
        },
      ],
    })}

    ${renderPortalWorkbench(outputDir, {
      title: '补跑补充页入口',
      copy: '保留和补跑判断直接相关的主链入口；运行概览、审阅看板和完成摘要不再从这里继续分叉。',
      cards: [
        { label: '回异常工作台', value: fileExists(exceptionWorkspacePath) ? '推荐入口' : '待生成', summary: nextActionReason, file: exceptionWorkspacePath, cta: '回异常工作台', tone: 'good' },
        { label: '回结果工作台', value: fileExists(resultWorkspacePath) ? '可进入' : '待生成', summary: '回主链重新判断是否真的需要补跑。', file: resultWorkspacePath, cta: '回结果工作台', tone: 'info' },
      ],
    })}

    <section class="section">
      <h2>失败项与待复核项</h2>
      <p class="section-copy">这里保留补跑判断真正需要看的信息，但不再把这页做成主控页。</p>
      <div class="entry-grid">
        <article class="entry-card">
          <div class="entry-kicker">失败项</div>
          ${renderList(ensureArray(failed).map((item) => `${item.index || '未记录'} / ${item.title || item.slug || '未命名失败项'} / ${item.error || '未知错误'}`), '当前没有失败项')}
        </article>
        <article class="entry-card">
          <div class="entry-kicker">待复核项</div>
          ${renderList(ensureArray(needsReview).map((item) => `${item.index || '未记录'} / ${item.title || item.slug || '未命名待复核项'} / ${item.revisedPrompt || item.revised_prompt || '未记录修订提示'}`), '当前没有待复核项')}
        </article>
      </div>
    </section>

    <section class="section">
      <h2>推荐命令</h2>
      <p class="section-copy">命令信息继续保留给专业用户，但不再把它放成主流程入口。</p>
      <div class="entry-grid">
        ${renderEntryCard({
          kicker: 'failed-only',
          title: '只补跑失败项',
          copy: runnerCommand,
          href: fileExists(exceptionWorkspacePath) ? relativeFile(outputDir, exceptionWorkspacePath) : null,
          cta: '回异常工作台确认',
          tone: 'warn',
        })}
      </div>
    </section>
  </div>
</body>
</html>`;

  fs.writeFileSync(outputPath, html);
}

main();
