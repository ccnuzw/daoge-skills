const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = '../../web/src/offline-strategy-model.mjs';

test('compares all offline-first paths with structured capability and tradeoff rows', async () => {
  const { compareOfflineStrategies } = await import(modulePath);
  const comparison = compareOfflineStrategies();

  assert.equal(comparison.defaultStrategyId, 'offline');
  assert.deepEqual(comparison.strategies.map((item) => item.id), ['offline', 'deferred', 'canary', 'provider']);
  assert.deepEqual(comparison.capabilities.map((row) => row.id), ['local', 'deferred', 'canary', 'provider']);
  assert.deepEqual(comparison.tradeoffs.map((row) => row.id), ['network', 'privacy', 'billing']);
  assert.equal(comparison.automaticNetwork, false);
  assert.equal(comparison.automaticGeneration, false);
  for (const row of [...comparison.capabilities, ...comparison.tradeoffs]) assert.equal(row.cells.length, 4);
});

test('keeps the default offline path local and non-generating', async () => {
  const { offlineStrategyForId } = await import(modulePath);
  const offline = offlineStrategyForId('offline');

  assert.equal(offline.capabilities.local.state, 'available');
  assert.equal(offline.capabilities.deferred.state, 'deferred');
  assert.equal(offline.capabilities.canary.state, 'blocked');
  assert.equal(offline.capabilities.provider.state, 'blocked');
  assert.equal(offline.tradeoffs.network.level, 'none');
  assert.equal(offline.tradeoffs.privacy.level, 'local');
  assert.equal(offline.tradeoffs.billing.level, 'none');
  assert.equal(offline.automaticNetwork, false);
  assert.equal(offline.automaticGeneration, false);
  assert.equal(offlineStrategyForId('deferred').requiresExplicitAction, true);
  assert.equal(offlineStrategyForId('canary').requiresExplicitAction, true);
  assert.equal(offlineStrategyForId('provider').requiresExplicitAction, true);
  assert.equal(offline.providerCall, 'none');
});

test('marks Canary and real Provider as explicit external choices', async () => {
  const { offlineStrategyForId } = await import(modulePath);
  const canary = offlineStrategyForId('canary');
  const provider = offlineStrategyForId('provider');

  assert.equal(canary.capabilities.canary.state, 'explicit');
  assert.equal(canary.capabilities.provider.state, 'separate');
  assert.equal(canary.tradeoffs.network.level, 'explicit');
  assert.equal(canary.tradeoffs.billing.level, 'possible');
  assert.equal(provider.capabilities.provider.state, 'explicit');
  assert.equal(provider.capabilities.canary.state, 'separate');
  assert.equal(provider.tradeoffs.privacy.level, 'external-by-confirmation');
  assert.equal(provider.tradeoffs.billing.level, 'provider-dependent');
  assert.equal(canary.automaticNetwork, false);
  assert.equal(provider.automaticGeneration, false);
});

test('uses the complete offline-first comparison for unknown or empty selections', async () => {
  const { compareOfflineStrategies } = await import(modulePath);
  assert.deepEqual(compareOfflineStrategies(['unknown']).strategies.map((item) => item.id), ['offline', 'deferred', 'canary', 'provider']);
  assert.deepEqual(compareOfflineStrategies([]).strategies.map((item) => item.id), ['offline', 'deferred', 'canary', 'provider']);
  assert.deepEqual(compareOfflineStrategies(['provider', 'provider', 'offline']).strategies.map((item) => item.id), ['provider', 'offline']);
});
