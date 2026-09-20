import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { openWorkbenchUrl } from './open-workbench';
import { MAX_GLOBAL_CONCURRENCY, MIN_EXECUTION_CONCURRENCY } from '../studio/runtime-settings';
import { healthStudioId, shutdownVerifiedDaemon } from './daemon-shutdown';
import { readStudioManifest, sameWorkspaceRoot, studioPaths } from '../studio/workspace';
import { daemonEnvWithSecretBackend, readWorkspaceSecretBackend, writeWorkspaceSecretBackend, SECRET_BACKEND_CHOICES, type SecretBackendChoice } from '../studio/secret-backend-config';
import { isSupportedProtocolVersion, isSupportedRuntimeVersion, RUNTIME_VERSION, SKILL_PROTOCOL_NAME, SKILL_PROTOCOL_VERSION } from '../shared/protocol';
import { currentBuildId } from '../shared/build-identity';
import { registerSkill, SkillRegistrationScope } from './register-skill';
import { skillHostChoices, skillHostDirectory } from '../domain/agent-detect';
import { assertWorkspaceSupported, doctorWorkspace, formatDoctorReport, redactDoctorReport } from './doctor';
import type { ProviderConcurrencySnapshot } from '../runtime/provider-concurrency';
export interface RuntimeRecord { pid: number; url: string; capability?: string; workspaceRoot: string; startedAt?: string; heartbeatAt: string; buildId?: string; providerConcurrency?: ProviderConcurrencySnapshot | null; }

type JsonObject = Record<string, unknown>;
const STDIN_JSON_MARKER = Object.freeze({ __daogeJsonStdin: true });
const STDIN_SECRET_MARKER = Object.freeze({ __daogeSecretStdin: true });
const MAX_STDIN_JSON_BYTES = 8 * 1024 * 1024;

type HttpMethod = 'GET' | 'POST' | 'PUT';
type LocalAction = 'status' | 'studio' | 'open' | 'enter' | 'stop' | 'restart' | 'register-skill' | 'reference' | 'round-status' | 'doctor' | 'backup-restore' | 'provider-secret-backend';
type FlagKind = 'text' | 'json' | 'secret-stdin' | 'positive-integer' | 'non-negative-integer' | 'usage-limit' | 'execution-concurrency' | 'list' | 'boolean' | 'purpose' | 'scope' | 'host' | 'secret-backend';
interface FlagSchema { kind: FlagKind; required?: boolean; }
interface CommandSchema {
  // summary 必填：用法文本由表生成，少了它这条命令在 --help 里就是一行没有说明的空壳。
  summary: string;
  action?: LocalAction;
  method?: HttpMethod;
  flags: Record<string, FlagSchema>;
  pathname?: (values: Record<string, unknown>) => string;
  body?: (values: Record<string, unknown>) => JsonObject;
}

// 每种参数取值形态在 --help 里的占位提示。与 validateFlag 同源：改了校验规则就改这里。
const FLAG_HINTS: Record<FlagKind, string> = {
  'text': '<文本>',
  'json': '<json|@->',
  'secret-stdin': '@-',
  'positive-integer': '<正整数>',
  'non-negative-integer': '<非负整数>',
  'usage-limit': '<1..10000>',
  'execution-concurrency': '<1..1000>',
  'list': '<逗号分隔>',
  'boolean': '<true|false>',
  'purpose': '<exploration|refinement|variation|edit|fill>',
  'scope': '<project|user>',
  'host': '<宿主名>',
  'secret-backend': '<plaintext|system>'
};
interface ParsedCommand {
  name: string;
  workspaceRoot?: string;
  action?: LocalAction;
  request?: { method: HttpMethod; pathname: string; body: JsonObject; idempotencyKey?: string; operationName?: string };
  force?: boolean;
  allowNestedStudio?: boolean;
  scope?: SkillRegistrationScope;
  host?: string;
  jsonOutput?: boolean;
  redactedOutput?: boolean;
  restoreInput?: JsonObject;
  secretBackend?: SecretBackendChoice;
  enter?: EnterInput;
  referenceTopic?: string;
  referenceSection?: string;
  roundStatus?: { roundId: string; sessionId: string };
  planChallenge?: { roundId: string; sessionId: string };
}

/**
 * 稳定工作区的解析顺序：显式参数 → `DAOGE_WORKSPACE_ROOT` → 从 cwd 向上找到**已经落盘**的 Studio。
 *
 * 第三步只认现存的 `daoge-studio/studio.json`：它不创建、不推断、不看 Skill 安装目录，
 * 所以「任意当前目录」依然当不了工作区（那是数据分裂的入口），而 agent 也不必再靠 glob
 * 满盘找 studio.json —— 那次实测里这正是两轮往返。
 */
export function resolveWorkspaceRoot(explicit?: string, startDirectory = process.cwd()): string {
  const requested = String(explicit || process.env.DAOGE_WORKSPACE_ROOT || '').trim();
  if (requested) return path.resolve(requested);
  let candidate = path.resolve(startDirectory);
  while (true) {
    if (fs.existsSync(studioPaths(candidate).manifestPath)) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error('需要 --workspace 或 DAOGE_WORKSPACE_ROOT（或在已初始化的 Studio 目录内运行）。不会使用不稳定的当前目录作为 Studio 工作区。');
}

/**
 * 安装动作必须显式说清装进哪个工作区：register-skill 写的是工作区级目录（`<workspace>/.agents/skills`），
 * 不能让「从 cwd 往上找到的 Studio」替用户决定装到哪儿。其它命令可以从 cwd 解析 —— 它们要么只读，
 * 要么只动 `<workspace>/daoge-studio`，认错工作区最多是找不到 Studio，不会把东西写进别人的仓库。
 */
function workspaceRootForCommand(name: string, requested: string | undefined): string | undefined {
  if (name !== 'register-skill') return resolveWorkspaceRoot(requested);
  if (requested === undefined || String(requested).trim() === '') throw new Error('需要 --workspace：register-skill 不会从当前目录推断要装进哪个工作区。');
  return resolveWorkspaceRoot(requested);
}

export function assertImplicitStudioCreationAllowed(workspaceRoot: string, allowNestedStudio = false): void {
  if (allowNestedStudio) return;
  const root = path.resolve(workspaceRoot);
  let candidate = path.dirname(root);
  if (candidate === root) return;
  while (true) {
    const manifest = readStudioManifest(studioPaths(candidate));
    if (manifest) {
      throw new Error('检测到父级 DAOGE Pic Studio：' + candidate + '。为避免创建数据不互通的嵌套 Studio，已拒绝初始化 ' + root + '。请复用父级工作区；如确需独立 Studio，请先执行 daoge open --workspace <path> --allow-nested-studio true。');
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) return;
    candidate = parent;
  }
}

function runtimePath(workspaceRoot: string): string { return path.join(workspaceRoot, 'daoge-studio', 'runtime', 'daemon.json'); }
function manifestPath(workspaceRoot: string): string { return path.join(workspaceRoot, 'daoge-studio', 'studio.json'); }
function readStudioId(workspaceRoot: string): string {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath(workspaceRoot), 'utf8')) as { studioId?: unknown; workspaceRoot?: unknown };
    if (typeof manifest.studioId === 'string' && manifest.studioId && typeof manifest.workspaceRoot === 'string' && sameWorkspaceRoot(manifest.workspaceRoot, workspaceRoot)) return manifest.studioId;
  } catch { /* handled by the safe refusal below */ }
  throw new Error('无法确认当前 Studio manifest 身份，拒绝停止已有 daemon。');
}
function readRuntime(workspaceRoot: string): RuntimeRecord | null {
  try {
    const value = JSON.parse(fs.readFileSync(runtimePath(workspaceRoot), 'utf8')) as RuntimeRecord;
    if (!value || !Number.isInteger(value.pid) || value.pid <= 0 || typeof value.url !== 'string' || typeof value.workspaceRoot !== 'string') return null;
    const parsed = new URL(value.url);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !sameWorkspaceRoot(value.workspaceRoot, workspaceRoot)) return null;
    if (value.capability !== undefined && (typeof value.capability !== 'string' || value.capability.length < 43)) return null;
    return value;
  } catch { return null; }
}
function publicRuntime(record: RuntimeRecord | null): Record<string, unknown> | null {
  if (!record) return null;
  return { pid: record.pid, url: record.url, workspaceRoot: record.workspaceRoot, heartbeatAt: record.heartbeatAt, ...(record.buildId === undefined ? {} : { buildId: record.buildId }), providerConcurrency: record.providerConcurrency || null };
}
/**
 * agent 面向的精简运行时：只留 pid 与构建身份。
 * 不带 url / workspaceRoot / heartbeat / 并发明细：既省每次调用的 token，也避免把裸 Workbench origin
 * 塞进 agent 上下文（「不得暴露裸 origin」的边界）。需要地址请用 `daoge studio`。
 */
function compactRuntime(record: RuntimeRecord | null): Record<string, unknown> | null {
  if (!record) return null;
  return { pid: record.pid, ...(record.buildId === undefined ? {} : { buildId: record.buildId }) };
}

function workbenchBootstrapUrl(record: RuntimeRecord): string {
  if (!record.capability) throw new Error('Studio daemon 缺少本地访问 capability，必须先安全迁移。');
  return record.url + '/#capability=' + encodeURIComponent(record.capability);
}

const DAEMON_LIFECYCLE_ATTEMPTS = process.platform === 'win32' ? 600 : 100;
async function healthy(url: string, expectedStudioId?: string): Promise<boolean> {
  const studioId = await healthStudioId(url);
  return Boolean(studioId && (!expectedStudioId || studioId === expectedStudioId));
}


function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === 'string' ? value : '';
}

function studioStatusCompatible(value: unknown, expectedStudioId: string): boolean {
  const data = jsonRecord(value);
  if (!data || stringField(data, 'studioId') !== expectedStudioId) return false;
  const protocol = jsonRecord(data.protocol);
  return Boolean(protocol
    && stringField(protocol, 'name') === SKILL_PROTOCOL_NAME
    && isSupportedProtocolVersion(stringField(protocol, 'version'))
    && isSupportedRuntimeVersion(stringField(protocol, 'runtimeVersion')));
}

export async function daemonCompatible(record: RuntimeRecord, expectedStudioId: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!record.capability) return false;
  try {
    const response = await fetchImpl(new URL('/api/studio', record.url), {
      headers: { accept: 'application/json', authorization: 'Bearer ' + record.capability, 'x-daoge-skill-protocol': SKILL_PROTOCOL_NAME + '/' + SKILL_PROTOCOL_VERSION },
      signal: AbortSignal.timeout(800)
    });
    if (!response.ok) return false;
    const payload = await response.json() as { ok?: unknown; data?: unknown };
    return payload.ok === true && studioStatusCompatible(payload.data, expectedStudioId);
  } catch {
    return false;
  }
}

function sleep(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

export interface DaemonBuildStatus { cliBuildId: string; daemonBuildId: string | null; staleBuild: boolean; activeRequests: number; }

/**
 * 「这个 daemon 跑的是不是当前这份安装」——协议/运行时版本都是区间，答不了这个问题。
 * 看不见 daemon 身份（旧构建根本不报 buildId）也算陈旧：那就是它比本 CLI 老。
 * `activeRequests` 一起返回，是因为「换进程」只应该在**没有在飞请求**时做。
 */
export async function daemonBuildStatus(record: RuntimeRecord | null, fetchImpl: typeof fetch = fetch): Promise<DaemonBuildStatus> {
  const cliBuildId = currentBuildId();
  if (!record || !record.capability) return { cliBuildId, daemonBuildId: null, staleBuild: false, activeRequests: 0 };
  let daemonBuildId: string | null = null;
  let activeRequests = 0;
  try {
    const response = await fetchImpl(new URL('/api/studio', record.url), {
      headers: { accept: 'application/json', authorization: 'Bearer ' + record.capability, 'x-daoge-skill-protocol': SKILL_PROTOCOL_NAME + '/' + SKILL_PROTOCOL_VERSION },
      signal: AbortSignal.timeout(800)
    });
    if (response.ok) {
      const payload = await response.json() as { ok?: unknown; data?: unknown };
      const data = jsonRecord(payload.data);
      if (payload.ok === true && data) {
        if (typeof data.buildId === 'string') daemonBuildId = data.buildId;
        const runtime = jsonRecord(data.runtime);
        const concurrency = runtime ? jsonRecord(runtime.providerConcurrency) : null;
        const active = concurrency ? Number(concurrency.active) : 0;
        activeRequests = Number.isFinite(active) && active > 0 ? active : 0;
      }
    }
  } catch {
    /* 探不到身份就是探不到：下面按「陈旧」处理，而不是假装它是新的 */
  }
  return { cliBuildId, daemonBuildId, staleBuild: daemonBuildId !== cliBuildId, activeRequests };
}

function assertSupportedNodeRuntime(): void {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || major < 22 || (major === 22 && minor < 17)) {
    throw new Error('DAOGE Pic 需要 Node.js 22.17.0 或更高版本；当前版本为 ' + process.versions.node + '。');
  }
}


function strictExecutionConcurrency(value: string): number {
  const concurrency = Number(value);
  if (Number.isInteger(concurrency) && concurrency >= MIN_EXECUTION_CONCURRENCY && concurrency <= MAX_GLOBAL_CONCURRENCY) return concurrency;
  throw new Error('--concurrency 只能是 1 到 1000 的整数。');
}

function livePid(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function recordedOwnerPid(workspaceRoot: string): number | null {
  try {
    const owner = JSON.parse(fs.readFileSync(studioPaths(workspaceRoot).daemonOwnerRecordPath, 'utf8')) as { pid?: unknown };
    return Number.isInteger(owner.pid) && Number(owner.pid) > 0 ? Number(owner.pid) : null;
  } catch { return null; }
}


/**
 * 等旧 daemon 真正「放手」，判据是**事实**而不是「进程还在不在」：
 * 它自己退出时会删掉 runtime 记录（见 runtime/daemon.ts 的 close()），所以
 * 「记录不再属于它」且「不再响应健康检查」就是放手了。
 *
 * 不拿 `kill(pid, 0)` 当判据：调用方若是那个 daemon 的父进程且从不 wait()，
 * 子进程会变成僵尸 —— 僵尸不响应 HTTP，但 kill(pid, 0) 依然成功，于是每一次
 * 受控重启都会干等满 10 秒再报「未能在 10 秒内安全停止」。陈旧记录 + 无活进程
 * 的情况由此同样收敛：记录被清掉、健康检查无人应答，立刻放手。
 */
async function waitForDaemonRelease(workspaceRoot: string, record: RuntimeRecord): Promise<void> {
  for (let attempt = 0; attempt < DAEMON_LIFECYCLE_ATTEMPTS; attempt += 1) {
    const current = readRuntime(workspaceRoot);
    const stillHoldsRecord = Boolean(current && current.pid === record.pid);
    const responding = await healthy(record.url);
    if (!stillHoldsRecord && !responding) {
      // A stale daemon.lock observation never blocks the next SQLite lock acquisition:
      // only an exact pid+ownerId holder removes its own record during normal shutdown.
      return;
    }
    await sleep(100);
  }
  throw new Error('Studio daemon 未能在 ' + DAEMON_LIFECYCLE_ATTEMPTS / 10 + ' 秒内安全停止；没有执行强制终止。');
}

async function stopRecordedDaemon(workspaceRoot: string, existing: RuntimeRecord): Promise<void> {
  if (!sameWorkspaceRoot(existing.workspaceRoot, workspaceRoot)) throw new Error('运行记录不属于当前工作区，拒绝停止。');
  if (livePid(existing.pid)) {
    const ownerPid = recordedOwnerPid(workspaceRoot);
    if (ownerPid === null) throw new Error('daemon owner record 无有效 PID，拒绝受控关闭。');
    await shutdownVerifiedDaemon(existing, {
      workspaceRoot,
      studioId: readStudioId(workspaceRoot),
      lockPid: ownerPid,
      daemonEntry: path.resolve(__dirname, 'daemon.js')
    });
  }
  await waitForDaemonRelease(workspaceRoot, existing);
}
async function runOfflineRestoreHelper(workspaceRoot: string, sourceRoot: string, manifest: unknown, expectedStudio: JsonObject): Promise<number> {
  const existing = readRuntime(workspaceRoot);
  if (existing && livePid(existing.pid)) await stopRecordedDaemon(workspaceRoot, existing);
  const helper = path.resolve(__dirname, 'restore-helper.js');
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [helper], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DAOGE_OFFLINE_RESTORE: '1' } });
    let settled = false;
    const finish = (error?: Error, code = 1): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(code);
    };
    child.once('error', (error) => finish(error instanceof Error ? error : new Error('无法启动离线 restore helper。')));
    child.once('close', (code) => finish(undefined, code === null ? 1 : code));
    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.stdin.end(JSON.stringify({ sourceRoot, targetRoot: workspaceRoot, manifest, expectedStudio }));
  });
}

async function stopSpawnedDaemon(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener('exit', onExit);
      if (error) reject(error);
      else resolve();
    };
    const onExit = (): void => finish();
    const timeout = setTimeout(() => finish(new Error('本次 CLI 启动的非 owner daemon 未能在 3 秒内退出。')), 3000);
    child.once('exit', onExit);
    if (child.exitCode !== null || child.signalCode !== null) return finish();
    try {
      if (!child.kill('SIGTERM') && child.exitCode === null && child.signalCode === null) {
        finish(new Error('无法停止本次 CLI 启动的非 owner daemon。'));
      }
    } catch (error) {
      finish(error instanceof Error ? error : new Error('无法停止本次 CLI 启动的非 owner daemon。'));
    }
  });
}


/**
 * 重启 = **换进程**。
 *
 * 旧实现走 daemon 内 `/api/restart` 的同进程重初始化：PID 不变、`startedAt` 变新，
 * 于是 CLI 判定「重启成功」，而内存里仍是旧代码 —— 2026-09-20 的实测里，agent 为了
 * 证明这件事花了 14 分钟（ps lstart / git 历史 / backup manifest 探针）。现在只有换进程
 * 才算重启，并且换完必须自证：PID 必须变化、新进程必须报告与本 CLI 一致的构建身份。
 */
async function restartDaemon(workspaceRoot: string): Promise<{ previousPid: number | null; previousBuild: DaemonBuildStatus | null; daemon: RuntimeRecord }> {
  const existing = readRuntime(workspaceRoot);
  const previousPid = existing && livePid(existing.pid) ? existing.pid : null;
  const previousBuild = existing ? await daemonBuildStatus(existing) : null;
  if (existing) {
    // 记录还在但没有活进程：它只是残留，删掉即可，不必走受控关闭。
    if (previousPid === null) fs.rmSync(runtimePath(workspaceRoot), { force: true });
    else await stopRecordedDaemon(workspaceRoot, existing);
  }
  const daemon = await ensureDaemon(workspaceRoot);
  if (previousPid !== null && daemon.pid === previousPid) throw new Error('Studio daemon 重启后 PID 未变化，拒绝把同一个进程当作新进程汇报。');
  const build = await daemonBuildStatus(daemon);
  if (build.staleBuild) throw new Error('Studio daemon 重启后仍未加载当前构建（daemon ' + (build.daemonBuildId || 'unknown') + ' / cli ' + build.cliBuildId + '），拒绝谎报重启成功。');
  return { previousPid, previousBuild, daemon };
}

async function ensureDaemon(workspaceRoot: string): Promise<RuntimeRecord> {
  const existing = readRuntime(workspaceRoot);
  if (existing) {
    const studioId = readStudioId(workspaceRoot);
    if (existing.capability && await healthy(existing.url, studioId) && await daemonCompatible(existing, studioId)) return existing;
    await stopRecordedDaemon(workspaceRoot, existing);
  }
  const daemonEntry = path.resolve(__dirname, 'daemon.js');
  if (!fs.existsSync(daemonEntry)) throw new Error('未找到 vNext Studio daemon。当前安装包不完整，请重新安装完整发布包。');
  const child = spawn(process.execPath, [daemonEntry, '--workspace', workspaceRoot], { detached: true, stdio: 'ignore', windowsHide: true, env: daemonEnvWithSecretBackend(studioPaths(workspaceRoot)) });
  let spawnError: Error | null = null;
  child.once('error', (error) => { spawnError = error; });
  for (let attempt = 0; attempt < DAEMON_LIFECYCLE_ATTEMPTS; attempt += 1) {
    await sleep(100);
    if (spawnError) throw spawnError;
    const started = readRuntime(workspaceRoot);
    const studioId = started ? readStudioId(workspaceRoot) : '';
    if (started?.capability && await healthy(started.url, studioId) && await daemonCompatible(started, studioId)) {
      if (started.pid === child.pid) child.unref();
      else await stopSpawnedDaemon(child);
      return started;
    }
  }
  await stopSpawnedDaemon(child);
  throw new Error('Studio daemon 未能在 ' + DAEMON_LIFECYCLE_ATTEMPTS / 10 + ' 秒内启动。请检查 daoge-studio/runtime/daemon.log。');
}

async function api(record: RuntimeRecord, method: HttpMethod, pathname: string, body: JsonObject, idempotencyKey?: string, operationName?: string): Promise<unknown> {
  if (!record.capability) throw new Error('Studio daemon 缺少本地访问 capability，必须先安全迁移。');
  if (method !== 'GET' && !idempotencyKey && !operationName) throw new Error('写入操作需要 idempotency key 或 operation name。');
  const response = await fetch(record.url + pathname, {
    method,
    headers: { accept: 'application/json', authorization: 'Bearer ' + record.capability, 'x-daoge-skill-protocol': SKILL_PROTOCOL_NAME + '/' + SKILL_PROTOCOL_VERSION, ...(method !== 'GET' ? { 'content-type': 'application/json', ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}), ...(operationName ? { 'x-daoge-operation-name': operationName } : {}) } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body)
  });
  const payload = await response.json() as { ok?: boolean; data?: unknown; error?: { message?: string } };
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message || 'Studio API 请求失败。');
  return payload.data;
}
export interface WorkbenchOpenOutput {
  opened: boolean;
  reused: boolean;
  reason: 'opener-claim' | 'forced-opener-claim' | 'active-workbench' | 'recent-workbench' | 'open-claim-active';
}

const WORKBENCH_OPEN_REASONS: Record<WorkbenchOpenOutput['reason'], true> = { 'opener-claim': true, 'forced-opener-claim': true, 'active-workbench': true, 'recent-workbench': true, 'open-claim-active': true };

export async function openOrReuseWorkbench(record: RuntimeRecord, force = false, opener: (url: string) => Promise<void> = openWorkbenchUrl): Promise<WorkbenchOpenOutput> {
  const claimToken = randomBytes(32).toString('base64url');
  const claimed = await api(record, 'POST', '/api/workbench/open-claim', { claimToken, force }, 'open-claim-' + randomUUID()) as { claimed?: unknown; reused?: unknown; reason?: unknown };
  const reason = typeof claimed.reason === 'string' && WORKBENCH_OPEN_REASONS[claimed.reason as WorkbenchOpenOutput['reason']] ? claimed.reason as WorkbenchOpenOutput['reason'] : null;
  if (!reason || typeof claimed.claimed !== 'boolean' || typeof claimed.reused !== 'boolean') throw new Error('Studio daemon 返回了无效的 Workbench open claim。');
  if (!claimed.claimed) return { opened: false, reused: true, reason };
  try {
    await opener(workbenchBootstrapUrl(record));
    return { opened: true, reused: false, reason };
  } catch (error) {
    await api(record, 'POST', '/api/workbench/open-claim/release', { claimToken }, 'open-claim-release-' + randomUUID()).catch(() => undefined);
    throw error;
  }
}

export interface ProjectSummary { id: string; name: string; status: string; }
export interface EnterInput { conversation: string; project?: string; task?: string; round?: string; cli?: string; cliVersion?: string; skill?: string; skillVersion?: string; restartStale?: boolean; }
export type ProjectResolution = 'matched' | 'ambiguous' | 'not-found' | 'not-requested';

export interface ConversationResolution { id: string; source: string; }

/** 宿主环境里可以被信任的会话身份变量；顺序即优先级。 */
const CONVERSATION_ENVIRONMENT = ['DAOGE_CONVERSATION_ID', 'OMP_CONVERSATION_ID'];

/**
 * conversation 身份只能来自宿主：CLI 不猜、不编、也不复用别的会话 ——
 * 「哪个会话在说话」是宿主的事实，不是可以推断的东西。实测里 agent 为了拿到自己的
 * conversation ID 翻了四轮宿主目录；现在它只需要读这一条规则。
 */
export function resolveConversation(requested: string | undefined, environment: NodeJS.ProcessEnv = process.env): ConversationResolution {
  const value = String(requested || '').trim();
  if (value && value !== 'auto') return { id: value, source: 'flag' };
  for (const name of CONVERSATION_ENVIRONMENT) {
    const candidate = String(environment[name] || '').trim();
    if (candidate) return { id: candidate, source: 'env:' + name };
  }
  throw new Error('无法确定当前 conversation ID：传 --conversation <id>，或让宿主导出 ' + CONVERSATION_ENVIRONMENT.join(' / ') + ' 后再用 --conversation auto。CLI 不会替会话猜测身份。');
}

/** Narrow the daemon project list to what a connection needs: id, name, status. */
export function projectSummaries(value: unknown): ProjectSummary[] {
  const data = jsonRecord(value);
  const list = data && Array.isArray(data.projects) ? data.projects : [];
  return list.flatMap((item) => {
    const record = jsonRecord(item);
    if (!record) return [];
    const id = stringField(record, 'id');
    const name = stringField(record, 'name');
    return id && name ? [{ id, name, status: stringField(record, 'status') }] : [];
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

/**
 * One command that does what the startup protocol used to stretch across five CLI calls:
 * ensure the daemon is healthy, open or reuse the Workbench, register presence, open the
 * conversation's Studio session, resolve the project by name/id and bind it, then read the
 * pending request queue. Every step is idempotent, so re-running it on a live session is safe.
 *
 * 额外做两件实测里最贵的事：① 陈旧 daemon（跑的不是当前构建）在**没有在飞请求**时当场换进程，
 * 用户不必再等一轮 14 分钟的侦探戏；② 返回里带上构建身份与会话身份来源，让 agent 一轮就能
 * 汇报事实，而不是去翻宿主目录和进程时间戳。
 */
export async function enterStudio(record: RuntimeRecord, input: EnterInput, force = false, opener: (url: string) => Promise<void> = openWorkbenchUrl): Promise<JsonObject> {
  const conversation = resolveConversation(input.conversation);
  let active = record;
  let build = await daemonBuildStatus(active);
  let staleRestart: JsonObject | null = null;
  let staleReason: string | null = null;
  if (build.staleBuild) {
    // 「陈旧」有两种正当的不作为：用户关掉了自愈，或正在出图不能换进程。
    // 两者都要说明白 —— agent 的汇报不能只有 staleBuild: true 而没有下文。
    if (input.restartStale === false) staleReason = 'restart-stale-disabled';
    else if (build.activeRequests > 0) staleReason = 'active-requests';
    else {
      const restarted = await restartDaemon(active.workspaceRoot);
      staleRestart = { previousPid: restarted.previousPid, previousBuildId: restarted.previousBuild ? restarted.previousBuild.daemonBuildId : null };
      active = restarted.daemon;
      build = await daemonBuildStatus(active);
    }
  }
  const workbench = await openOrReuseWorkbench(active, force, opener);
  const registration = input.cli
    ? jsonRecord(await api(active, 'POST', '/api/agents/register', {
        cliName: input.cli,
        ...(input.cliVersion === undefined ? {} : { cliVersion: input.cliVersion }),
        ...(input.skill === undefined ? {} : { skills: [{ name: input.skill, ...(input.skillVersion === undefined ? {} : { version: input.skillVersion }) }] })
      }, 'enter-agent-' + randomUUID()))
    : null;
  const agent = registration ? jsonRecord(registration.agent) || registration : null;
  // /api/sessions/open dedupes by conversationId, so the random idempotency key only makes the
  // call retry-safe without freezing the session row.
  const session = jsonRecord(await api(active, 'POST', '/api/sessions/open', { conversationId: conversation.id }, 'enter-session-' + randomUUID())) || {};
  const sessionId = stringField(session, 'id');
  if (!sessionId) throw new Error('Studio 未返回有效的会话标识。');
  const projects = projectSummaries(await api(active, 'GET', '/api/projects', {}));
  const selection = resolveProjectSelection(projects, input.project || '');
  const context = selection.matched
    ? jsonRecord(await api(active, 'POST', '/api/sessions/' + encodeURIComponent(sessionId) + '/context', {
        projectId: selection.matched.id,
        ...(input.task === undefined ? {} : { taskId: input.task }),
        ...(input.round === undefined ? {} : { roundId: input.round })
      }, 'enter-context-' + randomUUID()))
    : null;
  const pending = jsonRecord(await api(active, 'GET', '/api/requests?status=pending&limit=20', {})) || {};
  const boundProjectId = context ? stringField(context, 'agentProjectId') : stringField(session, 'agentProjectId');
  const boundTaskId = context ? stringField(context, 'agentTaskId') : stringField(session, 'agentTaskId');
  const boundRoundId = context ? stringField(context, 'agentRoundId') : stringField(session, 'agentRoundId');
  const pendingList = Array.isArray(pending.requests) ? pending.requests : [];
  const agentSummary = agent ? {
    cliName: stringField(agent, 'cliName') || null,
    skillName: stringField(agent, 'skillName') || null,
    skillVersion: stringField(agent, 'skillVersion') || null
  } : null;
  return {
    workspaceRoot: active.workspaceRoot,
    daemon: compactRuntime(active),
    build,
    ...(staleRestart ? { staleRestart } : {}),
    ...(staleReason ? { staleReason } : {}),
    workbench,
    agent: agentSummary,
    conversationSource: conversation.source,
    contextBound: Boolean(context),
    session: {
      id: sessionId,
      projectId: boundProjectId || null,
      taskId: boundTaskId || null,
      roundId: boundRoundId || null
    },
    projectResolution: selection.resolution,
    project: selection.matched,
    // 只有解析不到唯一项目时才回传全量目录；命中时给一个计数就够 —— 这一项就是 ~1.7 KB。
    ...(selection.matched ? { projectCount: projects.length } : { projectCandidates: selection.candidates, projects }),
    pendingRequestCount: pendingList.length,
    pendingRequests: pendingList.slice(0, 10)
  };
}

function textValue(values: Record<string, unknown>, name: string): string { return values[name] as string; }
function jsonValue(values: Record<string, unknown>, name: string): unknown { return values[name] || {}; }
function listValue(values: Record<string, unknown>, name: string): string[] { return (values[name] as string[] | undefined) || []; }
function numberValue(values: Record<string, unknown>, name: string): number { return values[name] as number; }
function booleanValue(values: Record<string, unknown>, name: string): boolean { return values[name] === true; }
function encoded(values: Record<string, unknown>, name: string): string { return encodeURIComponent(textValue(values, name)); }
function query(values: Record<string, unknown>, entries: Array<[string, string]>): string {
  const params = entries.flatMap(([flag, name]) => {
    const value = values[flag];
    return value === undefined ? [] : [encodeURIComponent(name) + '=' + encodeURIComponent(String(value))];
  });
  return params.length ? '?' + params.join('&') : '';
}

function skillReferenceDirectory(): string { return path.resolve(__dirname, '..', '..', '..', 'references'); }
export function skillReferencePath(topic: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(topic)) throw new Error('--topic 只能是附录名（不含 .md，例如 queue）。');
  return path.join(skillReferenceDirectory(), topic + '.md');
}
/** 只取某一份附录里的一个章节：从该标题到下一个同级或更高级标题为止。 */
export function skillReferenceSection(text: string, heading: string): string {
  const lines = text.split('\n');
  const wanted = heading.trim();
  const headings = lines.flatMap((line, index) => {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    return match ? [{ index, level: match[1].length, text: match[2].trim() }] : [];
  });
  const target = headings.find((item) => item.text === wanted);
  if (!target) throw new Error('未找到章节：' + wanted + '。可用：' + [...new Set(headings.map((item) => item.text))].join('、'));
  let end = lines.length;
  for (const item of headings) {
    if (item.index > target.index && item.level <= target.level) { end = item.index; break; }
  }
  return lines.slice(target.index, end).join('\n').trimEnd() + '\n';
}

const commandSchemas: Record<string, CommandSchema> = {
  status: { summary: '查看本工作区 Studio 与后台服务状态', action: 'status', flags: {} }, studio: { summary: '输出 Studio 与工作台地址，不打开浏览器', action: 'studio', flags: {} }, open: { summary: '打开或复用唯一工作台；嵌套 Studio 必须由用户显式允许', action: 'open', flags: { '--force': { kind: 'boolean' }, '--allow-nested-studio': { kind: 'boolean' } } },
  enter: { summary: '一次完成连接：确保 daemon、打开或复用 Workbench、登记在场、建立会话、按项目名进入项目、读取请求队列', action: 'enter', flags: { '--conversation': { kind: 'text', required: true }, '--project': { kind: 'text' }, '--task': { kind: 'text' }, '--round': { kind: 'text' }, '--cli': { kind: 'text' }, '--cli-version': { kind: 'text' }, '--skill': { kind: 'text' }, '--skill-version': { kind: 'text' }, '--restart-stale': { kind: 'boolean' }, '--force': { kind: 'boolean' }, '--allow-nested-studio': { kind: 'boolean' } } },
  stop: { summary: '受控关闭本工作区 Studio，不自动重启；要再起来请用 enter 或 open', action: 'stop', flags: {} },
  reference: { summary: '按需打印 Skill 附录 references/<topic>.md（无需 --workspace）；--section 只打印某一节', action: 'reference', flags: { '--topic': { kind: 'text', required: true }, '--section': { kind: 'text' } } },
  'round-status': { summary: '一次读取当前轮次的计划摘要与 Generation History（替代两次调用）', action: 'round-status', flags: { '--round': { kind: 'text', required: true }, '--session': { kind: 'text', required: true } } },
  'project-list': { summary: '列出当前 Studio 的项目（含归档），用于把项目名解析成 projectId', method: 'GET', flags: {}, pathname: () => '/api/projects' },
  restart: { summary: '优雅重启本工作区 Studio', action: 'restart', flags: {} },
  'register-skill': { summary: '注册当前安装包；--scope user 装到 --host 指定的宿主（缺省 codex，agents = 跨宿主共享目录）且不需要 --workspace；目标已存在则拒绝', action: 'register-skill', flags: { '--scope': { kind: 'scope', required: true }, '--host': { kind: 'host' } } },
  doctor: { summary: '不调用 Provider；检查工作区、SQLite、权限、sharp 与 Windows volume', action: 'doctor', flags: { '--json': { kind: 'boolean' }, '--redacted': { kind: 'boolean' } } },
  'provider-list': { summary: '列出全部生成服务配置，不含密钥', method: 'GET', flags: {}, pathname: () => '/api/providers' },
  'backup-manifest': { summary: '输出仅含安全相对路径的当前 Studio manifest', method: 'GET', flags: {}, pathname: () => '/api/backup/manifest' },
  'backup-restore-dry-run': { summary: '仅 dry-run，不写入目标 Studio', method: 'POST', flags: { '--source-root': { kind: 'text', required: true }, '--manifest': { kind: 'json', required: true }, '--expected-studio': { kind: 'json' } }, pathname: () => '/api/backup/restore-dry-run', body: (v) => ({ sourceRoot: textValue(v, '--source-root'), manifest: v['--manifest'], ...(v['--expected-studio'] === undefined ? {} : { expectedStudio: v['--expected-studio'] }) }) },
  'backup-restore': { summary: '离线执行恢复，不会启动 daemon；失败自动回滚', action: 'backup-restore', flags: { '--source-root': { kind: 'text', required: true }, '--manifest': { kind: 'json', required: true } }, body: (v) => ({ sourceRoot: textValue(v, '--source-root'), manifest: v['--manifest'] }) },
  'backup-upgrade-assess': { summary: '当前运行时与支持范围由 daemon 自证，不接受调用方声明', method: 'POST', flags: { '--target-runtime-version': { kind: 'text', required: true }, '--target-schema-version': { kind: 'non-negative-integer', required: true }, '--target-protocol-version': { kind: 'text', required: true }, '--rollback-point': { kind: 'json' } }, pathname: () => '/api/backup/upgrade-assess', body: (v) => ({ targetRuntimeVersion: textValue(v, '--target-runtime-version'), targetSchemaVersion: numberValue(v, '--target-schema-version'), targetProtocolVersion: textValue(v, '--target-protocol-version'), ...(v['--rollback-point'] === undefined ? {} : { rollbackPoint: v['--rollback-point'] }) }) },
  'backup-rollback-point': { summary: '生成一个可回滚的版本锚点', method: 'POST', flags: { '--manifest': { kind: 'json', required: true }, '--runtime-version': { kind: 'text', required: true }, '--schema-version': { kind: 'non-negative-integer', required: true }, '--created-at': { kind: 'text' } }, pathname: () => '/api/backup/rollback-point', body: (v) => ({ manifest: v['--manifest'], runtimeVersion: textValue(v, '--runtime-version'), schemaVersion: numberValue(v, '--schema-version'), ...(v['--created-at'] === undefined ? {} : { createdAt: textValue(v, '--created-at') }) }) },
  'usage-list': { summary: '列出用量明细', method: 'GET', flags: { '--profile': { kind: 'text' }, '--project': { kind: 'text' }, '--task': { kind: 'text' }, '--round': { kind: 'text' }, '--run': { kind: 'text' }, '--item': { kind: 'text' }, '--limit': { kind: 'usage-limit' } }, pathname: (v) => '/api/usage' + query(v, [['--profile', 'profileId'], ['--project', 'projectId'], ['--task', 'taskId'], ['--round', 'roundId'], ['--run', 'runId'], ['--item', 'runItemId'], ['--limit', 'limit']]) },
  'usage-summary': { summary: '汇总用量', method: 'GET', flags: { '--profile': { kind: 'text' }, '--project': { kind: 'text' }, '--task': { kind: 'text' }, '--round': { kind: 'text' }, '--run': { kind: 'text' }, '--item': { kind: 'text' } }, pathname: (v) => '/api/usage/summary' + query(v, [['--profile', 'profileId'], ['--project', 'projectId'], ['--task', 'taskId'], ['--round', 'roundId'], ['--run', 'runId'], ['--item', 'runItemId']]) },
  'budget-get': { summary: '读取预算', method: 'GET', flags: { '--profile': { kind: 'text' } }, pathname: (v) => '/api/budget' + query(v, [['--profile', 'profileId']]) },
  'budget-set': { summary: '设置预算上限', method: 'POST', flags: { '--profile': { kind: 'text' }, '--limit': { kind: 'non-negative-integer', required: true }, '--cost-unit': { kind: 'text', required: true } }, pathname: () => '/api/budget', body: (v) => ({ ...(v['--profile'] === undefined ? {} : { profileId: v['--profile'] }), limitCostMinor: numberValue(v, '--limit'), costUnit: textValue(v, '--cost-unit') }) },
  'template-list': { summary: '列出已确认模板', method: 'GET', flags: { '--type': { kind: 'text' }, '--template': { kind: 'text' }, '--include-archived': { kind: 'boolean' } }, pathname: (v) => '/api/confirmed-templates' + query(v, [['--type', 'templateType'], ['--template', 'templateId'], ['--include-archived', 'includeArchived']]) },
  'template-get': { summary: '读取指定模板，可指定版本', method: 'GET', flags: { '--template': { kind: 'text', required: true }, '--version': { kind: 'positive-integer' } }, pathname: (v) => '/api/confirmed-templates/' + encoded(v, '--template') + query(v, [['--version', 'version']]) },
  'template-save': { summary: '保存模板', method: 'POST', flags: { '--type': { kind: 'text', required: true }, '--name': { kind: 'text', required: true }, '--definition': { kind: 'json', required: true }, '--round': { kind: 'text', required: true }, '--template': { kind: 'text' }, '--provenance': { kind: 'json' }, '--plan-version': { kind: 'positive-integer' } }, pathname: () => '/api/confirmed-templates', body: (v) => ({ templateType: textValue(v, '--type'), name: textValue(v, '--name'), definition: v['--definition'], roundId: textValue(v, '--round'), ...(v['--template'] === undefined ? {} : { templateId: v['--template'] }), ...(v['--provenance'] === undefined ? {} : { provenance: v['--provenance'] }), ...(v['--plan-version'] === undefined ? {} : { planVersion: v['--plan-version'] }) }) },
  'template-archive': { summary: '归档模板', method: 'POST', flags: { '--template': { kind: 'text', required: true } }, pathname: (v) => '/api/confirmed-templates/' + encoded(v, '--template') + '/archive', body: () => ({}) },
  'template-rollback': { summary: '回滚模板到指定版本', method: 'POST', flags: { '--template': { kind: 'text', required: true }, '--version': { kind: 'positive-integer', required: true } }, pathname: (v) => '/api/confirmed-templates/' + encoded(v, '--template') + '/rollback', body: (v) => ({ version: numberValue(v, '--version') }) },
  'provider-import-env': { summary: '显式导入工作区 daoge-studio/provider.env', method: 'POST', flags: {}, pathname: () => '/api/providers/import-env', body: () => ({}) },
  'provider-create': { summary: '新建生成服务配置；密钥只从 stdin 读取', method: 'POST', flags: { '--name': { kind: 'text', required: true }, '--provider': { kind: 'text', required: true }, '--model': { kind: 'text', required: true }, '--base-url': { kind: 'text', required: true }, '--api-key-stdin': { kind: 'secret-stdin', required: true }, '--endpoint-trust-mode': { kind: 'text' }, '--options': { kind: 'json' }, '--limits': { kind: 'json' }, '--active': { kind: 'boolean' } }, pathname: () => '/api/providers', body: (v) => ({ name: v['--name'], providerId: v['--provider'], model: v['--model'], baseUrl: v['--base-url'], apiKey: v['--api-key-stdin'], endpointTrustMode: v['--endpoint-trust-mode'], options: v['--options'], limits: v['--limits'], active: v['--active'] === true }) },
  'provider-update': { summary: '更新生成服务配置；replace 时密钥只从 stdin 读取', method: 'PUT', flags: { '--profile': { kind: 'text', required: true }, '--version': { kind: 'positive-integer', required: true }, '--name': { kind: 'text' }, '--provider': { kind: 'text' }, '--model': { kind: 'text' }, '--base-url-action': { kind: 'text', required: true }, '--base-url': { kind: 'text' }, '--api-key-action': { kind: 'text', required: true }, '--api-key-stdin': { kind: 'secret-stdin' }, '--endpoint-trust-mode': { kind: 'text' }, '--options': { kind: 'json' }, '--limits': { kind: 'json' } }, pathname: (v) => '/api/providers/' + encoded(v, '--profile'), body: (v) => ({ expectedConfigVersion: v['--version'], name: v['--name'], providerId: v['--provider'], model: v['--model'], baseUrl: { action: v['--base-url-action'], ...(v['--base-url'] ? { value: v['--base-url'] } : {}) }, apiKey: { action: v['--api-key-action'], ...(v['--api-key-stdin'] ? { value: v['--api-key-stdin'] } : {}) }, endpointTrustMode: v['--endpoint-trust-mode'], options: v['--options'], limits: v['--limits'] }) },
  'provider-copy': { summary: '复制一份配置，副本默认不启用', method: 'POST', flags: { '--profile': { kind: 'text', required: true }, '--name': { kind: 'text' } }, pathname: (v) => '/api/providers/' + encoded(v, '--profile') + '/copy', body: (v) => ({ name: v['--name'] }) },
  'provider-activate': { summary: '把这一组设为当前使用', method: 'POST', flags: { '--profile': { kind: 'text', required: true } }, pathname: (v) => '/api/providers/' + encoded(v, '--profile') + '/activate', body: () => ({}) },
  'provider-delete': { summary: '删除这一组配置；正在使用时要加 --force', method: 'POST', flags: { '--profile': { kind: 'text', required: true }, '--force': { kind: 'boolean' } }, pathname: (v) => '/api/providers/' + encoded(v, '--profile') + '/delete', body: (v) => ({ force: v['--force'] === true }) },
  'provider-validate': { summary: '只检查填得全不全，不联网', method: 'POST', flags: { '--profile': { kind: 'text', required: true } }, pathname: (v) => '/api/providers/' + encoded(v, '--profile') + '/validate', body: () => ({}) },
  'provider-test': { summary: '真的访问生成服务测连通，但不出图', method: 'POST', flags: { '--profile': { kind: 'text', required: true } }, pathname: (v) => '/api/providers/' + encoded(v, '--profile') + '/test', body: () => ({}) },
  'provider-secret-backend': { summary: '把 Provider 凭据后端写入工作区配置，之后官方入口启动的 daemon 会自动带上；需要 restart 生效', action: 'provider-secret-backend', flags: { '--backend': { kind: 'secret-backend', required: true } } },
  'provider-models': { summary: '读取服务可用的模型列表', method: 'POST', flags: { '--profile': { kind: 'text', required: true } }, pathname: (v) => '/api/providers/' + encoded(v, '--profile') + '/models', body: () => ({}) },
  session: { summary: '按 conversation 建立或恢复会话', method: 'POST', flags: { '--conversation': { kind: 'text', required: true } }, pathname: () => '/api/sessions/open', body: (v) => ({ conversationId: textValue(v, '--conversation') }) },
  'session-context': { summary: '绑定会话的项目、任务与轮次', method: 'POST', flags: { '--session': { kind: 'text', required: true }, '--project': { kind: 'text' }, '--task': { kind: 'text' }, '--round': { kind: 'text' } }, pathname: (v) => '/api/sessions/' + encoded(v, '--session') + '/context', body: (v) => ({ projectId: v['--project'], taskId: v['--task'], roundId: v['--round'] }) },
  'archive-project': { summary: '归档项目', method: 'POST', flags: { '--project': { kind: 'text', required: true } }, pathname: (v) => '/api/projects/' + encoded(v, '--project') + '/archive', body: () => ({}) },
  project: { summary: '新建项目', method: 'POST', flags: { '--name': { kind: 'text', required: true }, '--description': { kind: 'text' }, '--session': { kind: 'text' } }, pathname: () => '/api/projects', body: (v) => ({ name: textValue(v, '--name'), description: v['--description'], sessionId: v['--session'] }) },
  task: { summary: '在项目下新建任务', method: 'POST', flags: { '--project': { kind: 'text', required: true }, '--name': { kind: 'text', required: true }, '--task-type': { kind: 'text' }, '--intent': { kind: 'json' }, '--session': { kind: 'text' } }, pathname: () => '/api/tasks', body: (v) => ({ projectId: textValue(v, '--project'), name: textValue(v, '--name'), taskTypeId: v['--task-type'], intent: jsonValue(v, '--intent'), sessionId: v['--session'] }) },
  'task-type': { summary: '新建任务类型', method: 'POST', flags: { '--name': { kind: 'text', required: true }, '--definition': { kind: 'json' } }, pathname: () => '/api/task-types', body: (v) => ({ name: textValue(v, '--name'), definition: jsonValue(v, '--definition') }) },
  'style-kit': { summary: '新建风格包', method: 'POST', flags: { '--name': { kind: 'text', required: true }, '--definition': { kind: 'json' }, '--assets': { kind: 'list' } }, pathname: () => '/api/style-kits', body: (v) => ({ name: textValue(v, '--name'), definition: jsonValue(v, '--definition'), assetIds: listValue(v, '--assets') }) },
  'brand-kit': { summary: '新建品牌包', method: 'POST', flags: { '--name': { kind: 'text', required: true }, '--definition': { kind: 'json' }, '--assets': { kind: 'list' } }, pathname: () => '/api/brand-kits', body: (v) => ({ name: textValue(v, '--name'), definition: jsonValue(v, '--definition'), assetIds: listValue(v, '--assets') }) },
  delivery: { summary: '创建交付草稿', method: 'POST', flags: { '--project': { kind: 'text', required: true }, '--name': { kind: 'text', required: true }, '--assets': { kind: 'list', required: true }, '--creative-record': { kind: 'boolean' } }, pathname: () => '/api/deliveries', body: (v) => ({ projectId: textValue(v, '--project'), name: textValue(v, '--name'), assetIds: listValue(v, '--assets'), includeCreativeRecord: booleanValue(v, '--creative-record') }) },
  'delivery-update': { summary: '更新交付草稿的图片', method: 'PUT', flags: { '--delivery': { kind: 'text', required: true }, '--assets': { kind: 'list', required: true }, '--creative-record': { kind: 'boolean' } }, pathname: (v) => '/api/deliveries/' + encoded(v, '--delivery') + '/items', body: (v) => ({ assetIds: listValue(v, '--assets'), includeCreativeRecord: booleanValue(v, '--creative-record') }) },
  'delivery-ready': { summary: '把交付置为已准备', method: 'POST', flags: { '--delivery': { kind: 'text', required: true } }, pathname: (v) => '/api/deliveries/' + encoded(v, '--delivery') + '/ready', body: () => ({}) },
  'delivery-draft': { summary: '把交付退回草稿', method: 'POST', flags: { '--delivery': { kind: 'text', required: true } }, pathname: (v) => '/api/deliveries/' + encoded(v, '--delivery') + '/draft', body: () => ({}) },
  'delivery-export': { summary: '导出已准备的交付', method: 'POST', flags: { '--delivery': { kind: 'text', required: true } }, pathname: (v) => '/api/deliveries/' + encoded(v, '--delivery') + '/export', body: () => ({}) },
  'delivery-batch': { summary: '新建交付批次', method: 'POST', flags: { '--project': { kind: 'text', required: true }, '--name': { kind: 'text', required: true }, '--deliveries': { kind: 'list', required: true } }, pathname: () => '/api/delivery-batches', body: (v) => ({ projectId: textValue(v, '--project'), name: textValue(v, '--name'), deliveryIds: listValue(v, '--deliveries') }) },
  'delivery-batch-revise': { summary: '修订交付批次', method: 'POST', flags: { '--batch': { kind: 'text', required: true }, '--deliveries': { kind: 'list', required: true } }, pathname: (v) => '/api/delivery-batches/' + encoded(v, '--batch') + '/revisions', body: (v) => ({ deliveryIds: listValue(v, '--deliveries') }) },
  'delivery-batch-ready': { summary: '冻结批次版本', method: 'POST', flags: { '--version': { kind: 'text', required: true } }, pathname: (v) => '/api/delivery-batch-versions/' + encoded(v, '--version') + '/ready', body: () => ({}) },
  round: { summary: '在任务下新建轮次', method: 'POST', flags: { '--task': { kind: 'text', required: true }, '--purpose': { kind: 'purpose', required: true }, '--parent': { kind: 'text' }, '--session': { kind: 'text' } }, pathname: () => '/api/rounds', body: (v) => ({ taskId: textValue(v, '--task'), purpose: textValue(v, '--purpose'), parentRoundId: v['--parent'], sessionId: v['--session'] }) },
  plan: { summary: '写入计划；@- 从 stdin 读取 JSON；--challenge true 同时创建确认挑战', method: 'POST', flags: { '--round': { kind: 'text', required: true }, '--version': { kind: 'positive-integer', required: true }, '--plan': { kind: 'json', required: true }, '--session': { kind: 'text' }, '--challenge': { kind: 'boolean' } }, pathname: (v) => '/api/rounds/' + encoded(v, '--round') + '/plan', body: (v) => ({ expectedVersion: numberValue(v, '--version'), plan: jsonValue(v, '--plan') }) },
  'confirm-challenge': { summary: '只创建 Workbench 人工确认挑战', method: 'POST', flags: { '--round': { kind: 'text', required: true }, '--session': { kind: 'text', required: true } }, pathname: (v) => '/api/rounds/' + encoded(v, '--round') + '/confirmation-challenge', body: (v) => ({ sessionId: textValue(v, '--session') }) },
  preflight: { summary: '开工前核算；只接受已人工确认会话', method: 'POST', flags: { '--round': { kind: 'text', required: true }, '--session': { kind: 'text', required: true }, '--concurrency': { kind: 'execution-concurrency' }, '--usage-estimate': { kind: 'json' } }, pathname: (v) => '/api/rounds/' + encoded(v, '--round') + '/preflight', body: (v) => ({ sessionId: textValue(v, '--session'), executionConcurrency: v['--concurrency'], ...(v['--usage-estimate'] === undefined ? {} : { usageEstimate: v['--usage-estimate'] }) }) },
  run: { summary: '按预检结果开始出图', method: 'POST', flags: { '--round': { kind: 'text', required: true }, '--preflight': { kind: 'text', required: true }, '--confirm-token': { kind: 'text', required: true } }, pathname: () => '/api/runs', body: (v) => ({ roundId: textValue(v, '--round'), preflightId: textValue(v, '--preflight'), confirmToken: textValue(v, '--confirm-token') }) },
  pause: { summary: '暂停运行', method: 'POST', flags: { '--run': { kind: 'text', required: true } }, pathname: (v) => '/api/runs/' + encoded(v, '--run') + '/pause', body: () => ({}) },
  resume: { summary: '恢复运行', method: 'POST', flags: { '--run': { kind: 'text', required: true }, '--session': { kind: 'text', required: true } }, pathname: (v) => '/api/runs/' + encoded(v, '--run') + '/resume', body: (v) => ({ sessionId: textValue(v, '--session') }) },
  cancel: { summary: '取消运行', method: 'POST', flags: { '--run': { kind: 'text', required: true } }, pathname: (v) => '/api/runs/' + encoded(v, '--run') + '/cancel', body: () => ({}) },
  retry: { summary: '重试；超时属于重试参数，改它不需要重新确认计划', method: 'POST', flags: { '--run': { kind: 'text', required: true }, '--items': { kind: 'list' }, '--timeout-ms': { kind: 'non-negative-integer' } }, pathname: (v) => '/api/runs/' + encoded(v, '--run') + '/retry', body: (v) => ({ itemIds: v['--items'], ...(v['--timeout-ms'] === undefined ? {} : { timeoutMs: numberValue(v, '--timeout-ms') }) }) },
  'resolve-unknown': { summary: '判定结果不明的单张出图', method: 'POST', flags: { '--run': { kind: 'text', required: true }, '--items': { kind: 'list', required: true } }, pathname: (v) => '/api/runs/' + encoded(v, '--run') + '/outcomes/resolve', body: (v) => ({ itemIds: listValue(v, '--items') }) },
  'reconcile-external': { summary: '显式外部请求恢复；只查询 Provider，不生成、编辑或自动重放', method: 'POST', flags: { '--run': { kind: 'text', required: true }, '--item': { kind: 'text', required: true } }, pathname: (v) => '/api/runs/' + encoded(v, '--run') + '/items/' + encoded(v, '--item') + '/reconcile', body: () => ({}) },
  'request-list': { summary: '列出请求队列；--status 过滤 pending/accepted/done/rejected/failed', method: 'GET', flags: { '--status': { kind: 'text' }, '--limit': { kind: 'usage-limit' } }, pathname: (v) => '/api/requests' + query(v, [['--status', 'status'], ['--limit', 'limit']]) },
  'agent-register': { summary: '登记/续报在场；--skill 申报技能名（如 daoge-pic），Studio 只展示不管理', method: 'POST', flags: { '--cli': { kind: 'text', required: true }, '--cli-version': { kind: 'text' }, '--skill': { kind: 'text' }, '--skill-version': { kind: 'text' } }, pathname: () => '/api/agents/register', body: (v) => ({ cliName: textValue(v, '--cli'), ...(v['--cli-version'] === undefined ? {} : { cliVersion: textValue(v, '--cli-version') }), ...(v['--skill'] === undefined ? {} : { skills: [{ name: textValue(v, '--skill'), ...(v['--skill-version'] === undefined ? {} : { version: textValue(v, '--skill-version') }) }] }) }) },
  'agent-list': { summary: '查看当前有没有 agent 在场、最后活动时间、申报了什么技能', method: 'GET', flags: {}, pathname: () => '/api/agents' },
  'request-detail': { summary: '读一条请求；会带出上一条的原话（追问/续说用）', method: 'GET', flags: { '--request': { kind: 'text', required: true } }, pathname: (v) => '/api/requests/' + encoded(v, '--request') },
  'request-accept': { summary: '领取一条请求；租约到期未处理会自动回队', method: 'POST', flags: { '--request': { kind: 'text', required: true }, '--agent': { kind: 'text' } }, pathname: (v) => '/api/requests/' + encoded(v, '--request') + '/accept', body: (v) => ({ ...(v['--agent'] === undefined ? {} : { agentId: textValue(v, '--agent') }) }) },
  'request-renew': { summary: '续租（心跳）；跨人工确认的长活要定期调用，否则租约到期会被判「被领过但没完成」', method: 'POST', flags: { '--request': { kind: 'text', required: true }, '--agent': { kind: 'text' } }, pathname: (v) => '/api/requests/' + encoded(v, '--request') + '/renew', body: (v) => ({ ...(v['--agent'] === undefined ? {} : { agentId: textValue(v, '--agent') }) }) },
  'request-done': { summary: '结单；--reply 带回回应，--needs-input 带回追问，--round 关联产出的批次', method: 'POST', flags: { '--request': { kind: 'text', required: true }, '--round': { kind: 'text' }, '--reply': { kind: 'text' }, '--needs-input': { kind: 'text' }, '--result': { kind: 'json' } }, pathname: (v) => '/api/requests/' + encoded(v, '--request') + '/done', body: (v) => ({ ...(v['--round'] === undefined ? {} : { resultRoundId: textValue(v, '--round') }), ...(v['--reply'] === undefined ? {} : { reply: textValue(v, '--reply') }), ...(v['--needs-input'] === undefined ? {} : { needsInput: textValue(v, '--needs-input') }), ...(v['--result'] === undefined ? {} : { result: v['--result'] }) }) },
  'request-reject': { summary: '拒单；--reason 用人话说清为什么做不了', method: 'POST', flags: { '--request': { kind: 'text', required: true }, '--reason': { kind: 'text' } }, pathname: (v) => '/api/requests/' + encoded(v, '--request') + '/reject', body: (v) => ({ ...(v['--reason'] === undefined ? {} : { reason: textValue(v, '--reason') }) }) },
};

function validateFlag(name: string, raw: string, kind: FlagKind): unknown {
  const value = raw.trim();
  if (!value) throw new Error('需要 ' + name + '。');
  if (kind === 'text') return value;
  if (kind === 'json') {
    if (value === '@-') return STDIN_JSON_MARKER;
    let parsed: unknown;
    try { parsed = JSON.parse(raw) as unknown; } catch { throw new Error(name + ' 必须是有效 JSON 对象，或使用 @- 从 stdin 读取。'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(name + ' 必须是 JSON 对象。');
    return parsed;
  }
  if (kind === 'secret-stdin') {
    if (value !== '@-') throw new Error(name + ' 只能使用 @-，密钥必须通过 stdin 提供。');
    return STDIN_SECRET_MARKER;
  }
  if (kind === 'list') { const values = [...new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))]; if (!values.length) throw new Error(name + ' 必须包含至少一个 ID。'); return values; }
  if (kind === 'boolean') { if (value !== 'true' && value !== 'false') throw new Error(name + ' 只能是 true 或 false。'); return value === 'true'; }
  if (kind === 'purpose') { if (!['exploration', 'refinement', 'variation', 'edit', 'fill'].includes(value)) throw new Error(name + ' 不是支持的创作目的。'); return value; }
  if (kind === 'execution-concurrency') return strictExecutionConcurrency(value);
  if (kind === 'scope') { if (value !== 'project' && value !== 'user') throw new Error(name + ' 只能是 project 或 user。'); return value; }
  if (kind === 'host') {
    if (!skillHostDirectory(value)) throw new Error(name + ' 不是认得的宿主：' + value + '（可用：' + skillHostChoices().join('、') + '）');
    return value;
  }
  if (kind === 'secret-backend') { if (!SECRET_BACKEND_CHOICES.includes(value as SecretBackendChoice)) throw new Error(name + ' 只能是 plaintext 或 system。'); return value as SecretBackendChoice; }
  const integer = Number(value);
  if (!Number.isSafeInteger(integer) || (kind === 'non-negative-integer' ? integer < 0 : integer < 1) || (kind === 'usage-limit' && integer > 10000)) throw new Error(name + ' 必须是' + (kind === 'non-negative-integer' ? '非负安全整数' : kind === 'usage-limit' ? '1 到 10000 的安全整数' : '正整数') + '。');
  return integer;
}

function explicitIdempotencyKey(raw: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(raw)) throw new Error('--idempotency-key 必须为 1 到 128 个安全字符（字母、数字、点、下划线、冒号或连字符）。');
  return raw;
}

function explicitOperationName(raw: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(raw)) throw new Error('--operation-name 必须为 1 到 128 个安全字符（字母、数字、点、下划线、冒号或连字符）。');
  return raw;
}

export function materializeStdinJson(body: JsonObject): JsonObject {
  let markerCount = 0;
  const count = (value: unknown): void => {
    if (value === STDIN_JSON_MARKER || value === STDIN_SECRET_MARKER) { markerCount += 1; return; }
    if (Array.isArray(value)) { for (const item of value) count(item); return; }
    if (value && typeof value === 'object') for (const item of Object.values(value as JsonObject)) count(item);
  };
  count(body);
  if (markerCount > 1) throw new Error('每次命令最多只能使用一个 @- stdin JSON 标记。');
  let stdinRaw: string | null = null;
  const loadRaw = (): string => {
    if (stdinRaw !== null) return stdinRaw;
    const raw = fs.readFileSync(0, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > MAX_STDIN_JSON_BYTES) throw new Error('stdin 内容不能超过 8 MiB。');
    stdinRaw = raw;
    return raw;
  };
  let stdinValue: JsonObject | null = null;
  const load = (): JsonObject => {
    if (stdinValue) return stdinValue;
    const raw = loadRaw();
    let parsed: unknown;
    try { parsed = JSON.parse(raw) as unknown; } catch { throw new Error('stdin 必须是有效 JSON 对象。'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('stdin 必须是 JSON 对象。');
    stdinValue = parsed as JsonObject;
    return stdinValue;
  };
  const loadSecret = (): string => {
    const secret = loadRaw().trim();
    if (!secret) throw new Error('stdin 密钥不能为空。');
    return secret;
  };
  const replace = (value: unknown): unknown => {
    if (value === STDIN_JSON_MARKER) return load();
    if (value === STDIN_SECRET_MARKER) return loadSecret();
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as JsonObject).map(([key, item]) => [key, replace(item)]));
    return value;
  };
  return replace(body) as JsonObject;
}

function parseCommand(args: string[]): ParsedCommand {
  const name = args[0] || '';
  // `daoge reference queue` 与 `daoge reference --topic queue` 等价：附录名更常作为位置参数出现。
  if (name === 'reference' && args[1] && !args[1].startsWith('--')) args = ['reference', '--topic', args[1], ...args.slice(2)];
  const schema = commandSchemas[name];
  if (!schema) throw new Error('未知 vNext 命令。\n' + usage());
  const mutation = Boolean(schema.method && schema.method !== 'GET');
  const allowed = new Set(['--workspace', ...Object.keys(schema.flags), ...(mutation ? ['--idempotency-key', '--operation-name'] : [])]);
  const rawValues: Record<string, string> = {};
  for (let index = 1; index < args.length; index += 2) {
    const flagName = args[index];
    if (!flagName.startsWith('--') || !allowed.has(flagName)) throw new Error('未知或不适用于 ' + name + ' 的参数：' + flagName + '。\n该命令支持的参数：\n' + commandHelp(name));
    if (Object.prototype.hasOwnProperty.call(rawValues, flagName)) throw new Error('参数不能重复：' + flagName + '。');
    const raw = args[index + 1];
    if (raw === undefined || raw.startsWith('--')) throw new Error('需要 ' + flagName + '。');
    rawValues[flagName] = raw;
  }
  if (rawValues['--idempotency-key'] && rawValues['--operation-name']) throw new Error('--idempotency-key 与 --operation-name 不能同时使用。');
  const values: Record<string, unknown> = {};
  for (const [flagName, flagSchema] of Object.entries(schema.flags)) {
    const raw = rawValues[flagName];
    if (raw === undefined) { if (flagSchema.required) throw new Error('需要 ' + flagName + '。'); continue; }
    values[flagName] = validateFlag(flagName, raw, flagSchema.kind);
  }
  if (name === 'provider-update') {
    const action = values['--api-key-action'];
    const hasSecret = values['--api-key-stdin'] !== undefined;
    if (action === 'replace' && !hasSecret) throw new Error('替换 API Key 必须使用 --api-key-stdin @-。');
    if (action !== 'replace' && hasSecret) throw new Error('--api-key-stdin 只能与 --api-key-action replace 一起使用。');
  }
  const withoutWorkspace = name === 'reference' || (name === 'register-skill' && values['--scope'] === 'user' && rawValues['--workspace'] === undefined);
  const root = withoutWorkspace ? undefined : workspaceRootForCommand(name, rawValues['--workspace'] as string | undefined);
  const markerCount = Object.values(values).filter((value) => value === STDIN_JSON_MARKER).length;
  if (markerCount > 1) throw new Error('每次命令最多只能使用一个 @- stdin JSON 标记。');
  if (schema.action) return { name, workspaceRoot: root, action: schema.action, ...(schema.action === 'open' || schema.action === 'enter' ? { force: values['--force'] === true, allowNestedStudio: values['--allow-nested-studio'] === true } : {}), ...(schema.action === 'enter' ? { enter: { conversation: textValue(values, '--conversation'), ...(values['--project'] === undefined ? {} : { project: textValue(values, '--project') }), ...(values['--task'] === undefined ? {} : { task: textValue(values, '--task') }), ...(values['--round'] === undefined ? {} : { round: textValue(values, '--round') }), ...(values['--cli'] === undefined ? {} : { cli: textValue(values, '--cli') }), ...(values['--cli-version'] === undefined ? {} : { cliVersion: textValue(values, '--cli-version') }), ...(values['--skill'] === undefined ? {} : { skill: textValue(values, '--skill') }), ...(values['--skill-version'] === undefined ? {} : { skillVersion: textValue(values, '--skill-version') }), ...(values['--restart-stale'] === undefined ? {} : { restartStale: values['--restart-stale'] === true }) } } : {}), ...(schema.action === 'register-skill' ? { scope: values['--scope'] as SkillRegistrationScope, host: values['--host'] === undefined ? undefined : textValue(values, '--host') } : {}), ...(schema.action === 'doctor' ? { jsonOutput: values['--json'] === true, redactedOutput: values['--redacted'] === true } : {}), ...(schema.action === 'backup-restore' ? { restoreInput: (schema.body as (input: Record<string, unknown>) => JsonObject)(values) } : {}), ...(schema.action === 'provider-secret-backend' ? { secretBackend: values['--backend'] as SecretBackendChoice } : {}), ...(schema.action === 'reference' ? { referenceTopic: textValue(values, '--topic'), ...(values['--section'] === undefined ? {} : { referenceSection: textValue(values, '--section') }) } : {}), ...(schema.action === 'round-status' ? { roundStatus: { roundId: textValue(values, '--round'), sessionId: textValue(values, '--session') } } : {}) };
  const method = schema.method as HttpMethod;
  const operationName = method === 'GET' || rawValues['--idempotency-key'] ? undefined : rawValues['--operation-name'] ? explicitOperationName(rawValues['--operation-name']) : undefined;
  const idempotencyKey = method === 'GET' || operationName ? undefined : rawValues['--idempotency-key'] === undefined ? 'skill-' + randomUUID() : explicitIdempotencyKey(rawValues['--idempotency-key']);
  return { name, workspaceRoot: root, request: { method, pathname: (schema.pathname as (input: Record<string, unknown>) => string)(values), body: schema.body ? schema.body(values) : {}, idempotencyKey, operationName }, ...(name === 'plan' && values['--challenge'] === true ? { planChallenge: { roundId: textValue(values, '--round'), sessionId: values['--session'] === undefined ? '' : textValue(values, '--session') } } : {}) };
}

function commandLine(name: string, schema: CommandSchema): string {
  const flags = Object.entries(schema.flags)
    .map(([flag, flagSchema]) => (flagSchema.required ? ` ${flag} ${FLAG_HINTS[flagSchema.kind]}` : ` [${flag} ${FLAG_HINTS[flagSchema.kind]}]`))
    .join('');
  const note = schema.summary ? '  # ' + schema.summary : '';
  return `daoge ${name} --workspace <path>${flags}${note}`;
}

/** 速览行：agent 用来发现命令，不背负 69 条全签名。 */
function commandLineBrief(name: string, schema: CommandSchema): string {
  return `daoge ${name}  # ${schema.summary || ''}`.trimEnd();
}

function commandHelp(name: string): string {
  const schema = commandSchemas[name];
  const lines = ['daoge ' + name];
  if (schema.summary) lines.push('  ' + schema.summary);
  lines.push('');
  lines.push('参数：');
  lines.push(`  --workspace <path>  ${name === 'reference' ? '不需要（附录不依赖工作区）' : name === 'register-skill' ? 'project 范围必填；user 范围不需要' : '必填；在已初始化的 Studio 目录内运行时可省略'}`);
  for (const [flag, flagSchema] of Object.entries(schema.flags)) {
    lines.push(`  ${flag} ${FLAG_HINTS[flagSchema.kind]}  ${flagSchema.required ? '必填' : '可选'}`);
  }
  if (name === 'register-skill') lines.push(`  --host 可用：${skillHostChoices().join('、')}（agents = 跨宿主共享目录，多数宿主都能读到）`);
  if (schema.method && schema.method !== 'GET') {
    lines.push('  --idempotency-key <key>  可选，与 --operation-name 互斥');
    lines.push('  --operation-name <verb:scope>  可选，由 daemon 派生稳定 key');
  }
  if (!Object.keys(schema.flags).length && !(schema.method && schema.method !== 'GET')) lines.push('  （该命令没有其他参数）');
  return lines.join('\n');
}

function usage(): string {
  // 由 commandSchemas 生成，不再手写第二份。
  // 之前手写的那一份漏掉了 provider-copy/activate/delete/validate/test/models 六个命令 ——
  // 双份维护必然漂移，所以这里只保留一个来源。
  const lines = [
    'DAOGE Pic vNext Studio',
    '',
    '用法：daoge <命令> --workspace <项目根> [参数]',
    '查看某个命令的参数：daoge <命令> --help',
    ''
  ];
  for (const name of Object.keys(commandSchemas)) lines.push(commandLineBrief(name, commandSchemas[name]));
  lines.push('');
  lines.push('完整签名：daoge --help --full 或 daoge <命令> --help。');
  return lines.join('\n');
}

/** 全签名清单：只在明确要看签名时输出。 */
function usageFull(): string {
  const lines = [
    'DAOGE Pic vNext Studio',
    '',
    '用法：daoge <命令> --workspace <项目根> [参数]',
    '查看某个命令的参数：daoge <命令> --help',
    ''
  ];
  for (const name of Object.keys(commandSchemas)) lines.push(commandLine(name, commandSchemas[name]));
  lines.push('');
  lines.push('POST/PUT 可使用 --operation-name <verb:scope> 由 daemon 派生稳定 key；高级恢复仍可使用 --idempotency-key <key>，两者互斥。');
  return lines.join('\n');
}

export async function main(): Promise<void> {
  assertSupportedNodeRuntime();
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  if (command === 'help' || command === '--help' || command === '-h') { process.stdout.write((args.includes('--full') ? usageFull() : usage()) + '\n'); return; }
  if (args.includes('--help') || args.includes('-h')) {
    if (!commandSchemas[command]) { process.stderr.write('未知 vNext 命令：' + command + '。\n'); process.exitCode = 1; return; }
    process.stdout.write(commandHelp(command) + '\n'); return;
  }
  const parsed = parseCommand(args);
  if (parsed.action === 'register-skill') {
    process.stdout.write(JSON.stringify(registerSkill({ scope: parsed.scope as SkillRegistrationScope, workspaceRoot: parsed.workspaceRoot, host: parsed.host as string | undefined }), null, 2) + '\n');
    return;
  }
  if (parsed.action === 'reference') {
    const topic = String(parsed.referenceTopic || '');
    const file = skillReferencePath(topic);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      const directory = skillReferenceDirectory();
      const available = fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => name.endsWith('.md')).map((name) => name.slice(0, -3)).sort() : [];
      throw new Error('未知附录：' + topic + '。可用：' + available.join('、'));
    }
    const body = fs.readFileSync(file, 'utf8');
    process.stdout.write(parsed.referenceSection ? skillReferenceSection(body, parsed.referenceSection) : body);
    return;
  }
  const root = parsed.workspaceRoot as string;
  if (parsed.action === 'doctor') {
    const original = doctorWorkspace(root);
    const report = parsed.redactedOutput ? redactDoctorReport(original) : original;
    process.stdout.write((parsed.jsonOutput ? JSON.stringify(report, null, 2) : formatDoctorReport(report)) + '\n');
    if (!original.ok) process.exitCode = 1;
    return;
  }
  const manifest = readStudioManifest(studioPaths(root));
  if (manifest && !sameWorkspaceRoot(manifest.workspaceRoot, root)) throw new Error('当前 Studio manifest workspaceRoot 与请求工作区不匹配。');
  if (parsed.action === 'backup-restore') {
    if (!manifest) throw new Error('目标工作区不是已初始化的 DAOGE Pic Studio。');
    const input = materializeStdinJson(parsed.restoreInput as JsonObject);
    const exitCode = await runOfflineRestoreHelper(
      root,
      String(input.sourceRoot || ''),
      input.manifest,
      { studioId: manifest.studioId, protocolName: SKILL_PROTOCOL_NAME, protocolVersion: SKILL_PROTOCOL_VERSION, runtimeVersion: RUNTIME_VERSION }
    );
    if (exitCode !== 0) process.exitCode = exitCode;
    return;
  }
  if (parsed.action === 'status') {
    const record = readRuntime(root);
    const isHealthy = Boolean(record && await healthy(record.url));
    process.stdout.write(JSON.stringify({ workspaceRoot: root, daemon: compactRuntime(record), healthy: isHealthy, build: await daemonBuildStatus(isHealthy ? record : null) }) + '\n');
    return;
  }
  if (parsed.action === 'stop') {
    const existing = readRuntime(root);
    if (!existing || !livePid(existing.pid)) {
      if (existing) fs.rmSync(runtimePath(root), { force: true });
      process.stdout.write(JSON.stringify({ workspaceRoot: root, stopped: false, reason: 'not-running', previousPid: existing ? existing.pid : null }, null, 2) + '\n');
      return;
    }
    await stopRecordedDaemon(root, existing);
    process.stdout.write(JSON.stringify({ workspaceRoot: root, stopped: true, previousPid: existing.pid }, null, 2) + '\n');
    return;
  }
  if (!manifest) {
    assertWorkspaceSupported(root);
    assertImplicitStudioCreationAllowed(root, (parsed.action === 'open' || parsed.action === 'enter') && parsed.allowNestedStudio === true);
  }
  if (parsed.action === 'provider-secret-backend') {
    const paths = studioPaths(root);
    writeWorkspaceSecretBackend(paths, parsed.secretBackend as SecretBackendChoice);
    process.stdout.write(JSON.stringify({
      workspaceRoot: root,
      backend: readWorkspaceSecretBackend(paths),
      env: 'DAOGE_PIC_PROVIDER_SECRET_BACKEND=' + (parsed.secretBackend as SecretBackendChoice),
      note: '已写入工作区配置，之后 daoge open / daoge studio 启动的 daemon 会自动带上它。已在运行的 daemon 需要 daoge restart 才生效。'
    }, null, 2) + '\n');
    return;
  }
  if (parsed.action === 'restart') {
    const restarted = await restartDaemon(root);
    process.stdout.write(JSON.stringify({
      workspaceRoot: root,
      previousPid: restarted.previousPid,
      previousBuildId: restarted.previousBuild ? restarted.previousBuild.daemonBuildId : null,
      build: await daemonBuildStatus(restarted.daemon),
      daemon: compactRuntime(restarted.daemon)
    }, null, 2) + '\n');
    return;
  }
  const record = await ensureDaemon(root);
  if (parsed.action === 'round-status') {
    const input = parsed.roundStatus as { roundId: string; sessionId: string };
    const planStatus = await api(record, 'GET', '/api/sessions/' + encodeURIComponent(input.sessionId) + '/plan-status', {});
    const runs = await api(record, 'GET', '/api/rounds/' + encodeURIComponent(input.roundId) + '/runs', {});
    process.stdout.write(JSON.stringify({ planStatus, runs }) + '\n');
    return;
  }
  if (parsed.action === 'studio') { process.stdout.write(JSON.stringify({ workspaceRoot: root, daemon: publicRuntime(record), workbench: { origin: record.url, command: ['daoge', 'open', '--workspace', root] } }, null, 2) + '\n'); return; }
  if (parsed.action === 'open') {
    const workbench = await openOrReuseWorkbench(record, parsed.force === true);
    process.stdout.write(JSON.stringify({ workspaceRoot: root, ...workbench }, null, 2) + '\n');
    return;
  }
  if (parsed.action === 'enter') {
    // agent 是主要消费者：紧凑 JSON 比 2 空格缩进省约 25% 的 token。
    process.stdout.write(JSON.stringify(await enterStudio(record, parsed.enter as EnterInput, parsed.force === true)) + '\n');
    return;
  }
  const request = parsed.request as NonNullable<ParsedCommand['request']>;
  const result = await api(record, request.method, request.pathname, materializeStdinJson(request.body), request.idempotencyKey, request.operationName);
  if (parsed.planChallenge) {
    const challengeInput = parsed.planChallenge;
    if (!challengeInput.sessionId) throw new Error('plan --challenge true 需要同时给出 --session。');
    const challenge = await api(record, 'POST', '/api/rounds/' + encodeURIComponent(challengeInput.roundId) + '/confirmation-challenge', { sessionId: challengeInput.sessionId }, undefined, 'plan-challenge-' + randomUUID());
    process.stdout.write(JSON.stringify({ plan: result, challenge }, null, 2) + '\n');
    return;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

export { parseCommand, commandSchemas, commandHelp, usage, usageFull };

if (require.main === module) void main().catch((error) => { process.stderr.write((error instanceof Error ? error.message : 'DAOGE Pic 命令失败。') + '\n'); process.exitCode = 1; });
