const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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

function assertPackagePaths(paths) {
  const required = ['dist/vnext/cli/daoge.js', 'dist/vnext/cli/daemon.js', 'dist/workbench/index.html', 'scripts/daoge.js', 'SKILL.md', 'README.md', 'references/provider.env.example', 'docs/daoge_pic_vnext_upgrade_spec_zh.md'];
  const allowed = /^(dist\/|scripts\/daoge\.js$|references\/provider\.env\.example$|docs\/daoge_pic_vnext_upgrade_spec_zh\.md$|README\.md$|SKILL\.md$|LICENSE$|package\.json$)/;
  const missing = required.filter((file) => !paths.includes(file));
  const unexpected = paths.filter((file) => !allowed.test(file));
  const maps = paths.filter((file) => file.endsWith('.map'));
  const retired = paths.filter((file) => /^(app|agents|src|tests|references\/(?!provider\.env\.example$)|Dockerfile$|docker-compose\.yml$|\.env\.example$|\.dockerignore$)/.test(file) || file.includes('legacy-adapters'));
  if (missing.length || unexpected.length || maps.length || retired.length) throw new Error(JSON.stringify({ missing, unexpected, maps, retired }, null, 2));
  return { missing, unexpected, maps, retired };
}

function main({ runCommand = run, removeSync = fs.rmSync } = {}) {
  const skillRoot = path.resolve(__dirname, '..');
  let tarballPath = null;
  let consumerRoot = null;
  try {
    const packed = runCommand('npm', ['pack', '--json', '--ignore-scripts'], { cwd: skillRoot });
    const packages = parsePackJson(packed.stdout);
    const metadata = packages[0];
    tarballPath = path.resolve(skillRoot, metadata.filename);
    const paths = metadata.files.map((file) => file.path);
    const checked = assertPackagePaths(paths);
    if (!fs.existsSync(tarballPath)) throw new Error('npm pack did not create the reported tarball: ' + metadata.filename);

    consumerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-package-smoke-'));
    fs.writeFileSync(path.join(consumerRoot, 'package.json'), JSON.stringify({ private: true }, null, 2) + '\n');
    runCommand('npm', ['install', tarballPath, '--ignore-scripts'], { cwd: consumerRoot });
    const installedRoot = path.join(consumerRoot, 'node_modules', 'daoge-pic');
    const runtimeRequired = ['scripts/daoge.js', 'dist/vnext/cli/daemon.js', 'dist/workbench/index.html', 'references/provider.env.example'];
    const runtimeMissing = runtimeRequired.filter((file) => !fs.existsSync(path.join(installedRoot, file)));
    if (runtimeMissing.length) throw new Error(JSON.stringify({ runtimeMissing }, null, 2));
    const installedBin = path.join(consumerRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'daoge.cmd' : 'daoge');
    const help = runCommand(installedBin, ['--help'], { cwd: consumerRoot });
    if (!help.stdout.includes('DAOGE Pic vNext Studio')) throw new Error('Installed daoge --help did not execute the packaged bin.');
    process.stdout.write(JSON.stringify({ files: paths.length, unexpected: checked.unexpected.length, maps: checked.maps.length, retired: checked.retired.length, installed: true, bin: true, help: true }, null, 2) + '\n');
  } finally {
    if (tarballPath) removeSync(tarballPath, { force: true });
    if (consumerRoot) fs.rmSync(consumerRoot, { recursive: true, force: true });
  }
}

module.exports = { parsePackJson, assertPackagePaths, main };
if (require.main === module) main();
