import { CircleAlert, LoaderCircle, LockKeyhole, RefreshCw, X } from 'lucide-react';
import { IconButton } from '../components/IconButton.jsx';
import { useEffect, useRef, useState } from 'react';
import { canRetryWorkbenchError, errorMessageForDisplay, errorPresentation, isAbortError } from '../error-model.mjs';
import { bootstrapLocalStudioSession } from '../local-auth.mjs';
import { negotiateStudioVersion, versionProbeRequest } from '../version-negotiation-model.mjs';
import { ROUND_PURPOSE_LABELS, listItems } from '../app/creation-model.mjs';
import { api } from '../app/api.js';
import { StatusPill } from '../components/StatusPill.jsx';

import { statusPresentation } from '../status-presentation.mjs';

const EMPTY = [];

function statusLabel(value) { return statusPresentation('generic', value).label; }

// `presentation` 和 `value` 二选一：传了解析好的展示结果就不用再传原始状态值，
// 没传时由 `scope` + `value` 现场解析。

/** 界面批 E 从 main.jsx 搬出（行为零变化）。 */

export function SessionPlanSummary({ sessionPlanStatus, onRestoreContext }) {
  const detailsRef = useRef(null);
  useEffect(() => {
    const closeOnOutsidePointer = (event) => {
      const details = detailsRef.current;
      if (!details?.open || details.contains(event.target)) return;
      details.open = false;
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, []);
  if (!sessionPlanStatus) return null;
  const context = sessionPlanStatus.context;
  const purpose = context ? (({ exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' })[context.round.purpose] || context.round.purpose) : '';
  const compactLabel = context ? purpose + ' · 计划 v' + context.round.planVersion : '未绑定批次';
  return <details ref={detailsRef} className={'session-plan-summary ' + (!context ? 'is-empty' : '')}>
    <summary><LockKeyhole size={14} aria-hidden="true" /><span>当前会话</span><b>{compactLabel}</b></summary>
    <div className="session-plan-popover" aria-label="当前会话只读计划摘要">
      {context ? <><p className="eyebrow">当前选择</p><h3>{context.project.name} / {context.task.name}</h3><span>{purpose} · 计划 v{context.round.planVersion}</span><div className="session-plan-state"><StatusPill value={context.round.status} scope="round" /><span>{sessionPlanStatus.confirmation?.confirmed ? '当前计划已由用户确认' : '当前计划尚未人工确认'}</span>{sessionPlanStatus.latestRun && <span>最近运行：{statusLabel(sessionPlanStatus.latestRun.status)}</span>}</div><button type="button" className="outline-button" onClick={onRestoreContext}>回到当前选择</button></> : <><p className="eyebrow">当前会话</p><h3>未绑定活动批次</h3><span>确认计划前，请先选择项目、任务和还没开工的批次。</span></>}
    </div>
  </details>;
}

export function WorkspaceContextBar({ project, projects = EMPTY, tasks = EMPTY, task, rounds, selectedRound, sessionPlanStatus, onSwitchProject, onSelectTask, onSelectRound, onRestoreContext }) {
  if (!project) return null;
  const roundOptions = selectedRound && !rounds.some((round) => round.id === selectedRound.id) ? [selectedRound, ...rounds] : rounds;
  const roundTaskLabel = (round) => !task && round?.taskId ? tasks.find((item) => item.id === round.taskId)?.name : '';
  const segment = (label, current, options, onPick, emptyHint) => <details className="breadcrumb-segment">
    <summary title={current ? label + '：' + current : label}>{label} · <b>{current || '未选'}</b></summary>
    <div className="breadcrumb-menu" role="menu">{options.length ? options : <span className="breadcrumb-empty">{emptyHint}</span>}</div>
  </details>;
  // 批 B B2/B3：这一条**只剩面包屑**——只读路径 + 点开切换；导航在 rail，动作另有其位（D1）。
  // 顶栏不放动作：新建批次去画布（空白双击/工具条），任务列表去 rail，导出一律在各自页面。
  return <div className="workspace-context" data-region="header">
    <nav className="workspace-breadcrumb" data-region="breadcrumb" aria-label="当前位置">
      {segment('项目', project.name, listItems(projects).map((item) => <button type="button" role="menuitem" key={item.id} className={item.id === project.id ? 'is-active' : ''} onClick={() => onSwitchProject?.(item.id)}>{item.name}</button>), '暂无其他项目')}
      <span className="breadcrumb-sep" aria-hidden="true">›</span>
      {segment('任务', task?.name || '', listItems(tasks).map((item) => <button type="button" role="menuitem" key={item.id} className={item.id === task?.id ? 'is-active' : ''} onClick={() => onSelectTask(item.id)}>{item.name}</button>), '这个项目还没有任务')}
      <span className="breadcrumb-sep" aria-hidden="true">›</span>
      {segment('批次', selectedRound ? '计划 v' + selectedRound.planVersion : '', roundOptions.map((round) => <button type="button" role="menuitem" key={round.id} className={round.id === selectedRound?.id ? 'is-active' : ''} onClick={() => onSelectRound(round.id)}>{(ROUND_PURPOSE_LABELS[round.purpose] || round.purpose) + ' · 计划 v' + round.planVersion + (roundTaskLabel(round) ? ' · ' + roundTaskLabel(round) : '')}</button>), '还没有批次')}
    </nav>
    <div className="workspace-breadcrumb-trailing"><SessionPlanSummary sessionPlanStatus={sessionPlanStatus} onRestoreContext={onRestoreContext} /></div>
  </div>;
}

export function WorkbenchErrorAlert({ error, className = 'error-strip', icon: Icon = CircleAlert, dismissLabel = '关闭请求错误', onDismiss, onRetry, onReconnect }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => setDetailsOpen(false), [error]);
  if (!error) return null;
  const presentation = typeof error === 'string' ? null : errorPresentation(error);
  const retryAllowed = presentation ? canRetryWorkbenchError(error) && typeof error?.retry === 'function' : false;
  const handlers = {
    ...(typeof onRetry === 'function' && retryAllowed ? { retry: onRetry } : {}),
    ...(typeof onReconnect === 'function' ? { reconnect: onReconnect } : {}),
    ...(typeof onDismiss === 'function' ? { continue: onDismiss } : {}),
    'view-details': () => setDetailsOpen((current) => !current)
  };
  const actions = presentation ? presentation.actions.filter((action) => action.id !== 'retry' || retryAllowed).filter((action) => typeof handlers[action.id] === 'function') : [];
  return <div className={className} role="alert" aria-live="assertive">
    <Icon size={16} aria-hidden="true" />
    <div className="workbench-error-content">
      {presentation?.title && <strong>{presentation.title}</strong>}
      <span>{errorMessageForDisplay(error, '无法完成当前操作。')}</span>
      {detailsOpen && presentation && <dl className="workbench-error-details"><div><dt>代码</dt><dd>{presentation.code || '未记录'}</dd></div><div><dt>请求标识</dt><dd>{presentation.requestId || '未记录'}</dd></div><div><dt>阶段</dt><dd>{presentation.phase || 'unknown'}</dd></div><div><dt>结果</dt><dd>{presentation.outcome || 'unknown'}</dd></div><div><dt>操作</dt><dd>{presentation.operation || '未记录'}</dd></div><div><dt>资源</dt><dd>{presentation.resource || '未记录'}</dd></div><div><dt>重试</dt><dd>{presentation.safeToRetry ? '仅可安全重试' : '不可自动重试'}</dd></div></dl>}
      {actions.length > 0 && <div className="workbench-error-actions">{actions.map((action) => <button type="button" className="outline-button" key={action.id} onClick={() => void handlers[action.id]()}>{action.label}</button>)}</div>}
    </div>
    {onDismiss && <IconButton label={dismissLabel} onClick={onDismiss}><X size={15} /></IconButton>}
  </div>;
}

