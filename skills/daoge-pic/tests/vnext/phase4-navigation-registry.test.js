const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const skillRoot = path.resolve(__dirname, '../..');

test('every WORKBENCH_VIEW has exactly one renderer key and legacy dispatch is absent', async () => {
  const { WORKBENCH_VIEWS, WORKBENCH_VIEW_RENDERERS, rendererForWorkbenchView } = await import('../../web/src/workbench-route.mjs');
  assert.deepEqual(Object.keys(WORKBENCH_VIEW_RENDERERS), WORKBENCH_VIEWS);
  assert.equal(new Set(Object.keys(WORKBENCH_VIEW_RENDERERS)).size, WORKBENCH_VIEWS.length);
  for (const view of WORKBENCH_VIEWS) assert.equal(rendererForWorkbenchView(view), view);
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  assert.match(main, /const viewRenderers = \{/);
  assert.match(main, /const renderActiveView = viewRenderers\[routeView\]/);
  for (const view of WORKBENCH_VIEWS) {
    const key = /^[a-z]+$/.test(view) ? view + ':' : "'" + view + "':";
    assert.equal(main.includes(key), true, 'main renderer for ' + view);
  }
  assert.doesNotMatch(main, /__legacy_deliveries__|DeliveryComposer/);
});

test('mobile navigation exposes four human workbench entries with 44px targets', async () => {
  const { workbenchNavigationViews } = await import('../../web/src/workbench-navigation-model.mjs');
  assert.deepEqual(workbenchNavigationViews(true), ['projects', 'lineage', 'assets', 'deliveries']);
  assert.deepEqual(workbenchNavigationViews(false), ['projects']);
  const navigation = fs.readFileSync(path.join(skillRoot, 'web/src/workbench-navigation.jsx'), 'utf8');
  assert.match(navigation, /label: '项目管理'/);
  assert.match(navigation, /label: '创作平台'/);
  assert.match(navigation, /label: '资产管理'/);
  assert.match(navigation, /label: '资产交付'/);
  assert.match(navigation, /const mainItems = \[/);
  assert.match(navigation, /WORKBENCH_ACTIVE_VIEWS/);
  assert.match(navigation, /workbench: \{ view: 'projects', label: '项目管理'[^\n]+projectId: null/);
  assert.match(navigation, /const workbenchItem = NAVIGATION_ITEMS\.workbench/);
  assert.match(navigation, /const WORKBENCH_ACTIVE_VIEWS = new Set\(\['projects'\]\)/);
  assert.doesNotMatch(navigation, /workbenchItem = project \?/);
  assert.doesNotMatch(navigation, /workbenchItem[^\n]+project-overview/);
  assert.match(navigation, /ASSET_ACTIVE_VIEWS/);
  // 「生成历史」按轮次组织，只在任务内联页签里出现；一旦把它请回一级入口，这条会先响。
  assert.doesNotMatch(navigation, /NAVIGATION_ITEMS\.runs|item: runItem/);
  // v5.12.0 把轨道里「当前项目」那一组二级入口整体撤掉了，这条守卫锁住它不回潮。
  // 「项目管理」不在禁令内：它是 Studio 级 projects 入口的名字（v5.12.0 之前就叫这个），与那组二级入口无关。
  assert.doesNotMatch(navigation, /label: '项目资产'|label: '回收站'|label: '任务'/);
  assert.doesNotMatch(navigation, /NAVIGATION_ITEMS\.library|project-navigation-name/);
  const css = fs.readFileSync(path.join(skillRoot, 'web/src/styles.css'), 'utf8');
  assert.match(css, /\.studio-rail \{ min-width:0; max-width:100%; overflow:hidden;[^}]*\}/);
  assert.match(css, /\.workspace-navigation \{ display:flex; width:100%; max-width:100%; min-width:0;[^}]*overflow-x:auto/);
  assert.match(css, /\.workspace-navigation section \{ display:flex; flex:0 0 auto/);
  assert.match(css, /\.workspace-navigation button \{ flex:0 0 auto; min-width:44px; min-height:44px/);
});

test('sidebar owns collapsible chrome, studio status controls, and manual entry', () => {
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  const navigation = fs.readFileSync(path.join(skillRoot, 'web/src/workbench-navigation.jsx'), 'utf8');
  const css = fs.readFileSync(path.join(skillRoot, 'web/src/styles.css'), 'utf8');
  assert.match(main, /RAIL_COLLAPSE_KEY/);
  assert.match(main, /is-rail-collapsed/);
  assert.doesNotMatch(main, /RuntimeHealthControl/);
  assert.doesNotMatch(main, /className="connection-state/);
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
  assert.match(css, /@media \(max-width:800px\) \{[\s\S]*\.rail-utility-stack/);
});

test('styles cover all keyboard focus surfaces and reduced motion', () => {
  const css = fs.readFileSync(path.join(skillRoot, 'web/src/styles.css'), 'utf8');
  assert.match(css, /input:focus-visible, select:focus-visible, textarea:focus-visible, a:focus-visible, summary:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.spin \{ animation:none; \}/);
});
