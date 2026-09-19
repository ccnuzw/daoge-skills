const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { styleFiles } = require('./source-text');

/**
 * G2 · 断点收敛的守卫（界面方案 §4 S6 / 批 A A5 · 决策 D3）。
 *
 * 只允许 `640 / 900 / 1280` 三档（+ `prefers-reduced-motion`）。
 * 现状 13 档宽度断点（420/560/640/700/720/760/800/900/920/960/1100/1300/801min），
 * 其中 `(max-width: 800px)` 与 `(max-width:800px)` 还是同一个断点的两种写法。
 */

// 901 是 900 档的 `min-width` 写法（`max-width:900` ⟺ `min-width:901`），
// §4.1 的映射表明确要求「801 → 901」，所以它属于 900 档而不是第四档。
const ALLOWED = new Set([640, 900, 901, 1280]);

// 样式表统一走 source-text 的单一入口（分层后不再是一个文件）。
const cssFiles = styleFiles;

test('宽度断点只有 640 / 900 / 1280（+ reduced-motion）', () => {
  const offenders = [];
  for (const file of cssFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/@media[^{]*?\((?:max|min)-width\s*:\s*(\d+)px\)/g)) {
      const width = Number(match[1]);
      if (!ALLOWED.has(width)) offenders.push(file.split('web/src/')[1] + ' → ' + width + 'px');
    }
    // 同一断点的两种写法（带空格/不带空格）必须已经归一
    if (/\(max-width:800px\)/.test(text)) offenders.push(file.split('web/src/')[1] + ' → 未归一写法 (max-width:800px)');
  }
  assert.deepEqual(offenders, [], '这些断点不在允许的三档里：\n' + offenders.join('\n'));
});

test('三档断点在样式里真的被用到（防止收敛成空档）', () => {
  const text = cssFiles().map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  for (const width of ALLOWED) {
    assert.match(text, new RegExp('(?:max|min)-width\\s*:\\s*' + width + 'px'), width + ' 档应当被真实使用');
  }
});
