const test = require('node:test');
const assert = require('node:assert/strict');

test('Workbench route round-trips explicit task and round context', async () => {
  const { parseWorkbenchRoute, serializeWorkbenchRoute } = await import('../../web/src/workbench-route.mjs');
  const route = parseWorkbenchRoute('?view=runs&project=project_a&task=task_b&round=round_c&run=run_d&scope=round');
  assert.deepEqual(route, { view: 'runs', projectId: 'project_a', taskId: 'task_b', roundId: 'round_c', compareRoundIds: ['round_c'], runId: 'run_d', assetScope: 'round' });
  assert.equal(serializeWorkbenchRoute(route), '?view=runs&project=project_a&task=task_b&round=round_c&run=run_d&scope=round');
});

test('Studio-global views discard project context and do not serialize it', async () => {
  const { parseWorkbenchRoute, serializeWorkbenchRoute, isStudioView } = await import('../../web/src/workbench-route.mjs');
  const guide = parseWorkbenchRoute('?view=guide&project=project_a&task=task_b&round=round_c&scope=round');
  assert.deepEqual(guide, { view: 'guide', projectId: null, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'studio' });
  assert.equal(serializeWorkbenchRoute(guide), '?view=guide');
  assert.equal(isStudioView('library'), true);
  assert.equal(isStudioView('shared-assets'), true);
  assert.equal(isStudioView('trash'), false);
});

test('project and task selection open their respective workspace home', async () => {
  const { selectProject, selectTask, selectRound, updateWorkbenchRoute } = await import('../../web/src/workbench-route.mjs');
  const base = { view: 'runs', projectId: 'project_a', taskId: 'task_b', roundId: 'round_c', compareRoundIds: ['round_c'], runId: 'run_d', assetScope: 'round' };
  assert.deepEqual(selectProject(base, 'project_z'), { view: 'project-overview', projectId: 'project_z', taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' });
  assert.deepEqual(selectTask(base, 'task_z'), { view: 'studio-overview', projectId: 'project_a', taskId: 'task_z', roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' });
  assert.deepEqual(selectRound(base, 'round_z'), { ...base, roundId: 'round_z', compareRoundIds: ['round_z'], runId: null, assetScope: 'round' });
  assert.deepEqual(updateWorkbenchRoute(base, { runId: 'run_z' }), { ...base, runId: 'run_z' });
});

test('project assets deep links never retain a Studio-wide scope', async () => {
  const { parseWorkbenchRoute, serializeWorkbenchRoute } = await import('../../web/src/workbench-route.mjs');
  const projectAssets = parseWorkbenchRoute('?view=assets&project=project_a&scope=studio');
  assert.deepEqual(projectAssets, { view: 'assets', projectId: 'project_a', taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' });
  assert.equal(serializeWorkbenchRoute(projectAssets), '?view=assets&project=project_a&scope=project');
  const taskAssets = parseWorkbenchRoute('?view=assets&project=project_a&task=task_b&scope=studio');
  assert.deepEqual(taskAssets, { view: 'assets', projectId: 'project_a', taskId: 'task_b', roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' });
  assert.equal(serializeWorkbenchRoute(taskAssets), '?view=assets&project=project_a&task=task_b&scope=task');
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
