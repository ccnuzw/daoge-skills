const FIELD_LABELS_ZH = {
  run_preset: 'DAOGE 运行预设',
  content_brief: '内容主题',
  output_mode: '输出模式',
  style_requirements: '风格要求',
  source_files: '参考文件',
  total_count: '总张数',
  batch_size: '每批张数',
  width: '图片宽度',
  height: '图片高度',
  aspect_ratio_label: '图片比例',
  concurrency: '并发数',
  retry_count: '失败重试次数',
  timeout_seconds: '单张超时秒数',
  output_format: '输出格式',
  preview_count: '预览数量',
  contact_sheet: '生成联系表',
  require_confirmation: '执行前确认',
  sample_size: '样本阶段张数',
  stage_size: '分阶段张数',
  stop_after_sample: '样本后暂停',
  auto_pause: '自动暂停保护',
  max_consecutive_failures: '连续失败暂停阈值',
  max_batch_failure_rate: '批次失败率暂停阈值',
  skip_existing: '续跑跳过已完成',
  variation_requirements: '变化控制要求',
  text_policy: '文字排版策略',
  identity_policy: '身份策略',
  negative_requirements: '负向要求',
  run_label: '运行标签',
  notes: '备注',
  slug: '标识名',
  title: '标题',
  style_family: '风格族',
  style_variant: '风格变体',
  purity_grade: '强度等级',
  scene: '场景',
  scene_anchor: '场景锚点',
  wardrobe: '服装',
  exposure_signal: '细节强调',
  gesture: '姿态',
  camera: '镜头 / 构图',
  camera_language: '镜头语言',
  eye_language: '眼神',
  candidness: '瞬间感',
  lighting: '光线',
  palette: '色彩',
  mood: '情绪',
  composition: '构图',
  source_refs: '参考来源',
  grid_role: '画面角色',
  story_beat: '叙事节点',
  ad_test_hypothesis: '广告测试假设',
  detail_page_role: '详情页角色',
  variant_axes: '变体轴',
  variant_signature: '变体签名',
  generation_prompt: '正向提示词',
  negative_prompt: '负向提示词',
};

const PRESET_LABELS_ZH = {
  safe_2k_poster: 'DAOGE 默认安全 2K 海报预设',
  large_batch_stable: 'DAOGE 稳定大批量预设',
  fast_preview: 'DAOGE 快速预览预设',
  provider_stress_safe: 'DAOGE Provider 保守模式预设',
};

const SOURCE_LABELS_ZH = {
  dialogue: '来自对话显式设定',
  default: '来自 DAOGE 默认选择',
  none: '未使用',
  strategy: '来自策略规划',
  autofill: '来自自动补全',
  template: '来自模板',
  preset: '来自 DAOGE 运行预设',
};

function labelField(field) {
  return FIELD_LABELS_ZH[field] || String(field || '未命名字段');
}

function labelPreset(presetId) {
  return PRESET_LABELS_ZH[presetId] || `DAOGE 预设 ${presetId}`;
}

function labelSource(source) {
  const value = String(source || '').trim();
  if (!value) return '未记录';
  if (value.startsWith('preset:')) return `来自 ${labelPreset(value.slice('preset:'.length))}`;
  if (SOURCE_LABELS_ZH[value]) return SOURCE_LABELS_ZH[value];
  if (value.includes('autofill')) return '来自自动补全';
  if (value.includes('template')) return '来自模板';
  if (value.includes('strategy')) return '来自策略规划';
  return value;
}

function formatFieldSource(field, source) {
  return `- ${labelField(field)}: ${labelSource(source)}`;
}

function translateValidationMessage(message) {
  const text = String(message || '').trim();
  if (!text) return text;

  let match = text.match(/^Style family is highly concentrated: (.+)$/);
  if (match) return `风格族过于集中：${match[1]}`;

  match = text.match(/^(.+) prompts are shorter than (.+) characters$/);
  if (match) return `有 ${match[1]} 条提示词短于 ${match[2]} 个字符`;

  match = text.match(/^(.+) near-duplicate prompt pairs detected at threshold (.+)$/);
  if (match) return `发现 ${match[1]} 组近重复提示词，检测阈值 ${match[2]}`;

  match = text.match(/^Prompt file must contain at least (.+) items$/);
  if (match) return `提示词文件至少需要 ${match[1]} 条`;

  match = text.match(/^Missing required field: (.+)$/);
  if (match) return `缺少必填字段：${labelField(match[1])}`;

  match = text.match(/^Missing required prompt field: (.+)$/);
  if (match) return `提示词缺少必填字段：${labelField(match[1])}`;

  return text;
}

module.exports = {
  FIELD_LABELS_ZH,
  PRESET_LABELS_ZH,
  SOURCE_LABELS_ZH,
  labelField,
  labelPreset,
  labelSource,
  formatFieldSource,
  translateValidationMessage,
};
