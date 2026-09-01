import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { MAX_WORKER_CONCURRENCY, MIN_WORKER_CONCURRENCY } from '../studio/runtime-settings';

interface RuntimeRecord { pid: number; url: string; workspaceRoot: string; heartbeatAt: string; workerConcurrency?: number | null; }

type JsonObject = Record<string, unknown>;

function flag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || '').trim() || null : null;
}

function workspace(args: string[]): string {
  const root = flag(args, '--workspace') || String(process.env.DAOGE_WORKSPACE_ROOT || '').trim();
  if (!root) throw new Error('需要 --workspace 或 DAOGE_WORKSPACE_ROOT。不会使用不稳定的当前目录作为 Studio 工作区。');
  return path.resolve(root);
}

function runtimePath(workspaceRoot: string): string { return path.join(workspaceRoot, 'daoge-studio', 'runtime', 'daemon.json'); }
function readRuntime(workspaceRoot: string): RuntimeRecord | null {
  try {
    const value = JSON.parse(fs.readFileSync(runtimePath(workspaceRoot), 'utf8')) as RuntimeRecord;
    return value && typeof value.url === 'string' && Number.isInteger(value.pid) ? value : null;
  } catch { return null; }
}

async function healthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(url + '/api/health', { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch { return false; }
}

function sleep(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function strictWorkerConcurrency(value: string): number {
  const concurrency = Number(value);
  if (Number.isInteger(concurrency) && concurrency >= MIN_WORKER_CONCURRENCY && concurrency <= MAX_WORKER_CONCURRENCY) return concurrency;
  throw new Error('--worker-concurrency 只能是 1 到 30 的整数。');
}

function strictRequestedConcurrency(value: string): number {
  const concurrency = Number(value);
  if (Number.isInteger(concurrency) && concurrency >= MIN_WORKER_CONCURRENCY && concurrency <= MAX_WORKER_CONCURRENCY) return concurrency;
  throw new Error('--concurrency 只能是 1 到 30 的整数。');
}

async function waitForDaemonRelease(workspaceRoot: string, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const current = readRuntime(workspaceRoot);
    let live = false;
    try { process.kill(pid, 0); live = true; } catch { /* process is gone */ }
    if (!live && (!current || current.pid !== pid)) return;
    await sleep(100);
  }
  throw new Error('Studio daemon 未能在 6 秒内安全停止；没有执行强制终止。');
}

async function restartDaemon(workspaceRoot: string): Promise<{ previousPid: number | null; daemon: RuntimeRecord }> {
  const existing = readRuntime(workspaceRoot);
  if (existing && path.resolve(existing.workspaceRoot) !== workspaceRoot) throw new Error('运行记录不属于当前工作区，拒绝重启。');
  const previousPid = existing?.pid || null;
  if (existing) {
    try { process.kill(existing.pid, 'SIGTERM'); } catch { /* wait verifies release or reports a bounded failure */ }
    await waitForDaemonRelease(workspaceRoot, existing.pid);
  }
  return { previousPid, daemon: await ensureDaemon(workspaceRoot) };
}

async function ensureDaemon(workspaceRoot: string): Promise<RuntimeRecord> {
  const existing = readRuntime(workspaceRoot);
  if (existing && await healthy(existing.url)) return existing;
  const daemonEntry = path.resolve(__dirname, 'daemon.js');
  if (!fs.existsSync(daemonEntry)) throw new Error('未找到 vNext Studio daemon。当前安装包不完整，请重新安装完整发布包。');
  const child = spawn(process.execPath, [daemonEntry, '--workspace', workspaceRoot], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(100);
    const started = readRuntime(workspaceRoot);
    if (started && await healthy(started.url)) return started;
  }
  throw new Error('Studio daemon 未能在 6 秒内启动。请检查 daoge-studio/runtime/daemon.log。');
}

async function api(record: RuntimeRecord, method: 'GET' | 'POST' | 'PUT', pathname: string, body?: JsonObject): Promise<unknown> {
  const response = await fetch(record.url + pathname, {
    method,
    headers: { accept: 'application/json', ...(method !== 'GET' ? { 'content-type': 'application/json', 'idempotency-key': 'skill-' + randomUUID() } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json() as { ok?: boolean; data?: unknown; error?: { message?: string } };
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message || 'Studio API 请求失败。');
  return payload.data;
}

function booleanFlag(args: string[], name: string): boolean { return flag(args, name) === 'true'; }

function assetIdsFlag(args: string[], name = '--assets'): string[] {
  const raw = flag(args, name);
  return raw ? [...new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))] : [];
}

function jsonFlag(args: string[], name: string): JsonObject {
  const raw = flag(args, name);
  if (!raw) return {};
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(name + ' 必须是 JSON 对象。');
  return value as JsonObject;
}

function required(args: string[], name: string): string {
  const value = flag(args, name);
  if (!value) throw new Error('需要 ' + name + '。');
  return value;
}

function usage(): string {
  return [
    'DAOGE Pic vNext Studio',
    'daoge studio --workspace <path>',
    'daoge open --workspace <path>',
    'daoge config --workspace <path> --worker-concurrency <1..30>  # 修改工作区并发上限，需重启生效',
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
    'daoge run --workspace <path> --round <id> --preflight <dry-run-id> [--concurrency <1..30>]',
    'daoge pause --workspace <path> --run <id>',
    'daoge resume --workspace <path> --run <id> --session <session-id>',
    'daoge cancel --workspace <path> --run <id>',
    'daoge retry --workspace <path> --run <id> [--items <item-id,...>]',
    'daoge resolve-unknown --workspace <path> --run <id> --items <item-id,...>',
    'daoge status --workspace <path>'
  ].join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  if (command === 'help' || command === '--help' || command === '-h') { process.stdout.write(usage() + '\n'); return; }
  const root = workspace(args);
  if (command === 'status') {
    const record = readRuntime(root);
    process.stdout.write(JSON.stringify({ workspaceRoot: root, daemon: record, healthy: Boolean(record && await healthy(record.url)) }, null, 2) + '\n');
    return;
  }
  if (command === 'config') {
    const workerConcurrency = strictWorkerConcurrency(required(args, '--worker-concurrency'));
    const record = await ensureDaemon(root);
    const runtime = await api(record, 'PUT', '/api/runtime-settings', { maxWorkerConcurrency: workerConcurrency }) as { desired: { maxWorkerConcurrency: number }; active: { workerConcurrency: number | null } | null; restartRequired: boolean };
    process.stdout.write(JSON.stringify({ workspaceRoot: root, workerConcurrency: runtime.desired.maxWorkerConcurrency, restartRequired: runtime.restartRequired, activeWorkerConcurrency: runtime.active?.workerConcurrency || null }, null, 2) + '\n');
    return;
  }
  if (command === 'restart') {
    const restarted = await restartDaemon(root);
    process.stdout.write(JSON.stringify({ workspaceRoot: root, previousPid: restarted.previousPid, daemon: restarted.daemon }, null, 2) + '\n');
    return;
  }
  const record = await ensureDaemon(root);
  if (command === 'studio') { process.stdout.write(JSON.stringify({ url: record.url, workspaceRoot: root }, null, 2) + '\n'); return; }
  if (command === 'open') {
    if (process.platform === 'darwin') spawn('open', [record.url], { detached: true, stdio: 'ignore' }).unref();
    process.stdout.write(JSON.stringify({ url: record.url, workspaceRoot: root }, null, 2) + '\n');
    return;
  }
  let result: unknown;
  if (command === 'session') result = await api(record, 'POST', '/api/sessions/open', { conversationId: required(args, '--conversation') });
  else if (command === 'session-context') result = await api(record, 'POST', '/api/sessions/' + encodeURIComponent(required(args, '--session')) + '/context', { projectId: flag(args, '--project') || undefined, taskId: flag(args, '--task') || undefined, roundId: flag(args, '--round') || undefined });
  else if (command === 'archive-project') result = await api(record, 'POST', '/api/projects/' + encodeURIComponent(required(args, '--project')) + '/archive', {});
  else if (command === 'project') result = await api(record, 'POST', '/api/projects', { name: required(args, '--name'), description: flag(args, '--description') || undefined, sessionId: flag(args, '--session') || undefined });
  else if (command === 'task') result = await api(record, 'POST', '/api/tasks', { projectId: required(args, '--project'), name: required(args, '--name'), taskTypeId: flag(args, '--task-type') || undefined, intent: jsonFlag(args, '--intent'), sessionId: flag(args, '--session') || undefined });
  else if (command === 'task-type') result = await api(record, 'POST', '/api/task-types', { name: required(args, '--name'), definition: jsonFlag(args, '--definition') });
  else if (command === 'style-kit') result = await api(record, 'POST', '/api/style-kits', { name: required(args, '--name'), definition: jsonFlag(args, '--definition'), assetIds: assetIdsFlag(args) });
  else if (command === 'brand-kit') result = await api(record, 'POST', '/api/brand-kits', { name: required(args, '--name'), definition: jsonFlag(args, '--definition'), assetIds: assetIdsFlag(args) });
  else if (command === 'delivery') result = await api(record, 'POST', '/api/deliveries', { projectId: required(args, '--project'), name: required(args, '--name'), assetIds: assetIdsFlag(args), includeCreativeRecord: booleanFlag(args, '--creative-record') });
  else if (command === 'delivery-update') result = await api(record, 'PUT', '/api/deliveries/' + encodeURIComponent(required(args, '--delivery')) + '/items', { assetIds: assetIdsFlag(args), includeCreativeRecord: booleanFlag(args, '--creative-record') });
  else if (command === 'delivery-ready') result = await api(record, 'POST', '/api/deliveries/' + encodeURIComponent(required(args, '--delivery')) + '/ready', {});
  else if (command === 'delivery-draft') result = await api(record, 'POST', '/api/deliveries/' + encodeURIComponent(required(args, '--delivery')) + '/draft', {});
  else if (command === 'delivery-export') result = await api(record, 'POST', '/api/deliveries/' + encodeURIComponent(required(args, '--delivery')) + '/export', {});
  else if (command === 'delivery-batch') result = await api(record, 'POST', '/api/delivery-batches', { projectId: required(args, '--project'), name: required(args, '--name'), deliveryIds: assetIdsFlag(args, '--deliveries') });
  else if (command === 'delivery-batch-revise') result = await api(record, 'POST', '/api/delivery-batches/' + encodeURIComponent(required(args, '--batch')) + '/revisions', { deliveryIds: assetIdsFlag(args, '--deliveries') });
  else if (command === 'delivery-batch-ready') result = await api(record, 'POST', '/api/delivery-batch-versions/' + encodeURIComponent(required(args, '--version')) + '/ready', {});
  else if (command === 'round') result = await api(record, 'POST', '/api/rounds', { taskId: required(args, '--task'), purpose: required(args, '--purpose'), parentRoundId: flag(args, '--parent') || undefined, sessionId: flag(args, '--session') || undefined });
  else if (command === 'plan') result = await api(record, 'POST', '/api/rounds/' + encodeURIComponent(required(args, '--round')) + '/prepare', { expectedVersion: Number(required(args, '--version')), plan: jsonFlag(args, '--plan') });
  else if (command === 'confirm') result = await api(record, 'POST', '/api/rounds/' + encodeURIComponent(required(args, '--round')) + '/confirm', { expectedVersion: Number(required(args, '--version')) });
  else if (command === 'preflight') result = await api(record, 'POST', '/api/rounds/' + encodeURIComponent(required(args, '--round')) + '/preflight', {});
  else if (command === 'run') result = await api(record, 'POST', '/api/runs', { roundId: required(args, '--round'), preflightId: required(args, '--preflight'), requestedConcurrency: flag(args, '--concurrency') ? strictRequestedConcurrency(required(args, '--concurrency')) : undefined });
  else if (command === 'pause') result = await api(record, 'POST', '/api/runs/' + encodeURIComponent(required(args, '--run')) + '/pause', {});
  else if (command === 'resume') result = await api(record, 'POST', '/api/runs/' + encodeURIComponent(required(args, '--run')) + '/resume', { sessionId: required(args, '--session') });
  else if (command === 'cancel') result = await api(record, 'POST', '/api/runs/' + encodeURIComponent(required(args, '--run')) + '/cancel', {});
  else if (command === 'retry') result = await api(record, 'POST', '/api/runs/' + encodeURIComponent(required(args, '--run')) + '/retry', { itemIds: flag(args, '--items') ? assetIdsFlag(args, '--items') : undefined });
  else if (command === 'resolve-unknown') result = await api(record, 'POST', '/api/runs/' + encodeURIComponent(required(args, '--run')) + '/outcomes/resolve', { itemIds: assetIdsFlag(args, '--items') });
  else throw new Error('未知 vNext 命令。\n' + usage());
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

void main().catch((error) => { process.stderr.write((error instanceof Error ? error.message : 'DAOGE Pic 命令失败。') + '\n'); process.exitCode = 1; });
