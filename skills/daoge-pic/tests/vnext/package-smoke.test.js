const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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
  { path: 'protocol-version.json' },
  { path: 'references/provider.env.example' },
  { path: 'docs/daoge_pic_vnext_upgrade_spec_zh.md' },
  { path: 'docs/vnext_verification_evidence_zh.md' }
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

test('package smoke packs in a temporary directory and never removes a same-named release artifact', () => {
  const skillRoot = path.resolve(__dirname, '../..');
  const filename = `daoge-pic-protected-${process.pid}-${Date.now()}.tgz`;
  const protectedArtifact = path.join(skillRoot, filename);
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-package-smoke-contract-'));
  const invalidMetadata = [{ ...metadata[0], filename, files: [...metadata[0].files, { path: 'notes.txt' }] }];
  const calls = [];
  fs.writeFileSync(protectedArtifact, 'immutable release artifact');

  try {
    assert.throws(() => main({
      runCommand: (command, args, options) => {
        calls.push({ command, args, options });
        return { stdout: JSON.stringify(invalidMetadata) };
      },
      makeTemp: () => workRoot
    }), /notes\.txt/);
    assert.equal(fs.readFileSync(protectedArtifact, 'utf8'), 'immutable release artifact');
    assert.equal(fs.existsSync(workRoot), false);
    assert.deepEqual(calls[0].args.slice(-2), ['--pack-destination', path.join(workRoot, 'pack')]);
    assert.equal(calls[0].options.cwd, skillRoot);
  } finally {
    fs.rmSync(protectedArtifact, { force: true });
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
});
