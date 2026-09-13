const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROVENANCE_SCHEMA_VERSION,
  RETENTION_POLICY_VERSION,
  buildCanonicalProvenance,
  redactProvenance,
  hashSafePrompt,
  evaluateRetention
} = require('../../dist/vnext/provenance/contract');

function digest(seed) {
  return hashSafePrompt(seed);
}

function record(overrides = {}) {
  return {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    recordId: 'prov_01',
    createdAt: '2026-09-13T10:00:00.000Z',
    projectId: 'project_01',
    taskId: 'task_01',
    roundId: 'round_01',
    plan: {
      planId: 'plan_01',
      version: 2,
      operation: 'edit',
      planHash: digest('plan-safe'),
      safePromptHash: digest('prompt-never-stored')
    },
    provider: {
      providerId: 'openai-images',
      descriptorVersion: 3,
      configVersion: 7,
      model: 'gpt-image-safe'
    },
    run: { runId: 'run_01', itemId: 'item_01', itemSequence: 1 },
    inputs: [
      { assetId: 'asset_02', usage: 'style', kind: 'import', mediaType: 'image/png', contentHash: digest('asset-2') },
      { assetId: 'asset_01', usage: 'primary', kind: 'generated', mediaType: 'image/webp', contentHash: digest('asset-1') }
    ],
    review: {
      decision: 'keep',
      reviewerId: 'creator_01',
      reviewedAt: '2026-09-13T10:01:00.000Z',
      feedbackHash: digest('feedback-safe')
    },
    exportReport: { reportId: 'report_01', version: 4, exportedAt: '2026-09-13T10:02:00.000Z' },
    ...overrides
  };
}

test('canonical provenance is stable and sorts input assets', () => {
  const first = buildCanonicalProvenance(record());
  const second = buildCanonicalProvenance({ ...record(), inputs: [...record().inputs].reverse(), provider: { model: 'gpt-image-safe', configVersion: 7, descriptorVersion: 3, providerId: 'openai-images' } });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.canonicalJson, second.canonicalJson);
  assert.deepEqual(first.record.inputs.map((asset) => asset.assetId), ['asset_01', 'asset_02']);
});

test('missing causal fields produce structured validation issues without defaults', () => {
  const value = record();
  delete value.run;
  delete value.exportReport;
  const result = buildCanonicalProvenance(value);
  assert.equal(result.ok, false);
  assert.equal(result.record, null);
  assert.equal(result.canonicalJson, null);
  assert.deepEqual(result.issues.map((item) => item.path), ['$.run', '$.exportReport']);
});

test('prompt text, secrets, URLs, paths, and provider payloads are rejected', () => {
  for (const mutation of [
    { plan: { ...record().plan, prompt: 'raw prompt must not persist' } },
    { provider: { ...record().provider, apiKey: 'sk-test-secret' } },
    { provider: { ...record().provider, endpoint: 'https://provider.example.test/v1' } },
    { inputs: [{ ...record().inputs[0], storagePath: '/Users/alice/image.png' }] },
    { provider: { ...record().provider, rawResponse: { image: 'secret' } } }
  ]) {
    const result = buildCanonicalProvenance({ ...record(), ...mutation });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((item) => item.code === 'prompt_text_forbidden' || item.code === 'sensitive_field_forbidden'));
  }
});

test('safe prompt hash and safe projection never contain raw sensitive inputs', () => {
  const rawPrompt = 'a private prompt with https://private.example.test and /Users/alice/private.png';
  const value = record({ plan: { ...record().plan, safePromptHash: hashSafePrompt(rawPrompt) } });
  const projected = redactProvenance(value);
  assert.equal(projected.ok, true);
  assert.equal(projected.json.includes(rawPrompt), false);
  assert.equal(projected.json.includes('private.example.test'), false);
  assert.equal(projected.json.includes('/Users/alice'), false);
  assert.equal(projected.json.includes('apiKey'), false);
  assert.equal(projected.json.includes('rawResponse'), false);
});

test('retention rules are explicit, versioned, and honor inclusive expiry boundaries', () => {
  const policy = {
    version: RETENTION_POLICY_VERSION,
    rules: {
      source_asset: { action: 'keep' },
      generated_asset: { action: 'keep', expiresAfterMs: 1000, onExpire: 'delete' },
      prompt_hash: { action: 'redact' },
      review: { action: 'keep' },
      export_report: { action: 'delete' }
    }
  };
  assert.deepEqual(evaluateRetention('source_asset', policy).action, 'keep');
  assert.deepEqual(evaluateRetention('prompt_hash', policy).action, 'redact');
  assert.deepEqual(evaluateRetention('export_report', policy).action, 'delete');
  const boundary = evaluateRetention('generated_asset', policy, { recordedAt: '2026-09-13T10:00:00.000Z', now: '2026-09-13T10:00:01.000Z' });
  assert.equal(boundary.expired, true);
  assert.equal(boundary.action, 'delete');
});

test('unknown categories and incomplete policies fail closed without deletion side effects', () => {
  const unknown = evaluateRetention('provider_request', { version: 1, rules: {} });
  assert.equal(unknown.action, 'delete');
  assert.equal(unknown.failClosed, true);
  assert.equal(unknown.matched, false);
  const missingRule = evaluateRetention('review', { version: 1, rules: { prompt_hash: { action: 'redact' } } });
  assert.equal(missingRule.action, 'delete');
  assert.equal(missingRule.failClosed, true);
  const badPolicy = evaluateRetention('review', { version: 1, rules: { review: { action: 'keep' }, future_category: { action: 'keep' } } });
  assert.equal(badPolicy.failClosed, true);
  assert.equal(badPolicy.action, 'delete');
});
