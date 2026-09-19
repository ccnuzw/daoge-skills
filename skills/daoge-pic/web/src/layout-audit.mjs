/**
 * 布局预算（界面方案 §4 S1 / §8.1 / 批 A A6 · 决策 D6）。纯函数，可单测。
 *
 * S1 的四条口径（审计覆盖层 `?audit=layout` 的数字全部由这里算出来）：
 *   内容占比 = (视口高 − 顶部 chrome − 底部槽常驻 48) / 视口高
 *   顶部 chrome = topbar + status + header + toolbar      （**不含**底部槽）
 *   首元素 y   = 第一个业务元素到视口顶部的距离
 *   常驻横带   = 顶部 + 底部的条数
 *
 * 三条判断写死在这里（不散落到组件）：
 *   ① 状态条出现时，topChrome 与 firstElementY 的阈值**各放宽 44px**（S1 第 2 条）；
 *   ② **展开态不设内容占比阈值**——达标判据只看折叠态（S1 第 7 条），
 *      因为「展开时让内容让位」本身就是设计，不该被当成越界；
 *   ③ 未知 kind 直接报错，不许悄悄按某一档算。
 */
export const STATUS_BAR_ALLOWANCE_PX = 44;
export const BOTTOM_SLOT_IDLE_PX = 48;
export const MAX_PERSISTENT_BANDS = 3;

export const LAYOUT_BUDGETS = Object.freeze({
  workbench: { contentRatio: 0.6, topChrome: 180, firstElementY: 190 },
  list: { contentRatio: 0.55, topChrome: 200, firstElementY: 210 },
  reading: { contentRatio: 0.45, topChrome: 240, firstElementY: 240 }
});

function px(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * @param {{ kind?: 'workbench'|'list'|'reading', viewport?: { width: number, height: number }, regions?: { topbar?: number, status?: number, header?: number, toolbar?: number, bottom?: number, firstElementY?: number, bands?: number } }} [input]
 */
export function layoutBudgets(input = {}) {
  const budget = LAYOUT_BUDGETS[input.kind];
  if (!budget) throw new Error('未知的页面类型（kind）：' + String(input.kind) + '；只认 workbench / list / reading');
  const height = Number(input.viewport?.height);
  if (!Number.isFinite(height) || height <= 0) throw new Error('视口高度不合法：' + String(input.viewport?.height));
  const regions = input.regions || {};
  const topbar = px(regions.topbar);
  const status = px(regions.status);
  const header = px(regions.header);
  const toolbar = px(regions.toolbar);
  const bottom = px(regions.bottom);
  const bands = px(regions.bands);
  const firstElementY = px(regions.firstElementY);
  const topChrome = topbar + status + header + toolbar;
  const contentRatio = (height - topChrome - bottom) / height;
  const allowance = status > 0 ? STATUS_BAR_ALLOWANCE_PX : 0;
  const expanded = bottom > BOTTOM_SLOT_IDLE_PX;
  const violations = [];
  if (!expanded && contentRatio + 1e-9 < budget.contentRatio) {
    violations.push({ id: 'contentRatio', actual: round(contentRatio), limit: budget.contentRatio, unit: 'ratio' });
  }
  if (topChrome > budget.topChrome + allowance) {
    violations.push({ id: 'topChrome', actual: topChrome, limit: budget.topChrome + allowance, unit: 'px' });
  }
  if (firstElementY > budget.firstElementY + allowance) {
    violations.push({ id: 'firstElementY', actual: firstElementY, limit: budget.firstElementY + allowance, unit: 'px' });
  }
  if (bands > MAX_PERSISTENT_BANDS) {
    violations.push({ id: 'bands', actual: bands, limit: MAX_PERSISTENT_BANDS, unit: 'count' });
  }
  return { kind: input.kind, contentRatio, topChrome, firstElementY, bands, bottom, expanded, allowance, violations };
}

/** 验收证据里那一行可复制的数字串（§8.4 的证据格式）。 */
export function layoutAuditLine({ kind, viewport, result, screen = '' }) {
  const percent = Math.round(result.contentRatio * 100);
  const mark = result.violations.length ? '⚠️ 越界：' + result.violations.map((item) => item.id).join('、') : '✓';
  return [screen || kind, viewport.width + '×' + viewport.height, '主区 ' + percent + '%', '顶部 chrome ' + result.topChrome + 'px', '首元素 y ' + result.firstElementY + 'px', '横带 ' + result.bands, mark].join(' / ');
}
