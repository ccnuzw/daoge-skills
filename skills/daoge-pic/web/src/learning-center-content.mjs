export const LEARNING_FILTERS = [
  { id: 'all', label: '全部主题' },
  { id: 'start', label: '建立创作' },
  { id: 'create', label: '计划与运行' },
  { id: 'assets', label: '资产与复用' },
  { id: 'delivery', label: '交付与恢复' },
  { id: 'safety', label: '安全边界' }
];

export const LEARNING_PHASES = [
  { id: 'projects', number: '01', label: '建立项目' },
  { id: 'plans', number: '02', label: '确认计划' },
  { id: 'runs', number: '03', label: '观察运行' },
  { id: 'assets', number: '04', label: '视觉选片' },
  { id: 'delivery', number: '05', label: '冻结交付' }
];

export const LEARNING_TOPICS = [
  { id: 'projects', group: 'start', icon: 'project', kicker: '项目工作区', title: '从项目到任务，再到轮次', summary: '项目是长期创作边界；任务是清晰目标；轮次记录探索、优化、变体、编辑和补图。', studio: '从项目概览进入任务，在任务中查看轮次、计划、运行与结果。', conversation: '创建项目、任务和轮次，以及变更创作目标，都在会话中确认。', checkpoints: ['项目只承载一个业务主题', '任务必须能被创作者清楚描述', '新方向使用新轮次，不覆盖历史'], action: 'projects', actionLabel: '查看项目' },
  { id: 'plans', group: 'create', icon: 'plan', kicker: '计划与提示词', title: '让每一次生成可审阅、可比较', summary: '计划版本保存操作、提示词、数量、输出规格和参考素材，便于在同一任务内回看方向变化。', studio: '在选中轮次后使用“计划”查看版本、对比结构化差异和确认引用素材。', conversation: '会话起草和修改计划；只有明确确认后才会进入预检与排队。', checkpoints: ['提示词不是唯一事实，输出规格同样重要', '参考素材必须来自 Studio 的视觉选择', '计划变更保留版本证据'], action: null, actionLabel: '' },
  { id: 'preflight', group: 'create', icon: 'check', kicker: '预检与能力', title: '先验证，再调用外部生成', summary: '预检检查配置、数量、输出规格、参考素材与 Provider 能力，不产生计费调用或正式结果。', studio: 'Studio 显示脱敏后的配置就绪状态、轮次状态和运行结果。', conversation: '预检、能力不支持和确认生成都由会话协调，不能由页面绕过。', checkpoints: ['预检不等于生成', '不支持的画幅或参考能力会明确失败', '确认前不会创建 Provider 请求'], action: null, actionLabel: '' },
  { id: 'runs', group: 'create', icon: 'run', kicker: '运行与恢复', title: '理解运行、单项与异常结果', summary: '一次运行由多个可恢复单项构成。暂停、重试、服务重启和外部结果不明确都保留历史。', studio: '在轮次“运行”中查看状态、单项进度、重试入口和脱敏异常摘要。', conversation: '恢复未完成外部请求、处理结果不明和改变执行计划时回到会话。', checkpoints: ['不自动重放结果不明的外部请求', '暂停不会丢失已完成资产', '重启后待恢复运行仍需要确认'], action: null, actionLabel: '' },
  { id: 'assets', group: 'assets', icon: 'asset', kicker: '项目资产', title: '通过画面做选择，而不是记住标识', summary: '缩略图、可见状态、来源上下文和选片条共同构成项目级视觉选择。', studio: '在项目资产中导入图片或查看成果，按项目、任务、轮次缩小范围；使用复选框选片，更多菜单用于保留、待复核、批注、衍生、来源查看和回收。', conversation: '描述已在 Studio 中选定的画面后，才可要求新的衍生方向或编辑计划。', checkpoints: ['选片是项目持久状态', '保留决定才可进入交付', '运行来源在查看记录中追溯'], action: null, actionLabel: '' },
  { id: 'references', group: 'assets', icon: 'reference', kicker: '参考与衍生', title: '复用参考素材时保留边界与来源', summary: '参考图、遮罩和父资产必须来自活动 Studio 资产；新的衍生仍需新的计划和确认。', studio: '通过资产查看来源与评审，识别素材的任务、轮次和运行链路。', conversation: '提出引用、编辑或衍生请求时，会话将选择关系写进计划并重新验证能力。', checkpoints: ['不通过文字猜测图片身份', '参考图不等于自动执行编辑', '所有引用保持来源关系'], action: null, actionLabel: '' },
  { id: 'library', group: 'assets', icon: 'library', kicker: '创作资料库', title: '管理跨项目的可复用资源', summary: '资料库容纳任务类型、风格、品牌与全局参考素材；它不是某个项目的回收站。', studio: '在资料库查看可复用语义和共享素材；项目内移除关系不删除原资源。', conversation: '建立新的任务类型、风格约束或品牌规则时，由会话补全结构化内容。', checkpoints: ['共享资源用关系复用，不复制文件', '资料库资源可停用或归档', '项目结果默认不跨项目泄漏'], action: 'library', actionLabel: '打开资料库' },
  { id: 'delivery', group: 'delivery', icon: 'delivery', kicker: '交付', title: '从保留选片冻结为可导出的交付', summary: '交付草稿只接受当前项目中已保留的选片；准备后再导出冻结快照。', studio: '在交付页查看准入状态、草稿、准备状态、导出记录与版本化交付批次。', conversation: '补充交付意图、处理导出异常或创建新交付方向时回到会话。', checkpoints: ['未选片或未保留会引导回项目资产', '更新草稿保持原有创作记录选项', '导出不改写来源资产'], action: null, actionLabel: '' },
  { id: 'recovery', group: 'delivery', icon: 'recovery', kicker: '回收与治理', title: '用项目回收站恢复误删成果', summary: '回收站只属于当前项目，只列出已软删除资产；恢复后回到原项目关系。', studio: '在项目侧栏底部打开回收站，确认要恢复的素材与来源后执行恢复。', conversation: '处理被引用资产影响、恢复策略或大范围整理前，先在会话中澄清。', checkpoints: ['共享资料库资源不进入项目回收站', '删除不通过文件夹表达业务状态', '恢复保留评审和来源事实'], action: null, actionLabel: '' },
  { id: 'safety', group: 'safety', icon: 'safety', kicker: '安全边界', title: '知道哪些动作必须回到会话', summary: 'Studio 是视觉管理与受控操作界面；会话负责意图确认、外部执行、恢复决策和异常处理。', studio: 'Studio 不显示密钥、原始 Provider 地址、内部路径或调试日志。', conversation: '确认生成、继续恢复、修改外部请求和处理未知结果都必须回到会话。', checkpoints: ['密钥不进入数据库与导出', '页面不能越过确认调用 Provider', '外部未知结果不会自动重放'], action: null, actionLabel: '' }
];
