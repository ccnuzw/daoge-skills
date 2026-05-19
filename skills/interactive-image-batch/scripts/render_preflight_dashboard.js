const fs = require('fs');
const path = require('path');
const { parseArgs, readJson } = require('./script_utils');
const { labelField, labelSource, formatFieldSource, translateValidationMessage } = require('./display_labels_zh');
const { brandHeader, quickReplyBlock, userFocusBlock } = require('./daoge_brand_zh');
const { resolveProfile, buildDisplayDistributions, normalizeValue } = require('./template_display_profile');

function formatList(items, fallback = '未提供') {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  return list.length ? list.map((item) => `- ${item}`).join('\n') : `- ${fallback}`;
}

function formatInline(items, fallback = '未提供') {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  return list.length ? list.join(' -> ') : fallback;
}

function top(items, key, limit = 6) {
  return (items?.[key] || []).slice(0, limit);
}

function samplePrompts(prompts, count = 3) {
  return prompts.slice(0, count);
}

function displayTitle(item, fallbackIndex) {
  const shotLabel = String(item.shot_label || '').trim();
  if (shotLabel) return shotLabel;
  const scene = String(item.scene || '').trim();
  if (scene) return scene;
  return item.title || item.slug || `prompt-${fallbackIndex}`;
}

function hasVariantAxes(prompts) {
  return prompts.some((item) => Array.isArray(item.variant_axes) && item.variant_axes.length);
}

function collectVariantAxes(prompts) {
  const axes = {};
  prompts.forEach((item) => {
    (Array.isArray(item.variant_axes) ? item.variant_axes : []).forEach((axis) => {
      const name = axis.axis || axis.field;
      const value = axis.option || axis.value;
      if (!name || !value) return;
      axes[name] = axes[name] || {};
      axes[name][value] = (axes[name][value] || 0) + 1;
    });
  });
  return axes;
}

function formatVariantAxes(axes) {
  const entries = Object.entries(axes);
  if (!entries.length) return ['- 未配置'];
  return entries.flatMap(([axis, counts]) => [
    `- ${labelField(axis)}: ${Object.entries(counts).map(([value, count]) => `${value} ${count}`).join(', ')}`,
  ]);
}

function collectFieldSources(prompts) {
  const counts = {};
  prompts.forEach((item) => {
    const sources = item.field_sources || {};
    Object.entries(sources).forEach(([field, source]) => {
      const key = `${field}: ${source}`;
      counts[key] = (counts[key] || 0) + 1;
    });
  });
  return counts;
}

function formatPromptFieldSources(counts) {
  const entries = Object.entries(counts);
  if (!entries.length) return ['- 未记录'];
  return entries.slice(0, 12).map(([name, count]) => {
    const separator = name.indexOf(': ');
    if (separator === -1) return `- ${name}: ${count}`;
    const field = name.slice(0, separator);
    const source = name.slice(separator + 2);
    if (field === 'style_family' || field === 'purity_grade') return null;
    return `- ${labelField(field)} / ${labelSource(source)}: ${count}`;
  }).filter(Boolean);
}

function formatSizeIssues(sizeIssues) {
  const list = Array.isArray(sizeIssues) ? sizeIssues : [];
  if (!list.length) return ['- 无'];
  return list.slice(0, 12).map((item) => {
    const prefix = item.index !== undefined ? `- #${item.index} / ${item.size}` : `- ${item.size}`;
    const detail = item.displayIssue || translateValidationMessage(item.issue || '');
    return `${prefix}: ${detail}`;
  });
}

function sumValues(record) {
  return Object.values(record || {}).reduce((acc, value) => acc + Number(value || 0), 0);
}

function blockingMissingCount(missing = {}) {
  const blockingFields = ['prompt_text'];
  return blockingFields.reduce((acc, field) => acc + Number(missing[field] || 0), 0);
}

function buildReadiness(taskSpec, validation, gates) {
  const blocking = [];
  const cautions = [];
  const errors = Array.isArray(validation.errors) ? validation.errors : [];
  const warnings = Array.isArray(validation.warnings) ? validation.warnings : [];
  const missingTotal = blockingMissingCount(validation.missing);
  const templateMissingTotal = sumValues(gates.templateMissing);
  const sizeIssueCount = (gates.sizeIssues || []).length;
  const shortPromptCount = (gates.shortPrompts || []).length;
  const nearDuplicateCount = (gates.nearDuplicatePairs || []).length;
  const duplicatePromptCount = Number(validation.duplicatePromptCount || 0);
  const slugCollisionCount = (validation.slugCollisions || []).length;

  if (!validation.ok) blocking.push('提示词校验未通过');
  if (errors.length) blocking.push(`存在 ${errors.length} 条错误`);
  if (missingTotal > 0) blocking.push(`仍有 ${missingTotal} 个核心缺失字段`);
  if (templateMissingTotal > 0) blocking.push(`仍有 ${templateMissingTotal} 个模板必填项缺失`);
  if (sizeIssueCount > 0) blocking.push(`存在 ${sizeIssueCount} 个尺寸问题`);
  if (slugCollisionCount > 0) blocking.push(`存在 ${slugCollisionCount} 个标识名冲突`);
  if (duplicatePromptCount > 0) blocking.push(`存在 ${duplicatePromptCount} 条重复提示词`);
  if (Number(taskSpec.concurrency || 0) > 12) blocking.push(`当前并发 ${taskSpec.concurrency} 超过建议上限 12`);

  if (warnings.length) cautions.push(`存在 ${warnings.length} 条警告`);
  if (shortPromptCount > 0) cautions.push(`有 ${shortPromptCount} 条过短提示词`);
  if (nearDuplicateCount > 0) cautions.push(`发现 ${nearDuplicateCount} 组近重复提示词`);
  if (Number(taskSpec.total_count || 0) >= 300 && !taskSpec.sample_size) cautions.push('大批量任务未设置样本阶段');
  if (Number(taskSpec.total_count || 0) >= 300 && !taskSpec.stage_size) cautions.push('大批量任务未设置分阶段大小');
  if (Number(taskSpec.total_count || 0) >= 300 && !taskSpec.auto_pause) cautions.push('大批量任务未开启自动暂停保护');
  if (Number(taskSpec.total_count || 0) >= 300 && Number(taskSpec.concurrency || 0) >= 8) cautions.push(`大批量任务当前并发 ${taskSpec.concurrency} 偏高`);
  if (Number(taskSpec.total_count || 0) >= 300 && Number(taskSpec.batch_size || 0) >= 40) cautions.push(`大批量任务每批 ${taskSpec.batch_size} 张偏大`);
  if (Number(taskSpec.total_count || 0) >= 100 && taskSpec.require_confirmation === false) cautions.push('当前设置为不经确认直接执行');
  if (Number(taskSpec.timeout_seconds || 0) > 0 && Number(taskSpec.timeout_seconds || 0) < 240) cautions.push(`当前单张超时 ${taskSpec.timeout_seconds} 秒偏短`);

  let status = 'green';
  let label = '绿灯';
  let verdict = '可以直接开跑';
  let suggestions = [
    '确认这版总览无误后，直接开始正式生图',
    '保留当前参数，优先按预览结果进入执行阶段',
  ];

  if (blocking.length) {
    status = 'red';
    label = '红灯';
    verdict = '先修正问题，不要直接执行';
    suggestions = [
      '先修正红灯问题，再重新生成预检总览',
      '优先处理缺失字段、尺寸问题、重复提示词或模板缺项',
      '如果你不想逐项改运行参数，可以改用 DAOGE 预设补齐',
    ];
  } else if (cautions.length) {
    status = 'yellow';
    label = '黄灯';
    verdict = '可以执行，但建议先调整风险项';
    suggestions = [
      '优先降低并发、缩小每批张数，或先跑样本批',
      '如果是 300 张以上任务，建议开启样本阶段、分阶段和自动暂停',
      '处理完风险项后，再重新生成一版预检总览',
    ];
  }

  return {
    status,
    label,
    verdict,
    blocking,
    cautions,
    suggestions,
  };
}

function formatStoryboardSummary(storyboard) {
  if (!storyboard) return ['未启用 storyboard_plan'];
  const summary = storyboard.summary || {};
  const roleCounts = Object.entries(summary.role_counts || {});
  const referenceBindings = storyboard.reference_bindings || null;
  return [
    `布局 ID: ${summary.layout_id || '未提供'}`,
    `分镜板 ID: ${summary.board_id || '未提供'}`,
    `生成模式: ${summary.generation_mode || '未提供'}`,
    `参考图模式: ${summary.reference_mode || '未提供'}`,
    `参考绑定: ${referenceBindings?.path || '未提供'}`,
    `画布尺寸: ${summary.canvas?.width || '?'} x ${summary.canvas?.height || '?'}`,
    `可生图槽位数: ${summary.generation_slot_count || 0}`,
    `局部编辑槽位数: ${summary.local_edit_slot_count || 0}`,
    `遮罩槽位数: ${summary.mask_slot_count || 0}`,
    `槽位角色分布: ${roleCounts.length ? roleCounts.map(([role, count]) => `${role} ${count}`).join(', ') : '未提供'}`,
    `参考模式分布: ${Object.entries(summary.reference_mode_counts || {}).length ? Object.entries(summary.reference_mode_counts || {}).map(([mode, count]) => `${mode} ${count}`).join(', ') : '未提供'}`,
  ];
}

function summarizeEditSignals(prompts) {
  const items = Array.isArray(prompts) ? prompts : [];
  const promptCount = items.length;
  const selectedSlotIds = Array.from(new Set(items.map((item) => String(item.slot_id || '').trim()).filter(Boolean)));
  const localEditSlotIds = Array.from(new Set(items
    .filter((item) => {
      const mode = String(item.reference_mode || '').trim();
      const source = String(item.edit_source || '').trim();
      return source === 'previous-output' || mode === 'masked-edit';
    })
    .map((item) => String(item.slot_id || '').trim())
    .filter(Boolean)));
  const editSourceCount = items.filter((item) => String(item.edit_source || '').trim() === 'previous-output').length;
  const maskCount = items.filter((item) => Boolean(item.mask_image)).length;
  const localEditCount = localEditSlotIds.length;
  const selectionScope = promptCount <= 6 ? '局部小范围任务' : '常规任务';
  return {
    promptCount,
    selectedSlotIds,
    localEditSlotIds,
    editSourceCount,
    maskCount,
    localEditCount,
    selectionScope,
  };
}

function resolveUserFacingTemplateName(taskSpec, modeDetection, strategy) {
  const outputMode = String(taskSpec.output_mode || '').trim();
  if (outputMode) return outputMode;
  const variantName = String(
    strategy?.template_variant?.display_name ||
    strategy?.template_variant?.name ||
    ''
  ).trim();
  if (variantName) return variantName;
  return String(modeDetection?.detected_template?.name || '').trim() || '未检测';
}

function formatModeLabel(mode) {
  const text = String(mode || '').trim();
  if (!text) return '未检测';
  if (text === 'prepare-only') return '预检准备阶段';
  if (text === 'storyboard-board') return '分镜整板预检阶段';
  return text;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ['task-spec', 'strategy-file', 'prompts-file', 'validation-report', 'preview-file', 'plan-file', 'summary-file', 'mode-file'];
  for (const key of required) {
    if (!args[key]) throw new Error(`Missing required flag: --${key}`);
  }

  const taskSpecPath = path.resolve(args['task-spec']);
  const strategyPath = path.resolve(args['strategy-file']);
  const promptsPath = path.resolve(args['prompts-file']);
  const validationPath = path.resolve(args['validation-report']);
  const previewPath = path.resolve(args['preview-file']);
  const planPath = path.resolve(args['plan-file']);
  const summaryPath = path.resolve(args['summary-file']);
  const modePath = path.resolve(args['mode-file']);
  const outputPath = path.resolve(args['output-file'] || path.join(path.dirname(promptsPath), 'daoge_preflight_dashboard.md'));

  const taskSpec = readJson(taskSpecPath);
  const strategy = readJson(strategyPath);
  const prompts = readJson(promptsPath);
  const validation = readJson(validationPath);
  const batchPlan = readJson(planPath);
  const modeDetection = readJson(modePath);
  const storyboard = args['storyboard-file'] && fs.existsSync(path.resolve(args['storyboard-file'])) ? readJson(args['storyboard-file']) : null;
  const template = modeDetection.detected_template || {};
  const templateDocument = modeDetection.template_document || {};
  const gates = validation.qualityGates || {};
  const draftPrompts = args['draft-file'] && fs.existsSync(path.resolve(args['draft-file'])) ? readJson(args['draft-file']) : [];
  const variantSource = hasVariantAxes(prompts) ? prompts : draftPrompts;
  const variantAxes = collectVariantAxes(variantSource);
  const draftByIndex = new Map(draftPrompts.map((item) => [String(item.index), item]));
  const matrixPlan = args['matrix-plan-file'] && fs.existsSync(path.resolve(args['matrix-plan-file'])) ? readJson(args['matrix-plan-file']) : null;
  const promptFieldSources = collectFieldSources(draftPrompts.length ? draftPrompts : prompts);
  const taskFieldSources = taskSpec.field_sources || {};
  const readiness = buildReadiness(taskSpec, validation, gates);
  const editSignals = summarizeEditSignals(prompts);
  const displayProfile = resolveProfile(prompts);
  const userFacingTemplateName = resolveUserFacingTemplateName(taskSpec, modeDetection, strategy);
  const displayDistributions = buildDisplayDistributions(prompts, displayProfile)
    .map((item) => ({ ...item, counts: item.counts.slice(0, 6) }));
  const runtimeSourceFields = [
    'provider',
    'batch_size',
    'width',
    'height',
    'aspect_ratio_label',
    'concurrency',
    'retry_count',
    'timeout_seconds',
    'output_format',
    'preview_count',
    'contact_sheet',
    'require_confirmation',
    'sample_size',
    'stage_size',
    'stop_after_sample',
    'auto_pause',
    'max_consecutive_failures',
    'max_batch_failure_rate',
    'skip_existing',
  ];

  const lines = [
    ...brandHeader('DAOGE 开跑前总览', 'preview'),
    '',
    '我是 DAOGE。这是一份正式生图前的总览面板，用于最终确认这轮任务是否可以开始执行。',
    ...userFocusBlock([
      `方向：${taskSpec.content_brief || '未提供'} / ${taskSpec.output_mode || '未提供'}`,
      `规模：共 ${taskSpec.total_count} 张，${taskSpec.width} x ${taskSpec.height}，分 ${batchPlan.length} 批`,
      `稳定性：并发 ${taskSpec.concurrency}，重试 ${taskSpec.retry_count} 次，自动暂停${taskSpec.auto_pause ? '已开启' : '未开启'}`,
    ]),
    '',
    '## 0. DAOGE 预检结论',
    '',
    `- 当前信号灯: ${readiness.label}`,
    `- 结论: ${readiness.verdict}`,
    `- 阻塞项数量: ${readiness.blocking.length}`,
    `- 风险提示数量: ${readiness.cautions.length}`,
    '',
    '### 阻塞项',
    '',
    formatList(readiness.blocking, '无'),
    '',
    '### 风险提示',
    '',
    formatList(readiness.cautions, '无'),
    '',
    '### 建议动作',
    '',
    formatList(readiness.suggestions, '无'),
    '',
    '## 1. 任务定义',
    '',
    `- 内容主题: ${taskSpec.content_brief || '未提供'}`,
    `- 输出模式: ${taskSpec.output_mode || '未提供'}`,
    `- DAOGE 模式: ${formatModeLabel(modeDetection.detected_mode)}`,
    `- DAOGE 模板: ${userFacingTemplateName}`,
    `- 模板文档: ${templateDocument.exists ? templateDocument.path : (template.template_doc || '未设置')}`,
    `- 参考来源数量: ${(taskSpec.source_files || []).length}`,
    `- 参考图片数量: ${(taskSpec.source_images || []).length}`,
    `- 运行标签: ${taskSpec.run_label || '未设置'}`,
    `- 生图 Provider: ${taskSpec.provider || 'openai'}`,
    `- 运行预设: ${taskSpec.run_preset?.name || taskSpec.run_preset?.id || '未设置'}${taskSpec.run_preset?.explicit === false ? '（DAOGE 默认）' : ''}`,
    `- 模板变体: ${matrixPlan?.templateVariant?.name || matrixPlan?.templateVariant?.id || strategy.template_variant?.name || strategy.template_variant?.id || '未设置'}`,
    '',
    '### DAOGE 模板聚焦',
    '',
    formatList(template.required_focus, '未提供'),
    '',
    '### 模板必问项',
    '',
    formatList(template.ask_fields, '未提供'),
    '',
    '### 提示词槽位必备字段',
    '',
    formatList(template.required_slot_fields, '未提供'),
    '',
    '### 提示词写作顺序',
    '',
    `- ${formatInline(template.prompt_sections)}`,
    '',
    '### 构图偏置',
    '',
    formatList(template.composition_bias, '未提供'),
    '',
    '### 质量规则',
    '',
    formatList(template.quality_rules, '未提供'),
    '',
    '### 默认负向约束',
    '',
    formatList(template.default_negative_terms, '未提供'),
    '',
    '### 反模式检查',
    '',
    formatList(template.anti_patterns, '未提供'),
    '',
    '### 风格要求',
    '',
    formatList(taskSpec.style_requirements),
    '',
    '### 分镜板摘要',
    '',
    formatList(formatStoryboardSummary(storyboard), '未启用 storyboard_plan'),
    '',
    '### 局部编辑识别',
    '',
    formatList([
      `任务范围: ${editSignals.selectionScope}`,
      `当前提示词条数: ${editSignals.promptCount}`,
      `当前生图槽位: ${editSignals.selectedSlotIds.length ? editSignals.selectedSlotIds.join(', ') : '未识别'}`,
      `局部编辑槽位数: ${editSignals.localEditCount}`,
      `复用上一轮结果做底图: ${editSignals.editSourceCount}`,
      `带遮罩槽位数: ${editSignals.maskCount}`,
      `局部编辑目标分镜: ${editSignals.localEditSlotIds.length ? editSignals.localEditSlotIds.join(', ') : '未识别'}`,
    ], '未识别到局部编辑特征'),
    '',
    ...(storyboard ? [
      '### 分镜板校验提醒',
      '',
      formatList(storyboard.warnings, '无'),
      '',
    ] : []),
    '',
    '### 变化要求',
    '',
    formatList(taskSpec.variation_requirements),
    '',
    '## 2. 执行参数',
    '',
    `- 总张数: ${taskSpec.total_count}`,
    `- 生图 Provider: ${taskSpec.provider || 'openai'}`,
    `- 每批张数: ${taskSpec.batch_size}`,
    `- 批次数量: ${batchPlan.length}`,
    `- 分辨率: ${taskSpec.width} x ${taskSpec.height}`,
    `- 比例: ${taskSpec.aspect_ratio_label || '未设置'}`,
    `- 并发数: ${taskSpec.concurrency}`,
    `- 超时秒数: ${taskSpec.timeout_seconds}`,
    `- 重试次数: ${taskSpec.retry_count}`,
    `- 输出格式: ${taskSpec.output_format}`,
    `- 是否先确认: ${taskSpec.require_confirmation ? '是' : '否'}`,
    `- 样本阶段: ${taskSpec.sample_size || 0}`,
    `- 阶段大小: ${taskSpec.stage_size || 0}`,
    `- 样本后暂停: ${taskSpec.stop_after_sample ? '是' : '否'}`,
    `- 自动暂停: ${taskSpec.auto_pause ? '是' : '否'}`,
    `- 连续失败暂停阈值: ${taskSpec.max_consecutive_failures ?? '未设置'}`,
    `- 批次失败率暂停阈值: ${taskSpec.max_batch_failure_rate ?? '未设置'}`,
    `- 续跑跳过已完成: ${taskSpec.skip_existing ? '是' : '否'}`,
    '',
    '### 运行参数来源',
    '',
    ...runtimeSourceFields.map((field) => formatFieldSource(field, taskFieldSources[field] || '未记录')),
    '',
    '## 3. 风格与素材分布',
    '',
    ...displayDistributions.flatMap((item) => [
      `### ${item.label}分布`,
      '',
      ...(item.counts.length ? item.counts.map((entry) => `- ${entry.name}: ${entry.count}`) : ['- 未提供']),
      '',
    ]),
    '',
    '### 变体矩阵',
    '',
    ...formatVariantAxes(variantAxes),
    '',
    '### 矩阵规划',
    '',
    `- 矩阵轴数量: ${matrixPlan?.axes?.length || 0}`,
    `- 组合数量: ${matrixPlan?.combinationCounts ? Object.keys(matrixPlan.combinationCounts).length : 0}`,
    `- 矩阵批次数: ${matrixPlan?.batchCount || batchPlan.length}`,
    '',
    '### 提示词字段来源',
    '',
    ...formatPromptFieldSources(promptFieldSources),
    '',
    '## 4. 质量校验',
    '',
    `- 提示词总数: ${validation.promptCount}`,
    `- 缺失字段: ${Object.values(validation.missing || {}).reduce((acc, value) => acc + Number(value || 0), 0)}`,
    `- 标识名冲突: ${(validation.slugCollisions || []).length}`,
    `- 重复提示词: ${validation.duplicatePromptCount || 0}`,
    `- 校验状态: ${validation.ok ? '通过' : '未通过'}`,
    `- 错误数: ${(validation.errors || []).length}`,
    `- 警告数: ${(validation.warnings || []).length}`,
    '',
    '### 质量门禁详情',
    '',
    `- 严格模式: ${gates.strict ? '是' : '否'}`,
    `- 过短提示词: ${(gates.shortPrompts || []).length}`,
    `- 近重复组合: ${(gates.nearDuplicatePairs || []).length}`,
    `- 模板字段缺失: ${Object.values(gates.templateMissing || {}).reduce((acc, value) => acc + Number(value || 0), 0)}`,
    `- 尺寸问题: ${(gates.sizeIssues || []).length}`,
    `- 品牌海报缺少 KV 意图: ${(gates.campaignPosterIssues?.missingCampaignIntent || []).length}`,
    `- 品牌海报缺少全身信号: ${(gates.campaignPosterIssues?.missingFullBodySignal || []).length}`,
    `- 品牌海报缺少文字安全区: ${(gates.campaignPosterIssues?.missingTextSafeSignal || []).length}`,
    `- 品牌海报缺少场景信号: ${(gates.campaignPosterIssues?.missingSceneSignal || []).length}`,
    '',
    '### 质量门禁警告',
    '',
    formatList((validation.warnings || []).map(translateValidationMessage), '无'),
    '',
    '### 质量门禁错误',
    '',
    formatList((validation.errors || []).map(translateValidationMessage), '无'),
    '',
    '### 尺寸问题明细',
    '',
    ...formatSizeIssues(gates.sizeIssues),
    '',
    '## 5. 批次计划',
    '',
    ...batchPlan.map((item) => `- 第 ${item.batchNumber} 批: ${item.promptCount} 条 (${item.firstIndex} -> ${item.lastIndex})`),
    '',
    '## 6. 提示词样例',
    '',
  ];

    samplePrompts(prompts, 3).forEach((item, index) => {
      lines.push(`### 样例 ${index + 1}`);
      lines.push(`- 标题: ${displayTitle(item, index + 1)}`);
      lines.push(`- 槽位 ID: ${item.slot_id || '未设置'}`);
      displayProfile.sampleFields.forEach((field) => {
        lines.push(`- ${field.label}: ${normalizeValue(item[field.key]) || '未设置'}`);
      });
      lines.push(`- 参考模式: ${item.reference_mode || '未设置'}`);
      if (item.edit_source && item.edit_source !== '(missing)') lines.push(`- 编辑底图来源: ${item.edit_source}`);
      lines.push(`- 遮罩图: ${item.mask_image ? '已提供' : '未提供'}`);
      const draftItem = draftByIndex.get(String(item.index)) || {};
    const variantSignature = item.variant_signature || draftItem.variant_signature;
    if (variantSignature) lines.push(`- 变体签名: ${variantSignature}`);
    lines.push('- 正向提示词:');
    lines.push('```text');
    lines.push(String(item.generation_prompt || item.prompt || '').trim());
    lines.push('```');
    if (item.negative_prompt) {
      lines.push('- 负向提示词:');
      lines.push('```text');
      lines.push(String(item.negative_prompt).trim());
      lines.push('```');
    }
    lines.push('');
  });

  lines.push('## 7. 关键文件');
  lines.push('');
  lines.push(`- 任务规格: ${taskSpecPath}`);
  lines.push(`- 策略文件: ${strategyPath}`);
  lines.push(`- 提示词文件: ${promptsPath}`);
  lines.push(`- 校验报告: ${validationPath}`);
  lines.push(`- 提示词预览: ${previewPath}`);
  lines.push(`- 批次计划: ${planPath}`);
  lines.push(`- DAOGE 摘要: ${summaryPath}`);
  lines.push(`- 模式检测: ${modePath}`);
  lines.push('');
  lines.push('## 8. DAOGE 最终确认');
  lines.push('');
  lines.push(`- 当前预检信号灯：${readiness.label}`);
  lines.push(`- DAOGE 结论：${readiness.verdict}`);
  lines.push('- 如果需要调整内容、风格、数量、批次、尺寸、并发或重试，先修改参数，再重新生成这一页');
  lines.push('- 这一页是 DAOGE 在正式执行前给出的最终确认面板');
  const replies = readiness.status === 'red'
    ? [
        '先别跑，帮我修正红灯问题',
        '先别跑，帮我改参数后重新预检',
        '重新生成一版提示词预览',
      ]
    : readiness.status === 'yellow'
      ? [
          '先别跑，帮我降低风险',
          '先跑样本批再说',
          '降低并发后重新预检',
          '确认，按当前方案开始生图',
        ]
      : [
          '确认，开始生图',
          '先别跑，帮我调整风格',
          '先别跑，帮我降低并发',
          '重新生成一版提示词预览',
        ];
  lines.push(...quickReplyBlock(replies));

  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`);
  console.log(JSON.stringify({
    outputPath,
    promptCount: validation.promptCount,
    batchCount: batchPlan.length,
    validationOk: validation.ok,
    readinessStatus: readiness.status,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
