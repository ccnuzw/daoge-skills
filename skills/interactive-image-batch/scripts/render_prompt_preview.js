const fs = require('fs');
const path = require('path');
const { parseArgs, chunkArray } = require('./script_utils');
const { labelField } = require('./display_labels_zh');
const { brandHeader, quickReplyBlock, userFocusBlock } = require('./daoge_brand_zh');
const { topLabel, resolveProfile, buildDisplayDistributions, normalizeValue } = require('./template_display_profile');

function parseNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = normalizeValue(item[key]);
    const label = value || '未指定';
    counts[label] = (counts[label] || 0) + 1;
  }
  return counts;
}

function topCounts(counts, limit = 12) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function getPromptText(item) {
  return item.generation_prompt || item.prompt || '';
}

function shorten(text, max = 240) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function bullet(label, value) {
  return value ? `- ${label}: ${value}` : null;
}

function displayTitle(item, fallbackIndex) {
  const shotLabel = String(item.shot_label || '').trim();
  if (shotLabel) return shotLabel;
  const scene = String(item.scene || '').trim();
  if (scene) return scene;
  return item.title || item.slug || `prompt-${fallbackIndex}`;
}

function formatEditMode(item) {
  const mode = String(item.reference_mode || '').trim() || 'prompt-only';
  const source = String(item.edit_source || '').trim();
  if (source === 'previous-output') {
    return mode === 'masked-edit' ? '局部编辑：复用上一轮结果 + 遮罩' : '局部编辑：复用上一轮结果';
  }
  if (mode === 'masked-edit') return '局部编辑：参考图 + 遮罩';
  if (mode === 'reference-assisted') return '参考图辅助';
  return '纯提示词生成';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['prompts-file']) throw new Error('Missing required flag: --prompts-file');
  const promptsFile = path.resolve(args['prompts-file']);
  const prompts = JSON.parse(fs.readFileSync(promptsFile, 'utf8'));
  if (!Array.isArray(prompts)) throw new Error(`Prompt file must be a JSON array: ${promptsFile}`);

  const batchSize = Math.max(1, Math.floor(parseNumber(args['batch-size'], prompts.length)));
  const previewCount = Math.max(1, Math.floor(parseNumber(args['preview-count'], Math.min(12, prompts.length))));
  const outputPath = path.resolve(args['output-file'] || path.join(path.dirname(promptsFile), 'prompt_preview.md'));
  const planPath = path.resolve(args['plan-file'] || path.join(path.dirname(promptsFile), 'batch_plan.json'));
  const summaryPath = path.resolve(args['summary-file'] || path.join(path.dirname(promptsFile), 'daoge_run_summary.md'));

  const batches = chunkArray(prompts, batchSize).map((items, index) => ({
    batchNumber: index + 1,
    promptCount: items.length,
    firstIndex: items[0]?.index ?? index * batchSize + 1,
    lastIndex: items[items.length - 1]?.index ?? index * batchSize + items.length,
  }));
  fs.writeFileSync(planPath, JSON.stringify(batches, null, 2));

  const distributions = {
    style_family: topCounts(countBy(prompts, 'style_family')),
    purity_grade: topCounts(countBy(prompts, 'purity_grade')),
    scene: topCounts(countBy(prompts, 'scene')),
    wardrobe: topCounts(countBy(prompts, 'wardrobe')),
    composition: topCounts(countBy(prompts, 'composition')),
    slot_role: topCounts(countBy(prompts, 'slot_role')),
  };
  const displayProfile = resolveProfile(prompts);
  const displayDistributions = buildDisplayDistributions(prompts, displayProfile)
    .map((item) => ({ ...item, counts: item.counts.slice(0, 12) }));
  const storyboardMode = prompts.some((item) => item.slot_id || item.shot_id || item.layout_region_id);
  const boardIds = Array.from(new Set(prompts.map((item) => item.board_id).filter(Boolean)));
  const referenceModes = topCounts(countBy(prompts, 'reference_mode'));
  const editSources = topCounts(countBy(prompts, 'edit_source'));

  const previewItems = prompts.slice(0, previewCount);
  const lines = [
    ...brandHeader('DAOGE 提示词预览', 'preview'),
    '',
    '我是 DAOGE。预览已经生成，先看这次任务的摘要。',
    ...userFocusBlock([
      `数量：共 ${prompts.length} 条提示词，预览 ${previewItems.length} 条`,
      `批次：按每批 ${batchSize} 条拆分，共 ${batches.length} 批`,
      `方向：${displayProfile.summaryFields[0]?.label || '主方向'} ${topLabel(displayDistributions[0]?.counts || [])}，${displayProfile.summaryFields[1]?.label || '次方向'} ${topLabel(displayDistributions[1]?.counts || [])}`,
    ]),
    '',
    `- 提示词来源: ${promptsFile}`,
    `- 提示词总数: ${prompts.length}`,
    `- 每批数量: ${batchSize}`,
    `- 批次数量: ${batches.length}`,
    `- 预览数量: ${previewItems.length}`,
    ...(storyboardMode ? [
      `- 分镜板模式: 是`,
      `- 分镜板数量: ${boardIds.length || 1}`,
      `- 主要槽位角色: ${topLabel(distributions.slot_role)}`,
      `- 参考模式: ${topLabel(referenceModes)}`,
      ...(editSources.length ? [`- 编辑底图来源: ${topLabel(editSources, '未使用')}`] : []),
    ] : []),
    '',
    '## 分布摘要',
    '',
    ...displayDistributions.flatMap((item) => [
      `- ${item.label}:`,
      ...item.counts.map((entry) => `  - ${entry.name}: ${entry.count}`),
    ]),
    ...(storyboardMode ? ['- 槽位角色:', ...distributions.slot_role.map((item) => `  - ${item.name}: ${item.count}`)] : []),
    ...(storyboardMode ? ['- 参考模式:', ...referenceModes.map((item) => `  - ${item.name}: ${item.count}`)] : []),
    ...(storyboardMode && editSources.length ? ['- 编辑底图来源:', ...editSources.map((item) => `  - ${item.name}: ${item.count}`)] : []),
    '',
    '## DAOGE 摘要',
    '',
    `- 本次任务共 ${prompts.length} 条提示词，按每批 ${batchSize} 条拆分`,
    `- 当前共规划 ${batches.length} 批，预览展示前 ${previewItems.length} 条`,
    '- 当前阶段仅生成预览，尚未正式执行生图',
    '',
    '## 批次计划',
    '',
    ...batches.map((item) => `- 第 ${item.batchNumber} 批: ${item.promptCount} 条提示词 (${item.firstIndex} -> ${item.lastIndex})`),
    '',
    '## 提示词样例',
    '',
  ];

  previewItems.forEach((item, idx) => {
    lines.push(`### ${item.index ?? idx + 1}. ${displayTitle(item, idx + 1)}`);
    [
      bullet(labelField('board_id'), item.board_id),
      bullet(labelField('slot_id'), item.slot_id),
      bullet(labelField('slot_role'), item.slot_role),
      bullet(labelField('shot_id'), item.shot_id),
      bullet(labelField('shot_label'), item.shot_label),
      bullet(labelField('layout_region_id'), item.layout_region_id),
      bullet(labelField('timecode'), item.timecode),
      bullet(labelField('style_variant'), item.style_variant),
      ...displayProfile.sampleFields.map((field) => bullet(field.label, normalizeValue(item[field.key]))),
      bullet(labelField('scene_anchor'), item.scene_anchor),
      bullet(labelField('exposure_signal'), item.exposure_signal),
      bullet(labelField('gesture'), item.gesture),
      bullet(labelField('camera'), item.camera),
      bullet(labelField('eye_language'), item.eye_language),
      bullet(labelField('candidness'), item.candidness),
      bullet(labelField('lighting'), item.lighting),
      bullet(labelField('palette'), Array.isArray(item.palette) ? item.palette.join(', ') : item.palette),
      bullet(labelField('mood'), item.mood),
      bullet(labelField('composition'), item.composition),
      bullet(labelField('reference_images'), Array.isArray(item.reference_images) ? `${item.reference_images.length} 张` : item.reference_images),
      bullet(labelField('reference_mode'), item.reference_mode),
      bullet('分镜执行策略', formatEditMode(item)),
      bullet(labelField('mask_image'), item.mask_image ? '已提供' : null),
      bullet(labelField('edit_source'), item.edit_source),
      bullet(labelField('edit_source_output'), item.edit_source_output ? path.basename(item.edit_source_output) : null),
      bullet(labelField('reference_notes'), Array.isArray(item.reference_notes) ? item.reference_notes.join(' / ') : item.reference_notes),
      bullet(labelField('prompt_hints'), Array.isArray(item.prompt_hints) ? item.prompt_hints.join(' / ') : item.prompt_hints),
      bullet(labelField('continuity_notes'), Array.isArray(item.continuity_notes) ? item.continuity_notes.join(' / ') : item.continuity_notes),
      bullet(labelField('voiceover'), item.voiceover),
      bullet(labelField('music'), item.music),
      bullet(labelField('sound_effects'), item.sound_effects),
      bullet(labelField('camera_move'), item.camera_move),
      bullet(labelField('text_policy'), item.text_policy),
      bullet(labelField('source_refs'), Array.isArray(item.source_refs) ? item.source_refs.join(', ') : item.source_refs),
      bullet(labelField('notes'), item.notes),
    ].filter(Boolean).forEach((line) => lines.push(line));
    lines.push('- 正向提示词:');
    lines.push('```text');
    lines.push(getPromptText(item));
    lines.push('```');
    if (item.negative_prompt) {
      lines.push('- 负向提示词:');
      lines.push('```text');
      lines.push(shorten(item.negative_prompt, 500));
      lines.push('```');
    }
    lines.push('');
  });

  if (prompts.length > previewItems.length) {
    lines.push('## 未展开的提示词');
    lines.push('');
    lines.push(`- 预览文件省略了 ${prompts.length - previewItems.length} 条提示词，完整内容仍保存在 ${promptsFile}`);
  }

  lines.push('');
  lines.push('## DAOGE 确认提示');
  lines.push('');
  lines.push(`- 你确认这版提示词和批次规划后，DAOGE 再开始正式生图`);
  lines.push(`- 如果需要调整风格、数量、批次、尺寸或并发，先改参数，再重新生成预览`);
  lines.push(...quickReplyBlock([
    '确认，继续生成开跑前总览',
    '这版方向可以，开始生图',
    '保留结构，增强风格差异',
    '降低重复度后重新预览',
  ]));

  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`);

  const summaryLines = [
    ...brandHeader('DAOGE 运行摘要', 'preview'),
    '',
    '我是 DAOGE。这一轮任务已经完成预览阶段，当前摘要如下。',
    '',
    '## 当前状态',
    '',
    '- 状态: 预览已生成，尚未正式执行生图',
    `- 提示词总数: ${prompts.length}`,
    `- 每批数量: ${batchSize}`,
    `- 批次数量: ${batches.length}`,
    `- 预览数量: ${previewItems.length}`,
    '',
    '## 主要分布',
    '',
    ...displayProfile.summaryFields.map((field, index) => `- ${field.label}: ${topLabel(displayDistributions[index]?.counts || [])}`),
    '',
    '## 关键文件',
    '',
    `- 提示词预览: ${outputPath}`,
    `- 批次计划: ${planPath}`,
    `- 完整提示词文件: ${promptsFile}`,
    '',
    '## 下一步',
    '',
    '- 确认这版提示词和批次规划',
    '- 如需调整风格、数量、批次、尺寸或并发，先改参数再重新生成预览',
    '- 确认无误后，再进入正式生图阶段',
    '',
    '## DAOGE 提示',
    '',
    '- 这份摘要面向快速阅读',
    '- 需要看细节时，再打开提示词预览文件或完整提示词文件',
  ];

  fs.writeFileSync(summaryPath, `${summaryLines.join('\n')}\n`);
  console.log(JSON.stringify({ outputPath, planPath, summaryPath, promptCount: prompts.length, batchCount: batches.length, previewCount: previewItems.length, distributions }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
