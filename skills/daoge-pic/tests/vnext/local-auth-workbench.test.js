const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const helperPath = path.join(__dirname, '../../web/src/local-auth.mjs');

test('Workbench exchanges fragment capability for an HttpOnly server session and removes the fragment', async () => {
  const { bootstrapLocalStudioSession } = await import(helperPath);
  const calls = [];
  const replacements = [];
  const location = { hash: '#capability=secret-capability', pathname: '/workbench', search: '?view=assets' };
  const history = { state: { route: 'assets' }, replaceState: (...args) => replacements.push(args) };
  const bootstrapped = await bootstrapLocalStudioSession({
    location,
    history,
    fetchImpl: async (...args) => {
      calls.push(args);
      return { ok: true, json: async () => ({ ok: true, data: { authenticated: true } }) };
    }
  });

  assert.equal(bootstrapped, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/auth/bootstrap');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[0][1].body), { capability: 'secret-capability' });
  assert.deepEqual(replacements, [[history.state, '', '/workbench?view=assets']]);
});

test('Workbench with an existing cookie and no fragment does not invoke bootstrap', async () => {
  const { bootstrapLocalStudioSession } = await import(helperPath);
  let calls = 0;
  const result = await bootstrapLocalStudioSession({
    location: { hash: '', pathname: '/', search: '' },
    history: { state: null, replaceState: () => { throw new Error('fragment-free boot must not rewrite history'); } },
    fetchImpl: async () => { calls += 1; throw new Error('fragment-free boot must not fetch bootstrap'); }
  });
  assert.equal(result, false);
  assert.equal(calls, 0);
});

test('Workbench retains the fragment when authorization cannot be completed', async () => {
  const { bootstrapLocalStudioSession } = await import(helperPath);
  const replacements = [];
  const location = { hash: '#capability=secret-capability', pathname: '/workbench', search: '' };
  const history = { state: null, replaceState: (...args) => replacements.push(args) };

  await assert.rejects(() => bootstrapLocalStudioSession({ location, history, fetchImpl: async () => { throw new Error('offline'); } }), /无法连接到本地 Studio/);
  await assert.rejects(() => bootstrapLocalStudioSession({ location, history, fetchImpl: async () => ({ ok: false, json: async () => ({ ok: false, error: { message: 'secret-capability' } }) }) }), /本地 Studio 授权失败/);

  assert.deepEqual(replacements, []);
});

test('Workbench mounts App only after authorization and exposes a retryable failure page', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../web/src/main.jsx'), 'utf8');
  const auth = fs.readFileSync(helperPath, 'utf8');
  assert.match(main, /if \(authorized\) return <App \/>;/);
  assert.match(main, /className="local-auth-failure"/);
  assert.match(main, /重试授权/);
  assert.match(main, /<LocalStudioAuthorizationGate \/>/);
  assert.doesNotMatch(main, /bootstrapLocalStudioSession\(\)\.then\(renderWorkbench, renderWorkbench\)/);
  assert.doesNotMatch(auth, /console\./);
});
