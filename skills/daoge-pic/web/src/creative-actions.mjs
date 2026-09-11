export const CREATIVE_ACTION_ENTRIES = Object.freeze([
  {
    id: 'more-similar',
    kind: 'derive',
    title: '生成更多类似图',
    label: '生成更多类似图',
    shortLabel: '更多类似',
    purpose: 'variation',
    usage: 'subject',
    description: '方向已经可用，继续探索构图、背景、色彩或姿态变化。',
    defaultVariationAxes: ['构图', '背景', '光影'],
    defaultKeepConstraints: ['主体', '构图大方向']
  },
  {
    id: 'refine-selected-image',
    kind: 'derive',
    title: '让这张图更精致',
    label: '让这张图更精致',
    shortLabel: '精致化',
    purpose: 'refinement',
    usage: 'subject',
    description: '方向满意，提升清晰度、质感、光影、细节和商业完成度。',
    defaultRefinementGoals: ['清晰度', '质感', '光影', '细节'],
    defaultKeepConstraints: ['主体', '产品', 'Logo', '构图大方向']
  },
  {
    id: 'change-background',
    kind: 'derive',
    title: '换背景 / 局部修改',
    label: '换背景 / 局部修改',
    shortLabel: '换背景',
    purpose: 'edit',
    usage: 'subject',
    description: '主体可用，只调整背景、局部区域或不满意的画面元素。',
    defaultKeepConstraints: ['主体', '产品', 'Logo'],
    defaultVariationAxes: ['背景', '光影']
  },
  {
    id: 'expand-canvas',
    kind: 'derive',
    title: '扩图 / 改画幅',
    label: '扩图 / 改画幅',
    shortLabel: '扩图',
    purpose: 'fill',
    usage: 'composition',
    description: '适配横版、竖版或平台比例，补齐画面边缘和留白。',
    defaultKeepConstraints: ['主体', '构图大方向']
  },
  {
    id: 'add-as-reference',
    kind: 'reference',
    title: '作为参考加入当前草稿',
    label: '作为参考加入当前草稿',
    shortLabel: '加入参考',
    usage: 'subject',
    description: '把选中图片标注为主体、风格、构图或反例参考，不创建新轮次。'
  },
  {
    id: 'feedback-to-next-round',
    kind: 'feedback',
    title: '从不采用原因创建下一轮',
    label: '从不采用原因创建下一轮',
    shortLabel: '问题转下一轮',
    purpose: 'refinement',
    usage: 'negative',
    description: '把淘汰原因整理成反例、修正目标和保持约束，创建新的草稿轮次。',
    defaultRefinementGoals: ['修正不采用原因', '提升可用度'],
    defaultKeepConstraints: ['主体', '品牌约束', '构图大方向']
  }
]);

export const CREATIVE_DERIVED_ACTIONS = Object.freeze(CREATIVE_ACTION_ENTRIES.filter((action) => action.kind === 'derive'));
export const CREATIVE_ACTION_BY_ID = Object.freeze(Object.fromEntries(CREATIVE_ACTION_ENTRIES.map((action) => [action.id, action])));
export const CREATIVE_DERIVED_ACTION_BY_ID = Object.freeze(Object.fromEntries(CREATIVE_DERIVED_ACTIONS.map((action) => [action.id, action])));

export function creativeActionById(actionId) {
  return CREATIVE_ACTION_BY_ID[actionId] || null;
}

export function creativeDerivedActionForPurpose(purpose) {
  return CREATIVE_DERIVED_ACTIONS.find((action) => action.purpose === purpose) || CREATIVE_DERIVED_ACTIONS[0];
}

export function creativeActionTitleForRound(round) {
  const plan = round?.plan || round?.planSnapshot || {};
  const derivation = plan.derivation || {};
  const actionId = derivation.action || plan.actionId || plan.action;
  const registered = creativeActionById(actionId);
  return derivation.actionLabel || plan.actionLabel || registered?.title || '';
}
