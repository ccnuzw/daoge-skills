const test = require('node:test');
const assert = require('node:assert/strict');

test('project management filters names, descriptions, and lifecycle status', async () => {
  const { filterProjects } = await import('../../web/src/workspace-list-model.mjs');
  const projects = [
    { name: '青春四人组', description: '运动电商', status: 'active' },
    { name: '旧项目', description: '历史归档', status: 'archived' }
  ];
  assert.deepEqual(filterProjects(projects, '电商', 'all').map((item) => item.name), ['青春四人组']);
  assert.deepEqual(filterProjects(projects, '', 'archived').map((item) => item.name), ['旧项目']);
});

test('task management groups open work and clamps paginated results', async () => {
  const { filterTasks, paginateWorkspaceItems } = await import('../../web/src/workspace-list-model.mjs');
  const tasks = Array.from({ length: 25 }, (_, index) => ({ name: '任务 ' + index, status: index < 20 ? 'active' : index < 23 ? 'completed' : 'archived' }));
  assert.equal(filterTasks(tasks, '', 'open').length, 20);
  assert.equal(filterTasks(tasks, '任务 2', 'all').length, 6);
  const page = paginateWorkspaceItems(tasks, 9, 12);
  assert.equal(page.page, 3);
  assert.equal(page.totalPages, 3);
  assert.equal(page.items.length, 1);
});
