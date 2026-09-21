/**
 * 流程动作：把 agent 主线里「本来要 2–3 条命令」的两步各自收成一条。
 *
 * - `resolvePlanTarget`：`plan --project <名>` 时自己把 draft 任务与批次补齐（没有就建），
 *   并读回批次的当前版本号 —— 以前这三件事是 `task` / `round` / 再读一次版本号。
 * - `composePreflightAndRun`：`run --auto-preflight` 时先做预检再入队。**闸门一条不少**：
 *   预检仍然真实发生并留下 dry-run 记录，`confirm_token` 仍然由 daemon 签发并与
 *   `plan_hash + preflight_id + conversation_id` 绑定，只是不再要求 agent 手动传两遍 id。
 *
 * 两个函数都只通过注入的 `call` 访问 Studio API，所以测试可以直接对着真实 daemon 跑。
 */

type JsonObject = Record<string, unknown>;

import { projectSummaries, resolveProjectSelection } from './project-resolution';

export type ApiCaller = (method: 'GET' | 'POST' | 'PUT', pathname: string, body: JsonObject, idempotencyKey?: string, operationName?: string) => Promise<unknown>;

export interface PlanTargetInput {
  roundId?: string;
  project?: string;
  task?: string;
  purpose?: string;
  session?: string;
  expectedVersion?: number;
}

export interface PlanTarget {
  roundId: string;
  expectedVersion: number;
  /** 本次为达成目标新建的对象；没有建就是空对象。 */
  created: { task?: string; round?: string };
}

function asObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 从 `{value: {...}}` 回执里取实体；有些路由直接回实体。 */
function receiptValue(value: unknown): JsonObject {
  const record = asObject(value) ? value : {};
  return asObject(record.value) ? record.value as JsonObject : record;
}

function projectRows(value: unknown): JsonObject[] {
  const payload = asObject(value) ? value : {};
  return Array.isArray(payload.projects) ? payload.projects.filter(asObject) : [];
}

function listRows(value: unknown, key: string): JsonObject[] {
  const payload = asObject(value) ? value : {};
  return Array.isArray(payload[key]) ? payload[key].filter(asObject) : [];
}

/**
 * 把「要写计划的那个批次」找出来：显式 `--round` 优先，否则按 `--project` 解析并补齐结构。
 *
 * 补齐规则（保守、可预期）：
 *   1. 项目下取 `--task` 指定的任务；没指定就取**最新的非归档任务**；一个都没有才新建
 *      （名字默认等于项目名，`purpose` 默认 exploration）。
 *   2. 任务下取**最新的 draft 批次**（unconfirmed 才能写计划）；没有 draft 就新建一个。
 *   3. 新建批次时带上 `--session`，让会话上下文一起绑定 —— 这样随后的 `round-status`
 *      看得到批次，不会再回一堆 null。
 */
export async function resolvePlanTarget(call: ApiCaller, input: PlanTargetInput): Promise<PlanTarget> {
  if (input.roundId) {
    const detail = await call('GET', '/api/rounds/' + encodeURIComponent(input.roundId), {});
    // `/api/rounds/<id>` 回的是 `{round, latestRun, tally}`；写入类回执则是 `{value: round}`。
    const round = asObject(detail) && asObject(detail.round) ? detail.round as JsonObject : receiptValue(detail);
    const version = Number.isInteger(round.version) ? Number(round.version) : null;
    const expectedVersion = Number.isInteger(input.expectedVersion) ? Number(input.expectedVersion) : version;
    if (expectedVersion === null) throw new Error('无法读取批次版本号；请显式给出 --version。');
    return { roundId: input.roundId, expectedVersion, created: {} };
  }
  const wanted = text(input.project).trim();
  if (!wanted) throw new Error('需要 --round，或用 --project <名|id> 让 plan 自己找到/建立批次。');
  const projects = projectSummaries(await call('GET', '/api/projects', {}));
  const selection = resolveProjectSelection(projects, wanted);
  if (selection.resolution === 'ambiguous') throw new Error('项目名有歧义，请用 projectId：' + selection.candidates.map((item) => item.id + '（' + item.name + '）').join('、'));
  if (!selection.matched) throw new Error('没有找到项目：' + wanted + '。可用：' + projects.map((item) => item.name).join('、'));

  const created: { task?: string; round?: string } = {};
  const tasks = listRows(await call('GET', '/api/projects/' + encodeURIComponent(selection.matched.id) + '/tasks', {}), 'tasks');
  const explicitTask = text(input.task);
  let taskId = explicitTask && tasks.some((task) => task.id === explicitTask) ? explicitTask : '';
  if (!taskId && !explicitTask) {
    const openTask = tasks.find((task) => task.status !== 'archived' && task.status !== 'completed');
    taskId = openTask ? text(openTask.id) : '';
  }
  if (!taskId) {
    const createdTask = receiptValue(await call('POST', '/api/tasks', {
      projectId: selection.matched.id,
      name: explicitTask || selection.matched.name,
      ...(input.session === undefined ? {} : { sessionId: input.session })
    }));
    taskId = text(createdTask.id);
    if (!taskId) throw new Error('新建任务失败，Studio 未返回任务标识。');
    created.task = taskId;
  }

  const rounds = listRows(await call('GET', '/api/tasks/' + encodeURIComponent(taskId) + '/rounds', {}), 'rounds');
  const draft = rounds.find((round) => round.status === 'draft');
  if (draft && text(draft.id)) {
    const expectedVersion = Number.isInteger(input.expectedVersion) ? Number(input.expectedVersion) : Number.isInteger(draft.version) ? Number(draft.version) : null;
    if (expectedVersion === null) throw new Error('无法读取批次版本号；请显式给出 --version。');
    return { roundId: text(draft.id), expectedVersion, created };
  }
  const round = receiptValue(await call('POST', '/api/rounds', {
    taskId,
    purpose: text(input.purpose) || 'exploration',
    ...(input.session === undefined ? {} : { sessionId: input.session })
  }));
  const roundId = text(round.id);
  if (!roundId) throw new Error('新建批次失败，Studio 未返回批次标识。');
  created.round = roundId;
  return { roundId, expectedVersion: Number.isInteger(round.version) ? Number(round.version) : Number(input.expectedVersion), created };
}

export interface AutoRunInput {
  roundId: string;
  sessionId: string;
  concurrency?: number;
  usageEstimate?: unknown;
}

export interface AutoRunResult {
  preflight: JsonObject;
  run: JsonObject;
}

/**
 * 预检 + 入队，两条命令的语义合成一条。
 *
 * 预检失败时**不**入队，并把逐条 issue 原样抛出去（code 可机器判）。
 */
export async function composePreflightAndRun(call: ApiCaller, input: AutoRunInput): Promise<AutoRunResult> {
  const preflight = await call('POST', '/api/rounds/' + encodeURIComponent(input.roundId) + '/preflight', {
    sessionId: input.sessionId,
    ...(input.concurrency === undefined ? {} : { executionConcurrency: input.concurrency }),
    ...(input.usageEstimate === undefined ? {} : { usageEstimate: input.usageEstimate })
  });
  const payload = asObject(preflight) && asObject((preflight as JsonObject).value) ? (preflight as JsonObject).value as JsonObject : asObject(preflight) ? preflight : {};
  const preview = asObject(payload.preview) ? payload.preview as JsonObject : null;
  const preflightResult = asObject(payload.preflight) ? payload.preflight as JsonObject : {};
  const issues = Array.isArray(preflightResult.issues) ? preflightResult.issues.filter(asObject) : [];
  const preflightId = preview ? text(preview.id) : '';
  const confirmToken = text(payload.confirmToken);
  if (!preflightId || !confirmToken) {
    const summary = issues.map((issue) => text(issue.code) + '(' + (text(issue.field) || 'plan') + '：' + text(issue.message) + ')').join('；');
    throw new Error('预检未通过，没有入队。' + (summary ? '问题：' + summary : '请先在 Workbench 完成与当前计划匹配的人工确认。'));
  }
  const run = await call('POST', '/api/runs', { roundId: input.roundId, preflightId, confirmToken });
  return { preflight: { preflightId, roundId: input.roundId, itemCount: preview ? preview.itemCount : null, executionConcurrency: preview ? preview.executionConcurrency : null, confirmToken }, run: receiptValue(run) };
}
export interface DeliveryExportInput {
  projectId: string;
  name: string;
  assetIds: string[];
  includeCreativeRecord?: boolean;
}

/**
 * 交付一步导出：草稿 → 准备 → 导出，三条命令合成一条（仅限「这一批就是要交付」的常见情形）。
 *
 * 三步流程与状态机原样保留：需要修订的批次仍应显式走 `delivery` / `delivery-update` /
 * `delivery-ready`，这里只是不给常见路径加仪式。
 */
export async function composeDeliveryExport(call: ApiCaller, input: DeliveryExportInput): Promise<{ deliveryId: string; status: string; fileCount: number; firstDownloadUrl: string | null }> {
  const created = receiptValue(await call('POST', '/api/deliveries', {
    projectId: input.projectId,
    name: input.name,
    assetIds: input.assetIds,
    includeCreativeRecord: input.includeCreativeRecord === true
  }));
  const deliveryId = text(created.id);
  if (!deliveryId) throw new Error('创建交付失败，Studio 未返回交付标识。');
  await call('POST', '/api/deliveries/' + encodeURIComponent(deliveryId) + '/ready', {});
  // 导出回执就是权威形状：`{delivery, files:[{sequence,file,downloadUrl}]}`。
  const exportedValue = await call('POST', '/api/deliveries/' + encodeURIComponent(deliveryId) + '/export', {});
  const payload = asObject(exportedValue) ? exportedValue : {};
  const files = Array.isArray(payload.files) ? payload.files.filter(asObject) : [];
  const first = files.length ? files[0] : null;
  const delivery = asObject(payload.delivery) ? payload.delivery as JsonObject : {};
  return {
    deliveryId,
    status: text(delivery.status) || 'exported',
    fileCount: files.length,
    firstDownloadUrl: first ? text(first.downloadUrl) || null : null
  };
}
