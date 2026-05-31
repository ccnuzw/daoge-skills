const fs = require('fs');
const path = require('path');
const { readJson, fileExists } = require('./script_utils');
const { buildDefaultGenerationContract } = require('./default_generation_contract');

function normalizeText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeList(value, fallback = []) {
  const items = Array.isArray(value) ? value : [];
  const normalized = items.map((item) => normalizeText(item)).filter(Boolean);
  return normalized.length ? normalized : fallback;
}

function buildTaskCenterEntryProtocol(options = {}) {
  return {
    version: Number(options.version || 1),
    source: normalizeText(options.source, 'task_center_live_state.json'),
    role: normalizeText(options.role, '跨任务入口实时状态源'),
    owns: normalizeList(options.owns, ['任务总控实时状态', '入口主链提醒', '跨任务切换', '运行态副驾驶交接']),
    userRule: normalizeText(
      options.userRule,
      '任务内判断看工作台首页，也就是任务内判断交给工作台首页；跨任务入口、开新任务、继续任务和运行中提醒看任务总控；单轮任务判断交给工作台首页。'
    ),
    entryGuideKey: normalizeText(options.entryGuideKey, 'entryMainlineGuide'),
    runtimeFields: normalizeList(options.runtimeFields, ['runtimeMode', 'runtimeFocus', 'handoffRule']),
    handoffRule: normalizeText(
      options.handoffRule,
      '任务总控只决定开新任务或继续哪一轮；选定任务后，单轮判断交给工作台首页和四站主链。'
    ),
    summary: normalizeText(
      options.summary,
      '跨任务入口看任务总控；单轮任务怎么推进，看工作台首页。'
    ),
  };
}

function resolveTaskCenterEntryProtocol(source = {}, options = {}) {
  const protocol = source && typeof source === 'object' ? source : {};
  return buildTaskCenterEntryProtocol({
    ...protocol,
    source: normalizeText(options.source || protocol.source, protocol.source || 'task_center_live_state.json'),
  });
}

function buildEntryDefaultGenerationProtocol(options = {}) {
  const contract = buildDefaultGenerationContract({
    mode: options.mode || options.optionalPageMode || 'mainline-only',
  });
  return {
    mode: contract.currentMode.mode,
    targetMode: contract.targetMode,
    generatedHtmlFiles: contract.currentMode.generatedHtmlFiles,
    hiddenHtmlFiles: contract.currentMode.hiddenHtmlFiles,
    guardrail: contract.defaultGenerationGuardrail,
    reductionRule: contract.reductionRule,
    summary: normalizeText(
      options.summary,
      '入口层默认只带用户进入主链工作台；深看页、旧入口和内部资产不作为普通用户默认入口。'
    ),
  };
}

function resolveEntryDefaultGenerationProtocol(source = {}, options = {}) {
  const protocol = source && typeof source === 'object' ? source : {};
  const fallback = buildEntryDefaultGenerationProtocol({
    mode: options.mode || protocol.mode || 'mainline-only',
    summary: protocol.summary,
  });
  return {
    ...fallback,
    ...protocol,
    mode: normalizeText(protocol.mode, fallback.mode),
    targetMode: normalizeText(protocol.targetMode, fallback.targetMode),
    generatedHtmlFiles: normalizeList(protocol.generatedHtmlFiles, fallback.generatedHtmlFiles),
    hiddenHtmlFiles: normalizeList(protocol.hiddenHtmlFiles, fallback.hiddenHtmlFiles),
    guardrail: protocol.guardrail && typeof protocol.guardrail === 'object'
      ? { ...fallback.guardrail, ...protocol.guardrail }
      : fallback.guardrail,
    reductionRule: normalizeText(protocol.reductionRule, fallback.reductionRule),
    summary: normalizeText(protocol.summary, fallback.summary),
  };
}

function loadEntryState(entryStateFile) {
  if (!entryStateFile) return null;
  const resolved = path.resolve(entryStateFile);
  if (!fileExists(resolved)) return null;
  return readJson(resolved);
}

function entryModeLabel(entryState) {
  const mode = normalizeText(entryState?.entryMode);
  if (mode === 'intent') return '按任务意图进入';
  if (mode === 'example') return '按示例入口进入';
  return '首次进入';
}

function resolveEntryMainlineProtocol(entryState, options = {}) {
  const source = entryState?.entryMainlineProtocol && typeof entryState.entryMainlineProtocol === 'object'
    ? entryState.entryMainlineProtocol
    : {};
  const taskCenterEntryProtocol = resolveTaskCenterEntryProtocol(source.taskCenterEntryProtocol, {
    source: options.taskCenterUnifiedState,
  });
  const defaultGenerationProtocol = resolveEntryDefaultGenerationProtocol(source.defaultGenerationProtocol, {
    mode: options.optionalPageMode,
  });
  const sequence = Array.isArray(source.sequence) && source.sequence.length
    ? source.sequence
    : ['中文模板展示板', '任务总控', '工作台首页', '准备工作台', '结果工作台', '异常工作台'];
  const currentLayer = normalizeText(options.currentLayer || source.currentLayer, '入口层');
  return {
    version: Number(source.version || 1),
    currentLayer,
    sequence,
    sequenceLabel: normalizeText(source.sequenceLabel, sequence.join(' -> ')),
    entryRole: normalizeText(source.entryRole, '模板展示板只负责选择任务类型和起步入口。'),
    taskCenterRole: normalizeText(source.taskCenterRole, '任务总控只负责开新任务、继续当前任务和切换任务。'),
    workspaceRole: normalizeText(source.workspaceRole, '工作台首页接住单轮任务判断，再顺着准备、结果、异常继续。'),
    handoffRule: normalizeText(source.handoffRule, '入口层一旦选定任务，就把方向交给准备工作台；任务总控只做任务级切换，不展开单轮内部判断。'),
    taskCenterEntryProtocol,
    defaultGenerationProtocol,
    summary: normalizeText(source.summary, '先在中文模板展示板选任务，再到任务总控决定开新任务或继续任务，进入工作台首页后就沿四站主链推进。'),
  };
}

function resolveEntryPreview(entryState) {
  const selectedEntry = entryState?.entryWorkbench?.selectedEntry;
  if (selectedEntry && (selectedEntry.title || selectedEntry.summary)) {
    return {
      title: normalizeText(selectedEntry.title, '当前还没有选中的入口'),
      summary: normalizeText(selectedEntry.summary, '先按任务意图开始，或者从推荐起步里挑一个最像你需求的入口。'),
    };
  }
  if (!entryState || !entryState.selectedExample) {
    return {
      title: '当前还没有选中的入口',
      summary: '先按任务意图开始，或者从推荐起步里挑一个最像你需求的入口。',
    };
  }
  const selected = entryState.selectedExample;
  return {
    title: normalizeText(selected.name || selected.id, '当前还没有选中的入口'),
    summary: normalizeText(selected.description, '当前入口已经选定，可以继续进入准备工作台。'),
  };
}

function resolveEntryNextStep(baseDir, entryState, options = {}) {
  const routedNext = entryState?.entryWorkbench?.route?.next || null;
  const routedLabel = normalizeText(routedNext?.label);
  const routedReason = normalizeText(routedNext?.reason || routedNext?.summary);
  const routedTarget = normalizeText(routedNext?.target || routedNext?.file);
  const fallbackPrepare = options.prepareFile || path.join(baseDir, 'prepare_workspace.html');
  const fallbackHome = options.homeFile || path.join(baseDir, 'workspace_home.html');
  const target = routedTarget || normalizeText(entryState?.recommendedNextStep?.target);
  const label = routedLabel || normalizeText(entryState?.recommendedNextStep?.label, '生成预检工作台');
  const reason = routedReason
    || normalizeText(entryState?.recommendedNextStep?.reason, '先进入准备工作台确认方向、放行和素材绑定。');

  let absoluteTarget = null;
  if (target) {
    absoluteTarget = path.isAbsolute(target) ? target : path.resolve(baseDir, target);
  } else if (fs.existsSync(fallbackPrepare)) {
    absoluteTarget = fallbackPrepare;
  } else if (fs.existsSync(fallbackHome)) {
    absoluteTarget = fallbackHome;
  }

  return {
    label,
    reason,
    file: absoluteTarget,
  };
}

function resolveEntryRoute(baseDir, entryState, options = {}) {
  const route = entryState?.entryWorkbench?.route || {};
  const nextStep = options.nextStep || resolveEntryNextStep(baseDir, entryState, options);
  return {
    title: normalizeText(route.title, '从入口层继续'),
    copy: normalizeText(route.copy, '入口层只负责选任务和选起步入口，确认后就直接进入准备工作台。'),
    current: route.current && typeof route.current === 'object'
      ? {
        ...route.current,
        kicker: normalizeText(route.current.kicker, '当前入口'),
      }
      : null,
    next: {
      kicker: normalizeText(route.next?.kicker, '建议下一步'),
      label: nextStep.label,
      summary: normalizeText(route.next?.reason || route.next?.summary, nextStep.reason),
      file: route.next?.file || route.next?.target || nextStep.file,
      cta: normalizeText(route.next?.cta, '继续下一步'),
      pendingLabel: normalizeText(route.next?.pendingLabel, '当前还没有生成下一页'),
    },
  };
}

function resolveEntryWorkbench(baseDir, entryState, options = {}) {
  const workbench = entryState?.entryWorkbench?.workbench || null;
  const entryPreview = options.entryPreview || resolveEntryPreview(entryState);
  const nextStep = options.nextStep || resolveEntryNextStep(baseDir, entryState, options);
  const currentTaskCategory = normalizeText(options.currentTaskCategory || entryState?.taskCategory, '尚未选择');

  if (!workbench) {
    return {
      title: '入口层主控',
      copy: '入口层只保留选任务、看入口和进入准备层这几件高频动作。',
      cards: [
        {
          label: '当前入口',
          value: entryPreview.title,
          summary: entryPreview.summary,
          tone: entryState ? 'good' : 'neutral',
          hideLinkIfMissing: true,
        },
        {
          label: '当前任务组',
          value: currentTaskCategory,
          summary: currentTaskCategory === '尚未选择' ? '先判断你的任务属于哪一类。' : '这一组会决定你优先看哪类入口。',
          tone: currentTaskCategory === '尚未选择' ? 'warn' : 'info',
          hideLinkIfMissing: true,
        },
        {
          label: '推荐下一步',
          value: nextStep.label,
          summary: nextStep.reason,
          file: nextStep.file,
          cta: '进入下一步',
          pendingLabel: '下一步页面尚未生成',
          tone: 'good',
        },
      ],
    };
  }

  const cards = Array.isArray(workbench.cards) ? workbench.cards.map((card) => {
    if (!card || typeof card !== 'object') return null;
    if (normalizeText(card.label) === '推荐下一步') {
      return {
        ...card,
        value: normalizeText(card.value, nextStep.label),
        summary: normalizeText(card.summary, nextStep.reason),
        file: card.file || nextStep.file,
        cta: normalizeText(card.cta, '进入下一步'),
        pendingLabel: normalizeText(card.pendingLabel, '下一步页面尚未生成'),
      };
    }
    return { ...card };
  }).filter(Boolean) : [];

  return {
    title: normalizeText(workbench.title, '入口层主控'),
    copy: normalizeText(workbench.copy, '入口层只保留选任务、看入口和进入准备层这几件高频动作。'),
    cards,
  };
}

function resolveEntryContext(entryState, options = {}) {
  const currentTaskCategory = normalizeText(options.currentTaskCategory || entryState?.taskCategory, '尚未选择');
  const currentStarterIntent = normalizeText(options.currentStarterIntent || entryState?.starterIntent, '尚未选择');
  const entryPreview = options.entryPreview || resolveEntryPreview(entryState);
  const nextStep = options.nextStep || {
    reason: '先进入准备工作台确认方向、放行和素材绑定。',
  };
  const mainlineProtocol = options.mainlineProtocol || resolveEntryMainlineProtocol(entryState);
  const source = entryState?.entryContext && typeof entryState.entryContext === 'object'
    ? entryState.entryContext
    : {};

  return {
    runLabel: normalizeText(source.runLabel, entryPreview.title),
    phaseLabel: normalizeText(source.phaseLabel, '入口层'),
    flowLabel: normalizeText(source.flowLabel, mainlineProtocol.sequenceLabel || '中文模板展示板 -> 任务总控 -> 工作台首页 -> 准备工作台'),
    counts: Array.isArray(source.counts) && source.counts.length
      ? source.counts
      : [
        { label: '进入方式', value: entryModeLabel(entryState) },
        { label: '当前任务组', value: currentTaskCategory },
        { label: '当前意图', value: currentStarterIntent },
      ],
    hints: Array.isArray(source.hints) && source.hints.length
      ? source.hints
      : [
        entryPreview.summary,
        mainlineProtocol.handoffRule,
        normalizeText(nextStep.reason, '先进入准备工作台确认方向、放行和素材绑定。'),
      ],
  };
}

module.exports = {
  buildEntryDefaultGenerationProtocol,
  buildTaskCenterEntryProtocol,
  entryModeLabel,
  loadEntryState,
  resolveEntryDefaultGenerationProtocol,
  resolveEntryContext,
  resolveEntryMainlineProtocol,
  resolveEntryNextStep,
  resolveEntryPreview,
  resolveEntryRoute,
  resolveTaskCenterEntryProtocol,
  resolveEntryWorkbench,
};
