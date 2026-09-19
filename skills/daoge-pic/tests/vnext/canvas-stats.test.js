const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource, readStyles } = require('./source-text');

/**
 * G18 · 统计进浮层、保存态变指示点（界面批 C · C2）。
 *
 * 判据：① 一长串 11px 统计不再是常显横带的一部分（收进浮层）；
 *       ② 统计里的每个数字都还在（浮层里一个不少——见 canvas-chrome 的清点表）；
 *       ③ 保存态降为指示点，但**失败仍有一行字**（`aria-live`）——「变红点」不算通知到位。
 */
test('统计收进浮层：不再是常显横带', () => {
  const canvas = readSource('web/src/canvas/creator-workbench.jsx');
  assert.match(canvas, /<details [^>]*data-popover="stats">/, '统计必须是一个浮层（details）');
  assert.doesNotMatch(canvas, /lineage-save-state/, '旧的常显保存文本必须退场');
  assert.doesNotMatch(canvas, /\{assetCountLabel\} · \{runItemCountLabel\}/, '统计不许再以「·」串接常显');
});

test('保存态：指示点 + 失败一行字（aria-live 不许省）', () => {
  const canvas = readSource('web/src/canvas/creator-workbench.jsx');
  assert.match(canvas, /data-save=\{saveState\.status\} role="status" aria-live="polite" title=\{saveState\.message\}/, '指示点必须带 title 与 aria-live');
  assert.match(canvas, /lineage-save-indicator is-' \+ saveState\.status/, '指示点样式仍按状态分色');
  assert.match(canvas, /saveState\.status === 'error' \? <><Save size=\{13\} aria-hidden="true" \/>\{saveState\.message\}<\/>/, '失败时必须回到文字（点说不出原因）');
  const styles = readStyles();
  assert.match(styles, /\.lineage-save-indicator\.is-error \{ color: var\(--danger\); \}/, '失败态的颜色走 token（不许再写字面色）');
  assert.match(styles, /\.lineage-save-indicator\.is-saving, \.lineage-save-indicator\.is-queued \{ color: var\(--warning\); \}/, '保存中/排队中要有区分');
});
