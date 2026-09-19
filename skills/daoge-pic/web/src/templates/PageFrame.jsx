import { PageHeader } from '../components/PageHeader.jsx';
import { PageToolbar } from '../components/PageToolbar.jsx';

/**
 * 页面骨架（界面方案 §5.4 / 批 A A2）。
 *
 * 判据：**页面不得自定宽度、不得自造页头、不得在标题区放导航**。
 * 八屏共用这一个模板——宽度只由 `layout` 三档决定（token 里的 `--page-max-*`）。
 *
 * 对外稳定的是钩子（`data-region="page"` / `data-layout`）：测试与审计只许断言这两个，
 * 不许断言 class 字面量（§6.3）。
 */
export const PAGE_LAYOUTS = Object.freeze(['wide', 'standard', 'narrow']);

export function PageFrame({ layout = 'standard', title = '', description = '', actions = null, toolbar = null, children, className = '' }) {
  const tier = PAGE_LAYOUTS.includes(layout) ? layout : 'standard';
  const classes = ['page-frame', 'is-' + tier, className].filter(Boolean).join(' ');
  const hasHeader = Boolean(title || actions);
  return <section className={classes} data-region="page" data-layout={tier}>
    {hasHeader && <PageHeader title={title} description={description}>{actions}</PageHeader>}
    {toolbar && <PageToolbar>{toolbar}</PageToolbar>}
    {children}
  </section>;
}
