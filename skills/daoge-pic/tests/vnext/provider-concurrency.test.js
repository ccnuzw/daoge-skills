const test = require('node:test');
const assert = require('node:assert/strict');

const { ProviderConcurrencyGovernor } = require('../../dist/vnext/runtime/provider-concurrency');

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
