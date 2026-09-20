import { useEffect, useRef } from 'react';
import { isDismissKey, shouldDismissOnChange, shouldDismissOnPointerDown, shouldDismissOnSelect } from '../disclosure-model.mjs';

/**
 * 当前打开的浮层（模块级，不经过 React）。
 *
 * 用模块级而非 context：这些浮层散在顶栏、画布、rail、设置页四个互不嵌套的子树里，
 * 为了「同屏只开一个」而套一层 Provider，收益远小于把树改复杂。
 * 每个实例的 effect 卸载时会把自己摘掉，不会泄漏。
 */
const openDisclosures = new Set();

/**
 * 可收起的浮层（界面宪法 §5.2「点开切换」+ 菜单收回）。
 *
 * 原生 `<details>` 的语义、键盘行为、无障碍都由浏览器给，这里一个字都不重写；
 * 只补四件浏览器不管的事：
 *   ① 面板里选中按钮 → 收（选完就收）；面板里下拉**选完**（change）也收；
 *   ② 点浮层之外的任何地方 → 收；
 *   ③ Esc → 收，并把焦点还给 `summary`（键盘用户不会被扔在页面开头）；
 *   ④ 同屏只开一个 —— 开新的先收旧的。
 *
 * ⚠️ **不接管开合状态**：`open` 属性仍然只由 DOM 持有，React 里没有影子 state。
 * 这里做的是「事件里把属性改掉」，不是「用 state 渲染 open」——后者会让
 * 浏览器自己的 toggle、表单提交、无障碍树全部失真（这个仓库反复踩过影子状态的坑）。
 *
 * @param {{
 *   className?: string,
 *   summary: import('react').ReactNode,
 *   children?: import('react').ReactNode,
 *   closeOnSelect?: boolean,
 *   [key: string]: any
 * }} props
 *   `closeOnSelect` 默认 true。纯开关类面板（编辑设置里的吸附/小地图）传 false：
 *   那些按钮是「调一下继续调」，收掉反而要点第二次。
 */
export function Disclosure({ className = '', summary, children, closeOnSelect = true, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const entry = { node };
    const close = () => {
      node.open = false;
      openDisclosures.delete(entry);
    };
    const onPointerDown = (event) => {
      if (shouldDismissOnPointerDown({ open: node.open, node, target: event.target })) close();
    };
    const onKeyDown = (event) => {
      if (!node.open || !isDismissKey(event.key)) return;
      // 不让 Esc 继续往上冒：它先是「关掉这个浮层」，不该顺手再关别的什么。
      event.stopPropagation();
      close();
      node.querySelector('summary')?.focus();
    };
    const onClick = (event) => {
      if (closeOnSelect && node.open && shouldDismissOnSelect({ node, target: event.target })) close();
    };
    // 下拉（`<select>`）**选完**才收：点开系统下拉的那一刻不收，值变了才收。
    const onChange = (event) => {
      if (closeOnSelect && node.open && shouldDismissOnChange({ node, target: event.target })) close();
    };
    const onToggle = () => {
      if (!node.open) {
        openDisclosures.delete(entry);
        return;
      }
      // 遍历副本：收别人时会触发它们的 toggle，正本边遍历边改会漏项。
      for (const other of [...openDisclosures]) {
        if (other.node !== node) other.node.open = false;
      }
      openDisclosures.clear();
      openDisclosures.add(entry);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    node.addEventListener('click', onClick);
    node.addEventListener('change', onChange);
    node.addEventListener('toggle', onToggle);
    // 初始就是展开的（服务端渲染或属性直写），同样要登记，否则「只开一个」会漏掉它。
    if (node.open) openDisclosures.add(entry);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      node.removeEventListener('click', onClick);
      node.removeEventListener('change', onChange);
      node.removeEventListener('toggle', onToggle);
      openDisclosures.delete(entry);
    };
  }, [closeOnSelect]);
  return <details ref={ref} className={className} {...rest}>
    {summary}
    {children}
  </details>;
}