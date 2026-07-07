const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensureDir } = require('../shared/workspace');

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const commandCache = new Map();

function hasCommand(command) {
  if (commandCache.has(command)) return commandCache.get(command);
  const result = spawnSync('which', [command], { encoding: 'utf8' });
  const available = result.status === 0;
  commandCache.set(command, available);
  return available;
}

function thumbExtFor(mime) {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  return '.jpg';
}

function isImageMime(mime) {
  return IMAGE_MIMES.has(String(mime || '').toLowerCase());
}

function generateThumbnail(outputDir, assetId, sourcePath, mime) {
  const absoluteSource = path.resolve(sourcePath || '');
  if (!sourcePath || !isImageMime(mime) || !fs.existsSync(absoluteSource) || !fs.statSync(absoluteSource).isFile()) {
    return { status: 'missing', path: null };
  }
  const thumbsDir = path.join(path.resolve(outputDir), 'assets', 'thumbs');
  ensureDir(thumbsDir);
  const ext = thumbExtFor(mime);
  const targetPath = path.join(thumbsDir, `${assetId}${ext}`);
  const relativeTarget = path.relative(path.resolve(outputDir), targetPath).split(path.sep).join('/');
  if (fs.existsSync(targetPath)) return { status: 'ready', path: relativeTarget };

  if (hasCommand('sips') && (mime === 'image/png' || mime === 'image/jpeg')) {
    const result = spawnSync('sips', ['-Z', '480', absoluteSource, '--out', targetPath], { encoding: 'utf8' });
    if (result.status === 0 && fs.existsSync(targetPath)) return { status: 'ready', path: relativeTarget };
  }

  if (hasCommand('ffmpeg')) {
    const ffmpegTarget = path.join(thumbsDir, `${assetId}.jpg`);
    if (fs.existsSync(ffmpegTarget)) {
      return { status: 'ready', path: path.relative(path.resolve(outputDir), ffmpegTarget).split(path.sep).join('/') };
    }
    const result = spawnSync('ffmpeg', ['-y', '-i', absoluteSource, '-vf', 'scale=480:-1', '-frames:v', '1', ffmpegTarget], {
      encoding: 'utf8',
      stdio: 'ignore',
    });
    if (result.status === 0 && fs.existsSync(ffmpegTarget)) {
      return { status: 'ready', path: path.relative(path.resolve(outputDir), ffmpegTarget).split(path.sep).join('/') };
    }
  }

  return { status: 'missing', path: null };
}

module.exports = { generateThumbnail, isImageMime };
