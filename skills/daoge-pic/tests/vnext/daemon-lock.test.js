const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { acquireDaemonLock } = require('../../dist/vnext/runtime/daemon-lock');

const skillRoot = path.resolve(__dirname, '../..');
const lockModule = path.join(skillRoot, 'dist', 'vnext', 'runtime', 'daemon-lock.js');

function lockFixture() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-daemon-lock-'));
  const runtimeDir = path.join(workspaceRoot, 'daoge-studio', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(runtimeDir, 0o700);
  return {
    workspaceRoot,
    runtimeDir,
    paths: {
      databasePath: path.join(runtimeDir, 'daemon-lock.sqlite'),
      ownerRecordPath: path.join(runtimeDir, 'daemon.lock')
    }
  };
}

function waitForChildLine(child, expected) {
  return new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for child lock acquisition: ' + errors)), 5000);
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
      if (!output.includes(expected)) return;
      clearTimeout(timeout);
      resolve();
    });
    child.stderr.on('data', (chunk) => { errors += String(chunk); });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => {
      if (output.includes(expected)) return;
      clearTimeout(timeout);
      reject(new Error('Child exited before lock acquisition with code ' + code + ': ' + errors));
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('error', reject);
    child.once('exit', resolve);
  });
}

test('lock setup uses the fixed PRAGMAs and maps extended SQLITE_BUSY to already running', () => {
  const fixture = lockFixture();
  const statements = [];
  let closed = false;
  class BusyDatabase {
    constructor(databasePath) { fs.writeFileSync(databasePath, ''); }
    exec(sql) {
      statements.push(sql);
      if (sql === 'BEGIN EXCLUSIVE') throw Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR', errcode: 773, errstr: 'database is locked' });
    }
    prepare(sql) {
      statements.push(sql);
      return { get: () => ({ journal_mode: 'delete' }) };
    }
    close() { closed = true; }
  }
  try {
    assert.throws(() => acquireDaemonLock(fixture.paths, { databaseConstructor: BusyDatabase }), /already running/);
    assert.deepEqual(statements, [
      'PRAGMA busy_timeout = 100;',
      'PRAGMA journal_mode = DELETE',
      'PRAGMA synchronous = FULL;',
      'BEGIN EXCLUSIVE'
    ]);
    assert.equal(closed, true);
    assert.equal(fs.existsSync(fixture.paths.ownerRecordPath), false);
  } finally {
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});

test('two SQLite connections in one process are mutually exclusive and release removes only the exact owner record', () => {
  const fixture = lockFixture();
  let first = null;
  let second = null;
  try {
    first = acquireDaemonLock(fixture.paths);
    const firstRecord = JSON.parse(fs.readFileSync(fixture.paths.ownerRecordPath, 'utf8'));
    assert.equal(firstRecord.pid, process.pid);
    assert.equal(firstRecord.ownerId, first.ownerId);
    assert.throws(() => acquireDaemonLock(fixture.paths), /already running/);
    assert.deepEqual(JSON.parse(fs.readFileSync(fixture.paths.ownerRecordPath, 'utf8')), firstRecord);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(fixture.runtimeDir).mode & 0o777, 0o700);
      assert.equal(fs.statSync(fixture.paths.databasePath).mode & 0o777, 0o600);
      assert.equal(fs.statSync(fixture.paths.ownerRecordPath).mode & 0o777, 0o600);
    }

    assert.equal(first.release(), true);
    first = null;
    assert.equal(fs.existsSync(fixture.paths.ownerRecordPath), false);

    second = acquireDaemonLock(fixture.paths);
    assert.notEqual(second.ownerId, firstRecord.ownerId);
    assert.equal(second.release(), true);
    second = null;

    const inspection = new DatabaseSync(fixture.paths.databasePath);
    try {
      assert.equal(inspection.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
    } finally {
      inspection.close();
    }
    assert.equal(fs.existsSync(fixture.paths.databasePath + '-wal'), false);
    assert.equal(fs.existsSync(fixture.paths.databasePath + '-shm'), false);
    assert.equal(fs.existsSync(fixture.paths.databasePath + '-journal'), false);
  } finally {
    if (second) second.release();
    if (first) first.release();
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});

test('SQLite releases the daemon mutex after a lock-holding child is killed without cleanup', async () => {
  const fixture = lockFixture();
  const program = [
    "const { acquireDaemonLock } = require(process.argv[1]);",
    'const daemonLock = acquireDaemonLock(JSON.parse(process.argv[2]));',
    "process.stdout.write('LOCKED\\n');",
    'setInterval(() => undefined, 1000);'
  ].join(' ');
  const child = spawn(process.execPath, ['-e', program, lockModule, JSON.stringify(fixture.paths)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let recovered = null;
  try {
    await waitForChildLine(child, 'LOCKED\n');
    const crashedRecord = JSON.parse(fs.readFileSync(fixture.paths.ownerRecordPath, 'utf8'));
    assert.equal(crashedRecord.pid, child.pid);
    child.kill('SIGKILL');
    await waitForExit(child);

    recovered = acquireDaemonLock(fixture.paths);
    const recoveredRecord = JSON.parse(fs.readFileSync(fixture.paths.ownerRecordPath, 'utf8'));
    assert.equal(recoveredRecord.pid, process.pid);
    assert.equal(recoveredRecord.ownerId, recovered.ownerId);
    assert.notEqual(recoveredRecord.ownerId, crashedRecord.ownerId);
    assert.equal(recovered.release(), true);
    recovered = null;
  } finally {
    if (recovered) recovered.release();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await waitForExit(child);
    }
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});

test('a live unrelated PID owner record is overwritten without signaling it and mismatched ownership is never deleted', () => {
  const fixture = lockFixture();
  let lock = null;
  try {
    fs.writeFileSync(fixture.paths.ownerRecordPath, JSON.stringify({ pid: process.pid, ownerId: 'unrelated-live-process', acquiredAt: new Date(0).toISOString() }) + '\n', { mode: 0o600 });
    process.kill(process.pid, 0);
    lock = acquireDaemonLock(fixture.paths);
    const current = JSON.parse(fs.readFileSync(fixture.paths.ownerRecordPath, 'utf8'));
    assert.equal(current.pid, process.pid);
    assert.equal(current.ownerId, lock.ownerId);
    assert.notEqual(current.ownerId, 'unrelated-live-process');
    process.kill(process.pid, 0);

    const replaced = { ...current, ownerId: 'not-the-holder' };
    fs.writeFileSync(fixture.paths.ownerRecordPath, JSON.stringify(replaced) + '\n', { mode: 0o600 });
    assert.equal(lock.release(), false);
    lock = null;
    assert.deepEqual(JSON.parse(fs.readFileSync(fixture.paths.ownerRecordPath, 'utf8')), replaced);

    lock = acquireDaemonLock(fixture.paths);
    assert.notEqual(JSON.parse(fs.readFileSync(fixture.paths.ownerRecordPath, 'utf8')).ownerId, replaced.ownerId);
    assert.equal(lock.release(), true);
    lock = null;
    assert.equal(fs.existsSync(fixture.paths.ownerRecordPath), false);
  } finally {
    if (lock) lock.release();
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});

test('the coordination database rejects symlinks and non-regular files', { skip: process.platform === 'win32' }, () => {
  const fixture = lockFixture();
  const outside = path.join(fixture.workspaceRoot, 'outside.sqlite');
  try {
    fs.writeFileSync(outside, 'not opened');
    fs.symlinkSync(outside, fixture.paths.databasePath);
    assert.throws(() => acquireDaemonLock(fixture.paths), /regular file/);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'not opened');
    fs.unlinkSync(fixture.paths.databasePath);
    fs.mkdirSync(fixture.paths.databasePath);
    assert.throws(() => acquireDaemonLock(fixture.paths), /regular file/);
  } finally {
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});
