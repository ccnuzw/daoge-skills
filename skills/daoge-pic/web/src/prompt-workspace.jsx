import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ClipboardCopy, FileDiff, ImagePlus, Layers3, RefreshCw } from 'lucide-react';
import { planDiff, planPresentation, planStateLabel, ROUND_PURPOSE_LABELS } from './plan-presentation.mjs';

function stateTone(value) { return value === 'confirmed' ? 'ready' : value === 'awaiting_confirmation' ? 'pending' : 'draft'; }

export function PromptWorkspace({ round, planVersions, loading, onRefresh }) {
  const [comparison, setComparison] = useState([]);
  useEffect(() => { setComparison([]); }, [round?.id]);
  const selected = useMemo(() => planVersions.filter((plan) => comparison.includes(plan.planVersion)).sort((left, right) => left.planVersion - right.planVersion), [comparison, planVersions]);
  const differences = selected.length === 2 ? planDiff(selected[0].plan, selected[1].plan) : [];
  const toggleComparison = (version) => setComparison((current) => current.includes(version) ? current.filter((item) => item !== version) : [...current, version].slice(-2));
  const copyCurrent = async () => {
    const current = planVersions.find((plan) => plan.state === 'confirmed') || planVersions[0];
    if (current?.plan?.prompt && navigator.clipboard?.writeText) await navigator.clipboard.writeText(current.plan.prompt);
  };

  if (!round) return <section className="prompt-stage empty-stage"><Layers3 size={30} strokeWidth={1.15} /><p>先从左侧选择一个轮次，再查看可追溯的计划与提示词。</p></section>;
  return <section className="prompt-stage">
    <header className="prompt-stage-head"><div><p className="eyebrow">任务 / {ROUND_PURPOSE_LABELS[round.purpose] || round.purpose}轮次</p><h2>计划与提示词</h2><span>确认前由会话起草与修改；确认后此处保留只读版本证据。</span></div><div className="prompt-stage-actions"><button type="button" className="outline-button" onClick={onRefresh} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} />刷新版本</button><button type="button" className="outline-button" onClick={() => void copyCurrent()} disabled={!planVersions.some((plan) => plan.plan?.prompt)}><ClipboardCopy size={16} />复制当前提示词</button></div></header>
    {loading ? <div className="empty-stage"><RefreshCw size={26} className="spin" /><p>正在读取计划版本。</p></div> : !planVersions.length ? <div className="empty-stage"><Layers3 size={30} strokeWidth={1.15} /><p>当前轮次还没有可展示的计划版本。</p></div> : <>
      <div className="prompt-version-rail">{planVersions.map((version) => <label key={version.id || version.planVersion} className={'prompt-version-chip ' + (comparison.includes(version.planVersion) ? 'is-selected' : '')}><input type="checkbox" checked={comparison.includes(version.planVersion)} onChange={() => toggleComparison(version.planVersion)} /><span>v{version.planVersion}</span><small>{planStateLabel(version.state)}</small></label>)}</div>
      <div className="prompt-version-grid">{planVersions.map((version) => {
        const presentation = planPresentation(version.plan);
        return <article key={version.id || version.planVersion} className="prompt-version-card"><header><div><span className={'prompt-state ' + stateTone(version.state)}>{version.state === 'confirmed' && <Check size={13} />}{planStateLabel(version.state)}</span><h3>计划 v{version.planVersion}</h3></div><small>{version.confirmedAt ? '已于 ' + new Date(version.confirmedAt).toLocaleString('zh-CN') + ' 确认' : version.createdAt ? '创建于 ' + new Date(version.createdAt).toLocaleString('zh-CN') : '时间未知'}</small></header><dl><div><dt>操作</dt><dd>{presentation.operation}</dd></div><div><dt>计划数量</dt><dd>{presentation.itemCount === null ? '未设置' : presentation.itemCount + ' 张'}</dd></div><div><dt>画面比例</dt><dd>{presentation.aspectRatio}</dd></div><div><dt>分辨率</dt><dd>{presentation.resolution}</dd></div><div><dt>输出尺寸</dt><dd>{presentation.size}</dd></div><div><dt>像素尺寸</dt><dd>{presentation.dimensions}</dd></div><div><dt>参考素材</dt><dd>{presentation.references.length ? presentation.references.length + ' 张已绑定' : '无'}</dd></div></dl><section className="prompt-copy"><span>提示词</span><p>{presentation.prompt}</p></section>{presentation.references.length > 0 && <div className="prompt-references"><ImagePlus size={14} /><span>已绑定参考素材，生成前会由预检验证能力。</span></div>}</article>;
      })}</div>
      {selected.length === 2 && <section className="prompt-diff"><header><div><FileDiff size={18} /><div><p className="eyebrow">版本对比</p><h3>v{selected[0].planVersion} 与 v{selected[1].planVersion}</h3></div></div><small>{differences.length ? differences.length + ' 项变化' : '两版没有结构化差异'}</small></header>{differences.length ? <dl>{differences.map((item) => <div key={item.label}><dt>{item.label}</dt><dd><span>{item.before}</span><b>→</b><span>{item.after}</span></dd></div>)}</dl> : <p>计划的提示词、操作、数量、输出规格与参考素材一致。</p>}</section>}
    </>}
  </section>;
}
