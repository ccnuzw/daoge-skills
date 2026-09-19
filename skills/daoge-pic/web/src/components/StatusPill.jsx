import { statusPresentation } from '../status-presentation.mjs';

/** 状态药丸：状态只由状态模型说一次（scope + value），不许各处自译。 */
export function StatusPill({ value = null, scope = 'generic', presentation = null }) {
  const semantics = presentation || statusPresentation(scope, value);
  return <span className={'status-pill ' + semantics.tone}>{semantics.label}</span>;
}
