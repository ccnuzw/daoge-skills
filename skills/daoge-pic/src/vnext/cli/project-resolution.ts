/**
 * 项目解析：把用户说的话（项目名 / projectId）变成唯一确定的项目。
 *
 * 这里是 `enter --project` 与 `plan --project` 共用的那份判定 —— 单独成文件是为了让
 * 「一条命令里顺带解析项目」的流程动作（flow-actions）也能用它，而不是各写一份。
 */

export interface ProjectSummary { id: string; name: string; status: string; }
export type ProjectResolution = 'matched' | 'ambiguous' | 'not-found' | 'not-requested';

/** Narrow the daemon project list to what a connection needs: id, name, status. */
export function projectSummaries(value: unknown): ProjectSummary[] {
  const data = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const list = Array.isArray(data.projects) ? data.projects : [];
  return list.flatMap((item) => {
    const record = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null;
    if (!record) return [];
    const id = typeof record.id === 'string' ? record.id : '';
    const name = typeof record.name === 'string' ? record.name : '';
    return id && name ? [{ id, name, status: typeof record.status === 'string' ? record.status : '' }] : [];
  });
}

/**
 * 项目名 → projectId 的确定性解析，绝不替用户猜。
 *
 * 归档是真实存在的坑：本机的 Studio 里「鉴权表复验临时项目」active/archived 各有一个，
 * 旧规则会把精确输入判成 ambiguous，让用户为一个早就不用的项目再确认一次。规则改为
 * 先分档（active 优先），档内唯一才算命中：
 *   1. 精确 projectId 命中即为准 —— 调用方给的是唯一事实；
 *   2. 精确项目名：唯一 active → 命中；多个 active → ambiguous；没有 active 时唯一 archived → 命中；
 *   3. 包含匹配按同一分档判定；候选永远 active 在前、archived 在后。
 */
export function resolveProjectSelection(projects: ProjectSummary[], requested: string): { resolution: ProjectResolution; matched: ProjectSummary | null; candidates: ProjectSummary[] } {
  const wanted = requested.trim();
  if (!wanted) return { resolution: 'not-requested', matched: null, candidates: [] };
  const byId = projects.find((project) => project.id === wanted);
  if (byId) return { resolution: 'matched', matched: byId, candidates: [] };
  const decide = (matches: ProjectSummary[]): { resolution: ProjectResolution; matched: ProjectSummary | null; candidates: ProjectSummary[] } => {
    const active = matches.filter((project) => project.status !== 'archived');
    const archived = matches.filter((project) => project.status === 'archived');
    if (active.length === 1) return { resolution: 'matched', matched: active[0], candidates: [] };
    if (active.length > 1) return { resolution: 'ambiguous', matched: null, candidates: [...active, ...archived] };
    if (archived.length === 1) return { resolution: 'matched', matched: archived[0], candidates: [] };
    if (archived.length > 1) return { resolution: 'ambiguous', matched: null, candidates: archived };
    return { resolution: 'not-found', matched: null, candidates: [] };
  };
  const exact = projects.filter((project) => project.name === wanted);
  if (exact.length) return decide(exact);
  const partial = projects.filter((project) => project.name.includes(wanted));
  return partial.length ? decide(partial) : { resolution: 'not-found', matched: null, candidates: [] };
}