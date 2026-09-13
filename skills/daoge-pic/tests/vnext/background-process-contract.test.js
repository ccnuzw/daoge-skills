const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { closeStudioDatabase, openStudioDatabase } = require('../../dist/vnext/studio/database');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const assert = require('node:assert/strict');

test('generation and media worker pools hide every Windows child console while retaining IPC', async () => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  const workerModule = require.resolve('../../dist/vnext/runtime/worker-pool');
  const mediaModule = require.resolve('../../dist/vnext/runtime/media-worker-pool');
  const calls = [];
  let nextPid = 9100;
  childProcess.spawn = (executable, args, options) => {
    const child = new EventEmitter();
    calls.push({ executable, args, options });
    child.pid = nextPid++;
    child.connected = false;
    child.exitCode = 0;
    child.signalCode = null;
    child.kill = () => true;
    child.send = () => false;
    return child;
  };
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-worker contract-'));
  const initialized = initializeStudio({ workspaceRoot });
  const database = openStudioDatabase(initialized.paths, initialized.manifest);
  closeStudioDatabase(database);

  let generationPool;
  let mediaPool;
  try {
    delete require.cache[workerModule];
    delete require.cache[mediaModule];
    const { WorkerProcessPool } = require(workerModule);
    const { MediaProcessPool } = require(mediaModule);
    generationPool = new WorkerProcessPool(workspaceRoot, 1, { profileId: 'profile-contract', profileName: 'Contract Provider', configVersion: 7, providerId: 'openai-images', baseUrl: 'https://provider.example/v1', apiKey: 'provider-contract-key', model: 'gpt-image-2', options: {}, referenceEnabled: true, endpointTrustMode: 'compatible_public', limits: {}, descriptorVersion: 1, adapterVersion: 'http-image-v1' });
    mediaPool = new MediaProcessPool(workspaceRoot, 1);
    assert.equal(calls.length, 0);
    await generationPool.processOnce(1);
    void mediaPool.run({ type: 'reconcile', studioId: 'studio-contract' }).catch(() => undefined);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].executable, process.execPath);
    assert.equal(calls[1].executable, process.execPath);
    assert.match(calls[0].args[0], /worker-process\.js$/);
    assert.match(calls[1].args[0], /media-worker-process\.js$/);
    assert.deepEqual(calls[0].args.slice(1), ['--workspace', workspaceRoot, '--provider-profile-id', 'profile-contract', '--provider-config-version', '7', '--provider-config-ipc']);
    assert.deepEqual(calls[1].args.slice(1), ['--workspace', workspaceRoot]);
    for (const call of calls) {
      assert.equal(call.options.windowsHide, true);
      assert.deepEqual(call.options.stdio, ['ignore', 'ignore', 'ignore', 'ipc']);
    }
  } finally {
    if (generationPool) await generationPool.close();
    if (mediaPool) await mediaPool.close();
    childProcess.spawn = originalSpawn;
    delete require.cache[workerModule];
    delete require.cache[mediaModule];
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
