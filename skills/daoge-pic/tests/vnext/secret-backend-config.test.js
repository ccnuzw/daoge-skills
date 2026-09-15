const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { studioPaths } = require('../../dist/vnext/studio/workspace');
const { readWorkspaceSecretBackend, writeWorkspaceSecretBackend, daemonEnvWithSecretBackend, SECRET_BACKEND_ENV } = require('../../dist/vnext/studio/secret-backend-config');

function tempPaths() {
  return studioPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-secret-backend-')));
}

test('没有工作区配置时保持默认，不注入任何变量', () => {
  const paths = tempPaths();
  // 这条是整个改动的底线：默认值必须是 system 且 fail-closed。
  // 加这个开关是为了让「显式选择」可持久化，不是为了让明文变成默认。
  assert.equal(readWorkspaceSecretBackend(paths), null);
  assert.equal(SECRET_BACKEND_ENV in daemonEnvWithSecretBackend(paths, {}), false);
});

test('写入工作区配置后，官方入口启动的 daemon 会带上这个变量', () => {
  const paths = tempPaths();
  writeWorkspaceSecretBackend(paths, 'plaintext');
  assert.equal(readWorkspaceSecretBackend(paths), 'plaintext');
  assert.equal(daemonEnvWithSecretBackend(paths, {})[SECRET_BACKEND_ENV], 'plaintext');

  writeWorkspaceSecretBackend(paths, 'system');
  assert.equal(readWorkspaceSecretBackend(paths), 'system');
  assert.equal(daemonEnvWithSecretBackend(paths, {})[SECRET_BACKEND_ENV], 'system');
});

test('命令行上已显式给出的变量优先，不被落盘配置覆盖', () => {
  const paths = tempPaths();
  writeWorkspaceSecretBackend(paths, 'system');
  const env = daemonEnvWithSecretBackend(paths, { [SECRET_BACKEND_ENV]: 'plaintext' });
  assert.equal(env[SECRET_BACKEND_ENV], 'plaintext');
});

test('配置文件损坏时退回默认，不猜', () => {
  const paths = tempPaths();
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(paths.runtimeDir, 'secret-backend.json'), '{ 不是 json');
  assert.equal(readWorkspaceSecretBackend(paths), null);
  assert.equal(SECRET_BACKEND_ENV in daemonEnvWithSecretBackend(paths, {}), false);
});

test('配置文件只接受两种取值，写坏的东西读不出来', () => {
  const paths = tempPaths();
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(paths.runtimeDir, 'secret-backend.json'), JSON.stringify({ backend: 'totally-invalid' }));
  assert.equal(readWorkspaceSecretBackend(paths), null);
});

test('CLI 命令表里有 provider-secret-backend，且参数校验只收两种取值', () => {
  const { commandSchemas, commandHelp, parseCommand } = require('../../dist/vnext/cli/daoge');
  assert.ok(commandSchemas['provider-secret-backend'], '缺少 provider-secret-backend 命令');
  assert.ok(commandSchemas['provider-secret-backend'].summary, '该命令必须有 summary，否则 --help 里是一行空壳');
  assert.match(commandHelp('provider-secret-backend'), /--backend/);

  const ok = parseCommand(['provider-secret-backend', '--workspace', '/tmp/x', '--backend', 'plaintext']);
  assert.equal(ok.secretBackend, 'plaintext');
  assert.throws(() => parseCommand(['provider-secret-backend', '--workspace', '/tmp/x', '--backend', 'nope']), /只能是 plaintext 或 system/);
});
