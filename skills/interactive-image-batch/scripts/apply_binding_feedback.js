const path = require('path');
const { parseArgs, readJson, writeJson } = require('./script_utils');

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function parseOrdinal(text) {
  const normalized = String(text || '').trim();
  if (/最后一张|最后1张/.test(normalized)) return { kind: 'last', offset: 0 };
  const digit = normalized.match(/第\s*(\d+)\s*张/);
  if (digit) return { kind: 'index', index: Number(digit[1]) - 1 };
  const zhMap = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 七: 6, 八: 7, 九: 8, 十: 9 };
  const zh = normalized.match(/第([一二三四五六七八九十])张/);
  if (zh && zhMap[zh[1]] !== undefined) return { kind: 'index', index: zhMap[zh[1]] };
  return null;
}

function resolveAssetIndex(selector, totalCount) {
  if (!selector) return null;
  if (selector.kind === 'last') {
    const index = totalCount - 1 - selector.offset;
    return index >= 0 ? index : null;
  }
  if (selector.kind === 'index') {
    return selector.index >= 0 && selector.index < totalCount ? selector.index : null;
  }
  return null;
}

function collectSlotIds(plan) {
  const ids = new Set();
  ensureArray(plan.reference_assets).forEach((item) => item.slot_id && ids.add(item.slot_id));
  ensureArray(plan.mask_assets).forEach((item) => item.slot_id && ids.add(item.slot_id));
  ensureArray(plan.prompt_only_slots).forEach((item) => item && ids.add(item));
  return Array.from(ids);
}

function parseFeedback(feedback, slotIds, totalCount) {
  const sentences = String(feedback || '')
    .split(/[。；;，,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const operations = [];
  let currentAssetIndex = null;

  sentences.forEach((sentence) => {
    const selector = parseOrdinal(sentence);
    const assetIndex = resolveAssetIndex(selector, totalCount);
    if (assetIndex !== null) currentAssetIndex = assetIndex;
    const slotId = slotIds.find((id) => sentence.toLowerCase().includes(String(id).toLowerCase())) || null;
    const moveMatch = /改给|改到|换到|给/.test(sentence);
    const removeMask = /不做.*遮罩|不要.*遮罩|取消.*遮罩/.test(sentence);
    const makeMask = /是.*遮罩图|做.*遮罩图|改成.*遮罩图/.test(sentence);
    const promptOnly = /改成.*prompt-only|只走提示词|不要参考图/.test(sentence);
    const effectiveAssetIndex = assetIndex !== null ? assetIndex : currentAssetIndex;

    if (effectiveAssetIndex === null && !slotId) return;

    if (removeMask && effectiveAssetIndex !== null) {
      operations.push({ type: 'set-reference', asset_index: effectiveAssetIndex, reason: sentence, slot_id: slotId });
      return;
    }
    if (makeMask && effectiveAssetIndex !== null) {
      operations.push({ type: 'set-mask', asset_index: effectiveAssetIndex, reason: sentence, slot_id: slotId });
      return;
    }
    if (promptOnly && slotId) {
      operations.push({ type: 'set-prompt-only', slot_id: slotId, reason: sentence });
      return;
    }
    if (moveMatch && effectiveAssetIndex !== null && slotId) {
      operations.push({ type: 'move-asset', asset_index: effectiveAssetIndex, slot_id: slotId, reason: sentence });
    }
  });

  return operations;
}

function rebuildAssignments(plan) {
  const assignments = [];
  const grouped = new Map();

  function ensureAssignment(slotId) {
    if (!slotId) return null;
    if (!grouped.has(slotId)) {
      grouped.set(slotId, {
        slot_id: slotId,
        asset_ids: [],
        mask_asset_ids: [],
        reference_mode: 'prompt-only',
        priority: null,
        notes: null,
      });
    }
    return grouped.get(slotId);
  }

  ensureArray(plan.reference_assets).forEach((item, index) => {
    const assignment = ensureAssignment(item.slot_id);
    if (!assignment) return;
    assignment.asset_ids.push(item.asset_id || `ref_${String(index + 1).padStart(2, '0')}`);
    assignment.reference_mode = assignment.mask_asset_ids.length ? 'masked-edit' : 'reference-assisted';
  });

  ensureArray(plan.mask_assets).forEach((item, index) => {
    const assignment = ensureAssignment(item.slot_id);
    if (!assignment) return;
    assignment.mask_asset_ids.push(item.asset_id || `mask_${String(index + 1).padStart(2, '0')}`);
    assignment.reference_mode = 'masked-edit';
  });

  grouped.forEach((value) => assignments.push(value));
  return assignments;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['plan-file']) throw new Error('Missing required flag: --plan-file');
  if (!args['feedback-text']) throw new Error('Missing required flag: --feedback-text');

  const planFile = path.resolve(args['plan-file']);
  const plan = readJson(planFile);
  const slotIds = collectSlotIds(plan);
  const allAssets = [
    ...ensureArray(plan.reference_assets).map((item) => ({ ...item, intended_type: 'reference' })),
    ...ensureArray(plan.mask_assets).map((item) => ({ ...item, intended_type: 'mask' })),
  ];
  const operations = parseFeedback(args['feedback-text'], slotIds, allAssets.length);

  operations.forEach((op) => {
    if (op.type === 'set-prompt-only') {
      plan.reference_assets = ensureArray(plan.reference_assets).filter((item) => item.slot_id !== op.slot_id);
      plan.mask_assets = ensureArray(plan.mask_assets).filter((item) => item.slot_id !== op.slot_id);
      if (!ensureArray(plan.prompt_only_slots).includes(op.slot_id)) {
        plan.prompt_only_slots = [...ensureArray(plan.prompt_only_slots), op.slot_id];
      }
      return;
    }

    const target = allAssets[op.asset_index];
    if (!target) return;
    if (op.slot_id) target.slot_id = op.slot_id;
    if (op.type === 'set-mask') target.intended_type = 'mask';
    if (op.type === 'set-reference') target.intended_type = 'reference';
    target.notes = op.reason;
  });

  plan.reference_assets = allAssets
    .filter((item) => item.intended_type !== 'mask')
    .map(({ intended_type, ...rest }) => rest);
  plan.mask_assets = allAssets
    .filter((item) => item.intended_type === 'mask')
    .map(({ intended_type, ...rest }) => rest);
  plan.plan_assignments = allAssets.map((item, index) => ({
    asset_index: index,
    path: item.path,
    slot_id: item.slot_id || null,
    intended_type: item.intended_type,
    confidence: Number(item.confidence || 0),
    reason: item.notes || null,
  }));
  plan.feedback_history = [
    ...ensureArray(plan.feedback_history),
    {
      feedback_text: args['feedback-text'],
      operations,
    },
  ];
  plan.summary = `已根据反馈更新绑定计划: ${args['feedback-text']}`;
  plan.slot_assignments = rebuildAssignments(plan);

  const outputPath = path.resolve(args['output-file'] || planFile);
  writeJson(outputPath, plan);
  console.log(JSON.stringify({
    outputPath,
    operationCount: operations.length,
    referenceAssetCount: ensureArray(plan.reference_assets).length,
    maskAssetCount: ensureArray(plan.mask_assets).length,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
