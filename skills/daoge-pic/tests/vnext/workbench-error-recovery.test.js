const test = require('node:test');
const assert = require('node:assert/strict');
const { readFrontendSource, readSource } = require('./source-text');

function blockBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return source.slice(startIndex, endIndex);
}

test('Workbench reads abort superseded requests before committing state', () => {
  const source = readFrontendSource();
  // 「当前会话」面板（会话计划摘要）在 2026-09-20 移除：它读的是 Workbench 自己那个
  // 浏览器会话的 `plan-status`，而工作指针现在只属于 Agent 会话，读出来永远是 null。
  // 会话侧已无读取，剩下的读取仍必须遵守「被顶替的请求先 abort 再提交状态」。
  const provenance = blockBetween(source, 'const inspectAsset = async (assetId) => {', 'const downloadAsset =');

  assert.match(provenance, /\.begin\(String\(/);
  assert.match(provenance, /signal: request\.signal/);
  assert.match(provenance, /!request\.isCurrent\(\)/);
  assert.match(provenance, /isAbortError\(nextError\)/);
  assert.match(provenance, /setAssetProvenance\(data\.provenance \|\| null\)/);
});

test('Workbench async failures use classified safe error state instead of raw thrown values', () => {
  const source = readFrontendSource();
  assert.match(readSource('web/src/error-model.mjs'), /function normalizeRequestError\(value, fallback/);
  assert.match(source, /if \(normalized\.category === 'connection'\) setConnectionError\(normalized\);/);
  assert.match(source, /operation: 'load-lineage-run-items'/);
  assert.doesNotMatch(blockBetween(source, 'const inspectAsset = async (assetId) => {', 'const downloadAsset ='), /setError\(nextError \|\|/);
});

test('API retry callbacks are limited to reads and idempotent mutations', async () => {
  // 批 E（第 9 批）迁移：api 请求口搬去 app/api.js（块边界改为文件尾）。
  const source = readSource('web/src/app/api.js');
  const api = source.slice(source.indexOf('export async function api(path, options = {}) {'));

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
