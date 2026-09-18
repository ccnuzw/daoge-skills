const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const { createBackupManifest } = require('../../dist/vnext/backup/manifest');
const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { applyBackupRestore, recoverPendingBackupRestore } = require('../../dist/vnext/backup/restore');
const { acquireDaemonLock } = require('../../dist/vnext/runtime/daemon-lock');

const studio = {
  studioId: 'studio_restore_apply_fixture',
  protocolName: 'daoge-pic-skill-protocol',
  protocolVersion: '3.0.0',
  runtimeVersion: '6.0.0'
};

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-restore-apply-'));
}
function put(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function read(root, relativePath) {
  return fs.readFileSync(path.join(root, ...relativePath.split('/')), 'utf8');
}
function manifestFor(source, paths) {
  return createBackupManifest({ workspaceRoot: source, studio, entries: paths.map((entry) => ({ path: entry, category: entry.startsWith('media/') ? 'media' : 'metadata' })) });
}
function runCli(root, source, manifest) {
  return spawnSync(process.execPath, [path.join(__dirname, '../../dist/vnext/cli/daoge.js'), 'backup-restore', '--workspace', root, '--source-root', source, '--manifest', JSON.stringify(manifest)], { cwd: path.join(__dirname, '../..'), encoding: 'utf8', env: { ...process.env, DAOGE_PIC_PROVIDER_SECRET_BACKEND: 'plaintext' } });
}

test('restore writes verified bytes into the target and leaves unchanged files alone', () => {
  const source = workspace();
  const target = workspace();
  try {
    put(source, 'metadata/studio.json', '{"schemaVersion":1}');
    put(source, 'media/a.bin', 'source-a');
    put(source, 'media/new.bin', 'brand-new');
    put(target, 'metadata/studio.json', '{"schemaVersion":1}');
    put(target, 'media/a.bin', 'old-a');
    const manifest = manifestFor(source, ['media/a.bin', 'media/new.bin', 'metadata/studio.json']);

    const result = applyBackupRestore({ sourceRoot: source, targetRoot: target, manifest, studio });
    assert.equal(result.applied, true);
    assert.deepEqual([result.created, result.replaced, result.unchanged], [1, 1, 1]);
    assert.equal(read(target, 'media/a.bin'), 'source-a');
    assert.equal(read(target, 'media/new.bin'), 'brand-new');
    assert.equal(fs.readdirSync(target).filter((name) => name.startsWith('.daoge-restore-')).length, 0, 'the staging directory must not survive');
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('a tampered source is rejected before anything is replaced', () => {
  const source = workspace();
  const target = workspace();
  try {
    put(source, 'media/a.bin', 'source-a');
    put(target, 'media/a.bin', 'precious-current-content');
    const manifest = manifestFor(source, ['media/a.bin']);
    put(source, 'media/a.bin', 'tampered-after-the-manifest-was-built');

    const result = applyBackupRestore({ sourceRoot: source, targetRoot: target, manifest, studio });
    assert.equal(result.applied, false);
    assert.ok(['not_ready', 'verification_failed'].includes(result.error.code), 'the tampered source must not reach the target');
    assert.equal(read(target, 'media/a.bin'), 'precious-current-content', 'the target must be untouched');
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('a failure during the swap rolls the already-replaced files back to their previous contents', () => {
  const source = workspace();
  const target = workspace();
  try {
    for (const name of ['a', 'b', 'c']) put(source, 'media/' + name + '.bin', 'source-' + name);
    for (const name of ['a', 'b', 'c']) put(target, 'media/' + name + '.bin', 'original-' + name);
    put(target, 'media/only-in-target.bin', 'untouched');
    const manifest = manifestFor(source, ['media/a.bin', 'media/b.bin', 'media/c.bin']);

    // Fail on the third swap: a and b are already in place, so rollback has to
    // put both back. This is the failure mode that would otherwise leave a
    // half-restored Studio behind.
    const result = applyBackupRestore({ sourceRoot: source, targetRoot: target, manifest, studio, failAt: 'during_swap', failAtOperation: 2 });
    assert.equal(result.applied, false);
    assert.equal(result.rolledBack, true);
    assert.equal(result.error.code, 'swap_failed');
    assert.equal(read(target, 'media/a.bin'), 'original-a');
    assert.equal(read(target, 'media/b.bin'), 'original-b');
    assert.equal(read(target, 'media/c.bin'), 'original-c');
    assert.equal(read(target, 'media/only-in-target.bin'), 'untouched');
    assert.equal(fs.readdirSync(target).filter((name) => name.startsWith('.daoge-restore-')).length, 0, 'staging must be cleaned up even on failure');
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('a newly created file is removed again when a later swap fails', () => {
  const source = workspace();
  const target = workspace();
  try {
    put(source, 'media/a.bin', 'source-a');
    put(source, 'media/b.bin', 'source-b');
    put(target, 'media/b.bin', 'original-b');
    const manifest = manifestFor(source, ['media/a.bin', 'media/b.bin']);

    const result = applyBackupRestore({ sourceRoot: source, targetRoot: target, manifest, studio, failAt: 'during_swap', failAtOperation: 1 });
    assert.equal(result.applied, false);
    assert.equal(result.rolledBack, true);
    assert.equal(fs.existsSync(path.join(target, 'media/a.bin')), false, 'a file the target never had must not be left behind');
    assert.equal(read(target, 'media/b.bin'), 'original-b');
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('a failure after staging leaves the target completely untouched', () => {
  const source = workspace();
  const target = workspace();
  try {
    put(source, 'media/a.bin', 'source-a');
    put(target, 'media/a.bin', 'original-a');
    const manifest = manifestFor(source, ['media/a.bin']);

    const result = applyBackupRestore({ sourceRoot: source, targetRoot: target, manifest, studio, failAt: 'after_staging' });
    assert.equal(result.applied, false);
    assert.equal(read(target, 'media/a.bin'), 'original-a');
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('restore refuses while the actual SQLite daemon lock is held', () => {
  const source = workspace();
  const target = workspace();
  let lock;
  try {
    put(source, 'media/a.bin', 'source-a');
    put(target, 'media/a.bin', 'original-a');
    const manifest = manifestFor(source, ['media/a.bin']);
    fs.mkdirSync(path.join(target, 'daoge-studio/runtime'), { recursive: true });
    lock = acquireDaemonLock({
      databasePath: path.join(target, 'daoge-studio/runtime/daemon-lock.sqlite'),
      ownerRecordPath: path.join(target, 'daoge-studio/runtime/daemon.lock')
    });

    const result = applyBackupRestore({ sourceRoot: source, targetRoot: target, manifest, studio });
    assert.equal(result.applied, false);
    assert.equal(result.error.code, 'target_locked');
    assert.equal(read(target, 'media/a.bin'), 'original-a', 'swapping files under a live daemon would corrupt it');
  } finally {
    if (lock) lock.release();
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('a stale daemon runtime record does not block restore when SQLite is unlocked', () => {
  const source = workspace();
  const target = workspace();
  try {
    put(source, 'media/a.bin', 'source-a');
    put(target, 'media/a.bin', 'original-a');
    put(target, 'daoge-studio/runtime/daemon.json', '{"port":1}');
    const manifest = manifestFor(source, ['media/a.bin']);

    const result = applyBackupRestore({ sourceRoot: source, targetRoot: target, manifest, studio });
    assert.equal(result.applied, true);
    assert.equal(read(target, 'media/a.bin'), 'source-a');
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('an unready plan is never applied', () => {
  const source = workspace();
  const target = workspace();
  try {
    put(source, 'media/a.bin', 'source-a');
    fs.symlinkSync(path.join(source, 'media/a.bin'), path.join(target, 'media'));
    const manifest = manifestFor(source, ['media/a.bin']);

    const result = applyBackupRestore({ sourceRoot: source, targetRoot: target, manifest, studio });
    assert.equal(result.applied, false);
    assert.equal(result.error.code, 'not_ready');
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('recovery restores an original from a durable backup intent even before originalRenamed is persisted', () => {
  const target = workspace();
  try {
    const id = 'intent-window';
    const staging = path.join(target, '.daoge-restore-' + id);
    const original = path.join(staging, 'original-0');
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(original, 'original-a');
    put(target, 'media/a.bin', 'source-a');
    const journalPath = path.join(target, '.daoge-restore-' + id + '.journal.json');
    fs.writeFileSync(journalPath, JSON.stringify({
      version: 1, state: 'pending', targetRoot: target, stagingRoot: staging, journalPath, createdDirectories: [],
      entries: [{ relativePath: 'media/a.bin', stagedPath: path.join(staging, 'file-0'), originalPath: original, backupIntent: true, originalRenamed: false, newInstalled: false, hadOriginal: true }]
    }));

    const result = recoverPendingBackupRestore(target);
    assert.equal(result.recovered, 1);
    assert.equal(read(target, 'media/a.bin'), 'original-a');
    assert.equal(fs.existsSync(journalPath), false);
    assert.equal(fs.existsSync(staging), false);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});


test('a failure after moving the original restores it from the journaled backup', () => {
  const source = workspace();
  const target = workspace();
  try {
    put(source, 'media/a.bin', 'source-a');
    put(target, 'media/a.bin', 'original-a');
    const manifest = manifestFor(source, ['media/a.bin']);

    const result = applyBackupRestore({ sourceRoot: source, targetRoot: target, manifest, studio, failAt: 'after_original_move' });
    assert.equal(result.applied, false);
    assert.equal(result.rolledBack, true);
    assert.equal(read(target, 'media/a.bin'), 'original-a');
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('rollback failure is reported and retains the journal and original bytes for recovery', () => {
  const source = workspace();
  const target = workspace();
  try {
    put(source, 'media/a.bin', 'source-a');
    put(target, 'media/a.bin', 'original-a');
    const manifest = manifestFor(source, ['media/a.bin']);

    const result = applyBackupRestore({ sourceRoot: source, targetRoot: target, manifest, studio, failAt: 'during_rollback' });
    assert.equal(result.applied, false);
    assert.equal(result.rolledBack, false);
    assert.equal(result.error.code, 'rollback_failed');
    const journals = fs.readdirSync(target).filter((name) => name.endsWith('.journal.json'));
    assert.equal(journals.length, 1);
    const journal = JSON.parse(fs.readFileSync(path.join(target, journals[0]), 'utf8'));
    assert.equal(fs.readFileSync(journal.entries[0].originalPath, 'utf8'), 'original-a');
    assert.deepEqual(recoverPendingBackupRestore(target), { recovered: 1 });
    assert.equal(read(target, 'media/a.bin'), 'original-a');
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('the public backup-restore CLI uses the offline helper and returns nonzero on validation failure', () => {
  const source = workspace();
  const target = workspace();
  try {
    put(source, 'media/a.bin', 'source-a');
    const initialized = initializeStudio({ workspaceRoot: target });
    put(target, 'media/a.bin', 'original-a');
    const manifest = createBackupManifest({ workspaceRoot: source, studio: { studioId: initialized.manifest.studioId, protocolName: 'daoge-pic-skill-protocol', protocolVersion: '3.0.0', runtimeVersion: '6.0.0' }, entries: [{ path: 'media/a.bin', category: 'media' }] });
    const success = runCli(target, source, manifest);
    assert.equal(success.status, 0, success.stderr);
    assert.equal(read(target, 'media/a.bin'), 'source-a');
    const failed = runCli(target, path.join(source, 'missing'), manifest);
    assert.notEqual(failed.status, 0);
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('待恢复记录的校验走 sameWorkspaceRoot，而不是手写 realpath 比较', () => {
  // 守的是一个已经踩过的坑：原先写的是 `fs.realpathSync.native(dir) !== root`，少了 win32 的大小写归一，
  // 于是同一份完好的待恢复记录在 Windows 上被判成损坏 —— 而原文其实好端端躺在暂存目录里。
  // 这条**行为上测不出来**（macOS 大小写敏感、realpath 形态稳定，本机永远绿），只能靠源码守卫钉住：
  // v5.14.0 与 v5.14.1 的 Windows CI 四个 job 全栽在这里。
  const source = fs.readFileSync(path.join(__dirname, '../../src/vnext/backup/restore.ts'), 'utf8');
  assert.match(source, /sameWorkspaceRoot\(/, '待恢复记录的路径比较必须走 sameWorkspaceRoot');
  assert.doesNotMatch(source, /realpathSync\.native\(path\.dirname/, '不要在恢复校验里手写 realpath 比较');
});
