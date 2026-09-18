const test = require('node:test');
const assert = require('node:assert/strict');
const { readFrontendSource, readSource } = require('./source-text');

const modelPath = '../../web/src/lineage-accessible-model.mjs';

function node(entityType, entityId, extra = {}) {
  return { key: entityType + ':' + entityId, entityType, entityId, title: entityType + ' title', subtitle: '', status: 'active', ...extra };
}

test('builds a safe non-visual outline for loaded nodes and unresolved relationships', async () => {
  const { createAccessibleLineage } = await import(modelPath);
  const project = node('project', 'project_alpha', { title: 'Project https://provider.example/v1', subtitle: '/Users/apple/private-project' });
  const task = node('task', 'task_alpha', { title: 'Hero task', subtitle: 'prompt: raw creative prompt must not be shown' });
  const round = node('round', 'round_alpha', { title: '探索轮次', subtitle: '计划 v2 · 生成 · 3 项' });
  const plan = node('plan', 'round_alpha', { title: '计划 v2', subtitle: '生成 · 3 项 · 图片 · 2 个参考', planDetail: { prompt: 'raw plan prompt' } });
  const run = node('run', 'run_alpha', { title: '生成运行 run_alpha', subtitle: '计划 v2 · 4 路并发', status: 'running' });
  const runItem = node('run_item', 'item_alpha', { title: '第 1 项', runId: 'run_alpha', roundId: 'round_alpha', status: 'failed', entity: { status: 'failed', error: { summary: 'Authorization: sk-secret12345678 https://provider.example/raw' } } });
  const asset = node('asset', 'asset_alpha', { title: '/private/raw.png', subtitle: '媒体不可用 · 来自第 1 项', status: 'unavailable', mediaUnavailable: true });
  const delivery = node('delivery', 'delivery_alpha', { title: '首发交付', subtitle: '1 张图片 · completed', status: 'completed' });
  const nodes = [project, task, round, plan, run, runItem, asset, delivery];
  const outline = createAccessibleLineage({
    nodes,
    connections: [
      { id: 'project-task', from: project.key, to: task.key, type: 'contains', label: '包含任务' },
      { id: 'item-asset', from: runItem.key, to: asset.key, type: 'generated', label: '生成资产' },
      { id: 'asset-delivery', from: asset.key, to: delivery.key, type: 'delivery', label: '加入交付' },
      { id: 'asset-missing', from: asset.key, to: 'asset:asset_not_loaded', type: 'generated', label: '生成资产' }
    ],
    endpointByKey: new Map(nodes.map((item) => [item.key, item])),
    scope: { type: 'project', id: project.entityId },
    coverage: { assets: { loaded: 1, total: 3 }, runItems: { loaded: 1, total: 2 } }
  });

  assert.deepEqual(outline.nodes.map((item) => item.type), ['project', 'task', 'round', 'plan', 'run', 'run_item', 'asset', 'delivery']);
  assert.equal(outline.connections.length, 4);
  assert.equal(outline.coverage.complete, false);
  assert.deepEqual(outline.coverage.rows.map((row) => [row.id, row.loaded, row.total]), [['assets', 1, 3], ['run-items', 1, 2]]);
  assert.equal(outline.coverage.unresolvedRelations, 1);
  assert.match(outline.coverage.message, /仅展示已加载数据/);
  assert.match(outline.connections[3].target.title, /未加载/);
  assert.equal(outline.nodes.find((item) => item.type === 'asset').status.label, '媒体不可用');
  assert.equal(outline.nodes.find((item) => item.type === 'run_item').openable, true);

  const serialized = JSON.stringify(outline);
  assert.doesNotMatch(serialized, /provider\.example|private-project|raw\.png|raw creative prompt|raw plan prompt|sk-secret12345678/);
});

test('does not expose unlabeled plan or resource text in the accessible outline', async () => {
  const { createAccessibleLineage } = await import(modelPath);
  const plan = node('plan', 'round_prompt', { subtitle: 'plain ordinary prompt phrase must not be spoken' });
  const resource = node('style_kit', 'style_prompt', { subtitle: 'another ordinary prompt phrase must not be spoken' });
  const outline = createAccessibleLineage({ nodes: [plan, resource] });
  const serialized = JSON.stringify(outline);
  assert.doesNotMatch(serialized, /ordinary prompt phrase/);
  assert.match(outline.nodes[0].summary, /提示词等受保护字段/);
  assert.match(outline.nodes[1].summary, /具体内容不在此视图展示/);
});

test('does not report complete coverage while lineage pages are loading', async () => {
  const { createAccessibleLineage } = await import(modelPath);
  const outline = createAccessibleLineage({ coverage: { assets: { loaded: 0, total: 0, loading: true }, runItems: { loaded: 0, total: 0, loading: true } } });
  assert.equal(outline.coverage.complete, false);
  assert.equal(outline.coverage.rows.every((row) => row.loading === true), true);
  assert.match(outline.coverage.message, /仅展示已加载数据/);
});

test('uses existing safe status semantics for media and exceptional run states', async () => {
  const { createAccessibleLineage } = await import(modelPath);
  const asset = node('asset', 'asset_keep', { title: '主视觉', selectedAsset: true, status: 'selected' });
  const unavailable = node('asset', 'asset_missing', { title: '缺失媒体', mediaUnavailable: true, status: 'unavailable' });
  const failed = node('run_item', 'item_failed', { title: '第 2 项', status: 'failed', entity: { status: 'failed', error: { summary: '脱敏失败摘要', kind: 'provider', code: 'provider_error' } } });
  const unknown = node('run_item', 'item_unknown', { title: '第 3 项', status: 'outcome_unknown', entity: { status: 'outcome_unknown' } });
  const outline = createAccessibleLineage({ nodes: [asset, unavailable, failed, unknown] });

  assert.equal(outline.nodes[0].status.label, '已选成果');
  assert.equal(outline.nodes[1].status.label, '媒体不可用');
  assert.equal(outline.nodes[1].status.tone, 'danger');
  assert.equal(outline.nodes[2].status.label, '失败');
  assert.match(outline.nodes[2].summary, /隐去隐私的错误摘要/);
  assert.equal(outline.nodes[3].status.label, '需核实结果');
  assert.match(outline.nodes[3].summary, /这张的状态已隐去隐私/);
});

test('marks complete loaded coverage without claiming a virtualized window is the graph', async () => {
  const { createAccessibleLineage } = await import(modelPath);
  const project = node('project', 'project_complete', { title: '项目' });
  const outline = createAccessibleLineage({
    nodes: [project],
    coverage: { assets: { loaded: 0, total: 0 }, runItems: { loaded: 0, total: 0 } }
  });

  assert.equal(outline.coverage.complete, true);
  // 意图：覆盖率文案必须说明「这份列表来自已加载数据，且分页已全覆盖」，不许冒充完整谱系。
  // 「关系端点」已按术语单收回到「连线」（docs/daoge_pic_terminology_zh.md）。
  assert.match(outline.coverage.message, /已加载的谱系数据[\s\S]*均已覆盖/);
  assert.doesNotMatch(outline.coverage.message, /端点/);
  assert.match(outline.coverage.canvasNote, /虚拟化/);
  assert.equal(outline.nodes[0].openable, true);
});

test('ordinary lineage canvas keeps raw plan prompts, errors, paths, and keys out of UI/search contracts', () => {
  const lineage = readFrontendSource();
  const haystack = lineage.match(/function nodeSearchHaystack[\s\S]*?\n}/)?.[0] || '';
  const details = lineage.match(/function roundPlanDetails[\s\S]*?\n}/)?.[0] || '';
  const actions = lineage.match(/function PlanActions[\s\S]*?function LineageAssetGetActions/)?.[0] || '';

  assert.match(lineage, /import \{ createAccessibleLineage, redactLineageText \}/);
  assert.match(lineage, /PLAN_PROMPT_PROTECTED_LABEL/);
  assert.match(lineage, /assetCoverage = null/);
  assert.match(lineage, /loading: lineageAssetLoading \|\| !layoutReady/);
  assert.match(lineage, /loading: runItemCoverage\?\.loading === true \|\| !layoutReady/);
  assert.match(lineage, /const assetCountLabel = lineageAssetLoading/);
  assert.doesNotMatch(details, /plan\.description|plan\.prompt|plan\.promptSummary/);
  assert.match(details, /promptNotice: PLAN_PROMPT_PROTECTED_LABEL/);
  assert.doesNotMatch(details, /prompt\s*=\s*.*plan\.description/);
  assert.doesNotMatch(actions, /detail\.prompt(?!Notice)/);
  assert.doesNotMatch(haystack, /prompt|description|error|brief/);
  assert.doesNotMatch(readSource('web/src/creative-lineage-canvas.jsx'), /node\.planDetail\?\.prompt/);
  assert.doesNotMatch(readSource('web/src/creative-lineage-canvas.jsx'), /<p>\{item\.error/);
  assert.doesNotMatch(readSource('web/src/creative-lineage-canvas.jsx'), /project\.description \|\| '项目工作区'\)\.slice/);
});
