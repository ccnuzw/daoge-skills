import { statusSlotPlan } from '../status-slot-model.mjs';

/**
 * 状态槽（界面方案 §4 S7 / §5.1 / 批 A A4）。
 *
 * 一次只显示一条（优先级在 `status-slot-model.mjs` 里写死）；其余进「还有 N 条」折叠区，
 * **摘要里点名**（不静默）。`danger` 永远是被显示的那一条——它是优先级表的第一名。
 *
 * 每个 item：`{ id, tone, label, content }`——`content` 就是原来那条状态条本身（外观不变）。
 */
export function StatusSlot({ items = [], label = '系统状态' }) {
  const plan = statusSlotPlan(items);
  if (!plan.primary) return null;
  return <section className="status-slot" data-region="status" data-tone={plan.primary.tone} aria-label={label}>
    <div className="status-slot-primary" data-block="status-primary">{plan.primary.content}</div>
    {plan.overflowCount > 0 && <details className="status-slot-overflow" data-block="status-overflow">
      <summary>还有 {plan.overflowCount} 条 · {plan.overflowLabel}</summary>
      <div className="status-slot-overflow-body">{plan.overflow.map((item) => <div key={item.id}>{item.content}</div>)}</div>
    </details>}
  </section>;
}
