import { Columns3, GitFork, ImagePlus, LockKeyhole, Sparkles, Tag, Trash2, X } from 'lucide-react';
import { CREATIVE_ACTION_BY_ID, CREATIVE_ACTION_ENTRIES } from './creative-actions.mjs';
import { DRAFT_BOUNDARY_COPY } from './boundary-copy.mjs';
import { Disclosure } from './components/Disclosure.jsx';

const EMPTY = [];

function listItems(value) {
  return Array.isArray(value) ? value : EMPTY;
}

function creativeActionDisabledReason(action, { assetCount = 0, selectedTask = null } = {}) {
  if (!selectedTask && ['derive', 'feedback'].includes(action.kind)) return '请先选择或创建一个任务。';
  if (['derive', 'feedback', 'reference'].includes(action.kind) && !assetCount) return '请先选择至少一张可用图片。';
  return '';
}

export function CreativeActionLauncher({ assets = EMPTY, selectedTask = null, fallbackTask = null, selectedRound = null, label = '继续创作', compact = false, onOpenDerive, onAddReference, onReject, onOpenReference }) {
  const sourceAssets = listItems(assets).filter((asset) => asset && !asset.deletedAt);
  const assetCount = sourceAssets.length;
  const activeTask = selectedTask || fallbackTask;
  const context = { assetCount, selectedTask: activeTask, selectedRound };
  const deriveActions = CREATIVE_ACTION_ENTRIES.filter((action) => action.kind === 'derive');
  const referenceAction = CREATIVE_ACTION_BY_ID['add-as-reference'];
  const feedbackAction = CREATIVE_ACTION_BY_ID['feedback-to-next-round'];
  const runDerive = (action) => {
    onOpenDerive?.(sourceAssets, action.purpose, action.id);
  };
  const runReference = (usage) => {
    onAddReference?.(sourceAssets, usage);
  };
  const runReject = (createNextRound = false) => {
    onReject?.(sourceAssets, { createNextRound });
  };
  const referenceReason = referenceAction ? creativeActionDisabledReason(referenceAction, context) : '参考动作不可用。';
  const feedbackReason = feedbackAction ? creativeActionDisabledReason(feedbackAction, context) : '反馈动作不可用。';
  const referenceGuidance = !selectedRound
    ? '未锁定批次：点击用途后先选一个还没开工的批次；有多个时再选。'
    : selectedRound.status === 'draft'
      ? '当前这一轮还没开工，可以直接保存参考。'
      : '当前这一轮已锁定；可以选其他还没开工的批次，或新建一轮。';
  return <Disclosure className={'creative-action-launcher ' + (compact ? 'is-compact' : '')} summary={<summary><Sparkles size={15} /><span className="creative-action-summary-copy"><b>{label}</b><small>{assetCount ? assetCount + ' 张已选' : '未选图片'}</small></span></summary>}>
    <div className="creative-action-panel" aria-label="创作动作入口">
      <section className="creative-action-section is-derive"><header><p className="eyebrow">继续创作</p><span>选择下一轮方向</span></header><div className="creative-action-grid">{deriveActions.map((action) => { const reason = creativeActionDisabledReason(action, context); return <button type="button" key={action.id} className={'creative-action-card ' + (action.id === 'more-similar' ? 'is-primary' : '')} disabled={Boolean(reason)} title={reason || action.description} onClick={() => runDerive(action)}><Sparkles size={15} /><span><b>{action.title}</b><small>{reason || action.description}</small></span></button>; })}</div></section>
      <section className="creative-action-section is-reference"><header><p className="eyebrow">作为参考</p><span>先选用途，再选还没开工的批次</span></header><div className="creative-reference-grid"><button type="button" className="creative-reference-chip" disabled={Boolean(referenceReason)} title={referenceReason || referenceAction?.description} onClick={() => runReference('subject')}><ImagePlus size={15} /><span>主体</span></button><button type="button" className="creative-reference-chip" disabled={Boolean(referenceReason)} title={referenceReason || referenceAction?.description} onClick={() => runReference('style')}><Tag size={15} /><span>风格</span></button><button type="button" className="creative-reference-chip" disabled={Boolean(referenceReason)} title={referenceReason || referenceAction?.description} onClick={() => runReference('composition')}><Columns3 size={15} /><span>构图</span></button><button type="button" className="creative-reference-chip" disabled={Boolean(referenceReason)} title={referenceReason || referenceAction?.description} onClick={() => runReference('negative')}><Trash2 size={15} /><span>反例</span></button></div><small className="creative-action-guidance">{referenceReason || referenceGuidance}</small></section>
      <section className="creative-action-section is-feedback"><header><p className="eyebrow">不采用反馈</p><span>保存判断或转下一轮</span></header><div className="creative-action-grid is-compact"><button type="button" className="creative-action-card" disabled={Boolean(feedbackReason)} title={feedbackReason || feedbackAction?.description} onClick={() => runReject(true)}><GitFork size={15} /><span><b>开下一轮</b><small>{feedbackReason || '记录原因，创建带反例和修正目标的草稿。'}</small></span></button><button type="button" className="creative-action-card" disabled={!assetCount} title={assetCount ? '只记录评审，不创建批次。' : '请先选择至少一张可用图片。'} onClick={() => runReject(false)}><X size={15} /><span><b>只记录不采用</b><small>{assetCount ? '保存结构化反馈，之后可再转成下一轮。' : '请先选择图片。'}</small></span></button></div></section>
      <section className="creative-action-boundary"><LockKeyhole size={15} /><span>{DRAFT_BOUNDARY_COPY}</span>{!assetCount && selectedRound?.status === 'draft' && <button type="button" className="outline-button" onClick={() => onOpenReference?.()}>添加本轮参考素材</button>}</section>
    </div>
  </Disclosure>;
}
