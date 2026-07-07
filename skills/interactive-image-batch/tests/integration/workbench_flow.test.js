const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  skillRoot,
  makeTempDir,
  runScript,
  writeJson,
  writeTinyPng,
} = require('../helpers/workspace_v2_test_utils');
const {
  openProjectDatabase,
  all,
  run,
  projectIdFor,
  initializeProject,
  createJob,
} = require('../../src/db/repository');
const { startWorkbenchServer, ensureWorkbenchDatabase } = require('../../src/server/server');
const { loadSqlite } = require('../../src/db/connection');

function sqliteAvailable() {
  try {
    loadSqlite();
    return true;
  } catch {
    return false;
  }
}

function count(outputDir, table) {
  const db = openProjectDatabase(outputDir);
  return all(db, `SELECT count(*) AS c FROM ${table}`, [])[0].c;
}

function createWorkbenchDomHarness() {
  const elements = new Map();
  function makeElement(id = '') {
    const element = {
      id,
      innerHTML: '',
      textContent: '',
      value: '',
      disabled: false,
      dataset: {},
      listeners: {},
      classList: {
        toggle() {},
        add() {},
        remove() {},
      },
      setAttribute(name, value) {
        this[name] = value;
      },
      addEventListener(type, handler) {
        this.listeners[type] = handler;
      },
      appendChild(child) {
        this.lastChild = child;
      },
      remove() {},
      closest() {
        return null;
      },
      querySelector() {
        return null;
      },
    };
    return element;
  }
  const requiredIds = [
    'pageEyebrow',
    'pageTitle',
    'pageSubtitle',
    'pageControls',
    'nav',
    'sideAssetCount',
    'sideIssueCount',
    'healthDot',
    'healthText',
    'menuButton',
    'exportButton',
    'view',
    'inspector',
    'jobSummary',
    'eventLog',
    'toastStack',
    'globalSearch',
    'refreshButton',
    'rerunButton',
  ];
  requiredIds.forEach((id) => elements.set(id, makeElement(id)));
  const shell = makeElement('shell');
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelector(selector) {
      if (selector === '[data-shell]') return shell;
      return null;
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    createElement(tagName) {
      return makeElement(tagName);
    },
    listeners: {},
  };
  const context = {
    document,
    navigator: { clipboard: { writeText: async () => {} } },
    window: {
      setTimeout: () => 0,
      clearTimeout: () => {},
    },
    fetch: async () => ({ headers: { get: () => 'application/json' }, ok: true, json: async () => ({ ok: true, data: {} }) }),
    console,
    URLSearchParams,
    Intl,
  };
  vm.createContext(context);
  const scriptPath = path.join(skillRoot, 'app', 'src', 'workbench.js');
  const source = fs.readFileSync(scriptPath, 'utf8').replace(/\nrender\(\);\nrefreshAll\(\)\.catch\(showError\);\s*$/, '\n');
  vm.runInContext(source, context, { filename: scriptPath });
  return { context, elements };
}

test('prepare writes project, run, prompts and events into daoge.db', () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  runScript('daoge.js', ['prepare',
    '--task-spec', path.join(skillRoot, 'references', 'examples', 'task_spec.minimal.json'),
    '--output-dir', outputDir,
  ]);
  assert.equal(fs.existsSync(path.join(outputDir, 'daoge.db')), true);
  assert.equal(count(outputDir, 'projects'), 1);
  assert.equal(count(outputDir, 'runs') >= 1, true);
  assert.equal(count(outputDir, 'prompts') >= 1, true);
  assert.equal(count(outputDir, 'events') >= 1, true);
});

test('execute dry-run writes run items and events into daoge.db', () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  runScript('daoge.js', ['prepare',
    '--task-spec', path.join(skillRoot, 'references', 'examples', 'task_spec.minimal.json'),
    '--output-dir', outputDir,
  ]);
  runScript('daoge.js', ['execute',
    '--output-dir', outputDir,
    '--dry-run', 'true',
  ]);
  assert.equal(count(outputDir, 'run_items') >= 1, true);
  assert.equal(count(outputDir, 'events') >= 1, true);
});

test('prepare after execute syncs current prepare manifest instead of stale execution manifest', () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  runScript('daoge.js', ['prepare',
    '--task-spec', path.join(skillRoot, 'references', 'examples', 'task_spec.minimal.json'),
    '--output-dir', outputDir,
  ]);
  runScript('daoge.js', ['execute',
    '--output-dir', outputDir,
    '--dry-run', 'true',
  ]);
  runScript('daoge.js', ['prepare',
    '--task-spec', path.join(skillRoot, 'references', 'examples', 'task_spec.minimal.json'),
    '--output-dir', outputDir,
  ]);
  const db = openProjectDatabase(outputDir);
  const phases = all(db, 'SELECT phase, count(*) AS c FROM runs GROUP BY phase', []);
  const prepare = phases.find((row) => row.phase === 'prepare');
  const execute = phases.find((row) => row.phase === 'execute');
  assert.equal(prepare?.c >= 2, true);
  assert.equal(execute?.c >= 1, true);
});

test('ingest writes assets, issues and events into daoge.db', () => {
  if (!sqliteAvailable()) return;
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  const resultImage = path.join(tempDir, 'host', 'success.png');
  writeTinyPng(resultImage);
  const resultsFile = path.join(tempDir, 'host_native_results.json');
  writeJson(resultsFile, [
    { index: '001', title: '成功图', requestMode: 'prompt-only', status: 'success', output: resultImage },
    { index: '002', title: '失败图', requestMode: 'prompt-only', status: 'failed', error: '测试失败' },
  ]);
  runScript('daoge.js', ['ingest',
    '--results-file', resultsFile,
    '--output-dir', outputDir,
  ]);
  assert.equal(count(outputDir, 'assets') >= 1, true);
  assert.equal(count(outputDir, 'issues') >= 1, true);
  assert.equal(count(outputDir, 'events') >= 1, true);
});

test('open server exposes health, APIs and fixed UI files', async () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  runScript('daoge.js', ['prepare',
    '--task-spec', path.join(skillRoot, 'references', 'examples', 'task_spec.minimal.json'),
    '--output-dir', outputDir,
  ]);
  const started = await startWorkbenchServer({ outputDir, port: 0 });
  try {
    const health = await fetch(`${started.url}api/health`).then((res) => res.json());
    const project = await fetch(`${started.url}api/project`).then((res) => res.json());
    const runs = await fetch(`${started.url}api/runs`).then((res) => res.json());
    const html = await fetch(started.url).then((res) => res.text());
    assert.equal(health.ok, true);
    assert.equal(project.ok, true);
    assert.equal(runs.ok, true);
    assert.match(html, /DAOGE 工作台/);
  } finally {
    started.server.close();
  }
});

test('workbench fixed UI exposes product shell and avoids old event capsule layout', async () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  runScript('daoge.js', ['prepare',
    '--task-spec', path.join(skillRoot, 'references', 'examples', 'task_spec.minimal.json'),
    '--output-dir', outputDir,
  ]);
  const started = await startWorkbenchServer({ outputDir, port: 0 });
  try {
    const [html, css, js] = await Promise.all([
      fetch(started.url).then((res) => res.text()),
      fetch(`${started.url}styles/workbench.css`).then((res) => res.text()),
      fetch(`${started.url}src/workbench.js`).then((res) => res.text()),
    ]);
    assert.match(html, /class="app-shell"/);
    assert.match(html, /class="sidebar"/);
    assert.match(html, /class="commandbar"/);
    assert.match(html, /class="workspace"/);
    assert.match(html, /class="inspector"/);
    assert.match(html, /class="activity-strip"/);
    assert.match(html, /class="toast-stack"/);
    assert.match(html, /data-shell/);
    assert.match(html, /id="pageEyebrow"/);
    assert.match(html, /id="pageControls"/);
    assert.match(html, /id="sideAssetCount"/);
    assert.match(html, /id="sideIssueCount"/);
    assert.match(html, /id="healthDot"/);
    assert.match(html, /id="healthText"/);
    assert.match(html, /id="menuButton"/);
    assert.match(html, /id="jobSummary"/);
    assert.match(html, /id="eventLog"/);
    assert.match(css, /--background:/);
    assert.match(css, /--surface:/);
    assert.match(css, /--primary:/);
    assert.match(css, /\.asset-card/);
    assert.match(css, /\.issues-board/);
    assert.match(css, /\.prompt-lab/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(js, /renderDashboard/);
    assert.match(js, /renderAssetInspector/);
    assert.match(js, /selectionBadge/);
    assert.match(js, /data-bulk-action/);
    assert.match(js, /exportBusy/);
    assert.match(js, /if \(state\.exportBusy\) return;/);
    assert.match(js, /state\.exportBusy \? '导出中' : '导出'/);
    assert.match(js, /toast\(/);
    assert.match(js, /INSPECTOR_TYPES_BY_PAGE/);
    assert.match(js, /state\.inspector/);
    assert.doesNotMatch(js, /state\.selected(?!Filter)/);
    assert.match(css, /height:\s*100dvh/);
    assert.match(css, /\.content\s*\{[\s\S]*overflow:\s*hidden/);
    assert.match(css, /\.workspace\s*\{[\s\S]*overflow:\s*auto/);
    assert.doesNotMatch(html + css + js, /event-pill|jobbar|statusFilters/);
  } finally {
    started.server.close();
  }
});

test('workbench inspector state is scoped to the active page and cleared by workflow changes', async () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  runScript('daoge.js', ['prepare',
    '--task-spec', path.join(skillRoot, 'references', 'examples', 'task_spec.minimal.json'),
    '--output-dir', outputDir,
  ]);
  const started = await startWorkbenchServer({ outputDir, port: 0 });
  try {
    const js = await fetch(`${started.url}src/workbench.js`).then((res) => res.text());
    assert.match(js, /inspector:\s*\{\s*page:\s*'dashboard'/);
    assert.match(js, /function syncInspectorToPage\(\)/);
    assert.match(js, /inspector\.page !== state\.page/);
    assert.match(js, /isInspectorAllowed\(inspector\.type,\s*state\.page\)/);
    assert.match(js, /resetInspector\('page_change'\)/);
    assert.match(js, /resetInspector\('filter_change'\)/);
    assert.match(js, /resetInspector\('asset_filter_change'\)/);
    assert.match(js, /resetInspector\('search'\)/);
    assert.match(js, /resetInspector\('refresh'\)/);
    assert.match(js, /resetInspector\('export_done'\)/);
    assert.match(js, /state\.inspector\?\.page === state\.page/);
    assert.match(js, /renderCurrentInspector\(\);/);
  } finally {
    started.server.close();
  }
});

test('workbench inspector behavior clears stale details when page or search context changes', () => {
  const { context } = createWorkbenchDomHarness();
  const pageChange = vm.runInContext(`
    state.project = { project: { name: 'VM 项目' }, counts: { assets: 3, open_issues: 2, selections: 1 } };
    state.assets.items = [{ id: 'asset_1', title: '旧资产详情', kind: 'result', status: 'ready', thumb_status: 'missing', updated_at: '2026-01-01T00:00:00.000Z' }];
    state.assets.total = 1;
    state.runs.items = [];
    state.jobs.items = [];
    state.events.items = [];
    state.page = 'assets';
    setInspector('asset', 'asset_1', state.assets.items[0], { asset: state.assets.items[0], tags: [], runs: [], prompt: null, runItem: null });
    renderCurrentInspector();
    const assetHtml = $('inspector').innerHTML;
    state.page = 'runs';
    renderCurrentInspector();
    ({ assetHtml, runHtml: $('inspector').innerHTML, inspector: state.inspector });
  `, context);
  assert.match(pageChange.assetHtml, /旧资产详情/);
  assert.match(pageChange.runHtml, /任务检查器/);
  assert.doesNotMatch(pageChange.runHtml, /旧资产详情/);
  assert.equal(pageChange.inspector.page, 'runs');
  assert.equal(pageChange.inspector.type, 'overview');

  const searchChange = vm.runInContext(`
    state.page = 'assets';
    setInspector('asset', 'asset_1', state.assets.items[0], { asset: state.assets.items[0], tags: [], runs: [], prompt: null, runItem: null });
    $('globalSearch').listeners.input({ target: { value: '蓝色瓶身' } });
    renderCurrentInspector();
    ({ html: $('inspector').innerHTML, inspector: state.inspector, query: state.query });
  `, context);
  assert.equal(searchChange.query, '蓝色瓶身');
  assert.equal(searchChange.inspector.page, 'assets');
  assert.equal(searchChange.inspector.type, 'overview');
  assert.match(searchChange.html, /资产筛选摘要/);
  assert.doesNotMatch(searchChange.html, /旧资产详情/);
});

test('workbench CSS uses fixed shell scroll regions for sidebar, main and inspector', async () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  initializeProject(outputDir, { name: 'Shell CSS' });
  const started = await startWorkbenchServer({ outputDir, port: 0 });
  try {
    const css = await fetch(`${started.url}styles/workbench.css`).then((res) => res.text());
    assert.match(css, /html,\s*body\s*\{[\s\S]*height:\s*100%/);
    assert.match(css, /\.app-shell\s*\{[\s\S]*height:\s*100dvh[\s\S]*overflow:\s*hidden/);
    assert.match(css, /\.sidebar\s*\{[\s\S]*height:\s*100dvh[\s\S]*overflow:\s*auto/);
    assert.match(css, /\.main\s*\{[\s\S]*height:\s*100dvh[\s\S]*overflow:\s*hidden/);
    assert.match(css, /\.inspector\s*\{[\s\S]*overflow:\s*auto/);
    assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*\.content\s*\{[\s\S]*display:\s*block[\s\S]*overflow:\s*auto/);
    assert.match(css, /\.primary-button,[\s\S]*\.chip-button\s*\{[\s\S]*min-height:\s*44px/);
    assert.match(css, /\.segmented button\s*\{[\s\S]*min-height:\s*44px/);
  } finally {
    started.server.close();
  }
});

test('asset file API blocks path traversal outside workspace', async () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  const project = initializeProject(outputDir, { name: 'Traversal' });
  const db = project.db;
  run(db, `
    INSERT INTO assets (
      id, project_id, kind, status, user_state, title, path,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `, ['asset_bad', project.projectId, 'result', 'ready', 'normal', '坏路径', '../secret.png']);
  const started = await startWorkbenchServer({ outputDir, port: 0 });
  try {
    const blocked = await fetch(`${started.url}api/assets/asset_bad/file`).then((res) => res.json());
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, 'ASSET_PATH_BLOCKED');
  } finally {
    started.server.close();
  }
});

test('asset file API downloads html assets instead of serving executable same-origin HTML', async () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  const project = initializeProject(outputDir, { name: 'Safe download' });
  fs.writeFileSync(path.join(outputDir, 'assets', 'exports', 'report.html'), '<script>window.bad=true</script>');
  run(project.db, `
    INSERT INTO assets (
      id, project_id, kind, status, user_state, title, path, mime,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `, ['asset_html', project.projectId, 'export', 'ready', 'normal', '报告', 'assets/exports/report.html', 'text/html']);
  const started = await startWorkbenchServer({ outputDir, port: 0 });
  try {
    const response = await fetch(`${started.url}api/assets/asset_html/file`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.match(response.headers.get('content-disposition'), /attachment/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    started.server.close();
  }
});

test('write APIs return 400 or 413 for invalid input instead of 500', async () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  runScript('daoge.js', ['prepare',
    '--task-spec', path.join(skillRoot, 'references', 'examples', 'task_spec.minimal.json'),
    '--output-dir', outputDir,
  ]);
  const started = await startWorkbenchServer({ outputDir, port: 0 });
  try {
    const badJson = await fetch(`${started.url}api/selections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    }).then(async (res) => ({ status: res.status, body: await res.json() }));
    assert.equal(badJson.status, 400);
    assert.equal(badJson.body.error.code, 'INVALID_JSON');

    const nonObject = await fetch(`${started.url}api/jobs/rerun`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    }).then(async (res) => ({ status: res.status, body: await res.json() }));
    assert.equal(nonObject.status, 400);
    assert.equal(nonObject.body.error.code, 'BODY_OBJECT_REQUIRED');

    const missingAsset = await fetch(`${started.url}api/selections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'selected' }),
    }).then(async (res) => ({ status: res.status, body: await res.json() }));
    assert.equal(missingAsset.status, 400);
    assert.equal(missingAsset.body.error.code, 'ASSET_ID_REQUIRED');

    const asset = all(openProjectDatabase(outputDir), 'SELECT id FROM assets LIMIT 1', [])[0];
    const emptyTag = await fetch(`${started.url}api/assets/${asset.id}/tags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  ' }),
    }).then(async (res) => ({ status: res.status, body: await res.json() }));
    assert.equal(emptyTag.status, 400);
    assert.equal(emptyTag.body.error.code, 'TAG_REQUIRED');

    const tooLarge = await fetch(`${started.url}api/jobs/rerun`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(1024 * 1024 + 1) }),
    }).then(async (res) => ({ status: res.status, body: await res.json() }));
    assert.equal(tooLarge.status, 413);
    assert.equal(tooLarge.body.error.code, 'BODY_TOO_LARGE');
  } finally {
    started.server.close();
  }
});

test('old workspace without daoge.db imports from internal and debug JSON', () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  runScript('daoge.js', ['prepare',
    '--task-spec', path.join(skillRoot, 'references', 'examples', 'task_spec.minimal.json'),
    '--output-dir', outputDir,
  ]);
  fs.rmSync(path.join(outputDir, 'daoge.db'), { force: true });
  fs.rmSync(path.join(outputDir, 'daoge.db-shm'), { force: true });
  fs.rmSync(path.join(outputDir, 'daoge.db-wal'), { force: true });
  const imported = ensureWorkbenchDatabase(outputDir);
  assert.equal(imported.imported, true);
  assert.equal(count(outputDir, 'prompts') >= 1, true);
  assert.equal(fs.readdirSync(path.join(outputDir, 'snapshots')).some((name) => name.startsWith('import_')), true);
});

test('assets API paginates and filters 1000+ assets', async () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  const project = initializeProject(outputDir, { name: 'Pagination' });
  const db = project.db;
  const ts = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (let i = 1; i <= 1005; i += 1) {
      run(db, `
        INSERT INTO assets (
          id, project_id, kind, status, user_state, title, path, thumb_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        `asset_${i}`,
        project.projectId,
        i % 2 ? 'result' : 'reference',
        i % 3 ? 'ready_for_selection' : 'needs_review',
        'normal',
        `asset-${i}`,
        `assets/results/${i}.png`,
        'missing',
        ts,
        `${ts}_${String(i).padStart(4, '0')}`,
      ]);
    }
    run(db, `
      INSERT INTO selections (id, project_id, asset_id, state, created_at, updated_at)
      VALUES ('selection_asset_5', ?, 'asset_5', 'selected', ?, ?)
    `, [project.projectId, ts, ts]);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const started = await startWorkbenchServer({ outputDir, port: 0 });
  try {
    const first = await fetch(`${started.url}api/assets?limit=100`).then((res) => res.json());
    assert.equal(first.ok, true);
    assert.equal(first.data.items.length, 100);
    assert.equal(Boolean(first.data.nextCursor), true);
    assert.equal(first.data.total, 1005);

    const second = await fetch(`${started.url}api/assets?limit=100&cursor=${encodeURIComponent(first.data.nextCursor)}`).then((res) => res.json());
    assert.equal(second.data.items.length, 100);
    assert.notEqual(second.data.items[0].id, first.data.items[0].id);
    assert.equal(second.data.total, 1005);

    const filteredFirst = await fetch(`${started.url}api/assets?status=ready_for_selection&limit=40`).then((res) => res.json());
    assert.equal(filteredFirst.ok, true);
    assert.equal(filteredFirst.data.items.length, 40);
    assert.equal(filteredFirst.data.total, 670);
    assert.equal(Boolean(filteredFirst.data.nextCursor), true);

    const filteredSecond = await fetch(`${started.url}api/assets?status=ready_for_selection&limit=40&cursor=${encodeURIComponent(filteredFirst.data.nextCursor)}`).then((res) => res.json());
    assert.equal(filteredSecond.ok, true);
    assert.equal(filteredSecond.data.items.length, 40);
    assert.equal(filteredSecond.data.total, 670);

    const searched = await fetch(`${started.url}api/assets?q=asset-1000&kind=reference`).then((res) => res.json());
    assert.equal(searched.data.items.length, 1);
    assert.equal(searched.data.items[0].title, 'asset-1000');

    const selected = await fetch(`${started.url}api/assets?selected=true`).then((res) => res.json());
    assert.deepEqual(selected.data.items.map((item) => item.id), ['asset_5']);
    assert.equal(selected.data.items[0].selection_state, 'selected');
    assert.equal(selected.data.items[0].selection_id, 'selection_asset_5');
    assert.equal(selected.data.items[0].selected_at, ts);

    const detail = await fetch(`${started.url}api/assets/asset_5`).then((res) => res.json());
    assert.equal(detail.ok, true);
    assert.equal(detail.data.asset.selection_state, 'selected');
    assert.equal(detail.data.asset.selection_id, 'selection_asset_5');
  } finally {
    started.server.close();
  }
});

test('issues API supports server-side search and status filtering', async () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  const project = initializeProject(outputDir, { name: 'Issue search' });
  const db = project.db;
  const runId = 'run_issue_search';
  run(db, `
    INSERT INTO runs (id, project_id, phase, status, created_at, updated_at)
    VALUES (?, ?, 'execute', 'needs_attention', datetime('now'), datetime('now'))
  `, [runId, project.projectId]);
  run(db, `
    INSERT INTO issues (
      id, project_id, run_id, type, severity, status, title, message, recommended_action, rerunnable, created_at, updated_at
    ) VALUES
      ('issue_key', ?, ?, 'needs_review', 'attention', 'open', '素材缺失', '缺少蓝色瓶身参考图', '补齐参考图', 0, datetime('now'), datetime('now')),
      ('issue_other', ?, ?, 'needs_review', 'attention', 'resolved', '接口超时', '服务暂时不可用', '稍后重试', 1, datetime('now'), datetime('now'))
  `, [project.projectId, runId, project.projectId, runId]);
  const started = await startWorkbenchServer({ outputDir, port: 0 });
  try {
    const searched = await fetch(`${started.url}api/issues?q=${encodeURIComponent('蓝色瓶身')}&status=open`).then((res) => res.json());
    assert.equal(searched.ok, true);
    assert.deepEqual(searched.data.items.map((item) => item.id), ['issue_key']);
    assert.equal(searched.data.total, 1);
  } finally {
    started.server.close();
  }
});

test('issue resolve keeps issue list and project counts in sync', async () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  const project = initializeProject(outputDir, { name: 'Issue sync' });
  const db = project.db;
  const runId = 'run_issue_sync';
  run(db, `
    INSERT INTO runs (id, project_id, phase, status, created_at, updated_at)
    VALUES (?, ?, 'execute', 'needs_attention', datetime('now'), datetime('now'))
  `, [runId, project.projectId]);
  run(db, `
    INSERT INTO issues (
      id, project_id, run_id, type, severity, status, title, message, recommended_action, rerunnable, created_at, updated_at
    ) VALUES
      ('issue_sync_a', ?, ?, 'needs_review', 'attention', 'open', '待处理 A', '需要复核', '复核', 0, datetime('now'), datetime('now')),
      ('issue_sync_b', ?, ?, 'needs_review', 'attention', 'open', '待处理 B', '需要补跑', '补跑', 1, datetime('now'), datetime('now'))
  `, [project.projectId, runId, project.projectId, runId]);
  const started = await startWorkbenchServer({ outputDir, port: 0 });
  try {
    const before = await fetch(`${started.url}api/project`).then((res) => res.json());
    assert.equal(before.data.counts.open_issues, 2);

    const resolved = await fetch(`${started.url}api/issues/issue_sync_a/resolve`, { method: 'POST' }).then((res) => res.json());
    assert.equal(resolved.ok, true);
    assert.equal(resolved.data.status, 'resolved');

    const open = await fetch(`${started.url}api/issues?status=open`).then((res) => res.json());
    assert.deepEqual(open.data.items.map((item) => item.id), ['issue_sync_b']);
    assert.equal(open.data.total, 1);

    const after = await fetch(`${started.url}api/project`).then((res) => res.json());
    assert.equal(after.data.counts.open_issues, 1);
  } finally {
    started.server.close();
  }
});

test('issues API total ignores pagination cursor', async () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  const project = initializeProject(outputDir, { name: 'Issue total' });
  const db = project.db;
  const runId = 'run_issue_total';
  run(db, `
    INSERT INTO runs (id, project_id, phase, status, created_at, updated_at)
    VALUES (?, ?, 'execute', 'needs_attention', datetime('now'), datetime('now'))
  `, [runId, project.projectId]);
  for (let i = 1; i <= 3; i += 1) {
    run(db, `
      INSERT INTO issues (
        id, project_id, run_id, type, severity, status, title, message, recommended_action, rerunnable, created_at, updated_at
      ) VALUES (?, ?, ?, 'needs_review', 'attention', 'open', ?, ?, '复核', 0, datetime('now'), ?)
    `, [`issue_page_${i}`, project.projectId, runId, `分页问题 ${i}`, '分页测试', `2026-01-01T00:00:0${i}.000Z`]);
  }
  const started = await startWorkbenchServer({ outputDir, port: 0 });
  try {
    const first = await fetch(`${started.url}api/issues?q=${encodeURIComponent('分页')}&status=open&limit=1`).then((res) => res.json());
    assert.equal(first.ok, true);
    assert.equal(first.data.items.length, 1);
    assert.equal(first.data.total, 3);
    assert.equal(Boolean(first.data.nextCursor), true);

    const second = await fetch(`${started.url}api/issues?q=${encodeURIComponent('分页')}&status=open&limit=1&cursor=${encodeURIComponent(first.data.nextCursor)}`).then((res) => res.json());
    assert.equal(second.ok, true);
    assert.equal(second.data.items.length, 1);
    assert.equal(second.data.total, 3);
  } finally {
    started.server.close();
  }
});

test('thumb endpoint only serves real thumbnails and never falls back to source image', async () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  const project = initializeProject(outputDir, { name: 'Thumbs' });
  writeTinyPng(path.join(outputDir, 'assets', 'results', 'source.png'));
  writeTinyPng(path.join(outputDir, 'assets', 'results', 'source-ready.png'));
  writeTinyPng(path.join(outputDir, 'assets', 'thumbs', 'ready.jpg'));
  run(project.db, `
    INSERT INTO assets (
      id, project_id, kind, status, user_state, title, path, thumb_path, thumb_status, mime,
      created_at, updated_at
    ) VALUES
      ('asset_missing_thumb', ?, 'result', 'ready', 'normal', '缺缩略图', 'assets/results/source.png', NULL, 'missing', 'image/png', datetime('now'), datetime('now')),
      ('asset_ready_thumb', ?, 'result', 'ready', 'normal', '有缩略图', 'assets/results/source-ready.png', 'assets/thumbs/ready.jpg', 'ready', 'image/png', datetime('now'), datetime('now'))
  `, [project.projectId, project.projectId]);
  const started = await startWorkbenchServer({ outputDir, port: 0 });
  try {
    const missing = await fetch(`${started.url}api/assets/asset_missing_thumb/thumb`);
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get('content-type'), /application\/json/);
    const ready = await fetch(`${started.url}api/assets/asset_ready_thumb/thumb`);
    assert.equal(ready.status, 200);
    assert.equal(ready.headers.get('content-type'), 'image/jpeg');
  } finally {
    started.server.close();
  }
});

test('rerun job moves through executable status flow and can be fetched', async () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  const project = initializeProject(outputDir, { name: 'Jobs' });
  const queuedId = createJob(project.db, project.projectId, 'rerun', { issue_ids: ['issue_1'] });
  const started = await startWorkbenchServer({ outputDir, port: 0 });
  try {
    const cancelled = await fetch(`${started.url}api/jobs/${queuedId}/cancel`, { method: 'POST' }).then((res) => res.json());
    assert.equal(cancelled.data.status, 'cancelled');

    const created = await fetch(`${started.url}api/jobs/rerun`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'test', issue_ids: ['issue_2'], dry_run: true }),
    }).then((res) => res.json());
    assert.equal(created.data.status, 'queued');
    assert.match(created.data.result.command, /daoge\.js rerun/);
    assert.match(created.data.result.command, /--failed-only true/);

    const fetched = await fetch(`${started.url}api/jobs/${created.data.id}`).then((res) => res.json());
    assert.equal(fetched.data.status, 'queued');
    assert.equal(fetched.data.completed_at, null);
  } finally {
    started.server.close();
  }
});

test('workbench script uses paged APIs and thumb-only asset previews', async () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  initializeProject(outputDir, { name: 'Frontend paging' });
  const started = await startWorkbenchServer({ outputDir, port: 0 });
  try {
    const js = await fetch(`${started.url}src/workbench.js`).then((res) => res.text());
    assert.match(js, /nextCursor/);
    assert.match(js, /data-more/);
    assert.match(js, /\/api\/prompts/);
    assert.match(js, /\/api\/assets\/\$\{encodeURIComponent\(asset.id\)\}\/thumb/);
    assert.doesNotMatch(js, /\/api\/assets\/\$\{encodeURIComponent\(asset.id\)\}\/file/);
  } finally {
    started.server.close();
  }
});
