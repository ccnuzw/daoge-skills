const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');
const { SHORTCUT_ROWS } = require('../../web/src/shortcut-model.mjs');

/**
 * G23b · 手册快捷键表「逐条同源」（界面批 C · 2.7 搭车）。
 *
 * 判据：① 快捷键表只有一个来源（`shortcut-model.mjs`）；
 *       ② 面板与创作手册都读它——手册抄一份就一定会漂（术语守卫的同一课）。
 */
test('快捷键表只有一个来源，且两处都读它', () => {
  const canvas = (readSource('web/src/canvas/creator-workbench.jsx') + '\n' + readSource('web/src/canvas/lineage-stage.jsx'));
  assert.match(canvas, /import \{ SHORTCUT_ROWS \} from '\.\.?\/shortcut-model\.mjs'/, '快捷键面板必须读模型');
  assert.match(canvas, /const rows = SHORTCUT_ROWS;/, '面板不许再内联那张表');
  const content = readSource('web/src/learning-center-content.mjs');
  assert.match(content, /import \{ SHORTCUT_ROWS \} from '\.\/shortcut-model\.mjs'/, '手册必须读同一份模型');
  assert.match(content, /checkpoints: SHORTCUT_ROWS\.map\(\(\[label, keys\]\) => label \+ '：' \+ keys\)/, '手册的快捷键专题必须逐条来自模型');
  assert.ok(SHORTCUT_ROWS.length >= 8, '表不许空');
  for (const [label, keys] of SHORTCUT_ROWS) {
    assert.ok(label && keys, '每行都要有说法和按键：' + JSON.stringify([label, keys]));
  }
});
