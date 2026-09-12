const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const zlib = require('node:zlib');

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
  const checked = assertPackagePaths(paths);
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
  const expectedRange = '>=' + expectedVersion + ' <6.0.0';
  const mismatch = {
    package: packageJson,
    protocolManifest,
    runtimeVersion,
    runtimeRange,
    declaredRuntimeVersion,
    declaredRuntimeRange,
    expectedVersion,
    expectedRange
  };
  if (!packageJson || packageJson.name !== 'daoge-pic' || packageJson.version !== expectedVersion || !protocolManifest || protocolManifest.protocol !== 'daoge-pic-skill-protocol' || protocolManifest.version !== '2.0.0' || protocolManifest.runtimeCompatibility !== expectedRange || runtimeVersion !== expectedVersion || runtimeRange !== expectedRange || declaredRuntimeVersion !== expectedVersion || declaredRuntimeRange !== expectedRange) {
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

function assertPackagePaths(paths) {
  const required = ['dist/vnext/cli/daoge.js', 'dist/vnext/cli/daemon.js', 'dist/vnext/cli/daemon-shutdown.js', 'dist/vnext/cli/daemon-shutdown.d.ts', 'dist/vnext/studio/provider-store.js', 'dist/vnext/runtime/restart.js', 'dist/workbench/index.html', 'scripts/daoge.js', 'SKILL.md', 'README.md', 'protocol-version.json', 'references/provider.env.example', 'docs/daoge_pic_vnext_upgrade_spec_zh.md', 'docs/vnext_verification_evidence_zh.md'];
  const allowed = /^(dist\/(?:vnext\/(?:api|cli|domain|media|providers|runner|runtime|shared|studio)\/[A-Za-z0-9._/-]+|workbench\/(?:index\.html|assets\/[A-Za-z0-9._-]+))$|scripts\/daoge\.js$|references\/provider\.env\.example$|docs\/(?:daoge_pic_vnext_upgrade_spec_zh|vnext_verification_evidence_zh)\.md$|README\.md$|SKILL\.md$|protocol-version\.json$|LICENSE$|package\.json$)/;
  const missing = required.filter((file) => !paths.includes(file));
  const unexpected = paths.filter((file) => !allowed.test(file));
  const maps = paths.filter((file) => file.endsWith('.map'));
  const retired = paths.filter((file) => /^(app|agents|src|tests|references\/(?!provider\.env\.example$)|Dockerfile$|docker-compose\.yml$|\.env\.example$|\.dockerignore$)/.test(file) || file.includes('legacy-adapters') || file.includes('legacy-daemon'));
  const sensitive = paths.filter(isSensitivePackagePath);
  if (missing.length || unexpected.length || maps.length || retired.length || sensitive.length) throw new Error(JSON.stringify({ missing, unexpected, maps, retired, sensitive }, null, 2));
  return { missing, unexpected, maps, retired, sensitive };
}

function main({ runCommand = run, makeTemp = fs.mkdtempSync, removeSync = fs.rmSync, skillRoot = path.resolve(__dirname, '..'), requireReleaseArtifact = true } = {}) {
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
    const runtimeRequired = ['scripts/daoge.js', 'dist/vnext/cli/daemon.js', 'dist/vnext/cli/daemon-shutdown.js', 'dist/vnext/cli/daemon-shutdown.d.ts', 'dist/vnext/shared/windows.js', 'dist/vnext/studio/provider-store.js', 'dist/vnext/runtime/restart.js', 'dist/workbench/index.html', 'protocol-version.json', 'references/provider.env.example'];
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

module.exports = { parsePackJson, tarEntries, assertPackagePaths, assertReleaseArtifact, main };
if (require.main === module) main({ requireReleaseArtifact: process.argv.includes('--require-release-artifact') });
