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
  renderWorkspaceStyles,
} = require('./workspace_page_shared');
const { deriveTaskLabel } = require('./task_label_utils');
const { loadWorkbenchState } = require('./workbench_state_shared');
const {
  resolveWorkspaceRouteFile,
  shouldShowStoryboardPage,
} = require('./workspace_storyboard_shared');

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['manifest-file']) throw new Error('Missing required flag: --manifest-file');

  const manifestPath = path.resolve(args['manifest-file']);
  const manifest = readJson(manifestPath);
  const outputDir = path.resolve(manifest.outputDir || path.dirname(manifestPath));
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'result_hub.html'));
  const workbenchState = loadWorkbenchState(outputDir);
  const pageState = workbenchState.pageState || workbenchState.workspaceState || {};

  const resultWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'result', path.join(outputDir, 'result_workspace.html'));
  const exceptionWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'exception', path.join(outputDir, 'exception_workspace.html'));
  const prepareWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'prepare', path.join(outputDir, 'prepare_workspace.html'));
  const reviewBoardPath = path.join(outputDir, 'review_board.html');
  const completionBoardPath = path.join(outputDir, 'completion_board.html');
  const storyboardBoardPath = resolveWorkspaceRouteFile(outputDir, pageState, 'storyboard', path.join(outputDir, 'storyboard_board.html'));
  const rerunBoardPath = path.join(outputDir, 'rerun_board.html');
  const runOverviewPath = path.join(outputDir, 'run_overview.html');
  const resultHubMarkdownPath = path.join(outputDir, 'daoge_result_hub.md');

  const success = Number(pageState?.counts?.success || manifest.success || 0);
  const failed = Number(pageState?.counts?.failed || manifest.failed || 0);
  const selectedCount = Number(manifest.selectedCount || success + failed || 0);
  const hasResultWorkspace = fileExists(resultWorkspacePath);
  const hasExceptionWorkspace = fileExists(exceptionWorkspacePath);
  const taskLabel = deriveTaskLabel({
    taskLabel: String(pageState?.taskLabel || '').trim(),
    selectedCount,
    sampleSize: Number(manifest?.sampleSize || 0),
    pauseReason: manifest?.pauseReason || '',
    resumeManifest: manifest?.resumeManifest || null,
  }, outputDir);
  const phaseLabel = String(pageState?.status?.phase || '').trim() || '结果兼容入口';
  const statusHeadline = String(pageState?.status?.headline || '').trim() || '结果入口已经迁移到统一结果工作台';
  const statusSummary = String(pageState?.status?.summary || '').trim()
    || (failed > 0
      ? `当前有 ${failed} 个失败项，建议先回异常工作台统一处理。`
      : '当前结果层已经由统一工作台主链接管，兼容页只保留少量补充入口。');
  const nextActionLabel = String(pageState?.nextAction?.label || '').trim()
    || (hasResultWorkspace ? '进入结果工作台' : '先看审阅看板');
  const nextActionReason = String(pageState?.nextAction?.reason || '').trim() || statusSummary;
  const hasStoryboard = shouldShowStoryboardPage({
    outputDir,
    workspaceState: pageState,
    storyboardPath: storyboardBoardPath,
    manifest,
  });

  const contextBar = renderPortalContextBar({
    runLabel: path.basename(outputDir),
    phaseLabel,
    flowLabel: '旧结果维护说明页 -> 结果工作台 -> 审阅 / 分镜补充 / 异常',
    counts: [
      { label: '成功', value: success },
      { label: '失败', value: failed },
      { label: '总数', value: selectedCount },
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
  <title>DAOGE 旧结果维护说明页</title>
${renderPortalHeadAssets()}
  <style>
    :root {
      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --page-glow: rgba(124,197,163,0.18);
      --hero-tint: rgba(124,197,163,0.15);
    }
${renderWorkspaceStyles()}
  </style>
</head>
<body data-portal-page="result_hub.html">
  <div class="shell">
    <section class="hero">
      <div class="top-links">
        ${renderPortalTopLinks(outputDir, {
          currentPage: 'result_hub.html',
          extraLinks: [{ label: '旧结果维护说明文档', file: resultHubMarkdownPath }],
        })}
      </div>
      <div class="eyebrow">旧结果维护说明</div>
      <h1>${taskLabel} · DAOGE 旧结果维护说明页</h1>
      <p class="hero-copy">${statusSummary}</p>
      ${renderPortalModeSwitch({
        title: '结果入口迁移说明',
        copy: '旧结果维护说明页继续存在，但现在只作为维护说明入口；真正的结果主控已经迁移到统一结果工作台。',
        newcomerLabel: '回结果主链',
        proLabel: '旧维护说明',
      })}
      ${contextBar}
      <div class="hero-grid">
        ${renderMetricCard('当前任务', taskLabel, 'info', phaseLabel)}
        ${renderMetricCard('当前定位', '旧结果维护说明', 'warn', statusHeadline)}
        ${renderMetricCard('推荐动作', nextActionLabel, 'good', nextActionReason)}
        ${renderMetricCard('结果状态', failed > 0 ? '先处理异常' : '可继续筛图', failed > 0 ? 'bad' : 'good', failed > 0 ? `当前失败 ${failed} 项` : `当前成功 ${success} 项`)}
      </div>
    </section>

    ${renderPortalProgressRail(outputDir, {
      currentPage: 'result_hub.html',
      title: '结果主链',
      copy: '旧结果维护说明页已经退到维护说明层，结果主链请回结果工作台，再按需进入异常工作台或结果补充页。',
    })}

    ${renderPortalRouteCompass(outputDir, {
      title: '现在建议这样走',
      copy: '从旧结果维护说明页迁移到新的结果主链，不再把这个旧页当结果总控。',
      previous: {
        label: '准备工作台',
        summary: '如果你怀疑方向或放行条件本身有问题，就先回准备层。',
        file: prepareWorkspacePath,
        cta: '回准备工作台',
      },
      nextSteps: [
        {
          kicker: '默认结果入口',
          label: '结果工作台',
          summary: nextActionReason,
          file: resultWorkspacePath,
          cta: '进入结果工作台',
          pendingLabel: '本轮尚未生成',
        },
        failed > 0 ? {
          kicker: '如果存在异常',
          label: '异常工作台',
          summary: '把失败项、待复核项和补跑建议统一收在一页里。',
          file: exceptionWorkspacePath,
          cta: '进入异常工作台',
          pendingLabel: '本轮尚未生成',
        } : null,
      ],
    })}

    ${renderPortalWorkbench(outputDir, {
      title: '结果迁移入口',
      copy: '保留真正常用的结果操作入口，其余旧结果页全部降到说明层。',
      cards: [
        { label: '结果工作台', value: hasResultWorkspace ? '推荐入口' : '待生成', summary: nextActionReason, file: resultWorkspacePath, cta: '进入结果工作台', tone: 'good' },
        { label: '审阅看板', value: fileExists(reviewBoardPath) ? '可进入' : '待生成', summary: '真正需要批量筛图时再进入。', file: reviewBoardPath, cta: '进入审阅看板', tone: 'info' },
        { label: '完成摘要页', value: fileExists(completionBoardPath) ? '可进入' : '待生成', summary: '需要完整执行摘要时再进入。', file: completionBoardPath, cta: '进入完成摘要页', tone: 'good' },
        { label: '异常工作台', value: hasExceptionWorkspace ? '按需进入' : '待生成', summary: '只在失败或待复核时使用。', file: exceptionWorkspacePath, cta: '进入异常工作台', tone: failed > 0 ? 'warn' : 'neutral' },
      ],
    })}

    <section class="section">
      <h2>旧结果维护说明页</h2>
      <p class="section-copy">这些页还保留，但已经退到细分操作层。现在建议先进入结果工作台，再按需要跳进去。</p>
      <div class="entry-grid">
        ${renderEntryCard({
          kicker: '细筛入口',
          title: '审阅看板',
          copy: '需要批量看图、挑图和判断去留时，再进入这个细分页面。',
          href: fileExists(reviewBoardPath) ? relativeFile(outputDir, reviewBoardPath) : null,
          cta: '打开审阅看板',
          tone: 'good',
        })}
        ${renderEntryCard({
          kicker: '按需补充页',
          title: '分镜整板补充页',
          copy: '只有分镜任务才更依赖这个视角，普通结果任务不必先看。',
          href: hasStoryboard ? relativeFile(outputDir, storyboardBoardPath) : null,
          cta: '打开分镜整板补充页',
          tone: 'neutral',
        })}
        ${renderEntryCard({
          kicker: '摘要入口',
          title: '完成摘要页',
          copy: '需要完整执行摘要、覆盖范围或成功失败统计时再进入。',
          href: fileExists(completionBoardPath) ? relativeFile(outputDir, completionBoardPath) : null,
          cta: '打开完成摘要页',
          tone: 'info',
        })}
        ${renderEntryCard({
          kicker: '补跑入口',
          title: '失败补跑页',
          copy: '只在明确要处理失败项时再进入，不再与正常结果页并列抢入口。',
          href: fileExists(rerunBoardPath) ? relativeFile(outputDir, rerunBoardPath) : null,
          cta: '打开失败补跑页',
          tone: 'warn',
        })}
        ${renderEntryCard({
          kicker: '运行细页',
          title: '运行概览页',
          copy: '这个页面更偏执行视角，普通用户不需要先看它。',
          href: fileExists(runOverviewPath) ? relativeFile(outputDir, runOverviewPath) : null,
          cta: '打开运行概览补充页',
          tone: 'neutral',
        })}
      </div>
    </section>
  </div>
</body>
</html>`;

  fs.writeFileSync(outputPath, html);
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
