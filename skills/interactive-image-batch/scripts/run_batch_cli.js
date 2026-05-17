function portableRunnerPreambleLines() {
  return [
    'DAOGE_RUNNER="${DAOGE_RUNNER_PATH:-./.codex/skills/interactive-image-batch/scripts/run_batch.js}"',
    'if [ ! -f "$DAOGE_RUNNER" ]; then DAOGE_RUNNER="${CODEX_HOME:-$HOME/.codex}/skills/interactive-image-batch/scripts/run_batch.js"; fi',
  ];
}

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;
}

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

module.exports = {
  portableRunnerPreambleLines,
  shellQuote,
  parseArgs,
};
