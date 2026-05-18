const path = require('path');
const { parseArgs, readJson } = require('./script_utils');
const { brandHeader, quickReplyBlock, userFocusBlock } = require('./daoge_brand_zh');

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function buildHighlights(bindings, plan) {
  const assignments = ensureArray(bindings?.slot_assignments);
  const promptOnly = ensureArray(plan?.prompt_only_slots);
  const localEdit = assignments.filter((item) => ensureArray(item.mask_asset_ids).length);
  return [
    `已绑定槽位 ${assignments.length} 个`,
    localEdit.length ? `其中 ${localEdit.length} 个是局部编辑槽位` : '当前没有局部编辑槽位',
    promptOnly.length ? `保持 prompt-only: ${promptOnly.join(', ')}` : '当前没有显式 prompt-only 槽位',
  ];
}

function buildSummaryLines(bindings) {
  const assignments = ensureArray(bindings?.slot_assignments);
  if (!assignments.length) return ['- 当前还没有可执行的素材绑定。'];
  return assignments.map((item) => {
    const refs = ensureArray(item.asset_ids).length;
    const masks = ensureArray(item.mask_asset_ids).length;
    const mode = item.reference_mode || (masks ? 'masked-edit' : 'reference-assisted');
    return `- ${item.slot_id}: ${mode} / 参考图 ${refs} 张 / 遮罩图 ${masks} 张`;
  });
}

function buildQuickReplies(plan, bindings) {
  const assignments = ensureArray(bindings?.slot_assignments);
  if (!assignments.length) {
    return ['请继续补充绑定说明', '按上传顺序重新绑定', '改成全部 prompt-only'];
  }
  const firstSlot = assignments[0]?.slot_id || 'shot_1';
  const secondSlot = assignments[1]?.slot_id || firstSlot;
  return [
    '确认，继续 prepare',
    `第2张改给 ${firstSlot}`,
    `最后一张不做遮罩图，改给 ${secondSlot}`,
  ];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['bindings-file']) throw new Error('Missing required flag: --bindings-file');

  const bindings = readJson(path.resolve(args['bindings-file']));
  const plan = args['plan-file'] ? readJson(path.resolve(args['plan-file'])) : null;
  const outputPath = path.resolve(args['output-file'] || path.join(path.dirname(path.resolve(args['bindings-file'])), 'binding_conversation_card.md'));

  const lines = [
    ...brandHeader('DAOGE 绑定会话卡', 'preview'),
    '',
    '## 当前绑定理解',
    '',
    ...buildSummaryLines(bindings),
    ...userFocusBlock(buildHighlights(bindings, plan)),
    ...quickReplyBlock(buildQuickReplies(plan, bindings)),
  ];

  require('fs').writeFileSync(outputPath, `${lines.join('\n')}\n`);
  console.log(JSON.stringify({
    outputPath,
    slotAssignmentCount: ensureArray(bindings.slot_assignments).length,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
