const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');

/**
 * G20 · 一个右栏（界面批 C · C3）。
 *
 * 判据：① 画布视图的右栏容器唯一，且带 `data-region="aside"`；
 *       ② 批次与资产来源两种内容**互斥**渲染在同一容器里（显式打开优先）；
 *       ③ 无选中时不许空白——顶部永远有这一批的四项指标（C5）；
 *       ④ 其它视图的资产浮层用独立标（`aside-overlay`），且画布视图不再开浮层。
 *
 * 队列按 C4/S1 走底部槽（展开即底栏），**不是**右栏的一种内容——这是决策，不是遗漏。
 */
test('右栏唯一且打过 aside 标：批次 / 资产 / 空态三种内容都是一同一个容器', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  assert.equal((canvas.match(/data-region="aside"/g) || []).length, 4, '四个分支（资产/空态/多选/单节点）都必须带同一个 aside 标');
  assert.match(canvas, /if \(asideSubject\(\{ explicit: assetProvenance \? 'assetProvenance' : null, selectedNodes \}\)\.kind === 'asset'\)/, '资产来源必须走 asideSubject 的优先级判据');
  const assetBranch = canvas.indexOf('kind === \'asset\'');
  const emptyBranch = canvas.indexOf('if (!selectedNodes.length)');
  assert.ok(assetBranch > 0 && emptyBranch > assetBranch, '显式打开优先于选中与空态');
  assert.match(canvas, /import \{ AssetProvenanceBody \} from '\.\/asset-provenance\.jsx'/, '资产来源必须复用同一份内容（不许写第二套说法）');
});

test('无选中也有内容：指标四项在三个分支里都渲染', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  assert.equal((canvas.match(/\{metricsStrip\}/g) || []).length, 4, '三个分支 + 资产分支都要有指标条（4 处引用）');
  assert.match(canvas, /选择一个节点/, '空态说明必须还在（无选中不是空白页）');
});

test('浮层与右栏不双开：画布视图的资产来源进右栏', () => {
  // 批 E（E1.6b）迁移：外壳 JSX 搬去 app/workbench-shell.jsx——源断言读「main + 壳」两处。
  const main = readSource('web/src/main.jsx') + '\n' + readSource('web/src/app/workbench-shell.jsx');
  assert.match(main, /\{assetProvenance && routeView !== 'lineage' && <aside [^>]*data-region="aside-overlay"/, '其它视图才开浮层，且用 aside-overlay 标区分');
  assert.match(main, /assetProvenance=\{assetProvenance\}/, '画布必须拿到资产来源');
  assert.match(readSource('web/src/views/lineage.jsx'), /onCloseAssetProvenance=\{\(\) => setAssetProvenance\(null\)\}/, '右栏里要能关掉它');
});

test('asideSubject 模型：显式 > 选中 > 空态', async () => {
  const { asideSubject } = await import('../../web/src/aside-model.mjs');
  assert.deepEqual(asideSubject({ explicit: 'assetProvenance', selectedNodes: [{}] }), { kind: 'asset', source: 'assetProvenance' });
  assert.deepEqual(asideSubject({ selectedNodes: [{}] }), { kind: 'selection', source: 'selectedNodes' });
  assert.deepEqual(asideSubject({}), { kind: 'empty', source: 'none' });
  assert.deepEqual(asideSubject({ selectedNodes: [] }), { kind: 'empty', source: 'none' });
});
