const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');

/**
 * 挑图体验的守卫（方案 4.8）。
 *
 * 方案里这一项的判据是速度：「出一批 10 张，有快捷键是 10 次按键，没有是 10 轮『点开—找—点』」。
 * 所以守卫盯的是三件事：键位对得上、缩放真的能放大到看得清细节、对比不止两张。
 */

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
