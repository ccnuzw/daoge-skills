export const ROUND_PURPOSE_LABELS = { exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' };

function asRecord(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function asArray(value) { return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item) : []; }
function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function specification(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const record = asRecord(value);
  const width = typeof record.width === 'number' || typeof record.width === 'string' ? String(record.width) : '';
  const height = typeof record.height === 'number' || typeof record.height === 'string' ? String(record.height) : '';
  return width && height ? width + ' × ' + height + (text(record.unit) ? ' ' + text(record.unit) : '') : '未设置';
}

export function planStateLabel(value) {
  return value === 'confirmed' ? '已确认' : value === 'awaiting_confirmation' ? '待确认' : '草稿';
}

export function planPresentation(plan) {
  const value = asRecord(plan);
  const output = asRecord(value.output);
  const prompt = text(value.prompt);
  const referenceAssetIds = asArray(value.referenceAssetIds);
  const operation = value.operation === 'edit' ? '编辑' : '生成';
  const aspectRatio = text(output.aspectRatio) || '未设置';
  const resolution = specification(output.resolution);
  const size = specification(output.size);
  const dimensions = specification(output.dimensions);
  return {
    operation,
    prompt: prompt || '此版本尚未填写可执行提示词。',
    itemCount: Number.isInteger(value.itemCount) ? value.itemCount : null,
    references: referenceAssetIds,
    aspectRatio,
    resolution,
    size,
    dimensions,
    output: [aspectRatio, resolution, size, dimensions].filter((item) => item !== '未设置').join(' · ') || '由 Provider 能力决定',
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
    ['画面比例', left.aspectRatio, right.aspectRatio],
    ['分辨率', left.resolution, right.resolution],
    ['输出尺寸', left.size, right.size],
    ['像素尺寸', left.dimensions, right.dimensions],
    ['参考素材', left.references.join('、') || '无', right.references.join('、') || '无']
  ];
  return fields.filter(([, before, after]) => before !== after).map(([label, before, after]) => ({ label, before, after }));
}
