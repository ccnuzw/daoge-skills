const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');

/**
 * 「批次目的」枚举 → 人话 label 的守卫。
 *
 * 背景：`main.jsx` 的 `ROUND_PURPOSE_OPTIONS` 早就有一份人话 label，但**只被选片那条路径用**；
 * 搜索结果（`studio-search.jsx`）直接渲染 `result.purpose`，于是同一个枚举在两处两种待遇——
 * 选片时说「精修当前结果」，搜索里裸奔 `refinement`。
 * 这里把它收成一份共享翻译，并锁住两个消费方都用它。
 */

const PURPOSES = ['exploration', 'refinement', 'variation', 'edit', 'fill'];

test('purpose labels live in one shared module and cover every enum value', async () => {
  const { PURPOSE_LABELS, purposeLabel } = await import('../../web/src/purpose-labels.mjs');
  for (const purpose of PURPOSES) {
    const label = purposeLabel(purpose);
    assert.ok(label, purpose + ' 必须有人话 label');
    assert.notEqual(label, purpose, purpose + ' 的 label 不能就是枚举本身');
    assert.equal(label, PURPOSE_LABELS[purpose], purpose + ' 的两种取法必须同源');
  }
  // 未知值返回空串：调用方据此决定不渲染，而不是把英文枚举漏到界面上。
  assert.equal(purposeLabel('unknown_purpose'), '');
  assert.equal(purposeLabel(null), '');
  assert.equal(purposeLabel(undefined), '');
});

test('studio search renders purpose through the shared label, never the raw enum', async () => {
  const search = readSource('web/src/studio-search.jsx');
  // 必须经共享翻译……
  assert.match(search, /purposeLabel\(result\.purpose\)/, '搜索结果的 purpose 必须经 purposeLabel');
  // ……且不许把枚举「裸接」进渲染（`|| result.purpose ||` 这种直接拼接）。
  assert.doesNotMatch(search, /\|\|\s*result\.purpose\s*\|\|/, '不许把英文枚举直接接进渲染');
});

test('the round purpose options take their labels from the shared module', async () => {
  // 批 E（E1.6b）迁移：外壳 JSX 搬去 app/workbench-shell.jsx——源断言读「main + 壳」两处。
  const main = readSource('web/src/main.jsx') + '\n' + readSource('web/src/app/workbench-shell.jsx');
  assert.match(main, /purpose-labels\.mjs/, 'main.jsx 必须从共享模块取 label');
  assert.doesNotMatch(main, /label: '探索新方向'/, 'label 文案不该在 main.jsx 里硬编码（防回退：新增枚举只改一处）');
});
