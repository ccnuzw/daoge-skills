const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { parseArgs, parseEnvFile, writeJson } = require('./script_utils');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (~crc) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function makeSolidPng({ width, height, pixelAt }) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      const pixel = pixelAt(x, y);
      row[offset] = pixel[0];
      row[offset + 1] = pixel[1];
      row[offset + 2] = pixel[2];
      row[offset + 3] = pixel[3];
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createSmokeAssets(outputDir) {
  const assetsDir = path.join(outputDir, '_real_provider_assets');
  ensureDir(assetsDir);
  const referencePath = path.join(assetsDir, 'reference.png');
  const maskPath = path.join(assetsDir, 'mask.png');
  const referencePng = makeSolidPng({
    width: 1024,
    height: 1024,
    pixelAt: (x, y) => {
      const r = Math.floor(40 + (x / 1024) * 160);
      const g = Math.floor(60 + (y / 1024) * 120);
      const b = 120;
      return [r, g, b, 255];
    },
  });
  const maskPng = makeSolidPng({
    width: 1024,
    height: 1024,
    pixelAt: (x, y) => {
      const editable = x > 640 && y > 640;
      return editable ? [255, 255, 255, 0] : [255, 255, 255, 255];
    },
  });
  fs.writeFileSync(referencePath, referencePng);
  fs.writeFileSync(maskPath, maskPng);
  return { assetsDir, referencePath, maskPath };
}

function writePromptFiles(outputDir, referencePath, maskPath) {
  const promptsDir = path.join(outputDir, '_real_provider_prompts');
  ensureDir(promptsDir);

  const promptOnlyFile = path.join(promptsDir, 'prompt_only.json');
  const referenceFile = path.join(promptsDir, 'reference_assisted.json');
  const maskedFile = path.join(promptsDir, 'masked_edit.json');

  writeJson(promptOnlyFile, [
    {
      index: 1,
      slug: 'real-provider-prompt-only',
      title: 'Real Provider Prompt Only',
      generation_prompt: 'Photoreal premium product poster, clean studio light, single hero object, no text.',
    },
  ]);
  writeJson(referenceFile, [
    {
      index: 1,
      slug: 'real-provider-reference-assisted',
      title: 'Real Provider Reference Assisted',
      reference_mode: 'reference-assisted',
      reference_images: [referencePath],
      generation_prompt: 'Use the reference composition as guidance, keep premium studio lighting and clean product framing.',
    },
  ]);
  writeJson(maskedFile, [
    {
      index: 1,
      slug: 'real-provider-masked-edit',
      title: 'Real Provider Masked Edit',
      reference_mode: 'masked-edit',
      reference_images: [referencePath],
      mask_image: maskPath,
      generation_prompt: 'Only change the lower-right editable region into a refined gift-box highlight while preserving the rest.',
    },
  ]);

  return { promptOnlyFile, referenceFile, maskedFile };
}

function runBatch(scriptPath, envFile, promptsFile, outputDir) {
  execFileSync(process.execPath, [
    scriptPath,
    '--prompts-file', promptsFile,
    '--env-file', envFile,
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--concurrency', '1',
    '--retry-count', '0',
    '--timeout-seconds', '240',
    '--output-format', 'png',
    '--contact-sheet', 'false',
    '--width', '1024',
    '--height', '1024',
  ], {
    stdio: 'inherit',
  });
  return JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
}

function renderReport({ outputDir, envFile, env, liveRunConfirmed, runResults, notes }) {
  const reportPath = path.join(outputDir, 'real_provider_smoke_report.md');
  const lines = [
    '# Real Provider Smoke Report',
    '',
    `- Env file: ${envFile}`,
    `- Provider base URL present: ${env.OPENAI_BASE_URL ? 'yes' : 'no'}`,
    `- API key present: ${env.OPENAI_API_KEY ? 'yes' : 'no'}`,
    `- Image model: ${env.OPENAI_MODEL || 'gpt-image-2'}`,
    `- Responses model: ${env.OPENAI_RESPONSES_MODEL || 'gpt-5.4'}`,
    `- Live run confirmed: ${liveRunConfirmed ? 'yes' : 'no'}`,
    '',
    '## Notes',
    '',
    ...notes.map((item) => `- ${item}`),
    '',
    '## Results',
    '',
  ];

  if (!runResults.length) {
    lines.push('- No live provider calls were executed.');
  } else {
    runResults.forEach((item) => {
      lines.push(`- ${item.mode}: success ${item.manifest.success}, failed ${item.manifest.failed}, output ${item.outputDir}`);
    });
  }

  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`);
  return reportPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const envFile = path.resolve(args['env-file'] || path.join(cwd, '.env'));
  const outputDir = path.resolve(args['output-dir'] || path.join(cwd, 'generated_images', 'real_provider_smoke'));
  ensureDir(outputDir);

  const env = parseEnvFile(envFile);
  const notes = [];
  if (!env.OPENAI_BASE_URL) notes.push('OPENAI_BASE_URL is missing.');
  if (!env.OPENAI_API_KEY) notes.push('OPENAI_API_KEY is missing.');
  if (!env.OPENAI_MODEL) notes.push('OPENAI_MODEL is not set; runner will default to gpt-image-2.');
  if (!env.OPENAI_RESPONSES_MODEL) notes.push('OPENAI_RESPONSES_MODEL is not set; runner will default to gpt-5.4 for Responses-based steps.');

  const liveRunConfirmed = String(args['confirm-live-run'] || 'false').trim().toLowerCase() === 'true';
  const scriptPath = path.join(__dirname, 'run_batch.js');
  const runResults = [];

  if (liveRunConfirmed) {
    if (!env.OPENAI_BASE_URL || !env.OPENAI_API_KEY) {
      throw new Error(`Missing OPENAI_BASE_URL or OPENAI_API_KEY in ${envFile}`);
    }
    const { referencePath, maskPath } = createSmokeAssets(outputDir);
    const { promptOnlyFile, referenceFile, maskedFile } = writePromptFiles(outputDir, referencePath, maskPath);

    const promptOnlyDir = path.join(outputDir, 'prompt_only');
    const referenceDir = path.join(outputDir, 'reference_assisted');
    const maskedDir = path.join(outputDir, 'masked_edit');

    runResults.push({
      mode: 'prompt-only',
      outputDir: promptOnlyDir,
      manifest: runBatch(scriptPath, envFile, promptOnlyFile, promptOnlyDir),
    });
    runResults.push({
      mode: 'reference-assisted',
      outputDir: referenceDir,
      manifest: runBatch(scriptPath, envFile, referenceFile, referenceDir),
    });
    runResults.push({
      mode: 'masked-edit',
      outputDir: maskedDir,
      manifest: runBatch(scriptPath, envFile, maskedFile, maskedDir),
    });
  } else {
    notes.push('Live provider run was not executed because --confirm-live-run true was not provided.');
    notes.push('This script defaults to safe preflight mode to avoid accidental paid calls.');
  }

  const reportPath = renderReport({ outputDir, envFile, env, liveRunConfirmed, runResults, notes });
  console.log(JSON.stringify({
    outputDir,
    reportPath,
    liveRunConfirmed,
    executedModes: runResults.map((item) => item.mode),
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
