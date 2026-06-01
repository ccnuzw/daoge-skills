const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./script_utils');
const { renderPortalHeadAssets } = require('./portal_ui_shared');
const {
  renderPortalTopLinks,
  renderPortalContextBar,
  renderPortalRouteCompass,
  renderPortalWorkbench,
  renderPortalProgressRail,
} = require('./portal_shared');
const {
  renderMetricCard,
  renderEntryCard,
  renderWorkspaceStyles,
  buildTaskControlBarFromUnifiedStatus,
  buildSupportPageCopy,
} = require('./workspace_page_shared');
const {
  loadEntryState,
  resolveEntryContext,
  resolveEntryMainlineActions,
  resolveEntryMainlineProtocol,
  resolveEntryNextStep,
  resolveEntryPreview,
  resolveEntryRoute,
  resolveEntryWorkbench,
} = require('./entry_state_shared');
const {
  loadTaskCenterState,
  renderRunCardModel,
} = require('./task_center_state_shared');
const {
  getTaskCenterLanguage,
} = require('./workspace_status_dictionary');

function buildEntryStatePaths(rootDir, latest) {
  const latestOutputDir = latest?.outputDir ? path.resolve(latest.outputDir) : null;
  return [
    latestOutputDir ? path.join(latestOutputDir, 'entry_state.json') : null,
    path.join(rootDir, 'entry_state.json'),
    path.join(rootDir, 'examples', 'entry_state.json'),
  ].filter(Boolean);
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLiveStatusStrip(taskCenterState = {}) {
  const language = getTaskCenterLanguage();
  const liveCopilotDirective = taskCenterState.liveCopilotDirective && typeof taskCenterState.liveCopilotDirective === 'object'
    ? taskCenterState.liveCopilotDirective
    : (taskCenterState.liveRun?.liveCopilotDirective && typeof taskCenterState.liveRun.liveCopilotDirective === 'object'
      ? taskCenterState.liveRun.liveCopilotDirective
      : {});
  const copilotSummary = taskCenterState.copilotSummary && typeof taskCenterState.copilotSummary === 'object'
    ? {
      ...taskCenterState.copilotSummary,
      nextActionLabel: liveCopilotDirective.nextActionLabel || liveCopilotDirective.nextAction?.label || taskCenterState.copilotSummary.nextActionLabel,
      nextActionSummary: liveCopilotDirective.nextActionSummary || liveCopilotDirective.nextAction?.reason || taskCenterState.copilotSummary.nextActionSummary,
      recommendedReply: liveCopilotDirective.recommendedReply || liveCopilotDirective.primarySay || taskCenterState.copilotSummary.recommendedReply,
      progressSummary: liveCopilotDirective.progressSummary || taskCenterState.copilotSummary.progressSummary,
    }
    : (taskCenterState.liveRun?.copilotSummary && typeof taskCenterState.liveRun.copilotSummary === 'object'
      ? {
        ...taskCenterState.liveRun.copilotSummary,
        nextActionLabel: liveCopilotDirective.nextActionLabel || liveCopilotDirective.nextAction?.label || taskCenterState.liveRun.copilotSummary.nextActionLabel,
        nextActionSummary: liveCopilotDirective.nextActionSummary || liveCopilotDirective.nextAction?.reason || taskCenterState.liveRun.copilotSummary.nextActionSummary,
        recommendedReply: liveCopilotDirective.recommendedReply || liveCopilotDirective.primarySay || taskCenterState.liveRun.copilotSummary.recommendedReply,
        progressSummary: liveCopilotDirective.progressSummary || taskCenterState.liveRun.copilotSummary.progressSummary,
      }
      : {});
  const unifiedStatus = taskCenterState.unifiedStatus && typeof taskCenterState.unifiedStatus === 'object'
    ? taskCenterState.unifiedStatus
    : (taskCenterState.liveRun?.unifiedStatus && typeof taskCenterState.liveRun.unifiedStatus === 'object'
      ? taskCenterState.liveRun.unifiedStatus
      : {});
  const dialogueStatus = taskCenterState.dialogueStatus && typeof taskCenterState.dialogueStatus === 'object'
    ? taskCenterState.dialogueStatus
    : (taskCenterState.liveRun?.dialogueStatus && typeof taskCenterState.liveRun.dialogueStatus === 'object'
      ? taskCenterState.liveRun.dialogueStatus
      : {});
  const currentStatus = String(liveCopilotDirective.currentStatus || taskCenterState.currentStatus || copilotSummary.status || unifiedStatus.status || '').trim();
  const runningTask = String(liveCopilotDirective.taskLabel || taskCenterState.runningTask || unifiedStatus.taskLabel || taskCenterState.latest?.taskLabel || '').trim();
  const progressSummary = String(
    liveCopilotDirective.progressSummary
    || liveCopilotDirective.statusSummary
    || liveCopilotDirective.currentFocus
    || taskCenterState.progressSummary
    || copilotSummary.progressSummary
    || unifiedStatus.progressSummary
    || unifiedStatus.statusSummary
    || unifiedStatus.progress
    || ''
  ).trim();
  const nextSuggestedAction = taskCenterState.nextSuggestedAction && typeof taskCenterState.nextSuggestedAction === 'object'
    ? (liveCopilotDirective.nextAction && typeof liveCopilotDirective.nextAction === 'object'
      ? liveCopilotDirective.nextAction
      : taskCenterState.nextSuggestedAction)
    : (liveCopilotDirective.nextAction && typeof liveCopilotDirective.nextAction === 'object'
      ? liveCopilotDirective.nextAction
      : {
        label: String(copilotSummary.nextActionLabel || '').trim(),
        reason: String(copilotSummary.nextActionSummary || '').trim(),
        ...(unifiedStatus.nextAction && typeof unifiedStatus.nextAction === 'object' ? unifiedStatus.nextAction : {}),
      });
  const primarySay = String(
    liveCopilotDirective.recommendedReply
    || liveCopilotDirective.primarySay
    || copilotSummary.recommendedReply
    ||
    unifiedStatus.recommendedReply
    || unifiedStatus.dialogue?.primarySay
    || dialogueStatus.primarySay
    || taskCenterState.latest?.pageState?.runtimeSummary?.dialogueStatus?.primarySay
    || ''
  ).trim();

  if (!currentStatus && !runningTask && !progressSummary && !primarySay) return '';

  const statusLabelMap = {
    running: '任务进行中',
    planned: '任务待开始',
    paused: '任务已暂停',
    completed: '任务已完成',
  };
  const toneMap = {
    running: 'info',
    planned: 'info',
    paused: 'warn',
    completed: 'good',
    good: 'good',
    info: 'info',
    warn: 'warn',
    bad: 'warn',
  };
  const statusLabel = statusLabelMap[currentStatus] || '当前任务状态';
  const tone = toneMap[currentStatus] || 'info';
  const nextActionLabel = String(liveCopilotDirective.nextActionLabel || nextSuggestedAction.label || copilotSummary.nextActionLabel || '').trim();
  const nextActionReason = String(
    liveCopilotDirective.nextActionSummary
    || nextSuggestedAction.reason
    || copilotSummary.nextActionSummary
    || copilotSummary.confirmationSummary
    || unifiedStatus.nextActionSummary
    || unifiedStatus.focusSummary
    || ''
  ).trim();

  return `
      <section class="task-center-live-strip tone-${escapeHtml(tone)}">
        <div class="task-center-live-main">
          <div class="task-center-live-kicker">${escapeHtml(statusLabel)}</div>
          <div class="task-center-live-title">${escapeHtml(runningTask || '当前任务')}</div>
          ${progressSummary ? `<div class="task-center-live-copy">${escapeHtml(progressSummary)}</div>` : ''}
        </div>
        <div class="task-center-live-side">
          ${nextActionLabel ? `
          <div class="task-center-live-block">
            <div class="task-center-live-label">${escapeHtml(language.liveActionLabel)}</div>
            <div class="task-center-live-value">${escapeHtml(nextActionLabel)}</div>
            ${nextActionReason ? `<div class="task-center-live-copy">${escapeHtml(nextActionReason)}</div>` : ''}
          </div>` : ''}
          ${primarySay ? `
          <div class="task-center-live-block">
            <div class="task-center-live-label">${escapeHtml(language.liveReplyLabel)}</div>
            <div class="task-center-live-value">${escapeHtml(primarySay)}</div>
          </div>` : ''}
        </div>
      </section>
  `;
}

function main() {
  const language = getTaskCenterLanguage();
  const args = parseArgs(process.argv.slice(2));
  if (!args['index-file']) throw new Error('Missing required flag: --index-file');

  const indexFile = path.resolve(args['index-file']);
  const rootDir = path.dirname(indexFile);
  const outputFile = path.resolve(args['output-file'] || path.join(rootDir, 'task_center.html'));
  const taskCenterState = loadTaskCenterState(indexFile, {
    examplesCatalogPath: path.join(__dirname, '..', 'references', 'examples', 'examples_catalog.html'),
    stateFile: args['state-file'] || null,
  });
  const {
    runs,
    latest,
    latestWorkspace,
    examplesCatalogPath,
    stableCount,
    issueCount,
    otherRuns,
    taskCenterWorkbench,
    entryMainlineGuide,
  } = taskCenterState;
  const entryState = buildEntryStatePaths(rootDir, latest)
    .map((filePath) => loadEntryState(filePath))
    .find(Boolean) || null;
  const entryActions = resolveEntryMainlineActions({ hasWorkspace: Boolean(latestWorkspace), latestWorkspace });
  const guideDefaultGenerationProtocol = entryMainlineGuide?.defaultGenerationProtocol && typeof entryMainlineGuide.defaultGenerationProtocol === 'object'
    ? entryMainlineGuide.defaultGenerationProtocol
    : null;
  const entryMainlineProtocol = resolveEntryMainlineProtocol(entryState, {
    currentLayer: '总控层',
    optionalPageMode: guideDefaultGenerationProtocol?.mode || entryMainlineGuide?.optionalPageMode?.mode,
  });
  const defaultGenerationProtocol = guideDefaultGenerationProtocol || entryMainlineProtocol.defaultGenerationProtocol || {};
  const defaultGenerationSummary = defaultGenerationProtocol.summary || entryMainlineProtocol.mainlineContract?.defaultGenerationSummary || '';
  const hiddenHtmlFiles = Array.isArray(defaultGenerationProtocol.hiddenHtmlFiles)
    ? defaultGenerationProtocol.hiddenHtmlFiles
    : [];
  const defaultGenerationGuardrail = defaultGenerationProtocol.guardrail && typeof defaultGenerationProtocol.guardrail === 'object'
    ? defaultGenerationProtocol.guardrail
    : (entryMainlineProtocol.mainlineContract?.defaultGenerationGuardrail || {});
  const defaultGenerationCardSummary = [
    defaultGenerationGuardrail.onDemandRule || defaultGenerationSummary,
    hiddenHtmlFiles.length ? `默认隐藏: ${hiddenHtmlFiles.slice(0, 6).join('、')}${hiddenHtmlFiles.length > 6 ? ' 等' : ''}` : '',
  ].filter(Boolean).join(' ');
  const entryPreview = resolveEntryPreview(entryState);
  const entryNextStep = resolveEntryNextStep(rootDir, entryState, {
    prepareFile: latest ? path.join(latest.outputDir, 'prepare_workspace.html') : path.join(rootDir, 'prepare_workspace.html'),
    homeFile: latestWorkspace,
  });
  const entryContext = resolveEntryContext(entryState, {
    currentTaskCategory: entryState?.taskCategory,
    currentStarterIntent: entryState?.starterIntent,
    entryPreview,
    nextStep: entryNextStep,
    mainlineProtocol: entryMainlineProtocol,
  });
  const entryRoute = resolveEntryRoute(rootDir, entryState, { nextStep: entryNextStep });
  const entryWorkbench = resolveEntryWorkbench(rootDir, entryState, {
    nextStep: entryNextStep,
    entryPreview,
    currentTaskCategory: entryState?.taskCategory,
  });
  const mergedTaskCenterWorkbench = entryState ? {
    title: entryWorkbench.title,
    copy: entryWorkbench.copy,
    cards: [
      ...entryWorkbench.cards,
      ...(taskCenterWorkbench?.cards || []),
    ],
  } : taskCenterWorkbench;
  const mainlineGuideWorkbench = entryMainlineGuide && typeof entryMainlineGuide === 'object'
    ? {
      title: entryMainlineGuide.title || '入口主链提醒',
      copy: entryMainlineGuide.copy || '任务总控只负责开新任务或继续任务，选定后交给工作台首页。',
      maxCards: 3,
      cards: Array.isArray(entryMainlineGuide.items) ? entryMainlineGuide.items : [],
    }
    : null;
  const protocolWorkbench = {
    title: '入口主链协议',
    copy: `${entryMainlineProtocol.mainlineContract?.summary || entryMainlineProtocol.summary} ${entryMainlineProtocol.taskCenterEntryProtocol?.userRule || ''} ${defaultGenerationSummary}`.trim(),
    maxCards: 4,
    cards: [
      { label: '模板展示板', value: entryActions.chooseTemplate.value, summary: entryMainlineProtocol.mainlineContract?.entryRole || entryMainlineProtocol.entryRole, file: examplesCatalogPath, cta: entryActions.startNewTask.cta, tone: 'good' },
      {
        label: '任务总控',
        value: '跨任务入口',
        summary: entryMainlineProtocol.mainlineContract?.taskCenterRole || entryMainlineProtocol.taskCenterEntryProtocol?.summary || entryMainlineProtocol.taskCenterRole,
        hideLinkIfMissing: true,
        tone: 'info',
      },
      latestWorkspace
        ? { label: entryActions.openWorkspaceHome.label, value: entryActions.openWorkspaceHome.value, summary: entryMainlineProtocol.mainlineContract?.workspaceRole || entryMainlineProtocol.workspaceRole, file: latestWorkspace, cta: entryActions.continueTask.cta, tone: 'neutral' }
        : { label: entryActions.openWorkspaceHome.label, value: entryActions.openWorkspaceHome.value, summary: entryMainlineProtocol.mainlineContract?.workspaceRole || entryMainlineProtocol.workspaceRole, pendingLabel: entryActions.openWorkspaceHome.pendingLabel, tone: 'neutral' },
      {
        label: '默认生成策略',
        value: defaultGenerationProtocol.mode || entryMainlineProtocol.mainlineContract?.defaultGenerationMode || 'mainline-only',
        summary: defaultGenerationCardSummary,
        hideLinkIfMissing: true,
        tone: 'neutral',
      },
    ],
  };
  const supportCopy = buildSupportPageCopy('task-center', {
    hasEntryState: Boolean(entryState),
    hasLatest: Boolean(latest),
  });
  const otherCards = otherRuns
    .slice(0, 6)
    .map((item) => renderEntryCard(renderRunCardModel(item, rootDir, {
      kicker: item.bucket === 'priority'
        ? '建议优先处理'
        : (item.bucket === 'active' ? '继续推进' : '可回看任务'),
    })))
    .join('');
  const liveDirective = taskCenterState.liveCopilotDirective && typeof taskCenterState.liveCopilotDirective === 'object'
    ? taskCenterState.liveCopilotDirective
    : (taskCenterState.liveRun?.liveCopilotDirective && typeof taskCenterState.liveRun.liveCopilotDirective === 'object'
      ? taskCenterState.liveRun.liveCopilotDirective
      : {});
  const liveControlBar = buildTaskControlBarFromUnifiedStatus(taskCenterState.unifiedStatus || taskCenterState.liveRun?.unifiedStatus, {
    taskLabel: liveDirective.taskLabel || taskCenterState.runningTask || latest?.taskLabel || '',
    stageLabel: liveDirective.stageLabel || taskCenterState.currentStage || latest?.phaseLabel || '',
    nextActionLabel: liveDirective.nextActionLabel || liveDirective.nextAction?.label || taskCenterState.nextSuggestedAction?.label || taskCenterState.copilotSummary?.nextActionLabel || taskCenterState.liveRun?.copilotSummary?.nextActionLabel || '',
    nextActionSummary: liveDirective.nextActionSummary || liveDirective.nextAction?.reason || taskCenterState.nextSuggestedAction?.reason || taskCenterState.copilotSummary?.nextActionSummary || taskCenterState.liveRun?.copilotSummary?.nextActionSummary || taskCenterState.progressSummary || '',
    primarySay: liveDirective.recommendedReply || liveDirective.primarySay || taskCenterState.dialogueStatus?.primarySay || taskCenterState.copilotSummary?.recommendedReply || taskCenterState.liveRun?.copilotSummary?.recommendedReply || taskCenterState.liveRun?.dialogueStatus?.primarySay || '',
    progressSummary: liveDirective.progressSummary || taskCenterState.progressSummary || taskCenterState.copilotSummary?.progressSummary || taskCenterState.liveRun?.copilotSummary?.progressSummary || '',
    status: taskCenterState.currentStatus || '',
  });
  const liveStatusState = liveControlBar ? {
    ...taskCenterState,
    liveCopilotDirective: liveDirective,
    copilotSummary: {
      ...(taskCenterState.copilotSummary || taskCenterState.liveRun?.copilotSummary || {}),
      stageLabel: taskCenterState.copilotSummary?.stageLabel || taskCenterState.liveRun?.copilotSummary?.stageLabel || liveControlBar.stageLabel,
      status: taskCenterState.currentStatus || taskCenterState.copilotSummary?.status || taskCenterState.liveRun?.copilotSummary?.status || '',
      progressSummary: liveControlBar.progressSummary,
      nextActionLabel: liveControlBar.nextActionLabel,
      nextActionSummary: liveControlBar.nextActionSummary,
      recommendedReply: liveControlBar.primarySay,
    },
    unifiedStatus: {
      ...(taskCenterState.unifiedStatus || taskCenterState.liveRun?.unifiedStatus || {}),
      taskLabel: liveControlBar.taskLabel,
      stage: liveControlBar.stageLabel,
      progress: liveControlBar.progressSummary,
      status: taskCenterState.currentStatus || taskCenterState.unifiedStatus?.status || '',
      nextAction: {
        label: liveControlBar.nextActionLabel,
        reason: liveControlBar.nextActionSummary,
      },
      dialogue: {
        primarySay: liveControlBar.primarySay,
      },
    },
  } : taskCenterState;

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DAOGE 任务总控</title>
${renderPortalHeadAssets()}
  <style>
    :root {
      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --page-glow: rgba(124,197,163,0.16);
      --hero-tint: rgba(124,197,163,0.14);
    }
${renderWorkspaceStyles()}
    .task-center-live-strip {
      margin-top: 12px;
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.85fr);
      gap: 10px;
      padding: 12px 14px;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.08);
      background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.035));
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
    }
    .task-center-live-strip.tone-info {
      box-shadow: inset 0 0 0 1px rgba(136,185,255,0.12);
    }
    .task-center-live-strip.tone-warn {
      box-shadow: inset 0 0 0 1px rgba(226,192,112,0.12);
    }
    .task-center-live-strip.tone-good {
      box-shadow: inset 0 0 0 1px rgba(124,197,163,0.12);
    }
    .task-center-mainline-note {
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: 16px;
      color: var(--text-sub);
      font-size: 11px;
      line-height: 1.5;
      background: rgba(217,179,109,0.07);
      border: 1px solid rgba(217,179,109,0.12);
    }
    .task-center-live-main,
    .task-center-live-side,
    .task-center-live-block {
      display: grid;
      gap: 5px;
    }
    .task-center-live-side {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .task-center-live-kicker,
    .task-center-live-label {
      color: var(--text-sub);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .task-center-live-title,
    .task-center-live-value {
      color: var(--text-main);
      font-size: 14px;
      line-height: 1.35;
      font-weight: 650;
    }
    .task-center-live-copy {
      color: var(--text-sub);
      font-size: 11px;
      line-height: 1.5;
    }
    @media (max-width: 960px) {
      .task-center-live-strip,
      .task-center-live-side {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <div class="top-links">
        ${renderPortalTopLinks(rootDir, {
          currentPage: 'task_center.html',
          maxLinks: 3,
          preferExtraLinks: true,
          extraLinks: [
            { label: '中文模板展示板', file: examplesCatalogPath },
            latestWorkspace ? { label: entryActions.continueTask.label, file: latestWorkspace } : null,
          ],
        })}
      </div>
      <div class="eyebrow">DAOGE 任务总控</div>
      <h1>DAOGE 任务总控</h1>
      <p class="hero-copy">${supportCopy.heroCopy}</p>
      ${renderPortalContextBar({
        runLabel: entryState ? entryContext.runLabel : (latest?.taskLabel || '当前还没有历史任务'),
        phaseLabel: entryState ? `${entryContext.phaseLabel} / 总控层` : '总控层',
        flowLabel: entryState ? `中文模板展示板 -> 任务总控 -> ${entryContext.flowLabel}` : '中文模板展示板 -> 任务总控 -> 工作台首页 -> 准备工作台',
        counts: [
          { label: language.taskCountLabel, value: runs.length },
          { label: language.readyCountLabel, value: stableCount },
          { label: language.issueCountLabel, value: issueCount },
        ],
        hints: entryState
          ? [
            ...entryContext.hints.slice(0, 1),
            supportCopy.liveStripHint,
          ]
          : [
            latest ? (latest.nextActionReason || '先选定这一轮，再进入它自己的工作台主链。') : '当前还没有可继续的历史任务。',
            supportCopy.liveStripHint,
          ],
      })}
      <div class="hero-grid">
        ${renderMetricCard(language.taskCountLabel, runs.length, 'info', '这里只保留最近仍值得继续的任务')}
        ${renderMetricCard(language.readyCountLabel, stableCount, 'good', '这些任务当前没有明显异常压力')}
        ${renderMetricCard(language.issueCountLabel, issueCount, issueCount > 0 ? 'bad' : 'good', issueCount > 0 ? '这些任务建议先打开一眼' : '当前没有卡住主线的问题')}
      </div>
      ${renderLiveStatusStrip(liveStatusState)}
      ${entryMainlineGuide?.principle ? `<div class="task-center-mainline-note">${escapeHtml(entryMainlineGuide.principle)}</div>` : ''}
      ${entryMainlineGuide?.runtimeFocus ? `<div class="task-center-mainline-note">${escapeHtml(entryMainlineGuide.runtimeFocus)} ${entryMainlineGuide?.handoffRule ? escapeHtml(entryMainlineGuide.handoffRule) : ''}</div>` : ''}
      ${entryMainlineGuide?.copilotRelay?.summary ? `<div class="task-center-mainline-note">${escapeHtml(entryMainlineGuide.copilotRelay.summary)}</div>` : ''}
    </section>

    ${mainlineGuideWorkbench ? renderPortalWorkbench(rootDir, mainlineGuideWorkbench) : ''}

    ${renderPortalWorkbench(rootDir, protocolWorkbench)}

    ${renderPortalProgressRail(rootDir, {
      currentPage: 'task_center.html',
      title: '从这里进入任务',
      copy: supportCopy.workbenchCopy,
      visibleIds: ['task-center', 'workspace-home', 'prepare-workspace'],
    })}

    ${renderPortalRouteCompass(rootDir, {
      title: entryState ? entryRoute.title : supportCopy.routeTitle,
      copy: entryState ? entryRoute.copy : supportCopy.routeCopy,
      current: entryState ? entryRoute.current : (latest ? {
        kicker: '当前推荐',
        label: latest.taskLabel,
        summary: latest.nextActionReason || latest.phaseSummary || '这一轮当前最值得继续。',
        file: latestWorkspace,
        cta: entryActions.continueTask.cta,
        pendingLabel: entryActions.continueTask.pendingLabel,
      } : {
        kicker: '当前推荐',
        label: '先开始一轮新任务',
        summary: entryActions.startNewTask.summary,
        file: examplesCatalogPath,
        cta: entryActions.startNewTask.cta,
        pendingLabel: entryActions.startNewTask.pendingLabel,
      }),
      nextSteps: [
        entryState ? entryRoute.next : null,
        latest ? {
          kicker: '下一步',
          label: latest.nextActionLabel || '进入工作台首页',
          summary: latest.nextActionReason || '先进入这一轮任务的工作台首页，再顺着主链继续。',
          file: latestWorkspace,
          cta: entryActions.continueTask.routeCta,
          pendingLabel: entryActions.continueTask.pendingLabel,
        } : {
          kicker: '下一步',
          label: entryActions.startNewTask.value,
          summary: entryActions.startNewTask.summary,
          file: examplesCatalogPath,
          cta: entryActions.startNewTask.cta,
          pendingLabel: entryActions.startNewTask.pendingLabel,
        },
      ].filter(Boolean),
    })}

    ${mergedTaskCenterWorkbench ? renderPortalWorkbench(rootDir, mergedTaskCenterWorkbench) : ''}

    ${otherCards ? `
    <details class="section portal-audience-pro">
      <summary>${supportCopy.otherRunsSummaryLabel || supportCopy.otherRunsTitle}</summary>
      <p class="section-copy">${supportCopy.otherRunsCopy}</p>
      <div class="entry-grid">
        ${otherCards}
      </div>
    </details>` : ''}
  </div>
</body>
</html>`;

  fs.writeFileSync(outputFile, html);
  console.log(JSON.stringify({ outputFile, totalRuns: runs.length }, null, 2));
}

main();
