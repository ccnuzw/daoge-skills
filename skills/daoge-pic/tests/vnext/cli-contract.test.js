const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const test = require('node:test');
const assert = require('node:assert/strict');

const { openWorkbenchUrl } = require('../../dist/vnext/cli/open-workbench');
const { signalVerifiedDaemon } = require('../../dist/vnext/cli/legacy-daemon');
const { main, parseCommand, materializeStdinJson, assertImplicitStudioCreationAllowed } = require('../../dist/vnext/cli/daoge');
const { matchesDaemonProcess, queryProcessArguments } = require('../../dist/vnext/cli/process-identity');
const { registerSkill } = require('../../dist/vnext/cli/register-skill');
const { doctorWorkspace, inspectWindowsVolume, inspectWorkspaceSupport, redactDoctorReport } = require('../../dist/vnext/cli/doctor');

const skillRoot = path.resolve(__dirname, '../..');

test('CLI launcher and direct dist entry expose the same help contract', () => {
  const launcher = spawnSync(process.execPath, [path.join(skillRoot, 'scripts', 'daoge.js'), '--help'], { encoding: 'utf8' });
  const direct = spawnSync(process.execPath, [path.join(skillRoot, 'dist', 'vnext', 'cli', 'daoge.js'), '--help'], { encoding: 'utf8' });
  assert.equal(launcher.status, 0, launcher.stderr);
  assert.equal(direct.status, 0, direct.stderr);
  assert.equal(launcher.stdout, direct.stdout);
  for (const command of ['register-skill', 'archive-project', 'provider-list', 'provider-create', 'provider-update', 'restart', 'preflight', 'run', 'pause', 'resume', 'cancel', 'retry', 'resolve-unknown']) {
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

test('Skill registration creates fail-if-exists project and user links to the installed package', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-register-'));
  try {
    const projectRoot = path.join(root, 'project');
    const homeRoot = path.join(root, 'home');
    fs.mkdirSync(projectRoot);
    fs.mkdirSync(homeRoot);
    const project = registerSkill({ scope: 'project', workspaceRoot: projectRoot, sourceRoot: skillRoot });
    assert.equal(fs.realpathSync(project.destination), fs.realpathSync(skillRoot));
    assert.throws(() => registerSkill({ scope: 'project', workspaceRoot: projectRoot, sourceRoot: skillRoot }), /already exists/);
    const user = registerSkill({ scope: 'user', homeRoot, sourceRoot: skillRoot });
    assert.equal(fs.realpathSync(user.destination), fs.realpathSync(skillRoot));
    assert.equal(parseCommand(['register-skill', '--scope', 'user']).workspaceRoot, undefined);
    assert.equal(parseCommand(['register-skill', '--scope', 'project', '--workspace', projectRoot]).scope, 'project');
    assert.throws(() => parseCommand(['register-skill', '--scope', 'project']), /需要 --workspace/);
    const hostileProject = path.join(root, 'hostile-project');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(hostileProject);
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(hostileProject, '.agents'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => registerSkill({ scope: 'project', workspaceRoot: hostileProject, sourceRoot: skillRoot }), /parents must be real directories/);
    assert.equal(fs.existsSync(path.join(outside, 'skills', 'daoge-pic')), false);
    assert.throws(() => parseCommand(['register-skill', '--scope', 'machine']), /project 或 user/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('doctor validates runtime primitives without creating the requested Studio or calling a Provider', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-doctor-'));
  const workspaceRoot = path.join(root, 'future-workspace');
  try {
    const report = doctorWorkspace(workspaceRoot);
    const redacted = redactDoctorReport(report);
    assert.equal(report.ok, true, JSON.stringify(report));
    assert.equal(fs.existsSync(workspaceRoot), false);
    for (const code of ['node_runtime', 'workspace_real_path', 'atomic_rename', 'sqlite_locking', 'private_acl', 'sharp_runtime']) {
      assert.equal(report.checks.some((check) => check.code === code && check.status === 'pass'), true, code);
    }
    assert.equal(JSON.stringify(redacted).includes(workspaceRoot), false);
    assert.equal(redacted.workspaceRoot, '[redacted-workspace]');
    assert.equal(parseCommand(['doctor', '--workspace', workspaceRoot, '--json', 'true']).jsonOutput, true);
    assert.equal(parseCommand(['doctor', '--workspace', workspaceRoot, '--json', 'true', '--redacted', 'true']).redactedOutput, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Windows doctor uses bounded module-free volume inspection and rejects managed roots', () => {
  const calls = [];
  const dependencies = {
    platform: 'win32',
    environment: { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', OneDrive: 'C:\\Users\\Example\\OneDrive' },
    powershellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    execFile: (command, args, options) => { calls.push({ command, args, options }); return '3|TlRGUw==|QnJvd3NlckhUTUw='; }
  };
  const volume = inspectWindowsVolume('C:\\Users\\Example\\Source\\图片项目', dependencies);
  assert.deepEqual(volume, { driveType: 3, fileSystem: 'NTFS', browserProgId: 'BrowserHTML' });
  const script = Buffer.from(calls[0].args[4], 'base64').toString('utf16le');
  assert.match(script, /System\.IO\.DriveInfo/);
  assert.match(script, /Microsoft\.Win32\.Registry/);
  assert.doesNotMatch(script, /Get-CimInstance|Get-ItemProperty/);
  assert.equal(script.includes('C:\\Users\\Example\\Source\\图片项目'), false);
  assert.deepEqual(calls[0].options, { timeout: 15000, maxBuffer: 1024 * 1024 });
  const checks = inspectWorkspaceSupport('C:\\Users\\Example\\OneDrive\\project', dependencies);
  assert.equal(checks.some((check) => check.code === 'workspace_managed_root' && check.status === 'fail'), true);
  assert.throws(() => inspectWindowsVolume('\\\\server\\share\\project', dependencies), /UNC/);
});

test('doctor rejects an existing symlink or Windows junction workspace root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-doctor-link-'));
  const real = path.join(root, 'real');
  const linked = path.join(root, 'linked');
  try {
    fs.mkdirSync(real);
    fs.symlinkSync(real, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const checks = inspectWorkspaceSupport(linked);
    assert.equal(checks.some((check) => check.code === 'workspace_real_path' && check.status === 'fail'), true);
  } finally {
    try { fs.unlinkSync(linked); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Windows native WMI and long Unicode workspace diagnostics execute on the real OS', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-Windows-图片 空格-'));
  const workspaceRoot = path.join(root, '长'.repeat(Math.max(1, 205 - root.length - 1)));
  try {
    fs.mkdirSync(workspaceRoot, { recursive: true });
    const arguments_ = queryProcessArguments(process.pid);
    assert.ok(Array.isArray(arguments_) && arguments_.length > 0);
    const report = doctorWorkspace(workspaceRoot);
    assert.equal(report.ok, true, JSON.stringify(report));
    assert.equal(report.checks.some((check) => check.code === 'workspace_path_length' && check.status === 'warning'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI rejects Node versions that cannot load node:sqlite without a flag', () => {
  const modulePath = path.join(skillRoot, 'dist', 'vnext', 'cli', 'daoge.js');
  const script = `Object.defineProperty(process.versions, 'node', { value: '22.12.0' }); process.argv = ['node', 'daoge', '--help']; const { main } = require(${JSON.stringify(modulePath)}); void main().catch((error) => { process.stderr.write(error.message); process.exitCode = 1; });`;
  const rejected = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Node\.js 22\.13\.0/);
  assert.equal(rejected.stdout, '');
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

test('CLI refuses implicit nested Studio creation and requires explicit open opt-in', () => {
  const parentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-cli-parent-studio-'));
  const childRoot = path.join(parentRoot, 'nested', 'repo');
  const studioDir = path.join(parentRoot, 'daoge-studio');
  fs.mkdirSync(studioDir, { recursive: true });
  fs.mkdirSync(childRoot, { recursive: true });
  fs.writeFileSync(path.join(studioDir, 'studio.json'), JSON.stringify({ schemaVersion: 1, studioId: 'studio-parent', workspaceRoot: parentRoot, createdAt: new Date().toISOString() }));
  try {
    assert.throws(() => assertImplicitStudioCreationAllowed(childRoot), /检测到父级 DAOGE Pic Studio/);
    assert.doesNotThrow(() => assertImplicitStudioCreationAllowed(childRoot, true));
    assert.equal(fs.existsSync(path.join(childRoot, 'daoge-studio')), false);
    assert.equal(parseCommand(['open', '--workspace', childRoot]).allowNestedStudio, false);
    assert.equal(parseCommand(['open', '--workspace', childRoot, '--allow-nested-studio', 'true']).allowNestedStudio, true);
    assert.throws(() => parseCommand(['studio', '--workspace', childRoot, '--allow-nested-studio', 'true']), /未知或不适用/);
  } finally {
    fs.rmSync(parentRoot, { recursive: true, force: true });
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
      launchGraceMs: 1,
      spawn: (command, args) => { calls.push({ command, args }); queueMicrotask(() => child.emit('spawn')); return child; }
    });
    assert.equal(unrefCalled, false);
    await opening;
    assert.equal(unrefCalled, true);
    assert.deepEqual(calls, [{ command: expectedCommand, args: expectedArgs }]);
  }
});

test('Windows Workbench opener falls back to explorer when rundll32 cannot start', async () => {
  const calls = [];
  const children = [new EventEmitter(), new EventEmitter()];
  for (const child of children) child.unref = () => {};
  const opening = openWorkbenchUrl('http://127.0.0.1:4321/#capability=secret', {
    platform: 'win32',
    launchGraceMs: 1,
    spawn: (command, args) => {
      const child = children[calls.length];
      calls.push({ command, args });
      queueMicrotask(() => child.emit(calls.length === 1 ? 'error' : 'spawn', new Error('blocked opener')));
      return child;
    }
  });
  await opening;
  assert.deepEqual(calls, [
    { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', 'http://127.0.0.1:4321/#capability=secret'] },
    { command: 'explorer.exe', args: ['http://127.0.0.1:4321/#capability=secret'] }
  ]);
});

test('Windows Workbench opener falls back when rundll32 starts and immediately exits nonzero', async () => {
  const calls = [];
  await openWorkbenchUrl('http://127.0.0.1:4321/#capability=secret', {
    platform: 'win32',
    launchGraceMs: 10,
    spawn: (command, args) => {
      const child = new EventEmitter();
      child.unref = () => {};
      calls.push({ command, args });
      queueMicrotask(() => {
        child.emit('spawn');
        if (command === 'rundll32.exe') child.emit('exit', 1, null);
      });
      return child;
    }
  });
  assert.deepEqual(calls.map((call) => call.command), ['rundll32.exe', 'explorer.exe']);
});

test('Workbench opener reports platform launch failures', async () => {
  const child = new EventEmitter();
  child.unref = () => {};
  const opening = openWorkbenchUrl('http://127.0.0.1:4321/#capability=secret', {
    platform: 'linux',
    launchGraceMs: 1,
    spawn: () => { queueMicrotask(() => child.emit('error', new Error('missing opener'))); return child; }
  });
  await assert.rejects(opening, /无法启动系统浏览器/);
});

test('Windows process identity uses bounded module-free WMI instead of optional WMIC', () => {
  const calls = [];
  const commandLine = '"C:\\Program Files\\nodejs\\node.exe" "C:\\skill path\\daemon.js" --workspace "C:\\workspace with spaces"';
  const arguments_ = queryProcessArguments(4242, {
    platform: 'win32',
    powershellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    execFile: (command, args, options) => { calls.push({ command, args, options }); return Buffer.from(commandLine, 'utf8').toString('base64') + '\r\n'; }
  });
  assert.deepEqual(arguments_, ['C:\\Program Files\\nodejs\\node.exe', 'C:\\skill path\\daemon.js', '--workspace', 'C:\\workspace with spaces']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(calls[0].args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
  const script = Buffer.from(calls[0].args[4], 'base64').toString('utf16le');
  assert.match(script, /ManagementObjectSearcher/);
  assert.match(script, /Options\.Timeout = \[TimeSpan\]::FromSeconds\(3\)/);
  assert.deepEqual(calls[0].options, { timeout: 10000, maxBuffer: 1024 * 1024 });
  assert.match(script, /ProcessId = 4242/);
  assert.doesNotMatch(script, /Get-CimInstance|wmic/i);
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
