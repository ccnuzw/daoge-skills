/**
 * Agent 频道的响应投影。
 *
 * 为什么需要投影：计划正文（`prompt` + `itemPrompts`）会随 `plan` / `preflight` /
 * `round-status` / `run` 的响应原样回流给 agent。实测一份 4 张、中位规模的计划，
 * 「写计划 → 预检 → 读状态」一轮就回流约 67 KB（较大样本单次 `round-status` 109 KB），
 * 而 agent 真正需要的只是「哪个批次、哪一版、什么状态、几张、成没成」。
 *
 * 三条规则：
 *   1. **白名单**：投影只保留 id / 状态 / 版本 / 计数与少量摘要；正文（`plan`、`prompt`、
 *      `itemPrompts`、`planSnapshot`、`requestSummary`）一律不回传。需要正文时用 `--full`。
 *   2. **永不回传令牌类字段**：确认挑战值（`challenge`）、`planHash`、`conversationId` 不进
 *      agent 上下文 —— 人工确认由 Workbench 的 Cookie 完成，agent 拿到这几项只会诱使它
 *      把它们贴进对话。
 *   3. **投影不做业务判断**：它只按表搬运字段，不改语义；字段缺失就是 `null`，不猜、不补默认值。
 *
 * 字段表是**唯一**的形状来源：想加字段就得改表，`tests/vnext/cli-projection.test.js`
 * 用同一张表断言输出，防止投影日后悄悄长回一棵大树。
 */

type JsonObject = Record<string, unknown>;

type FieldKind = 'string' | 'integer' | 'boolean' | 'object' | 'strings';

interface FieldRule {
  /** 输出字段名。 */
  key: string;
  /** 取值种类；`null` 表示源里没有、或类型不符（投影不猜）。 */
  as: FieldKind;
  /** 源字段名，默认与 `key` 相同。 */
  from?: string;
}

/** 类型守卫：只有普通对象才算对象，数组与 null 都不算。 */
function asObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 按字段表取一个对象。`unwrap` 用来剥掉命令回执的 `value` 外壳。
 * 这是模块里唯一的取数实现：所有投影都走它，缺字段一律 `null`。
 */
function shape(value: unknown, rules: readonly FieldRule[], unwrap?: string): JsonObject {
  const outer = asObject(value) ? value : {};
  const source = unwrap === undefined ? outer : asObject(outer[unwrap]) ? outer[unwrap] as JsonObject : {};
  const output: JsonObject = {};
  for (const rule of rules) {
    const raw = source[rule.from || rule.key];
    if (rule.as === 'string') output[rule.key] = typeof raw === 'string' && raw ? raw : null;
    else if (rule.as === 'integer') output[rule.key] = Number.isInteger(raw) ? Number(raw) : null;
    else if (rule.as === 'boolean') output[rule.key] = typeof raw === 'boolean' ? raw : null;
    else if (rule.as === 'object') output[rule.key] = asObject(raw) ? raw : null;
    else output[rule.key] = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
  }
  return output;
}

/** 投影选项：只影响「要不要附能力表」与 `project-list` 的本地筛选，不改变投影形状。 */
export interface ProjectionOptions {
  /** provider-list --descriptors：追加 Provider Descriptor 全表。 */
  descriptors?: boolean;
  /** project-list --name / --status / --limit：筛选在本地完成，daemon 仍回全表。 */
  filters?: { name?: string; status?: string; limit?: number };
}

const RUN_SUMMARY_RULES: readonly FieldRule[] = [
  { key: 'id', as: 'string' },
  { key: 'roundId', as: 'string' },
  { key: 'status', as: 'string' },
  { key: 'planVersion', as: 'integer' },
  { key: 'executionConcurrency', as: 'integer' },
  { key: 'concurrencySource', as: 'string' },
  { key: 'createdAt', as: 'string' },
  { key: 'updatedAt', as: 'string' }
];

/**
 * 确认挑战窗口：只留 agent 看得懂的「什么时候过期、对着哪一版」。
 * 挑战值、planHash、sessionId、conversationId 都不进投影。
 */
function challengeWindow(value: unknown): JsonObject | null {
  if (!asObject(value) || typeof value.expiresAt !== 'string') return null;
  return shape(value, [
    { key: 'roundId', as: 'string' },
    { key: 'expectedVersion', as: 'integer' },
    { key: 'expiresAt', as: 'string' }
  ]);
}

/** 预检问题清单：`code` 是机器可判的，`field` 与 `message` 给人看。 */
function issueList(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!asObject(item) || typeof item.code !== 'string' || !item.code) return [];
    return [shape(item, [{ key: 'code', as: 'string' }, { key: 'field', as: 'string' }, { key: 'message', as: 'string' }])];
  });
}

/**
 * 写计划（`plan` 与 `plan --challenge true`）。
 *
 * 原始回执里的 `value.plan` 就是整份计划正文；投影只回「批次 + 版本 + 状态」，
 * 外加挑战窗口（`--challenge true` 时）。
 */
export function projectPlanWrite(value: unknown, challenge?: unknown): JsonObject {
  const projected = shape(value, [
    { key: 'roundId', as: 'string', from: 'id' },
    { key: 'taskId', as: 'string' },
    { key: 'purpose', as: 'string' },
    { key: 'planVersion', as: 'integer' },
    { key: 'status', as: 'string' },
    { key: 'version', as: 'integer' }
  ], 'value');
  const window = challenge === undefined ? null : challengeWindow(challenge);
  if (window) projected.challenge = window;
  return projected;
}

/**
 * 预检（`preflight`）。
 *
 * 原始回执里 `value.preview.planSnapshot` 又一次带回整份计划，`value.preflight.normalizedPlan`
 * 也是同一份正文；投影只回「预检 id + 计划版本 + 张数 + 并发 + 确认令牌 + 问题清单」。
 * `confirmToken` 是 `run` 的必需输入，保留它是为了不打断「确认之后入队」这条既定流程。
 */
export function projectPreflight(value: unknown): JsonObject {
  const payload = asObject(value) && asObject(value.value) ? value.value as JsonObject : asObject(value) ? value : {};
  const preview = asObject(payload.preview) ? payload.preview as JsonObject : null;
  const preflight = asObject(payload.preflight) ? payload.preflight as JsonObject : {};
  const issues = issueList(preflight.issues);
  const valid = typeof preflight.valid === 'boolean' ? preflight.valid : null;
  return {
    preflightId: preview && typeof preview.id === 'string' ? preview.id : null,
    roundId: preview && typeof preview.roundId === 'string' ? preview.roundId : null,
    planVersion: preview && Number.isInteger(preview.planVersion) ? Number(preview.planVersion) : null,
    itemCount: preview && Number.isInteger(preview.itemCount) ? Number(preview.itemCount) : null,
    executionConcurrency: preview && Number.isInteger(preview.executionConcurrency) ? Number(preview.executionConcurrency) : null,
    concurrencySource: preview && typeof preview.concurrencySource === 'string' ? preview.concurrencySource : null,
    confirmed: valid === true && issues.length === 0,
    confirmToken: typeof payload.confirmToken === 'string' && payload.confirmToken ? payload.confirmToken : null,
    issues
  };
}

/**
 * 生成运行回执（`run` / `pause` / `cancel` / `resume`）。
 *
 * 这几个命令回的都是运行行，里面带着 `planSnapshot`（含 prompt）与 Provider 快照。
 */
export function projectRunReceipt(value: unknown): JsonObject {
  const run = shape(value, RUN_SUMMARY_RULES, 'value');
  return {
    runId: run.id,
    roundId: run.roundId,
    status: run.status,
    itemCount: (() => {
      const outer = asObject(value) ? value : {};
      const source = asObject(outer.value) ? outer.value as JsonObject : outer;
      const plan = asObject(source.planSnapshot) ? source.planSnapshot as JsonObject : {};
      return Number.isInteger(plan.itemCount) ? Number(plan.itemCount) : null;
    })(),
    planVersion: run.planVersion,
    executionConcurrency: run.executionConcurrency,
    concurrencySource: run.concurrencySource,
    updatedAt: run.updatedAt
  };
}

/**
 * 轮次状态（`round-status`）：确认之后与等待出图时的主读命令。
 *
 * 原始响应里 `planStatus.context.round.plan` 是整份计划，`runs[].planSnapshot.prompt` 是每轮的
 * 提示词。投影只回状态与计数 —— 包括 `tally`（最新运行逐状态张数）。
 */
export function projectRoundStatus(value: unknown): JsonObject {
  const payload = asObject(value) ? value : {};
  const planStatus = asObject(payload.planStatus) ? payload.planStatus as JsonObject : {};
  const context = asObject(planStatus.context) ? planStatus.context as JsonObject : {};
  const confirmation = asObject(planStatus.confirmation) ? planStatus.confirmation as JsonObject : {};
  // plan-status 里的 round/run 只跟着**会话绑定的批次**走；会话还没绑批次时（例如刚
  // `enter --project` 就查状态），用命令显式给的 `--round` 读到的详情兜底，免得回一堆 null
  // 让 agent 以为"没有批次"。
  const boundRound = asObject(context.round) ? context.round as JsonObject : {};
  const fallbackRound = asObject(payload.round) ? payload.round as JsonObject : {};
  const roundSource = typeof boundRound.id === 'string' ? boundRound : fallbackRound;
  const boundRun = asObject(planStatus.latestRun) ? planStatus.latestRun as JsonObject : null;
  const fallbackRun = asObject(payload.latestRun) ? payload.latestRun as JsonObject : null;
  const latestRun = boundRun || fallbackRun;
  const runs = Array.isArray(payload.runs) ? payload.runs.filter(asObject) : [];
  return {
    round: shape(roundSource, [
      { key: 'id', as: 'string' },
      { key: 'taskId', as: 'string' },
      { key: 'purpose', as: 'string' },
      { key: 'status', as: 'string' },
      { key: 'planVersion', as: 'integer' }
    ]),
    confirmation: shape(confirmation, [
      { key: 'confirmed', as: 'boolean' },
      { key: 'confirmedAt', as: 'string' },
      { key: 'expiresAt', as: 'string' }
    ]),
    challenge: challengeWindow(planStatus.pendingConfirmation),
    latestRun: latestRun ? shape(latestRun, RUN_SUMMARY_RULES) : null,
    tally: asObject(payload.tally) ? payload.tally : null,
    runCount: runs.length,
    runs: runs.map((run) => shape(run, RUN_SUMMARY_RULES))
  };
}

/**
 * 生成服务列表（`provider-list`）。
 *
 * 默认只回「当前启用的是哪一组 + 每组的名字与模型 + 连接状态」；descriptor 全表（4 个
 * Provider 的字段能力）与运行时细节只在 `--descriptors` / `--full` 时出现。
 * `endpoint`（完整 Base URL）在任何投影里都不出现。
 */
export function projectProviderList(value: unknown, options: ProjectionOptions = {}): JsonObject {
  const payload = asObject(value) ? value : {};
  const status = asObject(payload.status) ? payload.status as JsonObject : {};
  const capabilities = asObject(status.capabilities) ? status.capabilities as JsonObject : {};
  const profiles = (Array.isArray(payload.profiles) ? payload.profiles.filter(asObject) : []).map((profile) => shape(profile, [
    { key: 'id', as: 'string' },
    { key: 'name', as: 'string' },
    { key: 'providerId', as: 'string' },
    { key: 'model', as: 'string' },
    { key: 'active', as: 'boolean' }
  ]));
  return {
    active: {
      ...shape(status, [
        { key: 'id', as: 'string', from: 'profileId' },
        { key: 'name', as: 'string', from: 'profileName' },
        { key: 'providerId', as: 'string' },
        { key: 'model', as: 'string' },
        { key: 'configured', as: 'boolean' },
        { key: 'missing', as: 'strings' },
        { key: 'endpointTrustMode', as: 'string' },
        { key: 'configVersion', as: 'integer' }
      ]),
      capabilities: shape(capabilities, [
        { key: 'generate', as: 'boolean' },
        { key: 'edit', as: 'boolean' },
        { key: 'referenceImage', as: 'boolean' },
        { key: 'mask', as: 'boolean' }
      ])
    },
    profiles,
    profileCount: profiles.length,
    hasRuntimeDetails: asObject(payload.runtime),
    // 能力表是显式请求才给的：4 个 Provider 的字段能力约 6 KB，agent 主线不需要。
    ...(options.descriptors === true && Array.isArray(payload.descriptors) ? { descriptors: payload.descriptors } : {})
  };
}

/** 项目列表（`project-list`）：id / 名称 / 状态；`--name` / `--status` / `--limit` 在本地筛选。 */
export function projectProjectList(value: unknown, options: ProjectionOptions = {}): JsonObject {
  const payload = asObject(value) ? value : {};
  const filters = options.filters || {};
  const wanted = typeof filters.name === 'string' ? filters.name.trim() : '';
  const wantedStatus = typeof filters.status === 'string' ? filters.status.trim() : '';
  const rows = (Array.isArray(payload.projects) ? payload.projects.filter(asObject) : []).filter((project) => {
    if (wanted && project.name !== wanted) return false;
    if (wantedStatus && project.status !== wantedStatus) return false;
    return true;
  });
  const limited = Number.isInteger(filters.limit) ? rows.slice(0, Number(filters.limit)) : rows;
  const projects = limited.map((project) => shape(project, [
    { key: 'id', as: 'string' },
    { key: 'name', as: 'string' },
    { key: 'status', as: 'string' }
  ]));
  return { projects, projectCount: projects.length, matchedInStudio: rows.length };
}

/** 任务列表（`task-list`）：新建时 `intent` 可能很大，投影只留结构字段。 */
export function projectTaskList(value: unknown): JsonObject {
  const payload = asObject(value) ? value : {};
  const tasks = (Array.isArray(payload.tasks) ? payload.tasks.filter(asObject) : []).map((task) => shape(task, [
    { key: 'id', as: 'string' },
    { key: 'name', as: 'string' },
    { key: 'status', as: 'string' },
    { key: 'taskTypeId', as: 'string' },
    { key: 'version', as: 'integer' }
  ]));
  return { tasks, taskCount: tasks.length };
}

/** 轮次列表（`round-list`）：每行原样带整份计划，投影只留结构字段。 */
export function projectRoundList(value: unknown): JsonObject {
  const payload = asObject(value) ? value : {};
  const rounds = (Array.isArray(payload.rounds) ? payload.rounds.filter(asObject) : []).map((round) => shape(round, [
    { key: 'id', as: 'string' },
    { key: 'taskId', as: 'string' },
    { key: 'parentRoundId', as: 'string' },
    { key: 'purpose', as: 'string' },
    { key: 'status', as: 'string' },
    { key: 'planVersion', as: 'integer' },
    { key: 'version', as: 'integer' }
  ]));
  return { rounds, roundCount: rounds.length };
}

/** 轮次详情（`round-detail`）：`tally` 是「这批成没成」的权威计数。 */
export function projectRoundDetail(value: unknown): JsonObject {
  const payload = asObject(value) ? value : {};
  const latestRun = asObject(payload.latestRun) ? payload.latestRun as JsonObject : null;
  return {
    round: shape(payload.round, [
      { key: 'id', as: 'string' },
      { key: 'taskId', as: 'string' },
      { key: 'parentRoundId', as: 'string' },
      { key: 'purpose', as: 'string' },
      { key: 'status', as: 'string' },
      { key: 'planVersion', as: 'integer' },
      { key: 'version', as: 'integer' }
    ]),
    latestRun: latestRun ? shape(latestRun, RUN_SUMMARY_RULES) : null,
    tally: asObject(payload.tally) ? payload.tally : null
  };
}

/**
 * 运行项列表（`run-items`）：`statusCounts` 是进度，逐项只留 id / 序号 / 状态 / 产物 id。
 * 安全错误摘要保留 —— 失败与结果不明时 agent 必须看得到原因。
 */
export function projectRunItems(value: unknown): JsonObject {
  const payload = asObject(value) ? value : {};
  const items = (Array.isArray(payload.items) ? payload.items.filter(asObject) : []).map((entry) => {
    const error = asObject(entry.error) ? entry.error as JsonObject : {};
    const result = asObject(entry.result) ? entry.result as JsonObject : {};
    const assetIds = (Array.isArray(entry.outputAssets) ? entry.outputAssets.filter(asObject) : [])
      .flatMap((asset) => (typeof asset.id === 'string' && asset.id ? [asset.id] : []));
    const resultAsset = typeof result.assetId === 'string' && result.assetId && !assetIds.includes(result.assetId) ? [result.assetId] : [];
    return {
      ...shape(entry, [
        { key: 'id', as: 'string' },
        { key: 'sequence', as: 'integer' },
        { key: 'status', as: 'string' },
        { key: 'attempts', as: 'integer' },
        { key: 'updatedAt', as: 'string' }
      ]),
      assetIds: [...resultAsset, ...assetIds],
      errorCode: shape(error, [{ key: 'code', as: 'string' }]).code,
      errorMessage: shape(error, [{ key: 'message', as: 'string' }]).message
    };
  });
  return {
    runId: shape(payload, [{ key: 'runId', as: 'string' }]).runId,
    page: shape(payload, [{ key: 'page', as: 'integer' }]).page,
    pageSize: shape(payload, [{ key: 'pageSize', as: 'integer' }]).pageSize,
    total: shape(payload, [{ key: 'total', as: 'integer' }]).total,
    totalPages: shape(payload, [{ key: 'totalPages', as: 'integer' }]).totalPages,
    statusCounts: asObject(payload.statusCounts) ? payload.statusCounts : null,
    itemCount: items.length,
    items
  };
}

/**
 * 命令 → 投影。表里没有的命令保持原样（它们的回执本来就没有正文），
 * `--full` 绕过整张表。
 */
export const COMMAND_PROJECTIONS: Record<string, (value: unknown, options?: ProjectionOptions) => JsonObject> = {
  plan: (value) => projectPlanWrite(value),
  preflight: projectPreflight,
  run: projectRunReceipt,
  pause: projectRunReceipt,
  cancel: projectRunReceipt,
  resume: projectRunReceipt,
  'round-status': projectRoundStatus,
  'provider-list': projectProviderList,
  'project-list': projectProjectList,
  'task-list': projectTaskList,
  'round-list': projectRoundList,
  'round-detail': projectRoundDetail,
  'run-items': projectRunItems
};