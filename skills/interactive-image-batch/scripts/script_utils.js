const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
    args[key] = value;
    if (value !== 'true') i += 1;
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(path.resolve(filePath), JSON.stringify(value, null, 2));
}

function fileExists(filePath) {
  return fs.existsSync(path.resolve(filePath));
}

function chunkArray(items, chunkSize) {
  const out = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    out.push(items.slice(i, i + chunkSize));
  }
  return out;
}

function resolvePromptFileForRerun(manifest, outputDir) {
  const localPromptCopy = path.join(outputDir, 'prompts.generated.json');
  if (manifest.promptSnapshot && fileExists(manifest.promptSnapshot)) return manifest.promptSnapshot;
  if (fileExists(localPromptCopy)) return localPromptCopy;
  return manifest.promptSource || localPromptCopy;
}

module.exports = {
  parseArgs,
  readJson,
  writeJson,
  fileExists,
  chunkArray,
  resolvePromptFileForRerun,
};
