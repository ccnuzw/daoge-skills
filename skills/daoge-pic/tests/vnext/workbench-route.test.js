const test = require('node:test');
const assert = require('node:assert/strict');

test('Workbench route round-trips explicit context without selecting implicit defaults', async () => {
  const { parseWorkbenchRoute, serializeWorkbenchRoute } = await import('../../web/src/workbench-route.mjs');
  const route = parseWorkbenchRoute('?view=runs&project=project_a&task=task_b&round=round_c&run=run_d&scope=round');

  assert.deepEqual(route, { view: 'runs', projectId: 'project_a', taskId: 'task_b', roundId: 'round_c', runId: 'run_d', assetScope: 'round' });
  assert.equal(serializeWorkbenchRoute(route), '?view=runs&project=project_a&task=task_b&round=round_c&run=run_d&scope=round');
});

test('Workbench route rejects unknown view and scope without inventing an entity selection', async () => {
  const { parseWorkbenchRoute } = await import('../../web/src/workbench-route.mjs');
  assert.deepEqual(parseWorkbenchRoute('?view=unknown&scope=all'), { view: 'assets', projectId: null, taskId: null, roundId: null, runId: null, assetScope: 'round' });
});

test('parent selections clear dependent Workbench route IDs while explicit run selection remains scoped', async () => {
  const { selectProject, selectTask, selectRound, updateWorkbenchRoute } = await import('../../web/src/workbench-route.mjs');
  const base = { view: 'runs', projectId: 'project_a', taskId: 'task_b', roundId: 'round_c', runId: 'run_d', assetScope: 'round' };

  assert.deepEqual(selectProject(base, 'project_z'), { ...base, projectId: 'project_z', taskId: null, roundId: null, runId: null });
  assert.deepEqual(selectTask(base, 'task_z'), { ...base, taskId: 'task_z', roundId: null, runId: null });
  assert.deepEqual(selectRound(base, 'round_z'), { ...base, roundId: 'round_z', runId: null });
  assert.deepEqual(updateWorkbenchRoute(base, { runId: 'run_z' }), { ...base, runId: 'run_z' });
});
