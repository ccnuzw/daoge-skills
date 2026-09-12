const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { parsePackJson, assertPackagePaths, assertReleaseArtifact, main } = require('../../scripts/package-smoke');

const metadata = [{ filename: 'daoge-pic-fixture.tgz', files: [
  { path: 'dist/vnext/cli/daoge.js' },
  { path: 'dist/vnext/cli/daemon.js' },
  { path: 'dist/vnext/cli/daemon-shutdown.js' },
  { path: 'dist/vnext/cli/daemon-shutdown.d.ts' },
  { path: 'dist/vnext/shared/protocol.js' },
  { path: 'dist/vnext/shared/protocol.d.ts' },
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

function writeTarball(file, extraPaths = [], version = '5.13.0') {
  const paths = [...new Set([...metadata[0].files.map((entry) => entry.path), 'package.json', ...extraPaths])];
  const chunks = [];
  for (const name of paths) {
    const content = name === 'package.json'
      ? JSON.stringify({ name: 'daoge-pic', version })
      : name === 'protocol-version.json'
        ? JSON.stringify({ protocol: 'daoge-pic-skill-protocol', version: '2.0.0', runtimeCompatibility: `>=${version} <6.0.0` })
        : name === 'dist/vnext/shared/protocol.js'
          ? `exports.RUNTIME_VERSION = '${version}';\nexports.RUNTIME_COMPATIBILITY_RANGE = '>=${version} <6.0.0';`
          : name === 'dist/vnext/shared/protocol.d.ts'
            ? `export declare const RUNTIME_VERSION = "${version}";\nexport declare const RUNTIME_COMPATIBILITY_RANGE = ">=${version} <6.0.0";`
            : 'fixture';
    const body = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write('0000644\0', 100, 'ascii');
    header.write((body.length.toString(8).padStart(11, '0') + '\0'), 124, 'ascii');
    header.write('0', 156, 'ascii');
    header.write('package/' + name, 0, 'utf8');
    chunks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  fs.writeFileSync(file, zlib.gzipSync(Buffer.concat(chunks)));
}

test('release artifact verifier validates package version and rejects retired files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-release-artifact-'));
  const valid = path.join(root, 'valid.tgz');
  const stale = path.join(root, 'stale.tgz');
  try {
    writeTarball(valid);
    assert.equal(assertReleaseArtifact(valid, '5.13.0').version, '5.13.0');
    writeTarball(stale, ['dist/vnext/cli/legacy-daemon.js']);
    assert.throws(() => assertReleaseArtifact(stale, '5.13.0'), /legacy-daemon/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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
  assert.throws(() => assertPackagePaths([...paths, 'dist/old-runtime.js']), /old-runtime\.js/);
  assert.throws(() => assertPackagePaths([...paths, 'dist/vnext/legacy/adapter.js']), /legacy\/adapter\.js/);
  assert.throws(() => assertPackagePaths([...paths, 'dist/vnext/cli/legacy-daemon.js']), /legacy-daemon\.js/);
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
  const skillRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-package-smoke-skill-root-'));
  fs.writeFileSync(path.join(skillRoot, 'package.json'), JSON.stringify({ name: 'daoge-pic', version: '5.13.0' }));
  const filename = `daoge-pic-protected-${process.pid}-${Date.now()}.tgz`;
  const protectedArtifact = path.join(skillRoot, filename);
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-package-smoke-contract-'));
  const invalidMetadata = [{ ...metadata[0], filename, files: [...metadata[0].files, { path: 'notes.txt' }] }];
  const calls = [];
  fs.writeFileSync(protectedArtifact, 'immutable release artifact');

  try {
    assert.throws(() => main({ skillRoot }), /Required release artifact/);
    assert.throws(() => main({
      skillRoot,
      requireReleaseArtifact: false,
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
    fs.rmSync(skillRoot, { recursive: true, force: true });
  }
});
