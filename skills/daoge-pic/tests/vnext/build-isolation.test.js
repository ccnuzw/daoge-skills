const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const skillRoot = path.resolve(__dirname, '../..');
const runTests = path.join(skillRoot, 'scripts', 'run-tests.js');
const buildLock = path.join(skillRoot, 'scripts', 'build-lock.js');

function waitForFile(filePath, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (fs.existsSync(filePath)) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error('Timed out waiting for fixture test to start.'));
      setTimeout(poll, 20);
    };
    poll();
  });
}

function collect(child) {
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test('run-tests holds the dist lock until its test process exits', async () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-test-lock-'));
  const lockPath = path.join(fixtureRoot, 'dist.lock');
  const startedPath = path.join(fixtureRoot, 'started');
  const releasePath = path.join(fixtureRoot, 'release');
  const fixturePath = path.join(fixtureRoot, 'fixture.test.js');
  fs.writeFileSync(fixturePath, [
    "const test = require('node:test');",
    "const fs = require('node:fs');",
    'fs.writeFileSync(' + JSON.stringify(startedPath) + ", 'started');",
    "test('fixture remains active', async () => {",
    '  while (!fs.existsSync(' + JSON.stringify(releasePath) + ')) await new Promise((resolve) => setTimeout(resolve, 20));',
    '});'
  ].join('\n'));

  const environment = { ...process.env, DAOGE_PIC_DIST_LOCK_PATH: lockPath };
  // A nested node --test invocation must not inherit the outer runner's
  // private child marker or Node treats it as another protocol child.
  delete environment.NODE_TEST_CONTEXT;
  const runner = spawn(process.execPath, [runTests, fixturePath], { cwd: skillRoot, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  const runnerResult = collect(runner);
  try {
    await waitForFile(startedPath);
    const contenderProgram = [
      'const { acquireLock } = require(process.argv[1]);',
      "acquireLock(process.argv[2], { timeoutMs: 150, pollMs: 20, label: 'regression-contender' })",
      "  .then(() => { process.stderr.write('unexpected acquisition'); process.exitCode = 2; },",
      "    (error) => { if (!/Timed out waiting/.test(error.message)) throw error; });"
    ].join('\n');
    const contender = spawn(process.execPath, ['-e', contenderProgram, buildLock, lockPath], { cwd: skillRoot, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    const blocked = await collect(contender);
    assert.equal(blocked.code, 0, blocked.stderr);
    assert.equal(fs.existsSync(lockPath), true, 'the runner still owns the lock while its test is active');
  } finally {
    fs.writeFileSync(releasePath, 'release');
  }
  const completed = await runnerResult;
  assert.equal(completed.code, 0, completed.stderr || completed.stdout);
  assert.equal(fs.existsSync(lockPath), false, 'the runner releases the lock after its child exits');
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});
