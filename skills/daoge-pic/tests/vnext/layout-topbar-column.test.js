const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource, readStyles } = require('./source-text');

/**
 * G25 · 「顶栏与内容列是同一条列」的守卫（界面宪法 §4 S3 / §5.2）。
 *
 * 实机复现（1920×900，真实 CSS）：
 *   · 修复前：顶栏左边缘比内容列右移 **414px**，宽度被冻在 689px（由文案长度决定）；
 *   · 仅改一个任务名长度 → 整条顶栏横移 12px；隐藏「当前会话」→ 横移 106px；
 *   · 窗口 1280→2560 → 左边缘漂 640px。
 *
 * 三条根因，各自锁一条断言：
 *   ① `.work-surface.is-canvas` 是纵向 flex，顶栏带 `margin:0 auto` ——
 *      **flex 里的 auto 外边距会取消拉伸**，元素被收缩成内容宽度再居中（中居 + 抖动）→
 *      修法是**同时给 `width:100%`**：宽度变成确定值，auto 外边距只分配剩余空间，不再决定宽度；
 *   ② 顶栏按 1560、页面列按 1680，两个宽度令牌打架（两条左边缘永远对不上）；
 *   ③ 内边距 `clamp(20px,4vw,64px)` 随窗口连续滑动（拖窗口时整块横移）。
 *
 * 2026-09-20（刀哥定）：内容列由「贴左」改为**居中**——顶栏 / 状态槽 / 页面列 / 底部槽
 * 仍是同一条列，只是对齐方式从「同一条左边缘」换成「同一条中轴」；宽度仍只来自 tier 令牌，
 * 且 ① 的兜底（`width:100%`）不许丢，否则 flex 里又会缩成内容宽度。
 */

const SHELL = 'web/src/styles/blocks/shell.css';
const TEMPLATES = 'web/src/styles/templates.css';
const TOKENS = 'web/src/tokens/tokens.css';

test('顶栏居中：宽度仍是 wide 档令牌 + width:100% 兜住 flex 的 auto 外边距', () => {
  const shell = readSource(SHELL);
  const rule = shell.match(/\.workspace-chrome \{[^}]*\}/)[0];
  assert.match(rule, /max-width:var\(--page-max-wide\)/, '顶栏宽度必须与页面列同一个令牌（wide 档）');
  assert.match(rule, /width:100%/, 'width:100% 是 flex 里 auto 外边距的兜底：缺了它顶栏会缩成内容宽度（S22）');
  assert.match(rule, /margin:0 auto var\(--space-1\)/, '顶栏与内容列同一条中轴（居中）；底边距 2026-09-20 由 12 收到 4（S28：分隔线下不留大空档）');
});

test('页面列居中，且 flex 容器里不被收窄', () => {
  const templates = readSource(TEMPLATES);
  const rule = templates.match(/\.page-frame \{[^}]*\}/)[0];
  assert.match(rule, /width:\s*100%/, '页面列宽度确定，才不会被 auto 外边距收成内容宽度');
  assert.match(rule, /margin:\s*0 auto/, '内容列居中（2026-09-20 刀哥定）');
});

test('内容最大宽度只有一个来源（--workbench-content-max 已退场）', () => {
  const styles = readStyles();
  assert.doesNotMatch(styles, /--workbench-content-max/, '1560 那个令牌必须退场：它和 wide 档差 120px，正是两条左边缘对不上的原因');
  assert.doesNotMatch(styles, /max-width:\s*1560px/, '样式层里不许再有写死的 1560（0 处 = 顶栏/状态条/底部槽/设置页同一条列）');
});

test('内边距是台阶不是连续值', () => {
  const shell = readSource(SHELL);
  const rule = shell.match(/\.work-surface \{[^}]*\}/)[0];
  assert.match(rule, /padding:\s*var\(--space-6\) var\(--workbench-page-pad\)/, '工作区左右内边距只能来自令牌');
  assert.doesNotMatch(rule, /vw/, '不许再用 vw 连续插值');
  const tokens = readSource(TOKENS);
  assert.match(tokens, /--workbench-page-pad:var\(--space-\d\)/, '令牌本身是固定档，不是 clamp/vw');
  assert.doesNotMatch(tokens, /--workbench-page-pad:clamp/, '令牌本身是固定档，不是 clamp/vw');
});

test('顶栏与页面内容共用同一条左边距（16px 的内缩只写一处）', () => {
  const shell = readSource(SHELL);
  const rule = shell.match(/\.workspace-chrome \{[^}]*\}/)[0];
  assert.match(rule, /padding:0 var\(--space-4\) var\(--space-2\)/, '顶栏内容内缩必须与 page-frame 的 16px 一致');
  const templates = readSource(TEMPLATES);
  const frame = templates.match(/\.page-frame \{[^}]*\}/)[0];
  assert.match(frame, /padding: var\(--space-1\) var\(--space-4\) 42px/, '页面列的内缩 16px、顶部留白 4px（2026-09-20 收敛：分隔线到内容整条 12px）');
});

test('面包屑与标题/搜索同一行（S28）：三条目同名网格，窄档才回到独立一行', () => {
  const shell = readSource(SHELL);
  const header = shell.match(/\.workspace-chrome \.surface-header \{[^}]*\}/)[0];
  assert.match(header, /grid-template-areas:"head ctx actions"/, '标题 / 面包屑 / 动作必须在同一行（面包屑原本独占 36px 一行，白丢 42px）');
  for (const area of ['head', 'ctx', 'actions']) {
    assert.match(shell, new RegExp('\\.workspace-chrome \\.[a-z-]+( \\.[a-z-]+)? \\{ grid-area:' + area), '三条目都要落到有名网格的各自区域：' + area);
  }
  const context = shell.match(/\.workspace-chrome \.workspace-context \{[^}]*\}/)[0];
  assert.doesNotMatch(context, /flex-wrap:\s*wrap/, '行内面包屑不许换行（换行会撑高 52px 的顶栏行）');
  // 窄档：1280 以下中间列不足 ~380px，三段名字会被切碎 —— 放回独立一行。
  const responsive = readSource('web/src/styles/blocks/responsive.css');
  assert.match(responsive, /@media \(max-width:1280px\) \{[^@]*grid-template-areas:"head actions" "ctx ctx"/, '1280 以下面包屑要回到自己一行');
});

test('画布工具条不折字、不静默裁切', () => {
  const canvas = readSource('web/src/styles/blocks/canvas.css');
  const actions = canvas.match(/\.lineage-actions \{[^}]*\}/)[0];
  assert.doesNotMatch(actions, /overflow: hidden/, 'overflow:hidden 会静默裁掉按钮（1024px 宽实测被挤成 42×62px 竖排）');
  assert.match(actions, /overflow-x: auto/, '放不下时左组横向滚动，按钮仍然可达');
  assert.match(canvas, /\.lineage-actions > button[^}]*flex: 0 0 auto/, '按钮不许被挤扁');
  assert.match(canvas, /\.lineage-toolbar-tail \{[^}]*flex: 0 0 auto/, '右组固定，收缩量全部由可滚动的左组吸收');
});