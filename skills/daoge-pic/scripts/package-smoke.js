const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const zlib = require('node:zlib');
const { withLockSync, resolveLockPath } = require('./build-lock');


function parsePackJson(output) {
  const text = String(output || '');
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '[') continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let end = start; end < text.length; end += 1) {
      const character = text[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === '[' || character === '{') depth += 1;
      else if (character === ']' || character === '}') depth -= 1;
      if (depth !== 0) continue;
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] && Array.isArray(parsed[0].files) && typeof parsed[0].filename === 'string') return parsed;
      } catch { /* another bracket may start the npm metadata */ }
      break;
    }
  }
  throw new Error('npm pack did not emit valid JSON metadata.');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || command + ' failed.');
  return result;
}

function runNpm(runCommand, args, options) {
  const npmExecPath = String(process.env.npm_execpath || '').trim();
  if (npmExecPath && fs.existsSync(npmExecPath)) return runCommand(process.execPath, [npmExecPath, ...args], options);
  if (process.platform === 'win32') throw new Error('Windows package smoke must run through npm.cmd run test:package so npm_execpath identifies npm-cli.js safely.');
  return runCommand('npm', args, options);
}

function tarFileEntries(tarballPath) {
  const archive = zlib.gunzipSync(fs.readFileSync(tarballPath));
  const entries = [];
  for (let offset = 0; offset + 512 <= archive.length; ) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    if (!name || !Number.isSafeInteger(size) || size < 0 || offset + 512 + size > archive.length) throw new Error('Invalid tar entry in release artifact: ' + tarballPath);
    const entryPath = (prefix ? prefix + '/' + name : name).replace(/^package\//, '');
    entries.push({ path: entryPath, content: Buffer.from(archive.subarray(offset + 512, offset + 512 + size)) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function tarEntries(tarballPath) {
  return tarFileEntries(tarballPath).map((entry) => entry.path);
}

function tarFile(tarballPath, expectedPath) {
  return tarFileEntries(tarballPath).find((entry) => entry.path === expectedPath)?.content || null;
}

function assertReleaseArtifact(tarballPath, expectedVersion) {
  if (!fs.existsSync(tarballPath)) throw new Error('Release artifact does not exist: ' + tarballPath);
  const paths = tarEntries(tarballPath);
  const checked = assertPackagePaths(paths, { requireCurrentFiles: false });
  const packageContent = tarFile(tarballPath, 'package.json');
  const protocolContent = tarFile(tarballPath, 'dist/vnext/shared/protocol.js');
  const protocolTypes = tarFile(tarballPath, 'dist/vnext/shared/protocol.d.ts');
  const protocolManifestContent = tarFile(tarballPath, 'protocol-version.json');
  let packageJson;
  let protocolManifest;
  try {
    packageJson = packageContent ? JSON.parse(packageContent.toString('utf8')) : null;
    protocolManifest = protocolManifestContent ? JSON.parse(protocolManifestContent.toString('utf8')) : null;
  } catch (error) {
    throw new Error('Release artifact contains invalid package or protocol JSON: ' + error.message);
  }
  const runtimeVersion = protocolContent?.toString('utf8').match(/exports\.RUNTIME_VERSION = ['"]([^'"]+)['"]/u)?.[1] || null;
  const runtimeRange = protocolContent?.toString('utf8').match(/exports\.RUNTIME_COMPATIBILITY_RANGE = ['"]([^'"]+)['"]/u)?.[1] || null;
  const declaredRuntimeVersion = protocolTypes?.toString('utf8').match(/RUNTIME_VERSION = ["']([^"']+)["']/u)?.[1] || null;
  const declaredRuntimeRange = protocolTypes?.toString('utf8').match(/RUNTIME_COMPATIBILITY_RANGE = ["']([^"']+)["']/u)?.[1] || null;
  // 运行时兼容范围是**独立声明**（对 6.x 始终是 `>=6.0.0 <7.0.0`），不能从制品版本反推下界：
  // minor/patch 升级不改变下界，用 `>=<version>` 去比会把 6.1.0 的合法制品误判成假升级。
  // 只要求：三处声明一致、是合法区间、且制品版本落在区间内。
  const RANGE_PATTERN = /^>=(\d+)\.(\d+)\.(\d+)\s+<(\d+)\.(\d+)\.(\d+)$/;
  const parseRange = (value) => (typeof value === 'string' ? RANGE_PATTERN.exec(value) : null);
  const manifestRange = parseRange(protocolManifest && protocolManifest.runtimeCompatibility);
  const codeRange = parseRange(runtimeRange);
  const typesRange = parseRange(declaredRuntimeRange);
  const triple = (match, offset) => match.slice(offset, offset + 3).map(Number);
  const compare = (left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
  const artifactMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(expectedVersion);
  const artifactParts = artifactMatch ? artifactMatch.slice(1, 4).map(Number) : null;
  const rangeContainsVersion = (match) => Boolean(artifactParts && match && compare(artifactParts, triple(match, 1)) >= 0 && compare(artifactParts, triple(match, 4)) < 0);
  const rangesConsistent = Boolean(manifestRange && codeRange && typesRange && manifestRange[0] === codeRange[0] && codeRange[0] === typesRange[0] && rangeContainsVersion(manifestRange));
  const mismatch = {
    package: packageJson,
    protocolManifest,
    runtimeVersion,
    runtimeRange,
    declaredRuntimeVersion,
    declaredRuntimeRange,
    expectedVersion,
    declaredRange: protocolManifest && protocolManifest.runtimeCompatibility,
    rangesConsistent
  };
  if (!packageJson || packageJson.name !== 'daoge-pic' || packageJson.version !== expectedVersion || !protocolManifest || protocolManifest.protocol !== 'daoge-pic-skill-protocol' || protocolManifest.version !== '3.1.0' || !rangesConsistent || runtimeVersion !== expectedVersion || declaredRuntimeVersion !== expectedVersion) {
    throw new Error(JSON.stringify(mismatch, null, 2));
  }
  return { paths, ...checked, version: packageJson.version, runtimeVersion, runtimeRange };
}

function isSensitivePackagePath(file) {
  const normalized = String(file || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (normalized === 'references/provider.env.example') return false;
  const lower = normalized.toLowerCase();
  return /(?:^|\/)daemon-lock\.sqlite(?:$|[.-])/.test(lower)
    || /(?:^|\/)(?:provider|studio)\.db(?:$|[.-])/.test(lower)
    || /\.(?:db|sqlite|sqlite3)-(?:wal|shm|journal)(?:$|[.-])/.test(lower)
    || /(?:^|\/)provider\.env(?:$|[.-])/.test(lower)
    || /(?:^|\/)daoge-studio\/runtime(?:\/|$)/.test(lower)
    || /(?:^|\/)[^/]*\.log(?:$|[.-])/.test(lower);
}

// Skill 附录（references/）是封闭白名单：只有这些文件允许上包，别的 md（草稿、旧材料）
// 一律按 retired 拒绝。允许集、必需集、retired 与安装后校验共用这一个来源 ——
// 发布包内容的表只准有一份，否则迟早出现「改了三处漏一处」。
const PACKAGE_REFERENCES = ['provider.env.example', 'boundaries.md', 'build-identity.md', 'commands.md', 'delivery.md', 'flow.md', 'provider-keys.md', 'queue.md', 'recovery.md', 'startup.md', 'state-model.md', 'workbench.md'];
const PACKAGE_REFERENCE_PATHS = PACKAGE_REFERENCES.map((name) => 'references/' + name);
const PACKAGE_REFERENCE_PATTERN = PACKAGE_REFERENCES.map((name) => name.replace(/\./g, '\\.')).join('|');
const ALLOWED_PACKAGE_PATH = new RegExp('^(dist\\/(?:vnext\\/(?:api|backup|cli|domain|media|provenance|providers|runner|runtime|shared|skill|studio|usage)\\/[A-Za-z0-9._/-]+|workbench\\/(?:index\\.html|assets\\/[A-Za-z0-9._-]+))$|scripts\\/daoge\\.js$|references\\/(?:' + PACKAGE_REFERENCE_PATTERN + ')$|docs\\/(?:daoge_pic_vnext_upgrade_spec_zh|vnext_verification_evidence_zh)\\.md$|README\\.md$|SKILL\\.md$|protocol-version\\.json$|LICENSE$|package\\.json$)');
const RETIRED_PACKAGE_PATH = new RegExp('^(app|agents|src|tests|references\\/(?!' + PACKAGE_REFERENCE_PATTERN + '$)|Dockerfile$|docker-compose\\.yml$|\\.env\\.example$|\\.dockerignore$)');

/**
 * 包内容校验分两层，别混为一谈：
 * - **卫生**（unexpected / maps / retired / sensitive）对任何包都成立：不许混进源码、地图、数据库、日志。
 * - **完整**（required：CLI、Workbench、协议、SKILL.md 的按需附录…）只对**从当前工作树打出来的包**
 *   成立。已发布制品是冻结的：它不可能含有发布之后才新增的文件，要求它含有等于要求它自我背叛。
 *   身份与版本另由 assertReleaseArtifact 校验。
 */
function assertPackagePaths(paths, { requireCurrentFiles = true } = {}) {
  const required = ['dist/vnext/cli/daoge.js', 'dist/vnext/cli/daemon.js', 'dist/vnext/cli/daemon-shutdown.js', 'dist/vnext/cli/daemon-shutdown.d.ts', 'dist/vnext/studio/provider-store.js', 'dist/vnext/runtime/restart.js', 'dist/workbench/index.html', 'scripts/daoge.js', 'SKILL.md', 'README.md', 'protocol-version.json', ...PACKAGE_REFERENCE_PATHS, 'docs/daoge_pic_vnext_upgrade_spec_zh.md', 'docs/vnext_verification_evidence_zh.md'];
  const missing = requireCurrentFiles ? required.filter((file) => !paths.includes(file)) : [];
  const unexpected = paths.filter((file) => !ALLOWED_PACKAGE_PATH.test(file));
  const maps = paths.filter((file) => file.endsWith('.map'));
  const retired = paths.filter((file) => RETIRED_PACKAGE_PATH.test(file) || file.includes('legacy-adapters') || file.includes('legacy-daemon'));
  const sensitive = paths.filter(isSensitivePackagePath);
  if (missing.length || unexpected.length || maps.length || retired.length || sensitive.length) throw new Error(JSON.stringify({ missing, unexpected, maps, retired, sensitive }, null, 2));
  return { missing, unexpected, maps, retired, sensitive };
}

function runPackageSmoke({ runCommand, makeTemp, removeSync, skillRoot, requireReleaseArtifact }) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(skillRoot, 'package.json'), 'utf8'));
  const currentArtifact = path.join(skillRoot, 'daoge-pic-' + packageJson.version + '.tgz');
  if (requireReleaseArtifact && !fs.existsSync(currentArtifact)) throw new Error('Required release artifact does not exist: ' + currentArtifact);
  if (fs.existsSync(currentArtifact)) assertReleaseArtifact(currentArtifact, packageJson.version);
  const workRoot = makeTemp(path.join(os.tmpdir(), 'daoge-pic-package-smoke-图片 空格-'));
  const packRoot = path.join(workRoot, 'pack');
  const consumerRoot = path.join(workRoot, 'consumer');
  fs.mkdirSync(packRoot, { recursive: true });
  fs.mkdirSync(consumerRoot, { recursive: true });
  try {
    const packed = runNpm(runCommand, ['pack', '--json', '--ignore-scripts', '--pack-destination', packRoot], { cwd: skillRoot });
    const packages = parsePackJson(packed.stdout);
    const metadata = packages[0];
    const tarballPath = path.resolve(packRoot, metadata.filename);
    const paths = metadata.files.map((file) => file.path);
    const checked = assertPackagePaths(paths);
    assertReleaseArtifact(tarballPath, packageJson.version);
    if (!fs.existsSync(tarballPath)) throw new Error('npm pack did not create the reported tarball: ' + metadata.filename);

    fs.writeFileSync(path.join(consumerRoot, 'package.json'), JSON.stringify({ private: true }, null, 2) + '\n');
    runNpm(runCommand, ['install', tarballPath, '--ignore-scripts'], { cwd: consumerRoot });
    const installedRoot = path.join(consumerRoot, 'node_modules', 'daoge-pic');
    const runtimeRequired = ['scripts/daoge.js', 'dist/vnext/cli/daemon.js', 'dist/vnext/cli/daemon-shutdown.js', 'dist/vnext/cli/daemon-shutdown.d.ts', 'dist/vnext/shared/windows.js', 'dist/vnext/studio/provider-store.js', 'dist/vnext/runtime/restart.js', 'dist/workbench/index.html', 'protocol-version.json', ...PACKAGE_REFERENCE_PATHS];
    const runtimeMissing = runtimeRequired.filter((file) => !fs.existsSync(path.join(installedRoot, file)));
    if (runtimeMissing.length) throw new Error(JSON.stringify({ runtimeMissing }, null, 2));
    const installedBin = path.join(consumerRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'daoge.cmd' : 'daoge');
    if (!fs.existsSync(installedBin)) throw new Error('npm did not create the packaged daoge bin shim.');
    const help = process.platform === 'win32'
      ? runCommand(process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', 'daoge.cmd --help'], { cwd: path.dirname(installedBin), env: process.env })
      : runCommand(installedBin, ['--help'], { cwd: consumerRoot });
    if (!help.stdout.includes('DAOGE Pic vNext Studio')) throw new Error('Installed daoge bin shim did not execute the packaged entry.');
    const registration = path.join(consumerRoot, '.agents', 'skills', 'daoge-pic');
    const registered = runCommand(process.execPath, [path.join(installedRoot, 'scripts', 'daoge.js'), 'register-skill', '--scope', 'project', '--workspace', consumerRoot], { cwd: consumerRoot });
    if (JSON.parse(registered.stdout).scope !== 'project') throw new Error('Packaged register-skill command did not report project registration.');
    if (fs.realpathSync(registration) !== fs.realpathSync(installedRoot)) throw new Error('Skill registration does not resolve to the installed package.');
    const registeredHelp = runCommand(process.execPath, [path.join(registration, 'scripts', 'daoge.js'), '--help'], { cwd: consumerRoot });
    if (!registeredHelp.stdout.includes('DAOGE Pic vNext Studio')) throw new Error('Registered Skill did not execute the packaged entry.');
    const doctor = runCommand(process.execPath, [path.join(installedRoot, 'scripts', 'daoge.js'), 'doctor', '--workspace', path.join(consumerRoot, 'future-workspace'), '--json', 'true'], { cwd: consumerRoot });
    if (JSON.parse(doctor.stdout).ok !== true) throw new Error('Packaged doctor command did not validate the temporary consumer workspace.');

    const sharpProbe = `const root=${JSON.stringify(installedRoot)}; const sharp=require(require.resolve('sharp',{paths:[root]})); if(!sharp.versions||!sharp.versions.vips) process.exit(2); process.stdout.write(sharp.versions.vips);`;
    const sharp = runCommand(process.execPath, ['-e', sharpProbe], { cwd: consumerRoot });
    if (!sharp.stdout.trim()) throw new Error('Installed sharp dependency did not load its native image runtime.');
    process.stdout.write(JSON.stringify({ files: paths.length, unexpected: checked.unexpected.length, maps: checked.maps.length, retired: checked.retired.length, sensitive: checked.sensitive.length, installed: true, bin: true, help: true, registered: true, doctor: true, sharp: true }, null, 2) + '\n');
  } finally {
    removeSync(workRoot, { recursive: true, force: true });
  }
}

function main(options = {}) {
  const config = {
    runCommand: run,
    makeTemp: fs.mkdtempSync,
    removeSync: fs.rmSync,
    skillRoot: path.resolve(__dirname, '..'),
    requireReleaseArtifact: true,
    ...options
  };
  config.skillRoot = path.resolve(config.skillRoot);
  return withLockSync(resolveLockPath(config.skillRoot), () => runPackageSmoke(config), { label: 'package-smoke' });
}

module.exports = { parsePackJson, tarEntries, assertPackagePaths, assertReleaseArtifact, main };
if (require.main === module) main({ requireReleaseArtifact: process.argv.includes('--require-release-artifact') });
