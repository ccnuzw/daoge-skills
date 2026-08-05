const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const skillRoot = path.resolve(__dirname, '..', '..');

function makeTempDir(prefix = 'daoge-v2-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runScript(scriptName, args, options = {}) {
  return execFileSync(process.execPath, [path.join(skillRoot, 'scripts', scriptName), ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
    ...options,
  });
}

function writeTinyPng(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pS3FoAAAAAASUVORK5CYII=', 'base64'));
}

function writeEnv(filePath) {
  fs.writeFileSync(filePath, [
    'OPENAI_BASE_URL=https://example.com/v1',
    'OPENAI_API_KEY=test-key',
    'OPENAI_MODEL=gpt-image-2',
  ].join('\n'));
}

function assertWorkspacePagesExist(assert, outputDir) {
  ['index', 'prepare', 'results', 'issues', 'record'].forEach((page) => {
    assert.equal(fs.existsSync(path.join(outputDir, 'workspace', `${page}.html`)), true, `missing ${page}.html`);
    assert.equal(fs.existsSync(path.join(outputDir, 'internal', 'view_models', `${page}.json`)), true, `missing ${page}.json`);
  });
}

module.exports = {
  skillRoot,
  makeTempDir,
  readJson,
  writeJson,
  runScript,
  writeTinyPng,
  writeEnv,
  assertWorkspacePagesExist,
};
