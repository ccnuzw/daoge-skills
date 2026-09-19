import { useState } from 'react';
import { Send, X, CircleAlert, MessageSquare, Check, CornerDownLeft } from 'lucide-react';
import { requestCardPresentation, queueAttention } from './request-queue-model.mjs';
import { agentPresencePresentation } from './agent-presence-model.mjs';
import { detectedCliSummary, queueAttentionThresholdMs, MIN_ATTENTION_MINUTES, MAX_ATTENTION_MINUTES } from './agent-connection-model.mjs';

/**
 * 催什么，取决于**下一步该做什么**——三句话对应三个不同的动作。
 * （「不在场 → 去唤起」与「在场但没接 → 去说一声」是两件事，不能共用一句话。）
 */
function attentionMessage(attention) {
  if (attention.reason === 'present-waiting') return '这一条已经排上了；去会话里说一声，agent 一入场就会接单。';
  // 被领过但没完成——**不许说「还没人接」**，那与卡片上的「已被领取 N 次」自相矛盾。
  if (attention.reason === 'requeued') return '这一条之前被接过的 agent 没做完就断了，已经回到队列；唤起 agent 会重新接单。';
  if (attention.reason === 'backlog') return '已经积了几条，agent 可能不在场；唤起它就会接单。';
  return '这一条还没人接；agent 不在场时，唤起它就会接单。';
}

/**
 * 请求队列的界面（方案 4.2 / 4.5 / 4.6）。
 *
 * 三条硬要求：
 *   - 输入框**必须足够自由**：绝不是「从下拉里选模板」，用户要能指定用哪个 skill（4.6）；
 *   - 请求卡片说人话，四种形态各有说法（4.5）；
 *   - 追问**就地回答**，不离开画布、不丢圈选的指代（8.10#8）。
 *
 * Studio 仍然不执行任何出图——这里只是排队叫号机，执行方永远是装着 skill 的 agent。
 */
export function RequestQueueDock({ requests, pendingCount, busy, presence, context, progress, onSend, onWithdraw, onAnswer, onOpenRound, onEditPlan, detection, detectionLoading, onDetect, connection, onConnectionChange, providerNotice = '' }) {
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  // ⚠️ 在场**只有一个来源**（presence 对象）。
  // 这里曾经另有一个 `present` 属性，但调用方只传了 presence，于是它恒为 false——
  // 界面就一边说「agent 在场」、一边说「agent 不在场时」，自相矛盾。
  // 判据收成一处之后，这种矛盾在结构上不可能再出现。
  const present = presence?.present === true;
  // C4：催促超时是「少而必要」的可配项（默认 2 分钟），所以把它交给 queueAttention。
  const attention = queueAttention({ requests, present, now: Date.now(), thresholdMs: queueAttentionThresholdMs(connection?.attentionMinutes) });
  // 「在场 ≠ 胜任」：没申报 daoge-pic 时，就在输入框旁说清楚（4.6）。
  const agent = agentPresencePresentation(presence, { now: Date.now() });
  const active = requests.filter((request) => ['pending', 'accepted'].includes(request.status));
  const visible = expanded ? requests.slice(0, 20) : active.slice(0, 4);
  const canSend = Boolean(context?.projectId) && Boolean(draft.trim()) && !busy;
  // 侦查摘要只算一次——它同时给标题、行、未检测到的名单用。
  const summary = detection ? detectedCliSummary(detection) : null;

  const submit = () => {
    if (!canSend) return;
    const value = draft;
    setDraft('');
    void onSend(value, context).then((sent) => { if (sent) setExpanded(true); });
  };

  return <section className="request-dock" data-region="bottom" aria-label="请求队列">
    <div className="request-composer">
      <MessageSquare size={16} aria-hidden="true" />
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } }}
        placeholder={context?.projectId ? '说一句：这几张再亮一点 / 出 10 张 4:5 的照片 / 帮我看看这批怎么样（Enter 发送，Shift+Enter 换行）' : '先在顶栏选一个项目，再说这句话'}
        aria-label="向 agent 说一句"
        rows={1}
        disabled={!context?.projectId}
      />
      <button type="button" className="command-button" disabled={!canSend} onClick={submit}><Send size={15} />{busy ? '发送中' : '发起'}</button>
      <button type="button" className="outline-button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>{expanded ? '收起记录' : '全部记录'}{pendingCount ? ' · ' + pendingCount + ' 待接' : ''}</button>
    </div>
    <p className={'request-agent is-' + agent.tone} role="status"><span className="request-agent-dot" aria-hidden="true" />{agent.label}{agent.detail ? ' · ' + agent.detail : ''}</p>
    {providerNotice && <p className="request-provider-notice" role="status"><CircleAlert size={14} aria-hidden="true" />{providerNotice}</p>}
    {attention.attention && <p className="request-attention" role="status"><CircleAlert size={14} aria-hidden="true" />{attentionMessage(attention)}</p>}
    <details className="request-connection" onToggle={(event) => { if (event.currentTarget.open) void onDetect?.(); }}>
      <summary>连接与唤起</summary>
      <div className="request-connection-body">
        <section className="request-connection-detect" aria-live="polite">
          <p className="eyebrow">这台机器上装了什么</p>
          {detectionLoading && !summary ? <p className="request-connection-line">正在侦查…</p> : summary ? <><p className="request-connection-line">{summary.headline} · {summary.skillLine}</p><ul className="request-connection-clis">{summary.installedRows.map((row) => <li key={row.name}><b>{row.title}</b><span>{row.detail}</span></li>)}</ul>{summary.missingNames.length > 0 && <p className="request-connection-line">另有 {summary.missingNames.length} 个未检测到：{summary.missingNames.join('、')}</p>}</> : <p className="request-connection-line">展开时自动侦查，不打扰。</p>}
        </section>
        <section className="request-connection-config">
          <p className="eyebrow">怎么唤起 agent</p>
          <label>唤起命令<input value={connection?.invokeCommand || ''} onChange={(event) => onConnectionChange?.({ invokeCommand: event.target.value })} placeholder="例如：codex / claude / opencode / omp / pi / grok" aria-label="唤起 agent 的命令" /></label>
          <label>催促超时（分钟）<input type="number" min={MIN_ATTENTION_MINUTES} max={MAX_ATTENTION_MINUTES} value={connection?.attentionMinutes ?? MIN_ATTENTION_MINUTES} onChange={(event) => onConnectionChange?.({ attentionMinutes: event.target.value })} aria-label="agent 离线催促超时分钟数" /></label>
          <p className="request-connection-note">超时只影响「多久开始催你」；agent 的 skills 归宿主管理，Studio 只侦查不代管。</p>
        </section>
      </div>
    </details>
    {visible.length > 0 && <ul className="request-cards">{visible.map((request) => <RequestCard key={request.id} request={request} busy={busy} progress={progress ? progress(request) : null} onWithdraw={onWithdraw} onAnswer={onAnswer} onOpenRound={onOpenRound} onEditPlan={onEditPlan} />)}</ul>}
  </section>;
}

function RequestCard({ request, busy, progress: progressValue, onWithdraw, onAnswer, onOpenRound, onEditPlan }) {
  const card = requestCardPresentation(request);
  const [answer, setAnswer] = useState('');
  const answerable = card.canAnswer && typeof onAnswer === 'function';
  const submitAnswer = () => {
    const value = answer.trim();
    if (!value) return;
    setAnswer('');
    void onAnswer(request, value);
  };
  return <li className={'request-card is-' + card.kind} data-tone={card.tone}>
    <div className="request-card-main">
      {/* 状态**只由进度模型说一次**。这里原来还渲染一个 card.label，
          于是 pending 时出现两遍「等待接单」——重复不是信息。 */}
      <p className="request-card-text">{request.text}</p>
    </div>
    {progressValue && <div className={'request-card-progress is-' + progressValue.stage} role="status">
      <span className="request-card-stage">{progressValue.label}</span>
      {progressValue.detail && <span className="request-card-stage-detail">{progressValue.detail}</span>}
      {/* 4.1 回执：把「我准备这么出」摆回来——人只需要核对那一句（尤其是「有没有上一批」）。 */}
      {progressValue.receipt?.ready && <ul className="request-card-receipt">{progressValue.receipt.lines.map((line) => <li key={line}>{line}</li>)}</ul>}
      {progressValue.canConfirm && <span className="request-card-actions"><button type="button" className="command-button request-card-confirm" disabled={busy} onClick={() => void onOpenRound?.(progressValue.roundId)}>就这么出</button><button type="button" className="outline-button request-card-edit" disabled={busy} onClick={() => void onEditPlan?.(progressValue.roundId)}>改一下</button></span>}
      {progressValue.canWatch && !progressValue.canConfirm && <button type="button" className="outline-button request-card-watch" disabled={busy} onClick={() => void onOpenRound?.(progressValue.roundId)}>看这一批</button>}
    </div>}
    {card.text && <p className="request-card-note">{card.text}</p>}
    {card.reply && <p className="request-card-note is-reply"><Check size={13} aria-hidden="true" />{card.reply}</p>}
    {card.needsInput && <p className="request-card-note is-question">{card.question}</p>}
    {answerable && <div className="request-card-answer">
      <input value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitAnswer(); } }} placeholder="把你的回答写在这里，agent 会接着这一条继续" aria-label="回答 agent 的追问" />
      <button type="button" className="outline-button" disabled={!answer.trim() || busy} onClick={submitAnswer}><CornerDownLeft size={14} />回答</button>
    </div>}
    {card.canWithdraw && <button type="button" className="request-card-withdraw" onClick={() => void onWithdraw(request.id)} disabled={busy} aria-label="撤回这条请求"><X size={13} />撤回</button>}
  </li>;
}
