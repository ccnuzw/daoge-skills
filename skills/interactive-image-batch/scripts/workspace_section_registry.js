const SECTION_REGISTRY = {
  flow: {
    key: 'flow',
    label: '流程状态',
    layer: 'default',
    audience: 'all',
    summary: '阶段位置、当前判断和推荐动作。',
  },
  judgment: {
    key: 'judgment',
    label: '主控判断',
    layer: 'default',
    audience: 'all',
    summary: '这一站为什么这样判断，以及现在先做什么。',
  },
  stageRelay: {
    key: 'stageRelay',
    label: '阶段接力',
    layer: 'default',
    audience: 'all',
    summary: '从哪来、现在做什么、做完去哪。',
  },
  statusStack: {
    key: 'statusStack',
    label: '状态栈',
    layer: 'default',
    audience: 'all',
    summary: '当前阶段最关键的统一状态信号。',
  },
  collaboration: {
    key: 'collaboration',
    label: '协同接力',
    layer: 'support',
    audience: 'all',
    summary: '最近变化、待确认项和回到对话框怎么继续。',
  },
  assets: {
    key: 'assets',
    label: '资产状态',
    layer: 'support',
    audience: 'all',
    summary: '当前可直接使用的资产和仍待确认的资产。',
  },
  actions: {
    key: 'actions',
    label: '动作入口',
    layer: 'support',
    audience: 'all',
    summary: '页面内主动作、辅助动作和注意点。',
  },
  transitions: {
    key: 'transitions',
    label: '页面交接',
    layer: 'support',
    audience: 'all',
    summary: '进入下一页前已经确认了什么、下一页先看什么。',
  },
  content: {
    key: 'content',
    label: '当前工作区',
    layer: 'content',
    audience: 'all',
    summary: '当前阶段真正需要操作、浏览或判断的主要内容区。',
  },
  timeline: {
    key: 'timeline',
    label: '阶段时间线',
    layer: 'advanced',
    audience: 'pro',
    summary: '阶段变化回放和时间顺序。',
  },
  confirmation: {
    key: 'confirmation',
    label: '阶段确认',
    layer: 'advanced',
    audience: 'all',
    summary: '当前能不能继续、还差什么、哪里会卡住。',
  },
  dialogue: {
    key: 'dialogue',
    label: '对话协同',
    layer: 'advanced',
    audience: 'all',
    summary: '把当前判断接回对话框。',
  },
  decision: {
    key: 'decision',
    label: '当前判断',
    layer: 'advanced',
    audience: 'all',
    summary: '解释为什么当前会给出这样的判断。',
  },
  summary: {
    key: 'summary',
    label: '阶段摘要',
    layer: 'advanced',
    audience: 'all',
    summary: '当前阶段真正需要的补充信息。',
  },
  advanced: {
    key: 'advanced',
    label: '高级信息',
    layer: 'advanced',
    audience: 'pro',
    summary: '结构分布和更偏专业的补充信息。',
  },
};

const STAGE_SECTION_KEYS = {
  home: ['flow', 'judgment', 'stageRelay', 'statusStack', 'collaboration', 'assets', 'actions', 'timeline', 'confirmation', 'dialogue', 'decision', 'summary', 'content'],
  prepare: ['flow', 'judgment', 'stageRelay', 'statusStack', 'collaboration', 'assets', 'actions', 'transitions', 'timeline', 'confirmation', 'dialogue', 'decision', 'summary', 'content'],
  result: ['flow', 'judgment', 'stageRelay', 'statusStack', 'collaboration', 'assets', 'actions', 'transitions', 'timeline', 'confirmation', 'dialogue', 'decision', 'summary', 'content', 'advanced'],
  exception: ['flow', 'judgment', 'stageRelay', 'statusStack', 'collaboration', 'assets', 'actions', 'transitions', 'timeline', 'confirmation', 'dialogue', 'decision', 'summary', 'content'],
};

function cloneSectionSpec(spec = {}) {
  return { ...spec };
}

function getSectionSpec(key) {
  const spec = SECTION_REGISTRY[String(key || '').trim()];
  return spec ? cloneSectionSpec(spec) : null;
}

function getStageSectionSpecs(stage) {
  const keys = STAGE_SECTION_KEYS[String(stage || '').trim()] || STAGE_SECTION_KEYS.home;
  return keys.map((key) => getSectionSpec(key)).filter(Boolean);
}

function getStageSectionKeysByLayer(stage, layer) {
  return getStageSectionSpecs(stage)
    .filter((spec) => spec.layer === layer)
    .map((spec) => spec.key);
}

module.exports = {
  SECTION_REGISTRY,
  STAGE_SECTION_KEYS,
  getSectionSpec,
  getStageSectionSpecs,
  getStageSectionKeysByLayer,
};
