const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const skillRoot = path.resolve(__dirname, '../..');

test('CLI help documents every supported vNext control command', () => {
  const result = spawnSync(process.execPath, [path.join(skillRoot, 'scripts', 'daoge.js'), '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const command of ['archive-project', 'preflight', 'run', 'pause', 'resume', 'cancel', 'retry', 'resolve-unknown']) {
    assert.equal(result.stdout.includes('daoge ' + command + ' '), true);
  }
  assert.equal((result.stdout.match(/daoge preflight/g) || []).length, 1);
});
