const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const test = require('node:test');
const assert = require('node:assert/strict');

const { openWorkbenchUrl } = require('../../dist/vnext/cli/open-workbench');
const { signalVerifiedDaemon } = require('../../dist/vnext/cli/legacy-daemon');
const { main, parseCommand, materializeStdinJson } = require('../../dist/vnext/cli/daoge');
const { matchesDaemonProcess } = require('../../dist/vnext/cli/process-identity');

const skillRoot = path.resolve(__dirname, '../..');

test('CLI launcher and direct dist entry expose the same help contract', () => {
  const launcher = spawnSync(process.execPath, [path.join(skillRoot, 'scripts', 'daoge.js'), '--help'], { encoding: 'utf8' });
  const direct = spawnSync(process.execPath, [path.join(skillRoot, 'dist', 'vnext', 'cli', 'daoge.js'), '--help'], { encoding: 'utf8' });
  assert.equal(launcher.status, 0, launcher.stderr);
  assert.equal(direct.status, 0, direct.stderr);
  assert.equal(launcher.stdout, direct.stdout);
  for (const command of ['archive-project', 'provider-list', 'provider-create', 'provider-update', 'restart', 'preflight', 'run', 'pause', 'resume', 'cancel', 'retry', 'resolve-unknown']) {
    assert.equal(launcher.stdout.includes('daoge ' + command + ' '), true);
  }
  assert.equal((launcher.stdout.match(/daoge preflight/g) || []).length, 1);
  assert.match(launcher.stdout, /daoge preflight .*--concurrency <1..1000>/);
  assert.doesNotMatch(launcher.stdout, /worker-concurrency|daoge config/);
  assert.doesNotMatch(launcher.stdout, /daoge run .*--concurrency/);
  assert.doesNotMatch(launcher.stdout, /--api-key <|--api-key> <|--api-key \u003ckey\u003e/);
  assert.match(launcher.stdout, /--api-key-stdin @-/);
});

test('CLI module exports main without executing it during import', () => {
  assert.equal(typeof main, 'function');
  const modulePath = path.join(skillRoot, 'dist', 'vnext', 'cli', 'daoge.js');
  const imported = spawnSync(process.execPath, ['-e', `const cli = require(${JSON.stringify(modulePath)}); process.stdout.write(typeof cli.main + ':' + typeof cli.parseCommand);`], { encoding: 'utf8' });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, 'function:function');
  assert.equal(imported.stderr, '');
});

test('CLI command schemas reject unknown flags and malformed values before workspace side effects', () => {
  const workspaceRoot = path.join(os.tmpdir(), 'daoge-cli-invalid-' + process.pid + '-' + Date.now());
  const cli = path.join(skillRoot, 'scripts', 'daoge.js');
  try {
    for (const args of [
      ['unknown', '--workspace', workspaceRoot],
      ['project', '--workspace', workspaceRoot],
      ['plan', '--workspace', workspaceRoot, '--round', 'round-1', '--version', 'nope', '--plan', '{}'],
      ['task', '--workspace', workspaceRoot, '--project', 'project-1', '--name', 'task', '--intent', '[]'],
      ['status', '--workspace', workspaceRoot, '--unexpected', 'value']
    ]) {
      const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.equal(fs.existsSync(workspaceRoot), false, result.stderr);
    }
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('CLI parser preserves an explicit safe idempotency key for every mutation', () => {
  const key = 'recovery.run:attempt-01';
  const parsed = parseCommand(['run', '--workspace', '/tmp/daoge-cli-key', '--round', 'round-1', '--preflight', 'preview-1', '--confirm-token', 'dgpct1.claim.signature', '--idempotency-key', key]);
  assert.equal(parsed.request.idempotencyKey, key);
  assert.equal(parsed.request.body.confirmToken, 'dgpct1.claim.signature');
  assert.throws(() => parseCommand(['run', '--workspace', '/tmp/daoge-cli-key', '--round', 'round-1', '--preflight', 'preview-1', '--idempotency-key', key]), /需要 --confirm-token/);
  assert.throws(() => parseCommand(['run', '--workspace', '/tmp/daoge-cli-key', '--round', 'round-1', '--preflight', 'preview-1', '--confirm-token', 'dgpct1.claim.signature', '--idempotency-key', 'unsafe key']), /安全字符/);
  assert.throws(() => parseCommand(['status', '--workspace', '/tmp/daoge-cli-key', '--idempotency-key', key]), /未知或不适用/);
  assert.equal(parseCommand(['open', '--workspace', '/tmp/daoge-cli-key']).force, false);
  assert.equal(parseCommand(['open', '--workspace', '/tmp/daoge-cli-key', '--force', 'true']).force, true);
  assert.throws(() => parseCommand(['open', '--workspace', '/tmp/daoge-cli-key', '--force', 'yes']), /只能是 true 或 false/);
});

test('CLI accepts one stdin JSON marker and rejects multiple markers', () => {
  const plan = parseCommand(['plan', '--workspace', '/tmp/daoge-stdin', '--round', 'round-1', '--version', '2', '--plan', '@-', '--operation-name', 'plan:round-1:v2']);
  assert.equal(plan.request.operationName, 'plan:round-1:v2');
  assert.equal(plan.request.idempotencyKey, undefined);
  assert.equal(plan.request.body.plan.__daogeJsonStdin, true);
  assert.throws(() => parseCommand(['plan', '--workspace', '/tmp/daoge-stdin', '--round', 'round-1', '--version', '2', '--plan', '@-', '--operation-name', 'unsafe operation']), /安全字符/);
  const marker = plan.request.body.plan;
  assert.throws(() => materializeStdinJson({ intent: marker, plan: marker }), /最多只能使用一个/);
});

test('CLI never accepts provider secrets as argv values and only permits secret stdin replacement', () => {
  assert.throws(() => parseCommand(['provider-create', '--workspace', '/tmp/daoge-provider-secret', '--name', 'Provider', '--provider', 'openai-images', '--model', 'gpt-image-2', '--base-url', 'https://images.example.test', '--api-key', 'secret']), /未知或不适用于/);
  const create = parseCommand(['provider-create', '--workspace', '/tmp/daoge-provider-secret', '--name', 'Provider', '--provider', 'openai-images', '--model', 'gpt-image-2', '--base-url', 'https://images.example.test', '--api-key-stdin', '@-']);
  assert.equal(create.request.body.apiKey.__daogeSecretStdin, true);
  assert.throws(() => parseCommand(['provider-update', '--workspace', '/tmp/daoge-provider-secret', '--profile', 'profile-1', '--version', '1', '--base-url-action', 'keep', '--api-key-action', 'replace']), /--api-key-stdin/);
  assert.throws(() => parseCommand(['provider-update', '--workspace', '/tmp/daoge-provider-secret', '--profile', 'profile-1', '--version', '1', '--base-url-action', 'keep', '--api-key-action', 'keep', '--api-key-stdin', '@-']), /只能与/);
});

test('CLI refuses a mismatched manifest before creating daemon runtime state', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-cli-manifest-'));
  const studioDir = path.join(workspaceRoot, 'daoge-studio');
  fs.mkdirSync(studioDir);
  fs.writeFileSync(path.join(studioDir, 'studio.json'), JSON.stringify({ schemaVersion: 1, studioId: 'studio-mismatch', workspaceRoot: workspaceRoot + '-other', createdAt: new Date().toISOString() }));
  try {
    const result = spawnSync(process.execPath, [path.join(skillRoot, 'scripts', 'daoge.js'), 'status', '--workspace', workspaceRoot], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /workspaceRoot/);
    assert.equal(fs.existsSync(path.join(studioDir, 'runtime')), false);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Workbench opener uses platform-native commands and waits for spawn confirmation', async () => {
  const cases = [
    ['darwin', 'open', ['http://127.0.0.1:4321/#capability=secret']],
    ['linux', 'xdg-open', ['http://127.0.0.1:4321/#capability=secret']],
    ['win32', 'rundll32.exe', ['url.dll,FileProtocolHandler', 'http://127.0.0.1:4321/#capability=secret']]
  ];
  for (const [platform, expectedCommand, expectedArgs] of cases) {
    const calls = [];
    let unrefCalled = false;
    const child = new EventEmitter();
    child.unref = () => { unrefCalled = true; };
    const opening = openWorkbenchUrl(expectedArgs.at(-1), {
      platform,
      spawn: (command, args) => { calls.push({ command, args }); queueMicrotask(() => child.emit('spawn')); return child; }
    });
    assert.equal(unrefCalled, false);
    await opening;
    assert.equal(unrefCalled, true);
    assert.deepEqual(calls, [{ command: expectedCommand, args: expectedArgs }]);
  }
});

test('Workbench opener reports platform launch failures', async () => {
  const child = new EventEmitter();
  child.unref = () => {};
  const opening = openWorkbenchUrl('http://127.0.0.1:4321/#capability=secret', {
    platform: 'linux',
    spawn: () => { queueMicrotask(() => child.emit('error', new Error('missing opener'))); return child; }
  });
  await assert.rejects(opening, /无法启动系统浏览器/);
});

function healthResponse(studioId) {
  return new Response(JSON.stringify({
    ok: true,
    data: { service: 'daoge-pic-vnext', studioId }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('legacy daemon signals only when runtime, lock, manifest, health, entry, and workspace identities all match', async () => {
  const manifest = { studioId: 'studio-manifest', workspaceRoot: '/tmp/daoge legacy workspace' };
  const runtime = { pid: 4242, url: 'http://127.0.0.1:43123/', workspaceRoot: manifest.workspaceRoot };
  const daemonEntry = '/opt/daoge/dist/vnext/daemon/daemon-entry.js';
  const healthRequests = [];
  const processQueries = [];
  const signals = [];

  await signalVerifiedDaemon(runtime, {
    workspaceRoot: manifest.workspaceRoot,
    studioId: manifest.studioId,
    lockPid: runtime.pid,
    daemonEntry
  }, {
    fetch: async (input) => {
      healthRequests.push(String(input));
      return healthResponse(manifest.studioId);
    },
    queryProcessArguments: (pid) => {
      processQueries.push(pid);
      return [process.execPath, daemonEntry, '--workspace', manifest.workspaceRoot];
    },
    signal: (pid, signal) => signals.push({ pid, signal })
  });

  assert.deepEqual(healthRequests, ['http://127.0.0.1:43123/api/health']);
  assert.deepEqual(processQueries, [runtime.pid]);
  assert.deepEqual(signals, [{ pid: runtime.pid, signal: 'SIGTERM' }]);
});

test('daemon process identity accepts a registered Skill symlink to the same entry', () => {
  if (process.platform === 'win32') return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-daemon-link-'));
  try {
    const source = path.join(root, 'source');
    const registered = path.join(root, 'registered');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'daemon.js'), '');
    fs.symlinkSync(source, registered, 'dir');
    assert.equal(matchesDaemonProcess([process.execPath, path.join(registered, 'daemon.js'), '--workspace', root], path.join(source, 'daemon.js'), root), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const legacyIdentityFixture = {
  manifest: { studioId: 'studio-manifest', workspaceRoot: '/tmp/daoge legacy workspace' },
  runtime: { pid: 4242, url: 'http://127.0.0.1:43123/', workspaceRoot: '/tmp/daoge legacy workspace' },
  daemonEntry: '/opt/daoge/dist/vnext/daemon/daemon-entry.js'
};

for (const identityCase of [
  {
    name: 'runtime and lock PID mismatch',
    runtime: { ...legacyIdentityFixture.runtime, pid: 4243 },
    error: /runtime 与 owner record PID 不匹配/
  },
  {
    name: 'runtime and manifest workspace mismatch',
    runtime: { ...legacyIdentityFixture.runtime, workspaceRoot: '/tmp/another-workspace' },
    error: /runtime 工作区不匹配/
  },
  {
    name: 'health and manifest Studio identity mismatch',
    healthStudioId: 'different-studio',
    error: /健康端点未确认当前 Studio 身份/
  },
  {
    name: 'PID reuse with a different daemon entry command',
    arguments: [process.execPath, '/opt/other/daemon-entry.js', '--workspace', legacyIdentityFixture.manifest.workspaceRoot],
    error: /PID 对应进程不是当前工作区 daemon/
  },
  {
    name: 'daemon command workspace mismatch',
    arguments: [process.execPath, legacyIdentityFixture.daemonEntry, '--workspace', '/tmp/another-workspace'],
    error: /PID 对应进程不是当前工作区 daemon/
  },
  {
    name: 'process identity query unavailable',
    arguments: null,
    error: /无法可靠查询 daemon 进程身份/
  }
]) {
  test('legacy daemon refuses to signal when ' + identityCase.name, async () => {
    const signals = [];
    const runtime = identityCase.runtime || legacyIdentityFixture.runtime;
    const arguments_ = Object.prototype.hasOwnProperty.call(identityCase, 'arguments')
      ? identityCase.arguments
      : [process.execPath, legacyIdentityFixture.daemonEntry, '--workspace', legacyIdentityFixture.manifest.workspaceRoot];

    await assert.rejects(() => signalVerifiedDaemon(runtime, {
      workspaceRoot: legacyIdentityFixture.manifest.workspaceRoot,
      studioId: legacyIdentityFixture.manifest.studioId,
      lockPid: legacyIdentityFixture.runtime.pid,
      daemonEntry: legacyIdentityFixture.daemonEntry
    }, {
      fetch: async () => healthResponse(identityCase.healthStudioId || legacyIdentityFixture.manifest.studioId),
      queryProcessArguments: () => arguments_,
      signal: (pid, signal) => signals.push({ pid, signal })
    }), identityCase.error);

    assert.deepEqual(signals, []);
  });
}
