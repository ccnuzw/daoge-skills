const DEFAULT_STRATEGY_ID = 'offline';

const STATUS_LABELS = Object.freeze({
  available: '本地可做',
  deferred: '延后决定',
  explicit: '需明确发起',
  blocked: '不执行',
  separate: '另行选择'
});

const CAPABILITY_DIMENSIONS = Object.freeze([
  { id: 'local', label: '本地离线可做' },
  { id: 'deferred', label: '延后联网' },
  { id: 'canary', label: '显式 Canary' },
  { id: 'provider', label: '显式真实 Provider' }
]);

const TRADEOFF_DIMENSIONS = Object.freeze([
  { id: 'network', label: '网络副作用' },
  { id: 'privacy', label: '隐私取舍' },
  { id: 'billing', label: '计费取舍' }
]);

const TRADEOFF_LABELS = Object.freeze({
  none: '当前无副作用',
  local: '留在本机',
  later: '仅未来决定',
  'none-now': '当前不计费',
  'local-until-explicit': '明确恢复前留在本机',
  explicit: '仅明确发起',
  possible: '可能产生费用',
  'controlled-external': '受控发送',
  'external-by-confirmation': '确认后发送',
  'provider-dependent': '依 Provider 规则'
});

function capability(state, detail) {
  return Object.freeze({ state, statusLabel: STATUS_LABELS[state] || STATUS_LABELS.separate, detail });
}

function tradeoff(level, detail) {
  return Object.freeze({ level, levelLabel: TRADEOFF_LABELS[level] || '需进一步确认', detail });
}
export const DEFAULT_OFFLINE_STRATEGY_ID = DEFAULT_STRATEGY_ID;

function strategy({ id, label, marker, summary, guardrail, capabilities, tradeoffs, providerCall, requiresExplicitAction = providerCall !== 'none' }) {
  return Object.freeze({
    id,
    label,
    marker,
    summary,
    guardrail,
    capabilities: Object.freeze(capabilities),
    tradeoffs: Object.freeze(tradeoffs),
    providerCall,
    automaticNetwork: false,
    automaticGeneration: false,
    requiresExplicitAction
  });
}

export const OFFLINE_STRATEGY_IDS = Object.freeze(['offline', 'deferred', 'canary', 'provider']);
export const OFFLINE_STRATEGY_DIMENSIONS = CAPABILITY_DIMENSIONS;
export const OFFLINE_STRATEGY_TRADEOFFS = TRADEOFF_DIMENSIONS;

export const OFFLINE_STRATEGIES = Object.freeze([
  strategy({
    id: 'offline',
    label: '本地离线',
    marker: '默认路径',
    summary: '先在本机整理目标、约束和策略差异；不连接服务，也不生成图片。',
    guardrail: '适合目标澄清、参考角色拆分和提示策略比较。页面只改变本地阅读状态，不排队、不上传、不创建运行。',
    providerCall: 'none',
    capabilities: {
      local: capability('available', '整理目标、约束、参考角色和比较维度；不提交、不生成。'),
      deferred: capability('deferred', '可以写下之后由用户决定的联网待办；不会创建联网队列或自动恢复。'),
      canary: capability('blocked', '离线时不触发 Canary；恢复连接后仍须由用户明确发起受控 Canary。'),
      provider: capability('blocked', '不访问真实 Provider，不创建 Generation Run，也不暗示已有生成结果。')
    },
    tradeoffs: {
      network: tradeoff('none', '当前没有网络请求；不会自动重连、上传、排队或重放。'),
      privacy: tradeoff('local', '提示策略、比较内容和本地判断留在本机页面；不新增外部副本。'),
      billing: tradeoff('none', '不访问 Provider，不产生 Provider 调用或费用。')
    }
  }),
  strategy({
    id: 'deferred',
    label: '延后联网',
    marker: '手动恢复',
    summary: '现在保持离线，把需要联网的步骤和边界列成待办；之后由用户明确恢复。',
    guardrail: '适合网络不稳定、预算待确认或需要先完成本地审阅的情况。延后不是排队：没有后台上传、自动重试或自动生成。',
    providerCall: 'none',
    requiresExplicitAction: true,
    capabilities: {
      local: capability('available', '完成本地策略比较、输入清单和隐私/预算检查；不触发外部动作。'),
      deferred: capability('available', '保留“何时、为何、发给谁”的人工待办；联网时由用户重新确认范围。'),
      canary: capability('explicit', '之后可由用户点名 Canary 并审阅最小载荷；本页不会提前联网。'),
      provider: capability('separate', '真实 Provider 不属于延后说明本身；要调用时需另行选择并确认。')
    },
    tradeoffs: {
      network: tradeoff('later', '当前无网络副作用；未来是否联网、何时联网由用户明确决定。'),
      privacy: tradeoff('local-until-explicit', '在明确恢复前不离开本机；恢复时仍需重新核对提示词、参考图和端点范围。'),
      billing: tradeoff('none-now', '当前不计费；未来 Canary 或真实 Provider 是否计费需在调用前确认。')
    }
  }),
  strategy({
    id: 'canary',
    label: '显式 Canary',
    marker: '受控联网',
    summary: '先完成离线审阅，再由用户明确发起受限 Canary；不自动升级为真实生成。',
    guardrail: 'Canary 是一次明确的联网实验，不是默认连接测试。先核对端点、数据范围、最小载荷和预算，再由会话执行。',
    providerCall: 'canary',
    capabilities: {
      local: capability('available', '联网前仍可在本地整理和比较策略，决定哪些内容允许离开本机。'),
      deferred: capability('available', '可先列出待发数据和退出条件；不把 Canary 变成隐式自动步骤。'),
      canary: capability('explicit', '用户明确发起后，可做受限 Canary；先核对端点、数据和预算。'),
      provider: capability('separate', '不会从 Canary 自动升级为真实 Provider；真实生成必须另行确认。')
    },
    tradeoffs: {
      network: tradeoff('explicit', '只有用户明确发起 Canary 时联网；当前阅读入口本身不发请求。'),
      privacy: tradeoff('controlled-external', '优先发送最小脱敏样本；仍可能离开本机，必须先审阅数据范围和端点信任。'),
      billing: tradeoff('possible', '可能按 Canary Provider 规则计费；不能假设测试免费或没有配额影响。')
    }
  }),
  strategy({
    id: 'provider',
    label: '真实 Provider',
    marker: '需确认',
    summary: '仅在用户明确确认后进入真实 Provider 执行；网络、隐私和计费都按实际请求承担。',
    guardrail: '这不是 Learning Center 的自动动作。必须回到会话完成计划、确认、预检和受控执行；页面不代替这些闸门。',
    providerCall: 'real',
    capabilities: {
      local: capability('available', '仍可先在本地比较策略、检查参考范围和预算，再决定是否发送。'),
      deferred: capability('available', '可以先延后真实请求；是否继续由用户明确决定，不自动排队或重放。'),
      canary: capability('separate', 'Canary 不是必经的自动前置步骤；如需先试，明确切换到 Canary 策略。'),
      provider: capability('explicit', '用户明确确认并完成现有计划/预检边界后，才可调用真实 Provider。')
    },
    tradeoffs: {
      network: tradeoff('explicit', '仅用户明确发起时发送请求或媒体；不自动联网、自动生成或自动重试。'),
      privacy: tradeoff('external-by-confirmation', '经用户确认的提示词和参考素材可能发送给 Provider；发送前应核对内容和端点。'),
      billing: tradeoff('provider-dependent', '按真实 Provider、模型和请求规则可能计费；调用前必须确认预算和配额。')
    }
  })
]);

function strategyIds(input) {
  const values = Array.isArray(input) && input.length ? input : OFFLINE_STRATEGY_IDS;
  const known = new Set(OFFLINE_STRATEGY_IDS);
  const result = [];
  for (const value of values) {
    const id = String(value || '');
    if (known.has(id) && !result.includes(id)) result.push(id);
  }
  return result.length ? result : [...OFFLINE_STRATEGY_IDS];
}

export function offlineStrategyForId(id) {
  return OFFLINE_STRATEGIES.find((item) => item.id === id) || OFFLINE_STRATEGIES[0];
}

export function offlineStrategyStatusLabel(state) {
  return STATUS_LABELS[state] || STATUS_LABELS.separate;
}

export function compareOfflineStrategies(ids = OFFLINE_STRATEGY_IDS) {
  const strategies = strategyIds(ids).map(offlineStrategyForId);
  return {
    defaultStrategyId: DEFAULT_OFFLINE_STRATEGY_ID,
    strategies,
    capabilities: OFFLINE_STRATEGY_DIMENSIONS.map((dimension) => ({
      ...dimension,
      cells: strategies.map((item) => ({ strategyId: item.id, ...item.capabilities[dimension.id] }))
    })),
    tradeoffs: OFFLINE_STRATEGY_TRADEOFFS.map((dimension) => ({
      ...dimension,
      cells: strategies.map((item) => ({ strategyId: item.id, ...item.tradeoffs[dimension.id] }))
    })),
    automaticNetwork: false,
    automaticGeneration: false
  };
}
