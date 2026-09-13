const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertProviderCanaryOptIn,
  createOfflineProviderTransport,
  runProviderConformance,
  runProviderConformanceSuite
} = require('../../dist/vnext/providers/conformance');
const { createImageProvider } = require('../../dist/vnext/providers/http-adapters');

const providerIds = ['openai-images', 'gemini-image', 'gemini-openai-compatible', 'xai-grok-image'];

function check(result, code) {
  return result.checks.find((item) => item.code === code);
}

test('offline provider conformance covers every built-in adapter without network access', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('global fetch must not be called by offline conformance'); };
  try {
    const suite = await runProviderConformanceSuite();
    assert.equal(suite.status, 'pass');
    assert.deepEqual(suite.results.map((result) => result.providerId), providerIds);
    for (const result of suite.results) {
      assert.equal(result.status, 'pass');
      assert.deepEqual(result.failedCodes, []);
      assert.equal(result.descriptorVersion, suite.descriptorVersion);
      assert.equal(result.adapterVersion, suite.adapterVersion);
      assert.equal(result.checks.length, 9);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('offline transport records request shape only and never exposes credential or body data', async () => {
  const transport = createOfflineProviderTransport('openai-images');
  const secret = 'offline-secret-for-test';
  await transport.dependencies.fetch('https://secret.example.invalid/v1/images/generations', {
    method: 'POST',
    redirect: 'manual',
    headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'private prompt', api_key: secret })
  });
  assert.deepEqual(transport.requests, [{
    method: 'POST',
    path: '/v1/images/generations',
    headerNames: ['authorization', 'content-type'],
    hasAuthorization: true,
    hasGoogleApiKey: false,
    redirectMode: 'manual',
    bodyKind: 'json',
    bodyKeys: ['api_key', 'prompt']
  }]);
  const serialized = JSON.stringify(transport.requests);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('secret.example.invalid'), false);
  assert.equal(serialized.includes('private prompt'), false);
});

test('conformance result is structured and credential-free after sensitive recorded response metadata', async () => {
  const result = await runProviderConformance('openai-images', {
    fixture: {
      successBody: {
        data: [{ b64_json: 'iVBORw0KGgo=', revised_prompt: 'offline response' }],
        usage: { note: 'offline response metadata' }
      }
    }
  });
  assert.equal(result.status, 'pass');
  assert.equal(check(result, 'response_sanitization').status, 'pass');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('offline-conformance-key'), false);
  assert.equal(serialized.includes('provider-fixture.invalid'), false);
  assert.equal(serialized.includes('b64_json'), false);
});

test('unsupported capability violations are reported by the harness', async () => {
  const config = { providerId: 'gemini-openai-compatible', baseUrl: 'https://fixture.example.invalid/v1', apiKey: 'fixture-key', model: 'fixture-model', referenceEnabled: false };
  const transport = createOfflineProviderTransport('gemini-openai-compatible');
  const provider = createImageProvider(config, transport.dependencies);
  provider.capabilities = () => ({
    textToImage: true,
    referenceEdit: false,
    maskEdit: false,
    cancellation: false,
    reconciliation: false,
    idempotency: false,
    acceptedReferenceMediaTypes: []
  });
  provider.edit = async () => ({ bytes: Buffer.from('fixture'), mediaType: 'image/png' });
  const result = await runProviderConformance('gemini-openai-compatible', { provider });
  assert.equal(result.status, 'fail');
  assert.equal(check(result, 'unsupported_capability').status, 'fail');
});

test('error classification violations are reported by the harness', async () => {
  const config = { providerId: 'openai-images', baseUrl: 'https://fixture.example.invalid/v1', apiKey: 'fixture-key', model: 'fixture-model', referenceEnabled: false };
  const transport = createOfflineProviderTransport('openai-images');
  const provider = createImageProvider(config, transport.dependencies);
  provider.classifyError = () => ({ kind: 'unknown_outcome', code: 'fixture', message: 'fixture' });
  const result = await runProviderConformance('openai-images', { provider });
  assert.equal(result.status, 'fail');
  assert.equal(check(result, 'error_classification').status, 'fail');
});

test('redirect safety violations are reported by the harness', async () => {
  const config = { providerId: 'openai-images', baseUrl: 'https://fixture.example.invalid/v1', apiKey: 'fixture-key', model: 'fixture-model', referenceEnabled: false };
  const transport = createOfflineProviderTransport('openai-images');
  const provider = createImageProvider(config, transport.dependencies);
  const result = await runProviderConformance('openai-images', { provider });
  assert.equal(result.status, 'fail');
  assert.equal(check(result, 'redirect_safety').status, 'fail');
});

test('real endpoint canary guard requires explicit opt-in and injected transport', () => {
  assert.throws(() => assertProviderCanaryOptIn(), /provider_canary_opt_in_required/);
  assert.throws(() => assertProviderCanaryOptIn({ enabled: true }), /provider_canary_transport_required/);
  const injected = async () => new Response(null, { status: 204 });
  assert.doesNotThrow(() => assertProviderCanaryOptIn({ enabled: true, transport: { fetch: injected } }));
});
