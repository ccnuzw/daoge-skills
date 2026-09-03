export const LEARNING_FILTERS = [
  { id: 'all', label: '全部主题' },
  { id: 'start', label: '启动与配置' },
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
  { id: 'projects', group: 'start', icon: 'project', kicker: '项目工作区', title: '从项目到任务，再到轮次', summary: '项目是长期创作边界；任务是清晰目标；轮次记录探索、优化、变体、编辑和补图。', studio: '从项目概览进入任务，在项目与任务列表中使用名称搜索、生命周期筛选和有界分页，再查看轮次、计划、运行与结果。', conversation: '创建项目、任务和轮次，以及变更创作目标，都在会话中确认。', checkpoints: ['项目只承载一个业务主题', '任务必须能被创作者清楚描述', '新方向使用新轮次，不覆盖历史', '项目与任务数量增长后仍通过搜索、筛选和分页定位'], action: 'projects', actionLabel: '查看项目' },
  { id: 'sessions', group: 'start', icon: 'session', kicker: '启动与会话', title: '共享工作台，隔离每个真实会话', summary: '同一稳定 workspace 的并发会话共享唯一 daemon 与 Workbench，但每个真实 conversation 使用独立 Studio Session。', studio: '普通打开可能新开 Workbench，也可能安全复用现有 Workbench；每个浏览器标签保存自己的界面身份，但它不代表智能体 conversation。', conversation: '每个真实 conversation 都创建或恢复自己的 Studio Session，再绑定项目、任务和轮次上下文。', checkpoints: ['共享 daemon 不等于共享会话上下文', '一个会话切换项目不会覆盖另一个会话的上下文', '打开结果必须区分新打开与安全复用', '浏览器标签身份与智能体 conversation Session 不是同一概念'], action: null, actionLabel: '' },
  { id: 'provider', group: 'start', icon: 'provider', kicker: '生成服务', title: '用 Profile 管理 Provider 配置', summary: 'Studio 可以在没有 active Profile 时启动；生成前再配置并激活可用 Profile。', studio: '在生成服务中列出、新建、编辑、复制、激活、删除和本地校验 Profile；API Key 与完整 Base URL 为只写字段，加载或保存不会自动连接 Provider。', conversation: 'Profile 就绪后回到会话继续计划与预检；配置版本变化并提示需要重启时，重启前不能创建新运行。', checkpoints: ['最多一个 Profile 处于 active，也允许暂时没有 active Profile', 'API Key 与完整 Base URL 只写入受本地权限保护的 Provider.db', '只有用户明确发起“连接测试”才会访问 Provider', 'Profile 配置版本变化后按提示保存并重启'], action: null, actionLabel: '' },
  { id: 'plans', group: 'create', icon: 'plan', kicker: '计划与提示词', title: '让每一次生成可审阅、可比较', summary: '计划版本保存操作、提示词、数量、输出规格和参考素材，便于在同一任务内回看方向变化。', studio: '在选中轮次后使用“计划”查看版本、对比结构化差异和确认引用素材。', conversation: '会话起草和修改计划；只有明确确认后才会进入预检与排队。', checkpoints: ['提示词不是唯一事实，输出规格同样重要', '参考素材只能来自当前项目资产或明确共享素材', '计划变更保留版本证据'], action: null, actionLabel: '' },
  { id: 'preflight', group: 'create', icon: 'check', kicker: '预检与能力', title: '先冻结执行证据，再调用外部生成', summary: '预检检查配置、数量、输出规格、参考素材、Provider 能力和执行并发，不产生计费调用或正式结果。并发范围为 1..1000，默认 4，串行使用 1。', studio: 'Studio 显示脱敏后的配置就绪状态、轮次状态和已冻结的预检证据。', conversation: '会话确认计划后发起预检；计划、Profile 版本或并发变化时必须重新预检。', checkpoints: ['预检不等于生成', '不支持的画幅或参考能力会明确失败', '执行并发由预检冻结，queue 和 run 阶段不能另改', '确认前不会创建 Provider 请求'], action: null, actionLabel: '' },
  { id: 'runs', group: 'create', icon: 'run', kicker: '运行与恢复', title: '理解运行、单项与异常结果', summary: '一次运行由多个可恢复单项构成。暂停、重试、服务重启和外部结果不明确都保留历史。', studio: '在轮次“运行”中查看状态、单项进度、重试入口和脱敏异常摘要。', conversation: '恢复未完成外部请求、处理结果不明和改变执行计划时回到会话。', checkpoints: ['不自动重放结果不明的外部请求', '暂停不会丢失已完成资产', '重启后待恢复运行仍需要确认'], action: null, actionLabel: '' },
  { id: 'history', group: 'create', icon: 'history', kicker: 'Generation History', title: '显式选择要查看的 Generation Run', summary: 'Generation History 按当前轮次列出全部持久运行；查看历史前必须明确选择其中一次运行。', studio: '选择运行后，只查看该运行的计划版本、时间、短 ID、状态、运行项和结果资产。', conversation: '讨论历史结果或继续处理时，引用已明确选择的运行；活跃运行和最新运行都不会被静默当作已选择历史。', checkpoints: ['刷新和 SSE 重连不会把其他运行改成已选记录', '浏览器缓存不能替代持久 Generation History', '运行必须由用户或会话显式选择'], action: null, actionLabel: '' },
  { id: 'assets', group: 'assets', icon: 'asset', kicker: '项目资产', title: '通过画面做选择，而不是记住标识', summary: '缩略图、可见状态、来源上下文和选片条共同构成项目级视觉选择。项目资产默认每页 24 张，可切换 16、24、32、48、64、96。', studio: '在项目资产中通过文件选择、拖入或粘贴一次导入多张图片；按项目、任务、轮次和资产类型筛选，使用“全选本页”只选择当前页可见资产，并可在放大预览中直接选为成果或取消成果。', conversation: '描述已在 Studio 中选定的画面后，才可要求新的衍生方向或编辑计划。', checkpoints: ['选片是项目持久状态，并与 keep 评审语义一致', '全选本页不跨越当前筛选范围和分页', '保留决定才可进入交付', '运行来源在查看记录中追溯'], action: null, actionLabel: '' },
  { id: 'references', group: 'assets', icon: 'reference', kicker: '参考与衍生', title: '复用参考素材时保留边界与来源', summary: '参考图、遮罩和父资产必须来自当前项目资产或明确共享素材；新的衍生仍需新的计划和确认。', studio: '通过资产查看来源与评审，识别素材的项目、任务、轮次和运行链路；共享素材只从独立共享素材视图显式提供。', conversation: '提出引用、编辑或衍生请求时，会话将选择关系写进计划，并在计划写入、确认、预检和执行前重复验证项目边界。', checkpoints: ['不通过文字猜测图片身份', '同一 Studio 的其他项目未共享素材不可引用', '参考图不等于自动执行编辑', '所有引用保持来源关系'], action: null, actionLabel: '' },
  { id: 'library', group: 'assets', icon: 'library', kicker: '创作资料库', title: '管理跨项目的可复用资源', summary: '资料库容纳任务类型、风格、品牌与全局参考素材；它不是某个项目的回收站。', studio: '在资料库查看可复用语义和共享素材；项目内移除关系不删除原资源。', conversation: '建立新的任务类型、风格约束或品牌规则时，由会话补全结构化内容。', checkpoints: ['共享资源用关系复用，不复制文件', '资料库资源可停用或归档', '项目结果默认不跨项目泄漏'], action: 'library', actionLabel: '打开资料库' },
  { id: 'delivery', group: 'delivery', icon: 'delivery', kicker: '交付', title: '从保留选片冻结为可导出的交付', summary: '交付草稿只接受当前项目中已保留的选片；准备后再导出冻结快照。', studio: '在交付页全选或取消全选交付图片，查看准入状态、草稿、准备状态、导出记录与版本化交付批次；项目资产和已导出交付 ZIP 通过项目名、交付名、类型和时间区分。', conversation: '补充交付意图、处理导出异常或创建新交付方向时回到会话。', checkpoints: ['未选片或未保留会引导回项目资产', '更新草稿保持原有创作记录选项', '导出冻结图片实体，不改写来源资产', '已导出交付不受源资产后续回收影响'], action: null, actionLabel: '' },
  { id: 'recovery', group: 'delivery', icon: 'recovery', kicker: '回收与治理', title: '用项目回收站恢复误删成果', summary: '回收站只属于当前项目，只列出已软删除资产；恢复后回到原项目关系。', studio: '在项目侧栏底部打开回收站，确认要恢复的素材与来源后执行恢复。', conversation: '处理被引用资产影响、恢复策略或大范围整理前，先在会话中澄清。', checkpoints: ['共享资料库资源不进入项目回收站', '删除不通过文件夹表达业务状态', '恢复保留评审和来源事实'], action: null, actionLabel: '' },
  { id: 'safety', group: 'safety', icon: 'safety', kicker: '安全边界', title: '知道秘密存在哪里、哪些动作必须确认', summary: '完整 Provider 配置只保存在受本地权限保护的 Provider.db；Studio 是视觉管理与受控操作界面，会话负责意图确认和外部执行决策。', studio: 'API Key 与完整 Base URL 只写不回显，也不进入 studio.db、事件、日志、导出或诊断；页面加载和保存不会自动访问 Provider。', conversation: '确认生成、继续恢复、修改外部请求和处理未知结果都必须回到会话。', checkpoints: ['Provider.db 是本地敏感配置事实源', '密钥与完整 Base URL 不进入 studio.db、事件、日志、导出或诊断', '只有显式连接测试才访问 Provider', '外部未知结果不会自动重放'], action: null, actionLabel: '' }
];
