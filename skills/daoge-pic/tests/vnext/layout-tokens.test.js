const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource, webSourceExists } = require('./source-text');

/**
 * G3 · 设计 token 的守卫（界面方案 §4 S4 / 批 A A1 · 决策 D5）。
 *
 * 判据：`tokens/` 是**全仓唯一允许出现字面量**的地方；其余 CSS 只许引用 token。
 * 现状：0 个 token、1157 个六位色值、27 种字号（方案 F4）。
 *
 * ⚠️ 「只减不增」基线：存量字面量按文件登记在 `web/src/tokens/literal-baseline.json`，
 * 每批只许减少；本文件先写成 fail（基线文件与 tokens 都还不存在）。
 */

const TOKENS_RELATIVE = 'web/src/tokens/tokens.css';
const BASELINE_RELATIVE = 'web/src/tokens/literal-baseline.json';

const REQUIRED_TOKENS = [
  '--surface-page', '--surface-card', '--surface-raised',
  '--ink-1', '--ink-2', '--ink-3', '--line-1', '--line-2',
  '--accent', '--accent-strong',
  '--page-max-wide', '--page-max-standard', '--page-max-narrow',
  '--z-sticky', '--z-slot', '--z-drawer', '--z-dialog'
];

test('tokens 文件存在且包含 S4 规定的 token 名', () => {
  if (!webSourceExists(TOKENS_RELATIVE)) assert.fail('token 文件尚未实现：web/src/tokens/tokens.css');
  const text = readSource(TOKENS_RELATIVE);
  const missing = REQUIRED_TOKENS.filter((token) => !text.includes(token + ':'));
  assert.deepEqual(missing, [], '这些 token 还没定义：' + missing.join('、'));
});

test('字面量基线存在，且基线之外的字面量只减不增', () => {
  if (!webSourceExists(BASELINE_RELATIVE)) assert.fail('字面量基线尚未建立：web/src/tokens/literal-baseline.json');
  const baseline = JSON.parse(readSource(BASELINE_RELATIVE));
  const patterns = { files: /#[0-9a-fA-F]{6}\b/g, rgba: /\brgba?\(/g };
  const offenders = [];
  for (const key of Object.keys(patterns)) {
    for (const [relative, allowed] of Object.entries(baseline[key] || {})) {
      const count = webSourceExists(relative) ? (readSource(relative).match(patterns[key]) || []).length : 0;
      if (count > Number(allowed)) offenders.push(key + ' ' + relative + '：' + count + ' > 基线 ' + allowed);
    }
  }
  assert.deepEqual(offenders, [], '这些文件的字面量比基线还多（基线只减不增）：\n' + offenders.join('\n'));
});

test('styles.css 已改为分层汇聚入口（@import），不再是巨石文件', () => {
  const styles = readSource('web/src/styles.css');
  assert.match(styles, /@import\s+['"]\.\/tokens\/tokens\.css['"]/, 'styles.css 必须 @import tokens');
  assert.match(styles, /@import\s+['"]\.\/styles\/base\.css['"]/, 'styles.css 必须 @import base 层');
});
