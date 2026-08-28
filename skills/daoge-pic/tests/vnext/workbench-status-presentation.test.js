const test = require('node:test');
const assert = require('node:assert/strict');

test('status labels distinguish an open project, confirmed round, and active Provider execution', async () => {
  const { statusPresentation, taskPresentation, runExecutionPresentation } = await import('../../web/src/status-presentation.mjs');

  assert.deepEqual(statusPresentation('project', 'active'), { label: '开放', tone: 'ready' });
  assert.deepEqual(statusPresentation('round', 'active'), { label: '已确认 · 可继续', tone: 'ready' });
  assert.deepEqual(taskPresentation({ status: 'draft' }, [{ status: 'active' }, { status: 'active' }]), { label: '已确认 · 2 轮次', tone: 'ready' });
  assert.deepEqual(runExecutionPresentation({ status: 'running' }, [{ status: 'requesting' }]), { label: '正在生成', tone: 'live' });
});

test('execution status remains distinct from queued, preparing, paused, and terminal runs', async () => {
  const { runExecutionPresentation } = await import('../../web/src/status-presentation.mjs');

  assert.deepEqual(runExecutionPresentation({ status: 'queued' }, [{ status: 'pending' }]), { label: '排队中', tone: 'live' });
  assert.deepEqual(runExecutionPresentation({ status: 'running' }, [{ status: 'leased' }]), { label: '正在准备', tone: 'live' });
  assert.deepEqual(runExecutionPresentation({ status: 'paused' }, [{ status: 'pending' }]), { label: '已暂停', tone: 'quiet' });
  assert.deepEqual(runExecutionPresentation({ status: 'completed' }, [{ status: 'succeeded' }]), { label: '已完成', tone: 'ready' });
});

test('status presentation does not use the ambiguous 进行中 label', async () => {
  const { statusPresentation, taskPresentation, runExecutionPresentation } = await import('../../web/src/status-presentation.mjs');
  const labels = [
    statusPresentation('project', 'active').label,
    statusPresentation('round', 'active').label,
    taskPresentation({ status: 'draft' }, [{ status: 'active' }]).label,
    runExecutionPresentation({ status: 'running' }, [{ status: 'receiving' }]).label
  ];

  assert.equal(labels.includes('进行中'), false);
  assert.equal(labels.includes('正在生成'), true);
});
