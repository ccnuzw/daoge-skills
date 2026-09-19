import { CREATIVE_DERIVED_ACTIONS, CREATIVE_DERIVED_ACTION_BY_ID } from '../creative-actions.mjs';
import { purposeLabel } from '../purpose-labels.mjs';
import { REFERENCE_USAGE_LABELS } from '../reference-usage-model.mjs';

/** 创建/衍生/驳回的**文案与选项模型**（界面批 E 从 main.jsx 搬出，行为零变化）。 */

export const CREATION_ASPECT_OPTIONS = ['', '1:1', '4:5', '3:4', '16:9', '9:16', '3:2'];

export const CREATION_COUNT_OPTIONS = ['', '2', '4', '6', '8', '12'];

export const DERIVED_ACTION_BY_ID = CREATIVE_DERIVED_ACTION_BY_ID;

export const DERIVED_KEEP_CONSTRAINTS = ['主体', '产品', 'Logo', '人物身份', '构图大方向', '色彩氛围'];

export const DERIVED_REFERENCE_PRESETS = [
  { id: 'lead-style-composition', label: '主图 + 风格 + 构图', description: '第 1 张定主体，第 2 张定风格，第 3 张定构图，剩余补色彩氛围。', pattern: ['subject', 'style', 'composition'], rest: 'color' },
  { id: 'multi-subject', label: '多主体 / 多元素融合', description: '所有图片都作为主体或元素参考，适合人物、产品或角色组合。', all: 'subject' },
  { id: 'subject-negative', label: '主体 + 反例对照', description: '第 1 张作为保留方向，其余作为不要继续的反例。', pattern: ['subject'], rest: 'negative' },
  { id: 'edit-mask-style', label: '局部编辑三件套', description: '第 1 张主体，第 2 张遮罩，其余参考风格；只在局部修改时显示。', purposes: ['edit'], pattern: ['subject', 'mask'], rest: 'style' },
  { id: 'fill-composition', label: '补图构图板', description: '第 1 张确定构图和边界，其余补风格与氛围；适合扩图。', purposes: ['fill'], pattern: ['composition'], rest: 'style' }
];

export const DERIVED_REFERENCE_USAGE_NOTES = {
  subject: '主体 / 产品 / 人物身份参考',
  style: '风格、质感和画法参考',
  composition: '构图、视角和空间关系参考',
  color: '色彩与明暗氛围参考',
  brand: '品牌元素、Logo 或固定规范参考',
  mask: '局部编辑遮罩；白色区域通常表示修改范围',
  negative: '反例：下一轮需要避免这种方向'
};

export const DERIVED_REFINEMENT_GOALS = ['清晰度', '质感', '光影', '构图', '细节', '商业感'];

export const DERIVED_ROUND_ACTIONS = CREATIVE_DERIVED_ACTIONS.map((action) => ({ ...action, label: action.label || action.title }));

export const DERIVED_VARIATION_AXES = ['构图', '背景', '色彩', '风格', '姿势', '表情', '光影', '商业感'];

export const GENERIC_TASK_GOAL_FALLBACKS = [
  { id: 'exploration', label: '从零探索方向', description: '还没确定视觉方向，一次准备多组候选。', defaultName: '首轮视觉探索', defaultCount: '6', defaultAspectRatio: '4:5', roundPurpose: 'exploration', recommendedInputs: ['目标受众 / 使用渠道', '风格方向', '参考素材'], quickBriefs: ['说明创作目标、目标受众、参考素材和交付用途。', '先探索几个差异明显的视觉方向，再从中收敛。'] },
  { id: 'variation', label: '基于已有图做变化', description: '保留大方向，变化构图、色彩、背景或姿态。', defaultName: '结果变体探索', defaultCount: '4', defaultAspectRatio: '', roundPurpose: 'variation', defaultVariationAxes: ['构图', '背景'], defaultKeepConstraints: ['主体'], recommendedInputs: ['父资产 / 参考图', '希望变化的维度', '必须保持不变'], quickBriefs: ['保留主体方向，尝试不同背景、构图或色彩。', '主体不变，分别变化构图、背景和光影。'] },
  { id: 'refinement', label: '把选中图做精致', description: '提升质感、光影、清晰度和商业完成度。', defaultName: '结果精修', defaultCount: '4', defaultAspectRatio: '', roundPurpose: 'refinement', defaultRefinementGoals: ['质感', '光影', '细节'], defaultKeepConstraints: ['主体', '构图大方向'], recommendedInputs: ['父资产 / 参考图', '精修目标', '不允许改变项'], quickBriefs: ['提高材质真实感和边缘清晰度，不改变主体身份。', '保留构图和主体，增强质感、细节和完成度。'] },
  { id: 'edit', label: '局部修改 / 替换', description: '只修改画面中特定区域，其他内容尽量保持。', defaultName: '局部编辑', defaultCount: '2', defaultAspectRatio: '', roundPurpose: 'edit', defaultKeepConstraints: ['主体'], recommendedInputs: ['父资产', '修改区域 / 遮罩', '保持区域'], quickBriefs: ['只替换指定背景区域，主体保持不变。', '修改局部瑕疵区域，其他构图和光影不变。'] },
  { id: 'custom', label: '自定义任务', description: '目标特殊时选择，并在创作意图里写清输入、限制和交付用途。', defaultName: '自定义创作任务', defaultCount: '', defaultAspectRatio: '', roundPurpose: 'exploration', recommendedInputs: ['输入素材', '限制条件', '交付用途'], quickBriefs: ['已有明确需求，请按当前素材、限制条件和交付目标建立任务。'] }
];

export const PROJECT_TEMPLATE_UNAVAILABLE = Object.freeze({
  id: '',
  version: 0,
  name: '模板未加载',
  label: '模板未加载',
  description: '项目模板由 Studio 提供；未加载时可先创建不绑定模板的自定义项目。',
  defaultName: '自定义创作项目',
  descriptionPrompt: '说明客户、产品、使用渠道或交付目标。',
  recommendedTasks: [],
  aspectRatios: [],
  referenceHint: '模板加载后会显示官方素材建议；这里只是把信息记进项目。',
  exampleDescriptions: [],
  taskDefaults: []
});

export const REJECT_REASON_OPTIONS = [
  { id: 'subject-wrong', label: '主体不准' },
  { id: 'style-wrong', label: '风格不对' },
  { id: 'composition-bad', label: '构图不行' },
  { id: 'quality-cheap', label: '质感廉价' },
  { id: 'text-logo-wrong', label: '文字 / Logo 错' },
  { id: 'brand-mismatch', label: '不符合品牌' },
  { id: 'other', label: '其他' }
];

export const ROUND_PURPOSE_LABELS = { exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' };

export const ROUND_PURPOSE_OPTIONS = [
  { id: 'exploration', label: purposeLabel('exploration'), description: '适合还没确定视觉方向时，一次生成多种候选。', defaultCount: '6', defaultAspectRatio: '4:5', recommendedInputs: ['创作主题', '风格方向', '参考素材'], quickBriefs: ['探索几个适合当前目标的视觉方向。', '从不同风格、构图和受众角度各出候选。'] },
  { id: 'refinement', label: purposeLabel('refinement'), description: '适合选中满意图后，提高质感或细节。', defaultCount: '4', defaultAspectRatio: '', defaultRefinementGoals: ['质感', '光影', '细节'], defaultKeepConstraints: ['主体', '构图大方向'], recommendedInputs: ['父批次 / 父资产', '精修目标', '不允许改变项'], quickBriefs: ['提升质感和边缘清晰度，不改变主体身份。', '保留构图，增强完成度和画面细节。'] },
  { id: 'variation', label: purposeLabel('variation'), description: '适合保留主体方向，但想多看几种变化。', defaultCount: '4', defaultAspectRatio: '', defaultVariationAxes: ['构图', '背景'], defaultKeepConstraints: ['主体'], recommendedInputs: ['父批次 / 父资产', '变化维度', '保持不变项'], quickBriefs: ['保留主体方向，尝试几种背景和构图。', '主体不变，分别变化构图、背景和色彩。'] },
  { id: 'edit', label: purposeLabel('edit'), description: '适合只替换画面中的某个区域。', defaultCount: '2', defaultAspectRatio: '', defaultKeepConstraints: ['主体'], recommendedInputs: ['父资产', '遮罩或修改区域', '保持区域'], quickBriefs: ['只替换指定局部区域，其他内容不变。', '修改局部文字或瑕疵区域，其他内容不变。'] },
  { id: 'fill', label: purposeLabel('fill'), description: '适合扩展画幅或补充缺失区域。', defaultCount: '2', defaultAspectRatio: '16:9', defaultKeepConstraints: ['主体', '构图大方向'], recommendedInputs: ['原图', '扩展方向', '目标画幅'], quickBriefs: ['扩展为目标画幅，补齐环境和留白。', '保持主体位置，向画面两侧自然延展背景。'] }
];

export function assetMatchesQuery(asset, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [asset.id, asset.kind, asset.mediaType, asset.display?.label, asset.display?.taskName].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalized));
}

export function buildDerivedPresetMaterials(sourceAssets, preset, fallbackUsage) {
  return new Map(sourceAssets.map((asset, index) => {
    const usage = preset?.all || preset?.pattern?.[index] || preset?.rest || fallbackUsage || 'subject';
    return [asset.id, derivedPresetMaterial(asset, usage, index, preset)];
  }));
}

export function compactRecord(record) {
  const value = {};
  for (const [key, item] of Object.entries(record)) if (item !== undefined && item !== null && item !== '') value[key] = item;
  return value;
}

export function creationDefaultSummary(option) { return [option?.defaultCount ? option.defaultCount + ' 张' : '数量由 Agent 决定', option?.defaultAspectRatio || '画幅由 Agent 决定'].join(' · '); }

export function derivedPresetAllowed(preset, purpose) {
  return !preset.purposes || preset.purposes.includes(purpose);
}

export function libraryDefinitionSummary(item, fallback) {
  return item?.definition?.summary || item?.definition?.description || fallback;
}

export function listItems(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }

export function projectTemplateForProject(project, templates = EMPTY) {
  const templateId = typeof project?.templateId === 'string' ? project.templateId : '';
  return templateId ? templates.find((template) => template.id === templateId) || null : null;
}

export function projectTemplateName(template) { return template?.name || template?.label || '自定义项目'; }

export function setIfEmptyOrDefault(setter, previousDefault, nextDefault) {
  setter((current) => !String(current || '').trim() || current === previousDefault ? nextDefault || '' : current);
}

export function taskGoalsForProjectTemplate(template) {
  const defaults = listItems(template?.taskDefaults);
  if (!defaults.length) return GENERIC_TASK_GOAL_FALLBACKS.map((goal) => mergeTaskGoalDefault(goal, null));
  const defaultByGoal = new Map(defaults.map((item) => [item.goalId, item]));
  const recommended = defaults.map((item) => {
    const base = GENERIC_TASK_GOAL_FALLBACKS.find((goal) => goal.id === item.goalId);
    return base ? mergeTaskGoalDefault(base, item) : null;
  }).filter(Boolean);
  const rest = GENERIC_TASK_GOAL_FALLBACKS.filter((goal) => !defaultByGoal.has(goal.id)).map((goal) => mergeTaskGoalDefault(goal, null));
  return [...recommended, ...rest];
}

export function toggleChoice(values, value) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function uniqueList(items) {
  return Array.from(new Set(listItems(items).map((item) => String(item).trim()).filter(Boolean)));
}

export function usageCountsFromMaterials(materials) {
  const counts = {};
  for (const item of materials) counts[item.usage] = (counts[item.usage] || 0) + 1;
  return counts;
}

export const REJECT_REASON_LABELS = Object.fromEntries(REJECT_REASON_OPTIONS.map((option) => [option.id, option.label]));

export function defaultDerivedPresetForPurpose(purpose) {
  return DERIVED_REFERENCE_PRESETS.find((preset) => Array.isArray(preset.purposes) && preset.purposes.includes(purpose)) || DERIVED_REFERENCE_PRESETS.find((preset) => derivedPresetAllowed(preset, purpose)) || null;
}

export function materialNeedsForTemplate(template) {
  const defaults = listItems(template?.taskDefaults);
  return uniqueList(defaults[0]?.materialNeeds || template?.materialNeeds || []);
}

export function projectTemplateDefaultName(template) { return template?.defaultName || projectTemplateName(template) + '项目'; }

const EMPTY = [];

export function derivedPresetMaterial(asset, usage, index, preset) {
  const label = REFERENCE_USAGE_LABELS[usage] || usage;
  const usageNote = DERIVED_REFERENCE_USAGE_NOTES[usage] || label;
  const primaryPrefix = index === 0 ? '主参考图；' : '';
  return { assetId: asset.id, usage, note: primaryPrefix + usageNote + '。' + (preset?.label ? '编排：' + preset.label + '。' : '') };
}

export function mergeTaskGoalDefault(goal, taskDefault) {
  if (!taskDefault) return { ...goal, templateRecommended: false, materialNeeds: listItems(goal.materialNeeds) };
  return {
    ...goal,
    ...taskDefault,
    id: goal.id,
    goalId: taskDefault.goalId || goal.id,
    label: taskDefault.label || goal.label,
    description: taskDefault.description || goal.description,
    defaultName: taskDefault.defaultName || goal.defaultName,
    defaultCount: taskDefault.defaultCount ?? goal.defaultCount,
    defaultAspectRatio: taskDefault.defaultAspectRatio ?? goal.defaultAspectRatio,
    roundPurpose: taskDefault.roundPurpose || goal.roundPurpose,
    recommendedInputs: uniqueList(taskDefault.recommendedInputs || goal.recommendedInputs),
    quickBriefs: uniqueList(taskDefault.quickBriefs || goal.quickBriefs),
    materialNeeds: uniqueList(taskDefault.materialNeeds || goal.materialNeeds),
    defaultVariationAxes: listItems(taskDefault.defaultVariationAxes || goal.defaultVariationAxes),
    defaultKeepConstraints: listItems(taskDefault.defaultKeepConstraints || goal.defaultKeepConstraints),
    defaultRefinementGoals: listItems(taskDefault.defaultRefinementGoals || goal.defaultRefinementGoals),
    templateRecommended: true
  };
}
