/**
 * 页面工具条（界面方案 §5.5 / 批 A A2）。
 *
 * 判据（宪法 §4.4）：**工具条只回答「怎么看」**——视角 / 筛选 / 搜索，加**页面级创建**。
 * 「对某个东西做什么」不许进这里：批量动作属于「有作用对象」，去选中后浮现的浮条（I4）。
 *
 * 48px 单行；可见按钮 ≤7，其余进「更多 ▾」（S1 第 3 条）。
 */
export function PageToolbar({ children, label = '页面工具条', trailing = null }) {
  return <div className="page-toolbar" data-block="toolbar" role="toolbar" aria-label={label}>
    <div className="page-toolbar-leading" data-block="toolbar-leading">{children}</div>
    {trailing && <div className="page-toolbar-trailing" data-block="toolbar-trailing">{trailing}</div>}
  </div>;
}
