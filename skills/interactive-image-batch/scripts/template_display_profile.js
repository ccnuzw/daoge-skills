function normalizeValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) {
    const list = value.map((item) => String(item || '').trim()).filter(Boolean);
    return list.length ? list.join(', ') : null;
  }
  const text = String(value).trim();
  return text || null;
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = normalizeValue(item[key]);
    const label = value || '未指定';
    counts[label] = (counts[label] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function pickTemplateId(prompts) {
  const first = Array.isArray(prompts) ? prompts.find(Boolean) : null;
  return String(first?.daoge_template_id || '').trim();
}

function pickTemplateCategory(prompts) {
  const first = Array.isArray(prompts) ? prompts.find(Boolean) : null;
  return String(first?.template_category || '').trim();
}

function resolveProfile(prompts) {
  const templateId = pickTemplateId(prompts);
  const category = pickTemplateCategory(prompts);

  const base = {
    templateId,
    category,
    heroSummary: '让你先确认风格、场景和构图分布，再决定是否继续进入预检或重新改 Prompt。',
    firstLookCopy: '先看这轮 Prompt 的主风格、主场景和构图分布，再看批次计划，最后抽查样例 Prompt。如果这里就发现方向不对，不要直接进入执行阶段。',
    distributionOverviewCopy: '这一页只放最值得先看的几个维度，帮助你快速判断这轮 Prompt 有没有风格过于单一、场景过于集中或者构图重复的问题。',
    currentAdvice: [
      '先确认风格分布和场景分布是否符合任务预期。',
      '再看批次计划，判断这轮是小样本还是大规模正式执行。',
      '最后抽查样例 Prompt，确认没有明显重复或跑偏。',
    ],
    summaryFields: [
      { key: 'scene', label: '主场景' },
      { key: 'wardrobe', label: '主服装' },
      { key: 'composition', label: '主构图' },
    ],
    distributionFields: [
      { key: 'style_family', label: '风格族', shortLabel: 'Style 分布' },
      { key: 'scene', label: '场景', shortLabel: 'Scene 分布' },
      { key: 'wardrobe', label: '服装', shortLabel: 'Wardrobe 分布' },
      { key: 'composition', label: '构图', shortLabel: 'Composition 分布' },
    ],
    sampleFields: [
      { key: 'style_family', label: 'Style' },
      { key: 'scene', label: 'Scene' },
      { key: 'wardrobe', label: 'Wardrobe' },
      { key: 'composition', label: 'Composition' },
    ],
  };

  if (templateId === 'academic-figure-board' || category === 'academic-figures') {
    return {
      ...base,
      heroSummary: '让你先确认风格、图类型、比较模式和版面结构分布，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主风格、主图类型和版面结构分布，再看批次计划，最后抽查样例 Prompt。如果摘要里的图类型或比较模式已经偏离论文目标，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示学术图最关键的几个维度，帮助你快速判断图类型、比较模式、注释密度和版面结构是否与任务一致。',
      currentAdvice: [
        '先确认图类型和比较模式是否符合论文或汇报目标。',
        '再看注释密度和版面结构，避免信息过载或证据层级不清。',
        '最后抽查样例 Prompt，确认术语、标注与叙事顺序一致。',
      ],
      summaryFields: [
        { key: 'figure_type', label: '主图类型' },
        { key: 'comparison_mode', label: '主比较模式' },
        { key: 'composition', label: '主版面结构' },
      ],
      distributionFields: [
        { key: 'style_family', label: '风格族', shortLabel: 'Style 分布' },
        { key: 'figure_type', label: '图类型', shortLabel: '图类型分布' },
        { key: 'comparison_mode', label: '比较模式', shortLabel: '比较模式分布' },
        { key: 'composition', label: '版面结构', shortLabel: '版面结构分布' },
      ],
      sampleFields: [
        { key: 'style_family', label: 'Style' },
        { key: 'figure_type', label: '图类型' },
        { key: 'comparison_mode', label: '比较模式' },
        { key: 'annotation_density', label: '注释密度' },
        { key: 'composition', label: '版面结构' },
      ],
    };
  }

  if (templateId === 'technical-diagram' || category === 'technical-diagrams') {
    return {
      ...base,
      heroSummary: '让你先确认风格、图解类型、表达目标和结构布局分布，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主风格、主图解类型和表达目标分布，再看批次计划，最后抽查样例 Prompt。如果摘要里的图解层级或表达目标已经偏离工程任务，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示技术图任务最关键的几个维度，帮助你快速判断图解类型、表达目标、图例策略和结构布局是否符合系统说明需求。',
      currentAdvice: [
        '先确认图解类型和表达目标是否符合当前技术说明任务。',
        '再看图例策略和结构布局，避免节点层级和关系语义混乱。',
        '最后抽查样例 Prompt，确认模块分组、箭头语义和术语边界一致。',
      ],
      summaryFields: [
        { key: 'diagram_type', label: '主图解类型' },
        { key: 'diagram_goal', label: '主表达目标' },
        { key: 'composition', label: '主结构布局' },
      ],
      distributionFields: [
        { key: 'style_family', label: '风格族', shortLabel: 'Style 分布' },
        { key: 'diagram_type', label: '图解类型', shortLabel: '图解类型分布' },
        { key: 'diagram_goal', label: '表达目标', shortLabel: '表达目标分布' },
        { key: 'composition', label: '结构布局', shortLabel: '结构布局分布' },
      ],
      sampleFields: [
        { key: 'style_family', label: 'Style' },
        { key: 'diagram_type', label: '图解类型' },
        { key: 'diagram_goal', label: '表达目标' },
        { key: 'legend_label_policy', label: '图例策略' },
        { key: 'composition', label: '结构布局' },
      ],
    };
  }

  if (templateId === 'ecommerce-clean') {
    return {
      ...base,
      heroSummary: '让你先确认风格、商品展示目标、背景控制和商品构图分布，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主风格、主商品展示目标和背景控制分布，再看批次计划，最后抽查样例 Prompt。如果摘要里的商品可读性或背景控制已经偏离任务，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示电商纯净图任务最关键的几个维度，帮助你快速判断商品展示目标、背景控制和商品构图是否稳定可读。',
      currentAdvice: [
        '先确认商品展示目标是否符合当前电商主图任务。',
        '再看背景控制和商品构图，避免氛围或道具抢走商品主体。',
        '最后抽查样例 Prompt，确认商品结构、材质和主次关系稳定。',
      ],
      summaryFields: [
        { key: 'scene', label: '主背景控制' },
        { key: 'wardrobe', label: '主商品展示目标' },
        { key: 'composition', label: '主商品构图' },
      ],
      distributionFields: [
        { key: 'scene', label: '背景控制', shortLabel: '背景控制分布' },
        { key: 'wardrobe', label: '商品展示目标', shortLabel: '商品展示目标分布' },
        { key: 'composition', label: '商品构图', shortLabel: '商品构图分布' },
      ],
      sampleFields: [
        { key: 'scene', label: '背景控制' },
        { key: 'wardrobe', label: '商品展示目标' },
        { key: 'lighting', label: '光线控制' },
        { key: 'composition', label: '商品构图' },
      ],
    };
  }

  if (templateId === 'portrait-kv') {
    return {
      ...base,
      heroSummary: '让你先确认人物主视觉方向、镜头角色和版面留白分布，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主人物主视觉方向、镜头角色和版面留白分布，再看批次计划，最后抽查样例 Prompt。如果摘要里的镜头职责或留白方向已经偏离海报目标，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示人物主视觉最关键的几个维度，帮助你快速判断镜头角色、人物状态和版面留白是否适合海报使用。',
      currentAdvice: [
        '先确认镜头角色是否符合这轮人物主视觉任务。',
        '再看人物状态和版面留白，避免情绪强度与标题区发生冲突。',
        '最后抽查样例 Prompt，确认人物主体、镜头留白和海报气质稳定。',
      ],
      summaryFields: [
        { key: 'scene', label: '主人物镜头' },
        { key: 'mood', label: '主人物状态' },
        { key: 'composition', label: '主版面留白' },
      ],
      distributionFields: [
        { key: 'scene', label: '人物镜头', shortLabel: '人物镜头分布' },
        { key: 'mood', label: '人物状态', shortLabel: '人物状态分布' },
        { key: 'composition', label: '版面留白', shortLabel: '版面留白分布' },
      ],
      sampleFields: [
        { key: 'scene', label: '人物镜头' },
        { key: 'mood', label: '人物状态' },
        { key: 'lighting', label: '光线控制' },
        { key: 'composition', label: '版面留白' },
      ],
    };
  }

  if (templateId === 'studio-editorial') {
    return {
      ...base,
      heroSummary: '让你先确认棚拍方向、人物动作和版面结构分布，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主棚拍方向、人物动作和版面结构分布，再看批次计划，最后抽查样例 Prompt。如果摘要里的动作节奏或棚拍气质已经偏离编辑片目标，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示棚拍编辑片最关键的几个维度，帮助你快速判断人物动作、棚拍氛围和版面结构是否适合成片使用。',
      currentAdvice: [
        '先确认棚拍方向是否符合这轮人物编辑片任务。',
        '再看人物动作和版面结构，避免动作张力与画面秩序失衡。',
        '最后抽查样例 Prompt，确认人物状态、背景控制和棚拍气质稳定。',
      ],
      summaryFields: [
        { key: 'scene', label: '主棚拍方向' },
        { key: 'gesture', label: '主人物动作' },
        { key: 'composition', label: '主版面结构' },
      ],
      distributionFields: [
        { key: 'scene', label: '棚拍方向', shortLabel: '棚拍方向分布' },
        { key: 'gesture', label: '人物动作', shortLabel: '人物动作分布' },
        { key: 'lighting', label: '灯光气质', shortLabel: '灯光气质分布' },
        { key: 'composition', label: '版面结构', shortLabel: '版面结构分布' },
      ],
      sampleFields: [
        { key: 'scene', label: '棚拍方向' },
        { key: 'gesture', label: '人物动作' },
        { key: 'lighting', label: '灯光气质' },
        { key: 'composition', label: '版面结构' },
      ],
    };
  }

  if (templateId === 'ui-mockup-board' || category === 'ui-mockups') {
    return {
      ...base,
      heroSummary: '让你先确认风格、界面载体、模块重点和版面结构分布，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主风格、主界面载体和模块重点分布，再看批次计划，最后抽查样例 Prompt。如果摘要里的界面载体或转化重点已经偏离任务，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示 UI 视觉稿任务最关键的几个维度，帮助你快速判断界面载体、模块重点、阅读目标和版面结构是否适合当前产品场景。',
      currentAdvice: [
        '先确认界面载体和模块重点是否符合这轮 UI 任务目标。',
        '再看版面结构和信息主次，避免设备外框或装饰层压过界面本身。',
        '最后抽查样例 Prompt，确认标题区、CTA 区和核心模块关系稳定。',
      ],
      summaryFields: [
        { key: 'ui_surface', label: '主界面载体' },
        { key: 'module_focus', label: '主模块重点' },
        { key: 'composition', label: '主版面结构' },
      ],
      distributionFields: [
        { key: 'style_family', label: '风格族', shortLabel: 'Style 分布' },
        { key: 'ui_surface', label: '界面载体', shortLabel: '界面载体分布' },
        { key: 'module_focus', label: '模块重点', shortLabel: '模块重点分布' },
        { key: 'composition', label: '版面结构', shortLabel: '版面结构分布' },
      ],
      sampleFields: [
        { key: 'style_family', label: 'Style' },
        { key: 'ui_surface', label: '界面载体' },
        { key: 'module_focus', label: '模块重点' },
        { key: 'information_goal', label: '信息目标' },
        { key: 'composition', label: '版面结构' },
      ],
    };
  }

  if (templateId === 'image-edit') {
    return {
      ...base,
      heroSummary: '让你先确认风格、编辑目标、修改边界和保留结构分布，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主风格、主编辑目标和修改边界分布，再看批次计划，最后抽查样例 Prompt。如果摘要里的保留范围或修改边界已经不清晰，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示图像编辑任务最关键的几个维度，帮助你快速判断编辑目标、修改边界、保留规则和结果结构是否符合编辑任务。',
      currentAdvice: [
        '先确认编辑目标和修改边界是否符合当前改图任务。',
        '再看保留范围和结果结构，避免局部编辑越界或整体重绘过多。',
        '最后抽查样例 Prompt，确认保留主体、修改区域和结果风格一致。',
      ],
      summaryFields: [
        { key: 'scene', label: '主编辑目标' },
        { key: 'wardrobe', label: '主保留范围' },
        { key: 'composition', label: '主结果结构' },
      ],
      distributionFields: [
        { key: 'style_family', label: '风格族', shortLabel: 'Style 分布' },
        { key: 'scene', label: '编辑目标', shortLabel: '编辑目标分布' },
        { key: 'wardrobe', label: '保留范围', shortLabel: '保留范围分布' },
        { key: 'composition', label: '结果结构', shortLabel: '结果结构分布' },
      ],
      sampleFields: [
        { key: 'style_family', label: 'Style' },
        { key: 'scene', label: '编辑目标' },
        { key: 'wardrobe', label: '保留范围' },
        { key: 'change_boundary', label: '修改边界' },
        { key: 'composition', label: '结果结构' },
      ],
    };
  }

  if (templateId === 'infographic-board' || category === 'infographics') {
    return {
      ...base,
      heroSummary: '让你先确认风格、信息层级、信息目标和版面结构分布，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主风格、主信息层级和信息目标分布，再看批次计划，最后抽查样例 Prompt。如果摘要里的阅读顺序或信息目标已经偏离内容任务，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示信息图任务最关键的几个维度，帮助你快速判断信息层级、信息目标、阅读顺序和版面结构是否清晰可读。',
      currentAdvice: [
        '先确认信息层级和信息目标是否符合这轮传播重点。',
        '再看阅读顺序和版面结构，避免指标卡、结论区和图例关系混乱。',
        '最后抽查样例 Prompt，确认结论区和数据区主次分明。',
      ],
      summaryFields: [
        { key: 'information_hierarchy', label: '主信息层级' },
        { key: 'information_goal', label: '主信息目标' },
        { key: 'composition', label: '主版面结构' },
      ],
      distributionFields: [
        { key: 'style_family', label: '风格族', shortLabel: 'Style 分布' },
        { key: 'information_hierarchy', label: '信息层级', shortLabel: '信息层级分布' },
        { key: 'information_goal', label: '信息目标', shortLabel: '信息目标分布' },
        { key: 'composition', label: '版面结构', shortLabel: '版面结构分布' },
      ],
      sampleFields: [
        { key: 'style_family', label: 'Style' },
        { key: 'information_hierarchy', label: '信息层级' },
        { key: 'information_goal', label: '信息目标' },
        { key: 'reading_path', label: '阅读顺序' },
        { key: 'composition', label: '版面结构' },
      ],
    };
  }

  if (templateId === 'social-grid') {
    return {
      ...base,
      heroSummary: '让你先确认风格、宫格角色、内容节奏和裁切结构分布，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主风格、主宫格角色和内容节奏分布，再看批次计划，最后抽查样例 Prompt。如果摘要里的封面/内页角色已经混乱，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示社媒九宫格任务最关键的几个维度，帮助你快速判断宫格角色、内容节奏和裁切结构是否适合 feed 系统使用。',
      currentAdvice: [
        '先确认宫格角色是否符合当前 feed 组合目标。',
        '再看内容节奏和裁切结构，避免封面、细节、氛围图角色失衡。',
        '最后抽查样例 Prompt，确认色彩统一、角色分工和裁切安全区稳定。',
      ],
      summaryFields: [
        { key: 'grid_role', label: '主宫格角色' },
        { key: 'scene', label: '主内容节奏' },
        { key: 'composition', label: '主裁切结构' },
      ],
      distributionFields: [
        { key: 'style_family', label: '风格族', shortLabel: 'Style 分布' },
        { key: 'grid_role', label: '宫格角色', shortLabel: '宫格角色分布' },
        { key: 'scene', label: '内容节奏', shortLabel: '内容节奏分布' },
        { key: 'composition', label: '裁切结构', shortLabel: '裁切结构分布' },
      ],
      sampleFields: [
        { key: 'style_family', label: 'Style' },
        { key: 'grid_role', label: '宫格角色' },
        { key: 'scene', label: '内容节奏' },
        { key: 'text_policy', label: '文案留位' },
        { key: 'composition', label: '裁切结构' },
      ],
    };
  }

  if (templateId === 'avatar-profile-pack' || category === 'avatars-and-profile') {
    return {
      ...base,
      heroSummary: '让你先确认风格、资产用途、裁切策略和头像结构分布，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主风格、主资产用途和裁切策略分布，再看批次计划，最后抽查样例 Prompt。如果摘要里的头像用途或裁切安全区已经偏离目标，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示头像资产任务最关键的几个维度，帮助你快速判断资产用途、裁切策略、背景控制和头像结构是否适合小尺寸使用。',
      currentAdvice: [
        '先确认资产用途和裁切策略是否符合这轮头像任务目标。',
        '再看头像结构和背景控制，避免主体比例和缩略图可读性失衡。',
        '最后抽查样例 Prompt，确认 identity 一致、状态变化清晰、轮廓稳定。',
      ],
      summaryFields: [
        { key: 'asset_usage', label: '主资产用途' },
        { key: 'crop_scale', label: '主裁切策略' },
        { key: 'composition', label: '主头像结构' },
      ],
      distributionFields: [
        { key: 'style_family', label: '风格族', shortLabel: 'Style 分布' },
        { key: 'asset_usage', label: '资产用途', shortLabel: '资产用途分布' },
        { key: 'crop_scale', label: '裁切策略', shortLabel: '裁切策略分布' },
        { key: 'composition', label: '头像结构', shortLabel: '头像结构分布' },
      ],
      sampleFields: [
        { key: 'style_family', label: 'Style' },
        { key: 'asset_usage', label: '资产用途' },
        { key: 'crop_scale', label: '裁切策略' },
        { key: 'background_depth', label: '背景控制' },
        { key: 'composition', label: '头像结构' },
      ],
    };
  }

  if (templateId === 'cinematic-storyboard' || category === 'cinematic-sequences') {
    return {
      ...base,
      heroSummary: '让你先确认镜头推进、画面节奏和关键分镜角色分布，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主镜头类型、主叙事节点和画面节奏分布，再看批次计划，最后抽查样例 Prompt。如果这里已经看出分镜推进不顺，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示分镜任务最关键的几个维度，帮助你快速判断镜头推进、叙事节点和画面节奏是否符合当前故事任务。',
      currentAdvice: [
        '先确认镜头推进和叙事节点是否符合当前分镜任务。',
        '再看画面节奏和分镜角色，避免整组图都像同一镜头重复。',
        '最后抽查样例 Prompt，确认开场、推进、高潮和收尾职责清楚。',
      ],
      summaryFields: [
        { key: 'scene', label: '主镜头场景' },
        { key: 'story_beat', label: '主叙事节点' },
        { key: 'composition', label: '主画面结构' },
      ],
      distributionFields: [
        { key: 'scene', label: '镜头场景', shortLabel: '镜头场景分布' },
        { key: 'story_beat', label: '叙事节点', shortLabel: '叙事节点分布' },
        { key: 'camera_language', label: '镜头语言', shortLabel: '镜头语言分布' },
        { key: 'composition', label: '画面结构', shortLabel: '画面结构分布' },
      ],
      sampleFields: [
        { key: 'scene', label: '镜头场景' },
        { key: 'story_beat', label: '叙事节点' },
        { key: 'camera_language', label: '镜头语言' },
        { key: 'composition', label: '画面结构' },
      ],
    };
  }

  if (templateId === 'oral-storyboard-board') {
    return {
      ...base,
      heroSummary: '让你先确认口播推进、信息区结构和收尾镜头节奏，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主讲解场景、主口播节点和整板结构分布，再看批次计划，最后抽查样例 Prompt。如果这里已经看出口播推进或信息层不对，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示口播分镜整板最关键的几个维度，帮助你快速判断讲解节奏、信息区分工和收尾结构是否符合整板任务。',
      currentAdvice: [
        '先确认讲解推进是否符合这轮口播整板目标。',
        '再看信息区结构和镜头分工，避免每格都在重复同一种讲解动作。',
        '最后抽查样例 Prompt，确认开场钩子、讲解展开和收尾结论职责清楚。',
      ],
      summaryFields: [
        { key: 'scene', label: '主讲解场景' },
        { key: 'story_beat', label: '主口播节点' },
        { key: 'composition', label: '主整板结构' },
      ],
      distributionFields: [
        { key: 'scene', label: '讲解场景', shortLabel: '讲解场景分布' },
        { key: 'story_beat', label: '口播节点', shortLabel: '口播节点分布' },
        { key: 'slot_role', label: '分镜角色', shortLabel: '分镜角色分布' },
        { key: 'composition', label: '整板结构', shortLabel: '整板结构分布' },
      ],
      sampleFields: [
        { key: 'scene', label: '讲解场景' },
        { key: 'story_beat', label: '口播节点' },
        { key: 'slot_role', label: '分镜角色' },
        { key: 'composition', label: '整板结构' },
      ],
    };
  }

  if (templateId === 'ab-ad-test') {
    return {
      ...base,
      heroSummary: '让你先确认风格、测试假设、控制变量和投放结构分布，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主风格、主测试假设和控制变量分布，再看批次计划，最后抽查样例 Prompt。如果摘要里的测试变量已经漂移，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示广告 A/B 测试任务最关键的几个维度，帮助你快速判断测试假设、控制变量和投放结构是否支持后续复盘。',
      currentAdvice: [
        '先确认测试假设是否符合当前投放验证目标。',
        '再看控制变量和投放结构，避免多变量同时变化导致无法分析。',
        '最后抽查样例 Prompt，确认假设命名、结构留白和卖点表达一致。',
      ],
      summaryFields: [
        { key: 'ad_test_hypothesis', label: '主测试假设' },
        { key: 'scene', label: '主控制变量' },
        { key: 'composition', label: '主投放结构' },
      ],
      distributionFields: [
        { key: 'style_family', label: '风格族', shortLabel: 'Style 分布' },
        { key: 'ad_test_hypothesis', label: '测试假设', shortLabel: '测试假设分布' },
        { key: 'scene', label: '控制变量', shortLabel: '控制变量分布' },
        { key: 'composition', label: '投放结构', shortLabel: '投放结构分布' },
      ],
      sampleFields: [
        { key: 'style_family', label: 'Style' },
        { key: 'ad_test_hypothesis', label: '测试假设' },
        { key: 'scene', label: '控制变量' },
        { key: 'text_policy', label: 'CTA 留位' },
        { key: 'composition', label: '投放结构' },
      ],
    };
  }

  if (templateId === 'map-route-board' || category === 'maps') {
    return {
      ...base,
      heroSummary: '让你先确认风格、地图类型、路线逻辑和导览结构分布，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主风格、主地图类型和路线逻辑分布，再看批次计划，最后抽查样例 Prompt。如果摘要里的路线结构或标签密度已经跑偏，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示地图路线任务最关键的几个维度，帮助你快速判断地图类型、路线逻辑、标签密度和导览结构是否清晰。',
      currentAdvice: [
        '先确认地图类型和路线逻辑是否符合当前导览任务。',
        '再看标签密度和导览结构，避免图面拥挤或路径不清。',
        '最后抽查样例 Prompt，确认地标、图例和路线主次分明。',
      ],
      summaryFields: [
        { key: 'map_type', label: '主地图类型' },
        { key: 'route_logic', label: '主路线逻辑' },
        { key: 'composition', label: '主导览结构' },
      ],
      distributionFields: [
        { key: 'style_family', label: '风格族', shortLabel: 'Style 分布' },
        { key: 'map_type', label: '地图类型', shortLabel: '地图类型分布' },
        { key: 'route_logic', label: '路线逻辑', shortLabel: '路线逻辑分布' },
        { key: 'composition', label: '导览结构', shortLabel: '导览结构分布' },
      ],
      sampleFields: [
        { key: 'style_family', label: 'Style' },
        { key: 'map_type', label: '地图类型' },
        { key: 'route_logic', label: '路线逻辑' },
        { key: 'label_density', label: '标签密度' },
        { key: 'composition', label: '导览结构' },
      ],
    };
  }

  if (templateId === 'detail-page-set') {
    return {
      ...base,
      heroSummary: '让你先确认风格、详情页角色、卖点拆解和页面结构分布，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主风格、主详情页角色和卖点拆解分布，再看批次计划，最后抽查样例 Prompt。如果摘要里的主图/细节图角色已经混乱，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示详情页组图任务最关键的几个维度，帮助你快速判断详情页角色、卖点拆解和页面结构是否适合后续版式编排。',
      currentAdvice: [
        '先确认详情页角色是否符合这轮组图拆解目标。',
        '再看卖点拆解和页面结构，避免所有图都长成同一种主图。',
        '最后抽查样例 Prompt，确认材质特写、主图和场景图职责清楚。',
      ],
      summaryFields: [
        { key: 'detail_page_role', label: '主详情页角色' },
        { key: 'scene', label: '主卖点拆解' },
        { key: 'composition', label: '主页面结构' },
      ],
      distributionFields: [
        { key: 'style_family', label: '风格族', shortLabel: 'Style 分布' },
        { key: 'detail_page_role', label: '详情页角色', shortLabel: '详情页角色分布' },
        { key: 'scene', label: '卖点拆解', shortLabel: '卖点拆解分布' },
        { key: 'composition', label: '页面结构', shortLabel: '页面结构分布' },
      ],
      sampleFields: [
        { key: 'style_family', label: 'Style' },
        { key: 'detail_page_role', label: '详情页角色' },
        { key: 'scene', label: '卖点拆解' },
        { key: 'text_policy', label: '标注留位' },
        { key: 'composition', label: '页面结构' },
      ],
    };
  }

  if (templateId === 'brand-packaging-board' || category === 'branding-and-packaging') {
    return {
      ...base,
      heroSummary: '让你先确认风格、包装形态、品牌资产范围和展示结构分布，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主风格、主包装形态和品牌资产范围分布，再看批次计划，最后抽查样例 Prompt。如果摘要里的包装类型或品牌系统边界已经偏离目标，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示品牌包装任务最关键的几个维度，帮助你快速判断包装形态、品牌资产范围、材质信号和展示结构是否符合品牌系统目标。',
      currentAdvice: [
        '先确认包装形态和品牌资产范围是否符合这轮品牌系统任务。',
        '再看材质信号和展示结构，避免品牌层级和包装材质表达失焦。',
        '最后抽查样例 Prompt，确认品牌色、标签系统和包装阵列关系稳定。',
      ],
      summaryFields: [
        { key: 'packaging_format', label: '主包装形态' },
        { key: 'brand_asset_scope', label: '主品牌资产范围' },
        { key: 'composition', label: '主展示结构' },
      ],
      distributionFields: [
        { key: 'style_family', label: '风格族', shortLabel: 'Style 分布' },
        { key: 'packaging_format', label: '包装形态', shortLabel: '包装形态分布' },
        { key: 'brand_asset_scope', label: '品牌资产范围', shortLabel: '品牌资产范围分布' },
        { key: 'composition', label: '展示结构', shortLabel: '展示结构分布' },
      ],
      sampleFields: [
        { key: 'style_family', label: 'Style' },
        { key: 'packaging_format', label: '包装形态' },
        { key: 'brand_asset_scope', label: '品牌资产范围' },
        { key: 'material_signal', label: '材质信号' },
        { key: 'composition', label: '展示结构' },
      ],
    };
  }

  if (templateId === 'visual-doc-slide' || category === 'slides-and-visual-docs') {
    return {
      ...base,
      heroSummary: '让你先确认风格、页面角色、版区结构和版面节奏分布，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主风格、主页面角色和版区结构分布，再看批次计划，最后抽查样例 Prompt。如果摘要里的汇报页角色或阅读节奏已经偏离目标，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示视觉报告页任务最关键的几个维度，帮助你快速判断页面角色、版区结构、叙事流向和版面节奏是否适合汇报使用。',
      currentAdvice: [
        '先确认页面角色和版区结构是否符合当前汇报场景。',
        '再看叙事流向和版面节奏，避免标题区、正文区和图像区互相抢占。',
        '最后抽查样例 Prompt，确认结论区和视觉区的主次关系稳定。',
      ],
      summaryFields: [
        { key: 'page_role', label: '主页面角色' },
        { key: 'layout_zones', label: '主版区结构' },
        { key: 'composition', label: '主版面节奏' },
      ],
      distributionFields: [
        { key: 'style_family', label: '风格族', shortLabel: 'Style 分布' },
        { key: 'page_role', label: '页面角色', shortLabel: '页面角色分布' },
        { key: 'layout_zones', label: '版区结构', shortLabel: '版区结构分布' },
        { key: 'composition', label: '版面节奏', shortLabel: '版面节奏分布' },
      ],
      sampleFields: [
        { key: 'style_family', label: 'Style' },
        { key: 'page_role', label: '页面角色' },
        { key: 'layout_zones', label: '版区结构' },
        { key: 'story_flow', label: '叙事流向' },
        { key: 'composition', label: '版面节奏' },
      ],
    };
  }

  if (templateId === 'type-layout-poster' || category === 'typography-and-text-layout') {
    return {
      ...base,
      heroSummary: '让你先确认风格、标题角色、语言模式和版面结构分布，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主风格、主标题角色和语言模式分布，再看批次计划，最后抽查样例 Prompt。如果摘要里的版式重点或双语策略已经偏离目标，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示排版海报任务最关键的几个维度，帮助你快速判断标题角色、语言模式、版面结构和文字主导强度是否合理。',
      currentAdvice: [
        '先确认标题角色和语言模式是否符合传播目标。',
        '再看版面结构和文字主导强度，避免可读性和张力失衡。',
        '最后抽查样例 Prompt，确认标题安全区和版式节奏都在线。',
      ],
      summaryFields: [
        { key: 'headline_role', label: '主标题角色' },
        { key: 'language_mode', label: '主语言模式' },
        { key: 'composition', label: '主版面结构' },
      ],
      distributionFields: [
        { key: 'style_family', label: '风格族', shortLabel: 'Style 分布' },
        { key: 'headline_role', label: '标题角色', shortLabel: '标题角色分布' },
        { key: 'language_mode', label: '语言模式', shortLabel: '语言模式分布' },
        { key: 'composition', label: '版面结构', shortLabel: '版面结构分布' },
      ],
      sampleFields: [
        { key: 'style_family', label: 'Style' },
        { key: 'headline_role', label: '标题角色' },
        { key: 'language_mode', label: '语言模式' },
        { key: 'type_dominance', label: '文字主导' },
        { key: 'composition', label: '版面结构' },
      ],
    };
  }

  if (templateId === 'asset-prop-sheet' || category === 'assets-and-props') {
    return {
      ...base,
      heroSummary: '让你先确认风格、资产角色、表面风格和展示结构分布，再决定是否继续进入预检或重新改 Prompt。',
      firstLookCopy: '先看这轮 Prompt 的主风格、主资产角色和展示结构分布，再看批次计划，最后抽查样例 Prompt。如果摘要里的资产类型或表面风格已经不对，不要直接进入执行阶段。',
      distributionOverviewCopy: '这一页优先展示资产道具任务最关键的几个维度，帮助你快速判断资产角色、表面风格和展示方式是否与目标资产包一致。',
      currentAdvice: [
        '先确认资产角色是否符合当前资产包目标。',
        '再看表面风格和展示方式，避免材质语言和使用场景冲突。',
        '最后抽查样例 Prompt，确认资产清单、道具结构和可读性稳定。',
      ],
      summaryFields: [
        { key: 'asset_role', label: '主资产角色' },
        { key: 'surface_style', label: '主表面风格' },
        { key: 'composition', label: '主展示结构' },
      ],
      distributionFields: [
        { key: 'style_family', label: '风格族', shortLabel: 'Style 分布' },
        { key: 'asset_role', label: '资产角色', shortLabel: '资产角色分布' },
        { key: 'surface_style', label: '表面风格', shortLabel: '表面风格分布' },
        { key: 'composition', label: '展示结构', shortLabel: '展示结构分布' },
      ],
      sampleFields: [
        { key: 'style_family', label: 'Style' },
        { key: 'asset_role', label: '资产角色' },
        { key: 'surface_style', label: '表面风格' },
        { key: 'presentation_mode', label: '展示方式' },
        { key: 'composition', label: '展示结构' },
      ],
    };
  }

  return base;
}

function buildDisplayDistributions(prompts, profile) {
  return (profile.distributionFields || []).map((field) => ({
    ...field,
    counts: countBy(prompts, field.key),
  }));
}

function topLabel(entries, fallback = '未指定') {
  return entries[0]?.name || fallback;
}

module.exports = {
  normalizeValue,
  countBy,
  topLabel,
  resolveProfile,
  buildDisplayDistributions,
};
