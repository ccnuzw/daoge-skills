const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./script_utils');
const { loadTaskCenterState } = require('./task_center_state_shared');

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['index-file']) throw new Error('Missing required flag: --index-file');

  const indexPath = path.resolve(args['index-file']);
  const markdownPath = path.resolve(args['markdown-file'] || path.join(path.dirname(indexPath), 'daoge_run_index.md'));
  const taskCenterState = loadTaskCenterState(indexPath, {
    stateFile: args['state-file'] || null,
  });
  const lines = taskCenterState.markdownLines;

  fs.writeFileSync(markdownPath, `${lines.join('\n')}\n`);
  console.log(JSON.stringify({ indexPath, markdownPath, totalRuns: taskCenterState.totalRuns }, null, 2));
}

main();
