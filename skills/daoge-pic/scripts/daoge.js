#!/usr/bin/env node
const { main } = require('../dist/vnext/cli/daoge.js');

void main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.message : 'DAOGE Pic 命令失败。') + '\n');
  process.exitCode = 1;
});
