function clampLimit(value, fallback = 50, max = 100) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function encodeCursor(row) {
  if (!row) return null;
  return Buffer.from(JSON.stringify({ updated_at: row.updated_at || row.created_at, id: row.id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed.updated_at || !parsed.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function pagedQuery(db, sqlParts, params, options = {}) {
  const limit = clampLimit(options.limit, options.defaultLimit || 50, options.maxLimit || 100);
  const rows = db.prepare(`${sqlParts.select} ${sqlParts.where} ${sqlParts.order} LIMIT ?`).all(...params, limit + 1);
  const items = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? encodeCursor(items[items.length - 1]) : null;
  let total = undefined;
  if (options.includeTotal && sqlParts.count) {
    total = db.prepare(`${sqlParts.count} ${sqlParts.where}`).get(...params)?.total;
  }
  return { items, nextCursor, total };
}

function addCursorClause(clauses, params, cursor, table = '') {
  const decoded = decodeCursor(cursor);
  if (!decoded) return;
  const prefix = table ? `${table}.` : '';
  clauses.push(`(${prefix}updated_at < ? OR (${prefix}updated_at = ? AND ${prefix}id < ?))`);
  params.push(decoded.updated_at, decoded.updated_at, decoded.id);
}

module.exports = { clampLimit, encodeCursor, decodeCursor, pagedQuery, addCursorClause };
