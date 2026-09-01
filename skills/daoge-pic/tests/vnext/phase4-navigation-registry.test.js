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

test('mobile navigation exposes project utility in the horizontal scroller with 44px targets', async () => {
  const { workbenchNavigationViews } = await import('../../web/src/workbench-navigation-model.mjs');
  assert.deepEqual(workbenchNavigationViews(true), ['projects', 'library', 'shared-assets', 'guide', 'project-overview', 'tasks', 'assets', 'deliveries', 'trash']);
  const css = fs.readFileSync(path.join(skillRoot, 'web/src/styles.css'), 'utf8');
  assert.match(css, /\.studio-rail \{ min-width:0; max-width:100%; overflow:hidden;[^}]*\}/);
  assert.match(css, /\.workspace-navigation \{ display:flex; width:100%; max-width:100%; min-width:0;[^}]*overflow-x:auto/);
  assert.match(css, /\.workspace-navigation section \{ display:flex; flex:0 0 auto/);
  assert.match(css, /\.workspace-navigation \.project-navigation,\.workspace-navigation \.project-utility \{ display:flex/);
  assert.match(css, /\.workspace-navigation button \{ flex:0 0 auto; min-width:44px; min-height:44px/);
});

test('styles cover all keyboard focus surfaces and reduced motion', () => {
  const css = fs.readFileSync(path.join(skillRoot, 'web/src/styles.css'), 'utf8');
  assert.match(css, /input:focus-visible, select:focus-visible, textarea:focus-visible, a:focus-visible, summary:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.spin \{ animation:none; \}/);
});
