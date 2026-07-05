const {
  toArray,
  normalizeText,
  ISSUE_TYPES,
  RESULT_STATUSES,
  ASSET_KINDS,
  LIFECYCLE_STATUSES,
  RESOLUTION_STATES,
  ISSUE_ACTION_IDS,
  ISSUE_GROUP_IDS,
} = require('../shared/workspace');

const CONTRACTS = {
  runPlan: {
    file: 'internal/run_plan.json',
    required: ['schemaVersion', 'phase', 'task', 'readiness', 'promptPlan', 'materials'],
  },
  executionManifest: {
    file: 'internal/execution_manifest.json',
    required: ['schemaVersion', 'phase', 'execution', 'counts', 'results'],
  },
  issueQueue: {
    file: 'internal/issue_queue.json',
    required: ['schemaVersion', 'supportedTypes', 'summary', 'groups', 'items'],
  },
  assetLibrary: {
    file: 'internal/asset_library.json',
    required: ['schemaVersion', 'directories', 'groups', 'assets'],
  },
  workspaceState: {
    file: 'internal/workspace_state.json',
    required: ['schemaVersion', 'task', 'stage', 'primaryAction', 'nextBestStep', 'replySuggestions'],
  },
  viewModel: {
    file: 'internal/view_models/*.json',
    required: ['schemaVersion', 'pageId', 'title', 'task', 'primaryAction', 'sections'],
  },
};

function validateObject(name, value, required = []) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${name} 必须是对象`);
    return errors;
  }
  required.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      errors.push(`${name} 缺少字段: ${key}`);
    }
  });
  return errors;
}

function expectType(errors, name, value, type) {
  if (type === 'array') {
    if (!Array.isArray(value)) errors.push(`${name} 必须是数组`);
    return;
  }
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) errors.push(`${name} 必须是对象`);
    return;
  }
  if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${name} 必须是数字`);
    return;
  }
  if (typeof value !== type) errors.push(`${name} 必须是${type === 'boolean' ? '布尔值' : '字符串'}`);
}

function expectEnum(errors, name, value, supported) {
  if (!supported.includes(value)) errors.push(`${name} 不支持: ${value}`);
}

function validateAction(action, label = 'action') {
  const errors = validateObject(label, action, [
    'id',
    'label',
    'intent',
    'href',
    'targetPage',
    'reply',
    'reason',
    'enabled',
    'disabledReason',
    'riskLevel',
  ]);
  if (!action || typeof action !== 'object' || Array.isArray(action)) return errors;
  ['id', 'label', 'intent', 'reply', 'reason', 'riskLevel'].forEach((key) => expectType(errors, `${label}.${key}`, action[key], 'string'));
  if (action.href !== null) expectType(errors, `${label}.href`, action.href, 'string');
  if (action.targetPage !== null) expectType(errors, `${label}.targetPage`, action.targetPage, 'string');
  expectType(errors, `${label}.enabled`, action.enabled, 'boolean');
  if (action.disabledReason !== null) expectType(errors, `${label}.disabledReason`, action.disabledReason, 'string');
  return errors;
}

function validateTaskSpec(spec = {}) {
  const errors = validateObject('task_spec', spec, ['content_brief']);
  const width = Number(spec.width || 0);
  const height = Number(spec.height || 0);
  if (width && width < 16) errors.push('width 不能小于 16');
  if (height && height < 16) errors.push('height 不能小于 16');
  return {
    ok: errors.length === 0,
    errors,
    warnings: spec.content_brief ? [] : ['任务说明为空，页面会显示默认任务名'],
    normalized: {
      ...spec,
      total_count: Number(spec.total_count || spec.totalCount || 0) || toArray(spec.prompts).length || null,
      batch_size: Number(spec.batch_size || spec.batchSize || 0) || null,
      width: width || null,
      height: height || null,
    },
  };
}

function validatePromptStrategy(strategy = {}) {
  const errors = validateObject('prompt_strategy', strategy, []);
  return {
    ok: errors.length === 0,
    errors,
    warnings: [],
    normalized: {
      ...strategy,
      content_brief: normalizeText(strategy.content_brief || strategy.brief),
    },
  };
}

function validatePromptList(prompts = []) {
  const errors = [];
  if (!Array.isArray(prompts)) {
    errors.push('prompts 必须是数组');
  } else {
    prompts.forEach((item, index) => {
      if (!normalizeText(item.generation_prompt || item.prompt)) {
        errors.push(`第 ${index + 1} 条缺少提示词`);
      }
      const mode = normalizeText(item.reference_mode || item.referenceMode);
      const refs = toArray(item.reference_images || item.referenceImages || item.params?.reference_images);
      const mask = normalizeText(item.mask_image || item.edit_mask || item.params?.mask_image);
      if (mode === 'reference-assisted' && refs.length === 0) {
        errors.push(`第 ${index + 1} 条需要参考图，但没有提供参考图`);
      }
      if (mode === 'masked-edit' && (!refs.length || !mask)) {
        errors.push(`第 ${index + 1} 条需要参考图和遮罩`);
      }
    });
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}

function assertContract(name, value) {
  const contract = CONTRACTS[name];
  if (!contract) throw new Error(`未知契约: ${name}`);
  const errors = validateObject(name, value, contract.required);
  if (!errors.length) {
    if (name === 'runPlan') errors.push(...validateRunPlan(value));
    if (name === 'executionManifest') errors.push(...validateExecutionManifest(value));
    if (name === 'issueQueue') errors.push(...validateIssueQueue(value));
    if (name === 'assetLibrary') errors.push(...validateAssetLibrary(value));
    if (name === 'workspaceState') errors.push(...validateWorkspaceState(value));
    if (name === 'viewModel') errors.push(...validateViewModel(value));
  }
  if (errors.length) throw new Error(errors.join('; '));
  return true;
}

function validateRunPlan(plan = {}) {
  const errors = [];
  expectType(errors, 'runPlan.schemaVersion', plan.schemaVersion, 'number');
  expectEnum(errors, 'runPlan.phase', plan.phase, ['prepare']);
  expectType(errors, 'runPlan.task', plan.task, 'object');
  expectType(errors, 'runPlan.readiness', plan.readiness, 'object');
  expectType(errors, 'runPlan.promptPlan', plan.promptPlan, 'object');
  expectType(errors, 'runPlan.materials', plan.materials, 'object');
  if (plan.task) {
    ['id', 'title', 'summary'].forEach((key) => expectType(errors, `runPlan.task.${key}`, plan.task[key], 'string'));
  }
  if (plan.readiness) {
    expectType(errors, 'runPlan.readiness.canRun', plan.readiness.canRun, 'boolean');
    expectType(errors, 'runPlan.readiness.blockingItems', plan.readiness.blockingItems, 'array');
    expectType(errors, 'runPlan.readiness.attentionItems', plan.readiness.attentionItems, 'array');
  }
  if (plan.promptPlan) {
    ['promptCount', 'batchCount'].forEach((key) => expectType(errors, `runPlan.promptPlan.${key}`, plan.promptPlan[key], 'number'));
    expectType(errors, 'runPlan.promptPlan.items', plan.promptPlan.items, 'array');
    toArray(plan.promptPlan.items).forEach((item, index) => {
      expectType(errors, `runPlan.promptPlan.items[${index}]`, item, 'object');
      if (item) ['id', 'userTitle', 'summary'].forEach((key) => expectType(errors, `runPlan.promptPlan.items[${index}].${key}`, item[key], 'string'));
    });
  }
  if (plan.materials) {
    ['inputs', 'references', 'masks'].forEach((key) => expectType(errors, `runPlan.materials.${key}`, plan.materials[key], 'array'));
    ['inputCount', 'referenceCount', 'maskCount'].forEach((key) => expectType(errors, `runPlan.materials.${key}`, plan.materials[key], 'number'));
    ['inputs', 'references', 'masks'].forEach((key) => {
      toArray(plan.materials[key]).forEach((item, index) => {
        expectType(errors, `runPlan.materials.${key}[${index}]`, item, 'object');
        if (item) ['id', 'title'].forEach((field) => expectType(errors, `runPlan.materials.${key}[${index}].${field}`, item[field], 'string'));
      });
    });
  }
  return errors;
}

function validateExecutionManifest(manifest = {}) {
  const errors = [];
  expectType(errors, 'executionManifest.schemaVersion', manifest.schemaVersion, 'number');
  expectEnum(errors, 'executionManifest.phase', manifest.phase, ['execute']);
  expectType(errors, 'executionManifest.execution', manifest.execution, 'object');
  expectType(errors, 'executionManifest.counts', manifest.counts, 'object');
  expectType(errors, 'executionManifest.results', manifest.results, 'array');
  if (manifest.execution) {
    expectType(errors, 'executionManifest.execution.mode', manifest.execution.mode, 'string');
    expectType(errors, 'executionManifest.execution.provider', manifest.execution.provider, 'string');
    expectType(errors, 'executionManifest.execution.paused', manifest.execution.paused, 'boolean');
    expectType(errors, 'executionManifest.execution.dryRun', manifest.execution.dryRun, 'boolean');
  }
  if (manifest.counts) {
    ['total', 'success', 'failed', 'needsReview', 'skipped'].forEach((key) => expectType(errors, `executionManifest.counts.${key}`, manifest.counts[key], 'number'));
  }
  toArray(manifest.results).forEach((item, index) => {
    expectType(errors, `executionManifest.results[${index}]`, item, 'object');
    if (!item) return;
    ['id', 'title', 'requestKind'].forEach((key) => expectType(errors, `executionManifest.results[${index}].${key}`, item[key], 'string'));
    expectEnum(errors, `executionManifest.results[${index}].status`, item.status, RESULT_STATUSES);
    if (item.output !== null) expectType(errors, `executionManifest.results[${index}].output`, item.output, 'string');
    if (item.error !== null) expectType(errors, `executionManifest.results[${index}].error`, item.error, 'string');
  });
  return errors;
}

function validateIssueQueue(queue = {}) {
  const errors = [];
  expectType(errors, 'issueQueue.schemaVersion', queue.schemaVersion, 'number');
  expectType(errors, 'issueQueue.supportedTypes', queue.supportedTypes, 'array');
  expectType(errors, 'issueQueue.summary', queue.summary, 'object');
  expectType(errors, 'issueQueue.groups', queue.groups, 'array');
  expectType(errors, 'issueQueue.items', queue.items, 'array');
  toArray(queue.groups).forEach((group, index) => {
    expectType(errors, `issueQueue.groups[${index}]`, group, 'object');
    if (!group) return;
    expectEnum(errors, `issueQueue.groups[${index}].id`, group.id, ISSUE_GROUP_IDS);
    expectType(errors, `issueQueue.groups[${index}].title`, group.title, 'string');
    expectType(errors, `issueQueue.groups[${index}].itemIds`, group.itemIds, 'array');
  });
  toArray(queue.items).forEach((item, index) => {
    expectType(errors, `issueQueue.items[${index}]`, item, 'object');
    if (!item) return;
    expectEnum(errors, `issueQueue.items[${index}].type`, item.type, ISSUE_TYPES);
    expectEnum(errors, `issueQueue.items[${index}].resolutionState`, item.resolutionState, RESOLUTION_STATES);
    ['id', 'severity', 'title', 'impact', 'userImpact', 'recommendedAction', 'userNextStep'].forEach((key) => expectType(errors, `issueQueue.items[${index}].${key}`, item[key], 'string'));
    ['blocking', 'worthRerun'].forEach((key) => expectType(errors, `issueQueue.items[${index}].${key}`, item[key], 'boolean'));
    expectType(errors, `issueQueue.items[${index}].relatedAssetIds`, item.relatedAssetIds, 'array');
    expectType(errors, `issueQueue.items[${index}].availableActions`, item.availableActions, 'array');
    toArray(item.availableActions).forEach((action, actionIndex) => {
      errors.push(...validateAction(action, `issueQueue.items[${index}].availableActions[${actionIndex}]`));
      if (action?.id) expectEnum(errors, `issueQueue.items[${index}].availableActions[${actionIndex}].id`, action.id, ISSUE_ACTION_IDS);
    });
  });
  return errors;
}

function validateAssetLibrary(library = {}) {
  const errors = [];
  expectType(errors, 'assetLibrary.schemaVersion', library.schemaVersion, 'number');
  expectType(errors, 'assetLibrary.directories', library.directories, 'object');
  expectType(errors, 'assetLibrary.groups', library.groups, 'array');
  expectType(errors, 'assetLibrary.assets', library.assets, 'array');
  toArray(library.groups).forEach((group, index) => {
    expectType(errors, `assetLibrary.groups[${index}]`, group, 'object');
    if (!group) return;
    expectType(errors, `assetLibrary.groups[${index}].id`, group.id, 'string');
    expectType(errors, `assetLibrary.groups[${index}].title`, group.title, 'string');
    expectType(errors, `assetLibrary.groups[${index}].assetIds`, group.assetIds, 'array');
  });
  toArray(library.assets).forEach((asset, index) => {
    expectType(errors, `assetLibrary.assets[${index}]`, asset, 'object');
    if (!asset) return;
    expectEnum(errors, `assetLibrary.assets[${index}].kind`, asset.kind, ASSET_KINDS);
    expectEnum(errors, `assetLibrary.assets[${index}].lifecycleStatus`, asset.lifecycleStatus, LIFECYCLE_STATUSES);
    ['id', 'userTitle', 'userStatus', 'userPurpose', 'userAction', 'sourceReason', 'path', 'group'].forEach((key) => expectType(errors, `assetLibrary.assets[${index}].${key}`, asset[key], 'string'));
    expectType(errors, `assetLibrary.assets[${index}].usage`, asset.usage, 'object');
    if (asset.usage) ['canSelect', 'needsReview', 'hasIssue', 'canExport'].forEach((key) => expectType(errors, `assetLibrary.assets[${index}].usage.${key}`, asset.usage[key], 'boolean'));
    expectType(errors, `assetLibrary.assets[${index}].relationships`, asset.relationships, 'object');
    expectType(errors, `assetLibrary.assets[${index}].source`, asset.source, 'object');
    if (asset.source) expectEnum(errors, `assetLibrary.assets[${index}].source.stage`, asset.source.stage, ['prepare', 'execute']);
  });
  return errors;
}

function validateWorkspaceState(state = {}) {
  const errors = [];
  expectType(errors, 'workspaceState.schemaVersion', state.schemaVersion, 'number');
  expectType(errors, 'workspaceState.task', state.task, 'object');
  expectType(errors, 'workspaceState.stage', state.stage, 'object');
  errors.push(...validateAction(state.primaryAction, 'workspaceState.primaryAction'));
  expectType(errors, 'workspaceState.secondaryActions', state.secondaryActions, 'array');
  toArray(state.secondaryActions).forEach((action, index) => errors.push(...validateAction(action, `workspaceState.secondaryActions[${index}]`)));
  expectType(errors, 'workspaceState.nextBestStep', state.nextBestStep, 'object');
  expectType(errors, 'workspaceState.replySuggestions', state.replySuggestions, 'array');
  if (state.stage) {
    expectEnum(errors, 'workspaceState.stage.id', state.stage.id, ['prepare', 'results', 'issues', 'record']);
    expectEnum(errors, 'workspaceState.stage.status', state.stage.status, ['ready', 'blocked', 'attention']);
  }
  if (state.nextBestStep) ['actionId', 'page', 'reply', 'reason'].forEach((key) => expectType(errors, `workspaceState.nextBestStep.${key}`, state.nextBestStep[key], 'string'));
  return errors;
}

function validateViewModel(model = {}) {
  const errors = [];
  expectType(errors, 'viewModel.schemaVersion', model.schemaVersion, 'number');
  expectEnum(errors, 'viewModel.pageId', model.pageId, ['index', 'prepare', 'results', 'issues', 'record']);
  expectType(errors, 'viewModel.title', model.title, 'string');
  expectType(errors, 'viewModel.task', model.task, 'object');
  errors.push(...validateAction(model.primaryAction, 'viewModel.primaryAction'));
  expectType(errors, 'viewModel.sections', model.sections, 'array');
  return errors;
}

module.exports = {
  CONTRACTS,
  validateAction,
  validateTaskSpec,
  validatePromptStrategy,
  validatePromptList,
  assertContract,
};
