const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const test = require('node:test');

const modulePath = require.resolve('../../dist/vnext/studio/provider-secrets');

test('macOS Keychain provider secrets are passed through stdin, never argv', () => {
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
    assert.equal(calls[0].command, 'security');
    assert.equal(calls[0].args.at(-1), '-w');
    assert.equal(calls[0].args.includes('fixture-provider-secret'), false);
    assert.equal(calls[0].options.input, 'fixture-provider-secret\n');
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
