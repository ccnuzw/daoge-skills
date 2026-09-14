'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_STALE_LOCK_MS = 30_000;
const DEFAULT_POLL_MS = 100;
const LOCK_TOKEN_ENV = 'DAOGE_PIC_DIST_LOCK_TOKEN';
const LOCK_PATH_ENV = 'DAOGE_PIC_DIST_LOCK_PATH';

function randomToken() {
  return crypto.randomBytes(18).toString('hex');
}

function ownerPath(lockPath) {
  return path.join(lockPath, 'owner.json');
}

function readOwner(lockPath) {
  try {
    const text = fs.readFileSync(ownerPath(lockPath), 'utf8');
    const owner = JSON.parse(text);
    if (!owner || typeof owner !== 'object') return null;
    return owner;
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error instanceof SyntaxError)) return null;
    return null;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is not signalable by this user.
    return error && error.code === 'EPERM';
  }
}

function statAge(lockPath) {
  try {
    return Math.max(0, Date.now() - fs.statSync(lockPath).mtimeMs);
  } catch {
    return 0;
  }
}

function ownerIsLive(owner) {
  return Boolean(owner && isProcessAlive(Number(owner.pid)));
}

function ownerTokenIs(owner, token) {
  return Boolean(owner && typeof owner.token === 'string' && owner.token === token);
}

function isHeldByToken(lockPath, token) {
  if (!token || !fs.existsSync(lockPath)) return false;
  return ownerTokenIs(readOwner(lockPath), token);
}

function quarantinePath(lockPath) {
  return lockPath + '.stale-' + process.pid + '-' + randomToken();
}

function removeQuietly(filePath) {
  try {
    fs.rmSync(filePath, { recursive: true, force: true });
  } catch {
    // A competing process may have removed it already.
  }
}

function reclaimStaleLock(lockPath, { staleLockMs }) {
  const owner = readOwner(lockPath);
  const stale = owner ? !ownerIsLive(owner) : statAge(lockPath) >= staleLockMs;
  if (!stale) return false;

  // Move the exact lock directory out of the way before deleting it. A new
  // owner can mkdir(lockPath) while the stale directory is quarantined; in
  // that case it is deliberately left untouched.
  const quarantined = quarantinePath(lockPath);
  try {
    fs.renameSync(lockPath, quarantined);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return true;
    if (error && (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EBUSY')) return false;
    throw error;
  }

  const movedOwner = readOwner(quarantined);
  if (!movedOwner || !ownerTokenIs(movedOwner, owner?.token)) {
    // The metadata was incomplete when we observed it. It is safe to discard
    // only if it is still incomplete; a live owner should be restored.
    if (!ownerIsLive(movedOwner)) removeQuietly(quarantined);
    else {
      try { fs.renameSync(quarantined, lockPath); } catch (restoreError) {
        if (!(restoreError && restoreError.code === 'EEXIST')) throw restoreError;
      }
    }
    return true;
  }

  if (ownerIsLive(movedOwner)) {
    try { fs.renameSync(quarantined, lockPath); } catch (restoreError) {
      if (!(restoreError && restoreError.code === 'EEXIST')) throw restoreError;
    }
    return false;
  }
  removeQuietly(quarantined);
  return true;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
function sleepSync(milliseconds) {
  if (milliseconds <= 0) return;
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, milliseconds);
}


function releaseLock(handle) {
  if (!handle || handle.released) return false;
  handle.released = true;
  const owner = readOwner(handle.lockPath);
  if (!ownerTokenIs(owner, handle.token)) return false;
  removeQuietly(handle.lockPath);
  return true;
}

async function acquireLock(lockPath, options = {}) {
  const staleLockMs = Number.isFinite(options.staleLockMs) ? Math.max(0, options.staleLockMs) : DEFAULT_STALE_LOCK_MS;
  const pollMs = Number.isFinite(options.pollMs) ? Math.max(10, options.pollMs) : DEFAULT_POLL_MS;
  const timeoutMs = options.timeoutMs == null ? null : Math.max(0, Number(options.timeoutMs));
  const deadline = timeoutMs == null ? Infinity : Date.now() + timeoutMs;
  const token = options.token || randomToken();
  const label = options.label || 'daoge-pic';
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      const owner = {
        pid: process.pid,
        token,
        startedAt: new Date().toISOString(),
        hostname: os.hostname(),
        platform: process.platform,
        label,
      };
      const temporaryOwner = ownerPath(lockPath) + '.tmp-' + token;
      fs.writeFileSync(temporaryOwner, JSON.stringify(owner) + '\n', { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temporaryOwner, ownerPath(lockPath));
      return { lockPath, token, owner, released: false, release() { return releaseLock(this); } };
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        if (reclaimStaleLock(lockPath, { staleLockMs })) continue;
        if (Date.now() >= deadline) {
          const owner = readOwner(lockPath);
          throw new Error('Timed out waiting for dist lock ' + lockPath + (owner?.pid ? ' held by pid ' + owner.pid : '') + '.');
        }
        await wait(Math.min(pollMs, Math.max(10, deadline - Date.now())));
        continue;
      }
      // If owner metadata creation failed, do not strand a lock owned by this
      // process. A failed rename can only happen before another process sees a
      // valid owner record.
      if (fs.existsSync(lockPath) && !readOwner(lockPath)) removeQuietly(lockPath);
      throw error;
    }
  }
}
function acquireLockSync(lockPath, options = {}) {
  const staleLockMs = Number.isFinite(options.staleLockMs) ? Math.max(0, options.staleLockMs) : DEFAULT_STALE_LOCK_MS;
  const pollMs = Number.isFinite(options.pollMs) ? Math.max(10, options.pollMs) : DEFAULT_POLL_MS;
  const timeoutMs = options.timeoutMs == null ? null : Math.max(0, Number(options.timeoutMs));
  const deadline = timeoutMs == null ? Infinity : Date.now() + timeoutMs;
  const token = options.token || randomToken();
  const label = options.label || 'daoge-pic';
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      const owner = {
        pid: process.pid,
        token,
        startedAt: new Date().toISOString(),
        hostname: os.hostname(),
        platform: process.platform,
        label,
      };
      const temporaryOwner = ownerPath(lockPath) + '.tmp-' + token;
      fs.writeFileSync(temporaryOwner, JSON.stringify(owner) + '\n', { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temporaryOwner, ownerPath(lockPath));
      return { lockPath, token, owner, released: false, release() { return releaseLock(this); } };
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        if (reclaimStaleLock(lockPath, { staleLockMs })) continue;
        if (Date.now() >= deadline) {
          const owner = readOwner(lockPath);
          throw new Error('Timed out waiting for dist lock ' + lockPath + (owner?.pid ? ' held by pid ' + owner.pid : '') + '.');
        }
        sleepSync(Math.min(pollMs, Math.max(10, deadline - Date.now())));
        continue;
      }
      if (fs.existsSync(lockPath) && !readOwner(lockPath)) removeQuietly(lockPath);
      throw error;
    }
  }
}


async function withLock(lockPath, fn, options = {}) {
  const handle = await acquireLock(lockPath, options);
  try {
    return await fn(handle);
  } finally {
    handle.release();
  }
}
function withLockSync(lockPath, fn, options = {}) {
  const handle = acquireLockSync(lockPath, options);
  try {
    return fn(handle);
  } finally {
    handle.release();
  }
}


function resolveLockPath(workspace) {
  const configured = String(process.env[LOCK_PATH_ENV] || '').trim();
  return configured ? path.resolve(configured) : path.join(workspace, '.daoge-pic-dist.lock');
}

module.exports = {
  DEFAULT_STALE_LOCK_MS,
  LOCK_PATH_ENV,
  LOCK_TOKEN_ENV,
  acquireLockSync,
  acquireLock,
  isHeldByToken,
  releaseLock,
  resolveLockPath,
  withLock,
  withLockSync,
};
