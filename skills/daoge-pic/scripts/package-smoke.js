const { spawnSync } = require('node:child_process');

const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
if (packed.status !== 0) {
  process.stderr.write(packed.stderr || packed.stdout || 'npm pack --dry-run failed.\n');
  process.exit(packed.status || 1);
}
const jsonStart = packed.stdout.lastIndexOf('\n[');
if (jsonStart < 0) throw new Error('npm pack did not emit JSON metadata.');
const packages = JSON.parse(packed.stdout.slice(jsonStart + 1));
const paths = (packages[0]?.files || []).map((file) => file.path);
const required = ['dist/vnext/cli/daoge.js', 'dist/workbench/index.html', 'SKILL.md', 'README.md', 'references/provider.env.example', 'docs/daoge_pic_vnext_upgrade_spec_zh.md'];
const missing = required.filter((file) => !paths.includes(file));
const maps = paths.filter((file) => file.endsWith('.map'));
const retired = paths.filter((file) => /^(app|agents|src(?!\/vnext)|tests|references\/(?!provider\.env\.example$)|Dockerfile$|docker-compose\.yml$|\.env\.example$|\.dockerignore$)/.test(file) || file.includes('legacy-adapters'));
if (missing.length || maps.length || retired.length) {
  process.stderr.write(JSON.stringify({ missing, maps, retired }, null, 2) + '\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify({ files: paths.length, maps: maps.length, retired: retired.length }, null, 2) + '\n');
