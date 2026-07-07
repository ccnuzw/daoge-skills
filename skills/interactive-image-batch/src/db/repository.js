const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ensureDir, readJsonIfExists, toArray, writeJson } = require('../shared/workspace');
const { openDatabase, projectDbPath, closeDatabase } = require('./connection');
const { initializeSchema } = require('./schema');
const { generateThumbnail, isImageMime } = require('../domain/thumbs');

const EVENT_TYPES = new Set([
  'project_created',
  'run_prepared',
  'prompt_generated',
  'run_started',
  'asset_created',
  'issue_opened',
  'issue_resolved',
  'asset_selected',
  'asset_rejected',
  'rerun_requested',
  'export_created',
]);

function nowIso() {
  return new Date().toISOString();
}

function json(value) {
  return JSON.stringify(value == null ? null : value);
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stableId(parts) {
  return crypto.createHash('sha1').update(parts.filter((part) => part != null).join('|')).digest('hex').slice(0, 16);
}

function projectIdFor(outputDir) {
  return `project_${stableId([path.resolve(outputDir)])}`;
}

function runIdFor(projectId, phase, sourcePath, generatedAt, fingerprint = null) {
  return `run_${stableId([projectId, phase, sourcePath || '', fingerprint || generatedAt || 'current'])}`;
}

function promptIdFor(projectId, promptIndex) {
  return `prompt_${stableId([projectId, String(promptIndex || '')])}`;
}

function promptIdForRun(runId, promptIndex) {
  return `prompt_${stableId([runId, String(promptIndex || '')])}`;
}

function runItemIdFor(runId, itemIndex) {
  return `run_item_${stableId([runId, String(itemIndex || '')])}`;
}

function eventDedupeKey(fields) {
  return [
    fields.projectId,
    fields.runId || '',
    fields.eventType,
    fields.entityType || '',
    fields.entityId || '',
  ].join('|');
}

function normalizeAssetKind(kind) {
  const map = {
    image_result: 'result',
    issue_record: 'issue',
    selected_result: 'result',
    export_image: 'export',
    export_report: 'export',
    selection_placeholder: 'issue',
    mask: 'reference',
  };
  return map[kind] || kind || 'result';
}

function relativePath(outputDir, filePath) {
  if (!filePath) return null;
  if (!path.isAbsolute(filePath)) return filePath.split(path.sep).join('/');
  const relative = path.relative(path.resolve(outputDir), filePath);
  return relative.startsWith('..') ? filePath : relative.split(path.sep).join('/');
}

function absoluteAssetPath(outputDir, assetPath) {
  if (!assetPath) return null;
  return path.isAbsolute(assetPath) ? assetPath : path.join(path.resolve(outputDir), assetPath);
}

function sha256File(filePath) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

function imageDimensions(buffer) {
  if (!buffer || buffer.length < 24) return { width: null, height: null };
  if (buffer.toString('ascii', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  return { width: null, height: null };
}

function fileMetadata(outputDir, assetPath) {
  const filePath = absoluteAssetPath(outputDir, assetPath);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return { sha256: null, mime: null, sizeBytes: null, width: null, height: null };
  }
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.json': 'application/json',
    '.html': 'text/html',
  };
  const stat = fs.statSync(filePath);
  const fd = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(Math.min(64 * 1024, stat.size));
  try {
    fs.readSync(fd, header, 0, header.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  const dimensions = imageDimensions(header);
  return {
    sha256: sha256File(filePath),
    mime: mimeMap[ext] || 'application/octet-stream',
    sizeBytes: stat.size,
    width: dimensions.width,
    height: dimensions.height,
  };
}

function run(db, sql, params = []) {
  return db.prepare(sql).run(...params);
}

function all(db, sql, params = []) {
  return db.prepare(sql).all(...params);
}

function get(db, sql, params = []) {
  return db.prepare(sql).get(...params);
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function upsertProject(db, outputDir, fields = {}) {
  const id = fields.id || projectIdFor(outputDir);
  const ts = nowIso();
  run(db, `
    INSERT INTO projects (id, name, root_path, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      root_path = excluded.root_path,
      description = excluded.description,
      updated_at = excluded.updated_at
  `, [
    id,
    fields.name || path.basename(path.resolve(outputDir)) || 'DAOGE 项目',
    path.resolve(outputDir),
    fields.description || null,
    ts,
    ts,
  ]);
  appendEvent(db, {
    projectId: id,
    eventType: 'project_created',
    entityType: 'project',
    entityId: id,
    message: '项目已初始化',
    dedupeKey: eventDedupeKey({
      projectId: id,
      eventType: 'project_created',
      entityType: 'project',
      entityId: id,
    }),
  });
  return id;
}

function appendEvent(db, fields) {
  if (!EVENT_TYPES.has(fields.eventType)) throw new Error(`不支持事件类型：${fields.eventType}`);
  const ts = nowIso();
  const id = fields.id || `event_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${stableId([Math.random(), ts])}`}`;
  try {
    run(db, `
      INSERT INTO events (id, project_id, run_id, event_type, entity_type, entity_id, dedupe_key, message, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      fields.projectId,
      fields.runId || null,
      fields.eventType,
      fields.entityType || null,
      fields.entityId || null,
      fields.dedupeKey || null,
      fields.message || null,
      json(fields.payload || null),
      ts,
      ts,
    ]);
  } catch (error) {
    if (fields.dedupeKey && /UNIQUE constraint failed: events\.dedupe_key/.test(String(error.message || error))) {
      const existing = get(db, 'SELECT id FROM events WHERE dedupe_key = ?', [fields.dedupeKey]);
      if (existing?.id) return existing.id;
    }
    throw error;
  }
  return id;
}

function upsertSetting(db, projectId, key, value) {
  const ts = nowIso();
  const id = `setting_${stableId([projectId, key])}`;
  run(db, `
    INSERT INTO settings (id, project_id, key, value_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `, [id, projectId, key, json(value), ts, ts]);
  return id;
}

function upsertRun(db, projectId, fields = {}) {
  const ts = nowIso();
  const id = fields.id || runIdFor(projectId, fields.phase || 'prepare', fields.sourcePath, fields.generatedAt, fields.fingerprint);
  run(db, `
    INSERT INTO runs (
      id, project_id, phase, status, title, provider, model, dry_run, prompt_count,
      success_count, failed_count, skipped_count, needs_review_count, source_path,
      started_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      title = excluded.title,
      provider = excluded.provider,
      model = excluded.model,
      dry_run = excluded.dry_run,
      prompt_count = excluded.prompt_count,
      success_count = excluded.success_count,
      failed_count = excluded.failed_count,
      skipped_count = excluded.skipped_count,
      needs_review_count = excluded.needs_review_count,
      source_path = excluded.source_path,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      updated_at = excluded.updated_at
  `, [
    id,
    projectId,
    fields.phase || 'prepare',
    fields.status || 'ready',
    fields.title || null,
    fields.provider || null,
    fields.model || null,
    fields.dryRun ? 1 : 0,
    Number(fields.promptCount || 0),
    Number(fields.successCount || 0),
    Number(fields.failedCount || 0),
    Number(fields.skippedCount || 0),
    Number(fields.needsReviewCount || 0),
    fields.sourcePath || null,
    fields.startedAt || fields.generatedAt || ts,
    fields.completedAt || fields.generatedAt || ts,
    ts,
    ts,
  ]);
  appendEvent(db, {
    projectId,
    runId: id,
    eventType: fields.phase === 'prepare' ? 'run_prepared' : 'run_started',
    entityType: 'run',
    entityId: id,
    message: fields.phase === 'prepare' ? '任务已准备' : '运行已记录',
    dedupeKey: eventDedupeKey({
      projectId,
      runId: id,
      eventType: fields.phase === 'prepare' ? 'run_prepared' : 'run_started',
      entityType: 'run',
      entityId: id,
    }),
  });
  return id;
}

function upsertPrompt(db, projectId, runId, prompt, sourcePath) {
  const ts = nowIso();
  const promptIndex = String(prompt.index ?? prompt.id ?? stableId([prompt.title, prompt.generation_prompt || prompt.prompt]));
  const id = promptIdForRun(runId, promptIndex);
  run(db, `
    INSERT INTO prompts (id, project_id, run_id, prompt_index, title, prompt_text, negative_prompt, params_json, source_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, prompt_index) DO UPDATE SET
      title = excluded.title,
      prompt_text = excluded.prompt_text,
      negative_prompt = excluded.negative_prompt,
      params_json = excluded.params_json,
      source_path = excluded.source_path,
      updated_at = excluded.updated_at
  `, [
    id,
    projectId,
    runId || null,
    promptIndex,
    prompt.title || prompt.userLabel || `提示词 ${promptIndex}`,
    prompt.generation_prompt || prompt.prompt || '',
    prompt.negative_prompt || prompt.negativePrompt || null,
    json(prompt),
    sourcePath || null,
    ts,
    ts,
  ]);
  appendEvent(db, {
    projectId,
    runId,
    eventType: 'prompt_generated',
    entityType: 'prompt',
    entityId: id,
    message: '提示词已生成',
    dedupeKey: eventDedupeKey({
      projectId,
      runId,
      eventType: 'prompt_generated',
      entityType: 'prompt',
      entityId: id,
    }),
  });
  return id;
}

function upsertRunItem(db, projectId, runId, item) {
  const ts = nowIso();
  const itemIndex = String(item.index ?? item.id ?? stableId([item.title, item.output, item.error]));
  const id = runItemIdFor(runId, itemIndex);
  const prompt = get(db, 'SELECT id FROM prompts WHERE run_id = ? AND prompt_index = ?', [runId, itemIndex]);
  const promptId = prompt?.id || null;
  run(db, `
    INSERT INTO run_items (id, project_id, run_id, prompt_id, item_index, title, status, output_path, error, request_mode, batch_number, raw_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, item_index) DO UPDATE SET
      prompt_id = excluded.prompt_id,
      title = excluded.title,
      status = excluded.status,
      output_path = excluded.output_path,
      error = excluded.error,
      request_mode = excluded.request_mode,
      batch_number = excluded.batch_number,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `, [
    id,
    projectId,
    runId,
    promptId,
    itemIndex,
    item.title || `结果 ${itemIndex}`,
    item.status || (item.ok === false ? 'failed' : (item.skipped ? 'skipped' : 'success')),
    item.output || item.sourceOutput || null,
    item.error || null,
    item.requestMode || item.request_mode || null,
    Number(item.batchNumber || 0) || null,
    json(item),
    ts,
    ts,
  ]);
  if (promptId) {
    upsertAssetLink(db, projectId, 'prompt', promptId, 'run_item', id, 'prompt_result');
  }
  return id;
}

function assetRole(asset) {
  if (asset.kind === 'selected_result') return 'selected';
  if (asset.kind === 'export_image' || asset.kind === 'export_report') return 'export';
  if (asset.kind === 'image_result') return 'result';
  if (asset.kind === 'issue_record') return 'issue';
  return normalizeAssetKind(asset.kind);
}

function canonicalAssetId(projectId, kind, relativeAssetPath, sha256, fallback) {
  return `asset_${stableId([projectId, kind, relativeAssetPath || '', sha256 || '', fallback || 'asset'])}`;
}

function upsertRunAsset(db, projectId, runId, assetId, role, sourcePromptId = null, sourceRunItemId = null) {
  if (!runId || !assetId) return null;
  const ts = nowIso();
  const id = `run_asset_${stableId([projectId, runId, assetId, role])}`;
  run(db, `
    INSERT INTO run_assets (id, project_id, run_id, asset_id, role, source_prompt_id, source_run_item_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, asset_id, role) DO UPDATE SET
      source_prompt_id = excluded.source_prompt_id,
      source_run_item_id = excluded.source_run_item_id,
      updated_at = excluded.updated_at
  `, [id, projectId, runId, assetId, role, sourcePromptId, sourceRunItemId, ts, ts]);
  return id;
}

function upsertAsset(db, projectId, outputDir, asset, runId = null) {
  const ts = nowIso();
  const relativeAssetPath = relativePath(outputDir, asset.path);
  const metadata = fileMetadata(outputDir, relativeAssetPath);
  const kind = normalizeAssetKind(asset.kind);
  const assetId = canonicalAssetId(projectId, kind, relativeAssetPath, metadata.sha256, asset.id || asset.userTitle);
  const promptIndex = asset.relationships?.sourcePromptIndex ?? asset.sourcePromptIndex ?? null;
  const prompt = promptIndex != null && runId ? get(db, 'SELECT id FROM prompts WHERE run_id = ? AND prompt_index = ?', [runId, String(promptIndex)]) : null;
  const sourceResult = asset.relationships?.sourceResultId;
  const sourceIndex = sourceResult ? String(sourceResult).replace(/^result_0*/, '') : (promptIndex != null ? String(promptIndex) : null);
  const runItem = sourceIndex && runId ? get(db, 'SELECT id, prompt_id FROM run_items WHERE run_id = ? AND item_index = ?', [runId, sourceIndex]) : null;
  const sourcePromptId = prompt?.id || runItem?.prompt_id || null;
  const absolutePath = absoluteAssetPath(outputDir, relativeAssetPath);
  const thumb = isImageMime(metadata.mime)
    ? generateThumbnail(outputDir, assetId, absolutePath, metadata.mime)
    : { status: 'missing', path: null };
  run(db, `
    INSERT INTO assets (
      id, project_id, kind, status, user_status, user_state, title, path, thumb_path,
      thumb_status, mime, size_bytes, width, height, sha256,
      notes, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      status = excluded.status,
      user_status = excluded.user_status,
      title = excluded.title,
      path = excluded.path,
      thumb_path = excluded.thumb_path,
      thumb_status = excluded.thumb_status,
      mime = excluded.mime,
      size_bytes = excluded.size_bytes,
      width = excluded.width,
      height = excluded.height,
      sha256 = excluded.sha256,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `, [
    assetId,
    projectId,
    kind,
    asset.lifecycleStatus || asset.userStatus || 'ready',
    asset.userStatus || null,
    asset.userState || 'normal',
    asset.userTitle || asset.title || assetId,
    relativeAssetPath,
    thumb.path || relativePath(outputDir, asset.thumb_path),
    thumb.status,
    metadata.mime,
    metadata.sizeBytes,
    metadata.width,
    metadata.height,
    metadata.sha256,
    asset.notes || null,
    json(asset),
    ts,
    ts,
  ]);
  upsertRunAsset(db, projectId, runId, assetId, assetRole(asset), sourcePromptId, runItem?.id || null);
  appendEvent(db, {
    projectId,
    runId,
    eventType: 'asset_created',
    entityType: 'asset',
    entityId: assetId,
    message: '资产已入库',
    dedupeKey: eventDedupeKey({
      projectId,
      runId,
      eventType: 'asset_created',
      entityType: 'asset',
      entityId: assetId,
    }),
  });
  if (asset.kind === 'selected_result') {
    upsertSelection(db, projectId, assetId, 'selected', '兼容资产库推荐或用户选择', {
      dedupeKey: eventDedupeKey({
        projectId,
        eventType: 'asset_selected',
        entityType: 'asset',
        entityId: assetId,
      }),
    });
  }
  if (runItem?.id) {
    upsertAssetLink(db, projectId, 'run_item', runItem.id, 'asset', assetId, 'result_asset');
  }
  if (sourcePromptId && runItem?.id) {
    upsertAssetLink(db, projectId, 'prompt', sourcePromptId, 'run_item', runItem.id, 'prompt_result');
  }
  if (thumb.path) {
    upsertAssetLink(db, projectId, 'asset', assetId, 'thumb', thumb.path, 'result_thumb');
  }
  return assetId;
}

function upsertAssetLink(db, projectId, sourceType, sourceId, targetType, targetId, relation) {
  const ts = nowIso();
  const id = `link_${stableId([projectId, sourceType, sourceId, targetType, targetId, relation])}`;
  run(db, `
    INSERT OR IGNORE INTO asset_links (id, project_id, source_type, source_id, target_type, target_id, relation, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, projectId, sourceType, sourceId, targetType, targetId, relation, ts, ts]);
  return id;
}

function upsertIssue(db, projectId, runId, issue, options = {}) {
  const ts = nowIso();
  const id = issue.id ? `issue_${stableId([runId, issue.id])}` : `issue_${stableId([runId, issue.title, issue.sourcePromptIndex])}`;
  const status = issue.resolutionState || issue.status || 'open';
  const relatedLegacyId = issue.sourceResultId || issue.relatedAssetIds?.[0] || null;
  const assetId = relatedLegacyId ? (options.assetIdByLegacyId?.get?.(relatedLegacyId) || null) : null;
  run(db, `
    INSERT INTO issues (id, project_id, run_id, asset_id, type, severity, status, title, message, recommended_action, rerunnable, metadata_json, resolved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      run_id = excluded.run_id,
      type = excluded.type,
      severity = excluded.severity,
      status = excluded.status,
      title = excluded.title,
      message = excluded.message,
      recommended_action = excluded.recommended_action,
      rerunnable = excluded.rerunnable,
      metadata_json = excluded.metadata_json,
      resolved_at = excluded.resolved_at,
      updated_at = excluded.updated_at
  `, [
    id,
    projectId,
    runId,
    assetId,
    issue.type || 'needs_review',
    issue.severity || 'attention',
    status,
    issue.userTitle || issue.title || '需要处理',
    issue.userMessage || issue.impact || null,
    issue.userAction || issue.recommendedAction || null,
    issue.rerunnable ? 1 : 0,
    json(issue),
    status === 'resolved' ? ts : null,
    ts,
    ts,
  ]);
  appendEvent(db, {
    projectId,
    runId,
    eventType: status === 'resolved' ? 'issue_resolved' : 'issue_opened',
    entityType: 'issue',
    entityId: id,
    message: status === 'resolved' ? '问题已处理' : '问题已记录',
    dedupeKey: eventDedupeKey({
      projectId,
      runId,
      eventType: status === 'resolved' ? 'issue_resolved' : 'issue_opened',
      entityType: 'issue',
      entityId: id,
    }),
  });
  return id;
}

function upsertSelection(db, projectId, assetId, state = 'selected', reason = null, options = {}) {
  const ts = nowIso();
  const id = `selection_${stableId([projectId, assetId])}`;
  run(db, `
    INSERT INTO selections (id, project_id, asset_id, state, reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, asset_id) DO UPDATE SET state = excluded.state, reason = excluded.reason, updated_at = excluded.updated_at
  `, [id, projectId, assetId, state, reason, ts, ts]);
  appendEvent(db, {
    projectId,
    eventType: state === 'rejected' ? 'asset_rejected' : 'asset_selected',
    entityType: 'asset',
    entityId: assetId,
    message: state === 'rejected' ? '资产已标记不采用' : '资产已选择',
    dedupeKey: options.dedupeKey || null,
  });
  return id;
}

function addTagToAsset(db, projectId, assetId, name) {
  const tagName = String(name || '').trim();
  if (!tagName) throw new Error('标签不能为空');
  const ts = nowIso();
  const tagId = `tag_${stableId([projectId, tagName])}`;
  run(db, `
    INSERT INTO tags (id, project_id, name, color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, name) DO UPDATE SET updated_at = excluded.updated_at
  `, [tagId, projectId, tagName, null, ts, ts]);
  const linkId = `asset_tag_${stableId([projectId, assetId, tagId])}`;
  run(db, `
    INSERT OR IGNORE INTO asset_tags (id, project_id, asset_id, tag_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [linkId, projectId, assetId, tagId, ts, ts]);
  return tagId;
}

function createExport(db, projectId, kind, title, exportPath, metadata = {}) {
  const ts = nowIso();
  const id = `export_${stableId([projectId, kind, exportPath || title])}`;
  run(db, `
    INSERT INTO exports (id, project_id, kind, title, path, status, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, path = excluded.path, status = excluded.status, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
  `, [id, projectId, kind, title, exportPath || null, 'ready', json(metadata), ts, ts]);
  appendEvent(db, {
    projectId,
    eventType: 'export_created',
    entityType: 'export',
    entityId: id,
    message: '导出已创建',
  });
  return id;
}

function createJob(db, projectId, kind, payload = {}) {
  const ts = nowIso();
  const id = `job_${stableId([projectId, kind, ts, JSON.stringify(payload)])}`;
  run(db, `
    INSERT INTO jobs (id, project_id, kind, status, payload_json, result_json, error, started_at, completed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, projectId, kind, 'queued', json(payload), null, null, null, null, ts, ts]);
  if (kind === 'rerun') {
    appendEvent(db, {
      projectId,
      eventType: 'rerun_requested',
      entityType: 'job',
      entityId: id,
      message: '补跑任务已创建',
      payload,
    });
  }
  return id;
}

function updateJobStatus(db, projectId, jobId, status, fields = {}) {
  const ts = nowIso();
  const result = run(db, `
    UPDATE jobs
    SET status = ?,
        result_json = COALESCE(?, result_json),
        error = ?,
        started_at = COALESCE(?, started_at),
        completed_at = COALESCE(?, completed_at),
        updated_at = ?
    WHERE project_id = ? AND id = ?
  `, [
    status,
    fields.result === undefined ? null : json(fields.result),
    fields.error || null,
    fields.startedAt || null,
    fields.completedAt || null,
    ts,
    projectId,
    jobId,
  ]);
  return result.changes;
}

function createSnapshot(outputDir, prefix, data) {
  const snapshotsDir = path.join(path.resolve(outputDir), 'snapshots');
  ensureDir(snapshotsDir);
  const filePath = path.join(snapshotsDir, `${prefix}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeJson(filePath, data);
  return filePath;
}

function openProjectDatabase(outputDir) {
  const db = openDatabase(projectDbPath(outputDir));
  initializeSchema(db);
  return db;
}

function initializeProject(outputDir, fields = {}) {
  const root = path.resolve(outputDir);
  ['assets/inputs', 'assets/references', 'assets/results', 'assets/thumbs', 'assets/exports', 'assets/archive', 'snapshots'].forEach((dir) => {
    ensureDir(path.join(root, dir));
  });
  const db = openProjectDatabase(root);
  const projectId = transaction(db, () => {
    const id = upsertProject(db, root, fields);
    upsertSetting(db, id, 'workbench', { version: 1, mainEntry: 'daoge open' });
    return id;
  });
  return { db, projectId, dbPath: projectDbPath(root), outputDir: root };
}

function manifestFingerprint(parts) {
  return stableId(parts.map((part) => JSON.stringify(part || null)));
}

function loadWorkspaceBundle(root, options = {}) {
  const runPlan = readJsonIfExists(path.join(root, 'internal', 'run_plan.json')) || {};
  const executionManifest = readJsonIfExists(path.join(root, 'internal', 'execution_manifest.json')) || {};
  const issueQueue = readJsonIfExists(path.join(root, 'internal', 'issue_queue.json')) || {};
  const assetLibrary = readJsonIfExists(path.join(root, 'internal', 'asset_library.json')) || {};
  const prompts = readJsonIfExists(path.join(root, 'debug', 'prompts.generated.json')) || [];
  const prepareManifest = readJsonIfExists(path.join(root, 'internal', 'prepare_manifest.json')) || {};
  const manifestPath = options.manifestFile
    || (fs.existsSync(path.join(root, 'internal', 'local_execution_raw.json')) ? path.join(root, 'internal', 'local_execution_raw.json') : null)
    || (fs.existsSync(path.join(root, 'internal', 'host_native_execution.json')) ? path.join(root, 'internal', 'host_native_execution.json') : null)
    || path.join(root, 'internal', 'prepare_manifest.json');
  const rawManifest = readJsonIfExists(manifestPath) || prepareManifest;
  const phase = options.phase || (rawManifest.runtimeMode && rawManifest.runtimeMode !== 'prepare-only' ? 'execute' : 'prepare');
  return { runPlan, executionManifest, issueQueue, assetLibrary, prompts, rawManifest, manifestPath, phase };
}

function ingestProject(db, root, fields = {}) {
  return upsertProject(db, root, fields);
}

function ingestRun(db, projectId, root, bundle) {
  const fingerprint = manifestFingerprint([
    bundle.phase,
    bundle.rawManifest,
    bundle.executionManifest.results || [],
    bundle.prompts,
  ]);
  return upsertRun(db, projectId, {
    id: runIdFor(projectId, bundle.phase, relativePath(root, bundle.manifestPath), bundle.rawManifest.generatedAt || bundle.runPlan.generatedAt, fingerprint),
    phase: bundle.phase,
    status: Number(bundle.executionManifest.counts?.failed || bundle.rawManifest.failed || 0) ? 'needs_attention' : 'ready',
    title: bundle.runPlan.task?.title || path.basename(root),
    provider: bundle.rawManifest.providerId || bundle.rawManifest.model || null,
    model: bundle.rawManifest.model || null,
    dryRun: Boolean(bundle.rawManifest.dryRun),
    promptCount: bundle.rawManifest.selectedCount || toArray(bundle.prompts).length,
    successCount: bundle.executionManifest.counts?.success || bundle.rawManifest.success || 0,
    failedCount: bundle.executionManifest.counts?.failed || bundle.rawManifest.failed || 0,
    skippedCount: bundle.executionManifest.counts?.skipped || bundle.rawManifest.skipped || 0,
    needsReviewCount: bundle.executionManifest.counts?.needsReview || 0,
    sourcePath: relativePath(root, bundle.manifestPath),
    generatedAt: bundle.rawManifest.generatedAt || bundle.runPlan.generatedAt,
    fingerprint,
  });
}

function ingestPrompts(db, projectId, runId, prompts) {
  const promptIds = new Map();
  toArray(prompts).forEach((prompt) => {
    const id = upsertPrompt(db, projectId, runId, prompt, 'debug/prompts.generated.json');
    const promptIndex = String(prompt.index ?? prompt.id ?? stableId([prompt.title, prompt.generation_prompt || prompt.prompt]));
    promptIds.set(promptIndex, id);
  });
  return promptIds;
}

function ingestRunItems(db, projectId, runId, executionManifest) {
  const runItemIds = new Map();
  toArray(executionManifest.results).forEach((item) => {
    const id = upsertRunItem(db, projectId, runId, item);
    const itemIndex = String(item.index ?? item.id ?? stableId([item.title, item.output, item.error]));
    runItemIds.set(itemIndex, id);
    if (item.id) runItemIds.set(item.id, id);
  });
  return runItemIds;
}

function ingestAssets(db, projectId, root, runId, assetLibrary) {
  const assetIdByLegacyId = new Map();
  const assets = toArray(assetLibrary.assets);
  assets.forEach((asset) => {
    const id = upsertAsset(db, projectId, root, asset, runId);
    if (asset.id) assetIdByLegacyId.set(asset.id, id);
  });
  assets.forEach((asset) => {
    const targetId = asset.id ? assetIdByLegacyId.get(asset.id) : null;
    const sourceLegacyId = asset.relationships?.derivedFromAssetId || asset.relationships?.sourceAssetId || null;
    const sourceId = sourceLegacyId ? assetIdByLegacyId.get(sourceLegacyId) : null;
    if (sourceId && targetId) {
      const relation = asset.kind === 'export_image' || asset.kind === 'export_report' ? 'result_export' : 'result_copy';
      upsertAssetLink(db, projectId, 'asset', sourceId, 'asset', targetId, relation);
    }
  });
  const references = assets.filter((asset) => ['reference', 'input', 'mask'].includes(normalizeAssetKind(asset.kind)));
  const results = assets.filter((asset) => normalizeAssetKind(asset.kind) === 'result');
  references.forEach((reference) => {
    const referenceId = assetIdByLegacyId.get(reference.id);
    if (!referenceId) return;
    results.forEach((result) => {
      const resultId = assetIdByLegacyId.get(result.id);
      if (resultId) upsertAssetLink(db, projectId, 'asset', referenceId, 'asset', resultId, 'reference_result');
    });
  });
  return assetIdByLegacyId;
}

function ingestIssues(db, projectId, runId, issueQueue, assetIdByLegacyId) {
  toArray(issueQueue.items).forEach((issue) => upsertIssue(db, projectId, runId, issue, { assetIdByLegacyId }));
}

function syncWorkspaceToDb(outputDir, options = {}) {
  const root = path.resolve(outputDir);
  const { db } = initializeProject(root, options.project || {});
  const bundle = loadWorkspaceBundle(root, options);
  const projectId = transaction(db, () => ingestProject(db, root, options.project || {}));
  const runId = transaction(db, () => {
    const id = ingestRun(db, projectId, root, bundle);
    ingestPrompts(db, projectId, id, bundle.prompts);
    ingestRunItems(db, projectId, id, bundle.executionManifest);
    const assetIdByLegacyId = ingestAssets(db, projectId, root, id, bundle.assetLibrary);
    ingestIssues(db, projectId, id, bundle.issueQueue, assetIdByLegacyId);
    return id;
  });
  createSnapshot(root, options.snapshotPrefix || `run_${runId}`, {
    projectId,
    runId,
    syncedAt: nowIso(),
    runPlan: bundle.runPlan,
    executionManifest: bundle.executionManifest,
    issueQueue: bundle.issueQueue,
    assetLibrary: bundle.assetLibrary,
  });
  return { db, projectId, runId, dbPath: projectDbPath(root), outputDir: root };
}

function rowsToObjects(rows) {
  return rows.map((row) => {
    const out = { ...row };
    ['params_json', 'raw_json', 'metadata_json', 'payload_json', 'result_json', 'value_json'].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        out[key.replace(/_json$/, '')] = parseJson(out[key], null);
        delete out[key];
      }
    });
    return out;
  });
}

function loadProjectSummary(db, projectId) {
  const project = get(db, 'SELECT * FROM projects WHERE id = ?', [projectId]);
  const counts = get(db, `
    SELECT
      (SELECT count(*) FROM runs WHERE project_id = ?) AS runs,
      (SELECT count(*) FROM prompts WHERE project_id = ?) AS prompts,
      (SELECT count(*) FROM assets WHERE project_id = ?) AS assets,
      (SELECT count(*) FROM issues WHERE project_id = ? AND status = 'open') AS open_issues,
      (SELECT count(*) FROM selections WHERE project_id = ? AND state = 'selected') AS selections
  `, [projectId, projectId, projectId, projectId, projectId]);
  return { project, counts };
}

module.exports = {
  EVENT_TYPES,
  nowIso,
  stableId,
  projectIdFor,
  closeDatabase,
  promptIdFor,
  promptIdForRun,
  runIdFor,
  runItemIdFor,
  openProjectDatabase,
  initializeProject,
  syncWorkspaceToDb,
  transaction,
  run,
  all,
  get,
  rowsToObjects,
  upsertProject,
  upsertRun,
  upsertPrompt,
  upsertRunItem,
  upsertAsset,
  upsertRunAsset,
  upsertIssue,
  upsertSelection,
  addTagToAsset,
  createExport,
  createJob,
  updateJobStatus,
  appendEvent,
  createSnapshot,
  loadProjectSummary,
  absoluteAssetPath,
};
