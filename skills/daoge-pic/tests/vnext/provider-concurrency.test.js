const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { ProviderConcurrencyGovernor } = require('../../dist/vnext/runtime/provider-concurrency');
const { WorkerProcessPool } = require('../../dist/vnext/runtime/worker-pool');
const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { closeStudioDatabase, openStudioDatabase } = require('../../dist/vnext/studio/database');

const healthy = { succeeded: 16, rateLimited: 0, transient: 0, unknown: 0, otherFailure: 0, maxRssBytes: 0, maxExternalBytes: 0 };

test('Provider concurrency ramps toward 100 without exceeding the requested limit', () => {
  let now = 0;
  const governor = new ProviderConcurrencyGovernor(100, () => now, 16);
  assert.equal(governor.capacity(100), 16);
  for (let index = 0; index < 20; index += 1) {
    now += 5000;
    governor.record(healthy);
  }
  assert.equal(governor.snapshot().target, 100);
  assert.equal(governor.capacity(37), 37);
});

test('Provider rate limits halve the target and enforce a cooldown', () => {
  let now = 5000;
  const governor = new ProviderConcurrencyGovernor(100, () => now, 64);
  governor.record({ ...healthy, rateLimited: 1 });
  assert.equal(governor.snapshot().target, 32);
  assert.equal(governor.snapshot().lastReason, 'rate_limited');
  assert.notEqual(governor.snapshot().cooldownUntil, null);
  assert.equal(governor.capacity(100), 0);
  now += 30000;
  governor.record(healthy);
  assert.equal(governor.snapshot().target, 40);
  assert.equal(governor.capacity(100), 40);
});

test('Provider transient and unknown outcomes reduce concurrency without changing the hard maximum', () => {
  let now = 5000;
  const governor = new ProviderConcurrencyGovernor(100, () => now, 40);
  governor.record({ ...healthy, transient: 1 });
  assert.equal(governor.snapshot().target, 30);
  governor.record({ ...healthy, unknown: 1 });
  assert.equal(governor.snapshot().target, 22);
  assert.equal(governor.capacity(1000), 0);
  now += 10000;
  assert.equal(governor.capacity(1000), 22);
});

test('Provider cooldown state can be restored without exposing provider configuration', () => {
  let now = 5000;
  const source = new ProviderConcurrencyGovernor(100, () => now, 64);

  source.record({ ...healthy, rateLimited: 1, maxRssBytes: 1234 });
  const state = source.persistedState();
  assert.deepEqual(Object.keys(state).sort(), ['cooldownUntilMs', 'lastAdjustmentAtMs', 'lastReason', 'maxObservedExternalBytes', 'maxObservedRssBytes', 'target']);
  const restored = new ProviderConcurrencyGovernor(100, () => now, 16);
  restored.restore(state);
  assert.equal(restored.capacity(100), 0);
  now += 30000;
  assert.equal(restored.capacity(100), 32);
  assert.equal(restored.snapshot().lastReason, 'rate_limited');
});
test('Worker pools restore cooldown state only for their Studio profile version', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-provider-state-'));
  let db;
  let pool;
  try {
    const initialized = initializeStudio({ workspaceRoot });
    db = openStudioDatabase(initialized.paths, initialized.manifest);
    const studioId = initialized.manifest.studioId;
    const cooldownUntil = Date.now() + 30000;
    const insert = db.prepare('INSERT INTO provider_concurrency_state (studio_id, profile_id, config_version, target, cooldown_until_ms, last_adjustment_at_ms, last_reason, max_observed_rss_bytes, max_observed_external_bytes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insert.run(studioId, 'profile-a', 3, 1, cooldownUntil, Date.now(), 'rate_limited', 0, 0, new Date().toISOString());
    insert.run(studioId, 'profile-b', 3, 16, 0, 0, 'warmup', 0, 0, new Date().toISOString());
    closeStudioDatabase(db);
    db = null;
    pool = new WorkerProcessPool(workspaceRoot, 1, { profileId: 'profile-a', profileName: 'Safe Provider', configVersion: 3, providerId: 'offline-provider', baseUrl: 'https://provider.invalid/v1', apiKey: 'not-used', model: 'safe-model', options: {}, referenceEnabled: false, endpointTrustMode: 'compatible_public', limits: {}, descriptorVersion: 1, adapterVersion: 'offline-v1' });
    assert.equal(pool.concurrencySnapshot().target, 1);
    assert.equal(pool.concurrencySnapshot().cooldownUntil !== null, true);
    await pool.close();
    pool = null;
    db = openStudioDatabase(initialized.paths, initialized.manifest, { attachOnly: true });
    const rows = db.prepare('SELECT profile_id, target FROM provider_concurrency_state WHERE studio_id = ? ORDER BY profile_id').all(studioId).map((row) => ({ profile_id: row.profile_id, target: Number(row.target) }));
    assert.deepEqual(rows, [{ profile_id: 'profile-a', target: 1 }, { profile_id: 'profile-b', target: 16 }]);
  } finally {
    if (pool) await pool.close();
    if (db) closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
test('Configured Worker pools fail closed when the Studio state database is unavailable', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-provider-state-missing-'));
  let pool;
  try {
    pool = new WorkerProcessPool(workspaceRoot, 1, { profileId: 'profile-missing', profileName: 'Missing State Provider', configVersion: 1, providerId: 'openai-images', baseUrl: 'https://provider.invalid/v1', apiKey: 'not-used', model: 'safe-model', options: {}, referenceEnabled: false, endpointTrustMode: 'compatible_public', limits: {}, descriptorVersion: 1, adapterVersion: 'offline-v1' });
    assert.equal(pool.healthSnapshot().state, 'failed');
    assert.equal(pool.healthSnapshot().dispatchReason, 'failed');
    assert.match(pool.healthSnapshot().lastError || '', /Studio database is missing/);
    const result = await pool.processOnce(1);
    assert.deepEqual(result, { claimed: 0, succeeded: 0, retrying: 0, blocked: 0, unknown: 0, cancelled: 0 });
    assert.equal(pool.processIds().length, 0);
    assert.equal(pool.healthSnapshot().state, 'failed');
    assert.equal(pool.healthSnapshot().dispatchReason, 'failed');
  } finally {
    if (pool) await pool.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
