const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const skillRoot = path.resolve(__dirname, '../..');

test('project assets expose page selection, configurable pagination, and multi-file import', () => {
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(skillRoot, 'web/src/styles.css'), 'utf8');
  assert.match(main, /全选本页/);
  assert.match(main, /取消全选本页/);
  assert.match(main, /ASSET_PAGE_SIZES/);
  assert.match(main, /type="file" multiple/);
  assert.match(main, /Array\.from\(files \|\| \[\]\)/);
  assert.match(main, /正在导入.*completed.*total/);
  assert.match(main, /className="command-button asset-import-button"/);
  assert.match(main, /routeView === 'assets' && selectedProject && <button type="button" className="command-button asset-import-button"/);
  assert.match(main, /function WorkspaceContextBar\(\{ project, tasks = EMPTY, task/);
  assert.match(main, /className="workspace-context-select workspace-context-task"/);
  assert.match(main, /onSelectTask=\{\(taskId\) => taskId \? navigateRoute\(selectTask/);
  assert.match(main, /aria-label="任务工作入口"/);
  assert.match(main, />轮次对比<\/button>/);
  assert.doesNotMatch(main, /className="task-more-tabs"/);
  assert.match(main, /if \(!session\) void openWorkbenchSession\(\)\.catch/);
  assert.match(main, /\[session\?\.id, session\?\.version, eventRevision\.planVersions/);
  assert.match(main, /复制完整提示词/);
  assert.match(main, /onCopyPrompt\(activeRun\)/);
  assert.match(main, /\/api\/rounds\/' \+ encodeURIComponent\(selectedRound\.id\) \+ '\/plan-versions/);
  assert.match(main, /version\?\.plan\?\.prompt/);
  assert.match(main, /version\?\.plan\?\.itemPrompts/);
  assert.match(main, /第 ' \+ \(index \+ 1\) \+ ' 张完整提示词/);
  assert.match(main, /已复制 ' \+ copiedItemCount \+ ' 条逐图完整提示词/);
  assert.match(main, /function AdvancedDetailsPanel/);
  assert.match(main, /advanced-dry-run-card/);
  assert.match(main, /advanced-fact-grid/);
  assert.match(main, /查看原始摘要/);
  assert.doesNotMatch(main, /JSON\.stringify\(evidence\.details\)<\/p>/);
  assert.match(styles, /\.advanced-preflight-breakdown/);
});

test('current plan review exposes per-image prompts before confirmation', () => {
  const promptWorkspace = fs.readFileSync(path.join(skillRoot, 'web/src/prompt-workspace.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(skillRoot, 'web/src/styles.css'), 'utf8');
  assert.match(promptWorkspace, /function PlanReviewPanel/);
  assert.match(promptWorkspace, /逐图提示词/);
  assert.match(promptWorkspace, /Specific scene direction for this image:/);
  assert.match(promptWorkspace, /复制全部最终提示词/);
  assert.match(promptWorkspace, /复制结构化 JSON/);
  assert.match(promptWorkspace, /原始计划结构/);
  assert.match(promptWorkspace, /查看原始 JSON/);
  assert.match(promptWorkspace, /OPENAI_GPT_IMAGE_PROMPT_LIMIT = 32000/);
  assert.match(styles, /\.prompt-review-metrics/);
  assert.match(styles, /\.prompt-item-card/);
  assert.match(promptWorkspace, /function ReferenceMaterialsSection/);
  assert.match(promptWorkspace, /rawSummaryGroups/);
  assert.doesNotMatch(promptWorkspace, /function PromptStructureSection/);
  assert.doesNotMatch(promptWorkspace, /提示词独占展示/);
  assert.doesNotMatch(promptWorkspace, /<PromptStructureSection plan=\{plan\}/);
  assert.doesNotMatch(promptWorkspace, /\['提示词', \[\['prompt'/);
  assert.match(styles, /\.prompt-raw-layout/);
  assert.doesNotMatch(styles, /\.prompt-raw-prompt-section/);
  assert.match(styles, /\.prompt-raw-material-table/);
  assert.match(styles, /\.prompt-raw-groups div\.is-long/);
  assert.match(styles, /\.prompt-stage-actions \{ display:grid; grid-template-columns:repeat\(4,max-content\)/);
  assert.match(styles, /\.prompt-stage-actions \.outline-button \{ white-space:nowrap; \}/);
  assert.match(styles, /\.prompt-copy-notice \{ grid-column:1 \/ -1/);
});

test('Workbench exposes Studio-first creation controls without a second chat flow', () => {
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(skillRoot, 'web/src/styles.css'), 'utf8');
  assert.match(main, /PROJECT_CREATION_TEMPLATES/);
  assert.match(main, /TASK_CREATION_GOALS/);
  assert.match(main, /ROUND_CREATION_PURPOSES/);
  assert.match(main, /双入口、单工作流/);
  assert.match(main, /新建项目/);
  assert.match(main, /新建任务/);
  assert.match(main, /新建轮次/);
  assert.match(main, /同时创建首个轮次并设为当前上下文/);
  assert.match(main, /api\('\/api\/project-templates'/);
  assert.match(main, /templateVersion/);
  assert.match(main, /creation-selection-detail/);
  assert.match(main, /创建摘要/);
  assert.match(main, /descriptionPrompt/);
  assert.match(main, /projectTemplateDefaultName/);
  assert.match(main, /CreationSuggestionChips/);
  assert.match(main, /项目说明示例/);
  assert.doesNotMatch(main, /创建后建议|创建完成提示|nextSteps/);
  for (const handlerName of ['createProjectFromStudio', 'createTaskFromStudio', 'createRoundFromStudio']) {
    const start = main.indexOf('  const ' + handlerName + ' =');
    const end = main.indexOf('\n  const ', start + 1);
    assert.notEqual(start, -1, handlerName + ' handler must exist');
    assert.doesNotMatch(main.slice(start, end === -1 ? main.length : end), /setNotice\(\'[^\']+\'\)/, handlerName + ' must not show a creation success notice');
  }
  assert.match(main, /套用推荐默认值/);
  assert.match(main, /recommendedInputs/);
  assert.match(main, /defaultVariationAxes/);
  assert.match(main, /defaultRefinementGoals/);
  assert.match(main, /扩展或补充方向/);
  assert.doesNotMatch(main, /CreationNextGuide/);
  assert.match(main, /继续操作/);
  assert.doesNotMatch(main, /回到 Agent 可直接说/);
  assert.doesNotMatch(main, /外部 Provider 调用仍必须由 Agent/);
  assert.match(main, /taskGoalsForProjectTemplate/);
  assert.match(main, /creation-template-bridge/);
  assert.match(main, /项目模板联动/);
  assert.match(main, /模板推荐/);
  assert.match(main, /materialNeeds/);
  assert.match(main, /商品主图探索/);
  assert.match(main, /商品主体图/);
  assert.match(main, /defaultCount: '8'/);
  assert.match(main, /defaultAspectRatio: '1:1'/);
  assert.match(main, /DERIVED_VARIATION_AXES/);
  assert.match(main, /DERIVED_REFINEMENT_GOALS/);
  assert.match(main, /希望保持不变/);
  assert.match(main, /api\('\/api\/projects'/);
  assert.match(main, /api\('\/api\/tasks'/);
  assert.match(main, /api\('\/api\/rounds'/);
  assert.match(main, /Studio 创建的结构化上下文草稿/);
  assert.match(styles, /\.creation-dialog/);
  assert.match(styles, /\.creation-choice-grid/);
  assert.match(styles, /\.creation-summary/);
  assert.match(styles, /\.creation-choice-list/);
  assert.match(styles, /\.creation-suggestion-chips/);
  assert.match(styles, /\.creation-info-list/);
  assert.doesNotMatch(styles, /\.creation-next-actions/);
  assert.doesNotMatch(styles, /\.creation-next-boundary/);

  assert.match(styles, /\.creation-template-bridge/);
});
test('Workbench exposes a creator-facing reference material selector for draft rounds', () => {
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(skillRoot, 'web/src/styles.css'), 'utf8');
  assert.match(main, /REFERENCE_USAGE_OPTIONS/);
  assert.match(main, /ReferenceAssetDialog/);
  assert.match(main, /选择本轮参考素材/);
  assert.match(main, /主体参考/);
  assert.match(main, /api\('\/api\/rounds\/'.*\/draft-context/);
  assert.match(main, /回到当前上下文/);
  assert.match(styles, /\.reference-panel/);
  assert.match(styles, /\.reference-candidate-grid/);
  assert.match(main, /assets: \(\) => renderAssetsView\(\)/);
  assert.match(main, /MATERIAL_NEED_USAGE_RULES/);
  assert.match(main, /MaterialNeedChecklist/);
  assert.match(main, /MaterialImportGuide/);
  assert.match(main, /素材导入引导/);
  assert.match(main, /x-daoge-material-need/);
  assert.match(main, /x-daoge-material-usage/);
  assert.match(main, /导入成功后会按用途自动加入当前草稿轮次参考素材/);
  assert.match(styles, /\.material-need-checklist/);
  assert.match(styles, /\.material-import-guide/);
});

test('delivery page exposes a visible all-images selection action', () => {
  const delivery = fs.readFileSync(path.join(skillRoot, 'web/src/creator-delivery.jsx'), 'utf8');
  assert.match(delivery, /全选全部.*assets\.length.*张/);
  assert.match(delivery, /取消全选/);
  assert.match(delivery, /打包下载.*selected\.length.*张/);
});

test('image preview can select deliverables and the selection strip keeps removal compact', () => {
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(skillRoot, 'web/src/styles.css'), 'utf8');
  assert.match(main, /inspector-select-control/);
  assert.match(main, /onChange=\{\(\) => void onToggleDeliverable\(asset\)\}/);
  assert.match(main, /className="selection-item"/);
  assert.match(main, /className="selection-item-copy"/);
  assert.match(styles, /\.selection-strip-items article > button\.selection-remove \{ position:absolute; top:7px; right:7px;.*width:24px; height:24px;/);
  assert.match(styles, /\.selection-strip-items article\.selection-item \{[^}]*padding:6px 40px 6px 6px;/);
});

test('Workbench exposes one shared image action launcher and structured reject-to-round flow', () => {
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  const lineage = fs.readFileSync(path.join(skillRoot, 'web/src/creative-lineage-canvas.jsx'), 'utf8');
  const launcher = fs.readFileSync(path.join(skillRoot, 'web/src/creative-action-launcher.jsx'), 'utf8');
  const actions = fs.readFileSync(path.join(skillRoot, 'web/src/creative-actions.mjs'), 'utf8');
  const styles = fs.readFileSync(path.join(skillRoot, 'web/src/styles.css'), 'utf8');
  assert.match(actions, /CREATIVE_ACTION_ENTRIES/);
  assert.match(actions, /more-similar/);
  assert.match(actions, /feedback-to-next-round/);
  assert.match(main, /import \{ CreativeActionLauncher \} from '\.\/creative-action-launcher\.jsx'/);
  assert.match(main, /CreativeActionLauncher/);
  assert.match(lineage, /import \{ CreativeActionLauncher \} from '\.\/creative-action-launcher\.jsx'/);
  assert.match(lineage, /<CreativeActionLauncher/);
  assert.match(launcher, /export function CreativeActionLauncher/);
  assert.match(launcher, /先选用途，再选草稿轮次/);
  assert.match(launcher, /未锁定轮次：点击用途后先选择或创建草稿轮次/);
  assert.match(launcher, /不会确认、预检、创建 Generation Run 或访问 Provider/);
  assert.match(main, /writeImageBlobToClipboard/);
  assert.match(main, /convertImageBlobToPng/);
  assert.match(main, /ClipboardItem\.supports/);
  assert.match(main, /图片已转换为 PNG 并复制/);
  assert.match(main, /document\.addEventListener\('pointerdown'/);
  assert.match(main, /ReferenceRoundResolverDialog/);
  assert.match(main, /referenceTargetForAssets/);
  assert.match(main, /chooseReferenceTask/);
  assert.match(main, /reference-task-options/);
  assert.match(main, /allDraftRounds\.length === 1/);
  assert.match(main, /新建草稿轮次并加入/);
  assert.match(main, /从不采用原因创建下一轮/);
  assert.match(main, /feedbackToNextRound/);
  assert.match(main, /actionLabel/);
  assert.match(main, /DERIVED_REFERENCE_PRESETS/);
  assert.match(main, /多图用途编排/);
  assert.match(main, /主图 \+ 风格 \+ 构图/);
  assert.match(main, /referenceArrangementMode/);
  assert.match(main, /primaryAssetId/);
  assert.match(main, /REJECT_REASON_OPTIONS/);
  assert.match(main, /为什么不采用/);
  assert.match(main, /同时加入当前草稿轮次作为反例参考/);
  assert.match(lineage, /LineageAssetGetActions/);
  assert.doesNotMatch(lineage, /function LineageContinueMenu|function LineageReferenceActions|function LineageCreativeActions/);
  assert.match(styles, /\.creative-action-launcher/);
  assert.match(styles, /\.creative-action-panel/);
  assert.match(styles, /\.creative-action-card/);
  assert.match(styles, /\.creative-reference-grid/);
  assert.match(styles, /\.creative-reference-chip/);
  assert.match(styles, /\.creative-action-summary-copy/);
  assert.match(styles, /\.inspector-action-bar \.creative-action-panel[\s\S]*transform:translateX\(-50%\)/);
  assert.match(styles, /\.lineage-primary-actions/);
  assert.match(styles, /\.lineage-utility-row/);
  assert.doesNotMatch(styles, /\.lineage-inspector-menu|\.lineage-menu-panel|\.lineage-action-card|\.lineage-reference-actions|\.lineage-reference-grid|\.lineage-reference-chip|\.lineage-creative-actions/);
  assert.match(styles, /\.lineage-mode-panel/);
  assert.match(styles, /\.lineage-metrics-strip/);
  assert.match(styles, /\.derived-purpose-board/);
  assert.match(styles, /\.derived-arrangement-grid/);
  assert.match(styles, /\.derived-role-chips/);
  assert.match(styles, /\.inspector-action-bar/);
  assert.match(main, /轻量遮罩准备/);
  assert.match(main, /导入遮罩图/);
  assert.match(main, /onImportMask/);
  assert.match(main, /parentAssetIds/);
  assert.match(styles, /\.mask-lite-panel/);
  assert.match(styles, /\.mask-lite-actions/);
  assert.doesNotMatch(main, /推荐下一步|ContextActionRecommendations|推荐动作只创建\/选择上下文/);
  assert.doesNotMatch(lineage, /lineage-next-actions|标记保留|标记待复核|标记可衍生/);
  assert.doesNotMatch(styles, /context-action-recommendations|context-action-row|lineage-next-actions|project-next-step/);
  assert.match(main, /className="asset-action-menu"/);
  assert.match(styles, /\.asset-action-menu/);
  assert.doesNotMatch(main, /WorkspaceActionMenu|工作台统一动作入口|行动入口只创建上下文/);
  assert.doesNotMatch(styles, /\.workspace-action-menu|\.workspace-action-panel/);
  assert.match(main, /asset-action-section/);
  assert.match(styles, /\.asset-action-section/);
  assert.doesNotMatch(main, /className="asset-action-group"/);
});

test('Workbench confirmations use the shared accessible modal instead of native dialogs', () => {
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  const provider = fs.readFileSync(path.join(skillRoot, 'web/src/provider-settings.jsx'), 'utf8');
  const confirmation = fs.readFileSync(path.join(skillRoot, 'web/src/confirmation-dialog.jsx'), 'utf8');
  assert.doesNotMatch(main + provider, /window\.(?:alert|confirm|prompt)|\b(?:alert|confirm|prompt)\s*\(/);
  assert.match(main, /<ConfirmationDialog/);
  assert.match(main, /归档后将关闭该项目下的任务与轮次/);
  assert.match(main, /这张图片仍被选择、资料库或交付引用/);
  assert.match(provider, /<ConfirmationDialog/);
  assert.match(confirmation, /<AccessibleDialog/);
  assert.match(confirmation, /confirmation-dialog-actions/);
});

test('Workbench suppresses only injected diagnostics startTime errors', async () => {
  const { isInjectedDiagnosticsStartTimeError } = await import('../../web/src/browser-error-guard.mjs');
  assert.equal(isInjectedDiagnosticsStartTimeError({
    message: "Uncaught TypeError: Cannot read properties of undefined (reading 'startTime')",
    filename: 'VM190',
    error: { stack: "TypeError: Cannot read properties of undefined (reading 'startTime')\n    at et.reportAllChanges (<anonymous>:2:19429)" }
  }), true);
  assert.equal(isInjectedDiagnosticsStartTimeError({
    message: "Uncaught TypeError: Cannot read properties of undefined (reading 'startTime')",
    filename: '/assets/index.js',
    error: { stack: "TypeError: Cannot read properties of undefined (reading 'startTime')\n    at reportAllChanges (/assets/index.js:2:10)" }
  }), false);
  assert.equal(isInjectedDiagnosticsStartTimeError({
    message: "Cannot read properties of undefined (reading 'id')",
    error: { stack: "TypeError\n    at et.reportAllChanges (<anonymous>:2:19429)" }
  }), false);
});

test('Workbench guards injected diagnostics timer callbacks without hiding app errors', async () => {
  const { installBrowserErrorGuard } = await import('../../web/src/browser-error-guard.mjs');
  const listeners = new Map();
  const target = {
    onerror: null,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    setTimeout(callback, delay, ...args) { this.pendingTimeout = { callback, delay, args }; return 1; },
    setInterval(callback, delay, ...args) { this.pendingInterval = { callback, delay, args }; return 2; }
  };
  const restore = installBrowserErrorGuard(target);
  const injectedError = new TypeError("Cannot read properties of undefined (reading 'startTime')");
  injectedError.stack = "TypeError: Cannot read properties of undefined (reading 'startTime')\n    at et.reportAllChanges (<anonymous>:2:19429)";
  target.setTimeout(() => { throw injectedError; }, 10);
  assert.doesNotThrow(() => target.pendingTimeout.callback());
  target.setTimeout(() => { throw new TypeError("Cannot read properties of undefined (reading 'id')"); }, 10);
  assert.throws(() => target.pendingTimeout.callback(), /reading 'id'/);
  const event = { message: "Uncaught TypeError: Cannot read properties of undefined (reading 'startTime')", filename: 'VM84', preventDefaultCalled: false, stopped: false, preventDefault() { this.preventDefaultCalled = true; }, stopImmediatePropagation() { this.stopped = true; } };
  listeners.get('error')(event);
  assert.equal(event.preventDefaultCalled, true);
  assert.equal(event.stopped, true);
  assert.equal(target.onerror(event.message, event.filename, 2, 19429, null), true);
  restore();
});

test('lineage canvas preserves group soft links as layout endpoints', () => {
  const lineage = fs.readFileSync(path.join(skillRoot, 'web/src/creative-lineage-canvas.jsx'), 'utf8');
  assert.match(lineage, /endpointByKey/);
  assert.match(lineage, /nodeKey\('group', rendered\.id\)/);
  assert.match(lineage, /payloadEndpointKeys/);
  assert.doesNotMatch(lineage, /payloadNodeKeys\.has\(nodeKey\(link\.sourceType, link\.sourceId\)\) && payloadNodeKeys\.has/);
});

test('lineage canvas exposes complete data loading and keyboard-accessible overlays', () => {
  const lineage = fs.readFileSync(path.join(skillRoot, 'web/src/creative-lineage-canvas.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(skillRoot, 'web/src/styles.css'), 'utf8');
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  assert.match(main, /runItems=\{lineageVisibleRunItems\}/);
  assert.match(main, /runItemCoverage=\{lineageRunItemCoverage\}/);
  assert.match(main, /loadCompleteLineageAssets\(route/);
  assert.match(lineage, /assetCountLabel/);
  assert.match(lineage, /runItemCountLabel/);
  assert.doesNotMatch(lineage, /居中选择/);
  assert.match(lineage, /role="combobox"/);
  assert.match(lineage, /aria-activedescendant=\{activeSearchOptionId\}/);
  assert.match(lineage, /role="listbox"/);
  assert.match(lineage, /role="option"/);
  assert.match(lineage, /const menuRef = useRef\(null\)/);
  assert.match(lineage, /event\.key === 'Escape'/);
  assert.match(lineage, /event\.key === 'ArrowDown'/);
  assert.match(lineage, /return <article role="button" tabIndex=\{0\}/);
  assert.match(lineage, /event\.key === 'Enter'/);
  assert.match(lineage, /event\.key === 'ContextMenu'/);
  assert.match(styles, /\.lineage-node:focus-visible/);
});

test('lineage canvas is the creator-first project workspace', () => {
  const lineage = fs.readFileSync(path.join(skillRoot, 'web/src/creative-lineage-canvas.jsx'), 'utf8');
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(skillRoot, 'web/src/styles.css'), 'utf8');
  const route = fs.readFileSync(path.join(skillRoot, 'web/src/workbench-route.mjs'), 'utf8');
  assert.match(route, /view: 'lineage', projectId/);
  assert.match(route, /selectTask[\s\S]*view: 'lineage'/);
  assert.match(main, /const projectRounds = roundLists\.flat\(\)/);
  assert.match(main, /const projectRuns = await loadLineageRuns\(projectRounds\)/);
  assert.match(main, /navigateRoute\(\{ view: 'lineage'/);
  assert.match(lineage, /CREATOR_MODES/);
  assert.match(lineage, /项目地图/);
  assert.match(lineage, /任务创作流/);
  assert.match(lineage, /轮次对比/);
  assert.match(lineage, /资产分支/);
  assert.match(lineage, /交付路线/);
  assert.match(lineage, /LineageWorkspaceSummary/);
  assert.match(lineage, /lineage-focus-strip/);
  assert.match(lineage, /toolbarMode/);
  assert.doesNotMatch(lineage, /创作地图|创作者工作台/);
  assert.match(styles, /\.lineage-focus-strip/);
  assert.doesNotMatch(styles, /\.lineage-workspace-hero/);
  assert.match(lineage, /lineage-metrics-strip/);
  assert.match(lineage, /visibleByMode/);
  assert.match(lineage, /<CreativeActionLauncher/);
  assert.match(lineage, /反例参考/);
  assert.match(lineage, /label: '不采用'/);
  assert.match(lineage, /设为当前上下文/);
  assert.match(lineage, /不会预检、运行或访问 Provider/);
  assert.match(lineage, /lineage-context-actions/);
  assert.match(lineage, /任务列表/);
  assert.match(lineage, /lineage-mode-grid" role="radiogroup"/);
  assert.doesNotMatch(lineage, /<details className="lineage-mode-panel"/);
  assert.match(lineage, /lineage-edit-more/);
  assert.match(styles, /\.lineage-shell\.has-resources \{ grid-template-columns:minmax\(0,1fr\) 360px/);
  assert.match(styles, /\.lineage-shell\.has-resources \.lineage-resource-panel \{ position:absolute/);
  assert.match(main, /onOpenConfirmation=\{\(round\) => void openGenerationConfirmation\(round\)\}/);
  assert.match(lineage, /PlanActions\(\{ node, onNavigate, onCopyContext, onOpenConfirmation \}\)/);
  assert.match(lineage, /node\.entity\?\.status === 'awaiting_confirmation'/);
  assert.match(lineage, /审阅并确认计划/);
});

test('Workbench renders route context errors as live alerts', () => {
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  assert.match(main, /contextError && <div className="error-strip" role="alert" aria-live="assertive"/);
  assert.match(main, /关闭上下文错误/);
});
