const HIDDEN_KEY = /(api[_-]?key|authorization|secret|token|base[_-]?url|endpoint|password|external.*request|storage.*path|content.*hash|capability|cookie|provider)/i;

function text(value) { return typeof value === 'string' ? value.trim() : ''; }

function redactedText(value, maxLength = 320) {
  const source = text(value);
  if (!source) return '';
  return source
    .replace(/https?:\/\/[^\s]+/gi, '[redacted-url]')
    .replace(/(^|[\s("'=:])(?:~\/|\.{1,2}\/|[A-Za-z]:[\\/]|\/(?:Users|home|var|tmp|private|Volumes|opt|srv|mnt|media|workspace)\/)[^\s,;:"'<>|)]*/g, '$1[redacted-path]')
    .replace(/\b(?:sk|pk|rk)-[a-z0-9_-]{8,}\b/gi, '[redacted-secret]')
    .replace(/\b(?:bearer|authorization|api[_ -]?key)\s*[:=]?\s*[^\s,;]+/gi, '[redacted-secret]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function shortId(value) { return String(value || '').replace(/^[^_]+_/, '').slice(0, 8) || '未记录'; }

function safeValue(value, depth = 0) {
  if (depth > 6) return null;
  if (typeof value === 'string') return redactedText(value);
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => safeValue(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (HIDDEN_KEY.test(key)) continue;
    output[key.slice(0, 64)] = safeValue(item, depth + 1);
  }
  return output;
}

function publicNode(node = {}) {
  return {
    type: node.entityType || 'unknown',
    shortId: shortId(node.entityId),
    title: redactedText(node.title) || redactedText(node.entity?.name) || redactedText(node.entity?.display?.label) || '未命名节点',
    status: redactedText(node.status, 80) || 'active',
    summary: redactedText(node.subtitle, 160),
    flags: {
      selected: node.selectedAsset === true,
      shared: node.sharedAsset === true,
      delivered: node.deliveredAsset === true,
      externalShared: node.externalSharedAsset === true,
      unavailable: node.mediaUnavailable === true
    }
  };
}

function publicGroup(group = {}) {
  return {
    shortId: shortId(group.id),
    title: redactedText(group.title) || '分组',
    type: redactedText(group.groupType, 80) || 'custom',
    collapsed: group.metadata?.collapsed === true
  };
}

function publicLink(link = {}) {
  return {
    type: redactedText(link.linkType, 80) || redactedText(link.type, 80) || 'custom',
    label: redactedText(link.label) || '标注关系',
    source: { type: redactedText(link.sourceType, 80), shortId: shortId(link.sourceId) },
    target: { type: redactedText(link.targetType, 80), shortId: shortId(link.targetId) }
  };
}

export function createLineageExport({ project, scope, nodes = [], groups = [], links = [], generatedAt = new Date().toISOString() } = {}) {
  return safeValue({
    generatedAt,
    project: { shortId: shortId(project?.id), name: redactedText(project?.name) || '未命名项目', description: redactedText(project?.description, 240) },
    scope: { type: redactedText(scope?.type, 80) || 'project', shortId: shortId(scope?.id) },
    summary: { nodes: nodes.length, groups: groups.length, links: links.length },
    nodes: nodes.map(publicNode),
    groups: groups.map(publicGroup),
    links: links.map(publicLink)
  });
}

export function lineageExportFilename(projectName, now = new Date()) {
  const safeName = redactedText(projectName, 80).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'daoge-lineage';
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${safeName}-创作谱系-${stamp}.json`;
}
