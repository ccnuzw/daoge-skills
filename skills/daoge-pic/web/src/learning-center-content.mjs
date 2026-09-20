import { SHORTCUT_ROWS } from './shortcut-model.mjs';

/**
 * 创作手册（Studio 学习中心）的内容。
 *
 * 2026-09-20 重写（刀哥委托）；同日二稿：**产品化**。
 * 口径：这是给创作者看的手册——说人话，但不口语化；用产品里的词，不造土话。
 *   ① 按创作动线排序：建立项目 → 提出需求 → 生成运行 → 选片评审 → 资产交付；
 *   ② 讲「你会看到什么、点了会怎样」，不讲后台怎么实现；
 *   ③ 步骤名与按钮名一律用界面上的产品词（资产交付 / 生成运行 / 选片评审 / 核算 / 回执 / 就这么出 / 改一下）；
 *   ④ 工程词只留躲不开的几个（Provider / Profile / API Key / Base URL / 运行 / 运行项 / Workbench / conversation / Studio Session），
 *      首次出现给括注，顶部名词表兜底。
 * 「离线策略」专题整体退场（2026-09-20）：默认离线、只有出图联网——一句话的事，不值得一页对照表。
 *
 * 主题字段的读法：
 *   studio       —— 在这个界面里怎么做（看得见、点得到）
 *   conversation —— 回到对话里怎么说
 *   checkpoints  —— 记住这几条
 */

export const LEARNING_FILTERS = [
  { id: 'all', label: '全部主题' },
  { id: 'start', label: '开始使用' },
  { id: 'create', label: '需求与生成' },
  { id: 'assets', label: '选片与画布' },
  { id: 'delivery', label: '交付与找回' },
  { id: 'safety', label: '安全边界' }
];

export const LEARNING_PHASES = [
  { id: 'projects', number: '01', label: '建立项目' },
  { id: 'plans', number: '02', label: '提出需求' },
  { id: 'runs', number: '03', label: '生成运行' },
  { id: 'assets', number: '04', label: '选片评审' },
  { id: 'delivery', number: '05', label: '资产交付' }
];

export const LEARNING_TOPICS = [
  {
    id: 'projects', group: 'start', icon: 'project', kicker: '项目', title: '项目、任务与批次：三层创作结构',
    summary: '项目是长期的创作边界；一个项目下可以有多个任务，一个任务下可以开多个批次——一个批次就是一轮出图。',
    studio: '在「项目管理」里新建项目；进入项目后新建任务，再新建批次。列表支持按名称搜索、按状态筛选与翻页。',
    conversation: '新建只记下条件；真正出图要回到对话：说明目标、数量与画幅，确认计划后执行。',
    checkpoints: ['项目、任务、批次是三层，不要混用', '新建后直接进入当前上下文，不会弹出额外的“下一步”提示', '需要出图时，回来说一句即可'],
    action: 'projects', actionLabel: '去项目管理'
  },
  {
    id: 'sessions', group: 'start', icon: 'session', kicker: '会话', title: '每个会话有独立的工作记录',
    summary: '同一个工作区里，多个对话共用一个后台服务，但各自记住自己的项目、任务与批次；界面（Workbench：你现在看到的这个可视化界面）会自动复用已经打开的那一个。',
    studio: '每个浏览器标签保存自己的界面身份，但它不等于一次对话；项目、任务与批次的选中状态跟随界面。',
    conversation: '每个真实对话（conversation：你和智能体之间的一次真实对话）都有自己的工作记录（Studio Session：这一次对话的上下文）；换对话即换一份上下文。',
    checkpoints: ['关闭界面不影响后台继续工作', '切换标签页不等于切换对话', '界面显示的状态以项目里的事实为准']
  },
  {
    id: 'provider', group: 'start', icon: 'provider', kicker: '生成服务', title: '生成服务：配置一次，长期可用',
    summary: '生成服务（Provider：帮你出图的那家外部服务，比如 OpenAI、Gemini）配置一次即可长期使用：一组配置（Profile：服务 + 网址 + 密钥 + 模型），网址（Base URL：这家服务的入口地址），密钥（API Key：调用这家服务的密钥）。',
    studio: '在左下「系统状态 → 打开设置」新建并激活配置；密钥保存后不再回显，只有点击「连接测试」「获取模型」时才会联网。',
    conversation: '对话不会替你修改配置；更换服务或模型，请先在设置里配好，再回到对话继续。',
    checkpoints: ['未配置也可以先建好项目、任务与批次', '密钥只写不回显，也不进入日志与导出', '打开或保存设置本身不会联网']
  },
  {
    id: 'plans', group: 'create', icon: 'plan', kicker: '计划', title: '计划与确认：回执、就这么出、改一下',
    summary: '在底部输入框说一句（想要什么、几张、什么画幅），agent 先给出回执「我准备这么出」，你确认后才开始执行。',
    studio: '回执卡片上有「就这么出」与「改一下」：「改一下」可调整批次目的、数量、画幅与补充说明；确认闸门只能由你本人提交。',
    conversation: '把目标、数量、画幅与参考说清楚；不满意直接提，agent 修改计划后会再次请你确认。',
    checkpoints: ['没有你的确认，不会出图、不会花钱', '计划修改后需要重新确认', '检查器会说明这份计划的依据，以及每张图的完整提示词']
  },
  {
    id: 'preflight', group: 'create', icon: 'check', kicker: '核算', title: '核算：确认之后先核算，不花钱',
    summary: '确认计划后先核算一遍：是否可执行、共几张、什么规格。核算阶段不出图、不计费。',
    studio: '核算结论会留在批次的「计划 / 生成历史」里；同时出几张默认 4，需要逐张生成就设为 1。',
    conversation: '计划或同时生成的数量发生变化，回来说一声重新核算；核算通过后才会真正排队出图。',
    checkpoints: ['核算不调用出图服务、不产生费用', '计划变化即重新核算，旧结论作废', '同时出几张写在计划里，修改它需要重新确认']
  },
  {
    id: 'runs', group: 'create', icon: 'run', kicker: '生成运行', title: '生成运行：进度看得见，随时可暂停',
    summary: '出图开始后，画布先立占位格，出一张填一张；没有成功的会单独标出，可以只补那几张。',
    studio: '出图过程中可以直接暂停或取消（不花钱；取消后 5 秒内可以撤销）。未成功的用「重试这 N 张」补；需要提醒就打开「出完了叫我」。',
    conversation: '重试或从中断处恢复，回来说一句；结果不明时先核实，不要自动重放。',
    checkpoints: ['暂停与取消在界面上直接完成，不必回到对话', '补图只重试未成功的那几张', '离开页面也会有完成提醒']
  },
  {
    id: 'history', group: 'create', icon: 'history', kicker: '生成历史', title: '生成历史：每次运行都有完整记录',
    summary: '同一批次可以出很多次，每一次都有完整记录：当时使用的计划版本，以及每一张（运行项：一次出图里的其中一张）的结果。',
    studio: '在检查器的「生成历史」里先选择一次出图（运行：一次真正的出图执行），再查看详情；刷新页面不会打乱已选中的记录。',
    conversation: '讨论历史结果时，直接说明那一次的短 ID，agent 不会用最新一次来猜。',
    checkpoints: ['不会默认把最新一次当作你选中的记录', '记录保留当时使用的完整提示词', '失败与重试都留在同一份记录里']
  },
  {
    id: 'assets', group: 'assets', icon: 'asset', kicker: '选片评审', title: '选片在创作平台，资产管理做后台',
    summary: '选片在画布的批次旁进行；「资产管理」负责导入、整理与去重的后台工作。',
    studio: '选中图片后：← → 切换、空格保留、X 不采用、Enter 缩放、Esc 退出，支持 2–4 张并排对比；资产页支持筛选、翻页与「全选本页」。',
    conversation: '例如「这批里挑三张亮一点的」——agent 按你的描述执行；大范围整理先在对话里对齐。',
    checkpoints: ['状态图例：未定 / 成果 keep / 不采用 / 可继续 / 交付冻结', '只有「成果 keep」能够进入交付', '「不采用」会记录原因，并可转为反例']
  },
  {
    id: 'references', group: 'assets', icon: 'reference', kicker: '参考与衍生', title: '参考素材与衍生：来源可追溯',
    summary: '参考图与遮罩只能来自当前项目资产，或明确共享的素材；更换方向需要新开一个批次。',
    studio: '选中图片后，在「继续创作」中选用途（主体 / 风格 / 构图 / 反例）或发起衍生；「查看来源」可以看到这张图的完整来历。',
    conversation: '说明用哪张作参考、要衍生还是局部修改，以及希望保持与改变的部分。',
    checkpoints: ['其他项目的素材默认不可用，除非明确共享', '衍生属于新批次，需要重新确认', '参考用途会写入计划，出图时按它执行']
  },
  {
    id: 'lineage', group: 'assets', icon: 'reference', kicker: '创作谱系', title: '创作谱系：看清任务、批次与资产的关系',
    summary: '画布把任务、批次与图片连成一条线；批次可以收起与展开，图片跟随批次显示。',
    studio: '空白处拖拽框选，按住 Shift 或 Cmd 加点选；F 适应选择、双击批次收起或展开；工具条提供「全局 / 按图片 / 按交付」三种视角。',
    conversation: '画布只调整看得见的部分（位置、分组、连线）；涉及计划与出图的变更仍要回到对话确认。',
    checkpoints: ['布局会记住你调整过的节点', '编辑模式才有框选、移动、分组与小地图', '快捷键面板：右键菜单「查看快捷键」或工具条「更多」']
  },
  {
    id: 'library', group: 'assets', icon: 'library', kicker: '规则资料', title: '规则资料：任务类型、风格包与品牌包',
    summary: '规则资料存放可复用的创作规则；agent 起草计划时会参考它们。',
    studio: '从项目里打开规则资料会保留当前项目，看完可以直接回去；其中只放规则，不绑定具体任务或批次。',
    conversation: '要沉淀一套新规则，把内容说清楚，agent 会整理成结构化规则；套用规则出图仍要确认计划。',
    checkpoints: ['规则只是计划的默认值', '图片资源共享在「共享素材」，不在这里', '同一套规则可以跨项目复用']
  },
  {
    id: 'delivery', group: 'delivery', icon: 'delivery', kicker: '资产交付', title: '资产交付：从选片到导出',
    summary: '「资产交付」把成果冻结成一份交付：先选图，再准备，最后导出；导出之后，即使源图被回收也不受影响。',
    studio: '在「资产交付」里选图 → 准备 → 导出；导出会生成图片与一份清单，支持整包 ZIP 下载，也可以附带创作记录。',
    conversation: '需要调整交付范围或补充说明，回来说；已导出的交付是冻结的，修改它会新建一版。',
    checkpoints: ['只有「成果 keep」能够进入交付', '每份交付都有版本记录', '历史交付一直可以下载']
  },
  {
    id: 'recovery', group: 'delivery', icon: 'recovery', kicker: '回收站', title: '回收站：删除可恢复',
    summary: '回收站只属于当前项目：删除的图片都在这里，恢复后回到原来的位置与关系。',
    studio: '在项目里打开回收站，选中要恢复的图片，点击恢复。',
    conversation: '批量整理，或删除可能被引用的图片之前，先在对话里确认。',
    checkpoints: ['共享素材不在这里，请到「共享素材」页处理', '恢复会带回原来的评审与来源', '删除不通过文件夹表达状态']
  },
  {
    id: 'safety', group: 'safety', icon: 'safety', kicker: '安全边界', title: '安全边界：密钥与人工确认',
    summary: '密钥只写不回显；确认计划、恢复外部请求这些操作，只能由你本人完成。',
    studio: '密钥不进入日志与导出；打开或保存页面不会自动联网。需要重启后台时，从「系统状态」执行安全重启。',
    conversation: 'agent 不会替你确认计划，也不能绕过确认去出图。',
    checkpoints: ['计划确认只能由你亲手提交', '密钥不进入日志、导出或诊断', '出图之外的操作不会触碰你的服务商账号']
  },
  {
    id: 'shortcuts', group: 'start', icon: 'check', kicker: '键盘', title: '画布快捷键',
    summary: '画布支持一套键盘操作；工具条「更多 → 快捷键」与本页共用同一张表。',
    studio: '在画布上直接按键；开启吸附时方向键按网格移动节点。',
    conversation: '快捷键只改变画布呈现，不改变项目里的事实。',
    checkpoints: SHORTCUT_ROWS.map(([label, keys]) => label + '：' + keys)
  }
];