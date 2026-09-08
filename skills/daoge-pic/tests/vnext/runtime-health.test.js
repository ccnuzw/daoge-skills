const test = require('node:test');
const assert = require('node:assert/strict');

test('Workbench runtime health distinguishes recovery and exhausted worker states', async () => {
  const { runtimeHealthPresentation } = await import('../../web/src/runtime-health.mjs');
  assert.equal(runtimeHealthPresentation({}, 'stopping').title, '正在安全关闭后台任务');
  assert.equal(runtimeHealthPresentation({}, 'reconnecting').title, 'Studio 正在重连');
  assert.equal(runtimeHealthPresentation({}, 'restored').title, 'Studio 已恢复');
  const failed = runtimeHealthPresentation({ workerPool: { state: 'failed', lastError: 'worker unavailable' }, mediaWorkerPool: { state: 'idle' } });
  assert.equal(failed.tone, 'danger');
  assert.match(failed.detail, /worker unavailable/);
  const healthy = runtimeHealthPresentation({ workerPool: { state: 'idle' }, mediaWorkerPool: { state: 'idle' } });
  assert.equal(healthy.tone, 'ready');
});

test('Workbench diagnostic summary excludes paths, URLs, authorization values, and Provider secrets', async () => {
  const { redactedRuntimeDiagnostic } = await import('../../web/src/runtime-health.mjs');
  const summary = redactedRuntimeDiagnostic({
    studio: {
      protocol: { runtimeVersion: '5.11.0', version: '2.0.0' },
      runtime: { mode: 'daemon', workerPool: { state: 'failed', lastError: 'C:\\Users\\name\\secret apiKey=top-secret https://private.example/v1' }, mediaWorkerPool: { state: 'idle' } }
    },
    provider: { configured: true, apiKey: 'must-not-copy', endpoint: 'https://private.example/v1' },
    recoveryPhase: 'reconnecting',
    connectionError: 'offline'
  });
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes('C:\\Users'), false);
  assert.equal(serialized.includes('top-secret'), false);
  assert.equal(serialized.includes('must-not-copy'), false);
  assert.equal(serialized.includes('private.example'), false);
  assert.equal(summary.providerConfigured, true);
  assert.equal(summary.connected, false);
});
