import { useEffect, useRef, useState } from 'react';
import { layoutAuditLine, layoutBudgets } from '../layout-audit.mjs';

/**
 * 布局体检覆盖层（界面方案 §8.1 / 批 A A6 · 决策 D6）。
 *
 * 只在 URL 带 `?audit=layout` 时挂载（**生产零开销**：不带参数时这个组件根本不在树里）。
 * 它把 S1 从口号变成数字：**主区占比 / 顶部 chrome / 首元素 y / 常驻横带数**，
 * 并把同一行打到控制台，验收证据直接复制。
 *
 * 口径全部来自 `layout-audit.mjs`（单一来源，带单测）；这里只负责**量**与**显示**。
 */
const KIND_BY_LAYOUT = Object.freeze({ wide: 'workbench', standard: 'list', narrow: 'reading' });

function heightOf(region) {
  const element = document.querySelector('[data-region="' + region + '"]');
  return element ? Math.round(element.getBoundingClientRect().height) : 0;
}

export function LayoutAuditOverlay({ layout = 'standard', screen = '' }) {
  const [result, setResult] = useState(null);
  const lastLine = useRef('');
  useEffect(() => {
    const measure = () => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const page = document.querySelector('[data-region="page"]');
      const regions = {
        topbar: heightOf('topbar'),
        status: heightOf('status'),
        header: heightOf('header'),
        toolbar: heightOf('toolbar'),
        bottom: heightOf('bottom'),
        firstElementY: page ? Math.round(page.getBoundingClientRect().top) : 0,
        // 常驻横带：顶部（topbar / 状态槽）+ 底部槽，各自存在才算一条。
        bands: ['topbar', 'status', 'bottom'].filter((region) => heightOf(region) > 0).length
      };
      const next = layoutBudgets({ kind: KIND_BY_LAYOUT[layout] || 'list', viewport, regions });
      setResult(next);
      // 同一行只打一次（ResizeObserver 会连着触发）；值变了才再打，便于复制证据。
      const line = layoutAuditLine({ kind: next.kind, viewport, result: next, screen });
      if (line !== lastLine.current) { lastLine.current = line; window.console?.log?.('[layout-audit] ' + line); }
    };
    measure();
    const observer = new ResizeObserver(() => measure());
    for (const element of document.querySelectorAll('[data-region]')) observer.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [layout, screen]);

  if (!result) return null;
  const bad = (id) => result.violations.some((item) => item.id === id);
  return <aside className="layout-audit" data-region="audit" aria-label="布局体检">
    <header><b>布局体检 · {result.kind}</b><span>{screen}</span></header>
    <dl>
      <div><dt>主区占比</dt><dd className={bad('contentRatio') ? 'is-bad' : ''}>{Math.round(result.contentRatio * 100)}%</dd></div>
      <div><dt>顶部 chrome</dt><dd className={bad('topChrome') ? 'is-bad' : ''}>{result.topChrome}px</dd></div>
      <div><dt>首元素 y</dt><dd className={bad('firstElementY') ? 'is-bad' : ''}>{result.firstElementY}px</dd></div>
      <div><dt>常驻横带</dt><dd className={bad('bands') ? 'is-bad' : ''}>{result.bands}</dd></div>
    </dl>
    {result.violations.length > 0
      ? <p className="layout-audit-bad">越界：{result.violations.map((item) => item.id + ' ' + item.actual + ' > ' + item.limit).join('；')}</p>
      : <p className="layout-audit-ok">全部达标</p>}
    {result.expanded && <p className="layout-audit-note">底部槽展开中：按让位后计算，不看占比阈值。</p>}
  </aside>;
}
