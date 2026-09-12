import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ClipboardCopy, FileDiff, ImagePlus, Layers3, RefreshCw } from 'lucide-react';
import { planDiff, planPresentation, planStateLabel, ROUND_PURPOSE_LABELS } from './plan-presentation.mjs';

const ITEM_PROMPT_PREFIX = '\n\nSpecific scene direction for this image: ';
const OPENAI_GPT_IMAGE_PROMPT_LIMIT = 32000;
const RAW_FIELD_GROUPS = [
  { label: '基础', keys: ['operation', 'itemCount', 'draftKind', 'createdFrom', 'requestedConcurrency'] },
  { label: '输出规格', keys: ['output'] },
  { label: '创作简报', keys: ['brief', 'creativeIntent', 'constraints', 'notes', 'note', 'planningNotes'] },
  { label: '参考素材', keys: ['referenceAssetIds', 'referenceLabels', 'referenceMaterials', 'maskAssetId'] },
  { label: '主体 / 角色', keys: ['subject', 'hero_subject', 'heroSubject', 'characterProfiles', 'identity_constraints', 'identityConstraints', 'wardrobe', 'expression', 'setting'] },
  { label: '商品 / 包装', keys: ['product', 'productSpec', 'package_type', 'packageType', 'materials', 'selling_points', 'sellingPoints'] },
  { label: '品牌 / 渠道', keys: ['brand', 'brandSpec', 'brand_constraints', 'brandConstraints', 'platform', 'platformSpec', 'usage_scene', 'usageScene', 'campaign'] },
  { label: '场景 / 构图', keys: ['framingSpec', 'composition', 'compositionSpec', 'background', 'angle', 'camera_language', 'cameraLanguage', 'aspect_ratio', 'aspectRatio'] },
  { label: '真实感 / 风格', keys: ['realismSpec', 'styleSpec', 'visualStyle', 'visual_system', 'visualSystem', 'colorPalette'] },
  { label: '文案 / 排版', keys: ['copy', 'language', 'hierarchy', 'safe_area', 'safeArea', 'headline_safe_area', 'headlineSafeArea', 'text_safe_area', 'textSafeArea', 'cta_area', 'ctaArea', 'typography_constraints', 'typographyConstraints', 'label_policy', 'labelPolicy'] },
  { label: '分镜 / 系列', keys: ['story', 'storyboard', 'storyboardSpec', 'shot_list', 'shotList', 'continuity', 'series', 'seriesSlot', 'seriesSpec', 'product_flow', 'productFlow', 'device', 'information_hierarchy', 'informationHierarchy'] },
  { label: '学术 / 图解', keys: ['topic', 'claims', 'diagram_structure', 'diagramStructure', 'evidence_constraints', 'evidenceConstraints'] },
  { label: '衍生关系', keys: ['parentAssetIds', 'parentRoundId', 'derivation', 'referenceArrangement', 'feedbackToNextRound'] },
  { label: '变化 / 精修', keys: ['variationSpec', 'variationAxes', 'variationCatalog', 'creativeDistribution', 'keepConstraints', 'refinementGoals', 'editIntent', 'fillDirection'] },
  { label: '质量 / 风险', keys: ['qualityGates', 'riskNotes', 'failurePolicy', 'recovery', 'compositingWorkflow'] }
];
const RAW_GROUP_KEYS = new Set(['prompt', 'itemPrompts', ...RAW_FIELD_GROUPS.flatMap((group) => group.keys)]);
const RAW_OBJECT_FIELD_KEYS = new Set(['output', 'framingSpec', 'realismSpec', 'variationSpec', 'productSpec', 'brandSpec', 'platformSpec', 'compositionSpec', 'styleSpec', 'storyboardSpec', 'seriesSpec']);

function stateTone(value) { return value === 'confirmed' ? 'ready' : value === 'awaiting_confirmation' ? 'pending' : 'draft'; }
function asRecord(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function looksLikeAssetId(value) { return typeof value === 'string' && /^asset_[a-f0-9-]{20,}$/i.test(value); }
function displayValue(value) {
  if (value === null || value === undefined || value === '') return '未设置';
  if (Array.isArray(value)) return value.length ? value.map((item) => displayValue(item)).join('、') : '无';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}
function scalarValueSummary(value) {
  if (value === null || value === undefined || value === '') return '未设置';
  if (Array.isArray(value)) return value.length ? value.slice(0, 3).map((item) => scalarValueSummary(item)).join('、') + (value.length > 3 ? ' …' : '') : '无';
  if (typeof value === 'object') {
    const record = asRecord(value);
    const title = text(record.name) || text(record.label) || text(record.assetId) || text(record.id);
    if (title) return title;
    const entries = Object.entries(record).filter(([, item]) => item !== undefined);
    return entries.length ? entries.slice(0, 2).map(([key, item]) => key + ': ' + scalarValueSummary(item)).join(' / ') + (entries.length > 2 ? ' …' : '') : '{}';
  }
  const raw = String(value).replace(/\s+/g, ' ').trim();
  return raw.length > 72 ? raw.slice(0, 69) + '…' : raw || '未设置';
}
function compactDisplayValue(value) {
  if (value === null || value === undefined || value === '') return '未设置';
  if (Array.isArray(value)) {
    if (!value.length) return '无';
    if (value.every(looksLikeAssetId)) return value.length + ' 项 · 已绑定素材 ID';
    const samples = value.slice(0, 4).map((item) => {
      const record = asRecord(item);
      return text(record.name) || text(record.label) || text(record.assetId) || text(record.id) || scalarValueSummary(item);
    }).filter(Boolean);
    return value.length + ' 项' + (samples.length ? ' · ' + samples.join(' / ') + (value.length > samples.length ? ' …' : '') : '');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(asRecord(value)).filter(([, item]) => item !== undefined);
    return entries.length ? entries.slice(0, 4).map(([key, item]) => key + ': ' + scalarValueSummary(item)).join('\n') + (entries.length > 4 ? '\n+' + (entries.length - 4) + ' 字段' : '') : '{}';
  }
  return displayValue(value);
}

function currentPlanVersion(planVersions) {
  return [...planVersions].sort((left, right) => {
    const confirmed = Number(right.state === 'confirmed') - Number(left.state === 'confirmed');
    return confirmed || Number(right.planVersion || 0) - Number(left.planVersion || 0);
  })[0] || null;
}

function finalPrompt(plan, itemPrompt) {
  const prompt = text(asRecord(plan).prompt);
  return itemPrompt ? prompt + ITEM_PROMPT_PREFIX + itemPrompt : prompt;
}

function itemPromptList(plan) { return asArray(asRecord(plan).itemPrompts).map(text).filter(Boolean); }
function plannedItemCount(plan) { const count = asRecord(plan).itemCount; return Number.isInteger(count) && count > 0 ? count : null; }
function finalPromptEntries(plan) {
  const prompts = itemPromptList(plan);
  if (!prompts.length) return [];
  return prompts.map((prompt, index) => ({ index: index + 1, itemPrompt: prompt, finalPrompt: finalPrompt(plan, prompt), charCount: finalPrompt(plan, prompt).length }));
}
function allFinalPromptText(plan) {
  const entries = finalPromptEntries(plan);
  const shared = finalPrompt(plan);
  return entries.length ? entries.map((entry) => '第 ' + entry.index + ' 张完整提示词\n' + entry.finalPrompt).join('\n\n---\n\n') : shared;
}
function maxFinalPromptLength(plan) {
  const entries = finalPromptEntries(plan);
  return entries.length ? Math.max(...entries.map((entry) => entry.charCount)) : finalPrompt(plan).length;
}
function promptReviewMetrics(plan) {
  const presentation = planPresentation(plan);
  const itemCount = plannedItemCount(plan);
  const entries = finalPromptEntries(plan);
  const prompt = text(asRecord(plan).prompt);
  return [
    ['计划数量', itemCount ? itemCount + ' 张' : '未设置'],
    ['通用提示词', prompt ? prompt.length + ' 字符' : '未填写'],
    ['逐图提示词', entries.length ? entries.length + (itemCount ? ' / ' + itemCount : '') + ' 条' : itemCount && itemCount > 1 ? itemCount + ' 张共用' : '无'],
    ['最长单图', maxFinalPromptLength(plan) + ' / ' + OPENAI_GPT_IMAGE_PROMPT_LIMIT + ' 字符'],
    ['参考素材', presentation.references.length ? presentation.references.length + ' 张' : '无'],
    ['输出规格', presentation.output]
  ];
}
function isLongRawValue(value) {
  if (typeof value === 'string') return value.length > 96 || value.includes('\n');
  if (Array.isArray(value)) return JSON.stringify(value).length > 160;
  return value && typeof value === 'object' ? JSON.stringify(value).length > 160 : false;
}
function rawFieldEntries(value, key) {
  if (key === 'referenceMaterials') {
    const materialCount = asArray(value.referenceMaterials).length;
    return [['referenceMaterials', materialCount ? materialCount + ' 条' : value.referenceMaterials]];
  }
  if (RAW_OBJECT_FIELD_KEYS.has(key) || (/Spec$/.test(key) && value[key] && typeof value[key] === 'object' && !Array.isArray(value[key]))) {
    const entries = Object.entries(asRecord(value[key]));
    return entries.length ? entries : [[key, value[key]]];
  }
  return [[key, value[key]]];
}
function rawSummaryGroups(plan) {
  const value = asRecord(plan);
  const groups = RAW_FIELD_GROUPS.map(({ label, keys }) => [label, keys.flatMap((key) => rawFieldEntries(value, key)).filter(([, item]) => item !== undefined)]).filter(([, fields]) => fields.length);
  const other = Object.entries(value).filter(([key]) => !RAW_GROUP_KEYS.has(key));
  if (other.length) groups.push(['其他元数据', other]);
  return groups;
}
function rawSummaryIntro(groups) {
  const semantic = groups.map(([label]) => label).filter((label) => !['基础', '输出规格', '参考素材'].includes(label));
  if (!semantic.length) return '字段较少时保持紧凑网格；完整计划仍保留在原始 JSON。';
  return '已识别 ' + semantic.slice(0, 4).join('、') + (semantic.length > 4 ? ' 等' : '') + ' 任务字段；长数组和对象先摘要，可展开查看完整结构。';
}
function RawFieldValue({ value }) {
  if (value && typeof value === 'object' && isLongRawValue(value)) return <details className="prompt-raw-field-details"><summary>{compactDisplayValue(value)}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
  return displayValue(value);
}
function referenceRows(plan) {
  const value = asRecord(plan);
  const materialAssetIds = new Set();
  const rows = asArray(value.referenceMaterials).map((item, index) => {
    const record = asRecord(item);
    const assetId = text(record.assetId);
    if (assetId) materialAssetIds.add(assetId);
    return { key: 'material-' + index, source: 'referenceMaterials', assetId, usage: text(record.usage) || 'reference', note: text(record.note) || '—' };
  });
  for (const assetId of asArray(value.referenceAssetIds).map(text).filter(Boolean)) if (!materialAssetIds.has(assetId)) rows.push({ key: 'asset-' + assetId, source: 'referenceAssetIds', assetId, usage: 'reference', note: '—' });
  const maskAssetId = text(value.maskAssetId);
  if (maskAssetId) rows.push({ key: 'mask-' + maskAssetId, source: 'maskAssetId', assetId: maskAssetId, usage: 'mask', note: '遮罩素材' });
  return rows;
}


function PlanVersionCard({ version, current = false, review = false }) {
  const presentation = planPresentation(version.plan);
  return <article className={'prompt-version-card ' + (current ? 'is-current' : '')}>
    <header><div><span className={'prompt-state ' + stateTone(version.state)}>{version.state === 'confirmed' && <Check size={13} />}{planStateLabel(version.state)}</span><h3>{current ? '当前计划' : '计划 v' + version.planVersion}</h3></div><small>{version.confirmedAt ? '已于 ' + new Date(version.confirmedAt).toLocaleString('zh-CN') + ' 确认' : version.createdAt ? '创建于 ' + new Date(version.createdAt).toLocaleString('zh-CN') : '时间未知'}</small></header>
    <dl><div><dt>操作</dt><dd>{presentation.operation}</dd></div><div><dt>计划数量</dt><dd>{presentation.itemCount === null ? '未设置' : presentation.itemCount + ' 张'}</dd></div><div><dt>画面比例</dt><dd>{presentation.aspectRatio}</dd></div><div><dt>分辨率</dt><dd>{presentation.resolution}</dd></div><div><dt>输出尺寸</dt><dd>{presentation.size}</dd></div><div><dt>像素尺寸</dt><dd>{presentation.dimensions}</dd></div><div><dt>参考素材</dt><dd>{presentation.references.length ? presentation.references.length + ' 张已绑定' : '无'}</dd></div></dl>
    <section className="prompt-copy"><span>通用提示词</span><p>{presentation.prompt}</p></section>
    {review && <PlanReviewPanel plan={version.plan} />}
    {presentation.references.length > 0 && <div className="prompt-references"><ImagePlus size={14} /><span>已绑定参考素材，生成前会由预检验证能力。</span></div>}
  </article>;
}

function PlanReviewPanel({ plan }) {
  const entries = finalPromptEntries(plan);
  const itemCount = plannedItemCount(plan);
  const prompt = text(asRecord(plan).prompt);
  return <section className="prompt-review-panel" aria-label="确认前计划审阅">
    <div className="prompt-review-metrics">{promptReviewMetrics(plan).map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
    <section className="prompt-item-prompts"><header><div><p className="eyebrow">确认前必看</p><h4>逐图提示词 {entries.length ? entries.length + ' 张' : '无逐图差异'}</h4></div><span>{entries.length ? '展开任意图片查看最终会发送给 Provider 的完整提示词。' : itemCount && itemCount > 1 ? itemCount + ' 张共用同一条通用提示词。' : '这一版只生成一张或尚未提供逐图差异。'}</span></header>{entries.length ? <ol>{entries.map((entry) => <li key={entry.index}><details className="prompt-item-card"><summary><b>#{String(entry.index).padStart(3, '0')}</b><span>{entry.itemPrompt}</span><small>{entry.charCount} 字符</small></summary><pre>{entry.finalPrompt}</pre></details></li>)}</ol> : <p className="prompt-shared-note">{prompt ? '最终提示词就是上方通用提示词；多张图会分别用同一条提示词发起请求。' : '还没有可执行提示词。'}</p>}</section>
    <StructuredPlanDetails plan={plan} />
  </section>;
}


function ReferenceMaterialsSection({ plan }) {
  const rows = referenceRows(plan);
  if (!rows.length) return null;
  return <section className="prompt-raw-material-section"><header><p className="eyebrow">参考素材结构</p><h4>{rows.length} 条素材引用</h4></header><div className="prompt-raw-material-table" role="table" aria-label="参考素材结构"><div role="row"><span role="columnheader">来源字段</span><span role="columnheader">用途</span><span role="columnheader">assetId</span><span role="columnheader">备注</span></div>{rows.map((row) => <div role="row" key={row.key}><span role="cell">{row.source}</span><span role="cell">{row.usage}</span><span role="cell">{row.assetId || '未记录'}</span><span role="cell">{row.note}</span></div>)}</div></section>;
}

function StructuredPlanDetails({ plan }) {
  const groups = rawSummaryGroups(plan);
  return <details className="prompt-raw-structure"><summary><ChevronDown size={15} /><span>原始计划结构</span><small>{groups.length} 组字段 + 原始 JSON</small></summary><div className="prompt-raw-layout"><section className="prompt-raw-summary"><header><div><p className="eyebrow">关键字段</p><h4>按任务类型归组</h4></div><span>{rawSummaryIntro(groups)}</span></header><div className="prompt-raw-groups">{groups.map(([label, fields]) => <section key={label} className={fields.some(([, value]) => isLongRawValue(value)) ? 'is-rich' : 'is-compact'}><h4>{label}</h4><dl>{fields.map(([key, value]) => <div key={key} className={isLongRawValue(value) ? 'is-long' : ''}><dt>{key}</dt><dd><RawFieldValue value={value} /></dd></div>)}</dl></section>)}</div></section><ReferenceMaterialsSection plan={plan} /></div><details className="prompt-raw-json"><summary>查看原始 JSON</summary><pre>{JSON.stringify(asRecord(plan), null, 2)}</pre></details></details>;
}

export function PromptWorkspace({ round, planVersions, loading, onRefresh }) {
  const [comparison, setComparison] = useState([]);
  const [copyNotice, setCopyNotice] = useState('');
  useEffect(() => { setComparison([]); }, [round?.id]);
  useEffect(() => { setCopyNotice(''); }, [round?.id]);
  const selected = useMemo(() => planVersions.filter((plan) => comparison.includes(plan.planVersion)).sort((left, right) => left.planVersion - right.planVersion), [comparison, planVersions]);
  const differences = selected.length === 2 ? planDiff(selected[0].plan, selected[1].plan) : [];
  const current = useMemo(() => currentPlanVersion(planVersions), [planVersions]);
  const history = useMemo(() => planVersions.filter((version) => version !== current), [planVersions, current]);
  const toggleComparison = (version) => setComparison((current) => current.includes(version) ? current.filter((item) => item !== version) : [...current, version].slice(-2));
  const copyCurrent = async (mode) => {
    if (!current?.plan || !navigator.clipboard?.writeText) return;
    if (mode === 'json') {
      await navigator.clipboard.writeText(JSON.stringify(asRecord(current.plan), null, 2));
      setCopyNotice('已复制结构化计划 JSON。');
      return;
    }
    if (mode === 'final') {
      await navigator.clipboard.writeText(allFinalPromptText(current.plan));
      setCopyNotice(finalPromptEntries(current.plan).length ? '已复制全部逐图最终提示词。' : '已复制最终提示词。');
      return;
    }
    await navigator.clipboard.writeText(text(asRecord(current.plan).prompt));
    setCopyNotice('已复制通用提示词。');
  };

  if (!round) return <section className="prompt-stage empty-stage"><Layers3 size={30} strokeWidth={1.15} /><p>先从左侧选择一个轮次，再查看可追溯的计划与提示词。</p></section>;
  return <section className="prompt-stage">
    <header className="prompt-stage-head"><div><p className="eyebrow">{ROUND_PURPOSE_LABELS[round.purpose] || round.purpose}轮次</p><h2>当前计划</h2><span>确认前先看通用提示词、逐图差异、参考素材和原始计划结构；历史版本和对比放在下面。</span></div><div className="prompt-stage-actions"><button type="button" className="outline-button" onClick={onRefresh} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} />刷新</button><button type="button" className="outline-button" onClick={() => void copyCurrent('shared')} disabled={!current?.plan?.prompt}><ClipboardCopy size={16} />复制通用提示词</button><button type="button" className="outline-button" onClick={() => void copyCurrent('final')} disabled={!current?.plan?.prompt}><ClipboardCopy size={16} />复制全部最终提示词</button><button type="button" className="outline-button" onClick={() => void copyCurrent('json')} disabled={!current?.plan}><ClipboardCopy size={16} />复制结构化 JSON</button>{copyNotice && <span className="prompt-copy-notice" role="status">{copyNotice}</span>}</div></header>
    {loading ? <div className="empty-stage"><RefreshCw size={26} className="spin" /><p>正在读取计划版本。</p></div> : !planVersions.length ? <div className="empty-stage"><Layers3 size={30} strokeWidth={1.15} /><p>当前轮次还没有可展示的计划版本。</p></div> : <>
      <section className="prompt-current-plan"><PlanVersionCard version={current} current review /></section>
      <details className="prompt-history"><summary><ChevronDown size={16} /><span>历史版本与对比</span><small>{history.length ? history.length + ' 个旧版本' : '没有旧版本'}</small></summary><div className="prompt-version-rail">{planVersions.map((version) => <label key={version.id || version.planVersion} className={'prompt-version-chip ' + (comparison.includes(version.planVersion) ? 'is-selected' : '')}><input type="checkbox" checked={comparison.includes(version.planVersion)} onChange={() => toggleComparison(version.planVersion)} /><span>v{version.planVersion}</span><small>{planStateLabel(version.state)}</small></label>)}</div>{history.length ? <div className="prompt-version-grid">{history.map((version) => <PlanVersionCard key={version.id || version.planVersion} version={version} />)}</div> : <p className="empty-copy">当前只有一个计划版本。</p>}{selected.length === 2 && <section className="prompt-diff"><header><div><FileDiff size={18} /><div><p className="eyebrow">版本对比</p><h3>v{selected[0].planVersion} 与 v{selected[1].planVersion}</h3></div></div><small>{differences.length ? differences.length + ' 项变化' : '两版没有结构化差异'}</small></header>{differences.length ? <dl>{differences.map((item) => <div key={item.label}><dt>{item.label}</dt><dd><span>{item.before}</span><b>→</b><span>{item.after}</span></dd></div>)}</dl> : <p>计划的提示词、操作、数量、输出规格与参考素材一致。</p>}</section>}</details>
    </>}
  </section>;
}
