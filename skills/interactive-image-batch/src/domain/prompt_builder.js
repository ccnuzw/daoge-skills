const path = require('path');
const { toArray, normalizeText, inferTaskId, userFilePart } = require('../shared/workspace');
const { resolveMaterialPath } = require('./material_resolver');

function pick(list, index, fallback) {
  const items = toArray(list).filter(Boolean);
  return items.length ? items[index % items.length] : fallback;
}

function countFrom(taskSpec = {}, strategy = {}) {
  return Math.max(1, Number(taskSpec.total_count || taskSpec.totalCount || strategy.total_count || strategy.totalCount || 1) || 1);
}

function poolFromStrategy(strategy = {}, key, fallback) {
  const value = strategy[key];
  if (Array.isArray(value) && value.length) {
    return value.map((item) => (typeof item === 'string' ? item : item.name || item.title || item.id)).filter(Boolean);
  }
  return fallback;
}

function styleFamilyAt(strategy = {}, index, fallback) {
  const families = toArray(strategy.style_families);
  if (!families.length) return fallback;
  const expanded = [];
  families.forEach((item) => {
    const name = typeof item === 'string' ? item : normalizeText(item.name || item.id || item.title);
    const count = Math.max(1, Number(item.count || 1) || 1);
    for (let i = 0; i < count; i += 1) expanded.push(name);
  });
  return expanded[index % expanded.length] || fallback;
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function peopleTask(taskId, brief) {
  const text = String(brief || '').toLowerCase();
  if (/(不要人物|无人物|不出现人物|no people|without people)/.test(text)) return false;
  return ['portrait', 'studio', 'avatar-profile-pack', 'oralboard'].includes(taskId)
    || includesAny(text, ['人像', '人物', '肖像', '头像', '主持人', '主理人', '女性', '男性', '模特', '创始人', 'portrait', 'profile']);
}

function aspectHint(taskSpec = {}, brief = '') {
  const width = Number(taskSpec.width || 0);
  const height = Number(taskSpec.height || 0);
  const text = String(brief || '').toLowerCase();
  if (/(横图|banner|横版|16:9|landscape)/.test(text)) return '横图构图，主体横向展开，标题或行动区留在左右安全区域';
  if (/(竖版|短视频|海报|9:16|portrait)/.test(text)) return '竖版构图，主体纵向层级清楚，顶部或底部预留标题安全区';
  if (/(方图|九宫格|头像|1:1|square)/.test(text)) return '方图构图，中心主体稳定，边缘留安全边距，适合社媒裁切';
  if (width && height && width > height) return '横图构图，画面左右层级清楚，适合 banner、分镜板或说明图';
  if (width && height && height > width) return '竖图构图，主视觉纵向展开，适合海报、封面或详情页';
  return '方图构图，主体居中稳定，保留平台裁切安全边距';
}

function titleFromBrief(brief, index) {
  const firstClause = normalizeText(brief, '生图任务').split(/[，。；;:：]/)[0];
  const title = userFilePart(firstClause, '生图任务').replace(/_/g, '');
  return `${title.slice(0, 28)} ${String(index + 1).padStart(3, '0')}`;
}

function taskProfile(taskId, brief) {
  const person = peopleTask(taskId, brief);
  const generic = {
    purpose: '可筛选视觉产出',
    subjectLabel: '主体',
    detailLabel: person ? '人物造型' : '视觉重点',
    scenes: ['干净可控的商业场景', '有层次的品牌背景', '克制留白的展示环境'],
    details: person
      ? ['符合任务气质的服装与姿态', '清楚的人物表情和身份感', '自然可信的人物造型']
      : ['主体材质、结构和卖点清楚', '信息重点明确可读', '视觉元素服务任务目标'],
    compositions: ['主体明确、层级清楚的商业构图', '留出可放标题或说明的安全区域', '适合批量筛选的稳定构图'],
    lighting: ['干净柔和的商业光线', '主体边缘清楚的方向光', '自然但有质感的受控光线'],
    style: '清晰、克制、商业可用',
    constraints: ['不要水印', '不要乱码文字', '不要错误 logo', '不要多余变形元素'],
    negative: person
      ? 'no watermark, no unreadable text, no distorted hands, no broken anatomy, no fake logo'
      : 'no watermark, no unreadable text, no fake logo, no distorted product, no messy layout',
  };
  const profiles = {
    ecommerce: {
      purpose: '电商转化素材',
      subjectLabel: '商品主体',
      detailLabel: '卖点与材质',
      scenes: ['白底或浅色平台安全区', '干净棚拍商品展示台', '轻生活化但不抢主体的使用场景'],
      details: ['商品轮廓完整，材质和口味/功能卖点清楚', '平台安全区完整，适合主图审核', '细节、尺寸和使用方式可读'],
      compositions: ['商品居中或三分法主图构图', '详情页纵向信息层级，卖点分区清楚', '局部特写与完整商品关系明确'],
      style: '干净、可信、转化友好',
    },
    packaging: {
      purpose: '品牌包装展示',
      subjectLabel: '包装主体',
      detailLabel: '包装形态与材质',
      scenes: ['品牌资产板式展示场景', '干净桌面或展台环境', '节日或礼赠氛围但主体清楚'],
      details: ['外盒、内盒、瓶罐或标签关系清楚', '纸张、金属、玻璃或印刷工艺可读', '套组摆放有主次'],
      compositions: ['包装套组 45 度展示角度', '正面主包装加侧面细节', '品牌板式布局，资产关系清楚'],
      style: '品牌化、材质可信、包装结构清楚',
    },
    'campaign-poster': {
      purpose: '品牌传播视觉',
      subjectLabel: '主视觉主体',
      detailLabel: person ? '人物与产品关系' : '品牌卖点',
      scenes: ['有品牌氛围的广告场景', '主视觉突出且背景有层次', '适合投放的干净商业背景'],
      details: person ? ['人物姿态、产品位置和品牌气质同屏成立', '人物不遮挡关键商品', '表情和动作服务广告主题'] : ['产品、标题区和行动区关系清楚', '品牌气质和卖点可读', '主视觉冲击力强但不杂乱'],
      compositions: ['海报层级：主视觉、标题安全区、行动区', '横图左右分区或竖版上下分区清楚', '适合投放裁切的安全边距'],
      style: '广告感、品牌化、完成度高',
    },
    'social-grid': {
      purpose: '社媒内容矩阵',
      subjectLabel: '每格主题',
      detailLabel: '内容差异',
      scenes: ['统一品牌色的社媒场景', '生活方式内容场景', '封面、细节、氛围混合布局'],
      details: ['每格内容不同但系统一致', '封面、卖点、氛围和细节互补', '适合移动端浏览'],
      compositions: ['九宫格整体统一，单格也能成立', '中心格主视觉更强，边缘格做细节延展', '社媒裁切安全边距充足'],
      style: '统一、轻内容化、适合发布',
    },
    'avatar-profile-pack': {
      purpose: '头像与 profile 资产',
      subjectLabel: '头像主体',
      detailLabel: '身份与裁切',
      scenes: ['干净背景带轻微深度', '圆形裁切友好的中心构图', '个人品牌化头像背景'],
      details: ['脸部识别清楚，身份气质明确', '适合圆形和方形裁切', '背景不抢人物'],
      compositions: ['头肩范围稳定，边缘留安全边距', '中心构图，头像缩小时仍可读', '多张保持身份一致但表情略有差异'],
      style: '可信、清楚、有识别度',
    },
    cinematic: {
      purpose: '叙事分镜',
      subjectLabel: '镜头画面',
      detailLabel: '镜头节奏',
      scenes: ['连续镜头叙事场景', '广告短片关键画面', '动作和环境关系明确的镜头'],
      details: ['每条体现不同镜头段落', '角色或产品连续性清楚', '动作、情绪和时间推进可读'],
      compositions: ['分镜画幅，镜头编号感清楚但不生成可读文字', '远景、中景、特写有变化', '横版整板或单镜头构图稳定'],
      style: '电影感、连续性强、节奏明确',
    },
    oralboard: {
      purpose: '口播分镜板',
      subjectLabel: '讲述画面',
      detailLabel: '主持人与信息关系',
      scenes: ['演播厅或专业讲解场景', '主持人加辅助图形区域', '横版整板内容提案场景'],
      details: ['主持人、主题信息和画面节奏清楚', '三段内容有开场、解释、总结层次', '信息区留白，不生成可读小字'],
      compositions: ['横版整板，主持人区和信息区分明', '镜头段落节奏清楚', '适合内容提案查看'],
      style: '专业、清楚、内容可信',
    },
    'technical-diagram': {
      purpose: '技术说明图',
      subjectLabel: '系统对象',
      detailLabel: '节点与连线',
      scenes: ['干净白底或浅灰技术画布', '工程文档风格图解画面', '分层结构清楚的说明图'],
      details: ['节点、方向、层级和依赖关系清楚', '箭头语义明确，避免装饰干扰', '留出后期加文字标签的位置'],
      compositions: ['左到右或上到下流程结构', '核心节点居中，外围节点分组', '连线不交叉或少交叉'],
      style: '清晰、工程化、可读性优先',
      negative: 'no watermark, no unreadable text, no fake logo, no tangled arrows, no decorative clutter',
    },
    'infographic-board': {
      purpose: '信息图说明',
      subjectLabel: '信息主题',
      detailLabel: '信息层级',
      scenes: ['干净信息图画布', '移动端可读的图文分区', '品牌化知识说明场景'],
      details: ['比较维度、步骤或数据重点清楚', '阅读路径明确，从标题区到核心信息', '图标和图形辅助理解'],
      compositions: ['纵向信息层级或 bento 分区', '对比列清楚，留出文字替换区域', '重要信息视觉权重更高'],
      style: '清楚、轻量、信息密度适中',
    },
    'map-route-board': {
      purpose: '地图路线视觉',
      subjectLabel: '路线与地点',
      detailLabel: '地图逻辑',
      scenes: ['城市导览地图画布', '旅行路线插画地图', '地点标记清楚的路线图'],
      details: ['地点、路线颜色和日程关系清楚', '地标有差异化图标', '标注密度适中'],
      compositions: ['路线从起点到终点顺畅', '地图留白平衡，标记不拥挤', '横版路线总览可读'],
      style: '导览友好、清楚、有地域感',
    },
    'ui-mockup-board': {
      purpose: '界面视觉稿',
      subjectLabel: '界面主体',
      detailLabel: '组件层级',
      scenes: ['真实设备界面展示', '产品界面案例板', '干净背景上的界面 mockup'],
      details: ['关键组件、导航、卡片和数据层级真实', '界面状态可信，不像装饰海报', '留出可替换文案区域'],
      compositions: ['设备画面完整，主模块优先', '页面层级从导航到内容清楚', '移动端或桌面端比例匹配'],
      style: '现代、真实、产品可用',
    },
    'academic-figure-board': {
      purpose: '学术图说明',
      subjectLabel: '研究主题',
      detailLabel: '机制与阶段',
      scenes: ['科研图形摘要画布', '论文配图风格说明图', '干净分区的机制图'],
      details: ['材料、细胞、过程或实验阶段关系清楚', '箭头和分区帮助解释机制', '标注位置留白充足'],
      compositions: ['从材料到作用机制再到结果的阅读路径', '多阶段分区清楚', '适合后期加注释'],
      style: '严谨、清楚、科研出版感',
    },
    'type-layout-poster': {
      purpose: '文字排版海报',
      subjectLabel: '排版主题',
      detailLabel: '标题与图像关系',
      scenes: ['强标题区海报画面', '图像和文字区域平衡的版式', '城市或活动氛围背景'],
      details: ['大标题区、副标题区和图像节奏清楚', '文字区域只留空间，不生成乱码文字', '中英文层级关系明确'],
      compositions: ['标题占主导或图文平衡构图', '视觉节奏强，安全边距充足', '竖版海报层级清楚'],
      style: '排版感、节奏明确、可后期落字',
    },
    'image-edit': {
      purpose: '参考图编辑',
      subjectLabel: '保留主体',
      detailLabel: '修改范围',
      scenes: ['与原图透视一致的新环境', '光线匹配的替换背景', '保留主体结构的风格迁移画面'],
      details: ['保留指定主体、姿势、轮廓或构图', '只改变 brief 中要求改变的区域', '新旧光线、色温和阴影一致'],
      compositions: ['沿用原图构图，不随意裁切', '修改区域自然融入', '边缘过渡干净'],
      style: '一致、自然、可交付',
      negative: 'no watermark, no unreadable text, no identity drift, no broken edges, no inconsistent lighting',
    },
  };
  return { ...generic, ...(profiles[taskId] || {}) };
}

function normalizeSourceList(value, baseDir) {
  return toArray(value)
    .map((item) => (typeof item === 'string' ? item : item.path || item.file || item.source))
    .filter(Boolean)
    .map((item) => resolveMaterialPath(item, baseDir));
}

function buildGeneratedPrompts({ taskSpec = {}, promptStrategy = {}, taskSpecFile = null } = {}) {
  const taskBaseDir = taskSpecFile ? path.dirname(path.resolve(taskSpecFile)) : process.cwd();
  const total = countFrom(taskSpec, promptStrategy);
  const taskId = inferTaskId({
    contentBrief: taskSpec.content_brief,
    outputMode: taskSpec.output_mode,
    intent: taskSpec.intent,
  });
  const brief = normalizeText(taskSpec.content_brief || promptStrategy.content_brief, '生图任务');
  const profile = taskProfile(taskId, brief);
  const rawOutputMode = normalizeText(taskSpec.output_mode || promptStrategy.output_mode, 'photoreal image');
  const outputMode = rawOutputMode === 'image batch' ? `一组${profile.purpose}` : rawOutputMode;
  const textPolicy = normalizeText(taskSpec.text_policy || promptStrategy.text_policy, '预留后期文字和标题安全区，不直接生成可读小字');
  const negative = normalizeText(promptStrategy.negative_policy || taskSpec.negative_prompt, profile.negative);
  const styleRequirements = toArray(taskSpec.style_requirements).join(', ');
  const variationRequirements = toArray(taskSpec.variation_requirements || promptStrategy.variation_requirements);
  const scenes = poolFromStrategy(promptStrategy, 'scene_pool', profile.scenes);
  const visualDetails = poolFromStrategy(promptStrategy, 'detail_pool', poolFromStrategy(promptStrategy, 'wardrobe_pool', profile.details));
  const compositions = poolFromStrategy(promptStrategy, 'composition_pool', profile.compositions);
  const lightingPool = poolFromStrategy(promptStrategy, 'lighting_pool', profile.lighting);
  const references = normalizeSourceList(taskSpec.reference_images || taskSpec.references, taskBaseDir);
  const masks = normalizeSourceList(taskSpec.masks || taskSpec.mask_images, taskBaseDir);
  const aspect = aspectHint(taskSpec, brief);
  const person = peopleTask(taskId, brief);

  return Array.from({ length: total }, (_, index) => {
    const ordinal = index + 1;
    const scene = pick(scenes, index, 'clean studio scene');
    const visualDetail = pick(visualDetails, index, profile.details[0]);
    const composition = pick(compositions, index, 'vertical poster composition');
    const lighting = pick(lightingPool, index, 'soft premium light');
    const styleFamily = styleFamilyAt(promptStrategy, index, profile.style);
    const variation = pick(variationRequirements, index, '');
    const promptParts = [
      `输出类型: ${outputMode}`,
      `用途: ${profile.purpose}`,
      `${profile.subjectLabel}: ${brief}`,
      `场景: ${scene}`,
      `${profile.detailLabel}: ${visualDetail}`,
      `光线: ${lighting}`,
      `构图: ${composition}; ${aspect}`,
      `风格: ${styleFamily}; ${profile.style}`,
      styleRequirements ? `风格要求: ${styleRequirements}` : '',
      variation ? `本条差异点: ${variation}` : '',
      `文字策略: ${textPolicy}`,
      `约束: ${profile.constraints.join('; ')}`,
      '成片要求: 主体清楚、层级明确、细节可信、可直接进入商业筛选',
    ].filter(Boolean);
    const item = {
      index: ordinal,
      slug: `${taskId}-${String(ordinal).padStart(3, '0')}`,
      title: titleFromBrief(brief, index),
      style_family: styleFamily,
      scene,
      lighting,
      mood: normalizeText(taskSpec.mood || promptStrategy.mood, 'clean, controlled, polished'),
      composition,
      text_policy: textPolicy,
      negative_prompt: negative,
      generation_prompt: promptParts.join(', '),
      source_refs: toArray(taskSpec.source_files).map((source) => (typeof source === 'string' ? source : source.path || source.file)).filter(Boolean),
    };
    if (person) item.wardrobe = visualDetail;
    if (!person) item.visual_focus = visualDetail;
    if (references.length) item.reference_images = references;
    if (masks.length) item.mask_image = masks[index % masks.length];
    if (item.mask_image && references.length) item.reference_mode = 'masked-edit';
    if (!item.mask_image && references.length) item.reference_mode = 'reference-assisted';
    return item;
  });
}

module.exports = { buildGeneratedPrompts };
