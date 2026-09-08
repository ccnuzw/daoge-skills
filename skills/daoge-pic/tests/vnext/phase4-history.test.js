const test = require('node:test');
const assert = require('node:assert/strict');

test('run history labels are stable identities independent of list position', async () => {
  const { runHistoryOption } = await import('../../web/src/status-presentation.mjs');
  const oldRun = { id: 'run_0123456789', shortId: '3456789', createdAt: '2026-08-30T11:22:33.456Z', planVersion: 7, status: 'completed' };
  const before = runHistoryOption(oldRun);
  const runs = [{ id: 'run_new', createdAt: '2026-09-01T00:00:00.000Z', planVersion: 8, status: 'running' }, oldRun];
  const after = runHistoryOption(runs[1]);
  assert.equal(before, '2026-08-30 11:22:33Z · v7 · 3456789 · 已完成');
  assert.equal(after, before);
});

test('run item recovery shows attempts, retry time, safe error and recovery guidance only', async () => {
  const { runItemRecovery } = await import('../../web/src/status-presentation.mjs');
  const item = {
    attempts: 3,
    status: 'retry_wait',
    retryAt: '2026-09-01T12:30:00.000Z',
    error: { summary: '服务暂时限流', kind: 'rate_limited', code: '429', endpoint: 'https://private.example/v1', apiKey: 'secret' }
  };
  const recovery = runItemRecovery(item);
  assert.deepEqual(recovery, { error: '服务暂时限流 · rate_limited · 429', advice: '系统将在 2026-09-01T12:30:00.000Z 后重试；也可立即重试此项。' });
  assert.equal(JSON.stringify(recovery).includes('private.example'), false);
  assert.equal(JSON.stringify(recovery).includes('secret'), false);
  assert.match('尝试 ' + item.attempts + ' 次 · ' + item.retryAt, /尝试 3 次/);
});

test('live run items merge into creative history without dropping historical output assets', async () => {
  const { mergeRunHistoryItems } = await import('../../web/src/status-presentation.mjs');
  const historical = [{ id: 'i1', status: 'requesting', attempts: 1, outputAssets: [{ id: 'asset-old' }] }, { id: 'i2', status: 'succeeded' }];
  const live = [{ id: 'i1', status: 'retry_wait', attempts: 2, retryAt: 'later' }, { id: 'i3', status: 'pending' }];
  assert.deepEqual(mergeRunHistoryItems(historical, live), [
    { id: 'i1', status: 'retry_wait', attempts: 2, retryAt: 'later', outputAssets: [{ id: 'asset-old' }] },
    { id: 'i2', status: 'succeeded' },
    { id: 'i3', status: 'pending' }
  ]);
});

test('run item pagination model serializes filters, bounds and retryable selections', async () => {
  const { normalizeRunItemPage, runItemFilterCount, runItemPageBounds, selectableRunItemIds, serializeRunItemRequestQuery } = await import('../../web/src/run-item-pagination.mjs');
  const query = serializeRunItemRequestQuery({ page: 3, pageSize: 100, filter: 'attention', sequence: 42 });
  assert.equal(query, 'page=3&pageSize=100&status=failed&status=blocked&status=outcome_unknown&sequence=42&sort=sequence');
  const page = normalizeRunItemPage({ items: [{ id: 'failed-1', status: 'failed' }, { id: 'blocked-1', status: 'blocked' }, { id: 'retry-1', status: 'retry_wait' }, { id: 'ok-1', status: 'succeeded' }], page: 3, pageSize: 100, total: 205, totalPages: 3, allTotal: 260, statusCounts: { failed: 2, blocked: 1, outcome_unknown: 1, succeeded: 200 } });
  assert.deepEqual(runItemPageBounds(page), { start: 201, end: 204 });
  assert.equal(runItemFilterCount(page.statusCounts, 'attention'), 4);
  assert.deepEqual(selectableRunItemIds(page.items, new Set(['failed-1', 'blocked-1', 'retry-1', 'ok-1'])), ['failed-1', 'blocked-1', 'retry-1']);
});
