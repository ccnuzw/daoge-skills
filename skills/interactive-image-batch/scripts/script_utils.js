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

function readJsonIfExists(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) return null;
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function parseEnvFile(filePath) {
  const out = {};
  const raw = fs.readFileSync(path.resolve(filePath), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const normalizedLine = line.replace(/^\s*export\s+/, '');
    const idx = normalizedLine.indexOf('=');
    if (idx === -1) continue;
    const key = normalizedLine.slice(0, idx).trim();
    let value = normalizedLine.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1);
    }
    out[key] = value.trim();
  }
  return out;
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

function ensureDir(dirPath) {
  fs.mkdirSync(path.resolve(dirPath), { recursive: true });
}

function copyFileIntoDir(sourcePath, targetDir, targetName) {
  const absoluteSource = path.resolve(sourcePath);
  if (!fs.existsSync(absoluteSource)) {
    throw new Error(`Source file not found: ${absoluteSource}`);
  }
  ensureDir(targetDir);
  const extension = path.extname(absoluteSource).toLowerCase();
  const safeName = targetName ? String(targetName).trim() : path.basename(absoluteSource);
  const normalizedName = path.extname(safeName) ? safeName : `${safeName}${extension}`;
  const destination = path.resolve(path.join(targetDir, normalizedName));
  fs.copyFileSync(absoluteSource, destination);
  return destination;
}

module.exports = {
  parseArgs,
  readJson,
  readJsonIfExists,
  parseEnvFile,
  writeJson,
  fileExists,
  chunkArray,
  resolvePromptFileForRerun,
  ensureDir,
  copyFileIntoDir,
};
