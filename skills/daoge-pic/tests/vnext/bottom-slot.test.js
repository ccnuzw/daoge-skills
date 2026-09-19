const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource, readStyles } = require('./source-text');
const { bottomSlotPlan, QUEUE_IDLE_PX, QUEUE_MAX_PX, QUEUE_MAX_RATIO } = require('../../web/src/bottom-slot-model.mjs');

/**
 * G19 · 队列贴底让位（界面批 C · C4 / S1）。
 *
 * 判据：① 队列的 DOM 序**在页面区之后**（这就是首元素 y 从 355 回到 147 的那一步）；
 *       ② 空闲恒 48px、展开 ≤min(320px, 35% 视口高)（模型说了算）；
 *       ③ 展开时画布**让位**（主列视口高 + 页面区可收缩），不许浮层盖住画布。
 */
test('队列的 DOM 序在页面区之后（不再挤占内容顶部）', () => {
  const main = readSource('web/src/main.jsx');
  const page = main.indexOf('data-region="scroll"');
  const dock = main.indexOf('<RequestQueueDock');
  const status = main.indexOf('<StatusSlot');
  assert.ok(page > 0 && dock > 0 && status > 0, '三件都必须还在');
  assert.ok(status < page, '状态条在页面区之前（顶部横带语义不变）');
  assert.ok(dock > page, '队列必须在页面区**之后**——挪回内容上方就是回潮');
});

test('底部槽三态：空闲 48 / 展开 ≤min(320, 35%) / 选片让位', async () => {
  const { bottomSlotPlan: plan } = await import('../../web/src/bottom-slot-model.mjs');
  assert.equal(plan({ queue: 'folded', viewportHeight: 950 }).height, 48);
  assert.equal(plan({ queue: 'folded', viewportHeight: 950 }).state, 'folded');
  assert.equal(plan({ queue: 'expanded', viewportHeight: 950 }).height, 320);
  assert.equal(plan({ queue: 'expanded', viewportHeight: 800 }).height, 280);
  assert.equal(plan({ queue: 'expanded', viewportHeight: 950, selecting: true }).state, 'exclusive');
  assert.equal(plan({ queue: 'expanded', viewportHeight: 950, selecting: true }).height, 48);
  assert.throws(() => plan({ viewportHeight: 0 }), /视口高不合法/, '视口高不合法必须直接抛，不许静默算 0');
  assert.equal(QUEUE_IDLE_PX, 48);
  assert.equal(QUEUE_MAX_PX, 320);
  assert.equal(QUEUE_MAX_RATIO, 0.35);
});

test('dock 用的是模型（不是自己攒的一套）', () => {
  const dock = readSource('web/src/request-queue.jsx');
  assert.match(dock, /import \{ bottomSlotPlan \} from '\.\/bottom-slot-model\.mjs'/, '队列必须走底部槽模型');
  assert.match(dock, /const slot = bottomSlotPlan\(\{ queue: expanded \|\| needsYou \? 'expanded' : 'folded', viewportHeight: typeof window === 'undefined' \? 900 : window\.innerHeight, selecting \}\)/, '三态输入必须齐全（S7 的追问不折叠也在内）');
  assert.match(dock, /const showBody = slot\.state === 'expanded'/, '展开层只由模型裁决');
  assert.match(dock, /data-slot=\{slot\.state\}/, '状态必须写进 DOM（样式/守卫都靠它）');
  assert.match(dock, /\{showBody && <div [^>]*data-block="dock-body">/, '收起时不许渲染记录体（空闲 48px 是硬约束）');
});

test('让位是结构性的：主列视口高、页面区可收缩、底栏不遮挡', () => {
  const styles = readStyles();
  assert.match(styles, /\.work-surface\.is-canvas \{ height: 100vh; display: flex; flex-direction: column; padding-bottom: 0; \}/, '画布视图主列必须固定视口高');
  assert.match(styles, /\.work-surface\.is-canvas \.work-scroll \{ flex: 1 1 auto; min-height: 0; overflow: auto; \}/, '页面区必须是可收缩的滚动区');
  assert.match(styles, /\.request-composer \{[^}]*min-height: 48px;/, 'composer 行高是空闲预算：48px');
  assert.match(styles, /\.request-dock-body \{ display: grid; gap: 8px; max-height: min\(320px, 35vh\); overflow: auto; \}/, '展开上限按 S1：min(320px, 35vh)');
});
