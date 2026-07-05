#!/usr/bin/env node
const path = require('path');
const { parseArgs } = require('../shared/workspace');
const { prepareTask } = require('../domain/prepare_service');
const { executeTask } = require('../domain/execution_service');
const { ingestHostNativeResults } = require('../providers/host_native');
const { refreshWorkspace } = require('../domain/workspace_service');

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
}

function commandFrom(argv) {
  const [command, ...rest] = argv;
  if (command && !command.startsWith('--')) return { command, rest };
  return { command: 'prepare', rest: argv };
}

async function main(argv = process.argv.slice(2)) {
  const { command, rest } = commandFrom(argv);
  const args = parseArgs(rest);
  if (command === 'prepare') {
    return prepareTask({
      taskSpecFile: args['task-spec'],
      strategyFile: args['strategy-file'],
      promptsFile: args['prompts-file'],
      outputDir: args['output-dir'],
      batchSize: args['batch-size'],
      intent: args.intent,
    });
  }
  if (command === 'execute') {
    return executeTask({
      promptsFile: args['prompts-file'],
      taskSpecFile: args['task-spec'],
      envFile: args['env-file'],
      outputDir: args['output-dir'],
      batchSize: args['batch-size'],
      concurrency: args.concurrency,
      retryCount: args['retry-count'],
      timeoutSeconds: args['timeout-seconds'],
      width: args.width,
      height: args.height,
      outputFormat: args['output-format'],
      dryRun: args['dry-run'] === 'true' || args['dry-run'] === '1',
      skipExisting: args['skip-existing'],
      generatePath: args['generate-path'],
      editPath: args['edit-path'],
    });
  }
  if (command === 'rerun') {
    return executeTask({
      promptsFile: args['prompts-file'],
      taskSpecFile: args['task-spec'],
      envFile: args['env-file'],
      outputDir: args['output-dir'],
      batchSize: args['batch-size'],
      concurrency: args.concurrency,
      retryCount: args['retry-count'],
      timeoutSeconds: args['timeout-seconds'],
      width: args.width,
      height: args.height,
      outputFormat: args['output-format'],
      dryRun: args['dry-run'] === 'true' || args['dry-run'] === '1',
      skipExisting: args['skip-existing'],
      generatePath: args['generate-path'],
      editPath: args['edit-path'],
      resumeManifestFile: args['resume-manifest'],
      failedOnly: args['failed-only'],
    });
  }
  if (command === 'ingest') {
    return ingestHostNativeResults({
      promptPackFile: args['prompt-pack-file'],
      resultsFile: args['results-file'],
      outputDir: args['output-dir'],
    });
  }
  if (command === 'refresh') {
    return refreshWorkspace({
      outputDir: path.resolve(args['output-dir'] || process.cwd()),
      taskSpecFile: args['task-spec'],
      promptsFile: args['prompts-file'],
      manifestFile: args['manifest-file'],
      resultsFile: args['results-file'],
    });
  }
  throw new Error(`未知命令：${command}`);
}

if (require.main === module) {
  main()
    .then(printResult)
    .catch((error) => {
      console.error(String(error.message || error));
      process.exit(1);
    });
}

module.exports = { main };
