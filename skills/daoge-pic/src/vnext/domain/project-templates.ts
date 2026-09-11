export interface ProjectTaskDefault {
  goalId: string;
  label: string;
  defaultName: string;
  defaultCount: string;
  defaultAspectRatio: string;
  roundPurpose: string;
  materialNeeds: string[];
  recommendedInputs: string[];
  quickBriefs: string[];
  defaultVariationAxes?: string[];
  defaultKeepConstraints?: string[];
  defaultRefinementGoals?: string[];
}

export interface ProjectTemplate {
  id: string;
  version: number;
  name: string;
  description: string;
  defaultName: string;
  descriptionPrompt: string;
  recommendedTasks: string[];
  aspectRatios: string[];
  referenceHint: string;
  exampleDescriptions: string[];
  taskDefaults: ProjectTaskDefault[];
}

const PROJECT_TEMPLATES: ReadonlyArray<ProjectTemplate> = [
  {
    id: 'brand-visual',
    version: 1,
    name: '品牌视觉探索',
    description: '适合为品牌、活动或长期主题建立视觉方向。',
    defaultName: '品牌视觉探索项目',
    descriptionPrompt: '写清品牌/活动、受众、使用场景、必须保留的品牌元素。',
    recommendedTasks: ['品牌视觉方向探索', '品牌主视觉精修', '品牌素材交付整理'],
    aspectRatios: ['1:1', '4:5', '16:9'],
    referenceHint: '可以准备 Logo、品牌色、竞品风格或历史视觉作为参考。',
    exampleDescriptions: ['为新品发布建立一组高级、清爽、有品牌识别度的主视觉方向。', '沉淀品牌长期视觉关键词，先探索 3 个不同方向再收敛。'],
    taskDefaults: [
      { goalId: 'exploration', label: '品牌方向探索', defaultName: '品牌视觉方向探索', defaultCount: '6', defaultAspectRatio: '16:9', roundPurpose: 'exploration', materialNeeds: ['Logo / 品牌字标', '品牌色或色板', '竞品或历史视觉', '使用渠道'], recommendedInputs: ['品牌定位', '目标受众', '使用渠道', '禁用元素'], quickBriefs: ['围绕品牌发布会探索 6 张 16:9 主视觉方向，要求高级、清爽、有识别度。', '基于 Logo 和品牌色探索高端、年轻化、自然感三种视觉路线。'] },
      { goalId: 'refinement', label: '主视觉精修', defaultName: '品牌主视觉精修', defaultCount: '4', defaultAspectRatio: '16:9', roundPurpose: 'refinement', materialNeeds: ['已选主视觉', '品牌包', '禁改元素'], recommendedInputs: ['精修目标', '必须保持的品牌元素', '交付用途'], quickBriefs: ['保留品牌主视觉构图，增强质感、层次和商业完成度。'], defaultRefinementGoals: ['质感', '光影', '商业感'], defaultKeepConstraints: ['Logo', '构图大方向', '色彩氛围'] },
      { goalId: 'variation', label: '渠道物料变体', defaultName: '品牌渠道物料变体', defaultCount: '6', defaultAspectRatio: '4:5', roundPurpose: 'variation', materialNeeds: ['已确认主视觉', '渠道尺寸', '品牌规范'], recommendedInputs: ['变化渠道', '保留元素', '尺寸要求'], quickBriefs: ['基于已确认主视觉，扩展 4:5 社媒物料和 1:1 封面版本。'], defaultVariationAxes: ['构图', '色彩', '商业感'], defaultKeepConstraints: ['Logo', '色彩氛围', '构图大方向'] }
    ]
  },
  {
    id: 'ecommerce-product',
    version: 1,
    name: '电商商品图',
    description: '适合商品主图、场景图、卖点图和详情页素材。',
    defaultName: '电商商品图项目',
    descriptionPrompt: '写清商品、平台规格、卖点、品牌约束和交付图类型。',
    recommendedTasks: ['商品主图探索', '商品场景图', '卖点细节图'],
    aspectRatios: ['1:1', '4:5', '3:4'],
    referenceHint: '准备商品主体图、品牌包和平台规格，有助于保持商品与 Logo 一致。',
    exampleDescriptions: ['为夏季茶饮新品制作电商主图、场景图和卖点图，突出清爽感和产品质感。', '围绕单个商品探索 1:1 主图和 4:5 详情页视觉，要求主体准确、背景高级。'],
    taskDefaults: [
      { goalId: 'exploration', label: '商品主图探索', defaultName: '商品主图探索', defaultCount: '8', defaultAspectRatio: '1:1', roundPurpose: 'exploration', materialNeeds: ['商品主体图', '品牌包 / Logo', '平台规格', '核心卖点'], recommendedInputs: ['商品卖点', '平台规格', '背景风格', '禁忌元素'], quickBriefs: ['围绕单个商品探索 8 张 1:1 主图，主体准确、背景高级、卖点清晰。', '为夏季茶饮新品探索清爽、明亮、有购买欲的电商主图方向。'] },
      { goalId: 'variation', label: '商品场景图变体', defaultName: '商品场景图变体', defaultCount: '4', defaultAspectRatio: '4:5', roundPurpose: 'variation', materialNeeds: ['商品主体图', '已选主图', '场景关键词'], recommendedInputs: ['场景方向', '变化维度', '保持不变项'], quickBriefs: ['保留商品主体和 Logo，生成 4 张 4:5 场景图，变化背景和光影。'], defaultVariationAxes: ['背景', '光影', '商业感'], defaultKeepConstraints: ['产品', 'Logo', '主体'] },
      { goalId: 'refinement', label: '商品质感精修', defaultName: '商品质感精修', defaultCount: '4', defaultAspectRatio: '1:1', roundPurpose: 'refinement', materialNeeds: ['已选商品图', '产品细节要求', '品牌约束'], recommendedInputs: ['精修目标', '不可改变的产品细节', '交付规格'], quickBriefs: ['保留商品轮廓和 Logo，增强材质、边缘清晰度和商业摄影质感。'], defaultRefinementGoals: ['清晰度', '质感', '商业感'], defaultKeepConstraints: ['产品', 'Logo', '主体'] }
    ]
  },
  {
    id: 'social-content',
    version: 1,
    name: '社媒内容图',
    description: '适合小红书封面、公众号配图和短内容封面。',
    defaultName: '社媒内容图项目',
    descriptionPrompt: '写清发布平台、主题系列、标题安全区、目标受众和视觉语气。',
    recommendedTasks: ['社媒封面探索', '系列内容变体', '发布素材整理'],
    aspectRatios: ['3:4', '4:5', '9:16'],
    referenceHint: '先确定发布平台、文字安全区和系列视觉规律。',
    exampleDescriptions: ['做一组适合小红书的新品封面，保留足够标题区，整体明亮、有点击欲。', '为 6 篇系列内容统一视觉风格，同时保留每篇主题差异。'],
    taskDefaults: [
      { goalId: 'exploration', label: '社媒封面探索', defaultName: '社媒封面探索', defaultCount: '6', defaultAspectRatio: '3:4', roundPurpose: 'exploration', materialNeeds: ['发布平台', '标题文案 / 安全区', '系列参考封面', '受众标签'], recommendedInputs: ['平台', '标题区', '主题系列', '视觉语气'], quickBriefs: ['做 6 张适合小红书的 3:4 封面，保留标题安全区，明亮、有点击欲。', '围绕新品内容探索统一系列视觉，要求每张主题不同但风格一致。'] },
      { goalId: 'variation', label: '系列封面变体', defaultName: '系列封面变体', defaultCount: '6', defaultAspectRatio: '4:5', roundPurpose: 'variation', materialNeeds: ['已选封面方向', '系列主题清单', '标题规则'], recommendedInputs: ['变化主题', '保持版式', '标题区域'], quickBriefs: ['保持封面版式和色调，为 6 篇系列内容生成不同主题变体。'], defaultVariationAxes: ['构图', '色彩', '风格'], defaultKeepConstraints: ['构图大方向', '色彩氛围'] },
      { goalId: 'refinement', label: '发布图精修', defaultName: '发布图精修', defaultCount: '4', defaultAspectRatio: '3:4', roundPurpose: 'refinement', materialNeeds: ['待发布封面', '标题安全区', '平台规范'], recommendedInputs: ['精修目标', '标题区域', '发布平台'], quickBriefs: ['保留标题安全区和版式，提高封面清晰度、对比和点击吸引力。'], defaultRefinementGoals: ['清晰度', '构图', '商业感'], defaultKeepConstraints: ['构图大方向', '色彩氛围'] }
    ]
  },
  {
    id: 'character-ip',
    version: 1,
    name: '角色 / IP 设计',
    description: '适合头像、角色设定、表情包和衍生形象。',
    defaultName: '角色 IP 设计项目',
    descriptionPrompt: '写清角色身份、固定外观、性格、禁改特征和使用场景。',
    recommendedTasks: ['角色形象探索', '角色动作变体', '表情与头像套组'],
    aspectRatios: ['1:1', '3:4', '9:16'],
    referenceHint: '准备角色主体、身份特征、服饰和不可改变的形象约束。',
    exampleDescriptions: ['设计一个亲切、机灵的猫咪 IP，先探索头像和全身设定。', '基于现有角色做表情包和动作变体，必须保持脸型、服饰和主色。'],
    taskDefaults: [
      { goalId: 'exploration', label: '角色形象探索', defaultName: '角色形象探索', defaultCount: '8', defaultAspectRatio: '1:1', roundPurpose: 'exploration', materialNeeds: ['角色设定描述', '主体参考图', '不可改变特征', '使用场景'], recommendedInputs: ['角色身份', '性格关键词', '固定外观', '禁改特征'], quickBriefs: ['设计 8 张 1:1 角色头像方向，保持亲切、机灵、可做长期 IP。', '探索角色全身设定和头像方向，明确脸型、服饰、主色和性格。'] },
      { goalId: 'variation', label: '动作 / 表情变体', defaultName: '角色动作表情变体', defaultCount: '8', defaultAspectRatio: '1:1', roundPurpose: 'variation', materialNeeds: ['已确认角色图', '动作或表情清单', '保持特征'], recommendedInputs: ['变化表情 / 动作', '必须保持特征', '使用场景'], quickBriefs: ['保持角色脸型、服饰和主色，生成 8 张不同情绪头像。'], defaultVariationAxes: ['表情', '姿势', '构图'], defaultKeepConstraints: ['人物身份', '主体', '色彩氛围'] },
      { goalId: 'refinement', label: '角色一致性精修', defaultName: '角色一致性精修', defaultCount: '4', defaultAspectRatio: '1:1', roundPurpose: 'refinement', materialNeeds: ['已选角色图', '一致性约束', '细节要求'], recommendedInputs: ['精修目标', '身份保持项', '细节要求'], quickBriefs: ['保留角色身份、脸型和服饰，提升线条、质感和头像完成度。'], defaultRefinementGoals: ['清晰度', '细节', '质感'], defaultKeepConstraints: ['人物身份', '主体', '色彩氛围'] }
    ]
  },
  {
    id: 'custom',
    version: 1,
    name: '自定义项目',
    description: '目标特殊时选择，并在说明中写清客户、产品、渠道和交付用途。',
    defaultName: '自定义创作项目',
    descriptionPrompt: '写清项目边界、已有素材、限制条件、产出规格和交付对象。',
    recommendedTasks: ['自定义创作任务'],
    aspectRatios: ['1:1', '4:5', '3:4', '16:9', '9:16'],
    referenceHint: '请在项目说明中写清输入、限制、使用渠道和交付目标。',
    exampleDescriptions: ['已有明确需求，按当前素材和交付目标建立一个独立创作项目。'],
    taskDefaults: [
      { goalId: 'custom', label: '自定义创作任务', defaultName: '自定义创作任务', defaultCount: '', defaultAspectRatio: '', roundPurpose: 'exploration', materialNeeds: ['输入素材', '限制条件', '交付用途'], recommendedInputs: ['输入素材', '限制条件', '交付用途'], quickBriefs: ['已有明确需求，请按当前素材、限制条件和交付目标建立任务。'] }
    ]
  }
];

function cloneTaskDefault(item: ProjectTaskDefault): ProjectTaskDefault {
  return { ...item, materialNeeds: [...item.materialNeeds], recommendedInputs: [...item.recommendedInputs], quickBriefs: [...item.quickBriefs], ...(item.defaultVariationAxes ? { defaultVariationAxes: [...item.defaultVariationAxes] } : {}), ...(item.defaultKeepConstraints ? { defaultKeepConstraints: [...item.defaultKeepConstraints] } : {}), ...(item.defaultRefinementGoals ? { defaultRefinementGoals: [...item.defaultRefinementGoals] } : {}) };
}

function cloneTemplate(template: ProjectTemplate): ProjectTemplate {
  return { ...template, recommendedTasks: [...template.recommendedTasks], aspectRatios: [...template.aspectRatios], exampleDescriptions: [...template.exampleDescriptions], taskDefaults: template.taskDefaults.map(cloneTaskDefault) };
}

export function listProjectTemplates(): ProjectTemplate[] {
  return PROJECT_TEMPLATES.map(cloneTemplate);
}

export function isProjectTemplateId(value: unknown): value is string {
  return typeof value === 'string' && PROJECT_TEMPLATES.some((template) => template.id === value.trim());
}

export function getProjectTemplate(id: string): ProjectTemplate | null {
  const template = PROJECT_TEMPLATES.find((item) => item.id === id.trim());
  return template ? cloneTemplate(template) : null;
}
