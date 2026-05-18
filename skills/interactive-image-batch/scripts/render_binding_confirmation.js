const path = require('path');
const { parseArgs, readJson } = require('./script_utils');

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function line(text = '') {
  return `${text}\n`;
}

function buildNaturalLanguageSummary(analysis, plan, bindings) {
  const lines = [];
  const draftAssignments = ensureArray(analysis?.naturalLanguageBindings?.explicitAssignments);
  const slotAssignments = ensureArray(bindings?.slot_assignments);
  const planAssignments = ensureArray(plan?.plan_assignments);

  if (draftAssignments.length) {
    lines.push('我先按你的中文说明理解成这样：');
    draftAssignments.forEach((item) => {
      lines.push(`- 第 ${item.asset_index + 1} 张 -> ${item.slot_id} (${item.type === 'mask' ? '遮罩图' : '参考图'})`);
    });
  } else if (planAssignments.length) {
    lines.push('我理解到的绑定计划：');
    planAssignments.forEach((item) => {
      lines.push(`- 第 ${item.asset_index + 1} 张 -> ${item.slot_id || '未明确'} (${String(item.intended_type || '').includes('mask') ? '遮罩图' : '参考图'})`);
    });
  } else if (slotAssignments.length) {
    lines.push('我当前准备这样绑定素材：');
    slotAssignments.forEach((item) => {
      if (item.mask_asset_ids?.length) {
        lines.push(`- ${item.slot_id}: ${item.asset_ids?.length || 0} 张参考图 + ${item.mask_asset_ids.length} 张遮罩图`);
      } else {
        lines.push(`- ${item.slot_id}: ${item.asset_ids?.length || 0} 张参考图`);
      }
    });
  } else {
    lines.push('当前没有解析出明确的素材绑定计划。');
  }

  if (ensureArray(plan?.prompt_only_slots).length) {
    lines.push(`- 保持 prompt-only 的槽位: ${plan.prompt_only_slots.join(', ')}`);
  }

  return lines;
}

function buildDecisionLines(analysis, plan, bindings) {
  const lines = [];
  const slotAssignments = ensureArray(bindings?.slot_assignments);
  lines.push('确认摘要：');
  if (!slotAssignments.length) {
    lines.push('- 当前没有可执行的 slot 绑定。');
    return lines;
  }

  slotAssignments.forEach((item) => {
    const mode = item.reference_mode || (item.mask_asset_ids?.length ? 'masked-edit' : 'reference-assisted');
    const refCount = ensureArray(item.asset_ids).length;
    const maskCount = ensureArray(item.mask_asset_ids).length;
    lines.push(`- ${item.slot_id}: ${mode}, 参考图 ${refCount} 张, 遮罩图 ${maskCount} 张`);
  });

  const unresolved = ensureArray(plan?.unresolved_questions);
  if (unresolved.length) {
    lines.push('');
    lines.push('仍有待确认点：');
    unresolved.forEach((question) => lines.push(`- ${question}`));
  }

  const visionRecommendations = ensureArray(analysis?.visionAnalysis?.recommendations);
  if (visionRecommendations.length) {
    lines.push('');
    lines.push('视觉分析参考：');
    visionRecommendations.forEach((item) => {
      lines.push(`- ${path.basename(item.asset_path)} -> ${item.recommended_slot_id || '未推荐'} / ${item.recommended_type} / 置信度 ${Number(item.confidence || 0).toFixed(2)}`);
    });
  }

  return lines;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['analysis-file']) throw new Error('Missing required flag: --analysis-file');
  if (!args['bindings-file']) throw new Error('Missing required flag: --bindings-file');

  const analysis = readJson(path.resolve(args['analysis-file']));
  const bindings = readJson(path.resolve(args['bindings-file']));
  const plan = args['plan-file'] ? readJson(path.resolve(args['plan-file'])) : null;
  const outputPath = path.resolve(args['output-file'] || path.join(path.dirname(path.resolve(args['bindings-file'])), 'binding_confirmation.md'));

  const sections = [];
  sections.push('# 素材绑定确认摘要');
  sections.push('');
  buildNaturalLanguageSummary(analysis, plan, bindings).forEach((item) => sections.push(item));
  sections.push('');
  buildDecisionLines(analysis, plan, bindings).forEach((item) => sections.push(item));
  sections.push('');
  sections.push('如果这版理解无误，就继续执行。');
  sections.push('如果不对，优先修改中文绑定说明、binding_intent_draft 或 binding_plan。');

  require('fs').writeFileSync(outputPath, sections.map((item) => line(item)).join(''));
  console.log(JSON.stringify({
    outputPath,
    slotAssignmentCount: ensureArray(bindings.slot_assignments).length,
    unresolvedQuestionCount: ensureArray(plan?.unresolved_questions).length,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
