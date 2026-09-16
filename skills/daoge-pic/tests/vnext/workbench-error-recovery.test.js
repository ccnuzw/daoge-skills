const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { readSource } = require('./source-text');

function blockBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return source.slice(startIndex, endIndex);
}

test('Workbench session and provenance reads abort superseded requests before committing state', () => {
  const source = readSource('web/src/main.jsx');
  const session = blockBetween(source, 'const refreshWorkbenchSession = useCallback(async (sessionId) => {', 'const refreshStudio =');
  const provenance = blockBetween(source, 'const inspectAsset = async (assetId) => {', 'const downloadAsset =');

  for (const block of [session, provenance]) {
    assert.match(block, /\.begin\(String\(/);
    assert.match(block, /signal: request\.signal/);
    assert.match(block, /!request\.isCurrent\(\)/);
    assert.match(block, /isAbortError\(nextError\)/);
  }
  assert.match(session, /if \(nextSession\) \{/);
  assert.match(provenance, /setAssetProvenance\(data\.provenance \|\| null\)/);
});

test('Workbench async failures use classified safe error state instead of raw thrown values', () => {
  const source = readSource('web/src/main.jsx');
  assert.match(readSource('web/src/error-model.mjs'), /function normalizeRequestError\(value, fallback/);
  assert.match(source, /if \(normalized\.category === 'connection'\) setConnectionError\(normalized\);/);
  assert.match(source, /operation: 'load-lineage-run-items'/);
  assert.doesNotMatch(blockBetween(source, 'const refreshWorkbenchSession = useCallback(async (sessionId) => {', 'const refreshStudio ='), /setError\(nextError \|\|/);
  assert.doesNotMatch(blockBetween(source, 'const inspectAsset = async (assetId) => {', 'const downloadAsset ='), /setError\(nextError \|\|/);
});

test('API retry callbacks are limited to reads and idempotent mutations', async () => {
  const source = readSource('web/src/main.jsx');
  const api = blockBetween(source, 'async function api(path, options = {}) {', 'function projectArchiveUrl');

  assert.match(api, /const canReplay = readRequest \|\| Boolean\(options\.idempotencyKey\);/);
  assert.match(api, /const retry = canReplay \? \(typeof options\.retry === 'function' \? options\.retry : \(\) => api\(path, requestOptions\)\) : null;/);
  assert.match(api, /mayHaveCommitted: !readRequest && !options\.idempotencyKey/);
  assert.match(api, /const unsafeReplay = !readRequest && !options\.idempotencyKey;/);

  const { normalizeWorkbenchError } = await import('../../web/src/error-model.mjs');
  const invalidResponse = normalizeWorkbenchError({ code: 'invalid_response' }, { operation: 'load-studio', phase: 'loading' });
  assert.equal(invalidResponse.category, 'connection');
  assert.equal(invalidResponse.safeToRetry, true);

  const unknownCommit = normalizeWorkbenchError({ category: 'connection', code: 'network_error' }, { operation: 'save-change', phase: 'requesting', mayHaveCommitted: true });
  assert.equal(unknownCommit.outcome, 'unknown');
  assert.equal(unknownCommit.safeToRetry, false);
  assert.equal(unknownCommit.actions.includes('retry'), false);
});
