import { SHORTCUT_ROWS } from './shortcut-model.mjs';

/**
 * 创作手册（Studio 学习中心）的内容。
 *
 * 2026-09-20 重写（刀哥委托）：这是一本**给创作者看的手册**，不是系统规格书。
 * 三条口径：
 *   ① 按人的动线排序：建项目 → 说一句 → 看出图 → 挑图 → 拿出去；
 *   ② 说人话：讲「你会看到什么、点了会怎样」，不讲后台怎么实现；
 *   ③ 工程词只留躲不开的几个（Provider / Profile / API Key / Base URL / 运行 / 运行项 / Workbench / conversation / Studio Session），
 *      首次出现给括注，顶部名词表兜底。
 * 「离线策略」专题整体退场（2026-09-20）：默认就是离线，只有出图才联网——这件事一句话说完，不值得一页对照表。
 *
 * 主题字段的读法：
 *   studio       —— 在这个界面里怎么做（看得见、点得到）
 *   conversation —— 回到对话里怎么说
 *   checkpoints  —— 记住这几条
 */

export const LEARNING_FILTERS = [
  { id: 'all', label: '全部主题' },
  { id: 'start', label: '开始使用' },
  { id: 'create', label: '说一句与出图' },
  { id: 'assets', label: '挑图与画布' },
  { id: 'delivery', label: '拿出去与找回' },
  { id: 'safety', label: '安全边界' }
];

export const LEARNING_PHASES = [
  { id: 'projects', number: '01', label: '建项目' },
  { id: 'plans', number: '02', label: '说一句' },
  { id: 'runs', number: '03', label: '看出图' },
  { id: 'assets', number: '04', label: '挑图' },
  { id: 'delivery', number: '05', label: '拿出去' }
];

export const LEARNING_TOPICS = [
  {
    id: 'projects', group: 'start', icon: 'project', kicker: '项目', title: '一个项目，装着一条创作线',
    summary: '项目是长期的创作边界：一个项目里有若干任务，一个任务下可以开很多批次——一批就是一轮出图。',
    studio: '在「项目管理」里建项目；进入项目后建任务，再新建批次。列表支持按名称搜索、按状态筛选、翻页。',
    conversation: '新建只记下条件；真正出图仍要回到对话：说清目标、数量、画幅，确认计划。',
    checkpoints: ['项目、任务、批次是三层，别混着用', '新建后直接进入当前上下文，不会弹“下一步”卡片', '想让 agent 出图，回来说一句就行'],
    action: 'projects', actionLabel: '去项目管理'
  },
  {
    id: 'sessions', group: 'start', icon: 'session', kicker: '会话', title: '多开也不乱：每个对话有自己的工作记录',
    summary: '同一个工作区里，多个对话共用一个后台服务，但各自记住自己的项目、任务和批次；工作台（Workbench：你现在看到的这个界面）会自动复用已经开着的那个。',
    studio: '每个浏览器标签保存自己的界面身份，但它不等于一次对话；项目、任务、批次的选中状态跟着界面走。',
    conversation: '每个真实对话（conversation：你和智能体之间的一次对话）都有自己的工作记录（Studio Session：这一次对话的上下文）；换对话等于换一份上下文。',
    checkpoints: ['关掉界面不影响后台继续工作', '换标签页不等于换对话', '界面显示什么，以项目里的事实为准']
  },
  {
    id: 'provider', group: 'start', icon: 'provider', kicker: '生成服务', title: '配置一次，之后只管出图',
    summary: '生成服务（Provider：帮你出图的那家外部服务，比如 OpenAI、Gemini）填一次就能一直用：一组配置（Profile：服务 + 网址 + 密钥 + 模型），网址（Base URL：这家服务的入口地址），密钥（API Key：调用这家服务的钥匙）。',
    studio: '在左下「系统状态 → 打开设置」里新建并激活配置；密钥填进去就不再回显，只有你点「连接测试」「获取模型」时才会联网。',
    conversation: '对话不会替你改配置；要换服务或模型，先在设置里配好再回来说。',
    checkpoints: ['没配置也能先把项目、任务、批次建好', '密钥只写不回显，也不进日志和导出', '打开或保存设置本身不会联网']
  },
  {
    id: 'plans', group: 'create', icon: 'plan', kicker: '说一句', title: '说一句 → 回执 → 就这么出',
    summary: '在底部输入框说一句（想要什么、几张、什么画幅），agent 先回一条「我准备这么出」，你点头才开始。',
    studio: '回执卡片上有「就这么出」和「改一下」：「改一下」能改批次目的、数量、画幅和补充说明；确认闸门只有你本人能点。',
    conversation: '把目标、数量、画幅、参考说清楚；不满意就直说，agent 改完计划会再给你确认。',
    checkpoints: ['没有你的确认，不会出图、不会花钱', '改了计划要重新确认一次', '检查器里能看「它为什么这么理解」，也能看每张图的完整提示词']
  },
  {
    id: 'preflight', group: 'create', icon: 'check', kicker: '核算', title: '确认之后先核算，这步不花钱',
    summary: '你确认计划后，先核算一遍：能不能跑通、一共几张、什么规格。核算阶段不出图、不计费。',
    studio: '核算结论留在批次的「计划 / 生成历史」里；同一批同时出几张默认 4，想一张一张就设 1。',
    conversation: '计划或同时出图的数量变了，就回来说一声重新核算；核算通过才会真正排队出图。',
    checkpoints: ['核算不调用出图服务、不产生费用', '改了计划就重算，旧结论作废', '同时出几张写在计划里，改它要重新确认']
  },
  {
    id: 'runs', group: 'create', icon: 'run', kicker: '出图', title: '看着它一张张长出来',
    summary: '出图开始后，画布上先立占位格，出一张填一张；没出成的会标出来，可以只补那几张。',
    studio: '出图中可以直接暂停或取消（不花钱；取消后 5 秒内还能撤销）。没成的用「重试这 N 张」补；想被叫回来就开「出完了叫我」。',
    conversation: '要重试、要从断点恢复，回来说一句；结果不明时先核实，别让它自动重放。',
    checkpoints: ['暂停 / 取消在界面上直接点，不用回对话', '补图只重试没成的那几张', '离开页面也会有完成提醒']
  },
  {
    id: 'history', group: 'create', icon: 'history', kicker: '出图记录', title: '每次出图都留着，想看哪次自己选',
    summary: '同一批次可以出很多次，每次都有完整记录：当时用的计划版本、每一张（运行项：一次出图里的其中一张）的结果。',
    studio: '在检查器的「生成历史」里先选一次出图（运行：一次真正的出图执行），再看它的详情；刷新页面不会把选中记录弄乱。',
    conversation: '讨论历史结果时，直接说那一次的短 ID，agent 不会拿最新一次来猜。',
    checkpoints: ['不会默认拿最新一次当你选中的', '记录里保留当时的完整提示词', '失败与重试都留在同一份记录里']
  },
  {
    id: 'assets', group: 'assets', icon: 'asset', kicker: '挑图', title: '挑图在创作平台，资产管理是后台',
    summary: '挑图在画布的批次旁边做；「资产管理」是导入、整理、去重的后台。',
    studio: '选中图片后：← → 换图、空格保留、X 不采用、Enter 缩放、Esc 退出，可以 2–4 张并排对比；资产页支持筛选、翻页和「全选本页」。',
    conversation: '说「这批里挑三张亮一点的」这类话，agent 按你的说法执行；大范围整理先在对话里对齐。',
    checkpoints: ['状态图例：未定 / 成果 keep / 不采用 / 可继续 / 交付冻结', '只有「成果 keep」能进交付', '「不采用」会记下原因，还能转成反例']
  },
  {
    id: 'references', group: 'assets', icon: 'reference', kicker: '参考与衍生', title: '用参考图，也要留好来源',
    summary: '参考图和遮罩只能来自当前项目资产，或明确共享的素材；想换方向就新开一批（批次）。',
    studio: '选中图后从「继续创作」里选用途（主体 / 风格 / 构图 / 反例）或发起衍生；「查看来源」能看到这张图的完整来历。',
    conversation: '要用哪张当参考、要衍生还是局部修改，跟 agent 说清楚对象和目的。',
    checkpoints: ['别的项目的图默认不可用，除非明确共享', '衍生是新批次，要重新确认', '参考用途会写进计划，出图时按它执行']
  },
  {
    id: 'lineage', group: 'assets', icon: 'reference', kicker: '画布', title: '一张图看懂这条线怎么长出来的',
    summary: '画布把任务、批次和图片连成一条线；批次可以收起、展开，图跟着批次走。',
    studio: '空白处拖拽框选，Shift 或多选加点选；F 适应选择、双击批次收起/展开；工具条「全局 / 按图片 / 按交付」三种视角。',
    conversation: '画布只改看得见的部分（位置、分组、连线），改事实（计划、出图）仍要回到对话确认。',
    checkpoints: ['布局会记住你动过的节点', '编辑模式才有框选、移动、分组和小地图', '快捷键面板：右键菜单「查看快捷键」或工具条「更多」']
  },
  {
    id: 'library', group: 'assets', icon: 'library', kicker: '规则资料', title: '任务类型、风格包、品牌包',
    summary: '规则资料放可复用的创作规则；agent 起草计划时会参考它们。',
    studio: '从项目里打开规则资料会保留当前项目，看完能直接回去；里面只放规则，不绑定具体任务或批次。',
    conversation: '要沉淀一套新规则，跟 agent 说清内容，它会整理成结构化规则；套用规则出图仍要确认计划。',
    checkpoints: ['规则只是计划的默认值', '图片资源共享在「共享素材」，不在这里', '同一套规则可以跨项目复用']
  },
  {
    id: 'delivery', group: 'delivery', icon: 'delivery', kicker: '拿出去', title: '挑好的图，正式交出去',
    summary: '「拿出去」把成果冻结成一份交付：先选图，准备，再导出；导出之后，就算源图被回收也不受影响。',
    studio: '在「资产交付」里选图 → 准备 → 导出；导出会生成图片和一份清单，也能整包 ZIP 下载，还能带上创作记录。',
    conversation: '要改交付范围或补说明，回来说；导出后的交付是冻结的，改它会新建一版。',
    checkpoints: ['只有「成果 keep」能进交付', '每份交付都有版本记录', '历史交付一直能下载']
  },
  {
    id: 'recovery', group: 'delivery', icon: 'recovery', kicker: '回收站', title: '删错了还能找回来',
    summary: '回收站只属于当前项目：删掉的图都在这里，恢复后回到原来的位置和关系。',
    studio: '在项目里打开回收站，选中要恢复的图，点恢复。',
    conversation: '大范围整理、或要删可能被引用的图，先跟 agent 对一下再动手。',
    checkpoints: ['共享素材不在这里，去「共享素材」页处理', '恢复会带着原来的评审和来源', '删除不靠文件夹表达状态']
  },
  {
    id: 'safety', group: 'safety', icon: 'safety', kicker: '安全边界', title: '哪些事只有你能做',
    summary: '密钥只写不回显；确认计划、恢复外部请求这些事，只有你本人能做。',
    studio: '密钥不进日志、不进导出；打开或保存页面不会自动联网。要重启后台，从「系统状态」里走安全重启。',
    conversation: 'agent 不会替你确认计划，也不能绕过确认去出图。',
    checkpoints: ['计划确认只能由你亲手点', '密钥不进日志、导出或诊断', '出图之外的操作不会碰你的服务商账号']
  },
  {
    id: 'shortcuts', group: 'start', icon: 'check', kicker: '键盘', title: '画布快捷键',
    summary: '画布支持一套键盘操作；工具条「更多 → 快捷键」和这里读的是同一张表，不会各说各话。',
    studio: '在画布上直接按键；吸附开启时方向键按网格移动节点。',
    conversation: '快捷键只改画布呈现，不改项目里的事实。',
    checkpoints: SHORTCUT_ROWS.map(([label, keys]) => label + '：' + keys)
  }
];