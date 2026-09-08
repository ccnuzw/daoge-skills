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

test('project and task selection open their respective workspace home', async () => {
  const { selectProject, selectTask, selectRound, updateWorkbenchRoute } = await import('../../web/src/workbench-route.mjs');
  const base = { view: 'runs', projectId: 'project_a', taskId: 'task_b', roundId: 'round_c', compareRoundIds: ['round_c'], runId: 'run_d', assetScope: 'round', ...RUN_ITEM_DEFAULTS };
  assert.deepEqual(selectProject(base, 'project_z'), { view: 'project-overview', projectId: 'project_z', taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' });
  assert.deepEqual(selectTask(base, 'task_z'), { view: 'studio-overview', projectId: 'project_a', taskId: 'task_z', roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' });
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
  assert.deepEqual(updateWorkbenchRoute(route, { view: 'prompts' }), { view: 'prompts', projectId: 'project_a', taskId: 'task_b', roundId: 'round_c', compareRoundIds: ['round_c'], runId: 'run_d', assetScope: 'round' });
});
