const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { parsePackJson, assertPackagePaths, main } = require('../../scripts/package-smoke');

const metadata = [{ filename: 'daoge-pic-5.5.0.tgz', files: [
  { path: 'dist/vnext/cli/daoge.js' },
  { path: 'dist/vnext/cli/daemon.js' },
  { path: 'dist/vnext/studio/provider-store.js' },
  { path: 'dist/vnext/runtime/restart.js' },
  { path: 'dist/workbench/index.html' },
  { path: 'scripts/daoge.js' },
  { path: 'SKILL.md' },
  { path: 'README.md' },
  { path: 'references/provider.env.example' },
  { path: 'docs/daoge_pic_vnext_upgrade_spec_zh.md' }
] }];

test('package smoke parser accepts npm JSON with no leading newline and surrounding warnings', () => {
  const json = JSON.stringify(metadata);
  assert.deepEqual(parsePackJson(json), metadata);
  assert.deepEqual(parsePackJson('npm warn before pack\n' + json + '\nnpm warn after pack\n'), metadata);
  assert.deepEqual(parsePackJson('warning [not-json]\n' + json), metadata);
});

test('package smoke allowlist rejects maps and retired source paths', () => {
  const paths = metadata[0].files.map((file) => file.path);
  assert.deepEqual(assertPackagePaths(paths), { missing: [], unexpected: [], maps: [], retired: [], sensitive: [] });
  assert.throws(() => assertPackagePaths(paths.filter((file) => file !== 'scripts/daoge.js')), /scripts\/daoge\.js/);
  assert.throws(() => assertPackagePaths([...paths, 'dist/vnext/cli/daoge.js.map']), /daoge\.js\.map/);
  assert.throws(() => assertPackagePaths([...paths, 'src/vnext/cli/daoge.ts']), /src\/vnext/);
  assert.throws(() => assertPackagePaths([...paths, 'notes.txt']), /notes\.txt/);
  for (const sensitivePath of [
    'dist/daoge-studio/Provider.db',
    'dist/daoge-studio/studio.db',
    'dist/cache/Provider.db-wal',
    'dist/cache/worker.sqlite-shm',
    'dist/references/provider.env',
    'dist/daoge-studio/runtime/daemon.json',
    'dist/cache/daemon-lock.sqlite',
    'dist/cache/daemon-lock.sqlite-journal',
    'dist/cache/daemon-lock.sqlite-wal',
    'dist/cache/daemon-lock.sqlite-shm',
    'dist/logs/daemon.log',
    'dist/logs/runtime.log.1'
  ]) assert.throws(() => assertPackagePaths([...paths, sensitivePath]), new RegExp(sensitivePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotThrow(() => assertPackagePaths(paths));
});

test('package smoke removes the tarball when package path validation throws', () => {
  const filename = 'daoge-pic-invalid.tgz';
  const invalidMetadata = [{ ...metadata[0], filename, files: [...metadata[0].files, { path: 'notes.txt' }] }];
  const removed = [];

  assert.throws(() => main({
    runCommand: () => ({ stdout: JSON.stringify(invalidMetadata) }),
    removeSync: (target, options) => removed.push({ target, options })
  }), /notes\.txt/);
  assert.deepEqual(removed, [{
    target: path.resolve(__dirname, '../..', filename),
    options: { force: true }
  }]);
});
