const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { skillRoot, readJson } = require('../helpers/workspace_v2_test_utils');

test('npm package publishes runtime files and excludes tests, reports and catalog html', () => {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
  const [pack] = JSON.parse(output);
  const files = pack.files.map((item) => item.path);
  assert.equal(files.includes('src/cli/daoge.js'), true);
  assert.equal(files.includes('scripts/daoge.js'), true);
  assert.equal(files.includes('README.md'), true);
  assert.equal(files.includes('SKILL.md'), true);
  assert.equal(files.includes('agents/openai.yaml'), true);
  assert.equal(files.includes('references/runner.md'), true);
  assert.equal(files.some((file) => file.startsWith('tests/')), false);
  assert.equal(files.some((file) => file.startsWith('docs/')), false);
  assert.equal(files.includes('references/examples/examples_catalog.html'), false);
  assert.equal(files.includes('references/template_registry_report.html'), false);
  assert.equal(files.includes('references/template_registry_validation_report.json'), false);
});

test('contact sheet is not advertised in CLI-facing presets or docs', () => {
  const presets = readJson(path.join(skillRoot, 'references', 'run_presets_zh.json'));
  presets.presets.forEach((preset) => {
    assert.equal(Object.prototype.hasOwnProperty.call(preset.values, 'contact_sheet'), false);
  });
  [
    'references/runner.md',
    'references/task_spec.md',
    'references/guided_intake.md',
    'references/trigger_modes_zh.md',
  ].forEach((relativePath) => {
    const text = fs.readFileSync(path.join(skillRoot, relativePath), 'utf8');
    assert.doesNotMatch(text, /contact[_-]sheet|contact_sheet\.png/);
  });
});
