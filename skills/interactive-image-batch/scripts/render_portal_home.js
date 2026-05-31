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
const { resolveWorkspaceRouteFile } = require('./workspace_storyboard_shared');

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['manifest-file']) throw new Error('Missing required flag: --manifest-file');

  const manifestPath = path.resolve(args['manifest-file']);
  const manifest = readJson(manifestPath);
  const outputDir = path.resolve(manifest.outputDir || path.dirname(manifestPath));
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'daoge_portal.html'));
  const workbenchState = loadWorkbenchState(outputDir);
  const pageState = workbenchState.pageState || workbenchState.workspaceState || {};

  const workspaceHomePath = resolveWorkspaceRouteFile(outputDir, pageState, 'home', path.join(outputDir, 'workspace_home.html'));
  const prepareWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'prepare', path.join(outputDir, 'prepare_workspace.html'));
  const resultWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'result', path.join(outputDir, 'result_workspace.html'));
  const exceptionWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'exception', path.join(outputDir, 'exception_workspace.html'));
  const examplesCatalogPath = path.join(__dirname, '..', 'references', 'examples', 'examples_catalog.html');

  const reviewBoardPath = path.join(outputDir, 'review_board.html');
  const completionBoardPath = path.join(outputDir, 'completion_board.html');
  const storyboardBoardPath = path.join(outputDir, 'storyboard_board.html');
  const rerunBoardPath = path.join(outputDir, 'rerun_board.html');
  const promptPreviewPath = path.join(outputDir, 'prompt_preview.html');
  const preflightBoardPath = path.join(outputDir, 'preflight_board.html');
  const assetsBoardPath = path.join(outputDir, 'assets_board.html');

  const success = Number(pageState?.counts?.success || manifest.success || 0);
  const failed = Number(pageState?.counts?.failed || manifest.failed || 0);
  const selectedCount = Number(pageState?.counts?.selected || manifest.selectedCount || success + failed || 0);
  const batchCount = Number(pageState?.counts?.batches || manifest.batchCount || 0);
  const hasWorkspaceHome = fileExists(workspaceHomePath);
  const hasPrepare = fileExists(prepareWorkspacePath);
  const hasResult = fileExists(resultWorkspacePath);
  const hasException = fileExists(exceptionWorkspacePath);
  const issueCount = failed;
  const taskLabel = deriveTaskLabel({
    taskLabel: String(pageState?.taskLabel || '').trim(),
    selectedCount,
    sampleSize: Number(manifest?.sampleSize || 0),
    pauseReason: manifest?.pauseReason || '',
    resumeManifest: manifest?.resumeManifest || null,
  }, outputDir);
  const phaseLabel = String(pageState?.status?.phase || '').trim() || (hasResult ? '兼容入口页' : '兼容准备页');
  const statusHeadline = String(pageState?.status?.headline || '').trim() || '默认入口已经切换到统一工作台主链';
  const statusSummary = String(pageState?.status?.summary || '').trim()
    || (hasResult
      ? '当前更适合回结果工作台继续筛图和收口。'
      : hasPrepare
        ? '当前更适合回准备工作台确认方向和放行。'
        : '当前先从工作台首页或中文模板展示板进入。');
  const nextActionLabel = String(pageState?.nextAction?.label || '').trim()
    || (hasWorkspaceHome ? '进入工作台首页' : '打开中文模板展示板');
  const nextActionReason = String(pageState?.nextAction?.reason || '').trim() || statusSummary;

  const contextBar = renderPortalContextBar({
    runLabel: path.basename(outputDir),
    phaseLabel,
    flowLabel: '旧门户 -> 工作台首页 -> 准备工作台 -> 结果工作台',
    counts: [
      { label: '成功', value: success },
      { label: '失败', value: failed },
      { label: '总数', value: selectedCount },
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
  <title>DAOGE 旧入口说明页</title>
${renderPortalHeadAssets()}
  <style>
    :root {
      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --page-glow: rgba(217,179,109,0.18);
      --hero-tint: rgba(217,179,109,0.15);
    }
${renderWorkspaceStyles()}
  </style>
</head>
<body data-portal-page="daoge_portal.html">
  <div class="shell">
    <section class="hero">
      <div class="top-links">
        ${renderPortalTopLinks(outputDir, {
          currentPage: 'daoge_portal.html',
          extraLinks: [{ label: '中文模板展示板', file: examplesCatalogPath }],
        })}
      </div>
      <div class="eyebrow">旧入口说明</div>
      <h1>${taskLabel} · DAOGE 旧入口说明页</h1>
      <p class="hero-copy">${statusSummary}</p>
      ${renderPortalModeSwitch({
        title: '入口迁移说明',
        copy: '旧门户继续存在，但现在只作为过渡说明；真正的主链入口已经收敛到新的工作台页面。',
        newcomerLabel: '回工作台主链',
        proLabel: '旧入口说明',
      })}
      ${contextBar}
      <div class="hero-grid">
        ${renderMetricCard('当前任务', taskLabel, 'info', phaseLabel)}
        ${renderMetricCard('当前定位', '旧入口说明', 'warn', statusHeadline)}
        ${renderMetricCard('推荐动作', nextActionLabel, 'good', nextActionReason)}
        ${renderMetricCard('结果入口', hasResult ? '结果工作台' : '待生成', issueCount > 0 ? 'warn' : 'good', issueCount > 0 ? '如果存在异常，结果层后再进入异常工作台' : '结果判断已并入新的结果工作台')}
      </div>
    </section>

    ${renderPortalProgressRail(outputDir, {
      currentPage: 'daoge_portal.html',
      title: '工作台主链',
      copy: '旧门户已经退到说明层，真正的入口请回工作台首页，再按阶段进入准备工作台、结果工作台和异常工作台。',
    })}

    ${renderPortalRouteCompass(outputDir, {
      title: '现在建议这样走',
      copy: '不要再把这个旧页当作主入口。直接转入新的工作台体系就好。',
      previous: {
        label: '中文模板展示板',
        summary: '如果你还在判断任务入口类型，就回中文模板展示板。',
        file: examplesCatalogPath,
        cta: '回展示板',
      },
      nextSteps: [
        {
          kicker: '默认入口',
          label: '工作台首页',
          summary: nextActionReason,
          file: workspaceHomePath,
          cta: '进入工作台首页',
          pendingLabel: '本轮尚未生成',
        },
        {
          kicker: '如果你在准备阶段',
          label: '准备工作台',
          summary: '方向、放行和素材准备都已经收进这一页。',
          file: prepareWorkspacePath,
          cta: '进入准备工作台',
          pendingLabel: '本轮尚未生成',
        },
      ],
    })}

    ${renderPortalWorkbench(outputDir, {
      title: '新主链入口',
      copy: '保留真正该点的几个入口，不再把旧门户继续做成大而全导航页。',
      cards: [
        { label: '工作台首页', value: hasWorkspaceHome ? '推荐入口' : '待生成', summary: nextActionReason, file: workspaceHomePath, cta: '进入工作台首页', tone: 'good' },
        { label: '准备工作台', value: hasPrepare ? '已就绪' : '待生成', summary: '准备阶段唯一主页面。', file: prepareWorkspacePath, cta: '进入准备工作台', tone: 'info' },
        { label: '结果工作台', value: hasResult ? '已就绪' : '待生成', summary: '结果阶段唯一主页面。', file: resultWorkspacePath, cta: '进入结果工作台', tone: 'good' },
        { label: '异常工作台', value: hasException ? '按需进入' : '待生成', summary: '只在失败或待复核时使用。', file: exceptionWorkspacePath, cta: '进入异常工作台', tone: issueCount > 0 ? 'warn' : 'neutral' },
      ],
    })}

    <section class="section">
      <h2>旧入口说明</h2>
      <p class="section-copy">这些页面还会暂时保留，但它们已经降级成补充页或说明页，不再建议作为第一入口。</p>
      <div class="entry-grid">
        ${renderEntryCard({
          kicker: '准备补充页',
          title: '提示词预览 / 预检 / 素材页',
          copy: '当你需要细看方向、风险或素材绑定时再进入，不需要一开始就全看。',
          href: fileExists(promptPreviewPath) ? relativeFile(outputDir, promptPreviewPath) : (fileExists(preflightBoardPath) ? relativeFile(outputDir, preflightBoardPath) : (fileExists(assetsBoardPath) ? relativeFile(outputDir, assetsBoardPath) : null)),
          cta: '打开准备补充页',
          tone: 'info',
        })}
        ${renderEntryCard({
          kicker: '结果补充页',
          title: '审阅 / 整板 / 完成摘要',
          copy: '真正需要批量筛图或看整板时再进入这些旧的细分结果页。',
          href: fileExists(reviewBoardPath) ? relativeFile(outputDir, reviewBoardPath) : (fileExists(completionBoardPath) ? relativeFile(outputDir, completionBoardPath) : null),
          cta: '打开结果补充页',
          tone: 'good',
        })}
        ${renderEntryCard({
          kicker: '异常补充页',
          title: '失败补跑页',
          copy: '只在确定需要处理失败项时再进入，不再放在主链前面。',
          href: fileExists(rerunBoardPath) ? relativeFile(outputDir, rerunBoardPath) : null,
          cta: '打开补跑补充页',
          tone: 'warn',
        })}
        ${renderEntryCard({
          kicker: '按需补充页',
          title: '分镜整板页',
          copy: '只有分镜任务才需要这类整板视角，普通任务可跳过。',
          href: fileExists(storyboardBoardPath) ? relativeFile(outputDir, storyboardBoardPath) : null,
          cta: '打开分镜整板页',
          tone: 'neutral',
        })}
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
