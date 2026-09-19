const test = require('node:test');
const assert = require('node:assert/strict');
const { readFrontendSource, readSource, readStyles } = require('./source-text');


test('every WORKBENCH_VIEW has exactly one renderer key and legacy dispatch is absent', async () => {
  const { WORKBENCH_VIEWS, WORKBENCH_VIEW_RENDERERS, rendererForWorkbenchView } = await import('../../web/src/workbench-route.mjs');
  assert.deepEqual(Object.keys(WORKBENCH_VIEW_RENDERERS), WORKBENCH_VIEWS);
  assert.equal(new Set(Object.keys(WORKBENCH_VIEW_RENDERERS)).size, WORKBENCH_VIEWS.length);
  for (const view of WORKBENCH_VIEWS) assert.equal(rendererForWorkbenchView(view), view);
  const main = readFrontendSource();
  assert.match(main, /const viewRenderers = \{/);
  assert.match(main, /const renderActiveView = viewRenderers\[routeView\]/);
  for (const view of WORKBENCH_VIEWS) {
    const key = /^[a-z]+$/.test(view) ? view + ':' : "'" + view + "':";
    assert.equal(main.includes(key), true, 'main renderer for ' + view);
  }
  assert.doesNotMatch(readSource('web/src/main.jsx'), /__legacy_deliveries__|DeliveryComposer/);
});

test('mobile navigation exposes four human workbench entries with 44px targets', async () => {
  const { workbenchNavigationViews } = await import('../../web/src/workbench-navigation-model.mjs');
  assert.deepEqual(workbenchNavigationViews(true), ['projects', 'lineage', 'assets', 'deliveries']);
  assert.deepEqual(workbenchNavigationViews(false), ['projects']);
  const navigation = readFrontendSource();
  assert.match(navigation, /label: '项目管理'/);
  assert.match(navigation, /label: '创作平台'/);
  assert.match(navigation, /label: '资产管理'/);
  assert.match(navigation, /label: '资产交付'/);
  assert.match(navigation, /const mainItems = \[/);
  assert.match(navigation, /WORKBENCH_ACTIVE_VIEWS/);
  assert.match(navigation, /workbench: \{ view: 'projects', label: '项目管理'[^\n]+projectId: null/);
  assert.match(navigation, /const workbenchItem = NAVIGATION_ITEMS\.workbench/);
  assert.match(navigation, /const WORKBENCH_ACTIVE_VIEWS = new Set\(\['projects'\]\)/);
  assert.doesNotMatch(readSource('web/src/workbench-navigation.jsx'), /workbenchItem = project \?/);
  assert.doesNotMatch(readSource('web/src/workbench-navigation.jsx'), /workbenchItem[^\n]+project-overview/);
  assert.match(navigation, /ASSET_ACTIVE_VIEWS/);
  // 「生成历史」按批次组织，只在任务内联页签里出现；一旦把它请回一级入口，这条会先响。
  assert.doesNotMatch(readSource('web/src/workbench-navigation.jsx'), /NAVIGATION_ITEMS\.runs|item: runItem/);
  // v5.12.0 把轨道里「当前项目」那一组二级入口整体撤掉了，这条守卫锁住它不回潮。
  // 「项目管理」不在禁令内：它是 Studio 级 projects 入口的名字（v5.12.0 之前就叫这个），与那组二级入口无关。
  // 「NAVIGATION_ITEMS.library」也不在禁令内：925f7e5 禁它是因为当时 library 是个没有渲染的死项，
  // 现在它有了真入口（辅助区），守卫跟着演进 —— 但「不许回潮」的部分必须留着。
  assert.doesNotMatch(readSource('web/src/workbench-navigation.jsx'), /label: '项目资产'|label: '回收站'|label: '任务'/);
  assert.doesNotMatch(readSource('web/src/workbench-navigation.jsx'), /project-navigation-name/);
  // 辅助区的两个视图曾经各自只在创作手册里有一个按钮，等于不可达（library 跳转目标数只有 1）。
  // 它们必须各有真入口，否则会再次变成孤儿。
  assert.match(navigation, /const AUX_ITEMS = \[/);
  assert.match(navigation, /view: 'library', label: '规则资料'/);
  assert.match(navigation, /view: 'shared-assets', label: '共享素材'/);
  assert.match(navigation, /AUX_ITEMS\.map\(\(item\) => <RailAuxCard/);
  // 「资产管理」以项目为边界（用户已定）：选片 / 评审 / 交付在数据模型里就是按项目记的
  // （/api/projects/<id>/selection/…），跨项目混看没有意义，所以它和另外两个项目级入口一样要先选项目。
  // 连带保持 workbench-route.test.js 里那条刻意立的不变量有效：「assets/lineage 深链永不保留 studio 作用域」。
  assert.match(navigation, /assets: \{ view: 'assets', label: '资产管理'[^\n]+assetScope: 'project'/);
  assert.match(navigation, /\{ item: assetItem, active: ASSET_ACTIVE_VIEWS\.has\(view\), disabled: projectRequired \}/);
  const css = readStyles();
  assert.match(css, /\.studio-rail \{ min-width:0; max-width:100%; overflow:hidden;[^}]*\}/);
  assert.match(css, /\.workspace-navigation \{ display:flex; width:100%; max-width:100%; min-width:0;[^}]*overflow-x:auto/);
  assert.match(css, /\.workspace-navigation section \{ display:flex; flex:0 0 auto/);
  assert.match(css, /\.workspace-navigation button \{ flex:0 0 auto; min-width:44px; min-height:44px/);
});

test('sidebar owns collapsible chrome, studio status controls, and manual entry', () => {
  const main = readFrontendSource();
  const navigation = readFrontendSource();
  const css = readStyles();
  assert.match(main, /RAIL_COLLAPSE_KEY/);
  assert.match(main, /is-rail-collapsed/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /RuntimeHealthControl/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /className="connection-state/);
  assert.match(navigation, /ProviderStatusCard/);
  assert.match(navigation, /RuntimeStatusCard/);
  assert.match(navigation, /rail-system-panel/);
  assert.match(navigation, /创作手册/);
  assert.match(css, /\.rail-status-card/);
  assert.match(css, /\.rail-guide-card/);
  assert.match(css, /\.rail-section-label \{ margin:0 0 5px; padding:0 10px; color:#7d8a7d; font-size:10px/);
  assert.match(css, /\.workspace-navigation \{ flex:1 1 auto; align-content:start/);
  assert.match(css, /\.studio-shell\.is-rail-collapsed/);
  assert.match(css, /\.rail-status-popover \{ position:absolute/);
  assert.match(css, /@media \(max-width:900px\) \{[\s\S]*\.rail-utility-stack/);
});

test('styles cover all keyboard focus surfaces and reduced motion', () => {
  const css = readStyles();
  assert.match(css, /input:focus-visible, select:focus-visible, textarea:focus-visible, a:focus-visible, summary:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.spin \{ animation:none; \}/);
});
