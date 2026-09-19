const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * 就地建任务 / 批次的守卫（方案 4.3「画布外 / 创建」· 施工单 G2）。
 *
 * 「建任务不该是离开画布的理由」：空白双击或选中菜单建完结构，**必须留在画布**，
 * 且新建的那个实体要成为当前焦点——否则用户建完就不知道自己去哪了。
 *
 * 纯函数：给定当前 route 与新建的实体，返回**保持 view 不变**的新 route。
 */

async function model() {
  try {
    return await import('../../web/src/canvas-creation-model.mjs');
  } catch (error) {
    assert.fail('就地创建模型尚未实现：web/src/canvas-creation-model.mjs（' + error.code + '）');
  }
}

const route = { view: 'lineage', projectId: 'project_1', taskId: 'task_old', roundId: 'round_old', assetScope: 'project' };

test('建任务是留在画布、并把新任务设为焦点', async () => {
  const { inPlaceCreationRoute } = await model();
  const next = inPlaceCreationRoute({ ...route, kind: 'task', id: 'task_new' });
  assert.equal(next.view, 'lineage', '不许跳到任务列表');
  assert.equal(next.taskId, 'task_new');
  assert.equal(next.projectId, 'project_1', '项目不变');
});

test('建批次同理：留在画布，且新批次之前不残留旧批次焦点', async () => {
  const { inPlaceCreationRoute } = await model();
  const next = inPlaceCreationRoute({ ...route, kind: 'round', id: 'round_new' });
  assert.equal(next.view, 'lineage');
  assert.equal(next.roundId, 'round_new');
});

test('不认识的 kind 拒绝，而不是悄悄跳到某处', async () => {
  const { inPlaceCreationRoute } = await model();
  assert.throws(() => inPlaceCreationRoute({ ...route, kind: 'project', id: 'x' }), /kind|创建|支持/);
});