import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { openWorkbenchUrl } from './open-workbench';
import { MAX_WORKER_CONCURRENCY, MIN_WORKER_CONCURRENCY } from '../studio/runtime-settings';
import { healthStudioId, signalVerifiedDaemon } from './legacy-daemon';
import { readStudioManifest, studioPaths } from '../studio/workspace';

interface RuntimeRecord { pid: number; url: string; capability?: string; workspaceRoot: string; heartbeatAt: string; workerConcurrency?: number | null; }

type JsonObject = Record<string, unknown>;

type HttpMethod = 'GET' | 'POST' | 'PUT';
type LocalAction = 'status' | 'studio' | 'open' | 'restart';
type FlagKind = 'text' | 'json' | 'positive-integer' | 'worker-concurrency' | 'requested-concurrency' | 'list' | 'boolean' | 'purpose';
interface FlagSchema { kind: FlagKind; required?: boolean; }
interface CommandSchema {
  action?: LocalAction;
  method?: HttpMethod;
  flags: Record<string, FlagSchema>;
  pathname?: (values: Record<string, unknown>) => string;
  body?: (values: Record<string, unknown>) => JsonObject;
}
interface ParsedCommand {
  name: string;
  workspaceRoot: string;
  action?: LocalAction;
  request?: { method: HttpMethod; pathname: string; body: JsonObject; idempotencyKey?: string };
}

function workspaceRoot(value: string | undefined): string {
  const root = String(value || process.env.DAOGE_WORKSPACE_ROOT || '').trim();
  if (!root) throw new Error('需要 --workspace 或 DAOGE_WORKSPACE_ROOT。不会使用不稳定的当前目录作为 Studio 工作区。');
  return path.resolve(root);
}

function runtimePath(workspaceRoot: string): string { return path.join(workspaceRoot, 'daoge-studio', 'runtime', 'daemon.json'); }
function lockPath(workspaceRoot: string): string { return path.join(workspaceRoot, 'daoge-studio', 'runtime', 'daemon.lock'); }
function manifestPath(workspaceRoot: string): string { return path.join(workspaceRoot, 'daoge-studio', 'studio.json'); }
function readStudioId(workspaceRoot: string): string {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath(workspaceRoot), 'utf8')) as { studioId?: unknown; workspaceRoot?: unknown };
    if (typeof manifest.studioId === 'string' && manifest.studioId && typeof manifest.workspaceRoot === 'string' && path.resolve(manifest.workspaceRoot) === workspaceRoot) return manifest.studioId;
  } catch { /* handled by the safe refusal below */ }
  throw new Error('无法确认当前 Studio manifest 身份，拒绝停止已有 daemon。');
}
function readRuntime(workspaceRoot: string): RuntimeRecord | null {
  try {
    const value = JSON.parse(fs.readFileSync(runtimePath(workspaceRoot), 'utf8')) as RuntimeRecord;
    if (!value || !Number.isInteger(value.pid) || value.pid <= 0 || typeof value.url !== 'string' || typeof value.workspaceRoot !== 'string') return null;
    const parsed = new URL(value.url);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || path.resolve(value.workspaceRoot) !== workspaceRoot) return null;
    if (value.capability !== undefined && (typeof value.capability !== 'string' || value.capability.length < 43)) return null;
    return value;
  } catch { return null; }
}
function publicRuntime(record: RuntimeRecord | null): Record<string, unknown> | null {
  if (!record) return null;
  return { pid: record.pid, url: record.url, workspaceRoot: record.workspaceRoot, heartbeatAt: record.heartbeatAt, workerConcurrency: record.workerConcurrency ?? null };
}

function workbenchBootstrapUrl(record: RuntimeRecord): string {
  if (!record.capability) throw new Error('Studio daemon 缺少本地访问 capability，必须先安全迁移。');
  return record.url + '/#capability=' + encodeURIComponent(record.capability);
}

async function healthy(url: string, expectedStudioId?: string): Promise<boolean> {
  const studioId = await healthStudioId(url);
  return Boolean(studioId && (!expectedStudioId || studioId === expectedStudioId));
}

function sleep(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function strictWorkerConcurrency(value: string): number {
  const concurrency = Number(value);
  if (Number.isInteger(concurrency) && concurrency >= MIN_WORKER_CONCURRENCY && concurrency <= MAX_WORKER_CONCURRENCY) return concurrency;
  throw new Error('--worker-concurrency 只能是 1 到 1000 的整数。');
}

function strictRequestedConcurrency(value: string): number {
  const concurrency = Number(value);
  if (Number.isInteger(concurrency) && concurrency >= MIN_WORKER_CONCURRENCY && concurrency <= MAX_WORKER_CONCURRENCY) return concurrency;
  throw new Error('--concurrency 只能是 1 到 1000 的整数。');
}

function livePid(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function recordedLockPid(workspaceRoot: string): number | null {
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath(workspaceRoot), 'utf8')) as { pid?: unknown };
    return Number.isInteger(lock.pid) && Number(lock.pid) > 0 ? Number(lock.pid) : null;
  } catch { return null; }
}

function matchingLockPid(workspaceRoot: string, pid: number): boolean {
  return recordedLockPid(workspaceRoot) === pid;
}

async function waitForDaemonRelease(workspaceRoot: string, record: RuntimeRecord): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const live = livePid(record.pid);
    const responding = await healthy(record.url);
    if (!live && !responding) {
      const current = readRuntime(workspaceRoot);
      if (current?.pid === record.pid) fs.rmSync(runtimePath(workspaceRoot), { force: true });
      if (matchingLockPid(workspaceRoot, record.pid)) fs.rmSync(lockPath(workspaceRoot), { force: true });
      if (!fs.existsSync(lockPath(workspaceRoot))) return;
    }
    await sleep(100);
  }
  throw new Error('Studio daemon 未能在 6 秒内安全停止；没有执行强制终止。');
}

async function stopRecordedDaemon(workspaceRoot: string, existing: RuntimeRecord): Promise<void> {
  if (path.resolve(existing.workspaceRoot) !== workspaceRoot) throw new Error('运行记录不属于当前工作区，拒绝停止。');
  if (livePid(existing.pid)) {
    const lockPid = recordedLockPid(workspaceRoot);
    if (lockPid === null) throw new Error('daemon 锁文件无有效 PID，拒绝发送终止信号。');
    await signalVerifiedDaemon(existing, {
      workspaceRoot,
      studioId: readStudioId(workspaceRoot),
      lockPid,
      daemonEntry: path.resolve(__dirname, 'daemon.js')
    });
  }
  await waitForDaemonRelease(workspaceRoot, existing);
}

async function restartDaemon(workspaceRoot: string): Promise<{ previousPid: number | null; daemon: RuntimeRecord }> {
  const existing = readRuntime(workspaceRoot);
  const previousPid = existing?.pid || null;
  if (existing) await stopRecordedDaemon(workspaceRoot, existing);
  return { previousPid, daemon: await ensureDaemon(workspaceRoot) };
}

async function ensureDaemon(workspaceRoot: string): Promise<RuntimeRecord> {
  const existing = readRuntime(workspaceRoot);
  if (existing) {
    const studioId = readStudioId(workspaceRoot);
    if (existing.capability && await healthy(existing.url, studioId)) return existing;
    await stopRecordedDaemon(workspaceRoot, existing);
  }
  const daemonEntry = path.resolve(__dirname, 'daemon.js');
  if (!fs.existsSync(daemonEntry)) throw new Error('未找到 vNext Studio daemon。当前安装包不完整，请重新安装完整发布包。');
  const child = spawn(process.execPath, [daemonEntry, '--workspace', workspaceRoot], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(100);
    const started = readRuntime(workspaceRoot);
    if (started?.capability && await healthy(started.url, readStudioId(workspaceRoot))) return started;
  }
  throw new Error('Studio daemon 未能在 6 秒内启动。请检查 daoge-studio/runtime/daemon.log。');
}

async function api(record: RuntimeRecord, method: HttpMethod, pathname: string, body: JsonObject, idempotencyKey?: string): Promise<unknown> {
  if (!record.capability) throw new Error('Studio daemon 缺少本地访问 capability，必须先安全迁移。');
  if (method !== 'GET' && !idempotencyKey) throw new Error('写入操作需要明确的 idempotency key。');
  const response = await fetch(record.url + pathname, {
    method,
    headers: { accept: 'application/json', authorization: 'Bearer ' + record.capability, ...(method !== 'GET' ? { 'content-type': 'application/json', 'idempotency-key': idempotencyKey as string } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body)
  });
  const payload = await response.json() as { ok?: boolean; data?: unknown; error?: { message?: string } };
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message || 'Studio API 请求失败。');
  return payload.data;
}

function textValue(values: Record<string, unknown>, name: string): string { return values[name] as string; }
function jsonValue(values: Record<string, unknown>, name: string): JsonObject { return (values[name] as JsonObject | undefined) || {}; }
function listValue(values: Record<string, unknown>, name: string): string[] { return (values[name] as string[] | undefined) || []; }
function numberValue(values: Record<string, unknown>, name: string): number { return values[name] as number; }
function booleanValue(values: Record<string, unknown>, name: string): boolean { return values[name] === true; }
function encoded(values: Record<string, unknown>, name: string): string { return encodeURIComponent(textValue(values, name)); }

const commandSchemas: Record<string, CommandSchema> = {
  status: { action: 'status', flags: {} }, studio: { action: 'studio', flags: {} }, open: { action: 'open', flags: {} }, restart: { action: 'restart', flags: {} },
  config: { method: 'PUT', flags: { '--worker-concurrency': { kind: 'worker-concurrency', required: true } }, pathname: () => '/api/runtime-settings', body: (v) => ({ maxWorkerConcurrency: numberValue(v, '--worker-concurrency') }) },
  session: { method: 'POST', flags: { '--conversation': { kind: 'text', required: true } }, pathname: () => '/api/sessions/open', body: (v) => ({ conversationId: textValue(v, '--conversation') }) },
  'session-context': { method: 'POST', flags: { '--session': { kind: 'text', required: true }, '--project': { kind: 'text' }, '--task': { kind: 'text' }, '--round': { kind: 'text' } }, pathname: (v) => '/api/sessions/' + encoded(v, '--session') + '/context', body: (v) => ({ projectId: v['--project'], taskId: v['--task'], roundId: v['--round'] }) },
  'archive-project': { method: 'POST', flags: { '--project': { kind: 'text', required: true } }, pathname: (v) => '/api/projects/' + encoded(v, '--project') + '/archive', body: () => ({}) },
  project: { method: 'POST', flags: { '--name': { kind: 'text', required: true }, '--description': { kind: 'text' }, '--session': { kind: 'text' } }, pathname: () => '/api/projects', body: (v) => ({ name: textValue(v, '--name'), description: v['--description'], sessionId: v['--session'] }) },
  task: { method: 'POST', flags: { '--project': { kind: 'text', required: true }, '--name': { kind: 'text', required: true }, '--task-type': { kind: 'text' }, '--intent': { kind: 'json' }, '--session': { kind: 'text' } }, pathname: () => '/api/tasks', body: (v) => ({ projectId: textValue(v, '--project'), name: textValue(v, '--name'), taskTypeId: v['--task-type'], intent: jsonValue(v, '--intent'), sessionId: v['--session'] }) },
  'task-type': { method: 'POST', flags: { '--name': { kind: 'text', required: true }, '--definition': { kind: 'json' } }, pathname: () => '/api/task-types', body: (v) => ({ name: textValue(v, '--name'), definition: jsonValue(v, '--definition') }) },
  'style-kit': { method: 'POST', flags: { '--name': { kind: 'text', required: true }, '--definition': { kind: 'json' }, '--assets': { kind: 'list' } }, pathname: () => '/api/style-kits', body: (v) => ({ name: textValue(v, '--name'), definition: jsonValue(v, '--definition'), assetIds: listValue(v, '--assets') }) },
  'brand-kit': { method: 'POST', flags: { '--name': { kind: 'text', required: true }, '--definition': { kind: 'json' }, '--assets': { kind: 'list' } }, pathname: () => '/api/brand-kits', body: (v) => ({ name: textValue(v, '--name'), definition: jsonValue(v, '--definition'), assetIds: listValue(v, '--assets') }) },
  delivery: { method: 'POST', flags: { '--project': { kind: 'text', required: true }, '--name': { kind: 'text', required: true }, '--assets': { kind: 'list', required: true }, '--creative-record': { kind: 'boolean' } }, pathname: () => '/api/deliveries', body: (v) => ({ projectId: textValue(v, '--project'), name: textValue(v, '--name'), assetIds: listValue(v, '--assets'), includeCreativeRecord: booleanValue(v, '--creative-record') }) },
  'delivery-update': { method: 'PUT', flags: { '--delivery': { kind: 'text', required: true }, '--assets': { kind: 'list', required: true }, '--creative-record': { kind: 'boolean' } }, pathname: (v) => '/api/deliveries/' + encoded(v, '--delivery') + '/items', body: (v) => ({ assetIds: listValue(v, '--assets'), includeCreativeRecord: booleanValue(v, '--creative-record') }) },
  'delivery-ready': { method: 'POST', flags: { '--delivery': { kind: 'text', required: true } }, pathname: (v) => '/api/deliveries/' + encoded(v, '--delivery') + '/ready', body: () => ({}) },
  'delivery-draft': { method: 'POST', flags: { '--delivery': { kind: 'text', required: true } }, pathname: (v) => '/api/deliveries/' + encoded(v, '--delivery') + '/draft', body: () => ({}) },
  'delivery-export': { method: 'POST', flags: { '--delivery': { kind: 'text', required: true } }, pathname: (v) => '/api/deliveries/' + encoded(v, '--delivery') + '/export', body: () => ({}) },
  'delivery-batch': { method: 'POST', flags: { '--project': { kind: 'text', required: true }, '--name': { kind: 'text', required: true }, '--deliveries': { kind: 'list', required: true } }, pathname: () => '/api/delivery-batches', body: (v) => ({ projectId: textValue(v, '--project'), name: textValue(v, '--name'), deliveryIds: listValue(v, '--deliveries') }) },
  'delivery-batch-revise': { method: 'POST', flags: { '--batch': { kind: 'text', required: true }, '--deliveries': { kind: 'list', required: true } }, pathname: (v) => '/api/delivery-batches/' + encoded(v, '--batch') + '/revisions', body: (v) => ({ deliveryIds: listValue(v, '--deliveries') }) },
  'delivery-batch-ready': { method: 'POST', flags: { '--version': { kind: 'text', required: true } }, pathname: (v) => '/api/delivery-batch-versions/' + encoded(v, '--version') + '/ready', body: () => ({}) },
  round: { method: 'POST', flags: { '--task': { kind: 'text', required: true }, '--purpose': { kind: 'purpose', required: true }, '--parent': { kind: 'text' }, '--session': { kind: 'text' } }, pathname: () => '/api/rounds', body: (v) => ({ taskId: textValue(v, '--task'), purpose: textValue(v, '--purpose'), parentRoundId: v['--parent'], sessionId: v['--session'] }) },
  plan: { method: 'POST', flags: { '--round': { kind: 'text', required: true }, '--version': { kind: 'positive-integer', required: true }, '--plan': { kind: 'json', required: true } }, pathname: (v) => '/api/rounds/' + encoded(v, '--round') + '/prepare', body: (v) => ({ expectedVersion: numberValue(v, '--version'), plan: jsonValue(v, '--plan') }) },
  confirm: { method: 'POST', flags: { '--round': { kind: 'text', required: true }, '--version': { kind: 'positive-integer', required: true } }, pathname: (v) => '/api/rounds/' + encoded(v, '--round') + '/confirm', body: (v) => ({ expectedVersion: numberValue(v, '--version') }) },
  preflight: { method: 'POST', flags: { '--round': { kind: 'text', required: true } }, pathname: (v) => '/api/rounds/' + encoded(v, '--round') + '/preflight', body: () => ({}) },
  run: { method: 'POST', flags: { '--round': { kind: 'text', required: true }, '--preflight': { kind: 'text', required: true }, '--concurrency': { kind: 'requested-concurrency' } }, pathname: () => '/api/runs', body: (v) => ({ roundId: textValue(v, '--round'), preflightId: textValue(v, '--preflight'), requestedConcurrency: v['--concurrency'] }) },
  pause: { method: 'POST', flags: { '--run': { kind: 'text', required: true } }, pathname: (v) => '/api/runs/' + encoded(v, '--run') + '/pause', body: () => ({}) },
  resume: { method: 'POST', flags: { '--run': { kind: 'text', required: true }, '--session': { kind: 'text', required: true } }, pathname: (v) => '/api/runs/' + encoded(v, '--run') + '/resume', body: (v) => ({ sessionId: textValue(v, '--session') }) },
  cancel: { method: 'POST', flags: { '--run': { kind: 'text', required: true } }, pathname: (v) => '/api/runs/' + encoded(v, '--run') + '/cancel', body: () => ({}) },
  retry: { method: 'POST', flags: { '--run': { kind: 'text', required: true }, '--items': { kind: 'list' } }, pathname: (v) => '/api/runs/' + encoded(v, '--run') + '/retry', body: (v) => ({ itemIds: v['--items'] }) },
  'resolve-unknown': { method: 'POST', flags: { '--run': { kind: 'text', required: true }, '--items': { kind: 'list', required: true } }, pathname: (v) => '/api/runs/' + encoded(v, '--run') + '/outcomes/resolve', body: (v) => ({ itemIds: listValue(v, '--items') }) }
};

function validateFlag(name: string, raw: string, kind: FlagKind): unknown {
  const value = raw.trim();
  if (!value) throw new Error('需要 ' + name + '。');
  if (kind === 'text') return value;
  if (kind === 'json') { let parsed: unknown; try { parsed = JSON.parse(raw) as unknown; } catch { throw new Error(name + ' 必须是有效 JSON 对象。'); } if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(name + ' 必须是 JSON 对象。'); return parsed; }
  if (kind === 'list') { const values = [...new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))]; if (!values.length) throw new Error(name + ' 必须包含至少一个 ID。'); return values; }
  if (kind === 'boolean') { if (value !== 'true' && value !== 'false') throw new Error(name + ' 只能是 true 或 false。'); return value === 'true'; }
  if (kind === 'purpose') { if (!['exploration', 'refinement', 'variation', 'edit', 'fill'].includes(value)) throw new Error(name + ' 不是支持的创作目的。'); return value; }
  if (kind === 'worker-concurrency') return strictWorkerConcurrency(value);
  if (kind === 'requested-concurrency') return strictRequestedConcurrency(value);
  const integer = Number(value); if (!Number.isInteger(integer) || integer < 1) throw new Error(name + ' 必须是正整数。'); return integer;
}

function explicitIdempotencyKey(raw: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(raw)) throw new Error('--idempotency-key 必须为 1 到 128 个安全字符（字母、数字、点、下划线、冒号或连字符）。');
  return raw;
}

function parseCommand(args: string[]): ParsedCommand {
  const name = args[0] || '';
  const schema = commandSchemas[name];
  if (!schema) throw new Error('未知 vNext 命令。\n' + usage());
  const mutation = Boolean(schema.method && schema.method !== 'GET');
  const allowed = new Set(['--workspace', ...Object.keys(schema.flags), ...(mutation ? ['--idempotency-key'] : [])]);
  const rawValues: Record<string, string> = {};
  for (let index = 1; index < args.length; index += 2) {
    const flagName = args[index];
    if (!flagName.startsWith('--') || !allowed.has(flagName)) throw new Error('未知或不适用于 ' + name + ' 的参数：' + flagName + '。');
    if (Object.prototype.hasOwnProperty.call(rawValues, flagName)) throw new Error('参数不能重复：' + flagName + '。');
    const raw = args[index + 1];
    if (raw === undefined || raw.startsWith('--')) throw new Error('需要 ' + flagName + '。');
    rawValues[flagName] = raw;
  }
  const values: Record<string, unknown> = {};
  for (const [flagName, flagSchema] of Object.entries(schema.flags)) {
    const raw = rawValues[flagName];
    if (raw === undefined) { if (flagSchema.required) throw new Error('需要 ' + flagName + '。'); continue; }
    values[flagName] = validateFlag(flagName, raw, flagSchema.kind);
  }
  const root = workspaceRoot(rawValues['--workspace']);
  if (schema.action) return { name, workspaceRoot: root, action: schema.action };
  const method = schema.method as HttpMethod;
  const idempotencyKey = method === 'GET' ? undefined : rawValues['--idempotency-key'] === undefined ? 'skill-' + randomUUID() : explicitIdempotencyKey(rawValues['--idempotency-key']);
  return { name, workspaceRoot: root, request: { method, pathname: (schema.pathname as (input: Record<string, unknown>) => string)(values), body: schema.body ? schema.body(values) : {}, idempotencyKey } };
}

function usage(): string {
  return [
    'DAOGE Pic vNext Studio',
    'daoge studio --workspace <path>',
    'daoge open --workspace <path>',
    'daoge config --workspace <path> --worker-concurrency <1..1000>  # 修改工作区并发上限，需重启生效',
    'daoge restart --workspace <path>  # 优雅重启本工作区 Studio',
    'daoge session --workspace <path> --conversation <id>',
    'daoge project --workspace <path> --name <name> [--description <text>] [--session <id>]',
    'daoge archive-project --workspace <path> --project <id>',
    'daoge session-context --workspace <path> --session <id> [--project <id>] [--task <id>] [--round <id>]',
    'daoge task --workspace <path> --project <id> --name <name> [--intent <json>] [--session <id>]',
    'daoge task-type --workspace <path> --name <name> [--definition <json>]',
    'daoge style-kit --workspace <path> --name <name> [--definition <json>] [--assets <asset-id,...>]',
    'daoge brand-kit --workspace <path> --name <name> [--definition <json>] [--assets <asset-id,...>]',
    'daoge delivery --workspace <path> --project <id> --name <name> --assets <asset-id,...> [--creative-record true]  # 创建草稿',
    'daoge delivery-update --workspace <path> --delivery <id> --assets <asset-id,...>',
    'daoge delivery-ready --workspace <path> --delivery <id>',
    'daoge delivery-draft --workspace <path> --delivery <id>',
    'daoge delivery-export --workspace <path> --delivery <id>  # 仅已准备交付',
    'daoge delivery-batch --workspace <path> --project <id> --name <name> --deliveries <delivery-id,...>',
    'daoge delivery-batch-revise --workspace <path> --batch <id> --deliveries <delivery-id,...>',
    'daoge delivery-batch-ready --workspace <path> --version <version-id>  # 冻结批次版本',
    'daoge round --workspace <path> --task <id> --purpose <exploration|refinement|variation|edit|fill> [--session <id>]',
    'daoge plan --workspace <path> --round <id> --version <n> --plan <json>',
    'daoge confirm --workspace <path> --round <id> --version <n>',
    'daoge preflight --workspace <path> --round <id>',
    'daoge run --workspace <path> --round <id> --preflight <dry-run-id> [--concurrency <1..1000>]',
    'daoge pause --workspace <path> --run <id>',
    'daoge resume --workspace <path> --run <id> --session <session-id>',
    'daoge cancel --workspace <path> --run <id>',
    'daoge retry --workspace <path> --run <id> [--items <item-id,...>]',
    'daoge resolve-unknown --workspace <path> --run <id> --items <item-id,...>',
    'daoge status --workspace <path>',
    '所有 POST/PUT 命令均可追加 [--idempotency-key <key>]，恢复重试时复用同一 key。'
  ].join('\n');
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  if (command === 'help' || command === '--help' || command === '-h') { process.stdout.write(usage() + '\n'); return; }
  const parsed = parseCommand(args);
  const root = parsed.workspaceRoot;
  const manifest = readStudioManifest(studioPaths(root));
  if (manifest && path.resolve(manifest.workspaceRoot) !== root) throw new Error('当前 Studio manifest workspaceRoot 与请求工作区不匹配。');
  if (parsed.action === 'status') {
    const record = readRuntime(root);
    process.stdout.write(JSON.stringify({ workspaceRoot: root, daemon: publicRuntime(record), healthy: Boolean(record && await healthy(record.url)) }, null, 2) + '\n');
    return;
  }
  if (parsed.action === 'restart') {
    const restarted = await restartDaemon(root);
    process.stdout.write(JSON.stringify({ workspaceRoot: root, previousPid: restarted.previousPid, daemon: publicRuntime(restarted.daemon) }, null, 2) + '\n');
    return;
  }
  const record = await ensureDaemon(root);
  if (parsed.action === 'studio') { process.stdout.write(JSON.stringify({ workspaceRoot: root, workbench: { origin: record.url, command: ['daoge', 'open', '--workspace', root] } }, null, 2) + '\n'); return; }
  if (parsed.action === 'open') {
    await openWorkbenchUrl(workbenchBootstrapUrl(record));
    process.stdout.write(JSON.stringify({ workspaceRoot: root, workbenchOrigin: record.url, opened: true }, null, 2) + '\n');
    return;
  }
  const request = parsed.request as NonNullable<ParsedCommand['request']>;
  const result = await api(record, request.method, request.pathname, request.body, request.idempotencyKey);
  if (parsed.name === 'config') {
    const runtime = result as { desired: { maxWorkerConcurrency: number }; active: { workerConcurrency: number | null } | null; restartRequired: boolean };
    process.stdout.write(JSON.stringify({ workspaceRoot: root, workerConcurrency: runtime.desired.maxWorkerConcurrency, restartRequired: runtime.restartRequired, activeWorkerConcurrency: runtime.active?.workerConcurrency || null }, null, 2) + '\n');
    return;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

export { parseCommand };

if (require.main === module) void main().catch((error) => { process.stderr.write((error instanceof Error ? error.message : 'DAOGE Pic 命令失败。') + '\n'); process.exitCode = 1; });
