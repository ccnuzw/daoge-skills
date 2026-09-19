/**
 * 页头（界面方案 §5.4 / 批 A A2）。
 *
 * 一行写清「这是什么页」+ 最多两个页面级动作；**不放导航**（导航在 rail 与面包屑，§5.2/§5.3）。
 * 高度上限写死在样式里（工作台面 ≤56、列表与阅读 ≤88，S1 第 6 条）。
 */
export function PageHeader({ title, kicker = '', description = '', children = null, level = 1 }) {
  const Heading = level === 2 ? 'h2' : 'h1';
  return <header className="page-header" data-block="header">
    <div className="page-header-copy">
      {kicker && <p className="eyebrow">{kicker}</p>}
      <Heading className="page-header-title">{title}</Heading>
      {description && <p className="page-header-description">{description}</p>}
    </div>
    {children && <div className="page-header-actions" data-block="header-actions">{children}</div>}
  </header>;
}
