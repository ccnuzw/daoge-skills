// 导航的单一来源：一级入口，以及「每个视图归哪个入口」。
//
// 为什么需要这一层：`WORKBENCH_VIEWS`（路由里的全部视图）与左侧高亮的 `*_ACTIVE_VIEWS`（导航组件）
// 此前各自维护，**没有任何一处声明「哪个视图归哪个入口」**。新增一个视图时要记得改三到四处，
// 漏一处就出现「视图能进但左侧不高亮」或「高亮了却没有入口」。
// 这里把「视图 → 宿主」固定成语义事实，并由 tests/vnext/view-registry.test.js 锁住它与另外几处的一致性。

export const STUDIO_NAVIGATION_VIEWS = Object.freeze(['projects']);
// 「生成历史」(runs) 不进一级入口：它只在任务内联页签里出现。
export const PROJECT_NAVIGATION_VIEWS = Object.freeze(['lineage', 'assets', 'deliveries']);

/**
 * 一级入口。**从上面两个数组派生**，所以不需要单独维护——
 * 它恒等于 `workbenchNavigationViews(true)`。
 */
export const PRIMARY_VIEWS = Object.freeze([...STUDIO_NAVIGATION_VIEWS, ...PROJECT_NAVIGATION_VIEWS]);

/**
 * 视图 → 宿主。宿主是一级入口之一，或 `'system'`（辅助区与创作手册挂在系统区，不是工作区入口）。
 *
 * 覆盖 `WORKBENCH_VIEWS` 里的**全部**视图——一个不多、一个不少，由 view-registry 守卫锁住。
 * 注意 `tasks` 归「创作平台」：任务列表是画布上的任务节点 + 文件夹管理，不是独立入口。
 */
export const VIEW_HOSTS = Object.freeze({
  projects: 'projects',
  'project-overview': 'projects',
  lineage: 'lineage',
  tasks: 'lineage',
  'studio-overview': 'lineage',
  prompts: 'lineage',
  runs: 'lineage',
  assets: 'assets',
  trash: 'assets',
  'shared-assets': 'assets',
  deliveries: 'deliveries',
  library: 'system',
  guide: 'system',
  troubleshoot: 'system'
});

/**
 * 视图 → 宽度档（界面方案 §4 S3 / §5.4 / 批 A A2–A3 · G12 扩展）。
 *
 * 宽度**是页面的属性**，所以与「视图 → 宿主」一样进注册表：每个 view 声明一次，
 * `PageFrame` 消费它。任何页面**不得自写 max-width**。
 *
 * 分档依据（方案 S3）：wide＝工作台面（创作平台 / 生成历史 / 批次清单）；
 * standard＝列表面（项目 / 任务 / 资产 / 交付）；narrow＝阅读面（资料 / 共享素材 / 手册 / 疑难 / 计划审阅）。
 */
/**
 * 视图 → 人话标签（界面宪法 §5.2 / 批 B B5）。
 *
 * 面包屑与 rail 都读它：**不许散落字面量**，更不许把英文枚举端给创作者（§4 S8）。
 */
export const VIEW_LABELS = Object.freeze({
  projects: '项目管理',
  'project-overview': '项目概览',
  tasks: '任务',
  lineage: '创作平台',
  'studio-overview': '批次对比',
  prompts: '计划',
  runs: '生成历史',
  assets: '资产管理',
  trash: '回收站',
  deliveries: '资产交付',
  library: '规则资料',
  'shared-assets': '共享素材',
  guide: '创作手册',
  troubleshoot: '疑难处理'
});

export const VIEW_LAYOUTS = Object.freeze({
  lineage: 'wide',
  runs: 'wide',
  'studio-overview': 'wide',
  // 资料三页（规则资料 / 共享素材 / 创作手册）2026-09-20 由 narrow 提到 **wide**（刀哥：主内容区太窄，
  // 左右空一大片，利用率要到 90%+）。它们原来按「阅读面」给 820px，而这实为**浏览面**
  // （目录 + 详情 / 卡片网格 / 分阶段指引），薄正文自带 620–680px 行宽上限，放宽页面不会拉长行。
  // 同时 `--page-max-wide` 1680 → 2400：1680 在 2560 这类屏上只剩 76%，"两边一大片空"会原样复现。
  library: 'wide',
  'shared-assets': 'wide',
  guide: 'wide',
  projects: 'standard',
  'project-overview': 'standard',
  tasks: 'standard',
  // 资产 / 回收站 / 交付 2026-09-20 由 standard(1180) 提到 **wide**（刀哥：这三屏才是真正吃空间的模块——
  // 选图看图、对比、打包交付）。1180 在 1920 视窗只剩 75%、2560 只剩 54%，而它们的卡片网格是自适应的：
  // 宽度到手就变成「一屏多看到几张」，这正是选片时最缺的东西。
  assets: 'wide',
  trash: 'wide',
  deliveries: 'wide',
  prompts: 'narrow',
  troubleshoot: 'narrow'
});

/** 某个宿主下的全部视图（给高亮分组、以及「收起视图后去哪」提供依据）。 */
export function viewsHostedBy(host) {
  return Object.keys(VIEW_HOSTS).filter((view) => VIEW_HOSTS[view] === host);
}

export function workbenchNavigationViews(hasProject) {
  return hasProject ? [...STUDIO_NAVIGATION_VIEWS, ...PROJECT_NAVIGATION_VIEWS] : [...STUDIO_NAVIGATION_VIEWS];
}
