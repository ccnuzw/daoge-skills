// 「点开的浮层什么时候收」的判据（界面宪法 §5.2「点开切换」+ 菜单收回）。
//
// 为什么要有这个文件：全站 20 多个浮层都是裸 `<details>`，**浏览器不会替你收**——
// 选完一项、点页面别处、按 Esc，它全都纹丝不动。修之前只有两处各打了一个补丁
// （`creative-action-launcher` 的选中即关、`shell-pieces` 的点外关），
// 于是「面包屑三段可以同时开着」「选完项目菜单还挂在那儿」就成了常态。
//
// 这里只放**纯判断**（要不要收），DOM 由 `components/Disclosure.jsx` 负责执行；
// 判断能被单测锁住（守卫见 tests/vnext/disclosure.test.js），执行只有一处。

/**
 * 面板里「选中它就等于这件事办完了」的元素。
 *
 * 一律按**动作**判定，不要求每个调用点自己记得调 `close()`——
 * 靠自觉的那种写法，正是这次 20 多个浮层里 18 个漏掉的原因。
 */
export const MENU_ITEM_SELECTOR = '[role="menuitem"], button, a[href]';

/** Esc / Escape 都算（不同浏览器与老习惯的两种写法）。 */
export function isDismissKey(key) {
  return String(key).toLowerCase() === 'escape';
}

/**
 * 指针按下时：**开着**且点在这个浮层**之外** → 收。
 *
 * 浮层里点任何地方都不在这里收：里面可能是选择、可能是拖动文本，
 * 「选完就收」交给 `shouldDismissOnSelect` 精确判定，不在这里一刀切。
 *
 * @param {{ open?: boolean, node?: Node | null, target?: Node | null }} input
 */
export function shouldDismissOnPointerDown({ open, node, target }) {
  if (!open || !node || !target) return false;
  if (typeof node.contains !== 'function') return false;
  return !node.contains(target);
}

/**
 * 面板里的**下拉选完**（`change`）→ 收。
 *
 * 与「选中按钮」分开判：点开一个 `<select>` 只是打开系统下拉，那一刻不该把卡片收走；
 * 真正办完事是**值变了**（change）。「每页 64 张」这类控件就属于这一种。
 */
export const SELECT_SELECTOR = 'select';

function landsInside(node, target, selector) {
  if (!node || !target || typeof target.closest !== 'function') return false;
  if (typeof node.contains !== 'function') return false;
  const item = target.closest(selector);
  return Boolean(item && node.contains(item));
}

/**
 * 点在面板里的按钮/菜单项上 → 收（**这就是本次要修的毛病**）。
 *
 * 判定用 `closest` 往上看：点中按钮里的图标或文字同样算数。
 * 点面板空白处不算——浮层不该因为随便点一下就没了。
 *
 * @param {{ node?: Element | null, target?: Element | null, selector?: string }} input
 */
export function shouldDismissOnSelect({ node, target, selector = MENU_ITEM_SELECTOR }) {
  return landsInside(node, target, selector);
}

/**
 * 面板里的下拉**选完** → 收（见 `SELECT_SELECTOR`）。
 *
 * @param {{ node?: Element | null, target?: Element | null, selector?: string }} input
 */
export function shouldDismissOnChange({ node, target, selector = SELECT_SELECTOR }) {
  return landsInside(node, target, selector);
}