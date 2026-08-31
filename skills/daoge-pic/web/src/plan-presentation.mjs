export const ROUND_PURPOSE_LABELS = { exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' };

function asRecord(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function asArray(value) { return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item) : []; }
function text(value) { return typeof value === 'string' ? value.trim() : ''; }

export function planStateLabel(value) {
  return value === 'confirmed' ? '已确认' : value === 'awaiting_confirmation' ? '待确认' : '草稿';
}

export function planPresentation(plan) {
  const value = asRecord(plan);
  const output = asRecord(value.output);
  const prompt = text(value.prompt);
  const referenceAssetIds = asArray(value.referenceAssetIds);
  const operation = value.operation === 'edit' ? '编辑' : '生成';
  const aspectRatio = text(output.aspectRatio);
  const size = text(output.size) || text(output.dimensions);
  return {
    operation,
    prompt: prompt || '此版本尚未填写可执行提示词。',
    itemCount: Number.isInteger(value.itemCount) ? value.itemCount : null,
    references: referenceAssetIds,
    output: aspectRatio || size || '由 Provider 能力决定',
    constraintCount: prompt ? prompt.split('.').map((item) => item.trim()).filter(Boolean).length : 0
  };
}

export function planDiff(leftPlan, rightPlan) {
  const left = planPresentation(leftPlan);
  const right = planPresentation(rightPlan);
  const fields = [
    ['提示词', left.prompt, right.prompt],
    ['操作', left.operation, right.operation],
    ['数量', left.itemCount === null ? '未设置' : String(left.itemCount), right.itemCount === null ? '未设置' : String(right.itemCount)],
    ['输出规格', left.output, right.output],
    ['参考素材', left.references.join('、') || '无', right.references.join('、') || '无']
  ];
  return fields.filter(([, before, after]) => before !== after).map(([label, before, after]) => ({ label, before, after }));
}
