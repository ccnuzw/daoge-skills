const test = require('node:test');
const assert = require('node:assert/strict');
const { readFrontendSource, readSource, readStyles, webSourceExists } = require('./source-text');

/**
 * G1 · `PageFrame` 的守卫（界面方案 §5.4 / 批 A A2–A3）。
 *
 * 判据：**页面不得自定宽度、不得自造页头**——八屏共用同一个 `PageFrame`，
 * 宽度只由 `layout` 档（wide/standard/narrow）决定。
 *
 * 现状（开工前）：9 个页面容器 6 种宽度、10 套页头类名族（方案 F1）。
 */

function pageFrameSource() {
  if (!webSourceExists('web/src/templates/PageFrame.jsx')) assert.fail('PageFrame 尚未实现：web/src/templates/PageFrame.jsx');
  return readSource('web/src/templates/PageFrame.jsx');
}

test('PageFrame 存在，且对外暴露稳定钩子 data-region="page" 与 data-layout', () => {
  const source = pageFrameSource();
  assert.match(source, /data-region="page"/, 'PageFrame 必须带 data-region="page"（测试与审计只认钩子，不认 class）');
  assert.match(source, /data-layout=/, 'PageFrame 必须带 data-layout（宽度档的唯一来源）');
});

test('宽度只认三档，且不再有 view 自写 max-width', () => {
  const source = pageFrameSource();
  for (const layout of ['wide', 'standard', 'narrow']) {
    assert.match(source, new RegExp(layout), 'PageFrame 必须支持 ' + layout + ' 档');
  }
  // ⚠️ 必须用 readStyles()：样式表**不在** readFrontendSource() 的范围里
  //（那条口径的守卫明写「样式表单独用 readStyles()」）。这里曾用前者查 CSS —— 结果是一条**永真的空断言**。
  const styles = readStyles();
  // 页面级容器不得自定宽度（组件内部的小元素不受此限，故只盯着 *_stage / *-stage 这几族）。
  const offenders = [];
  for (const match of styles.matchAll(/\.([a-z-]+-(?:stage|shell|frame))\s*\{[^}]*max-width:\s*\d+px/g)) {
    offenders.push(match[1]);
  }
  assert.deepEqual(offenders, [], '这些页面容器仍自写 max-width，应交给 PageFrame：' + offenders.join('、'));
});
