const fs = require('fs');
const path = require('path');
const { labelField } = require('./display_labels_zh');
const { brandHeader, quickReplyBlock, userFocusBlock } = require('./daoge_brand_zh');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
    args[key] = value;
    if (value !== 'true') i += 1;
  }
  return args;
}

function parseNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function chunkArray(items, chunkSize) {
  const out = [];
  for (let i = 0; i < items.length; i += chunkSize) out.push(items.slice(i, i + chunkSize));
  return out;
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item[key];
    const label = value === undefined || value === null || value === '' ? '(missing)' : String(value).trim();
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

function topLabel(entries, fallback = '未指定') {
  return entries[0]?.name || fallback;
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
  };

  const previewItems = prompts.slice(0, previewCount);
  const lines = [
    ...brandHeader('DAOGE 提示词预览', 'preview'),
    '',
    '我是 DAOGE。预览已经生成，先看这次任务的摘要。',
    ...userFocusBlock([
      `数量：共 ${prompts.length} 条提示词，预览 ${previewItems.length} 条`,
      `批次：按每批 ${batchSize} 条拆分，共 ${batches.length} 批`,
      `方向：主风格族 ${topLabel(distributions.style_family)}，主场景 ${topLabel(distributions.scene)}`,
    ]),
    '',
    `- 提示词来源: ${promptsFile}`,
    `- 提示词总数: ${prompts.length}`,
    `- 每批数量: ${batchSize}`,
    `- 批次数量: ${batches.length}`,
    `- 预览数量: ${previewItems.length}`,
    '',
    '## 分布摘要',
    '',
    '- 风格族:',
    ...distributions.style_family.map((item) => `  - ${item.name}: ${item.count}`),
    '- 强度等级:',
    ...distributions.purity_grade.map((item) => `  - ${item.name}: ${item.count}`),
    '- 场景:',
    ...distributions.scene.map((item) => `  - ${item.name}: ${item.count}`),
    '- 服装:',
    ...distributions.wardrobe.map((item) => `  - ${item.name}: ${item.count}`),
    '- 构图:',
    ...distributions.composition.map((item) => `  - ${item.name}: ${item.count}`),
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
    lines.push(`### ${item.index ?? idx + 1}. ${item.title || item.slug || `prompt-${idx + 1}`}`);
    [
      bullet(labelField('slug'), item.slug),
      bullet(labelField('style_family'), item.style_family),
      bullet(labelField('style_variant'), item.style_variant),
      bullet(labelField('purity_grade'), item.purity_grade),
      bullet(labelField('scene'), item.scene),
      bullet(labelField('scene_anchor'), item.scene_anchor),
      bullet(labelField('wardrobe'), item.wardrobe),
      bullet(labelField('exposure_signal'), item.exposure_signal),
      bullet(labelField('gesture'), item.gesture),
      bullet(labelField('camera'), item.camera),
      bullet(labelField('eye_language'), item.eye_language),
      bullet(labelField('candidness'), item.candidness),
      bullet(labelField('lighting'), item.lighting),
      bullet(labelField('palette'), Array.isArray(item.palette) ? item.palette.join(', ') : item.palette),
      bullet(labelField('mood'), item.mood),
      bullet(labelField('composition'), item.composition),
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
    `- 主风格族: ${topLabel(distributions.style_family)}`,
    `- 主强度等级: ${topLabel(distributions.purity_grade)}`,
    `- 主场景: ${topLabel(distributions.scene)}`,
    `- 主服装: ${topLabel(distributions.wardrobe)}`,
    `- 主构图: ${topLabel(distributions.composition)}`,
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
