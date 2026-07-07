#!/usr/bin/env node
const path = require('path');
const { parseArgs, STABLE_CLI_COMMANDS, writeJson } = require('../shared/workspace');
const { prepareTask } = require('../domain/prepare_service');
const { executeTask } = require('../domain/execution_service');
const { ingestHostNativeResults } = require('../providers/host_native');
const { refreshWorkspace } = require('../domain/workspace_service');
const { searchTemplateDirectory } = require('../domain/template_catalog');
const { syncWorkspaceToDbIfAvailable } = require('../db/sync');
const { initializeProject: initializeProjectDb, projectIdFor, openProjectDatabase, all, rowsToObjects, createExport, createSnapshot, createJob, updateJobStatus, closeDatabase } = require('../db/repository');
const { registerProject, listRecentProjects } = require('../db/library');
const { startWorkbenchServer } = require('../server/server');

const SUPPORTED_CLI_COMMANDS = [...STABLE_CLI_COMMANDS, 'init', 'open', 'projects', 'library', 'export', 'catalog'];

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
}

function commandFrom(argv) {
  const [command, ...rest] = argv;
  if (command && !command.startsWith('--')) return { command, rest };
  return { command: null, rest: argv };
}

function firstPositional(rest) {
  return rest.find((item) => !String(item).startsWith('--')) || null;
}

function unknownCommandError(command) {
  const name = command || '缺少命令';
  return new Error(`未知命令：${name}. 支持命令：${SUPPORTED_CLI_COMMANDS.join(', ')}`);
}

async function main(argv = process.argv.slice(2)) {
  const { command, rest } = commandFrom(argv);
  const args = parseArgs(rest);
  const subcommand = firstPositional(rest);
  if (command === 'init') {
    const outputDir = path.resolve(args['output-dir'] || args.workspace || process.cwd());
    const project = initializeProjectDb(outputDir, { name: args.name || path.basename(outputDir) });
    registerProject({
      id: project.projectId,
      name: args.name || path.basename(outputDir),
      rootPath: outputDir,
      dbPath: project.dbPath,
    });
    closeDatabase(project.db);
    return {
      outputDir,
      database: project.dbPath,
      nextAction: `运行 node scripts/daoge.js open --output-dir ${outputDir}`,
    };
  }
  if (command === 'open') {
    const outputDir = path.resolve(args['output-dir'] || args.workspace || process.cwd());
    const started = await startWorkbenchServer({
      outputDir,
      host: args.host || '127.0.0.1',
      port: args.port || 0,
    });
    registerProject({
      id: started.projectId,
      name: path.basename(outputDir),
      rootPath: outputDir,
      dbPath: started.dbPath,
    });
    console.log(`DAOGE 工作台：${started.url}`);
    console.log('按 Ctrl+C 停止本地服务。');
    return {
      url: started.url,
      outputDir,
      database: started.dbPath,
      imported: started.imported,
    };
  }
  if (command === 'projects' || command === 'library') {
    const outputDir = path.resolve(args['output-dir'] || args.workspace || process.cwd());
    if (subcommand === 'register') {
      const project = initializeProjectDb(outputDir, { name: args.name || path.basename(outputDir) });
      registerProject({
        id: project.projectId,
        name: args.name || path.basename(outputDir),
        rootPath: outputDir,
        dbPath: project.dbPath,
      });
      closeDatabase(project.db);
    }
    return {
      projects: listRecentProjects(Number(args.limit || 20)),
      nextAction: '使用 node scripts/daoge.js open --output-dir <项目目录> 打开项目',
    };
  }
  if (command === 'export') {
    const outputDir = path.resolve(args['output-dir'] || args.workspace || process.cwd());
    const dbSync = syncWorkspaceToDbIfAvailable(outputDir, { snapshotPrefix: 'export_refresh' });
    if (dbSync.dbWarning) return { outputDir, dbWarning: dbSync.dbWarning };
    const db = openProjectDatabase(outputDir);
    const projectId = projectIdFor(outputDir);
    if (subcommand === 'pack') {
      const jobId = createJob(db, projectId, 'export_pack', { source: 'cli' });
      updateJobStatus(db, projectId, jobId, 'running', { startedAt: new Date().toISOString() });
      const selected = rowsToObjects(all(db, `
        SELECT assets.* FROM assets
        JOIN selections ON selections.asset_id = assets.id
        WHERE assets.project_id = ? AND selections.state = 'selected'
        ORDER BY selections.updated_at DESC
      `, [projectId]));
      const pack = { generatedAt: new Date().toISOString(), projectId, selectedAssets: selected };
      const packPath = path.join(outputDir, 'assets', 'exports', 'selected_pack_manifest.json');
      writeJson(packPath, pack);
      createSnapshot(outputDir, 'export_pack', pack);
      createExport(db, projectId, 'pack', '已选资产包清单', 'assets/exports/selected_pack_manifest.json', { selected: selected.length });
      updateJobStatus(db, projectId, jobId, 'succeeded', {
        result: { path: packPath, selected: selected.length },
        completedAt: new Date().toISOString(),
      });
      return { outputDir, export: 'pack', jobId, path: packPath, selected: selected.length };
    }
    const { createReport } = require('../server/routes/exports');
    const report = await createReport({ db, projectId, outputDir });
    return { outputDir, export: 'report', path: path.join(outputDir, report.path), counts: report.report.counts };
  }
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
      provider: args.provider,
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
      provider: args.provider,
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
  if (command === 'review') {
    const workspace = refreshWorkspace({
      outputDir: path.resolve(args['output-dir'] || process.cwd()),
      taskSpecFile: args['task-spec'],
      promptsFile: args['prompts-file'],
      manifestFile: args['manifest-file'],
      resultsFile: args['results-file'],
    });
    const dbSync = syncWorkspaceToDbIfAvailable(workspace.outputDir, {
      snapshotPrefix: 'run_review',
      manifestFile: args['manifest-file'],
      phase: args['manifest-file'] ? 'review' : null,
    });
    return {
      ...workspace,
      database: dbSync.dbPath || null,
      dbWarning: dbSync.dbWarning || null,
    };
  }
  if (command === 'catalog') {
    return searchTemplateDirectory({
      category: args.category,
      keyword: args.keyword || args.query,
      recommendedOnly: args.recommended === 'true' || args.recommended === '1',
    });
  }
  throw unknownCommandError(command);
}

if (require.main === module) {
  main()
    .then(printResult)
    .catch((error) => {
      console.error(String(error.message || error));
      process.exit(1);
    });
}

module.exports = { main, commandFrom, STABLE_CLI_COMMANDS };
