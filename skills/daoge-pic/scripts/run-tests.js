#!/usr/bin/env node
'use strict';

/**
 * Regression entry point.
 *
 * The suite has to start from a known environment, and `--env-file` cannot
 * provide that: Node lets an existing environment variable win over the file,
 * so an ambient `HTTP_PROXY` (agent runtimes and CI images commonly export one)
 * would silently reroute the Provider transport tests through it and defeat
 * every DNS-pinning assertion. Deleting the proxy variables here — in a real
 * process, before the runner starts — is the only portable way to guarantee it.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { LOCK_TOKEN_ENV, isHeldByToken, resolveLockPath, withLock } = require('./build-lock');

const workspace = path.join(__dirname, '..');
const PROXY_ENVIRONMENT = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'];

const childEnvironment = { ...process.env, DAOGE_PIC_PROVIDER_SECRET_BACKEND: 'plaintext' };
for (const name of PROXY_ENVIRONMENT) delete childEnvironment[name];

function regressionFiles() {
  const directory = path.join(workspace, 'tests', 'vnext');
  return fs.readdirSync(directory).filter((name) => name.endsWith('.test.js')).sort().map((name) => path.join('tests', 'vnext', name));
}

function run(files) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--env-file=tests/vnext/test.env', '--test', '--test-concurrency=1', ...files], { cwd: workspace, env: childEnvironment, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 1 : (code === null ? 1 : code)));
  });
}

async function main() {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : regressionFiles();
  const lockPath = resolveLockPath(workspace);
  // A regression test may invoke this runner recursively. The inherited token
  // is accepted only while its parent still owns the lock; unrelated callers
  // must always acquire the lock normally.
  const inheritedToken = process.env[LOCK_TOKEN_ENV];
  if (isHeldByToken(lockPath, inheritedToken)) {
    process.exitCode = await run(files);
    return;
  }
  // Tests load compiled modules lazily in separate Node processes. Keep the
  // writer lock until every test exits so build-vnext cannot swap dist/vnext
  // between module resolution and loading.
  const exitCode = await withLock(lockPath, (handle) => {
    childEnvironment[LOCK_TOKEN_ENV] = handle.token;
    return run(files);
  }, { label: 'vnext-tests' });
  process.exitCode = exitCode;
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write((error && error.stack) || String(error));
    process.stderr.write('\n');
    process.exitCode = 1;
  });
}

module.exports = { main, regressionFiles, run };
