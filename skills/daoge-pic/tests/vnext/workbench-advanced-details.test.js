const test = require('node:test');
const assert = require('node:assert/strict');

test('advanced details renders the persisted dry-run preview model without preflight results', async () => {
  const { normalizeAdvancedDetails, dryRunEvidence } = await import('../../web/src/advanced-details.mjs');
  const details = normalizeAdvancedDetails({
    plans: [{ planVersion: 2, state: 'confirmed', plan: { operation: 'generate' } }],
    dryRuns: [{
      id: 'dryrun-1',
      planVersion: 2,
      providerSnapshot: { providerId: 'openai-images', model: 'gpt-image-2', endpoint: 'private-endpoint' },
      planSnapshot: { operation: 'generate', itemCount: 2 },
      itemCount: 2,
      createdAt: '2026-08-27T00:00:00.000Z'
    }]
  });

  assert.equal(details.plans.length, 1);
  assert.equal(details.dryRuns.length, 1);
  assert.deepEqual(dryRunEvidence(details.dryRuns[0]), {
    status: '预检通过',
    planVersion: 2,
    details: {
      planSnapshot: { operation: 'generate', itemCount: 2 },
      provider: { providerId: 'openai-images', model: 'gpt-image-2', referenceEnabled: false, capabilities: {} },
      itemCount: 2,
      createdAt: '2026-08-27T00:00:00.000Z'
    }
  });
  assert.equal(JSON.stringify(dryRunEvidence(details.dryRuns[0]).details).includes('endpoint'), false);
});

test('advanced details tolerates missing or incomplete historical evidence', async () => {
  const { normalizeAdvancedDetails, dryRunEvidence } = await import('../../web/src/advanced-details.mjs');
  const details = normalizeAdvancedDetails({ plans: null, dryRuns: [{ id: 'legacy-dryrun' }, null] });

  assert.deepEqual(details.plans, []);
  assert.equal(details.dryRuns.length, 1);
  assert.deepEqual(dryRunEvidence(details.dryRuns[0]), {
    status: '记录不完整',
    planVersion: null,
    details: { planSnapshot: {}, provider: { providerId: null, model: null, referenceEnabled: false, capabilities: {} }, itemCount: null, createdAt: null }
  });
});
