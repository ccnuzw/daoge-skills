const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const http = require('http');
const { refreshTaskCenterRuntimeState } = require('../scripts/task_center_state_runtime');
const { refreshRuntimeWorkbench } = require('../scripts/workbench_state_runtime');
const { writeRuntimeStateSnapshot } = require('../scripts/runtime_state_snapshot');
const { loadWorkbenchState } = require('../scripts/workbench_state_shared');
const { buildTaskCenterState } = require('../scripts/task_center_state_shared');

const skillRoot = path.resolve(__dirname, '..');
const scriptsDir = path.join(skillRoot, 'scripts');
const fixturesDir = path.join(__dirname, 'fixtures');

function readFixture(name) {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runNode(scriptName, args, options = {}) {
  return execFileSync(process.execPath, [path.join(scriptsDir, scriptName), ...args], {
    cwd: path.resolve(skillRoot, '..', '..'),
    encoding: 'utf8',
    ...options,
  });
}

function runNodeAsync(scriptName, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(scriptsDir, scriptName), ...args], {
      cwd: path.resolve(skillRoot, '..', '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`child exited with code ${code}: ${stderr || stdout}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

async function withMockImageServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function writeMockEnv(envFile, baseUrl) {
  fs.writeFileSync(envFile, [
    `OPENAI_BASE_URL=${baseUrl}/v1`,
    'OPENAI_API_KEY=test-key',
    'OPENAI_MODEL=gpt-image-2',
    'OPENAI_RESPONSES_MODEL=gpt-5.4',
  ].join('\n'));
}

function tinyPngBase64() {
  return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pS3FoAAAAAASUVORK5CYII=';
}

function writeStoryboardFixtures(tempDir) {
  const taskSpec = path.join(tempDir, 'task_spec.storyboard.json');
  const layoutManifest = path.join(tempDir, 'layout_manifest.storyboard.json');
  const contentManifest = path.join(tempDir, 'content_manifest.storyboard.json');
  const renderConfig = path.join(tempDir, 'render_config.storyboard.json');
  fs.writeFileSync(taskSpec, readFixture('storyboard_task_spec.minimal.json'));
  fs.writeFileSync(layoutManifest, readFixture('layout_manifest.storyboard.json'));
  fs.writeFileSync(contentManifest, readFixture('content_manifest.storyboard.json'));
  fs.writeFileSync(renderConfig, readFixture('render_config.storyboard.json'));
  return { taskSpec, layoutManifest, contentManifest, renderConfig };
}

test('run_batch dry-run produces expected artifacts', () => {
  const tempDir = makeTempDir('interactive-image-batch-runner-');
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  const promptsFile = path.join(tempDir, 'prompts.generated.json');

  fs.writeFileSync(envFile, [
    'OPENAI_BASE_URL=https://example.com/v1',
    'OPENAI_API_KEY=test-key',
    'OPENAI_MODEL=gpt-image-2',
  ].join('\n'));
  fs.writeFileSync(promptsFile, readFixture('prompts.minimal.json'));
  fs.mkdirSync(path.join(outputDir, 'workspace'), { recursive: true });
  [
    'storyboard_board.html',
    'review_board.html',
    'completion_board.html',
    'run_overview.html',
    'rerun_board.html',
    'result_hub.html',
    'daoge_portal.html',
  ].forEach((name) => {
    fs.writeFileSync(path.join(outputDir, name), '<html>stale optional page</html>');
    fs.writeFileSync(path.join(outputDir, 'workspace', name), '<html>stale optional mirror</html>');
  });

  const stdout = runNode('run_batch.js', [
    '--prompts-file', promptsFile,
    '--env-file', envFile,
    '--dry-run', 'true',
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--concurrency', '1',
  ]);

  assert.match(stdout, /\[dry-run\]/);
  [
    'README.md',
    'manifest.json',
    'batch_plan.json',
    'stage_plan.json',
    'job_state.json',
    'checkpoint.json',
    'operations_report.json',
    'run_record.html',
    'workspace_state.json',
    'workspace_assets.json',
    'workspace_timeline.json',
    'workbench_state.json',
    'workspace_live_state.json',
    'workspace_home.html',
    'result_workspace.html',
    'exception_workspace.html',
    'workspace_layout_manifest.json',
  ].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, name)), true, `missing ${name}`);
  });
  [
    'workspace/workspace_home.html',
    'workspace/result_workspace.html',
    'workspace/exception_workspace.html',
    'workspace/run_record.html',
    'internal/manifest.json',
    'internal/workspace_state.json',
    'internal/workspace_live_state.json',
    'internal/operations_report.json',
  ].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, name)), true, `missing layout mirror ${name}`);
  });
  const layoutManifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'workspace_layout_manifest.json'), 'utf8'));
  assert.equal(layoutManifest.kind, 'daoge-workspace-layout-manifest');
  assert.equal(layoutManifest.mode, 'workspace-first');
  assert.equal(layoutManifest.source, 'run_batch');
  assert.match(layoutManifest.principle, /workspace\/internal\/debug 是正式分层输出/);
  assert.ok(layoutManifest.counts.workspace >= 4);
  assert.ok(layoutManifest.counts.internal >= 4);
  const workspaceState = JSON.parse(fs.readFileSync(path.join(outputDir, 'workspace_state.json'), 'utf8'));
  assert.equal(workspaceState.artifactGovernance?.summary?.workspaceLayoutMode, 'workspace-first');
  assert.equal(workspaceState.artifactGovernance?.summary?.defaultEntryPath, path.join(outputDir, 'workspace', 'workspace_home.html'));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(outputDir, 'internal', 'workspace_live_state.json'), 'utf8')).liveCopilotDirective?.recommendedReply,
    JSON.parse(fs.readFileSync(path.join(outputDir, 'workspace_live_state.json'), 'utf8')).liveCopilotDirective?.recommendedReply
  );
  const mirroredWorkspaceHome = fs.readFileSync(path.join(outputDir, 'workspace', 'workspace_home.html'), 'utf8');
  assert.match(mirroredWorkspaceHome, /href="prepare_workspace\.html"/);
  assert.match(mirroredWorkspaceHome, /href="result_workspace\.html"/);
  assert.match(mirroredWorkspaceHome, /href="\.\.\/\.\.\/task_center\.html"/);
  assert.doesNotMatch(mirroredWorkspaceHome, /href="\.\.\/prepare_workspace\.html"/);
  assert.doesNotMatch(mirroredWorkspaceHome, /href="\.\.\/result_workspace\.html"/);
  const mirroredRunRecord = fs.readFileSync(path.join(outputDir, 'workspace', 'run_record.html'), 'utf8');
  assert.match(mirroredRunRecord, /href="workspace_home\.html"/);
  assert.match(mirroredRunRecord, /href="\.\.\/\.\.\/task_center\.html"/);

  assert.equal(fs.existsSync(path.join(tempDir, 'task_center_state.json')), true, 'missing task_center_state.json');
  assert.equal(fs.existsSync(path.join(tempDir, 'task_center_live_state.json')), true, 'missing task_center_live_state.json');

  [
    'prompt_preview.md',
    'daoge_run_summary.md',
    'daoge_preflight_dashboard.md',
  ].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, name)), false, `unexpected ${name}`);
    assert.equal(fs.existsSync(path.join(outputDir, 'workspace', name)), false, `unexpected workspace mirror ${name}`);
  });
  assert.equal(fs.existsSync(path.join(tempDir, 'task_center.html')), true, 'missing task_center.html');

  [
    'selection_board.md',
    'operations_report.md',
    'contact_sheet_index.md',
    'run_record.md',
    'daoge_completion_report.md',
    'storyboard_board.html',
    'daoge_portal.html',
    'result_hub.html',
    'review_board.html',
    'completion_board.html',
    'run_overview.html',
    'rerun_board.html',
  ].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, name)), false, `unexpected ${name}`);
  });

  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.dryRun, true);
  assert.equal(manifest.selectedCount, 2);
  assert.equal(manifest.batchCount, 2);

  const runRecordHtml = fs.readFileSync(path.join(outputDir, 'run_record.html'), 'utf8');
  assert.match(runRecordHtml, /DAOGE 任务档案/);
  assert.match(runRecordHtml, /任务规模/);
  assert.match(runRecordHtml, /输出目录规则/);
  assert.match(runRecordHtml, /这份档案不负责什么/);
  assert.match(runRecordHtml, /入口说明|最终收口/);
  assert.match(runRecordHtml, /用户直看层|文件落盘层|已后退文件/);
  assert.match(runRecordHtml, /统一状态模型/);
  assert.match(runRecordHtml, /运行状态源/);
  const readme = fs.readFileSync(path.join(outputDir, 'README.md'), 'utf8');
  assert.match(readme, /DAOGE 当前任务入口/);
  assert.match(readme, /请先打开工作台首页/);
  assert.match(readme, /先看这里:/);
  assert.match(readme, /workspace\/workspace_home\.html/);
  assert.match(readme, /workspace\/ 是正式工作台入口/);
  assert.match(readme, /打开后先看: 当前阶段、推荐下一步、回到对话框怎么说/);
  assert.match(readme, /不用先看: JSON \/ Markdown 内部记录、深看页/);
  assert.match(readme, /内部记录: 仅维护者诊断和续跑使用，不作为普通阅读入口/);
  assert.match(readme, /任务档案只作回看，内部记录仅维护者诊断使用/);
  assert.match(readme, /其它补充页: 默认不生成；需要深看时从对应工作台按需进入/);
  assert.match(readme, /这轮怎么进入/);
  assert.match(readme, /当前主入口: 工作台首页/);
  assert.match(readme, /进入后: 先看页面顶部主动作，再按推荐按钮继续/);
  assert.match(readme, /主链: 任务总控 -> 工作台首页 -> 准备工作台 -> 结果工作台 -> 异常工作台/);
  assert.match(readme, /目录规则:/);
  assert.match(readme, /这三份说明各看什么/);
  assert.match(readme, /README: 只看入口、主链和目录分层/);
  assert.match(readme, /任务档案: 只看这轮发生了什么/);
  assert.match(readme, /完成报告: 只看这轮是否已经可以收口/);
  assert.match(readme, /目录分层/);
  assert.match(readme, /用户直看层|文件落盘层|归档层|内部状态层/);
  assert.match(readme, /内部状态层: .*仅维护者诊断、续跑和程序读取使用/);
  assert.doesNotMatch(readme, /- 分镜整板页:/);
  assert.doesNotMatch(readme, /- 分镜整板补充页: .*storyboard_board\.html/);
  assert.doesNotMatch(readme, /- 完成报告: .*daoge_completion_report\.md/);
  assert.doesNotMatch(readme, /结果挑选说明|运行复盘/);
});

test('summarizeUserWorkbenchProtocol provides shared fallback language', () => {
  const { summarizeUserWorkbenchProtocol } = require('../scripts/workspace_page_shared');
  const summary = summarizeUserWorkbenchProtocol({}, { outputDir: '/tmp/demo-output' });
  assert.equal(summary.defaultEntryLabel, '工作台首页');
  assert.equal(summary.supportEntryLabel, '任务档案页');
  assert.deepEqual(summary.defaultVisibleLabels, ['工作台首页', '准备工作台', '结果工作台', '异常工作台']);
  assert.match(summary.taskCenterCopy, /默认先从工作台首页进入/);
  assert.match(summary.runtimeRule, /workspace_live_state\.json/);
  assert.equal(summary.primaryRuntimeSource, '/tmp/demo-output/workspace_live_state.json');
  assert.equal(summary.canonicalState, '/tmp/demo-output/workspace_state.json');
  assert.equal(summary.runtimeState, '/tmp/demo-output/runtime_state.json');
  assert.equal(summary.assetsState, '/tmp/demo-output/workspace_assets.json');
  assert.equal(summary.timelineState, '/tmp/demo-output/workspace_timeline.json');
  assert.equal(summary.derivedWorkbenchSnapshot, '/tmp/demo-output/workbench_state.json');
  assert.equal(summary.taskCenterUnifiedState, '/tmp/task_center_live_state.json');
  assert.match(summary.stateSourceSummary, /入口主链提醒和运行态副驾驶交接/);
  assert.equal(summary.stateRoles?.canonicalState, '任务内统一状态模型');
  assert.equal(summary.stateProtocol?.files?.workspaceLiveState?.file, 'workspace_live_state.json');
  assert.match(String(summary.stateProtocol?.files?.workspaceLiveState?.responsibility || ''), /主实时状态源/);
  assert.match(String(summary.stateProtocol?.files?.workspaceState?.responsibility || ''), /统一状态模型/);
  assert.match(String(summary.stateProtocol?.files?.runtimeState?.responsibility || ''), /运行期状态源/);
  assert.match(String(summary.stateProtocol?.files?.taskCenterLiveState?.responsibility || ''), /跨任务总控实时状态源/);
  assert.match(String(summary.stateProtocol?.duplicateFieldRule || ''), /currentFocus、nextActionSummary、recommendedReply、pressureLabel、statusSummary/);
  assert.equal(summary.stateProtocol?.fieldBoundaries?.currentFocus?.canonicalOwner, 'workspace_state.json');
  assert.match(String(summary.stateProtocol?.fieldBoundaries?.currentFocus?.liveMirror || ''), /不新增语义判断/);
  assert.match(String(summary.stateProtocol?.fieldBoundaries?.nextActionSummary?.taskCenterMirror || ''), /不反写单轮 nextAction/);
  assert.match(String(summary.stateProtocol?.fieldBoundaries?.recommendedReply?.runtimeOverride || ''), /等待确认、暂停、异常分流和完成收口/);
  assert.match(String(summary.stateProtocol?.fieldBoundaries?.pressureLabel?.taskCenterMirror || ''), /不拥有单轮 pressureLabel/);
  assert.match(String(summary.stateProtocol?.fieldBoundaries?.statusSummary?.runtimeOverride || ''), /运行态/);
  assert.deepEqual(summary.stateProtocol?.consumerReadPlan?.pages?.readPriority?.slice(0, 3), [
    'workspace_live_state.json',
    'workspace_state.json',
    'runtime_state.json',
  ]);
  assert.equal(summary.stateProtocol?.consumerReadPlan?.taskCenter?.primaryLayer, 'task_center_live_state.json');
  assert.equal(summary.stateProtocol?.consumerReadPlan?.runtime?.primaryLayer, 'runtime_state.json');
  assert.equal(summary.stateProtocol?.consumerReadPlan?.copilot?.canonicalLayer, 'workspace_state.json');
  assert.equal(summary.fieldBoundaries?.recommendedReply?.canonicalOwner, 'workspace_state.json');
  assert.equal(summary.consumerReadPlan?.copilot?.runtimeOverlay, 'runtime_state.json');
  assert.deepEqual(summary.stateProtocol?.readPriority?.slice(0, 3), [
    'workspace_live_state.json',
    'workspace_state.json',
    'runtime_state.json',
  ]);
  assert.equal(summary.taskCenterEntryProtocol?.source, '/tmp/task_center_live_state.json');
  assert.equal(summary.taskCenterEntryProtocol?.entryGuideKey, 'entryMainlineGuide');
  assert.deepEqual(summary.taskCenterEntryProtocol?.runtimeFields, ['runtimeMode', 'runtimeFocus', 'handoffRule']);
  assert.match(String(summary.taskCenterEntryProtocol?.userRule || ''), /任务内判断看工作台首页/);
  assert.match(String(summary.taskCenterEntryProtocol?.summary || ''), /跨任务入口看任务总控/);
});

test('task center artifact layer summary prefers user-facing governance copy', () => {
  const { formatArtifactLayerSummary } = require('../scripts/task_center_state_shared');
  const summary = formatArtifactLayerSummary({
    summary: {
      defaultEntryLabel: '厚治理入口',
      mainlineCount: 10,
      principle: '维护者厚治理说明。',
    },
    userFacingSummary: {
      defaultEntryLabel: '工作台首页',
      mainlineCount: 4,
      supportCount: 1,
      principle: '普通用户默认只沿主链工作台继续。',
    },
  });
  assert.equal(summary.defaultEntryLabel, '工作台首页');
  assert.equal(summary.mainlineCount, 4);
  assert.equal(summary.supportCount, 1);
  assert.equal(summary.userFacing, true);
  assert.match(summary.principle, /普通用户默认只沿主链工作台继续/);
});

test('unified status summary keeps recommended reply and next action summary as the primary contract', () => {
  const { buildStageUnifiedStatus, buildCopilotSummary, buildRuntimeCopilotProtocol } = require('../scripts/unified_status_summary');

  const unifiedStatus = buildStageUnifiedStatus({
    stage: '结果阶段',
    conclusion: '结果已经齐了',
    currentFocus: '先筛出最值得保留的图',
    progress: '已经完成 4/4 批',
    nextActionLabel: '进入结果工作台',
    nextActionReason: '先回结果工作台做筛图判断',
    dialogueStatus: {
      primarySay: '继续，进入结果工作台',
      actionReason: '结果已经齐了，先筛图最自然。',
      summary: '当前已经可以开始看结果。',
      nextSayItems: ['继续，进入结果工作台', '继续，我开始筛图'],
    },
  });

  const copilotSummary = buildCopilotSummary({
    unifiedStatus,
    nextAction: {
      label: '一个旧动作',
      reason: '一个旧原因',
    },
    dialogueStatus: {
      primarySay: '一个旧回复',
      summary: '旧摘要',
    },
  });

  assert.equal(unifiedStatus.recommendedReply, '继续，进入结果工作台');
  assert.equal(unifiedStatus.nextActionSummary, '先回结果工作台做筛图判断');
  assert.equal(copilotSummary.recommendedReply, '继续，进入结果工作台');
  assert.equal(copilotSummary.nextActionSummary, '先回结果工作台做筛图判断');

  const runtimeProtocol = buildRuntimeCopilotProtocol({
    status: 'awaiting_confirmation',
    stageLabel: '准备阶段',
    taskLabel: '结果已经齐了',
    progressSummary: '等待确认',
    nextAction: { label: '进入结果工作台', reason: '先回结果工作台做筛图判断' },
    dialogueStatus: { primarySay: '继续，进入结果工作台' },
    copilotSummary,
  });
  assert.equal(runtimeProtocol.cadenceLabel, '等待确认');
  assert.match(runtimeProtocol.handoffRule, /对话框负责给出明确确认/);
  assert.equal(runtimeProtocol.handoffState?.branch, 'waiting-confirmation');
  assert.equal(runtimeProtocol.handoffState?.primarySurface, 'workspace_home.html');
});

test('workspace shared consumers prefer unified status contract over stale copilot fallbacks', () => {
  const {
    buildActionStatusFromUnifiedStatus,
    buildDialogueStatusFromUnifiedStatus,
    buildTaskControlBarFromUnifiedStatus,
  } = require('../scripts/workspace_page_shared');

  const unifiedStatus = {
    taskLabel: '示例任务',
    stage: '异常阶段',
    status: 'warn',
    statusLabel: '需要先处理异常',
    statusSummary: '当前有失败项需要先收口。',
    progressSummary: '本轮已完成 3/4 批。',
    currentFocus: '先处理失败项',
    nextActionSummary: '先集中处理失败项，再决定是否补跑。',
    recommendedReply: '继续，先处理异常',
    nextAction: {
      label: '进入异常工作台',
      reason: '旧动作原因，不该再优先生效',
    },
    dialogue: {
      primarySay: '旧对话主句，不该再优先生效',
      actionReason: '旧对话原因',
      summary: '旧对话摘要',
      nextSayItems: ['继续，带我看失败项'],
    },
  };
  const copilotSummary = {
    nextActionSummary: '旧副驾驶摘要',
    recommendedReply: '旧副驾驶回复',
    confirmationSummary: '旧确认摘要',
  };

  const taskControlBar = buildTaskControlBarFromUnifiedStatus(unifiedStatus, { copilotSummary });
  const actionStatus = buildActionStatusFromUnifiedStatus(unifiedStatus, { copilotSummary });
  const dialogueStatus = buildDialogueStatusFromUnifiedStatus(unifiedStatus, { copilotSummary });

  assert.equal(taskControlBar.nextActionSummary, '先集中处理失败项，再决定是否补跑。');
  assert.equal(actionStatus.recommendedReply, '继续，先处理异常');
  assert.equal(actionStatus.actionReason, '先集中处理失败项，再决定是否补跑。');
  assert.equal(dialogueStatus.primarySay, '继续，先处理异常');
});

test('copilot summary and workspace shared consumers can fallback to shared runtime conversation copy', () => {
  const { buildCopilotSummary } = require('../scripts/unified_status_summary');
  const {
    buildActionStatusFromUnifiedStatus,
    buildDialogueStatusFromUnifiedStatus,
  } = require('../scripts/workspace_page_shared');

  const unifiedStatus = {
    stage: '执行中',
    status: 'running',
    progressSummary: '已完成 1/2 批，当前执行第 2 批。',
    nextAction: {
      label: '打开当前任务',
      reason: '',
    },
    dialogue: {},
  };

  const copilotSummary = buildCopilotSummary({
    unifiedStatus,
    status: 'running',
    currentBatch: 2,
  });
  const actionStatus = buildActionStatusFromUnifiedStatus(unifiedStatus, {
    copilotSummary,
    status: 'running',
    currentBatch: 2,
  });
  const dialogueStatus = buildDialogueStatusFromUnifiedStatus(unifiedStatus, {
    copilotSummary,
    status: 'running',
    currentBatch: 2,
  });

  assert.equal(copilotSummary.recommendedReply, '继续，先盯住当前进度');
  assert.match(String(copilotSummary.confirmationSummary || ''), /第 2 批/);
  assert.match(String(copilotSummary.confirmationSummary || ''), /工作台会持续刷新进度/);
  assert.match(String(copilotSummary.nextActionSummary || ''), /第 2 批/);
  assert.equal(actionStatus.recommendedReply, '继续，先盯住当前进度');
  assert.match(String(actionStatus.actionReason || ''), /工作台会持续刷新进度/);
  assert.equal(dialogueStatus.primarySay, '继续，先盯住当前进度');
  assert.equal(dialogueStatus.nextSayItems[0], '继续，先盯住当前进度');
});

test('workspace shared narrative prefers unified status summary and current focus over stale summary phrasing', () => {
  const {
    buildTaskControlBarFromUnifiedStatus,
    resolveUnifiedStageNarrative,
  } = require('../scripts/workspace_page_shared');

  const unifiedStatus = {
    stage: '准备阶段',
    conclusion: '准备已完成',
    statusLabel: '可以进入下一步',
    statusSummary: '当前重点是确认放行条件已经齐备。',
    currentFocus: '先确认放行条件',
    focusSummary: '旧焦点摘要，不该优先生效',
    progressSummary: '当前进度旧摘要，不该压过状态摘要',
    nextAction: {
      label: '进入结果工作台',
      reason: '旧动作原因',
    },
  };
  const copilotSummary = {
    conclusion: '旧结论摘要',
    progressSummary: '旧副驾驶进度摘要',
  };

  const taskControlBar = buildTaskControlBarFromUnifiedStatus(unifiedStatus, { copilotSummary });
  const narrative = resolveUnifiedStageNarrative(unifiedStatus, {});

  assert.equal(taskControlBar.statusSummary, '当前重点是确认放行条件已经齐备。');
  assert.equal(narrative.currentFocus, '先确认放行条件');
});

test('workspace shared view resolvers prefer state view contracts before page fallbacks', () => {
  const {
    resolveWorkspaceViewContextBarData,
    resolveWorkspaceViewRouteSection,
    resolveWorkspaceViewContentSectionPlan,
    resolveWorkspaceViewSummarySection,
    resolveWorkspaceViewWorkbenchSection,
    resolveWorkspaceStageContextBarData,
    resolveWorkspaceStageRouteSection,
    resolveWorkspaceStageContentSectionPlan,
    resolveWorkspaceStageSummarySection,
    resolveWorkspaceStageWorkbenchSection,
    resolveWorkspaceStageSessionConsole,
    resolveWorkspaceStageViewValue,
    resolveWorkspaceStageSection,
    resolveWorkspaceStageStateValue,
    resolveWorkspaceShellRuntime,
    resolveWorkspaceStageActionStatus,
    resolveWorkspaceStageDialogueStatus,
    resolveWorkspaceStageConfirmationState,
  } = require('../scripts/workspace_page_shared');

  const view = {
    context: {
      runLabel: '状态层任务',
      phaseLabel: '状态层阶段',
      flowLabel: '状态层主链',
      counts: [{ label: '状态计数', value: '来自 view' }],
      hints: ['状态层提示'],
    },
    route: {
      title: '状态层路线',
      current: { label: '当前状态层' },
      nextSteps: [{ label: '下一步状态层', summary: '继续信状态层' }],
    },
    summary: {
      title: '状态层摘要',
      items: [{ label: '摘要来源', value: '来自 view' }],
    },
    workbench: {
      title: '状态层补充入口',
      cards: [{ label: '状态层卡片', value: '来自 view' }],
    },
    contentSections: [
      { key: 'state-first', kind: 'keyValue', enabled: true },
    ],
  };

  const context = resolveWorkspaceViewContextBarData('home', view, {
    runLabel: '页面兜底任务',
    phaseLabel: '页面兜底阶段',
    countValues: { focus: '页面兜底计数' },
    defaultHints: ['页面兜底提示'],
  });
  const route = resolveWorkspaceViewRouteSection('home', view, {
    title: '页面兜底路线',
    current: { label: '当前页面兜底' },
    nextSteps: [{ label: '下一步页面兜底' }],
  });
  const contentPlan = resolveWorkspaceViewContentSectionPlan(view, [
    { key: 'fallback', kind: 'keyValue', enabled: true },
  ]);
  const summary = resolveWorkspaceViewSummarySection(view, {
    title: '页面兜底摘要',
    items: [{ label: '摘要来源', value: '来自 fallback' }],
  });
  const workbench = resolveWorkspaceViewWorkbenchSection(view, {
    title: '页面兜底补充入口',
    cards: [{ label: '页面兜底卡片', value: '来自 fallback' }],
  });

  assert.equal(context.runLabel, '状态层任务');
  assert.equal(context.phaseLabel, '状态层阶段');
  assert.equal(context.counts[0].value, '来自 view');
  assert.equal(context.hints.at(-1), '状态层提示');
  assert.equal(route.title, '状态层路线');
  assert.equal(route.current.label, '当前状态层');
  assert.equal(route.nextSteps[0].label, '下一步状态层');
  assert.deepEqual(contentPlan.map((item) => [item.key, item.kind, item.enabled]), [
    ['state-first', 'keyValue', true],
  ]);
  assert.equal(summary.title, '状态层摘要');
  assert.equal(summary.items[0].value, '来自 view');
  assert.equal(workbench.title, '状态层补充入口');
  assert.equal(workbench.cards[0].value, '来自 view');

  assert.equal(resolveWorkspaceViewContextBarData('home', {}, { runLabel: '页面兜底任务' }).runLabel, '页面兜底任务');
  assert.equal(resolveWorkspaceViewRouteSection('home', {}, { title: '页面兜底路线' }).title, '页面兜底路线');
  assert.equal(resolveWorkspaceViewSummarySection({}, { title: '页面兜底摘要' }).title, '页面兜底摘要');
  assert.equal(resolveWorkspaceViewWorkbenchSection({}, { title: '页面兜底补充入口' }).title, '页面兜底补充入口');
  assert.deepEqual(resolveWorkspaceViewContentSectionPlan({}, [
    { key: 'fallback', kind: 'keyValue', enabled: true },
  ]).map((item) => item.key), ['fallback']);

  const pageState = {
    workflowSessions: {
      result: {
        console: {
          sessionConsole: {
            title: '共享协同快照',
            items: [{ label: '来源', value: 'workflowSessions.result.console.sessionConsole' }],
          },
        },
      },
      prepare: {},
    },
    taskSessionSnapshots: {
      result: { title: '任务快照兜底' },
      prepare: { title: '准备任务快照' },
    },
  };
  assert.equal(
    resolveWorkspaceStageSessionConsole(pageState, 'result', { sessionConsole: { title: '视图兜底' } }).title,
    '共享协同快照'
  );
  assert.equal(
    resolveWorkspaceStageSessionConsole(pageState, 'prepare', { sessionConsole: { title: '视图兜底' } }).title,
    '准备任务快照'
  );
  assert.equal(
    resolveWorkspaceStageSessionConsole({}, 'exception', { sessionConsole: { title: '视图兜底' } }).title,
    '视图兜底'
  );

  const stageState = {
    views: {
      result: {
        context: {
          runLabel: '共享状态任务',
          counts: [{ label: '共享计数', value: '来自 pageState.views.result' }],
        },
        route: {
          title: '共享状态路线',
          nextSteps: [{ label: '共享下一步', summary: '来自 pageState.views.result' }],
        },
        summary: {
          title: '共享状态摘要',
          items: [{ label: '摘要来源', value: 'pageState.views.result' }],
        },
        workbench: {
          title: '共享状态补充入口',
          cards: [{ label: '共享卡片', value: 'pageState.views.result' }],
        },
        sections: {
          guide: {
            title: '共享状态指南',
            items: [{ label: '指南来源', value: 'pageState.views.result.sections.guide' }],
          },
        },
        display: {
          showSummaryByDefault: false,
          surfaceRules: { routeMaxNextSteps: 2 },
          modeSwitch: { title: '视图模式切换', defaultMode: 'newcomer' },
        },
        actionStatus: {
          title: '共享状态动作',
          primary: { title: '共享动作卡' },
        },
        signalBar: [
          { label: '共享状态信号', value: '来自 pageState.views.result' },
        ],
        dialogueStatus: {
          primarySay: '共享状态回复',
          nextSayItems: ['继续用共享状态回复'],
        },
        confirmation: {
          recommendedReply: '共享状态确认回复',
          summary: '共享状态确认说明',
        },
        contentSections: [
          { key: 'state-preview', kind: 'previewGrid', enabled: true },
        ],
      },
    },
  };
  assert.equal(
    resolveWorkspaceStageContextBarData(stageState, 'result', {
      context: { runLabel: '传入 view 任务' },
    }, { runLabel: 'fallback 任务' }).runLabel,
    '共享状态任务'
  );
  assert.equal(
    resolveWorkspaceStageRouteSection(stageState, 'result', {
      route: { title: '传入 view 路线' },
    }, { title: 'fallback 路线' }).title,
    '共享状态路线'
  );
  assert.deepEqual(
    resolveWorkspaceStageContentSectionPlan(stageState, 'result', {
      contentSections: [{ key: 'view-preview', kind: 'previewGrid', enabled: true }],
    }, [{ key: 'fallback-preview', kind: 'previewGrid', enabled: true }]).map((item) => item.key),
    ['state-preview']
  );
  assert.equal(
    resolveWorkspaceStageSummarySection(stageState, 'result', {
      summary: { title: '传入 view 摘要' },
    }, { title: 'fallback 摘要' }).title,
    '共享状态摘要'
  );
  assert.equal(
    resolveWorkspaceStageWorkbenchSection(stageState, 'result', {
      workbench: { title: '传入 view 补充入口' },
    }, { title: 'fallback 补充入口' }).title,
    '共享状态补充入口'
  );
  assert.equal(
    resolveWorkspaceStageActionStatus(stageState, 'result', {
      actionStatus: { title: '传入 view 动作' },
    }, { title: 'fallback 动作' }).title,
    '共享状态动作'
  );
  assert.deepEqual(
    resolveWorkspaceStageViewValue(stageState, 'result', {
      signalBar: [{ label: '传入 view 信号', value: '来自传入 view' }],
    }, 'signalBar', [{ label: 'fallback 信号', value: '来自 fallback' }]).map((item) => item.value),
    ['来自 pageState.views.result']
  );
  assert.equal(
    resolveWorkspaceStageSection(stageState, 'result', {
      sections: {
        guide: { title: '传入 view 指南' },
      },
    }, {
      sections: {
        guide: { title: 'pageData 指南优先' },
      },
    }, 'guide', { title: 'fallback 指南' }).title,
    'pageData 指南优先'
  );
  assert.equal(
    resolveWorkspaceStageSection(stageState, 'result', {
      sections: {
        guide: { title: '传入 view 指南' },
      },
    }, {}, 'guide', { title: 'fallback 指南' }).title,
    '共享状态指南'
  );
  assert.equal(
    resolveWorkspaceStageStateValue(stageState, 'result', {
      decision: { title: 'pageData 决策优先' },
    }, {
      decision: { title: '阶段状态决策' },
    }, 'decision', { title: 'fallback 决策' }).title,
    'pageData 决策优先'
  );
  assert.equal(
    resolveWorkspaceStageStateValue(stageState, 'result', {}, {
      decision: { title: '阶段状态决策' },
    }, 'decision', { title: 'fallback 决策' }).title,
    '阶段状态决策'
  );
  assert.equal(
    resolveWorkspaceStageDialogueStatus(stageState, 'result', {
      dialogueStatus: { primarySay: '传入 view 回复' },
    }, { primarySay: 'fallback 回复' }).primarySay,
    '共享状态回复'
  );
  assert.equal(
    resolveWorkspaceStageConfirmationState(stageState, 'result', {
      confirmation: { recommendedReply: '传入 view 确认' },
    }, { recommendedReply: 'fallback 确认' }).recommendedReply,
    '共享状态确认回复'
  );
  assert.equal(
    resolveWorkspaceStageContextBarData({}, 'result', {
      context: { runLabel: '传入 view 任务' },
    }, { runLabel: 'fallback 任务' }).runLabel,
    '传入 view 任务'
  );
  assert.equal(
    resolveWorkspaceStageSummarySection({
      views: {
        result: {
          context: { runLabel: '只有 context 的共享状态' },
        },
      },
    }, 'result', {
      summary: { title: '传入 view 字段兜底摘要' },
    }, { title: 'fallback 摘要' }).title,
    '传入 view 字段兜底摘要'
  );
  assert.equal(
    resolveWorkspaceStageActionStatus({}, 'result', {
      actionStatus: { title: '传入 view 动作' },
    }, { title: 'fallback 动作' }).title,
    '传入 view 动作'
  );
  assert.equal(
    resolveWorkspaceStageViewValue({
      views: {
        result: {
          context: { runLabel: '只有 context 的共享状态' },
        },
      },
    }, 'result', {
      signalBar: [{ label: '传入 view 信号', value: '传入 view 数组补位' }],
    }, 'signalBar', [{ label: 'fallback 信号', value: 'fallback 数组' }])[0].value,
    '传入 view 数组补位'
  );
  assert.equal(
    resolveWorkspaceStageSection({
      views: {
        result: {
          context: { runLabel: '只有 context 的共享状态' },
        },
      },
    }, 'result', {
      sections: {
        guide: { title: '传入 view section 补位' },
      },
    }, {}, 'guide', { title: 'fallback section' }).title,
    '传入 view section 补位'
  );
  assert.equal(
    resolveWorkspaceStageSection({}, 'result', {}, {}, 'guide', { title: 'fallback section' }).title,
    'fallback section'
  );
  assert.equal(
    resolveWorkspaceStageStateValue({}, 'result', {}, {}, 'decision', { title: 'fallback 决策' }).title,
    'fallback 决策'
  );
  const shellRuntime = resolveWorkspaceShellRuntime({
    governanceByPage: {
      'result_workspace.html': {
        display: {
          showSummaryByDefault: true,
          surfaceRules: { routeMaxNextSteps: 9 },
          modeSwitch: { title: '治理模式切换', defaultMode: 'pro' },
        },
        optionalSurface: { showStoryboardEntry: false },
        workbenchEntryIds: ['review-board'],
      },
    },
    views: stageState.views,
  }, 'result', {
    display: {
      showSummaryByDefault: true,
      surfaceRules: { routeMaxNextSteps: 4 },
      modeSwitch: { title: '传入 view 模式切换', defaultMode: 'pro' },
    },
  });
  assert.equal(shellRuntime.shell.currentPage, 'result_workspace.html');
  assert.equal(shellRuntime.layout.showSummaryByDefault, false);
  assert.equal(shellRuntime.surfaceRules.routeMaxNextSteps, 2);
  assert.equal(shellRuntime.modeSwitch.title, '视图模式切换');
  assert.equal(shellRuntime.optionalSurface.showStoryboardEntry, false);
  assert.equal(shellRuntime.governedWorkbenchIds.has('review-board'), true);
});

test('run_batch can emit diagnostic markdown only when explicitly enabled', () => {
  const tempDir = makeTempDir('interactive-image-batch-runner-diagnostic-md-');
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  const promptsFile = path.join(tempDir, 'prompts.generated.json');

  fs.writeFileSync(envFile, [
    'OPENAI_BASE_URL=https://example.com/v1',
    'OPENAI_API_KEY=test-key',
    'OPENAI_MODEL=gpt-image-2',
  ].join('\n'));
  fs.writeFileSync(promptsFile, readFixture('prompts.minimal.json'));

  runNode('run_batch.js', [
    '--prompts-file', promptsFile,
    '--env-file', envFile,
    '--dry-run', 'true',
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--concurrency', '1',
    '--emit-diagnostic-markdown', 'true',
  ]);

  assert.equal(fs.existsSync(path.join(outputDir, 'selection_board.md')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'operations_report.md')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'debug/selection_board.md')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'debug/operations_report.md')), true);

  const selectionBoard = fs.readFileSync(path.join(outputDir, 'selection_board.md'), 'utf8');
  const operationsReport = fs.readFileSync(path.join(outputDir, 'operations_report.md'), 'utf8');
  assert.match(selectionBoard, /DAOGE 结果挑选与补救说明/);
  assert.match(operationsReport, /DAOGE 运行复盘/);
});

test('run_batch can emit archive markdown only when explicitly enabled', () => {
  const tempDir = makeTempDir('interactive-image-batch-runner-archive-md-');
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  const promptsFile = path.join(tempDir, 'prompts.generated.json');

  fs.writeFileSync(envFile, [
    'OPENAI_BASE_URL=https://example.com/v1',
    'OPENAI_API_KEY=test-key',
    'OPENAI_MODEL=gpt-image-2',
  ].join('\n'));
  fs.writeFileSync(promptsFile, readFixture('prompts.minimal.json'));

  runNode('run_batch.js', [
    '--prompts-file', promptsFile,
    '--env-file', envFile,
    '--dry-run', 'true',
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--concurrency', '1',
    '--emit-archive-markdown', 'true',
  ]);

  assert.equal(fs.existsSync(path.join(outputDir, 'contact_sheet_index.md')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'run_record.md')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'debug/contact_sheet_index.md')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'debug/run_record.md')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'daoge_completion_report.md')), false);

  const runRecord = fs.readFileSync(path.join(outputDir, 'run_record.md'), 'utf8');
  assert.match(runRecord, /DAOGE 任务档案/);
  assert.match(runRecord, /本轮总量|任务规模|默认尺寸/);
  assert.doesNotMatch(runRecord, /- 分镜整板页:/);
});

test('daoge_prepare_run preflight pipeline succeeds on minimal fixture', () => {
  const tempDir = makeTempDir('interactive-image-batch-prepare-');
  const outputDir = path.join(tempDir, 'out');
  const taskSpec = path.join(tempDir, 'task_spec.json');
  const strategyFile = path.join(tempDir, 'prompt_strategy.json');
  const promptsFile = path.join(tempDir, 'prompts.generated.json');

  fs.writeFileSync(taskSpec, readFixture('task_spec.minimal.json'));
  fs.writeFileSync(strategyFile, readFixture('prompt_strategy.minimal.json'));
  fs.writeFileSync(promptsFile, readFixture('prompts.minimal.json'));
  fs.mkdirSync(path.join(outputDir, 'workspace'), { recursive: true });
  [
    'prompt_preview.html',
    'preflight_board.html',
    'assets_board.html',
  ].forEach((name) => {
    fs.writeFileSync(path.join(outputDir, name), '<html>stale prepare detail page</html>');
    fs.writeFileSync(path.join(outputDir, 'workspace', name), '<html>stale prepare detail mirror</html>');
  });

  runNode('daoge_prepare_run.js', [
    '--task-spec', taskSpec,
    '--strategy-file', strategyFile,
    '--prompts-file', promptsFile,
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--preview-count', '2',
  ]);

  [
    'task_spec.normalized.json',
    'prompt_strategy.normalized.json',
    'prompt_strategy.enriched.json',
    'prompt_slots.json',
    'prompt_draft_bundle.json',
    'prompt_validation_report.json',
    'batch_plan.json',
    'daoge_mode_detection.json',
    'manifest.json',
    'workspace_state.json',
    'workspace_assets.json',
    'workspace_timeline.json',
    'workbench_state.json',
    'workspace_live_state.json',
    'prepare_workspace.html',
    'workspace_home.html',
    'workspace_layout_manifest.json',
  ].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, name)), true, `missing ${name}`);
  });
  [
    'workspace/workspace_home.html',
    'workspace/prepare_workspace.html',
    'internal/workspace_state.json',
    'internal/workspace_live_state.json',
    'internal/manifest.json',
  ].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, name)), true, `missing prepare layout mirror ${name}`);
  });
  const prepareLayoutManifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'workspace_layout_manifest.json'), 'utf8'));
  assert.equal(prepareLayoutManifest.mode, 'workspace-first');
  assert.equal(prepareLayoutManifest.source, 'daoge_prepare_run');
  const mirroredPrepareHome = fs.readFileSync(path.join(outputDir, 'workspace', 'workspace_home.html'), 'utf8');
  assert.match(mirroredPrepareHome, /href="prepare_workspace\.html"/);

  const validation = JSON.parse(fs.readFileSync(path.join(outputDir, 'prompt_validation_report.json'), 'utf8'));
  assert.equal(validation.ok, true);

  const modeDetection = JSON.parse(fs.readFileSync(path.join(outputDir, 'daoge_mode_detection.json'), 'utf8'));
  assert.equal(modeDetection.detected_mode, 'prepare-only');
  assert.equal(modeDetection.detected_template.id, 'campaign-poster');

  const workspaceState = JSON.parse(fs.readFileSync(path.join(outputDir, 'workspace_state.json'), 'utf8'));
  assert.equal(workspaceState.mode, 'prepare');
  assert.equal(workspaceState.runtimeMode, 'prepare-only');
  assert.equal(workspaceState.taskLabel, '高端时尚竖版海报');
  assert.ok(Array.isArray(workspaceState.pageGroups?.entry));
  assert.ok(Array.isArray(workspaceState.pageGroups?.mainline));
  assert.ok(Array.isArray(workspaceState.pageGroups?.support));
  assert.ok(Array.isArray(workspaceState.pageGroups?.conditional));
  assert.ok(Array.isArray(workspaceState.pageGroups?.advanced));
  assert.ok(Array.isArray(workspaceState.pageGroups?.defaultVisible));
  assert.ok(Array.isArray(workspaceState.pageGroups?.defaultGenerated));
  assert.ok(Array.isArray(workspaceState.pageGroups?.defaultGeneratedMainline));
  assert.ok(Array.isArray(workspaceState.pageGroups?.defaultGeneratedSupport));
  assert.ok(workspaceState.governanceByPage);
  assert.ok(workspaceState.artifactGovernance);
  assert.ok(workspaceState.assetLayers);
  assert.equal(workspaceState.assetLayers?.defaultLayer, 'user-facing');
  assert.match(String(workspaceState.assetLayers?.principle || ''), /普通用户默认只看可继续判断和处理的用户资产/);
  assert.equal(workspaceState.assetLayers?.userFacing?.title, '用户资产');
  assert.equal(workspaceState.assetLayers?.workbenchState?.title, '工作台状态资产');
  assert.equal(workspaceState.assetLayers?.diagnosticFacing?.title, '诊断归档资产');
  assert.equal(workspaceState.assetLayers?.systemFacing?.title, '系统资产');
  assert.equal(workspaceState.assetLayers?.directoryProtocol?.version, 1);
  assert.equal(workspaceState.assetLayers?.directoryProtocol?.defaultSurface, 'user-facing');
  assert.match(String(workspaceState.assetLayers?.directoryProtocol?.principle || ''), /输出目录只把主链工作台和少量补充入口留在用户直看层/);
  assert.ok(Array.isArray(workspaceState.assetLayers?.directoryProtocol?.defaultVisibleFiles));
  assert.ok(Array.isArray(workspaceState.assetLayers?.directoryProtocol?.surfaces?.userFacing?.items));
  assert.ok(Array.isArray(workspaceState.assetLayers?.directoryProtocol?.surfaces?.filesystem?.items));
  assert.ok(Array.isArray(workspaceState.assetLayers?.directoryProtocol?.surfaces?.archive?.items));
  assert.ok(Array.isArray(workspaceState.assetLayers?.directoryProtocol?.surfaces?.internal?.items));
  assert.equal(workspaceState.assetLayers?.stateTopology?.preferredRuntimeSource, path.join(outputDir, 'workspace_live_state.json'));
  assert.equal(workspaceState.assetLayers?.stateTopology?.canonicalState, path.join(outputDir, 'workspace_state.json'));
  assert.equal(workspaceState.assetLayers?.stateTopology?.runtimeState, path.join(outputDir, 'runtime_state.json'));
  assert.equal(workspaceState.assetLayers?.stateTopology?.assetsState, path.join(outputDir, 'workspace_assets.json'));
  assert.equal(workspaceState.assetLayers?.stateTopology?.timelineState, path.join(outputDir, 'workspace_timeline.json'));
  assert.equal(workspaceState.assetLayers?.stateTopology?.derivedWorkbenchSnapshot, path.join(outputDir, 'workbench_state.json'));
  assert.equal(workspaceState.assetLayers?.stateTopology?.taskCenterUnifiedState, path.join(path.dirname(outputDir), 'task_center_live_state.json'));
  assert.equal(workspaceState.assetLayers?.stateTopology?.taskCenterEntryProtocol?.source, path.join(path.dirname(outputDir), 'task_center_live_state.json'));
  assert.equal(workspaceState.assetLayers?.stateTopology?.taskCenterEntryProtocol?.entryGuideKey, 'entryMainlineGuide');
  assert.deepEqual(workspaceState.assetLayers?.stateTopology?.taskCenterEntryProtocol?.runtimeFields, ['runtimeMode', 'runtimeFocus', 'handoffRule']);
  assert.match(String(workspaceState.assetLayers?.stateTopology?.summary || ''), /入口主链提醒和运行态副驾驶交接/);
  assert.equal(workspaceState.stateProtocol?.files?.workspaceLiveState?.path, path.join(outputDir, 'workspace_live_state.json'));
  assert.equal(workspaceState.stateProtocol?.files?.workspaceState?.path, path.join(outputDir, 'workspace_state.json'));
  assert.equal(workspaceState.stateProtocol?.files?.runtimeState?.path, path.join(outputDir, 'runtime_state.json'));
  assert.equal(workspaceState.stateProtocol?.files?.taskCenterLiveState?.path, path.join(path.dirname(outputDir), 'task_center_live_state.json'));
  assert.match(String(workspaceState.stateProtocol?.files?.workspaceLiveState?.responsibility || ''), /轻量快照/);
  assert.match(String(workspaceState.stateProtocol?.files?.workspaceState?.responsibility || ''), /副驾驶协议/);
  assert.match(String(workspaceState.stateProtocol?.files?.runtimeState?.responsibility || ''), /运行中、暂停、等待确认、完成和异常分流/);
  assert.match(String(workspaceState.stateProtocol?.files?.taskCenterLiveState?.responsibility || ''), /入口主链提醒/);
  assert.deepEqual(workspaceState.stateProtocol?.files?.workspaceLiveState?.consumers?.slice(0, 2), ['loadWorkbenchState', 'workspace_home.html']);
  assert.match(String(workspaceState.stateProtocol?.duplicateFieldRule || ''), /统一由 workspace_state\.json 持有语义源/);
  assert.equal(workspaceState.stateProtocol?.fieldBoundaries?.currentFocus?.canonicalOwner, 'workspace_state.json');
  assert.match(String(workspaceState.stateProtocol?.fieldBoundaries?.pressureLabel?.reductionRule || ''), /页面\/阶段 UI 标签/);
  assert.deepEqual(workspaceState.stateProtocol?.consumerReadPlan?.pages?.fields, [
    'currentFocus',
    'nextActionSummary',
    'recommendedReply',
    'pressureLabel',
    'statusSummary',
  ]);
  assert.equal(workspaceState.stateProtocol?.consumerReadPlan?.runtime?.mirrorTargets?.[0], 'workspace_live_state.json');
  assert.equal(workspaceState.assetLayers?.stateTopology?.fieldBoundaries?.recommendedReply?.canonicalOwner, 'workspace_state.json');
  assert.equal(workspaceState.assetLayers?.stateTopology?.consumerReadPlan?.taskCenter?.primaryLayer, 'task_center_live_state.json');
  assert.equal(workspaceState.specialWorkflowProtocol?.activeWorkflowKind, 'standard');
  assert.equal(workspaceState.specialWorkflowProtocol?.hostNative?.officialMainline, true);
  assert.equal(workspaceState.specialWorkflowProtocol?.hostNative?.active, false);
  assert.equal(workspaceState.specialWorkflowProtocol?.storyboard?.officialSubsystem, true);
  assert.equal(workspaceState.specialWorkflowProtocol?.localEditRerun?.officialProfessionalPath, true);
  assert.equal(workspaceState.specialWorkflowProtocol?.defaultVisibility?.advancedPagesDefaultGenerated, false);
  assert.match(String(workspaceState.specialWorkflowProtocol?.localEditRerun?.defaultMainlineBehavior || ''), /异常页先判断/);
  assert.equal(workspaceState.assetLayers?.stateProtocol?.files?.workspaceState?.file, 'workspace_state.json');
  assert.equal(workspaceState.assetLayers?.userWorkbenchProtocol?.stateProtocol?.files?.runtimeState?.file, 'runtime_state.json');
  assert.equal(workspaceState.assetLayers?.userWorkbenchProtocol?.defaultEntryLabel, '工作台首页');
  assert.deepEqual(workspaceState.assetLayers?.userWorkbenchProtocol?.defaultVisibleLabels, ['工作台首页', '准备工作台', '结果工作台', '异常工作台']);
  assert.equal(workspaceState.assetLayers?.userWorkbenchProtocol?.stateSources?.primaryRuntimeSource, path.join(outputDir, 'workspace_live_state.json'));
  assert.equal(workspaceState.assetLayers?.userWorkbenchProtocol?.stateSources?.canonicalState, path.join(outputDir, 'workspace_state.json'));
  assert.equal(workspaceState.assetLayers?.userWorkbenchProtocol?.stateSources?.runtimeState, path.join(outputDir, 'runtime_state.json'));
  assert.equal(workspaceState.assetLayers?.userWorkbenchProtocol?.stateSources?.assetsState, path.join(outputDir, 'workspace_assets.json'));
  assert.equal(workspaceState.assetLayers?.userWorkbenchProtocol?.stateSources?.timelineState, path.join(outputDir, 'workspace_timeline.json'));
  assert.equal(workspaceState.assetLayers?.userWorkbenchProtocol?.stateSources?.derivedWorkbenchSnapshot, path.join(outputDir, 'workbench_state.json'));
  assert.equal(workspaceState.assetLayers?.userWorkbenchProtocol?.stateSources?.taskCenterUnifiedState, path.join(path.dirname(outputDir), 'task_center_live_state.json'));
  assert.equal(workspaceState.assetLayers?.userWorkbenchProtocol?.taskCenterEntryProtocol?.source, path.join(path.dirname(outputDir), 'task_center_live_state.json'));
  assert.equal(workspaceState.assetLayers?.userWorkbenchProtocol?.taskCenterEntryProtocol?.entryGuideKey, 'entryMainlineGuide');
  assert.match(String(workspaceState.assetLayers?.userWorkbenchProtocol?.taskCenterEntryProtocol?.handoffRule || ''), /单轮判断交给工作台首页/);
  assert.match(String(workspaceState.assetLayers?.userWorkbenchProtocol?.summary || ''), /workspace_live_state\.json 是主实时状态源/);
  assert.match(String(workspaceState.assetLayers?.userWorkbenchProtocol?.runtimeRule || ''), /workspace_state\.json 负责统一状态模型/);
  assert.equal(workspaceState.assetLayers?.userWorkbenchProtocol?.fieldBoundaries?.statusSummary?.canonicalOwner, 'workspace_state.json');
  assert.equal(workspaceState.assetLayers?.userWorkbenchProtocol?.consumerReadPlan?.copilot?.canonicalLayer, 'workspace_state.json');
  assert.ok(Array.isArray(workspaceState.assetLayers?.userFacing?.groups));
  assert.ok(Array.isArray(workspaceState.assetLayers?.workbenchState?.groups));
  assert.ok(Array.isArray(workspaceState.assetLayers?.diagnosticFacing?.items?.diagnostic));
  assert.ok(Array.isArray(workspaceState.assetLayers?.systemFacing?.groups));
  assert.ok(Array.isArray(workspaceState.assetLayers?.systemFacing?.items?.state));
  const workspaceAssetsState = JSON.parse(fs.readFileSync(path.join(outputDir, 'workspace_assets.json'), 'utf8'));
  assert.ok(workspaceAssetsState.assetCollections);
  assert.ok(Array.isArray(workspaceAssetsState.assetCollections?.userFacing?.preview));
  assert.ok(Array.isArray(workspaceAssetsState.assetCollections?.userFacing?.result));
  assert.ok(Array.isArray(workspaceAssetsState.assetCollections?.userFacing?.review));
  assert.ok(Array.isArray(workspaceAssetsState.assetCollections?.userFacing?.exception));
  assert.ok(Array.isArray(workspaceAssetsState.assetCollections?.userFacing?.reference));
  assert.ok(workspaceAssetsState.assetCollections?.system?.keyFiles);
  assert.equal(workspaceAssetsState.assetCollections?.system?.directoryProtocol?.version, 1);
  assert.ok(Array.isArray(workspaceAssetsState.assetCollections?.system?.directoryProtocol?.surfaces?.userFacing?.items));
  assert.equal('previewImages' in workspaceAssetsState, false);
  assert.equal('resultAssets' in workspaceAssetsState, false);
  assert.equal('reviewAssets' in workspaceAssetsState, false);
  assert.equal('exceptionItems' in workspaceAssetsState, false);
  assert.equal('referenceAssets' in workspaceAssetsState, false);
  assert.equal(workspaceState.artifactGovernance?.summary?.defaultEntryLabel, '工作台首页');
  assert.match(String(workspaceState.artifactGovernance?.summary?.principle || ''), /普通用户默认只走任务总控和四站工作台/);
  assert.equal(workspaceState.artifactGovernance?.userFacingSummary?.version, 1);
  assert.equal(workspaceState.artifactGovernance?.userFacingSummary?.defaultEntryLabel, '工作台首页');
  assert.deepEqual(workspaceState.artifactGovernance?.userFacingSummary?.defaultUserJourney, [
    'task-center',
    'workspace-home',
    'prepare-workspace',
    'result-workspace',
    'exception-workspace',
  ]);
  assert.match(String(workspaceState.artifactGovernance?.userFacingSummary?.principle || ''), /任务总控和四站工作台/);
  assert.deepEqual(workspaceState.artifactGovernance?.userFacingSummary?.defaultVisibleLayers, ['mainline', 'support']);
  assert.deepEqual(workspaceState.artifactGovernance?.userFacingSummary?.onDemandLayers, ['conditional', 'advanced']);
  assert.match(String(workspaceState.artifactGovernance?.userFacingSummary?.onDemandRule || ''), /prepare-details \/ result-details \/ all/);
  assert.match(
    JSON.stringify(workspaceState.artifactGovernance?.userFacingSummary?.advancedPagePolicy || []),
    /prompt_preview\.html.*prepare-details/
  );
  assert.match(
    JSON.stringify(workspaceState.artifactGovernance?.userFacingSummary?.advancedPagePolicy || []),
    /review_board\.html.*result-details/
  );
  assert.ok(Array.isArray(workspaceState.artifactGovernance?.userEntry));
  assert.ok(Array.isArray(workspaceState.artifactGovernance?.workspaceSupport));
  assert.ok(Array.isArray(workspaceState.artifactGovernance?.internalOnly));
  assert.equal(workspaceState.artifactGovernance?.artifactStrategy?.defaultGenerationMode, 'mainline-minimal');
  assert.equal(workspaceState.artifactGovernance?.artifactStrategy?.targetMode, 'workspace-first');
  assert.equal(workspaceState.artifactGovernance?.artifactStrategy?.groups?.supportVisible?.generation, 'mainline-plus-core-support');
  assert.equal(workspaceState.artifactGovernance?.artifactStrategy?.groups?.advancedVisible?.generation, 'on-demand-target');
  assert.equal(workspaceState.artifactGovernance?.artifactStrategy?.groups?.diagnosticInternal?.generation, 'eligible-on-demand');
  assert.equal(workspaceState.artifactGovernance?.artifactStrategy?.runtimeToggles?.diagnosticMarkdown?.default, false);
  assert.equal(workspaceState.artifactGovernance?.artifactLayerProtocol?.version, 1);
  assert.deepEqual(workspaceState.artifactGovernance?.artifactLayerProtocol?.defaultVisibleLayers, ['mainline', 'support']);
  assert.deepEqual(workspaceState.artifactGovernance?.artifactLayerProtocol?.onDemandLayers, ['conditional', 'advanced']);
  assert.deepEqual(workspaceState.artifactGovernance?.artifactLayerProtocol?.internalLayers, ['internal']);
  assert.match(String(workspaceState.artifactGovernance?.artifactLayerProtocol?.userFacingRule || ''), /普通用户默认只理解主链层和少量补充入口/);
  assert.equal(workspaceState.artifactGovernance?.artifactLayerProtocol?.layers?.mainline?.title, '主链层');
  assert.equal(workspaceState.artifactGovernance?.artifactLayerProtocol?.layers?.mainline?.generation, 'always');
  assert.equal(workspaceState.artifactGovernance?.artifactLayerProtocol?.layers?.support?.generation, 'mainline-plus-core-support');
  assert.equal(workspaceState.artifactGovernance?.artifactLayerProtocol?.layers?.advanced?.defaultVisible, false);
  assert.equal(workspaceState.artifactGovernance?.artifactLayerProtocol?.layers?.internal?.audience, 'diagnostic');
  assert.match(String(workspaceState.artifactGovernance?.artifactLayerProtocol?.layers?.advanced?.hiddenByDefaultReason || ''), /默认不应陪跑主流程/);
  assert.equal(workspaceState.artifactGovernance?.summary?.defaultVisibleLayerCount, 2);
  assert.ok(workspaceState.artifactGovernance?.summary?.optionalVisibleCount >= 0);
  assert.equal(workspaceState.optionalPageMode?.mode, 'mainline-only');
  assert.equal(workspaceState.optionalPageMode?.label, '主链极简模式');
  assert.match(String(workspaceState.optionalPageMode?.currentFocus || ''), /顺着主链继续/);
  assert.match(String(workspaceState.optionalPageMode?.deepDiveSuggestion || ''), /准备补充页|结果补充页/);
  assert.deepEqual(workspaceState.optionalPageMode?.layerPolicy?.visibleLayers, ['mainline', 'support']);
  assert.deepEqual(workspaceState.optionalPageMode?.layerPolicy?.generatedLayers, ['mainline', 'support']);
  assert.deepEqual(workspaceState.optionalPageMode?.layerPolicy?.hiddenLayers, ['conditional', 'advanced', 'internal']);
  assert.match(String(workspaceState.optionalPageMode?.layerPolicy?.summary || ''), /主链层和补充层/);
  assert.equal(workspaceState.optionalPageMode?.generationPolicy?.source, 'default-generation-contract');
  assert.match(String(workspaceState.optionalPageMode?.generationPolicy?.summary || ''), /主链极简模式生成/);
  assert.equal(workspaceState.optionalPageMode?.generationPolicy?.contractVersion, 1);
  assert.equal(workspaceState.optionalPageMode?.generationPolicy?.defaultMode, 'mainline-only');
  assert.equal(workspaceState.optionalPageMode?.generationPolicy?.targetMode, 'single-workbench-mainline');
  assert.match(String(workspaceState.optionalPageMode?.generationPolicy?.guardrail?.defaultVisibleRule || ''), /默认只看主链工作台和任务档案页/);
  assert.match(String(workspaceState.optionalPageMode?.generationPolicy?.guardrail?.onDemandRule || ''), /必须按需开启/);
  assert.match(String(workspaceState.optionalPageMode?.generationPolicy?.guardrail?.removedRule || ''), /不再生成|残留会被清理/);
  assert.match(String(workspaceState.optionalPageMode?.generationPolicy?.guardrail?.internalRule || ''), /默认不展示给普通用户/);
  assert.deepEqual(workspaceState.optionalPageMode?.generationPolicy?.defaultHtmlFiles, [
    'task_center.html',
    'workspace_home.html',
    'prepare_workspace.html',
    'result_workspace.html',
    'exception_workspace.html',
    'run_record.html',
  ]);
  assert.deepEqual(workspaceState.optionalPageMode?.availableModes?.[0]?.generatedLayers, ['mainline', 'support']);
  assert.equal(workspaceState.optionalPageMode?.generationContract?.version, 1);
  assert.equal(workspaceState.optionalPageMode?.generationContract?.targetMode, 'single-workbench-mainline');
  assert.match(String(workspaceState.optionalPageMode?.generationContract?.principle || ''), /默认只生成单一主链工作台/);
  assert.match(String(workspaceState.optionalPageMode?.generationContract?.defaultGenerationGuardrail?.userEntry || ''), /任务总控 -> 工作台首页/);
  assert.match(String(workspaceState.optionalPageMode?.generationContract?.reductionRule || ''), /新增页面必须先证明能帮助用户做判断/);
  assert.equal(workspaceState.artifactGovernance?.defaultGenerationContract?.version, 1);
  assert.deepEqual(
    workspaceState.artifactGovernance?.defaultGenerationContract?.currentMode?.generatedHtmlFiles,
    workspaceState.optionalPageMode?.generationContract?.currentMode?.generatedHtmlFiles
  );
  assert.deepEqual(
    workspaceState.optionalPageMode?.generationContract?.defaultHtml?.map((item) => item.file),
    [
      'task_center.html',
      'workspace_home.html',
      'prepare_workspace.html',
      'result_workspace.html',
      'exception_workspace.html',
      'run_record.html',
    ]
  );
  assert.match(
    JSON.stringify(workspaceState.optionalPageMode?.generationContract?.onDemandHtml || []),
    /preflight_board\.html|prompt_preview\.html|review_board\.html|rerun_board\.html/
  );
  assert.deepEqual(
    workspaceState.optionalPageMode?.generationContract?.prepareDetailHtml?.map((item) => item.file),
    ['preflight_board.html', 'prompt_preview.html', 'assets_board.html']
  );
  assert.deepEqual(
    workspaceState.optionalPageMode?.generationContract?.resultDetailHtml?.map((item) => item.file),
    ['review_board.html', 'completion_board.html', 'run_overview.html', 'rerun_board.html']
  );
  assert.deepEqual(
    workspaceState.optionalPageMode?.generationContract?.storyboardDetailHtml?.map((item) => item.file),
    ['storyboard_board.html']
  );
  assert.match(
    JSON.stringify(workspaceState.optionalPageMode?.generationContract?.detailModeMatrix || []),
    /prompt_preview\.html.*prepare-details/
  );
  assert.match(
    JSON.stringify(workspaceState.optionalPageMode?.generationContract?.detailModeMatrix || []),
    /review_board\.html.*result-details/
  );
  assert.match(
    JSON.stringify(workspaceState.optionalPageMode?.generationContract?.removedHtml || []),
    /result_hub\.html|daoge_portal\.html/
  );
  assert.match(
    JSON.stringify(workspaceState.optionalPageMode?.generationContract?.internalArtifacts || []),
    /workspace_state\.json|workspace_live_state\.json|operations_report\.json/
  );
  assert.deepEqual(
    workspaceState.optionalPageMode?.generationContract?.currentMode?.generatedHtmlFiles,
    [
      'task_center.html',
      'workspace_home.html',
      'prepare_workspace.html',
      'result_workspace.html',
      'exception_workspace.html',
      'run_record.html',
    ]
  );
  assert.match(
    JSON.stringify(workspaceState.optionalPageMode?.generationContract?.currentMode?.hiddenHtmlFiles || []),
    /review_board\.html|result_hub\.html|daoge_portal\.html/
  );
  assert.match(
    JSON.stringify(workspaceState.optionalPageMode?.generationContract?.currentMode?.hiddenHtmlFiles || []),
    /prompt_preview\.html|assets_board\.html|completion_board\.html|run_overview\.html|rerun_board\.html/
  );
  assert.ok(Array.isArray(workspaceState.artifactGovernance?.assetLifecycle));
  assert.ok(Array.isArray(workspaceState.artifactGovernance?.reductionCandidates));
  assert.ok(workspaceState.artifactGovernance?.summary?.reducibleCount >= 1);
  assert.match(JSON.stringify(workspaceState.artifactGovernance?.groupedAssets?.diagnosticInternal || []), /operations-report-json|run-record-markdown|prompt-preview-markdown|selection-board-markdown/);
  assert.match(JSON.stringify(workspaceState.artifactGovernance?.reductionCandidates || []), /operations-report-json|prompt-preview-markdown|selection-board-markdown|operations-report-markdown|result-hub|portal-home/);
  assert.match(JSON.stringify(workspaceState.artifactGovernance?.assetLifecycle || []), /disabled-by-default/);
  assert.equal(workspaceState.workbenchGuide?.home?.section?.title, '工作台使用规则');
  assert.match(String(workspaceState.workbenchGuide?.home?.section?.copy || ''), /工作台首页负责总览当前阶段/);
  assert.equal(workspaceState.workbenchGuide?.home?.section?.items?.[4]?.label, '当前细页模式');
  assert.equal(workspaceState.workbenchGuide?.home?.section?.items?.[5]?.label, '现在怎么用');
  assert.equal(workspaceState.workbenchGuide?.home?.section?.items?.[6]?.label, '如果想深看');
  assert.equal(workspaceState.workbenchGuide?.prepare?.section?.items?.[0]?.label, '主入口');
  assert.ok(Array.isArray(workspaceState.workbenchGuide?.result?.cards));
  assert.ok(Array.isArray(workspaceState.workbenchGuide?.exception?.cards));
  assert.equal(workspaceState.assetVisibilityGuide?.home?.title, '这页先看什么');
  assert.match(String(workspaceState.assetVisibilityGuide?.result?.copy || ''), /结果工作台只保留和筛图、取舍、继续推进有关的内容/);
  assert.equal(workspaceState.assetVisibilityGuide?.home?.items?.[3]?.label, '当前细页模式');
  assert.equal(workspaceState.assetVisibilityGuide?.home?.items?.[4]?.label, '现在怎么用');
  assert.equal(workspaceState.assetVisibilityGuide?.home?.items?.[5]?.label, '如果想深看');
  assert.equal(workspaceState.assetVisibilityGuide?.exception?.items?.[2]?.label, '先不用看');
  const { summarizeArtifactLayer, buildWorkspaceFallbackGuide } = require('../scripts/workspace_page_shared');
  const artifactLayerSnapshot = summarizeArtifactLayer(workspaceState.artifactGovernance || {});
  assert.equal(artifactLayerSnapshot.userFacingSummary?.defaultEntryLabel, '工作台首页');
  assert.match(String(artifactLayerSnapshot.principle || ''), /唯一常驻补充入口/);
  assert.equal(artifactLayerSnapshot.layers?.mainline?.title, '主链层');
  assert.equal(artifactLayerSnapshot.layers?.support?.title, '补充层');
  assert.deepEqual(artifactLayerSnapshot.defaultVisibleLayers, ['mainline', 'support']);
  assert.deepEqual(artifactLayerSnapshot.onDemandLayers, ['conditional', 'advanced']);
  const homeFallbackGuide = buildWorkspaceFallbackGuide('home', artifactLayerSnapshot);
  assert.equal(homeFallbackGuide.guide.items?.[1]?.label, '默认可见层');
  assert.match(String(homeFallbackGuide.guide.items?.[1]?.value || ''), /主链层|补充层/);
  assert.match(String(homeFallbackGuide.guide.items?.[3]?.value || ''), /条件页层|进阶页层|内部资产层/);
  assert.match(String(homeFallbackGuide.visibility.items?.[1]?.value || ''), /补充层/);
  assert.match(String(homeFallbackGuide.visibility.items?.[2]?.value || ''), /内部资产层|条件页层|进阶页层/);
  assert.equal(workspaceState.views?.prepare?.sections?.direction?.title, '任务方向');
  assert.match(String(workspaceState.views?.prepare?.sections?.direction?.copy || ''), /普通用户真正需要看的方向信息/);
  assert.equal(workspaceState.views?.prepare?.sections?.readiness?.title, '执行判断');
  assert.equal(workspaceState.views?.prepare?.sections?.assets?.title, '素材绑定');
  assert.equal(workspaceState.views?.result?.sections?.issues?.title, '异常摘要');
  assert.match(String(workspaceState.views?.result?.sections?.issues?.copy || ''), /真正需要关注的问题/);
  assert.equal(workspaceState.views?.exception?.sections?.issues?.title, '问题列表');
  assert.match(String(workspaceState.views?.exception?.sections?.issues?.copy || ''), /只保留真正会影响主链继续的问题/);
  assert.equal(workspaceState.governanceByPage?.['workspace_home.html']?.currentPage, 'workspace_home.html');
  assert.equal(workspaceState.governanceByPage?.['prepare_workspace.html']?.currentPage, 'prepare_workspace.html');
  assert.equal(workspaceState.governanceByPage?.['result_workspace.html']?.currentPage, 'result_workspace.html');
  assert.equal(workspaceState.governanceByPage?.['exception_workspace.html']?.currentPage, 'exception_workspace.html');
  assert.equal(workspaceState.governanceByPage?.['run_record.html']?.currentPage, 'run_record.html');
  assert.deepEqual(workspaceState.governanceByPage?.['workspace_home.html']?.navigation?.topLinkIds, ['task-center', 'catalog', 'result-workspace']);
  assert.deepEqual(workspaceState.governanceByPage?.['result_workspace.html']?.navigation?.topLinkIds, ['workspace-home', 'task-center', 'exception-workspace']);
  assert.deepEqual(workspaceState.governanceByPage?.['workspace_home.html']?.navigation?.progressTrackIds, ['workspace-home', 'prepare-workspace', 'result-workspace', 'exception-workspace']);
  assert.deepEqual(workspaceState.governanceByPage?.['workspace_home.html']?.navigation?.defaultVisibleGroups, ['entry', 'mainline']);
  assert.deepEqual(workspaceState.governanceByPage?.['workspace_home.html']?.navigation?.defaultGeneratedSupportGroups, ['support']);
  assert.deepEqual(workspaceState.governanceByPage?.['workspace_home.html']?.navigation?.governanceReason?.defaultVisibleLayers, ['mainline', 'support']);
  assert.deepEqual(workspaceState.governanceByPage?.['workspace_home.html']?.navigation?.governanceReason?.onDemandLayers, ['conditional', 'advanced']);
  assert.match(String(workspaceState.governanceByPage?.['workspace_home.html']?.navigation?.governanceReason?.summary || ''), /默认先保留/);
  assert.deepEqual(workspaceState.governanceByPage?.['workspace_home.html']?.workbenchEntryIds, ['prepare-workspace']);
  assert.deepEqual(workspaceState.governanceByPage?.['prepare_workspace.html']?.workbenchEntryIds, ['result-workspace', 'workspace-home']);
  assert.deepEqual(workspaceState.governanceByPage?.['result_workspace.html']?.workbenchEntryIds, ['exception-workspace']);
  assert.deepEqual(workspaceState.governanceByPage?.['exception_workspace.html']?.workbenchEntryIds, ['result-workspace']);
  assert.equal(workspaceState.governanceByPage?.['workspace_home.html']?.optionalSurface?.mode, 'mainline-only');
  assert.deepEqual(workspaceState.governanceByPage?.['workspace_home.html']?.optionalSurface?.advancedVisibleIds, []);
  assert.equal(workspaceState.governanceByPage?.['workspace_home.html']?.optionalSurface?.showPrepareDetailEntry, false);
  assert.equal(workspaceState.governanceByPage?.['workspace_home.html']?.optionalSurface?.showResultDetailEntry, false);
  assert.equal(workspaceState.governanceByPage?.['workspace_home.html']?.optionalSurface?.showRerunEntry, false);
  assert.equal(workspaceState.governanceByPage?.['workspace_home.html']?.optionalSurface?.governanceReason?.conditionalLayerTitle, '条件页层');
  assert.equal(workspaceState.governanceByPage?.['workspace_home.html']?.optionalSurface?.governanceReason?.advancedLayerTitle, '进阶页层');
  assert.match(String(workspaceState.governanceByPage?.['workspace_home.html']?.optionalSurface?.governanceReason?.summary || ''), /按需层默认继续后退/);
  assert.match(String(workspaceState.governanceByPage?.['workspace_home.html']?.governanceReason?.userFacingRule || ''), /普通用户默认只理解主链层和少量补充入口/);
  assert.match(String(workspaceState.governanceByPage?.['workspace_home.html']?.governanceReason?.workbenchEntryRule || ''), /只保留一条最值得继续的主链入口/);
  assert.match(JSON.stringify(workspaceState.pageGroups.mainline), /工作台首页|准备工作台|结果工作台|异常工作台/);
  assert.ok(Array.isArray(workspaceState.pageGroups.support));
  assert.match(JSON.stringify(workspaceState.pageGroups.defaultVisible), /任务总控|工作台首页|准备工作台|结果工作台|异常工作台/);
  assert.doesNotMatch(JSON.stringify(workspaceState.pageGroups.defaultVisible), /任务档案/);
  assert.match(JSON.stringify(workspaceState.pageGroups.defaultGenerated), /任务总控|工作台首页|准备工作台|结果工作台|异常工作台|任务档案/);
  assert.match(JSON.stringify(workspaceState.pageGroups.defaultGeneratedMainline), /任务总控|工作台首页|准备工作台|结果工作台|异常工作台/);
  assert.doesNotMatch(JSON.stringify(workspaceState.pageGroups.defaultGeneratedMainline), /任务档案/);
  assert.match(JSON.stringify(workspaceState.pageGroups.defaultGeneratedSupport), /任务档案/);
  assert.equal(workspaceState.prepare?.readiness?.label, '可以进入执行');
  assert.equal(workspaceState.prepare?.batchCount, 2);
  assert.ok(workspaceState.result);
  assert.ok(workspaceState.exception);
  assert.ok(workspaceState.views);
  assert.equal(workspaceState.views?.home?.decision?.title, '当前判断');
  assert.equal(workspaceState.views?.home?.summary?.enabled, false);
  assert.equal(workspaceState.views?.prepare?.summary?.title, '准备摘要');
  assert.equal(workspaceState.views?.result?.summary?.title, '结果摘要');
  assert.equal(workspaceState.views?.exception?.summary?.title, '异常摘要');
  assert.deepEqual(
    (workspaceState.views?.home?.summary?.items || []).map((item) => item.label),
    ['当前阶段', '当前结论', '结果概况', '当前重点', '下一步', '为什么先做这一步']
  );
  assert.deepEqual(
    (workspaceState.views?.prepare?.summary?.items || []).map((item) => item.label),
    ['当前阶段', '当前结论', '结果概况', '当前重点', '下一步', '为什么先做这一步']
  );
  assert.deepEqual(
    (workspaceState.views?.result?.summary?.items || []).map((item) => item.label),
    ['当前阶段', '当前结论', '结果概况', '当前重点', '下一步', '为什么先做这一步']
  );
  assert.deepEqual(
    (workspaceState.views?.exception?.summary?.items || []).map((item) => item.label),
    ['当前阶段', '当前结论', '结果概况', '当前重点', '下一步', '为什么先做这一步']
  );
  assert.equal(workspaceState.views?.result?.summary?.enabled, false);
  assert.equal(workspaceState.views?.exception?.summary?.enabled, false);
  assert.equal(workspaceState.views?.home?.sections?.preview?.title, '图片速览');
  assert.equal(workspaceState.views?.home?.sections?.preview?.enabled, false);
  assert.equal(workspaceState.views?.home?.sections?.preview?.emptyText, '当前还没有可展示的成功结果。');
  assert.deepEqual(
    (workspaceState.views?.home?.contentSections || []).map((item) => [item.key, item.kind, item.enabled]),
    [
      ['preview', 'previewGrid', false],
      ['guide', 'keyValue', true],
      ['visibility', 'keyValue', true],
    ]
  );
  assert.equal(workspaceState.views?.prepare?.sections?.direction?.title, '任务方向');
  assert.equal(workspaceState.views?.prepare?.sections?.readiness?.blockingTitle, '阻塞清单');
  assert.equal(workspaceState.views?.prepare?.sections?.readiness?.cautionTitle, '提醒清单');
  assert.equal(workspaceState.views?.prepare?.sections?.assets?.title, '素材绑定');
  assert.deepEqual(
    (workspaceState.views?.prepare?.contentSections || []).map((item) => [item.key, item.kind, item.enabled]),
    [
      ['direction', 'keyValue', true],
      ['readiness', 'readinessGrid', true],
      ['assets', 'keyValue', true],
      ['guide', 'keyValue', true],
      ['visibility', 'keyValue', true],
    ]
  );
  assert.equal(workspaceState.views?.result?.sections?.preview?.title, '图片速览');
  assert.equal(workspaceState.views?.result?.sections?.preview?.imageLinkLabel, '查看原图');
  assert.equal(workspaceState.views?.result?.sections?.issues?.title, '异常摘要');
  assert.equal(workspaceState.views?.result?.sections?.issues?.kicker, '需要关注');
  assert.equal(workspaceState.views?.result?.sections?.advanced?.summary, '展开查看结构分布');
  assert.equal(workspaceState.views?.result?.sections?.advanced?.requestModeTitle, '请求方式分布');
  assert.deepEqual(
    (workspaceState.views?.result?.contentSections || []).map((item) => [item.key, item.kind, item.enabled]),
    [
      ['preview', 'previewGrid', true],
      ['issues', 'issuesGrid', true],
      ['guide', 'keyValue', true],
      ['visibility', 'keyValue', true],
    ]
  );
  assert.equal(workspaceState.views?.exception?.sections?.issues?.title, '问题列表');
  assert.equal(workspaceState.views?.exception?.sections?.issues?.emptyText, '当前没有明显异常，这一页可以先不使用。');
  assert.deepEqual(
    (workspaceState.views?.exception?.contentSections || []).map((item) => [item.key, item.kind, item.enabled]),
    [
      ['issues', 'issuesGrid', true],
      ['guide', 'keyValue', true],
      ['visibility', 'keyValue', true],
    ]
  );
  assert.equal(workspaceState.views?.prepare?.transitionStatus?.title, '进入结果页前，你已经确认了什么');
  assert.equal(workspaceState.views?.result?.transitionStatus?.title, '从准备页进入结果页后，这一页先看什么');
  assert.equal(workspaceState.views?.result?.handoffFromPrevious?.title, '从准备页进入结果页后，这一页先看什么');
  assert.equal(workspaceState.views?.result?.handoffToNext?.title, '从结果页转入异常页前，这一页已经帮你初判了什么');
  assert.equal(workspaceState.views?.exception?.transitionStatus?.title, '从结果页进入异常页后，先处理哪一类问题');
  assert.equal(workspaceState.views?.exception?.handoffFromPrevious?.title, '从结果页进入异常页后，先处理哪一类问题');
  assert.equal(workspaceState.views?.exception?.handoffToNext?.title, '异常处理完后，回工作台前先确认什么');
  assert.equal(workspaceState.views?.home?.route?.title, '先做这一步');
  assert.equal(workspaceState.views?.home?.workbench?.title, '按需再看');
  assert.equal(workspaceState.views?.home?.context?.runLabel, '高端时尚竖版海报');
  assert.equal(workspaceState.views?.home?.hero?.title, 'DAOGE 工作台首页');
  assert.equal(workspaceState.views?.home?.flow?.title, '当前流程状态');
  assert.equal(workspaceState.views?.prepare?.flow?.title, '当前流程状态');
  assert.equal(workspaceState.views?.result?.flow?.title, '当前流程状态');
  assert.equal(workspaceState.views?.exception?.flow?.title, '当前流程状态');
  assert.equal(workspaceState.views?.home?.display?.stage, 'home');
  assert.equal(workspaceState.views?.prepare?.display?.stage, 'prepare');
  assert.equal(workspaceState.views?.result?.display?.stage, 'result');
  assert.equal(workspaceState.views?.exception?.display?.stage, 'exception');
  assert.equal(workspaceState.views?.home?.copilot?.title, '会话副驾驶');
  assert.equal(workspaceState.views?.prepare?.copilot?.title, '会话副驾驶');
  assert.equal(workspaceState.views?.result?.copilot?.title, '会话副驾驶');
  assert.equal(workspaceState.views?.exception?.copilot?.title, '会话副驾驶');
  assert.equal(workspaceState.views?.home?.workflowCopilot?.stageKey, 'home');
  assert.equal(workspaceState.views?.prepare?.workflowCopilot?.stageKey, 'prepare');
  assert.equal(workspaceState.views?.result?.workflowCopilot?.stageKey, 'result');
  assert.equal(workspaceState.views?.exception?.workflowCopilot?.stageKey, 'exception');
  assert.equal(workspaceState.views?.home?.workflowContract?.stageKey, 'home');
  assert.equal(workspaceState.views?.prepare?.workflowContract?.stageKey, 'prepare');
  assert.equal(workspaceState.views?.result?.workflowContract?.stageKey, 'result');
  assert.equal(workspaceState.views?.exception?.workflowContract?.stageKey, 'exception');
  assert.equal(workspaceState.workflowSessions?.home?.stageKey, 'home');
  assert.equal(workspaceState.workflowSessions?.prepare?.stageKey, 'prepare');
  assert.equal(workspaceState.workflowSessions?.result?.stageKey, 'result');
  assert.equal(workspaceState.workflowSessions?.exception?.stageKey, 'exception');
  assert.equal(workspaceState.taskSessionSnapshots?.home?.title, '任务会话快照');
  assert.equal(workspaceState.taskSessionSnapshots?.prepare?.title, '任务会话快照');
  assert.equal(workspaceState.taskSessionSnapshots?.result?.title, '任务会话快照');
  assert.equal(workspaceState.taskSessionSnapshots?.exception?.title, '任务会话快照');
  assert.ok(Array.isArray(workspaceState.taskSessionSnapshots?.home?.items));
  assert.ok(Array.isArray(workspaceState.taskSessionSnapshots?.prepare?.items));
  assert.ok(Array.isArray(workspaceState.taskSessionSnapshots?.result?.items));
  assert.ok(Array.isArray(workspaceState.taskSessionSnapshots?.exception?.items));
  assert.equal(workspaceState.workflowCopilotRegistry?.home?.stageKey, 'home');
  assert.equal(workspaceState.workflowContracts?.home?.stageKey, 'home');
  assert.equal(workspaceState.workflowContracts?.prepare?.stageKey, 'prepare');
  assert.equal(workspaceState.workflowContracts?.result?.stageKey, 'result');
  assert.equal(workspaceState.workflowContracts?.exception?.stageKey, 'exception');
  assert.equal(workspaceState.workflowTextProtocol?.home?.source, 'workflowContracts.home');
  assert.equal(workspaceState.workflowTextProtocol?.prepare?.source, 'workflowContracts.prepare');
  assert.equal(workspaceState.workflowTextProtocol?.result?.source, 'workflowContracts.result');
  assert.equal(workspaceState.workflowTextProtocol?.exception?.source, 'workflowContracts.exception');
  assert.equal(
    workspaceState.workflowTextProtocol?.result?.nextActionSummary,
    workspaceState.workflowContracts?.result?.nextAction?.summary
  );
  assert.equal(
    workspaceState.workflowTextProtocol?.exception?.recommendedReply,
    workspaceState.workflowContracts?.exception?.nextAction?.recommendedReply
      || workspaceState.workflowContracts?.exception?.dialogue?.recommendedReply
  );
  assert.deepEqual(
    workspaceState.workflowTextProtocol?.home?.readPriority?.slice(0, 3),
    ['workflowContracts.home.currentJudgment', 'workflowContracts.home.nextAction', 'workflowContracts.home.dialogue']
  );
  assert.equal(workspaceState.views?.home?.workflowCopilot?.snapshot?.taskLabel, '高端时尚竖版海报');
  assert.equal(workspaceState.workflowSessions?.home?.snapshot?.taskLabel, '高端时尚竖版海报');
  assert.equal(
    workspaceState.views?.home?.workflowContract?.snapshot?.nextActionLabel,
    workspaceState.workflowSessions?.home?.action?.label
  );
  assert.equal(
    workspaceState.views?.prepare?.workflowContract?.dialogue?.primarySay,
    workspaceState.workflowSessions?.prepare?.reply?.primarySay
  );
  assert.equal(
    workspaceState.views?.result?.workflowContract?.confirmation?.summary,
    workspaceState.workflowSessions?.result?.checkpoints?.summary
  );
  assert.equal(
    workspaceState.views?.exception?.workflowContract?.recent?.title,
    String(workspaceState.workflowSessions?.exception?.relay?.recentEvent?.title || '')
  );
  assert.equal(
    workspaceState.workflowContracts?.result?.nextAction?.recommendedReply,
    workspaceState.workflowSessions?.result?.action?.recommendedReply
  );
  assert.ok(String(workspaceState.views?.prepare?.workflowCopilot?.checkpoints?.summary || '').trim().length > 0);
  assert.ok(String(workspaceState.workflowSessions?.prepare?.checkpoints?.summary || '').trim().length > 0);
  assert.ok(String(workspaceState.views?.result?.workflowCopilot?.rhythm?.primarySay || '').trim().length > 0);
  assert.ok(String(workspaceState.workflowSessions?.result?.rhythm?.primarySay || '').trim().length > 0);
  assert.ok(String(workspaceState.views?.result?.workflowCopilot?.reply?.primarySay || '').trim().length > 0);
  assert.ok(String(workspaceState.workflowSessions?.result?.reply?.replyReason || '').trim().length > 0);
  assert.ok(Array.isArray(workspaceState.workflowSessions?.result?.reply?.alternativeSayItems));
  assert.ok(String(workspaceState.views?.result?.workflowCopilot?.action?.label || '').trim().length > 0);
  assert.ok(String(workspaceState.workflowSessions?.prepare?.action?.summary || '').trim().length > 0);
  assert.ok(Array.isArray(workspaceState.workflowSessions?.exception?.action?.notes));
  assert.ok(String(workspaceState.workflowSessions?.result?.coordination?.primarySay || '').trim().length > 0);
  assert.ok(Array.isArray(workspaceState.workflowSessions?.exception?.coordination?.confirmItems));
  assert.ok(Array.isArray(workspaceState.views?.exception?.workflowCopilot?.console?.statusStack));
  assert.ok(Array.isArray(workspaceState.workflowSessions?.exception?.console?.statusStack));
  assert.equal(workspaceState.views?.home?.copilot?.hero?.taskControlBar?.taskLabel, '高端时尚竖版海报');
  assert.ok(Array.isArray(workspaceState.views?.prepare?.copilot?.hero?.cockpitSummary?.items));
  assert.ok(Array.isArray(workspaceState.views?.result?.copilot?.mainline?.statusStack));
  assert.ok(Array.isArray(workspaceState.views?.exception?.copilot?.hero?.heroCards));
  assert.equal(workspaceState.views?.result?.copilot?.mainline?.dialogueStatus?.title, '对话协同');
  assert.ok(String(workspaceState.views?.exception?.copilot?.reply?.primarySay || '').trim().length > 0);
  assert.equal(
    workspaceState.views?.home?.copilot?.snapshot?.nextActionLabel,
    workspaceState.workflowSessions?.home?.action?.label
  );
  assert.equal(
    workspaceState.views?.prepare?.copilot?.snapshot?.recommendedReply,
    workspaceState.workflowSessions?.prepare?.reply?.primarySay
  );
  assert.deepEqual(
    workspaceState.views?.result?.copilot?.mainline?.statusStack,
    workspaceState.workflowSessions?.result?.console?.statusStack
  );
  assert.equal(
    workspaceState.views?.exception?.copilot?.hero?.sessionConsole?.title,
    workspaceState.workflowSessions?.exception?.console?.sessionConsole?.title
  );
  assert.equal(
    workspaceState.views?.home?.copilot?.hero?.sessionConsole?.title,
    workspaceState.taskSessionSnapshots?.home?.title
  );
  assert.equal(
    workspaceState.views?.prepare?.copilot?.hero?.sessionConsole?.title,
    workspaceState.taskSessionSnapshots?.prepare?.title
  );
  assert.equal(
    workspaceState.views?.result?.copilot?.hero?.sessionConsole?.title,
    workspaceState.taskSessionSnapshots?.result?.title
  );
  assert.equal(
    workspaceState.views?.exception?.copilot?.hero?.sessionConsole?.title,
    workspaceState.taskSessionSnapshots?.exception?.title
  );
  assert.equal(
    workspaceState.views?.exception?.copilot?.reply?.reason,
    workspaceState.workflowSessions?.exception?.reply?.replyReason
  );
  assert.deepEqual(
    Object.keys(loadWorkbenchState(outputDir).snapshot?.workflowSessions || {}).sort(),
    ['exception', 'home', 'prepare', 'result']
  );
  const liveWorkbenchSnapshot = JSON.parse(fs.readFileSync(path.join(outputDir, 'workspace_live_state.json'), 'utf8'));
  assert.deepEqual(liveWorkbenchSnapshot.workflowSessions || {}, {});
  assert.deepEqual(liveWorkbenchSnapshot.status || {}, {});
  assert.deepEqual(liveWorkbenchSnapshot.counts || {}, {});
  assert.deepEqual(liveWorkbenchSnapshot.nextAction || {}, {});
  assert.deepEqual(liveWorkbenchSnapshot.risk || {}, {});
  assert.deepEqual(liveWorkbenchSnapshot.confirmationState || {}, {});
  assert.deepEqual(liveWorkbenchSnapshot.runtimeSummary || {}, {});
  assert.equal(liveWorkbenchSnapshot.runtimeWorkflow, null);
  assert.deepEqual(liveWorkbenchSnapshot.workflowProtocolRegistry || {}, {});
  assert.deepEqual(liveWorkbenchSnapshot.workflowCopilotRegistry || {}, {});
  assert.deepEqual(liveWorkbenchSnapshot.workflowTextProtocol || {}, {});
  assert.deepEqual(workspaceState.views?.home?.display?.order, ['default', 'content', 'support', 'advanced']);
  assert.equal(workspaceState.views?.home?.display?.sectionRegistry?.flow?.layer, 'default');
  assert.equal(workspaceState.views?.prepare?.display?.sectionRegistry?.transitions?.layer, 'support');
  assert.equal(workspaceState.views?.prepare?.display?.sectionRegistry?.content?.layer, 'content');
  assert.equal(workspaceState.views?.result?.display?.sectionRegistry?.advanced?.layer, 'advanced');
  assert.equal(workspaceState.views?.exception?.display?.sectionRegistry?.dialogue?.audience, 'all');
  assert.deepEqual(workspaceState.views?.home?.display?.sectionGroups?.content?.sectionKeys, ['content']);
  assert.deepEqual(workspaceState.views?.prepare?.display?.sectionGroups?.content?.sectionKeys, ['content']);
  assert.deepEqual(workspaceState.views?.result?.display?.sectionGroups?.content?.sectionKeys, ['content']);
  assert.deepEqual(workspaceState.views?.exception?.display?.sectionGroups?.content?.sectionKeys, ['content']);
  assert.deepEqual(workspaceState.views?.prepare?.display?.sectionGroups?.default?.sectionKeys, ['judgment', 'stageRelay']);
  assert.deepEqual(workspaceState.views?.result?.display?.sectionGroups?.default?.sectionKeys, ['judgment']);
  assert.deepEqual(workspaceState.views?.exception?.display?.sectionGroups?.default?.sectionKeys, ['judgment']);
  assert.deepEqual(workspaceState.views?.home?.display?.sectionGroups?.support?.sectionKeys, ['flow', 'statusStack', 'assets']);
  assert.deepEqual(workspaceState.views?.prepare?.display?.sectionGroups?.support?.sectionKeys, ['flow', 'statusStack', 'transitions']);
  assert.deepEqual(workspaceState.views?.result?.display?.sectionGroups?.support?.sectionKeys, ['stageRelay', 'statusStack', 'transitions']);
  assert.deepEqual(workspaceState.views?.exception?.display?.sectionGroups?.support?.sectionKeys, ['stageRelay', 'statusStack', 'transitions']);
  assert.deepEqual(workspaceState.views?.home?.display?.sectionGroups?.advanced?.sectionKeys, ['timeline']);
  assert.deepEqual(workspaceState.views?.prepare?.display?.sectionGroups?.advanced?.sectionKeys, ['timeline']);
  assert.deepEqual(workspaceState.views?.result?.display?.sectionGroups?.advanced?.sectionKeys, ['collaboration', 'timeline', 'advanced', 'summary']);
  assert.deepEqual(workspaceState.views?.exception?.display?.sectionGroups?.advanced?.sectionKeys, ['collaboration', 'timeline', 'summary']);
  assert.ok(Array.isArray(workspaceState.views?.prepare?.display?.sectionGroups?.support?.sectionKeys));
  assert.ok(workspaceState.views?.prepare?.display?.sectionGroups?.support?.sectionKeys.includes('transitions'));
  assert.ok(workspaceState.views?.result?.display?.sectionGroups?.support?.sectionKeys.includes('stageRelay'));
  assert.ok(Array.isArray(workspaceState.views?.result?.display?.sectionGroups?.advanced?.sectionKeys));
  assert.deepEqual(workspaceState.views?.home?.display?.sectionGroups?.default?.sectionKeys, ['judgment', 'stageRelay']);
  assert.ok(workspaceState.views?.exception?.display?.modeSwitch?.copy.includes('简洁查看'));
  assert.equal(workspaceState.views?.home?.display?.surfaceRules?.progressWindowRadius, 1);
  assert.equal(workspaceState.views?.home?.display?.surfaceRules?.routeMaxNextSteps, 1);
  assert.equal(workspaceState.views?.home?.display?.surfaceRules?.workbenchMaxCards, 1);
  assert.equal(workspaceState.governanceByPage?.['workspace_home.html']?.display?.surfaceRules?.routeMaxNextSteps, 1);
  assert.equal(workspaceState.governanceByPage?.['result_workspace.html']?.display?.surfaceRules?.workbenchMaxCards, 1);
  assert.equal(workspaceState.views?.home?.dialogueStatus?.title, '对话协同');
  assert.equal(workspaceState.views?.prepare?.dialogueStatus?.title, '对话协同');
  assert.equal(workspaceState.views?.result?.dialogueStatus?.title, '对话协同');
  assert.equal(workspaceState.views?.exception?.dialogueStatus?.title, '对话协同');
  assert.equal(workspaceState.views?.home?.dialogueStatus?.recentTitle, '系统刚接住');
  assert.ok(Array.isArray(workspaceState.views?.result?.dialogueStatus?.recentItems));
  assert.ok(Array.isArray(workspaceState.views?.exception?.dialogueStatus?.nextSayItems));
  assert.equal((workspaceState.views?.home?.dialogueStatus?.confirmItems || []).length, 0);
  assert.equal((workspaceState.views?.prepare?.dialogueStatus?.confirmItems || []).length, 0);
  assert.equal((workspaceState.views?.result?.dialogueStatus?.confirmItems || []).length, 0);
  assert.equal((workspaceState.views?.exception?.dialogueStatus?.confirmItems || []).length, 0);
  assert.ok(workspaceState.confirmationState);
  assert.ok(workspaceState.prepare?.confirmationState);
  assert.ok(workspaceState.result?.confirmationState);
  assert.ok(workspaceState.exception?.confirmationState);
  assert.equal(workspaceState.confirmationState?.stageLabel, '准备阶段');
  assert.equal(workspaceState.confirmationState?.canContinue, true);
  assert.equal(workspaceState.confirmationState?.recentEvent?.title, '准备阶段已生成');
  assert.equal(workspaceState.confirmationState?.recommendedReply, '继续，进入准备工作台');
  assert.equal(workspaceState.views?.home?.dialogueStatus?.primarySay, '继续，进入准备工作台');
  assert.equal(workspaceState.unifiedStatus?.dialogue?.primarySay, workspaceState.views?.home?.dialogueStatus?.primarySay);
  assert.equal(workspaceState.prepare?.confirmationState?.stageLabel, '准备阶段');
  assert.equal(workspaceState.prepare?.confirmationState?.canContinue, true);
  assert.equal(workspaceState.prepare?.confirmationState?.recentEvent?.title, '准备阶段已生成');
  assert.equal(workspaceState.prepare?.confirmationState?.recommendedReply, '继续，进入结果工作台');
  assert.equal(workspaceState.views?.prepare?.dialogueStatus?.primarySay, '继续，进入结果工作台');
  assert.equal(workspaceState.result?.confirmationState?.stageLabel, '结果阶段');
  assert.equal(workspaceState.result?.confirmationState?.recommendedReply, '继续，回工作台首页');
  assert.equal(workspaceState.exception?.confirmationState?.stageLabel, '异常阶段');
  assert.equal(workspaceState.exception?.confirmationState?.recommendedReply, '继续，回结果工作台复核');
  assert.match(String(workspaceState.prepare?.confirmationState?.summary || ''), /准备层/);
  assert.match(String(workspaceState.result?.confirmationState?.summary || ''), /结果层/);
  assert.match(String(workspaceState.exception?.confirmationState?.summary || ''), /异常层/);
  assert.ok(Array.isArray(workspaceState.views?.home?.flow?.availableActions));
  assert.ok(Array.isArray(workspaceState.views?.prepare?.flow?.blockers));
  assert.ok(Array.isArray(workspaceState.views?.result?.flow?.availableActions));
  assert.ok(Array.isArray(workspaceState.views?.exception?.flow?.blockers));
  assert.ok(Array.isArray(workspaceState.views?.home?.heroCards));
  assert.ok(Array.isArray(workspaceState.views?.prepare?.heroCards));
  assert.ok(Array.isArray(workspaceState.views?.prepare?.route?.nextSteps));
  assert.ok(Array.isArray(workspaceState.views?.result?.workbench?.cards));
  assert.ok(Array.isArray(workspaceState.views?.result?.heroCards));
  assert.ok(Array.isArray(workspaceState.views?.exception?.workbench?.cards));
  assert.ok(Array.isArray(workspaceState.views?.exception?.heroCards));
  assert.ok(String(workspaceState.result?.nextStepLabel || '').trim().length > 0);
  assert.equal(workspaceState.exception?.currentFocus, '当前没有明显异常');

  const prepareWorkspace = fs.readFileSync(path.join(outputDir, 'prepare_workspace.html'), 'utf8');
  assert.match(prepareWorkspace, /DAOGE 准备工作台/);
  assert.match(prepareWorkspace, /会话副驾驶/);
  assert.match(prepareWorkspace, /当前判断/);
  assert.match(prepareWorkspace, /准备阶段已生成/);
  assert.match(prepareWorkspace, /当前流程状态/);
  assert.doesNotMatch(prepareWorkspace, /阶段确认/);
  assert.match(prepareWorkspace, /推荐下一步/);
  assert.match(prepareWorkspace, /先做这一步/);
  assert.match(prepareWorkspace, /进入结果工作台/);
  assert.match(prepareWorkspace, /按需再看/);
  assert.match(prepareWorkspace, /进入结果页前，你已经确认了什么/);
  assert.match(prepareWorkspace, /准备页已经确认/);
  assert.match(prepareWorkspace, /进入结果页先看/);
  assert.match(prepareWorkspace, /工作台使用规则/);
  assert.match(prepareWorkspace, /这页先看什么/);
  assert.match(prepareWorkspace, /任务方向/);
  assert.match(prepareWorkspace, /执行前检查/);
  assert.match(prepareWorkspace, /准备阶段/);
  assert.match(prepareWorkspace, /可以进入执行/);
  assert.match(prepareWorkspace, /素材绑定/);
  assert.match(prepareWorkspace, /阻塞清单/);
  assert.match(prepareWorkspace, /提醒清单/);
  assert.doesNotMatch(prepareWorkspace, /当前 Run|准备层视图|这一页主控|任务中心/);
  assert.doesNotMatch(prepareWorkspace, /Prompt 预览页|预检总览页|素材绑定页/);

  const workspaceHome = fs.readFileSync(path.join(outputDir, 'workspace_home.html'), 'utf8');
  assert.match(workspaceHome, /DAOGE 工作台首页/);
  assert.match(workspaceHome, /会话副驾驶/);
  assert.match(workspaceHome, /当前判断/);
  assert.match(workspaceHome, /当前局面/);
  assert.match(workspaceHome, /当前压力/);
  assert.match(workspaceHome, /当前动作/);
  assert.match(workspaceHome, /推荐回复/);
  assert.match(workspaceHome, /准备阶段已生成/);
  assert.match(workspaceHome, /当前流程状态/);
  assert.doesNotMatch(workspaceHome, /阶段确认/);
  assert.match(workspaceHome, /推荐下一步/);
  assert.match(workspaceHome, /按需再看/);
  assert.match(workspaceHome, /准备阶段/);
  assert.match(workspaceHome, /当前阶段/);
  assert.match(workspaceHome, /主控首页 -&gt; 准备确认 -&gt; 结果判断/);
  assert.match(workspaceHome, /进入准备工作台/);
  assert.match(workspaceHome, /现在怎么用/);
  assert.match(workspaceHome, /如果想深看/);
  assert.doesNotMatch(workspaceHome, /任务摘要/);
  assert.doesNotMatch(workspaceHome, /图片速览/);
  assert.doesNotMatch(workspaceHome, /Prompt 预览页/);

  [
    'prompt_preview.md',
    'daoge_run_summary.md',
    'daoge_preflight_dashboard.md',
    'prompt_preview.html',
    'preflight_board.html',
    'assets_board.html',
  ].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, name)), false, `unexpected ${name}`);
    assert.equal(fs.existsSync(path.join(outputDir, 'workspace', name)), false, `unexpected workspace mirror ${name}`);
  });
});

test('daoge_prepare_run can emit prepare markdown only when explicitly enabled', () => {
  const tempDir = makeTempDir('interactive-image-batch-prepare-markdown-');
  const outputDir = path.join(tempDir, 'out');
  const taskSpec = path.join(tempDir, 'task_spec.json');
  const strategyFile = path.join(tempDir, 'prompt_strategy.json');
  const promptsFile = path.join(tempDir, 'prompts.generated.json');

  fs.writeFileSync(taskSpec, readFixture('task_spec.minimal.json'));
  fs.writeFileSync(strategyFile, readFixture('prompt_strategy.minimal.json'));
  fs.writeFileSync(promptsFile, readFixture('prompts.minimal.json'));

  runNode('daoge_prepare_run.js', [
    '--task-spec', taskSpec,
    '--strategy-file', strategyFile,
    '--prompts-file', promptsFile,
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--preview-count', '2',
    '--emit-prepare-markdown', 'true',
  ]);

  [
    'prompt_preview.md',
    'daoge_run_summary.md',
    'daoge_preflight_dashboard.md',
  ].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, name)), true, `missing ${name}`);
  });

  const previewMarkdown = fs.readFileSync(path.join(outputDir, 'prompt_preview.md'), 'utf8');
  const summaryMarkdown = fs.readFileSync(path.join(outputDir, 'daoge_run_summary.md'), 'utf8');
  const preflightMarkdown = fs.readFileSync(path.join(outputDir, 'daoge_preflight_dashboard.md'), 'utf8');
  assert.match(previewMarkdown, /DAOGE 提示词预览/);
  assert.match(summaryMarkdown, /DAOGE 运行摘要/);
  assert.match(preflightMarkdown, /DAOGE 开跑前总览/);
});

test('daoge_prepare_run can emit prepare detail pages only when explicitly enabled', () => {
  const tempDir = makeTempDir('interactive-image-batch-prepare-detail-pages-');
  const outputDir = path.join(tempDir, 'out');
  const taskSpec = path.join(tempDir, 'task_spec.json');
  const strategyFile = path.join(tempDir, 'prompt_strategy.json');
  const promptsFile = path.join(tempDir, 'prompts.generated.json');

  fs.writeFileSync(taskSpec, readFixture('task_spec.minimal.json'));
  fs.writeFileSync(strategyFile, readFixture('prompt_strategy.minimal.json'));
  fs.writeFileSync(promptsFile, readFixture('prompts.minimal.json'));

  runNode('daoge_prepare_run.js', [
    '--task-spec', taskSpec,
    '--strategy-file', strategyFile,
    '--prompts-file', promptsFile,
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--preview-count', '2',
    '--emit-prepare-markdown', 'true',
    '--emit-optional-pages', 'prepare-details',
  ]);

  [
    'prompt_preview.html',
    'preflight_board.html',
  ].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, name)), true, `missing ${name}`);
  });
  assert.equal(fs.existsSync(path.join(outputDir, 'assets_board.html')), false);
});

test('validate_template_registry reports healthy template mainline', () => {
  const tempDir = makeTempDir('interactive-image-batch-template-registry-');
  const reportFile = path.join(tempDir, 'template_registry_validation_report.json');

  const stdout = runNode('validate_template_registry.js', [
    '--output-file', reportFile,
  ]);

  const summary = JSON.parse(stdout);
  assert.equal(summary.ok, true);
  assert.equal(fs.existsSync(reportFile), true);

  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  assert.equal(report.ok, true);
  assert.ok(report.templateCount >= 10);
  assert.equal(report.errorCount, 0);

  const campaignPoster = report.templates.find((item) => item.id === 'campaign-poster');
  assert.ok(campaignPoster);
  assert.equal(campaignPoster.docExists, true);
  assert.equal(campaignPoster.missingDocSections.length, 0);
});

test('render_template_registry_report writes markdown and html reports', () => {
  const tempDir = makeTempDir('interactive-image-batch-template-report-');
  const reportFile = path.join(tempDir, 'template_registry_validation_report.json');
  const markdownFile = path.join(tempDir, 'template_registry_report.md');
  const htmlFile = path.join(tempDir, 'template_registry_report.html');

  runNode('validate_template_registry.js', [
    '--output-file', reportFile,
  ]);

  const stdout = runNode('render_template_registry_report.js', [
    '--report-file', reportFile,
    '--markdown-file', markdownFile,
    '--html-file', htmlFile,
  ]);

  const summary = JSON.parse(stdout);
  assert.equal(summary.ok, true);
  assert.equal(fs.existsSync(markdownFile), true);
  assert.equal(fs.existsSync(htmlFile), true);

  const markdown = fs.readFileSync(markdownFile, 'utf8');
  const html = fs.readFileSync(htmlFile, 'utf8');
  assert.match(markdown, /# 模板主链校验报告/);
  assert.match(markdown, /### campaign-poster/);
  assert.match(html, /模板主链校验看板/);
  assert.match(html, /campaign-poster/);
});

test('run_batch executes prompt-only against mock images provider', async () => {
  await withMockImageServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(body);
        assert.equal(payload.model, 'gpt-image-2');
        assert.equal(payload.size, '1440x2560');
        assert.equal(payload.output_format, 'png');
        assert.match(payload.prompt, /Photoreal/i);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          created: Date.now(),
          data: [{ b64_json: tinyPngBase64(), revised_prompt: 'mock revised prompt' }],
          model: 'gpt-image-2',
          size: '1440x2560',
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  }, async (baseUrl) => {
    const tempDir = makeTempDir('interactive-image-batch-exec-images-');
    const outputDir = path.join(tempDir, 'out');
    const envFile = path.join(tempDir, '.env');
    const promptsFile = path.join(tempDir, 'prompts.generated.json');

    writeMockEnv(envFile, baseUrl);
    fs.writeFileSync(promptsFile, readFixture('prompts.minimal.json'));

    const { stdout } = await runNodeAsync('run_batch.js', [
      '--prompts-file', promptsFile,
      '--env-file', envFile,
      '--output-dir', outputDir,
      '--batch-size', '1',
      '--concurrency', '1',
      '--contact-sheet', 'false',
    ]);

    assert.match(stdout, /\[done\]/);

    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.success, 2);
    assert.equal(manifest.failed, 0);

    const success = JSON.parse(fs.readFileSync(path.join(outputDir, 'success.json'), 'utf8'));
    assert.equal(success.length, 2);
    success.forEach((item) => {
      assert.equal(fs.existsSync(item.output), true);
      assert.equal(item.responseModel, 'gpt-image-2');
    });
  });
});

test('run_batch executes reference-assisted against mock edits provider', async () => {
  await withMockImageServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/images/edits') {
      req.on('data', () => {});
      req.on('end', () => {
        const contentType = req.headers['content-type'] || '';
        assert.match(String(contentType), /multipart\/form-data/i);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          created: Date.now(),
          data: [{ b64_json: tinyPngBase64(), revised_prompt: 'mock edit revised prompt' }],
          model: 'gpt-image-2',
          size: '1440x2560',
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  }, async (baseUrl) => {
    const tempDir = makeTempDir('interactive-image-batch-exec-edits-');
    const outputDir = path.join(tempDir, 'out');
    const envFile = path.join(tempDir, '.env');
    const promptsFile = path.join(tempDir, 'prompts.generated.json');
    const refImage = path.join(tempDir, 'ref.png');

    writeMockEnv(envFile, baseUrl);
    fs.writeFileSync(refImage, Buffer.from(tinyPngBase64(), 'base64'));
    fs.writeFileSync(promptsFile, JSON.stringify([
      {
        index: 1,
        slug: 'reference-assisted-test',
        title: 'Reference Assisted Test',
        style_family: 'hero-fashion',
        scene: 'studio backdrop',
        wardrobe: 'tailored black suit',
        lighting: 'soft premium studio light',
        mood: 'controlled luxury',
        composition: 'full-body vertical poster',
        text_policy: 'leave top and bottom clean for later typography',
        reference_mode: 'reference-assisted',
        reference_images: [refImage],
        generation_prompt: 'Photoreal reference-assisted campaign poster with premium studio lighting.',
      },
    ], null, 2));

    const { stdout } = await runNodeAsync('run_batch.js', [
      '--prompts-file', promptsFile,
      '--env-file', envFile,
      '--output-dir', outputDir,
      '--batch-size', '1',
      '--concurrency', '1',
      '--contact-sheet', 'false',
    ]);

    assert.match(stdout, /\[done\]/);

    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.success, 1);
    assert.equal(manifest.failed, 0);

    const success = JSON.parse(fs.readFileSync(path.join(outputDir, 'success.json'), 'utf8'));
    assert.equal(success.length, 1);
    assert.equal(success[0].requestMode, 'reference-assisted');
    assert.equal(fs.existsSync(success[0].output), true);
  });
});

test('run_batch executes masked-edit against mock edits provider', async () => {
  await withMockImageServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/images/edits') {
      req.on('data', () => {});
      req.on('end', () => {
        const contentType = req.headers['content-type'] || '';
        assert.match(String(contentType), /multipart\/form-data/i);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          created: Date.now(),
          data: [{ b64_json: tinyPngBase64(), revised_prompt: 'mock masked edit revised prompt' }],
          model: 'gpt-image-2',
          size: '1440x2560',
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  }, async (baseUrl) => {
    const tempDir = makeTempDir('interactive-image-batch-exec-masked-');
    const outputDir = path.join(tempDir, 'out');
    const envFile = path.join(tempDir, '.env');
    const promptsFile = path.join(tempDir, 'prompts.generated.json');
    const refImage = path.join(tempDir, 'ref.png');
    const maskImage = path.join(tempDir, 'mask.png');

    writeMockEnv(envFile, baseUrl);
    fs.writeFileSync(refImage, Buffer.from(tinyPngBase64(), 'base64'));
    fs.writeFileSync(maskImage, Buffer.from(tinyPngBase64(), 'base64'));
    fs.writeFileSync(promptsFile, JSON.stringify([
      {
        index: 1,
        slug: 'masked-edit-test',
        title: 'Masked Edit Test',
        style_family: 'hero-fashion',
        scene: 'studio backdrop',
        wardrobe: 'tailored black suit',
        lighting: 'soft premium studio light',
        mood: 'controlled luxury',
        composition: 'full-body vertical poster',
        text_policy: 'leave top and bottom clean for later typography',
        reference_mode: 'masked-edit',
        reference_images: [refImage],
        mask_image: maskImage,
        generation_prompt: 'Photoreal masked local edit for a premium campaign poster.',
      },
    ], null, 2));

    const { stdout } = await runNodeAsync('run_batch.js', [
      '--prompts-file', promptsFile,
      '--env-file', envFile,
      '--output-dir', outputDir,
      '--batch-size', '1',
      '--concurrency', '1',
      '--contact-sheet', 'false',
    ]);

    assert.match(stdout, /\[done\]/);

    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.success, 1);
    assert.equal(manifest.failed, 0);

    const success = JSON.parse(fs.readFileSync(path.join(outputDir, 'success.json'), 'utf8'));
    assert.equal(success.length, 1);
    assert.equal(success[0].requestMode, 'masked-edit');
    assert.equal(fs.existsSync(success[0].output), true);
    assert.equal(path.resolve(success[0].maskImage), path.resolve(maskImage));
  });
});

test('run_batch preserves storyboard slot metadata in execution outputs', async () => {
  await withMockImageServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(body);
        assert.match(payload.prompt, /storyboard/i);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          created: Date.now(),
          data: [{ b64_json: tinyPngBase64(), revised_prompt: 'mock storyboard revised prompt' }],
          model: 'gpt-image-2',
          size: '1440x2560',
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  }, async (baseUrl) => {
    const tempDir = makeTempDir('interactive-image-batch-storyboard-');
    const outputDir = path.join(tempDir, 'out');
    const envFile = path.join(tempDir, '.env');
    const promptsFile = path.join(tempDir, 'prompts.generated.json');

    writeMockEnv(envFile, baseUrl);
    fs.writeFileSync(promptsFile, JSON.stringify([
      {
        index: 1,
        slug: 'storyboard-shot-1',
        title: 'Storyboard Shot 1',
        board_id: 'board_alpha',
        slot_id: 'shot_001',
        slot_role: 'hero',
        shot_id: 'shot_001',
        shot_label: 'Opening Hero',
        layout_region_id: 'region_a',
        timecode: '00:00-00:03',
        camera_move: 'slow push-in',
        continuity_notes: ['keep same wardrobe and hair silhouette'],
        generation_prompt: 'Storyboard hero shot, premium opening frame, controlled cinematic poster language.',
      },
    ], null, 2));

    const { stdout } = await runNodeAsync('run_batch.js', [
      '--prompts-file', promptsFile,
      '--env-file', envFile,
      '--output-dir', outputDir,
      '--batch-size', '1',
      '--concurrency', '1',
      '--contact-sheet', 'false',
    ]);

    assert.match(stdout, /\[done\]/);

    const success = JSON.parse(fs.readFileSync(path.join(outputDir, 'success.json'), 'utf8'));
    assert.equal(success.length, 1);
    assert.equal(success[0].boardId, 'board_alpha');
    assert.equal(success[0].slotId, 'shot_001');
    assert.equal(success[0].slotRole, 'hero');
    assert.equal(success[0].shotId, 'shot_001');
    assert.equal(success[0].shotLabel, 'Opening Hero');
    assert.equal(success[0].layoutRegionId, 'region_a');
    assert.equal(success[0].timecode, '00:00-00:03');
    assert.equal(success[0].cameraMove, 'slow push-in');
    assert.deepEqual(success[0].continuityNotes, ['keep same wardrobe and hair silhouette']);
  });
});

test('workspace mainline pages render copilot deck when generated', () => {
  const tempDir = makeTempDir('interactive-image-batch-copilot-deck-');
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  const promptsFile = path.join(tempDir, 'prompts.generated.json');

  fs.writeFileSync(envFile, [
    'OPENAI_BASE_URL=https://example.com/v1',
    'OPENAI_API_KEY=test-key',
    'OPENAI_MODEL=gpt-image-2',
  ].join('\n'));
  fs.writeFileSync(promptsFile, readFixture('prompts.minimal.json'));

  runNode('run_batch.js', [
    '--prompts-file', promptsFile,
    '--env-file', envFile,
    '--dry-run', 'true',
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--concurrency', '1',
  ]);

  const workspaceHome = fs.readFileSync(path.join(outputDir, 'workspace_home.html'), 'utf8');
  const prepareWorkspace = fs.readFileSync(path.join(outputDir, 'prepare_workspace.html'), 'utf8');
  const resultWorkspace = fs.readFileSync(path.join(outputDir, 'result_workspace.html'), 'utf8');
  const exceptionWorkspace = fs.readFileSync(path.join(outputDir, 'exception_workspace.html'), 'utf8');

  assert.match(workspaceHome, /会话副驾驶/);
  assert.match(prepareWorkspace, /会话副驾驶/);
  assert.match(resultWorkspace, /会话副驾驶/);
  assert.match(exceptionWorkspace, /会话副驾驶/);
});

test('run_batch can emit result detail pages while removed history pages stay deleted', () => {
  const tempDir = makeTempDir('interactive-image-batch-optional-pages-');
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  const promptsFile = path.join(tempDir, 'prompts.generated.json');

  fs.writeFileSync(envFile, [
    'OPENAI_BASE_URL=https://example.com/v1',
    'OPENAI_API_KEY=test-key',
    'OPENAI_MODEL=gpt-image-2',
  ].join('\n'));
  fs.writeFileSync(promptsFile, readFixture('prompts.minimal.json'));

  runNode('run_batch.js', [
    '--prompts-file', promptsFile,
    '--env-file', envFile,
    '--dry-run', 'true',
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--concurrency', '1',
    '--emit-optional-pages', 'all',
  ]);

  [
    'review_board.html',
    'completion_board.html',
    'run_overview.html',
    'rerun_board.html',
  ].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, name)), true, `missing ${name}`);
  });
  [
    'result_hub.html',
    'daoge_portal.html',
  ].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, name)), false, `unexpected removed history page ${name}`);
  });
  assert.equal(fs.existsSync(path.join(outputDir, 'storyboard_board.html')), false, 'storyboard board should require storyboard data');

  const workspaceState = JSON.parse(fs.readFileSync(path.join(outputDir, 'workspace_state.json'), 'utf8'));
  assert.equal(workspaceState.optionalPageMode?.mode, 'all');
  assert.equal(workspaceState.optionalPageMode?.label, '完整展开模式');
  assert.match(String(workspaceState.optionalPageMode?.currentFocus || ''), /所有深看细页都可用/);
  assert.match(String(workspaceState.optionalPageMode?.deepDiveSuggestion || ''), /不必把所有页都逐个打开/);
  assert.deepEqual(workspaceState.optionalPageMode?.layerPolicy?.visibleLayers, ['mainline', 'support', 'conditional', 'advanced']);
  assert.deepEqual(workspaceState.optionalPageMode?.layerPolicy?.hiddenLayers, ['internal']);
  assert.match(String(workspaceState.optionalPageMode?.layerPolicy?.summary || ''), /准备\/结果深看层/);
  assert.match(String(workspaceState.optionalPageMode?.generationPolicy?.summary || ''), /完整展开模式/);
  assert.match(
    JSON.stringify(workspaceState.optionalPageMode?.generationContract?.currentMode?.generatedHtmlFiles || []),
    /review_board\.html|preflight_board\.html/
  );
  assert.match(
    JSON.stringify(workspaceState.optionalPageMode?.generationContract?.currentMode?.hiddenHtmlFiles || []),
    /result_hub\.html|daoge_portal\.html/
  );
});

test('run_batch removes leftover storyboard board in mainline-only mode', () => {
  const tempDir = makeTempDir('interactive-image-batch-mainline-storyboard-prune-');
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  const promptsFile = path.join(tempDir, 'prompts.generated.json');

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'storyboard_board.html'), '<html>stale storyboard</html>');
  fs.writeFileSync(envFile, [
    'OPENAI_BASE_URL=https://example.com/v1',
    'OPENAI_API_KEY=test-key',
    'OPENAI_MODEL=gpt-image-2',
  ].join('\n'));
  fs.writeFileSync(promptsFile, readFixture('prompts.minimal.json'));

  runNode('run_batch.js', [
    '--prompts-file', promptsFile,
    '--env-file', envFile,
    '--dry-run', 'true',
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--concurrency', '1',
  ]);

  assert.equal(fs.existsSync(path.join(outputDir, 'storyboard_board.html')), false);
});

test('run_batch prunes leftover advanced and removed history html in mainline-only mode', () => {
  const tempDir = makeTempDir('interactive-image-batch-mainline-advanced-prune-');
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  const promptsFile = path.join(tempDir, 'prompts.generated.json');

  fs.mkdirSync(path.join(outputDir, 'workspace'), { recursive: true });
  [
    'review_board.html',
    'completion_board.html',
    'run_overview.html',
    'rerun_board.html',
    'result_hub.html',
    'daoge_portal.html',
    'preflight_board.html',
    'prompt_preview.html',
    'assets_board.html',
  ].forEach((name) => {
    fs.writeFileSync(path.join(outputDir, name), `<html>${name}</html>`);
    fs.writeFileSync(path.join(outputDir, 'workspace', name), `<html>workspace ${name}</html>`);
  });
  fs.writeFileSync(envFile, [
    'OPENAI_BASE_URL=https://example.com/v1',
    'OPENAI_API_KEY=test-key',
    'OPENAI_MODEL=gpt-image-2',
  ].join('\n'));
  fs.writeFileSync(promptsFile, readFixture('prompts.minimal.json'));

  runNode('run_batch.js', [
    '--prompts-file', promptsFile,
    '--env-file', envFile,
    '--dry-run', 'true',
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--concurrency', '1',
  ]);

  [
    'review_board.html',
    'completion_board.html',
    'run_overview.html',
    'rerun_board.html',
    'result_hub.html',
    'daoge_portal.html',
    'preflight_board.html',
    'prompt_preview.html',
    'assets_board.html',
  ].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, name)), false, `unexpected leftover ${name}`);
    assert.equal(fs.existsSync(path.join(outputDir, 'workspace', name)), false, `unexpected workspace leftover ${name}`);
  });
});

test('import_reference_assets organizes files and generates storyboard bindings', () => {
  const tempDir = makeTempDir('interactive-image-batch-import-assets-');
  const outputDir = path.join(tempDir, 'out');
  const { taskSpec } = writeStoryboardFixtures(tempDir);
  const refImage = path.join(tempDir, 'desktop-upload-ref.png');
  const maskImage = path.join(tempDir, 'desktop-upload-mask.png');

  fs.writeFileSync(refImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(maskImage, Buffer.from(tinyPngBase64(), 'base64'));

  runNode('import_reference_assets.js', [
    '--task-spec', taskSpec,
    '--output-dir', outputDir,
    '--references', refImage,
    '--masks', maskImage,
    '--slot-order', 'shot_1,shot_2',
  ]);

  const bindings = JSON.parse(fs.readFileSync(path.join(outputDir, 'reference_bindings.imported.json'), 'utf8'));
  const updatedTaskSpec = JSON.parse(fs.readFileSync(path.join(outputDir, 'task_spec.with_imported_assets.json'), 'utf8'));

  assert.equal(bindings.reference_assets.length, 2);
  assert.equal(bindings.slot_assignments.length, 2);
  assert.equal(bindings.slot_assignments[0].slot_id, 'shot_1');
  assert.equal(bindings.slot_assignments[0].reference_mode, 'reference-assisted');
  assert.equal(bindings.slot_assignments[0].asset_ids.length, 1);
  assert.equal(bindings.slot_assignments[1].slot_id, 'shot_2');
  assert.equal(bindings.slot_assignments[1].reference_mode, 'masked-edit');
  assert.equal(bindings.slot_assignments[1].mask_asset_ids.length, 1);
  assert.equal(fs.existsSync(path.join(outputDir, bindings.reference_assets[0].path)), true);
  assert.equal(fs.existsSync(path.join(outputDir, bindings.reference_assets[1].path)), true);
  assert.equal(path.resolve(updatedTaskSpec.storyboard_plan.reference_bindings), path.resolve(path.join(outputDir, 'reference_bindings.imported.json')));
});

test('import_reference_assets can infer mask and slot from filenames by rules', () => {
  const tempDir = makeTempDir('interactive-image-batch-import-rules-');
  const outputDir = path.join(tempDir, 'out');
  const { taskSpec } = writeStoryboardFixtures(tempDir);
  const refImage = path.join(tempDir, 'shot_1-product-reference.png');
  const maskImage = path.join(tempDir, 'shot_2-local-mask.png');

  fs.writeFileSync(refImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(maskImage, Buffer.from(tinyPngBase64(), 'base64'));

  runNode('import_reference_assets.js', [
    '--task-spec', taskSpec,
    '--output-dir', outputDir,
    '--references', `${refImage},${maskImage}`,
  ]);

  const analysis = JSON.parse(fs.readFileSync(path.join(outputDir, 'reference_asset_analysis.json'), 'utf8'));
  const bindings = JSON.parse(fs.readFileSync(path.join(outputDir, 'reference_bindings.imported.json'), 'utf8'));

  assert.equal(analysis.ruleAssignments.length, 2);
  assert.equal(analysis.ruleAssignments[0].inference.strategy, 'rules');
  assert.equal(analysis.ruleAssignments[0].inferred_slot_id, 'shot_1');
  assert.equal(analysis.ruleAssignments[1].inferred_type, 'mask');
  assert.equal(analysis.ruleAssignments[1].inferred_slot_id, 'shot_2');
  assert.equal(bindings.slot_assignments.length, 2);
  assert.equal(bindings.slot_assignments[1].reference_mode, 'masked-edit');
});

test('import_reference_assets can parse natural language binding instructions', () => {
  const tempDir = makeTempDir('interactive-image-batch-import-nl-');
  const outputDir = path.join(tempDir, 'out');
  const { taskSpec } = writeStoryboardFixtures(tempDir);
  const firstImage = path.join(tempDir, 'desktop_upload_01.png');
  const secondImage = path.join(tempDir, 'desktop_upload_02.png');
  const thirdImage = path.join(tempDir, 'desktop_upload_03.png');

  fs.writeFileSync(firstImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(secondImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(thirdImage, Buffer.from(tinyPngBase64(), 'base64'));

  runNode('import_reference_assets.js', [
    '--task-spec', taskSpec,
    '--output-dir', outputDir,
    '--references', `${firstImage},${secondImage},${thirdImage}`,
    '--slot-order', 'shot_1,shot_2',
    '--binding-text', '前两张按上传顺序对应 shot_1、shot_2，最后一张是 shot_2 的遮罩图',
  ]);

  const analysis = JSON.parse(fs.readFileSync(path.join(outputDir, 'reference_asset_analysis.json'), 'utf8'));
  const bindings = JSON.parse(fs.readFileSync(path.join(outputDir, 'reference_bindings.imported.json'), 'utf8'));

  assert.deepEqual(analysis.naturalLanguageBindings.slotOrder, ['shot_1', 'shot_2']);
  assert.equal(analysis.naturalLanguageBindings.maskIndexes[0], 2);
  assert.equal(bindings.slot_assignments.length, 2);
  assert.equal(bindings.slot_assignments[0].slot_id, 'shot_1');
  assert.equal(bindings.slot_assignments[0].reference_mode, 'reference-assisted');
  assert.equal(bindings.slot_assignments[1].slot_id, 'shot_2');
  assert.equal(bindings.slot_assignments[1].reference_mode, 'masked-edit');
});

test('daoge_prepare_run can import storyboard assets before preflight', () => {
  const tempDir = makeTempDir('interactive-image-batch-prepare-import-');
  const outputDir = path.join(tempDir, 'out');
  const { taskSpec } = writeStoryboardFixtures(tempDir);
  const strategyFile = path.join(tempDir, 'prompt_strategy.json');
  const promptsFile = path.join(tempDir, 'prompts.generated.json');
  const assetsManifest = path.join(tempDir, 'assets_manifest.json');
  const refImage = path.join(tempDir, 'desktop-upload-ref.png');
  const maskImage = path.join(tempDir, 'desktop-upload-mask.png');

  fs.writeFileSync(strategyFile, readFixture('prompt_strategy.minimal.json'));
  fs.writeFileSync(promptsFile, JSON.stringify([
    {
      index: 1,
      slug: 'storyboard-shot-1',
      slot_id: 'shot_1',
      generation_prompt: 'Storyboard shot one prompt.'
    },
    {
      index: 2,
      slug: 'storyboard-shot-2',
      slot_id: 'shot_2',
      generation_prompt: 'Storyboard shot two prompt.'
    }
  ], null, 2));
  fs.writeFileSync(refImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(maskImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(assetsManifest, JSON.stringify({
    reference_assets: [
      { path: refImage, slot_id: 'shot_1', label: '桌面上传参考图' }
    ],
    mask_assets: [
      { path: maskImage, slot_id: 'shot_2', label: '桌面上传遮罩图', notes: '只改右下角' }
    ]
  }, null, 2));

  runNode('daoge_prepare_run.js', [
    '--task-spec', taskSpec,
    '--strategy-file', strategyFile,
    '--prompts-file', promptsFile,
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--preview-count', '2',
    '--import-reference-assets', 'true',
    '--assets-manifest', assetsManifest,
  ]);

  const importedBindings = JSON.parse(fs.readFileSync(path.join(outputDir, 'reference_bindings.imported.json'), 'utf8'));
  const storyboardValidation = JSON.parse(fs.readFileSync(path.join(outputDir, 'storyboard_bundle.validation.json'), 'utf8'));
  assert.equal(importedBindings.reference_assets.length, 2);
  assert.equal(storyboardValidation.ok, true);
  assert.equal(storyboardValidation.generation_slots.length, 2);
  assert.equal(storyboardValidation.generation_slots[0].reference_mode, 'reference-assisted');
  assert.equal(storyboardValidation.generation_slots[1].reference_mode, 'masked-edit');
  const prepareWorkspace = fs.readFileSync(path.join(outputDir, 'prepare_workspace.html'), 'utf8');
  assert.match(prepareWorkspace, /素材绑定/);
  assert.match(prepareWorkspace, /带约束的任务|自由度更高的任务/);
});

test('import_reference_assets can apply vision recommendations when enabled', async () => {
  await withMockImageServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/responses') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(body);
        assert.equal(payload.model, 'gpt-5.4');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    recommendations: [
                      {
                        asset_path: payload.input[0].content.find((item) => item.type === 'input_text' && /asset_path=/.test(item.text)).text.match(/asset_path=(.+)/)[1].trim(),
                        recommended_slot_id: 'shot_2',
                        recommended_type: 'mask',
                        confidence: 0.93,
                        reason: 'transparent local edit area in lower-right corner',
                      },
                    ],
                  }),
                },
              ],
            },
          ],
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  }, async (baseUrl) => {
    const tempDir = makeTempDir('interactive-image-batch-import-vision-');
    const outputDir = path.join(tempDir, 'out');
    const { taskSpec } = writeStoryboardFixtures(tempDir);
    const envFile = path.join(tempDir, '.env');
    const visualAsset = path.join(tempDir, 'desktop-visual.png');

    fs.writeFileSync(visualAsset, Buffer.from(tinyPngBase64(), 'base64'));
    fs.writeFileSync(envFile, [
      `OPENAI_BASE_URL=${baseUrl}/v1`,
      'OPENAI_API_KEY=test-key',
      'OPENAI_RESPONSES_MODEL=gpt-5.4',
    ].join('\n'));

    await runNodeAsync('import_reference_assets.js', [
      '--task-spec', taskSpec,
      '--output-dir', outputDir,
      '--references', visualAsset,
      '--enable-vision-analysis', 'true',
      '--env-file', envFile,
    ]);

    const analysis = JSON.parse(fs.readFileSync(path.join(outputDir, 'reference_asset_analysis.json'), 'utf8'));
    const bindings = JSON.parse(fs.readFileSync(path.join(outputDir, 'reference_bindings.imported.json'), 'utf8'));
    assert.equal(analysis.visionAnalysis.enabled, true);
    assert.equal(analysis.ruleAssignments[0].vision_recommendation.slot_id, 'shot_2');
    assert.equal(analysis.ruleAssignments[0].vision_recommendation.type, 'mask');
    assert.equal(bindings.slot_assignments[0].slot_id, 'shot_2');
    assert.equal(bindings.slot_assignments[0].reference_mode, 'masked-edit');
  });
});

test('daoge_prepare_run can pass natural language binding instructions into asset import', () => {
  const tempDir = makeTempDir('interactive-image-batch-prepare-nl-');
  const outputDir = path.join(tempDir, 'out');
  const { taskSpec } = writeStoryboardFixtures(tempDir);
  const strategyFile = path.join(tempDir, 'prompt_strategy.json');
  const promptsFile = path.join(tempDir, 'prompts.generated.json');
  const firstImage = path.join(tempDir, 'desktop_upload_01.png');
  const secondImage = path.join(tempDir, 'desktop_upload_02.png');

  fs.writeFileSync(strategyFile, readFixture('prompt_strategy.minimal.json'));
  fs.writeFileSync(promptsFile, JSON.stringify([
    {
      index: 1,
      slug: 'storyboard-shot-1',
      slot_id: 'shot_1',
      generation_prompt: 'Storyboard shot one prompt.'
    },
    {
      index: 2,
      slug: 'storyboard-shot-2',
      slot_id: 'shot_2',
      generation_prompt: 'Storyboard shot two prompt.'
    }
  ], null, 2));
  fs.writeFileSync(firstImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(secondImage, Buffer.from(tinyPngBase64(), 'base64'));

  runNode('daoge_prepare_run.js', [
    '--task-spec', taskSpec,
    '--strategy-file', strategyFile,
    '--prompts-file', promptsFile,
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--preview-count', '2',
    '--import-reference-assets', 'true',
    '--references', `${firstImage},${secondImage}`,
    '--slot-order', 'shot_1,shot_2',
    '--binding-text', '第一张给 shot_1，最后一张是 shot_2 的遮罩图',
  ]);

  const analysis = JSON.parse(fs.readFileSync(path.join(outputDir, 'reference_asset_analysis.json'), 'utf8'));
  const storyboardValidation = JSON.parse(fs.readFileSync(path.join(outputDir, 'storyboard_bundle.validation.json'), 'utf8'));
  const bindingConfirmation = fs.readFileSync(path.join(outputDir, 'binding_confirmation.md'), 'utf8');
  const bindingConversationCard = fs.readFileSync(path.join(outputDir, 'binding_conversation_card.md'), 'utf8');
  assert.equal(analysis.naturalLanguageBindings.explicitAssignments.length, 2);
  assert.equal(storyboardValidation.ok, true);
  assert.equal(storyboardValidation.generation_slots[0].reference_mode, 'reference-assisted');
  assert.equal(storyboardValidation.generation_slots[1].reference_mode, 'masked-edit');
  assert.match(bindingConfirmation, /第 1 张 -> shot_1/);
  assert.match(bindingConfirmation, /第 2 张 -> shot_2/);
  assert.match(bindingConversationCard, /DAOGE 绑定会话卡/);
  assert.match(bindingConversationCard, /确认，继续 prepare/);
});

test('plan_binding_from_draft converts llm draft into binding plan', () => {
  const tempDir = makeTempDir('interactive-image-batch-binding-plan-');
  const draftFile = path.join(tempDir, 'binding_intent_draft.json');
  const outputFile = path.join(tempDir, 'binding_plan.json');
  const firstImage = path.join(tempDir, 'desktop_upload_01.png');
  const secondImage = path.join(tempDir, 'desktop_upload_02.png');

  fs.writeFileSync(firstImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(secondImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(draftFile, JSON.stringify({
    binding_text: '第一张给 shot_1，最后一张是 shot_2 的遮罩图',
    draft: {
      slot_order: ['shot_1', 'shot_2'],
      asset_intents: [
        { asset_index: 0, target_slot_id: 'shot_1', intended_type: 'reference', confidence: 0.92, reason: 'first image is main reference' },
        { asset_index: 1, target_slot_id: 'shot_2', intended_type: 'mask', confidence: 0.95, reason: 'last image described as mask' }
      ],
      prompt_only_slots: [],
      unresolved_questions: [],
      summary: '图1给 shot_1，图2作为 shot_2 的遮罩图'
    }
  }, null, 2));

  runNode('plan_binding_from_draft.js', [
    '--draft-file', draftFile,
    '--output-file', outputFile,
    '--references', `${firstImage},${secondImage}`,
  ]);

  const plan = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  assert.equal(plan.reference_assets.length, 1);
  assert.equal(plan.mask_assets.length, 1);
  assert.equal(plan.reference_assets[0].slot_id, 'shot_1');
  assert.equal(plan.mask_assets[0].slot_id, 'shot_2');
});

test('daoge_prepare_run can use llm binding planner before asset import', async () => {
  await withMockImageServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/responses') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(body);
        assert.equal(payload.model, 'gpt-5.4');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    slot_order: ['shot_1', 'shot_2'],
                    asset_intents: [
                      { asset_index: 0, target_slot_id: 'shot_1', intended_type: 'reference', confidence: 0.91, reason: '用户明确说第一张给 shot_1' },
                      { asset_index: 1, target_slot_id: 'shot_2', intended_type: 'mask', confidence: 0.95, reason: '用户明确说最后一张是 shot_2 的遮罩图' }
                    ],
                    prompt_only_slots: [],
                    unresolved_questions: [],
                    summary: '第一张给 shot_1，第二张作为 shot_2 的遮罩图',
                  }),
                },
              ],
            },
          ],
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  }, async (baseUrl) => {
    const tempDir = makeTempDir('interactive-image-batch-prepare-llm-bind-');
    const outputDir = path.join(tempDir, 'out');
    const { taskSpec } = writeStoryboardFixtures(tempDir);
    const strategyFile = path.join(tempDir, 'prompt_strategy.json');
    const promptsFile = path.join(tempDir, 'prompts.generated.json');
    const envFile = path.join(tempDir, '.env');
    const firstImage = path.join(tempDir, 'desktop_upload_01.png');
    const secondImage = path.join(tempDir, 'desktop_upload_02.png');

    fs.writeFileSync(strategyFile, readFixture('prompt_strategy.minimal.json'));
    fs.writeFileSync(promptsFile, JSON.stringify([
      { index: 1, slug: 'storyboard-shot-1', slot_id: 'shot_1', generation_prompt: 'Storyboard shot one prompt.' },
      { index: 2, slug: 'storyboard-shot-2', slot_id: 'shot_2', generation_prompt: 'Storyboard shot two prompt.' }
    ], null, 2));
    fs.writeFileSync(envFile, [
      `OPENAI_BASE_URL=${baseUrl}/v1`,
      'OPENAI_API_KEY=test-key',
      'OPENAI_RESPONSES_MODEL=gpt-5.4',
    ].join('\n'));
    fs.writeFileSync(firstImage, Buffer.from(tinyPngBase64(), 'base64'));
    fs.writeFileSync(secondImage, Buffer.from(tinyPngBase64(), 'base64'));

    await runNodeAsync('daoge_prepare_run.js', [
      '--task-spec', taskSpec,
      '--strategy-file', strategyFile,
      '--prompts-file', promptsFile,
      '--output-dir', outputDir,
      '--batch-size', '1',
      '--preview-count', '2',
      '--import-reference-assets', 'true',
      '--use-llm-binding-planner', 'true',
      '--references', `${firstImage},${secondImage}`,
      '--slot-order', 'shot_1,shot_2',
      '--binding-text', '第一张给 shot_1，最后一张是 shot_2 的遮罩图',
      '--env-file', envFile,
    ]);

    const draft = JSON.parse(fs.readFileSync(path.join(outputDir, 'binding_intent_draft.json'), 'utf8'));
    const plan = JSON.parse(fs.readFileSync(path.join(outputDir, 'binding_plan.json'), 'utf8'));
    const storyboardValidation = JSON.parse(fs.readFileSync(path.join(outputDir, 'storyboard_bundle.validation.json'), 'utf8'));
    const bindingConfirmation = fs.readFileSync(path.join(outputDir, 'binding_confirmation.md'), 'utf8');

    assert.equal(draft.draft.asset_intents.length, 2);
    assert.equal(plan.reference_assets.length, 1);
    assert.equal(plan.mask_assets.length, 1);
    assert.equal(storyboardValidation.ok, true);
    assert.equal(storyboardValidation.generation_slots[0].reference_mode, 'reference-assisted');
    assert.equal(storyboardValidation.generation_slots[1].reference_mode, 'masked-edit');
    assert.match(bindingConfirmation, /我理解到的绑定计划|我先按你的中文说明理解成这样/);
    assert.match(bindingConfirmation, /shot_2/);
  });
});

test('apply_binding_feedback can revise binding plan from chinese feedback', () => {
  const tempDir = makeTempDir('interactive-image-batch-binding-feedback-');
  const planFile = path.join(tempDir, 'binding_plan.json');
  const outputFile = path.join(tempDir, 'binding_plan.updated.json');

  fs.writeFileSync(planFile, JSON.stringify({
    binding_text: '第一张给 shot_1，最后一张是 shot_2 的遮罩图',
    slot_order: ['shot_1', 'shot_2'],
    reference_assets: [
      { path: '/tmp/ref_01.png', slot_id: 'shot_1', label: null, notes: 'first image', confidence: 0.9 }
    ],
    mask_assets: [
      { path: '/tmp/ref_02.png', slot_id: 'shot_2', label: null, notes: 'last image mask', confidence: 0.95 }
    ],
    prompt_only_slots: [],
    unresolved_questions: [],
    plan_assignments: [
      { asset_index: 0, path: '/tmp/ref_01.png', slot_id: 'shot_1', intended_type: 'reference', confidence: 0.9, reason: 'first image' },
      { asset_index: 1, path: '/tmp/ref_02.png', slot_id: 'shot_2', intended_type: 'mask', confidence: 0.95, reason: 'last image mask' }
    ],
    summary: '初始绑定计划'
  }, null, 2));

  runNode('apply_binding_feedback.js', [
    '--plan-file', planFile,
    '--output-file', outputFile,
    '--feedback-text', '第2张不要做遮罩图，改给 shot_1',
  ]);

  const updatedPlan = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  assert.equal(updatedPlan.reference_assets.length, 2);
  assert.equal(updatedPlan.mask_assets.length, 0);
  assert.equal(updatedPlan.reference_assets[1].slot_id, 'shot_1');
  assert.equal(updatedPlan.feedback_history.length, 1);
});

test('render_storyboard_board assembles storyboard html from validation bundle and results', () => {
  const tempDir = makeTempDir('interactive-image-batch-storyboard-board-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const storyboardFile = path.join(tempDir, 'storyboard_bundle.validation.json');
  const resultsFile = path.join(tempDir, 'success.json');
  const imageOne = path.join(outputDir, 'shot_1.png');
  const imageTwo = path.join(outputDir, 'shot_2.png');
  const boardFile = path.join(outputDir, 'storyboard_board.html');

  fs.writeFileSync(imageOne, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(imageTwo, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(storyboardFile, JSON.stringify({
    layout: {
      canvas: { width: 1440, height: 2560, background: '#111111' },
      regions: [
        { id: 'brand_panel', role: 'brand_panel', x: 40, y: 40, width: 300, height: 600 },
        { id: 'shot_1', role: 'shot', x: 380, y: 40, width: 500, height: 260 },
        { id: 'shot_2', role: 'shot', x: 380, y: 340, width: 500, height: 260 }
      ],
      bindings: [
        { region_id: 'brand_panel', slot_id: 'brand_panel' },
        { region_id: 'shot_1', slot_id: 'shot_1' },
        { region_id: 'shot_2', slot_id: 'shot_2' }
      ]
    },
    content: {
      board_id: 'board_demo',
      board_title: 'Demo Storyboard',
      board_theme: 'cinematic product storyboard',
      brand_panel: {
        title_lines: ['Brand', 'Storyboard']
      }
    },
    slot_blueprint: [
      { slot_id: 'shot_1', shot_label: 'Opening Shot', timecode: '0-2s', scene: 'hero reveal', slot_role: 'shot' },
      { slot_id: 'shot_2', shot_label: 'Closing Shot', timecode: '2-4s', scene: 'product close', slot_role: 'shot' }
    ]
  }, null, 2));
  fs.writeFileSync(resultsFile, JSON.stringify([
    { ok: true, slotId: 'shot_1', output: imageOne },
    { ok: true, slotId: 'shot_2', output: imageTwo }
  ], null, 2));

  runNode('render_storyboard_board.js', [
    '--storyboard-file', storyboardFile,
    '--results-file', resultsFile,
    '--output-dir', outputDir,
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  assert.match(html, /Demo Storyboard/);
  assert.match(html, /DAOGE 分镜整板补充页/);
  assert.match(html, /分镜整板补充页已经退到结果补充页层/);
  assert.match(html, /分镜整板补充页浏览模式/);
  assert.match(html, /分镜整板补充页看完后，回结果主链/);
  assert.match(html, /不再承担结果总控/);
  assert.match(html, /结果主链进度/);
  assert.match(html, /Opening Shot/);
  assert.match(html, /shot_1\.png/);
  assert.match(html, /Brand/);
  assert.match(html, /结果摘要/);
  assert.match(html, /分组导航/);
  assert.match(html, /总镜头/);
  assert.match(html, /失败 \/ 缺图/);
  assert.match(html, /Board ID/);
  assert.match(html, /先看哪里/);
  assert.match(html, /已有画面|暂无画面/);
  assert.match(html, /href="#slot-shot_1"/);
  assert.match(html, /id="slot-shot_1"/);
  assert.match(html, /style="left:26\.3889%;top:1\.5625%;width:34\.7222%;height:10\.1563%"/);
  assert.match(html, /style="left:2\.7778%;top:1\.5625%;width:20\.8333%;height:23\.4375%"/);
  assert.match(html, /\.panel-shot \{\s*display: flex;\s*flex-direction: column;/);
  assert.match(html, /\.panel-frame \{\s*width: 100%;\s*flex: 1 1 auto;\s*min-height: 0;/);
  assert.doesNotMatch(html, /left:380px;top:40px;width:500px;height:260px/);
  assert.doesNotMatch(html, /height: calc\(100% - 74px\)/);
  assert.match(html, /focus-banner/);
  assert.match(html, /当前焦点/);
  assert.match(html, /is-focused/);
  assert.match(html, /applyFocusFromHash/);
  assert.match(html, /已出图|待复核|执行失败|缺图/);
});

test('adaptWorkflowCopilot maps unified workflow state into page-friendly sections', () => {
  const { adaptWorkflowCopilot } = require(path.join(scriptsDir, 'workspace_page_shared.js'));
  const adapted = adaptWorkflowCopilot({
    stageKey: 'result',
    reply: {
      recommendedReply: '继续筛图',
      primarySay: '继续筛图',
      replyReason: '先按结果层主链继续。',
      alternativeSayItems: ['先看异常项'],
      directReplies: ['继续筛图', '先看异常项'],
    },
    action: {
      label: '继续筛图',
      summary: '先按结果层主链继续。',
      recommendedReply: '继续筛图',
      actionReason: '先按结果层主链继续。',
      notes: ['先完成这一轮筛图'],
    },
    rhythm: {
      primarySay: '旧的节奏字段',
      recommendedReply: '旧的节奏字段',
      replyReason: '旧的节奏原因',
      summary: '结果层已经接住主线。',
      alternativeSayItems: ['旧备选句'],
    },
    checkpoints: {
      confirmedItems: ['已完成首轮筛图'],
      pendingItems: ['还要确认保留名单'],
      blockingItems: [],
      canContinue: true,
      hasBlocking: false,
      summary: '可以继续收口。',
    },
    coordination: {
      recentItems: ['结果层最近更新'],
      confirmItems: ['还要确认保留名单'],
      primarySay: '继续筛图',
      replyReason: '先按结果层主链继续。',
      alternativeSayItems: ['先看异常项'],
    },
    relay: {
      recentEvent: { title: '结果层接力', summary: '准备层已把任务送进结果页。' },
    },
    console: {
      taskControlBar: { taskLabel: '高端时尚竖版海报', stageLabel: '结果阶段', nextActionLabel: '继续筛图' },
      sessionConsole: { title: '任务会话快照', items: [{ label: '当前任务', value: '高端时尚竖版海报' }] },
      signalBar: [{ label: '当前状态', value: '结果稳定', summary: '可以继续收口。', tone: 'good' }],
      statusStack: [{ label: '结果层', value: '进行中', summary: '正在筛图。', tone: 'info' }],
      cockpitSummary: { title: '驾驶舱摘要', items: [{ label: '当前重点', value: '继续筛图', summary: '按主链继续。', tone: 'good' }] },
    },
  }, {
    confirmation: { stageLabel: '结果阶段' },
  });

  assert.equal(adapted.taskControlBar?.nextActionLabel, '继续筛图');
  assert.equal(adapted.taskControlBar?.taskLabel, '高端时尚竖版海报');
  assert.equal(adapted.taskControlBar?.primarySay, '继续筛图');
  assert.equal(adapted.action?.label, '继续筛图');
  assert.equal(adapted.action?.actionReason, '先按结果层主链继续。');
  assert.equal(adapted.dialogueStatus?.primarySay, '继续筛图');
  assert.equal(adapted.collaboration?.primarySay, '继续筛图');
  assert.equal(adapted.dialogueStatus?.actionReason, '先按结果层主链继续。');
  assert.equal(adapted.dialogueStatus?.alternativeSayItems?.[0], '先看异常项');
  assert.equal(adapted.collaboration?.recentItems?.[0], '结果层最近更新');
  assert.equal(adapted.collaboration?.confirmItems?.[0], '还要确认保留名单');
  assert.equal(adapted.language?.deckTitle, '会话副驾驶');
  assert.match(String(adapted.language?.pagePurpose || ''), /筛图|收口|异常分流/);
  assert.ok(Array.isArray(adapted.signalBar?.items));
  assert.ok(Array.isArray(adapted.statusStack?.items));
});

test('resolveUnifiedNextAction prefers unified status and keeps fallback targets stable', () => {
  const { resolveUnifiedNextAction } = require(path.join(scriptsDir, 'workspace_page_shared.js'));

  assert.deepEqual(
    resolveUnifiedNextAction(
      { nextAction: { label: '回工作台首页', reason: '结果已经稳定，回主链继续。', target: 'workspace_home.html' } },
      {
        secondarySource: { label: '进入分镜整板补充页', reason: '按需再看镜头衔接。', target: 'storyboard_board.html' },
        fallbackLabel: '进入结果工作台',
        fallbackReason: '先去结果层继续。',
        fallbackTarget: 'result_workspace.html',
      }
    ),
    { label: '回工作台首页', reason: '结果已经稳定，回主链继续。', target: 'workspace_home.html' }
  );

  assert.deepEqual(
    resolveUnifiedNextAction(
      {},
      {
        secondarySource: { label: '进入异常工作台', reason: '先处理失败项。', target: 'exception_workspace.html' },
        fallbackLabel: '回工作台首页',
        fallbackReason: '当前异常压力较低，可以回主链继续。',
        fallbackTarget: 'workspace_home.html',
      }
    ),
    { label: '进入异常工作台', reason: '先处理失败项。', target: 'exception_workspace.html' }
  );
});

test('resolveUnifiedStageNarrative prefers unified status fields and summary fallbacks', () => {
  const { resolveUnifiedStageNarrative } = require(path.join(scriptsDir, 'workspace_page_shared.js'));

  assert.deepEqual(
    resolveUnifiedStageNarrative(
      {
        conclusion: '统一结论',
        currentFocus: '统一重点',
        progress: '统一进展',
      },
      {
        summarySource: {
          stageSummary: '阶段说明',
          transitionSummary: '交接说明',
          handoffSummary: '下一站说明',
          issueSummary: '风险说明',
        },
        fallbackStatusLabel: '兜底结论',
        fallbackStatusSummary: '兜底进展',
        fallbackCurrentFocus: '兜底重点',
      }
    ),
    {
      statusLabel: '统一结论',
      statusSummary: '统一进展',
      currentFocus: '统一重点',
      stageSummary: '阶段说明',
      transitionSummary: '交接说明',
      handoffSummary: '下一站说明',
      issueSummary: '风险说明',
    }
  );
});

test('unified workflow builders prefer explicit workflow layers and keep stage fallbacks stable', () => {
  const {
    buildUnifiedWorkflowCockpitSummary,
    buildUnifiedWorkflowJudgment,
    buildUnifiedWorkflowStatusStack,
    buildUnifiedWorkflowDecision,
    buildUnifiedWorkflowConfirmation,
    buildUnifiedWorkflowCollaboration,
    buildUnifiedWorkflowStageRelay,
    buildWorkflowContractPageState,
  } = require(path.join(scriptsDir, 'workspace_page_shared.js'));

  assert.deepEqual(
    buildUnifiedWorkflowCockpitSummary({
      base: { items: [{ label: '基础', value: '基础值' }] },
      workflow: { items: [{ label: '工作流', value: '工作流值' }] },
      copilot: { items: [{ label: '副驾驶', value: '副驾驶值' }] },
      view: { items: [{ label: '页面', value: '页面值' }] },
      items: [{ label: '兜底', value: '兜底值' }],
    }),
    { items: [{ label: '基础', value: '基础值' }] }
  );

  assert.deepEqual(
    buildUnifiedWorkflowJudgment({
      stageConfig: { title: '主控判断', copy: '阶段说明' },
      base: { statusLabel: '基础判断' },
      baseState: { statusSummary: '基础摘要' },
      copilot: { noteItems: ['副驾驶提醒'] },
      workflow: { confirmItems: ['工作流确认'] },
      view: { statusTone: 'warn' },
    }),
    {
      title: '主控判断',
      copy: '阶段说明',
      statusLabel: '基础判断',
      statusSummary: '基础摘要',
      noteItems: ['副驾驶提醒'],
      confirmItems: ['工作流确认'],
      statusTone: 'warn',
    }
  );

  assert.deepEqual(
    buildUnifiedWorkflowStatusStack({
      workflow: null,
      copilot: null,
      controlRail: null,
      stateItems: [{ label: '当前阶段', value: '准备阶段' }],
      fallbackBuilder: () => [{ label: '兜底', value: '兜底状态' }],
    }),
    { items: [{ label: '当前阶段', value: '准备阶段' }] }
  );

  assert.deepEqual(
    buildUnifiedWorkflowDecision({
      stageConfig: { title: '当前判断', copy: '统一解释为什么这样判断' },
      base: { items: [{ label: '为什么当前这样判断', value: '基础原因' }] },
      state: { items: [{ label: '为什么当前这样判断', value: '状态原因' }] },
      view: { items: [{ label: '为什么当前这样判断', value: '页面原因' }] },
    }),
    {
      title: '当前判断',
      copy: '统一解释为什么这样判断',
      items: [{ label: '为什么当前这样判断', value: '页面原因' }],
    }
  );

  assert.deepEqual(
    buildUnifiedWorkflowConfirmation(
      {
        stage: '结果阶段',
        dialogue: {
          primarySay: '继续，先去结果工作台',
          summary: '统一状态要求先筛图',
          confirmItems: ['确认保留名单'],
        },
      },
      {
        fallback: { pendingItems: ['兜底确认项'] },
        state: { summary: '状态层说明', blockingItems: ['状态层阻塞'] },
        view: { recommendedReply: '页面层推荐回复' },
      }
    ),
    {
      pendingItems: ['兜底确认项'],
      summary: '状态层说明',
      blockingItems: ['状态层阻塞'],
      recommendedReply: '页面层推荐回复',
      stageLabel: '结果阶段',
      pendingCount: 1,
      blockingCount: 1,
    }
  );

  assert.deepEqual(
    buildUnifiedWorkflowCollaboration(
      {
        dialogue: {
          primarySay: '继续，按主链往下走',
          actionReason: '统一状态建议先继续',
          nextSayItems: ['继续，按主链往下走'],
          confirmItems: ['确认下一步'],
        },
      },
      {
        confirmation: { stageLabel: '准备阶段', pendingItems: ['确认下一步'] },
        timeline: { events: [{ title: '刚完成预检', summary: '系统已经接住准备结果' }] },
        dialogue: { primarySay: '继续，按主链往下走', actionReason: '统一状态建议先继续' },
      }
    ),
    {
      title: '对话接力',
      copy: '这里只补最近变化、继续前确认，以及回到对话框怎么继续。',
      recentTitle: '最近发生',
      recentSummary: '系统已经接住准备结果',
      recentItems: ['刚完成预检', '系统已经接住准备结果'],
      confirmTitle: '还差确认',
      confirmSummary: '统一状态建议先继续',
      confirmItems: ['确认下一步'],
      replyTitle: '回到对话框这样说',
      primarySay: '继续，按主链往下走',
      replyReason: '统一状态建议先继续',
      alternativeSayItems: [],
    }
  );

  assert.deepEqual(
    buildUnifiedWorkflowStageRelay(
      {
        conclusion: '当前已进入结果判断',
        currentFocus: '先筛出主保留图',
        nextAction: { label: '进入异常工作台', reason: '先处理失败项' },
      },
      {
        workflow: { currentSummary: '工作流当前说明' },
        fallbackNextSummary: '兜底下一站说明',
      }
    ),
    {
      title: '阶段接力',
      copy: '这里把上一站交接、这一站职责和完成后的去向收成同一块统一接力面板。',
      previousTitle: '上一站交来',
      previousLabel: '当前没有上一站交接',
      previousSummary: '当前没有额外说明。',
      previousItems: [],
      currentTitle: '这一站负责',
      currentLabel: '当前已进入结果判断',
      currentSummary: '工作流当前说明',
      currentItems: [],
      nextTitle: '完成后送去',
      nextLabel: '进入异常工作台',
      nextSummary: '先处理失败项',
      nextItems: [],
    }
  );

  const contractPageState = buildWorkflowContractPageState({
    snapshot: {
      taskLabel: '高端时尚竖版海报',
      stageLabel: '结果阶段',
      statusLabel: '结果基本稳定',
      nextActionLabel: '回工作台首页',
      nextActionSummary: '先统一收口，再决定是否补跑。',
    },
    currentJudgment: {
      statusLabel: '结果基本稳定',
      statusSummary: '当前可以继续收口。',
      confirmItems: ['先筛出保留图'],
    },
    nextAction: {
      label: '回工作台首页',
      summary: '先统一收口，再决定是否补跑。',
      reason: '当前主要动作是统一收口。',
      recommendedReply: '继续，先回工作台首页',
      notes: ['若仍有边界图，再回异常页'],
    },
    dialogue: {
      primarySay: '继续，先回工作台首页',
      replyReason: '系统已经完成结果层初判。',
      directReplies: ['继续，先回工作台首页', '继续，处理当前结果层'],
      alternativeSayItems: ['继续，先看异常项'],
      summary: '当前建议先顺着主链继续。',
    },
    confirmation: {
      stageLabel: '结果阶段',
      summary: '结果层已具备继续条件。',
      pendingItems: ['先确认保留名单'],
      blockingItems: [],
      confirmedItems: ['主要结果已经生成'],
      canContinue: true,
      hasBlocking: false,
    },
    relay: {
      previous: '准备层已交接',
      current: '结果层收口',
      next: '工作台首页',
      currentSummary: '这一站先做筛图与收口。',
      nextSummary: '收口后回主工作台继续。',
    },
    recent: {
      title: '结果层完成初判',
      summary: '已经把主要结果分层整理完。',
    },
    console: {
      sessionTitle: '会话控制台',
    },
  }, {
    progressTone: 'good',
  });

  assert.equal(contractPageState.nextAction.label, '回工作台首页');
  assert.equal(contractPageState.dialogueStatus.primarySay, '继续，先回工作台首页');
  assert.equal(contractPageState.confirmation.summary, '结果层已具备继续条件。');
  assert.equal(contractPageState.taskControlBar.taskLabel, '高端时尚竖版海报');
  assert.equal(contractPageState.taskControlBar.stageLabel, '结果阶段');
  assert.equal(contractPageState.stageRelay.nextLabel, '工作台首页');
  assert.equal(contractPageState.collaboration.primarySay, '继续，先回工作台首页');
  assert.deepEqual(contractPageState.dialogueStatus.confirmItems, ['先筛出保留图']);
  assert.deepEqual(contractPageState.confirmation.confirmedItems, ['主要结果已经生成']);
});

test('workspace shared builders normalize relay, cockpit, and decision sections', () => {
  const {
    buildWorkspaceStageRelayData,
    buildWorkspaceCockpitSummaryData,
    buildWorkspaceDecisionSectionData,
    buildWorkspaceDecisionItems,
    buildWorkspaceContextBarData,
    buildWorkspaceRouteData,
    buildWorkspaceRouteSectionData,
    buildWorkspaceWorkbenchData,
    buildWorkspaceWorkbenchSectionData,
  } = require(path.join(scriptsDir, 'workspace_page_shared.js'));

  const relay = buildWorkspaceStageRelayData({
    previousLabel: '准备层已交接',
    currentLabel: '继续结果层',
    nextItems: ['进入异常页', '回工作台首页'],
  });
  const cockpit = buildWorkspaceCockpitSummaryData({
    items: [
      { label: '当前局面', value: '结果稳定', summary: '可以继续收口。', tone: 'good' },
    ],
  });
  const decision = buildWorkspaceDecisionSectionData({
    items: buildWorkspaceDecisionItems({
      reasonValue: '因为异常已收清。',
      riskValue: '暂不处理会影响回主链。',
      pageValue: '这一页现在最适合继续收口。',
    }),
  });
  const contextBar = buildWorkspaceContextBarData({
    runLabel: '高端时尚竖版海报',
    counts: [{ label: '成功', value: 8 }],
    hints: ['先继续主链'],
  });
  const route = buildWorkspaceRouteData({
    current: { label: '结果层', summary: '继续筛图' },
    nextSteps: [{ label: '异常工作台', summary: '处理失败项' }],
  });
  const normalizedRoute = buildWorkspaceRouteSectionData({
    source: {
      current: { label: '结果层', summary: '继续筛图' },
      nextSteps: [{ label: '异常工作台', summary: '处理失败项' }, null],
    },
  });
  const workbench = buildWorkspaceWorkbenchData({
    cards: [{ label: '工作台首页', value: '回主链' }],
  });
  const normalizedWorkbench = buildWorkspaceWorkbenchSectionData({
    source: {
      cards: [{ label: '工作台首页', value: '回主链' }, null],
    },
  });

  assert.equal(relay.previousLabel, '准备层已交接');
  assert.equal(relay.currentLabel, '继续结果层');
  assert.equal(relay.nextItems[0], '进入异常页');
  assert.equal(cockpit.title, '驾驶舱摘要');
  assert.equal(cockpit.items[0].value, '结果稳定');
  assert.equal(decision.title, '当前判断');
  assert.equal(decision.items[0].label, '为什么当前这样判断');
  assert.equal(decision.items[1].label, '如果暂不处理，主要风险是什么');
  assert.equal(decision.items[2].label, '这一页为什么现在最值得看');
  assert.match(decision.copy, /为什么当前这样判断|如果暂不处理/);
  assert.equal(contextBar.runLabel, '高端时尚竖版海报');
  assert.equal(route.title, '现在继续');
  assert.equal(normalizedRoute.current.label, '结果层');
  assert.equal(normalizedRoute.nextSteps.length, 1);
  assert.equal(workbench.title, '补充入口');
  assert.equal(normalizedWorkbench.cards.length, 1);
});

test('render_review_board assembles html review dashboard from execution artifacts', () => {
  const tempDir = makeTempDir('interactive-image-batch-review-board-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const successFile = path.join(outputDir, 'success.json');
  const failedFile = path.join(outputDir, 'failed.json');
  const needsReviewFile = path.join(outputDir, 'needs_review.json');
  const rerunCandidatesFile = path.join(outputDir, 'rerun_candidates.json');
  const operationsReportFile = path.join(outputDir, 'operations_report.json');
  const reviewBoardFile = path.join(outputDir, 'review_board.html');
  const storyboardBoardFile = path.join(outputDir, 'storyboard_board.html');
  const resultWorkspaceFile = path.join(outputDir, 'result_workspace.html');
  const exceptionWorkspaceFile = path.join(outputDir, 'exception_workspace.html');
  const keepImage = path.join(outputDir, 'keep.png');
  const reviewImage = path.join(outputDir, 'review.png');

  fs.writeFileSync(resultWorkspaceFile, '<html>result workspace</html>');
  fs.writeFileSync(exceptionWorkspaceFile, '<html>exception workspace</html>');
  fs.writeFileSync(keepImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(reviewImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    generatedAt: new Date().toISOString(),
    success: 2,
    failed: 1,
    batches: [],
  }, null, 2));
  fs.writeFileSync(successFile, JSON.stringify([
    {
      ok: true,
      index: '001',
      slug: 'keep-item',
      title: 'Keep Item',
      output: keepImage,
      requestMode: 'prompt-only',
      slotId: 'shot_1',
      scene: 'hero reveal',
      composition: 'full-body portrait',
    },
    {
      ok: true,
      index: '002',
      slug: 'review-item',
      title: 'Review Item',
      output: reviewImage,
      requestMode: 'masked-edit',
      slotId: 'shot_2',
      revisedPrompt: 'only edit lower-right corner',
    }
  ], null, 2));
  fs.writeFileSync(failedFile, JSON.stringify([
    {
      ok: false,
      index: '003',
      slug: 'failed-item',
      title: 'Failed Item',
      error: 'provider timeout',
      requestMode: 'reference-assisted',
      slotId: 'shot_3',
    }
  ], null, 2));
  fs.writeFileSync(needsReviewFile, JSON.stringify([
    {
      ok: true,
      index: '002',
      slug: 'review-item',
      title: 'Review Item',
      output: reviewImage,
      requestMode: 'masked-edit',
      slotId: 'shot_2',
      revisedPrompt: 'only edit lower-right corner',
    }
  ], null, 2));
  fs.writeFileSync(rerunCandidatesFile, JSON.stringify([
    {
      index: '003',
      slug: 'failed-item',
      title: 'Failed Item',
      slotId: 'shot_3',
      requestMode: 'reference-assisted',
      error: 'provider timeout',
    }
  ], null, 2));
  fs.writeFileSync(operationsReportFile, JSON.stringify({
    distributions: {
      requestMode: [
        { name: 'prompt-only', count: 1 },
        { name: 'masked-edit', count: 1 }
      ]
    }
  }, null, 2));
  fs.writeFileSync(storyboardBoardFile, '<html><body><div id="slot-shot_1"></div><div id="slot-shot_2"></div></body></html>');
  fs.writeFileSync(path.join(outputDir, 'assets_board.html'), '<html><body><div id="slot-shot_1"></div></body></html>');

  runNode('render_review_board.js', [
    '--manifest-file', manifestFile,
    '--output-file', reviewBoardFile,
  ]);

  const html = fs.readFileSync(reviewBoardFile, 'utf8');
  const sharedCss = fs.readFileSync(path.join(outputDir, 'portal_shared.css'), 'utf8');
  assert.match(html, /DAOGE 结果审阅补充页/);
  assert.match(html, /审阅看板已经降为结果补充页/);
  assert.match(html, /回结果工作台/);
  assert.match(html, /回异常工作台/);
  assert.match(html, /审阅补充页看完后，回主链收口/);
  assert.match(html, /不再承担结果总控/);
  assert.doesNotMatch(html, /结果审阅工作台/);
  assert.match(html, /建议保留/);
  assert.match(html, /建议复核/);
  assert.match(html, /建议重跑/);
  assert.match(html, /平均审阅分/);
  assert.match(html, /审阅分/);
  assert.match(html, /section-summary/);
  assert.match(html, /status-legend/);
  assert.match(html, /结果摘要/);
  assert.match(html, /状态图例/);
  assert.match(html, /分组导航/);
  assert.match(html, /处理优先级/);
  assert.match(html, /展开更多细节/);
  assert.match(html, /card-details/);
  assert.match(html, /card-notes-primary/);
  assert.match(html, /数量/);
  assert.match(html, /均分/);
  assert.match(html, /保留/);
  assert.match(html, /复核/);
  assert.match(html, /重跑/);
  assert.match(html, /需检查文案留白|局部编辑边界风险|需检查遮罩融合感/);
  assert.match(html, /id="review-search"/);
  assert.match(html, /id="review-status"/);
  assert.match(html, /id="review-mode"/);
  assert.match(html, /id="review-sort"/);
  assert.match(html, /id="review-density"/);
  assert.match(html, /审阅模式/);
  assert.match(html, /画廊模式/);
  assert.match(html, /gallery-density/);
  assert.match(html, /toolbar-shell/);
  assert.match(html, /快捷入口/);
  assert.match(html, /hero-action-strip/);
  assert.match(html, /hero-action-primary/);
  assert.match(html, /overview-stack/);
  assert.match(html, /overview-grid/);
  assert.match(html, /overview-panel/);
  assert.match(html, /preview-modal/);
  assert.match(html, /preview-dialog/);
  assert.match(html, /preview-stage/);
  assert.match(html, /preview-side/);
  assert.match(html, /data-preview-trigger/);
  assert.match(html, /点击预览/);
  assert.match(html, /上一张/);
  assert.match(html, /下一张/);
  assert.match(html, /Esc 关闭/);
  assert.match(html, /board-section-keep/);
  assert.match(html, /board-section-review/);
  assert.match(html, /board-section-rerun/);
  assert.match(html, /查看整板位置/);
  assert.match(html, /查看素材来源/);
  assert.match(html, /storyboard_board\.html#slot-shot_1/);
  assert.match(html, /assets_board\.html#slot-shot_1/);
  assert.match(html, /当前展示全部结果|当前筛选后展示/);
  assert.match(html, /addEventListener\('input', applyFilters\)/);
  assert.match(html, /ArrowLeft/);
  assert.match(html, /ArrowRight/);
  assert.match(sharedCss, /\.portal-workbench/);
  assert.match(html, /Keep Item/);
  assert.match(html, /Review Item/);
  assert.match(html, /Failed Item/);
  assert.match(html, /审阅浏览模式/);
  assert.match(html, /结果主链进度/);
  assert.doesNotMatch(html, /看完审阅看板后，下一步通常是/);
});

test('render_completion_report writes archive-layer completion markdown', () => {
  const tempDir = makeTempDir('interactive-image-batch-completion-report-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const reportFile = path.join(outputDir, 'daoge_completion_report.md');
  const storyboardBoardFile = path.join(outputDir, 'storyboard_board.html');
  fs.writeFileSync(storyboardBoardFile, '<html>storyboard</html>');
  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    success: 2,
    failed: 0,
    skipped: 0,
    batchCount: 1,
    stageCount: 1,
    batches: [
      {
        batchNumber: 1,
        success: 2,
        failed: 0,
        results: [
          { ok: true, index: '001', title: 'Keep Item', output: path.join(outputDir, 'keep.png'), slotId: 'shot_1' },
          { ok: true, index: '002', title: 'Edit Item', output: path.join(outputDir, 'edit.png'), slotId: 'shot_2', requestMode: 'masked-edit' },
        ],
      },
    ],
  }, null, 2));

  runNode('render_completion_report.js', [
    '--manifest-file', manifestFile,
    '--output-file', reportFile,
  ]);

  const markdown = fs.readFileSync(reportFile, 'utf8');
  assert.match(markdown, /DAOGE 完成归档报告/);
  assert.match(markdown, /已经退到归档层/);
  assert.match(markdown, /不负责结果主控/);
  assert.match(markdown, /分镜整板补充页/);
  assert.match(markdown, /按需打开分镜整板补充页/);
  assert.doesNotMatch(markdown, /# DAOGE 完成报告/);
  assert.doesNotMatch(markdown, /- 分镜整板页:/);
});

test('render_example_catalog_board links back into portal navigation', () => {
  const tempDir = makeTempDir('interactive-image-batch-example-catalog-links-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const catalogFile = path.join(skillRoot, 'references', 'examples', 'examples.catalog.json');
  const outputFile = path.join(outputDir, 'examples_catalog.html');
  const workspaceHomeFile = path.join(outputDir, 'workspace_home.html');
  const prepareWorkspaceFile = path.join(outputDir, 'prepare_workspace.html');
  const resultWorkspaceFile = path.join(outputDir, 'result_workspace.html');
  fs.writeFileSync(workspaceHomeFile, '<html>workspace</html>');
  fs.writeFileSync(prepareWorkspaceFile, '<html>prepare</html>');
  fs.writeFileSync(resultWorkspaceFile, '<html>result</html>');

  runNode('render_example_catalog_board.js', [
    '--catalog-file', catalogFile,
    '--output-file', outputFile,
  ]);

  const html = fs.readFileSync(outputFile, 'utf8');
  assert.match(html, /中文任务入口总览/);
  assert.match(html, /按任务意图开始/);
  assert.match(html, /推荐起步/);
  assert.match(html, /人物与时尚视觉/);
  assert.match(html, /电商与商业视觉/);
  assert.match(html, /信息与说明型视觉/);
  assert.match(html, /分镜与叙事/);
  assert.match(html, /界面与产品样机/);
  assert.match(html, /推荐意图入口/);
  assert.match(html, /catalog-search/);
  assert.match(html, /只看主链/);
  assert.match(html, /只看变体/);
  assert.match(html, /折叠分组/);
  assert.match(html, /入口主链协议/);
  assert.match(html, /模板展示板只负责选择任务类型和起步入口/);
  assert.match(html, /跨任务入口/);
  assert.match(html, /单轮任务怎么推进，看工作台首页/);
  assert.match(html, /默认生成策略/);
  assert.match(html, /mainline-only|主链工作台/);
  assert.match(html, /提示词预览、素材页、审阅看板、运行概览和补跑页必须按需开启/);
  assert.match(html, /默认隐藏:/);
  assert.match(html, /prompt_preview\.html/);
  assert.match(html, /review_board\.html/);
  assert.match(html, /查看模板细节（维护者）|查看变体细节（维护者）/);
  assert.match(html, /第一次使用优先选它|适合不想先理解模板名的人/);
  assert.match(html, /工作台首页/);
  assert.match(html, /准备工作台/);
  assert.match(html, /结果工作台/);
});

test('render_example_catalog_board prefers entry state when available', () => {
  const tempDir = makeTempDir('interactive-image-batch-example-catalog-state-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const catalogFile = path.join(skillRoot, 'references', 'examples', 'examples.catalog.json');
  const outputFile = path.join(outputDir, 'examples_catalog.html');
  const entryStateFile = path.join(outputDir, 'entry_state.json');
  const workspaceHomeFile = path.join(outputDir, 'workspace_home.html');
  const prepareWorkspaceFile = path.join(outputDir, 'prepare_workspace.html');
  const resultWorkspaceFile = path.join(outputDir, 'result_workspace.html');

  fs.writeFileSync(workspaceHomeFile, '<html>workspace</html>');
  fs.writeFileSync(prepareWorkspaceFile, '<html>prepare</html>');
  fs.writeFileSync(resultWorkspaceFile, '<html>result</html>');

  fs.writeFileSync(entryStateFile, JSON.stringify({
    entryMode: 'intent',
    entryContext: {
      runLabel: '财经口播整板',
      phaseLabel: '入口层',
      flowLabel: '中文模板展示板 -> 任务总控 -> 工作台首页 -> 准备工作台 -> 结果工作台 -> 异常工作台',
      counts: [
        { label: '进入方式', value: '按任务意图进入' },
        { label: '当前任务组', value: '分镜与叙事' },
        { label: '当前意图', value: 'oralboard' },
      ],
      hints: [
        '适合中文口播和主持人整板任务。',
        '先确认这类整板任务的方向和放行条件。',
      ],
    },
    entryMainlineProtocol: {
      version: 1,
      currentLayer: '入口层',
      sequence: ['中文模板展示板', '任务总控', '工作台首页', '准备工作台', '结果工作台', '异常工作台'],
      sequenceLabel: '中文模板展示板 -> 任务总控 -> 工作台首页 -> 准备工作台 -> 结果工作台 -> 异常工作台',
      entryRole: '模板展示板只负责选择任务类型和起步入口。',
      taskCenterRole: '任务总控只负责开新任务、继续当前任务和切换任务。',
      workspaceRole: '工作台首页接住单轮任务判断，再顺着准备、结果、异常继续。',
      handoffRule: '入口层一旦选定任务，就把方向交给准备工作台；任务总控只做任务级切换，不展开单轮内部判断。',
      summary: '先在中文模板展示板选任务，再到任务总控决定开新任务或继续任务，进入工作台首页后就沿四站主链推进。',
    },
    taskCategory: '分镜与叙事',
    starterIntent: 'oralboard',
    selectedExample: {
      id: 'oralboard-finance-host',
      name: '财经口播整板',
      description: '适合中文口播和主持人整板任务。',
    },
    recommendedNextStep: {
      label: '进入准备工作台',
      target: 'prepare_workspace.html',
      reason: '先确认这类整板任务的方向和放行条件。',
    },
    entryWorkbench: {
      route: {
        title: '从入口层继续',
        copy: '入口层只负责选任务和选起步入口，确认后就直接进入准备工作台。',
        current: {
          kicker: '当前入口',
          label: '财经口播整板',
          summary: '适合中文口播和主持人整板任务。',
        },
        next: {
          label: '进入准备工作台',
          reason: '先确认这类整板任务的方向和放行条件。',
          target: 'prepare_workspace.html',
        },
      },
      workbench: {
        title: '入口层主控',
        copy: '入口层只保留选任务、看入口和进入准备层这几件高频动作。',
        cards: [
          { label: '当前入口', value: '财经口播整板', summary: '适合中文口播和主持人整板任务。', tone: 'good', hideLinkIfMissing: true },
          { label: '当前任务组', value: '分镜与叙事', summary: '这一组会决定你优先看哪类入口。', tone: 'info', hideLinkIfMissing: true },
          { label: '推荐下一步', value: '进入准备工作台', summary: '先确认这类整板任务的方向和放行条件。', file: 'prepare_workspace.html', cta: '进入下一步', tone: 'good' },
        ],
      },
    },
  }, null, 2));

  runNode('render_example_catalog_board.js', [
    '--catalog-file', catalogFile,
    '--output-file', outputFile,
    '--entry-state-file', entryStateFile,
  ]);

  const html = fs.readFileSync(outputFile, 'utf8');
  assert.match(html, /财经口播整板/);
  assert.match(html, /入口层/);
  assert.match(html, /按任务意图进入/);
  assert.match(html, /分镜与叙事/);
  assert.match(html, /oralboard/);
  assert.match(html, /先确认这类整板任务的方向和放行条件/);
  assert.match(html, /入口层主控/);
  assert.match(html, /入口主链协议/);
  assert.match(html, /中文模板展示板 -&gt; 任务总控 -&gt; 工作台首页|中文模板展示板 -&gt; 任务总控|模板展示板只负责选择任务类型和起步入口/);
  const { resolveEntryMainlineProtocol } = require('../scripts/entry_state_shared');
  const resolvedProtocol = resolveEntryMainlineProtocol(JSON.parse(fs.readFileSync(entryStateFile, 'utf8')));
  assert.equal(resolvedProtocol.defaultGenerationProtocol?.mode, 'mainline-only');
  assert.equal(resolvedProtocol.mainlineContract?.defaultGenerationMode, 'mainline-only');
  assert.match(String(resolvedProtocol.mainlineContract?.defaultGenerationSummary || ''), /默认只带用户进入主链工作台/);
  assert.match(String(resolvedProtocol.mainlineContract?.defaultGenerationGuardrail?.onDemandRule || ''), /必须按需开启/);
  assert.match(String(resolvedProtocol.defaultGenerationProtocol?.guardrail?.removedRule || ''), /不再生成|残留会被清理/);
  assert.match(html, /默认隐藏:/);
  assert.match(html, /prompt_preview\.html/);
  assert.match(html, /review_board\.html/);
  assert.match(html, /当前入口/);
  assert.match(html, /建议下一步/);
});

test('build_workspace_state promotes host-native as an official mainline mode', () => {
  const tempDir = makeTempDir('interactive-image-batch-workspace-host-native-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const workspaceStateFile = path.join(outputDir, 'workspace_state.json');
  const workspaceAssetsFile = path.join(outputDir, 'workspace_assets.json');
  const workspaceTimelineFile = path.join(outputDir, 'workspace_timeline.json');
  const workbenchStateFile = path.join(outputDir, 'workbench_state.json');

  fs.writeFileSync(path.join(outputDir, 'host_native_prompt_pack.json'), JSON.stringify({
    runtime_mode: 'host-native-image-tool',
    recommendation: 'use-host-native-light-path',
  }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'host_native_summary.html'), '<html>host native summary</html>');
  fs.writeFileSync(path.join(outputDir, 'host_native_summary.md'), '# host native summary');
  fs.writeFileSync(path.join(outputDir, 'success.json'), JSON.stringify([
    { title: 'Host native image 1', output: 'host-native-1.png' },
  ], null, 2));
  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    runtimeMode: 'host-native-image-tool',
    recommendation: 'use-host-native-light-path',
    hostNative: true,
    selectedCount: 1,
    success: 1,
    failed: 0,
    generatedAt: '2026-05-27T09:00:00.000Z',
  }, null, 2));

  runNode('build_workspace_state.js', [
    '--manifest-file', manifestFile,
    '--output-dir', outputDir,
    '--workspace-state-file', workspaceStateFile,
    '--workspace-assets-file', workspaceAssetsFile,
    '--workspace-timeline-file', workspaceTimelineFile,
    '--workbench-state-file', workbenchStateFile,
  ]);
  runNode('render_workspace_home.js', [
    '--manifest-file', manifestFile,
    '--output-file', path.join(outputDir, 'workspace_home.html'),
  ]);
  runNode('render_run_record.js', [
    '--manifest-file', manifestFile,
    '--html-file', path.join(outputDir, 'run_record.html'),
    '--markdown-file', path.join(outputDir, 'run_record.md'),
  ]);

  const workspaceState = JSON.parse(fs.readFileSync(workspaceStateFile, 'utf8'));
  const workbenchState = JSON.parse(fs.readFileSync(workbenchStateFile, 'utf8'));
  const workspaceHomeHtml = fs.readFileSync(path.join(outputDir, 'workspace_home.html'), 'utf8');
  const runRecordHtml = fs.readFileSync(path.join(outputDir, 'run_record.html'), 'utf8');
  const runRecordMarkdown = fs.readFileSync(path.join(outputDir, 'run_record.md'), 'utf8');
  assert.equal(workspaceState.runtimeMode, 'host-native-image-tool');
  assert.equal(workspaceState.workflowKind, 'host-native');
  assert.equal(workspaceState.specialWorkflowProtocol?.activeWorkflowKind, 'host-native');
  assert.equal(workspaceState.specialWorkflowProtocol?.hostNative?.officialMainline, true);
  assert.equal(workspaceState.specialWorkflowProtocol?.hostNative?.active, true);
  assert.match(String(workspaceState.specialWorkflowProtocol?.hostNative?.responsibility || ''), /正式运行模式之一/);
  assert.equal(workspaceState.specialWorkflowProtocol?.hostNative?.handoffAssets?.promptPack, path.join(outputDir, 'host_native_prompt_pack.json'));
  assert.equal(workspaceState.specialWorkflowProtocol?.hostNative?.resultBackfillContract?.sourceScript, 'ingest_host_native_results.js');
  assert.match(String(workspaceState.specialWorkflowProtocol?.hostNative?.defaultMainlineBehavior || ''), /不伪造本地 runner 执行记录/);
  assert.equal(workbenchState.specialWorkflowProtocol?.hostNative?.active, true);
  assert.match(workspaceHomeHtml, /特殊工作流定位/);
  assert.match(workspaceHomeHtml, /host-native 正式模式/);
  assert.match(workspaceHomeHtml, /不伪造本地 runner 执行记录/);
  assert.match(runRecordHtml, /特殊工作流定位/);
  assert.match(runRecordHtml, /host-native/);
  assert.match(runRecordMarkdown, /特殊工作流定位/);
  assert.match(runRecordMarkdown, /host-native: 当前启用/);
});

test('ingest_host_native_results mirrors workspace layout and keeps mirror navigation usable', () => {
  const tempDir = makeTempDir('interactive-image-batch-host-native-ingest-');
  const outputDir = path.join(tempDir, 'out');
  const promptPackFile = path.join(tempDir, 'host_native_prompt_pack.json');
  const resultsFile = path.join(tempDir, 'host_native_results.json');
  const successImage = path.join(tempDir, 'host_result_1.png');
  const reviewImage = path.join(tempDir, 'host_result_2.png');
  fs.writeFileSync(path.join(tempDir, 'task_center.html'), '<html>task center</html>');
  fs.writeFileSync(successImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(reviewImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(promptPackFile, JSON.stringify({
    runtime_mode: 'host-native-image-tool',
    recommendation: 'use-host-native-light-path',
    prompts_file: path.join(tempDir, 'prompts.generated.json'),
    prompt_count: 2,
    task_summary: {
      content_brief: '高端时尚竖版海报',
      output_mode: 'photoreal campaign poster',
      batch_size: 1,
      width: 1440,
      height: 2560,
    },
    template: {
      id: 'campaign-poster',
      name: 'Campaign Poster',
    },
  }, null, 2));
  fs.writeFileSync(resultsFile, JSON.stringify([
    {
      index: '001',
      title: 'Host Success',
      output: successImage,
      slotId: 'shot_1',
      requestMode: 'prompt-only',
      status: 'success',
      scene: 'studio',
      composition: 'full body',
      styleFamily: 'brand',
      slotRole: 'hero',
    },
    {
      index: '002',
      title: 'Host Review',
      output: reviewImage,
      slotId: 'shot_2',
      requestMode: 'masked-edit',
      status: 'needs_review',
      scene: 'window',
      composition: 'medium shot',
      textPolicy: 'leave top and bottom clean for later typography',
      styleFamily: 'brand',
      slotRole: 'detail',
    },
    {
      index: '003',
      title: 'Host Failed',
      slotId: 'shot_3',
      requestMode: 'reference-assisted',
      status: 'failed',
      error: 'provider timeout',
      styleFamily: 'brand',
      slotRole: 'detail',
    },
  ], null, 2));

  runNode('ingest_host_native_results.js', [
    '--prompt-pack-file', promptPackFile,
    '--results-file', resultsFile,
    '--output-dir', outputDir,
  ]);

  [
    'workspace_layout_manifest.json',
    'workspace/workspace_home.html',
    'workspace/result_workspace.html',
    'workspace/exception_workspace.html',
    'workspace/run_record.html',
    'internal/manifest.json',
    'internal/workspace_state.json',
    'internal/workspace_live_state.json',
    'internal/operations_report.json',
    'internal/success.json',
    'internal/failed.json',
    'internal/needs_review.json',
  ].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, name)), true, `missing host-native layout mirror ${name}`);
  });
  [
    'review_board.html',
    'result_hub.html',
    'completion_board.html',
    'run_overview.html',
    'rerun_board.html',
    'daoge_portal.html',
  ].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, name)), false, `unexpected host-native optional page ${name}`);
  });

  const layoutManifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'workspace_layout_manifest.json'), 'utf8'));
  assert.equal(layoutManifest.mode, 'workspace-first');
  assert.equal(layoutManifest.source, 'ingest_host_native_results');
  assert.ok(layoutManifest.counts.workspace >= 4);
  assert.ok(layoutManifest.counts.internal >= 7);
  const workspaceState = JSON.parse(fs.readFileSync(path.join(outputDir, 'workspace_state.json'), 'utf8'));
  assert.equal(workspaceState.runtimeMode, 'host-native-image-tool');
  assert.equal(workspaceState.workflowKind, 'host-native');
  assert.equal(workspaceState.artifactGovernance?.summary?.workspaceLayoutMode, 'workspace-first');
  assert.equal(workspaceState.artifactGovernance?.summary?.defaultEntryPath, path.join(outputDir, 'workspace', 'workspace_home.html'));
  const readme = fs.readFileSync(path.join(outputDir, 'README.md'), 'utf8');
  assert.match(readme, /workspace\/workspace_home\.html/);
  assert.match(readme, /workspace\/ 是正式工作台入口/);
  assert.match(readme, /其它补充页: 默认不生成；需要深看时从对应工作台按需进入/);
  assert.doesNotMatch(readme, /- 完成报告: .*daoge_completion_report\.md/);
  assert.doesNotMatch(readme, /review_board\.html|completion_board\.html|run_overview\.html|rerun_board\.html|storyboard_board\.html/);
  const mirroredWorkspaceHome = fs.readFileSync(path.join(outputDir, 'workspace', 'workspace_home.html'), 'utf8');
  assert.match(mirroredWorkspaceHome, /href="exception_workspace\.html"/);
  assert.match(mirroredWorkspaceHome, /href="\.\.\/\.\.\/task_center\.html"/);
  assert.doesNotMatch(mirroredWorkspaceHome, /href="\.\.\/result_workspace\.html"/);
  assert.doesNotMatch(mirroredWorkspaceHome, /href="\.\.\/exception_workspace\.html"/);
  const mirroredResultWorkspace = fs.readFileSync(path.join(outputDir, 'workspace', 'result_workspace.html'), 'utf8');
  assert.doesNotMatch(mirroredResultWorkspace, /href="\.\.\/workspace_home\.html"/);
  assert.doesNotMatch(mirroredResultWorkspace, /href="\.\.\/result_workspace\.html"/);
  assert.doesNotMatch(mirroredResultWorkspace, /href="\.\.\/exception_workspace\.html"/);
});

test('render_task_center prefers workspace state when available', () => {
  const tempDir = makeTempDir('interactive-image-batch-task-center-state-');
  const rootDir = path.join(tempDir, 'runs');
  const outputDir = path.join(rootDir, 'board_A_full');
  fs.mkdirSync(outputDir, { recursive: true });

  const indexFile = path.join(rootDir, 'daoge_run_index.json');
  const outputFile = path.join(rootDir, 'task_center.html');
  const workspaceHomeFile = path.join(outputDir, 'workspace_home.html');
  const workspaceStateFile = path.join(outputDir, 'workspace_state.json');
  const workspaceTimelineFile = path.join(outputDir, 'workspace_timeline.json');
  const examplesCatalogFile = path.join(skillRoot, 'references', 'examples', 'examples_catalog.html');

  fs.mkdirSync(path.join(outputDir, 'workspace'), { recursive: true });
  fs.writeFileSync(workspaceHomeFile, '<html>workspace</html>');
  fs.writeFileSync(path.join(outputDir, 'workspace', 'workspace_home.html'), '<html>workspace mirror</html>');
  fs.writeFileSync(indexFile, JSON.stringify([
    {
      outputDir,
      generatedAt: '2026-05-20T09:00:00.000Z',
      success: 0,
      failed: 0,
      selectedCount: 0,
    }
  ], null, 2));
  fs.writeFileSync(workspaceStateFile, JSON.stringify({
    taskLabel: '半导体口播整板',
    status: {
      phase: '结果阶段',
      tone: 'warn',
      headline: '结果整体稳定，但仍有待复核项',
      summary: '建议先回结果工作台继续细看。',
    },
    counts: {
      selected: 6,
      success: 4,
      failed: 1,
      needsReview: 1,
    },
    nextAction: {
      label: '进入结果工作台',
      reason: '建议先回结果工作台继续细看。',
      target: 'result_workspace.html',
    },
    assetLayers: {
      userFacing: {
        groups: [
          { key: 'result', count: 4 },
          { key: 'preview', count: 4 },
          { key: 'review', count: 1 },
          { key: 'exception', count: 1 },
          { key: 'reference', count: 0 },
        ],
      },
    },
  }, null, 2));
  fs.writeFileSync(workspaceTimelineFile, JSON.stringify({
    events: [
      {
        type: 'execution_completed',
        title: '执行阶段已完成',
        summary: '结果工作台已经可用。',
        time: '2026-05-20T10:00:00.000Z',
      },
    ],
  }, null, 2));

  runNode('render_task_center.js', [
    '--index-file', indexFile,
    '--output-file', outputFile,
  ]);

  const html = fs.readFileSync(outputFile, 'utf8');
  assert.match(html, /半导体口播整板/);
  assert.match(html, /结果阶段/);
  assert.match(html, /当前还有结果需要再收一轮|已经有结果可以继续推进/);
  assert.match(html, /建议先回结果工作台继续细看/);
  assert.match(html, /需要先看/);
  assert.match(html, /总控层/);
  assert.match(html, /从这里进入任务/);
  assert.match(html, /先选定这一轮/);
  assert.match(html, /当前要做什么/);
  assert.match(html, /继续当前任务/);
  assert.match(html, /开始新任务/);
  assert.match(html, /入口主链协议/);
  assert.match(html, /工作台首页接住单轮任务判断/);
  assert.match(html, /href="board_A_full\/workspace\/workspace_home\.html"/);
  assert.doesNotMatch(html, /href="board_A_full\/workspace_home\.html"/);
  assert.match(html, /跨任务入口/);
  assert.match(html, /任务内判断交给工作台首页/);
  assert.match(html, /默认生成策略/);
  assert.match(html, /提示词预览、素材页、审阅看板、运行概览和补跑页必须按需开启/);
  assert.match(html, /默认隐藏:/);
  assert.match(html, /prompt_preview\.html/);
  assert.match(html, /DAOGE 任务总控/);
  assert.doesNotMatch(html, /最近任务档案/);
  assert.match(html, /当前推荐/);
  assert.match(html, /这里只做一件事：决定现在是开新任务，还是继续当前任务/);
  assert.match(html, /选定这轮任务/);
  assert.doesNotMatch(html, /建议优先处理/);
  assert.doesNotMatch(html, /其它任务/);
  assert.doesNotMatch(html, /主链控制台/);
});

test('render_task_center translates existing runs into user-facing task groups', () => {
  const tempDir = makeTempDir('interactive-image-batch-task-center-existing-');
  const rootDir = path.join(tempDir, 'runs');
  const fullRunDir = path.join(rootDir, 'board_B_full');
  const fixRunDir = path.join(rootDir, 'board_B_shot10_fix');
  const sampleRunDir = path.join(rootDir, 'sample_preview_round1');
  fs.mkdirSync(fullRunDir, { recursive: true });
  fs.mkdirSync(fixRunDir, { recursive: true });
  fs.mkdirSync(sampleRunDir, { recursive: true });

  const indexFile = path.join(rootDir, 'daoge_run_index.json');
  const outputFile = path.join(rootDir, 'task_center.html');

  [fullRunDir, fixRunDir, sampleRunDir].forEach((dir) => {
    fs.writeFileSync(path.join(dir, 'workspace_home.html'), '<html>workspace</html>');
  });

  fs.writeFileSync(indexFile, JSON.stringify([
    {
      outputDir: sampleRunDir,
      generatedAt: '2026-05-20T09:00:00.000Z',
      success: 2,
      failed: 0,
      selectedCount: 4,
      sampleSize: 2,
      pauseReason: 'sample_stage_completed_review_required',
    },
    {
      outputDir: fixRunDir,
      generatedAt: '2026-05-20T08:00:00.000Z',
      success: 1,
      failed: 0,
      selectedCount: 1,
      resumeManifest: '/tmp/base/manifest.json',
    },
    {
      outputDir: fullRunDir,
      generatedAt: '2026-05-20T07:00:00.000Z',
      success: 6,
      failed: 0,
      selectedCount: 6,
    }
  ], null, 2));

  fs.writeFileSync(path.join(sampleRunDir, 'prompts.generated.json'), JSON.stringify([
    { title: 'Shot 02 米姐开场 Sample', board_id: 'mijie-semiconductor-v2-board-a' },
    { title: 'Shot 06 周期答案 Sample', board_id: 'mijie-semiconductor-v2-board-a' }
  ], null, 2));
  fs.writeFileSync(path.join(fixRunDir, 'prompts.generated.json'), JSON.stringify([
    { title: 'Shot 10 跟普通人有什么关系', board_id: 'mijie-semiconductor-v2-board-b' }
  ], null, 2));
  fs.writeFileSync(path.join(fullRunDir, 'prompts.generated.json'), JSON.stringify([
    { title: 'Shot 07 去库存结束', board_id: 'mijie-semiconductor-v2-board-b' },
    { title: 'Shot 08 海外AI算力拉动', board_id: 'mijie-semiconductor-v2-board-b' }
  ], null, 2));

  runNode('render_task_center.js', [
    '--index-file', indexFile,
    '--output-file', outputFile,
  ]);

  const html = fs.readFileSync(outputFile, 'utf8');
  assert.match(html, /其它可继续任务/);
  assert.match(html, /先选定这一轮/);
  assert.match(html, /A 段整板 抽样预览（4 张）/);
  assert.match(html, /局部修订/);
  assert.match(html, /跟普通人有什么关系 修订任务/);
  assert.match(html, /B 段整板（6 张）/);
  assert.match(html, /当前任务/);
  assert.match(html, /这里只负责选任务/);
  assert.match(html, /需要先处理的任务会自动排在前面/);
  assert.doesNotMatch(html, /A 段整板（6 张） · 结果阶段/);
  assert.doesNotMatch(html, /已稳定可回看/);

  const fixManifestFile = path.join(fixRunDir, 'manifest.json');
  const fixWorkspaceStateFile = path.join(fixRunDir, 'workspace_state.json');
  const fixWorkspaceAssetsFile = path.join(fixRunDir, 'workspace_assets.json');
  const fixWorkspaceTimelineFile = path.join(fixRunDir, 'workspace_timeline.json');
  const fixWorkbenchStateFile = path.join(fixRunDir, 'workbench_state.json');
  fs.writeFileSync(fixManifestFile, JSON.stringify({
    outputDir: fixRunDir,
    runtimeMode: 'local-batch-runner',
    selectedCount: 1,
    success: 1,
    failed: 0,
    resumeManifest: '/tmp/base/manifest.json',
  }, null, 2));

  runNode('build_workspace_state.js', [
    '--manifest-file', fixManifestFile,
    '--output-dir', fixRunDir,
    '--workspace-state-file', fixWorkspaceStateFile,
    '--workspace-assets-file', fixWorkspaceAssetsFile,
    '--workspace-timeline-file', fixWorkspaceTimelineFile,
    '--workbench-state-file', fixWorkbenchStateFile,
  ]);
  runNode('render_workspace_home.js', [
    '--manifest-file', fixManifestFile,
    '--output-file', path.join(fixRunDir, 'workspace_home.html'),
  ]);
  runNode('render_run_record.js', [
    '--manifest-file', fixManifestFile,
    '--html-file', path.join(fixRunDir, 'run_record.html'),
    '--markdown-file', path.join(fixRunDir, 'run_record.md'),
  ]);

  const fixWorkspaceState = JSON.parse(fs.readFileSync(fixWorkspaceStateFile, 'utf8'));
  const fixWorkspaceHomeHtml = fs.readFileSync(path.join(fixRunDir, 'workspace_home.html'), 'utf8');
  const fixRunRecordMarkdown = fs.readFileSync(path.join(fixRunDir, 'run_record.md'), 'utf8');
  assert.equal(fixWorkspaceState.workflowKind, 'local-edit');
  assert.equal(fixWorkspaceState.specialWorkflowProtocol?.localEditRerun?.officialProfessionalPath, true);
  assert.equal(fixWorkspaceState.specialWorkflowProtocol?.localEditRerun?.active, true);
  assert.equal(fixWorkspaceState.specialWorkflowProtocol?.localEditRerun?.triggerContract?.resumeManifest, '/tmp/base/manifest.json');
  assert.match(String(fixWorkspaceState.specialWorkflowProtocol?.localEditRerun?.responsibility || ''), /异常层和分镜局部修订/);
  assert.match(String(fixWorkspaceState.specialWorkflowProtocol?.localEditRerun?.defaultMainlineBehavior || ''), /只有确认进入专业处理/);
  assert.match(fixWorkspaceHomeHtml, /local-edit \/ rerun 专业路径/);
  assert.match(fixWorkspaceHomeHtml, /只有确认进入专业处理/);
  assert.match(fixRunRecordMarkdown, /local-edit \/ rerun: 当前需要关注/);
});

test('render_task_center can prefer unified workbench_state snapshot', () => {
  const tempDir = makeTempDir('interactive-image-batch-task-center-workbench-state-');
  const rootDir = path.join(tempDir, 'runs');
  const outputDir = path.join(rootDir, 'demo_run');
  fs.mkdirSync(outputDir, { recursive: true });

  const indexFile = path.join(rootDir, 'daoge_run_index.json');
  const outputFile = path.join(rootDir, 'task_center.html');
  const workspaceHomeFile = path.join(outputDir, 'workspace_home.html');
  const resultWorkspaceFile = path.join(outputDir, 'result_workspace.html');
  const workbenchStateFile = path.join(outputDir, 'workbench_state.json');
  const examplesCatalogFile = path.join(skillRoot, 'references', 'examples', 'examples_catalog.html');

  fs.writeFileSync(workspaceHomeFile, '<html>workspace</html>');
  fs.writeFileSync(resultWorkspaceFile, '<html>result</html>');
  fs.writeFileSync(indexFile, JSON.stringify([
    {
      outputDir,
      generatedAt: '2026-05-20T10:30:00.000Z',
      selectedCount: 8,
      success: 6,
      failed: 1,
      batchCount: 3,
    },
  ], null, 2));
  fs.writeFileSync(workbenchStateFile, JSON.stringify({
    kind: 'daoge-workbench-state',
    schemaVersion: 1,
    generatedAt: '2026-05-20T10:30:00.000Z',
    outputDir,
    taskLabel: '统一快照总控任务',
    status: {
      phase: '结果阶段',
      headline: '统一快照总控已接管',
      summary: '建议先回结果工作台继续。',
      tone: 'good',
    },
    counts: {
      selected: 8,
      success: 6,
      failed: 1,
      needsReview: 1,
    },
    nextAction: {
      label: '进入结果工作台',
      reason: '统一快照总控建议先回结果层继续。',
      target: 'result_workspace.html',
    },
    artifactGovernance: {
      summary: {
        defaultEntryLabel: '工作台首页',
        principle: '统一快照总控已接管工作台主链。',
      },
    },
    assetLayers: {
      userWorkbenchProtocol: {
        defaultEntryLabel: '工作台首页',
        defaultVisibleLabels: ['工作台首页', '准备工作台', '结果工作台', '异常工作台'],
        taskCenterCopy: '默认先从工作台首页进入，再顺着准备、结果、异常三站推进；任务档案只作为按需补充入口。',
        stateSources: {
          primaryRuntimeSource: path.join(outputDir, 'workspace_live_state.json'),
          derivedWorkbenchSnapshot: path.join(outputDir, 'workbench_state.json'),
        },
      },
    },
    timeline: {
      events: [
        {
          type: 'execution_completed',
          title: '统一快照总控最近事件',
          summary: '统一快照总控时间线说明',
          time: '2026-05-20T10:30:00.000Z',
        },
      ],
    },
  }, null, 2));

  runNode('render_task_center.js', [
    '--index-file', indexFile,
    '--output-file', outputFile,
  ]);

  const html = fs.readFileSync(outputFile, 'utf8');
  assert.match(html, /统一快照总控任务/);
  assert.match(html, /统一快照总控建议先回结果层继续/);
  assert.match(html, /结果阶段/);
  assert.match(html, /任务总控/);
  assert.match(html, /开始新任务/);
  assert.match(html, /中文模板展示板/);
  assert.match(html, /入口主链提醒/);
  assert.match(html, /从哪里进/);
  assert.match(html, /现在看什么/);
  assert.match(html, /对话框怎么回/);
  assert.match(html, /任务总控只负责两件事/);
  assert.match(html, /默认先从工作台首页进入，再顺着准备、结果、异常三站推进/);
  assert.equal(fs.existsSync(examplesCatalogFile), true);
});

test('render_task_center can reuse unified entry state language', () => {
  const tempDir = makeTempDir('interactive-image-batch-task-center-entry-state-');
  const rootDir = path.join(tempDir, 'runs');
  const outputDir = path.join(rootDir, 'board_A_full');
  fs.mkdirSync(outputDir, { recursive: true });

  const indexFile = path.join(rootDir, 'daoge_run_index.json');
  const outputFile = path.join(rootDir, 'task_center.html');
  const workspaceHomeFile = path.join(outputDir, 'workspace_home.html');
  const entryStateFile = path.join(outputDir, 'entry_state.json');

  fs.writeFileSync(workspaceHomeFile, '<html>workspace</html>');
  fs.writeFileSync(indexFile, JSON.stringify([
    {
      outputDir,
      generatedAt: '2026-05-20T09:00:00.000Z',
      success: 0,
      failed: 0,
      selectedCount: 0,
    }
  ], null, 2));
  fs.writeFileSync(entryStateFile, JSON.stringify({
    entryMode: 'intent',
    entryContext: {
      runLabel: '财经口播整板',
      phaseLabel: '入口层',
      flowLabel: '中文模板展示板 -> 任务总控 -> 工作台首页 -> 准备工作台 -> 结果工作台 -> 异常工作台',
      counts: [
        { label: '进入方式', value: '按任务意图进入' },
        { label: '当前任务组', value: '分镜与叙事' },
        { label: '当前意图', value: 'oralboard' },
      ],
      hints: [
        '适合中文口播和主持人整板任务。',
        '先确认这类整板任务的方向和放行条件。',
      ],
    },
    entryMainlineProtocol: {
      version: 1,
      currentLayer: '入口层',
      sequence: ['中文模板展示板', '任务总控', '工作台首页', '准备工作台', '结果工作台', '异常工作台'],
      sequenceLabel: '中文模板展示板 -> 任务总控 -> 工作台首页 -> 准备工作台 -> 结果工作台 -> 异常工作台',
      entryRole: '模板展示板只负责选择任务类型和起步入口。',
      taskCenterRole: '任务总控只负责开新任务、继续当前任务和切换任务。',
      workspaceRole: '工作台首页接住单轮任务判断，再顺着准备、结果、异常继续。',
      handoffRule: '入口层一旦选定任务，就把方向交给准备工作台；任务总控只做任务级切换，不展开单轮内部判断。',
      summary: '先在中文模板展示板选任务，再到任务总控决定开新任务或继续任务，进入工作台首页后就沿四站主链推进。',
    },
    taskCategory: '分镜与叙事',
    starterIntent: 'oralboard',
    selectedExample: {
      id: 'oralboard-finance-host',
      name: '财经口播整板',
      description: '适合中文口播和主持人整板任务。',
    },
    recommendedNextStep: {
      label: '进入准备工作台',
      target: path.join(outputDir, 'prepare_workspace.html'),
      reason: '先确认这类整板任务的方向和放行条件。',
    },
    entryWorkbench: {
      route: {
        title: '从入口层继续',
        copy: '入口层只负责选任务和选起步入口，确认后就直接进入准备工作台。',
        current: {
          kicker: '当前入口',
          label: '财经口播整板',
          summary: '适合中文口播和主持人整板任务。',
        },
        next: {
          kicker: '建议下一步',
          label: '进入准备工作台',
          reason: '先确认这类整板任务的方向和放行条件。',
          target: path.join(outputDir, 'prepare_workspace.html'),
        },
      },
      workbench: {
        title: '入口层主控',
        copy: '入口层只保留选任务、看入口和进入准备层这几件高频动作。',
        cards: [
          { label: '当前入口', value: '财经口播整板', summary: '适合中文口播和主持人整板任务。', tone: 'good', hideLinkIfMissing: true },
          { label: '当前任务组', value: '分镜与叙事', summary: '这一组会决定你优先看哪类入口。', tone: 'info', hideLinkIfMissing: true },
          { label: '推荐下一步', value: '进入准备工作台', summary: '先确认这类整板任务的方向和放行条件。', file: path.join(outputDir, 'prepare_workspace.html'), cta: '进入下一步', tone: 'good' },
        ],
      },
    },
  }, null, 2));

  runNode('render_task_center.js', [
    '--index-file', indexFile,
    '--output-file', outputFile,
  ]);

  const html = fs.readFileSync(outputFile, 'utf8');
  assert.match(html, /财经口播整板/);
  assert.match(html, /入口层主控/);
  assert.match(html, /入口主链协议/);
  assert.match(html, /入口主链提醒/);
  assert.match(html, /从入口层继续/);
  assert.match(html, /分镜与叙事/);
  assert.match(html, /先确认这类整板任务的方向和放行条件/);
  assert.match(html, /入口层 \/ 总控层/);
  assert.match(html, /跨任务入口/);
  assert.match(html, /任务内判断交给工作台首页/);
});

test('render_task_center can prefer task center state snapshot', () => {
  const tempDir = makeTempDir('interactive-image-batch-task-center-state-file-');
  const rootDir = path.join(tempDir, 'runs');
  const outputDir = path.join(rootDir, 'demo_run');
  fs.mkdirSync(outputDir, { recursive: true });

  const indexFile = path.join(rootDir, 'daoge_run_index.json');
  const outputFile = path.join(rootDir, 'task_center.html');
  const stateFile = path.join(rootDir, 'task_center_state.json');
  const workspaceHomeFile = path.join(outputDir, 'workspace_home.html');

  fs.writeFileSync(workspaceHomeFile, '<html>workspace</html>');
  fs.writeFileSync(indexFile, JSON.stringify([
    {
      outputDir,
      generatedAt: '2026-05-20T10:30:00.000Z',
      selectedCount: 8,
      success: 6,
      failed: 1,
      batchCount: 3,
    },
  ], null, 2));
  fs.writeFileSync(stateFile, JSON.stringify({
    schemaVersion: 1,
    kind: 'daoge-task-center-state',
    role: 'task-center-derived-state',
    generatedAt: '2026-05-25T10:00:00.000Z',
    rootDir,
    runs: [
      {
        outputDir,
        generatedAt: '2026-05-20T10:30:00.000Z',
        taskLabel: '状态文件总控任务',
        phaseLabel: '结果阶段',
        phaseSummary: '状态文件总控摘要',
        phaseTone: 'good',
        nextActionLabel: '进入结果工作台',
        nextActionReason: '状态文件总控建议先回结果层继续。',
        successCount: 6,
        failedCount: 1,
        reviewCount: 1,
        selectedCount: 8,
      },
    ],
    latest: {
      outputDir,
      generatedAt: '2026-05-20T10:30:00.000Z',
      taskLabel: '状态文件总控任务',
      phaseLabel: '结果阶段',
      phaseSummary: '状态文件总控摘要',
      phaseTone: 'good',
      nextActionLabel: '进入结果工作台',
      nextActionReason: '状态文件总控建议先回结果层继续。',
      successCount: 6,
      failedCount: 1,
      reviewCount: 1,
      selectedCount: 8,
    },
    latestWorkspace: workspaceHomeFile,
    liveRun: {
      outputDir,
      taskLabel: '状态文件总控任务',
      currentStatus: 'running',
      currentStage: '正式阶段 1',
      currentBatch: 2,
      completedBatchCount: 1,
      pendingBatchCount: 1,
      totalBatchCount: 2,
      progressSummary: '已完成 1/2 批，当前执行第 2 批；成功 6，失败 1。',
      runningTask: '状态文件总控任务',
      nextSuggestedAction: {
        label: '进入当前任务',
        reason: '当前执行中，工作台会持续刷新进度。',
        target: workspaceHomeFile,
      },
      dialogueStatus: {
        primarySay: '继续，先盯住当前进度',
      },
      liveCopilotDirective: {
        currentStatus: 'running',
        taskLabel: '状态文件总控任务',
        progressSummary: '实时副驾驶进度覆盖旧进度。',
        nextActionLabel: '按实时副驾驶行动',
        nextActionSummary: '实时副驾驶行动说明覆盖旧下一步。',
        recommendedReply: '继续，按实时副驾驶推进',
        nextAction: {
          label: '按实时副驾驶行动',
          reason: '实时副驾驶行动说明覆盖旧下一步。',
          target: workspaceHomeFile,
        },
      },
    },
    currentStatus: 'running',
    currentStage: '正式阶段 1',
    currentBatch: 2,
    completedBatchCount: 1,
    pendingBatchCount: 1,
    totalBatchCount: 2,
    progressSummary: '已完成 1/2 批，当前执行第 2 批；成功 6，失败 1。',
    runningTask: '状态文件总控任务',
    nextSuggestedAction: {
      label: '进入当前任务',
      reason: '当前执行中，工作台会持续刷新进度。',
      target: workspaceHomeFile,
    },
    examplesCatalogPath: path.join(skillRoot, 'references', 'examples', 'examples_catalog.html'),
    stableCount: 0,
    issueCount: 1,
    activeCount: 1,
    totalRuns: 1,
    otherRuns: [],
    taskCenterWorkbench: {
      title: '当前要做什么',
      copy: '状态文件总控说明',
      cards: [
        {
          label: '继续当前任务',
          value: '状态文件总控任务',
          summary: '结果阶段 · 状态文件总控建议先回结果层继续。',
          file: workspaceHomeFile,
          cta: '进入这轮任务',
          tone: 'good',
        },
      ],
    },
    markdownLines: ['# 状态文件任务索引'],
  }, null, 2));

  runNode('render_task_center.js', [
    '--index-file', indexFile,
    '--output-file', outputFile,
    '--state-file', stateFile,
  ]);

  const html = fs.readFileSync(outputFile, 'utf8');
  assert.match(html, /状态文件总控任务/);
  assert.match(html, /状态文件总控建议先回结果层继续/);
  assert.match(html, /状态文件总控说明/);
  assert.match(html, /入口主链提醒/);
  assert.match(html, /任务总控只负责两件事/);
  assert.match(html, /任务进行中/);
  assert.match(html, /实时副驾驶进度覆盖旧进度/);
  assert.doesNotMatch(html, /已完成 1\/2 批，当前执行第 2 批/);
  assert.match(html, /现在先做/);
  assert.match(html, /按实时副驾驶行动/);
  assert.match(html, /实时副驾驶行动说明覆盖旧下一步/);
  assert.match(html, /回到对话框直接说/);
  assert.match(html, /继续，按实时副驾驶推进/);
  assert.match(html, /默认生成策略/);
  assert.match(html, /默认隐藏:/);
  assert.match(html, /review_board\.html/);
});

test('render_run_index reuses task center state language', () => {
  const tempDir = makeTempDir('interactive-image-batch-run-index-state-');
  const rootDir = path.join(tempDir, 'runs');
  const outputDir = path.join(rootDir, 'sample_preview_round1');
  fs.mkdirSync(outputDir, { recursive: true });

  const indexFile = path.join(rootDir, 'daoge_run_index.json');
  const markdownFile = path.join(rootDir, 'daoge_run_index.md');
  fs.writeFileSync(indexFile, JSON.stringify([
    {
      outputDir,
      generatedAt: '2026-05-20T09:00:00.000Z',
      success: 2,
      failed: 0,
      selectedCount: 4,
      sampleSize: 2,
      pauseReason: 'sample_stage_completed_review_required',
    },
  ], null, 2));
  fs.writeFileSync(path.join(outputDir, 'prompts.generated.json'), JSON.stringify([
    { title: 'Shot 02 米姐开场 Sample', board_id: 'mijie-semiconductor-v2-board-a' },
    { title: 'Shot 06 周期答案 Sample', board_id: 'mijie-semiconductor-v2-board-a' },
  ], null, 2));

  runNode('render_run_index.js', [
    '--index-file', indexFile,
    '--markdown-file', markdownFile,
  ]);

  const markdown = fs.readFileSync(markdownFile, 'utf8');
  assert.match(markdown, /最近记录轮数: 1/);
  assert.match(markdown, /最近一轮: A 段整板 抽样预览（4 张）/);
  assert.match(markdown, /## 2\. 入口主链协议/);
  assert.match(markdown, /任务总控职责:/);
  assert.match(markdown, /单轮判断归属:/);
  assert.match(markdown, /实时副驾驶:/);
  assert.match(markdown, /默认生成模式: mainline-only/);
  assert.match(markdown, /默认生成入口: .*workspace_home\.html/);
  assert.match(markdown, /默认隐藏高级页: .*prompt_preview\.html/);
  assert.match(markdown, /默认隐藏高级页: .*review_board\.html/);
  assert.match(markdown, /生成守卫: .*必须按需开启/);
  assert.match(markdown, /A 段整板 抽样预览（4 张）/);
  assert.match(markdown, /整体稳定/);
});

test('render_run_index can prefer task center state snapshot', () => {
  const tempDir = makeTempDir('interactive-image-batch-run-index-state-file-');
  const rootDir = path.join(tempDir, 'runs');
  const outputDir = path.join(rootDir, 'demo_run');
  fs.mkdirSync(outputDir, { recursive: true });

  const indexFile = path.join(rootDir, 'daoge_run_index.json');
  const markdownFile = path.join(rootDir, 'daoge_run_index.md');
  const stateFile = path.join(rootDir, 'task_center_state.json');
  fs.writeFileSync(indexFile, JSON.stringify([
    {
      outputDir,
      generatedAt: '2026-05-20T09:00:00.000Z',
      success: 0,
      failed: 0,
      selectedCount: 0,
    },
  ], null, 2));
  fs.writeFileSync(stateFile, JSON.stringify({
    schemaVersion: 1,
    kind: 'daoge-task-center-state',
    role: 'task-center-derived-state',
    generatedAt: '2026-05-25T10:00:00.000Z',
    rootDir,
    runs: [],
    latest: {
      outputDir,
      generatedAt: '2026-05-20T09:00:00.000Z',
      taskLabel: '状态文件索引任务',
    },
    latestWorkspace: path.join(outputDir, 'workspace_home.html'),
    examplesCatalogPath: path.join(skillRoot, 'references', 'examples', 'examples_catalog.html'),
    stableCount: 1,
    issueCount: 0,
    activeCount: 1,
    totalRuns: 1,
    otherRuns: [],
    taskCenterWorkbench: null,
    markdownLines: [
      '# DAOGE 任务索引',
      '',
      '- 最近记录轮数: 1',
      '- 最近一轮: 状态文件索引任务',
    ],
  }, null, 2));

  runNode('render_run_index.js', [
    '--index-file', indexFile,
    '--markdown-file', markdownFile,
    '--state-file', stateFile,
  ]);

  const markdown = fs.readFileSync(markdownFile, 'utf8');
  assert.match(markdown, /状态文件索引任务/);
  assert.match(markdown, /## 2\. 入口主链协议/);
  assert.match(markdown, /默认生成模式: mainline-only/);
  assert.match(markdown, /默认隐藏高级页: .*review_board\.html/);
  assert.doesNotMatch(markdown, /- 最近记录轮数: 1\n- 最近一轮: 状态文件索引任务\n$/);
});

test('loadTaskCenterState prefers unified task center live state when available', () => {
  const tempDir = makeTempDir('interactive-image-batch-task-center-unified-preferred-');
  const rootDir = path.join(tempDir, 'runs');
  fs.mkdirSync(rootDir, { recursive: true });

  const indexFile = path.join(rootDir, 'daoge_run_index.json');
  const derivedStateFile = path.join(rootDir, 'task_center_state.json');
  const unifiedStateFile = path.join(rootDir, 'task_center_live_state.json');

  fs.writeFileSync(indexFile, JSON.stringify([], null, 2));
  fs.writeFileSync(derivedStateFile, JSON.stringify({
    schemaVersion: 1,
    kind: 'daoge-task-center-state',
    role: 'task-center-derived-state',
    latest: {
      taskLabel: '旧总控快照任务',
    },
    currentStatus: 'planned',
  }, null, 2));
  fs.writeFileSync(unifiedStateFile, JSON.stringify({
    schemaVersion: 1,
    kind: 'daoge-task-center-state',
    role: 'task-center-derived-state',
    latest: {
      taskLabel: '统一总控出口任务',
    },
    currentStatus: 'running',
    progressSummary: '统一总控出口已经接管状态读取。',
  }, null, 2));

  const loaded = buildTaskCenterState(indexFile);
  assert.equal(loaded.currentStatus, null);
  const { loadTaskCenterState } = require('../scripts/task_center_state_shared');
  const snapshot = loadTaskCenterState(indexFile);
  assert.equal(snapshot.latest?.taskLabel, '统一总控出口任务');
  assert.equal(snapshot.currentStatus, 'running');
  assert.match(String(snapshot.progressSummary || ''), /统一总控出口已经接管状态读取/);
});

test('refreshTaskCenterRuntimeState writes running paused and completed live state', () => {
  const tempDir = makeTempDir('interactive-image-batch-task-center-live-');
  const rootDir = path.join(tempDir, 'runs');
  const outputDir = path.join(rootDir, 'board_a_live');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'workspace', 'workspace_home.html'), '<html>workspace mirror</html>');
  fs.writeFileSync(path.join(outputDir, 'workspace', 'result_workspace.html'), '<html>result mirror</html>');
  fs.writeFileSync(path.join(outputDir, 'workspace', 'exception_workspace.html'), '<html>exception mirror</html>');

  fs.writeFileSync(path.join(outputDir, 'prompts.generated.json'), JSON.stringify([
    { title: 'Shot 02 米姐开场 Sample', board_id: 'mijie-semiconductor-v2-board-a' },
    { title: 'Shot 06 周期答案 Sample', board_id: 'mijie-semiconductor-v2-board-a' },
  ], null, 2));
  fs.writeFileSync(path.join(outputDir, 'stage_plan.json'), JSON.stringify({
    totalPrompts: 2,
    batchSize: 1,
    sampleSize: 0,
    stageCount: 1,
    batchCount: 2,
    stages: [
      {
        stageNumber: 1,
        type: 'production',
        promptCount: 2,
        batchCount: 2,
        batches: [
          { batchNumber: 1, promptCount: 1, firstIndex: 1, lastIndex: 1 },
          { batchNumber: 2, promptCount: 1, firstIndex: 2, lastIndex: 2 },
        ],
      },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(rootDir, 'daoge_run_index.json'), JSON.stringify([], null, 2));

  const runningState = {
    jobId: 'board_a_live',
    outputDir,
    status: 'running',
    createdAt: '2026-05-26T08:00:00.000Z',
    updatedAt: '2026-05-26T08:01:00.000Z',
    selectedCount: 2,
    sampleSize: 0,
    progress: {
      completedBatches: 1,
      totalBatches: 2,
      completedPrompts: 1,
      success: 1,
      failed: 0,
      skipped: 0,
      currentStage: 1,
      currentBatch: 2,
    },
    pauseReason: null,
  };
  fs.writeFileSync(path.join(outputDir, 'job_state.json'), JSON.stringify(runningState, null, 2));
  fs.writeFileSync(path.join(outputDir, 'checkpoint.json'), JSON.stringify({
    writtenAt: '2026-05-26T08:01:00.000Z',
    latestBatch: { batchNumber: 1 },
  }, null, 2));

  let result = refreshTaskCenterRuntimeState(outputDir, {
    renderOutputs: false,
  });
  assert.equal(fs.existsSync(result.statePath), true);
  assert.equal(fs.existsSync(result.unifiedStatePath), true);
  let snapshot = JSON.parse(fs.readFileSync(result.statePath, 'utf8'));
  let unifiedSnapshot = JSON.parse(fs.readFileSync(result.unifiedStatePath, 'utf8'));
  assert.equal(snapshot.currentStatus, 'running');
  assert.equal(unifiedSnapshot.currentStatus, 'running');
  assert.equal(snapshot.liveRun.currentBatch, 2);
  assert.equal(snapshot.dialogueStatus?.primarySay, '继续，先盯住当前进度');
  assert.equal(snapshot.liveRun.dialogueStatus?.primarySay, '继续，先盯住当前进度');
  assert.equal(snapshot.runtimeWorkflow?.currentStatus, 'running');
  assert.equal(snapshot.nextSuggestedAction?.target, path.join(outputDir, 'workspace', 'workspace_home.html'));
  assert.equal(snapshot.runtimeWorkflow?.nextAction?.target, path.join(outputDir, 'workspace', 'workspace_home.html'));
  assert.equal(snapshot.unifiedStatus?.nextAction?.target, path.join(outputDir, 'workspace', 'workspace_home.html'));
  assert.equal(snapshot.workflowDialogue?.primarySay, '继续，先盯住当前进度');
  assert.equal(snapshot.runtimeCopilotProtocol?.cadenceLabel, '运行中');
  assert.match(String(snapshot.runtimeCopilotProtocol?.userFocus || ''), /先看进度/);
  assert.equal(snapshot.runtimeCopilotProtocol?.handoffState?.branch, 'running');
  assert.equal(snapshot.runtimeCopilotProtocol?.handoffState?.primarySurface, 'workspace_live_state.json');
  assert.match(String(snapshot.runtimeCopilotProtocol?.handoffState?.nextStep || ''), /完成、暂停或确认状态分流/);
  assert.equal(snapshot.entryMainlineGuide?.runtimeMode, 'running');
  assert.match(String(snapshot.entryMainlineGuide?.runtimeFocus || ''), /先看进度/);
  assert.match(JSON.stringify(snapshot.entryMainlineGuide?.items || []), /先看实时进度/);
  assert.match(JSON.stringify(snapshot.entryMainlineGuide?.items || []), /继续，先盯住当前进度/);
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.summary || ''), /实时副驾驶/);
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.watch || ''), /先看实时进度/);
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.reply || ''), /继续，先盯住当前进度/);
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.handoff || ''), /完成、暂停或等待确认后/);
  assert.equal(snapshot.entryMainlineGuide?.copilotRelay?.generationMode, 'mainline-only');
  assert.equal(snapshot.entryMainlineGuide?.copilotRelay?.generationLabel, '主链极简模式');
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.generationRule || ''), /顺着主链继续/);
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.deepDiveRule || ''), /补充页/);
  assert.equal(snapshot.entryMainlineGuide?.defaultGenerationProtocol?.mode, 'mainline-only');
  assert.match(String(snapshot.entryMainlineGuide?.defaultGenerationProtocol?.guardrail?.onDemandRule || ''), /必须按需开启/);
  assert.match(
    JSON.stringify(snapshot.entryMainlineGuide?.defaultGenerationProtocol?.hiddenHtmlFiles || []),
    /review_board\.html/
  );
  assert.equal(snapshot.entryMainlineGuide?.generationContract?.targetMode, 'single-workbench-mainline');
  assert.match(
    JSON.stringify(snapshot.entryMainlineGuide?.generationContract?.currentMode?.hiddenHtmlFiles || []),
    /result_hub\.html/
  );
  assert.equal(snapshot.entryMainlineGuide?.copilotRelay?.defaultGenerationProtocol?.mode, 'mainline-only');
  assert.match(
    JSON.stringify(snapshot.entryMainlineGuide?.copilotRelay?.generationContract?.currentMode?.generatedHtmlFiles || []),
    /workspace_home\.html/
  );
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.summary || ''), /当前是主链极简模式/);
  assert.match(snapshot.progressSummary, /已完成 1\/2 批/);
  assert.match(snapshot.latest.phaseLabel, /执行中/);
  assert.match(snapshot.latest.nextActionReason, /工作台会持续刷新进度/);
  assert.equal(unifiedSnapshot.stateSources?.unifiedState, path.join(rootDir, 'task_center_live_state.json'));
  assert.equal(unifiedSnapshot.stateSources?.canonicalState, path.join(rootDir, 'task_center_state.json'));
  assert.equal(unifiedSnapshot.workbenchProtocol?.stateSources?.taskCenterUnifiedState, path.join(rootDir, 'task_center_live_state.json'));
  assert.match(String(unifiedSnapshot.workbenchProtocol?.stateSourceSummary || ''), /入口主链提醒和运行态副驾驶交接/);
  assert.equal(unifiedSnapshot.workbenchProtocol?.taskCenterEntryProtocol?.entryGuideKey, 'entryMainlineGuide');

  const pausedState = {
    ...runningState,
    status: 'paused',
    updatedAt: '2026-05-26T08:02:00.000Z',
    pauseReason: 'sample_stage_completed_review_required',
  };
  fs.writeFileSync(path.join(outputDir, 'job_state.json'), JSON.stringify(pausedState, null, 2));
  result = refreshTaskCenterRuntimeState(outputDir, {
    renderOutputs: false,
  });
  snapshot = JSON.parse(fs.readFileSync(result.statePath, 'utf8'));
  unifiedSnapshot = JSON.parse(fs.readFileSync(result.unifiedStatePath, 'utf8'));
  assert.equal(snapshot.currentStatus, 'paused');
  assert.equal(unifiedSnapshot.currentStatus, 'paused');
  assert.match(snapshot.latest.phaseLabel, /暂停待处理/);
  assert.match(snapshot.progressSummary, /任务已暂停/);
  assert.match(snapshot.nextSuggestedAction.reason, /等待人工复核/);
  assert.equal(snapshot.nextSuggestedAction?.target, path.join(outputDir, 'workspace', 'exception_workspace.html'));
  assert.equal(snapshot.runtimeWorkflow?.nextAction?.target, path.join(outputDir, 'workspace', 'exception_workspace.html'));
  assert.equal(snapshot.unifiedStatus?.nextAction?.target, path.join(outputDir, 'workspace', 'exception_workspace.html'));
  assert.equal(snapshot.runtimeCopilotProtocol?.cadenceLabel, '暂停待处理');
  assert.match(String(snapshot.runtimeCopilotProtocol?.handoffRule || ''), /暂停态先把风险收掉/);
  assert.equal(snapshot.runtimeCopilotProtocol?.handoffState?.branch, 'paused');
  assert.equal(snapshot.runtimeCopilotProtocol?.handoffState?.primarySurface, 'exception_workspace.html');
  assert.equal(snapshot.entryMainlineGuide?.runtimeMode, 'paused');
  assert.match(String(snapshot.entryMainlineGuide?.runtimeFocus || ''), /先处理暂停原因/);
  assert.match(JSON.stringify(snapshot.entryMainlineGuide?.items || []), /先看暂停原因/);
  assert.match(JSON.stringify(snapshot.entryMainlineGuide?.items || []), /暂停态先把风险收掉/);
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.watch || ''), /先看暂停原因/);
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.handoff || ''), /处理完暂停原因/);
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.summary || ''), /当前是主链极简模式/);
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.deepDiveRule || ''), /补充页/);

  const completedState = {
    ...runningState,
    status: 'completed',
    updatedAt: '2026-05-26T08:03:00.000Z',
    progress: {
      ...runningState.progress,
      completedBatches: 2,
      completedPrompts: 2,
      currentBatch: 2,
      success: 2,
      failed: 0,
    },
  };
  fs.writeFileSync(path.join(outputDir, 'job_state.json'), JSON.stringify(completedState, null, 2));
  result = refreshTaskCenterRuntimeState(outputDir, {
    renderOutputs: false,
  });
  snapshot = JSON.parse(fs.readFileSync(result.statePath, 'utf8'));
  unifiedSnapshot = JSON.parse(fs.readFileSync(result.unifiedStatePath, 'utf8'));
  assert.equal(snapshot.currentStatus, 'completed');
  assert.equal(unifiedSnapshot.currentStatus, 'completed');
  assert.equal(snapshot.completedBatchCount, 2);
  assert.equal(snapshot.pendingBatchCount, 0);
  assert.match(snapshot.latest.phaseLabel, /已完成/);
  assert.match(snapshot.nextSuggestedAction.label, /进入结果工作台/);
  assert.equal(snapshot.nextSuggestedAction?.target, path.join(outputDir, 'workspace', 'result_workspace.html'));
  assert.equal(snapshot.runtimeWorkflow?.nextAction?.target, path.join(outputDir, 'workspace', 'result_workspace.html'));
  assert.equal(snapshot.unifiedStatus?.nextAction?.target, path.join(outputDir, 'workspace', 'result_workspace.html'));
  assert.equal(snapshot.liveCopilotDirective?.branch, 'completed-clean');
  assert.equal(snapshot.liveCopilotDirective?.recommendedReply, snapshot.workflowDialogue?.primarySay);
  assert.equal(snapshot.liveCopilotDirective?.recommendedReply, snapshot.copilotSummary?.recommendedReply);
  assert.equal(snapshot.liveCopilotDirective?.nextActionSummary, snapshot.runtimeWorkflow?.nextAction?.reason);
  assert.equal(snapshot.liveCopilotDirective?.nextAction?.target, snapshot.nextSuggestedAction?.target);
  assert.equal(unifiedSnapshot.liveCopilotDirective?.recommendedReply, snapshot.liveCopilotDirective?.recommendedReply);
  assert.equal(snapshot.runtimeCopilotProtocol?.cadenceLabel, '已完成');
  assert.match(String(snapshot.runtimeCopilotProtocol?.pageFocus || ''), /结果工作台/);
  assert.equal(snapshot.runtimeCopilotProtocol?.handoffState?.branch, 'completed-clean');
  assert.equal(snapshot.runtimeCopilotProtocol?.handoffState?.primarySurface, 'result_workspace.html');
  assert.equal(snapshot.entryMainlineGuide?.runtimeMode, 'completed');
  assert.match(String(snapshot.entryMainlineGuide?.runtimeFocus || ''), /结果工作台/);
  assert.match(JSON.stringify(snapshot.entryMainlineGuide?.items || []), /进入结果工作台/);
  assert.match(JSON.stringify(snapshot.entryMainlineGuide?.items || []), /完成态由结果工作台接住/);
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.watch || ''), /结果工作台/);
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.handoff || ''), /结果工作台接住/);
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.summary || ''), /当前是主链极简模式/);
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.generationRule || ''), /顺着主链继续/);

  const waitingState = {
    ...runningState,
    status: 'awaiting_confirmation',
    updatedAt: '2026-05-26T08:04:00.000Z',
    pauseReason: 'sample_stage_completed_review_required',
  };
  fs.writeFileSync(path.join(outputDir, 'job_state.json'), JSON.stringify(waitingState, null, 2));
  result = refreshTaskCenterRuntimeState(outputDir, {
    renderOutputs: false,
  });
  snapshot = JSON.parse(fs.readFileSync(result.statePath, 'utf8'));
  assert.equal(snapshot.currentStatus, 'awaiting_confirmation');
  assert.equal(snapshot.nextSuggestedAction?.target, path.join(outputDir, 'workspace', 'workspace_home.html'));
  assert.equal(snapshot.runtimeWorkflow?.nextAction?.target, path.join(outputDir, 'workspace', 'workspace_home.html'));
  assert.equal(snapshot.unifiedStatus?.nextAction?.target, path.join(outputDir, 'workspace', 'workspace_home.html'));
  assert.equal(snapshot.liveCopilotDirective?.branch, 'waiting-confirmation');
  assert.equal(snapshot.liveCopilotDirective?.recommendedReply, snapshot.workflowDialogue?.primarySay);
  assert.equal(snapshot.liveCopilotDirective?.recommendedReply, snapshot.copilotSummary?.recommendedReply);
  assert.equal(snapshot.liveCopilotDirective?.nextActionSummary, snapshot.runtimeWorkflow?.nextAction?.reason);
  assert.equal(snapshot.liveCopilotDirective?.nextAction?.target, snapshot.nextSuggestedAction?.target);
  assert.equal(snapshot.runtimeCopilotProtocol?.cadenceLabel, '等待确认');
  assert.equal(snapshot.runtimeCopilotProtocol?.handoffState?.branch, 'waiting-confirmation');
  assert.equal(snapshot.entryMainlineGuide?.runtimeMode, 'awaiting_confirmation');
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.watch || ''), /确认点/);
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.handoff || ''), /确认完成后/);

  const completedFailedState = {
    ...completedState,
    progress: {
      ...completedState.progress,
      failed: 1,
      success: 1,
    },
  };
  fs.writeFileSync(path.join(outputDir, 'job_state.json'), JSON.stringify(completedFailedState, null, 2));
  result = refreshTaskCenterRuntimeState(outputDir, {
    renderOutputs: false,
  });
  snapshot = JSON.parse(fs.readFileSync(result.statePath, 'utf8'));
  assert.equal(snapshot.currentStatus, 'completed');
  assert.match(snapshot.nextSuggestedAction.label, /异常工作台/);
  assert.equal(snapshot.nextSuggestedAction?.target, path.join(outputDir, 'workspace', 'exception_workspace.html'));
  assert.equal(snapshot.runtimeWorkflow?.nextAction?.target, path.join(outputDir, 'workspace', 'exception_workspace.html'));
  assert.equal(snapshot.unifiedStatus?.nextAction?.target, path.join(outputDir, 'workspace', 'exception_workspace.html'));
  assert.equal(snapshot.liveCopilotDirective?.branch, 'completed-failed');
  assert.equal(snapshot.liveCopilotDirective?.recommendedReply, snapshot.workflowDialogue?.primarySay);
  assert.equal(snapshot.liveCopilotDirective?.recommendedReply, snapshot.copilotSummary?.recommendedReply);
  assert.equal(snapshot.liveCopilotDirective?.nextActionSummary, snapshot.runtimeWorkflow?.nextAction?.reason);
  assert.equal(snapshot.liveCopilotDirective?.nextAction?.target, snapshot.nextSuggestedAction?.target);
  assert.equal(snapshot.runtimeCopilotProtocol?.handoffState?.branch, 'completed-failed');
  assert.equal(snapshot.runtimeCopilotProtocol?.handoffState?.primarySurface, 'exception_workspace.html');
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.watch || ''), /异常工作台/);
  assert.match(String(snapshot.entryMainlineGuide?.copilotRelay?.handoff || ''), /异常工作台先接住失败项/);
});

test('refreshRuntimeWorkbench updates workspace pages for running and paused states', () => {
  const tempDir = makeTempDir('interactive-image-batch-runtime-workbench-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify({
    outputDir,
    runtimeMode: 'local-batch-runner',
    selectedCount: 4,
    promptCount: 4,
    batchCount: 2,
    stageCount: 1,
    success: 0,
    failed: 0,
    paused: false,
    generatedAt: '2026-05-26T09:00:00.000Z',
  }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'job_state.json'), JSON.stringify({
    jobId: 'out',
    outputDir,
    status: 'running',
    createdAt: '2026-05-26T09:00:00.000Z',
    updatedAt: '2026-05-26T09:02:00.000Z',
    selectedCount: 4,
    progress: {
      completedBatches: 1,
      totalBatches: 2,
      completedPrompts: 2,
      success: 2,
      failed: 0,
      skipped: 0,
      currentStage: 1,
      currentBatch: 2,
    },
  }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'prompts.generated.json'), JSON.stringify([
    { title: 'Shot 01 Host opener', board_id: 'board_a_demo' },
    { title: 'Shot 02 Host detail', board_id: 'board_a_demo' },
  ], null, 2));
  fs.writeFileSync(path.join(outputDir, 'batch_plan.json'), JSON.stringify([
    { batchNumber: 1, promptCount: 2 },
    { batchNumber: 2, promptCount: 2 },
  ], null, 2));

  refreshRuntimeWorkbench(outputDir);

  const workspaceState = JSON.parse(fs.readFileSync(path.join(outputDir, 'workspace_state.json'), 'utf8'));
  const runtimeState = JSON.parse(fs.readFileSync(path.join(outputDir, 'runtime_state.json'), 'utf8'));
  const unifiedWorkbenchState = JSON.parse(fs.readFileSync(path.join(outputDir, 'workspace_live_state.json'), 'utf8'));
  const workspaceHome = fs.readFileSync(path.join(outputDir, 'workspace_home.html'), 'utf8');
  const prepareWorkspace = fs.readFileSync(path.join(outputDir, 'prepare_workspace.html'), 'utf8');
  const resultWorkspace = fs.readFileSync(path.join(outputDir, 'result_workspace.html'), 'utf8');

  assert.equal(workspaceState.status.phase, '执行中');
  assert.equal(runtimeState.currentStatus, 'running');
  assert.equal(runtimeState.copilotSummary?.status, 'running');
  assert.equal(runtimeState.copilotSummary?.nextActionLabel, '打开当前任务');
  assert.equal(runtimeState.copilotSummary?.recommendedReply, '继续，先盯住当前进度');
  assert.equal(runtimeState.liveCopilotDirective?.branch, 'running');
  assert.equal(runtimeState.liveCopilotDirective?.recommendedReply, runtimeState.workflowDialogue?.primarySay);
  assert.equal(runtimeState.liveCopilotDirective?.recommendedReply, runtimeState.copilotSummary?.recommendedReply);
  assert.equal(runtimeState.liveCopilotDirective?.nextActionSummary, runtimeState.runtimeWorkflow?.nextAction?.reason);
  assert.equal(runtimeState.liveCopilotDirective?.nextAction?.target, runtimeState.nextSuggestedAction?.target);
  assert.equal(workspaceState.liveCopilotDirective?.recommendedReply, runtimeState.liveCopilotDirective?.recommendedReply);
  assert.equal(workspaceState.unifiedStatus?.recommendedReply, runtimeState.liveCopilotDirective?.recommendedReply);
  assert.equal(unifiedWorkbenchState.kind, 'daoge-workbench-state');
  assert.equal(unifiedWorkbenchState.stateSources?.unifiedState, path.join(outputDir, 'workspace_live_state.json'));
  assert.match(runtimeState.progressSummary, /已完成 1\/2 批/);
  assert.equal(runtimeState.dialogueStatus?.title, '对话协同');
  assert.equal(runtimeState.dialogueStatus?.primarySay, '继续，先盯住当前进度');
  assert.match(String(runtimeState.dialogueStatus?.actionReason || ''), /第 2 批|进度/);
  assert.equal(workspaceState.unifiedStatus?.dialogue?.primarySay, runtimeState.workflowDialogue?.primarySay);
  assert.equal(workspaceState.status.summary, runtimeState.phaseSummary);
  assert.match(workspaceState.status.headline, /第 2 批/);
  assert.match(workspaceState.nextAction.reason, /工作台会持续刷新/);
  assert.equal(workspaceState.nextAction.target, 'workspace_home.html');
  assert.match(workspaceHome, /执行中/);
  assert.match(workspaceHome, /当前正在执行第 2 批/);
  assert.match(workspaceHome, /继续，先盯住当前进度/);
  assert.doesNotMatch(workspaceHome, /这批跑完后提醒我/);
  assert.match(prepareWorkspace, /执行中|当前正在执行第 2 批/);
  assert.match(prepareWorkspace, /继续，先盯住当前进度/);
  assert.match(resultWorkspace, /执行中|当前正在执行第 2 批/);
  assert.match(resultWorkspace, /继续，先盯住当前进度/);

  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify({
    outputDir,
    runtimeMode: 'local-batch-runner',
    selectedCount: 4,
    promptCount: 4,
    batchCount: 2,
    stageCount: 1,
    success: 2,
    failed: 0,
    paused: true,
    pauseReason: 'sample_stage_completed_review_required',
    generatedAt: '2026-05-26T09:00:00.000Z',
  }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'job_state.json'), JSON.stringify({
    jobId: 'out',
    outputDir,
    status: 'paused',
    createdAt: '2026-05-26T09:00:00.000Z',
    updatedAt: '2026-05-26T09:03:00.000Z',
    selectedCount: 4,
    pauseReason: 'sample_stage_completed_review_required',
    progress: {
      completedBatches: 1,
      totalBatches: 2,
      completedPrompts: 2,
      success: 2,
      failed: 0,
      skipped: 0,
      currentStage: 1,
      currentBatch: 2,
    },
  }, null, 2));

  refreshRuntimeWorkbench(outputDir);

  const pausedState = JSON.parse(fs.readFileSync(path.join(outputDir, 'workspace_state.json'), 'utf8'));
  const pausedRuntimeState = JSON.parse(fs.readFileSync(path.join(outputDir, 'runtime_state.json'), 'utf8'));
  const pausedPrepare = fs.readFileSync(path.join(outputDir, 'prepare_workspace.html'), 'utf8');
  const pausedException = fs.readFileSync(path.join(outputDir, 'exception_workspace.html'), 'utf8');
  assert.equal(pausedState.status.phase, '异常阶段');
  assert.equal(pausedRuntimeState.currentStatus, 'paused');
  assert.equal(pausedRuntimeState.liveCopilotDirective?.branch, 'paused');
  assert.equal(pausedRuntimeState.liveCopilotDirective?.recommendedReply, pausedRuntimeState.workflowDialogue?.primarySay);
  assert.equal(pausedState.liveCopilotDirective?.recommendedReply, pausedRuntimeState.liveCopilotDirective?.recommendedReply);
  assert.equal(pausedState.unifiedStatus?.recommendedReply, pausedRuntimeState.liveCopilotDirective?.recommendedReply);
  assert.equal(pausedState.status.summary, pausedRuntimeState.phaseSummary);
  assert.match(pausedState.status.summary, /人工复核|继续/);
  assert.match(pausedPrepare, /暂停|风险|确认|复核/);
  assert.match(pausedException, /暂停|风险|异常/);
});

test('writeRuntimeStateSnapshot writes shared runtime state file', () => {
  const tempDir = makeTempDir('interactive-image-batch-runtime-state-file-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify({
    outputDir,
    selectedCount: 3,
    batchCount: 2,
    success: 1,
    failed: 0,
    generatedAt: '2026-05-26T10:00:00.000Z',
  }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'job_state.json'), JSON.stringify({
    jobId: 'out',
    outputDir,
    status: 'running',
    createdAt: '2026-05-26T10:00:00.000Z',
    updatedAt: '2026-05-26T10:01:00.000Z',
    selectedCount: 3,
    progress: {
      completedBatches: 1,
      totalBatches: 2,
      completedPrompts: 2,
      success: 1,
      failed: 0,
      skipped: 0,
      currentStage: 1,
      currentBatch: 2,
    },
  }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'stage_plan.json'), JSON.stringify({
    stages: [
      { stageNumber: 1, type: 'production' },
    ],
  }, null, 2));

  const result = writeRuntimeStateSnapshot(outputDir);
  assert.equal(fs.existsSync(result.outputFile), true);

  const snapshot = JSON.parse(fs.readFileSync(result.outputFile, 'utf8'));
  assert.equal(snapshot.kind, 'daoge-runtime-state');
  assert.equal(snapshot.role, 'shared-runtime-snapshot');
  assert.equal(snapshot.currentStatus, 'running');
  assert.equal(snapshot.unifiedStatus?.stage, '执行中');
  assert.match(String(snapshot.unifiedStatus?.conclusion || ''), /正式阶段 1|推进/);
  assert.match(String(snapshot.unifiedStatus?.currentFocus || ''), /工作台会持续刷新进度|第 2 批/);
  assert.equal(snapshot.unifiedStatus?.nextAction?.label, '打开当前任务');
  assert.equal(snapshot.unifiedStatus?.dialogue?.primarySay, '继续，先盯住当前进度');
  assert.match(snapshot.progressSummary, /当前执行第 2 批/);
  assert.equal(snapshot.runtimeWorkflow?.currentStatus, 'running');
  assert.equal(snapshot.runtimeWorkflow?.stageLabel, '执行中');
  assert.equal(snapshot.runtimeWorkflow?.nextAction?.label, '打开当前任务');
  assert.equal(snapshot.runtimeCopilotProtocol?.cadenceLabel, '运行中');
  assert.match(String(snapshot.runtimeCopilotProtocol?.handoffRule || ''), /运行中由工作台承担观察/);
  assert.equal(snapshot.runtimeCopilotProtocol?.handoffState?.branch, 'running');
  assert.equal(snapshot.runtimeCopilotProtocol?.handoffState?.nextOwner, '实时副驾驶');
  assert.equal(snapshot.dialogueStatus?.title, '对话协同');
  assert.equal(snapshot.dialogueStatus?.primarySay, '继续，先盯住当前进度');
  assert.equal(snapshot.workflowDialogue?.primarySay, '继续，先盯住当前进度');
  assert.equal(snapshot.liveCopilotDirective?.branch, 'running');
  assert.equal(snapshot.liveCopilotDirective?.recommendedReply, snapshot.workflowDialogue?.primarySay);
  assert.equal(snapshot.liveCopilotDirective?.recommendedReply, snapshot.copilotSummary?.recommendedReply);
  assert.equal(snapshot.liveCopilotDirective?.nextActionSummary, snapshot.runtimeWorkflow?.nextAction?.reason);
  assert.equal(snapshot.liveCopilotDirective?.nextAction?.target, snapshot.nextSuggestedAction?.target);
  assert.match(String(snapshot.workflowDialogue?.actionReason || ''), /第 2 批|进度/);
  assert.ok(Array.isArray(snapshot.workflowDialogue?.nextSayItems));
  assert.ok(Array.isArray(snapshot.dialogueStatus?.nextSayItems));
});

test('writeRuntimeStateSnapshot supports awaiting confirmation runtime cadence', () => {
  const tempDir = makeTempDir('interactive-image-batch-runtime-awaiting-confirmation-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'workspace', 'workspace_home.html'), '<html>workspace mirror</html>');

  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify({
    outputDir,
    selectedCount: 3,
    batchCount: 2,
    success: 1,
    failed: 0,
    generatedAt: '2026-05-26T10:00:00.000Z',
  }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'job_state.json'), JSON.stringify({
    jobId: 'out',
    outputDir,
    status: 'awaiting_confirmation',
    createdAt: '2026-05-26T10:00:00.000Z',
    updatedAt: '2026-05-26T10:01:00.000Z',
    selectedCount: 3,
    pauseReason: 'sample_stage_completed_review_required',
    progress: {
      completedBatches: 1,
      totalBatches: 2,
      completedPrompts: 2,
      success: 1,
      failed: 0,
      skipped: 0,
      currentStage: 1,
      currentBatch: 2,
    },
  }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'stage_plan.json'), JSON.stringify({
    stages: [
      { stageNumber: 1, type: 'production' },
    ],
  }, null, 2));

  const result = writeRuntimeStateSnapshot(outputDir);
  const snapshot = JSON.parse(fs.readFileSync(result.outputFile, 'utf8'));
  assert.equal(snapshot.currentStatus, 'awaiting_confirmation');
  assert.match(String(snapshot.phaseLabel || ''), /等待确认/);
  assert.equal(snapshot.dialogueStatus?.primarySay, '继续，我先确认这一步');
  assert.match(String(snapshot.dialogueStatus?.summary || ''), /人工复核|确认/);
  assert.equal(snapshot.nextSuggestedAction?.target, path.join(outputDir, 'workspace', 'workspace_home.html'));
  assert.equal(snapshot.runtimeWorkflow?.nextAction?.target, path.join(outputDir, 'workspace', 'workspace_home.html'));
  assert.equal(snapshot.unifiedStatus?.nextAction?.target, path.join(outputDir, 'workspace', 'workspace_home.html'));
  assert.equal(snapshot.unifiedStatus?.nextAction?.recommendedReply, '继续，我先确认这一步');
  assert.equal(snapshot.liveCopilotDirective?.branch, 'waiting-confirmation');
  assert.equal(snapshot.liveCopilotDirective?.recommendedReply, snapshot.workflowDialogue?.primarySay);
  assert.equal(snapshot.liveCopilotDirective?.recommendedReply, snapshot.copilotSummary?.recommendedReply);
  assert.equal(snapshot.liveCopilotDirective?.nextActionSummary, snapshot.runtimeWorkflow?.nextAction?.reason);
  assert.equal(snapshot.liveCopilotDirective?.nextAction?.target, snapshot.nextSuggestedAction?.target);
  assert.equal(snapshot.runtimeCopilotProtocol?.cadenceLabel, '等待确认');
  assert.match(String(snapshot.runtimeCopilotProtocol?.pageFocus || ''), /确认项|交接/);
  assert.equal(snapshot.runtimeCopilotProtocol?.handoffState?.branch, 'waiting-confirmation');
  assert.equal(snapshot.runtimeCopilotProtocol?.handoffState?.nextOwner, '对话确认');
});

test('writeRuntimeStateSnapshot aligns completed failure runtime language across action and dialogue', () => {
  const tempDir = makeTempDir('interactive-image-batch-runtime-completed-failed-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'workspace', 'exception_workspace.html'), '<html>exception mirror</html>');

  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify({
    outputDir,
    selectedCount: 4,
    batchCount: 2,
    success: 2,
    failed: 1,
    generatedAt: '2026-05-26T10:00:00.000Z',
  }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'job_state.json'), JSON.stringify({
    jobId: 'out',
    outputDir,
    status: 'completed',
    createdAt: '2026-05-26T10:00:00.000Z',
    updatedAt: '2026-05-26T10:03:00.000Z',
    selectedCount: 4,
    progress: {
      completedBatches: 2,
      totalBatches: 2,
      completedPrompts: 4,
      success: 2,
      failed: 1,
      skipped: 0,
      currentStage: 1,
      currentBatch: 2,
    },
  }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'stage_plan.json'), JSON.stringify({
    stages: [
      { stageNumber: 1, type: 'production' },
    ],
  }, null, 2));

  const result = writeRuntimeStateSnapshot(outputDir);
  const snapshot = JSON.parse(fs.readFileSync(result.outputFile, 'utf8'));

  assert.equal(snapshot.currentStatus, 'completed');
  assert.equal(snapshot.nextActionLabel, '进入异常工作台');
  assert.equal(snapshot.nextSuggestedAction?.label, '进入异常工作台');
  assert.equal(snapshot.nextSuggestedAction?.target, path.join(outputDir, 'workspace', 'exception_workspace.html'));
  assert.equal(snapshot.runtimeWorkflow?.nextAction?.target, path.join(outputDir, 'workspace', 'exception_workspace.html'));
  assert.equal(snapshot.unifiedStatus?.nextAction?.target, path.join(outputDir, 'workspace', 'exception_workspace.html'));
  assert.equal(snapshot.dialogueStatus?.primarySay, '继续，先处理异常');
  assert.equal(snapshot.unifiedStatus?.recommendedReply, '继续，先处理异常');
  assert.equal(snapshot.unifiedStatus?.nextAction?.label, '进入异常工作台');
  assert.equal(snapshot.liveCopilotDirective?.branch, 'completed-failed');
  assert.equal(snapshot.liveCopilotDirective?.recommendedReply, snapshot.workflowDialogue?.primarySay);
  assert.equal(snapshot.liveCopilotDirective?.recommendedReply, snapshot.copilotSummary?.recommendedReply);
  assert.equal(snapshot.liveCopilotDirective?.nextActionSummary, snapshot.runtimeWorkflow?.nextAction?.reason);
  assert.equal(snapshot.liveCopilotDirective?.nextAction?.target, snapshot.nextSuggestedAction?.target);
  assert.equal(snapshot.runtimeCopilotProtocol?.cadenceLabel, '已完成');
  assert.match(String(snapshot.runtimeCopilotProtocol?.userFocus || ''), /先处理异常/);
  assert.equal(snapshot.runtimeCopilotProtocol?.handoffState?.branch, 'completed-failed');
  assert.equal(snapshot.runtimeCopilotProtocol?.handoffState?.primarySurface, 'exception_workspace.html');
  assert.match(String(snapshot.nextActionReason || ''), /先收异常再继续会更稳/);
  assert.match(String(snapshot.dialogueStatus?.actionReason || ''), /先收异常再继续会更稳/);
});

test('writeRuntimeStateSnapshot keeps live copilot directive as the single reply source across runtime branches', () => {
  const cases = [
    { name: 'running', status: 'running', failed: 0, expectedBranch: 'running', expectedReply: '继续，先盯住当前进度' },
    { name: 'paused', status: 'paused', failed: 0, pauseReason: 'sample_stage_completed_review_required', expectedBranch: 'paused', expectedReply: '继续，我先处理暂停原因' },
    { name: 'awaiting', status: 'awaiting_confirmation', failed: 0, pauseReason: 'sample_stage_completed_review_required', expectedBranch: 'waiting-confirmation', expectedReply: '继续，我先确认这一步' },
    { name: 'completed-clean', status: 'completed', failed: 0, completedBatches: 2, success: 2, expectedBranch: 'completed-clean', expectedReply: '继续，进入结果工作台' },
    { name: 'completed-failed', status: 'completed', failed: 1, completedBatches: 2, success: 1, expectedBranch: 'completed-failed', expectedReply: '继续，先处理异常' },
  ];

  for (const item of cases) {
    const tempDir = makeTempDir(`interactive-image-batch-runtime-branch-${item.name}-`);
    const outputDir = path.join(tempDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify({
      outputDir,
      selectedCount: 2,
      batchCount: 2,
      success: item.success ?? 1,
      failed: item.failed,
      pauseReason: item.pauseReason || null,
    }, null, 2));
    fs.writeFileSync(path.join(outputDir, 'stage_plan.json'), JSON.stringify({
      stages: [{ stageNumber: 1, type: 'production' }],
    }, null, 2));
    fs.writeFileSync(path.join(outputDir, 'job_state.json'), JSON.stringify({
      jobId: item.name,
      outputDir,
      status: item.status,
      pauseReason: item.pauseReason || null,
      selectedCount: 2,
      progress: {
        completedBatches: item.completedBatches ?? 1,
        totalBatches: 2,
        completedPrompts: item.completedBatches === 2 ? 2 : 1,
        success: item.success ?? 1,
        failed: item.failed,
        skipped: 0,
        currentStage: 1,
        currentBatch: 2,
      },
    }, null, 2));

    const result = writeRuntimeStateSnapshot(outputDir);
    const snapshot = JSON.parse(fs.readFileSync(result.outputFile, 'utf8'));
    const directive = snapshot.liveCopilotDirective || {};
    const reply = item.expectedReply;
    assert.equal(directive.branch, item.expectedBranch);
    assert.equal(directive.recommendedReply, reply);
    assert.equal(directive.primarySay, reply);
    assert.equal(directive.recommendedReply, snapshot.workflowDialogue?.primarySay);
    assert.equal(directive.recommendedReply, snapshot.dialogueStatus?.primarySay);
    assert.equal(directive.recommendedReply, snapshot.copilotSummary?.recommendedReply);
    assert.equal(directive.recommendedReply, snapshot.unifiedStatus?.recommendedReply);
    assert.equal(directive.recommendedReply, snapshot.unifiedStatus?.dialogue?.primarySay);
    assert.equal(directive.recommendedReply, snapshot.unifiedStatus?.nextAction?.recommendedReply);
    assert.equal(directive.nextActionSummary, snapshot.runtimeWorkflow?.nextAction?.reason);
    assert.equal(directive.nextAction?.target, snapshot.nextSuggestedAction?.target);
    assert.match(JSON.stringify(directive.nextSayItems || []), new RegExp(reply));
  }
});

test('workspace contracts include action reply bridge for copilot alignment', () => {
  const tempDir = makeTempDir('interactive-image-batch-contract-action-reply-bridge-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify({
    outputDir,
    runtimeMode: 'local-batch-runner',
    selectedCount: 4,
    promptCount: 4,
    batchCount: 2,
    stageCount: 1,
    success: 0,
    failed: 0,
    paused: false,
    generatedAt: '2026-05-26T09:00:00.000Z',
  }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'prompts.generated.json'), JSON.stringify([
    { title: 'Shot 01 Host opener', board_id: 'board_a_demo' },
    { title: 'Shot 02 Host detail', board_id: 'board_a_demo' },
  ], null, 2));
  fs.writeFileSync(path.join(outputDir, 'batch_plan.json'), JSON.stringify([
    { batchNumber: 1, promptCount: 2 },
    { batchNumber: 2, promptCount: 2 },
  ], null, 2));

  runNode('build_workspace_state.js', [
    '--manifest-file', path.join(outputDir, 'manifest.json'),
    '--output-dir', outputDir,
    '--workspace-state-file', path.join(outputDir, 'workspace_state.json'),
    '--workspace-assets-file', path.join(outputDir, 'workspace_assets.json'),
    '--workspace-timeline-file', path.join(outputDir, 'workspace_timeline.json'),
    '--workbench-state-file', path.join(outputDir, 'workbench_state.json'),
  ]);

  const workspaceState = JSON.parse(fs.readFileSync(path.join(outputDir, 'workspace_state.json'), 'utf8'));
  const homeBridge = workspaceState.workflowContracts?.home?.actionReplyBridge;
  assert.equal(typeof homeBridge, 'object');
  assert.equal(homeBridge.reply, workspaceState.workflowContracts?.home?.dialogue?.recommendedReply);
  assert.equal(homeBridge.actionLabel, workspaceState.workflowContracts?.home?.nextAction?.label);
  const workbenchState = loadWorkbenchState(outputDir).snapshot || {};
  assert.equal(workbenchState.workflowTextProtocol?.home?.source, 'workflowContracts.home');
  assert.equal(
    workbenchState.workflowTextProtocol?.home?.recommendedReply,
    workspaceState.workflowTextProtocol?.home?.recommendedReply
  );
});

test('build_workspace_state preserves runtime mirror targets in mainline contracts', () => {
  const tempDir = makeTempDir('interactive-image-batch-workspace-state-runtime-mirror-target-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(path.join(outputDir, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'workspace', 'workspace_home.html'), '<html>workspace mirror</html>');
  fs.writeFileSync(path.join(outputDir, 'workspace', 'exception_workspace.html'), '<html>exception mirror</html>');
  fs.writeFileSync(path.join(outputDir, 'exception_workspace.html'), '<html>top exception</html>');
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify({
    outputDir,
    runtimeMode: 'local-batch-runner',
    selectedCount: 2,
    promptCount: 2,
    batchCount: 2,
    success: 1,
    failed: 1,
    generatedAt: '2026-05-26T12:00:00.000Z',
  }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'job_state.json'), JSON.stringify({
    jobId: 'out',
    outputDir,
    status: 'paused',
    createdAt: '2026-05-26T12:00:00.000Z',
    updatedAt: '2026-05-26T12:01:00.000Z',
    selectedCount: 2,
    pauseReason: 'sample_stage_completed_review_required',
    progress: {
      completedBatches: 1,
      totalBatches: 2,
      completedPrompts: 1,
      success: 1,
      failed: 1,
      skipped: 0,
      currentStage: 1,
      currentBatch: 2,
    },
  }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'stage_plan.json'), JSON.stringify({
    stages: [
      { stageNumber: 1, type: 'production' },
    ],
  }, null, 2));

  runNode('build_workspace_state.js', [
    '--manifest-file', path.join(outputDir, 'manifest.json'),
    '--output-dir', outputDir,
    '--workspace-state-file', path.join(outputDir, 'workspace_state.json'),
    '--workspace-assets-file', path.join(outputDir, 'workspace_assets.json'),
    '--workspace-timeline-file', path.join(outputDir, 'workspace_timeline.json'),
    '--workbench-state-file', path.join(outputDir, 'workbench_state.json'),
  ]);

  const workspaceState = JSON.parse(fs.readFileSync(path.join(outputDir, 'workspace_state.json'), 'utf8'));
  assert.equal(workspaceState.runtimeSummary?.nextSuggestedAction?.target, path.join(outputDir, 'workspace', 'exception_workspace.html'));
  assert.equal(workspaceState.runtimeWorkflow?.nextAction?.target, path.join(outputDir, 'workspace', 'exception_workspace.html'));
  assert.equal(workspaceState.nextAction?.target, path.join('workspace', 'exception_workspace.html'));
  assert.equal(workspaceState.workflowContracts?.home?.nextAction?.target, path.join(outputDir, 'workspace', 'exception_workspace.html'));
  assert.equal(workspaceState.workflowContracts?.home?.actionReplyBridge?.actionLabel, '先处理暂停原因');
  assert.equal(workspaceState.views?.home?.route?.nextSteps?.[0]?.file, path.join(outputDir, 'workspace', 'exception_workspace.html'));
});

test('loadWorkbenchState keeps runtime summary from runtime_state snapshot', () => {
  const tempDir = makeTempDir('interactive-image-batch-workbench-runtime-summary-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const runtimeStateFile = path.join(outputDir, 'runtime_state.json');
  fs.writeFileSync(runtimeStateFile, JSON.stringify({
    schemaVersion: 1,
    kind: 'daoge-runtime-state',
    role: 'shared-runtime-snapshot',
    outputDir,
    taskLabel: '半导体整板测试',
    currentStatus: 'running',
    currentStage: '正式阶段 1',
    currentBatch: 2,
    completedBatchCount: 1,
    pendingBatchCount: 1,
    totalBatchCount: 2,
    progressSummary: '已完成 1/2 批，当前执行第 2 批。',
    updatedAt: '2026-05-26T11:00:00.000Z',
    runningTask: '半导体整板测试',
    nextSuggestedAction: {
      label: '进入当前任务',
      reason: '当前执行中，继续观察工作台即可。',
      target: path.join(outputDir, 'workspace_home.html'),
    },
  }, null, 2));

  fs.writeFileSync(path.join(outputDir, 'workspace_state.json'), JSON.stringify({
    generatedAt: '2026-05-26T10:59:00.000Z',
    taskLabel: '半导体整板测试',
    mode: 'result',
    runtimeMode: 'local-batch-runner',
    status: {
      phase: '执行中',
    },
  }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'workspace_assets.json'), JSON.stringify({}, null, 2));
  fs.writeFileSync(path.join(outputDir, 'workspace_timeline.json'), JSON.stringify({ events: [] }, null, 2));

  const loaded = loadWorkbenchState(outputDir);
  assert.equal(loaded.pageState.stateSources?.unifiedState, path.join(outputDir, 'workspace_live_state.json'));
  assert.equal(loaded.pageState.stateSources?.runtimeState, runtimeStateFile);
  assert.equal(loaded.pageState.runtimeSummary?.currentStatus, 'running');
  assert.equal(loaded.pageState.runtimeWorkflow?.currentStatus, 'running');
  assert.equal(loaded.pageState.runtimeWorkflow?.nextAction?.label, '进入当前任务');
  assert.equal(loaded.pageState.liveCopilotDirective?.recommendedReply, '继续，先盯住当前进度');
  assert.equal(loaded.pageState.runtimeSummary?.liveCopilotDirective?.recommendedReply, '继续，先盯住当前进度');
  assert.equal(loaded.pageState.liveCopilotDirective?.nextActionSummary, '当前执行中，继续观察工作台即可。');
  assert.equal(loaded.pageState.runtimeSummary?.currentBatch, 2);
  assert.match(String(loaded.pageState.runtimeSummary?.progressSummary || ''), /当前执行第 2 批/);
});

test('loadWorkbenchState prefers unified workspace live state when available', () => {
  const tempDir = makeTempDir('interactive-image-batch-workbench-unified-preferred-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(path.join(outputDir, 'workbench_state.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'daoge-workbench-state',
    role: 'derived-page-snapshot',
    taskLabel: '旧快照任务',
    status: {
      phase: '旧阶段',
    },
  }, null, 2));

  fs.writeFileSync(path.join(outputDir, 'workspace_live_state.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'daoge-workbench-state',
    role: 'derived-page-snapshot',
    taskLabel: '统一出口任务',
    status: {
      phase: '统一阶段',
    },
    stateSources: {
      unifiedState: path.join(outputDir, 'workspace_live_state.json'),
      runtimeState: path.join(outputDir, 'runtime_state.json'),
    },
    runtimeSummary: {
      currentStatus: 'completed',
      progressSummary: '统一出口已经接管状态读取。',
    },
  }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'workspace_assets.json'), JSON.stringify({
    assetCollections: {
      userFacing: {
        preview: [{ title: '统一出口预览图' }],
        result: [{ title: '统一出口结果图' }],
        review: [],
        exception: [],
        reference: [],
      },
      system: {
        keyFiles: {},
      },
    },
    summary: {
      previewCount: 1,
      resultCount: 1,
      reviewCount: 0,
      exceptionCount: 0,
      referenceCount: 0,
    },
  }, null, 2));

  const loaded = loadWorkbenchState(outputDir);
  assert.equal(loaded.pageState.taskLabel, '统一出口任务');
  assert.equal(loaded.pageState.status?.phase, '统一阶段');
  assert.equal(loaded.pageState.runtimeSummary?.currentStatus, 'completed');
  assert.equal(loaded.pageState.liveCopilotDirective?.recommendedReply, '继续，进入结果工作台');
  assert.equal(loaded.workspaceAssets.assetCollections?.userFacing?.preview?.[0]?.title, '统一出口预览图');
  assert.equal(loaded.workspaceAssets.assetCollections?.userFacing?.result?.[0]?.title, '统一出口结果图');
});

test('loadWorkbenchState backfills risk and confirmation state from canonical workspace state', () => {
  const tempDir = makeTempDir('interactive-image-batch-workbench-core-decision-backfill-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(path.join(outputDir, 'workspace_state.json'), JSON.stringify({
    generatedAt: '2026-05-28T09:00:00.000Z',
    taskLabel: '统一状态回填测试',
    risk: {
      hasIssue: true,
      summary: '当前存在待复核项，建议先确认后再继续。',
    },
    confirmationState: {
      stageLabel: '结果阶段',
      canContinue: false,
      recommendedReply: '继续，先处理待复核项',
      summary: '还有待复核项没有确认，不建议直接收口。',
    },
  }, null, 2));

  fs.writeFileSync(path.join(outputDir, 'workspace_assets.json'), JSON.stringify({}, null, 2));
  fs.writeFileSync(path.join(outputDir, 'workspace_timeline.json'), JSON.stringify({ events: [] }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'workspace_live_state.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'daoge-workbench-state',
    role: 'live-workbench-state',
    taskLabel: '统一状态回填测试',
    risk: {},
    confirmationState: {},
    stateSources: {
      unifiedState: path.join(outputDir, 'workspace_live_state.json'),
      canonicalState: path.join(outputDir, 'workspace_state.json'),
      runtimeState: path.join(outputDir, 'runtime_state.json'),
    },
  }, null, 2));

  const loaded = loadWorkbenchState(outputDir);
  assert.equal(loaded.pageState.risk?.hasIssue, true);
  assert.equal(loaded.pageState.risk?.summary, '当前存在待复核项，建议先确认后再继续。');
  assert.equal(loaded.pageState.confirmationState?.stageLabel, '结果阶段');
  assert.equal(loaded.pageState.confirmationState?.canContinue, false);
  assert.equal(loaded.pageState.confirmationState?.recommendedReply, '继续，先处理待复核项');
  assert.match(String(loaded.pageState.confirmationState?.summary || ''), /待复核项/);
});

test('loadWorkbenchState backfills status counts and next action from canonical workspace state', () => {
  const tempDir = makeTempDir('interactive-image-batch-workbench-runtime-backfill-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(path.join(outputDir, 'workspace_state.json'), JSON.stringify({
    generatedAt: '2026-05-28T09:10:00.000Z',
    taskLabel: '主链状态回填测试',
    status: {
      phase: '结果阶段',
      tone: 'good',
      summary: '结果已经稳定，可以继续筛图收口。',
    },
    counts: {
      selected: 12,
      success: 8,
      failed: 1,
      needsReview: 3,
      batches: 4,
      stages: 2,
    },
    nextAction: {
      label: '进入结果工作台',
      reason: '当前应该先做结果取舍，再决定是否回整板复核。',
      target: 'result_workspace.html',
    },
  }, null, 2));

  fs.writeFileSync(path.join(outputDir, 'workspace_assets.json'), JSON.stringify({}, null, 2));
  fs.writeFileSync(path.join(outputDir, 'workspace_timeline.json'), JSON.stringify({ events: [] }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'workspace_live_state.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'daoge-workbench-state',
    role: 'live-workbench-state',
    taskLabel: '主链状态回填测试',
    status: {},
    counts: {},
    nextAction: {},
    stateSources: {
      unifiedState: path.join(outputDir, 'workspace_live_state.json'),
      canonicalState: path.join(outputDir, 'workspace_state.json'),
      runtimeState: path.join(outputDir, 'runtime_state.json'),
    },
  }, null, 2));

  const loaded = loadWorkbenchState(outputDir);
  assert.equal(loaded.pageState.status?.phase, '结果阶段');
  assert.equal(loaded.pageState.status?.tone, 'good');
  assert.match(String(loaded.pageState.status?.summary || ''), /结果已经稳定/);
  assert.equal(loaded.pageState.counts?.selected, 12);
  assert.equal(loaded.pageState.counts?.success, 8);
  assert.equal(loaded.pageState.counts?.failed, 1);
  assert.equal(loaded.pageState.counts?.needsReview, 3);
  assert.equal(loaded.pageState.counts?.batches, 4);
  assert.equal(loaded.pageState.counts?.stages, 2);
  assert.equal(loaded.pageState.nextAction?.label, '进入结果工作台');
  assert.equal(loaded.pageState.nextAction?.target, 'result_workspace.html');
  assert.match(String(loaded.pageState.nextAction?.reason || ''), /结果取舍/);
});

test('loadWorkbenchState keeps canonical asset collections without flat mirrors', () => {
  const tempDir = makeTempDir('interactive-image-batch-workbench-assets-normalize-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(path.join(outputDir, 'workspace_live_state.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'daoge-workbench-state',
    role: 'live-workbench-state',
    taskLabel: '资产标准化测试',
    assets: {
      assetCollections: {
        userFacing: {
          preview: [{ title: '预览图 1', output: path.join(outputDir, 'preview-1.png') }],
          result: [{ title: '结果 1', output: path.join(outputDir, 'result-1.png') }],
          review: [{ title: '待复核 1' }],
          exception: [{ title: '失败项 1', error: 'timeout' }],
          reference: [{ title: '参考图 1', path: path.join(outputDir, 'ref-1.png') }],
        },
        system: {
          keyFiles: {
            manifest: path.join(outputDir, 'manifest.json'),
          },
        },
      },
      summary: {
        previewCount: 1,
        resultCount: 1,
        reviewCount: 1,
        exceptionCount: 1,
        referenceCount: 1,
      },
    },
    timeline: {
      events: [],
    },
  }, null, 2));

  const loaded = loadWorkbenchState(outputDir);
  assert.equal(loaded.workspaceAssets.assetCollections?.userFacing?.preview?.[0]?.title, '预览图 1');
  assert.equal(loaded.workspaceAssets.assetCollections?.userFacing?.result?.[0]?.title, '结果 1');
  assert.equal(loaded.workspaceAssets.assetCollections?.userFacing?.review?.[0]?.title, '待复核 1');
  assert.equal(loaded.workspaceAssets.assetCollections?.userFacing?.exception?.[0]?.title, '失败项 1');
  assert.equal(loaded.workspaceAssets.assetCollections?.userFacing?.reference?.[0]?.title, '参考图 1');
  assert.equal('previewImages' in loaded.workspaceAssets, false);
  assert.equal('resultAssets' in loaded.workspaceAssets, false);
  assert.equal('reviewAssets' in loaded.workspaceAssets, false);
  assert.equal('exceptionItems' in loaded.workspaceAssets, false);
  assert.equal('referenceAssets' in loaded.workspaceAssets, false);
});

test('loadWorkbenchState ignores removed flat asset mirrors', () => {
  const tempDir = makeTempDir('interactive-image-batch-workbench-assets-canonical-first-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(path.join(outputDir, 'workspace_live_state.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'daoge-workbench-state',
    role: 'live-workbench-state',
    taskLabel: '资产优先级测试',
    assets: {
      assetCollections: {
        userFacing: {
          preview: [{ title: '规范预览图', output: path.join(outputDir, 'canonical-preview.png') }],
          result: [{ title: '规范结果图', output: path.join(outputDir, 'canonical-result.png') }],
          review: [{ title: '规范待复核' }],
          exception: [{ title: '规范失败项', error: 'timeout' }],
          reference: [{ title: '规范参考图', path: path.join(outputDir, 'canonical-ref.png') }],
        },
        system: {
          keyFiles: {},
        },
      },
      previewImages: [{ title: '历史预览图' }],
      resultAssets: [{ title: '历史结果图' }],
      reviewAssets: [{ title: '历史待复核' }],
      exceptionItems: [{ title: '历史失败项' }],
      referenceAssets: [{ title: '历史参考图' }],
    },
    timeline: {
      events: [],
    },
  }, null, 2));

  const loaded = loadWorkbenchState(outputDir);
  assert.equal(loaded.workspaceAssets.assetCollections?.userFacing?.preview?.[0]?.title, '规范预览图');
  assert.equal(loaded.workspaceAssets.assetCollections?.userFacing?.result?.[0]?.title, '规范结果图');
  assert.equal(loaded.workspaceAssets.assetCollections?.userFacing?.review?.[0]?.title, '规范待复核');
  assert.equal(loaded.workspaceAssets.assetCollections?.userFacing?.exception?.[0]?.title, '规范失败项');
  assert.equal(loaded.workspaceAssets.assetCollections?.userFacing?.reference?.[0]?.title, '规范参考图');
  assert.equal('previewImages' in loaded.workspaceAssets, false);
  assert.equal('resultAssets' in loaded.workspaceAssets, false);
  assert.equal('reviewAssets' in loaded.workspaceAssets, false);
  assert.equal('exceptionItems' in loaded.workspaceAssets, false);
  assert.equal('referenceAssets' in loaded.workspaceAssets, false);
});

test('buildTaskCenterState prefers shared runtime summary for live run', () => {
  const tempDir = makeTempDir('interactive-image-batch-task-center-runtime-summary-');
  const outputDir = path.join(tempDir, 'run_001');
  fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(path.join(tempDir, 'daoge_run_index.json'), JSON.stringify([
    {
      outputDir,
      generatedAt: '2026-05-26T11:10:00.000Z',
      taskLabel: '旧任务名',
      currentStatus: 'planned',
      progressSummary: '旧进度',
    },
  ], null, 2));
  fs.writeFileSync(path.join(outputDir, 'workbench_state.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'daoge-workbench-state',
    role: 'derived-page-snapshot',
    taskLabel: '用户可读任务名',
    status: {
      phase: '执行中',
      headline: '正式阶段 1 正在推进',
      summary: '当前正在执行第 2 批，建议先等待这一批完成。',
      tone: 'info',
    },
    nextAction: {
      label: '打开当前任务',
      reason: '当前正在执行第 2 批，工作台会持续刷新进度。',
    },
    runtimeSummary: {
      outputDir,
      taskLabel: '用户可读任务名',
      currentStatus: 'running',
      currentStage: '正式阶段 1',
      currentBatch: 2,
      completedBatchCount: 1,
      pendingBatchCount: 1,
      totalBatchCount: 2,
      progressSummary: '已完成 1/2 批，当前执行第 2 批；成功 2，失败 0，已处理 2/4 张。',
      updatedAt: '2026-05-26T11:12:00.000Z',
      runningTask: '用户可读任务名',
      nextSuggestedAction: {
        label: '进入当前任务',
        reason: '工作台会持续刷新进度。',
        target: path.join(outputDir, 'workspace_home.html'),
      },
      sourceFiles: {
        jobState: path.join(outputDir, 'job_state.json'),
      },
    },
    assets: {},
    timeline: { events: [] },
  }, null, 2));

  const state = buildTaskCenterState(path.join(tempDir, 'daoge_run_index.json'));
  assert.equal(state.liveRun?.currentStatus, 'running');
  assert.equal(state.liveRun?.currentBatch, 2);
  assert.equal(state.liveRun?.totalBatchCount, 2);
  assert.match(String(state.liveRun?.progressSummary || ''), /当前执行第 2 批/);
  assert.equal(state.liveRun?.runningTask, '用户可读任务名');
  assert.equal(state.liveRun?.unifiedStatus?.status, 'running');
  assert.equal(state.liveRun?.copilotSummary?.status, 'running');
  assert.equal(state.liveRun?.copilotSummary?.nextActionLabel, '进入当前任务');
  assert.equal(state.liveRun?.copilotSummary?.nextActionSummary, '工作台会持续刷新进度。');
  assert.equal(state.liveRun?.liveCopilotDirective?.recommendedReply, '继续，先盯住当前进度');
  assert.equal(state.liveCopilotDirective?.recommendedReply, '继续，先盯住当前进度');
  assert.equal(state.liveRun?.unifiedStatus?.taskLabel, '用户可读任务名');
  assert.equal(state.liveRun?.unifiedStatus?.nextAction?.label, '进入当前任务');
  assert.match(String(state.liveRun?.unifiedStatus?.progress || ''), /当前执行第 2 批/);
  assert.equal(state.dialogueStatus?.primarySay, '');
  assert.equal(state.liveRun?.runtimeWorkflow?.currentStatus, 'running');
  assert.equal(state.runtimeWorkflow?.taskLabel, '用户可读任务名');
  assert.equal(state.workflowDialogue?.primarySay, '');
  assert.equal(state.copilotSummary?.status, 'running');
  assert.equal(state.copilotSummary?.nextActionLabel, '进入当前任务');
});

test('buildTaskCenterState prefers workspace mirror entry when layout is available', () => {
  const tempDir = makeTempDir('interactive-image-batch-task-center-mirror-entry-');
  const outputDir = path.join(tempDir, 'run_001');
  fs.mkdirSync(path.join(outputDir, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'workspace_home.html'), '<html>top-level workspace</html>');
  fs.writeFileSync(path.join(outputDir, 'workspace', 'workspace_home.html'), '<html>workspace mirror</html>');
  fs.writeFileSync(path.join(tempDir, 'daoge_run_index.json'), JSON.stringify([
    {
      outputDir,
      generatedAt: '2026-05-26T11:10:00.000Z',
      taskLabel: '镜像入口任务',
      success: 2,
      failed: 0,
      selectedCount: 2,
    },
  ], null, 2));

  const state = buildTaskCenterState(path.join(tempDir, 'daoge_run_index.json'));
  const expectedMirrorEntry = path.join(outputDir, 'workspace', 'workspace_home.html');
  assert.equal(state.latestWorkspace, expectedMirrorEntry);
  assert.equal(state.taskCenterWorkbench?.cards?.[0]?.file, expectedMirrorEntry);
  assert.equal(state.entryMainlineGuide?.items?.[0]?.file, expectedMirrorEntry);
  assert.equal(state.entryMainlineGuide?.items?.[1]?.file, expectedMirrorEntry);
  assert.equal(state.entryMainlineGuide?.defaultGenerationProtocol?.mode, 'mainline-only');
  assert.match(
    JSON.stringify(state.entryMainlineGuide?.defaultGenerationProtocol?.hiddenHtmlFiles || []),
    /prompt_preview\.html/
  );
  assert.equal(state.entryMainlineGuide?.generationContract?.currentMode?.mode, 'mainline-only');
  assert.match(
    JSON.stringify(state.entryMainlineGuide?.generationContract?.currentMode?.hiddenHtmlFiles || []),
    /completion_board\.html/
  );

  const { renderRunCardModel } = require('../scripts/task_center_state_shared');
  const card = renderRunCardModel(state.latest, tempDir);
  assert.equal(card.href, path.join('run_001', 'workspace', 'workspace_home.html'));
  assert.equal(card.cta, '继续这轮任务');
});

test('render_workspace_home prefers user-facing task label in context and navigation', () => {
  const tempDir = makeTempDir('interactive-image-batch-workspace-home-label-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const workspaceStateFile = path.join(outputDir, 'workspace_state.json');
  const workspaceAssetsFile = path.join(outputDir, 'workspace_assets.json');
  const workspaceTimelineFile = path.join(outputDir, 'workspace_timeline.json');
  const workspaceHomeFile = path.join(outputDir, 'workspace_home.html');
  const resultWorkspaceFile = path.join(outputDir, 'result_workspace.html');
  const taskCenterFile = path.join(tempDir, 'task_center.html');

  fs.writeFileSync(resultWorkspaceFile, '<html>result</html>');
  fs.writeFileSync(taskCenterFile, '<html>task center</html>');
  fs.writeFileSync(path.join(outputDir, 'prompts.generated.json'), JSON.stringify([
    { title: 'Shot 01 钩子开场', board_id: 'mijie-semiconductor-v2-board-a' },
    { title: 'Shot 02 米姐开场', board_id: 'mijie-semiconductor-v2-board-a' },
  ], null, 2));

  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    selectedCount: 2,
    success: 2,
    failed: 0,
    batchCount: 1,
  }, null, 2));

  fs.writeFileSync(workspaceStateFile, JSON.stringify({
    taskLabel: 'board_A_full',
    status: {
      phase: '结果阶段',
      tone: 'good',
      headline: '结果整体稳定，可以继续收口',
      summary: '建议先进入结果工作台筛图，再决定是否继续。',
    },
    counts: {
      selected: 2,
      success: 2,
      failed: 0,
      needsReview: 0,
      batches: 1,
    },
    nextAction: {
      label: '进入结果工作台',
      reason: '当前已经具备统一结果入口，最适合继续筛图和收口。',
      target: 'result_workspace.html',
    },
    confirmationState: {
      stageLabel: '状态层首页阶段确认',
      canContinue: true,
      hasBlocking: false,
      pendingCount: 1,
      blockingCount: 0,
      confirmedItems: ['状态层首页已确认 1'],
      pendingItems: ['状态层首页待确认 1'],
      blockingItems: [],
      recommendedReply: '继续，进入结果工作台',
      recentEvent: { title: '状态层首页最近事件', summary: '状态层首页最近事件说明' },
      summary: '状态层首页当前可以继续。',
    },
    views: {
      home: {
        hero: {
          eyebrow: '状态层首页眉题',
          title: '状态层首页标题',
          intro: '状态层首页头部说明',
        },
        context: {
          runLabel: '状态层首页任务',
          phaseLabel: '状态层首页阶段',
          flowLabel: '状态层首页流程',
          counts: [{ label: '状态提示词', value: 2 }],
          hints: ['状态层首页提示'],
        },
        heroCards: [
          { label: '状态层阶段卡', value: '首页已接管', tone: 'info', detail: '这是状态层首页指标卡。' },
        ],
        route: {
          title: '现在继续',
          copy: '统一首页路线说明',
          nextSteps: [
            { kicker: '推荐下一步', label: '状态层结果入口', summary: '统一首页已经接管下一步路线。', file: resultWorkspaceFile, cta: '马上进入' },
          ],
        },
        workbench: {
          title: '按需补充',
          copy: '统一首页工作台入口',
          cards: [
            { label: '状态层任务总控', value: '切换任务', summary: '统一首页已接管任务切换入口。', file: taskCenterFile, cta: '回任务总控', tone: 'info' },
          ],
        },
        guides: {
          entryStructure: {
            title: '工作台使用规则',
            copy: '统一首页已经切换到单一工作台规则，补充入口和默认后退。',
            items: [
              { label: '主入口', value: '工作台首页' },
              { label: '主链', value: '4 站连续工作台' },
              { label: '补充入口', value: '默认只保留任务档案' },
            ],
          },
          assetVisibility: {
            title: '这页先看什么',
            copy: '首页只保留你继续推进当前任务最需要的内容。',
            items: [
              { label: '先看', value: '当前阶段、结果入口、异常压力' },
              { label: '按需再看', value: '任务档案、准备工作台（只在需要回看准备判断时）' },
              { label: '先不用看', value: '内部 JSON / Markdown 记录' },
            ],
          },
        },
        assetStatus: {
          title: '状态层首页资产',
          copy: '状态层首页资产说明',
          readyLabel: '状态层已就绪',
          readySummary: '状态层首页资产已可直接使用。',
          pendingLabel: '状态层待确认',
          pendingSummary: '状态层首页当前没有额外待确认资产。',
          items: [
            { label: '状态层首页资产项', value: '首页资产已接管', summary: '状态层首页资产摘要。', tone: 'good' },
          ],
        },
        actionStatus: {
          title: '状态层首页行动',
          copy: '状态层首页行动说明',
          primary: { kicker: '现在先做', title: '状态层首页主动作', summary: '状态层首页先做这一步。', file: resultWorkspaceFile, cta: '先去这里', tone: 'good' },
          secondary: [
            { kicker: '辅助动作', title: '状态层首页辅助动作', summary: '状态层首页辅助动作说明。', file: taskCenterFile, cta: '顺手看看', tone: 'info' },
          ],
          notes: ['状态层首页注意点'],
        },
        dialogueStatus: {
          title: '对话协同',
          copy: '状态层首页对话协同说明',
          recentTitle: '系统刚接住',
          understoodTitle: '系统已理解',
          confirmTitle: '继续前你只要确认',
          nextSayTitle: '回到对话框直接说',
          recentItems: ['状态层首页最近一步'],
          understoodItems: ['状态层首页已理解 1'],
          confirmItems: ['状态层首页待确认 1'],
          nextSayItems: ['继续，进入结果工作台'],
        },
      },
    },
  }, null, 2));

  fs.writeFileSync(workspaceAssetsFile, JSON.stringify({
    assetCollections: {
      userFacing: {
        preview: [],
        result: [],
        review: [],
        exception: [],
        reference: [],
      },
      system: {
        keyFiles: {},
      },
    },
    layers: {
      userFacing: {
        groups: [
          { key: 'result', count: 2 },
          { key: 'preview', count: 2 },
          { key: 'review', count: 0 },
          { key: 'exception', count: 0 },
          { key: 'reference', count: 0 },
        ],
      },
    },
    summary: {
      userFacingCount: 4,
      systemCount: 0,
    },
  }, null, 2));
  fs.writeFileSync(workspaceTimelineFile, JSON.stringify({
    events: [
      { type: 'prepare_completed', title: '状态层首页时间线 1', summary: '状态层首页时间线说明 1', time: '2026-05-20T09:00:00.000Z' },
      { type: 'execution_completed', title: '状态层首页时间线 2', summary: '状态层首页时间线说明 2', time: '2026-05-20T10:00:00.000Z' },
    ],
  }, null, 2));

  runNode('render_workspace_home.js', [
    '--manifest-file', manifestFile,
    '--output-file', workspaceHomeFile,
  ]);

  const html = fs.readFileSync(workspaceHomeFile, 'utf8');
  assert.match(html, /状态层首页眉题/);
  assert.match(html, /状态层首页标题/);
  assert.match(html, /状态层首页头部说明/);
  assert.match(html, /状态层首页任务/);
  assert.match(html, /状态层首页阶段/);
  assert.match(html, /状态层首页流程/);
  assert.match(html, /工作台使用规则/);
  assert.match(html, /工作台使用规则/);
  assert.match(html, /状态提示词 2/);
  assert.match(html, /状态层首页提示/);
  assert.match(html, /状态层首页流程/);
  assert.match(html, /统一首页路线说明|这里只保留一个主跳转/);
  assert.match(html, /状态层阶段卡/);
  assert.match(html, /首页已接管/);
  assert.match(html, /任务总控/);
  assert.match(html, /状态层首页流程/);
  assert.match(html, /状态层结果入口/);
  assert.match(html, /马上进入/);
  assert.match(html, /状态层任务总控/);
  assert.match(html, /回任务总控/);
  assert.match(html, /状态层首页资产/);
  assert.match(html, /状态层首页资产说明/);
  assert.match(html, /状态层首页资产项/);
  assert.match(html, /首页资产已接管/);
  assert.match(html, /推荐下一步/);
  assert.doesNotMatch(html, /状态层首页行动/);
  assert.doesNotMatch(html, /状态层首页行动说明/);
  assert.doesNotMatch(html, /状态层首页主动作/);
  assert.doesNotMatch(html, /备用入口/);
  assert.doesNotMatch(html, /状态层首页辅助动作/);
  assert.doesNotMatch(html, /状态层首页注意点/);
  assert.doesNotMatch(html, /回到对话框直接说/);
  assert.match(html, /复制这句/);
  assert.match(html, /驾驶舱摘要/);
  assert.match(html, /当前重点/);
  assert.doesNotMatch(html, /阶段确认/);
  assert.doesNotMatch(html, /是否可继续/);
  assert.doesNotMatch(html, /已经确认/);
  assert.doesNotMatch(html, /还待确认/);
  assert.match(html, /阻塞情况/);
  assert.match(html, /阶段时间线/);
  assert.match(html, /状态层首页时间线 1/);
  assert.match(html, /状态层首页时间线 2/);
  assert.doesNotMatch(html, /对话协同/);
  assert.doesNotMatch(html, /状态层首页对话协同说明/);
  assert.doesNotMatch(html, /系统刚接住/);
  assert.doesNotMatch(html, /系统已理解/);
  assert.doesNotMatch(html, /回到对话框直接说/);
  assert.match(html, /状态层首页待确认 1/);
  assert.match(html, /继续，进入结果工作台/);
  assert.match(html, /主入口/);
  assert.match(html, /主链/);
  assert.match(html, /补充入口/);
  assert.match(html, /这页先看什么/);
  assert.match(html, /首页只保留你继续推进当前任务最需要的内容/);
  assert.match(html, /统一首页工作台入口|按需再看/);
  assert.match(html, /当前判断/);
  assert.doesNotMatch(html, /为什么当前这样判断|如果暂不处理，主要风险是什么|这一页为什么现在最值得看/);
  assert.doesNotMatch(html, /任务摘要/);
  assert.doesNotMatch(html, /核心摘要/);
  assert.doesNotMatch(html, /当前 Run/);
});

test('render_result_workspace prefers workspace state and assets when available', () => {
  const tempDir = makeTempDir('interactive-image-batch-result-workspace-state-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const workspaceStateFile = path.join(outputDir, 'workspace_state.json');
  const workspaceAssetsFile = path.join(outputDir, 'workspace_assets.json');
  const workspaceTimelineFile = path.join(outputDir, 'workspace_timeline.json');
  const exceptionWorkspaceFile = path.join(outputDir, 'exception_workspace.html');
  const runRecordFile = path.join(outputDir, 'run_record.html');
  const resultWorkspaceFile = path.join(outputDir, 'result_workspace.html');
  const previewImage = path.join(outputDir, 'state-preview.png');

  fs.writeFileSync(previewImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(exceptionWorkspaceFile, '<html>exception</html>');
  fs.writeFileSync(runRecordFile, '<html>record</html>');

  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    success: 0,
    failed: 0,
    selectedCount: 0,
  }, null, 2));

  fs.writeFileSync(workspaceStateFile, JSON.stringify({
    taskLabel: '统一状态任务',
    status: {
      phase: '结果阶段',
      tone: 'warn',
      headline: '统一状态已经接管结果判断',
      summary: '建议先处理待复核项，再决定是否继续收口。',
    },
    counts: {
      selected: 5,
      success: 3,
      failed: 1,
      needsReview: 2,
    },
    nextAction: {
      label: '进入异常工作台',
      reason: '统一状态建议先处理异常摘要。',
      target: 'exception_workspace.html',
    },
    result: {
      statusLabel: '统一状态已经接管结果判断',
      statusTone: 'warn',
      statusSummary: '建议先处理待复核项，再决定是否继续收口。',
      stageSummary: '状态层结果阶段摘要',
      currentFocus: '统一结果摘要已经接管当前重点',
      nextStepLabel: '进入异常工作台',
      nextStepReason: '统一结果摘要建议先处理异常摘要。',
      actionSummary: '状态层结果行动摘要',
      previewCount: 1,
      issueCount: 3,
      confirmationState: {
        stageLabel: '状态层结果阶段确认',
        canContinue: false,
        hasBlocking: true,
        pendingCount: 1,
        blockingCount: 1,
        confirmedItems: ['状态层结果已确认 1'],
        pendingItems: ['状态层结果待确认 1'],
        blockingItems: ['状态层结果阻塞 1'],
        recommendedReply: '继续，先处理异常',
        recentEvent: { title: '状态层结果最近事件', summary: '状态层结果最近事件说明' },
        summary: '状态层结果当前还不能直接收口。',
      },
    },
    runtimeSummary: {
      copilotSummary: {
        stageLabel: '结果阶段',
        status: 'warn',
        conclusion: '统一状态已经接管结果判断',
        progressSummary: '副驾驶摘要建议先处理待复核项，再决定是否继续收口。',
        nextActionLabel: '进入异常工作台',
        nextActionSummary: '副驾驶摘要建议先处理异常摘要。',
        recommendedReply: '继续，先处理异常',
      },
    },
    views: {
      result: {
        hero: {
          eyebrow: '状态层结果眉题',
          title: '状态层结果标题',
          intro: '状态层结果头部说明',
        },
        context: {
          runLabel: '状态层结果任务',
          phaseLabel: '状态层结果阶段',
          flowLabel: '状态层结果流程',
          counts: [{ label: '状态成功', value: 3 }],
          hints: ['状态层结果提示'],
        },
        heroCards: [
          { label: '状态层结果卡', value: '结果顶部已接管', tone: 'warn', detail: '这是状态层结果指标卡。' },
        ],
        cockpitSummary: {
          title: '驾驶舱摘要',
          copy: '状态层结果驾驶舱说明',
          items: [
            { label: '当前局面', value: '状态层结果局面', summary: '状态层结果局面说明', tone: 'warn' },
            { label: '当前重点', value: '状态层结果重点', summary: '状态层结果重点说明', tone: 'warn' },
            { label: '阻塞情况', value: '状态层结果阻塞', summary: '状态层结果阻塞说明', tone: 'bad' },
          ],
        },
        decision: {
          title: '状态层结果判断',
          copy: '状态层结果判断说明',
          items: [
            { label: '为什么当前这样判断', value: '状态层结果判断来自状态层。' },
            { label: '这一步最该盯什么', value: '状态层结果当前先盯异常入口。' },
          ],
        },
        judgment: {
          title: '状态层结果主判断',
          copy: '状态层结果主判断说明',
          statusLabel: '状态层结果主判断已接管',
          statusSummary: '状态层结果主判断摘要。',
          statusTone: 'warn',
          actionLabel: '状态层结果现在动作',
          actionSummary: '状态层结果现在动作说明。',
          replyLabel: '继续，先处理异常',
          confirmItems: ['状态层结果判断待确认 1'],
          noteItems: ['状态层结果判断提醒 1'],
        },
        summary: {
          enabled: false,
          title: '状态层结果摘要',
          copy: '状态层结果摘要说明',
          items: [
            { label: '当前状态', value: '状态层结果摘要来自状态层。' },
          ],
        },
        stageRelay: {
          title: '状态层结果交接',
          copy: '状态层结果交接说明',
          previousTitle: '状态层结果来自准备页',
          previousLabel: '状态层结果已承接上一站',
          previousSummary: '状态层结果上一站说明。',
          previousItems: ['状态层结果已接住'],
          currentTitle: '状态层结果当前职责',
          currentLabel: '状态层结果当前先看',
          currentSummary: '状态层结果当前职责说明。',
          currentItems: ['状态层结果当前项 1'],
          nextTitle: '状态层结果下一步',
          nextLabel: '状态层结果转异常',
          nextSummary: '状态层结果准备转入异常页。',
          nextItems: ['状态层结果下一项 1'],
        },
        collaboration: {
          title: '状态层结果协同',
          copy: '状态层结果协同说明',
          recentTitle: '状态层结果最近变化',
          recentSummary: '状态层结果最近变化摘要。',
          recentItems: ['状态层结果已初判'],
          confirmTitle: '状态层结果还差确认',
          confirmSummary: '状态层结果确认摘要。',
          confirmItems: ['状态层结果协同待确认 1'],
          replyTitle: '状态层结果回话术',
          primarySay: '继续，先处理异常',
          replyReason: '状态层结果先去异常页。',
          alternativeSayItems: ['继续，回首页再看'],
        },
        route: {
          title: '现在继续',
          copy: '统一结果路线说明',
          previous: { label: '状态层首页', summary: '先回统一首页。', file: path.join(outputDir, 'workspace_home.html'), cta: '回首页' },
          nextSteps: [
            { kicker: '建议下一步', label: '状态层异常入口', summary: '统一结果视图已接管下一步。', file: exceptionWorkspaceFile, cta: '先去处理' },
          ],
        },
        workbench: {
          title: '可进入的页面',
          copy: '统一结果工作台入口',
          cards: [
            { label: '状态层异常面板', value: '3 项待处理', summary: '统一结果入口已接管异常入口。', file: exceptionWorkspaceFile, cta: '进入异常工作台', tone: 'bad' },
          ],
        },
        assetStatus: {
          title: '状态层结果资产',
          copy: '状态层结果资产说明',
          readyLabel: '状态层结果已就绪',
          readySummary: '状态层结果资产可直接筛图。',
          pendingLabel: '状态层结果待确认',
          pendingSummary: '状态层结果仍有资产待确认。',
          items: [
            { label: '状态层结果资产项', value: '结果资产已接管', summary: '状态层结果资产摘要。', tone: 'good' },
            { label: '状态层结果待确认项', value: '1 项待看', summary: '状态层结果仍需复核。', tone: 'warn' },
          ],
        },
        actionStatus: {
          title: '状态层结果行动',
          copy: '状态层结果行动说明',
          primary: { kicker: '现在先做', title: '状态层结果主动作', summary: '状态层结果先做这一步。', file: exceptionWorkspaceFile, cta: '先去处理', tone: 'warn' },
          secondary: [
            { kicker: '辅助动作', title: '状态层结果辅助动作', summary: '状态层结果辅助动作说明。', file: runRecordFile, cta: '补充看看', tone: 'info' },
          ],
          notes: ['状态层结果注意点'],
        },
        dialogueStatus: {
          title: '对话协同',
          copy: '状态层结果对话协同说明',
          recentTitle: '系统刚接住',
          understoodTitle: '系统已理解',
          confirmTitle: '收口前你还要确认',
          nextSayTitle: '回到对话框直接说',
          recentItems: ['状态层结果最近一步'],
          understoodItems: ['状态层结果已理解 1'],
          confirmItems: ['是否先进入异常工作台', '阻塞确认: 失败项还没有收口'],
          nextSayItems: ['继续，先处理异常'],
        },
        summary: {
          enabled: false,
          title: '状态层结果摘要',
          copy: '状态层结果摘要说明',
          items: [
            { label: '状态层结果摘要项', value: '状态层结果摘要已隐藏' },
          ],
        },
        transitionStatus: {
          title: '状态层结果交接',
          copy: '状态层结果交接说明',
          confirmedTitle: '状态层结果已承接',
          nextFocusTitle: '状态层结果先看',
          confirmedItems: ['状态层结果已交接 1'],
          nextFocusItems: ['状态层结果先看 1'],
        },
        handoffFromPrevious: {
          title: '状态层结果来自准备页',
          copy: '状态层结果已承接上一站',
          confirmedTitle: '状态层结果已接住',
          nextFocusTitle: '状态层结果当前先看',
          confirmedItems: ['状态层结果已接住 1'],
          nextFocusItems: ['状态层结果当前先看 1'],
        },
        handoffToNext: {
          title: '状态层结果转异常',
          copy: '状态层结果准备转入异常页',
          confirmedTitle: '状态层结果已初判',
          nextFocusTitle: '状态层异常页先做',
          confirmedItems: ['状态层结果已初判 1'],
          nextFocusItems: ['状态层异常页先做 1'],
        },
        sections: {
          preview: {
            title: '状态层结果预览',
            copy: '状态层结果预览说明',
            emptyText: '状态层结果暂无预览',
            itemFallbackSummary: '状态层结果预览兜底说明',
            imageLinkLabel: '状态层查看原图',
            imageMissingText: '状态层结果无预览图',
          },
          issues: {
            title: '状态层结果异常',
            copy: '状态层结果异常说明',
            emptyText: '状态层结果无异常项',
            kicker: '状态层结果提醒',
            fallbackReason: '状态层结果建议回异常工作台',
          },
          advanced: {
            title: '状态层结果高级信息',
            copy: '状态层结果高级说明',
            summary: '状态层展开结构',
            requestModeTitle: '状态层请求方式',
            styleTitle: '状态层风格分布',
            slotRoleTitle: '状态层槽位角色',
            emptyText: '状态层暂无分布数据',
          },
        },
      },
    },
    routes: {
      home: path.join(outputDir, 'workspace_home.html'),
      exception: exceptionWorkspaceFile,
      record: runRecordFile,
    },
  }, null, 2));

  fs.writeFileSync(workspaceAssetsFile, JSON.stringify({
    assetCollections: {
      userFacing: {
        preview: [
          {
            title: '状态层预览图',
            output: previewImage,
            slotId: 'shot_9',
            requestMode: 'reference-assisted',
          },
        ],
        result: [],
        exception: [
          {
            title: '状态层失败项',
            slotId: 'shot_3',
            requestMode: 'masked-edit',
            error: 'provider timeout',
          },
        ],
        review: [
          {
            title: '状态层待复核项',
            slotId: 'shot_4',
            requestMode: 'reference-assisted',
            reason: '构图还可以再确认',
          },
        ],
        reference: [],
      },
      system: {
        keyFiles: {},
      },
    },
  }, null, 2));
  fs.writeFileSync(workspaceTimelineFile, JSON.stringify({
    events: [
      { type: 'prepare_completed', title: '状态层结果时间线 1', summary: '状态层结果时间线说明 1', time: '2026-05-20T09:00:00.000Z' },
      { type: 'execution_completed', title: '状态层结果时间线 2', summary: '状态层结果时间线说明 2', time: '2026-05-20T10:00:00.000Z' },
    ],
  }, null, 2));

  runNode('render_result_workspace.js', [
    '--manifest-file', manifestFile,
    '--output-file', resultWorkspaceFile,
  ]);

  const html = fs.readFileSync(resultWorkspaceFile, 'utf8');
  assert.match(html, /副驾驶摘要建议先处理待复核项，再决定是否继续收口。/);
  assert.match(html, /副驾驶摘要建议先处理异常摘要。/);
  assert.match(html, /继续，先处理异常/);
  assert.match(html, /状态层结果眉题/);
  assert.match(html, /状态层结果标题/);
  assert.match(html, /状态层结果头部说明/);
  assert.match(html, /统一状态已经接管结果判断/);
  assert.match(html, /状态层结果任务/);
  assert.match(html, /状态层结果阶段/);
  assert.match(html, /状态层结果流程/);
  assert.match(html, /状态成功 3/);
  assert.match(html, /状态层结果提示/);
  assert.match(html, /状态层结果阶段摘要/);
  assert.match(html, /统一结果摘要已经接管当前重点/);
  assert.match(html, /统一结果摘要建议先处理异常摘要/);
  assert.match(html, /状态层结果卡/);
  assert.match(html, /结果顶部已接管/);
  assert.match(html, /状态层结果主判断已接管/);
  assert.match(html, /结果总览/);
  assert.match(html, /先看图，再决定保留、复核还是转异常处理/);
  assert.match(html, /问题与复核/);
  assert.match(html, /这里只留会影响去留判断的问题项/);
  assert.match(html, /展开按需补充/);
  assert.doesNotMatch(html, /资产状态/);
  assert.doesNotMatch(html, /状态层结果资产说明/);
  assert.doesNotMatch(html, /状态层结果资产项/);
  assert.doesNotMatch(html, /结果资产已接管/);
  assert.doesNotMatch(html, /回到对话框直接说/);
  assert.match(html, /复制这句/);
  assert.match(html, /驾驶舱摘要/);
  assert.match(html, /状态层结果驾驶舱说明/);
  assert.match(html, /当前重点/);
  assert.match(html, /状态层结果主判断/);
  assert.match(html, /状态层结果主判断已接管/);
  assert.doesNotMatch(html, /状态层结果现在动作/);
  assert.match(html, /状态层结果判断待确认 1/);
  assert.doesNotMatch(html, /阶段确认/);
  assert.match(html, /阶段时间线/);
  assert.match(html, /状态层结果时间线 1/);
  assert.match(html, /状态层结果时间线 2/);
  assert.doesNotMatch(html, /系统刚接住/);
  assert.doesNotMatch(html, /为什么当前这样判断|如果暂不处理，主要风险是什么/);
  assert.match(html, /状态层结果已初判/);
  assert.match(html, /状态层结果已初判/);
  assert.match(html, /状态层查看原图/);
  assert.match(html, /状态层结果提醒/);
  assert.match(html, /这里只保留一个主跳转|统一结果路线说明/);
  assert.match(html, /状态层异常面板/);
  assert.match(html, /当前任务主链/);
  assert.match(html, /当前判断/);
  assert.match(html, /状态层预览图/);
  assert.match(html, /状态层失败项/);
  assert.match(html, /状态层待复核项/);
  assert.doesNotMatch(html, /<h2>异常摘要<\/h2>/);
  assert.match(html, /DAOGE 结果工作台/);
  assert.doesNotMatch(html, /先做这一步/);
  assert.match(html, /统一结果工作台入口|按需再看|可进入的页面/);
  assert.doesNotMatch(html, /<h2>结果摘要<\/h2>/);
  assert.doesNotMatch(html, /结果大图区|这一页主控|当前 Run/);
  assert.doesNotMatch(html, /Storyboard Workbench/);
  assert.doesNotMatch(html, /<title>Demo Storyboard<\/title>/);
  assert.doesNotMatch(html, /<div class="portal-route-label">回工作台首页<\/div>/);
});

test('render_result_workspace hides storyboard entry when it is only a leftover file', () => {
  const tempDir = makeTempDir('interactive-image-batch-result-workspace-storyboard-guard-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const workspaceStateFile = path.join(outputDir, 'workspace_state.json');
  const resultWorkspaceFile = path.join(outputDir, 'result_workspace.html');
  const storyboardBoardFile = path.join(outputDir, 'storyboard_board.html');

  fs.writeFileSync(storyboardBoardFile, '<html>storyboard</html>');
  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    success: 2,
    failed: 0,
    selectedCount: 2,
  }, null, 2));
  fs.writeFileSync(workspaceStateFile, JSON.stringify({
    taskLabel: '普通结果任务',
    specialization: {
      storyboard: {
        enabled: false,
      },
    },
    status: {
      phase: '结果阶段',
      tone: 'good',
      headline: '普通结果任务已经稳定',
      summary: '建议继续做普通结果收口。',
    },
    counts: {
      selected: 2,
      success: 2,
      failed: 0,
      needsReview: 0,
    },
    routes: {
      home: path.join(outputDir, 'workspace_home.html'),
      storyboard: storyboardBoardFile,
    },
  }, null, 2));

  runNode('render_result_workspace.js', [
    '--manifest-file', manifestFile,
    '--output-file', resultWorkspaceFile,
  ]);

  const html = fs.readFileSync(resultWorkspaceFile, 'utf8');
  assert.doesNotMatch(html, /Storyboard 整板/);
  assert.doesNotMatch(html, /进入整板页/);
});

test('build_workspace_state infers storyboard specialization from execution manifest', () => {
  const tempDir = makeTempDir('interactive-image-batch-workspace-state-storyboard-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const workspaceStateFile = path.join(outputDir, 'workspace_state.json');
  const workspaceAssetsFile = path.join(outputDir, 'workspace_assets.json');
  const workspaceTimelineFile = path.join(outputDir, 'workspace_timeline.json');
  const workbenchStateFile = path.join(outputDir, 'workbench_state.json');
  const storyboardBoardFile = path.join(outputDir, 'storyboard_board.html');
  const resultWorkspaceFile = path.join(outputDir, 'result_workspace.html');

  fs.writeFileSync(storyboardBoardFile, '<html>storyboard</html>');
  fs.writeFileSync(resultWorkspaceFile, '<html>result</html>');
  fs.writeFileSync(path.join(outputDir, 'entry_state.json'), JSON.stringify({
    entryMode: 'intent',
    taskCategory: '分镜与叙事',
    starterIntent: 'oralboard',
    selectedExample: {
      id: 'oralboard-semiconductor-host',
      name: '半导体口播整板',
      description: '适合主持人口播整板和故事版任务。',
    },
    entryContext: {
      runLabel: '半导体口播整板',
      phaseLabel: '入口层',
      flowLabel: '中文模板展示板 -> 任务总控 -> 工作台首页 -> 准备工作台 -> 结果工作台 -> 异常工作台',
      counts: [
        { label: '进入方式', value: '按任务意图进入' },
        { label: '当前任务组', value: '分镜与叙事' },
        { label: '当前意图', value: 'oralboard' },
      ],
      hints: [
        '适合主持人口播整板和故事版任务。',
        '先确认这类整板任务的方向和放行条件。',
      ],
    },
    entryMainlineProtocol: {
      version: 1,
      currentLayer: '入口层',
      sequence: ['中文模板展示板', '任务总控', '工作台首页', '准备工作台', '结果工作台', '异常工作台'],
      sequenceLabel: '中文模板展示板 -> 任务总控 -> 工作台首页 -> 准备工作台 -> 结果工作台 -> 异常工作台',
      entryRole: '模板展示板只负责选择任务类型和起步入口。',
      taskCenterRole: '任务总控只负责开新任务、继续当前任务和切换任务。',
      workspaceRole: '工作台首页接住单轮任务判断，再顺着准备、结果、异常继续。',
      handoffRule: '入口层一旦选定任务，就把方向交给准备工作台；任务总控只做任务级切换，不展开单轮内部判断。',
      summary: '先在中文模板展示板选任务，再到任务总控决定开新任务或继续任务，进入工作台首页后就沿四站主链推进。',
    },
    recommendedNextStep: {
      label: '进入准备工作台',
      target: 'prepare_workspace.html',
      reason: '先确认这类整板任务的方向和放行条件。',
    },
    entryWorkbench: {
      route: {
        title: '从入口层继续',
        copy: '入口层只负责选任务和选起步入口，确认后就直接进入准备工作台。',
        current: {
          kicker: '当前入口',
          label: '半导体口播整板',
          summary: '适合主持人口播整板和故事版任务。',
        },
        next: {
          kicker: '建议下一步',
          label: '进入准备工作台',
          reason: '先确认这类整板任务的方向和放行条件。',
          target: 'prepare_workspace.html',
        },
      },
    },
  }, null, 2));
  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    selectedCount: 2,
    success: 2,
    failed: 0,
    batchCount: 1,
    batches: [
      {
        batchNumber: 1,
        results: [
          {
            title: 'Shot 01 钩子开场',
            slotId: 'shot_1',
            boardId: 'demo-board',
            shotLabel: '01 钩子开场',
            timecode: '0-8s',
            composition: 'scene-led storyboard frame',
          },
        ],
      },
    ],
  }, null, 2));

  runNode('build_workspace_state.js', [
    '--manifest-file', manifestFile,
    '--output-dir', outputDir,
    '--workspace-state-file', workspaceStateFile,
    '--workspace-assets-file', workspaceAssetsFile,
    '--workspace-timeline-file', workspaceTimelineFile,
    '--workbench-state-file', workbenchStateFile,
  ]);
  runNode('render_workspace_home.js', [
    '--manifest-file', manifestFile,
    '--output-file', path.join(outputDir, 'workspace_home.html'),
  ]);
  runNode('render_run_record.js', [
    '--manifest-file', manifestFile,
    '--html-file', path.join(outputDir, 'run_record.html'),
    '--markdown-file', path.join(outputDir, 'run_record.md'),
  ]);

  const workspaceState = JSON.parse(fs.readFileSync(workspaceStateFile, 'utf8'));
  const workbenchState = JSON.parse(fs.readFileSync(workbenchStateFile, 'utf8'));
  const unifiedWorkbenchState = JSON.parse(fs.readFileSync(path.join(outputDir, 'workspace_live_state.json'), 'utf8'));
  const workspaceHomeHtml = fs.readFileSync(path.join(outputDir, 'workspace_home.html'), 'utf8');
  const runRecordHtml = fs.readFileSync(path.join(outputDir, 'run_record.html'), 'utf8');
  const runRecordMarkdown = fs.readFileSync(path.join(outputDir, 'run_record.md'), 'utf8');
  assert.equal(workspaceState.specialization.storyboard.enabled, true);
  assert.equal(workspaceState.workflowKind, 'storyboard');
  assert.equal(workspaceState.specialWorkflowProtocol?.activeWorkflowKind, 'storyboard');
  assert.equal(workspaceState.specialWorkflowProtocol?.storyboard?.active, true);
  assert.equal(workspaceState.specialWorkflowProtocol?.storyboard?.officialSubsystem, true);
  assert.equal(workspaceState.specialWorkflowProtocol?.storyboard?.structureContract?.contentSlots, 1);
  assert.deepEqual(workspaceState.specialWorkflowProtocol?.storyboard?.structureContract?.continuityFields, ['continuity', 'camera_move', 'timecode', 'shot_label']);
  assert.match(String(workspaceState.specialWorkflowProtocol?.storyboard?.defaultMainlineBehavior || ''), /普通批量图不默认生成/);
  assert.equal(workspaceState.specialization.storyboard.protocol?.officialSubsystem, true);
  assert.equal(workbenchState.kind, 'daoge-workbench-state');
  assert.equal(workbenchState.specialWorkflowProtocol?.storyboard?.active, true);
  assert.match(workspaceHomeHtml, /特殊工作流定位/);
  assert.match(workspaceHomeHtml, /storyboard 专用子系统/);
  assert.match(workspaceHomeHtml, /content slot \/ layout \/ reference \/ mask/);
  assert.match(runRecordHtml, /特殊工作流定位/);
  assert.match(runRecordHtml, /storyboard/);
  assert.match(runRecordHtml, /content slot \/ layout \/ reference \/ mask \/ continuity \/ camera_move/);
  assert.match(runRecordMarkdown, /storyboard: 当前启用/);
  assert.equal(unifiedWorkbenchState.kind, 'daoge-workbench-state');
  assert.equal(workbenchState.schemaVersion, 1);
  assert.equal(workbenchState.role, 'derived-page-snapshot');
  assert.equal(workbenchState.snapshotIntent, 'derived-workbench-snapshot');
  assert.equal(workbenchState.taskLabel, workspaceState.taskLabel);
  assert.equal(workspaceState.entryBridge?.selectedEntry?.title, '半导体口播整板');
  assert.equal(workspaceState.entryBridge?.route?.next?.label, '进入准备工作台');
  assert.equal(workspaceState.entryBridge?.mainlineProtocol?.taskCenterRole, '任务总控只负责开新任务、继续当前任务和切换任务。');
  assert.match(String(workspaceState.entryBridge?.mainlineProtocol?.sequenceLabel || ''), /中文模板展示板 -> 任务总控 -> 工作台首页/);
  assert.equal(workspaceState.entryBridge?.mainlineProtocol?.defaultGenerationProtocol?.mode, 'mainline-only');
  assert.match(String(workspaceState.entryBridge?.mainlineProtocol?.defaultGenerationProtocol?.guardrail?.internalRule || ''), /默认不展示给普通用户/);
  assert.equal(workbenchState.entryBridge?.context?.phaseLabel, '入口层');
  assert.equal(workbenchState.entryState, undefined);
  assert.equal(workbenchState.stateSources?.canonicalState, workspaceStateFile);
  assert.equal(workbenchState.stateSources?.preferredState, path.join(outputDir, 'workspace_live_state.json'));
  assert.equal(workbenchState.stateSources?.liveState, path.join(outputDir, 'workspace_live_state.json'));
  assert.equal(workbenchState.stateSources?.derivedWorkbenchSnapshot, path.join(outputDir, 'workbench_state.json'));
  assert.equal(workbenchState.stateSources?.currentState, path.join(outputDir, 'workbench_state.json'));
  assert.equal(workbenchState.stateSources?.unifiedState, path.join(outputDir, 'workspace_live_state.json'));
  assert.equal(workbenchState.stateSources?.assetsState, workspaceAssetsFile);
  assert.equal(workbenchState.stateSources?.timelineState, workspaceTimelineFile);
  assert.equal(workbenchState.stateSources?.entryState, path.join(outputDir, 'entry_state.json'));
  assert.equal(workbenchState.stateSources?.runtimeState, path.join(outputDir, 'runtime_state.json'));
  assert.deepEqual(workbenchState.workbenchGuide || {}, {});
  assert.deepEqual(workbenchState.assetVisibilityGuide || {}, {});
  assert.deepEqual(workbenchState.pageData || {}, {});
  assert.deepEqual(workbenchState.views || {}, {});
  assert.equal(unifiedWorkbenchState.role, 'live-workbench-state');
  assert.equal(unifiedWorkbenchState.snapshotIntent, 'primary-runtime-source');
  assert.equal(unifiedWorkbenchState.stateSources?.currentState, path.join(outputDir, 'workspace_live_state.json'));
  assert.equal(unifiedWorkbenchState.stateSources?.derivedWorkbenchSnapshot, path.join(outputDir, 'workbench_state.json'));
  assert.equal(unifiedWorkbenchState.stateSources?.preferredState, path.join(outputDir, 'workspace_live_state.json'));
  assert.equal(unifiedWorkbenchState.stateSources?.liveState, path.join(outputDir, 'workspace_live_state.json'));
  assert.equal(unifiedWorkbenchState.entryBridge, null);
  assert.deepEqual(unifiedWorkbenchState.stateProtocol || {}, {});
  assert.deepEqual(unifiedWorkbenchState.specialWorkflowProtocol || {}, {});
  assert.deepEqual(unifiedWorkbenchState.routes || {}, {});
  assert.deepEqual(unifiedWorkbenchState.sourceSummary || {}, {});
  assert.deepEqual(unifiedWorkbenchState.assetLayers || {}, {});
  assert.equal('assets' in unifiedWorkbenchState, false);
  assert.deepEqual(unifiedWorkbenchState.workflowSessions || {}, {});
  assert.deepEqual(unifiedWorkbenchState.pageGroups || {}, {});
  assert.deepEqual(unifiedWorkbenchState.governance || {}, {});
  assert.deepEqual(unifiedWorkbenchState.governanceByPage || {}, {});
  assert.deepEqual(unifiedWorkbenchState.artifactGovernance || {}, {});
  assert.deepEqual(unifiedWorkbenchState.workbenchGuide || {}, {});
  assert.deepEqual(unifiedWorkbenchState.assetVisibilityGuide || {}, {});
  assert.deepEqual(unifiedWorkbenchState.pageData || {}, {});
  assert.deepEqual(unifiedWorkbenchState.views || {}, {});
  assert.deepEqual(unifiedWorkbenchState.status || {}, {});
  assert.deepEqual(unifiedWorkbenchState.counts || {}, {});
  assert.deepEqual(unifiedWorkbenchState.nextAction || {}, {});
  assert.deepEqual(unifiedWorkbenchState.risk || {}, {});
  assert.deepEqual(unifiedWorkbenchState.confirmationState || {}, {});
  assert.deepEqual(unifiedWorkbenchState.runtimeSummary || {}, {});
  assert.equal(unifiedWorkbenchState.runtimeWorkflow, null);
  assert.deepEqual(unifiedWorkbenchState.prepare || {}, {});
  assert.deepEqual(unifiedWorkbenchState.result || {}, {});
  assert.deepEqual(unifiedWorkbenchState.exception || {}, {});
  assert.deepEqual(unifiedWorkbenchState.specialization || {}, {});
  assert.deepEqual(unifiedWorkbenchState.panels || {}, {});
  assert.deepEqual(unifiedWorkbenchState.timeline || {}, {});
  assert.deepEqual(
    Object.keys(loadWorkbenchState(outputDir).snapshot?.workflowSessions || {}).sort(),
    ['exception', 'home', 'prepare', 'result']
  );
  assert.ok(Array.isArray(loadWorkbenchState(outputDir).snapshot?.pageGroups?.mainline));
  assert.equal(
    loadWorkbenchState(outputDir).snapshot?.assetLayers?.defaultLayer,
    'user-facing'
  );
  assert.equal(
    loadWorkbenchState(outputDir).snapshot?.sourceSummary?.assets?.userFacingCount,
    workbenchState.assets?.summary?.userFacingCount ?? loadWorkbenchState(outputDir).snapshot?.sourceSummary?.assets?.userFacingCount
  );
  assert.equal(
    loadWorkbenchState(outputDir).snapshot?.artifactGovernance?.summary?.defaultEntryLabel,
    '工作台首页'
  );
  assert.equal(
    loadWorkbenchState(outputDir).snapshot?.workbenchGuide?.home?.section?.title,
    '工作台使用规则'
  );
  assert.equal(
    loadWorkbenchState(outputDir).snapshot?.assetVisibilityGuide?.home?.title,
    '这页先看什么'
  );
  assert.equal(
    loadWorkbenchState(outputDir).snapshot?.governanceByPage?.['workspace_home.html']?.currentPage,
    'workspace_home.html'
  );
  assert.equal(
    loadWorkbenchState(outputDir).snapshot?.specialization?.storyboard?.enabled,
    true
  );
  assert.equal(
    loadWorkbenchState(outputDir).snapshot?.panels?.showStoryboard,
    true
  );
  assert.ok(String(loadWorkbenchState(outputDir).snapshot?.routes?.result || '').trim().length > 0);
  assert.equal(
    loadWorkbenchState(outputDir).snapshot?.pageData?.prepare?.sections?.guide?.title,
    '工作台使用规则'
  );
  assert.equal(
    loadWorkbenchState(outputDir).snapshot?.views?.home?.hero?.title,
    'DAOGE 工作台首页'
  );
  assert.equal(
    loadWorkbenchState(outputDir).snapshot?.prepare?.unifiedStatus?.stage,
    '准备阶段'
  );
  assert.equal(
    loadWorkbenchState(outputDir).snapshot?.result?.unifiedStatus?.stage,
    '结果阶段'
  );
  assert.equal(
    loadWorkbenchState(outputDir).snapshot?.exception?.unifiedStatus?.stage,
    '异常阶段'
  );
  assert.equal(
    loadWorkbenchState(outputDir).snapshot?.workflowTextProtocol?.home?.source,
    'workflowContracts.home'
  );
  assert.equal(
    loadWorkbenchState(outputDir).snapshot?.stateProtocol?.files?.workspaceState?.file,
    'workspace_state.json'
  );
  assert.deepEqual({
    ...unifiedWorkbenchState,
    role: 'derived-page-snapshot',
    snapshotIntent: 'derived-workbench-snapshot',
    outputFile: path.join(outputDir, 'workbench_state.json'),
    stateSources: {
      ...unifiedWorkbenchState.stateSources,
      currentState: path.join(outputDir, 'workbench_state.json'),
    },
    entryBridge: workbenchState.entryBridge,
    stateProtocol: workbenchState.stateProtocol,
    specialWorkflowProtocol: workbenchState.specialWorkflowProtocol,
    status: workbenchState.status,
    counts: workbenchState.counts,
    nextAction: workbenchState.nextAction,
    routes: workbenchState.routes,
    risk: workbenchState.risk,
    confirmationState: workbenchState.confirmationState,
    sourceSummary: workbenchState.sourceSummary,
    assetLayers: workbenchState.assetLayers,
    pageGroups: workbenchState.pageGroups,
    governance: workbenchState.governance,
    governanceByPage: workbenchState.governanceByPage,
    artifactGovernance: workbenchState.artifactGovernance,
    workbenchGuide: {},
    assetVisibilityGuide: {},
    workflowSessions: workbenchState.workflowSessions,
    taskSessionSnapshots: workbenchState.taskSessionSnapshots,
    workflowProtocolRegistry: workbenchState.workflowProtocolRegistry,
    workflowCopilotRegistry: workbenchState.workflowCopilotRegistry,
    workflowTextProtocol: workbenchState.workflowTextProtocol,
    pageData: {},
    views: {},
    runtimeWorkflow: workbenchState.runtimeWorkflow,
    prepare: workbenchState.prepare,
    result: workbenchState.result,
    exception: workbenchState.exception,
    specialization: workbenchState.specialization,
    panels: workbenchState.panels,
    assets: workbenchState.assets,
    timeline: workbenchState.timeline,
  }, workbenchState);
  assert.equal(workbenchState.runtimeSummary?.currentStatus, workspaceState.runtimeSummary?.currentStatus);
  const persistedWorkspaceAssets = JSON.parse(fs.readFileSync(workspaceAssetsFile, 'utf8'));
  assert.deepEqual(workbenchState.assets?.assetCollections, persistedWorkspaceAssets.assetCollections);
  assert.deepEqual(workbenchState.assets?.layers, persistedWorkspaceAssets.layers);
  assert.deepEqual(workbenchState.assets?.summary, persistedWorkspaceAssets.summary);
  assert.deepEqual(workbenchState.assets?.keyFiles, persistedWorkspaceAssets.keyFiles);
  assert.equal('previewImages' in persistedWorkspaceAssets, false);
  assert.equal('resultAssets' in persistedWorkspaceAssets, false);
  assert.equal('reviewAssets' in persistedWorkspaceAssets, false);
  assert.equal('exceptionItems' in persistedWorkspaceAssets, false);
  assert.equal('referenceAssets' in persistedWorkspaceAssets, false);
  assert.deepEqual(workbenchState.timeline, JSON.parse(fs.readFileSync(workspaceTimelineFile, 'utf8')));
  assert.equal(workbenchState.assetLayers?.defaultLayer, 'user-facing');
  assert.equal(workbenchState.assetLayers?.userFacing?.title, '用户资产');
  assert.equal(workbenchState.assetLayers?.workbenchState?.title, '工作台状态资产');
  assert.equal(workbenchState.assetLayers?.diagnosticFacing?.title, '诊断归档资产');
  assert.equal(workbenchState.assetLayers?.systemFacing?.title, '系统资产');
  assert.ok(Array.isArray(workbenchState.assets?.layers?.userFacing?.groups));
  assert.ok(Array.isArray(workbenchState.assets?.layers?.systemFacing?.items?.state));
  assert.ok(Array.isArray(workbenchState.assets?.layers?.workbenchState?.items?.liveState));
  assert.ok(Array.isArray(workbenchState.assets?.layers?.diagnosticFacing?.items?.diagnostic));
  assert.ok(workbenchState.assets?.layers?.userFacing?.groups?.some((item) => item.key === 'result'));
  assert.ok(workbenchState.assets?.layers?.systemFacing?.items?.state?.some((item) => item.id === 'workspace-state'));
  assert.ok(workbenchState.assets?.layers?.workbenchState?.items?.liveState?.some((item) => item.id === 'workspace-live-state'));
  assert.equal('previewImages' in (workbenchState.assets || {}), false);
  assert.equal('resultAssets' in (workbenchState.assets || {}), false);
  assert.equal('reviewAssets' in (workbenchState.assets || {}), false);
  assert.equal('exceptionItems' in (workbenchState.assets || {}), false);
  assert.equal('referenceAssets' in (workbenchState.assets || {}), false);
  assert.equal(workspaceState.panels.showStoryboard, true);
  assert.equal(workspaceState.governanceByPage?.['result_workspace.html']?.optionalSurface?.showStoryboardEntry, true);
  assert.ok((workspaceState.governanceByPage?.['result_workspace.html']?.optionalSurface?.conditionalVisibleIds || []).includes('storyboard'));
  assert.ok((workspaceState.governanceByPage?.['result_workspace.html']?.workbenchEntryIds || []).includes('storyboard'));
  assert.ok((workspaceState.governanceByPage?.['exception_workspace.html']?.workbenchEntryIds || []).includes('storyboard'));
  assert.equal(workspaceState.result?.nextStepLabel, '回工作台首页');
  assert.equal(workspaceState.unifiedStatus?.taskLabel, workspaceState.taskLabel);
  assert.ok(String(workspaceState.unifiedStatus?.stage || '').trim().length > 0);
  assert.ok(String(workspaceState.unifiedStatus?.conclusion || '').trim().length > 0);
  assert.ok(String(workspaceState.unifiedStatus?.currentFocus || '').trim().length > 0);
  assert.ok(String(workspaceState.prepare?.unifiedStatus?.stage || '').trim().length > 0);
  assert.equal(workspaceState.prepare?.unifiedStatus?.stage, '准备阶段');
  assert.equal(workspaceState.result?.unifiedStatus?.stage, '结果阶段');
  assert.equal(workspaceState.exception?.unifiedStatus?.stage, '异常阶段');
  assert.ok(String(workspaceState.prepare?.unifiedStatus?.nextAction?.label || '').trim().length > 0);
  assert.ok(String(workspaceState.result?.unifiedStatus?.nextAction?.reason || '').trim().length > 0);
  assert.ok(String(workspaceState.exception?.unifiedStatus?.dialogue?.primarySay || '').trim().length > 0);
  assert.equal(workspaceState.views.home.assetStatus.title, '资产状态');
  assert.match(workspaceState.views.home.assetStatus.copy, /项用户资产里|已经沉淀了什么/);
  assert.equal(workspaceState.views.prepare.assetStatus.title, '资产状态');
  assert.equal(workspaceState.views.result.assetStatus.title, '资产状态');
  assert.equal(workspaceState.views.exception.assetStatus.title, '资产状态');
  assert.ok(Array.isArray(workspaceState.views.result.assetStatus.items));
  assert.ok(workspaceState.views.result.assetStatus.items.some((item) => item.label === '可直接使用结果'));
  assert.match(workspaceState.views.prepare.assetStatus.copy, /真正会影响放行的|准备层重点不是看文件名/);
  assert.match(workspaceState.views.result.assetStatus.copy, /项可用结果|结果层先帮你分清/);
  assert.match(workspaceState.views.exception.assetStatus.copy, /真的会影响主链继续的问题资产|这里只保留和问题处理有关的资产状态/);
  assert.equal(workspaceState.sourceSummary?.assets?.userFacingCount, workspaceState.assets?.summary?.userFacingCount ?? workspaceState.sourceSummary?.assets?.userFacingCount);
  assert.equal(workspaceState.sourceSummary?.assets?.workbenchStateCount, workspaceState.assets?.summary?.workbenchStateCount ?? workspaceState.sourceSummary?.assets?.workbenchStateCount);
  assert.equal(workspaceState.sourceSummary?.assets?.diagnosticCount, workspaceState.assets?.summary?.diagnosticCount ?? workspaceState.sourceSummary?.assets?.diagnosticCount);
  assert.equal(workspaceState.sourceSummary?.assets?.systemCount, workspaceState.assets?.summary?.systemCount ?? workspaceState.sourceSummary?.assets?.systemCount);
  assert.equal(workspaceState.views.home.actionStatus.title, '行动建议');
  assert.equal(workspaceState.views.prepare.actionStatus.title, '行动建议');
  assert.equal(workspaceState.views.result.actionStatus.title, '行动建议');
  assert.equal(workspaceState.views.exception.actionStatus.title, '行动建议');
  assert.ok(workspaceState.views.result.actionStatus.primary);
  assert.ok(String(workspaceState.prepare.nextStepLabel || '').trim().length > 0);
  assert.ok(String(workspaceState.prepare.nextStepReason || '').trim().length > 0);
  assert.ok(workspaceState.prepare.currentFocus.length > 0);
  assert.equal(workspaceState.pageData.prepare.nextStepLabel, workspaceState.prepare.nextStepLabel);
  assert.equal(workspaceState.pageData.prepare.nextStepReason, workspaceState.prepare.nextStepReason);
  assert.equal(workspaceState.pageData.prepare.currentFocus, workspaceState.prepare.currentFocus);
  assert.ok(String(workspaceState.prepare.transitionSummary || '').trim().length > 0);
  assert.ok(String(workspaceState.prepare.handoffSummary || '').trim().length > 0);
  assert.ok(workspaceState.prepare.primaryAction && String(workspaceState.prepare.primaryAction.label || '').trim().length > 0);
  assert.ok(Array.isArray(workspaceState.prepare.secondaryActionHints));
  assert.ok(workspaceState.prepare.cockpitSummary && Array.isArray(workspaceState.prepare.cockpitSummary.items));
  assert.ok(workspaceState.prepare.judgment && String(workspaceState.prepare.judgment.statusLabel || '').trim().length > 0);
  assert.ok(Array.isArray(workspaceState.prepare.statusStack));
  assert.ok(workspaceState.prepare.decision && Array.isArray(workspaceState.prepare.decision.items));
  assert.ok(workspaceState.prepare.summary && Array.isArray(workspaceState.prepare.summary.items));
  assert.ok(workspaceState.prepare.collaboration && Array.isArray(workspaceState.prepare.collaboration.recentItems));
  assert.equal(workspaceState.pageData.prepare.transitionSummary, workspaceState.prepare.transitionSummary);
  assert.equal(workspaceState.pageData.prepare.handoffSummary, workspaceState.prepare.handoffSummary);
  assert.deepEqual(workspaceState.pageData.prepare.cockpitSummary, workspaceState.prepare.cockpitSummary);
  assert.deepEqual(workspaceState.pageData.prepare.judgment, workspaceState.prepare.judgment);
  assert.deepEqual(workspaceState.pageData.prepare.statusStack, workspaceState.prepare.statusStack);
  assert.deepEqual(workspaceState.pageData.prepare.decision, workspaceState.prepare.decision);
  assert.deepEqual(workspaceState.pageData.prepare.summary, workspaceState.prepare.summary);
  assert.deepEqual(workspaceState.pageData.prepare.collaboration, workspaceState.prepare.collaboration);
  assert.equal(workspaceState.pageData.prepare.sections?.guide?.title, '工作台使用规则');
  assert.equal(workspaceState.pageData.prepare.sections?.visibility?.title, '这页先看什么');
  assert.equal(workspaceState.pageData.prepare.sections?.direction?.title, '任务方向');
  assert.equal(workspaceState.pageData.prepare.sections?.readiness?.title, '执行判断');
  assert.equal(workspaceState.pageData.prepare.sections?.assets?.title, '素材绑定');
  assert.ok(Array.isArray(workspaceState.pageData.prepare.sections?.assets?.assetItems));
  assert.equal(workspaceState.pageData.prepare.sections?.timeline?.title, '阶段时间线');
  assert.equal(workspaceState.pageData.home.sections?.preview?.title, '图片速览');
  assert.equal(workspaceState.pageData.home.sections?.preview?.enabled, false);
  assert.equal(workspaceState.pageData.home.sections?.timeline?.title, '阶段时间线');
  assert.ok(String(workspaceState.result.nextStepLabel || '').trim().length > 0);
  assert.ok(String(workspaceState.result.nextStepReason || '').trim().length > 0);
  assert.ok(String(workspaceState.result.currentFocus || '').trim().length > 0);
  assert.equal(workspaceState.pageData.result.nextStepLabel, workspaceState.result.nextStepLabel);
  assert.equal(workspaceState.pageData.result.nextStepReason, workspaceState.result.nextStepReason);
  assert.equal(workspaceState.pageData.result.currentFocus, workspaceState.result.currentFocus);
  assert.ok(String(workspaceState.result.transitionSummary || '').trim().length > 0);
  assert.ok(String(workspaceState.result.handoffSummary || '').trim().length > 0);
  assert.ok(workspaceState.result.primaryAction && String(workspaceState.result.primaryAction.label || '').trim().length > 0);
  assert.ok(Array.isArray(workspaceState.result.secondaryActionHints));
  assert.ok(workspaceState.result.cockpitSummary && Array.isArray(workspaceState.result.cockpitSummary.items));
  assert.ok(workspaceState.result.judgment && String(workspaceState.result.judgment.statusLabel || '').trim().length > 0);
  assert.ok(Array.isArray(workspaceState.result.statusStack));
  assert.ok(workspaceState.result.decision && Array.isArray(workspaceState.result.decision.items));
  assert.ok(workspaceState.result.summary && Array.isArray(workspaceState.result.summary.items));
  assert.ok(workspaceState.result.collaboration && Array.isArray(workspaceState.result.collaboration.recentItems));
  assert.equal(workspaceState.pageData.result.transitionSummary, workspaceState.result.transitionSummary);
  assert.equal(workspaceState.pageData.result.handoffSummary, workspaceState.result.handoffSummary);
  assert.deepEqual(workspaceState.pageData.result.cockpitSummary, workspaceState.result.cockpitSummary);
  assert.deepEqual(workspaceState.pageData.result.judgment, workspaceState.result.judgment);
  assert.deepEqual(workspaceState.pageData.result.statusStack, workspaceState.result.statusStack);
  assert.deepEqual(workspaceState.pageData.result.decision, workspaceState.result.decision);
  assert.deepEqual(workspaceState.pageData.result.summary, workspaceState.result.summary);
  assert.deepEqual(workspaceState.pageData.result.collaboration, workspaceState.result.collaboration);
  assert.equal(workspaceState.pageData.result.sections?.guide?.title, '工作台使用规则');
  assert.equal(workspaceState.pageData.result.sections?.visibility?.title, '这页先看什么');
  assert.equal(workspaceState.pageData.result.sections?.preview?.title, '图片速览');
  assert.ok(Array.isArray(workspaceState.pageData.result.sections?.preview?.items));
  assert.equal(workspaceState.pageData.result.sections?.issues?.title, '异常摘要');
  assert.ok(Array.isArray(workspaceState.pageData.result.sections?.issues?.items));
  assert.equal(workspaceState.pageData.result.sections?.advanced?.title, '补充理解');
  assert.ok(Array.isArray(workspaceState.pageData.result.sections?.advanced?.groups));
  assert.equal(workspaceState.pageData.result.sections?.timeline?.title, '阶段时间线');
  assert.ok(String(workspaceState.exception.nextStepLabel || '').trim().length > 0);
  assert.ok(String(workspaceState.exception.nextStepReason || '').trim().length > 0);
  assert.ok(String(workspaceState.exception.currentFocus || '').trim().length > 0);
  assert.equal(workspaceState.pageData.exception.nextStepLabel, workspaceState.exception.nextStepLabel);
  assert.equal(workspaceState.pageData.exception.nextStepReason, workspaceState.exception.nextStepReason);
  assert.equal(workspaceState.pageData.exception.currentFocus, workspaceState.exception.currentFocus);
  assert.ok(String(workspaceState.exception.transitionSummary || '').trim().length > 0);
  assert.ok(String(workspaceState.exception.handoffSummary || '').trim().length > 0);
  assert.ok(workspaceState.exception.primaryAction && String(workspaceState.exception.primaryAction.label || '').trim().length > 0);
  assert.ok(Array.isArray(workspaceState.exception.secondaryActionHints));
  assert.ok(workspaceState.exception.cockpitSummary && Array.isArray(workspaceState.exception.cockpitSummary.items));
  assert.ok(workspaceState.exception.judgment && String(workspaceState.exception.judgment.statusLabel || '').trim().length > 0);
  assert.ok(Array.isArray(workspaceState.exception.statusStack));
  assert.ok(workspaceState.exception.decision && Array.isArray(workspaceState.exception.decision.items));
  assert.ok(workspaceState.exception.summary && Array.isArray(workspaceState.exception.summary.items));
  assert.ok(workspaceState.exception.collaboration && Array.isArray(workspaceState.exception.collaboration.recentItems));
  assert.equal(workspaceState.pageData.exception.transitionSummary, workspaceState.exception.transitionSummary);
  assert.equal(workspaceState.pageData.exception.handoffSummary, workspaceState.exception.handoffSummary);
  assert.deepEqual(workspaceState.pageData.exception.cockpitSummary, workspaceState.exception.cockpitSummary);
  assert.deepEqual(workspaceState.pageData.exception.judgment, workspaceState.exception.judgment);
  assert.deepEqual(workspaceState.pageData.exception.statusStack, workspaceState.exception.statusStack);
  assert.deepEqual(workspaceState.pageData.exception.decision, workspaceState.exception.decision);
  assert.deepEqual(workspaceState.pageData.exception.summary, workspaceState.exception.summary);
  assert.deepEqual(workspaceState.pageData.exception.collaboration, workspaceState.exception.collaboration);
  assert.equal(workspaceState.pageData.exception.sections?.guide?.title, '工作台使用规则');
  assert.equal(workspaceState.pageData.exception.sections?.visibility?.title, '这页先看什么');
  assert.equal(workspaceState.pageData.exception.sections?.issues?.title, '问题列表');
  assert.ok(Array.isArray(workspaceState.pageData.exception.sections?.issues?.items));
  assert.equal(workspaceState.pageData.exception.sections?.rerun?.title, '补跑候选');
  assert.ok(Array.isArray(workspaceState.pageData.exception.sections?.rerun?.items));
  assert.equal(workspaceState.pageData.exception.sections?.timeline?.title, '阶段时间线');
});

test('render_exception_workspace prefers workspace state and assets when available', () => {
  const tempDir = makeTempDir('interactive-image-batch-exception-workspace-state-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const workspaceStateFile = path.join(outputDir, 'workspace_state.json');
  const workspaceAssetsFile = path.join(outputDir, 'workspace_assets.json');
  const workspaceTimelineFile = path.join(outputDir, 'workspace_timeline.json');
  const resultWorkspaceFile = path.join(outputDir, 'result_workspace.html');
  const exceptionWorkspaceFile = path.join(outputDir, 'exception_workspace.html');
  const workspaceHomeFile = path.join(outputDir, 'workspace_home.html');

  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    failed: 0,
    success: 3,
  }, null, 2));
  fs.writeFileSync(resultWorkspaceFile, '<html>result</html>');
  fs.writeFileSync(workspaceHomeFile, '<html>home</html>');

  fs.writeFileSync(workspaceStateFile, JSON.stringify({
    taskLabel: '统一异常任务',
    status: {
      phase: '异常阶段',
      tone: 'bad',
      headline: '统一状态已经接管异常判断',
      summary: '建议先统一处理失败项，再决定是否补跑。',
    },
    counts: {
      failed: 2,
      needsReview: 1,
    },
    risk: {
      summary: '统一状态提示当前异常压力较高。',
    },
    exception: {
      statusLabel: '统一状态已经接管异常判断',
      statusTone: 'bad',
      statusSummary: '建议先统一处理失败项，再决定是否补跑。',
      stageSummary: '状态层异常阶段摘要',
      issueSummary: '统一状态提示当前异常压力较高。',
      totalIssueCount: 3,
      rerunCount: 0,
      currentFocus: '统一异常摘要已经接管当前重点',
      nextStepLabel: '回首页重新看主链判断',
      nextStepReason: '统一异常摘要建议先处理失败项，再回主链。',
      actionSummary: '状态层异常行动摘要',
      confirmationState: {
        stageLabel: '状态层异常阶段确认',
        canContinue: false,
        hasBlocking: true,
        pendingCount: 1,
        blockingCount: 1,
        confirmedItems: ['状态层异常已确认 1'],
        pendingItems: ['状态层异常待确认 1'],
        blockingItems: ['状态层异常阻塞 1'],
        recommendedReply: '继续，先处理失败项',
        recentEvent: { title: '状态层异常最近事件', summary: '状态层异常最近事件说明' },
        summary: '状态层异常当前还没有完全收口。',
      },
    },
    runtimeSummary: {
      copilotSummary: {
        stageLabel: '异常阶段',
        status: 'bad',
        conclusion: '统一状态已经接管异常判断',
        progressSummary: '副驾驶摘要建议先统一处理失败项，再决定是否补跑。',
        nextActionLabel: '回首页重新看主链判断',
        nextActionSummary: '副驾驶摘要建议先处理失败项，再回主链。',
        recommendedReply: '继续，先处理失败项',
      },
    },
    views: {
      exception: {
        hero: {
          eyebrow: '状态层异常眉题',
          title: '状态层异常标题',
          intro: '状态层异常头部说明',
        },
        context: {
          runLabel: '状态层异常任务',
          phaseLabel: '状态层异常阶段',
          flowLabel: '状态层异常流程',
          counts: [{ label: '状态失败', value: 2 }],
          hints: ['状态层异常提示'],
        },
        heroCards: [
          { label: '状态层异常卡', value: '异常顶部已接管', tone: 'bad', detail: '这是状态层异常指标卡。' },
        ],
        cockpitSummary: {
          title: '驾驶舱摘要',
          copy: '状态层异常驾驶舱说明',
          items: [
            { label: '当前局面', value: '状态层异常局面', summary: '状态层异常局面说明', tone: 'bad' },
            { label: '当前重点', value: '状态层异常重点', summary: '状态层异常重点说明', tone: 'bad' },
            { label: '阻塞情况', value: '状态层异常阻塞', summary: '状态层异常阻塞说明', tone: 'bad' },
          ],
        },
        decision: {
          title: '状态层异常判断',
          copy: '状态层异常判断说明',
          items: [
            { label: '为什么当前这样判断', value: '状态层异常判断来自状态层。' },
            { label: '这一步最该先处理什么', value: '状态层异常当前先处理失败项。' },
          ],
        },
        judgment: {
          title: '状态层异常主判断',
          copy: '状态层异常主判断说明',
          statusLabel: '状态层异常主判断已接管',
          statusSummary: '状态层异常主判断摘要。',
          statusTone: 'bad',
          actionLabel: '状态层异常现在动作',
          actionSummary: '状态层异常现在动作说明。',
          replyLabel: '继续，先处理失败项',
          confirmItems: ['状态层异常判断待确认 1'],
          noteItems: ['状态层异常判断提醒 1'],
        },
        summary: {
          enabled: false,
          title: '状态层异常摘要',
          copy: '状态层异常摘要说明',
          items: [
            { label: '当前状态', value: '状态层异常摘要来自状态层。' },
          ],
        },
        stageRelay: {
          title: '状态层异常交接',
          copy: '状态层异常交接说明',
          previousTitle: '状态层异常来自结果页',
          previousLabel: '状态层异常已接住上一站',
          previousSummary: '状态层异常上一站说明。',
          previousItems: ['状态层异常已承接'],
          currentTitle: '状态层异常当前职责',
          currentLabel: '状态层异常现在先做',
          currentSummary: '状态层异常当前职责说明。',
          currentItems: ['状态层异常当前项 1'],
          nextTitle: '状态层异常下一步',
          nextLabel: '状态层异常回主链',
          nextSummary: '状态层异常准备送回主链。',
          nextItems: ['状态层异常下一项 1'],
        },
        collaboration: {
          title: '状态层异常协同',
          copy: '状态层异常协同说明',
          recentTitle: '状态层异常最近变化',
          recentSummary: '状态层异常最近变化摘要。',
          recentItems: ['状态层异常已收口'],
          confirmTitle: '状态层异常还差确认',
          confirmSummary: '状态层异常确认摘要。',
          confirmItems: ['状态层异常协同待确认 1'],
          replyTitle: '状态层异常回话术',
          primarySay: '继续，先处理失败项',
          replyReason: '状态层异常先收失败项。',
          alternativeSayItems: ['继续，回结果工作台复核'],
        },
        route: {
          title: '现在继续',
          copy: '统一异常路线说明',
          previous: { label: '状态层结果入口', summary: '先回统一结果层。', file: resultWorkspaceFile, cta: '回结果工作台' },
          nextSteps: [
            { kicker: '推荐下一步', label: '状态层首页入口', summary: '统一异常视图已接管下一步。', file: workspaceHomeFile, cta: '回首页继续' },
          ],
        },
        workbench: {
          title: '可进入的页面',
          copy: '统一异常工作台入口',
          cards: [
            { label: '状态层结果入口', value: '回主链', summary: '统一异常入口已接管结果回退。', file: resultWorkspaceFile, cta: '回结果工作台', tone: 'good' },
          ],
        },
        assetStatus: {
          title: '状态层异常资产',
          copy: '状态层异常资产说明',
          readyLabel: '状态层异常可回收',
          readySummary: '状态层异常里仍有可回主链的资产。',
          pendingLabel: '状态层异常待处理',
          pendingSummary: '状态层异常资产仍待收口。',
          items: [
            { label: '状态层异常资产项', value: '异常资产已接管', summary: '状态层异常资产摘要。', tone: 'bad' },
          ],
        },
        actionStatus: {
          title: '状态层异常行动',
          copy: '状态层异常行动说明',
          primary: { kicker: '现在先做', title: '状态层异常主动作', summary: '状态层异常先做这一步。', file: resultWorkspaceFile, cta: '先回结果层', tone: 'bad' },
          secondary: [
            { kicker: '辅助动作', title: '状态层异常辅助动作', summary: '状态层异常辅助动作说明。', file: workspaceHomeFile, cta: '再看首页', tone: 'info' },
          ],
          notes: ['状态层异常注意点'],
        },
        dialogueStatus: {
          title: '对话协同',
          copy: '状态层异常对话协同说明',
          recentTitle: '系统刚接住',
          understoodTitle: '系统已理解',
          confirmTitle: '回主链前你还要确认',
          nextSayTitle: '回到对话框直接说',
          recentItems: ['状态层异常最近一步'],
          understoodItems: ['状态层异常已理解 1'],
          confirmItems: ['是否先处理失败项', '阻塞确认: 失败项会直接阻塞主链继续'],
          nextSayItems: ['继续，先处理失败项'],
        },
        summary: {
          enabled: false,
          title: '状态层异常摘要',
          copy: '状态层异常摘要说明',
          items: [
            { label: '状态层异常摘要项', value: '状态层异常摘要已隐藏' },
          ],
        },
        handoffFromPrevious: {
          title: '状态层异常来自结果页',
          copy: '状态层异常已接住上一站',
          confirmedTitle: '状态层异常已承接',
          nextFocusTitle: '状态层异常现在先做',
          confirmedItems: ['状态层异常已承接 1'],
          nextFocusItems: ['状态层异常现在先做 1'],
        },
        handoffToNext: {
          title: '状态层异常回主链',
          copy: '状态层异常准备送回主链',
          confirmedTitle: '状态层异常已收口',
          nextFocusTitle: '状态层主链先看',
          confirmedItems: ['状态层异常已收口 1'],
          nextFocusItems: ['状态层主链先看 1'],
        },
        sections: {
          issues: {
            title: '状态层异常问题列表',
            copy: '状态层异常问题说明',
            emptyText: '状态层异常当前无问题',
            failedFallbackSummary: '状态层失败项兜底说明',
            reviewFallbackSummary: '状态层待复核兜底说明',
          },
        },
      },
    },
    routes: {
      result: resultWorkspaceFile,
      home: workspaceHomeFile,
    },
  }, null, 2));

  fs.writeFileSync(workspaceAssetsFile, JSON.stringify({
    assetCollections: {
      userFacing: {
        preview: [],
        result: [],
        exception: [
          {
            title: '状态层失败项',
            slotId: 'shot_3',
            requestMode: 'masked-edit',
            error: 'provider timeout',
          },
          {
            title: '状态层第二失败项',
            slotId: 'shot_5',
            requestMode: 'reference-assisted',
            error: 'invalid mask bounds',
          },
        ],
        review: [
          {
            title: '状态层待复核项',
            slotId: 'shot_4',
            requestMode: 'reference-assisted',
          },
        ],
        reference: [],
      },
      system: {
        keyFiles: {},
      },
    },
  }, null, 2));
  fs.writeFileSync(workspaceTimelineFile, JSON.stringify({
    events: [
      { type: 'execution_completed', title: '状态层异常时间线 1', summary: '状态层异常时间线说明 1', time: '2026-05-20T10:00:00.000Z' },
      { type: 'paused', title: '状态层异常时间线 2', summary: '状态层异常时间线说明 2', time: '2026-05-20T11:00:00.000Z' },
    ],
  }, null, 2));

  runNode('render_exception_workspace.js', [
    '--manifest-file', manifestFile,
    '--output-file', exceptionWorkspaceFile,
  ]);

  const html = fs.readFileSync(exceptionWorkspaceFile, 'utf8');
  assert.match(html, /副驾驶摘要建议先统一处理失败项，再决定是否补跑。/);
  assert.match(html, /副驾驶摘要建议先处理失败项，再回主链。/);
  assert.match(html, /继续，先处理失败项/);
  assert.match(html, /状态层异常眉题/);
  assert.match(html, /状态层异常标题/);
  assert.match(html, /状态层异常头部说明/);
  assert.match(html, /统一状态已经接管异常判断/);
  assert.match(html, /状态层异常任务/);
  assert.match(html, /状态层异常阶段/);
  assert.match(html, /状态层异常流程/);
  assert.match(html, /状态失败 2/);
  assert.match(html, /状态层异常提示/);
  assert.match(html, /状态层异常阶段摘要/);
  assert.match(html, /统一异常摘要已经接管当前重点/);
  assert.match(html, /统一异常摘要建议先处理失败项，再回主链/);
  assert.match(html, /状态层异常卡/);
  assert.match(html, /异常顶部已接管/);
  assert.match(html, /状态层异常主判断已接管/);
  assert.match(html, /状态层异常问题列表/);
  assert.match(html, /状态层异常问题说明/);
  assert.match(html, /推荐下一步/);
  assert.doesNotMatch(html, /状态层异常资产/);
  assert.doesNotMatch(html, /状态层异常资产说明/);
  assert.doesNotMatch(html, /状态层异常资产项/);
  assert.doesNotMatch(html, /异常资产已接管/);
  assert.doesNotMatch(html, /状态层异常行动/);
  assert.doesNotMatch(html, /状态层异常行动说明/);
  assert.doesNotMatch(html, /状态层异常主动作/);
  assert.doesNotMatch(html, /备用入口/);
  assert.doesNotMatch(html, /状态层异常辅助动作/);
  assert.doesNotMatch(html, /状态层异常注意点/);
  assert.doesNotMatch(html, /回到对话框直接说/);
  assert.doesNotMatch(html, /复制这句/);
  assert.match(html, /驾驶舱摘要/);
  assert.match(html, /状态层异常驾驶舱说明/);
  assert.match(html, /当前重点/);
  assert.match(html, /状态层异常主判断/);
  assert.match(html, /状态层异常主判断已接管/);
  assert.doesNotMatch(html, /状态层异常现在动作/);
  assert.match(html, /状态层异常判断待确认 1/);
  assert.doesNotMatch(html, /阶段确认/);
  assert.match(html, /阶段时间线/);
  assert.match(html, /状态层异常时间线 1/);
  assert.match(html, /状态层异常时间线 2/);
  assert.doesNotMatch(html, /系统刚接住/);
  assert.doesNotMatch(html, /为什么当前这样判断|如果暂不处理，主要风险是什么/);
  assert.match(html, /状态层异常已收口/);
  assert.match(html, /状态层异常已收口/);
  assert.match(html, /统一异常工作台入口|按需再看/);
  assert.match(html, /这里只保留一个主跳转|统一异常路线说明/);
  assert.match(html, /当前判断/);
  assert.match(html, /这页先看什么/);
  assert.match(html, /异常工作台只保留真正会影响主链继续的问题/);
  assert.match(html, /主入口/);
  assert.match(html, /这一站负责什么/);
  assert.match(html, /哪些内容先后退/);
  assert.match(html, /状态层失败项/);
  assert.match(html, /状态层第二失败项/);
  assert.match(html, /状态层待复核项/);
  assert.match(html, /DAOGE 异常工作台/);
  assert.doesNotMatch(html, /先做这一步/);
  assert.match(html, /统一异常工作台入口|按需再看/);
  assert.doesNotMatch(html, /<h2>异常摘要<\/h2>/);
  assert.doesNotMatch(html, /当前 Run|推荐动作|异常层主控|异常层视图/);
});

test('render_run_record prefers workspace state and timeline when available', () => {
  const tempDir = makeTempDir('interactive-image-batch-run-record-state-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const workspaceStateFile = path.join(outputDir, 'workspace_state.json');
  const workspaceTimelineFile = path.join(outputDir, 'workspace_timeline.json');
  const runRecordHtmlFile = path.join(outputDir, 'run_record.html');
  const runRecordMarkdownFile = path.join(outputDir, 'run_record.md');
  const resultWorkspaceFile = path.join(outputDir, 'result_workspace.html');
  const exceptionWorkspaceFile = path.join(outputDir, 'exception_workspace.html');

  fs.writeFileSync(resultWorkspaceFile, '<html>result</html>');
  fs.writeFileSync(exceptionWorkspaceFile, '<html>exception</html>');

  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    success: 1,
    failed: 0,
    selectedCount: 0,
    batchCount: 0,
    generatedAt: '2026-05-20T10:00:00.000Z',
  }, null, 2));

  fs.writeFileSync(workspaceStateFile, JSON.stringify({
    taskLabel: '统一档案任务',
    status: {
      phase: '结果阶段',
      tone: 'warn',
      headline: '统一状态已经接管档案判断',
      summary: '建议先处理待复核项，再决定是否继续收口。',
    },
    counts: {
      selected: 7,
      success: 5,
      failed: 1,
      needsReview: 2,
      batches: 3,
      stages: 2,
    },
    nextAction: {
      label: '进入异常工作台',
      reason: '统一状态建议先回异常工作台收口问题。',
      target: 'exception_workspace.html',
    },
    routes: {
      result: resultWorkspaceFile,
      exception: exceptionWorkspaceFile,
      home: path.join(outputDir, 'workspace_home.html'),
    },
    assetLayers: {
      userWorkbenchProtocol: {
        defaultEntryLabel: '工作台首页',
        supportEntryLabel: '任务档案页',
        defaultVisibleLabels: ['工作台首页', '准备工作台', '结果工作台', '异常工作台'],
        taskCenterCopy: '默认先从工作台首页进入，再顺着准备、结果、异常三站推进；任务档案只作为按需补充入口。',
        runtimeRule: '工作台页面优先读取 workspace_live_state.json，派生快照只保留旧读取作用。',
        summary: '默认先看工作台首页、准备工作台、结果工作台、异常工作台；任务档案按需打开；workspace_live_state.json 是主实时状态源，workbench_state.json 只作派生快照。',
        stateSources: {
          primaryRuntimeSource: path.join(outputDir, 'workspace_live_state.json'),
          derivedWorkbenchSnapshot: path.join(outputDir, 'workbench_state.json'),
        },
      },
    },
  }, null, 2));

  fs.writeFileSync(workspaceTimelineFile, JSON.stringify({
    events: [
      {
        type: 'prepare_completed',
        title: '准备阶段已生成',
        summary: '准备工作台已经可用。',
        time: '2026-05-20T09:00:00.000Z',
      },
      {
        type: 'execution_completed',
        title: '执行阶段已完成',
        summary: '结果工作台已经可用。',
        time: '2026-05-20T10:30:00.000Z',
      },
    ],
  }, null, 2));

  runNode('render_run_record.js', [
    '--manifest-file', manifestFile,
    '--html-file', runRecordHtmlFile,
    '--markdown-file', runRecordMarkdownFile,
  ]);

  const html = fs.readFileSync(runRecordHtmlFile, 'utf8');
  const markdown = fs.readFileSync(runRecordMarkdownFile, 'utf8');
  assert.match(html, /统一状态已经接管档案判断/);
  assert.match(html, /统一状态建议先回异常工作台收口问题/);
  assert.match(html, /档案摘要/);
  assert.match(html, /现在继续/);
  assert.match(html, /可进入的页面/);
  assert.match(html, /阶段时间线/);
  assert.match(html, /普通用户不用翻内部记录/);
  assert.match(html, /维护者诊断位置/);
  assert.match(html, /普通用户不用打开/);
  assert.match(html, /准备阶段已生成/);
  assert.match(html, /执行阶段已完成/);
  assert.match(html, /默认先看/);
  assert.match(html, /工作台首页 -&gt; 准备工作台 -&gt; 结果工作台 -&gt; 异常工作台/);
  assert.match(html, /workspace_live_state\.json/);
  assert.match(html, /workbench_state\.json/);
  assert.doesNotMatch(html, /当前 Run|下一步入口|任务中心/);
  assert.match(markdown, /阶段时间线/);
  assert.match(markdown, /准备阶段已生成/);
  assert.match(markdown, /执行阶段已完成/);
  assert.match(markdown, /默认先看: 工作台首页 -> 准备工作台 -> 结果工作台 -> 异常工作台/);
  assert.match(markdown, /主状态源: .*workspace_live_state\.json/);
  assert.match(markdown, /高级补充页: 已后退到 prepare-details \/ result-details \/ all 模式/);
  assert.match(markdown, /维护者诊断位置/);
  assert.match(markdown, /普通用户不用打开/);
  assert.doesNotMatch(html, /回主控|进入整板页/);
  assert.doesNotMatch(html, /进入分镜补充页/);
  assert.doesNotMatch(markdown, /- 分镜整板页:|- 分镜整板补充页:/);
});

test('render_run_record can prefer unified workbench_state snapshot', () => {
  const tempDir = makeTempDir('interactive-image-batch-run-record-workbench-state-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const runRecordHtmlFile = path.join(outputDir, 'run_record.html');
  const runRecordMarkdownFile = path.join(outputDir, 'run_record.md');
  const resultWorkspaceFile = path.join(outputDir, 'result_workspace.html');
  const exceptionWorkspaceFile = path.join(outputDir, 'exception_workspace.html');
  const workbenchStateFile = path.join(outputDir, 'workbench_state.json');

  fs.writeFileSync(resultWorkspaceFile, '<html>result</html>');
  fs.writeFileSync(exceptionWorkspaceFile, '<html>exception</html>');
  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    success: 1,
    failed: 0,
    selectedCount: 0,
    batchCount: 0,
    generatedAt: '2026-05-20T10:00:00.000Z',
  }, null, 2));
  fs.writeFileSync(workbenchStateFile, JSON.stringify({
    kind: 'daoge-workbench-state',
    schemaVersion: 1,
    generatedAt: '2026-05-20T10:30:00.000Z',
    outputDir,
    taskLabel: '统一快照档案任务',
    status: {
      phase: '结果阶段',
      tone: 'warn',
      headline: '统一快照已经接管档案判断',
      summary: '统一快照建议先回异常工作台收口问题。',
    },
    counts: {
      selected: 7,
      success: 5,
      failed: 1,
      needsReview: 2,
      batches: 3,
      stages: 2,
    },
    nextAction: {
      label: '进入异常工作台',
      reason: '统一快照建议先回异常工作台收口问题。',
      target: 'exception_workspace.html',
    },
    routes: {
      result: resultWorkspaceFile,
      exception: exceptionWorkspaceFile,
      home: path.join(outputDir, 'workspace_home.html'),
    },
    timeline: {
      events: [
        {
          type: 'prepare_completed',
          title: '统一快照准备阶段已生成',
          summary: '统一快照准备工作台已经可用。',
          time: '2026-05-20T09:00:00.000Z',
        },
        {
          type: 'execution_completed',
          title: '统一快照执行阶段已完成',
          summary: '统一快照结果工作台已经可用。',
          time: '2026-05-20T10:30:00.000Z',
        },
      ],
    },
  }, null, 2));

  runNode('render_run_record.js', [
    '--manifest-file', manifestFile,
    '--html-file', runRecordHtmlFile,
    '--markdown-file', runRecordMarkdownFile,
  ]);

  const html = fs.readFileSync(runRecordHtmlFile, 'utf8');
  const markdown = fs.readFileSync(runRecordMarkdownFile, 'utf8');
  assert.match(html, /统一快照已经接管档案判断/);
  assert.match(html, /统一快照建议先回异常工作台收口问题/);
  assert.match(html, /统一快照准备阶段已生成/);
  assert.match(html, /统一快照执行阶段已完成/);
  assert.match(markdown, /统一快照准备阶段已生成/);
  assert.match(markdown, /统一快照执行阶段已完成/);
  assert.match(markdown, /高级补充页: 已后退到 prepare-details \/ result-details \/ all 模式/);
  assert.doesNotMatch(html, /回主控|进入整板页/);
  assert.doesNotMatch(html, /进入分镜补充页/);
  assert.doesNotMatch(markdown, /- 分镜整板页:|- 分镜整板补充页:/);
});

test('render_completion_board writes html completion summary', () => {
  const tempDir = makeTempDir('interactive-image-batch-completion-board-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const reviewBoardFile = path.join(outputDir, 'review_board.html');
  const storyboardBoardFile = path.join(outputDir, 'storyboard_board.html');
  const boardFile = path.join(outputDir, 'completion_board.html');

  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    success: 2,
    failed: 1,
    skipped: 0,
    batchCount: 2,
    defaultSize: '1024x1024',
    model: 'gpt-image-2',
    promptSource: path.join(outputDir, 'prompts.generated.json'),
    batches: [
      {
        results: [
          { ok: true, index: '001', title: 'Keep Item', output: path.join(outputDir, 'keep.png'), slotId: 'shot_1' },
          { ok: true, index: '002', title: 'Review Item', output: path.join(outputDir, 'review.png'), slotId: 'shot_2', requestMode: 'masked-edit' },
          { ok: false, index: '003', title: 'Failed Item', error: 'provider timeout', slotId: 'shot_3' }
        ]
      }
    ]
  }, null, 2));
  fs.writeFileSync(reviewBoardFile, '<html>review</html>');
  fs.writeFileSync(storyboardBoardFile, '<html>storyboard</html>');

  runNode('render_completion_board.js', [
    '--manifest-file', manifestFile,
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  assert.match(html, /DAOGE 完成摘要补充页/);
  assert.match(html, /当前定位/);
  assert.match(html, /完成页定位/);
  assert.match(html, /看完摘要后，建议这样走/);
  assert.match(html, /完成摘要入口/);
  assert.match(html, /完成概览/);
  assert.match(html, /结果样例/);
  assert.match(html, /回结果工作台/);
  assert.doesNotMatch(html, /结果说明文档|进入审阅看板|进入分镜整板补充页/);
  assert.doesNotMatch(html, /结果主链进度/);
  assert.doesNotMatch(html, /完成主控/);
});

test('render_preflight_board writes html preflight summary', () => {
  const tempDir = makeTempDir('interactive-image-batch-preflight-board-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const taskSpecFile = path.join(outputDir, 'task_spec.normalized.json');
  const strategyFile = path.join(outputDir, 'prompt_strategy.enriched.json');
  const promptsFile = path.join(outputDir, 'prompts.generated.json');
  const validationFile = path.join(outputDir, 'prompt_validation_report.json');
  const previewFile = path.join(outputDir, 'prompt_preview.md');
  const summaryFile = path.join(outputDir, 'daoge_run_summary.md');
  const planFile = path.join(outputDir, 'batch_plan.json');
  const modeFile = path.join(outputDir, 'daoge_mode_detection.json');
  const boardFile = path.join(outputDir, 'preflight_board.html');

  fs.writeFileSync(taskSpecFile, JSON.stringify({
    content_brief: '高端运动品牌广告海报',
    output_mode: 'prompt-only',
    total_count: 4,
    width: 1024,
    height: 1024,
    batch_size: 2,
    concurrency: 2,
    retry_count: 1,
    timeout_seconds: 300,
    output_format: 'png',
    provider: 'openai',
    require_confirmation: true,
    style_requirements: ['高级质感', '品牌海报'],
    variation_requirements: ['不同构图', '不同场景'],
    source_images: [],
  }, null, 2));
  fs.writeFileSync(strategyFile, JSON.stringify({
    template_variant: { id: 'hero-poster', name: 'Hero Poster' },
  }, null, 2));
  fs.writeFileSync(promptsFile, JSON.stringify([
    { index: '001', title: 'Poster 1', style_family: 'brand', scene: 'studio', wardrobe: 'coat', composition: 'full body' },
    { index: '002', title: 'Poster 2', style_family: 'brand', scene: 'urban', wardrobe: 'jacket', composition: 'wide shot' },
  ], null, 2));
  fs.writeFileSync(validationFile, JSON.stringify({
    ok: true,
    promptCount: 2,
    errors: [],
    warnings: [],
    missing: {},
    duplicatePromptCount: 0,
    slugCollisions: [],
    distributions: {
      style_family: [{ name: 'brand', count: 2 }],
      scene: [{ name: 'studio', count: 1 }, { name: 'urban', count: 1 }],
      wardrobe: [{ name: 'coat', count: 1 }, { name: 'jacket', count: 1 }],
      composition: [{ name: 'full body', count: 1 }, { name: 'wide shot', count: 1 }],
    },
    qualityGates: {
      strict: false,
      shortPrompts: [],
      nearDuplicatePairs: [],
      templateMissing: {},
      sizeIssues: [],
    },
  }, null, 2));
  fs.writeFileSync(previewFile, '# Prompt Preview\n');
  fs.writeFileSync(summaryFile, '# Summary\n');
  fs.writeFileSync(planFile, JSON.stringify([
    { batchNumber: 1, promptCount: 2, firstIndex: '001', lastIndex: '002' },
    { batchNumber: 2, promptCount: 2, firstIndex: '003', lastIndex: '004' },
  ], null, 2));
  fs.writeFileSync(modeFile, JSON.stringify({
    detected_mode: 'prepare-only',
    detected_template: {
      id: 'campaign-poster',
      name: 'Campaign Poster',
      template_doc: 'references/templates/poster-and-campaigns/campaign-poster.md',
    },
  }, null, 2));

  runNode('render_preflight_board.js', [
    '--task-spec', taskSpecFile,
    '--strategy-file', strategyFile,
    '--prompts-file', promptsFile,
    '--validation-report', validationFile,
    '--preview-file', previewFile,
    '--plan-file', planFile,
    '--summary-file', summaryFile,
    '--mode-file', modeFile,
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  const sharedCss = fs.readFileSync(path.join(outputDir, 'portal_shared.css'), 'utf8');
  assert.match(html, /DAOGE 预检补充页/);
  assert.match(html, /预检总览已经退到准备补充页层/);
  assert.match(html, /预检补充判断/);
  assert.match(html, /预检补充页，先看这里/);
  assert.match(html, /预检补充页看完后，回准备主链/);
  assert.match(html, /不再承担准备总控/);
  assert.match(html, /放行结论/);
  assert.match(html, /任务概览/);
  assert.match(html, /执行参数/);
  assert.match(html, /质量门禁/);
  assert.match(html, /继续下一步/);
  assert.match(html, /预检补充页浏览模式/);
  assert.match(html, /准备主链进度/);
  assert.doesNotMatch(html, /DAOGE Preflight Board/);
  assert.doesNotMatch(html, /<h2>预检主控<\/h2>/);
  assert.match(sharedCss, /\.portal-workbench/);
  assert.match(sharedCss, /padding: 12px 13px/);
});

test('render_preflight_board can prefer unified workbench_state snapshot', () => {
  const tempDir = makeTempDir('interactive-image-batch-preflight-board-workbench-state-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const taskSpecFile = path.join(outputDir, 'task_spec.normalized.json');
  const strategyFile = path.join(outputDir, 'prompt_strategy.enriched.json');
  const promptsFile = path.join(outputDir, 'prompts.generated.json');
  const validationFile = path.join(outputDir, 'prompt_validation_report.json');
  const previewFile = path.join(outputDir, 'prompt_preview.md');
  const summaryFile = path.join(outputDir, 'daoge_run_summary.md');
  const planFile = path.join(outputDir, 'batch_plan.json');
  const modeFile = path.join(outputDir, 'daoge_mode_detection.json');
  const boardFile = path.join(outputDir, 'preflight_board.html');
  const prepareWorkspaceFile = path.join(outputDir, 'prepare_workspace.html');
  const workbenchStateFile = path.join(outputDir, 'workbench_state.json');

  fs.writeFileSync(taskSpecFile, JSON.stringify({
    output_mode: 'prompt-only',
    total_count: 4,
    width: 1024,
    height: 1024,
    batch_size: 2,
    concurrency: 2,
    retry_count: 1,
    timeout_seconds: 300,
    output_format: 'png',
    provider: 'openai',
    require_confirmation: true,
    source_images: [],
  }, null, 2));
  fs.writeFileSync(strategyFile, JSON.stringify({
    template_variant: { id: 'hero-poster', name: 'Hero Poster' },
  }, null, 2));
  fs.writeFileSync(promptsFile, JSON.stringify([
    { index: '001', title: 'Poster 1', style_family: 'brand', scene: 'studio' },
    { index: '002', title: 'Poster 2', style_family: 'brand', scene: 'urban' },
  ], null, 2));
  fs.writeFileSync(validationFile, JSON.stringify({
    ok: true,
    promptCount: 2,
    errors: [],
    warnings: [],
    missing: {},
    duplicatePromptCount: 0,
    slugCollisions: [],
    qualityGates: {
      shortPrompts: [],
      nearDuplicatePairs: [],
      templateMissing: {},
      sizeIssues: [],
    },
  }, null, 2));
  fs.writeFileSync(previewFile, '# Prompt Preview\n');
  fs.writeFileSync(summaryFile, '# Summary\n');
  fs.writeFileSync(planFile, JSON.stringify([
    { batchNumber: 1, promptCount: 2, firstIndex: '001', lastIndex: '002' },
  ], null, 2));
  fs.writeFileSync(modeFile, JSON.stringify({
    detected_mode: 'prepare-only',
    detected_template: {
      id: 'campaign-poster',
      name: 'Campaign Poster',
    },
  }, null, 2));
  fs.writeFileSync(prepareWorkspaceFile, '<html>prepare</html>');
  fs.writeFileSync(workbenchStateFile, JSON.stringify({
    kind: 'daoge-workbench-state',
    schemaVersion: 1,
    generatedAt: '2026-05-24T13:00:00.000Z',
    outputDir,
    taskLabel: '统一快照预检任务',
    status: {
      phase: '准备阶段',
      headline: '统一快照已经接管预检说明',
      summary: '统一快照建议先回准备工作台确认主链，再决定是否放行。',
      tone: 'warn',
    },
    counts: {
      selected: 2,
      batches: 1,
    },
    nextAction: {
      label: '回准备工作台',
      reason: '统一快照建议先回准备主链确认当前局面。',
      target: 'prepare_workspace.html',
    },
    routes: {
      prepare: prepareWorkspaceFile,
    },
  }, null, 2));

  runNode('render_preflight_board.js', [
    '--task-spec', taskSpecFile,
    '--strategy-file', strategyFile,
    '--prompts-file', promptsFile,
    '--validation-report', validationFile,
    '--preview-file', previewFile,
    '--plan-file', planFile,
    '--summary-file', summaryFile,
    '--mode-file', modeFile,
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  assert.match(html, /统一快照预检任务/);
  assert.match(html, /统一快照已经接管预检说明/);
  assert.match(html, /统一快照建议先回准备工作台确认主链，再决定是否放行。/);
  assert.match(html, /统一快照建议先回准备主链确认当前局面。/);
});

test('render_prepare_workspace prefers prepare summary from workspace state when available', () => {
  const tempDir = makeTempDir('interactive-image-batch-prepare-workspace-state-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const workspaceStateFile = path.join(outputDir, 'workspace_state.json');
  const workspaceAssetsFile = path.join(outputDir, 'workspace_assets.json');
  const workspaceTimelineFile = path.join(outputDir, 'workspace_timeline.json');
  const prepareWorkspaceFile = path.join(outputDir, 'prepare_workspace.html');
  const workspaceHomeFile = path.join(outputDir, 'workspace_home.html');

  fs.writeFileSync(workspaceHomeFile, '<html>workspace</html>');
  fs.writeFileSync(workspaceStateFile, JSON.stringify({
    taskLabel: '统一准备任务',
    status: {
      phase: '准备阶段',
      tone: 'warn',
      summary: '统一状态建议再收一轮后执行。',
    },
    counts: {
      selected: 8,
      batches: 4,
    },
    prepare: {
      templateName: '财经口播整板',
      modeLabel: '分镜整板阶段',
      mainDirection: '主持人口播解释',
      styleDirection: '高端财经演播室',
      sceneDirection: '蓝金演播室',
      promptCount: 8,
      batchCount: 4,
      importedBindingCount: 3,
      assetCount: 5,
      readiness: {
        tone: 'warn',
        label: '可以执行，但建议再收一轮',
        detail: '统一准备摘要已经接管放行判断。',
        blockingItems: [],
        cautionItems: ['当前有 2 条提醒'],
      },
      confirmationState: {
        stageLabel: '状态层准备阶段确认',
        canContinue: true,
        hasBlocking: false,
        pendingCount: 1,
        blockingCount: 0,
        confirmedItems: ['状态层准备已确认 1'],
        pendingItems: ['状态层准备待确认 1'],
        blockingItems: [],
        recommendedReply: '继续，进入结果工作台',
        recentEvent: { title: '状态层准备最近事件', summary: '状态层准备最近事件说明' },
        summary: '状态层准备当前可以继续。',
      },
    },
    runtimeSummary: {
      copilotSummary: {
        stageLabel: '准备阶段',
        status: 'warn',
        conclusion: '统一准备摘要已经接管放行判断。',
        progressSummary: '副驾驶摘要建议再收一轮后执行。',
        nextActionLabel: '进入异常工作台',
        nextActionSummary: '副驾驶摘要希望先去异常层统一复核风险。',
        recommendedReply: '继续，进入结果工作台',
      },
    },
    views: {
      prepare: {
        hero: {
          eyebrow: '状态层准备眉题',
          title: '状态层准备标题',
          intro: '状态层准备头部说明',
        },
        context: {
          runLabel: '状态层准备任务',
          phaseLabel: '状态层准备阶段',
          flowLabel: '状态层准备流程',
          counts: [{ label: '状态批次', value: 4 }],
          hints: ['状态层准备提示'],
        },
        heroCards: [
          { label: '状态层准备卡', value: '准备顶部已接管', tone: 'warn', detail: '这是状态层准备指标卡。' },
        ],
        route: {
          title: '先做这一步',
          copy: '统一准备路线说明',
          previous: { label: '状态层首页', summary: '先回统一首页。', file: workspaceHomeFile, cta: '回工作台首页' },
          nextSteps: [
            { kicker: '推荐下一步', label: '状态层结果入口', summary: '统一准备视图已接管下一步。', file: path.join(outputDir, 'result_workspace.html'), cta: '先去结果层', pendingLabel: '执行完成后生成' },
          ],
        },
        workbench: {
          title: '可进入的页面',
          copy: '统一准备工作台入口',
          cards: [
            { label: '状态层放行判断', value: '建议再收一轮', summary: '统一准备入口已接管放行判断。', tone: 'warn', hideLinkIfMissing: true },
          ],
        },
        assetStatus: {
          title: '状态层准备资产',
          copy: '状态层准备资产说明',
          readyLabel: '状态层准备已到位',
          readySummary: '状态层准备资产可直接进入判断。',
          pendingLabel: '状态层准备待确认',
          pendingSummary: '状态层准备仍有少量风险项。',
          items: [
            { label: '状态层准备资产项', value: '准备资产已接管', summary: '状态层准备资产摘要。', tone: 'good' },
          ],
        },
        actionStatus: {
          title: '状态层准备行动',
          copy: '状态层准备行动说明',
          primary: { kicker: '现在先做', title: '状态层准备主动作', summary: '状态层准备先做这一步。', file: workspaceHomeFile, cta: '先回首页', tone: 'warn' },
          secondary: [
            { kicker: '辅助动作', title: '状态层准备辅助动作', summary: '状态层准备辅助动作说明。', file: workspaceHomeFile, cta: '再看一眼', tone: 'info' },
          ],
          notes: ['状态层准备注意点'],
        },
        dialogueStatus: {
          title: '对话协同',
          copy: '状态层准备对话协同说明',
          recentTitle: '系统刚接住',
          understoodTitle: '系统已理解',
          confirmTitle: '开跑前你还要确认',
          nextSayTitle: '回到对话框直接说',
          recentItems: ['状态层准备最近一步'],
          understoodItems: ['状态层准备已理解 1'],
          confirmItems: ['是否直接进入结果工作台'],
          nextSayItems: ['继续，进入结果工作台'],
        },
        transitionStatus: {
          title: '状态层准备交接',
          copy: '状态层准备交接说明',
          confirmedTitle: '状态层准备已确认',
          nextFocusTitle: '状态层准备下一步',
          confirmedItems: ['状态层准备已交接 1'],
          nextFocusItems: ['状态层准备先看 1'],
        },
      },
    },
  }, null, 2));
  fs.writeFileSync(workspaceAssetsFile, JSON.stringify({
    assetCollections: {
      userFacing: {
        preview: [],
        result: [],
        review: [],
        exception: [],
        reference: [],
      },
      system: {
        keyFiles: {},
      },
    },
  }, null, 2));
  fs.writeFileSync(workspaceTimelineFile, JSON.stringify({
    events: [
      { type: 'prepare_completed', title: '状态层准备时间线 1', summary: '状态层准备时间线说明 1', time: '2026-05-20T09:00:00.000Z' },
      { type: 'execution_completed', title: '状态层准备时间线 2', summary: '状态层准备时间线说明 2', time: '2026-05-20T10:00:00.000Z' },
    ],
  }, null, 2));

  runNode('render_prepare_workspace.js', [
    '--output-dir', outputDir,
    '--output-file', prepareWorkspaceFile,
  ]);

  const html = fs.readFileSync(prepareWorkspaceFile, 'utf8');
  assert.match(html, /状态层准备眉题/);
  assert.match(html, /状态层准备标题/);
  assert.match(html, /状态层准备头部说明/);
  assert.match(html, /状态层准备任务/);
  assert.match(html, /状态层准备阶段/);
  assert.match(html, /状态层准备流程/);
  assert.match(html, /放行判断/);
  assert.match(html, /状态层准备提示/);
  assert.match(html, /状态层准备卡/);
  assert.match(html, /准备顶部已接管/);
  assert.match(html, /统一准备摘要已经接管放行判断/);
  assert.match(html, /副驾驶摘要建议再收一轮后执行。/);
  assert.match(html, /副驾驶摘要希望先去异常层统一复核风险。/);
  assert.match(html, /继续，进入结果工作台/);
  assert.match(html, /当前结论/);
  assert.match(html, /当前重点/);
  assert.match(html, /下一步/);
  assert.match(html, /推荐下一步/);
  assert.match(html, /素材约束/);
  assert.match(html, /素材绑定|素材约束|准备资产已接管/);
  assert.match(html, /当前有 2 条提醒/);
  assert.match(html, /展开按需补充/);
  assert.doesNotMatch(html, /页面交接/);
  assert.match(html, /状态层准备交接说明/);
  assert.doesNotMatch(html, /回到对话框直接说/);
  assert.match(html, /复制这句/);
  assert.match(html, /驾驶舱摘要/);
  assert.match(html, /当前重点/);
  assert.doesNotMatch(html, /阶段确认/);
  assert.match(html, /阶段时间线/);
  assert.match(html, /状态层准备时间线 1/);
  assert.match(html, /状态层准备时间线 2/);
  assert.doesNotMatch(html, /系统刚接住/);
  assert.doesNotMatch(html, /为什么当前这样判断|如果暂不处理，主要风险是什么|这一页为什么现在最值得看/);
  assert.match(html, /状态层准备交接/);
  assert.match(html, /状态层准备交接说明/);
  assert.match(html, /状态层准备已确认/);
  assert.match(html, /状态层准备下一步/);
  assert.match(html, /状态层结果入口/);
  assert.match(html, /先去结果层|执行完成后生成/);
  assert.match(html, /统一准备摘要已经接管放行判断/);
  assert.match(html, /状态层放行判断/);
  assert.match(html, /这里只保留一个主跳转|统一准备路线说明/);
  assert.match(html, /执行前检查/);
  assert.doesNotMatch(html, /状态层准备资产说明/);
  assert.match(html, /当前任务主链/);
  assert.match(html, /统一准备工作台入口|按需再看|可进入的页面/);
});

test('render_prepare_workspace prefers unified next action when route is not overridden', () => {
  const tempDir = makeTempDir('interactive-image-batch-prepare-workspace-next-action-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const workspaceStateFile = path.join(outputDir, 'workspace_state.json');
  const prepareWorkspaceFile = path.join(outputDir, 'prepare_workspace.html');
  const workspaceHomeFile = path.join(outputDir, 'workspace_home.html');
  const exceptionWorkspaceFile = path.join(outputDir, 'exception_workspace.html');

  fs.writeFileSync(workspaceHomeFile, '<html>workspace</html>');
  fs.writeFileSync(exceptionWorkspaceFile, '<html>exception</html>');
  fs.writeFileSync(workspaceStateFile, JSON.stringify({
    taskLabel: '统一准备跳转任务',
    status: {
      phase: '准备阶段',
      tone: 'warn',
      summary: '准备阶段先确认当前风险。',
    },
    prepare: {
      readiness: {
        tone: 'warn',
        label: '可以执行，但建议再收一轮',
        detail: '先把准备阶段的风险项再看一遍。',
        blockingItems: [],
        cautionItems: ['还有 1 条提醒'],
      },
      nextStepLabel: '进入异常工作台',
      nextStepReason: '这轮准备判断希望先去异常层统一复核风险。',
    },
    routes: {
      home: workspaceHomeFile,
      exception: exceptionWorkspaceFile,
    },
    unifiedStatus: {
      stage: '准备阶段',
      conclusion: '准备阶段建议先复核风险',
      currentFocus: '先把风险收清楚',
      progress: '当前没有硬阻塞，但还有风险项。',
      status: 'warn',
      nextAction: {
        label: '进入异常工作台',
        reason: '这轮准备判断希望先去异常层统一复核风险。',
        target: 'exception_workspace.html',
      },
      dialogue: {
        primarySay: '继续，先去异常工作台',
      },
    },
  }, null, 2));

  runNode('render_prepare_workspace.js', [
    '--output-dir', outputDir,
    '--output-file', prepareWorkspaceFile,
  ]);

  const html = fs.readFileSync(prepareWorkspaceFile, 'utf8');
  assert.match(html, /进入异常工作台/);
  assert.match(html, /这轮准备判断希望先去异常层统一复核风险。/);
});

test('render_workspace_home can prefer unified workbench_state snapshot', () => {
  const tempDir = makeTempDir('interactive-image-batch-workbench-state-home-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const workspaceHomeFile = path.join(outputDir, 'workspace_home.html');
  const workbenchStateFile = path.join(outputDir, 'workbench_state.json');
  const resultWorkspaceFile = path.join(outputDir, 'result_workspace.html');
  const taskCenterFile = path.join(tempDir, 'task_center.html');

  fs.writeFileSync(resultWorkspaceFile, '<html>result</html>');
  fs.writeFileSync(taskCenterFile, '<html>task center</html>');
  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    selectedCount: 2,
    success: 2,
    failed: 0,
    batchCount: 1,
  }, null, 2));

  fs.writeFileSync(workbenchStateFile, JSON.stringify({
    kind: 'daoge-workbench-state',
    schemaVersion: 1,
    generatedAt: '2026-05-24T10:00:00.000Z',
    outputDir,
    taskLabel: '统一快照首页任务',
    mode: 'workspace',
    runtimeMode: 'execution',
    status: {
      phase: '结果阶段',
      tone: 'good',
      summary: '统一快照建议直接进入结果工作台。',
    },
    counts: {
      selected: 2,
      success: 2,
      failed: 0,
      needsReview: 0,
      batches: 1,
    },
    nextAction: {
      label: '进入结果工作台',
      reason: '统一快照已经接管下一步。',
      target: 'result_workspace.html',
    },
    runtimeSummary: {
      copilotSummary: {
        stageLabel: '结果阶段',
        status: 'completed',
        conclusion: '统一快照建议直接进入结果工作台。',
        progressSummary: '统一快照进度摘要已经接管首页说明。',
        nextActionLabel: '进入结果工作台',
        nextActionSummary: '统一快照已经接管下一步。',
        recommendedReply: '继续，进入结果工作台',
      },
    },
    confirmationState: {
      stageLabel: '统一快照阶段确认',
      canContinue: true,
      hasBlocking: false,
      pendingCount: 1,
      blockingCount: 0,
      confirmedItems: ['统一快照已确认 1'],
      pendingItems: ['统一快照待确认 1'],
      blockingItems: [],
      recommendedReply: '继续，进入结果工作台',
      recentEvent: { title: '统一快照最近事件', summary: '统一快照最近事件说明' },
      summary: '统一快照当前可以继续。',
    },
    artifactGovernance: {
      summary: {
        principle: '统一快照已经接管主链入口。',
        defaultEntryLabel: '工作台首页',
      },
      userEntry: [{ id: 'workspace-home' }],
      workspaceSupport: [{ id: 'run-record-html' }],
      internalOnly: [{ id: 'workspace-state' }],
    },
    entryBridge: {
      entryMode: 'intent',
      taskCategory: '分镜与叙事',
      starterIntent: 'oralboard',
      selectedEntry: {
        id: 'oralboard-semiconductor-host',
        title: '半导体口播整板',
        summary: '适合主持人口播整板和故事版任务。',
      },
      context: {
        runLabel: '半导体口播整板',
        phaseLabel: '入口层',
        flowLabel: '中文模板展示板 -> 准备工作台 -> 结果工作台',
        counts: [
          { label: '进入方式', value: '按任务意图进入' },
          { label: '当前任务组', value: '分镜与叙事' },
          { label: '当前意图', value: 'oralboard' },
        ],
        hints: [
          '适合主持人口播整板和故事版任务。',
          '先确认这类整板任务的方向和放行条件。',
        ],
      },
      route: {
        title: '从入口层继续',
        copy: '入口层只负责选任务和选起步入口，确认后就直接进入准备工作台。',
        current: {
          kicker: '当前入口',
          label: '半导体口播整板',
          summary: '适合主持人口播整板和故事版任务。',
        },
        next: {
          kicker: '建议下一步',
          label: '进入准备工作台',
          summary: '先确认这类整板任务的方向和放行条件。',
          file: path.join(outputDir, 'prepare_workspace.html'),
          cta: '继续下一步',
          pendingLabel: '当前还没有生成下一页',
        },
      },
    },
    views: {
      home: {
        hero: {
          eyebrow: '统一快照首页眉题',
          title: '统一快照首页标题',
          intro: '统一快照首页头部说明',
        },
        context: {
          runLabel: '统一快照首页任务',
          phaseLabel: '统一快照首页阶段',
          flowLabel: '统一快照首页流程',
          counts: [{ label: '统一快照提示词', value: 2 }],
          hints: ['统一快照首页提示'],
        },
        heroCards: [
          { label: '统一快照阶段卡', value: '首页快照已接管', tone: 'info', detail: '这是统一快照首页指标卡。' },
        ],
        route: {
          title: '现在继续',
          copy: '统一快照首页路线说明',
          nextSteps: [
            { kicker: '推荐下一步', label: '统一快照结果入口', summary: '统一快照首页已接管下一步。', file: resultWorkspaceFile, cta: '马上进入' },
          ],
        },
        workbench: {
          title: '可进入的页面',
          copy: '统一快照工作台入口',
          cards: [
            { label: '统一快照任务总控', value: '切换任务', summary: '统一快照已接管任务切换入口。', file: taskCenterFile, cta: '回任务总控', tone: 'info' },
          ],
        },
        assetStatus: {
          title: '统一快照首页资产',
          copy: '统一快照首页资产说明',
          readyLabel: '统一快照已就绪',
          readySummary: '统一快照首页资产已可直接使用。',
          pendingLabel: '统一快照待确认',
          pendingSummary: '统一快照首页当前没有额外待确认资产。',
          items: [
            { label: '统一快照首页资产项', value: '首页资产已接管', summary: '统一快照首页资产摘要。', tone: 'good' },
          ],
        },
        actionStatus: {
          title: '统一快照首页行动',
          copy: '统一快照首页行动说明',
          primary: { kicker: '现在先做', title: '统一快照首页主动作', summary: '统一快照首页先做这一步。', file: resultWorkspaceFile, cta: '先去这里', tone: 'good' },
          secondary: [
            { kicker: '辅助动作', title: '统一快照首页辅助动作', summary: '统一快照首页辅助动作说明。', file: taskCenterFile, cta: '顺手看看', tone: 'info' },
          ],
          notes: ['统一快照首页注意点'],
        },
      },
    },
    assets: {
      assetCollections: {
        userFacing: {
          preview: [],
          result: [],
          review: [],
          exception: [],
          reference: [],
        },
        system: {
          keyFiles: {},
        },
      },
      summary: {
        previewCount: 0,
        resultCount: 2,
        reviewCount: 0,
        exceptionCount: 0,
        referenceCount: 0,
      },
    },
    timeline: {
      events: [
        { type: 'prepare_completed', title: '统一快照首页时间线 1', summary: '统一快照首页时间线说明 1', time: '2026-05-20T09:00:00.000Z' },
        { type: 'execution_completed', title: '统一快照首页时间线 2', summary: '统一快照首页时间线说明 2', time: '2026-05-20T10:00:00.000Z' },
      ],
      summary: {
        eventCount: 2,
        latestTitle: '统一快照首页时间线 2',
        latestSummary: '统一快照首页时间线说明 2',
      },
    },
  }, null, 2));

  runNode('render_workspace_home.js', [
    '--manifest-file', manifestFile,
    '--output-file', workspaceHomeFile,
  ]);

  const html = fs.readFileSync(workspaceHomeFile, 'utf8');
  assert.match(html, /统一快照首页眉题/);
  assert.match(html, /统一快照首页标题/);
  assert.match(html, /统一快照首页头部说明/);
  assert.match(html, /统一快照首页任务/);
  assert.match(html, /统一快照首页阶段/);
  assert.match(html, /统一快照首页流程/);
  assert.match(html, /当前局面/);
  assert.match(html, /当前压力/);
  assert.match(html, /当前动作/);
  assert.match(html, /推荐回复/);
  assert.match(html, /当前这轮任务来自入口“半导体口播整板”/);
  assert.match(html, /统一快照首页资产/);
  assert.match(html, /推荐下一步/);
  assert.doesNotMatch(html, /统一快照首页主动作/);
  assert.doesNotMatch(html, /统一快照首页辅助动作/);
  assert.doesNotMatch(html, /统一快照首页注意点/);
  assert.match(html, /统一快照首页时间线 1/);
  assert.match(html, /统一快照首页时间线 2/);
  assert.match(html, /统一快照已经接管下一步。/);
  assert.match(html, /统一快照进度摘要已经接管首页说明。/);
  assert.match(html, /继续，进入结果工作台/);
});

test('render_workspace_home routes to exception first when issue pressure exists', () => {
  const tempDir = makeTempDir('interactive-image-batch-workbench-state-home-issues-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const workspaceHomeFile = path.join(outputDir, 'workspace_home.html');
  const workbenchStateFile = path.join(outputDir, 'workbench_state.json');
  const resultWorkspaceFile = path.join(outputDir, 'result_workspace.html');
  const exceptionWorkspaceFile = path.join(outputDir, 'exception_workspace.html');
  const runRecordFile = path.join(outputDir, 'run_record.html');

  fs.writeFileSync(resultWorkspaceFile, '<html>result</html>');
  fs.writeFileSync(exceptionWorkspaceFile, '<html>exception</html>');
  fs.writeFileSync(runRecordFile, '<html>record</html>');
  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    selectedCount: 4,
    success: 2,
    failed: 1,
    batchCount: 2,
  }, null, 2));

  fs.writeFileSync(workbenchStateFile, JSON.stringify({
    kind: 'daoge-workbench-state',
    schemaVersion: 1,
    generatedAt: '2026-05-25T10:00:00.000Z',
    outputDir,
    taskLabel: '统一快照首页异常任务',
    status: {
      phase: '结果阶段',
      tone: 'warn',
      summary: '统一快照建议先回异常工作台收口问题。',
    },
    risk: {
      summary: '当前这一轮还有失败项和待复核项，先统一收口更稳。',
    },
    counts: {
      selected: 4,
      success: 2,
      failed: 1,
      needsReview: 2,
      batches: 2,
    },
    nextAction: {
      label: '进入结果工作台',
      reason: '这条状态故意保留旧倾向，用来验证首页会改成异常优先。',
      target: 'result_workspace.html',
    },
    views: {
      home: {
        hero: {
          title: '统一快照首页异常标题',
          intro: '统一快照首页异常说明',
        },
      },
    },
    assets: {
      assetCollections: {
        userFacing: {
          preview: [],
          result: [],
          review: [{ title: '待复核项 1' }, { title: '待复核项 2' }],
          exception: [{ title: '失败项 1' }],
          reference: [],
        },
        system: {
          keyFiles: {},
        },
      },
      summary: {
        previewCount: 0,
        resultCount: 2,
        reviewCount: 2,
        exceptionCount: 1,
        referenceCount: 0,
      },
    },
  }, null, 2));

  runNode('render_workspace_home.js', [
    '--manifest-file', manifestFile,
    '--output-file', workspaceHomeFile,
  ]);

  const html = fs.readFileSync(workspaceHomeFile, 'utf8');
  assert.match(html, /进入异常工作台/);
  assert.match(html, /当前这一轮还有失败项和待复核项，先统一收口更稳。/);
  assert.doesNotMatch(html, /这条状态故意保留旧倾向，用来验证首页会改成异常优先。/);
  assert.match(html, /结果工作台/);
  assert.match(html, /处理完再回看/);
  assert.match(html, /问题收口后，再回结果工作台做保留、复核和最终取舍。/);
  assert.doesNotMatch(html, /想回看本轮记录、批次和输出概况时再打开。/);
});

test('render_prompt_preview_board writes html prompt summary', () => {
  const tempDir = makeTempDir('interactive-image-batch-prompt-preview-board-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const promptsFile = path.join(outputDir, 'prompts.generated.json');
  const planFile = path.join(outputDir, 'batch_plan.json');
  const summaryFile = path.join(outputDir, 'daoge_run_summary.md');
  const markdownFile = path.join(outputDir, 'prompt_preview.md');
  const preflightBoardFile = path.join(outputDir, 'preflight_board.html');
  const boardFile = path.join(outputDir, 'prompt_preview.html');

  fs.writeFileSync(promptsFile, JSON.stringify([
    {
      index: '001',
      title: 'Poster 1',
      style_family: 'brand',
      purity_grade: 'hero',
      scene: 'studio',
      wardrobe: 'coat',
      composition: 'full body',
      prompt: 'Photoreal studio poster with premium fashion styling',
    },
    {
      index: '002',
      title: 'Poster 2',
      style_family: 'brand',
      purity_grade: 'hero',
      scene: 'urban',
      wardrobe: 'jacket',
      composition: 'wide shot',
      prompt: 'Photoreal urban poster with cinematic framing',
    }
  ], null, 2));
  fs.writeFileSync(planFile, JSON.stringify([
    { batchNumber: 1, promptCount: 2, firstIndex: '001', lastIndex: '002' }
  ], null, 2));
  fs.writeFileSync(summaryFile, '# summary');
  fs.writeFileSync(markdownFile, '# prompt preview');
  fs.writeFileSync(preflightBoardFile, '<html>preflight</html>');

  runNode('render_prompt_preview_board.js', [
    '--prompts-file', promptsFile,
    '--plan-file', planFile,
    '--summary-file', summaryFile,
    '--markdown-file', markdownFile,
    '--preview-count', '2',
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  const sharedCss = fs.readFileSync(path.join(outputDir, 'portal_shared.css'), 'utf8');
  assert.match(html, /DAOGE 提示词预览补充页/);
  assert.match(html, /提示词预览已经退到准备补充页层/);
  assert.match(html, /提示词补充判断/);
  assert.match(html, /提示词补充页，先看这里/);
  assert.match(html, /提示词补充页看完后，回准备主链/);
  assert.match(html, /不再承担准备总控/);
  assert.match(html, /主方向/);
  assert.match(html, /准备概览/);
  assert.match(html, /批次概览/);
  assert.match(html, /提示词样例/);
  assert.match(html, /文字版和 JSON 只留给维护排查/);
  assert.match(html, /继续下一步/);
  assert.match(html, /提示词补充页浏览模式/);
  assert.match(html, /准备主链进度/);
  assert.doesNotMatch(html, /提示词预览文字版|运行摘要文字版|批次计划 JSON|返回预检总览/);
  assert.doesNotMatch(html, /<h2>准备主控<\/h2>/);
  assert.match(sharedCss, /\.portal-workbench/);
  assert.match(sharedCss, /min-height: 42px/);
});

test('render_prompt_preview_board can prefer unified workbench_state snapshot', () => {
  const tempDir = makeTempDir('interactive-image-batch-prompt-preview-workbench-state-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const promptsFile = path.join(outputDir, 'prompts.generated.json');
  const planFile = path.join(outputDir, 'batch_plan.json');
  const summaryFile = path.join(outputDir, 'daoge_run_summary.md');
  const markdownFile = path.join(outputDir, 'prompt_preview.md');
  const boardFile = path.join(outputDir, 'prompt_preview.html');
  const prepareWorkspaceFile = path.join(outputDir, 'prepare_workspace.html');
  const workbenchStateFile = path.join(outputDir, 'workbench_state.json');

  fs.writeFileSync(promptsFile, JSON.stringify([
    {
      index: '001',
      title: 'Poster 1',
      style_family: 'brand',
      purity_grade: 'hero',
      scene: 'studio',
      prompt: 'Photoreal studio poster with premium fashion styling',
    },
  ], null, 2));
  fs.writeFileSync(planFile, JSON.stringify([
    { batchNumber: 1, promptCount: 1, firstIndex: '001', lastIndex: '001' }
  ], null, 2));
  fs.writeFileSync(summaryFile, '# summary');
  fs.writeFileSync(markdownFile, '# prompt preview');
  fs.writeFileSync(prepareWorkspaceFile, '<html>prepare</html>');
  fs.writeFileSync(workbenchStateFile, JSON.stringify({
    kind: 'daoge-workbench-state',
    schemaVersion: 1,
    generatedAt: '2026-05-24T13:30:00.000Z',
    outputDir,
    taskLabel: '统一快照预览任务',
    status: {
      phase: '准备阶段',
      headline: '统一快照已经接管预览说明',
      summary: '统一快照建议先回准备工作台，再决定是否继续预检。',
      tone: 'info',
    },
    counts: {
      selected: 1,
      batches: 1,
    },
    nextAction: {
      label: '回准备工作台',
      reason: '统一快照建议先回主链重新看当前阶段。',
      target: 'prepare_workspace.html',
    },
    routes: {
      prepare: prepareWorkspaceFile,
    },
  }, null, 2));

  runNode('render_prompt_preview_board.js', [
    '--prompts-file', promptsFile,
    '--plan-file', planFile,
    '--summary-file', summaryFile,
    '--markdown-file', markdownFile,
    '--preview-count', '1',
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  assert.match(html, /统一快照预览任务/);
  assert.match(html, /统一快照已经接管预览说明/);
  assert.match(html, /统一快照建议先回准备工作台，再决定是否继续预检。/);
  assert.match(html, /统一快照建议先回主链重新看当前阶段。/);
});

test('render_assets_board writes html asset summary', () => {
  const tempDir = makeTempDir('interactive-image-batch-assets-board-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const bindingsFile = path.join(outputDir, 'reference_bindings.imported.json');
  const analysisFile = path.join(outputDir, 'reference_asset_analysis.json');
  const assetImage = path.join(outputDir, 'shot_1-ref_01.png');
  const maskImage = path.join(outputDir, 'shot_2-mask_01.png');
  const boardFile = path.join(outputDir, 'assets_board.html');
  const preflightBoardFile = path.join(outputDir, 'preflight_board.html');
  const promptPreviewBoardFile = path.join(outputDir, 'prompt_preview.html');

  fs.writeFileSync(assetImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(maskImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(preflightBoardFile, '<html>preflight</html>');
  fs.writeFileSync(promptPreviewBoardFile, '<html>prompt preview</html>');

  fs.writeFileSync(bindingsFile, JSON.stringify({
    reference_assets: [
      { asset_id: 'ref_01', path: 'shot_1-ref_01.png', asset_type: 'reference', label: '主参考图', notes: '桌面上传' },
      { asset_id: 'mask_01', path: 'shot_2-mask_01.png', asset_type: 'mask', label: '局部遮罩', notes: '右下角' },
    ],
    slot_assignments: [
      { slot_id: 'shot_1', asset_ids: ['ref_01'], mask_asset_ids: [], reference_mode: 'reference-assisted' },
      { slot_id: 'shot_2', asset_ids: [], mask_asset_ids: ['mask_01'], reference_mode: 'masked-edit' },
    ],
  }, null, 2));

  fs.writeFileSync(analysisFile, JSON.stringify({
    naturalLanguageBindings: {
      explicitAssignments: [
        { asset_index: 0, slot_id: 'shot_1', type: 'reference' },
        { asset_index: 1, slot_id: 'shot_2', type: 'mask' },
      ],
    },
    visionAnalysis: {
      enabled: true,
      reason: 'mocked',
    },
    ruleAssignments: [
      {
        path: assetImage,
        inferred_slot_id: 'shot_1',
        inferred_type: 'reference',
        inference: { reason: 'filename-slot-match' },
        vision_recommendation: { slot_id: 'shot_1', type: 'reference', confidence: 0.93 },
      },
      {
        path: maskImage,
        inferred_slot_id: 'shot_2',
        inferred_type: 'mask',
        inference: { reason: 'filename-slot-match' },
        vision_recommendation: { slot_id: 'shot_2', type: 'mask', confidence: 0.95 },
      },
    ],
  }, null, 2));

  runNode('render_assets_board.js', [
    '--bindings-file', bindingsFile,
    '--analysis-file', analysisFile,
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  assert.match(html, /DAOGE 素材补充页/);
  assert.match(html, /素材看板已经退到准备补充页层/);
  assert.match(html, /当前阶段/);
  assert.match(html, /素材绑定补充页/);
  assert.match(html, /流程位置/);
  assert.match(html, /素材补充页浏览模式/);
  assert.match(html, /准备主链进度/);
  assert.match(html, /素材补充页看完后，回准备主链/);
  assert.match(html, /素材补充判断/);
  assert.match(html, /素材补充页，先看这里/);
  assert.match(html, /不再承担准备总控/);
  assert.match(html, /绑定关系/);
  assert.match(html, /资产卡片/);
  assert.match(html, /主参考图/);
  assert.match(html, /局部遮罩/);
  assert.match(html, /id="slot-shot_1"/);
  assert.match(html, /href="#asset-ref_01"/);
  assert.match(html, /href="#asset-mask_01"/);
  assert.match(html, /绑定 Markdown 和 JSON 只留在内部状态层/);
  assert.doesNotMatch(html, /绑定确认摘要|会话卡|绑定关系 JSON|资产分析 JSON|返回预检总览/);
  assert.doesNotMatch(html, /DAOGE Assets Board/);
  assert.doesNotMatch(html, /<h2>素材主控<\/h2>/);
});

test('render_assets_board can prefer unified workbench_state snapshot', () => {
  const tempDir = makeTempDir('interactive-image-batch-assets-board-workbench-state-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const bindingsFile = path.join(outputDir, 'reference_bindings.imported.json');
  const analysisFile = path.join(outputDir, 'reference_asset_analysis.json');
  const assetImage = path.join(outputDir, 'shot_1-ref_01.png');
  const boardFile = path.join(outputDir, 'assets_board.html');
  const prepareWorkspaceFile = path.join(outputDir, 'prepare_workspace.html');
  const workbenchStateFile = path.join(outputDir, 'workbench_state.json');

  fs.writeFileSync(assetImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(prepareWorkspaceFile, '<html>prepare</html>');
  fs.writeFileSync(bindingsFile, JSON.stringify({
    reference_assets: [
      { asset_id: 'ref_01', path: 'shot_1-ref_01.png', asset_type: 'reference', label: '主参考图', notes: '桌面上传' },
    ],
    slot_assignments: [
      { slot_id: 'shot_1', asset_ids: ['ref_01'], mask_asset_ids: [], reference_mode: 'reference-assisted' },
    ],
  }, null, 2));
  fs.writeFileSync(analysisFile, JSON.stringify({
    naturalLanguageBindings: {
      explicitAssignments: [
        { asset_index: 0, slot_id: 'shot_1', type: 'reference' },
      ],
    },
    visionAnalysis: {
      enabled: false,
      reason: 'mocked',
    },
    ruleAssignments: [
      {
        path: assetImage,
        asset_id: 'ref_01',
        inferred_slot_id: 'shot_1',
        inferred_type: 'reference',
        inference: { reason: 'matched by filename' },
      },
    ],
  }, null, 2));
  fs.writeFileSync(workbenchStateFile, JSON.stringify({
    kind: 'daoge-workbench-state',
    schemaVersion: 1,
    generatedAt: '2026-05-24T14:00:00.000Z',
    outputDir,
    taskLabel: '统一快照素材任务',
    status: {
      phase: '准备阶段',
      headline: '统一快照已经接管素材页说明',
      summary: '统一快照建议先回准备工作台，再决定是否继续逐项核对素材。',
      tone: 'info',
    },
    counts: {
      selected: 1,
    },
    nextAction: {
      label: '回准备工作台',
      reason: '统一快照建议先回主链确认交接和下一步。',
      target: 'prepare_workspace.html',
    },
    routes: {
      prepare: prepareWorkspaceFile,
    },
  }, null, 2));

  runNode('render_assets_board.js', [
    '--bindings-file', bindingsFile,
    '--analysis-file', analysisFile,
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  assert.match(html, /统一快照素材任务/);
  assert.match(html, /统一快照已经接管素材页说明/);
  assert.match(html, /统一快照建议先回准备工作台，再决定是否继续逐项核对素材。/);
  assert.match(html, /统一快照建议先回主链确认交接和下一步。/);
});

test('render_run_overview writes html run summary', () => {
  const tempDir = makeTempDir('interactive-image-batch-run-overview-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const operationsReportFile = path.join(outputDir, 'operations_report.json');
  const reviewBoardFile = path.join(outputDir, 'review_board.html');
  const completionBoardFile = path.join(outputDir, 'completion_board.html');
  const selectionBoardFile = path.join(outputDir, 'selection_board.md');
  const boardFile = path.join(outputDir, 'run_overview.html');

  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    generatedAt: '2026-05-18T10:00:00.000Z',
    success: 2,
    failed: 1,
    batchCount: 2,
    batchSize: 1,
    model: 'gpt-image-2',
    defaultSize: '1024x1024',
    paused: false,
    dryRun: false,
    batches: [
      {
        batchNumber: 1,
        success: 1,
        failed: 0,
        results: [
          { ok: true, skipped: false, requestMode: 'prompt-only', styleFamily: 'brand', slotRole: 'hero' },
        ],
      },
      {
        batchNumber: 2,
        success: 1,
        failed: 1,
        results: [
          { ok: true, skipped: false, requestMode: 'masked-edit', styleFamily: 'brand', slotRole: 'detail' },
          { ok: false, skipped: false, requestMode: 'masked-edit', styleFamily: 'brand', slotRole: 'detail' },
        ],
      },
    ],
  }, null, 2));

  fs.writeFileSync(operationsReportFile, JSON.stringify({
    distributions: {
      requestMode: [{ name: 'prompt-only', count: 1 }, { name: 'masked-edit', count: 1 }],
      styleFamily: [{ name: 'brand', count: 2 }],
      slotRole: [{ name: 'hero', count: 1 }, { name: 'detail', count: 1 }],
    },
  }, null, 2));
  fs.writeFileSync(reviewBoardFile, '<html>review</html>');
  fs.writeFileSync(completionBoardFile, '<html>completion</html>');
  fs.writeFileSync(selectionBoardFile, '# selection');

  runNode('render_run_overview.js', [
    '--manifest-file', manifestFile,
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  assert.match(html, /DAOGE 运行概览补充页/);
  assert.match(html, /当前任务/);
  assert.match(html, /运行页定位/);
  assert.match(html, /建议路线/);
  assert.match(html, /运行补充页入口/);
  assert.match(html, /运行参数/);
  assert.match(html, /批次与分布/);
  assert.match(html, /Request Mode 分布/);
  assert.match(html, /结果工作台/);
  assert.doesNotMatch(html, /进入审阅看板|进入完成摘要页|打开选择板|selection_board\.md/);
  assert.doesNotMatch(html, /执行主链进度/);
  assert.doesNotMatch(html, /run-timeline/);
});

test('render_run_overview can prefer unified workbench_state snapshot', () => {
  const tempDir = makeTempDir('interactive-image-batch-run-overview-workbench-state-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const boardFile = path.join(outputDir, 'run_overview.html');
  const resultWorkspaceFile = path.join(outputDir, 'result_workspace.html');
  const exceptionWorkspaceFile = path.join(outputDir, 'exception_workspace.html');
  const workbenchStateFile = path.join(outputDir, 'workbench_state.json');

  fs.writeFileSync(resultWorkspaceFile, '<html>result</html>');
  fs.writeFileSync(exceptionWorkspaceFile, '<html>exception</html>');
  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    success: 1,
    failed: 1,
    batchCount: 2,
    batchSize: 1,
    model: 'gpt-image-2',
    defaultSize: '1024x1024',
    batches: [],
  }, null, 2));
  fs.writeFileSync(workbenchStateFile, JSON.stringify({
    kind: 'daoge-workbench-state',
    schemaVersion: 1,
    generatedAt: '2026-05-24T12:00:00.000Z',
    outputDir,
    taskLabel: '统一快照执行页任务',
    status: {
      phase: '结果阶段',
      headline: '统一快照建议先回异常工作台统一处理',
      summary: '统一快照认为当前更适合先收异常，再决定是否排查执行细节。',
      tone: 'warn',
    },
    counts: {
      selected: 2,
      success: 1,
      failed: 1,
      batches: 2,
    },
    nextAction: {
      label: '回异常工作台',
      reason: '统一快照先把异常收口，再回来排查执行细节。',
      target: 'exception_workspace.html',
    },
    routes: {
      result: resultWorkspaceFile,
      exception: exceptionWorkspaceFile,
    },
  }, null, 2));

  runNode('render_run_overview.js', [
    '--manifest-file', manifestFile,
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  assert.match(html, /统一快照执行页任务/);
  assert.match(html, /统一快照建议先回异常工作台统一处理/);
  assert.match(html, /统一快照认为当前更适合先收异常，再决定是否排查执行细节。/);
  assert.match(html, /统一快照先把异常收口，再回来排查执行细节。/);
});

test('render_rerun_board writes html rerun summary', () => {
  const tempDir = makeTempDir('interactive-image-batch-rerun-board-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const failedFile = path.join(outputDir, 'failed.json');
  const needsReviewFile = path.join(outputDir, 'needs_review.json');
  const rerunCandidatesFile = path.join(outputDir, 'rerun_candidates.json');
  const runOverviewFile = path.join(outputDir, 'run_overview.html');
  const reviewBoardFile = path.join(outputDir, 'review_board.html');
  const completionBoardFile = path.join(outputDir, 'completion_board.html');
  const selectionBoardFile = path.join(outputDir, 'selection_board.md');
  const boardFile = path.join(outputDir, 'rerun_board.html');

  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    promptSource: path.join(outputDir, 'prompts.generated.json'),
    failed: 1,
    success: 2,
  }, null, 2));
  fs.writeFileSync(failedFile, JSON.stringify([
    { index: '003', slug: 'failed-item', title: 'Failed Item', slotId: 'shot_3', requestMode: 'reference-assisted', error: 'provider timeout' }
  ], null, 2));
  fs.writeFileSync(needsReviewFile, JSON.stringify([
    { index: '002', slug: 'review-item', title: 'Review Item', slotId: 'shot_2', requestMode: 'masked-edit', revisedPrompt: 'only edit lower-right corner' }
  ], null, 2));
  fs.writeFileSync(rerunCandidatesFile, JSON.stringify([
    { index: '003', slug: 'failed-item', title: 'Failed Item', slotId: 'shot_3', requestMode: 'reference-assisted', error: 'provider timeout' }
  ], null, 2));
  fs.writeFileSync(runOverviewFile, '<html>run overview</html>');
  fs.writeFileSync(reviewBoardFile, '<html>review</html>');
  fs.writeFileSync(completionBoardFile, '<html>completion</html>');
  fs.writeFileSync(selectionBoardFile, '# selection');

  runNode('render_rerun_board.js', [
    '--manifest-file', manifestFile,
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  assert.match(html, /DAOGE 失败补跑补充页/);
  assert.match(html, /补跑页定位/);
  assert.match(html, /补跑前，建议这样判断/);
  assert.match(html, /补跑补充页入口/);
  assert.match(html, /失败项/);
  assert.match(html, /待复核项/);
  assert.match(html, /推荐命令/);
  assert.match(html, /provider timeout/);
  assert.match(html, /异常工作台/);
  assert.doesNotMatch(html, /运行概览补充页|进入审阅看板|进入完成摘要页|查看选择板|selection_board\.md/);
  assert.doesNotMatch(html, /结果主链进度/);
});

test('render_rerun_board can prefer unified workbench_state snapshot', () => {
  const tempDir = makeTempDir('interactive-image-batch-rerun-board-workbench-state-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const failedFile = path.join(outputDir, 'failed.json');
  const boardFile = path.join(outputDir, 'rerun_board.html');
  const resultWorkspaceFile = path.join(outputDir, 'result_workspace.html');
  const exceptionWorkspaceFile = path.join(outputDir, 'exception_workspace.html');
  const workbenchStateFile = path.join(outputDir, 'workbench_state.json');

  fs.writeFileSync(resultWorkspaceFile, '<html>result</html>');
  fs.writeFileSync(exceptionWorkspaceFile, '<html>exception</html>');
  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    promptSource: path.join(outputDir, 'prompts.generated.json'),
    failed: 1,
    success: 1,
    selectedCount: 2,
  }, null, 2));
  fs.writeFileSync(failedFile, JSON.stringify([
    { index: '003', slug: 'failed-item', title: 'Failed Item', slotId: 'shot_3', requestMode: 'reference-assisted', error: 'provider timeout' }
  ], null, 2));
  fs.writeFileSync(workbenchStateFile, JSON.stringify({
    kind: 'daoge-workbench-state',
    schemaVersion: 1,
    generatedAt: '2026-05-24T12:30:00.000Z',
    outputDir,
    taskLabel: '统一快照补跑页任务',
    status: {
      phase: '异常阶段',
      headline: '统一快照已经接管补跑判断',
      summary: '统一快照建议先回异常工作台统一判断，再决定是否补跑。',
      tone: 'warn',
    },
    counts: {
      selected: 2,
      success: 1,
      failed: 1,
      needsReview: 1,
    },
    nextAction: {
      label: '回异常工作台',
      reason: '统一快照建议先统一判断，再决定是否补跑。',
      target: 'exception_workspace.html',
    },
    routes: {
      result: resultWorkspaceFile,
      exception: exceptionWorkspaceFile,
    },
  }, null, 2));

  runNode('render_rerun_board.js', [
    '--manifest-file', manifestFile,
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  assert.match(html, /统一快照补跑页任务/);
  assert.match(html, /统一快照已经接管补跑判断/);
  assert.match(html, /统一快照建议先回异常工作台统一判断，再决定是否补跑。/);
  assert.match(html, /统一快照建议先统一判断，再决定是否补跑。/);
});

test('analyze_review_results writes visual review analysis against mock responses provider', async () => {
  await withMockImageServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/responses') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(body);
        assert.equal(payload.model, 'gpt-5.4');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    items: [
                      {
                        output: JSON.parse(payload.input[0].content.find((item) => item.type === 'input_text' && /"output":/.test(item.text)).text).output,
                        verdict: 'review',
                        confidence: 0.91,
                        score: 74,
                        risk_tags: ['视觉检测：需检查遮罩融合感'],
                        reason: 'lower-right edit boundary is slightly visible',
                        next_action: '保留当前图作为方向，但建议局部再修一版',
                      }
                    ],
                  }),
                },
              ],
            },
          ],
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  }, async (baseUrl) => {
    const tempDir = makeTempDir('interactive-image-batch-visual-review-');
    const outputDir = path.join(tempDir, 'out');
    const successFile = path.join(outputDir, 'success.json');
    const envFile = path.join(tempDir, '.env');
    const outputImage = path.join(outputDir, 'result.png');
    const analysisFile = path.join(outputDir, 'review_analysis.json');

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outputImage, Buffer.from(tinyPngBase64(), 'base64'));
    fs.writeFileSync(successFile, JSON.stringify([
      {
        ok: true,
        index: '001',
        title: 'Visual Review Target',
        output: outputImage,
        requestMode: 'masked-edit',
        slotId: 'shot_2',
        scene: 'gift box close-up',
        composition: 'tight product crop',
      }
    ], null, 2));
    fs.writeFileSync(envFile, [
      `OPENAI_BASE_URL=${baseUrl}/v1`,
      'OPENAI_API_KEY=test-key',
      'OPENAI_RESPONSES_MODEL=gpt-5.4',
    ].join('\n'));

    await runNodeAsync('analyze_review_results.js', [
      '--success-file', successFile,
      '--output-file', analysisFile,
      '--env-file', envFile,
      '--max-items', '1',
    ]);

    const analysis = JSON.parse(fs.readFileSync(analysisFile, 'utf8'));
    assert.equal(analysis.enabled, true);
    assert.equal(analysis.items.length, 1);
    assert.equal(analysis.items[0].verdict, 'review');
    assert.equal(analysis.items[0].score, 74);
    assert.equal(analysis.items[0].risk_tags[0], '视觉检测：需检查遮罩融合感');
  });
});

test('run_real_provider_smoke creates safe preflight report without live execution', () => {
  const tempDir = makeTempDir('interactive-image-batch-real-smoke-');
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  const reportFile = path.join(outputDir, 'real_provider_smoke_report.md');

  fs.writeFileSync(envFile, [
    'OPENAI_BASE_URL=https://example.com/v1',
    'OPENAI_API_KEY=test-key',
    'OPENAI_MODEL=gpt-image-2',
    'OPENAI_RESPONSES_MODEL=gpt-5.4',
  ].join('\n'));

  runNode('run_real_provider_smoke.js', [
    '--env-file', envFile,
    '--output-dir', outputDir,
  ]);

  const report = fs.readFileSync(reportFile, 'utf8');
  assert.match(report, /Live run confirmed: no/);
  assert.match(report, /No live provider calls were executed/);
});

test('run_example_catalog_prepare can run third-wave lookbook variants from widened catalog', () => {
  const tempDir = makeTempDir('interactive-image-batch-example-catalog-lookbook-wave3-');
  const cases = [
    { exampleId: 'lookbook-editorial-pairing-lookbook', variant: 'editorial-pairing-lookbook' },
    { exampleId: 'lookbook-detail-mix', variant: 'lookbook-detail-mix' },
  ];

  cases.forEach((item) => {
    const outputDir = path.join(tempDir, item.exampleId);
    const runStdout = runNode('run_example_catalog_prepare.js', [
      '--example-id', item.exampleId,
      '--output-dir', outputDir,
    ]);
    const summary = JSON.parse(runStdout);
    const entryState = JSON.parse(fs.readFileSync(summary.entryState, 'utf8'));
    assert.equal(summary.selectedExample.id, item.exampleId);
    assert.equal(summary.selectedExample.template_variant, item.variant);
    assert.match(entryState.entryMainlineProtocol?.sequenceLabel || '', /中文模板展示板 -> 任务总控 -> 工作台首页/);
    assert.equal(entryState.entryMainlineProtocol?.taskCenterEntryProtocol?.entryGuideKey, 'entryMainlineGuide');
    assert.match(String(entryState.entryMainlineProtocol?.taskCenterEntryProtocol?.summary || ''), /跨任务入口看任务总控/);
    assert.equal(entryState.entryMainlineProtocol?.defaultGenerationProtocol?.mode, 'mainline-only');
    assert.match(String(entryState.entryMainlineProtocol?.defaultGenerationProtocol?.summary || ''), /默认只带用户进入主链工作台/);
    assert.match(String(entryState.entryMainlineProtocol?.defaultGenerationProtocol?.guardrail?.removedRule || ''), /不再生成|残留会被清理/);
    assert.match(
      JSON.stringify(entryState.entryMainlineProtocol?.defaultGenerationProtocol?.hiddenHtmlFiles || []),
      /review_board\.html|result_hub\.html|daoge_portal\.html/
    );
    assert.equal(fs.existsSync(summary.entryState), true);
    assert.equal(fs.existsSync(summary.workspaceHome), true);
    assert.equal(fs.existsSync(summary.prepareWorkspace), true);
    assert.equal(fs.existsSync(path.join(summary.prepareOutputDir, 'prompt_preview.html')), false);
    assert.equal(fs.existsSync(path.join(summary.prepareOutputDir, 'preflight_board.html')), false);
  });
});

test('run_example_catalog_prepare can resolve second-wave oral storyboard starter intents', () => {
  const tempDir = makeTempDir('interactive-image-batch-oral-storyboard-wave2-intents-');
  const cases = [
    { intent: 'expertboard', exampleId: 'oral-storyboard-board-expert-led', variant: 'expert-led' },
    { intent: 'testimonialboard', exampleId: 'oral-storyboard-board-testimonial-led', variant: 'testimonial-led' },
  ];

  cases.forEach((item) => {
    const outputDir = path.join(tempDir, item.intent);
    const runStdout = runNode('run_example_catalog_prepare.js', [
      '--intent', item.intent,
      '--output-dir', outputDir,
    ]);
    const summary = JSON.parse(runStdout);
    const entryState = JSON.parse(fs.readFileSync(summary.entryState, 'utf8'));
    assert.equal(summary.selectedExample.id, item.exampleId);
    assert.equal(summary.selectedExample.template_variant, item.variant);
    assert.match(entryState.entryMainlineProtocol?.handoffRule || '', /任务总控只做任务级切换/);
    assert.equal(entryState.entryMainlineProtocol?.defaultGenerationProtocol?.mode, 'mainline-only');
    assert.match(String(entryState.entryMainlineProtocol?.defaultGenerationProtocol?.guardrail?.onDemandRule || ''), /必须按需开启/);
    assert.equal(fs.existsSync(summary.entryState), true);
    assert.equal(fs.existsSync(summary.workspaceHome), true);
    assert.equal(fs.existsSync(summary.prepareWorkspace), true);
  });
});

test('run_example_catalog_prepare can run third-wave portrait-fashion variants from widened catalog', () => {
  const tempDir = makeTempDir('interactive-image-batch-portrait-fashion-wave3-');
  const cases = [
    { exampleId: 'portrait-kv-emotion-contrast-kv', variant: 'emotion-contrast-kv' },
    { exampleId: 'portrait-kv-product-linked-portrait-kv', variant: 'product-linked-portrait-kv' },
    { exampleId: 'studio-editorial-couture-minimal-studio', variant: 'couture-minimal-studio' },
    { exampleId: 'studio-editorial-gesture-sequence-studio', variant: 'gesture-sequence-studio' },
  ];

  cases.forEach((item) => {
    const outputDir = path.join(tempDir, item.exampleId);
    const runStdout = runNode('run_example_catalog_prepare.js', [
      '--example-id', item.exampleId,
      '--output-dir', outputDir,
    ]);
    const summary = JSON.parse(runStdout);
    assert.equal(summary.selectedExample.id, item.exampleId);
    assert.equal(summary.selectedExample.template_variant, item.variant);
    assert.equal(fs.existsSync(summary.entryState), true);
    assert.equal(fs.existsSync(summary.workspaceHome), true);
    assert.equal(fs.existsSync(summary.prepareWorkspace), true);
  });
});

test('run_example_catalog_prepare can run fourth-wave portrait-fashion variants from widened catalog', () => {
  const tempDir = makeTempDir('interactive-image-batch-portrait-fashion-wave4-');
  const cases = [
    { exampleId: 'portrait-kv-headline-safe-portrait-kv', variant: 'headline-safe-portrait-kv', templateId: 'portrait-kv' },
    { exampleId: 'portrait-kv-profile-silhouette-kv', variant: 'profile-silhouette-kv', templateId: 'portrait-kv' },
    { exampleId: 'studio-editorial-sharp-tailoring-studio', variant: 'sharp-tailoring-studio', templateId: 'studio-editorial' },
    { exampleId: 'studio-editorial-beauty-detail-studio', variant: 'beauty-detail-studio', templateId: 'studio-editorial' },
  ];

  cases.forEach((item) => {
    const outputDir = path.join(tempDir, item.exampleId);
    const runStdout = runNode('run_example_catalog_prepare.js', [
      '--example-id', item.exampleId,
      '--output-dir', outputDir,
    ]);
    const summary = JSON.parse(runStdout);
    assert.equal(summary.selectedExample.id, item.exampleId);
    assert.equal(summary.selectedExample.template_variant, item.variant);
    assert.equal(fs.existsSync(summary.entryState), true);
    assert.equal(fs.existsSync(summary.workspaceHome), true);
    assert.equal(fs.existsSync(summary.prepareWorkspace), true);
    const modeDetection = JSON.parse(fs.readFileSync(summary.modeDetection, 'utf8'));
    assert.equal(modeDetection.detected_template.id, item.templateId);
    const promptValidation = JSON.parse(fs.readFileSync(path.join(summary.prepareOutputDir, 'prompt_validation_report.json'), 'utf8'));
    assert.equal(promptValidation.duplicatePromptCount, 0);
    assert.deepEqual(promptValidation.warnings || [], []);
    assert.equal(promptValidation.qualityGates.ok, true);
  });
});
