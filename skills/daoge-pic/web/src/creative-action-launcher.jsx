import { Columns3, GitFork, ImagePlus, LockKeyhole, Sparkles, Tag, Trash2, X } from 'lucide-react';
import { CREATIVE_ACTION_BY_ID, CREATIVE_ACTION_ENTRIES } from './creative-actions.mjs';

const EMPTY = [];

function listItems(value) {
  return Array.isArray(value) ? value : EMPTY;
}

function creativeActionDisabledReason(action, { assetCount = 0, selectedTask = null } = {}) {
  if (!selectedTask && ['derive', 'feedback'].includes(action.kind)) return '请先选择或创建一个任务。';
  if (['derive', 'feedback', 'reference'].includes(action.kind) && !assetCount) return '请先选择至少一张可用图片。';
  return '';
}

function closeContainingDetails(event) {
  event.currentTarget.closest('details')?.removeAttribute('open');
}

export function CreativeActionLauncher({ assets = EMPTY, selectedTask = null, fallbackTask = null, selectedRound = null, label = '继续创作', compact = false, onOpenDerive, onAddReference, onReject, onOpenReference }) {
  const sourceAssets = listItems(assets).filter((asset) => asset && !asset.deletedAt);
  const assetCount = sourceAssets.length;
  const activeTask = selectedTask || fallbackTask;
  const context = { assetCount, selectedTask: activeTask, selectedRound };
  const deriveActions = CREATIVE_ACTION_ENTRIES.filter((action) => action.kind === 'derive');
  const referenceAction = CREATIVE_ACTION_BY_ID['add-as-reference'];
  const feedbackAction = CREATIVE_ACTION_BY_ID['feedback-to-next-round'];
  const runDerive = (event, action) => {
    closeContainingDetails(event);
    onOpenDerive?.(sourceAssets, action.purpose, action.id);
  };
  const runReference = (event, usage) => {
    closeContainingDetails(event);
    onAddReference?.(sourceAssets, usage);
  };
  const runReject = (event, createNextRound = false) => {
    closeContainingDetails(event);
    onReject?.(sourceAssets, { createNextRound });
  };
  const referenceReason = referenceAction ? creativeActionDisabledReason(referenceAction, context) : '参考动作不可用。';
  const feedbackReason = feedbackAction ? creativeActionDisabledReason(feedbackAction, context) : '反馈动作不可用。';
  const referenceGuidance = !selectedRound
    ? '未锁定轮次：点击用途后先选择或创建草稿轮次；有多个轮次时再选择。'
    : selectedRound.status === 'draft'
      ? '当前为草稿轮次，可直接保存参考。'
      : '当前轮次已锁定；可选择其他草稿轮次或新建轮次。';
  return <details className={'creative-action-launcher ' + (compact ? 'is-compact' : '')}>
    <summary><Sparkles size={15} /><span className="creative-action-summary-copy"><b>{label}</b><small>{assetCount ? assetCount + ' 张已选' : '当前上下文'}</small></span></summary>
    <div className="creative-action-panel" aria-label="创作动作入口">
      <section className="creative-action-section is-derive"><header><p className="eyebrow">继续创作</p><span>选择下一轮方向</span></header><div className="creative-action-grid">{deriveActions.map((action) => { const reason = creativeActionDisabledReason(action, context); return <button type="button" key={action.id} className={'creative-action-card ' + (action.id === 'more-similar' ? 'is-primary' : '')} disabled={Boolean(reason)} title={reason || action.description} onClick={(event) => runDerive(event, action)}><Sparkles size={15} /><span><b>{action.title}</b><small>{reason || action.description}</small></span></button>; })}</div></section>
      <section className="creative-action-section is-reference"><header><p className="eyebrow">作为参考</p><span>先选用途，再选草稿轮次</span></header><div className="creative-reference-grid"><button type="button" className="creative-reference-chip" disabled={Boolean(referenceReason)} title={referenceReason || referenceAction?.description} onClick={(event) => runReference(event, 'subject')}><ImagePlus size={15} /><span>主体</span></button><button type="button" className="creative-reference-chip" disabled={Boolean(referenceReason)} title={referenceReason || referenceAction?.description} onClick={(event) => runReference(event, 'style')}><Tag size={15} /><span>风格</span></button><button type="button" className="creative-reference-chip" disabled={Boolean(referenceReason)} title={referenceReason || referenceAction?.description} onClick={(event) => runReference(event, 'composition')}><Columns3 size={15} /><span>构图</span></button><button type="button" className="creative-reference-chip" disabled={Boolean(referenceReason)} title={referenceReason || referenceAction?.description} onClick={(event) => runReference(event, 'negative')}><Trash2 size={15} /><span>反例</span></button></div><small className="creative-action-guidance">{referenceReason || referenceGuidance}</small></section>
      <section className="creative-action-section is-feedback"><header><p className="eyebrow">不采用反馈</p><span>保存判断或转下一轮</span></header><div className="creative-action-grid is-compact"><button type="button" className="creative-action-card" disabled={Boolean(feedbackReason)} title={feedbackReason || feedbackAction?.description} onClick={(event) => runReject(event, true)}><GitFork size={15} /><span><b>开下一轮</b><small>{feedbackReason || '记录原因，创建带反例和修正目标的草稿。'}</small></span></button><button type="button" className="creative-action-card" disabled={!assetCount} title={assetCount ? '只记录评审，不创建轮次。' : '请先选择至少一张可用图片。'} onClick={(event) => runReject(event, false)}><X size={15} /><span><b>只记录不采用</b><small>{assetCount ? '保存结构化反馈，之后可再转成下一轮。' : '请先选择图片。'}</small></span></button></div></section>
      <section className="creative-action-boundary"><LockKeyhole size={15} /><span>这些动作只写入草稿上下文、参考关系或评审反馈；不会确认、预检、创建 Generation Run 或访问 Provider。</span>{!assetCount && selectedRound?.status === 'draft' && <button type="button" className="outline-button" onClick={(event) => { closeContainingDetails(event); onOpenReference?.(); }}>添加本轮参考素材</button>}</section>
    </div>
  </details>;
}
