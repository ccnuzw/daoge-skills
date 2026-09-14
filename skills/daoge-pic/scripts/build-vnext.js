'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { withLock, resolveLockPath } = require('./build-lock');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist', 'vnext');
const temp = path.join(root, 'dist', '.vnext-build-' + process.pid + '-' + crypto.randomBytes(8).toString('hex'));
const backup = path.join(root, 'dist', '.vnext-previous-' + process.pid + '-' + crypto.randomBytes(8).toString('hex'));

function remove(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function compile() {
  const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(process.execPath, [tsc, '-p', path.join(root, 'tsconfig.vnext.json'), '--outDir', temp], {
    cwd: root,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('TypeScript build failed with exit code ' + result.status + '.');
  if (!fs.existsSync(path.join(temp, 'cli', 'daoge.js'))) throw new Error('TypeScript build produced no vNext CLI entrypoint.');
}

async function main() {
  await withLock(resolveLockPath(root), async () => {
    remove(temp);
    remove(backup);
    let movedPrevious = false;
    try {
      compile();
      if (fs.existsSync(dist)) {
        fs.renameSync(dist, backup);
        movedPrevious = true;
      }
      fs.renameSync(temp, dist);
      if (movedPrevious) remove(backup);
    } catch (error) {
      remove(temp);
      if (movedPrevious && !fs.existsSync(dist) && fs.existsSync(backup)) fs.renameSync(backup, dist);
      throw error;
    }
  }, { label: 'vnext-build' });
}

main().catch((error) => {
  process.stderr.write((error && error.stack) || String(error));
  process.stderr.write('\n');
  process.exitCode = 1;
});
