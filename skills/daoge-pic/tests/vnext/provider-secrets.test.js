const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const test = require('node:test');

const modulePath = require.resolve('../../dist/vnext/studio/provider-secrets');

function hasSecretTool() {
  const result = childProcess.spawnSync('secret-tool', ['--version'], { stdio: 'ignore', timeout: 5_000 });
  return !result.error;
}

test('macOS Keychain provider secrets use stdin and never appear in argv', () => {
  const original = childProcess.execFileSync;
  const calls = [];
  childProcess.execFileSync = (command, args, options) => {
    calls.push({ command, args, options });
    return Buffer.from('');
  };
  try {
    delete require.cache[modulePath];
    const { createProviderSecretStore } = require(modulePath);
    const store = createProviderSecretStore({ workspaceRoot: '/tmp/daoge-secret-test' }, 'macos-keychain');
    store.store('profile:api_key', 'fixture-provider-secret');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, '/usr/bin/script');
    assert.equal(calls[0].args.at(-1), '-w');
    assert.equal(calls[0].args.includes('fixture-provider-secret'), false);
    assert.equal(calls[0].args.includes('/usr/bin/security'), true);
    assert.equal([calls[0].command, ...calls[0].args].some((argument) => String(argument).includes('fixture-provider-secret')), false);
    assert.equal(calls[0].options.input, 'fixture-provider-secret\nfixture-provider-secret\n');
    assert.deepEqual(calls[0].options.stdio, ['pipe', 'ignore', 'ignore']);
    assert.ok(calls[0].options.timeout > 0, 'every OS secret-store call must be bounded');
  } finally {
    childProcess.execFileSync = original;
    delete require.cache[modulePath];
  }
});

test('macOS Keychain provider writes fail closed without putting secrets in errors or argv', () => {
  const original = childProcess.execFileSync;
  const calls = [];
  childProcess.execFileSync = (command, args) => {
    calls.push({ command, args });
    throw new Error('keychain helper failed');
  };
  try {
    delete require.cache[modulePath];
    const { createProviderSecretStore } = require(modulePath);
    const store = createProviderSecretStore({ workspaceRoot: '/tmp/daoge-secret-failure-test' }, 'macos-keychain');
    assert.throws(() => store.store('profile:api_key', 'fixture-provider-secret'), /keychain helper failed/);
    assert.equal(calls.length, 1);
    assert.equal([calls[0].command, ...calls[0].args].some((argument) => String(argument).includes('fixture-provider-secret')), false);
  } finally {
    childProcess.execFileSync = original;
    delete require.cache[modulePath];
  }
});

test('an explicitly requested system backend fails closed without Studio paths', () => {
  const previous = process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND;
  process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND = 'system';
  try {
    delete require.cache[modulePath];
    const { createProviderSecretStore } = require(modulePath);
    assert.throws(() => createProviderSecretStore(), /requires Studio paths/);
  } finally {
    if (previous === undefined) delete process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND;
    else process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND = previous;
    delete require.cache[modulePath];
  }
});

test('the default backend prefers the OS secret store instead of plaintext', { skip: process.platform === 'linux' && !hasSecretTool() }, () => {
  const previous = process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND;
  delete process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND;
  try {
    delete require.cache[modulePath];
    const { createProviderSecretStore } = require(modulePath);
    const store = createProviderSecretStore({ workspaceRoot: '/tmp/daoge-secret-default', studioDir: '/tmp/daoge-secret-default/daoge-studio' });
    assert.notEqual(store.backend, 'sqlite-plaintext', 'the default must no longer be plaintext');
  } finally {
    if (previous === undefined) delete process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND;
    else process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND = previous;
    delete require.cache[modulePath];
  }
});

test('the default backend fails closed instead of silently degrading to plaintext', () => {
  const previous = process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND;
  try {
    delete process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND;
    delete require.cache[modulePath];
    const { createProviderSecretStore, providerSecretBackendPolicy } = require(modulePath);
    assert.equal(providerSecretBackendPolicy(), 'system');
    assert.throws(() => createProviderSecretStore(), /requires Studio paths/);
  } finally {
    if (previous === undefined) delete process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND;
    else process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND = previous;
    delete require.cache[modulePath];
  }
});

test('DAOGE_PIC_PROVIDER_SECRET_BACKEND=plaintext still opts into plaintext explicitly', () => {
  const previous = process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND;
  process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND = 'plaintext';
  try {
    delete require.cache[modulePath];
    const { createProviderSecretStore } = require(modulePath);
    assert.equal(createProviderSecretStore({ workspaceRoot: '/tmp/daoge-secret-plain' }).backend, 'sqlite-plaintext');
  } finally {
    if (previous === undefined) delete process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND;
    else process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND = previous;
    delete require.cache[modulePath];
  }
});

test('Linux libsecret clear fails closed except for an explicit not-found result', () => {
  const original = childProcess.spawnSync;
  const calls = [];
  const results = [
    { error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }), status: null, signal: null, stderr: '' },
    { error: undefined, status: null, signal: 'SIGTERM', stderr: '' },
    { error: undefined, status: 2, signal: null, stderr: 'backend unavailable' },
    { error: undefined, status: 1, signal: null, stderr: 'backend unavailable' },
    { error: undefined, status: 1, signal: null, stderr: 'No matching item found while backend unavailable' },
    { error: undefined, status: null, signal: null, stderr: '' },
    { error: undefined, status: 1, signal: null, stderr: 'secret-tool: No matching item found' },
    { error: undefined, status: 0, signal: null, stderr: '' }
  ];
  childProcess.spawnSync = (command, args, options) => {
    calls.push({ command, args, options });
    return results.shift();
  };
  try {
    delete require.cache[modulePath];
    const { createProviderSecretStore } = require(modulePath);
    const store = createProviderSecretStore({ workspaceRoot: '/tmp/daoge-linux-secret-test' }, 'linux-libsecret');
    assert.throws(() => store.delete('profile:api_key'), /delete failed/);
    assert.throws(() => store.delete('profile:api_key'), /delete failed/);
    assert.throws(() => store.delete('profile:api_key'), /delete failed/);
    assert.throws(() => store.delete('profile:api_key'), /delete failed/);
    assert.throws(() => store.delete('profile:api_key'), /delete failed/);
    assert.throws(() => store.delete('profile:api_key'), /delete failed/);
    assert.doesNotThrow(() => store.delete('profile:api_key'), 'an exact not-found diagnostic is idempotent success');
    assert.doesNotThrow(() => store.delete('profile:api_key'));
    assert.equal(calls.length, 8);
    assert.ok(calls.every((call) => call.command === 'secret-tool' && call.args[0] === 'clear'));
    assert.ok(calls.every((call) => call.options.timeout > 0));
    assert.ok(calls.every((call) => call.options.stdio[2] === 'pipe'), 'stderr must be captured to distinguish not-found');
  } finally {
    childProcess.spawnSync = original;
    delete require.cache[modulePath];
  }
});
