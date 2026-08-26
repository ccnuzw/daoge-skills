const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const skillRoot = path.resolve(__dirname, '../..');

function entries(directory) {
  return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
}

test('vNext source tree excludes the retired workflow and static workbench', () => {
  for (const retired of [
    '.dockerignore', '.env.example', 'Dockerfile', 'agents', 'app', 'docker-compose.yml', '.docker-workspace',
    'scripts/probe_gemini_image_provider.js', 'scripts/probe_gemini_openai_provider.js', 'scripts/run_smoke_tests.sh',
    'src/vnext/providers/legacy-adapters.ts'
  ]) {
    assert.equal(fs.existsSync(path.join(skillRoot, retired)), false, retired + ' must not remain in the vNext tree');
  }
  assert.deepEqual(entries(path.join(skillRoot, 'src')), ['vnext']);
  assert.deepEqual(entries(path.join(skillRoot, 'tests')), ['vnext']);
  assert.deepEqual(entries(path.join(skillRoot, 'references')), ['provider.env.example']);
  assert.deepEqual(entries(path.join(skillRoot, 'docs')), ['daoge_pic_vnext_upgrade_spec_zh.md', 'vnext_verification_evidence_zh.md']);
});
