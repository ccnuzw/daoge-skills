const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * 视图注册表的守卫。
 *
 * 背景：`WORKBENCH_VIEWS`（路由里的全部视图）、`workbenchNavigationViews()`（一级入口）、
 * `workbench-navigation.jsx` 里的 `*_ACTIVE_VIEWS`（左侧高亮归属）此前各自维护，**没有一处声明**
 * 「哪个视图归哪个入口」。新增一个视图时，要记得改的位置散在三到四处，漏一处就出现
 * 「视图能进但左侧不高亮」或「高亮了却没有入口」。
 *
 * 本守卫把「视图 → 宿主」这一维固化成单一来源，并锁住它与另外几处的一致性。
 */

test('every workbench view declares exactly one host, and the primary set matches the navigation model', async () => {
  const { WORKBENCH_VIEWS } = await import('../../web/src/workbench-route.mjs');
  const { VIEW_HOSTS, PRIMARY_VIEWS, viewsHostedBy, workbenchNavigationViews } = await import('../../web/src/workbench-navigation-model.mjs');

  // 完整性：注册表覆盖全部视图，一个不多、一个不少。
  assert.deepEqual(Object.keys(VIEW_HOSTS).sort(), [...WORKBENCH_VIEWS].sort(), 'VIEW_HOSTS 必须与 WORKBENCH_VIEWS 一一对应');

  // 一级入口的单一来源仍是 workbench-navigation-model；注册表必须与它一致。
  assert.deepEqual([...PRIMARY_VIEWS].sort(), [...workbenchNavigationViews(true)].sort(), 'PRIMARY_VIEWS 必须等于 workbenchNavigationViews(true)');

  // 每个一级入口是自己的宿主；每个视图的宿主都必须是一个真实的一级入口或 system。
  const HOSTS = new Set([...PRIMARY_VIEWS, 'system']);
  for (const view of PRIMARY_VIEWS) assert.equal(VIEW_HOSTS[view], view, view + ' 必须自己当宿主');
  for (const [view, host] of Object.entries(VIEW_HOSTS)) assert.ok(HOSTS.has(host), view + ' 的宿主 ' + host + ' 不是一级入口也不是 system');

  // 宿主分组非空且只包含声明过的视图。
  for (const host of HOSTS) {
    for (const view of viewsHostedBy(host)) {
      assert.equal(VIEW_HOSTS[view], host, view + ' 出现在 ' + host + ' 的分组里，但它的宿主不是它');
    }
  }
});

test('left-rail highlight groupings agree with the registry', async () => {
  const { VIEW_HOSTS } = await import('../../web/src/workbench-navigation-model.mjs');
  // 这几个视图共用「创作平台」的高亮（生成历史按轮次组织，从任务页签进入时让创作平台保持高亮）。
  for (const view of ['lineage', 'studio-overview', 'prompts', 'runs']) {
    assert.equal(VIEW_HOSTS[view], 'lineage', view + ' 应归「创作平台」');
  }
  // 资产相关的三个视图共用「资产管理」的高亮。
  for (const view of ['assets', 'trash', 'shared-assets']) {
    assert.equal(VIEW_HOSTS[view], 'assets', view + ' 应归「资产管理」');
  }
  // 项目总览归「项目管理」（它此前没有任何高亮归属——见施工日志）。
  assert.equal(VIEW_HOSTS['project-overview'], 'projects', 'project-overview 应归「项目管理」');
  assert.equal(VIEW_HOSTS['deliveries'], 'deliveries', 'deliveries 应自己当宿主');
  // 辅助区与手册挂在系统区，不是工作区一级入口。
  for (const view of ['library', 'guide', 'troubleshoot']) {
    assert.equal(VIEW_HOSTS[view], 'system', view + ' 应挂系统区');
  }
});

test('a NEW view cannot be added to WORKBENCH_VIEWS without declaring its host', async () => {
  const { WORKBENCH_VIEWS } = await import('../../web/src/workbench-route.mjs');
  const { VIEW_HOSTS } = await import('../../web/src/workbench-navigation-model.mjs');
  // 反向守卫：注册表里不许有 WORKBENCH_VIEWS 之外的键（防止删了视图却留下孤儿登记）。
  const known = new Set(WORKBENCH_VIEWS);
  const orphans = Object.keys(VIEW_HOSTS).filter((view) => !known.has(view));
  assert.deepEqual(orphans, [], '这些视图已不在 WORKBENCH_VIEWS 里，但注册表还留着：' + orphans.join(', '));
});
