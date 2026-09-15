const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = '../../web/src/error-model.mjs';

test('normalizes Studio API conflict errors into stable local UI state', async () => {
  const { normalizeWorkbenchError, errorPresentation } = await import(modulePath);
  const normalized = normalizeWorkbenchError({
    status: 409,
    error: {
      code: 'version_conflict',
      message: '已创建生成运行：/Users/alice/workspace should not be copied',
      requestId: 'req_conflict-123',
      details: { entity: 'run', from: 'paused', to: 'pausing' }
    }
  }, { operation: 'queue-generation-run', resource: 'run:active', phase: 'preflight' });

  assert.equal(normalized.category, 'conflict');
  assert.equal(normalized.code, 'version_conflict');
  assert.equal(normalized.requestId, 'req_conflict-123');
  assert.equal(normalized.operation, 'queue-generation-run');
  assert.equal(normalized.resource, 'run:active');
  assert.equal(normalized.safeToRetry, false);
  assert.equal(normalized.outcome, 'not_submitted');
  assert.deepEqual(normalized.actions, ['continue', 'view-details']);
  assert.equal(JSON.stringify(normalized).includes('/Users/alice'), false);

  const presentation = errorPresentation(normalized);
  assert.equal(presentation.title, '状态已变化');
  assert.equal(presentation.failure, true);
});

test('surfaces a Provider secret-backend mismatch as actionable configuration copy, not a lost connection', async () => {
  const { normalizeWorkbenchError, errorPresentation } = await import(modulePath);
  const normalized = normalizeWorkbenchError({
    status: 409,
    error: {
      code: 'provider_secret_backend_policy',
      message: '当前 daemon 的 Provider 凭据后端与工作区内已有的 Provider Profile 不一致，因此拒绝读写。',
      details: { activeBackend: 'system', requiredEnv: 'DAOGE_PIC_PROVIDER_SECRET_BACKEND=plaintext', reason: 'Plaintext Provider credentials are read-only legacy data under the active secret backend policy.' }
    }
  }, { operation: 'save-provider', resource: 'provider:profile_1' });

  assert.equal(normalized.category, 'secret_backend');
  assert.equal(normalized.code, 'provider_secret_backend_policy');
  assert.equal(normalized.safeToRetry, false);
  assert.match(normalized.message, /DAOGE_PIC_PROVIDER_SECRET_BACKEND=plaintext/);
  assert.doesNotMatch(normalized.message, /无法连接到本地 Studio/);

  const presentation = errorPresentation(normalized);
  assert.equal(presentation.title, 'Provider 凭据后端不匹配');
  assert.equal(presentation.failure, true);
});

test('redacts sensitive API, Provider, prompt, URL, and path data from the model', async () => {
  const { normalizeWorkbenchError } = await import(modulePath);
  const normalized = normalizeWorkbenchError({
    status: 502,
    error: {
      code: 'provider_http_502',
      message: 'Rejected sk-secret-abcdefgh at https://private.example/v1 for prompt: 夏季新品广告语 with /tmp/daoge/raw.png file:///Users/alice/private.txt ftp://private.example/raw www.private.example/raw',
      requestId: 'https://private.example/v1/request/secret',
      details: {
        providerId: 'openai-images',
        prompt: '夏季新品广告语',
        baseUrl: 'https://private.example/v1',
        apiKey: 'sk-secret-abcdefgh',
        rawResponse: { output: 'full provider response' },
        context: { roundId: 'round_123', endpointPath: '/tmp/daoge/raw.png' }
      }
    }
  });

  assert.equal(normalized.category, 'provider');
  assert.equal(normalized.requestId, null);
  const serialized = JSON.stringify(normalized);
  assert.equal(serialized.includes('sk-secret'), false);
  assert.equal(serialized.includes('private.example'), false);
  assert.equal(serialized.includes('夏季新品广告语'), false);
  assert.equal(serialized.includes('/tmp/daoge'), false);
  assert.equal(serialized.includes('private.txt'), false);
  assert.equal(serialized.includes('private.example'), false);
  assert.equal(serialized.includes('full provider response'), false);
  assert.equal(normalized.context.roundId, 'round_123');
});

test('re-normalizes hostile normalized-looking errors before presentation', async () => {
  const { normalizeWorkbenchError } = await import(modulePath);
  const normalized = normalizeWorkbenchError({ category: 'connection', safeToRetry: true, actions: ['retry'], message: 'secret-value', requestId: 'secret-value' });

  assert.equal(normalized.category, 'connection');
  assert.equal(normalized.requestId, null);
  assert.equal(normalized.message.includes('secret-value'), false);
  assert.deepEqual(normalized.actions, ['reconnect', 'retry', 'view-details']);
});

test('marks conflicts, unknown outcomes, and partial batches as unsafe to retry', async () => {
  const { normalizeWorkbenchError, canRetryWorkbenchError } = await import(modulePath);
  const conflict = normalizeWorkbenchError({ status: 409, error: { code: 'version_conflict', retryable: true } });
  const unknown = normalizeWorkbenchError({ error: { code: 'lease_expired', kind: 'unknown_outcome', retryable: true }, phase: 'receiving' });
  const partial = normalizeWorkbenchError({ error: { code: 'partial_batch', retryable: true, details: { succeededCount: 2, failedCount: 1 } } });

  assert.equal(conflict.safeToRetry, false);
  assert.equal(canRetryWorkbenchError(unknown), false);
  assert.equal(unknown.category, 'unknown_outcome');
  assert.equal(unknown.outcome, 'unknown');
  assert.equal(unknown.mayHaveCommitted, true);
  assert.equal(partial.category, 'partial_batch');
  assert.equal(partial.outcome, 'partial');
  assert.equal(partial.safeToRetry, false);
});

test('allows local retry affordances for network and explicit retryable errors only', async () => {
  const { normalizeWorkbenchError, canRetryWorkbenchError, errorPresentation } = await import(modulePath);
  const network = normalizeWorkbenchError(Object.assign(new TypeError('Failed to fetch https://127.0.0.1:1234/api/studio'), { category: 'connection' }), { operation: 'refresh-studio', phase: 'loading' });
  assert.equal(network.category, 'connection');
  assert.equal(network.retryable, true);
  assert.equal(network.safeToRetry, true);
  assert.equal(canRetryWorkbenchError(network), true);
  assert.deepEqual(network.actions, ['reconnect', 'retry', 'view-details']);

  const retryable = normalizeWorkbenchError({ status: 503, error: { code: 'studio_busy', retryable: true, requestId: 'req_retry_01' } }, { operation: 'load-assets', phase: 'loading' });
  assert.equal(retryable.safeToRetry, true);
  assert.equal(errorPresentation(retryable).actions.some((action) => action.id === 'retry' && action.primary), true);
});

test('treats AbortError as a cancelled non-failure without retry controls', async () => {
  const { normalizeWorkbenchError, errorPresentation, canRetryWorkbenchError } = await import(modulePath);
  const abort = new DOMException('Stale refresh should never be surfaced as failure', 'AbortError');
  const normalized = normalizeWorkbenchError(abort, { operation: 'refresh-assets' });
  const presentation = errorPresentation(abort);

  assert.equal(normalized.category, 'abort');
  assert.equal(normalized.message, '操作已取消，页面状态已保留。');
  assert.equal(normalized.safeToRetry, false);
  assert.equal(canRetryWorkbenchError(abort), false);
  assert.deepEqual(normalized.actions, ['continue']);
  assert.equal(presentation.failure, false);
  assert.equal(presentation.title, '操作已取消');
});

test('uses safe validation copy instead of leaking user input from error.message', async () => {
  const { normalizeWorkbenchError } = await import(modulePath);
  const normalized = normalizeWorkbenchError({
    status: 400,
    error: {
      code: 'invalid_command',
      message: 'prompt must not include raw customer brief: 把竞品 Logo 换成我的产品; apiKey=secret-value'
    }
  });

  assert.equal(normalized.category, 'validation');
  assert.equal(normalized.message.includes('raw customer brief'), false);
  assert.equal(normalized.message.includes('竞品 Logo'), false);
  assert.equal(JSON.stringify(normalized).includes('secret-value'), false);
  assert.equal(normalized.safeToRetry, false);
});
