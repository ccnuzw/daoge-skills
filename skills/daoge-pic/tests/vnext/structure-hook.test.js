const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { readFrontendSource, readSource, SKILL_ROOT } = require('./source-text');

/**
 * G13 · 结构钩子的守卫（界面方案 §6.3 / §8.3 / 批 A A7）。
 *
 * 两件事：
 *   ① 每个 view 的根元素带 `data-region="page"`、`PageFrame` 带 `data-layout`——
 *      测试与审计**只许断言这些钩子，不许断言 class 字面量**（现状 29 处，是最脆的一层）；
 *   ② **class 字面量断言只减不增**：存量按文件登记为基线，新测试一律用钩子。
 */

const CLASS_LITERAL_BASELINE = Object.freeze({
  'workbench-bulk-ui.test.js': 10,
  'asset-card-layout.test.js': 9,
  'terminology-guard.test.js': 3,
  'provider-settings-ui.test.js': 1,
  'provider-runtime-state.test.js': 1,
  'phase4-navigation-registry.test.js': 1,
  'local-auth-workbench.test.js': 1,
  'lineage-menu.test.js': 1,
  'creator-delivery-ui.test.js': 1
});

test('每个 view 都由 PageFrame 包着（钩子由模板带，页面不自写）', async () => {
  const { WORKBENCH_VIEWS } = await import('../../web/src/workbench-route.mjs');
  const frontend = readFrontendSource();
  const renderers = frontend.slice(frontend.indexOf('const viewRenderers = {'), frontend.indexOf('const renderActiveView'));
  // 钩子在 PageFrame 里（`data-region="page"` / `data-layout`），页面只负责被它包住。
  // 逐 view 断言「确实包了」——比数 class 字面量稳：模板换实现、页面换写法都不会误报。
  const unwrapped = WORKBENCH_VIEWS.filter((view) => !renderers.includes("page('" + view + "'"));
  assert.deepEqual(unwrapped, [], '这些 view 还没包进 PageFrame：' + unwrapped.join('、'));
  assert.match(readSource('web/src/templates/PageFrame.jsx'), /data-region="page"/, 'PageFrame 必须带 data-region="page"');
});

test('class 字面量断言只减不增（基线 29 处 / 10 文件）', () => {
  const dir = path.join(SKILL_ROOT, 'tests/vnext');
  const offenders = [];
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.test.js')) continue;
    // 本守卫自己必须提到 `className=` 才能做这件事，所以把自己排除在扫描之外。
    if (name === 'structure-hook.test.js') continue;
    // 口径：**含 `className=` 的行数**（与 §0.5 的 29 处同口径；一行写两处仍算一行）。
    const count = fs.readFileSync(path.join(dir, name), 'utf8').split('\n').filter((line) => line.includes('className=')).length;
    total += count;
    const allowed = CLASS_LITERAL_BASELINE[name] || 0;
    if (count > allowed) offenders.push(name + '：' + count + ' > 基线 ' + allowed);
  }
  assert.deepEqual(offenders, [], '这些测试新增了 class 字面量断言，应改用 data-region / data-tone / data-action：\n' + offenders.join('\n'));
  assert.ok(total <= 29, 'class 字面量断言总数只减不增（现 ' + total + '，基线 29）');
});
