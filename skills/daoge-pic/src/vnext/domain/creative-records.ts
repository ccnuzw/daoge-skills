import { StudioDatabase } from '../studio/database';
import { StudioAsset, getStudioAsset } from './assets';
import { InvalidCommandError, StudioNotFoundError } from './studio-commands';
import { publicRunPlanSnapshot, publicRunRequestSummary } from './queries';
import { safeErrorDetail } from '../shared/safe-error';

type JsonRecord = Record<string, unknown>;
type TaskRow = { id: string; project_id: string; name: string; status: string; intent_json: string; project_name: string; };
type RoundRow = { id: string; task_id: string; parent_round_id: string | null; purpose: string; plan_json: string; plan_version: number; status: string; created_at: string; updated_at: string; };

function parseRecord(value: string): JsonRecord { try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonRecord : {}; } catch { return {}; } }
function safeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeValue);
  if (!value || typeof value !== 'object') return value;
  const result: JsonRecord = {};
  for (const [key, item] of Object.entries(value as JsonRecord)) if (!/(api[_-]?key|authorization|secret|token|base[_-]?url|endpoint|password|external.*request|storage.*path|content.*hash)/i.test(key)) result[key] = safeValue(item);
  return result;
}
function taskRow(db: StudioDatabase, studioId: string, taskId: string): TaskRow {
  const value = db.prepare('SELECT task.id, task.project_id, task.name, task.status, task.intent_json, project.name AS project_name FROM creative_tasks task JOIN projects project ON project.id = task.project_id WHERE task.id = ? AND project.studio_id = ?').get(taskId, studioId) as TaskRow | undefined;
  if (!value) throw new StudioNotFoundError('Creative task not found: ' + taskId);
  return value;
}
function roundRow(db: StudioDatabase, studioId: string, roundId: string): RoundRow {
  const value = db.prepare('SELECT round.id, round.task_id, round.parent_round_id, round.purpose, round.plan_json, round.plan_version, round.status, round.created_at, round.updated_at FROM creative_rounds round JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE round.id = ? AND project.studio_id = ?').get(roundId, studioId) as RoundRow | undefined;
  if (!value) throw new StudioNotFoundError('Creative round not found: ' + roundId);
  return value;
}
function publicRound(round: RoundRow): JsonRecord { return { id: round.id, parentRoundId: round.parent_round_id, purpose: round.purpose, planVersion: round.plan_version, status: round.status, plan: safeValue(parseRecord(round.plan_json)), createdAt: round.created_at, updatedAt: round.updated_at }; }
function lineage(db: StudioDatabase, studioId: string, round: RoundRow): { rounds: JsonRecord[]; truncated: boolean } {
  const rounds: JsonRecord[] = [];
  const visited = new Set<string>([round.id]);
  let parentId = round.parent_round_id;
  let truncated = false;
  while (parentId && rounds.length < 32) {
    if (visited.has(parentId)) { truncated = true; break; }
    const parent = roundRow(db, studioId, parentId);
    if (parent.task_id !== round.task_id) { truncated = true; break; }
    visited.add(parent.id);
    rounds.push(publicRound(parent));
    parentId = parent.parent_round_id;
  }
  if (parentId && rounds.length >= 32) truncated = true;
  return { rounds, truncated };
}
function outputAssetsByItem(db: StudioDatabase, itemIds: string[]): Map<string, JsonRecord[]> {
  const results = new Map<string, JsonRecord[]>();
  if (!itemIds.length) return results;
  const placeholders = itemIds.map(() => '?').join(',');
  const rows = db.prepare('SELECT relation.target_id AS item_id, asset.id, asset.kind, asset.media_type, asset.deleted_at FROM asset_relations relation JOIN assets asset ON asset.id = relation.asset_id WHERE relation.relation_type = \'output_of\' AND relation.target_type = \'run_item\' AND relation.target_id IN (' + placeholders + ') ORDER BY asset.created_at, asset.id').all(...itemIds) as Array<{ item_id: string; id: string; kind: string; media_type: string; deleted_at: string | null }>;
  for (const row of rows) { const current = results.get(row.item_id) || []; current.push({ id: row.id, kind: row.kind, mediaType: row.media_type, deletedAt: row.deleted_at }); results.set(row.item_id, current); }
  return results;
}

export function purposeLabel(value: string): string { return ({ exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' } as Record<string, string>)[value] || value || '创作'; }

function assetDisplayContexts(db: StudioDatabase, assets: StudioAsset[]): Map<string, JsonRecord> {
  const displays = new Map<string, JsonRecord>();
  if (!assets.length) return displays;
  const placeholders = assets.map(() => '?').join(',');
  const rows = db.prepare(
    "WITH first_outputs AS (" +
      "SELECT relation.asset_id, item.sequence AS item_sequence, round.id AS round_id, round.task_id, " +
      "round.created_at AS round_created_at, round.purpose AS round_purpose, task.name AS task_name, " +
      "run.id AS run_id, run.round_id AS run_round_id, run.created_at AS run_created_at, " +
      "ROW_NUMBER() OVER (PARTITION BY relation.asset_id ORDER BY run.created_at, run.id, item.sequence) AS position " +
      "FROM asset_relations relation JOIN run_items item ON item.id = relation.target_id " +
      "JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id " +
      "JOIN creative_tasks task ON task.id = round.task_id WHERE relation.asset_id IN (" + placeholders + ") " +
      "AND relation.relation_type = 'output_of' AND relation.target_type = 'run_item') " +
    "SELECT first.asset_id, first.item_sequence, first.round_purpose, first.task_name, " +
      "1 + (SELECT COUNT(*) FROM creative_rounds prior_round WHERE prior_round.task_id = first.task_id " +
        "AND (prior_round.created_at < first.round_created_at OR " +
          "(prior_round.created_at = first.round_created_at AND prior_round.id < first.round_id))) AS round_sequence, " +
      "1 + (SELECT COUNT(*) FROM generation_runs prior_run WHERE prior_run.round_id = first.run_round_id " +
        "AND (prior_run.created_at < first.run_created_at OR " +
          "(prior_run.created_at = first.run_created_at AND prior_run.id < first.run_id))) AS run_sequence " +
    "FROM first_outputs first WHERE first.position = 1 ORDER BY first.asset_id"
  ).all(...assets.map((asset) => asset.id)) as Array<{ asset_id: string; item_sequence: number; round_purpose: string; task_name: string; round_sequence: number; run_sequence: number }>;
  for (const row of rows) {
    const roundLabel = purposeLabel(row.round_purpose) + '第 ' + row.round_sequence + ' 轮';
    const label = row.task_name + ' · ' + roundLabel + ' · 运行 ' + row.run_sequence + ' · 第 ' + row.item_sequence + ' 张';
    displays.set(row.asset_id, { label, selectionText: label, taskName: row.task_name, roundPurpose: row.round_purpose, roundSequence: row.round_sequence, runSequence: row.run_sequence, itemSequence: row.item_sequence });
  }
  for (const asset of assets) if (!displays.has(asset.id)) displays.set(asset.id, { label: asset.kind === 'import' ? '导入素材' : asset.kind === 'export' ? '导出素材' : '生成结果', selectionText: asset.kind === 'import' ? '导入素材' : asset.kind === 'export' ? '导出素材' : '生成结果' });
  return displays;
}

export function listAssetsWithReviewSummaries(db: StudioDatabase, assets: StudioAsset[], projectId?: string): Array<StudioAsset & { review: JsonRecord | null; display: JsonRecord }> {
  if (!assets.length) return [];
  const reviews = new Map<string, JsonRecord>();
  const displays = assetDisplayContexts(db, assets);
  const placeholders = assets.map(() => '?').join(',');
  const scope = projectId ? " AND ((review.task_id IS NULL AND review.round_id IS NULL) OR task.project_id = ? OR round_task.project_id = ?)" : '';
  const rows = db.prepare("WITH ranked_reviews AS (SELECT review.asset_id, review.decision, review.created_at, ROW_NUMBER() OVER (PARTITION BY review.asset_id ORDER BY review.created_at DESC, review.rowid DESC) AS position FROM review_decisions review LEFT JOIN creative_tasks task ON task.id = review.task_id LEFT JOIN creative_rounds round ON round.id = review.round_id LEFT JOIN creative_tasks round_task ON round_task.id = round.task_id WHERE review.asset_id IN (" + placeholders + ")" + scope + ') SELECT asset_id, decision, created_at FROM ranked_reviews WHERE position = 1').all(...assets.map((asset) => asset.id), ...(projectId ? [projectId, projectId] : [])) as Array<{ asset_id: string; decision: string; created_at: string }>;
  for (const row of rows) reviews.set(row.asset_id, { decision: row.decision, createdAt: row.created_at });
  return assets.map((asset) => ({ ...asset, review: reviews.get(asset.id) || null, display: displays.get(asset.id) || { label: '素材', selectionText: '素材' } }));
}

export function getTaskCreativeOverview(db: StudioDatabase, studioId: string, taskId: string): JsonRecord {
  const task = taskRow(db, studioId, taskId);
  const rounds = db.prepare('SELECT round.id, round.parent_round_id, round.purpose, round.plan_version, round.status, round.created_at, (SELECT COUNT(*) FROM generation_runs run WHERE run.round_id = round.id) AS run_count, (SELECT COUNT(DISTINCT asset.id) FROM generation_runs run JOIN run_items item ON item.run_id = run.id JOIN asset_relations relation ON relation.target_id = item.id AND relation.target_type = \'run_item\' AND relation.relation_type = \'output_of\' JOIN assets asset ON asset.id = relation.asset_id WHERE run.round_id = round.id) AS result_count FROM creative_rounds round WHERE round.task_id = ? ORDER BY round.created_at, round.id').all(task.id) as Array<{ id: string; parent_round_id: string | null; purpose: string; plan_version: number; status: string; created_at: string; run_count: number; result_count: number }>;
  const totals = rounds.reduce((value, round) => ({ runCount: value.runCount + Number(round.run_count), resultCount: value.resultCount + Number(round.result_count) }), { runCount: 0, resultCount: 0 });
  return { task: { id: task.id, projectId: task.project_id, projectName: task.project_name, name: task.name, status: task.status, intent: safeValue(parseRecord(task.intent_json)) }, summary: { roundCount: rounds.length, ...totals }, rounds: rounds.map((round) => ({ id: round.id, parentRoundId: round.parent_round_id, purpose: round.purpose, planVersion: round.plan_version, status: round.status, createdAt: round.created_at, runCount: Number(round.run_count), resultCount: Number(round.result_count) })) };
}

function comparisonPlanSummary(value: JsonRecord): JsonRecord { const plan = safeValue(value) as JsonRecord; return { operation: plan.operation === 'edit' ? 'edit' : 'generate', itemCount: Number(plan.itemCount || 0) }; }
function comparisonLineage(rounds: Map<string, RoundRow>, round: RoundRow): JsonRecord {
  const lineageRounds: JsonRecord[] = [];
  const visited = new Set<string>([round.id]);
  let parentId = round.parent_round_id;
  let truncated = false;
  while (parentId && lineageRounds.length < 32) {
    const parent = rounds.get(parentId);
    if (!parent || visited.has(parentId) || parent.task_id !== round.task_id) { truncated = true; break; }
    visited.add(parent.id);
    lineageRounds.push(publicRound(parent));
    parentId = parent.parent_round_id;
  }
  if (parentId && lineageRounds.length >= 32) truncated = true;
  return { truncated, rounds: lineageRounds.map((parent) => ({ id: parent.id, parentRoundId: parent.parentRoundId, purpose: parent.purpose, planVersion: parent.planVersion, status: parent.status, createdAt: parent.createdAt })) };
}
function reviewedOutputs(db: StudioDatabase, studioId: string, projectId: string, items: JsonRecord[]): Map<string, JsonRecord> {
  const ids = [...new Set(items.flatMap((item) => Array.isArray(item.outputAssets) ? item.outputAssets.map((asset) => String((asset as JsonRecord).id || '')) : []).filter(Boolean))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const assets = (db.prepare('SELECT id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, deleted_at FROM assets WHERE studio_id = ? AND id IN (' + placeholders + ')').all(studioId, ...ids) as Array<{ id: string; studio_id: string; kind: StudioAsset['kind']; media_type: string; storage_path: string; content_hash: string; byte_size: number; source_json: string; deleted_at: string | null }>).map((asset) => ({ id: asset.id, studioId: asset.studio_id, kind: asset.kind, mediaType: asset.media_type, storagePath: asset.storage_path, contentHash: asset.content_hash, byteSize: asset.byte_size, source: parseRecord(asset.source_json), deletedAt: asset.deleted_at }));
  const summaries = listAssetsWithReviewSummaries(db, assets, projectId);
  return new Map(summaries.map((asset) => [asset.id, { id: asset.id, kind: asset.kind, mediaType: asset.mediaType, deletedAt: asset.deletedAt, review: asset.review, display: asset.display }]));
}

export function getTaskStudioOverview(db: StudioDatabase, studioId: string, taskId: string, selectedRoundIds: string[] = []): JsonRecord {
  const task = taskRow(db, studioId, taskId);
  const available = db.prepare('SELECT id, task_id, parent_round_id, purpose, plan_json, plan_version, status, created_at, updated_at FROM creative_rounds WHERE task_id = ? ORDER BY created_at, id').all(task.id) as RoundRow[];
  const selected = [...new Set(selectedRoundIds.filter(Boolean))];
  if (selected.length > 12) throw new InvalidCommandError('At most 12 rounds can be compared.');
  const byId = new Map(available.map((round) => [round.id, round]));
  for (const id of selected) if (!byId.has(id)) throw new InvalidCommandError('Selected round does not belong to this task.');
  const selectedRounds = selected.map((id) => byId.get(id) as RoundRow);
  const selectedPlaceholders = selected.map(() => '?').join(',');
  const summaries = new Map<string, { runCount: number; resultCount: number }>();
  const runsByRound = new Map<string, Array<{ id: string; status: string }>>();
  const itemsByRun = new Map<string, JsonRecord[]>();
  if (selected.length) {
    const summaryRows = db.prepare("SELECT run.round_id, COUNT(DISTINCT run.id) AS run_count, COUNT(DISTINCT relation.asset_id) AS result_count FROM generation_runs run LEFT JOIN run_items item ON item.run_id = run.id LEFT JOIN asset_relations relation ON relation.target_id = item.id AND relation.target_type = 'run_item' AND relation.relation_type = 'output_of' WHERE run.round_id IN (" + selectedPlaceholders + ') GROUP BY run.round_id').all(...selected) as Array<{ round_id: string; run_count: number; result_count: number }>;
    for (const row of summaryRows) summaries.set(row.round_id, { runCount: Number(row.run_count), resultCount: Number(row.result_count) });
    const runRows = db.prepare("WITH ranked_runs AS (SELECT id, round_id, status, ROW_NUMBER() OVER (PARTITION BY round_id ORDER BY created_at DESC, id DESC) AS position FROM generation_runs WHERE round_id IN (" + selectedPlaceholders + ')) SELECT id, round_id, status FROM ranked_runs WHERE position <= 24 ORDER BY round_id, position').all(...selected) as Array<{ id: string; round_id: string; status: string }>;
    for (const run of runRows) { const current = runsByRound.get(run.round_id) || []; current.push({ id: run.id, status: run.status }); runsByRound.set(run.round_id, current); }
    if (runRows.length) {
      const runPlaceholders = runRows.map(() => '?').join(',');
      const itemRows = db.prepare('SELECT id, run_id, sequence, status, attempts FROM run_items WHERE run_id IN (' + runPlaceholders + ') ORDER BY run_id, sequence').all(...runRows.map((run) => run.id)) as Array<{ id: string; run_id: string; sequence: number; status: string; attempts: number }>;
      const outputs = outputAssetsByItem(db, itemRows.map((item) => item.id));
      for (const item of itemRows) { const current = itemsByRun.get(item.run_id) || []; current.push({ id: item.id, sequence: item.sequence, status: item.status, attempts: item.attempts, outputAssets: outputs.get(item.id) || [] }); itemsByRun.set(item.run_id, current); }
    }
  }
  const assets = reviewedOutputs(db, studioId, task.project_id, [...itemsByRun.values()].flat());
  const comparisons = selectedRounds.map((round) => {
    const summary = summaries.get(round.id) || { runCount: 0, resultCount: 0 };
    const runs = runsByRound.get(round.id) || [];
    return { round: { id: round.id, parentRoundId: round.parent_round_id, purpose: round.purpose, status: round.status, planVersion: round.plan_version, createdAt: round.created_at, updatedAt: round.updated_at, plan: comparisonPlanSummary(parseRecord(round.plan_json)) }, lineage: comparisonLineage(byId, round), summary, runsTruncated: summary.runCount > runs.length, runs: runs.map((run) => ({ id: run.id, status: run.status, items: (itemsByRun.get(run.id) || []).map((item) => ({ ...item, outputAssets: (item.outputAssets as JsonRecord[]).map((asset) => assets.get(String(asset.id)) || asset) })) })) };
  });
  return { task: { id: task.id, projectId: task.project_id, projectName: task.project_name, name: task.name, status: task.status }, availableRounds: available.map((round) => ({ id: round.id, parentRoundId: round.parent_round_id, purpose: round.purpose, status: round.status, planVersion: round.plan_version, createdAt: round.created_at })), selectedRoundIds: selected, comparisons };
}

export function getRoundCreativeRecord(db: StudioDatabase, studioId: string, roundId: string, runId?: string): JsonRecord {
  const round = roundRow(db, studioId, roundId);
  const task = taskRow(db, studioId, round.task_id);
  const runs = db.prepare('SELECT id, status, plan_snapshot_json, created_at, updated_at, completed_at FROM generation_runs WHERE round_id = ? ORDER BY created_at DESC, id DESC').all(round.id) as Array<{ id: string; status: string; plan_snapshot_json: string; created_at: string; updated_at: string; completed_at: string | null }>;
  if (runId && !runs.some((run) => run.id === runId)) throw new InvalidCommandError('Selected run does not belong to this round.');
  const selectedItems = runId ? db.prepare('SELECT id, sequence, status, attempts, retry_at, error_json, created_at, updated_at FROM run_items WHERE run_id = ? ORDER BY sequence').all(runId) as Array<{ id: string; sequence: number; status: string; attempts: number; retry_at: string | null; error_json: string | null; created_at: string; updated_at: string }> : [];
  const outputs = outputAssetsByItem(db, selectedItems.map((item) => item.id));
  const allOutputCount = Number((db.prepare('SELECT COUNT(DISTINCT asset.id) AS count FROM generation_runs run JOIN run_items item ON item.run_id = run.id JOIN asset_relations relation ON relation.target_id = item.id AND relation.target_type = \'run_item\' AND relation.relation_type = \'output_of\' JOIN assets asset ON asset.id = relation.asset_id WHERE run.round_id = ?').get(round.id) as { count: number }).count);
  const parentLineage = lineage(db, studioId, round);
  return { task: { id: task.id, projectId: task.project_id, projectName: task.project_name, name: task.name, intent: safeValue(parseRecord(task.intent_json)) }, round: publicRound(round), lineage: parentLineage, summary: { runCount: runs.length, resultCount: allOutputCount }, runs: runs.map((run) => { const plan = parseRecord(run.plan_snapshot_json); return { id: run.id, shortId: run.id.slice(-8), status: run.status, planVersion: round.plan_version, createdAt: run.created_at, updatedAt: run.updated_at, completedAt: run.completed_at, planSnapshot: publicRunPlanSnapshot(plan), requestSummary: publicRunRequestSummary(plan) }; }), selectedRunId: runId || null, items: selectedItems.map((item) => ({ id: item.id, sequence: item.sequence, status: item.status, attempts: item.attempts, retryAt: item.retry_at, error: item.error_json ? safeErrorDetail(parseRecord(item.error_json)) : null, createdAt: item.created_at, updatedAt: item.updated_at, outputAssets: outputs.get(item.id) || [] })) };
}

export function getAssetProvenance(db: StudioDatabase, studioId: string, assetId: string): JsonRecord {
  const asset = getStudioAsset(db, studioId, assetId);
  if (!asset) throw new StudioNotFoundError('Studio asset not found: ' + assetId);
  const outputs = db.prepare('SELECT item.id AS item_id, item.sequence AS item_sequence, item.status AS item_status, run.id AS run_id, run.status AS run_status, round.id AS round_id, round.purpose AS round_purpose, task.id AS task_id, task.name AS task_name, project.id AS project_id, project.name AS project_name FROM asset_relations relation JOIN run_items item ON item.id = relation.target_id JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE relation.asset_id = ? AND relation.relation_type = \'output_of\' AND relation.target_type = \'run_item\' AND project.studio_id = ? ORDER BY run.created_at, item.sequence').all(asset.id, studioId) as Array<{ item_id: string; item_sequence: number; item_status: string; run_id: string; run_status: string; round_id: string; round_purpose: string; task_id: string; task_name: string; project_id: string; project_name: string }>;
  const reviews = db.prepare('SELECT review.id, review.decision, review.feedback_json, review.task_id, review.round_id, review.created_at FROM review_decisions review WHERE review.asset_id = ? ORDER BY review.created_at, review.rowid').all(asset.id) as Array<{ id: string; decision: string; feedback_json: string; task_id: string | null; round_id: string | null; created_at: string }>;
  const relations = db.prepare('SELECT relation_type, target_type, target_id, created_at FROM asset_relations WHERE asset_id = ? AND NOT (relation_type = \'output_of\' AND target_type = \'run_item\') ORDER BY created_at, id').all(asset.id) as Array<{ relation_type: string; target_type: string; target_id: string; created_at: string }>;
  const deliveries = db.prepare('SELECT delivery.id, delivery.name, delivery.status, delivery.project_id FROM delivery_assets item JOIN deliveries delivery ON delivery.id = item.delivery_id WHERE item.asset_id = ? ORDER BY delivery.updated_at DESC').all(asset.id) as Array<{ id: string; name: string; status: string; project_id: string }>;
  const lineages = outputs.map((output) => ({ runId: output.run_id, ...lineage(db, studioId, roundRow(db, studioId, output.round_id)) }));
  const batches = db.prepare("SELECT batch.id, batch.name, version.id AS version_id, version.version_no, version.status FROM delivery_assets delivery_asset JOIN delivery_batch_version_deliveries member ON member.delivery_id = delivery_asset.delivery_id JOIN delivery_batch_versions version ON version.id = member.version_id JOIN delivery_batches batch ON batch.id = version.batch_id JOIN projects project ON project.id = batch.project_id WHERE delivery_asset.asset_id = ? AND project.studio_id = ? ORDER BY batch.updated_at DESC, version.version_no DESC").all(asset.id, studioId) as Array<{ id: string; name: string; version_id: string; version_no: number; status: string }>;
  return { asset: { id: asset.id, kind: asset.kind, mediaType: asset.mediaType, byteSize: asset.byteSize, deletedAt: asset.deletedAt, source: safeValue(asset.source) }, outputs: outputs.map((output) => ({ runItem: { id: output.item_id, sequence: output.item_sequence, status: output.item_status }, run: { id: output.run_id, status: output.run_status }, round: { id: output.round_id, purpose: output.round_purpose }, task: { id: output.task_id, name: output.task_name }, project: { id: output.project_id, name: output.project_name } })), lineages, reviews: reviews.map((review) => ({ id: review.id, decision: review.decision, feedback: safeValue(parseRecord(review.feedback_json)), taskId: review.task_id, roundId: review.round_id, createdAt: review.created_at })), relations, deliveries: deliveries.map((delivery) => ({ id: delivery.id, name: delivery.name, status: delivery.status, projectId: delivery.project_id })), deliveryBatches: batches.map((batch) => ({ id: batch.id, name: batch.name, versionId: batch.version_id, versionNo: batch.version_no, status: batch.status })) };
}
