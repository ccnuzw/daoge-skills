const fs = require('fs');
const path = require('path');
const { getWorkbenchDisplayGovernance } = require('./workbench_governance');
const { getWorkspaceDenseCopy, getWorkspaceContextDenseCopy } = require('./workspace_dense_copy');
const { buildRuntimeConversationCopy, getStagePrimaryActionLabel } = require('./workspace_status_dictionary');
const { buildTaskCenterEntryProtocol } = require('./entry_state_shared');

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

function readJsonIfExists(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) return null;
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.bindings)) return value.bindings;
  return [];
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function mergeUniqueStrings(...groups) {
  const seen = new Set();
  return groups.flatMap((group) => toArray(group))
    .map((item) => String(item || '').trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function sumObjectValues(record) {
  return Object.values(record || {}).reduce((total, value) => total + Number(value || 0), 0);
}

function renderList(items, emptyText = '暂无') {
  const list = toArray(items).filter(Boolean);
  if (!list.length) return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  return `<ul class="info-list">${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderDialogueSayList(items, emptyText = '当前可以直接按主动作继续') {
  const list = toArray(items).filter(Boolean);
  if (!list.length) return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  return `
    <div class="dialogue-say-stack">
      ${list.map((item) => `<div class="dialogue-say-item">${escapeHtml(item)}</div>`).join('')}
    </div>
  `;
}

function renderMetricCard(label, value, tone = 'neutral', detail = '', options = {}) {
  const audience = String(options.audience || 'all').trim() || 'all';
  return `
    <article class="metric-card tone-${escapeHtml(tone)} portal-audience-${escapeHtml(audience)}">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
      ${detail ? `<div class="metric-detail">${escapeHtml(detail)}</div>` : ''}
    </article>
  `;
}

function renderEntryCard(options = {}) {
  const title = String(options.title || '').trim() || '主链接力';
  if (!title) return '';
  const href = options.href ? String(options.href) : null;
  const hideLinkIfMissing = Boolean(options.hideLinkIfMissing);
  return `
    <article class="entry-card tone-${escapeHtml(options.tone || 'neutral')}">
      ${options.kicker ? `<div class="entry-kicker">${escapeHtml(options.kicker)}</div>` : ''}
      <h3 class="entry-title">${escapeHtml(title)}</h3>
      ${options.copy ? `<p class="entry-copy">${escapeHtml(options.copy)}</p>` : ''}
      ${hideLinkIfMissing && !href ? '' : `
      <div class="entry-link">
        ${href ? `<a href="${escapeHtml(href)}">${escapeHtml(options.cta || '打开')}</a>` : `<span>${escapeHtml(options.pendingLabel || '本轮尚未生成')}</span>`}
      </div>`}
    </article>
  `;
}

function renderKeyValueGrid(items) {
  const rows = toArray(items).filter((item) => item && item.label);
  if (!rows.length) return '';
  return `
    <div class="kv-grid">
      ${rows.map((item) => `
        <article class="kv-card">
          <div class="kv-label">${escapeHtml(item.label)}</div>
          <div class="kv-value">${escapeHtml(item.value ?? '未提供')}</div>
        </article>
      `).join('')}
    </div>
  `;
}

function getWorkspaceStageChrome(stage) {
  const key = String(stage || '').trim();
  const shared = {
    progressTitle: '当前任务主链',
    routeTitle: '先做这一步',
    workbenchTitle: '按需再看',
    decisionTitle: '当前判断',
  };

  const stageMap = {
    home: {
      routeTitle: '先做这一步',
      workbenchTitle: '按需再看',
      progressCopy: '这里是当前任务唯一默认先看页，你现在只需要知道自己走到哪一站，以及现在先去哪里。',
      routeCopy: '先按这一轮当前唯一值得先做的一步继续，不要在首页自己分支判断。',
      workbenchCopy: '主动作已经在前面给出；这里只保留一个真正按需入口。',
      decisionCopy: '这一块只解释为什么首页会给出这样的主判断，不再重复首屏已经给出的结论和动作。',
      summaryTitle: '任务摘要',
      summaryCopy: '这里保留任务层面的补充信息，方便你在首页继续看整体判断。',
    },
    prepare: {
      routeTitle: '先做这一步',
      workbenchTitle: '按需再看',
      progressCopy: '准备层属于这条主链的第二站，确认方向后就进入结果工作台。',
      routeCopy: '先按准备层当前最值得做的一步继续，不需要再自己判断该打开哪一张旧准备页。',
      workbenchCopy: '主动作已经在前面给出，这里只保留少量按需入口。',
      decisionCopy: '这一块只解释为什么当前能放行、不能放行，或为什么还要再收一轮，不再重复首屏动作。',
      summaryTitle: '准备摘要',
      summaryCopy: '这里保留准备层的任务信息，不再把程序字段和内部产物名直接堆给人看。',
    },
    result: {
      routeTitle: '先做这一步',
      workbenchTitle: '按需再看',
      progressCopy: '结果层仍然属于同一条主链，只是当前已经走到看图和取舍这一站。',
      routeCopy: '先按结果层当前最值得做的一步继续，不要在多个结果相关页面之间自己来回判断。',
      workbenchCopy: '主动作已经在前面给出，这里只保留少量按需入口。',
      decisionCopy: '这一块只解释为什么当前该保留、复核，还是先去处理异常，不再重复首屏结论。',
      summaryTitle: '结果摘要',
      summaryCopy: '这里保留结果层的补充信息，方便你继续看全局分布和风险概况。',
    },
    exception: {
      progressCopy: '异常页是主链里的按需页面，只在需要处理问题时进入。',
      routeCopy: '先按异常层当前最值得做的一步继续，不把按需页面变成第二个主控页。',
      workbenchCopy: '主动作已经在前面给出，这里只保留一个按需入口。',
      decisionCopy: '这一块只解释为什么这些问题会影响主链，以及为什么当前先处理这一类问题。',
      summaryTitle: '异常摘要',
      summaryCopy: '这里保留异常层的补充判断，避免把程序字段直接讲给人看。',
    },
  };

  return {
    ...shared,
    ...(stageMap[key] || stageMap.home),
  };
}

function getWorkflowCopilotLanguage(stage) {
  const key = String(stage || '').trim() || 'home';
  const shared = {
    deckTitle: '会话副驾驶',
    cockpitTitle: '驾驶舱摘要',
    judgmentTitle: '主控判断',
    confirmationTitle: '继续前确认',
    stageRelayTitle: '主链接力',
  };
  const stageMap = {
    home: {
      deckCopy: '这里先把首页当前任务、主动作、判断和流程信号收成一套统一入口。',
      cockpitCopy: '这里只解释首页当前局面、当前重点和阻塞情况，不重复上方动作建议。',
      judgmentCopy: '这里只解释首页为什么这么判断，以及继续前最值得留意什么。',
      confirmationCopy: '这里只看首页现在能不能继续，以及继续前还差哪一个确认点。',
      dialogueActionReason: '当前建议先按主链继续，不需要再自己判断要切去哪一页。',
      pagePurpose: '先在首页确认阶段位置、主链路线和是否需要转去异常处理。',
    },
    prepare: {
      deckCopy: '这里先把准备阶段当前任务、放行判断、主动作和流程信号收成一套统一入口。',
      cockpitCopy: '这里只解释准备层当前结论、当前重点和阻塞情况，不重复上方动作建议。',
      judgmentCopy: '这里只解释准备层为什么能放行、不能放行，或为什么还要再收一轮。',
      confirmationCopy: '这里只看这一站现在能不能继续，以及继续前还差哪一个确认点。',
      dialogueActionReason: '当前建议先完成准备层最后确认，再顺着主链进入结果工作台。',
      pagePurpose: '把方向、放行和素材约束收在同一页里做执行前判断。',
    },
    result: {
      deckCopy: '这里先把结果阶段当前任务、主动作、筛图判断和流程信号收成一套统一入口。',
      cockpitCopy: '这里只解释结果层当前结论、当前重点和阻塞情况，不重复上方动作建议。',
      judgmentCopy: '这里只解释结果层为什么先收异常、先筛图，或为什么已经可以继续收口。',
      confirmationCopy: '这里只看结果阶段现在能不能继续，以及继续前还差哪一个确认点。',
      dialogueActionReason: '当前建议先按推荐动作继续收口，不需要在结果页里自己判断下一跳。',
      pagePurpose: '把筛图、收口、异常分流和整板复看收成同一层结果判断。',
    },
    exception: {
      deckCopy: '这里先把异常阶段当前任务、主动作、问题判断和流程信号收成一套统一入口。',
      cockpitCopy: '这里只解释异常层当前结论、当前重点和阻塞情况，不重复上方动作建议。',
      judgmentCopy: '这里只解释异常层为什么要先处理这类问题，以及处理完后为什么能回工作台。',
      confirmationCopy: '这里只看异常阶段现在能不能继续，以及继续前还差哪一个确认点。',
      dialogueActionReason: '当前建议先把异常相关问题收掉，再考虑回到工作台继续。',
      pagePurpose: '把失败项、待复核项和补跑候选收成一页，处理完再顺着工作台主链回去。',
    },
  };
  return {
    ...shared,
    ...(stageMap[key] || stageMap.home),
  };
}

function getWorkspaceStagePhrases(stage) {
  const key = String(stage || '').trim() || 'home';
  const stageMap = {
    home: {
      actionReason: '当前直接按推荐动作继续即可。',
      dialogueActionReason: '当前建议先按主链继续，不需要再自己判断要切去哪一页。',
      progressLabel: '当前判断',
      routeCurrentPendingLabel: '首页当前判断已显示在这里',
    },
    prepare: {
      actionReason: '当前建议先完成准备层最后确认，再顺着主链进入结果工作台。',
      dialogueActionReason: '当前建议先完成准备层最后确认，再顺着主链进入结果工作台。',
      progressLabel: '放行判断',
      routeCurrentPendingLabel: '准备层当前判断已显示在这里',
    },
    result: {
      actionReason: '当前建议先按结果层推荐动作继续。',
      dialogueActionReason: '当前建议先按推荐动作继续收口，不需要在结果页里自己判断下一跳。',
      progressLabel: '结果判断',
      routeCurrentPendingLabel: '结果层当前判断已显示在这里',
    },
    exception: {
      actionReason: '当前建议先按异常层推荐动作继续。',
      dialogueActionReason: '当前建议先把异常相关问题收掉，再考虑回到主链继续。',
      progressLabel: '异常判断',
      routeCurrentPendingLabel: '异常层当前判断已显示在这里',
    },
  };
  return {
    ...(stageMap.home),
    ...(stageMap[key] || {}),
  };
}

function getWorkspaceActionCopy() {
  const identity = getWorkspaceIdentityCopy();
  return {
    enterResult: `进入${identity.pages.result}`,
    enterPrepare: `进入${identity.pages.prepare}`,
    enterException: `进入${identity.pages.exception}`,
    returnHome: `回${identity.pages.home}`,
    returnResult: `回${identity.pages.result}`,
    returnTaskCenter: '回任务总控',
    openStoryboard: '进入分镜整板补充页',
    viewRunRecord: '查看任务档案',
    viewRecordShort: '查看任务档案',
    viewIssues: '查看问题',
    enterNow: '现在进入',
    generatedAfterRun: '执行完成后生成',
  };
}

function summarizeArtifactLayer(artifactGovernance = {}) {
  const summary = artifactGovernance.summary || {};
  const userFacingSummary = artifactGovernance.userFacingSummary && typeof artifactGovernance.userFacingSummary === 'object'
    ? artifactGovernance.userFacingSummary
    : {};
  const protocol = artifactGovernance.artifactLayerProtocol && typeof artifactGovernance.artifactLayerProtocol === 'object'
    ? artifactGovernance.artifactLayerProtocol
    : {};
  const protocolLayers = protocol.layers && typeof protocol.layers === 'object'
    ? protocol.layers
    : {};
  const workspaceSupport = Array.isArray(artifactGovernance.workspaceSupport)
    ? artifactGovernance.workspaceSupport.filter((item) => item.exists)
    : [];
  const optionalPages = Array.isArray(artifactGovernance.optionalPages)
    ? artifactGovernance.optionalPages.filter((item) => item.exists)
    : [];
  const layerOrder = ['mainline', 'support', 'conditional', 'advanced', 'internal'];
  const defaultVisibleLayers = Array.isArray(userFacingSummary.defaultVisibleLayers) && userFacingSummary.defaultVisibleLayers.length
    ? userFacingSummary.defaultVisibleLayers
    : (Array.isArray(protocol.defaultVisibleLayers) ? protocol.defaultVisibleLayers : []);
  const onDemandLayers = Array.isArray(userFacingSummary.onDemandLayers) && userFacingSummary.onDemandLayers.length
    ? userFacingSummary.onDemandLayers
    : (Array.isArray(protocol.onDemandLayers) ? protocol.onDemandLayers : []);
  const internalLayers = Array.isArray(userFacingSummary.internalLayers) && userFacingSummary.internalLayers.length
    ? userFacingSummary.internalLayers
    : (Array.isArray(protocol.internalLayers) ? protocol.internalLayers : []);
  return {
    defaultEntryLabel: String(userFacingSummary.defaultEntryLabel || summary.defaultEntryLabel || '工作台首页').trim(),
    userVisibleCount: Number(summary.userVisibleCount || 0),
    internalCount: Number(userFacingSummary.userVisibleCounts?.internal ?? summary.internalCount ?? 0),
    principle: String(userFacingSummary.principle || summary.principle || '').trim() || '普通用户默认只看工作台主链。任务档案保留为少量补充入口，Markdown 与 JSON 退回文件落盘或内部诊断层。',
    userFacingRule: String(protocol.userFacingRule || '').trim() || '',
    defaultVisibleLayers,
    onDemandLayers,
    internalLayers,
    userFacingSummary,
    layerProtocol: protocol,
    layers: Object.fromEntries(layerOrder.map((key) => {
      const layer = protocolLayers[key] && typeof protocolLayers[key] === 'object'
        ? protocolLayers[key]
        : {};
      return [key, {
        key,
        title: String(layer.title || '').trim() || '',
        audience: String(layer.audience || '').trim() || '',
        attention: String(layer.attention || '').trim() || '',
        defaultVisible: Boolean(layer.defaultVisible),
        generation: String(layer.generation || '').trim() || '',
        count: Number(layer.count || 0),
        entryIds: Array.isArray(layer.entryIds) ? layer.entryIds : [],
        description: String(layer.description || '').trim() || '',
        hiddenByDefaultReason: String(layer.hiddenByDefaultReason || '').trim() || '',
      }];
    })),
    workspaceSupport,
    optionalPages,
  };
}

function buildWorkspaceStateTopology(outputDir = '', overrides = {}) {
  const baseDir = String(outputDir || '').trim();
  const source = overrides && typeof overrides === 'object' ? overrides : {};
  const nestedSources = source.stateSources && typeof source.stateSources === 'object'
    ? source.stateSources
    : {};
  const resolveInOutput = (name) => (baseDir ? path.join(baseDir, name) : name);
  const resolveInTaskRoot = (name) => (baseDir ? path.join(path.dirname(baseDir), name) : name);
  const preferredRuntimeSource = String(
    source.preferredRuntimeSource
    || source.primaryRuntimeSource
    || nestedSources.primaryRuntimeSource
    || nestedSources.preferredRuntimeSource
    || ''
  ).trim() || resolveInOutput('workspace_live_state.json');
  const canonicalState = String(source.canonicalState || nestedSources.canonicalState || '').trim()
    || resolveInOutput('workspace_state.json');
  const runtimeState = String(source.runtimeState || nestedSources.runtimeState || '').trim()
    || resolveInOutput('runtime_state.json');
  const assetsState = String(source.assetsState || nestedSources.assetsState || '').trim()
    || resolveInOutput('workspace_assets.json');
  const timelineState = String(source.timelineState || nestedSources.timelineState || '').trim()
    || resolveInOutput('workspace_timeline.json');
  const derivedWorkbenchSnapshot = String(source.derivedWorkbenchSnapshot || nestedSources.derivedWorkbenchSnapshot || '').trim()
    || resolveInOutput('workbench_state.json');
  const taskCenterUnifiedState = String(source.taskCenterUnifiedState || nestedSources.taskCenterUnifiedState || '').trim()
    || resolveInTaskRoot('task_center_live_state.json');
  const taskCenterEntryProtocol = source.taskCenterEntryProtocol && typeof source.taskCenterEntryProtocol === 'object'
    ? buildTaskCenterEntryProtocol({ ...source.taskCenterEntryProtocol, source: source.taskCenterEntryProtocol.source || taskCenterUnifiedState })
    : buildTaskCenterEntryProtocol({ source: taskCenterUnifiedState });
  const stateRoles = {
    primaryRuntimeSource: '任务内主实时状态源',
    canonicalState: '任务内统一状态模型',
    runtimeState: '运行阶段状态源',
    assetsState: '资产分层状态源',
    timelineState: '阶段时间线状态源',
    derivedWorkbenchSnapshot: '派生工作台快照',
    taskCenterUnifiedState: '跨任务总控实时状态源',
  };
  const readPriority = [
    'workspace_live_state.json',
    'workspace_state.json',
    'runtime_state.json',
    'workspace_assets.json',
    'workspace_timeline.json',
    'workbench_state.json',
  ];
  const taskCenterReadPriority = [
    'task_center_live_state.json',
    'task_center_state.json',
    'daoge_run_index.json',
  ];
  const runtimeRule = '工作台会优先使用 workspace_live_state.json 作为主实时状态源；workspace_state.json 负责统一状态模型；runtime_state.json 只负责运行期进度；workspace_assets.json 和 workspace_timeline.json 分别承接资产分层与阶段时间线；workbench_state.json 是内部派生快照。';
  const stateSourceSummary = '任务内优先读取主实时状态源，再由统一状态模型、运行状态、资产状态和时间线状态补全；跨任务切换、入口主链提醒和运行态副驾驶交接再交给任务总控实时状态源处理。';
  const summary = 'workspace_live_state.json 是主实时状态源，workspace_state.json 是统一状态模型，runtime_state.json / workspace_assets.json / workspace_timeline.json 分别承接运行、资产和时间线信息，workbench_state.json 是内部派生快照，task_center_live_state.json 负责跨任务总控实时状态、入口主链提醒和运行态副驾驶交接。';
  const duplicateFieldRule = 'currentFocus、nextActionSummary、recommendedReply、pressureLabel、statusSummary 统一由 workspace_state.json 持有语义源；workspace_live_state.json 只做页面首屏镜像，runtime_state.json 只在运行中、暂停、等待确认、异常和完成收口时提供实时覆盖，task_center_live_state.json 只保留跨任务摘要与交接副本。';
  const fieldBoundaries = {
    currentFocus: {
      canonicalOwner: 'workspace_state.json',
      canonicalPaths: ['workflowContracts.*.currentJudgment.currentFocus', 'views.*.stageSummary.currentFocus', 'unifiedStatus.currentFocus'],
      liveMirror: 'workspace_live_state.json 页面首屏轻量镜像，不新增语义判断。',
      runtimeOverride: 'runtime_state.json 仅在运行态接管时用 runtimeWorkflow.currentFocus / runtimeCopilotProtocol.handoffState 覆盖显示。',
      taskCenterMirror: 'task_center_live_state.json 只保留 liveRun.runtimeFocus / entryMainlineGuide.focus 级别的跨任务交接摘要。',
      consumers: ['页面主链', '实时副驾驶', '任务总控摘要'],
      reductionRule: '其它层不得重新定义“当前重点”，只能镜像 canonical 或按运行态临时覆盖。',
    },
    nextActionSummary: {
      canonicalOwner: 'workspace_state.json',
      canonicalPaths: ['workflowContracts.*.nextAction.reason', 'workflowTextProtocol.*.nextActionSummary', 'unifiedStatus.nextActionSummary'],
      liveMirror: 'workspace_live_state.json 可缓存首屏下一步文案。',
      runtimeOverride: 'runtime_state.json 运行中优先使用 runtimeWorkflow.nextAction.reason / runtimeCopilotProtocol.nextActionSummary。',
      taskCenterMirror: 'task_center_live_state.json 只保留跨任务继续建议，不反写单轮 nextAction。',
      consumers: ['页面行动条', '副驾驶建议', '任务总控继续入口'],
      reductionRule: '页面与任务总控只消费下一步摘要，不自行拼接新的下一步判断。',
    },
    recommendedReply: {
      canonicalOwner: 'workspace_state.json',
      canonicalPaths: ['workflowContracts.*.dialogueStatus.primarySay', 'workflowTextProtocol.*.recommendedReply', 'unifiedStatus.recommendedReply'],
      liveMirror: 'workspace_live_state.json 可镜像 copilotSummary.recommendedReply 供首屏直接展示。',
      runtimeOverride: 'runtime_state.json 在等待确认、暂停、异常分流和完成收口时用 workflowDialogue.primarySay 接管。',
      taskCenterMirror: 'task_center_live_state.json 只镜像 liveRun.copilotSummary.recommendedReply 作为跨任务入口提示。',
      consumers: ['副驾驶', '确认条', '任务总控入口提示'],
      reductionRule: '推荐回复归副驾驶语言协议持有，状态层只引用，不再各自生成不同口径。',
    },
    pressureLabel: {
      canonicalOwner: 'workspace_state.json',
      canonicalPaths: ['views.*.stageUi.pressureLabel', 'workflowContracts.*.currentJudgment.pressureLabel', 'stageUi.*.pressureLabel'],
      liveMirror: 'workspace_live_state.json 可镜像当前页面压力标签。',
      runtimeOverride: 'runtime_state.json 只在 running / paused / awaiting_confirmation / exception / completed 这些实时分支给临时压力标签。',
      taskCenterMirror: 'task_center_live_state.json 不拥有单轮 pressureLabel，只可汇总为跨任务风险标签。',
      consumers: ['页面状态条', '实时副驾驶'],
      reductionRule: 'pressureLabel 是页面/阶段 UI 标签，不作为任务总控或运行底层事实字段重复维护。',
    },
    statusSummary: {
      canonicalOwner: 'workspace_state.json',
      canonicalPaths: ['workflowContracts.*.currentJudgment.statusSummary', 'statusStack.current.summary', 'unifiedStatus.statusSummary'],
      liveMirror: 'workspace_live_state.json 可缓存首屏状态摘要。',
      runtimeOverride: 'runtime_state.json 运行态用 currentStatus / runtimeCopilotProtocol.progressSummary 临时覆盖。',
      taskCenterMirror: 'task_center_live_state.json 只保留跨任务 liveRun.statusSummary。',
      consumers: ['页面状态摘要', '运行态副驾驶', '任务总控任务卡'],
      reductionRule: '长期状态摘要由 workspace_state 统一，实时摘要只在 runtime_state 生命周期内覆盖。',
    },
  };
  const consumerReadPlan = {
    pages: {
      owner: 'workspace renderers / loadWorkbenchState',
      readPriority,
      primaryLayer: 'workspace_live_state.json',
      canonicalLayer: 'workspace_state.json',
      runtimeOverlay: 'runtime_state.json 只覆盖运行中、暂停、等待确认、异常分流和完成收口的实时副驾驶字段。',
      fallbackLayers: ['workspace_assets.json', 'workspace_timeline.json', 'workbench_state.json'],
      fields: ['currentFocus', 'nextActionSummary', 'recommendedReply', 'pressureLabel', 'statusSummary'],
    },
    taskCenter: {
      owner: 'task_center.html / task_center_state_shared.js',
      readPriority: taskCenterReadPriority,
      primaryLayer: 'task_center_live_state.json',
      fallbackLayers: ['task_center_state.json', 'daoge_run_index.json'],
      fields: ['entryMainlineGuide', 'liveRun', 'copilotSummary', 'nextTaskSuggestion'],
      rule: '任务总控只读跨任务摘要与交接，不直接接管单轮 workspace_state 字段所有权。',
    },
    runtime: {
      owner: 'runtime_state_snapshot.js / refreshRuntimeWorkbench',
      readPriority: ['runtime_state.json', 'job_state.json', 'checkpoint.json', 'manifest.json'],
      primaryLayer: 'runtime_state.json',
      mirrorTargets: ['workspace_live_state.json', 'task_center_live_state.json'],
      fields: ['currentStatus', 'runtimeWorkflow', 'runtimeCopilotProtocol', 'workflowDialogue'],
      rule: '运行态负责实时覆盖与分流，不持有阶段长期语义。',
    },
    copilot: {
      owner: 'workflowContracts / workflowTextProtocol / runtimeCopilotProtocol',
      readPriority: ['workspace_state.json', 'workspace_live_state.json', 'runtime_state.json'],
      canonicalLayer: 'workspace_state.json',
      runtimeOverlay: 'runtime_state.json',
      fields: ['recommendedReply', 'nextActionSummary', 'statusSummary', 'currentFocus'],
      rule: '副驾驶先读统一语言协议；有运行态接管时再读 runtime_state 的临时覆盖。',
    },
  };

  return {
    preferredRuntimeSource,
    primaryRuntimeSource: preferredRuntimeSource,
    canonicalState,
    runtimeState,
    assetsState,
    timelineState,
    derivedWorkbenchSnapshot,
    taskCenterUnifiedState,
    diagnosticArchiveDefaultVisible: Boolean(source.diagnosticArchiveDefaultVisible),
    taskCenterEntryProtocol,
    stateRoles,
    readPriority,
    taskCenterReadPriority,
    duplicateFieldRule,
    fieldBoundaries,
    consumerReadPlan,
    runtimeRule,
    stateSourceSummary,
    consumerRule: '任务内页面优先消费 workspace_live_state.json；缺失时回落到 workspace_state.json，再补 runtime_state.json、workspace_assets.json、workspace_timeline.json 和 workbench_state.json。',
    taskCenterConsumerRule: '任务总控优先消费 task_center_live_state.json；缺失时回落到 task_center_state.json 和 daoge_run_index.json；单轮任务判断仍交给对应工作台首页。',
    summary,
  };
}

function buildWorkspaceStateProtocol(outputDir = '', overrides = {}) {
  const topology = buildWorkspaceStateTopology(outputDir, overrides);
  const fileContracts = {
    workspaceLiveState: {
      file: 'workspace_live_state.json',
      path: topology.primaryRuntimeSource,
      responsibility: '任务内主实时状态源，只保留页面运行中最先需要读取的轻量快照。',
      consumers: ['loadWorkbenchState', 'workspace_home.html', 'prepare_workspace.html', 'result_workspace.html', 'exception_workspace.html'],
      readOrder: 1,
      defaultVisible: false,
      updateCadence: '工作台刷新或运行态变化时优先更新。',
      owns: ['实时入口状态', '轻量页面快照', '当前状态源指针'],
      doesNotOwn: ['currentFocus 等长期语义源', '完整用户资产分层', '完整页面治理配置', '内部派生快照'],
    },
    workspaceState: {
      file: 'workspace_state.json',
      path: topology.canonicalState,
      responsibility: '任务内统一状态模型，负责汇总阶段判断、页面治理、主链文案和副驾驶协议。',
      consumers: ['build_workspace_state.js', 'loadWorkbenchState', 'workspace renderers', 'task_center_state_shared.js'],
      readOrder: 2,
      defaultVisible: false,
      updateCadence: '准备、运行、结果、异常和收口节点变化时重建。',
      owns: ['统一阶段语义', 'workflowContracts', 'workflowTextProtocol', 'stateProtocol', 'artifactGovernance', 'currentFocus/nextActionSummary/recommendedReply/pressureLabel/statusSummary 的语义源'],
      doesNotOwn: ['逐批运行进度原始事实', '图片资产原始列表', '跨任务总控索引'],
    },
    runtimeState: {
      file: 'runtime_state.json',
      path: topology.runtimeState,
      responsibility: '运行期状态源，只负责运行中、暂停、等待确认、完成和异常分流的实时副驾驶信息。',
      consumers: ['build_workspace_state.js', 'refreshRuntimeWorkbench', 'loadWorkbenchState'],
      readOrder: 3,
      defaultVisible: false,
      updateCadence: 'job_state.json 或 checkpoint.json 更新后同步。',
      owns: ['currentStatus', 'runtimeWorkflow', 'runtimeCopilotProtocol', 'workflowDialogue'],
      doesNotOwn: ['currentFocus 等长期阶段语义', '入口选择', '页面分层治理', '长期任务档案'],
    },
    taskCenterLiveState: {
      file: 'task_center_live_state.json',
      path: topology.taskCenterUnifiedState,
      responsibility: '跨任务总控实时状态源，负责入口主链提醒、继续哪一轮任务和运行态副驾驶交接。',
      consumers: ['loadTaskCenterState', 'task_center.html', 'render_run_index.js'],
      readOrder: 1,
      defaultVisible: false,
      updateCadence: '任务总控刷新或单轮运行态变化时同步。',
      owns: ['entryMainlineGuide', 'liveRun', 'taskCenterConsumerRule', '跨任务继续建议'],
      doesNotOwn: ['单轮 currentFocus/pressureLabel 等内部判断', '单轮结果资产细节', '任务内派生快照'],
    },
  };

  return {
    version: 1,
    summary: topology.summary,
    consumerRule: topology.consumerRule,
    taskCenterConsumerRule: topology.taskCenterConsumerRule,
    readPriority: topology.readPriority,
    taskCenterReadPriority: topology.taskCenterReadPriority,
    stateRoles: topology.stateRoles,
    duplicateFieldRule: topology.duplicateFieldRule,
    fieldBoundaries: topology.fieldBoundaries,
    consumerReadPlan: topology.consumerReadPlan,
    files: fileContracts,
  };
}

function summarizeUserWorkbenchProtocol(protocol = {}, options = {}) {
  const source = protocol && typeof protocol === 'object' ? protocol : {};
  const outputDir = String(options.outputDir || '').trim();
  const fallbackDefaultVisibleLabels = Array.isArray(options.fallbackDefaultVisibleLabels) && options.fallbackDefaultVisibleLabels.length
    ? options.fallbackDefaultVisibleLabels
    : ['工作台首页', '准备工作台', '结果工作台', '异常工作台'];
  const stateSources = source.stateSources && typeof source.stateSources === 'object'
    ? source.stateSources
    : {};
  const stateTopology = buildWorkspaceStateTopology(outputDir, {
    ...stateSources,
    taskCenterEntryProtocol: source.taskCenterEntryProtocol,
  });
  const defaultEntryLabel = String(source.defaultEntryLabel || '工作台首页').trim() || '工作台首页';
  const supportEntryLabel = String(source.supportEntryLabel || '任务档案页').trim() || '任务档案页';
  const defaultVisibleLabels = Array.isArray(source.defaultVisibleLabels) && source.defaultVisibleLabels.length
    ? source.defaultVisibleLabels.filter(Boolean)
    : fallbackDefaultVisibleLabels;
  const primaryRuntimeSource = stateTopology.primaryRuntimeSource;
  const derivedWorkbenchSnapshot = stateTopology.derivedWorkbenchSnapshot;
  const canonicalState = stateTopology.canonicalState;
  const runtimeState = stateTopology.runtimeState;
  const assetsState = stateTopology.assetsState;
  const timelineState = stateTopology.timelineState;
  const taskCenterUnifiedState = stateTopology.taskCenterUnifiedState;
  const taskCenterEntryProtocol = stateTopology.taskCenterEntryProtocol;
  const userRule = String(source.userRule || '').trim()
    || '普通用户默认先看工作台首页，再按准备、结果、异常顺着主链继续；任务档案只在按需回看时打开；底层记录文件默认不用直接看。';
  const runtimeRule = String(source.runtimeRule || '').trim()
    || stateTopology.runtimeRule;
  const taskCenterCopy = String(source.taskCenterCopy || '').trim()
    || '默认先从工作台首页进入，再顺着准备、结果、异常三站推进；任务档案只作为按需补充入口。';
  const summary = String(source.summary || '').trim()
    || `默认先看${defaultVisibleLabels.join('、')}；任务档案按需打开；workspace_live_state.json 是主实时状态源，workspace_state.json 是统一状态模型，workbench_state.json 是内部派生快照，普通用户不用直接看这些文件名。`;
  const stateSourceSummary = String(source.stateSourceSummary || '').trim()
    || stateTopology.stateSourceSummary;
  const stateRoles = stateTopology.stateRoles;
  const stateProtocol = source.stateProtocol && typeof source.stateProtocol === 'object'
    ? source.stateProtocol
    : buildWorkspaceStateProtocol(outputDir, {
      ...stateSources,
      taskCenterEntryProtocol: source.taskCenterEntryProtocol,
    });

  return {
    defaultEntryLabel,
    supportEntryLabel,
    defaultVisibleLabels,
    userRule,
    runtimeRule,
    taskCenterCopy,
    summary,
    primaryRuntimeSource,
    derivedWorkbenchSnapshot,
    canonicalState,
    runtimeState,
    assetsState,
    timelineState,
    taskCenterUnifiedState,
    stateSourceSummary,
    taskCenterEntryProtocol,
    stateProtocol,
    stateRoles,
    readPriority: stateTopology.readPriority,
    taskCenterReadPriority: stateTopology.taskCenterReadPriority,
    duplicateFieldRule: stateTopology.duplicateFieldRule,
    fieldBoundaries: stateTopology.fieldBoundaries,
    consumerReadPlan: stateTopology.consumerReadPlan,
    consumerRule: stateTopology.consumerRule,
    taskCenterConsumerRule: stateTopology.taskCenterConsumerRule,
    stateSources: {
      primaryRuntimeSource,
      canonicalState,
      runtimeState,
      assetsState,
      timelineState,
      derivedWorkbenchSnapshot,
      taskCenterUnifiedState,
    },
  };
}

function buildSupportPageCopy(pageKey, options = {}) {
  const key = String(pageKey || '').trim() || 'record';
  if (key === 'task-center') {
    const hasEntryState = Boolean(options.hasEntryState);
    const hasLatest = Boolean(options.hasLatest);
    return {
      heroCopy: '这里只做一件事：决定现在是开新任务，还是继续当前任务。',
      routeTitle: hasEntryState ? '从入口层继续' : '先选定这一轮',
      routeCopy: hasEntryState
        ? '入口层只负责选任务和选起步入口，确认后就直接进入准备工作台。'
        : '先选任务，再进入它自己的工作台首页。',
      workbenchCopy: '这里只保留当前最值得继续的任务入口，不把所有页面都堆在第一屏。',
      liveStripHint: hasLatest
        ? '总控层只负责切任务和决定下一步，不展开任务内部操作。'
        : '当前还没有可继续的历史任务，先从中文模板展示板开始。',
      otherRunsTitle: '其它可继续任务',
      otherRunsCopy: '如果不是继续当前这轮，只在这里挑一轮旧任务；需要先处理的任务会自动排在前面。',
      otherRunsSummaryLabel: '展开其它可继续任务',
    };
  }

  if (key === 'record') {
    const defaultEntryLabel = String(options.defaultEntryLabel || '工作台首页').trim() || '工作台首页';
    const supportEntryLabel = String(options.supportEntryLabel || '任务档案页').trim() || '任务档案页';
    return {
      heroCopy: '这里把底层运行记录统一翻译成人话。你不需要看懂程序字段，只需要知道这轮任务发生了什么、现在到了哪一步、接下来回哪个工作台。',
      routeTitle: '现在继续',
      routeCopy: '看完档案后，直接回主链继续，不需要把这里当成新的常驻看板。',
      workbenchCopy: '这里只保留档案页真正需要的入口，不再把辅助说明页做成新的主链看板。',
      archiveLead: '这份档案只负责回答三件事：这轮发生了什么、现在进行到了哪里、下一步该回哪个工作台。',
      archiveBoundaryTitle: '这份档案不负责什么',
      archiveBoundaryCopy: '为了减少说明层重复，这里不再承担总入口说明和最终收口结论。',
      archiveBoundaryItems: [
        { label: '入口说明', value: `回 README 或 ${defaultEntryLabel}` },
        { label: '最终收口', value: '看完成报告' },
      ],
      archiveSummaryTitle: '档案摘要',
      archiveSummaryCopy: '这里只保留一眼能看懂的档案结论，不再把程序字段直接堆给人看。',
      protocolTitle: '输出目录规则',
      protocolCopy: String(options.protocolSummary || '').trim() || `${supportEntryLabel} 只作为按需补充入口。`,
      protocolSummaryLabel: '展开输出目录规则',
    };
  }

  return {};
}

function buildWorkspaceFallbackGuide(stage, artifactLayer = {}) {
  const key = String(stage || '').trim() || 'home';
  const denseCopy = getWorkspaceDenseCopy(key);
  const entryTitle = denseCopy.guideSectionTitle;
  const visibilityTitle = denseCopy.visibilitySectionTitle;
  const defaultEntryLabel = String(artifactLayer.defaultEntryLabel || '工作台首页').trim() || '工作台首页';
  const principle = String(artifactLayer.principle || '').trim() || '普通用户默认只看工作台主链。任务档案保留为少量补充入口，Markdown 与 JSON 退回文件落盘或内部诊断层。';
  const userFacingRule = String(artifactLayer.userFacingRule || '').trim() || principle;
  const visibleLayerLabels = (artifactLayer.defaultVisibleLayers || [])
    .map((keyName) => artifactLayer.layers?.[keyName]?.title || '')
    .filter(Boolean)
    .join('、');
  const onDemandLayerLabels = (artifactLayer.onDemandLayers || [])
    .map((keyName) => artifactLayer.layers?.[keyName]?.title || '')
    .filter(Boolean)
    .join('、');
  const internalLayerLabels = (artifactLayer.internalLayers || [])
    .map((keyName) => artifactLayer.layers?.[keyName]?.title || '')
    .filter(Boolean)
    .join('、');

  const stageMap = {
    home: {
      guideCopy: `${userFacingRule} 首页只负责帮你确认主链位置、下一步入口和是否需要先处理异常。`,
      guideItems: [
        { label: '主入口', value: defaultEntryLabel },
        { label: '默认可见层', value: visibleLayerLabels || '主链层、补充层' },
        { label: '这一站负责什么', value: '先看当前阶段、下一步入口和异常压力，再决定往哪一站继续' },
        { label: '哪些内容先后退', value: `${onDemandLayerLabels || '条件页层、进阶页层'}、${internalLayerLabels || '内部资产层'} 默认后退，不占首页主判断` },
      ],
      visibilityCopy: denseCopy.visibilitySectionCopy,
      visibilityItems: [
        { label: '先看', value: '当前阶段、结果入口、异常压力' },
        { label: '按需再看', value: `${artifactLayer.layers?.support?.title || '补充层'}里的准备工作台、任务档案` },
        { label: '先不用看', value: `${onDemandLayerLabels || '条件页层、进阶页层'}和${internalLayerLabels || '内部资产层'}里的底层记录、辅助页面和内部细分页` },
      ],
    },
    prepare: {
      guideCopy: `${userFacingRule} 准备工作台只负责方向、放行和素材判断。`,
      guideItems: [
        { label: '主入口', value: defaultEntryLabel },
        { label: '默认可见层', value: visibleLayerLabels || '主链层、补充层' },
        { label: '这一站负责什么', value: '把任务方向、放行判断和素材约束收在一页里看清' },
        { label: '哪些内容先后退', value: `${onDemandLayerLabels || '条件页层、进阶页层'}和${internalLayerLabels || '内部资产层'}继续保留，但默认不占主链注意力` },
      ],
      visibilityCopy: denseCopy.visibilitySectionCopy,
      visibilityItems: [
        { label: '先看', value: '任务方向、放行判断、素材绑定' },
        { label: '按需再看', value: `${artifactLayer.layers?.support?.title || '补充层'}里的工作台首页、任务档案` },
        { label: '先不用看', value: `${internalLayerLabels || '内部资产层'}里的底层计划、校验记录和内部产物` },
      ],
    },
    result: {
      guideCopy: `${userFacingRule} 结果工作台只负责看图、取舍和下一步判断。`,
      guideItems: [
        { label: '主入口', value: defaultEntryLabel },
        { label: '默认可见层', value: visibleLayerLabels || '主链层、补充层' },
        { label: '这一站负责什么', value: '把可用结果、待确认结果和异常结果放在同一套判断里收口' },
        { label: '哪些内容先后退', value: `${onDemandLayerLabels || '条件页层、进阶页层'}和${internalLayerLabels || '内部资产层'}继续保留，但默认不占主链注意力` },
      ],
      visibilityCopy: denseCopy.visibilitySectionCopy,
      visibilityItems: [
        { label: '先看', value: '可直接使用结果、预览图、待复核与异常结果' },
        { label: '按需再看', value: `${artifactLayer.layers?.support?.title || '补充层'}里的任务档案、异常工作台` },
        { label: '先不用看', value: `${internalLayerLabels || '内部资产层'}里的运行复盘、执行记录和内部统计` },
      ],
    },
    exception: {
      guideCopy: `${userFacingRule} 异常工作台只是按需页面，只有出现问题时才需要进入。`,
      guideItems: [
        { label: '主入口', value: defaultEntryLabel },
        { label: '默认可见层', value: visibleLayerLabels || '主链层、补充层' },
        { label: '这一站负责什么', value: '只把会打断主链继续的问题集中收口，不把按需页面当成新的主控页' },
        { label: '哪些内容先后退', value: `${onDemandLayerLabels || '条件页层、进阶页层'}和${internalLayerLabels || '内部资产层'}继续保留，但默认不占这一步注意力` },
      ],
      visibilityCopy: denseCopy.visibilitySectionCopy,
      visibilityItems: [
        { label: '先看', value: '失败结果、待复核结果、补跑候选' },
        { label: '按需再看', value: '结果工作台、工作台首页' },
        { label: '先不用看', value: `${onDemandLayerLabels || '条件页层、进阶页层'}和${internalLayerLabels || '内部资产层'}里的准备细分页和底层记录` },
      ],
    },
  };

  const selected = stageMap[key] || stageMap.home;
  return {
    guide: buildWorkspaceGuideSectionData({
      title: entryTitle,
      copy: denseCopy.guideSectionCopy,
      items: selected.guideItems,
    }),
    visibility: {
      title: visibilityTitle,
      copy: selected.visibilityCopy,
      items: selected.visibilityItems,
    },
  };
}

function buildWorkspaceNewcomerSummaryItems(items = {}, fallback = {}) {
  const normalizedItems = toArray(items);
  const findValue = (label) => String(
    normalizedItems.find((item) => String(item?.label || '').trim() === label)?.value
    || ''
  ).trim();

  return {
    guide: [
      {
        label: '现在怎么用',
        value: findValue('现在怎么用')
          || String(fallback.currentFocus || '').trim()
          || '先按主判断继续。',
      },
      {
        label: '如果想深看',
        value: findValue('如果想深看')
          || String(fallback.deepDiveSuggestion || '').trim()
          || '需要时再展开完整规则。',
      },
    ],
    visibility: [
      {
        label: '先看',
        value: findValue('先看')
          || String(fallback.now || '').trim()
          || '先看当前最关键的判断。',
      },
      {
        label: '按需再看',
        value: findValue('按需再看')
          || String(fallback.optional || '').trim()
          || '需要时再展开补充说明。',
      },
    ],
  };
}

function formatTimelineEvents(events) {
  return Array.isArray(events)
    ? events.filter(Boolean).map((event) => ({
      ...event,
      timeLabel: event?.time ? String(event.time).replace('T', ' ').replace(/\.\d+Z$/, 'Z') : '',
    }))
    : [];
}

function buildWorkspaceFallbackTimeline(stage, options = {}) {
  const key = String(stage || '').trim() || 'home';
  const timelineCopyMap = {
    home: '这里按顺序回放这轮任务刚刚发生了什么，帮助你快速接上当前主链。',
    prepare: '这里回放准备层刚刚确认了哪些阶段变化，帮助你判断现在该不该直接开跑。',
    result: '这里按顺序回放这轮结果层刚刚发生了什么，帮助你快速接上当前筛图与收口判断。',
    exception: '这里回放异常层刚刚接住了哪些问题、工作台是怎么走到这里的，帮助你顺着问题收口再回工作台。',
  };
  return {
    title: String(options.title || '').trim() || '阶段时间线',
    copy: String(options.copy || '').trim() || timelineCopyMap[key] || timelineCopyMap.home,
    events: Array.isArray(options.events) ? options.events : formatTimelineEvents(options.workspaceTimelineEvents),
  };
}

function buildWorkspaceFallbackAssetOverview(options = {}) {
  const stageKey = String(options.stageKey || '').trim() || 'home';
  const sourceAssets = options.sourceAssets && typeof options.sourceAssets === 'object' ? options.sourceAssets : {};
  const assetSummary = options.assetSummary && typeof options.assetSummary === 'object' ? options.assetSummary : {};
  const metrics = options.metrics && typeof options.metrics === 'object' ? options.metrics : {};
  const counts = {
    resultCount: Number(options.resultCount ?? sourceAssets.resultCount ?? assetSummary.resultCount ?? metrics.successCount ?? 0),
    previewCount: Number(options.previewCount ?? sourceAssets.previewCount ?? assetSummary.previewCount ?? 0),
    reviewCount: Number(options.reviewCount ?? sourceAssets.reviewCount ?? assetSummary.reviewCount ?? metrics.reviewCount ?? 0),
    exceptionCount: Number(options.exceptionCount ?? sourceAssets.exceptionCount ?? assetSummary.exceptionCount ?? metrics.failedCount ?? 0),
    referenceCount: Number(options.referenceCount ?? sourceAssets.referenceCount ?? assetSummary.referenceCount ?? metrics.referenceCount ?? 0),
  };
  if (stageKey === 'exception') {
    counts.resultCount = 0;
    counts.previewCount = 0;
    counts.referenceCount = 0;
  }
  return {
    ...counts,
    overview: options.overviewBuilder(counts),
  };
}

function buildWorkspaceFallbackCockpitSummary(options = {}) {
  const items = Array.isArray(options.items) ? options.items : [];
  return buildWorkspaceCockpitSummaryData({
    items,
  });
}

function buildStageWorkspaceFallbackState(stageKey, options = {}) {
  const key = String(stageKey || '').trim() || 'home';
  const currentPhaseConclusion = String(options.currentPhaseConclusion || '').trim();
  const currentPhaseSummary = String(options.currentPhaseSummary || '').trim();
  const currentFocus = String(options.currentFocus || '').trim();
  const statusLabel = String(options.statusLabel || '').trim();
  const statusSummary = String(options.statusSummary || '').trim();
  const statusTone = String(options.statusTone || '').trim();
  const nextActionLabel = String(options.nextActionLabel || '').trim();
  const nextActionReason = String(options.nextActionReason || '').trim();
  const transitionSummary = String(options.transitionSummary || '').trim();
  const handoffSummary = String(options.handoffSummary || '').trim();
  const issueSummary = String(options.issueSummary || '').trim();
  const confirmationState = options.confirmationState && typeof options.confirmationState === 'object'
    ? options.confirmationState
    : {};

  if (key === 'home') {
    const issueCount = Number(options.issueCount || 0);
    const hasResult = Boolean(options.hasResult);
    const fallbackCurrentFocus = currentFocus || '先按推荐下一步继续';
    const fallbackStatusLabel = statusLabel || currentPhaseConclusion || '当前主链';
    const fallbackStatusSummary = statusSummary || '先按当前主链继续。';
    const fallbackStageSummary = String(options.stageSummary || '').trim() || '首页负责给出当前主链入口与下一步方向。';
    const fallbackIssueSummary = issueSummary || (issueCount > 0 ? `有 ${issueCount} 个待处理问题` : '当前没有明显异常');
    const fallbackTransitionSummary = transitionSummary || nextActionReason || fallbackStatusSummary;
    const fallbackHandoffSummary = handoffSummary || fallbackTransitionSummary;
    const resolvedStatusTone = statusTone || (issueCount > 0 ? 'warn' : (hasResult ? 'good' : 'info'));
    return {
      narrative: {
        fallbackCurrentFocus,
        fallbackStageSummary,
        fallbackStatusLabel,
        fallbackStatusSummary,
        fallbackTransitionSummary,
        fallbackHandoffSummary,
        fallbackIssueSummary,
      },
      cockpitItems: [
        {
          label: '当前局面',
          value: currentPhaseConclusion || fallbackStatusLabel,
          summary: currentPhaseSummary || fallbackStatusSummary,
          tone: resolvedStatusTone,
        },
        {
          label: '当前重点',
          value: fallbackCurrentFocus,
          summary: nextActionReason || fallbackTransitionSummary,
          tone: issueCount > 0 ? 'warn' : 'good',
        },
        {
          label: '当前压力',
          value: String(options.pressureLabel || '').trim() || (issueCount > 0 ? '还有问题待处理' : '当前平稳'),
          summary: String(options.pressureSummary || '').trim() || fallbackIssueSummary,
          tone: String(options.pressureTone || '').trim() || (issueCount > 0 ? 'bad' : 'good'),
        },
      ],
      judgmentBase: {
        statusLabel: fallbackStatusLabel || '当前判断',
        statusSummary: fallbackStatusSummary || '先按当前主链继续。',
        statusTone: resolvedStatusTone,
        actionLabel: nextActionLabel || '继续当前主链',
        actionSummary: nextActionReason || fallbackTransitionSummary || '当前建议按推荐动作继续。',
        replyLabel: String(options.recommendedReply || confirmationState.recommendedReply || '').trim(),
        confirmItems: toArray(options.confirmItems).length ? options.confirmItems : toArray(confirmationState.pendingItems),
        noteItems: mergeUniqueStrings(options.noteItems, [
          fallbackIssueSummary,
          fallbackStageSummary,
        ]),
      },
      stageRelay: {
        fallbackCurrentSummary: fallbackTransitionSummary,
        fallbackNextSummary: fallbackHandoffSummary || fallbackTransitionSummary,
      },
    };
  }

  if (key === 'prepare') {
    const hasBlocking = Boolean(options.hasBlocking);
    const importedBindingCount = Number(options.importedBindingCount || 0);
    const fallbackCurrentFocus = currentFocus || (hasBlocking ? '先补齐开跑条件' : '确认后即可放行');
    const fallbackStatusLabel = statusLabel || (hasBlocking ? '先修正再开跑' : '可以进入执行');
    const fallbackStatusSummary = statusSummary || (hasBlocking ? '当前不建议直接执行，先把阻塞项收干净。' : '当前准备层已经比较干净，可以进入正式生图。');
    const fallbackTransitionSummary = transitionSummary || nextActionReason || fallbackStatusSummary;
    const fallbackHandoffSummary = handoffSummary || '准备层会把放行判断和当前约束交给结果层。';
    const resolvedStatusTone = statusTone || (hasBlocking ? 'bad' : 'good');
    return {
      narrative: {
        fallbackCurrentFocus,
        fallbackStageSummary: '准备层负责方向、放行和素材绑定确认。',
        fallbackStatusLabel,
        fallbackStatusSummary,
        fallbackTransitionSummary,
        fallbackHandoffSummary,
      },
      cockpitItems: [
        {
          label: '当前局面',
          value: currentPhaseConclusion || fallbackStatusLabel,
          summary: currentPhaseSummary || fallbackStatusSummary,
          tone: resolvedStatusTone,
        },
        {
          label: '当前重点',
          value: fallbackCurrentFocus,
          summary: nextActionReason || fallbackTransitionSummary || '先按准备层当前判断继续。',
          tone: hasBlocking ? 'warn' : 'good',
        },
        {
          label: '当前压力',
          value: hasBlocking ? '还有准备问题待处理' : '当前可放行',
          summary: fallbackStatusSummary,
          tone: hasBlocking ? 'bad' : 'good',
        },
      ],
      judgmentBase: {
        statusLabel: fallbackStatusLabel || '准备层判断',
        statusSummary: fallbackStatusSummary || '先按准备层当前判断继续。',
        statusTone: resolvedStatusTone,
        actionLabel: nextActionLabel || getStagePrimaryActionLabel('prepare', { hasBlocking }),
        actionSummary: nextActionReason || fallbackTransitionSummary || '确认完准备条件后再继续。',
        replyLabel: String(options.recommendedReply || confirmationState.recommendedReply || '').trim(),
        confirmItems: toArray(options.confirmItems).length ? options.confirmItems : toArray(confirmationState.pendingItems),
        noteItems: mergeUniqueStrings(options.noteItems, [
          importedBindingCount > 0 ? '这一轮带有素材约束，后面更要看主体稳定和绑定关系。' : '这一轮没有素材约束，可以优先看方向和风格是否对味。',
          hasBlocking ? '当前还有准备问题没收干净，先别急着往下走。' : '当前没有硬阻塞，可以按主链继续。',
        ]),
      },
      stageRelay: {
        fallbackCurrentSummary: fallbackTransitionSummary,
        fallbackNextSummary: fallbackHandoffSummary || fallbackTransitionSummary,
      },
    };
  }

  if (key === 'result') {
    const failedCount = Number(options.failedCount || 0);
    const reviewCount = Number(options.reviewCount || 0);
    const fallbackCurrentFocus = currentFocus || (failedCount > 0 ? '先看异常与可用性' : '先看保留取舍');
    const fallbackStatusLabel = statusLabel || (failedCount > 0
      ? '先处理异常，再决定是否收口'
      : (reviewCount > 0 ? '结果大体稳定，但仍有待复核项' : '结果层基本稳定，可以继续收口'));
    const fallbackStatusSummary = statusSummary || (failedCount > 0 ? '建议优先处理异常相关结果。' : '可以继续做图片取舍。');
    const fallbackTransitionSummary = transitionSummary
      || nextActionReason
      || (failedCount > 0 ? '建议先处理异常，再决定是否回工作台。' : '建议先在结果工作台完成筛图与取舍。');
    const fallbackHandoffSummary = handoffSummary || '结果层会把当前筛图判断交给下一站。';
    const resolvedStatusTone = statusTone || (failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good'));
    return {
      narrative: {
        fallbackCurrentFocus,
        fallbackStageSummary: failedCount > 0 ? '结果层负责筛图、取舍和异常分流。' : '结果层负责筛图、取舍和最终收口。',
        fallbackStatusLabel,
        fallbackStatusSummary,
        fallbackTransitionSummary,
        fallbackHandoffSummary,
      },
      cockpitItems: [
        {
          label: '当前局面',
          value: currentPhaseConclusion || fallbackStatusLabel,
          summary: currentPhaseSummary || fallbackStatusSummary,
          tone: resolvedStatusTone,
        },
        {
          label: '当前重点',
          value: fallbackCurrentFocus,
          summary: nextActionReason || fallbackTransitionSummary,
          tone: failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good'),
        },
        {
          label: '当前压力',
          value: failedCount > 0 ? '还有异常待处理' : (reviewCount > 0 ? '还有待复核项' : '当前平稳'),
          summary: failedCount > 0 ? '先处理会直接影响主链的失败项。' : (reviewCount > 0 ? '当前主要压力来自待复核项。' : '这一轮已经具备继续收口条件。'),
          tone: failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good'),
        },
      ],
      judgmentBase: {
        statusLabel: fallbackStatusLabel || '结果层判断',
        statusSummary: fallbackStatusSummary || '先按结果层当前判断继续。',
        statusTone: resolvedStatusTone,
        actionLabel: nextActionLabel || (failedCount > 0 ? '进入异常工作台' : '回工作台首页'),
        actionSummary: nextActionReason || fallbackTransitionSummary || '当前建议先按结果层推荐动作继续。',
        replyLabel: String(options.recommendedReply || confirmationState.recommendedReply || '').trim(),
        confirmItems: toArray(options.confirmItems).length ? options.confirmItems : toArray(confirmationState.pendingItems),
        noteItems: mergeUniqueStrings(options.noteItems, [
          failedCount > 0 ? `当前仍有 ${failedCount} 项失败结果` : '当前没有硬失败',
          reviewCount > 0 ? `当前仍有 ${reviewCount} 项待复核` : '当前复核压力较低',
        ]),
      },
      stageRelay: {
        fallbackCurrentSummary: fallbackTransitionSummary,
        fallbackNextSummary: fallbackHandoffSummary || fallbackTransitionSummary,
      },
    };
  }

  if (key === 'exception') {
    const failedCount = Number(options.failedCount || 0);
    const reviewCount = Number(options.reviewCount || 0);
    const totalIssueCount = Number(options.totalIssueCount || (failedCount + reviewCount));
    const fallbackCurrentFocus = currentFocus || (failedCount > 0 ? '先处理失败项' : (reviewCount > 0 ? '先确认待复核项' : '当前没有明显异常'));
    const fallbackStatusLabel = statusLabel || (totalIssueCount > 0 ? '建议先统一处理异常' : '当前没有明显异常');
    const fallbackStatusSummary = statusSummary || (totalIssueCount > 0 ? '建议先把异常收口，再考虑继续扩图。' : '当前可以直接回到结果工作台。');
    const fallbackIssueSummary = issueSummary || (totalIssueCount > 0 ? '当前需要优先处理异常相关结果。' : '当前没有明显异常压力。');
    const fallbackTransitionSummary = transitionSummary || nextActionReason || fallbackIssueSummary;
    const fallbackHandoffSummary = handoffSummary || '异常层会把问题收口判断送回工作台或结果工作台。';
    const resolvedStatusTone = statusTone || (totalIssueCount > 0 ? 'bad' : 'good');
    return {
      narrative: {
        fallbackCurrentFocus,
        fallbackStageSummary: '异常层负责失败项、待复核项和补跑判断。',
        fallbackStatusLabel,
        fallbackStatusSummary,
        fallbackTransitionSummary,
        fallbackHandoffSummary,
        fallbackIssueSummary: fallbackIssueSummary,
      },
      cockpitItems: [
        {
          label: '当前局面',
          value: currentPhaseConclusion || fallbackStatusLabel,
          summary: currentPhaseSummary || fallbackStatusSummary,
          tone: resolvedStatusTone,
        },
        {
          label: '当前重点',
          value: fallbackCurrentFocus,
          summary: nextActionReason || fallbackIssueSummary,
          tone: failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good'),
        },
        {
          label: '当前压力',
          value: totalIssueCount > 0 ? '还有问题待处理' : '当前平稳',
          summary: failedCount > 0 ? '先把会打断主链的失败项收掉。' : (reviewCount > 0 ? '当前主要是边界结果还想再确认一眼。' : '这一页当前可以先不使用。'),
          tone: totalIssueCount > 0 ? 'bad' : 'good',
        },
      ],
      judgmentBase: {
        statusLabel: fallbackStatusLabel || '异常层判断',
        statusSummary: fallbackIssueSummary || fallbackStatusSummary || '先按异常层当前判断继续。',
        statusTone: resolvedStatusTone,
        actionLabel: nextActionLabel || getStagePrimaryActionLabel('exception', { failedCount }),
        actionSummary: nextActionReason || fallbackTransitionSummary || fallbackIssueSummary || '当前建议先把异常收口。',
        replyLabel: String(options.recommendedReply || confirmationState.recommendedReply || '').trim(),
        confirmItems: toArray(options.confirmItems).length ? options.confirmItems : toArray(confirmationState.pendingItems),
        noteItems: mergeUniqueStrings(options.noteItems, [
          failedCount > 0 ? `当前仍有 ${failedCount} 项失败项` : '当前没有硬失败',
          reviewCount > 0 ? `当前仍有 ${reviewCount} 项待复核` : '当前复核压力较低',
        ]),
      },
      stageRelay: {
        fallbackCurrentSummary: fallbackTransitionSummary || fallbackIssueSummary,
        fallbackNextSummary: fallbackHandoffSummary || fallbackTransitionSummary || fallbackIssueSummary,
      },
    };
  }

  return {
    narrative: {},
    cockpitItems: [],
    judgmentBase: {},
    stageRelay: {},
  };
}

function buildUnifiedWorkflowCockpitSummary(options = {}) {
  const items = Array.isArray(options.items) ? options.items : [];
  const base = options.base && typeof options.base === 'object' ? options.base : null;
  const workflow = options.workflow && typeof options.workflow === 'object' ? options.workflow : null;
  const copilot = options.copilot && typeof options.copilot === 'object' ? options.copilot : null;
  const view = options.view && typeof options.view === 'object' ? options.view : null;
  return base
    || view
    || workflow
    || copilot
    || buildWorkspaceFallbackCockpitSummary({ items });
}

function buildUnifiedWorkflowJudgment(options = {}) {
  const stageConfig = options.stageConfig && typeof options.stageConfig === 'object' ? options.stageConfig : {};
  return {
    title: String(stageConfig.title || '').trim(),
    copy: String(stageConfig.copy || '').trim(),
    ...(options.base && typeof options.base === 'object' ? options.base : {}),
    ...(options.baseState && typeof options.baseState === 'object' ? options.baseState : {}),
    ...(options.copilot && typeof options.copilot === 'object' ? options.copilot : {}),
    ...(options.workflow && typeof options.workflow === 'object' ? options.workflow : {}),
    ...(options.view && typeof options.view === 'object' ? options.view : {}),
  };
}

function buildUnifiedWorkflowStatusStack(options = {}) {
  const workflow = options.workflow && typeof options.workflow === 'object' ? options.workflow : null;
  const copilot = options.copilot && typeof options.copilot === 'object' ? options.copilot : null;
  const controlRail = options.controlRail && typeof options.controlRail === 'object' ? options.controlRail : null;
  const stateItems = toArray(options.stateItems);
  const fallbackBuilder = typeof options.fallbackBuilder === 'function'
    ? options.fallbackBuilder
    : null;
  const fallbackItems = fallbackBuilder ? toArray(fallbackBuilder()) : [];
  return workflow
    || copilot
    || controlRail
    || {
      items: stateItems.length ? stateItems : fallbackItems,
    };
}

function buildUnifiedWorkflowDecision(options = {}) {
  const stageConfig = options.stageConfig && typeof options.stageConfig === 'object' ? options.stageConfig : {};
  const base = options.base && typeof options.base === 'object' ? options.base : null;
  const state = options.state && typeof options.state === 'object' ? options.state : null;
  const view = options.view && typeof options.view === 'object' ? options.view : null;
  const fallback = options.fallback && typeof options.fallback === 'object' ? options.fallback : {};
  return buildWorkspaceDecisionSectionData({
    title: String(stageConfig.title || '').trim(),
    copy: String(stageConfig.copy || '').trim(),
    ...(fallback || {}),
    ...(base || {}),
    ...(state || {}),
    ...(view || {}),
  });
}

function buildUnifiedWorkflowConfirmation(unifiedStatus = {}, options = {}) {
  const fallback = options.fallback && typeof options.fallback === 'object' ? options.fallback : {};
  const view = options.view && typeof options.view === 'object' ? options.view : null;
  const state = options.state && typeof options.state === 'object' ? options.state : null;
  const page = options.page && typeof options.page === 'object' ? options.page : null;
  return buildConfirmationStateFromUnifiedStatus(unifiedStatus, {
    ...fallback,
    ...(page || {}),
    ...(state || {}),
    ...(view || {}),
  });
}

function buildUnifiedWorkflowCollaboration(unifiedStatus = {}, options = {}) {
  const base = options.base && typeof options.base === 'object' ? options.base : null;
  const view = options.view && typeof options.view === 'object' ? options.view : null;
  const workflow = options.workflow && typeof options.workflow === 'object' ? options.workflow : null;
  if (base || view || workflow) {
    return buildWorkspaceCollaborationSectionData({
      ...(base || {}),
      ...(workflow || {}),
      ...(view || {}),
    });
  }
  return buildCollaborationFromUnifiedStatus(unifiedStatus, {
    confirmation: options.confirmation,
    timeline: options.timeline,
    dialogue: options.dialogue,
    title: options.title,
    copy: options.copy,
    recentItems: options.recentItems,
    confirmItems: options.confirmItems,
    replyReason: options.replyReason,
    primarySay: options.primarySay,
    alternativeSayItems: options.alternativeSayItems,
  });
}

function buildUnifiedWorkflowStageRelay(unifiedStatus = {}, options = {}) {
  const source = unifiedStatus && typeof unifiedStatus === 'object' ? unifiedStatus : {};
  const nextAction = source.nextAction && typeof source.nextAction === 'object' ? source.nextAction : {};
  const workflow = options.workflow && typeof options.workflow === 'object' ? options.workflow : null;
  const copilot = options.copilot && typeof options.copilot === 'object' ? options.copilot : null;
  const view = options.view && typeof options.view === 'object' ? options.view : null;
  const base = view || workflow || copilot || {};
  return buildStageRelayFromUnifiedStatus(unifiedStatus, {
    ...base,
    currentSummary: firstNonEmpty(
      options.currentSummary,
      base.currentSummary,
      source.currentFocus,
      source.progress,
      base.summary,
      options.fallbackCurrentSummary
    ),
    nextSummary: firstNonEmpty(
      options.nextSummary,
      base.nextSummary,
      nextAction.reason,
      options.fallbackNextSummary,
      options.fallbackCurrentSummary
    ),
  });
}

function getWorkspaceIdentityCopy() {
  return {
    pages: {
      home: '工作台首页',
      prepare: '准备工作台',
      result: '结果工作台',
      exception: '异常工作台',
      storyboard: '分镜整板补充页',
      record: '任务档案',
      taskCenter: '任务总控',
    },
    stages: {
      home: '首页总控阶段',
      prepare: '准备阶段',
      result: '结果阶段',
      exception: '异常阶段',
    },
    flows: {
      home: '工作台首页 -> 准备工作台 -> 结果工作台 -> 异常工作台',
      prepare: '首页总览 -> 准备确认 -> 结果判断',
      result: '首页总览 -> 结果判断 -> 异常处理 / 整板复看',
      exception: '首页总览 -> 结果判断 -> 异常处理',
    },
  };
}

function getWorkspacePageShellConfig(stage) {
  const key = String(stage || '').trim();
  const map = {
    home: {
      pageTitle: 'DAOGE 工作台首页',
      currentPage: 'workspace_home.html',
      heroEyebrow: '主链总控',
      heroTitle: 'DAOGE 工作台首页',
      heroCopy: '这是当前任务唯一默认先看页。你只需要在这里判断三件事：这一轮现在到哪一步、先做哪一步、这一轮是否需要先处理异常。',
      cssVars: `      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --page-glow: rgba(217,179,109,0.18);
      --hero-tint: rgba(217,179,109,0.15);`,
    },
    prepare: {
      pageTitle: 'DAOGE 准备工作台',
      currentPage: 'prepare_workspace.html',
      heroEyebrow: '执行前确认',
      heroTitle: 'DAOGE 准备工作台',
      heroCopy: '这是准备驾驶台。你可以在这里同时确认任务方向、放行判断和素材绑定，不用再来回跳 Prompt 预览、预检页和素材页才能弄清当前是否能开跑。',
      cssVars: `      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --page-glow: rgba(136,185,255,0.18);
      --hero-tint: rgba(136,185,255,0.15);`,
    },
    result: {
      pageTitle: 'DAOGE 结果工作台',
      currentPage: 'result_workspace.html',
      heroEyebrow: '结果判断台',
      heroTitle: 'DAOGE 结果工作台',
      heroCopy: '这是结果驾驶台。你只需要做三件事：细看图片、确认保留取舍、决定是否转去异常处理或整板复看。',
      cssVars: `      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --page-glow: rgba(124,197,163,0.18);
      --hero-tint: rgba(124,197,163,0.15);`,
    },
    exception: {
      pageTitle: 'DAOGE 异常工作台',
      currentPage: 'exception_workspace.html',
      heroEyebrow: '异常处理台',
      heroTitle: 'DAOGE 异常工作台',
      heroCopy: '这是异常驾驶台。只有当前结果真的出现问题时才需要进入；进入后先把失败项和待复核项收掉，再回到工作台继续。',
      cssVars: `      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --page-glow: rgba(255,140,122,0.18);
      --hero-tint: rgba(255,140,122,0.15);`,
    },
  };
  return map[key] || map.home;
}

function getWorkspaceLayoutConfig(stage, options = {}) {
  return getWorkbenchDisplayGovernance({
    stage,
    currentPage: options.currentPage,
  });
}

function getWorkspaceModeSwitchConfig(stage, options = {}) {
  return getWorkspaceLayoutConfig(stage, options).modeSwitch;
}

function resolveWorkspaceShellRuntime(pageState = {}, stage = 'home', viewState = {}) {
  const shell = getWorkspacePageShellConfig(stage);
  const state = pageState && typeof pageState === 'object' ? pageState : {};
  const viewDisplay = resolveWorkspaceStageViewValue(state, stage, viewState, 'display', null);
  const governance = state.governanceByPage?.[shell.currentPage] || state.governance || null;
  const layout = viewDisplay || governance?.display || getWorkspaceLayoutConfig(stage, { currentPage: shell.currentPage });
  const surfaceRules = layout?.surfaceRules || {};
  const modeSwitch = layout?.modeSwitch || getWorkspaceModeSwitchConfig(stage, { currentPage: shell.currentPage });
  return {
    shell,
    governance,
    layout,
    surfaceRules,
    modeSwitch,
    optionalSurface: governance?.optionalSurface || {},
    governedWorkbenchIds: Array.isArray(governance?.workbenchEntryIds) ? new Set(governance.workbenchEntryIds) : null,
  };
}

function renderWorkspaceDensityGroup(title, copy, items, options = {}) {
  const validItems = toArray(items).filter(Boolean);
  if (!validItems.length) return '';
  const groupTitle = String(title || '').trim();
  const groupCopy = String(copy || '').trim();
  const summaryLabel = String(options.summaryLabel || '').trim() || groupTitle || '展开查看';
  const tone = String(options.tone || 'neutral').trim();
  const audience = String(options.audience || 'all').trim() || 'all';
  const extraClasses = Array.isArray(options.extraClasses)
    ? options.extraClasses.filter(Boolean).map((item) => String(item).trim()).filter(Boolean)
    : [];
  const className = [
    'workspace-density-group',
    options.open ? 'workspace-density-open' : 'workspace-density-fold',
    `workspace-density-${escapeHtml(tone)}`,
    `portal-audience-${escapeHtml(audience)}`,
    ...extraClasses.map((item) => escapeHtml(item)),
  ].join(' ');
  const open = Boolean(options.open);
  if (open) {
    return `
      <section class="${className}">
        ${groupTitle ? `<div class="workspace-density-title">${escapeHtml(groupTitle)}</div>` : ''}
        ${groupCopy ? `<p class="workspace-density-copy">${escapeHtml(groupCopy)}</p>` : ''}
        ${validItems.join('\n')}
      </section>
    `;
  }
  return `
    <details class="${className}">
      <summary>${escapeHtml(summaryLabel)}</summary>
      ${groupCopy ? `<p class="workspace-density-copy">${escapeHtml(groupCopy)}</p>` : ''}
      ${validItems.join('\n')}
    </details>
  `;
}

function renderWorkspaceSectionLayout(stage, sections = {}, options = {}) {
  const layout = getWorkspaceLayoutConfig(stage, options);
  const sectionGroups = layout.sectionGroups || {};
  const groups = Object.fromEntries(
    Object.entries(sectionGroups).map(([key, group]) => {
      const items = toArray(group.sectionKeys).flatMap((sectionKey) => {
        const value = sections[sectionKey];
        return Array.isArray(value) ? value.filter(Boolean) : (value ? [value] : []);
      });
      return [key, renderWorkspaceDensityGroup(group.title, group.copy, items, {
        open: group.open,
        tone: group.tone,
        audience: group.audience,
        summaryLabel: group.summaryLabel,
        extraClasses: group.extraClasses,
      })];
    })
  );

  return toArray(layout.order).map((key) => groups[key]).filter(Boolean).join('\n');
}

function renderWorkspaceSection(options = {}) {
  const title = String(options.title || '').trim();
  if (!title) return '';
  const copy = String(options.copy || '').trim();
  const body = String(options.body || '').trim();
  const audience = String(options.audience || 'all').trim() || 'all';
  const extraClasses = Array.isArray(options.extraClasses)
    ? options.extraClasses.filter(Boolean).map((item) => String(item).trim()).filter(Boolean)
    : [];
  const className = [
    'section',
    `portal-audience-${escapeHtml(audience)}`,
    ...extraClasses.map((item) => escapeHtml(item)),
  ].join(' ');
  return `
    <section class="${className}">
      <h2>${escapeHtml(title)}</h2>
      ${copy ? `<p class="section-copy">${escapeHtml(copy)}</p>` : ''}
      ${body}
    </section>
  `;
}

function renderWorkspaceKeyValueSection(options = {}) {
  return renderWorkspaceSection({
    title: options.title,
    copy: options.copy,
    audience: options.audience,
    extraClasses: options.extraClasses,
    body: renderKeyValueGrid(options.items),
  });
}

function renderResolvedWorkspaceDecisionSection(section = {}, fallback = {}) {
  const resolved = resolveWorkspaceDecisionSectionData(section, fallback);
  return renderWorkspaceKeyValueSection({
    title: String(resolved?.title || '').trim() || String(fallback?.title || '').trim(),
    copy: String(resolved?.copy || '').trim() || String(fallback?.copy || '').trim(),
    items: Array.isArray(resolved?.items) ? resolved.items : [],
  });
}

function renderResolvedWorkspaceSummarySection(section = {}, fallback = {}, options = {}) {
  const resolved = buildWorkspaceSummarySectionData(section || {});
  const items = Array.isArray(resolved?.items) ? resolved.items : [];
  const enabled = (resolved?.enabled ?? options.defaultEnabled) !== false && items.length > 0;
  if (!enabled) return '';
  return renderWorkspaceKeyValueSection({
    title: String(resolved?.title || '').trim() || String(fallback?.title || '').trim(),
    copy: String(resolved?.copy || '').trim() || String(fallback?.copy || '').trim(),
    items,
  });
}

function renderWorkspaceGridSection(options = {}) {
  const title = String(options.title || '').trim();
  if (!title) return '';
  const copy = String(options.copy || '').trim();
  const gridClass = String(options.gridClass || '').trim() || 'entry-grid';
  const emptyText = String(options.emptyText || '').trim() || '暂无内容';
  const itemsHtml = Array.isArray(options.itemsHtml)
    ? options.itemsHtml.filter(Boolean).join('')
    : String(options.itemsHtml || '').trim();
  return `
    <section class="section portal-audience-${escapeHtml(String(options.audience || 'all').trim() || 'all')} ${escapeHtml(String(options.extraClass || '').trim())}">
      <h2>${escapeHtml(title)}</h2>
      ${copy ? `<p class="section-copy">${escapeHtml(copy)}</p>` : ''}
      <div class="${escapeHtml(gridClass)}">
        ${itemsHtml || `<div class="empty-state">${escapeHtml(emptyText)}</div>`}
      </div>
    </section>
  `;
}

function renderWorkspaceBodySection(options = {}) {
  const title = String(options.title || '').trim();
  if (!title) return '';
  const extraClasses = Array.isArray(options.extraClasses)
    ? options.extraClasses.filter(Boolean)
    : [];
  return renderWorkspaceSection({
    title,
    copy: String(options.copy || '').trim(),
    audience: options.audience,
    extraClasses,
    body: String(options.body || '').trim(),
  });
}

function renderWorkspaceAdvancedSection(options = {}) {
  const title = String(options.title || '').trim();
  if (!title) return '';
  const copy = String(options.copy || '').trim();
  const summary = String(options.summary || '').trim() || '展开查看';
  const body = String(options.body || '').trim();
  return `
    <section class="section">
      <h2>${escapeHtml(title)}</h2>
      ${copy ? `<p class="section-copy">${escapeHtml(copy)}</p>` : ''}
      <details class="advanced-panel">
        <summary>${escapeHtml(summary)}</summary>
        ${body}
      </details>
    </section>
  `;
}

function renderWorkspaceFlowSection(options = {}) {
  const title = String(options.title || '').trim();
  if (!title) return '';
  const copy = String(options.copy || '').trim();
  const mode = String(options.mode || 'full').trim() || 'full';
  const compactItems = [
    { label: '当前阶段', value: String(options.status || '').trim() || '未提供' },
    { label: '是否可继续', value: String(options.readiness || '').trim() || '未提供' },
    { label: '当前完成度', value: String(options.completion || '').trim() || '未提供' },
  ];
  const fullItems = [
    { label: '当前阶段', value: String(options.status || '').trim() || '未提供' },
    { label: '是否可继续', value: String(options.readiness || '').trim() || '未提供' },
    { label: '当前完成度', value: String(options.completion || '').trim() || '未提供' },
  ];
  const items = mode === 'compact' ? compactItems : fullItems;
  const blockers = toArray(options.blockers).filter(Boolean);
  const actions = toArray(options.availableActions).filter(Boolean);
  return renderWorkspaceSection({
    title,
    copy,
    body: `
      ${renderKeyValueGrid(items)}
      <div class="entry-grid" style="margin-top:14px;">
        <article class="entry-card tone-${blockers.length ? 'bad' : 'good'}">
          <div class="entry-kicker">阻塞条件</div>
          ${renderList(blockers, '当前没有明显阻塞')}
        </article>
        <article class="entry-card tone-info">
          <div class="entry-kicker">可执行动作</div>
          ${renderList(actions, '当前没有额外动作')}
        </article>
      </div>
    `,
  });
}

function renderWorkspaceAssetStatusSection(options = {}) {
  const title = String(options.title || '').trim();
  if (!title) return '';
  const copy = String(options.copy || '').trim();
  const readyLabel = String(options.readyLabel || '').trim() || '已可直接使用';
  const readySummary = String(options.readySummary || '').trim() || '当前已有可直接使用的资产';
  const pendingLabel = String(options.pendingLabel || '').trim() || '仍待确认';
  const pendingSummary = String(options.pendingSummary || '').trim() || '当前没有额外待确认资产';
  const items = toArray(options.items).filter((item) => item && item.label);
  const compactItems = items.slice(0, 4);
  return renderWorkspaceSection({
    title,
    copy,
    body: `
      <div class="entry-grid" style="margin-bottom:14px;">
        ${renderEntryCard({
          kicker: '已可直接使用',
          title: readyLabel,
          copy: readySummary,
          tone: 'good',
          hideLinkIfMissing: true,
        })}
        ${renderEntryCard({
          kicker: '仍待确认',
          title: pendingLabel,
          copy: pendingSummary,
          tone: items.some((item) => ['warn', 'bad'].includes(String(item.tone || '').trim())) ? 'warn' : 'info',
          hideLinkIfMissing: true,
        })}
      </div>
      ${renderKeyValueGrid(compactItems.map((item) => ({
        label: item.label,
        value: item.value,
      })))}
    `,
  });
}

function renderWorkspaceActionStatusSection(options = {}) {
  const title = String(options.title || '').trim();
  if (!title) return '';
  const copy = String(options.copy || '').trim() || '这里只负责页面内动作入口和补充跳转，不再重复解释当前结论。';
  const primary = options.primary || null;
  const secondary = toArray(options.secondary).filter((item) => item && item.title);
  const notes = toArray(options.notes).filter(Boolean);
  const fallbackItems = [
    ...secondary.map((item) => {
      const titleText = String(item.title || '').trim();
      const summaryText = String(item.summary || '').trim();
      return summaryText ? `${titleText}: ${summaryText}` : titleText;
    }),
    ...notes,
  ].filter(Boolean);
  return renderWorkspaceSection({
    title,
    copy,
    body: `
      <div class="entry-grid">
        ${primary ? `
          <article class="entry-card tone-${escapeHtml(primary.tone || 'good')} action-primary-card">
            <div class="entry-kicker">${escapeHtml(primary.kicker || '现在先做')}</div>
            <h3 class="entry-title">${escapeHtml(primary.title)}</h3>
            ${primary.summary ? `<p class="entry-copy">${escapeHtml(primary.summary)}</p>` : ''}
            <div class="entry-link">
              ${(primary.file || primary.href)
                ? `<a href="${escapeHtml(primary.file || primary.href)}">${escapeHtml(primary.cta || '现在进入')}</a>`
                : `<span>${escapeHtml(primary.pendingLabel || '本轮尚未生成')}</span>`}
            </div>
          </article>
        ` : ''}
        ${fallbackItems.length ? `
          <article class="entry-card tone-neutral">
            <div class="entry-kicker">备用入口</div>
            ${renderList(fallbackItems, '当前没有额外补充入口')}
          </article>
        ` : ''}
      </div>
    `,
  });
}

function renderWorkspaceJudgmentPanelSection(options = {}) {
  const title = String(options.title || '').trim();
  if (!title) return '';
  const copy = String(options.copy || '').trim() || '这里只解释当前为什么这样判断，以及继续前最值得留意什么。';
  const statusLabel = String(options.statusLabel || '').trim() || '当前判断';
  const statusSummary = String(options.statusSummary || '').trim() || '当前没有额外说明。';
  const statusTone = String(options.statusTone || 'info').trim() || 'info';
  const confirmItems = toArray(options.confirmItems).filter(Boolean).slice(0, 3);
  const noteItems = toArray(options.noteItems).filter(Boolean).slice(0, 3);
  return renderWorkspaceSection({
    title,
    copy,
    body: `
      <div class="workspace-judgment-grid">
        <article class="entry-card tone-${escapeHtml(statusTone)} workspace-judgment-hero">
          <div class="entry-kicker">当前判断</div>
          <h3 class="entry-title">${escapeHtml(statusLabel)}</h3>
          <p class="entry-copy">${escapeHtml(statusSummary)}</p>
        </article>
        <div class="workspace-judgment-side">
          <article class="entry-card tone-warn">
            <div class="entry-kicker">还差确认</div>
            ${renderList(confirmItems, '当前没有额外确认点')}
          </article>
          <article class="entry-card tone-neutral">
            <div class="entry-kicker">继续前提醒</div>
            ${renderList(noteItems, '当前没有额外提醒')}
          </article>
        </div>
      </div>
    `,
  });
}

function renderWorkspaceSessionConsoleSection(options = {}) {
  const title = String(options.title || '').trim();
  if (!title) return '';
  const copy = String(options.copy || '').trim();
  const items = toArray(options.items).filter((item) => item && item.label && item.value);
  if (!items.length) return '';
  return renderWorkspaceSection({
    title,
    copy,
    body: `
      <div class="workspace-session-grid">
        ${items.map((item) => `
          <article class="workspace-session-card tone-${escapeHtml(item.tone || 'neutral')}">
            <div class="workspace-session-label">${escapeHtml(item.label)}</div>
            <div class="workspace-session-value">${escapeHtml(item.value)}</div>
            ${item.summary ? `<div class="workspace-session-copy">${escapeHtml(item.summary)}</div>` : ''}
          </article>
        `).join('')}
      </div>
    `,
  });
}

function renderWorkspaceCockpitSummarySection(options = {}) {
  const title = String(options.title || '').trim() || '驾驶舱摘要';
  const copy = String(options.copy || '').trim() || '这里只保留当前局面和当前重点，避免和流程状态、状态栈重复。';
  const items = toArray(options.items).filter((item) => item && item.label && item.value);
  if (!items.length) return '';
  return renderWorkspaceSection({
    title,
    copy,
    body: `
      <div class="cockpit-grid">
        ${items.map((item) => `
          <article class="entry-card tone-${escapeHtml(item.tone || 'neutral')} cockpit-card">
            <div class="entry-kicker">${escapeHtml(item.label)}</div>
            <h3 class="entry-title">${escapeHtml(item.value)}</h3>
            ${item.summary ? `<p class="entry-copy">${escapeHtml(item.summary)}</p>` : ''}
            ${item.reply ? `<div class="cockpit-reply-group">
              <div class="workspace-inline-toolbar">
                <div class="cockpit-reply-label">回到对话框可直接说</div>
                <button type="button" class="workspace-copy-button" data-copy-text="${escapeHtml(item.reply)}">复制这句</button>
              </div>
              <div class="cockpit-reply-chip">${escapeHtml(item.reply)}</div>
            </div>` : ''}
          </article>
        `).join('')}
      </div>
    `,
  });
}

function renderWorkspaceConfirmationSection(options = {}) {
  const stageLabel = String(options.stageLabel || '').trim();
  if (!stageLabel) return '';
  const displayStageLabel = stageLabel.replace(/阶段确认/g, '阶段').trim();
  const title = String(options.title || '').trim() || '继续前确认';
  const copy = String(options.copy || '').trim() || '这里只看这一阶段现在能不能继续，以及继续前还差哪一个确认点。';
  const canContinue = Boolean(options.canContinue);
  const hasBlocking = Boolean(options.hasBlocking);
  const confirmedItems = toArray(options.confirmedItems).filter(Boolean);
  const pendingItems = toArray(options.pendingItems).filter(Boolean);
  const blockingItems = toArray(options.blockingItems).filter(Boolean);
  const recentEvent = options.recentEvent || null;
  const summary = String(options.summary || '').trim() || (canContinue ? '当前可以继续。' : '当前还不能继续。');
  const tone = hasBlocking ? 'bad' : (canContinue ? 'good' : 'warn');
  const stateLabel = hasBlocking ? '当前阻塞' : (canContinue ? '当前可继续' : '等待确认');
  const stateCopy = hasBlocking
    ? '这一阶段还有会直接卡住主链的问题，建议先处理阻塞项。'
    : (canContinue
      ? '这一阶段已经具备继续条件，可以顺着主链往下走。'
      : '这一阶段还差最后确认，确认后再继续更稳。');
  return renderWorkspaceSection({
    title,
    copy,
    body: `
      <article class="workspace-status-banner tone-${escapeHtml(tone)}">
        <div class="workspace-status-main">
          <div class="workspace-status-pill">${escapeHtml(stateLabel)}</div>
          <div class="workspace-status-summary">
            <h3>${escapeHtml(summary)}</h3>
            <p>${escapeHtml(stateCopy)}</p>
          </div>
        </div>
      </article>
      ${renderKeyValueGrid([
        { label: '当前阶段', value: displayStageLabel || stageLabel },
        { label: '是否可继续', value: canContinue ? '可以继续' : '先别继续' },
        { label: '待确认数', value: Number(options.pendingCount || pendingItems.length || 0) },
        { label: '阻塞数', value: Number(options.blockingCount || blockingItems.length || 0) },
      ])}
      <div class="entry-grid" style="margin-top:14px;">
        ${renderEntryCard({
          kicker: '当前结论',
          title: summary,
          copy: hasBlocking ? '当前还有阻塞项，建议先把会直接卡住主链的问题收掉。' : '当前主链条件已经比较明确，可以按推荐动作继续往下走。',
          tone,
          hideLinkIfMissing: true,
        })}
        ${renderEntryCard({
          kicker: '最近阶段变化',
          title: recentEvent?.title || '当前没有新的阶段变化',
          copy: recentEvent?.summary || '当前还没有额外的阶段事件需要同步。',
          tone: 'info',
          hideLinkIfMissing: true,
        })}
      </div>
      <div class="entry-grid" style="margin-top:14px;">
        <article class="entry-card tone-good">
          <div class="entry-kicker">已经确认</div>
          ${renderList(confirmedItems, '当前还没有额外确认项')}
        </article>
        <article class="entry-card tone-warn">
          <div class="entry-kicker">还待确认</div>
          ${renderList(pendingItems, '当前没有额外待确认项')}
        </article>
        <article class="entry-card tone-${hasBlocking ? 'bad' : 'info'}">
          <div class="entry-kicker">阻塞情况</div>
          ${renderList(blockingItems, hasBlocking ? '当前没有明确阻塞说明' : '当前没有明显阻塞')}
        </article>
      </div>
    `,
  });
}

function renderWorkspaceTimelineSection(options = {}) {
  const title = String(options.title || '').trim();
  if (!title) return '';
  const copy = String(options.copy || '').trim();
  const events = toArray(options.events).filter(Boolean);
  if (!events.length) {
    return renderWorkspaceSection({
      title,
      copy,
      body: '<div class="empty-state">当前还没有可展示的阶段变化。</div>',
    });
  }
  return renderWorkspaceSection({
    title,
    copy,
    body: `
      <div class="timeline-stack">
        ${events.map((event, index) => `
          <article class="entry-card tone-${event.tone || (String(event.type || '').includes('paused') ? 'warn' : (String(event.type || '').includes('completed') ? 'good' : 'info'))}">
            <div class="entry-kicker">阶段 ${index + 1}</div>
            <h3 class="entry-title">${escapeHtml(event.title || '未命名事件')}</h3>
            <p class="entry-copy">${escapeHtml(event.summary || '当前没有附加说明。')}</p>
            ${event.timeLabel || event.time ? `<div class="timeline-meta">${escapeHtml(event.timeLabel || event.time)}</div>` : ''}
          </article>
        `).join('')}
      </div>
    `,
  });
}

function uniqueTextItems(items = [], limit = 4) {
  const result = [];
  toArray(items).forEach((item) => {
    const value = String(item || '').trim();
    if (!value) return;
    if (!result.includes(value)) result.push(value);
  });
  return result.slice(0, limit);
}

function normalizeTextList(items) {
  return toArray(items)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function buildWorkspaceCollaborationSectionData(options = {}) {
  const confirmation = options.confirmation || {};
  const timeline = options.timeline || {};
  const dialogue = options.dialogue || {};
  const timelineEvents = toArray(timeline.events).filter(Boolean);
  const recentEvent = timelineEvents[timelineEvents.length - 1] || confirmation.recentEvent || null;
  const pendingItems = toArray(confirmation.pendingItems);
  const blockingItems = toArray(confirmation.blockingItems);
  const nextSayItems = uniqueTextItems(dialogue.nextSayItems, 4);
  const primarySay = String(
    options.primarySay
    || dialogue.primarySay
    || confirmation.recommendedReply
    || nextSayItems[0]
    || ''
  ).trim();
  return {
    title: String(options.title || '').trim() || '对话接力',
    copy: String(options.copy || '').trim() || '这里只补最近变化、继续前确认，以及回到对话框怎么继续。',
    recentTitle: String(options.recentTitle || '').trim() || '最近发生',
    recentSummary: String(options.recentSummary || recentEvent?.summary || timeline.copy || '').trim(),
    recentItems: uniqueTextItems(
      options.recentItems && toArray(options.recentItems).length
        ? options.recentItems
        : [recentEvent?.title, recentEvent?.summary, ...toArray(dialogue.recentItems)],
      3,
    ),
    confirmTitle: String(options.confirmTitle || '').trim() || '还差确认',
    confirmSummary: String(options.confirmSummary || confirmation.summary || dialogue.summary || '').trim(),
    confirmItems: uniqueTextItems(
      options.confirmItems && toArray(options.confirmItems).length
        ? options.confirmItems
        : [...pendingItems, ...blockingItems, ...toArray(dialogue.confirmItems)],
      4,
    ),
    replyTitle: String(options.replyTitle || '').trim() || '回到对话框这样说',
    primarySay,
    replyReason: String(options.replyReason || dialogue.actionReason || confirmation.summary || '').trim(),
    alternativeSayItems: uniqueTextItems(
      options.alternativeSayItems && toArray(options.alternativeSayItems).length
        ? options.alternativeSayItems
        : nextSayItems.filter((item) => item !== primarySay),
      3,
    ),
  };
}

function buildConfirmationStateFromUnifiedStatus(unifiedStatus = {}, fallback = {}) {
  const source = unifiedStatus && typeof unifiedStatus === 'object' ? unifiedStatus : {};
  const dialogue = source.dialogue && typeof source.dialogue === 'object' ? source.dialogue : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const pendingItems = Array.isArray(base.pendingItems) && base.pendingItems.length
    ? base.pendingItems
    : toArray(dialogue.confirmItems);
  const blockingItems = Array.isArray(base.blockingItems) && base.blockingItems.length
    ? base.blockingItems
    : [];
  return {
    ...base,
    stageLabel: String(base.stageLabel || source.stage || '').trim(),
    recommendedReply: String(base.recommendedReply || dialogue.primarySay || '').trim(),
    summary: String(base.summary || dialogue.summary || dialogue.actionReason || source.progress || '').trim(),
    pendingItems,
    blockingItems,
    pendingCount: Number(base.pendingCount ?? pendingItems.length ?? 0),
    blockingCount: Number(base.blockingCount ?? blockingItems.length ?? 0),
  };
}

function buildCollaborationFromUnifiedStatus(unifiedStatus = {}, options = {}) {
  const source = unifiedStatus && typeof unifiedStatus === 'object' ? unifiedStatus : {};
  const dialogue = source.dialogue && typeof source.dialogue === 'object' ? source.dialogue : {};
  return buildWorkspaceCollaborationSectionData({
    ...options,
    confirmation: buildConfirmationStateFromUnifiedStatus(source, options.confirmation || {}),
    dialogue: {
      ...(options.dialogue && typeof options.dialogue === 'object' ? options.dialogue : {}),
      primarySay: String(options.dialogue?.primarySay || dialogue.primarySay || '').trim(),
      actionReason: String(options.dialogue?.actionReason || dialogue.actionReason || '').trim(),
      summary: String(options.dialogue?.summary || dialogue.summary || '').trim(),
      nextSayItems: Array.isArray(options.dialogue?.nextSayItems) && options.dialogue.nextSayItems.length
        ? options.dialogue.nextSayItems
        : toArray(dialogue.nextSayItems),
      alternativeSayItems: Array.isArray(options.dialogue?.alternativeSayItems) && options.dialogue.alternativeSayItems.length
        ? options.dialogue.alternativeSayItems
        : toArray(dialogue.alternativeSayItems),
      confirmItems: Array.isArray(options.dialogue?.confirmItems) && options.dialogue.confirmItems.length
        ? options.dialogue.confirmItems
        : toArray(dialogue.confirmItems),
    },
  });
}

function buildStageRelayFromUnifiedStatus(unifiedStatus = {}, options = {}) {
  const source = unifiedStatus && typeof unifiedStatus === 'object' ? unifiedStatus : {};
  const nextAction = source.nextAction && typeof source.nextAction === 'object' ? source.nextAction : {};
  const dialogue = source.dialogue && typeof source.dialogue === 'object' ? source.dialogue : {};
  return buildWorkspaceStageRelayData({
    ...options,
    currentLabel: String(options.currentLabel || source.conclusion || '').trim(),
    currentSummary: String(options.currentSummary || source.currentFocus || source.progress || '').trim(),
    nextLabel: String(options.nextLabel || nextAction.label || '').trim(),
    nextSummary: String(options.nextSummary || nextAction.reason || '').trim(),
    nextItems: Array.isArray(options.nextItems) && options.nextItems.length
      ? options.nextItems
      : (toArray(dialogue.confirmItems).length ? toArray(dialogue.confirmItems) : toArray(dialogue.alternativeSayItems)),
  });
}

function buildWorkflowContractPageState(workflowContract, options = {}) {
  const contract = workflowContract && typeof workflowContract === 'object' ? workflowContract : {};
  const snapshot = contract.snapshot && typeof contract.snapshot === 'object' ? contract.snapshot : {};
  const nextAction = contract.nextAction && typeof contract.nextAction === 'object' ? contract.nextAction : {};
  const dialogue = contract.dialogue && typeof contract.dialogue === 'object' ? contract.dialogue : {};
  const confirmation = contract.confirmation && typeof contract.confirmation === 'object' ? contract.confirmation : {};
  const currentJudgment = contract.currentJudgment && typeof contract.currentJudgment === 'object' ? contract.currentJudgment : {};
  const relay = contract.relay && typeof contract.relay === 'object' ? contract.relay : {};
  const recent = contract.recent && typeof contract.recent === 'object' ? contract.recent : {};
  const fallbackTaskControlBar = options.taskControlBar && typeof options.taskControlBar === 'object' ? options.taskControlBar : {};
  const fallbackDialogue = options.dialogueStatus && typeof options.dialogueStatus === 'object' ? options.dialogueStatus : {};
  const fallbackConfirmation = options.confirmation && typeof options.confirmation === 'object' ? options.confirmation : {};
  const fallbackStageRelay = options.stageRelay && typeof options.stageRelay === 'object' ? options.stageRelay : {};
  const fallbackCollaboration = options.collaboration && typeof options.collaboration === 'object' ? options.collaboration : {};
  const fallbackNextAction = options.nextAction && typeof options.nextAction === 'object' ? options.nextAction : {};
  const fallbackSessionConsole = options.sessionConsole && typeof options.sessionConsole === 'object' ? options.sessionConsole : {};
  const primarySay = String(
    dialogue.primarySay
    || dialogue.recommendedReply
    || nextAction.recommendedReply
    || fallbackDialogue.primarySay
    || fallbackConfirmation.recommendedReply
    || ''
  ).trim();
  const actionReason = String(
    dialogue.replyReason
    || nextAction.reason
    || currentJudgment.actionSummary
    || currentJudgment.statusSummary
    || fallbackDialogue.actionReason
    || fallbackTaskControlBar.progressSummary
    || ''
  ).trim();
  const dialogueSummary = String(
    dialogue.summary
    || confirmation.summary
    || currentJudgment.statusSummary
    || actionReason
    || fallbackDialogue.summary
    || ''
  ).trim();
  const confirmItems = normalizeTextList(
    currentJudgment.confirmItems && currentJudgment.confirmItems.length
      ? currentJudgment.confirmItems
      : confirmation.pendingItems
  );
  const alternativeSayItems = uniqueTextItems(
    normalizeTextList(dialogue.alternativeSayItems).concat(
      normalizeTextList(dialogue.directReplies).filter((item) => item !== primarySay)
    ),
    4,
  );
  const nextSayItems = uniqueTextItems(
    [
      primarySay,
      ...normalizeTextList(dialogue.directReplies),
      ...alternativeSayItems,
    ],
    5,
  );
  const resolvedConfirmation = {
    ...fallbackConfirmation,
    stageLabel: String(
      fallbackConfirmation.stageLabel
      || confirmation.stageLabel
      || snapshot.stageLabel
      || ''
    ).trim(),
    summary: String(
      fallbackConfirmation.summary
      || confirmation.summary
      || dialogueSummary
      || ''
    ).trim(),
    pendingItems: normalizeTextList(
      Array.isArray(fallbackConfirmation.pendingItems) && fallbackConfirmation.pendingItems.length
        ? fallbackConfirmation.pendingItems
        : confirmation.pendingItems
    ),
    blockingItems: normalizeTextList(
      Array.isArray(fallbackConfirmation.blockingItems) && fallbackConfirmation.blockingItems.length
        ? fallbackConfirmation.blockingItems
        : confirmation.blockingItems
    ),
    confirmedItems: normalizeTextList(
      Array.isArray(fallbackConfirmation.confirmedItems) && fallbackConfirmation.confirmedItems.length
        ? fallbackConfirmation.confirmedItems
        : confirmation.confirmedItems
    ),
    canContinue: fallbackConfirmation.canContinue !== undefined
      ? Boolean(fallbackConfirmation.canContinue)
      : Boolean(confirmation.canContinue),
    hasBlocking: fallbackConfirmation.hasBlocking !== undefined
      ? Boolean(fallbackConfirmation.hasBlocking)
      : Boolean(confirmation.hasBlocking),
    recommendedReply: String(
      fallbackConfirmation.recommendedReply
      || primarySay
      || nextAction.recommendedReply
      || ''
    ).trim(),
  };
  resolvedConfirmation.pendingCount = Number(
    fallbackConfirmation.pendingCount ?? resolvedConfirmation.pendingItems.length ?? 0
  );
  resolvedConfirmation.blockingCount = Number(
    fallbackConfirmation.blockingCount ?? resolvedConfirmation.blockingItems.length ?? 0
  );

  const resolvedDialogueStatus = {
    ...fallbackDialogue,
    primarySay: String(fallbackDialogue.primarySay || primarySay || '').trim(),
    actionReason,
    summary: String(fallbackDialogue.summary || dialogueSummary || '').trim(),
    nextSayItems: Array.isArray(fallbackDialogue.nextSayItems) && fallbackDialogue.nextSayItems.length
      ? fallbackDialogue.nextSayItems
      : nextSayItems,
    alternativeSayItems: Array.isArray(fallbackDialogue.alternativeSayItems) && fallbackDialogue.alternativeSayItems.length
      ? fallbackDialogue.alternativeSayItems
      : alternativeSayItems,
    confirmItems: Array.isArray(fallbackDialogue.confirmItems) && fallbackDialogue.confirmItems.length
      ? fallbackDialogue.confirmItems
      : confirmItems,
  };

  const resolvedNextAction = {
    ...fallbackNextAction,
    label: String(fallbackNextAction.label || nextAction.label || snapshot.nextActionLabel || '').trim(),
    reason: String(
      fallbackNextAction.reason
      || nextAction.reason
      || nextAction.summary
      || snapshot.nextActionSummary
      || actionReason
      || ''
    ).trim(),
    summary: String(
      fallbackNextAction.summary
      || nextAction.summary
      || snapshot.nextActionSummary
      || currentJudgment.actionSummary
      || ''
    ).trim(),
    recommendedReply: String(
      fallbackNextAction.recommendedReply
      || nextAction.recommendedReply
      || primarySay
      || ''
    ).trim(),
    notes: Array.isArray(fallbackNextAction.notes) && fallbackNextAction.notes.length
      ? fallbackNextAction.notes
      : normalizeTextList(nextAction.notes),
  };

  const resolvedTaskControlBar = finalizeTaskControlBar({
    ...fallbackTaskControlBar,
    taskLabel: String(fallbackTaskControlBar.taskLabel || snapshot.taskLabel || '').trim(),
    stageLabel: String(fallbackTaskControlBar.stageLabel || snapshot.stageLabel || '').trim(),
    nextActionLabel: String(fallbackTaskControlBar.nextActionLabel || resolvedNextAction.label || '').trim(),
    nextActionSummary: String(
      fallbackTaskControlBar.nextActionSummary
      || resolvedNextAction.reason
      || resolvedNextAction.summary
      || ''
    ).trim(),
  }, {
    primarySay: resolvedDialogueStatus.primarySay || resolvedConfirmation.recommendedReply || '',
    progressLabel: fallbackTaskControlBar.progressLabel || currentJudgment.statusLabel || snapshot.statusLabel || '当前判断',
    progressSummary: fallbackTaskControlBar.progressSummary || currentJudgment.statusSummary || dialogueSummary || '',
    progressTone: fallbackTaskControlBar.progressTone || options.progressTone || 'info',
  });

  const resolvedStageRelay = buildWorkspaceStageRelayData({
    ...fallbackStageRelay,
    previousLabel: String(fallbackStageRelay.previousLabel || relay.previous || '').trim(),
    currentLabel: String(
      fallbackStageRelay.currentLabel
      || relay.current
      || currentJudgment.statusLabel
      || snapshot.statusLabel
      || ''
    ).trim(),
    nextLabel: String(
      fallbackStageRelay.nextLabel
      || relay.next
      || resolvedNextAction.label
      || snapshot.nextActionLabel
      || ''
    ).trim(),
    currentSummary: String(
      fallbackStageRelay.currentSummary
      || relay.currentSummary
      || currentJudgment.statusSummary
      || dialogueSummary
      || ''
    ).trim(),
    nextSummary: String(
      fallbackStageRelay.nextSummary
      || relay.nextSummary
      || resolvedNextAction.reason
      || resolvedNextAction.summary
      || ''
    ).trim(),
    nextItems: Array.isArray(fallbackStageRelay.nextItems) && fallbackStageRelay.nextItems.length
      ? fallbackStageRelay.nextItems
      : confirmItems,
  });

  const resolvedCollaboration = buildWorkspaceCollaborationSectionData({
    ...fallbackCollaboration,
    confirmation: resolvedConfirmation,
    dialogue: resolvedDialogueStatus,
    recentItems: Array.isArray(fallbackCollaboration.recentItems) && fallbackCollaboration.recentItems.length
      ? fallbackCollaboration.recentItems
      : [recent.title, recent.summary].filter(Boolean),
    recentSummary: fallbackCollaboration.recentSummary || recent.summary || '',
    primarySay: fallbackCollaboration.primarySay || resolvedDialogueStatus.primarySay || '',
    replyReason: fallbackCollaboration.replyReason || resolvedDialogueStatus.actionReason || '',
  });

  return {
    nextAction: resolvedNextAction,
    dialogueStatus: resolvedDialogueStatus,
    confirmation: resolvedConfirmation,
    taskControlBar: resolvedTaskControlBar,
    stageRelay: resolvedStageRelay,
    collaboration: resolvedCollaboration,
    sessionConsole: {
      ...fallbackSessionConsole,
      title: String(
        fallbackSessionConsole.title
        || fallbackSessionConsole.sessionTitle
        || contract.console?.sessionTitle
        || ''
      ).trim(),
      items: Array.isArray(fallbackSessionConsole.items) ? fallbackSessionConsole.items : [],
    },
  };
}

function adaptWorkflowCopilot(workflowCopilot, fallback = {}) {
  const source = workflowCopilot && typeof workflowCopilot === 'object' ? workflowCopilot : {};
  const stageKey = String(source.stageKey || fallback.stageKey || '').trim() || 'home';
  const language = getWorkflowCopilotLanguage(stageKey);
  const relay = source.relay && typeof source.relay === 'object' ? source.relay : {};
  const rhythm = source.rhythm && typeof source.rhythm === 'object' ? source.rhythm : {};
  const reply = (source.reply && typeof source.reply === 'object'
    ? source.reply
    : (source.replyCadence && typeof source.replyCadence === 'object' ? source.replyCadence : {}));
  const action = source.action && typeof source.action === 'object' ? source.action : {};
  const coordination = source.coordination && typeof source.coordination === 'object' ? source.coordination : {};
  const checkpoints = source.checkpoints && typeof source.checkpoints === 'object' ? source.checkpoints : {};
  const consoleState = source.console && typeof source.console === 'object' ? source.console : {};
  const fallbackDialogue = fallback.dialogueStatus && typeof fallback.dialogueStatus === 'object' ? fallback.dialogueStatus : {};
  const fallbackConfirmation = fallback.confirmation && typeof fallback.confirmation === 'object' ? fallback.confirmation : {};
  const fallbackTimeline = fallback.timeline && typeof fallback.timeline === 'object' ? fallback.timeline : {};
  const recommendedReply = String(
    reply.recommendedReply
    || reply.primarySay
    || rhythm.recommendedReply
    || rhythm.primarySay
    || fallbackDialogue.primarySay
    || fallbackConfirmation.recommendedReply
    || ''
  ).trim();
  const dialogueStatus = {
    ...fallbackDialogue,
    ...(relay.dialogueStatus && typeof relay.dialogueStatus === 'object' ? relay.dialogueStatus : {}),
    primarySay: String(
      reply.primarySay
      || rhythm.primarySay
      || relay.dialogueStatus?.primarySay
      || fallbackDialogue.primarySay
      || recommendedReply
      || ''
    ).trim(),
    nextSayItems: toArray(
      relay.dialogueStatus?.nextSayItems && toArray(relay.dialogueStatus.nextSayItems).length
        ? relay.dialogueStatus.nextSayItems
        : [reply.primarySay, recommendedReply, ...toArray(reply.directReplies), ...toArray(rhythm.directReplies)]
    ).filter(Boolean),
    alternativeSayItems: toArray(
      relay.dialogueStatus?.alternativeSayItems && toArray(relay.dialogueStatus.alternativeSayItems).length
        ? relay.dialogueStatus.alternativeSayItems
        : (toArray(reply.alternativeSayItems).length ? reply.alternativeSayItems : rhythm.alternativeSayItems)
    ).filter(Boolean),
    summary: String(
      relay.dialogueStatus?.summary
      || rhythm.summary
      || fallbackDialogue.summary
      || checkpoints.summary
      || ''
    ).trim(),
    actionReason: String(
      relay.dialogueStatus?.actionReason
      || reply.replyReason
      || rhythm.replyReason
      || fallbackDialogue.actionReason
      || language.dialogueActionReason
      || checkpoints.summary
      || ''
    ).trim(),
    confirmItems: [],
  };
  const baseTaskControlBar = consoleState.taskControlBar && typeof consoleState.taskControlBar === 'object'
    ? { ...consoleState.taskControlBar }
    : (fallback.taskControlBar && typeof fallback.taskControlBar === 'object' ? { ...fallback.taskControlBar } : null);
  if (baseTaskControlBar) {
    baseTaskControlBar.primarySay = String(
      baseTaskControlBar.primarySay
      || dialogueStatus.primarySay
      || recommendedReply
      || ''
    ).trim();
    baseTaskControlBar.progressLabel = String(
      baseTaskControlBar.progressLabel
      || ''
    ).trim();
    baseTaskControlBar.progressSummary = String(
      baseTaskControlBar.progressSummary
      || action.summary
      || action.actionReason
      || ''
    ).trim();
  }

  return {
    language,
    taskControlBar: baseTaskControlBar,
    sessionConsole: consoleState.sessionConsole || fallback.sessionConsole || null,
    signalBar: toArray(consoleState.signalBar).length
      ? {
        title: '阶段信号',
        copy: '这里用统一信号说明当前阶段、状态、压力和下一步。',
        items: toArray(consoleState.signalBar),
      }
      : (fallback.signalBar || null),
    statusStack: toArray(consoleState.statusStack).length
      ? {
        title: '工作流状态栈',
        copy: '这里把当前阶段最关键的流程状态收成统一状态栈。',
        items: toArray(consoleState.statusStack),
      }
      : (fallback.statusStack || null),
    cockpitSummary: consoleState.cockpitSummary || fallback.cockpitSummary || null,
    action: {
      label: String(
        action.label
        || fallback.taskControlBar?.nextActionLabel
        || ''
      ).trim(),
      summary: String(
        action.summary
        || fallback.taskControlBar?.nextActionSummary
        || ''
      ).trim(),
      recommendedReply,
      actionReason: String(
        action.actionReason
        || reply.replyReason
        || rhythm.replyReason
        || fallbackDialogue.actionReason
        || checkpoints.summary
        || ''
      ).trim(),
      primary: action.primary || null,
      secondary: toArray(action.secondary),
      notes: toArray(action.notes),
    },
    judgment: relay.judgment || fallback.judgment || null,
    stageRelay: relay.stageRelay || fallback.stageRelay || null,
    dialogueStatus,
    collaboration: buildWorkspaceCollaborationSectionData({
      ...coordination,
      confirmation: {
        ...fallbackConfirmation,
        stageLabel: fallbackConfirmation.stageLabel || fallback.stageLabel || fallback.taskControlBar?.stageLabel || '',
        recommendedReply: fallbackConfirmation.recommendedReply || recommendedReply || dialogueStatus.primarySay,
        confirmedItems: toArray(checkpoints.confirmedItems).length ? checkpoints.confirmedItems : fallbackConfirmation.confirmedItems,
        pendingItems: toArray(checkpoints.pendingItems).length ? checkpoints.pendingItems : fallbackConfirmation.pendingItems,
        blockingItems: toArray(checkpoints.blockingItems).length ? checkpoints.blockingItems : fallbackConfirmation.blockingItems,
        canContinue: typeof checkpoints.canContinue === 'boolean' ? checkpoints.canContinue : fallbackConfirmation.canContinue,
        hasBlocking: typeof checkpoints.hasBlocking === 'boolean' ? checkpoints.hasBlocking : fallbackConfirmation.hasBlocking,
        summary: String(checkpoints.summary || fallbackConfirmation.summary || '').trim(),
        recentEvent: relay.recentEvent || fallbackConfirmation.recentEvent || null,
      },
      timeline: fallbackTimeline,
      dialogue: dialogueStatus,
      primarySay: String(coordination.primarySay || reply.primarySay || dialogueStatus.primarySay || '').trim(),
      replyReason: String(coordination.replyReason || reply.replyReason || rhythm.replyReason || dialogueStatus.actionReason || checkpoints.summary || '').trim(),
      alternativeSayItems: toArray(coordination.alternativeSayItems).length
        ? coordination.alternativeSayItems
        : (toArray(reply.alternativeSayItems).length ? reply.alternativeSayItems : dialogueStatus.alternativeSayItems),
    }),
  };
}

function buildWorkspaceStageRelayData(options = {}) {
  return {
    title: String(options.title || '').trim() || '阶段接力',
    copy: String(options.copy || '').trim() || '这里把上一站交接、这一站职责和完成后的去向收成同一块统一接力面板。',
    previousTitle: String(options.previousTitle || '').trim() || '上一站交来',
    previousLabel: String(options.previousLabel || '').trim() || '当前没有上一站交接',
    previousSummary: String(options.previousSummary || '').trim() || '当前没有额外说明。',
    previousItems: toArray(options.previousItems).filter(Boolean),
    currentTitle: String(options.currentTitle || '').trim() || '这一站负责',
    currentLabel: String(options.currentLabel || '').trim() || '继续当前主链',
    currentSummary: String(options.currentSummary || '').trim() || '按当前主判断继续即可。',
    currentItems: toArray(options.currentItems).filter(Boolean),
    nextTitle: String(options.nextTitle || '').trim() || '完成后送去',
    nextLabel: String(options.nextLabel || '').trim() || '继续下一步',
    nextSummary: String(options.nextSummary || '').trim() || '完成这一站后继续主链。',
    nextItems: toArray(options.nextItems).filter(Boolean),
  };
}

function buildWorkspaceCockpitSummaryData(options = {}) {
  return {
    title: String(options.title || '').trim() || '驾驶舱摘要',
    copy: String(options.copy || '').trim() || '这里只解释当前结论、当前重点和阻塞情况，不重复上方动作建议。',
    items: toArray(options.items).filter((item) => item && item.label && item.value),
  };
}

function buildWorkspaceDecisionSectionData(options = {}) {
  return {
    title: String(options.title || '').trim() || '当前判断',
    copy: String(options.copy || '').trim() || '这里只解释为什么当前这样判断，以及如果暂不处理会卡在哪。',
    items: toArray(options.items).filter((item) => item && item.label && item.value),
  };
}

function buildWorkspaceDecisionItems(options = {}) {
  const reasonLabel = String(options.reasonLabel || '').trim() || '为什么当前这样判断';
  const riskLabel = String(options.riskLabel || '').trim() || '如果暂不处理，主要风险是什么';
  const pageLabel = String(options.pageLabel || '').trim() || '这一页为什么现在最值得看';
  const reasonValue = String(options.reasonValue || '').trim();
  const riskValue = String(options.riskValue || '').trim();
  const pageValue = String(options.pageValue || '').trim();
  return [
    reasonValue ? { label: reasonLabel, value: reasonValue } : null,
    riskValue ? { label: riskLabel, value: riskValue } : null,
    pageValue ? { label: pageLabel, value: pageValue } : null,
  ].filter(Boolean);
}

function buildWorkspaceSummarySectionData(options = {}) {
  return {
    enabled: options.enabled !== false,
    title: String(options.title || '').trim() || '任务摘要',
    copy: String(options.copy || '').trim() || '这里保留当前阶段真正需要的补充信息。',
    items: toArray(options.items).filter((item) => item && item.label && item.value !== undefined && item.value !== null && String(item.value).trim() !== ''),
  };
}

function buildWorkspaceHeroCardsData(options = {}) {
  return toArray(options.cards).filter((item) => item && item.label && item.value !== undefined && item.value !== null && String(item.value).trim() !== '');
}

function buildWorkspacePreviewSectionData(options = {}) {
  return {
    enabled: options.enabled !== false,
    title: String(options.title || '').trim() || '图片速览',
    copy: String(options.copy || '').trim() || '这里先给你一个缩略速览，帮助你快速接上当前判断。',
    emptyText: String(options.emptyText || '').trim() || '当前还没有可展示的成功结果。',
    itemFallbackSummary: String(options.itemFallbackSummary || '').trim() || '这一张可以继续做保留、复核或淘汰判断。',
    imageLinkLabel: String(options.imageLinkLabel || '').trim() || '查看原图',
    imageMissingText: String(options.imageMissingText || '').trim() || '本轮未生成预览图',
    items: toArray(options.items).filter(Boolean),
  };
}

function buildWorkspaceIssuesSectionData(options = {}) {
  return {
    title: String(options.title || '').trim() || '异常摘要',
    copy: String(options.copy || '').trim() || '这里只保留真正值得继续判断的问题，不让内部记录打断主链。',
    emptyText: String(options.emptyText || '').trim() || '当前没有需要单独处理的问题。',
    kicker: String(options.kicker || '').trim() || '需要关注',
    fallbackReason: String(options.fallbackReason || '').trim() || '建议回异常工作台统一处理。',
    failedFallbackSummary: String(options.failedFallbackSummary || '').trim() || '这一项在执行时没有稳定完成。',
    reviewFallbackSummary: String(options.reviewFallbackSummary || '').trim() || '这一项建议人工再看一眼，确认边界、融合和主体稳定度。',
    items: toArray(options.items).filter(Boolean),
  };
}

function buildWorkspaceAdvancedSectionData(options = {}) {
  return {
    title: String(options.title || '').trim() || '高级信息',
    copy: String(options.copy || '').trim() || '这些信息主要用于补充理解，不再默认占据主视觉。',
    summary: String(options.summary || '').trim() || '展开查看结构分布',
    requestModeTitle: String(options.requestModeTitle || '').trim() || '请求方式分布',
    styleTitle: String(options.styleTitle || '').trim() || '风格分布',
    slotRoleTitle: String(options.slotRoleTitle || '').trim() || '槽位角色分布',
    emptyText: String(options.emptyText || '').trim() || '当前没有可展示的分布',
    groups: toArray(options.groups).filter(Boolean),
  };
}

function buildWorkspaceDirectionSectionData(options = {}) {
  return {
    title: String(options.title || '').trim() || '任务方向',
    copy: String(options.copy || '').trim() || '这里保留普通用户真正需要看的方向信息，不直接把程序字段和内部产物名堆出来。',
    items: toArray(options.items).filter((item) => item && item.label),
  };
}

function buildWorkspaceReadinessSectionData(options = {}) {
  return {
    title: String(options.title || '').trim() || '执行判断',
    copy: String(options.copy || '').trim() || '先判断能不能开跑，再决定是直接继续还是先收一轮。',
    blockingTitle: String(options.blockingTitle || '').trim() || '阻塞清单',
    cautionTitle: String(options.cautionTitle || '').trim() || '提醒清单',
    blockingItems: toArray(options.blockingItems).filter(Boolean),
    cautionItems: toArray(options.cautionItems).filter(Boolean),
    blockingEmptyText: String(options.blockingEmptyText || '').trim() || '当前没有硬阻塞',
    cautionEmptyText: String(options.cautionEmptyText || '').trim() || '当前没有明显提醒项',
  };
}

function buildWorkspaceAssetsSectionData(options = {}) {
  return {
    title: String(options.title || '').trim() || '素材绑定',
    copy: String(options.copy || '').trim() || '只有存在参考图、遮罩图或槽位绑定时，这部分才需要重点看。',
    items: toArray(options.items).filter((item) => item && item.label),
    assetItems: toArray(options.assetItems).filter(Boolean),
  };
}

function resolveWorkspaceSectionItems(sectionItems, fallbackItems) {
  return Array.isArray(sectionItems) && sectionItems.length
    ? sectionItems
    : toArray(fallbackItems);
}

function resolveWorkspaceGuideSectionData(section = {}, fallback = {}) {
  return buildWorkspaceGuideSectionData({
    title: section.title || fallback.title,
    copy: section.copy || fallback.copy,
    items: resolveWorkspaceSectionItems(section.items, fallback.items),
  });
}

function resolveWorkspaceDirectionSectionData(section = {}, fallback = {}) {
  return buildWorkspaceDirectionSectionData({
    title: section.title || fallback.title,
    copy: section.copy || fallback.copy,
    items: resolveWorkspaceSectionItems(section.items, fallback.items),
  });
}

function resolveWorkspaceAssetsSectionData(section = {}, fallback = {}) {
  return buildWorkspaceAssetsSectionData({
    title: section.title || fallback.title,
    copy: section.copy || fallback.copy,
    items: resolveWorkspaceSectionItems(section.items, fallback.items),
    assetItems: Array.isArray(section.assetItems) ? section.assetItems : toArray(fallback.assetItems),
  });
}

function resolveWorkspaceReadinessSectionData(section = {}, fallback = {}) {
  return buildWorkspaceReadinessSectionData({
    title: section.title || fallback.title,
    copy: section.copy || fallback.copy,
    blockingTitle: section.blockingTitle || fallback.blockingTitle,
    cautionTitle: section.cautionTitle || fallback.cautionTitle,
    blockingItems: Array.isArray(section.blockingItems) ? section.blockingItems : toArray(fallback.blockingItems),
    cautionItems: Array.isArray(section.cautionItems) ? section.cautionItems : toArray(fallback.cautionItems),
    blockingEmptyText: section.blockingEmptyText || fallback.blockingEmptyText,
    cautionEmptyText: section.cautionEmptyText || fallback.cautionEmptyText,
  });
}

function resolveWorkspaceIssuesSectionData(section = {}, fallback = {}) {
  return buildWorkspaceIssuesSectionData({
    title: section.title || fallback.title,
    copy: section.copy || fallback.copy,
    emptyText: section.emptyText || fallback.emptyText,
    kicker: section.kicker || fallback.kicker,
    fallbackReason: section.fallbackReason || fallback.fallbackReason,
    failedFallbackSummary: section.failedFallbackSummary || fallback.failedFallbackSummary,
    reviewFallbackSummary: section.reviewFallbackSummary || fallback.reviewFallbackSummary,
    items: Array.isArray(section.items) ? section.items : toArray(fallback.items),
  });
}

function resolveWorkspaceDecisionSectionData(section = {}, fallback = {}) {
  return buildWorkspaceDecisionSectionData({
    title: section.title || fallback.title,
    copy: section.copy || fallback.copy,
    items: resolveWorkspaceSectionItems(section.items, fallback.items),
  });
}

function resolveWorkspaceSummarySectionData(section = {}, fallback = {}) {
  return buildWorkspaceSummarySectionData({
    enabled: section.enabled !== undefined ? section.enabled : fallback.enabled,
    title: section.title || fallback.title,
    copy: section.copy || fallback.copy,
    items: resolveWorkspaceSectionItems(section.items, fallback.items),
  });
}

function resolveWorkspaceViewSummarySection(viewState = {}, fallback = {}) {
  const source = viewState && typeof viewState === 'object' ? viewState : {};
  return resolveWorkspaceSummarySectionData(source.summary || {}, fallback);
}

function resolveWorkspaceStageSummarySection(pageState = {}, stage = 'home', viewState = {}, fallback = {}) {
  return resolveWorkspaceViewSummarySection(
    resolveWorkspaceStageView(pageState, stage, viewState),
    fallback
  );
}

function buildWorkspaceGuideSectionData(options = {}) {
  return {
    title: String(options.title || '').trim() || '主链接力说明',
    copy: String(options.copy || '').trim() || '这里只保留当前任务真正需要的主链说明，不把内部结构直接摊给用户。',
    items: toArray(options.items).filter((item) => item && item.label),
  };
}

function buildWorkspaceContextBarData(options = {}) {
  return {
    items: Array.isArray(options.items) ? options.items : [],
    runLabel: String(options.runLabel || '').trim() || '',
    phaseLabel: String(options.phaseLabel || '').trim() || '',
    flowLabel: String(options.flowLabel || '').trim() || '',
    counts: toArray(options.counts).filter(Boolean),
    hints: toArray(options.hints).filter(Boolean),
  };
}

function resolveWorkspaceContextBarData(stage, section = {}, fallback = {}) {
  const source = section && typeof section === 'object' ? section : {};
  const fallbackFlowLabel = String(fallback.flowLabel || '').trim();
  const fallbackCounts = buildWorkspaceContextCounts(stage, fallback.countValues || {}, fallback.counts || []);
  const fallbackHints = buildWorkspaceContextHints(stage, source.hints, fallback.hints || []);

  return buildWorkspaceContextBarData({
    items: Array.isArray(source.items) ? source.items : toArray(fallback.items),
    runLabel: String(source.runLabel || '').trim() || String(fallback.runLabel || '').trim(),
    phaseLabel: String(source.phaseLabel || '').trim() || String(fallback.phaseLabel || '').trim(),
    flowLabel: String(source.flowLabel || '').trim() || fallbackFlowLabel,
    counts: Array.isArray(source.counts) && source.counts.length ? source.counts : fallbackCounts,
    hints: fallbackHints,
  });
}

function resolveWorkspaceViewContextBarData(stage, viewState = {}, fallback = {}) {
  const source = viewState && typeof viewState === 'object' ? viewState : {};
  return resolveWorkspaceContextBarData(stage, source.context || {}, fallback);
}

function resolveWorkspaceStageView(pageState = {}, stage = 'home', fallbackView = {}) {
  const stageKey = String(stage || '').trim() || 'home';
  const state = pageState && typeof pageState === 'object' ? pageState : {};
  const stateView = state.views?.[stageKey] && typeof state.views[stageKey] === 'object'
    ? state.views[stageKey]
    : {};
  const fallback = fallbackView && typeof fallbackView === 'object' ? fallbackView : {};
  if (Object.keys(stateView).length) {
    return {
      ...fallback,
      ...stateView,
    };
  }
  return fallback;
}

function resolveWorkspaceStageContextBarData(pageState = {}, stage = 'home', viewState = {}, fallback = {}) {
  return resolveWorkspaceViewContextBarData(
    stage,
    resolveWorkspaceStageView(pageState, stage, viewState),
    fallback
  );
}

function resolveWorkspaceStageSessionConsole(pageState = {}, stage = 'home', viewState = {}) {
  const stageKey = String(stage || '').trim() || 'home';
  const state = pageState && typeof pageState === 'object' ? pageState : {};
  const view = resolveWorkspaceStageView(state, stageKey, viewState);
  const workflowSession = state.workflowSessions?.[stageKey] && typeof state.workflowSessions[stageKey] === 'object'
    ? state.workflowSessions[stageKey]
    : {};
  const workflowSessionConsole = workflowSession.console?.sessionConsole && typeof workflowSession.console.sessionConsole === 'object'
    ? workflowSession.console.sessionConsole
    : {};
  const taskSessionSnapshot = state.taskSessionSnapshots?.[stageKey] && typeof state.taskSessionSnapshots[stageKey] === 'object'
    ? state.taskSessionSnapshots[stageKey]
    : {};
  const viewSessionConsole = view.sessionConsole && typeof view.sessionConsole === 'object'
    ? view.sessionConsole
    : {};

  if (Object.keys(workflowSessionConsole).length) return workflowSessionConsole;
  if (Object.keys(taskSessionSnapshot).length) return taskSessionSnapshot;
  return viewSessionConsole;
}

function hasWorkspaceStageViewValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return value !== undefined && value !== null && value !== '';
}

function resolveWorkspaceStageViewValue(pageState = {}, stage = 'home', viewState = {}, field = '', fallback = undefined) {
  const fieldKey = String(field || '').trim();
  if (!fieldKey) return fallback;
  const stageKey = String(stage || '').trim() || 'home';
  const state = pageState && typeof pageState === 'object' ? pageState : {};
  const stateView = state.views?.[stageKey] && typeof state.views[stageKey] === 'object'
    ? state.views[stageKey]
    : {};
  const passedView = viewState && typeof viewState === 'object' ? viewState : {};
  if (hasWorkspaceStageViewValue(stateView[fieldKey])) return stateView[fieldKey];
  if (hasWorkspaceStageViewValue(passedView[fieldKey])) return passedView[fieldKey];
  return fallback;
}

function resolveWorkspaceStagePageData(pageState = {}, stage = 'home', pageData = {}) {
  const stageKey = String(stage || '').trim() || 'home';
  const state = pageState && typeof pageState === 'object' ? pageState : {};
  const statePageData = state.pageData?.[stageKey] && typeof state.pageData[stageKey] === 'object'
    ? state.pageData[stageKey]
    : {};
  const passedPageData = pageData && typeof pageData === 'object' ? pageData : {};
  if (Object.keys(passedPageData).length) return passedPageData;
  return statePageData;
}

function resolveWorkspaceStageSection(pageState = {}, stage = 'home', viewState = {}, pageData = {}, sectionKey = '', fallback = {}) {
  const key = String(sectionKey || '').trim();
  if (!key) return fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {};
  const page = resolveWorkspaceStagePageData(pageState, stage, pageData);
  const view = resolveWorkspaceStageView(pageState, stage, viewState);
  const pageSections = page.sections && typeof page.sections === 'object' ? page.sections : {};
  const viewSections = view.sections && typeof view.sections === 'object' ? view.sections : {};
  const pageSection = pageSections[key] && typeof pageSections[key] === 'object' && !Array.isArray(pageSections[key])
    ? pageSections[key]
    : {};
  const viewSection = viewSections[key] && typeof viewSections[key] === 'object' && !Array.isArray(viewSections[key])
    ? viewSections[key]
    : {};
  if (Object.keys(pageSection).length) return pageSection;
  if (Object.keys(viewSection).length) return viewSection;
  return fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {};
}

function resolveWorkspaceStageStateValue(pageState = {}, stage = 'home', pageData = {}, stageState = {}, field = '', fallback = undefined) {
  const fieldKey = String(field || '').trim();
  if (!fieldKey) return fallback;
  const page = resolveWorkspaceStagePageData(pageState, stage, pageData);
  const stateSource = stageState && typeof stageState === 'object' ? stageState : {};
  if (hasWorkspaceStageViewValue(page[fieldKey])) return page[fieldKey];
  if (hasWorkspaceStageViewValue(stateSource[fieldKey])) return stateSource[fieldKey];
  return fallback;
}

function resolveWorkspaceStageViewField(pageState = {}, stage = 'home', viewState = {}, field = '', fallback = {}) {
  const value = resolveWorkspaceStageViewValue(pageState, stage, viewState, field, fallback);
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) return value;
  return fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {};
}

function resolveWorkspaceStageActionStatus(pageState = {}, stage = 'home', viewState = {}, fallback = {}) {
  return resolveWorkspaceStageViewField(pageState, stage, viewState, 'actionStatus', fallback);
}

function resolveWorkspaceStageDialogueStatus(pageState = {}, stage = 'home', viewState = {}, fallback = {}) {
  return resolveWorkspaceStageViewField(pageState, stage, viewState, 'dialogueStatus', fallback);
}

function resolveWorkspaceStageConfirmationState(pageState = {}, stage = 'home', viewState = {}, fallback = {}) {
  return resolveWorkspaceStageViewField(pageState, stage, viewState, 'confirmation', fallback);
}

function buildWorkspaceContextFallback(stage, options = {}) {
  const key = String(stage || '').trim() || 'home';
  const denseContextCopy = getWorkspaceContextDenseCopy(key);
  const explicitFlowLabel = String(options.flowLabel || '').trim();
  const entryFlowLabel = String(options.entryFlowLabel || '').trim();
  const defaultFlowValue = String(denseContextCopy.defaultFlowValue || '').trim();
  let flowLabel = explicitFlowLabel;

  if (!flowLabel && key === 'home' && entryFlowLabel) {
    flowLabel = `入口页 -> 工作台首页 -> ${entryFlowLabel
      .replace(/^中文模板展示板\s*->\s*/u, '')
      .replace(/^入口页\s*->\s*/u, '')
      .trim()}`;
  }
  if (!flowLabel) flowLabel = defaultFlowValue;

  const mergedHints = [...toArray(options.defaultHints), ...toArray(options.extraHints)]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const uniqueHints = [];
  const seen = new Set();
  for (const item of mergedHints) {
    if (seen.has(item)) continue;
    seen.add(item);
    uniqueHints.push(item);
  }

  return {
    items: Array.isArray(options.items) ? options.items : [],
    runLabel: String(options.runLabel || '').trim(),
    phaseLabel: String(options.phaseLabel || '').trim(),
    flowLabel,
    countValues: options.countValues && typeof options.countValues === 'object'
      ? options.countValues
      : {},
    hints: uniqueHints.slice(0, denseContextCopy.hintLimit || 2),
  };
}

function buildWorkspaceStageDefaultHints(stage, options = {}) {
  const key = String(stage || '').trim() || 'home';
  const values = options && typeof options === 'object' ? options : {};
  const hintsByStage = {
    home: [
      firstNonEmpty(
        values.primaryHint,
        values.hasResult ? '首页只负责决定这轮先去哪里；如果想换任务，再回任务总控。' : values.densePrimaryHint
      ),
      firstNonEmpty(
        values.entryTitle ? `当前这轮任务来自入口“${values.entryTitle}”，首页会继续沿用这次入口判断。` : '',
        values.secondaryHint
      ),
      values.tertiaryHint,
    ],
    prepare: [
      firstNonEmpty(values.primaryHint, values.stageSummary, values.densePrimaryHint),
      firstNonEmpty(values.secondaryHint, values.currentFocus),
      values.tertiaryHint,
    ],
    result: [
      firstNonEmpty(values.primaryHint, values.stageSummary, values.densePrimaryHint),
      firstNonEmpty(values.secondaryHint, values.currentFocus),
      firstNonEmpty(values.tertiaryHint, values.nextActionReason),
    ],
    exception: [
      firstNonEmpty(values.primaryHint, values.stageSummary, values.hasIssue ? values.densePrimaryHint : '当前没有必须处理的异常，这一页可以先不用看。'),
      firstNonEmpty(values.secondaryHint, values.currentFocus),
      firstNonEmpty(values.tertiaryHint, values.nextActionReason),
    ],
  };
  return toArray(hintsByStage[key] || hintsByStage.home).filter(Boolean);
}

function buildWorkspaceStageGuideFallback(stage, options = {}) {
  const key = String(stage || '').trim() || 'home';
  const values = options && typeof options === 'object' ? options : {};
  const guideByStage = {
    home: {
      title: values.entryGuideTitle,
      copy: values.guideCopy,
      items: Array.isArray(values.entryGuideItems) && values.entryGuideItems.length
        ? values.entryGuideItems
        : [
          { label: '主入口', value: values.defaultEntryLabel },
          { label: '主链结构', value: '首页负责总览，准备/结果/异常三页分别接住下一步判断' },
          { label: '补充内容', value: '补充说明和细分页仍会保留，但默认不占主链注意力' },
        ],
    },
    prepare: {
      title: values.entryGuideTitle,
      copy: values.guideCopy,
      items: values.entryGuideItems,
    },
    result: {
      title: values.entryGuideTitle,
      copy: values.guideCopy,
      items: values.entryGuideItems,
    },
    exception: {
      title: values.entryGuideTitle,
      copy: values.guideCopy,
      items: values.entryGuideItems,
    },
  };
  return buildWorkspaceGuideSectionData(guideByStage[key] || guideByStage.home);
}

function buildWorkspaceStageVisibilityFallback(stage, options = {}) {
  const values = options && typeof options === 'object' ? options : {};
  return buildWorkspaceGuideSectionData({
    title: values.visibilityTitle,
    copy: values.visibilityCopy,
    items: values.visibilityItems,
  });
}

function buildWorkspaceStageWorkbenchCards(stage, options = {}) {
  const key = String(stage || '').trim() || 'home';
  const values = options && typeof options === 'object' ? options : {};
  const denseCopy = values.denseCopy && typeof values.denseCopy === 'object'
    ? values.denseCopy
    : getWorkspaceDenseCopy(key);

  const stageCards = {
    prepare: [
      buildWorkspaceStandardWorkbenchCard({
        stage: key,
        denseCopy,
        source: {
          id: 'result-workspace',
          label: '结果工作台',
          value: values.resultAvailable ? '可进入' : '执行后生成',
          summary: '执行完成后，用它统一筛图、收口和下一步判断。',
          file: values.resultFile,
          cta: values.resultCta || '进入结果工作台',
          pendingLabel: values.resultPendingLabel || '执行完成后生成',
          tone: 'good',
        },
      }),
      buildWorkspaceStandardWorkbenchCard({
        stage: key,
        denseCopy,
        source: {
          id: 'workspace-home',
          label: '工作台首页',
          value: '回主链',
          summary: '如果你要重新看当前阶段和主链入口，再回这里。',
          file: values.homeFile,
          cta: values.homeCta || '回工作台首页',
          tone: 'info',
        },
      }),
      buildWorkspaceStandardWorkbenchCard({
        stage: key,
        denseCopy,
        source: {
          label: values.focusLabel || '放行判断',
          value: values.focusValue,
          summary: values.focusSummary,
          tone: values.focusTone,
          hideLinkIfMissing: true,
        },
      }),
    ],
    result: [
      buildWorkspaceStandardWorkbenchCard({
        stage: key,
        denseCopy,
        source: {
          id: 'exception-workspace',
          label: '异常工作台',
          value: values.exceptionValue,
          summary: values.exceptionSummary,
          file: values.exceptionFile,
          cta: values.exceptionCta,
          tone: values.exceptionTone,
        },
      }),
      values.includeStoryboard
        ? buildWorkspaceStandardWorkbenchCard({
          stage: key,
          denseCopy,
          type: 'storyboard',
          source: {
            id: 'storyboard',
            label: '分镜整板补充页',
            file: values.storyboardFile,
            cta: values.storyboardCta,
            tone: values.storyboardTone || 'info',
            audience: 'pro',
          },
        })
        : null,
    ],
    exception: [
      buildWorkspaceStandardWorkbenchCard({
        stage: key,
        denseCopy,
        source: {
          id: 'result-workspace',
          label: '结果工作台',
          value: values.resultValue,
          summary: values.resultSummary,
          file: values.resultFile,
          cta: values.resultCta,
          tone: values.resultTone || 'good',
        },
      }),
      values.includeStoryboard
        ? buildWorkspaceStandardWorkbenchCard({
          stage: key,
          denseCopy,
          type: 'storyboard',
          source: {
            id: 'storyboard',
            label: '分镜整板补充页',
            file: values.storyboardFile,
            cta: values.storyboardCta,
            tone: values.storyboardTone || 'warn',
            audience: 'pro',
          },
        })
        : null,
    ],
  };

  return toArray(stageCards[key]).filter(Boolean);
}

function buildWorkspaceContextCounts(stage, values = {}, fallback = []) {
  const denseCopy = getWorkspaceContextDenseCopy(stage);
  const source = values && typeof values === 'object' ? values : {};
  const items = Array.isArray(denseCopy.counts) ? denseCopy.counts.map((item) => {
    const value = String(source[item.field] ?? '').trim();
    return value ? { label: item.label, value } : null;
  }).filter(Boolean) : [];
  return items.length ? items : toArray(fallback);
}

function buildWorkspaceContextHints(stage, hints = [], fallback = []) {
  const denseCopy = getWorkspaceContextDenseCopy(stage);
  const source = toArray(hints).map((item) => String(item || '').trim()).filter(Boolean);
  const fallbackItems = toArray(fallback).map((item) => String(item || '').trim()).filter(Boolean);

  if (source.length) {
    const seen = new Set();
    return [...fallbackItems, ...source].filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
  }

  return fallbackItems.slice(0, denseCopy.hintLimit || 2);
}

function buildWorkspaceStageFallbackBundle(stage, options = {}) {
  const key = String(stage || '').trim() || 'home';
  const values = options && typeof options === 'object' ? options : {};
  const denseCopy = values.denseCopy && typeof values.denseCopy === 'object'
    ? values.denseCopy
    : getWorkspaceDenseCopy(key);
  const stagePhrases = getWorkspaceStagePhrases(key);
  const chrome = getWorkspaceStageChrome(key);
  const actionCopy = getWorkspaceActionCopy();
  const context = buildWorkspaceContextFallback(key, {
    items: Array.isArray(values.contextItems) ? values.contextItems : [],
    runLabel: values.runLabel,
    phaseLabel: values.phaseLabel,
    flowLabel: values.flowLabel,
    entryFlowLabel: values.entryFlowLabel,
    countValues: values.countValues,
    defaultHints: buildWorkspaceStageDefaultHints(key, {
      stageSummary: values.stageSummary,
      densePrimaryHint: values.densePrimaryHint || denseCopy.contextPrimaryHint,
      currentFocus: values.currentFocus,
      nextActionReason: values.nextActionReason,
      hasIssue: values.hasIssue,
      hasResult: values.hasResult,
      entryTitle: values.entryTitle,
      primaryHint: values.primaryHint,
      secondaryHint: values.secondaryHint,
      tertiaryHint: values.tertiaryHint,
    }),
    extraHints: values.extraHints,
  });
  const route = buildWorkspaceStageRouteFallback(key, {
    title: values.routeTitle || chrome.routeTitle,
    copy: values.routeCopy || chrome.routeCopy,
    denseCopy,
    currentLabel: values.currentLabel,
    currentSummary: values.currentSummary,
    currentPendingLabel: values.currentPendingLabel || stagePhrases.routeCurrentPendingLabel,
    previousLabel: values.previousLabel,
    previousSummary: values.previousSummary,
    previousFile: values.previousFile,
    previousCta: values.previousCta,
    nextLabel: values.nextLabel,
    nextSummary: values.nextSummary,
    nextFile: values.nextFile,
    nextHref: values.nextHref,
    nextCta: values.nextCta,
    nextPendingLabel: values.nextPendingLabel,
    extraNextSteps: values.extraNextSteps,
  });
  const workbenchCards = buildWorkspaceStageWorkbenchCards(key, {
    denseCopy,
    resultAvailable: values.resultAvailable,
    resultFile: values.resultFile,
    resultCta: values.resultCta,
    resultPendingLabel: values.resultPendingLabel,
    resultValue: values.resultValue,
    resultSummary: values.resultSummary,
    resultTone: values.resultTone,
    homeFile: values.homeFile,
    homeCta: values.homeCta,
    focusLabel: values.focusLabel,
    focusValue: values.focusValue,
    focusSummary: values.focusSummary,
    focusTone: values.focusTone,
    exceptionValue: values.exceptionValue,
    exceptionSummary: values.exceptionSummary,
    exceptionFile: values.exceptionFile,
    exceptionCta: values.exceptionCta,
    exceptionTone: values.exceptionTone,
    includeStoryboard: values.includeStoryboard,
    storyboardFile: values.storyboardFile,
    storyboardCta: values.storyboardCta,
    storyboardTone: values.storyboardTone,
  });
  const workbench = buildWorkspaceWorkbenchSectionData({
    title: values.workbenchTitle || chrome.workbenchTitle,
    copy: values.workbenchCopy || chrome.workbenchCopy,
    cards: workbenchCards.concat(toArray(values.extraWorkbenchCards)),
  });

  return {
    context,
    route,
    workbench,
    denseCopy,
    stagePhrases,
    chrome,
    actionCopy,
  };
}

function buildWorkspaceRoutePointData(point) {
  if (!point || typeof point !== 'object') return null;
  const label = String(point.label || '').trim();
  const summary = String(point.summary || '').trim();
  if (!label && !summary) return null;
  return {
    ...point,
    label,
    summary,
  };
}

function buildWorkspaceStandardRoutePoint(options = {}) {
  const type = String(options.type || 'next').trim() || 'next';
  const denseCopy = options.denseCopy && typeof options.denseCopy === 'object'
    ? options.denseCopy
    : getWorkspaceDenseCopy(options.stage);
  const defaults = {
    current: {
      kicker: '当前判断',
      pendingLabel: '当前就是这一步的统一判断',
      summary: denseCopy.routeCurrentSummary || '这一块只负责说明当前这一站在做什么，不再展开重复细节。',
    },
    previous: {
      kicker: '上一站',
      pendingLabel: '上一站本轮不可用',
      summary: denseCopy.routeBackSummary || '只有需要回看上一站判断时，再回去。',
    },
    next: {
      kicker: '推荐下一步',
      pendingLabel: '本轮尚未生成',
    },
  };
  const source = options.source && typeof options.source === 'object' ? options.source : {};
  return buildWorkspaceRoutePointData({
    kicker: source.kicker || defaults[type]?.kicker,
    pendingLabel: source.pendingLabel || defaults[type]?.pendingLabel,
    summary: source.summary || defaults[type]?.summary || '',
    ...source,
  });
}

function buildWorkspaceRouteData(options = {}) {
  return {
    title: String(options.title || '').trim() || '现在继续',
    copy: String(options.copy || '').trim() || '先按这里继续，避免在多个页面之间来回判断。',
    current: buildWorkspaceRoutePointData(options.current),
    previous: buildWorkspaceRoutePointData(options.previous),
    nextSteps: toArray(options.nextSteps).map((item) => buildWorkspaceRoutePointData(item)).filter(Boolean),
  };
}

function buildWorkspaceRouteSectionData(options = {}) {
  const source = options.source && typeof options.source === 'object' ? options.source : null;
  return buildWorkspaceRouteData({
    title: String(source?.title || '').trim() || options.title,
    copy: String(source?.copy || '').trim() || options.copy,
    current: source?.current || options.current || null,
    previous: source?.previous || options.previous || null,
    nextSteps: Array.isArray(source?.nextSteps) ? source.nextSteps : options.nextSteps,
  });
}

function resolveWorkspaceRouteSectionData(section = {}, fallback = {}) {
  return buildWorkspaceRouteSectionData({
    source: section,
    title: fallback.title,
    copy: fallback.copy,
    current: fallback.current,
    previous: fallback.previous,
    nextSteps: fallback.nextSteps,
  });
}

function resolveWorkspaceRouteSectionByStage(section = {}, fallback = {}) {
  return resolveWorkspaceRouteSectionData(section, buildWorkspaceRouteSectionData(fallback));
}

function resolveWorkspaceViewRouteSection(stage, viewState = {}, fallback = {}) {
  const source = viewState && typeof viewState === 'object' ? viewState : {};
  return resolveWorkspaceRouteSectionByStage(source.route || {}, fallback);
}

function resolveWorkspaceStageRouteSection(pageState = {}, stage = 'home', viewState = {}, fallback = {}) {
  return resolveWorkspaceViewRouteSection(
    stage,
    resolveWorkspaceStageView(pageState, stage, viewState),
    fallback
  );
}

function buildWorkspaceRouteFallback(stage, options = {}) {
  const key = String(stage || '').trim() || 'home';
  const denseCopy = options.denseCopy && typeof options.denseCopy === 'object'
    ? options.denseCopy
    : getWorkspaceDenseCopy(key);
  const current = buildWorkspaceStandardRoutePoint({
    stage: key,
    denseCopy,
    type: 'current',
    source: options.current && typeof options.current === 'object' ? options.current : {},
  });
  const previousSource = options.previous && typeof options.previous === 'object' ? options.previous : null;
  const previous = previousSource
    ? buildWorkspaceStandardRoutePoint({
      stage: key,
      denseCopy,
      type: 'previous',
      source: previousSource,
    })
    : null;
  const nextSteps = toArray(options.nextSteps).map((item) => buildWorkspaceStandardRoutePoint({
    stage: key,
    denseCopy,
    type: 'next',
    source: item,
  })).filter(Boolean);

  return {
    title: String(options.title || '').trim(),
    copy: String(options.copy || '').trim(),
    current,
    previous,
    nextSteps,
  };
}

function buildWorkspaceStageRouteFallback(stage, options = {}) {
  const key = String(stage || '').trim() || 'home';
  const values = options && typeof options === 'object' ? options : {};
  const routeByStage = {
    home: {
      current: {
        label: values.currentLabel,
        summary: values.currentSummary,
        pendingLabel: values.currentPendingLabel,
      },
      previous: null,
      nextSteps: [
        {
          label: values.nextLabel,
          summary: values.nextSummary,
          href: values.nextHref,
          file: values.nextFile,
          cta: values.nextCta || '现在进入',
          pendingLabel: values.nextPendingLabel,
        },
      ],
    },
    prepare: {
      current: {
        label: values.currentLabel,
        summary: values.currentSummary,
        pendingLabel: values.currentPendingLabel,
      },
      previous: {
        label: values.previousLabel || '工作台首页',
        summary: values.previousSummary || '回到总控页重新看当前阶段与主链入口。',
        file: values.previousFile,
        cta: values.previousCta || '回工作台首页',
      },
      nextSteps: [
        {
          label: values.nextLabel,
          summary: values.nextSummary,
          file: values.nextFile,
          cta: values.nextCta || '进入结果工作台',
          pendingLabel: values.nextPendingLabel,
        },
      ],
    },
    result: {
      current: {
        label: values.currentLabel,
        summary: values.currentSummary,
        pendingLabel: values.currentPendingLabel,
      },
      previous: {
        label: values.previousLabel || '工作台首页',
        summary: values.previousSummary,
        file: values.previousFile,
        cta: values.previousCta || '回工作台首页',
      },
      nextSteps: [
        {
          label: values.nextLabel,
          summary: values.nextSummary,
          file: values.nextFile,
          cta: values.nextCta || '现在进入',
          pendingLabel: values.nextPendingLabel,
        },
        ...toArray(values.extraNextSteps),
      ],
    },
    exception: {
      current: {
        label: values.currentLabel,
        summary: values.currentSummary,
        pendingLabel: values.currentPendingLabel,
      },
      previous: {
        label: values.previousLabel || '结果工作台',
        summary: values.previousSummary,
        file: values.previousFile,
        cta: values.previousCta || '回结果工作台',
      },
      nextSteps: [
        {
          label: values.nextLabel || '工作台首页',
          summary: values.nextSummary,
          file: values.nextFile,
          cta: values.nextCta || '回工作台首页',
          pendingLabel: values.nextPendingLabel,
        },
      ],
    },
  };
  return buildWorkspaceRouteFallback(key, {
    title: values.title,
    copy: values.copy,
    denseCopy: values.denseCopy,
    ...(routeByStage[key] || routeByStage.home),
  });
}

function buildWorkspaceWorkbenchCardData(card) {
  if (!card || typeof card !== 'object') return null;
  const label = String(card.label || '').trim();
  const value = card.value === undefined || card.value === null ? '' : String(card.value).trim();
  const summary = String(card.summary || '').trim();
  if (!label && !value && !summary) return null;
  return {
    ...card,
    label,
    value,
    summary,
  };
}

function buildWorkspaceStandardWorkbenchCard(options = {}) {
  const denseCopy = options.denseCopy && typeof options.denseCopy === 'object'
    ? options.denseCopy
    : getWorkspaceDenseCopy(options.stage);
  const source = options.source && typeof options.source === 'object' ? options.source : {};
  const defaultType = String(options.type || 'optional').trim() || 'optional';
  const typeDefaults = {
    optional: {
      value: denseCopy.optionalEntryValue || '按需再看',
      summary: denseCopy.optionalEntrySummary || '这里只留按需入口，不抢当前主动作。',
      tone: 'neutral',
    },
    storyboard: {
      value: denseCopy.storyboardEntryValue || '按需再看',
      summary: denseCopy.storyboardEntrySummary || '只有需要对照镜头上下文时，再从这里进入。',
      tone: 'info',
      audience: 'pro',
    },
    record: {
      value: denseCopy.runRecordEntryValue || '按需再看',
      summary: denseCopy.runRecordEntrySummary || '只在想翻完整记录时再打开。',
      tone: 'neutral',
    },
  };
  const defaults = typeDefaults[defaultType] || typeDefaults.optional;
  return buildWorkspaceWorkbenchCardData({
    value: defaults.value,
    summary: defaults.summary,
    tone: defaults.tone,
    audience: defaults.audience,
    ...source,
  });
}

function buildWorkspaceWorkbenchData(options = {}) {
  return {
    title: String(options.title || '').trim() || '补充入口',
    copy: String(options.copy || '').trim() || '这里只保留当前任务真正需要的补充入口。',
    cards: toArray(options.cards).map((item) => buildWorkspaceWorkbenchCardData(item)).filter(Boolean),
  };
}

function buildWorkspaceWorkbenchSectionData(options = {}) {
  const source = options.source && typeof options.source === 'object' ? options.source : null;
  return buildWorkspaceWorkbenchData({
    title: String(source?.title || '').trim() || options.title,
    copy: String(source?.copy || '').trim() || options.copy,
    cards: Array.isArray(source?.cards) && source.cards.length ? source.cards : options.cards,
  });
}

function resolveWorkspaceWorkbenchSectionData(section = {}, fallback = {}) {
  return buildWorkspaceWorkbenchSectionData({
    source: section,
    title: fallback.title,
    copy: fallback.copy,
    cards: fallback.cards,
  });
}

function resolveWorkspaceViewWorkbenchSection(viewState = {}, fallback = {}) {
  const source = viewState && typeof viewState === 'object' ? viewState : {};
  return resolveWorkspaceWorkbenchSectionData(source.workbench || {}, fallback);
}

function resolveWorkspaceStageWorkbenchSection(pageState = {}, stage = 'home', viewState = {}, fallback = {}) {
  return resolveWorkspaceViewWorkbenchSection(
    resolveWorkspaceStageView(pageState, stage, viewState),
    fallback
  );
}

function finalizeWorkspaceActionStatus(actionStatus = {}, workflow = {}) {
  const resolved = actionStatus && typeof actionStatus === 'object' ? { ...actionStatus } : {};
  const workflowAction = workflow && typeof workflow === 'object' ? workflow.action || {} : {};
  resolved.recommendedReply = String(resolved.recommendedReply || '').trim() || String(workflowAction.recommendedReply || '').trim();
  resolved.actionReason = String(resolved.actionReason || '').trim() || String(workflowAction.actionReason || '').trim();
  return resolved;
}

function buildRenderableWorkbench(options = {}) {
  const section = options.section && typeof options.section === 'object' ? options.section : {};
  return {
    ...buildWorkspaceWorkbenchSectionData({
      title: String(section.title || '').trim() || String(options.title || '').trim(),
      copy: String(section.copy || '').trim() || String(options.copy || '').trim(),
      cards: Array.isArray(section.cards) ? section.cards : [],
    }),
    maxCards: options.maxCards,
  };
}

function buildWorkspaceContentSectionPlan(items = [], fallback = []) {
  const source = toArray(items).length ? toArray(items) : toArray(fallback);
  return source.map((item) => {
    if (!item || typeof item !== 'object') return null;
    const key = String(item.key || '').trim();
    const kind = String(item.kind || '').trim();
    if (!key || !kind) return null;
    return {
      ...item,
      key,
      kind,
      enabled: item.enabled !== false,
    };
  }).filter(Boolean);
}

function resolveWorkspaceViewContentSectionPlan(viewState = {}, fallback = []) {
  const source = viewState && typeof viewState === 'object' ? viewState : {};
  return buildWorkspaceContentSectionPlan(source.contentSections, fallback);
}

function resolveWorkspaceStageContentSectionPlan(pageState = {}, stage = 'home', viewState = {}, fallback = []) {
  return resolveWorkspaceViewContentSectionPlan(
    resolveWorkspaceStageView(pageState, stage, viewState),
    fallback
  );
}

function renderWorkspaceDeclaredSections(plan = [], renderers = {}) {
  return toArray(plan).map((item) => {
    if (!item || item.enabled === false) return '';
    const render = renderers[item.kind] || renderers[item.key];
    return typeof render === 'function' ? render(item) : '';
  }).filter(Boolean);
}

function renderWorkspaceGuideSummarySection(options = {}) {
  return renderWorkspaceKeyValueSection({
    title: options.title,
    copy: options.copy,
    items: options.items,
    audience: options.audience || 'newcomer',
  });
}

function renderWorkspaceVisibilitySummarySection(options = {}) {
  return renderWorkspaceKeyValueSection({
    title: options.title,
    copy: options.copy,
    items: options.items,
    audience: options.audience || 'newcomer',
  });
}

function renderWorkspaceGuideDetailSection(section = {}, audience = 'pro') {
  return renderWorkspaceKeyValueSection({
    ...section,
    audience,
    extraClasses: ['workspace-guide-hint'],
  });
}

function buildCommonDeclaredSectionRenderers(options = {}) {
  const renderers = {};

  if (options.guideSummary) {
    renderers.guideSummary = () => renderWorkspaceGuideSummarySection(options.guideSummary);
  }
  if (options.guide) {
    renderers.guide = () => renderWorkspaceGuideDetailSection(options.guide, options.guideAudience || 'pro');
  }
  if (options.visibilitySummary) {
    renderers.visibilitySummary = () => renderWorkspaceVisibilitySummarySection(options.visibilitySummary);
  }
  if (options.visibility) {
    renderers.visibility = () => renderWorkspaceGuideDetailSection(options.visibility, options.visibilityAudience || 'pro');
  }

  return renderers;
}

function buildCommonContentLeadSections(options = {}) {
  const sections = [];

  if (options.guideSummary && Array.isArray(options.guideSummary.items) && options.guideSummary.items.length) {
    sections.push(renderWorkspaceGuideSummarySection(options.guideSummary));
  }
  if (options.guide && Array.isArray(options.guide.items) && options.guide.items.length) {
    sections.push(renderWorkspaceGuideDetailSection(options.guide, options.guideAudience || 'pro'));
  }
  if (options.visibilitySummary && Array.isArray(options.visibilitySummary.items) && options.visibilitySummary.items.length) {
    sections.push(renderWorkspaceVisibilitySummarySection(options.visibilitySummary));
  }
  if (options.visibility && Array.isArray(options.visibility.items) && options.visibility.items.length) {
    sections.push(renderWorkspaceGuideDetailSection(options.visibility, options.visibilityAudience || 'pro'));
  }

  return sections.filter(Boolean);
}

function renderWorkspaceCollaborationSection(options = {}) {
  const data = buildWorkspaceCollaborationSectionData(options);
  const supplementItems = uniqueTextItems([
    ...toArray(data.confirmItems),
    ...toArray(data.recentItems),
  ], 5);
  const supplementSummary = firstNonEmpty(
    data.confirmSummary,
    data.recentSummary,
    data.replyReason
  );
  if (!supplementItems.length && !supplementSummary) return '';
  return renderWorkspaceSection({
    title: data.title,
    copy: data.copy,
    body: `
      <div class="entry-grid">
        <article class="entry-card tone-info workspace-relay-card">
          <div class="entry-kicker">当前补充</div>
          ${supplementSummary ? `<p class="entry-copy">${escapeHtml(supplementSummary)}</p>` : ''}
          ${renderList(supplementItems, '当前没有额外补充点')}
        </article>
      </div>
    `,
  });
}

function renderWorkspaceTransitionStatusSection(options = {}) {
  const title = String(options.title || '').trim();
  if (!title) return '';
  const copy = String(options.copy || '').trim();
  const confirmedTitle = String(options.confirmedTitle || '').trim() || '已经确认';
  const nextFocusTitle = String(options.nextFocusTitle || '').trim() || '下一页先看';
  const confirmedItems = toArray(options.confirmedItems).filter(Boolean);
  const nextFocusItems = toArray(options.nextFocusItems).filter(Boolean);
  return renderWorkspaceSection({
    title,
    copy,
    body: `
      <div class="entry-grid">
        <article class="entry-card tone-good">
          <div class="entry-kicker">${escapeHtml(confirmedTitle)}</div>
          ${renderList(confirmedItems, '当前还没有可交接的确认项')}
        </article>
        <article class="entry-card tone-info">
          <div class="entry-kicker">${escapeHtml(nextFocusTitle)}</div>
          ${renderList(nextFocusItems, '进入下一页后先按主动作继续')}
        </article>
      </div>
    `,
  });
}

function renderWorkspaceStageRelaySection(options = {}) {
  const title = String(options.title || '').trim();
  if (!title) return '';
  const copy = String(options.copy || '').trim() || '这里只回答从哪来、这一站先做什么、做完送去哪里。';
  const previousTitle = String(options.previousTitle || '').trim() || '上一站交来';
  const previousLabel = String(options.previousLabel || '').trim() || '当前没有上一站交接';
  const previousSummary = String(options.previousSummary || '').trim() || '当前没有额外说明。';
  const previousItems = toArray(options.previousItems).filter(Boolean).slice(0, 3);
  const currentTitle = String(options.currentTitle || '').trim() || '这一站要完成';
  const currentLabel = String(options.currentLabel || '').trim() || '把当前这一步收清';
  const currentSummary = String(options.currentSummary || '').trim() || '这一块只说明这一站要完成什么，不重复主动作口令。';
  const currentItems = toArray(options.currentItems).filter(Boolean).slice(0, 3);
  const nextTitle = String(options.nextTitle || '').trim() || '完成后送去';
  const nextLabel = String(options.nextLabel || '').trim() || '继续下一步';
  const nextSummary = String(options.nextSummary || '').trim() || '完成这一站后继续主链。';
  const nextItems = toArray(options.nextItems).filter(Boolean).slice(0, 3);
  return renderWorkspaceSection({
    title,
    copy,
    body: `
      <div class="workspace-stage-relay-grid">
        <article class="entry-card tone-neutral workspace-stage-relay-card">
          <div class="entry-kicker">${escapeHtml(previousTitle)}</div>
          <h3 class="entry-title">${escapeHtml(previousLabel)}</h3>
          <p class="entry-copy">${escapeHtml(previousSummary)}</p>
          ${renderList(previousItems, '当前没有额外交接信息')}
        </article>
        <article class="entry-card tone-info workspace-stage-relay-card workspace-stage-relay-current">
          <div class="entry-kicker">${escapeHtml(currentTitle)}</div>
          <h3 class="entry-title">${escapeHtml(currentLabel)}</h3>
          <p class="entry-copy">${escapeHtml(currentSummary)}</p>
          ${renderList(currentItems, '当前按主判断继续即可')}
        </article>
        <article class="entry-card tone-good workspace-stage-relay-card">
          <div class="entry-kicker">${escapeHtml(nextTitle)}</div>
          <h3 class="entry-title">${escapeHtml(nextLabel)}</h3>
          <p class="entry-copy">${escapeHtml(nextSummary)}</p>
          ${renderList(nextItems, '完成这一站后按主链继续')}
        </article>
      </div>
    `,
  });
}

function renderWorkspaceDialogueStatusSection(options = {}) {
  const title = String(options.title || '').trim();
  if (!title) return '';
  const copy = String(options.copy || '').trim() || '这里只负责把当前判断接回对话框。';
  const nextSayTitle = '下一句直接说';
  const nextSayItems = toArray(options.nextSayItems).filter(Boolean);
  const primarySay = String(options.primarySay || nextSayItems[0] || '').trim();
  const actionReason = String(options.actionReason || options.summary || '').trim();
  const showCopyButton = options.showCopyButton !== false;
  if (!primarySay && !actionReason) return '';
  return renderWorkspaceSection({
    title,
    copy,
    body: `
      <div class="dialogue-panel-grid">
        <article class="entry-card tone-good dialogue-action-card">
          <div class="entry-kicker">${escapeHtml(nextSayTitle)}</div>
          <h3 class="entry-title">${escapeHtml(primarySay || '继续当前主链')}</h3>
          <p class="entry-copy">${escapeHtml(actionReason || '当前建议你先按这句继续，系统会顺着主链带你往下走。')}</p>
          ${primarySay && showCopyButton ? `
            <div class="workspace-inline-toolbar">
              <div class="dialogue-inline-label">把这句发回对话框</div>
              <button type="button" class="workspace-copy-button" data-copy-text="${escapeHtml(primarySay)}">复制这句</button>
            </div>
          ` : ''}
        </article>
      </div>
    `,
  });
}

function renderWorkspaceSignalBar(options = {}) {
  const title = String(options.title || '').trim() || '阶段信号';
  const copy = String(options.copy || '').trim() || '这里只用一排信号说明当前阶段、状态和下一步。';
  const items = toArray(options.items).filter((item) => item && item.label && item.value);
  if (!items.length) return '';
  return `
    <section class="workspace-signal-strip">
      <div class="workspace-signal-head">
        <div class="workspace-signal-title">${escapeHtml(title)}</div>
        <div class="workspace-signal-copy">${escapeHtml(copy)}</div>
      </div>
      <div class="workspace-signal-grid">
        ${items.map((item) => `
          <article class="workspace-signal-card tone-${escapeHtml(item.tone || 'neutral')}">
            <div class="workspace-signal-label">${escapeHtml(item.label)}</div>
            <div class="workspace-signal-value">${escapeHtml(item.value)}</div>
            ${item.summary ? `<div class="workspace-signal-summary">${escapeHtml(item.summary)}</div>` : ''}
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function mapUnifiedStatusTone(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return 'info';
  if (['good', 'info', 'warn', 'bad', 'neutral', 'accent'].includes(normalized)) return normalized;
  if (['running', 'planned', 'ready'].includes(normalized)) return 'info';
  if (['paused', 'warning'].includes(normalized)) return 'warn';
  if (['completed', 'success'].includes(normalized)) return 'good';
  if (['failed', 'error', 'blocked'].includes(normalized)) return 'bad';
  return 'info';
}

function resolveUnifiedNextAction(unifiedStatus = {}, options = {}) {
  const source = unifiedStatus && typeof unifiedStatus === 'object' ? unifiedStatus : {};
  const nextAction = source.nextAction && typeof source.nextAction === 'object' ? source.nextAction : {};
  const secondarySource = options.secondarySource && typeof options.secondarySource === 'object'
    ? options.secondarySource
    : {};
  const secondaryNextAction = secondarySource.nextAction && typeof secondarySource.nextAction === 'object'
    ? secondarySource.nextAction
    : {};

  return {
    label: String(
      options.label
      || nextAction.label
      || secondarySource.label
      || secondaryNextAction.label
      || options.fallbackLabel
      || ''
    ).trim(),
    reason: String(
      options.reason
      || nextAction.reason
      || secondarySource.reason
      || secondaryNextAction.reason
      || options.fallbackReason
      || ''
    ).trim(),
    target: String(
      options.target
      || nextAction.target
      || secondarySource.target
      || secondaryNextAction.target
      || options.fallbackTarget
      || ''
    ).trim(),
  };
}

function resolveUnifiedStageNarrative(unifiedStatus = {}, options = {}) {
  const source = unifiedStatus && typeof unifiedStatus === 'object' ? unifiedStatus : {};
  const summarySource = options.summarySource && typeof options.summarySource === 'object'
    ? options.summarySource
    : {};

  return {
    statusLabel: String(
      options.statusLabel
      || summarySource.statusLabel
      || source.statusLabel
      || source.conclusion
      || options.fallbackStatusLabel
      || ''
    ).trim(),
    statusSummary: String(
      options.statusSummary
      || summarySource.statusSummary
      || source.statusSummary
      || source.progress
      || options.fallbackStatusSummary
      || ''
    ).trim(),
    currentFocus: String(
      options.currentFocus
      || summarySource.currentFocus
      || source.currentFocus
      || source.focusSummary
      || options.fallbackCurrentFocus
      || ''
    ).trim(),
    stageSummary: String(
      options.stageSummary
      || summarySource.stageSummary
      || options.fallbackStageSummary
      || ''
    ).trim(),
    transitionSummary: String(
      options.transitionSummary
      || summarySource.transitionSummary
      || options.fallbackTransitionSummary
      || ''
    ).trim(),
    handoffSummary: String(
      options.handoffSummary
      || summarySource.handoffSummary
      || options.fallbackHandoffSummary
      || ''
    ).trim(),
    issueSummary: String(
      options.issueSummary
      || summarySource.issueSummary
      || options.fallbackIssueSummary
      || ''
    ).trim(),
  };
}

function buildTaskControlBarFromUnifiedStatus(unifiedStatus = {}, options = {}) {
  const source = unifiedStatus && typeof unifiedStatus === 'object' ? unifiedStatus : {};
  const copilotSummary = resolveCopilotSummary(options);
  const nextAction = source.nextAction && typeof source.nextAction === 'object' ? source.nextAction : {};
  const dialogue = source.dialogue && typeof source.dialogue === 'object' ? source.dialogue : {};
  const taskLabel = String(options.taskLabel || source.taskLabel || '').trim();
  const stageLabel = String(options.stageLabel || copilotSummary.stageLabel || source.stage || '').trim();
  const statusLabel = String(options.statusLabel || source.statusLabel || copilotSummary.conclusion || source.conclusion || source.statusLabel || stageLabel || '').trim();
  const statusSummary = String(
    options.statusSummary
    || source.statusSummary
    || copilotSummary.progressSummary
    || copilotSummary.conclusion
    || source.progress
    || source.currentFocus
    || nextAction.reason
    || ''
  ).trim();
  const pressureLabel = String(options.pressureLabel || source.pressureLabel || '').trim();
  const pressureSummary = String(
    options.pressureSummary
    || source.pressureSummary
    || source.issueSummary
    || ''
  ).trim();
  const nextActionLabel = String(options.nextActionLabel || nextAction.label || '').trim();
  const nextActionSummary = String(
    options.nextActionSummary
    || source.nextActionSummary
    || copilotSummary.nextActionSummary
    || copilotSummary.confirmationSummary
    || nextAction.reason
    || source.currentFocus
    || source.conclusion
    || ''
  ).trim();
  const primarySay = String(options.primarySay || copilotSummary.recommendedReply || dialogue.primarySay || '').trim();
  const progressLabel = String(options.progressLabel || '').trim() || '当前判断';
  const progressSummary = String(
    options.progressSummary
    || copilotSummary.progressSummary
    || copilotSummary.conclusion
    || source.progressSummary
    || source.progress
    || source.conclusion
    || source.currentFocus
    || ''
  ).trim();
  if (!taskLabel && !stageLabel && !nextActionLabel && !primarySay && !progressSummary) return null;
  const tone = mapUnifiedStatusTone(options.status || copilotSummary.status || source.status);
  return {
    taskLabel,
    stageLabel,
    statusLabel,
    statusSummary,
    statusTone: String(options.statusTone || '').trim() || tone,
    pressureLabel,
    pressureSummary,
    pressureTone: String(options.pressureTone || '').trim() || (pressureLabel ? tone : 'good'),
    nextActionLabel,
    nextActionSummary,
    nextActionTone: String(options.nextActionTone || '').trim() || (nextActionLabel ? tone : 'good'),
    primarySay,
    progressLabel,
    progressSummary,
    progressTone: String(options.progressTone || '').trim() || tone,
  };
}

function finalizeTaskControlBar(taskControlBar, options = {}) {
  const base = taskControlBar && typeof taskControlBar === 'object' ? taskControlBar : {};
  const preferOptionFields = new Set(Array.isArray(options.preferOptionFields) ? options.preferOptionFields : []);
  const resolveField = (fieldName, fallbackValue = '') => {
    if (preferOptionFields.has(fieldName)) {
      return firstNonEmpty(options[fieldName], base[fieldName], fallbackValue);
    }
    return firstNonEmpty(base[fieldName], options[fieldName], fallbackValue);
  };
  return {
    ...base,
    taskLabel: resolveField('taskLabel'),
    stageLabel: resolveField('stageLabel'),
    statusLabel: resolveField('statusLabel'),
    statusSummary: resolveField('statusSummary'),
    statusTone: resolveField('statusTone', 'info') || 'info',
    pressureLabel: resolveField('pressureLabel'),
    pressureSummary: resolveField('pressureSummary'),
    pressureTone: resolveField('pressureTone', 'good') || 'good',
    nextActionLabel: resolveField('nextActionLabel'),
    nextActionSummary: resolveField('nextActionSummary'),
    nextActionTone: resolveField('nextActionTone', 'good') || 'good',
    primarySay: options.forcePrimarySay !== undefined
      ? String(options.forcePrimarySay || '').trim()
      : resolveField('primarySay'),
    progressLabel: resolveField('progressLabel', '当前判断') || '当前判断',
    progressSummary: resolveField('progressSummary'),
    progressTone: resolveField('progressTone', 'info') || 'info',
  };
}

function buildActionStatusFromUnifiedStatus(unifiedStatus = {}, options = {}) {
  const source = unifiedStatus && typeof unifiedStatus === 'object' ? unifiedStatus : {};
  const copilotSummary = resolveCopilotSummary(options);
  const dialogue = source.dialogue && typeof source.dialogue === 'object' ? source.dialogue : {};
  const base = options.base && typeof options.base === 'object' ? options.base : {};
  const runtimeConversation = resolveRuntimeConversationFallback({
    ...options,
    unifiedStatus: source,
    copilotSummary,
  });
  const actionReason = String(
    base.actionReason
    || source.nextActionSummary
    || runtimeConversation.actionReason
    || copilotSummary.nextActionSummary
    || copilotSummary.confirmationSummary
    || dialogue.actionReason
    || options.nextActionSummary
    || options.confirmationSummary
    || options.defaultActionReason
    || ''
  ).trim();
  return {
    ...base,
    recommendedReply: String(
      base.recommendedReply
      || source.recommendedReply
      || options.confirmationReply
      || copilotSummary.recommendedReply
      || dialogue.primarySay
      || runtimeConversation.recommendedReply
      || options.dialogueNextSayItems?.[0]
      || ''
    ).trim(),
    actionReason,
  };
}

function buildDialogueStatusFromUnifiedStatus(unifiedStatus = {}, options = {}) {
  const source = unifiedStatus && typeof unifiedStatus === 'object' ? unifiedStatus : {};
  const copilotSummary = resolveCopilotSummary(options);
  const dialogue = source.dialogue && typeof source.dialogue === 'object' ? source.dialogue : {};
  const base = options.base && typeof options.base === 'object' ? options.base : {};
  const runtimeConversation = resolveRuntimeConversationFallback({
    ...options,
    unifiedStatus: source,
    copilotSummary,
  });
  const nextSayItems = Array.isArray(base.nextSayItems) && base.nextSayItems.length
    ? base.nextSayItems
    : (toArray(dialogue.nextSayItems).length
      ? toArray(dialogue.nextSayItems)
      : (toArray(copilotSummary.nextSayItems).length
        ? toArray(copilotSummary.nextSayItems)
        : toArray(runtimeConversation.nextSayItems)));
  return {
    ...base,
    confirmItems: Array.isArray(base.confirmItems) && base.confirmItems.length
      ? base.confirmItems
      : (toArray(dialogue.confirmItems).length
        ? toArray(dialogue.confirmItems)
        : toArray(copilotSummary.confirmItems)),
    nextSayItems,
    alternativeSayItems: Array.isArray(base.alternativeSayItems) && base.alternativeSayItems.length
      ? base.alternativeSayItems
      : toArray(dialogue.alternativeSayItems),
    primarySay: String(
      base.primarySay
      || source.recommendedReply
      || options.confirmationReply
      || copilotSummary.recommendedReply
      || dialogue.primarySay
      || runtimeConversation.recommendedReply
      || nextSayItems[0]
      || ''
    ).trim(),
    actionReason: String(
      base.actionReason
      || runtimeConversation.actionReason
      || copilotSummary.confirmationSummary
      || copilotSummary.nextActionSummary
      || dialogue.actionReason
      || options.nextActionSummary
      || options.confirmationSummary
      || options.defaultActionReason
      || ''
    ).trim(),
    summary: String(base.summary || dialogue.summary || copilotSummary.progressSummary || options.confirmationSummary || '').trim(),
  };
}

function finalizeCollaborationPromptState(dialogueStatus, options = {}) {
  const base = dialogueStatus && typeof dialogueStatus === 'object' ? { ...dialogueStatus } : {};
  const contractDialogue = options.contractDialogue && typeof options.contractDialogue === 'object'
    ? options.contractDialogue
    : {};
  const nextSayItems = Array.isArray(base.nextSayItems) && base.nextSayItems.length
    ? base.nextSayItems
    : toArray(contractDialogue.nextSayItems);
  const alternativeSayItems = Array.isArray(base.alternativeSayItems) && base.alternativeSayItems.length
    ? base.alternativeSayItems
    : toArray(contractDialogue.alternativeSayItems);
  const confirmItems = Array.isArray(base.confirmItems) && base.confirmItems.length
    ? base.confirmItems
    : toArray(contractDialogue.confirmItems);
  const fallbackPrimarySay = String(
    options.primarySay
    || contractDialogue.primarySay
    || options.confirmationReply
    || nextSayItems[0]
    || ''
  ).trim();
  const fallbackSummary = String(
    options.summary
    || contractDialogue.summary
    || options.confirmationSummary
    || ''
  ).trim();
  const fallbackActionReason = String(
    options.actionReason
    || contractDialogue.actionReason
    || options.defaultActionReason
    || fallbackSummary
    || ''
  ).trim();

  return {
    ...base,
    primarySay: String(base.primarySay || fallbackPrimarySay).trim(),
    summary: String(base.summary || fallbackSummary).trim(),
    actionReason: String(base.actionReason || fallbackActionReason).trim(),
    nextSayItems,
    alternativeSayItems,
    confirmItems,
  };
}

function resolveWorkflowDefaultText(options = {}) {
  const values = [
    options.primary,
    ...(Array.isArray(options.fallbacks) ? options.fallbacks : []),
  ];
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function resolveCopilotSummary(options = {}) {
  const candidate = options.copilotSummary && typeof options.copilotSummary === 'object'
    ? options.copilotSummary
    : null;
  return candidate || {};
}

function resolveRuntimeConversationFallback(options = {}) {
  const runtimeStatus = String(
    options.runtimeStatus
    || options.status
    || options.currentStatus
    || options.unifiedStatus?.status
    || options.copilotSummary?.status
    || ''
  ).trim();
  if (!['running', 'paused', 'awaiting_confirmation', 'waiting', 'completed', 'planned'].includes(runtimeStatus)) {
    return {};
  }
  return buildRuntimeConversationCopy({
    runtimeStatus,
    failedCount: Number(
      options.failedCount
      ?? options.unifiedStatus?.failedCount
      ?? options.counts?.failed
      ?? 0
    ),
    currentBatch: Number(
      options.currentBatch
      ?? options.unifiedStatus?.currentBatch
      ?? 0
    ),
    pauseReason: String(
      options.pauseReason
      || options.unifiedStatus?.pauseReason
      || ''
    ).trim(),
  });
}

function buildWorkflowTextDefaults(options = {}) {
  const copilotSummary = resolveCopilotSummary(options);
  const nextActionSummary = resolveWorkflowDefaultText({
    primary: options.nextActionSummary,
    fallbacks: [
      copilotSummary.nextActionSummary,
      copilotSummary.confirmationSummary,
      options.nextActionReason,
      options.confirmationSummary,
      options.issueSummary,
      options.statusSummary,
      options.progressSummary,
    ],
  });
  const replyLabel = resolveWorkflowDefaultText({
    primary: options.replyLabel,
    fallbacks: [
      copilotSummary.recommendedReply,
      options.primarySay,
      options.recommendedReply,
      options.continuationLabel,
    ],
  });
  const primarySay = resolveWorkflowDefaultText({
    primary: options.primarySay,
    fallbacks: [
      replyLabel,
      copilotSummary.recommendedReply,
      options.recommendedReply,
      options.continuationLabel,
    ],
  });
  const progressSummary = resolveWorkflowDefaultText({
    primary: options.progressSummary,
    fallbacks: [
      copilotSummary.progressSummary,
      options.statusSummary,
      nextActionSummary,
      copilotSummary.conclusion,
      options.confirmationSummary,
      options.issueSummary,
    ],
  });
  const statusSummary = resolveWorkflowDefaultText({
    primary: options.statusSummary,
    fallbacks: [
      progressSummary,
      copilotSummary.conclusion,
      nextActionSummary,
      options.issueSummary,
    ],
  });

  return {
    nextActionSummary,
    replyLabel,
    primarySay,
    progressSummary,
    statusSummary,
  };
}

function renderWorkspaceSummaryStrip(options = {}) {
  const taskLabel = String(options.taskLabel || '').trim();
  const stageLabel = String(options.stageLabel || '').trim();
  const statusLabel = String(options.statusLabel || '').trim();
  const statusSummary = String(options.statusSummary || '').trim();
  const pressureLabel = String(options.pressureLabel || '').trim();
  const pressureSummary = String(options.pressureSummary || '').trim();
  const nextActionLabel = String(options.nextActionLabel || '').trim();
  const nextActionSummary = String(options.nextActionSummary || '').trim();
  const primarySay = String(options.primarySay || '').trim();
  const progressLabel = String(options.progressLabel || '').trim();
  const progressSummary = String(options.progressSummary || '').trim();
  if (!taskLabel && !statusLabel && !pressureLabel && !nextActionLabel && !primarySay && !progressLabel && !progressSummary) return '';
  return `
    <section class="workspace-summary-strip">
      <div class="workspace-summary-main">
        ${taskLabel ? `
          <article class="workspace-summary-card tone-info">
            <div class="workspace-summary-label">当前任务</div>
            <div class="workspace-summary-value">${escapeHtml(taskLabel)}</div>
            ${stageLabel ? `<div class="workspace-summary-copy">${escapeHtml(`当前在 ${stageLabel}`)}</div>` : ''}
          </article>
        ` : ''}
        ${statusLabel ? `
          <article class="workspace-summary-card tone-${escapeHtml(options.statusTone || 'neutral')}">
            <div class="workspace-summary-label">当前局面</div>
            <div class="workspace-summary-value">${escapeHtml(statusLabel)}</div>
            ${statusSummary ? `<div class="workspace-summary-copy">${escapeHtml(statusSummary)}</div>` : ''}
          </article>
        ` : ''}
        ${pressureLabel ? `
          <article class="workspace-summary-card tone-${escapeHtml(options.pressureTone || 'good')}">
            <div class="workspace-summary-label">当前压力</div>
            <div class="workspace-summary-value">${escapeHtml(pressureLabel)}</div>
            ${pressureSummary ? `<div class="workspace-summary-copy">${escapeHtml(pressureSummary)}</div>` : ''}
          </article>
        ` : ''}
        ${nextActionLabel ? `
          <article class="workspace-summary-card tone-${escapeHtml(options.nextActionTone || 'good')}">
            <div class="workspace-summary-label">当前动作</div>
            <div class="workspace-summary-value">${escapeHtml(nextActionLabel)}</div>
            ${nextActionSummary ? `<div class="workspace-summary-copy">${escapeHtml(nextActionSummary)}</div>` : ''}
          </article>
        ` : ''}
        ${(progressLabel || progressSummary) ? `
          <article class="workspace-summary-card workspace-summary-progress tone-${escapeHtml(options.progressTone || 'info')}">
            <div class="workspace-summary-label">${escapeHtml(progressLabel || '当前判断')}</div>
            <div class="workspace-summary-value">${escapeHtml(progressSummary || '当前已接管')}</div>
          </article>
        ` : ''}
      </div>
      <div class="workspace-summary-side">
        ${primarySay ? `
          <article class="workspace-summary-focus workspace-summary-focus-main tone-accent">
            <div class="workspace-summary-label">推荐回复</div>
            <div class="workspace-summary-value">${escapeHtml(primarySay)}</div>
            ${(progressSummary || nextActionSummary) ? `<div class="workspace-summary-copy">${escapeHtml(progressSummary || nextActionSummary)}</div>` : ''}
            ${primarySay ? `
              <div class="workspace-summary-dialogue">
                <div class="workspace-inline-toolbar">
                  <div class="dialogue-inline-label">回到对话框可直接说</div>
                  <button type="button" class="workspace-copy-button" data-copy-text="${escapeHtml(primarySay)}">复制这句</button>
                </div>
                <div class="workspace-summary-dialogue-chip">${escapeHtml(primarySay)}</div>
              </div>
            ` : ''}
          </article>
        ` : ''}
      </div>
    </section>
  `;
}

function renderWorkspaceTaskControlBar(options = {}) {
  return renderWorkspaceSummaryStrip({
    taskLabel: options.taskLabel,
    stageLabel: options.stageLabel,
    statusLabel: options.statusLabel,
    statusSummary: options.statusSummary,
    statusTone: options.statusTone,
    pressureLabel: options.pressureLabel,
    pressureSummary: options.pressureSummary,
    pressureTone: options.pressureTone,
    nextActionLabel: options.nextActionLabel,
    nextActionSummary: options.nextActionSummary,
    nextActionTone: options.nextActionTone,
    primarySay: options.primarySay,
    progressLabel: options.progressLabel,
    progressSummary: options.progressSummary,
    progressTone: options.progressTone,
  });
}

function renderWorkspaceStatusStack(options = {}) {
  const title = String(options.title || '').trim() || '工作流状态栈';
  const copy = String(options.copy || '').trim() || '这里只补当前阶段最关键的流程状态。';
  const items = toArray(options.items).filter((item) => item && item.label && item.value);
  if (!items.length) return '';
  return renderWorkspaceSection({
    title,
    copy,
    body: `
      <div class="workspace-status-stack">
        ${items.map((item) => `
          <article class="workspace-status-step tone-${escapeHtml(item.tone || 'neutral')}">
            <div class="workspace-status-step-head">
              <div class="workspace-status-step-label">${escapeHtml(item.label)}</div>
              <div class="workspace-status-step-pill">${escapeHtml(item.value)}</div>
            </div>
            ${item.summary ? `<div class="workspace-status-step-copy">${escapeHtml(item.summary)}</div>` : ''}
          </article>
        `).join('')}
      </div>
    `,
  });
}

function renderWorkspaceCopilotDeck(options = {}) {
  const title = String(options.title || '').trim() || '会话副驾驶';
  const copy = String(options.copy || '').trim() || '这里先看任务会话、主动作、当前判断和流程信号。';
  const taskControlBar = String(options.taskControlBar || '').trim();
  const sessionConsole = String(options.sessionConsole || '').trim();
  const heroMetrics = String(options.heroMetrics || '').trim();
  const cockpitSummary = String(options.cockpitSummary || '').trim();
  const stageSignals = String(options.stageSignals || '').trim();
  const relayPanel = String(options.relayPanel || '').trim();
  const hasBody = taskControlBar || sessionConsole || heroMetrics || cockpitSummary || stageSignals || relayPanel;
  if (!hasBody) return '';
  const overviewMain = [
    sessionConsole,
    heroMetrics ? `<div class="workspace-copilot-metrics-panel"><div class="hero-grid workspace-copilot-metrics">${heroMetrics}</div></div>` : '',
  ].filter(Boolean).join('');
  const overviewSide = [
    cockpitSummary,
    stageSignals,
  ].filter(Boolean).join('');
  return `
    <section class="workspace-copilot-deck">
      <div class="workspace-copilot-head">
        <div class="workspace-copilot-title">${escapeHtml(title)}</div>
        ${copy ? `<div class="workspace-copilot-copy">${escapeHtml(copy)}</div>` : ''}
      </div>
      <div class="workspace-copilot-body">
        ${taskControlBar}
        ${(overviewMain || overviewSide) ? `
          <div class="workspace-copilot-overview">
            ${overviewMain ? `<div class="workspace-copilot-overview-main">${overviewMain}</div>` : ''}
            ${overviewSide ? `<div class="workspace-copilot-overview-side">${overviewSide}</div>` : ''}
          </div>
        ` : ''}
        ${relayPanel ? `<div class="workspace-copilot-relay">${relayPanel}</div>` : ''}
      </div>
    </section>
  `;
}

function renderWorkspacePageShell(options = {}) {
  const pageTitle = String(options.pageTitle || '').trim();
  const currentPage = String(options.currentPage || '').trim();
  const heroEyebrow = String(options.heroEyebrow || '').trim();
  const heroTitle = String(options.heroTitle || '').trim();
  const heroCopy = String(options.heroCopy || '').trim();
  const contextBar = String(options.contextBar || '').trim();
  const copilotDeck = String(options.copilotDeck || '').trim();
  const taskControlBar = String(options.taskControlBar || '').trim();
  const sessionConsole = String(options.sessionConsole || '').trim();
  const heroMetrics = String(options.heroMetrics || '').trim();
  const cockpitSummary = String(options.cockpitSummary || '').trim();
  const stageSignals = String(options.stageSignals || '').trim();
  const modeSwitch = String(options.modeSwitch || '').trim();
  const progressRail = String(options.progressRail || '').trim();
  const routeCompass = String(options.routeCompass || '').trim();
  const workbench = String(options.workbench || '').trim();
  const mainSections = String(options.mainSections || '').trim();
  const extraTopLinks = Array.isArray(options.extraTopLinks) ? options.extraTopLinks.filter(Boolean) : [];
  const cssVars = String(options.cssVars || '').trim();

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(pageTitle)}</title>
${options.headAssets || ''}
  <style>
    :root {
${cssVars}
    }
${renderWorkspaceStyles()}
  </style>
</head>
<body data-portal-page="${escapeHtml(currentPage)}">
  <div class="shell workspace-stage-shell workspace-stage-${escapeHtml(currentPage.replace('.html', ''))}">
    <section class="hero">
      <div class="top-links">
        ${options.topLinks || ''}
      </div>
      <div class="eyebrow">${escapeHtml(heroEyebrow)}</div>
      <h1>${escapeHtml(heroTitle)}</h1>
      <p class="hero-copy">${escapeHtml(heroCopy)}</p>
      ${contextBar}
      ${copilotDeck || `
      ${taskControlBar}
      ${sessionConsole}
      <div class="hero-grid">
        ${heroMetrics}
      </div>`}
    </section>

    ${copilotDeck ? '' : cockpitSummary}

    ${copilotDeck ? '' : stageSignals}

    <div class="workspace-command-deck">
      ${modeSwitch}
      <div class="workspace-command-grid">
        <div class="workspace-command-main">
          ${progressRail}
        </div>
        <div class="workspace-command-side">
          ${routeCompass}
          ${workbench}
        </div>
      </div>
    </div>

    ${mainSections}
  </div>
</body>
</html>`;
}

function renderWorkspaceStyles() {
  return `
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at top left, var(--page-glow, rgba(217,179,109,0.18)), transparent 26%),
        linear-gradient(135deg, #0a0f13 0%, #101720 45%, #0e1318 100%);
      color: var(--text-main);
      font-family: "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
    }
    .shell {
      max-width: 1480px;
      margin: 0 auto;
      padding: 20px 24px 48px;
    }
    .workspace-stage-shell {
      display: grid;
      gap: 16px;
    }
    .workspace-command-deck {
      display: grid;
      gap: 12px;
    }
    .workspace-copilot-deck {
      margin-top: 12px;
      display: grid;
      gap: 12px;
      padding: 14px;
      border-radius: 22px;
      border: 1px solid rgba(255,255,255,0.08);
      background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.035));
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
    }
    .workspace-copilot-head {
      display: grid;
      gap: 6px;
    }
    .workspace-copilot-title {
      color: var(--text-main);
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.03em;
    }
    .workspace-copilot-copy {
      color: var(--text-sub);
      font-size: 12px;
      line-height: 1.55;
    }
    .workspace-copilot-body {
      display: grid;
      gap: 12px;
    }
    .workspace-copilot-relay {
      display: grid;
      gap: 10px;
      padding: 10px;
      grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.92fr);
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.06);
      background:
        linear-gradient(160deg, rgba(217,179,109,0.08), transparent 42%),
        rgba(255,255,255,0.02);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
    }
    .workspace-copilot-relay .section:first-child {
      grid-column: 1 / -1;
    }
    .workspace-copilot-relay .section:nth-child(2) {
      grid-column: 1;
    }
    .workspace-copilot-relay .section:nth-child(3) {
      grid-column: 2;
    }
    .workspace-copilot-overview {
      display: grid;
      grid-template-columns: minmax(0, 1.18fr) minmax(320px, 0.96fr);
      gap: 12px;
      align-items: start;
    }
    .workspace-copilot-overview-main,
    .workspace-copilot-overview-side {
      display: grid;
      gap: 12px;
    }
    .workspace-copilot-metrics-panel {
      padding: 10px;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.06);
      background: rgba(255,255,255,0.025);
    }
    .workspace-copilot-metrics {
      margin-top: 0;
    }
    .workspace-summary-strip {
      display: grid;
      grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.95fr);
      gap: 10px;
      align-items: stretch;
    }
    .workspace-summary-main {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .workspace-summary-side {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .workspace-summary-card,
    .workspace-summary-focus {
      display: grid;
      gap: 5px;
      min-height: 100%;
      padding: 10px 12px;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.05);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
    }
    .workspace-summary-card.tone-good,
    .workspace-summary-focus.tone-good {
      box-shadow: inset 0 0 0 1px rgba(124,197,163,0.12);
    }
    .workspace-summary-card.tone-warn,
    .workspace-summary-focus.tone-warn {
      box-shadow: inset 0 0 0 1px rgba(226,192,112,0.12);
    }
    .workspace-summary-card.tone-bad,
    .workspace-summary-focus.tone-bad {
      box-shadow: inset 0 0 0 1px rgba(255,140,122,0.12);
    }
    .workspace-summary-card.tone-info,
    .workspace-summary-focus.tone-info {
      box-shadow: inset 0 0 0 1px rgba(136,185,255,0.12);
    }
    .workspace-summary-focus.tone-accent {
      box-shadow: inset 0 0 0 1px rgba(217,179,109,0.16);
    }
    .workspace-summary-label {
      color: var(--text-sub);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .workspace-summary-value {
      color: var(--text-main);
      font-size: 14px;
      line-height: 1.4;
      font-weight: 650;
    }
    .workspace-summary-copy {
      color: var(--text-sub);
      font-size: 10px;
      line-height: 1.45;
    }
    .workspace-summary-progress .workspace-summary-value {
      font-size: 12px;
      line-height: 1.5;
      font-weight: 600;
    }
    .workspace-summary-focus-main {
      align-content: start;
    }
    .workspace-summary-focus-main .workspace-summary-value {
      font-size: 15px;
      line-height: 1.42;
    }
    .workspace-summary-dialogue {
      margin-top: 4px;
      padding-top: 8px;
      border-top: 1px solid rgba(255,255,255,0.08);
      display: grid;
      gap: 6px;
    }
    .workspace-summary-dialogue-chip {
      border-radius: 14px;
      border: 1px solid rgba(217,179,109,0.2);
      background: rgba(217,179,109,0.08);
      color: var(--text-main);
      padding: 9px 11px;
      font-size: 12px;
      line-height: 1.5;
      font-weight: 600;
    }
    .workspace-taskbar,
    .workspace-taskbar-main,
    .workspace-taskbar-card,
    .workspace-taskbar-focus,
    .workspace-taskbar-label,
    .workspace-taskbar-value,
    .workspace-taskbar-summary {
      all: unset;
    }
    .workspace-status-stack {
      display: grid;
      gap: 10px;
    }
    .workspace-status-step {
      display: grid;
      gap: 7px;
      padding: 12px 13px;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.045);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
    }
    .workspace-status-step.tone-good {
      box-shadow: inset 0 0 0 1px rgba(124,197,163,0.12);
    }
    .workspace-status-step.tone-warn {
      box-shadow: inset 0 0 0 1px rgba(226,192,112,0.12);
    }
    .workspace-status-step.tone-bad {
      box-shadow: inset 0 0 0 1px rgba(255,140,122,0.12);
    }
    .workspace-status-step.tone-info {
      box-shadow: inset 0 0 0 1px rgba(136,185,255,0.12);
    }
    .workspace-status-step-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    .workspace-status-step-label {
      color: var(--text-sub);
      font-size: 11px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .workspace-status-step-pill {
      display: inline-flex;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.05);
      color: var(--text-main);
      font-size: 12px;
      line-height: 1;
      font-weight: 650;
    }
    .workspace-status-step-copy {
      color: var(--text-sub);
      font-size: 12px;
      line-height: 1.6;
    }
    .workspace-signal-strip {
      display: grid;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.08);
      background:
        linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)),
        rgba(255,255,255,0.03);
    }
    .workspace-signal-head {
      display: grid;
      gap: 4px;
    }
    .workspace-signal-title {
      color: var(--accent);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .workspace-signal-copy {
      color: var(--text-sub);
      font-size: 12px;
      line-height: 1.55;
    }
    .workspace-signal-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .workspace-signal-card {
      display: grid;
      gap: 5px;
      min-height: 100%;
      padding: 10px 11px 11px;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.045);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
    }
    .workspace-signal-card.tone-good {
      box-shadow: inset 0 0 0 1px rgba(124,197,163,0.12);
    }
    .workspace-signal-card.tone-warn {
      box-shadow: inset 0 0 0 1px rgba(226,192,112,0.12);
    }
    .workspace-signal-card.tone-bad {
      box-shadow: inset 0 0 0 1px rgba(255,140,122,0.12);
    }
    .workspace-signal-card.tone-info {
      box-shadow: inset 0 0 0 1px rgba(136,185,255,0.12);
    }
    .workspace-signal-label {
      color: var(--text-sub);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .workspace-signal-value {
      color: var(--text-main);
      font-size: 15px;
      line-height: 1.32;
      font-weight: 650;
    }
    .workspace-signal-summary {
      color: var(--text-sub);
      font-size: 10px;
      line-height: 1.42;
    }
    .workspace-command-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.48fr) minmax(320px, 0.92fr);
      gap: 12px;
      align-items: start;
    }
    .workspace-command-main,
    .workspace-command-side {
      display: grid;
      gap: 12px;
    }
    .workspace-command-deck .portal-mode-switch,
    .workspace-command-deck .portal-progress,
    .workspace-command-deck .portal-route-compass,
    .workspace-command-deck .portal-workbench {
      margin-top: 0;
      height: 100%;
    }
    .hero,
    .section,
    .metric-card,
    .entry-card,
    .kv-card,
    .preview-card,
    .issue-card {
      border: 1px solid var(--panel-border);
      background: var(--panel);
      backdrop-filter: blur(12px);
      border-radius: 24px;
      box-shadow: 0 18px 48px rgba(0,0,0,0.24);
    }
    .hero {
      padding: 20px 20px 18px;
      margin-bottom: 0;
      background:
        linear-gradient(160deg, var(--hero-tint, rgba(217,179,109,0.15)), transparent 38%),
        rgba(255,255,255,0.04);
    }
    .workspace-copilot-deck .section,
    .workspace-copilot-deck .workspace-signal-strip {
      border-radius: 18px;
      border-color: rgba(255,255,255,0.06);
      background: rgba(255,255,255,0.025);
      box-shadow: none;
      backdrop-filter: none;
    }
    .workspace-copilot-deck .section {
      padding: 12px 12px 14px;
    }
    .workspace-copilot-deck .section h2 {
      font-size: 15px;
      margin-bottom: 4px;
    }
    .workspace-copilot-deck .section-copy {
      margin-bottom: 6px;
    }
    .workspace-copilot-deck .workspace-session-grid,
    .workspace-copilot-deck .cockpit-grid {
      gap: 10px;
      margin-top: 0;
    }
    .workspace-copilot-relay .section {
      padding: 0;
      border: 0;
      background: transparent;
      box-shadow: none;
    }
    .workspace-copilot-relay .section + .section {
      margin-top: 0;
      padding-top: 10px;
      border-top: 1px solid rgba(255,255,255,0.08);
    }
    .workspace-copilot-relay .section h2 {
      font-size: 14px;
      margin-bottom: 3px;
    }
    .workspace-copilot-relay .section-copy {
      margin-bottom: 6px;
      font-size: 11px;
    }
    .workspace-copilot-relay .dialogue-panel-grid,
    .workspace-copilot-relay .entry-grid,
    .workspace-copilot-relay .kv-grid {
      gap: 10px;
    }
    .workspace-copilot-relay .dialogue-panel-grid,
    .workspace-copilot-relay .kv-grid {
      grid-template-columns: 1fr;
    }
    .workspace-copilot-relay .entry-grid {
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }
    .workspace-copilot-relay .workspace-status-banner {
      padding: 10px;
      gap: 10px;
      grid-template-columns: minmax(0, 1fr);
    }
    .workspace-copilot-relay .workspace-status-main {
      gap: 10px;
    }
    .workspace-copilot-relay .workspace-status-summary h3 {
      font-size: 15px;
    }
    .workspace-copilot-relay .workspace-status-summary p {
      font-size: 11px;
    }
    .workspace-copilot-relay .entry-card,
    .workspace-copilot-relay .kv-card {
      background: rgba(255,255,255,0.04);
    }
    .top-links {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 12px;
    }
    .top-links a {
      color: var(--text-main);
      text-decoration: none;
      padding: 8px 12px;
      border-radius: 14px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      font-size: 12px;
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
      margin-bottom: 10px;
    }
    h1 {
      margin: 0 0 6px;
      font-size: 28px;
      line-height: 1.1;
      letter-spacing: 0.02em;
    }
    .hero-copy,
    .section-copy,
    .entry-copy,
    .metric-detail,
    .preview-meta,
    .issue-copy,
    .empty-state {
      color: var(--text-sub);
      line-height: 1.65;
    }
    .hero-copy {
      margin: 0;
      max-width: 72ch;
      font-size: 13px;
    }
    .hero-grid,
    .workspace-session-grid,
    .entry-grid,
    .preview-grid,
    .issue-grid,
    .kv-grid {
      display: grid;
      gap: 12px;
    }
    .hero-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: 12px;
    }
    .workspace-session-grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: 12px;
    }
    .entry-grid {
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    }
    .cockpit-grid {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .dialogue-panel-grid {
      display: grid;
      gap: 10px;
      grid-template-columns: minmax(0, 1.45fr) repeat(2, minmax(0, 1fr));
    }
    .workspace-judgment-grid {
      display: grid;
      gap: 12px;
      grid-template-columns: minmax(0, 1.18fr) minmax(280px, 0.92fr);
    }
    .workspace-judgment-side {
      display: grid;
      gap: 12px;
      align-content: start;
    }
    .workspace-stage-relay-grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .workspace-stage-relay-card {
      min-height: 100%;
    }
    .workspace-stage-relay-current {
      background:
        linear-gradient(160deg, rgba(136,185,255,0.12), transparent 42%),
        rgba(255,255,255,0.045);
    }
    .workspace-relay-card {
      grid-column: 1 / -1;
      background:
        linear-gradient(160deg, rgba(124,197,163,0.12), transparent 42%),
        rgba(255,255,255,0.045);
    }
    .workspace-session-card {
      min-height: 100%;
      padding: 13px 13px 14px;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.045);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
    }
    .workspace-session-card.tone-good {
      box-shadow: inset 0 0 0 1px rgba(124,197,163,0.12);
    }
    .workspace-session-card.tone-warn {
      box-shadow: inset 0 0 0 1px rgba(226,192,112,0.12);
    }
    .workspace-session-card.tone-bad {
      box-shadow: inset 0 0 0 1px rgba(255,140,122,0.12);
    }
    .workspace-session-card.tone-info {
      box-shadow: inset 0 0 0 1px rgba(136,185,255,0.12);
    }
    .workspace-session-label {
      color: var(--text-sub);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .workspace-session-value {
      color: var(--text-main);
      font-size: 16px;
      line-height: 1.3;
      font-weight: 700;
    }
    .workspace-session-copy {
      color: var(--text-sub);
      font-size: 11px;
      line-height: 1.5;
      margin-top: 6px;
    }
    .preview-grid,
    .issue-grid {
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    }
    .kv-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .metric-card,
    .entry-card,
    .kv-card,
    .preview-card,
    .issue-card {
      padding: 12px 12px 13px;
    }
    .metric-label,
    .entry-kicker,
    .kv-label {
      color: var(--text-sub);
      font-size: 11px;
      margin-bottom: 6px;
    }
    .metric-value {
      font-size: 22px;
      font-weight: 700;
      line-height: 1.14;
    }
    .metric-detail {
      font-size: 11px;
      margin-top: 4px;
    }
    .tone-good .metric-value,
    .tone-good .entry-kicker,
    .pill-good {
      color: #7cc5a3;
    }
    .tone-warn .metric-value,
    .tone-warn .entry-kicker,
    .pill-warn {
      color: #e2c070;
    }
    .tone-bad .metric-value,
    .tone-bad .entry-kicker,
    .pill-bad {
      color: #ff8c7a;
    }
    .tone-info .metric-value,
    .tone-info .entry-kicker,
    .pill-info {
      color: #88b9ff;
    }
    .section {
      padding: 14px 14px 16px;
      margin-top: 0;
    }
    .workspace-primary-panel {
      border-radius: 22px;
      border: 1px solid rgba(255,255,255,0.08);
      background:
        linear-gradient(180deg, rgba(255,255,255,0.042), rgba(255,255,255,0.024)),
        rgba(255,255,255,0.03);
      box-shadow:
        inset 0 0 0 1px rgba(255,255,255,0.018),
        0 14px 28px rgba(0,0,0,0.14);
      padding: 16px 16px 18px;
    }
    .workspace-primary-panel h2 {
      font-size: 17px;
      margin-bottom: 5px;
    }
    .workspace-primary-panel .section-copy {
      margin-bottom: 10px;
      font-size: 11px;
      line-height: 1.58;
    }
    .workspace-primary-panel .entry-grid,
    .workspace-primary-panel .preview-grid,
    .workspace-primary-panel .issue-grid,
    .workspace-primary-panel .kv-grid {
      gap: 10px;
    }
    .workspace-primary-panel .entry-card,
    .workspace-primary-panel .preview-card,
    .workspace-primary-panel .issue-card,
    .workspace-primary-panel .kv-card {
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.07);
      background: rgba(255,255,255,0.04);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.015);
      padding: 12px 12px 13px;
    }
    .workspace-primary-panel .entry-title,
    .workspace-primary-panel .preview-title,
    .workspace-primary-panel .issue-title {
      font-size: 14px;
      line-height: 1.34;
    }
    .workspace-primary-panel .entry-copy,
    .workspace-primary-panel .preview-meta,
    .workspace-primary-panel .issue-copy,
    .workspace-primary-panel .kv-value {
      font-size: 11px;
      line-height: 1.6;
    }
    .workspace-primary-panel .image-frame {
      border-radius: 16px;
    }
    .workspace-primary-panel.workspace-primary-focus {
      background:
        linear-gradient(160deg, rgba(217,179,109,0.08), transparent 44%),
        linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.025)),
        rgba(255,255,255,0.03);
    }
    .workspace-guide-hint {
      padding: 10px 12px 12px;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.06);
      background:
        linear-gradient(180deg, rgba(255,255,255,0.022), rgba(255,255,255,0.014)),
        rgba(255,255,255,0.018);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.015);
    }
    .workspace-guide-hint h2 {
      font-size: 13px;
      margin-bottom: 3px;
    }
    .workspace-guide-hint .section-copy {
      margin-bottom: 5px;
      font-size: 10px;
      line-height: 1.5;
    }
    .workspace-guide-hint .kv-grid {
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .workspace-guide-hint .kv-card {
      padding: 10px 10px 11px;
      border-radius: 14px;
      background: rgba(255,255,255,0.032);
      border: 1px solid rgba(255,255,255,0.05);
    }
    .workspace-guide-hint .kv-label {
      font-size: 10px;
      margin-bottom: 4px;
      letter-spacing: 0.04em;
    }
    .workspace-guide-hint .kv-value {
      font-size: 12px;
      line-height: 1.58;
      color: var(--text-sub);
      font-weight: 520;
    }
    .workspace-density-group {
      margin-top: 12px;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.03);
      padding: 10px 10px 12px;
    }
    .workspace-density-open {
      background: rgba(255,255,255,0.035);
    }
    .workspace-density-group summary {
      cursor: pointer;
      list-style: none;
      color: var(--text-main);
      font-size: 14px;
      font-weight: 600;
    }
    .workspace-density-group summary::-webkit-details-marker {
      display: none;
    }
    .workspace-density-title {
      color: var(--accent);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .workspace-density-copy {
      margin: 0 0 8px;
      color: var(--text-sub);
      font-size: 11px;
      line-height: 1.55;
    }
    .section h2 {
      margin: 0 0 4px;
      font-size: 16px;
      line-height: 1.3;
    }
    .section-copy {
      margin: 0 0 6px;
      font-size: 11px;
    }
    .entry-title,
    .preview-title,
    .issue-title {
      margin: 0;
      font-size: 14px;
      line-height: 1.32;
    }
    .entry-copy {
      margin: 0;
      font-size: 11px;
      min-height: 34px;
    }
    .entry-link,
    .preview-link {
      margin-top: 2px;
    }
    .entry-link a,
    .preview-link a,
    details.advanced-panel a {
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px solid rgba(217,179,109,0.35);
      padding-bottom: 1px;
      font-size: 13px;
    }
    .entry-link span,
    .preview-link span {
      color: var(--text-sub);
      font-size: 13px;
    }
    .dialogue-say-card {
      background:
        linear-gradient(160deg, rgba(124,197,163,0.12), transparent 38%),
        rgba(255,255,255,0.04);
    }
    .action-primary-card {
      background:
        linear-gradient(160deg, rgba(136,185,255,0.12), transparent 38%),
        rgba(255,255,255,0.04);
    }
    .cockpit-card {
      background:
        linear-gradient(160deg, rgba(217,179,109,0.1), transparent 38%),
        rgba(255,255,255,0.04);
    }
    .cockpit-reply-group {
      margin-top: 10px;
      display: grid;
      gap: 6px;
    }
    .workspace-inline-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    .cockpit-reply-label {
      color: var(--text-sub);
      font-size: 12px;
      line-height: 1.6;
    }
    .workspace-copy-button {
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.06);
      color: var(--text-main);
      padding: 7px 11px;
      border-radius: 999px;
      font-size: 11px;
      line-height: 1;
      cursor: pointer;
      transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
    }
    .workspace-copy-button:hover {
      transform: translateY(-1px);
      background: rgba(255,255,255,0.1);
      border-color: rgba(255,255,255,0.18);
    }
    .workspace-copy-button.is-copied {
      border-color: rgba(124,197,163,0.32);
      background: rgba(124,197,163,0.12);
      color: #7cc5a3;
    }
    .cockpit-reply-chip {
      border-radius: 14px;
      border: 1px solid rgba(217,179,109,0.24);
      background: rgba(217,179,109,0.1);
      color: var(--text-main);
      padding: 9px 11px;
      font-size: 13px;
      line-height: 1.5;
      font-weight: 600;
    }
    .action-reply-group {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid rgba(255,255,255,0.08);
      display: grid;
      gap: 8px;
    }
    .action-reply-label,
    .action-reply-copy {
      color: var(--text-sub);
      font-size: 12px;
      line-height: 1.6;
    }
    .action-reply-chip {
      border-radius: 14px;
      border: 1px solid rgba(136,185,255,0.22);
      background: rgba(136,185,255,0.09);
      color: var(--text-main);
      padding: 11px 12px;
      font-size: 14px;
      line-height: 1.55;
      font-weight: 600;
      letter-spacing: 0.01em;
    }
    .dialogue-action-card {
      grid-column: 1 / span 1;
      grid-row: 1 / span 2;
      background:
        linear-gradient(160deg, rgba(124,197,163,0.16), transparent 42%),
        rgba(255,255,255,0.05);
    }
    .workspace-judgment-hero {
      background:
        linear-gradient(160deg, rgba(217,179,109,0.14), transparent 42%),
        rgba(255,255,255,0.05);
    }
    .workspace-judgment-action {
      background:
        linear-gradient(160deg, rgba(136,185,255,0.14), transparent 42%),
        rgba(255,255,255,0.05);
    }
    .dialogue-inline-group {
      margin-top: 10px;
      display: grid;
      gap: 6px;
    }
    .dialogue-inline-label {
      color: var(--text-sub);
      font-size: 11px;
      letter-spacing: 0.02em;
    }
    .dialogue-say-stack {
      display: grid;
      gap: 10px;
    }
    .dialogue-say-item {
      border-radius: 14px;
      border: 1px solid rgba(124,197,163,0.2);
      background: rgba(124,197,163,0.08);
      color: var(--text-main);
      padding: 9px 11px;
      font-size: 12px;
      line-height: 1.5;
      font-weight: 600;
      letter-spacing: 0.01em;
    }
    .timeline-stack {
      display: grid;
      gap: 10px;
    }
    .workspace-status-banner {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(260px, 0.9fr);
      gap: 12px;
      padding: 12px;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04);
      margin-bottom: 10px;
    }
    .workspace-status-main,
    .workspace-status-action {
      display: grid;
      gap: 8px;
      align-content: start;
    }
    .workspace-status-pill {
      display: inline-flex;
      width: fit-content;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.05);
      color: var(--text-main);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
    }
    .workspace-status-summary h3 {
      margin: 0;
      font-size: 16px;
      line-height: 1.35;
    }
    .workspace-status-summary p {
      margin: 4px 0 0;
      color: var(--text-sub);
      font-size: 11px;
      line-height: 1.5;
    }
    .workspace-status-banner.tone-good .workspace-status-pill {
      border-color: rgba(124,197,163,0.28);
      background: rgba(124,197,163,0.12);
      color: #7cc5a3;
    }
    .workspace-status-banner.tone-warn .workspace-status-pill {
      border-color: rgba(226,192,112,0.28);
      background: rgba(226,192,112,0.12);
      color: #e2c070;
    }
    .workspace-status-banner.tone-bad .workspace-status-pill {
      border-color: rgba(255,140,122,0.28);
      background: rgba(255,140,122,0.12);
      color: #ff8c7a;
    }
    .timeline-meta {
      margin-top: 8px;
      color: var(--text-sub);
      font-size: 12px;
      line-height: 1.5;
    }
    .info-list {
      margin: 0;
      padding-left: 18px;
      color: var(--text-sub);
      line-height: 1.55;
      font-size: 12px;
    }
    .kv-label {
      letter-spacing: 0.02em;
    }
    .kv-value {
      font-size: 14px;
      line-height: 1.5;
    }
    .preview-card,
    .issue-card {
      display: grid;
      gap: 7px;
    }
    .image-frame {
      display: block;
      overflow: hidden;
      border-radius: 16px;
      aspect-ratio: 5 / 6;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .image-frame img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    details.advanced-panel {
      margin-top: 14px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 18px;
      padding: 12px 14px;
      background: rgba(255,255,255,0.03);
    }
    details.advanced-panel summary {
      cursor: pointer;
      color: var(--text-main);
      font-size: 14px;
      font-weight: 600;
      list-style: none;
    }
    details.advanced-panel summary::-webkit-details-marker {
      display: none;
    }
    .advanced-grid {
      margin-top: 12px;
      display: grid;
      gap: 10px;
    }
    .advanced-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 14px;
      padding: 12px 0;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .advanced-item:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }
    .advanced-title {
      font-size: 14px;
    }
    .advanced-copy {
      color: var(--text-sub);
      font-size: 12px;
      margin-top: 4px;
    }
    .empty-state {
      font-size: 13px;
    }
    @media (max-width: 1080px) {
      .workspace-taskbar {
        grid-template-columns: 1fr;
      }
      .workspace-copilot-overview,
      .workspace-summary-strip {
        grid-template-columns: 1fr;
      }
      .workspace-copilot-relay {
        grid-template-columns: 1fr;
      }
      .workspace-copilot-relay .section:first-child,
      .workspace-copilot-relay .section:nth-child(2),
      .workspace-copilot-relay .section:nth-child(3) {
        grid-column: auto;
      }
      .workspace-taskbar-main,
      .workspace-signal-grid,
      .workspace-command-grid,
      .hero-grid,
      .workspace-session-grid,
      .kv-grid,
      .cockpit-grid,
      .workspace-judgment-grid,
      .workspace-stage-relay-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .workspace-command-side {
        grid-column: 1 / -1;
      }
      .dialogue-panel-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .workspace-status-banner {
        grid-template-columns: 1fr;
      }
      .dialogue-action-card {
        grid-column: 1 / -1;
        grid-row: auto;
      }
    }
    @media (max-width: 720px) {
      .shell {
        padding: 18px 14px 48px;
      }
      h1 {
        font-size: 26px;
      }
      .workspace-summary-main {
        grid-template-columns: 1fr;
      }
      .workspace-taskbar-main,
      .workspace-signal-grid,
      .workspace-command-grid,
      .hero-grid,
      .workspace-session-grid,
      .cockpit-grid,
      .workspace-judgment-grid,
      .workspace-stage-relay-grid,
      .entry-grid,
      .dialogue-panel-grid,
      .preview-grid,
      .issue-grid,
      .kv-grid {
        grid-template-columns: 1fr;
      }
      .advanced-item {
        align-items: flex-start;
        flex-direction: column;
      }
    }
  `;
}

module.exports = {
  escapeHtml,
  relativeFile,
  readJsonIfExists,
  toArray,
  sumObjectValues,
  renderList,
  renderDialogueSayList,
  renderMetricCard,
  renderEntryCard,
  renderKeyValueGrid,
  getWorkspaceStageChrome,
  getWorkflowCopilotLanguage,
  getWorkspaceStagePhrases,
  getWorkspaceIdentityCopy,
  summarizeArtifactLayer,
  summarizeUserWorkbenchProtocol,
  buildWorkspaceStateProtocol,
  buildSupportPageCopy,
  buildWorkspaceFallbackGuide,
  buildWorkspaceNewcomerSummaryItems,
  getWorkspaceDenseCopy,
  formatTimelineEvents,
  buildWorkspaceFallbackTimeline,
  buildWorkspaceFallbackAssetOverview,
  buildWorkspaceFallbackCockpitSummary,
  buildStageWorkspaceFallbackState,
  buildUnifiedWorkflowCockpitSummary,
  buildUnifiedWorkflowJudgment,
  buildUnifiedWorkflowStatusStack,
  buildUnifiedWorkflowDecision,
  buildUnifiedWorkflowConfirmation,
  buildUnifiedWorkflowCollaboration,
  buildUnifiedWorkflowStageRelay,
  resolveUnifiedStageNarrative,
  resolveUnifiedNextAction,
  getWorkspacePageShellConfig,
  getWorkspaceLayoutConfig,
  getWorkspaceModeSwitchConfig,
  resolveWorkspaceShellRuntime,
  getWorkspaceActionCopy,
  renderWorkspaceSection,
  renderWorkspaceKeyValueSection,
  renderWorkspaceGuideSummarySection,
  renderWorkspaceVisibilitySummarySection,
  renderWorkspaceGuideDetailSection,
  buildCommonDeclaredSectionRenderers,
  buildCommonContentLeadSections,
  renderResolvedWorkspaceDecisionSection,
  renderResolvedWorkspaceSummarySection,
  renderWorkspaceGridSection,
  renderWorkspaceBodySection,
  renderWorkspaceAdvancedSection,
  renderWorkspaceFlowSection,
  renderWorkspaceAssetStatusSection,
  renderWorkspaceActionStatusSection,
  buildWorkspaceCockpitSummaryData,
  buildWorkspaceContextBarData,
  buildWorkspaceContextFallback,
  resolveWorkspaceContextBarData,
  resolveWorkspaceViewContextBarData,
  resolveWorkspaceStageView,
  resolveWorkspaceStageViewValue,
  resolveWorkspaceStagePageData,
  resolveWorkspaceStageSection,
  resolveWorkspaceStageStateValue,
  resolveWorkspaceStageViewField,
  resolveWorkspaceStageContextBarData,
  resolveWorkspaceStageSessionConsole,
  resolveWorkspaceStageActionStatus,
  resolveWorkspaceStageDialogueStatus,
  resolveWorkspaceStageConfirmationState,
  buildWorkspaceDecisionSectionData,
  buildWorkspaceDecisionItems,
  buildWorkspaceDirectionSectionData,
  buildWorkspaceStageGuideFallback,
  buildWorkspaceStageWorkbenchCards,
  buildWorkspaceStageVisibilityFallback,
  buildWorkspaceGuideSectionData,
  buildWorkspaceContextCounts,
  buildWorkspaceContextHints,
  buildWorkspaceStageFallbackBundle,
  buildWorkspaceStageDefaultHints,
  buildWorkspaceHeroCardsData,
  buildWorkspaceIssuesSectionData,
  resolveWorkspaceGuideSectionData,
  resolveWorkspaceDirectionSectionData,
  resolveWorkspaceAssetsSectionData,
  resolveWorkspaceReadinessSectionData,
  resolveWorkspaceIssuesSectionData,
  resolveWorkspaceDecisionSectionData,
  resolveWorkspaceSummarySectionData,
  resolveWorkspaceViewSummarySection,
  resolveWorkspaceStageSummarySection,
  buildWorkspacePreviewSectionData,
  buildWorkspaceReadinessSectionData,
  buildWorkspaceRoutePointData,
  buildWorkspaceStandardRoutePoint,
  buildWorkspaceRouteSectionData,
  buildWorkspaceRouteFallback,
  buildWorkspaceStageRouteFallback,
  resolveWorkspaceRouteSectionByStage,
  resolveWorkspaceViewRouteSection,
  resolveWorkspaceStageRouteSection,
  resolveWorkspaceRouteSectionData,
  buildWorkspaceAssetsSectionData,
  buildWorkspaceAdvancedSectionData,
  renderWorkspaceJudgmentPanelSection,
  renderWorkspaceSessionConsoleSection,
  renderWorkspaceCockpitSummarySection,
  renderWorkspaceConfirmationSection,
  renderWorkspaceTimelineSection,
  adaptWorkflowCopilot,
  buildWorkspaceCollaborationSectionData,
  buildWorkspaceRouteData,
  buildWorkspaceSummarySectionData,
  buildWorkspaceStageRelayData,
  buildWorkspaceWorkbenchCardData,
  buildWorkspaceStandardWorkbenchCard,
  buildWorkspaceWorkbenchData,
  buildWorkspaceWorkbenchSectionData,
  resolveWorkspaceWorkbenchSectionData,
  resolveWorkspaceViewWorkbenchSection,
  resolveWorkspaceStageWorkbenchSection,
  buildRenderableWorkbench,
  buildWorkspaceContentSectionPlan,
  resolveWorkspaceViewContentSectionPlan,
  resolveWorkspaceStageContentSectionPlan,
  renderWorkspaceCollaborationSection,
  renderWorkspaceStageRelaySection,
  renderWorkspaceTransitionStatusSection,
  renderWorkspaceDialogueStatusSection,
  renderWorkspaceSignalBar,
  buildConfirmationStateFromUnifiedStatus,
  buildCollaborationFromUnifiedStatus,
  buildStageRelayFromUnifiedStatus,
  buildWorkflowContractPageState,
  buildActionStatusFromUnifiedStatus,
  finalizeWorkspaceActionStatus,
  buildDialogueStatusFromUnifiedStatus,
  finalizeCollaborationPromptState,
  resolveWorkflowDefaultText,
  buildWorkflowTextDefaults,
  buildTaskControlBarFromUnifiedStatus,
  finalizeTaskControlBar,
  renderWorkspaceTaskControlBar,
  renderWorkspaceStatusStack,
  renderWorkspaceCopilotDeck,
  renderWorkspaceSectionLayout,
  renderWorkspacePageShell,
  renderWorkspaceDeclaredSections,
  renderWorkspaceStyles,
  buildWorkspaceStateTopology,
};
