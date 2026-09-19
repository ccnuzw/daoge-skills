const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');

/**
 * 挑图体验的守卫（方案 4.8）。
 *
 * 方案里这一项的判据是速度：「出一批 10 张，有快捷键是 10 次按键，没有是 10 轮『点开—找—点』」。
 * 所以守卫盯的是三件事：键位对得上、缩放真的能放大到看得清细节、对比不止两张。
 */

test('⚠️ Enter 的放大必须真的放大（判据是基准 1×，不是缩放下限 0.75×）', async () => {
  const m = await import('../../web/src/image-review-keys-model.mjs');
  // 这一条来自实测：原实现拿 REVIEW_ZOOM_MIN(0.75) 当判据，1× 时条件也成立 →
  // 永远设回 1×，「Enter 放大」那一半是死的（连按 8 次缩放纹丝不动）。
  assert.equal(m.reviewZoomToggleTarget(1), 2, '1× 时 Enter 应当放大到 2×');
  assert.equal(m.reviewZoomToggleTarget(2), 1, '2× 时 Enter 应当复位到 1×');
  assert.equal(m.reviewZoomToggleTarget(4), 1, '放大之后 Enter 复位');
  assert.equal(m.reviewZoomToggleTarget(0.75), 2, '比 1× 小时也该放大');
  assert.notEqual(m.REVIEW_ZOOM_TOGGLE_BASE, m.REVIEW_ZOOM_MIN, '切换基准不能等于缩放下限（那正是这个 bug 的成因）');
  // 接线：组件必须用模型给的目标，不在组件里另写一遍判据。
  const { readSource } = require('./source-text');
  // 批 E（E1.6b）迁移：外壳 JSX 搬去 app/workbench-shell.jsx——源断言读「main + 壳」两处。
  const main = readSource('web/src/main.jsx') + '\n' + readSource('web/src/app/workbench-shell.jsx');
  assert.match(main, /onZoom\(reviewZoomToggleTarget\(zoom\)\)/, 'Enter 必须走模型给的目标倍率');
  assert.doesNotMatch(main, /clampReviewZoom\(zoom\) > REVIEW_ZOOM_MIN \? 1 : 2/, '不许再拿缩放下限当切换判据');
});

test('挑图键位：方向键切图、Esc 收起、Enter 缩放、空格保留、X 不采用', async () => {
  const { reviewKeyAction } = await import('../../web/src/image-review-keys-model.mjs');
  const at = (key, index, count, canReview = true) => reviewKeyAction({ key, index, count, canReview });

  assert.deepEqual(at('ArrowRight', 0, 3), { action: 'next', index: 1 });
  assert.deepEqual(at('ArrowLeft', 2, 3), { action: 'prev', index: 1 });
  assert.deepEqual(at('ArrowLeft', 0, 3), { action: 'none' }, '到头部就停住，不回绕');
  assert.deepEqual(at('ArrowRight', 2, 3), { action: 'none' }, '到尾部就停住');
  assert.deepEqual(at('Escape', 0, 3), { action: 'close' });
  assert.deepEqual(at('Enter', 0, 3), { action: 'toggle-zoom' });
  assert.deepEqual(at(' ', 0, 3), { action: 'keep' });
  assert.deepEqual(at('X', 0, 3), { action: 'reject' });
  assert.deepEqual(at('q', 0, 3), { action: 'none' }, '不相干的键不做事');
});

test('没有评审上下文时，决策键不动作（否则会悄悄改掉评审）', async () => {
  const { reviewKeyAction } = await import('../../web/src/image-review-keys-model.mjs');
  // 从参考素材、拒绝原因等对话框打开的预览也看得见图，但那里没有「给这一批定去留」的语义。
  assert.deepEqual(reviewKeyAction({ key: ' ', index: 0, count: 2, canReview: false }), { action: 'none' });
  assert.deepEqual(reviewKeyAction({ key: 'X', index: 0, count: 2, canReview: false }), { action: 'none' });
  // 但「看」的部分照常工作：切图与收起不受影响。
  assert.deepEqual(reviewKeyAction({ key: 'ArrowRight', index: 0, count: 2, canReview: false }), { action: 'next', index: 1 });
  assert.deepEqual(reviewKeyAction({ key: 'Escape', index: 0, count: 2, canReview: false }), { action: 'close' });
});

test('缩放能放大到看清细节的程度（≥4 倍），且上下限夹得住', async () => {
  const { REVIEW_ZOOM_MAX, REVIEW_ZOOM_MIN, clampReviewZoom, reviewZoomStep } = await import('../../web/src/image-review-keys-model.mjs');
  // 方案 4.8：挑图的核心判断是细节（脸、手、边缘），缩略图看不出来 —— 2 倍不够。
  assert.ok(REVIEW_ZOOM_MAX >= 4, '缩放上限至少 4 倍');
  assert.equal(clampReviewZoom(100), REVIEW_ZOOM_MAX);
  assert.equal(clampReviewZoom(0.01), REVIEW_ZOOM_MIN);
  assert.equal(clampReviewZoom('abc'), 1, '非法值回落到 1');
  assert.ok(reviewZoomStep(REVIEW_ZOOM_MAX, 1) === REVIEW_ZOOM_MAX, '到顶就不再放大');
  assert.ok(reviewZoomStep(REVIEW_ZOOM_MIN, -1) === REVIEW_ZOOM_MIN, '到底就不再缩小');
});

test('接线：预览态真的绑了键位，对比支持 3–4 张、缩放到 4 倍', () => {
  const main = readSource('web/src/main.jsx');
  assert.match(main, /image-review-keys-model\.mjs/, 'main.jsx 必须用这个模型');
  assert.match(main, /reviewKeyAction\(/, '预览态必须真的调用键位映射');
  // 对比入口不再限死两张（方案：两张只够「选 A 还是选 B」）。
  assert.doesNotMatch(main, /selectedAssets\.length === 2 &&/, '对比入口不该还卡在两张');
  // 缩放上限跟着模型走，而不是写死 2。
  assert.doesNotMatch(main, /Math\.min\(2, zoom \+ 0\.25\)/, '缩放上限不该还是写死的 2');
});

test('挑图链路完整：三个入口与弹层的每个决策回调都接通', () => {
  // 批 E（E1.6a/E1.6b）迁移：选区入口在 views/assets.jsx，弹层在 app/workbench-shell.jsx。
  const main = readSource('web/src/main.jsx') + '\n' + readSource('web/src/app/workbench-shell.jsx') + '\n' + readSource('web/src/views/assets.jsx');
  // 入口 1：选区工具条的「预览」按钮（选中图之后出现）。
  assert.match(main, /onPreview=\{\(nextAssets\) => \{ setPreviewZoom\(1\); setPreviewAssets\(nextAssets\); \}\}/, '选区工具条的预览必须接到弹层');
  // 入口 2：选中 2 张及以上即可对比（布局自适应网格，上限交给布局而不是按钮）。
  assert.match(main, /selectedAssets\.length >= 2 && <IconButton/, '对比按钮必须支持 2 张及以上');
  // 弹层的每个回调必须真的传进去——canReview 靠 onToggleDeliverable，缺了它空格/X 会静默失效。
  const dialog = main.match(/<ImageInspectorDialog[^\n]*/)?.[0] || '';
  for (const prop of ['onToggleDeliverable=', 'onReject=', 'onZoom=', 'onClose=']) {
    assert.ok(dialog.includes(prop), '预览弹层缺回调：' + prop);
  }
});
