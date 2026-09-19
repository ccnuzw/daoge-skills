import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Eye, GitFork, ImagePlus, LockKeyhole, RefreshCw, Search, Tag, X } from 'lucide-react';
import { AccessibleDialog } from '../accessible-dialog.jsx';
import { DRAFT_BOUNDARY_COPY } from '../boundary-copy.mjs';
import { assetThumbnailUrl } from '../asset-media-url.mjs';
import { REFERENCE_USAGE_LABELS, REFERENCE_USAGE_OPTIONS, materialNeedUsagePreset } from '../reference-usage-model.mjs';
import { creativeDerivedActionForPurpose } from '../creative-actions.mjs';
import { questionnaireVisible, defaultPurposeNote, DEFAULT_PURPOSE } from '../plan-questionnaire-model.mjs';
import { ListPager } from './asset-surfaces.jsx';
import { IconButton } from '../components/IconButton.jsx';
import { errorMessageForDisplay, isAbortError, normalizeRequestError } from '../error-model.mjs';
import { api } from './api.js';
import { CREATION_ASPECT_OPTIONS, CREATION_COUNT_OPTIONS, DERIVED_ACTION_BY_ID, DERIVED_KEEP_CONSTRAINTS, DERIVED_REFERENCE_PRESETS, DERIVED_REFERENCE_USAGE_NOTES, DERIVED_REFINEMENT_GOALS, DERIVED_ROUND_ACTIONS, DERIVED_VARIATION_AXES, GENERIC_TASK_GOAL_FALLBACKS, PROJECT_TEMPLATE_UNAVAILABLE, REJECT_REASON_LABELS, REJECT_REASON_OPTIONS, ROUND_PURPOSE_LABELS, ROUND_PURPOSE_OPTIONS, assetMatchesQuery, buildDerivedPresetMaterials, compactRecord, creationDefaultSummary, defaultDerivedPresetForPurpose, derivedPresetAllowed, libraryDefinitionSummary, listItems, materialNeedsForTemplate, projectTemplateDefaultName, projectTemplateForProject, projectTemplateName, setIfEmptyOrDefault, taskGoalsForProjectTemplate, toggleChoice, uniqueList, usageCountsFromMaterials } from './creation-model.mjs';

/** 创建/引用/衍生/驳回的对话框族（界面批 E 从 main.jsx 搬出，行为零变化）。 */

const EMPTY = [];

/** 创建/引用/衍生/驳回的对话框族（界面批 E 从 main.jsx 搬出，行为零变化）。 */

export function ExecutionBoundaryNote({ children = DRAFT_BOUNDARY_COPY }) {
  return <p className="execution-boundary-note"><LockKeyhole size={14} /><span>{children}</span></p>;
}

// 确认出图弹窗是唯一需要说清「确认之后会怎样」的地方，所以它不复用上面那句短提示。
// 只用真实拿得到的事实（计划里的张数 / 画幅 / 分辨率）——不编时间和金额，
// 那两项要等会话真正执行时才有依据。

export function CreationInfoList({ label, items }) {
  const values = listItems(items);
  if (!values.length) return null;
  return <div className="creation-info-list"><span>{label}</span><ul>{values.map((item) => <li key={item}>{item}</li>)}</ul></div>;
}

export function CreationSuggestionChips({ label = '填入示例', options, onChoose }) {
  const values = listItems(options);
  if (!values.length) return null;
  return <div className="creation-suggestion-chips"><span>{label}</span><div>{values.map((item) => <button type="button" key={item} className="outline-button" onClick={() => onChoose(item)}>{item}</button>)}</div></div>;
}

export function MaterialImportGuide({ materialNeeds, selectedNeed, completedCounts = {}, assetScope, selectedRound, onSelectNeed }) {
  const values = uniqueList(materialNeeds);
  if (!values.length) return null;
  const activeNeed = values.includes(selectedNeed) ? selectedNeed : '';
  const preset = activeNeed ? materialNeedUsagePreset(activeNeed) : null;
  const roundDraft = Boolean(selectedRound && assetScope === 'round' && selectedRound.status === 'draft');
  const roundLocked = Boolean(selectedRound && assetScope === 'round' && selectedRound.status !== 'draft');
  return <section className="material-import-guide" aria-label="素材导入引导">
    <header>
      <div><p className="eyebrow">素材导入引导</p><h3>本次导入准备什么？</h3><span>{roundDraft ? '导入成功后会按用途自动加入当前这一轮的参考素材。' : roundLocked ? '当前批次已进入确认或出图流程，导入只保存素材，不改参考信息。' : '先给这批导入选用途，后续会话能按素材需求理解你的意图。'}</span></div>
    </header>
    <div className="material-need-selector" role="radiogroup" aria-label="本次导入素材需求">
      {values.map((need) => {
        const needPreset = materialNeedUsagePreset(need);
        const count = Number(completedCounts[need] || 0);
        return <button type="button" key={need} className={activeNeed === need ? 'is-active' : ''} aria-pressed={activeNeed === need} onClick={() => onSelectNeed(need)}><b>{need}</b><span>{needPreset.usageLabel}</span>{count > 0 && <small>{count} 张已准备</small>}</button>;
      })}
      <button type="button" className={!activeNeed ? 'is-active' : ''} aria-pressed={!activeNeed} onClick={() => onSelectNeed('')}><b>通用素材</b><span>稍后标注</span><small>不写入素材需求标签</small></button>
    </div>
    <div className="material-import-current"><Tag size={15} /><span>{preset ? preset.need + ' → ' + preset.usageLabel + '。' + preset.hint : '如果素材用途无法归类，先作为通用素材导入，之后在参考素材选择器里自定义备注。'}</span></div>
  </section>;
}

export function CreationError({ error }) {
  const message = errorMessageForDisplay(error);
  return message ? <div className="creation-form-error" role="alert" aria-live="assertive"><CircleAlert size={15} /><span>{message}</span></div> : null;
}

export function ProjectCreationDialog({ projectTemplates = EMPTY, busy, error, onDismiss, onCreate }) {
  const availableTemplates = projectTemplates.length ? projectTemplates : [PROJECT_TEMPLATE_UNAVAILABLE];
  const initialTemplate = availableTemplates[0];
  const [templateId, setTemplateId] = useState(initialTemplate.id);
  const [name, setName] = useState(projectTemplateDefaultName(initialTemplate));
  const [description, setDescription] = useState('');
  const selectedTemplate = availableTemplates.find((option) => option.id === templateId) || initialTemplate;
  const selectedName = projectTemplateName(selectedTemplate);
  const descriptionExamples = listItems(selectedTemplate.exampleDescriptions);
  const materialNeeds = materialNeedsForTemplate(selectedTemplate);
  const templateBound = Boolean(selectedTemplate.id);
  const chooseTemplate = (option) => {
    const previous = selectedTemplate;
    setTemplateId(option.id);
    setIfEmptyOrDefault(setName, projectTemplateDefaultName(previous), projectTemplateDefaultName(option));
    setDescription((current) => !current.trim() || current.trim() === previous.description ? '' : current);
  };
  const submit = (event) => {
    event.preventDefault();
    onCreate({ templateId: templateBound ? selectedTemplate.id : undefined, templateVersion: templateBound ? selectedTemplate.version || 1 : undefined, templateName: templateBound ? selectedName : undefined, name: name.trim(), description: description.trim() || selectedTemplate.description, materialNeeds });
  };
  return <AccessibleDialog className="creation-dialog" label="新建项目" onDismiss={onDismiss}>
    <form className="creation-form" onSubmit={submit}>
      <header><div><p className="eyebrow">Studio 直接创建</p><h2>新建项目</h2><span>项目模板来自 Studio；这里只是把信息记下来。</span></div><IconButton label="关闭新建项目" onClick={onDismiss}><X size={16} /></IconButton></header>
      <ExecutionBoundaryNote />
      <section className="creation-section"><h3>选择项目类型</h3><div className="creation-choice-grid" role="radiogroup" aria-label="项目类型">{availableTemplates.map((option) => <button type="button" key={option.id || 'no-template'} className={templateId === option.id ? 'is-active' : ''} aria-pressed={templateId === option.id} onClick={() => chooseTemplate(option)}><b>{projectTemplateName(option)}</b><span>{option.description}</span></button>)}</div></section>
      <section className="creation-section creation-selection-detail"><div><b>{selectedName}</b><span>{selectedTemplate.description}</span></div><div className="creation-detail-grid"><span><strong>模板来源</strong>{templateBound ? 'Studio 内置 · 模板 v' + (selectedTemplate.version || 1) : '未绑定模板'}</span><span><strong>推荐任务</strong>{listItems(selectedTemplate.recommendedTasks).join('、') || '根据项目说明由 Agent 判断'}</span><span><strong>推荐画幅</strong>{listItems(selectedTemplate.aspectRatios).join('、') || '由 Agent 判断'}</span><span><strong>参考提示</strong>{selectedTemplate.referenceHint || '可在创建后从当前项目素材中选择参考。'}</span></div><CreationInfoList label="优先准备的素材" items={materialNeeds} /></section>
      <section className="creation-section"><h3>基础信息</h3><label><span>项目名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：茶饮新品夏季视觉" autoFocus /><small>{templateBound ? '已按 Studio 模板填入默认名称，可直接改成客户、品牌或产品名。' : '模板未加载时创建的项不绑定官方模板，后续仍可由会话补充信息。'}</small></label><label><span>项目说明</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder={selectedTemplate.descriptionPrompt || '说明客户、产品、使用渠道或交付目标。'} /></label><CreationSuggestionChips label="项目说明示例" options={descriptionExamples} onChoose={setDescription} /></section>
      <section className="creation-summary"><p className="eyebrow">创建摘要</p><strong>{name.trim() || '未填写项目名称'}</strong><span>{templateBound ? selectedName + ' · 模板 v' + (selectedTemplate.version || 1) : '不绑定项目模板'}</span><span>{description.trim() || selectedTemplate.description}</span></section>
      <p className="creation-hint">创建后会打开该项目，并设为当前 Studio 标签页的对象；后续可在项目工作区继续新建任务、导入素材或整理计划。</p><CreationError error={error} /><footer><button type="button" className="outline-button" onClick={onDismiss} disabled={busy}>取消</button><button type="submit" className="command-button" disabled={busy || !name.trim()}>{busy ? '正在创建' : '创建项目'}</button></footer>
    </form>
  </AccessibleDialog>;
}

export function CreationChoiceList({ label, values, options, onChange }) {
  return <div className="creation-choice-list"><span>{label}</span><div>{options.map((option) => <label key={option}><input type="checkbox" checked={values.includes(option)} onChange={() => onChange(toggleChoice(values, option))} /><span>{option}</span></label>)}</div></div>;
}

export function TaskCreationDialog({ project, projectTemplates = EMPTY, taskTypes, styleKits, brandKits, busy, error, onDismiss, onCreate }) {
  const selectedProjectTemplate = projectTemplateForProject(project, projectTemplates);
  const taskGoalOptions = useMemo(() => taskGoalsForProjectTemplate(selectedProjectTemplate), [selectedProjectTemplate]);
  const initialGoal = taskGoalOptions[0] || GENERIC_TASK_GOAL_FALLBACKS[0];
  const [goalId, setGoalId] = useState(initialGoal.id);
  const selectedGoal = taskGoalOptions.find((option) => option.id === goalId) || initialGoal;
  const [name, setName] = useState(initialGoal.defaultName);
  const [taskTypeId, setTaskTypeId] = useState('');
  const [targetCount, setTargetCount] = useState(initialGoal.defaultCount || '');
  const [aspectRatio, setAspectRatio] = useState(initialGoal.defaultAspectRatio || '');
  const [styleKitId, setStyleKitId] = useState('');
  const [brandKitId, setBrandKitId] = useState('');
  const [brief, setBrief] = useState('');
  const [variationAxes, setVariationAxes] = useState(listItems(initialGoal.defaultVariationAxes));
  const [keepConstraints, setKeepConstraints] = useState(listItems(initialGoal.defaultKeepConstraints));
  const [refinementGoals, setRefinementGoals] = useState(listItems(initialGoal.defaultRefinementGoals));
  const [editInstruction, setEditInstruction] = useState('');
  const [preserveInstruction, setPreserveInstruction] = useState('');
  const [createRound, setCreateRound] = useState(true);
  const [roundPurpose, setRoundPurpose] = useState(initialGoal.roundPurpose);
  const selectedTaskType = taskTypes.find((item) => item.id === taskTypeId) || null;
  const selectedStyleKit = styleKits.find((item) => item.id === styleKitId) || null;
  const selectedBrandKit = brandKits.find((item) => item.id === brandKitId) || null;
  const selectedRoundPurpose = ROUND_PURPOSE_OPTIONS.find((option) => option.id === roundPurpose) || ROUND_PURPOSE_OPTIONS[0];
  const materialNeeds = listItems(selectedGoal.materialNeeds);
  const projectTemplateLabel = selectedProjectTemplate ? projectTemplateName(selectedProjectTemplate) : '未绑定项目模板';
  const chooseGoal = (option) => {
    const previous = selectedGoal;
    setGoalId(option.id);
    setIfEmptyOrDefault(setName, previous.defaultName, option.defaultName);
    setIfEmptyOrDefault(setTargetCount, previous.defaultCount, option.defaultCount);
    setIfEmptyOrDefault(setAspectRatio, previous.defaultAspectRatio, option.defaultAspectRatio);
    setRoundPurpose(option.roundPurpose);
    setVariationAxes(listItems(option.defaultVariationAxes));
    setKeepConstraints(listItems(option.defaultKeepConstraints));
    setRefinementGoals(listItems(option.defaultRefinementGoals));
  };
  const applyRecommendedDefaults = () => {
    setTargetCount(selectedGoal.defaultCount || '');
    setAspectRatio(selectedGoal.defaultAspectRatio || '');
    setRoundPurpose(selectedGoal.roundPurpose);
    setVariationAxes(listItems(selectedGoal.defaultVariationAxes));
    setKeepConstraints(listItems(selectedGoal.defaultKeepConstraints));
    setRefinementGoals(listItems(selectedGoal.defaultRefinementGoals));
  };
  const submit = (event) => {
    event.preventDefault();
    const count = targetCount ? Number(targetCount) : undefined;
    const context = compactRecord({ projectTemplateId: selectedProjectTemplate?.id, projectTemplateName: selectedProjectTemplate ? projectTemplateName(selectedProjectTemplate) : undefined, goalType: goalId, goalLabel: selectedGoal.label, templateRecommended: selectedGoal.templateRecommended, recommendedInputs: listItems(selectedGoal.recommendedInputs), materialNeeds, brief: brief.trim(), targetCount: count, aspectRatio, taskTypeId, taskTypeName: selectedTaskType?.name, styleKitId, styleKitName: selectedStyleKit?.name, brandKitId, brandKitName: selectedBrandKit?.name, variationAxes, keepConstraints, refinementGoals, editInstruction: editInstruction.trim(), preserveInstruction: preserveInstruction.trim() });
    const intent = compactRecord({ createdFrom: 'workbench', ...context });
    const plan = compactRecord({ createdFrom: 'workbench', draftKind: 'studio-task-context', roundPurposeLabel: selectedRoundPurpose.label, ...context, note: '这是 Studio 记下的草稿；出图前仍需会话整理成可确认的计划。' });
    onCreate({ name: name.trim(), goalLabel: selectedGoal.label, projectTemplateId: selectedProjectTemplate?.id, projectTemplateName: selectedProjectTemplate ? projectTemplateName(selectedProjectTemplate) : undefined, materialNeeds, taskTypeId, styleKitId, brandKitId, intent, createRound, roundPurpose, roundPurposeLabel: selectedRoundPurpose.label, plan });
  };
  const quickBriefs = listItems(selectedGoal.quickBriefs);
  const briefPlaceholder = quickBriefs[0] || '例如：说明目标、输入素材、限制条件和交付用途。';
  return <AccessibleDialog className="creation-dialog is-wide" label="新建任务" onDismiss={onDismiss}>
    <form className="creation-form" onSubmit={submit}>
      <header><div><p className="eyebrow">{project.name}</p><h2>新建任务</h2><span>{selectedProjectTemplate ? '已根据“' + projectTemplateLabel + '”项目模板重排任务目标，并套用不同数量、画幅和素材需求。' : '未绑定项目模板，使用通用任务目标。'} Studio 只创建草稿。</span></div><IconButton label="关闭新建任务" onClick={onDismiss}><X size={16} /></IconButton></header>
      <ExecutionBoundaryNote />
      <section className="creation-template-bridge"><div><p className="eyebrow">项目模板联动</p><strong>{projectTemplateLabel}</strong><span>{selectedProjectTemplate ? selectedProjectTemplate.referenceHint : '可以先从项目详情补充模板或直接用自定义任务。'}</span></div><CreationInfoList label="该项目类型常用任务" items={selectedProjectTemplate?.recommendedTasks} /></section>
      <section className="creation-section"><h3>你现在想做什么？</h3><div className="creation-choice-grid is-goal" role="radiogroup" aria-label="任务目标">{taskGoalOptions.map((option) => <button type="button" key={option.id} className={goalId === option.id ? 'is-active' : ''} aria-pressed={goalId === option.id} onClick={() => chooseGoal(option)}><b>{option.label}</b><span>{option.description}</span>{option.templateRecommended && <small>模板推荐 · {creationDefaultSummary(option)}</small>}</button>)}</div></section>
      <section className="creation-section creation-selection-detail"><div><b>{selectedGoal.label}</b><span>{selectedGoal.description}</span></div><div className="creation-detail-grid"><span><strong>模板推荐默认值</strong>{creationDefaultSummary(selectedGoal)}</span><span><strong>首个批次</strong>{selectedRoundPurpose.label}</span><span><strong>需要补充</strong>{listItems(selectedGoal.recommendedInputs).join('、') || '无固定字段'}</span><span><strong>素材需求</strong>{materialNeeds.join('、') || '可创建后再导入素材'}</span></div><CreationInfoList label="建议先准备的素材" items={materialNeeds} /><button type="button" className="outline-button creation-apply-defaults" onClick={applyRecommendedDefaults}>套用推荐默认值</button></section>
      <section className="creation-section is-two-columns"><label><span>任务名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={selectedGoal.defaultName} autoFocus /><small>默认名称来自当前项目模板，建议改成“对象 + 目标”。</small></label><label><span>任务类型</span><select value={taskTypeId} onChange={(event) => setTaskTypeId(event.target.value)}><option value="">不绑定任务类型</option>{taskTypes.map((type) => <option value={type.id} key={type.id}>{type.name}{type.source === 'official' ? ' · 官方' : ' · 自定义'}</option>)}</select><small>{taskTypes.length ? '选择后会把该类型的字段建议带进来。' : '暂无任务类型；可先创建任务，稍后在规则资料补充。'}</small></label><label><span>目标数量</span><select value={targetCount} onChange={(event) => setTargetCount(event.target.value)}>{CREATION_COUNT_OPTIONS.map((value) => <option value={value} key={value || 'auto'}>{value ? value + ' 张' : '让 Agent 决定'}</option>)}</select></label><label><span>画幅</span><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{CREATION_ASPECT_OPTIONS.map((value) => <option value={value} key={value || 'auto'}>{value || '让 Agent 决定'}</option>)}</select></label><label><span>风格包</span><select value={styleKitId} onChange={(event) => setStyleKitId(event.target.value)}><option value="">不绑定风格包</option>{styleKits.map((kit) => <option value={kit.id} key={kit.id}>{kit.name}</option>)}</select><small>可选；用于固定画风、质感和关键词。</small></label><label><span>品牌包</span><select value={brandKitId} onChange={(event) => setBrandKitId(event.target.value)}><option value="">不绑定品牌包</option>{brandKits.map((kit) => <option value={kit.id} key={kit.id}>{kit.name}</option>)}</select><small>可选；用于品牌色、Logo 和禁忌约束。</small></label></section>
      {(selectedTaskType || selectedStyleKit || selectedBrandKit) && <section className="creation-section creation-selection-detail"><div className="creation-detail-grid">{selectedTaskType && <span><strong>任务类型</strong>{libraryDefinitionSummary(selectedTaskType, selectedTaskType.name)}{Array.isArray(selectedTaskType.definition?.fields) && selectedTaskType.definition.fields.length > 0 && <small>建议信息：{selectedTaskType.definition.fields.join('、')}</small>}</span>}{selectedStyleKit && <span><strong>风格包：{selectedStyleKit.name}</strong>{libraryDefinitionSummary(selectedStyleKit, '将作为风格约束供 Agent 参考。')}</span>}{selectedBrandKit && <span><strong>品牌包：{selectedBrandKit.name}</strong>{libraryDefinitionSummary(selectedBrandKit, '将作为品牌约束供 Agent 参考。')}</span>}</div></section>}
      {goalId === 'variation' && <section className="creation-section"><CreationChoiceList label="希望变化的维度" values={variationAxes} options={DERIVED_VARIATION_AXES} onChange={setVariationAxes} /><CreationChoiceList label="希望保持不变" values={keepConstraints} options={DERIVED_KEEP_CONSTRAINTS} onChange={setKeepConstraints} /></section>}
      {goalId === 'refinement' && <section className="creation-section"><CreationChoiceList label="希望精修的目标" values={refinementGoals} options={DERIVED_REFINEMENT_GOALS} onChange={setRefinementGoals} /><CreationChoiceList label="希望保持不变" values={keepConstraints} options={DERIVED_KEEP_CONSTRAINTS} onChange={setKeepConstraints} /></section>}
      {goalId === 'edit' && <section className="creation-section is-two-columns"><label><span>要修改什么</span><textarea value={editInstruction} onChange={(event) => setEditInstruction(event.target.value)} placeholder="例如：替换背景中的植物和文字区域。" /></label><label><span>哪些内容保持不变</span><textarea value={preserveInstruction} onChange={(event) => setPreserveInstruction(event.target.value)} placeholder="例如：人物身份、产品轮廓、Logo 和主体光线。" /></label></section>}
      <section className="creation-section"><label><span>创作意图 <small>可选；自定义要求请写清输入、限制和使用渠道</small></span><textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder={briefPlaceholder} /></label><CreationSuggestionChips options={quickBriefs} onChoose={setBrief} /><p className="creation-hint">Agent 会在后续会话中把项目模板、素材需求和任务目标整理为可审阅的生成计划；这里不会把文本直接发给生成服务。</p></section>
      <section className="creation-inline-option"><label><input type="checkbox" checked={createRound} onChange={(event) => setCreateRound(event.target.checked)} /><span>同时创建首个批次，并设为当前批次</span></label>{createRound && <select value={roundPurpose} onChange={(event) => setRoundPurpose(event.target.value)} aria-label="首个批次目的">{ROUND_PURPOSE_OPTIONS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select>}</section>
      <section className="creation-summary"><p className="eyebrow">创建摘要</p><strong>{name.trim() || '未填写任务名称'}</strong><span>{projectTemplateLabel} · {selectedGoal.label} · {targetCount ? targetCount + ' 张' : '数量由 Agent 决定'} · {aspectRatio || '画幅由 Agent 决定'}</span><span>{materialNeeds.length ? '素材需求：' + materialNeeds.join('、') : '暂无固定素材需求'}</span><span>{selectedTaskType?.name || '未绑定任务类型'} · {selectedStyleKit?.name || '未绑定风格包'} · {selectedBrandKit?.name || '未绑定品牌包'}</span><span>{createRound ? '会创建“' + selectedRoundPurpose.label + '”这一轮草稿' : '只创建任务，不创建批次'}</span></section>
      <CreationError error={error} /><footer><button type="button" className="outline-button" onClick={onDismiss} disabled={busy}>取消</button><button type="submit" className="command-button" disabled={busy || !name.trim()}>{busy ? '正在创建' : '创建任务'}</button></footer>
    </form>
  </AccessibleDialog>;
}

export function RoundCreationDialog({ task, rounds, currentRound, recipes = EMPTY, busy, error, onDismiss, onCreate }) {
  // 4.1 Q2：默认**不**要求先认领 5 个「轮次目的」——系统按描述推，想自己定点「改一下」。
  const initialPurposeId = currentRound ? 'variation' : DEFAULT_PURPOSE;
  const initialPurpose = ROUND_PURPOSE_OPTIONS.find((option) => option.id === initialPurposeId) || ROUND_PURPOSE_OPTIONS[0];
  const [advanced, setAdvanced] = useState(false);
  const [purpose, setPurpose] = useState(initialPurposeId);
  const [parentRoundId, setParentRoundId] = useState(currentRound?.id || '');
  const [targetCount, setTargetCount] = useState(initialPurpose.defaultCount || '');
  const [aspectRatio, setAspectRatio] = useState(initialPurpose.defaultAspectRatio || '');
  const [brief, setBrief] = useState('');
  const [variationAxes, setVariationAxes] = useState(listItems(initialPurpose.defaultVariationAxes));
  const [keepConstraints, setKeepConstraints] = useState(listItems(initialPurpose.defaultKeepConstraints));
  const [refinementGoals, setRefinementGoals] = useState(listItems(initialPurpose.defaultRefinementGoals));
  const [editInstruction, setEditInstruction] = useState('');
  const [preserveInstruction, setPreserveInstruction] = useState('');
  const [fillInstruction, setFillInstruction] = useState('');
  const [fillPreserveInstruction, setFillPreserveInstruction] = useState('');
  const selectedPurpose = ROUND_PURPOSE_OPTIONS.find((option) => option.id === purpose) || ROUND_PURPOSE_OPTIONS[0];
  const choosePurpose = (option) => {
    const previous = selectedPurpose;
    setPurpose(option.id);
    setIfEmptyOrDefault(setTargetCount, previous.defaultCount, option.defaultCount);
    setIfEmptyOrDefault(setAspectRatio, previous.defaultAspectRatio, option.defaultAspectRatio);
    setVariationAxes(listItems(option.defaultVariationAxes));
    setKeepConstraints(listItems(option.defaultKeepConstraints));
    setRefinementGoals(listItems(option.defaultRefinementGoals));
  };
  const applyRecommendedDefaults = () => {
    setTargetCount(selectedPurpose.defaultCount || '');
    setAspectRatio(selectedPurpose.defaultAspectRatio || '');
    setVariationAxes(listItems(selectedPurpose.defaultVariationAxes));
    setKeepConstraints(listItems(selectedPurpose.defaultKeepConstraints));
    setRefinementGoals(listItems(selectedPurpose.defaultRefinementGoals));
  };
  const quickBriefs = listItems(selectedPurpose.quickBriefs);
  const briefPlaceholder = quickBriefs[0] || '例如：说明本轮目标、输入素材、限制条件和交付用途。';
  const shouldSuggestParent = ['variation', 'refinement', 'edit', 'fill'].includes(purpose) && !parentRoundId;
  const submit = (event) => {
    event.preventDefault();
    const count = targetCount ? Number(targetCount) : undefined;
    const plan = compactRecord({ createdFrom: 'workbench', draftKind: 'studio-round-context', purposeLabel: selectedPurpose.label, recommendedInputs: listItems(selectedPurpose.recommendedInputs), brief: brief.trim(), targetCount: count, aspectRatio, parentRoundId, variationAxes, keepConstraints, refinementGoals, editInstruction: editInstruction.trim(), preserveInstruction: preserveInstruction.trim(), fillInstruction: fillInstruction.trim(), fillPreserveInstruction: fillPreserveInstruction.trim(), note: '这是 Studio 记下的批次草稿；出图前仍需会话整理成可确认的计划。' });
    onCreate({ purpose, purposeLabel: selectedPurpose.label, parentRoundId, plan });
  };
  return <AccessibleDialog className="creation-dialog is-wide" label="新建批次" onDismiss={onDismiss}>
    <form className="creation-form" onSubmit={submit}>
      <header><div><p className="eyebrow">{task.name}</p><h2>新建批次</h2><span>选择这次创作要完成的事情，Studio 会给出推荐默认值、父批次提示和示例文本。这里创建的是草稿。</span></div><IconButton label="关闭新建批次" onClick={onDismiss}><X size={16} /></IconButton></header>
      <ExecutionBoundaryNote />
      <section className="creation-section"><div className="creation-advanced-row"><div><h3>批次目的（可不选）</h3><span>{defaultPurposeNote()}</span></div><button type="button" className="outline-button" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>{advanced ? '收起' : '改一下'}</button></div>{questionnaireVisible({ mode: advanced ? 'advanced' : 'default' }) && <div className="creation-choice-grid" role="radiogroup" aria-label="批次目的">{ROUND_PURPOSE_OPTIONS.map((option) => <button type="button" key={option.id} className={purpose === option.id ? 'is-active' : ''} aria-pressed={purpose === option.id} onClick={() => choosePurpose(option)}><b>{option.label}</b><span>{option.description}</span></button>)}</div>}</section>
      {questionnaireVisible({ mode: advanced ? 'advanced' : 'default' }) && <section className="creation-section creation-selection-detail"><div><b>{selectedPurpose.label}</b><span>{selectedPurpose.description}</span></div><div className="creation-detail-grid"><span><strong>推荐默认值</strong>{creationDefaultSummary(selectedPurpose)}</span><span><strong>父批次提示</strong>{shouldSuggestParent ? '建议绑定父批次或从资产节点发起。' : parentRoundId ? '已绑定父批次。' : '可作为新的探索起点。'}</span><span><strong>需要补充</strong>{listItems(selectedPurpose.recommendedInputs).join('、') || '无固定字段'}</span></div><button type="button" className="outline-button creation-apply-defaults" onClick={applyRecommendedDefaults}>套用推荐默认值</button></section>}
      <section className="creation-section is-two-columns"><label><span>父批次（这一批有没有上一批？必答，可改）</span><select value={parentRoundId} onChange={(event) => setParentRoundId(event.target.value)}><option value="">不绑定父批次</option>{rounds.map((round) => <option value={round.id} key={round.id}>{ROUND_PURPOSE_LABELS[round.purpose] || round.purpose} · 计划 v{round.planVersion}</option>)}</select><small>{shouldSuggestParent ? '变体、精修、局部修改和补图通常需要父批次或父资产。' : '探索批次可以不绑定父批次。'}</small></label><label><span>目标数量</span><select value={targetCount} onChange={(event) => setTargetCount(event.target.value)}>{CREATION_COUNT_OPTIONS.map((value) => <option value={value} key={value || 'auto'}>{value ? value + ' 张' : '让 Agent 决定'}</option>)}</select></label><label><span>画幅</span><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{CREATION_ASPECT_OPTIONS.map((value) => <option value={value} key={value || 'auto'}>{value || '沿用任务/由 Agent 决定'}</option>)}</select></label></section>
      {advanced && purpose === 'variation' && <section className="creation-section"><CreationChoiceList label="希望变化的维度" values={variationAxes} options={DERIVED_VARIATION_AXES} onChange={setVariationAxes} /><CreationChoiceList label="希望保持不变" values={keepConstraints} options={DERIVED_KEEP_CONSTRAINTS} onChange={setKeepConstraints} /></section>}
      {advanced && purpose === 'refinement' && <section className="creation-section"><CreationChoiceList label="希望精修的目标" values={refinementGoals} options={DERIVED_REFINEMENT_GOALS} onChange={setRefinementGoals} /><CreationChoiceList label="希望保持不变" values={keepConstraints} options={DERIVED_KEEP_CONSTRAINTS} onChange={setKeepConstraints} /></section>}
      {advanced && purpose === 'edit' && <section className="creation-section is-two-columns"><label><span>要修改什么</span><textarea value={editInstruction} onChange={(event) => setEditInstruction(event.target.value)} placeholder="例如：替换背景中的植物和文字区域。" /></label><label><span>哪些内容保持不变</span><textarea value={preserveInstruction} onChange={(event) => setPreserveInstruction(event.target.value)} placeholder="例如：人物身份、产品轮廓、Logo 和主体光线。" /></label></section>}
      {advanced && purpose === 'fill' && <section className="creation-section is-two-columns"><label><span>扩展或补充方向</span><textarea value={fillInstruction} onChange={(event) => setFillInstruction(event.target.value)} placeholder="例如：向左右扩展环境，补齐桌面和背景留白。" /></label><label><span>补图时保持不变</span><textarea value={fillPreserveInstruction} onChange={(event) => setFillPreserveInstruction(event.target.value)} placeholder="例如：主体位置、产品比例、光影方向不变。" /></label></section>}
      <section className="creation-section"><label><span>本轮目标 <small>可选；特殊要求请说明输入、限制和交付用途</small></span><textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder={briefPlaceholder} /></label><CreationSuggestionChips options={quickBriefs} onChoose={setBrief} />{listItems(recipes).length > 0 && <div className="creation-recipes" aria-label="我的配方"><span>我的配方（点了带出，可改）</span>{listItems(recipes).map((recipe) => <button type="button" key={recipe.id} className="outline-button" onClick={() => setBrief(String(recipe.definition?.prompt || ''))}>{recipe.name}</button>)}</div>}<p className="creation-hint">后续由会话把这一轮记下的内容整理成可审阅的计划；Studio 不会把这段文字直接发给生成服务。</p></section>
      <section className="creation-summary"><p className="eyebrow">创建摘要</p><strong>{selectedPurpose.label}</strong><span>{targetCount ? targetCount + ' 张' : '数量由 Agent 决定'} · {aspectRatio || '画幅由 Agent 决定'}</span><span>{parentRoundId ? '已绑定父批次' : '不绑定父批次'} · 草稿批次</span></section>
      <CreationError error={error} /><footer><button type="button" className="outline-button" onClick={onDismiss} disabled={busy}>取消</button><button type="submit" className="command-button" disabled={busy}>{busy ? '正在创建' : '创建批次'}</button></footer>
    </form>
  </AccessibleDialog>;
}

export function ReferenceAssetDialog({ project, task, round, sharedAssets, selectedMaterials, busy, error, onDismiss, onSave, onPreview }) {
  const pageSize = 24;
  const [scope, setScope] = useState('project');
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [candidates, setCandidates] = useState(EMPTY);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState(() => new Map(selectedMaterials.map((item) => [item.assetId, { ...item }])));
  useEffect(() => {
    if (scope === 'shared') {
      setCandidates(EMPTY);
      setTotal(sharedAssets.length);
      setLoading(false);
      setLoadError('');
      return undefined;
    }
    const controller = new AbortController();
    let cancelled = false;
    const params = new URLSearchParams({ scope, limit: String(pageSize), offset: String((page - 1) * pageSize) });
    if (project?.id) params.set('projectId', project.id);
    if (task?.id) params.set('taskId', task.id);
    if (round?.id) params.set('roundId', round.id);
    if (kind !== 'all') params.set('kind', kind);
    setLoading(true);
    setLoadError('');
    api('/api/assets?' + params.toString(), { signal: controller.signal }).then((data) => {
      if (cancelled) return;
      setCandidates(data.assets || EMPTY);
      setTotal(data.total || 0);
    }).catch((nextError) => {
      if (!cancelled && !isAbortError(nextError)) setLoadError(errorMessageForDisplay(normalizeRequestError(nextError, '无法读取素材列表。', { operation: 'load-reference-assets', phase: 'loading' }), '无法读取素材列表。'));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; controller.abort(); };
  }, [scope, kind, page, project?.id, task?.id, round?.id, sharedAssets.length]);
  useEffect(() => { setPage(1); }, [scope, kind]);
  const sourceAssets = scope === 'shared' ? sharedAssets : candidates;
  const listedAssets = sourceAssets.filter((asset) => !asset.deletedAt && (kind === 'all' || asset.kind === kind) && assetMatchesQuery(asset, query));
  const visibleAssetById = new Map(sourceAssets.map((asset) => [asset.id, asset]));
  const totalPages = scope === 'shared' ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const setMaterial = (asset, patch = {}) => setDraft((current) => {
    const next = new Map(current);
    const existing = next.get(asset.id);
    next.set(asset.id, { assetId: asset.id, usage: patch.usage || existing?.usage || 'subject', note: patch.note ?? existing?.note ?? '' });
    return next;
  });
  const toggleAsset = (asset) => setDraft((current) => {
    const next = new Map(current);
    if (next.has(asset.id)) next.delete(asset.id);
    else next.set(asset.id, { assetId: asset.id, usage: 'subject', note: '' });
    return next;
  });
  const selected = [...draft.values()];
  return <AccessibleDialog className="reference-dialog" label="选择参考素材" onDismiss={onDismiss}>
    <div className="reference-dialog-body">
      <header><div><p className="eyebrow">{project.name} / {task.name}</p><h2>选择本轮参考素材</h2><span>选择素材并标注用途；Studio 会把这份选择记下来。</span></div><IconButton label="关闭参考素材选择" onClick={onDismiss}><X size={16} /></IconButton></header>
      <ExecutionBoundaryNote>{DRAFT_BOUNDARY_COPY + '已确认或正在出图的批次，要回会话里改计划。'}</ExecutionBoundaryNote>
      <section className="reference-toolbar" aria-label="素材筛选">
        <div className="workspace-list-filters">{[['project', '当前项目'], ['task', '当前任务'], ['round', '当前批次'], ['shared', '共享素材']].map(([value, label]) => <button type="button" key={value} className={scope === value ? 'is-active' : ''} disabled={(value === 'task' && !task) || (value === 'round' && !round)} onClick={() => setScope(value)}>{label}</button>)}</div>
        <label className="workspace-list-search"><Search size={15} /><input type="search" value={query} placeholder="搜索当前页素材名称、任务或 ID" aria-label="搜索当前页素材名称、任务或 ID" onChange={(event) => setQuery(event.target.value)} />{query && <IconButton label="清空素材搜索" onClick={() => setQuery('')}><X size={14} /></IconButton>}</label>
        <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="素材类型"><option value="all">全部素材</option><option value="import">导入素材</option><option value="generated">生成结果</option></select>

      </section>
      <section className="reference-selected"><h3>已选 {selected.length} 张</h3>{selected.length ? <div>{selected.map((item) => {
        const asset = visibleAssetById.get(item.assetId);
        return <article key={item.assetId}><span>{asset?.display?.label || item.assetId}</span><select value={item.usage} aria-label={'参考用途：' + (asset?.display?.label || item.assetId)} onChange={(event) => setDraft((current) => { const next = new Map(current); next.set(item.assetId, { ...item, usage: event.target.value }); return next; })}>{REFERENCE_USAGE_OPTIONS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select><input value={item.note || ''} onChange={(event) => setDraft((current) => { const next = new Map(current); next.set(item.assetId, { ...item, note: event.target.value }); return next; })} placeholder="选填：说明希望 Agent 如何理解这张图" aria-label={'参考备注：' + (asset?.display?.label || item.assetId)} /><IconButton label="移除已选参考素材" onClick={() => setDraft((current) => { const next = new Map(current); next.delete(item.assetId); return next; })}><X size={14} /></IconButton></article>;
      })}</div> : <p>点击下方素材即可加入；如果选择“自定义”方向，请在备注里说明用途。</p>}</section>
      <section className="reference-candidates" aria-busy={loading}>
        {loading ? <div className="empty-stage"><RefreshCw className="spin" size={22} /><p>正在读取素材</p></div> : loadError ? <div className="creation-form-error" role="alert"><CircleAlert size={15} /><span>{loadError}</span></div> : listedAssets.length ? <div className="reference-candidate-grid">{listedAssets.map((asset) => {
          const active = draft.has(asset.id);
          return <article className={'reference-candidate ' + (active ? 'is-active' : '')} key={asset.id}><button type="button" onClick={() => toggleAsset(asset)} aria-pressed={active}><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /><span><b>{asset.display?.label || (asset.kind === 'generated' ? '生成结果' : '导入素材')}</b><small>{active ? '已选为参考素材' : '点击加入参考素材'}</small></span></button><IconButton label="预览素材" onClick={() => onPreview([asset])}><Eye size={14} /></IconButton>{active && <select value={draft.get(asset.id)?.usage || 'subject'} onChange={(event) => setMaterial(asset, { usage: event.target.value })} aria-label="参考用途">{REFERENCE_USAGE_OPTIONS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select>}</article>;
        })}</div> : <div className="empty-stage"><ImagePlus size={24} /><p>{query ? '没有符合搜索条件的素材。' : '当前范围没有可用素材。可以先在项目素材页导入，再回来选择。'}</p></div>}
      </section>
      {scope !== 'shared' && <ListPager page={page} totalPages={totalPages} total={total} onPageChange={setPage} />}
      <CreationError error={error} />
      <footer><button type="button" className="outline-button" disabled={busy} onClick={onDismiss}>取消</button><button type="button" className="command-button" disabled={busy} onClick={() => onSave(selected)}>{busy ? '正在保存' : '保存参考素材'}</button></footer>
    </div>
  </AccessibleDialog>;
}

export function ReferenceRoundResolverDialog({ project, task = null, tasks = EMPTY, draftRounds, assets, usage, busy, error, onDismiss, onUseRound, onSelectTask, onCreateRound, onPreview }) {
  const usageLabel = REFERENCE_USAGE_LABELS[usage] || '参考素材';
  const taskList = Array.isArray(tasks) ? tasks : EMPTY;
  const taskById = new Map(taskList.map((item) => [item.id, item]));
  const selectedTask = task || (taskList.length === 1 ? taskList[0] : null);
  const createTargetTask = selectedTask;
  const context = [project.name, selectedTask?.name].filter(Boolean).join(' / ');
  const helper = draftRounds.length ? '选择一个还没开工的批次后，Studio 会直接写入参考素材。' : createTargetTask ? '当前任务还没有可直接写入的批次，可以新建一轮后自动加入。' : '先选择任务，再选一个已有批次或新建一轮。';
  return <AccessibleDialog className="reference-dialog reference-round-resolver" label="选择还没开工的批次" onDismiss={onDismiss}>
    <div className="reference-dialog-body">
      <header><div><p className="eyebrow">{context || project.name}</p><h2>把图片作为{usageLabel}</h2><span>{helper}</span></div><IconButton label="关闭批次选择" onClick={onDismiss}><X size={16} /></IconButton></header>
      <ExecutionBoundaryNote>{DRAFT_BOUNDARY_COPY + '计划由会话整理，你确认后才开始。'}</ExecutionBoundaryNote>
      <section className="derived-source-strip is-compact" aria-label="待加入参考的图片">{assets.map((asset) => <article key={asset.id}><button type="button" onClick={() => onPreview([asset])}><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /></button><div className="derived-source-copy"><b>{asset.display?.label || (asset.kind === 'generated' ? '生成结果' : '导入素材')}</b><span>{asset.id}</span></div></article>)}</section>
      {!selectedTask && taskList.length > 1 && <section className="reference-round-options reference-task-options" aria-label="选择任务"><p className="eyebrow">先选择任务</p>{taskList.map((item) => <button type="button" key={item.id} className="outline-button" disabled={busy} onClick={() => onSelectTask(item.id)}><GitFork size={15} /><span><b>{item.name}</b><small>{item.status === 'archived' ? '已归档' : '在这个任务里选一轮，或新建一轮'}</small></span></button>)}</section>}
      {selectedTask && taskList.length > 1 && <p className="reference-task-current">当前任务：<strong>{selectedTask.name}</strong></p>}
      <section className="reference-round-options" aria-label="可写入的批次">
        {draftRounds.length ? draftRounds.map((round) => {
          const roundTask = taskById.get(round.taskId) || selectedTask;
          const roundTaskLabel = roundTask && (!selectedTask || roundTask.id !== selectedTask.id) ? roundTask.name + ' / ' : '';
          return <button type="button" key={round.id} className="outline-button" disabled={busy} onClick={() => onUseRound(round.id)}><GitFork size={15} /><span><b>{roundTaskLabel}{ROUND_PURPOSE_LABELS[round.purpose] || round.purpose} · 计划 v{round.planVersion}</b><small>{round.description || round.plan?.brief || '加入这一轮'}</small></span></button>;
        }) : <div className="empty-stage"><GitFork size={24} /><p>{createTargetTask ? '当前任务还没有可直接写入的批次。' : '选择任务后即可新建一轮。'}</p></div>}
      </section>
      <CreationError error={error} />
      <footer><button type="button" className="outline-button" disabled={busy} onClick={onDismiss}>取消</button><button type="button" className="command-button" disabled={busy || !createTargetTask} onClick={onCreateRound}><GitFork size={16} />{createTargetTask ? '新建一轮并加入' : '先选择任务'}</button></footer>
    </div>
  </AccessibleDialog>;
}

export function ToggleButtonList({ options, value, onChange, label }) {
  const selected = new Set(value || []);
  const toggle = (item) => {
    const next = new Set(selected);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    onChange([...next]);
  };
  return <div className="derived-toggle-list" aria-label={label}>{options.map((item) => <button type="button" key={item} className={selected.has(item) ? 'is-active' : ''} aria-pressed={selected.has(item)} onClick={() => toggle(item)}>{item}</button>)}</div>;
}

export function DerivedRoundDialog({ project, task, rounds, currentRound, assets, initialPurpose, initialActionId, busy, error, onDismiss, onCreate, onPreview, onImportMask }) {
  const initialAction = DERIVED_ACTION_BY_ID[initialActionId] || creativeDerivedActionForPurpose(initialPurpose) || DERIVED_ROUND_ACTIONS[0];
  const initialSourceAssets = (assets || EMPTY).filter((asset) => asset && !asset.deletedAt);
  const defaultParentRoundId = initialSourceAssets.length === 1 && initialSourceAssets[0].display?.taskId === task.id && initialSourceAssets[0].display?.roundId ? initialSourceAssets[0].display.roundId : currentRound?.id || '';
  const initialPreset = defaultDerivedPresetForPurpose(initialAction.purpose);
  const maskInputRef = useRef(null);
  const [sourceAssets, setSourceAssets] = useState(initialSourceAssets);
  const [selectedActionId, setSelectedActionId] = useState(initialAction.id);
  const [purpose, setPurpose] = useState(initialAction.purpose);
  const [parentRoundId, setParentRoundId] = useState(defaultParentRoundId);
  const [targetCount, setTargetCount] = useState('');
  const [aspectRatio, setAspectRatio] = useState('');
  const [variationAxes, setVariationAxes] = useState(initialAction.defaultVariationAxes || (initialAction.purpose === 'variation' ? ['构图', '背景'] : []));
  const [keepConstraints, setKeepConstraints] = useState(initialAction.defaultKeepConstraints || ['主体']);
  const [refinementGoals, setRefinementGoals] = useState(initialAction.defaultRefinementGoals || (initialAction.purpose === 'refinement' ? ['质感', '细节'] : []));
  const [note, setNote] = useState('');
  const [arrangementMode, setArrangementMode] = useState(initialPreset?.id || 'custom');
  const [primaryAssetId, setPrimaryAssetId] = useState(initialSourceAssets[0]?.id || '');
  const [materials, setMaterials] = useState(() => initialPreset ? buildDerivedPresetMaterials(initialSourceAssets, initialPreset, initialAction.usage) : buildDerivedPresetMaterials(initialSourceAssets, { label: '自定义编排', all: initialAction.usage }, initialAction.usage));
  const [maskImporting, setMaskImporting] = useState(false);
  const [maskImportError, setMaskImportError] = useState('');
  const action = DERIVED_ACTION_BY_ID[selectedActionId] || creativeDerivedActionForPurpose(purpose) || initialAction;
  const applicablePresets = DERIVED_REFERENCE_PRESETS.filter((preset) => derivedPresetAllowed(preset, purpose));
  const selectedPreset = applicablePresets.find((preset) => preset.id === arrangementMode) || null;
  const selectedMaterials = sourceAssets.map((asset) => materials.get(asset.id) || { assetId: asset.id, usage: action.usage, note: '' });
  const usageCounts = usageCountsFromMaterials(selectedMaterials);
  const maskMaterials = selectedMaterials.filter((item) => item.usage === 'mask');
  const applyPreset = (preset) => {
    setArrangementMode(preset.id);
    setPrimaryAssetId(sourceAssets[0]?.id || '');
    setMaterials(buildDerivedPresetMaterials(sourceAssets, preset, action.usage));
  };
  const choosePurpose = (option) => {
    const preset = defaultDerivedPresetForPurpose(option.purpose);
    setSelectedActionId(option.id);
    setPurpose(option.purpose);
    setArrangementMode(preset?.id || 'custom');
    setMaterials(preset ? buildDerivedPresetMaterials(sourceAssets, preset, option.usage) : buildDerivedPresetMaterials(sourceAssets, { label: '自定义编排', all: option.usage }, option.usage));
    if (option.defaultVariationAxes) setVariationAxes(option.defaultVariationAxes);
    else if (option.purpose === 'variation') setVariationAxes((current) => current.length ? current : ['构图', '背景']);
    if (option.defaultKeepConstraints) setKeepConstraints(option.defaultKeepConstraints);
    if (option.defaultRefinementGoals) setRefinementGoals(option.defaultRefinementGoals);
    else if (option.purpose === 'refinement') setRefinementGoals((current) => current.length ? current : ['质感', '细节']);
  };
  const setMaterialPatch = (assetId, patch = {}) => setMaterials((current) => {
    const next = new Map(current);
    const existing = next.get(assetId) || { assetId, usage: action.usage, note: '' };
    next.set(assetId, { ...existing, ...patch, assetId });
    return next;
  });
  const setAllMaterials = (usage) => {
    setArrangementMode('custom');
    setMaterials(new Map(sourceAssets.map((asset, index) => {
      const existing = materials.get(asset.id);
      return [asset.id, { assetId: asset.id, usage, note: existing?.note || (index === 0 ? '主参考图；' : '') + (DERIVED_REFERENCE_USAGE_NOTES[usage] || REFERENCE_USAGE_LABELS[usage] || usage) + '。' }];
    })));
  };
  const importMaskFiles = async (files) => {
    const file = Array.from(files || []).find((item) => item?.type?.startsWith('image/'));
    if (!file) { setMaskImportError('请选择 PNG、JPG、WebP 或 GIF 图片作为遮罩。'); return; }
    if (!onImportMask) { setMaskImportError('当前 Workbench 不支持在此处导入遮罩图。'); return; }
    setMaskImporting(true);
    setMaskImportError('');
    try {
      const asset = await onImportMask(file);
      if (!asset?.id) throw new Error('遮罩图导入成功但未返回资产。');
      if (sourceAssets.some((item) => item.id === asset.id)) {
        setMaskImportError('导入的遮罩与当前参考图完全相同。为避免覆盖主体用途，请选择不同的遮罩图，或直接把现有图片改为遮罩。');
        return;
      }
      setSourceAssets((current) => [...current, asset]);
      setMaterials((current) => {
        const next = new Map(current);
        next.set(asset.id, { assetId: asset.id, usage: 'mask', note: '遮罩图；白色区域通常表示需要修改，黑色或透明区域保持。' });
        return next;
      });
    } catch (nextError) {
      setMaskImportError(errorMessageForDisplay(nextError, '无法导入遮罩图。'));
    } finally {
      setMaskImporting(false);
      if (maskInputRef.current) maskInputRef.current.value = '';
    }
  };
  const submit = (event) => {
    event.preventDefault();
    const arrangementLabel = selectedPreset?.label || '自定义编排';
    const parentAssetIds = purpose === 'edit' ? selectedMaterials.filter((item) => item.usage !== 'mask').map((item) => item.assetId) : sourceAssets.map((asset) => asset.id);
    onCreate({ purpose, action: action.id || purpose, actionLabel: action.title || action.label || '', parentRoundId, sourceAssetIds: sourceAssets.map((asset) => asset.id), parentAssetIds, referenceMaterials: selectedMaterials, primaryAssetId, referenceArrangementMode: arrangementMode, referenceArrangementLabel: arrangementLabel, referenceArrangement: { mode: arrangementMode, label: arrangementLabel, usageCounts }, targetCount: targetCount ? Number(targetCount) : undefined, aspectRatio, variationAxes, keepConstraints, refinementGoals, instruction: note.trim(), note: note.trim() });
  };
  return <AccessibleDialog className="creation-dialog is-wide derived-round-dialog" label="基于图片创建下一轮" onDismiss={onDismiss}>
    <form className="creation-form" onSubmit={submit}>
      <header><div><p className="eyebrow">{project.name} / {task.name}</p><h2>基于图片创建下一轮</h2><span>Studio 会新建一轮草稿和参考关系。</span></div><IconButton label="关闭图片迭代" onClick={onDismiss}><X size={16} /></IconButton></header>
      <ExecutionBoundaryNote />
      <section className="creation-section"><h3>你想如何继续？</h3><div className="creation-choice-grid" role="radiogroup" aria-label="图片迭代动作">{DERIVED_ROUND_ACTIONS.map((option) => <button type="button" key={option.id} className={selectedActionId === option.id ? 'is-active' : ''} aria-pressed={selectedActionId === option.id} onClick={() => choosePurpose(option)}><b>{option.label}</b><span>{option.description}</span></button>)}</div></section>
      <section className="creation-section derived-purpose-board"><header><div><h3>多图用途编排</h3><p>先套用常见创作关系，再逐张微调用途和说明；Agent 会读取这些结构化角色。</p></div><span>{sourceAssets.length} 张来源图</span></header><div className="derived-arrangement-grid" role="radiogroup" aria-label="多图用途编排模板">{applicablePresets.map((preset) => <button type="button" key={preset.id} className={arrangementMode === preset.id ? 'is-active' : ''} aria-pressed={arrangementMode === preset.id} onClick={() => applyPreset(preset)}><b>{preset.label}</b><span>{preset.description}</span></button>)}<button type="button" className={arrangementMode === 'custom' ? 'is-active' : ''} aria-pressed={arrangementMode === 'custom'} onClick={() => setArrangementMode('custom')}><b>自定义编排</b><span>逐张指定主体、风格、构图、色彩、品牌、遮罩或反例用途。</span></button></div><div className="derived-usage-summary" aria-label="当前用途统计">{REFERENCE_USAGE_OPTIONS.filter((option) => usageCounts[option.id]).map((option) => <span key={option.id}><b>{usageCounts[option.id]}</b>{option.label}</span>)}</div></section>
      {purpose === 'edit' && <section className="creation-section mask-lite-panel" onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void importMaskFiles(event.dataTransfer.files); }} onPaste={(event) => { const files = [...event.clipboardData.files].filter((item) => item.type.startsWith('image/')); if (files.length) { event.preventDefault(); event.stopPropagation(); void importMaskFiles(files); } }} tabIndex={0} aria-label="轻量遮罩准备"><div><h3>轻量遮罩准备</h3><p>不做画笔编辑器：可以把已选图指定为遮罩，也可以导入、拖入或粘贴一张黑白 / 透明遮罩图。生成前仍会核算生成服务的能力和遮罩素材。</p></div><div className="mask-lite-actions"><button type="button" className="command-button" disabled={maskImporting} onClick={() => maskInputRef.current?.click()}><ImagePlus size={15} />{maskImporting ? '正在导入遮罩' : '导入遮罩图'}</button><button type="button" className="outline-button" disabled={sourceAssets.length < 2} onClick={() => { setArrangementMode('custom'); setMaterialPatch(sourceAssets[1].id, { usage: 'mask', note: '遮罩图；白色区域通常表示需要修改，黑色或透明区域保持。' }); }}>第 2 张设为遮罩</button></div><input ref={maskInputRef} className="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void importMaskFiles(event.target.files)} /><div className="mask-lite-status"><span>{maskMaterials.length ? '已选择 ' + maskMaterials.length + ' 张遮罩图' : '尚未选择遮罩图；也可以先创建草稿，让 Agent 后续提示补齐。'}</span><small>遮罩不会当成普通参考图发给生成服务。</small></div>{maskImportError && <div className="creation-form-error" role="alert"><CircleAlert size={15} /><span>{maskImportError}</span></div>}</section>}
      <section className="derived-source-strip is-board" aria-label="本次参考图片">{sourceAssets.map((asset, index) => {
        const material = materials.get(asset.id) || { assetId: asset.id, usage: action.usage, note: '' };
        const assetLabel = asset.display?.label || (asset.kind === 'generated' ? '生成结果' : '导入素材');
        const primary = primaryAssetId === asset.id;
        return <article key={asset.id} className={primary ? 'is-primary' : ''}><button type="button" className="derived-source-preview" onClick={() => onPreview([asset])} aria-label="预览参考图片"><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /></button><div className="derived-source-copy"><div className="derived-source-title"><b title={assetLabel}>{index + 1}. {assetLabel}</b><button type="button" className="outline-button derived-primary-button" aria-pressed={primary} onClick={() => setPrimaryAssetId(asset.id)}>{primary ? '主参考' : '设为主参考'}</button></div><div className="derived-role-chips" aria-label={'分配 ' + assetLabel + ' 的用途'}>{REFERENCE_USAGE_OPTIONS.map((option) => <button type="button" key={option.id} className={material.usage === option.id ? 'is-active' : ''} aria-pressed={material.usage === option.id} title={option.description} onClick={() => { setArrangementMode('custom'); setMaterialPatch(asset.id, { usage: option.id, note: material.note || (DERIVED_REFERENCE_USAGE_NOTES[option.id] || option.label) + '。' }); }}>{option.label}</button>)}</div><input value={material.note || ''} onChange={(event) => { setArrangementMode('custom'); setMaterialPatch(asset.id, { note: event.target.value }); }} placeholder="这张图在下一轮里的用途说明" /></div></article>;
      })}</section>
      <section className="creation-section"><h3>快速分配用途</h3><div className="derived-preset-row"><button type="button" className="outline-button" onClick={() => setAllMaterials('subject')}>全部主体参考</button><button type="button" className="outline-button" onClick={() => setAllMaterials('style')}>全部风格参考</button><button type="button" className="outline-button" onClick={() => setAllMaterials('composition')}>全部构图参考</button><button type="button" className="outline-button" onClick={() => setAllMaterials('negative')}>全部反例</button></div></section>
      <section className="creation-section is-two-columns"><label><span>父批次</span><select value={parentRoundId} onChange={(event) => setParentRoundId(event.target.value)}><option value="">不绑定父批次</option>{rounds.map((round) => <option value={round.id} key={round.id}>{ROUND_PURPOSE_LABELS[round.purpose] || round.purpose} · 计划 v{round.planVersion}</option>)}</select></label><label><span>目标数量</span><select value={targetCount} onChange={(event) => setTargetCount(event.target.value)}>{CREATION_COUNT_OPTIONS.map((value) => <option value={value} key={value || 'auto'}>{value ? value + ' 张' : '让 Agent 决定'}</option>)}</select></label><label><span>画幅</span><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{CREATION_ASPECT_OPTIONS.map((value) => <option value={value} key={value || 'auto'}>{value || '沿用原图 / 由 Agent 决定'}</option>)}</select></label><label className="creation-full"><span>{purpose === 'edit' ? '修改说明' : purpose === 'fill' ? '补图 / 扩图说明' : '补充说明'}</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={purpose === 'variation' ? '例如：保持主体，换 4 种背景与构图。' : purpose === 'refinement' ? '例如：主体不变，提升质感、光影和细节。' : purpose === 'edit' ? '例如：只替换背景，主体和 Logo 不变。' : '例如：把这张竖图扩成 16:9 横版，左右补足场景。'} /></label></section>
      {purpose === 'variation' && <section className="creation-section"><h3>变化维度</h3><ToggleButtonList label="变化维度" options={DERIVED_VARIATION_AXES} value={variationAxes} onChange={setVariationAxes} /></section>}
      {purpose === 'refinement' && <section className="creation-section"><h3>精修目标</h3><ToggleButtonList label="精修目标" options={DERIVED_REFINEMENT_GOALS} value={refinementGoals} onChange={setRefinementGoals} /></section>}
      <section className="creation-section"><h3>保持不变</h3><ToggleButtonList label="保持不变" options={DERIVED_KEEP_CONSTRAINTS} value={keepConstraints} onChange={setKeepConstraints} /></section>
      <CreationError error={error} />
      <footer><button type="button" className="outline-button" onClick={onDismiss} disabled={busy}>取消</button><button type="submit" className="command-button" disabled={busy || !sourceAssets.length}>{busy ? '正在创建' : '创建批次'}</button></footer>
    </form>
  </AccessibleDialog>;
}

export function RejectReviewDialog({ assets, canAddNegative, canCreateNextRound, initialCreateNextRound = false, busy, error, onDismiss, onSave, onPreview }) {
  const [reasonIds, setReasonIds] = useState(['style-wrong']);
  const [note, setNote] = useState('');
  const [addNegative, setAddNegative] = useState(false);
  const [createNextRound, setCreateNextRound] = useState(Boolean(initialCreateNextRound && canCreateNextRound));
  const submit = (event) => {
    event.preventDefault();
    onSave({ reasonIds, reasons: reasonIds.map((id) => REJECT_REASON_LABELS[id] || id), note: note.trim(), source: 'workbench-reject-dialog' }, { addAsNegative: addNegative && canAddNegative, createNextRound: createNextRound && canCreateNextRound });
  };
  return <AccessibleDialog className="creation-dialog reject-review-dialog" label="不采用原因" onDismiss={onDismiss}>
    <form className="creation-form" onSubmit={submit}>
      <header><div><p className="eyebrow">结构化评审</p><h2>为什么不采用？</h2><span>这些反馈会写入资产评审记录；需要时也可以转为下一轮的反例、修正目标和保持约束。</span></div><IconButton label="关闭不采用原因" onClick={onDismiss}><X size={16} /></IconButton></header>
      <ExecutionBoundaryNote>{DRAFT_BOUNDARY_COPY + '反馈会写进评审记录，方便下一轮参考。'}</ExecutionBoundaryNote>
      <section className="derived-source-strip is-compact" aria-label="不采用图片">{assets.map((asset) => <article key={asset.id}><button type="button" onClick={() => onPreview([asset])} aria-label="预览不采用图片"><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /></button><div><b>{asset.display?.label || '素材'}</b><span>{asset.kind === 'generated' ? '生成结果' : '导入素材'}</span></div></article>)}</section>
      <section className="creation-section"><h3>选择原因</h3><div className="derived-toggle-list" aria-label="不采用原因">{REJECT_REASON_OPTIONS.map((option) => { const active = reasonIds.includes(option.id); return <button type="button" key={option.id} className={active ? 'is-active' : ''} aria-pressed={active} onClick={() => setReasonIds((current) => active ? current.filter((id) => id !== option.id) : [...current, option.id])}>{option.label}</button>; })}</div></section>
      <section className="creation-section"><label><span>补充说明</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：主体形态偏离品牌角色；下轮不要再使用这种廉价金属质感。" /></label>{canAddNegative && <label className="creation-inline-checkbox"><input type="checkbox" checked={addNegative} disabled={createNextRound} onChange={(event) => setAddNegative(event.target.checked)} /><span>同时加入当前这一轮作为反例参考</span></label>}{canCreateNextRound && <label className="creation-inline-checkbox"><input type="checkbox" checked={createNextRound} onChange={(event) => { const checked = event.target.checked; setCreateNextRound(checked); if (checked) setAddNegative(false); }} /><span>从不采用原因创建下一轮草稿</span></label>}<p className="creation-field-hint">勾选后会新建一轮草稿，可以在创作平台继续改。</p></section>
      <CreationError error={error} />
      <footer><button type="button" className="outline-button" disabled={busy} onClick={onDismiss}>取消</button><button type="submit" className="command-button" disabled={busy || !reasonIds.length}>{busy ? '正在保存' : createNextRound ? '保存并创建下一轮' : '保存不采用原因'}</button></footer>
    </form>
  </AccessibleDialog>;
}
