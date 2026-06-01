const fs = require('fs');
const path = require('path');
const { parseArgs, readJson, fileExists } = require('./script_utils');
const { renderWorkspaceChromeHeadAssets } = require('./workspace_chrome_ui');
const {
  relativeFile,
  readJsonIfExists,
  renderMetricCard,
  renderKeyValueGrid,
  renderWorkspaceStyles,
  summarizeUserWorkbenchProtocol,
  buildSupportPageCopy,
} = require('./workspace_page_shared');
const {
  renderWorkspaceChromeTopLinks,
  renderWorkspaceChromeContextBar,
  renderWorkspaceChromeProgressRail,
  renderWorkspaceChromeRouteCompass,
  renderWorkspaceChromeWorkbench,
} = require('./workspace_chrome');
const { deriveTaskLabel } = require('./task_label_utils');
const { loadWorkbenchState } = require('./workbench_state_shared');
const {
  resolveWorkspaceRouteFile,
} = require('./workspace_storyboard_shared');

function formatTime(value) {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatDuration(start, end) {
  if (!start || !end) return '未记录';
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime < startTime) return '未记录';
  const seconds = Math.round((endTime - startTime) / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes < 60) return remainSeconds ? `${minutes} 分 ${remainSeconds} 秒` : `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes ? `${hours} 小时 ${remainMinutes} 分钟` : `${hours} 小时`;
}

function formatBatchRange(batch) {
  const first = Number(batch.firstIndex || 0);
  const last = Number(batch.lastIndex || 0);
  if (first && last) return `${first} - ${last}`;
  return '未记录';
}

function describeStatus(manifest, jobState, failedCount, reviewCount) {
  if (manifest?.paused || jobState?.status === 'paused') {
    return {
      label: '本轮已暂停',
      tone: 'warn',
      detail: manifest?.pauseReason || jobState?.pauseReason || '需要人工确认后再继续',
    };
  }
  if (failedCount > 0) {
    return {
      label: '本轮有异常需要处理',
      tone: 'bad',
      detail: `当前有 ${failedCount} 个失败项，建议先去异常工作台集中处理。`,
    };
  }
  if (reviewCount > 0) {
    return {
      label: '本轮基本稳定，仍有少量待复核',
      tone: 'warn',
      detail: `当前有 ${reviewCount} 个结果建议再看一眼。`,
    };
  }
  if (jobState?.status === 'completed' || manifest) {
    return {
      label: '本轮已经顺利完成',
      tone: 'good',
      detail: '可以直接回结果工作台筛图，或者进入下一轮任务。',
    };
  }
  return {
    label: '当前仍在准备阶段',
    tone: 'info',
    detail: '运行尚未开始，这里暂时不会出现完整执行记录。',
  };
}

function summarizeBatches(batchPlan, manifest, jobState) {
  return batchPlan.map((batch) => {
    const manifestBatch = (manifest?.batches || []).find((item) => Number(item.batchNumber) === Number(batch.batchNumber));
    const status = manifestBatch
      ? ((manifestBatch.failed || 0) > 0 ? '出现异常' : '完成')
      : (jobState?.completedBatchNumbers || []).includes(batch.batchNumber)
        ? '完成'
        : '待执行';
    const summary = manifestBatch
      ? `成功 ${manifestBatch.success || 0}，失败 ${manifestBatch.failed || 0}`
      : `覆盖第 ${formatBatchRange(batch)} 项`;
    return {
      label: `第 ${batch.batchNumber} 批`,
      value: status,
      summary,
      tone: status === '出现异常' ? 'bad' : (status === '完成' ? 'good' : 'neutral'),
    };
  });
}

function buildRecommendation(status, hasException, hasResult, hasHome) {
  if (status.label === '本轮已暂停' || status.tone === 'bad') {
    return hasException
      ? '建议先打开异常工作台，把失败项或暂停原因收口后，再决定是否继续。'
      : '当前建议先检查异常原因，再决定是否继续。';
  }
  if (status.tone === 'warn') {
    return hasResult
      ? '建议先回结果工作台看待复核项，再决定是否继续扩图。'
      : '建议先人工复看关键结果。';
  }
  if (hasResult) return '建议直接回结果工作台继续筛图或收口。';
  if (hasHome) return '建议回工作台首页继续主链。';
  return '当前记录已经完整，可按你的任务目标继续下一步。';
}

function inferTimelineWindow(events, manifest, jobState) {
  const timelineEvents = Array.isArray(events) ? events : [];
  const eventTimes = timelineEvents
    .map((event) => event?.time)
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const start = eventTimes[0]?.toISOString() || jobState?.createdAt || manifest.generatedAt || null;
  const end = eventTimes[eventTimes.length - 1]?.toISOString() || jobState?.updatedAt || manifest.generatedAt || null;
  return { start, end };
}

function renderTimelineCards(events) {
  const timelineEvents = Array.isArray(events) ? events.filter(Boolean) : [];
  if (!timelineEvents.length) return '<div class="empty-state">当前还没有可展示的阶段时间线。</div>';
  return timelineEvents.map((event, index) => `
    <article class="entry-card tone-${event.type === 'paused' ? 'warn' : (String(event.type || '').includes('completed') ? 'good' : 'info')}">
      <div class="entry-kicker">阶段 ${index + 1}</div>
      <h3 class="entry-title">${event.title || '未命名事件'}</h3>
      <p class="entry-copy">${event.summary || '无附加说明'}${event.time ? ` · ${formatTime(event.time)}` : ''}</p>
    </article>
  `).join('');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['manifest-file']) throw new Error('Missing required flag: --manifest-file');

  const manifestPath = path.resolve(args['manifest-file']);
  const manifest = readJson(manifestPath);
  const outputDir = path.resolve(manifest.outputDir || path.dirname(manifestPath));
  const markdownPath = path.resolve(args['markdown-file'] || path.join(outputDir, 'run_record.md'));
  const htmlPath = path.resolve(args['html-file'] || path.join(outputDir, 'run_record.html'));

  const stagePlan = readJsonIfExists(path.join(outputDir, 'stage_plan.json')) || { stages: [] };
  const batchPlan = readJsonIfExists(path.join(outputDir, 'batch_plan.json')) || [];
  const jobState = readJsonIfExists(path.join(outputDir, 'job_state.json')) || null;
  const failedItems = readJsonIfExists(path.join(outputDir, 'failed.json')) || [];
  const reviewItems = readJsonIfExists(path.join(outputDir, 'needs_review.json')) || [];
  const workbenchState = loadWorkbenchState(outputDir);
  const pageState = workbenchState.pageState || workbenchState.workspaceState || {};
  const governance = pageState?.governanceByPage?.['run_record.html'] || pageState?.governance || null;
  const workspaceTimeline = workbenchState.workspaceTimeline || {};
  const directoryProtocol = pageState?.assetLayers?.directoryProtocol || workbenchState.workspaceAssets?.layers?.directoryProtocol || {};
  const directorySurfaces = directoryProtocol?.surfaces || {};
  const specialWorkflowProtocol = pageState?.specialWorkflowProtocol && typeof pageState.specialWorkflowProtocol === 'object'
    ? pageState.specialWorkflowProtocol
    : {};
  const workbenchProtocol = {
    ...summarizeUserWorkbenchProtocol(pageState?.assetLayers?.userWorkbenchProtocol, { outputDir }),
    summary: String(pageState?.assetLayers?.userWorkbenchProtocol?.summary || '').trim()
      || String(directoryProtocol?.summary || '').trim()
      || summarizeUserWorkbenchProtocol(pageState?.assetLayers?.userWorkbenchProtocol, { outputDir }).summary,
  };
  const workspaceHomePath = resolveWorkspaceRouteFile(outputDir, pageState, 'home', path.join(outputDir, 'workspace_home.html'));
  const resultWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'result', path.join(outputDir, 'result_workspace.html'));
  const exceptionWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'exception', path.join(outputDir, 'exception_workspace.html'));

  const failedCount = Number(pageState?.counts?.failed || manifest.failed || failedItems.length || 0);
  const reviewCount = Number(pageState?.counts?.needsReview || reviewItems.length || 0);
  const batchCount = Number(pageState?.counts?.batches || manifest.batchCount || batchPlan.length || 0);
  const stageCount = Number(pageState?.counts?.stages || manifest.stageCount || stagePlan.stageCount || stagePlan.stages?.length || 0);
  const selectedCount = Number(pageState?.counts?.selected || manifest.selectedCount || manifest.promptCount || 0);
  const taskLabel = deriveTaskLabel({
    taskLabel: String(pageState?.taskLabel || '').trim(),
    selectedCount,
    sampleSize: Number(manifest?.sampleSize || 0),
    pauseReason: manifest?.pauseReason || '',
    resumeManifest: manifest?.resumeManifest || null,
  }, outputDir);
  const fallbackStatus = describeStatus(manifest, jobState, failedCount, reviewCount);
  const status = {
    label: String(pageState?.status?.headline || '').trim() || fallbackStatus.label,
    tone: String(pageState?.status?.tone || '').trim() || fallbackStatus.tone,
    detail: String(pageState?.status?.summary || '').trim() || fallbackStatus.detail,
  };
  const currentPhaseLabel = String(pageState?.status?.phase || '').trim() || '任务档案';
  const hasHome = fileExists(workspaceHomePath);
  const hasResult = fileExists(resultWorkspacePath);
  const hasException = fileExists(exceptionWorkspacePath);
  const recommendation = String(pageState?.nextAction?.reason || '').trim()
    || buildRecommendation(status, hasException, hasResult, hasHome);
  const timelineEvents = Array.isArray(workspaceTimeline?.events) ? workspaceTimeline.events : [];
  const timelineWindow = inferTimelineWindow(timelineEvents, manifest, jobState);
  const batchCards = summarizeBatches(batchPlan, manifest, jobState);
  const recommendedEntry = hasException && (failedCount > 0 || status.tone === 'bad' || status.label === '本轮已暂停')
    ? {
        label: '异常工作台',
        summary: recommendation,
        file: exceptionWorkspacePath,
        cta: '进入异常工作台',
        tone: 'bad',
      }
    : (hasResult
      ? {
          label: '结果工作台',
          summary: recommendation,
          file: resultWorkspacePath,
          cta: '回结果工作台',
          tone: 'good',
        }
      : (hasHome
        ? {
            label: '工作台首页',
            summary: recommendation,
            file: workspaceHomePath,
            cta: '回工作台首页',
            tone: 'info',
          }
        : null));
  const workbenchCards = [
    recommendedEntry ? { label: recommendedEntry.label, value: '推荐入口', summary: recommendedEntry.summary, file: recommendedEntry.file, cta: recommendedEntry.cta, tone: recommendedEntry.tone } : null,
    hasHome ? { label: '工作台首页', value: '回主链', summary: '重新看当前阶段、主链位置和下一步推荐。', file: workspaceHomePath, cta: '回工作台首页', tone: 'info' } : null,
  ].filter(Boolean);
  const keyFacts = [
    { label: '任务规模', value: `${selectedCount} 张 / ${batchCount} 批 / ${stageCount} 段` },
    { label: '默认尺寸', value: manifest.defaultSize || '未记录' },
    { label: '时间感知', value: formatDuration(timelineWindow.start, timelineWindow.end) },
    { label: '当前状态', value: status.label },
  ];

  const directoryFacts = [
    { label: '默认先看', value: workbenchProtocol.defaultVisibleLabels.join(' -> '), summary: workbenchProtocol.taskCenterCopy, tone: 'good' },
    { label: '主状态源', value: path.basename(workbenchProtocol.primaryRuntimeSource || 'workspace_live_state.json'), summary: workbenchProtocol.runtimeRule, tone: 'info' },
    { label: '统一状态模型', value: path.basename(workbenchProtocol.canonicalState || 'workspace_state.json'), summary: '负责把页面真正需要的任务判断统一收成一套稳定状态模型。', tone: 'good' },
    { label: '运行状态源', value: path.basename(workbenchProtocol.runtimeState || 'runtime_state.json'), summary: '只负责运行中的批次进度、暂停状态和下一步运行提示。', tone: 'neutral' },
    { label: '派生快照', value: path.basename(workbenchProtocol.derivedWorkbenchSnapshot || 'workbench_state.json'), summary: '内部派生状态文件，不属于普通用户默认阅读层。', tone: 'neutral' },
    { label: '文件落盘层', value: `${Number(directorySurfaces?.filesystem?.count || 0)} 个文件`, summary: '只服务本地目录入口，不再算工作台补充层。', tone: 'neutral' },
    { label: '已后退文件', value: `${Number(directorySurfaces?.archive?.count || 0) + Number(directorySurfaces?.internal?.count || 0)} 个文件`, summary: '归档层和内部状态层默认都不占阅读注意力。', tone: 'warn' },
  ];
  const specialWorkflowFacts = [
    specialWorkflowProtocol?.hostNative?.officialMainline ? {
      label: 'host-native',
      value: specialWorkflowProtocol.hostNative.active ? '当前启用' : '正式模式，本轮未启用',
      summary: specialWorkflowProtocol.hostNative.active
        ? (specialWorkflowProtocol.hostNative.defaultMainlineBehavior || specialWorkflowProtocol.hostNative.responsibility)
        : '宿主原生图像工具是正式运行模式之一，但不会伪造成本地 runner 记录。',
      tone: specialWorkflowProtocol.hostNative.active ? 'good' : 'neutral',
    } : null,
    specialWorkflowProtocol?.storyboard?.officialSubsystem ? {
      label: 'storyboard',
      value: specialWorkflowProtocol.storyboard.active ? '当前启用' : '按需启用',
      summary: specialWorkflowProtocol.storyboard.active
        ? `保留 ${specialWorkflowProtocol.storyboard.structureContract?.contentSlots || '分镜'} 个 content slot / layout / reference / mask / continuity / camera_move 语义。`
        : specialWorkflowProtocol.storyboard.defaultMainlineBehavior,
      tone: specialWorkflowProtocol.storyboard.active ? 'info' : 'neutral',
    } : null,
    specialWorkflowProtocol?.localEditRerun?.officialProfessionalPath ? {
      label: 'local-edit / rerun',
      value: specialWorkflowProtocol.localEditRerun.active ? '当前需要关注' : '异常时再启用',
      summary: specialWorkflowProtocol.localEditRerun.active
        ? (specialWorkflowProtocol.localEditRerun.defaultMainlineBehavior || specialWorkflowProtocol.localEditRerun.responsibility)
        : '局部修订和补跑是异常页与分镜局部修订的专业路径，不进入普通用户第一主链。',
      tone: specialWorkflowProtocol.localEditRerun.active ? 'warn' : 'neutral',
    } : null,
  ].filter(Boolean);
  const supportCopy = buildSupportPageCopy('record', {
    defaultEntryLabel: workbenchProtocol.defaultEntryLabel,
    supportEntryLabel: workbenchProtocol.supportEntryLabel,
    protocolSummary: workbenchProtocol.summary,
  });

  const markdownLines = [
    '# DAOGE 任务档案',
    '',
    `${supportCopy.archiveLead} 入口看 README，最终收口看完成报告。`,
    '',
    '## 1. 一句话结论',
    '',
    `- 当前状态: ${status.label}`,
    `- 当前建议: ${recommendation}`,
    `- 成功结果: ${manifest.success || 0}`,
    `- 失败结果: ${failedCount}`,
    `- 待复核结果: ${reviewCount}`,
    '',
    '## 2. 任务概况',
    '',
    `- 本轮总量: ${selectedCount} 张`,
    `- 批次数量: ${batchCount} 批`,
    `- 阶段数量: ${stageCount} 段`,
    `- 默认尺寸: ${manifest.defaultSize || '未记录'}`,
    '',
    '## 3. 时间记录',
    '',
    `- 开始时间: ${formatTime(timelineWindow.start)}`,
    `- 完成时间: ${formatTime(timelineWindow.end)}`,
    `- 大致耗时: ${formatDuration(timelineWindow.start, timelineWindow.end)}`,
    '',
    '## 4. 阶段时间线',
    '',
    ...(timelineEvents.length
      ? timelineEvents.map((event, index) => `- 阶段 ${index + 1}: ${event.title || '未命名事件'}，${event.summary || '无附加说明'}${event.time ? `（${formatTime(event.time)}）` : ''}`)
      : ['- 当前没有可展示的阶段时间线']),
    '',
    '## 5. 分批记录',
    '',
    ...(batchCards.length
      ? batchCards.map((item) => `- ${item.label}: ${item.value}，${item.summary}`)
      : ['- 当前没有可展示的分批记录']),
    '',
    '## 6. 下一步入口',
    '',
    ...(hasHome ? [`- 工作台首页: ${workspaceHomePath}`] : []),
    ...(hasResult ? [`- 结果工作台: ${resultWorkspacePath}`] : []),
    ...(hasException ? [`- 异常工作台: ${exceptionWorkspacePath}`] : []),
    '- 高级补充页: 已后退到 prepare-details / result-details / all 模式，需要深看时从对应工作台按需进入',
    '',
    `## 7. ${supportCopy.archiveBoundaryTitle}`,
    '',
    '- 不负责总入口说明：想知道先从哪里进入，回 README 或工作台首页',
    '- 不负责最终收口结论：想知道这轮是否已经可以正式收尾，去看完成报告',
    '',
    '## 8. 输出目录规则',
    '',
    `- 目录原则: ${workbenchProtocol.summary}`,
    `- 默认先看: ${workbenchProtocol.defaultVisibleLabels.join(' -> ')}`,
    `- 任务档案定位: ${workbenchProtocol.supportEntryLabel}，只作为按需补充入口`,
    `- 主状态源: ${workbenchProtocol.primaryRuntimeSource}`,
    `- 派生快照: ${workbenchProtocol.derivedWorkbenchSnapshot}`,
    '',
    '## 9. 特殊工作流定位',
    '',
    ...(specialWorkflowFacts.length
      ? [
        `- 定位原则: ${specialWorkflowProtocol.positioning || '特殊工作流是正式能力，但不会回到普通用户第一主链。'}`,
        ...specialWorkflowFacts.map((item) => `- ${item.label}: ${item.value}，${item.summary}`),
      ]
      : ['- 当前没有特殊工作流定位信息。']),
    '',
    '## 10. 维护者诊断位置',
    '',
    '- 下面文件只服务维护者诊断、续跑和程序读取，普通用户不用打开。',
    `- manifest: ${manifestPath}`,
    `- job_state: ${path.join(outputDir, 'job_state.json')}`,
  ];

  fs.writeFileSync(markdownPath, `${markdownLines.join('\n')}\n`);

  const contextBar = renderWorkspaceChromeContextBar({
    runLabel: taskLabel,
    phaseLabel: currentPhaseLabel,
    flowLabel: '工作台首页 -> 结果工作台 -> 任务档案',
    counts: [
      { label: '总量', value: selectedCount },
      { label: '成功', value: manifest.success || 0 },
      { label: '失败', value: failedCount },
      { label: '待复核', value: reviewCount },
    ],
    hints: [
      '这一页不是新看板，而是把内部运行记录翻译成人话档案。',
      recommendation,
    ],
  });

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DAOGE 任务档案</title>
${renderWorkspaceChromeHeadAssets()}
  <style>
    :root {
      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --page-glow: rgba(110,164,217,0.16);
      --hero-tint: rgba(110,164,217,0.14);
    }
${renderWorkspaceStyles()}
  </style>
</head>
<body data-workspace-chrome-page="run_record.html">
  <div class="shell">
    <section class="hero">
      <div class="top-links">
        ${renderWorkspaceChromeTopLinks(outputDir, {
          currentPage: 'run_record.html',
          governance,
          maxLinks: 3,
          extraLinks: [
            hasHome ? { label: '工作台首页', file: workspaceHomePath } : null,
            hasResult ? { label: '结果工作台', file: resultWorkspacePath } : null,
            hasException ? { label: '异常工作台', file: exceptionWorkspacePath } : null,
          ].filter(Boolean),
        })}
      </div>
      <div class="eyebrow">DAOGE Run Record</div>
      <h1>DAOGE 任务档案</h1>
      <p class="hero-copy">${supportCopy.heroCopy}</p>
      ${contextBar}
      <div class="hero-grid">
        ${renderMetricCard('当前状态', status.label, status.tone, status.detail)}
        ${renderMetricCard('任务规模', `${selectedCount} 张 / ${batchCount} 批`, 'info', `共分 ${stageCount} 段`)}
        ${renderMetricCard('结果稳定度', failedCount > 0 ? '需要处理异常' : (reviewCount > 0 ? '建议再复核' : '当前较稳定'), failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good'), recommendation)}
        ${renderMetricCard('时间感知', formatDuration(timelineWindow.start, timelineWindow.end), 'warn', `${formatTime(timelineWindow.start)} - ${formatTime(timelineWindow.end)}`)}
      </div>
    </section>

    ${renderWorkspaceChromeProgressRail(outputDir, {
      currentPage: 'run_record.html',
      title: '工作台主链',
      copy: supportCopy.workbenchCopy,
      governance,
    })}

    ${renderWorkspaceChromeRouteCompass(outputDir, {
      title: supportCopy.routeTitle,
      copy: supportCopy.routeCopy,
      previous: hasResult ? {
        label: '结果工作台',
        summary: '回到统一结果页，继续筛图、收口和下一步判断。',
        file: resultWorkspacePath,
        cta: '回结果工作台',
      } : null,
      nextSteps: [
        recommendedEntry
          ? {
              kicker: '推荐入口',
              label: recommendedEntry.label,
              summary: recommendedEntry.summary,
              file: recommendedEntry.file,
              cta: recommendedEntry.cta,
            }
          : null,
        hasHome
          ? {
              kicker: '总控入口',
              label: '工作台首页',
              summary: '重新看当前阶段、主链位置和下一步推荐。',
              file: workspaceHomePath,
              cta: '回工作台首页',
            }
          : null,
      ],
    })}

    ${renderWorkspaceChromeWorkbench(outputDir, {
      title: '可进入的页面',
      copy: supportCopy.workbenchCopy,
      cards: workbenchCards,
    })}

    <section class="section">
      <h2>${supportCopy.protocolTitle}</h2>
      <p class="section-copy">${supportCopy.protocolCopy}</p>
      <details class="advanced-panel">
        <summary>${supportCopy.protocolSummaryLabel || supportCopy.protocolTitle}</summary>
        <div class="metric-grid">
          ${directoryFacts.map((item) => renderMetricCard(item.label, item.value, item.tone, item.summary)).join('')}
        </div>
      </details>
    </section>

    <section class="section">
      <h2>${supportCopy.archiveBoundaryTitle}</h2>
      <p class="section-copy">${supportCopy.archiveBoundaryCopy}</p>
      ${renderKeyValueGrid(supportCopy.archiveBoundaryItems)}
    </section>

    <section class="section">
      <h2>${supportCopy.archiveSummaryTitle}</h2>
      <p class="section-copy">${supportCopy.archiveSummaryCopy}</p>
      ${renderKeyValueGrid([
        { label: '当前状态', value: status.label },
        { label: '任务规模', value: `${selectedCount} 张 / ${batchCount} 批 / ${stageCount} 段` },
        { label: '结果概况', value: `${manifest.success || 0} 成功 / ${failedCount} 失败 / ${reviewCount} 待复核` },
        { label: '推荐下一步', value: recommendedEntry?.label || `回${workbenchProtocol.defaultEntryLabel}继续主链` },
      ])}
    </section>

    ${specialWorkflowFacts.length ? `
    <section class="section">
      <h2>特殊工作流定位</h2>
      <p class="section-copy">${specialWorkflowProtocol.positioning || '特殊工作流是正式能力，但不会回到普通用户第一主链。'}</p>
      <div class="metric-grid">
        ${specialWorkflowFacts.map((item) => renderMetricCard(item.label, item.value, item.tone, item.summary)).join('')}
      </div>
    </section>` : ''}

    <section class="section">
      <h2>任务概况</h2>
      <p class="section-copy">这里先收最重要的信息；普通用户不用翻内部记录，也能知道这轮任务的规模、状态和时间记录。</p>
      ${renderKeyValueGrid(keyFacts)}
    </section>

    <section class="section">
      <h2>维护者诊断位置</h2>
      <p class="section-copy">manifest 和 job_state 只服务维护者诊断、续跑和程序读取，普通用户不用打开。</p>
      ${renderKeyValueGrid([
        { label: 'manifest', value: manifestPath },
        { label: 'job_state', value: path.join(outputDir, 'job_state.json') },
      ])}
    </section>

    <section class="section">
      <h2>阶段时间线</h2>
      <p class="section-copy">这里用最少的信息告诉你这轮任务走到了哪几个阶段，不再让用户直接面对底层状态文件。</p>
      <div class="entry-grid">
        ${renderTimelineCards(timelineEvents)}
      </div>
    </section>

    <section class="section">
      <h2>分批记录</h2>
      <p class="section-copy">如果你想知道这轮任务是怎么被拆开的，这里只保留对人有意义的批次摘要，不展示多余内部字段。</p>
      <div class="entry-grid">
        ${batchCards.length
          ? batchCards.map((item) => `
              <article class="entry-card tone-${item.tone}">
                <div class="entry-kicker">${item.label}</div>
                <h3 class="entry-title">${item.value}</h3>
                <p class="entry-copy">${item.summary}</p>
              </article>
            `).join('')
          : '<div class="empty-state">当前没有可展示的分批记录。</div>'}
      </div>
    </section>
  </div>
</body>
</html>`;

  fs.writeFileSync(htmlPath, html);
  console.log(JSON.stringify({ markdownPath, htmlPath }, null, 2));
}

main();
