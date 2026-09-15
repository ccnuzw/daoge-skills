const test = require('node:test');
const assert = require('node:assert/strict');
const RUN_ITEM_DEFAULTS = { runItemFilter: 'all', runItemPage: 1, runItemPageSize: 50, runItemSequence: null };


test('Workbench route round-trips explicit task and round context', async () => {
  const { parseWorkbenchRoute, serializeWorkbenchRoute } = await import('../../web/src/workbench-route.mjs');
  const route = parseWorkbenchRoute('?view=runs&project=project_a&task=task_b&round=round_c&run=run_d&scope=round');
  assert.deepEqual(route, { view: 'runs', projectId: 'project_a', taskId: 'task_b', roundId: 'round_c', compareRoundIds: ['round_c'], runId: 'run_d', assetScope: 'round', ...RUN_ITEM_DEFAULTS });
  assert.equal(serializeWorkbenchRoute(route), '?view=runs&project=project_a&task=task_b&round=round_c&run=run_d&scope=round');
});

test('Studio-global views preserve project shell for project-aware reference views', async () => {
  const { parseWorkbenchRoute, serializeWorkbenchRoute, isStudioView } = await import('../../web/src/workbench-route.mjs');
  const guide = parseWorkbenchRoute('?view=guide&project=project_a&task=task_b&round=round_c&scope=round');
  assert.deepEqual(guide, { view: 'guide', projectId: 'project_a', taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' });
  assert.equal(serializeWorkbenchRoute(guide), '?view=guide&project=project_a');
  assert.equal(serializeWorkbenchRoute(parseWorkbenchRoute('?view=guide')), '?view=guide');
  const library = parseWorkbenchRoute('?view=library&project=project_a&task=task_b&round=round_c&scope=round');
  assert.deepEqual(library, { view: 'library', projectId: 'project_a', taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' });
  assert.equal(serializeWorkbenchRoute(library), '?view=library&project=project_a');
  assert.equal(serializeWorkbenchRoute(parseWorkbenchRoute('?view=library')), '?view=library');
  assert.equal(isStudioView('library'), true);
  assert.equal(isStudioView('shared-assets'), true);
  assert.equal(isStudioView('trash'), false);
});

test('project and task selection open lineage as the creator workspace home', async () => {
  const { selectProject, selectTask, selectRound, updateWorkbenchRoute } = await import('../../web/src/workbench-route.mjs');
  const base = { view: 'runs', projectId: 'project_a', taskId: 'task_b', roundId: 'round_c', compareRoundIds: ['round_c'], runId: 'run_d', assetScope: 'round', ...RUN_ITEM_DEFAULTS };
  assert.deepEqual(selectProject(base, 'project_z'), { view: 'lineage', projectId: 'project_z', taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' });
  assert.deepEqual(selectTask(base, 'task_z'), { view: 'lineage', projectId: 'project_a', taskId: 'task_z', roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' });
  assert.deepEqual(selectRound(base, 'round_z'), { ...base, roundId: 'round_z', compareRoundIds: ['round_z'], runId: null, assetScope: 'round' });
  assert.deepEqual(updateWorkbenchRoute(base, { runId: 'run_z' }), { ...base, runId: 'run_z' });
});

test('project assets and lineage deep links never retain a Studio-wide scope', async () => {
  const { parseWorkbenchRoute, serializeWorkbenchRoute } = await import('../../web/src/workbench-route.mjs');
  const projectAssets = parseWorkbenchRoute('?view=assets&project=project_a&scope=studio');
  assert.deepEqual(projectAssets, { view: 'assets', projectId: 'project_a', taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' });
  assert.equal(serializeWorkbenchRoute(projectAssets), '?view=assets&project=project_a&scope=project');
  const taskAssets = parseWorkbenchRoute('?view=assets&project=project_a&task=task_b&scope=studio');
  assert.deepEqual(taskAssets, { view: 'assets', projectId: 'project_a', taskId: 'task_b', roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' });
  assert.equal(serializeWorkbenchRoute(taskAssets), '?view=assets&project=project_a&task=task_b&scope=task');
  const projectLineage = parseWorkbenchRoute('?view=lineage&project=project_a&scope=studio');
  assert.deepEqual(projectLineage, { view: 'lineage', projectId: 'project_a', taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' });
  assert.equal(serializeWorkbenchRoute(projectLineage), '?view=lineage&project=project_a&scope=project');
  const taskLineage = parseWorkbenchRoute('?view=lineage&project=project_a&task=task_b&scope=studio');
  assert.deepEqual(taskLineage, { view: 'lineage', projectId: 'project_a', taskId: 'task_b', roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' });
  assert.equal(serializeWorkbenchRoute(taskLineage), '?view=lineage&project=project_a&task=task_b&scope=task');
  const roundLineage = parseWorkbenchRoute('?view=lineage&project=project_a&task=task_b&round=round_c&scope=studio');
  assert.deepEqual(roundLineage, { view: 'lineage', projectId: 'project_a', taskId: 'task_b', roundId: 'round_c', compareRoundIds: ['round_c'], runId: null, assetScope: 'round' });
  assert.equal(serializeWorkbenchRoute(roundLineage), '?view=lineage&project=project_a&task=task_b&round=round_c&scope=round');
  const orphanRoundLineage = parseWorkbenchRoute('?view=lineage&project=project_a&round=round_c&scope=studio');
  assert.deepEqual(orphanRoundLineage, { view: 'lineage', projectId: 'project_a', taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' });
  assert.equal(serializeWorkbenchRoute(orphanRoundLineage), '?view=lineage&project=project_a&scope=project');
});

test('project trash is never a Studio-scoped asset view', async () => {
  const { parseWorkbenchRoute, serializeWorkbenchRoute } = await import('../../web/src/workbench-route.mjs');
  const trash = parseWorkbenchRoute('?view=trash&project=project_a&task=task_b&round=round_c&scope=studio');
  assert.deepEqual(trash, { view: 'trash', projectId: 'project_a', taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' });
  assert.equal(serializeWorkbenchRoute(trash), '?view=trash&project=project_a&scope=project');
  assert.equal(parseWorkbenchRoute('?view=trash').view, 'projects');
});

test('Workbench route preserves explicit multi-round task comparison and prompt deep links', async () => {
  const { parseWorkbenchRoute, serializeWorkbenchRoute } = await import('../../web/src/workbench-route.mjs');
  const overview = parseWorkbenchRoute('?view=studio-overview&project=project_a&task=task_b&round=round_1&round=round_2&round=round_1&scope=task');
  assert.deepEqual(overview.compareRoundIds, ['round_1', 'round_2']);
  assert.equal(overview.runId, null);
  assert.equal(serializeWorkbenchRoute(overview), '?view=studio-overview&project=project_a&task=task_b&round=round_1&round=round_2&scope=task');
  const prompt = parseWorkbenchRoute('?view=prompts&project=project_a&task=task_b&round=round_c&scope=round');
  assert.equal(prompt.view, 'prompts');
  assert.equal(serializeWorkbenchRoute(prompt), '?view=prompts&project=project_a&task=task_b&round=round_c&scope=round');
});

test('run item controls round-trip only on generation history routes', async () => {
  const { parseWorkbenchRoute, serializeWorkbenchRoute, updateWorkbenchRoute } = await import('../../web/src/workbench-route.mjs');
  const route = parseWorkbenchRoute('?view=runs&project=project_a&task=task_b&round=round_c&run=run_d&scope=round&itemFilter=attention&itemPage=3&itemPageSize=100&itemSequence=42');
  assert.deepEqual(route, { view: 'runs', projectId: 'project_a', taskId: 'task_b', roundId: 'round_c', compareRoundIds: ['round_c'], runId: 'run_d', assetScope: 'round', runItemFilter: 'attention', runItemPage: 3, runItemPageSize: 100, runItemSequence: 42 });
  assert.equal(serializeWorkbenchRoute(route), '?view=runs&project=project_a&task=task_b&round=round_c&run=run_d&scope=round&itemFilter=attention&itemPage=3&itemPageSize=100&itemSequence=42');
  // Switching to 「计划」 must drop the run context. `prompts` does not render run items, and carrying `run_d`
  // across made the context loader answer with 「请先打开生成运行视图，再继续查看运行。」 on a page the operator
  // had deliberately opened. The next test covers every context-bar tab.
  assert.deepEqual(updateWorkbenchRoute(route, { view: 'prompts' }), { view: 'prompts', projectId: 'project_a', taskId: 'task_b', roundId: 'round_c', compareRoundIds: ['round_c'], runId: null, assetScope: 'round' });
});

test('every context-bar tab drops the run context on the views that do not render runs', async () => {
  const { parseWorkbenchRoute, serializeWorkbenchRoute, updateWorkbenchRoute } = await import('../../web/src/workbench-route.mjs');
  // The context bar is reachable from 「生成历史」 while a run is open, and `updateWorkbenchRoute` merges rather
  // than replaces. 「计划」/「资产管理」/「轮次对比」 therefore used to inherit `run=run_d`, and the context loader
  // answered with 「请先打开生成运行视图，再继续查看运行。」 on all three — a page the operator had just chosen.
  const onRuns = parseWorkbenchRoute('?view=runs&project=project_a&task=task_b&round=round_c&run=run_d&scope=round');
  const tabs = [
    ['计划', 'prompts', { assetScope: 'round' }],
    ['生成历史', 'runs', { assetScope: 'round' }],
    ['资产管理', 'assets', { assetScope: 'round' }],
    ['创作平台', 'lineage', { assetScope: 'round' }],
    ['轮次对比', 'studio-overview', { assetScope: 'task' }]
  ];
  for (const [label, targetView, changes] of tabs) {
    const next = updateWorkbenchRoute(onRuns, { view: targetView, ...changes });
    assert.equal(next.view, targetView, label + ' keeps its view');
    assert.equal(next.runId, ['runs', 'lineage'].includes(targetView) ? 'run_d' : null, label + ' run context');
  }
  // The invariant lives in the route, so a hand-edited or bookmarked URL is cleaned on the way in as well.
  const handEdited = parseWorkbenchRoute('?view=prompts&project=project_a&task=task_b&round=round_c&run=run_d&scope=round');
  assert.equal(handEdited.runId, null);
  assert.equal(serializeWorkbenchRoute(handEdited), '?view=prompts&project=project_a&task=task_b&round=round_c&scope=round');
  // Run deep links must keep working: the two views that render a run still honour the anchor.
  assert.equal(parseWorkbenchRoute('?view=runs&project=project_a&task=task_b&round=round_c&run=run_d&scope=round').runId, 'run_d');
  assert.equal(parseWorkbenchRoute('?view=lineage&project=project_a&task=task_b&round=round_c&run=run_d&scope=round').runId, 'run_d');
});

test('route never keeps a context level that has nothing behind it', async () => {
  const { parseWorkbenchRoute } = await import('../../web/src/workbench-route.mjs');
  // A round only resolves against its own task. An orphan round used to survive on the asset views, which made
  // the context loader answer with 「请先选择一个任务，再继续查看轮次或运行。」.
  const orphanRound = parseWorkbenchRoute('?view=assets&project=project_a&round=round_c&scope=round');
  assert.equal(orphanRound.roundId, null);
  assert.deepEqual(orphanRound.compareRoundIds, []);
  assert.equal(orphanRound.assetScope, 'project');
  // Scope degrades down the hierarchy instead of pointing at a level with no ids. Before this, a round-scoped
  // asset request with no round made assetRefreshPath return null, so the list silently kept its old contents.
  assert.equal(parseWorkbenchRoute('?view=assets&project=project_a&task=task_b&scope=round').assetScope, 'task');
  assert.equal(parseWorkbenchRoute('?view=assets&project=project_a&scope=task').assetScope, 'project');
  assert.equal(parseWorkbenchRoute('?view=studio-overview&project=project_a&task=task_b&scope=round').assetScope, 'task');
  // A fully backed scope is untouched.
  assert.equal(parseWorkbenchRoute('?view=assets&project=project_a&task=task_b&round=round_c&scope=round').assetScope, 'round');
  assert.equal(parseWorkbenchRoute('?view=lineage&project=project_a&task=task_b&round=round_c&scope=round').roundId, 'round_c');
  assert.equal(parseWorkbenchRoute('?view=lineage&project=project_a&task=task_b&round=round_c&scope=round').assetScope, 'round');
});
