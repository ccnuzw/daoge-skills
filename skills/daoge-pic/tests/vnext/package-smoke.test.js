const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const zlib = require('node:zlib');

const { parsePackJson, assertPackagePaths, assertReleaseArtifact, main } = require('../../scripts/package-smoke');
const { acquireLockSync } = require('../../scripts/build-lock');


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
  { path: 'references/boundaries.md' },
  { path: 'references/build-identity.md' },
  { path: 'references/commands.md' },
  { path: 'references/delivery.md' },
  { path: 'references/flow.md' },
  { path: 'references/provider-keys.md' },
  { path: 'references/queue.md' },
  { path: 'references/recovery.md' },
  { path: 'references/startup.md' },
  { path: 'references/state-model.md' },
  { path: 'references/workbench.md' },
  { path: 'docs/daoge_pic_vnext_upgrade_spec_zh.md' },
  { path: 'docs/vnext_verification_evidence_zh.md' }
] }];

function writeTarball(file, extraPaths = [], version = '5.14.2', omittedPaths = []) {
  const omitted = new Set(omittedPaths);
  const paths = [...new Set([...metadata[0].files.map((entry) => entry.path), 'package.json', ...extraPaths])].filter((name) => !omitted.has(name));
  const chunks = [];
  for (const name of paths) {
    const content = name === 'package.json'
      ? JSON.stringify({ name: 'daoge-pic', version })
      : name === 'protocol-version.json'
        ? JSON.stringify({ protocol: 'daoge-pic-skill-protocol', version: '3.1.0', runtimeCompatibility: `>=${version} <7.0.0` })
        : name === 'dist/vnext/shared/protocol.js'
          ? `exports.RUNTIME_VERSION = '${version}';\nexports.RUNTIME_COMPATIBILITY_RANGE = '>=${version} <7.0.0';`
          : name === 'dist/vnext/shared/protocol.d.ts'
            ? `export declare const RUNTIME_VERSION = "${version}";\nexport declare const RUNTIME_COMPATIBILITY_RANGE = ">=${version} <7.0.0";`
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

test('release artifact verifier validates package version and rejects retired files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-release-artifact-'));
  const valid = path.join(root, 'valid.tgz');
  const stale = path.join(root, 'stale.tgz');
  try {
    writeTarball(valid);
    assert.equal(assertReleaseArtifact(valid, '5.14.2').version, '5.14.2');
    writeTarball(stale, ['dist/vnext/cli/legacy-daemon.js']);
    assert.throws(() => assertReleaseArtifact(stale, '5.14.2'), /legacy-daemon/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('已发布制品只校验身份与卫生，完整性只对当前工作树打出来的包成立', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-frozen-artifact-'));
  try {
    // 冻结制品：没有本次新增的按需附录，但它就是那份已发布的 6.0.0 —— 不该被当成缺失。
    const frozen = path.join(root, 'frozen.tgz');
    writeTarball(frozen, [], '5.14.2', ['references/commands.md', 'references/recovery.md']);
    assert.deepEqual(assertReleaseArtifact(frozen, '5.14.2').missing, []);
    // 卫生对任何包都成立：冻结制品里混进数据库照样拒绝。
    const dirty = path.join(root, 'dirty.tgz');
    writeTarball(dirty, ['dist/cache/studio.db']);
    assert.throws(() => assertReleaseArtifact(dirty, '5.14.2'), /studio\.db/);
    // 当前工作树打包必须完整：缺一份附录就是缺一件 agent 要读的策略。
    const currentPaths = metadata[0].files.map((entry) => entry.path);
    assert.throws(() => assertPackagePaths(currentPaths.filter((file) => file !== 'references/commands.md')), /references\/commands\.md/);
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
  // references/ 是封闭白名单：附录之外的草稿不许混进发布包。
  assert.throws(() => assertPackagePaths([...paths, 'references/old-draft.md']), /old-draft\.md/);
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

test('包清单的允许集覆盖 src/vnext 的每个子目录（新目录不会再拖到发布时才炸）', () => {
  // 2026-09-20 抓到：批 4 新增 `src/vnext/skill/failure-advice.ts`，其 dist 产物不在允许集里，
  // `npm run test:package` 直到第一次做发布前检查才报 unexpected。这里把「src 有、清单无」钉死。
  const paths = metadata[0].files.map((file) => file.path);
  const srcRoot = path.resolve(__dirname, '../../src/vnext');
  for (const entry of fs.readdirSync(srcRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sample = 'dist/vnext/' + entry.name + '/sample.js';
    assert.doesNotThrow(() => assertPackagePaths([...paths, sample]), 'src/vnext/' + entry.name + ' 不在包清单允许集里：' + sample);
  }
});
test('package smoke waits for the dist lock before packing', async () => {
  const skillRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-package-smoke-lock-root-'));
  const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-package-smoke-lock-'));
  const lockPath = path.join(lockRoot, 'dist.lock');
  const markerPath = path.join(lockRoot, 'packed');
  fs.writeFileSync(path.join(skillRoot, 'package.json'), JSON.stringify({ name: 'daoge-pic', version: '5.14.2' }));
  const handle = acquireLockSync(lockPath, { label: 'package-smoke-test-owner' });
  try {
    const childProgram = [
      'const fs = require(\'node:fs\');',
      'const { main } = require(process.argv[1]);',
      'const markerPath = process.argv[3];',
      'main({',
      '  skillRoot: process.argv[2],',
      '  requireReleaseArtifact: false,',
      '  runCommand: () => { fs.writeFileSync(markerPath, \'packed\'); return { stdout: JSON.stringify([{ filename: \'fixture.tgz\', files: [] }]) }; }',
      '});'
    ].join('\n');
    const child = spawn(process.execPath, ['-e', childProgram, path.join(__dirname, '../../scripts/package-smoke.js'), skillRoot, markerPath], {
      cwd: skillRoot,
      env: { ...process.env, DAOGE_PIC_DIST_LOCK_PATH: lockPath },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const completed = collect(child);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(fs.existsSync(markerPath), false, 'package smoke must not pack while another build owns dist');
    handle.release();
    const result = await completed;
    assert.notEqual(result.code, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(markerPath), true, 'package smoke packs after the dist lock is released');
  } finally {
    handle.release();
    fs.rmSync(skillRoot, { recursive: true, force: true });
    fs.rmSync(lockRoot, { recursive: true, force: true });
  }
});

test('package smoke packs in a temporary directory and never removes a same-named release artifact', () => {
  const skillRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-package-smoke-skill-root-'));
  fs.writeFileSync(path.join(skillRoot, 'package.json'), JSON.stringify({ name: 'daoge-pic', version: '5.14.2' }));
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
