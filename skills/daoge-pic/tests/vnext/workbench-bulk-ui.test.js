const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFrontendSource, readSource, readStyles } = require('./source-text');

const skillRoot = path.resolve(__dirname, '../..');

test('project assets expose page selection, configurable pagination, and multi-file import', () => {
  const main = readFrontendSource();
  const styles = readStyles();
  assert.match(main, /全选本页/);
  assert.match(main, /取消全选本页/);
  assert.match(main, /ASSET_PAGE_SIZES/);
  assert.match(main, /type="file" multiple/);
  assert.match(main, /Array\.from\(files \|\| \[\]\)/);
  assert.match(main, /正在导入.*completed.*total/);
  assert.match(main, /className="command-button asset-import-button"/);
  assert.match(main, /routeView === 'assets' && selectedProject && <button type="button" className="command-button asset-import-button"/);
  // 批 B B2：上下文条降级为面包屑（签名随之变化），选择任务的能力仍在（onSelectTask 走面包屑菜单）。
  assert.match(main, /function WorkspaceContextBar\(\{ project, projects = EMPTY, tasks = EMPTY, task/);
  // §0.5 迁移：旧的常驻 select 换成面包屑的任务段（只读路径 + 点开切换）。
  assert.match(main, /data-region="breadcrumb"/);
  assert.match(main, /onSelectTask=\{\(taskId\) => navigateRoute\(updateWorkbenchRoute/);
  assert.match(main, /aria-label="当前位置"/);
  // 批 B B3：资产管理不再是页签（rail 才是它的家）；页签块整体退场。
  assert.equal(main.includes('task-local-tabs'), false, '旧页签块应已删除');
  assert.match(readSource('web/src/workbench-navigation.jsx'), /label: '资产管理'/);
  // 批 B B3/B4：`创作平台` 不再是上下文条页签（rail 是它的家）。
  // 批 B B3/B4：`生成历史` 不再是上下文条页签（检查器是它的家）。
  // 批 B B3/B4：`批次对比` 不再是上下文条页签（检查器是它的家）。
  assert.doesNotMatch(readSource('web/src/main.jsx'), /className="task-more-tabs"/);
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
  assert.doesNotMatch(readSource('web/src/main.jsx'), /JSON\.stringify\(evidence\.details\)<\/p>/);
  assert.match(styles, /\.advanced-preflight-breakdown/);
});

test('current plan review exposes per-image prompts before confirmation', () => {
  const promptWorkspace = readFrontendSource();
  const styles = readStyles();
  assert.match(promptWorkspace, /function PlanReviewPanel/);
  assert.match(promptWorkspace, /逐图提示词/);
  assert.match(promptWorkspace, /Specific scene direction for this image:/);
  assert.match(promptWorkspace, /复制全部最终提示词/);
  // 复制原始计划数据 / 查看原始数据：能力不变，只是把 JSON 这个词从创作者面收回
  // （见 docs/daoge_pic_terminology_zh.md，术语守卫会拦住回潮）。
  assert.match(promptWorkspace, /复制原始数据/);
  assert.match(promptWorkspace, /原始计划结构/);
  assert.match(promptWorkspace, /查看原始数据/);
  assert.doesNotMatch(readSource('web/src/prompt-workspace.jsx'), /结构化 JSON|原始 JSON/);
  assert.match(promptWorkspace, /OPENAI_GPT_IMAGE_PROMPT_LIMIT = 32000/);
  assert.match(styles, /\.prompt-review-metrics/);
  assert.match(styles, /\.prompt-item-card/);
  assert.match(promptWorkspace, /function ReferenceMaterialsSection/);
  assert.match(promptWorkspace, /rawSummaryGroups/);
  assert.doesNotMatch(readSource('web/src/prompt-workspace.jsx'), /function PromptStructureSection/);
  assert.doesNotMatch(readSource('web/src/prompt-workspace.jsx'), /提示词独占展示/);
  assert.doesNotMatch(readSource('web/src/prompt-workspace.jsx'), /<PromptStructureSection plan=\{plan\}/);
  assert.doesNotMatch(readSource('web/src/prompt-workspace.jsx'), /\['提示词', \[\['prompt'/);
  assert.match(styles, /\.prompt-raw-layout/);
  assert.doesNotMatch(styles, /\.prompt-raw-prompt-section/);
  assert.match(styles, /\.prompt-raw-material-table/);
  assert.match(styles, /\.prompt-raw-groups div\.is-long/);
  assert.match(styles, /\.prompt-stage-actions \{ display:grid; grid-template-columns:repeat\(4,max-content\)/);
  assert.match(styles, /\.prompt-stage-actions \.outline-button \{ white-space:nowrap; \}/);
  assert.match(styles, /\.prompt-copy-notice \{ grid-column:1 \/ -1/);
});

test('Workbench exposes Studio-first creation controls without a second chat flow', () => {
  const main = readFrontendSource();
  const styles = readStyles();
  const projectTemplates = fs.readFileSync(path.join(skillRoot, 'src/vnext/domain/project-templates.ts'), 'utf8');
  assert.doesNotMatch(readSource('web/src/main.jsx'), /PROJECT_CREATION_TEMPLATES/);
  assert.match(main, /PROJECT_TEMPLATE_UNAVAILABLE/);
  assert.match(main, /GENERIC_TASK_GOAL_FALLBACKS/);
  assert.match(main, /ROUND_PURPOSE_OPTIONS/);
  assert.match(main, /id: 'exploration',[\s\S]*defaultCount: '6',[\s\S]*defaultAspectRatio: '4:5'/);
  assert.match(main, /id: 'variation',[\s\S]*defaultCount: '4'/);
  assert.match(main, /id: 'refinement',[\s\S]*defaultCount: '4'/);
  assert.match(main, /id: 'edit',[\s\S]*defaultCount: '2'/);
  assert.match(main, /id: 'fill',[\s\S]*defaultCount: '2',[\s\S]*defaultAspectRatio: '16:9'/);
  assert.match(main, /setIfEmptyOrDefault\(setTargetCount, previous\.defaultCount, option\.defaultCount\)/);
  assert.match(main, /setTargetCount\(selectedGoal\.defaultCount \|\| ''\)/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /TASK_CREATION_GOALS/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /ROUND_CREATION_PURPOSES/);
  assert.match(main, /两条入口、一条流程/);
  assert.match(main, /新建项目/);
  assert.match(main, /新建任务/);
  assert.match(main, /新建批次/);
  assert.match(main, /同时创建首个批次，并设为当前批次/);
  assert.match(main, /api\('\/api\/project-templates'/);
  assert.match(main, /templateVersion/);
  assert.match(main, /creation-selection-detail/);
  assert.match(main, /创建摘要/);
  assert.match(main, /descriptionPrompt/);
  assert.match(main, /projectTemplateDefaultName/);
  assert.match(main, /CreationSuggestionChips/);
  assert.match(main, /项目说明示例/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /创建后建议|创建完成提示|nextSteps/);
  for (const handlerName of ['createProjectFromStudio', 'createTaskFromStudio', 'createRoundFromStudio']) {
    const start = main.indexOf('  const ' + handlerName + ' =');
    const end = main.indexOf('\n  const ', start + 1);
    assert.notEqual(start, -1, handlerName + ' handler must exist');
    assert.doesNotMatch(main.slice(start, end === -1 ? main.length : end), /setNotice\('[^']+'\)/, handlerName + ' must not show a creation success notice');
  }
  assert.match(main, /套用推荐默认值/);
  assert.match(main, /recommendedInputs/);
  assert.match(main, /defaultVariationAxes/);
  assert.match(main, /defaultRefinementGoals/);
  assert.match(main, /扩展或补充方向/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /CreationNextGuide/);
  assert.match(main, /继续操作/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /回到 Agent 可直接说/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /外部 Provider 调用仍必须由 Agent/);
  assert.match(main, /taskGoalsForProjectTemplate/);
  assert.match(main, /creation-template-bridge/);
  assert.match(main, /项目模板联动/);
  assert.match(main, /模板推荐/);
  assert.match(main, /materialNeeds/);
  // 意图：新建项目弹窗必须写明模板来自 Studio（配合上面的 doesNotMatch，禁止前端硬编码模板）。
  // 原句「项目模板只来自 Studio API；这里建立结构化上下文，不会调用 Provider」里，
  // 后半句与紧随其后的边界提示重复说同一件事，已随第一批术语治理收敛，断言只锁前半句的意图。
  assert.match(main, /项目模板来自 Studio/);
  assert.match(main, /setProjectTemplates\(projectTemplateData\.templates \|\| \[\]\)/);
  assert.match(projectTemplates, /商品主图探索/);
  assert.match(projectTemplates, /商品主体图/);
  assert.match(projectTemplates, /defaultCount: '8'/);
  assert.match(projectTemplates, /defaultAspectRatio: '1:1'/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /商品主图探索/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /商品主体图/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /defaultCount: '8'/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /defaultAspectRatio: '1:1'/);
  assert.match(main, /DERIVED_VARIATION_AXES/);
  assert.match(main, /DERIVED_REFINEMENT_GOALS/);
  assert.match(main, /希望保持不变/);
  assert.match(main, /api\('\/api\/projects'/);
  assert.match(main, /api\('\/api\/tasks'/);
  assert.match(main, /api\('\/api\/rounds'/);
  assert.match(main, /这是 Studio 记下的草稿/);
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
  const main = readFrontendSource();
  const styles = readStyles();
  assert.match(main, /REFERENCE_USAGE_OPTIONS/);
  assert.match(main, /ReferenceAssetDialog/);
  assert.match(main, /选择本轮参考素材/);
  assert.match(main, /主体参考/);
  assert.match(main, /api\('\/api\/rounds\/'.*\/draft-context/);
  assert.match(main, /回到当前选择/);
  assert.match(styles, /\.reference-panel/);
  assert.match(styles, /\.reference-candidate-grid/);
  // A3：renderer 现在包在 PageFrame 里（宽度由注册表决定），绑定关系不变。
  // 批 E（E1.6）迁移：assets/trash 共用一个 AssetsView（视图文件）。
  assert.match(readSource('web/src/views/assets.jsx'), /export function AssetsView/);
  assert.match(main, /MATERIAL_NEED_USAGE_RULES/);
  assert.match(main, /MaterialImportGuide/);
  assert.match(main, /素材导入引导/);
  assert.match(main, /x-daoge-material-need/);
  assert.match(main, /x-daoge-material-usage/);
  assert.match(main, /导入成功后会按用途自动加入当前这一轮的参考素材/);
  assert.match(styles, /\.material-need-checklist/);
  assert.match(styles, /\.material-import-guide/);
});

test('delivery page exposes a visible all-images selection action', () => {
  const delivery = readFrontendSource();
  assert.match(delivery, /全选全部.*assets\.length.*张/);
  assert.match(delivery, /取消全选/);
  assert.match(delivery, /打包下载.*selected\.length.*张/);
});

test('image preview can select deliverables and the selection strip keeps removal compact', () => {
  const main = readFrontendSource();
  const styles = readStyles();
  assert.match(main, /inspector-select-control/);
  assert.match(main, /onChange=\{\(\) => void onToggleDeliverable\(asset\)\}/);
  assert.match(main, /className="selection-item"/);
  assert.match(main, /className="selection-item-copy"/);
  assert.match(styles, /\.selection-strip-items article > button\.selection-remove \{ position:absolute; top:7px; right:7px;.*width:24px; height:24px;/);
  assert.match(styles, /\.selection-strip-items article\.selection-item \{[^}]*padding:6px 40px 6px 6px;/);
});

test('Workbench exposes one shared image action launcher and structured reject-to-round flow', () => {
  const main = readFrontendSource();
  const lineage = readFrontendSource();
  const launcher = readFrontendSource();
  const actions = readSource('web/src/creative-actions.mjs');
  const styles = readStyles();
  assert.match(actions, /CREATIVE_ACTION_ENTRIES/);
  assert.match(actions, /more-similar/);
  assert.match(actions, /feedback-to-next-round/);
  assert.match(main, /import \{ CreativeActionLauncher \} from '\.\.?\/creative-action-launcher\.jsx'/);
  assert.match(main, /CreativeActionLauncher/);
  assert.match(lineage, /import \{ CreativeActionLauncher \} from '\.\.?\/creative-action-launcher\.jsx'/);
  assert.match(lineage, /<CreativeActionLauncher/);
  assert.match(launcher, /export function CreativeActionLauncher/);
  assert.match(launcher, /先选用途，再选还没开工的批次/);
  assert.match(launcher, /未锁定批次：点击用途后先选一个还没开工的批次/);
  // 动作面板必须继续声明「这些动作不出图」，但改用全站唯一那句人话（见 boundary-copy.mjs）。
  // 旧文案「不会确认、预检、创建 Generation Run 或访问 Provider」是工程话，已随第一批术语治理收敛。
  assert.match(launcher, /import \{ DRAFT_BOUNDARY_COPY \} from '\.\/boundary-copy\.mjs'/);
  assert.match(launcher, /\{DRAFT_BOUNDARY_COPY\}/);
  assert.doesNotMatch(readSource('web/src/creative-action-launcher.jsx'), /创建 Generation Run|访问 Provider/);
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
  assert.match(main, /新建一轮并加入/);
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
  assert.match(main, /同时加入当前这一轮作为反例参考/);
  assert.match(lineage, /LineageAssetGetActions/);
  assert.doesNotMatch(readSource('web/src/canvas/creator-workbench.jsx'), /function LineageContinueMenu|function LineageReferenceActions|function LineageCreativeActions/);
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
  assert.match(styles, /\.lineage-mode-menu/);
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
  assert.doesNotMatch(readSource('web/src/main.jsx'), /推荐下一步|ContextActionRecommendations|推荐动作只创建\/选择上下文/);
  assert.doesNotMatch(readSource('web/src/canvas/creator-workbench.jsx'), /lineage-next-actions|标记保留|标记待复核|标记可衍生/);
  assert.doesNotMatch(styles, /context-action-recommendations|context-action-row|lineage-next-actions|project-next-step/);
  assert.match(main, /className="asset-action-menu"/);
  assert.match(styles, /\.asset-action-menu/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /WorkspaceActionMenu|工作台统一动作入口|行动入口只创建上下文/);
  assert.doesNotMatch(styles, /\.workspace-action-menu|\.workspace-action-panel/);
  assert.match(main, /asset-action-section/);
  assert.match(styles, /\.asset-action-section/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /className="asset-action-group"/);
});

test('Workbench confirmations use the shared accessible modal instead of native dialogs', () => {
  const main = readFrontendSource();
  const provider = readFrontendSource();
  const confirmation = readFrontendSource();
  assert.doesNotMatch(main + provider, /window\.(?:alert|confirm|prompt)|\b(?:alert|confirm|prompt)\s*\(/);
  assert.match(main, /<ConfirmationDialog/);
  assert.match(main, /归档后将关闭该项目下的任务与批次/);
  assert.match(main, /这张图片仍被选择、规则资料或交付引用/);
  assert.match(main, /busy=\{confirmationBusy\}/);
  assert.match(main, /error=\{confirmationError\}/);
  assert.match(main, /onCancel=\{dismissConfirmation\}/);
  assert.match(main, /onConfirm=\{confirmPendingAction\}/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /archiveProjectAction|trash\(confirmation\.assetId/);
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
  const lineage = readFrontendSource();
  assert.match(lineage, /endpointByKey/);
  assert.match(lineage, /nodeKey\('group', rendered\.id\)/);
  assert.match(lineage, /payloadEndpointKeys/);
  assert.doesNotMatch(readSource('web/src/canvas/creator-workbench.jsx'), /payloadNodeKeys\.has\(nodeKey\(link\.sourceType, link\.sourceId\)\) && payloadNodeKeys\.has/);
});

test('lineage canvas exposes complete data loading and keyboard-accessible overlays', () => {
  const lineage = readFrontendSource();
  const styles = readStyles();
  const main = readFrontendSource();
  assert.match(main, /runItems=\{lineageVisibleRunItems\}/);
  assert.match(main, /runItemCoverage=\{lineageRunItemCoverage\}/);
  assert.match(main, /loadCompleteLineageAssets\(route/);
  assert.match(lineage, /assetCountLabel/);
  assert.match(lineage, /runItemCountLabel/);
  assert.doesNotMatch(readSource('web/src/canvas/creator-workbench.jsx'), /居中选择/);
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
  const lineage = readFrontendSource();
  const main = readFrontendSource();
  const styles = readStyles();
  const route = readSource('web/src/workbench-route.mjs');
  assert.match(route, /view: 'lineage', projectId/);
  assert.match(route, /selectTask[\s\S]*view: 'lineage'/);
  assert.match(main, /const projectRounds = roundLists\.flat\(\)/);
  assert.match(main, /const projectRuns = await loadLineageRuns\(projectRounds\)/);
  assert.match(main, /navigateRoute\(\{ view: 'lineage'/);
  assert.match(lineage, /CREATOR_MODES/);
  assert.match(lineage, /'全局'/);
  assert.match(lineage, /'按图片'/);
  assert.match(lineage, /'按交付'/);
  // 2026-09-17 收敛为三种（刀哥裁定）：按批次与全局重合、按任务与按图片重合。
  assert.doesNotMatch(lineage, /'按任务'|'按批次'/);
  assert.match(lineage, /画布视角/);
  // 画布 mode 是同一张图上的三种看法（收敛前五种），名字不得再和左侧一级入口撞车
  // （旧名里「项目地图/资产分支/交付路线」与入口近义、「批次对比」与页签同名）。
  assert.doesNotMatch(readSource('web/src/canvas/creator-workbench.jsx'), /'项目地图'|'任务创作流'|'资产分支'|'交付路线'|'批次对比'/);
  // 批 C（第 7 批）迁移：焦点条退场——模式进工具条、指标进右栏，但**名字一个没丢**。
  assert.doesNotMatch(lineage, /LineageWorkspaceSummary/);
  assert.doesNotMatch(lineage, /lineage-focus-strip/);
  assert.match(lineage, /lineage-mode-menu/);
  assert.match(lineage, /lineage-inspector' \+ \(selectedNodes\.length \? ' is-open' : ''\)\} data-region="aside"/);
  assert.match(lineage, /toolbarMode/);
  assert.doesNotMatch(readSource('web/src/canvas/creator-workbench.jsx'), /创作地图|创作者工作台/);
  assert.doesNotMatch(styles, /\.lineage-focus-strip/);
  assert.match(styles, /\.lineage-toolbar \{ display: flex;[\s\S]{0,160}min-height: 48px; height: 48px;/);
  assert.match(lineage, /title=\{description\} onClick=\{\(\) => onMode\(value\)\}><strong>\{label\}<\/strong><\/button>/);
  assert.match(styles, /\.lineage-thumb img \{ display:block; width:100%; height:126px; object-fit:contain;/);
  assert.doesNotMatch(styles, /\.lineage-workspace-hero/);
  assert.match(lineage, /lineage-metrics-strip/);
  assert.match(lineage, /visibleByMode/);
  assert.match(lineage, /<CreativeActionLauncher/);
  assert.match(lineage, /反例参考/);
  assert.match(lineage, /label: '不采用'/);
  assert.match(lineage, /设为当前批次/);
  // 批 C（第 7 批）迁移：条件卡退场（任务列表去 rail、新建任务去任务页），模式换到工具条浮层。
  assert.doesNotMatch(lineage, /lineage-context-actions/);
  assert.match(readSource('web/src/workbench-navigation.jsx'), /rail-sub-entry/);
  assert.match(lineage, /lineage-mode-list" role="radiogroup"/);
  assert.doesNotMatch(readSource('web/src/canvas/creator-workbench.jsx'), /className="lineage-mode-panel"/);
  assert.match(lineage, /lineage-edit-more/);
  assert.match(lineage, /boundsNodes=\{nodes\}/);
  assert.match(lineage, /event\.stopPropagation\(\)/);
  assert.match(lineage, /aria-label="画布缩略图，拖动以定位"/);
  assert.match(styles, /\.lineage-minimap svg \{ display:block; width:210px; height:134px/);
  assert.match(main, /onOpenConfirmation=\{\(round\) => void openGenerationConfirmation\(round\)\}/);
  // 断言的是「PlanActions 必须接得上确认回调」这件事本身，而不是把整个签名拷一遍 ——
  // 后者会在每次给它加一个 prop 时无意义地变红（C1 加 onEditPlan 时就红了一次）。
  assert.match(lineage, /function PlanActions\(\{[^}]*onOpenConfirmation[^}]*\}\)/);
  assert.match(lineage, /node\.entity\?\.status === 'awaiting_confirmation'/);
  assert.match(lineage, /审阅并确认计划/);
  // 意图不变：画布只展示状态，不直接执行重试。运行控制接线已整体移出画布，剩下这两条否定断言兜底。
  assert.doesNotMatch(readSource('web/src/canvas/creator-workbench.jsx'), /onControlRun\('(?:pause|resume|cancel)'/);
  assert.doesNotMatch(readSource('web/src/canvas/creator-workbench.jsx'), /onRetryRunItem\(item\.id\)/);
});

test('Workbench renders route context errors as live alerts', () => {
  const main = readFrontendSource();
  // A4：状态条收进 StatusSlot 的 items 后，条件从 `&&` 变成 `when:`，断言跟随（意图不变：仍是 alert/assertive）。
  assert.match(main, /content: <div className="error-strip" role="alert" aria-live="assertive"/);
  assert.match(main, /关闭错误提示/);
});
