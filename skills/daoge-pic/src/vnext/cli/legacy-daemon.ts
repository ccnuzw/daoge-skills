import { SKILL_PROTOCOL_NAME, SKILL_PROTOCOL_VERSION } from '../shared/protocol';
import { matchesDaemonProcess, ProcessArgumentsQuery, queryProcessArguments } from './process-identity';
import { sameWorkspaceRoot } from '../studio/workspace';

export interface RecordedDaemonIdentity {
  pid: number;
  url: string;
  capability?: string;
  workspaceRoot: string;
}

export interface DaemonShutdownDependencies {
  fetch?: typeof fetch;
  queryProcessArguments?: ProcessArgumentsQuery;
  signal?: (pid: number, signal: NodeJS.Signals) => void;
}

function loopbackRuntimeUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:'
      && parsed.hostname === '127.0.0.1'
      && parsed.port !== ''
      && !parsed.username
      && !parsed.password
      && parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash ? parsed : null;
  } catch {
    return null;
  }
}

export async function healthStudioId(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const parsed = loopbackRuntimeUrl(url);
  if (!parsed) return null;
  try {
    const response = await fetchImpl(new URL('/api/health', parsed), { signal: AbortSignal.timeout(800) });
    if (!response.ok) return null;
    const payload = await response.json() as { ok?: unknown; data?: { service?: unknown; studioId?: unknown } };
    return payload.ok === true
      && payload.data?.service === 'daoge-pic-vnext'
      && typeof payload.data.studioId === 'string'
      && payload.data.studioId ? payload.data.studioId : null;
  } catch {
    return null;
  }
}

export async function shutdownVerifiedDaemon(
  record: RecordedDaemonIdentity,
  expected: { workspaceRoot: string; studioId: string; lockPid: number; daemonEntry: string },
  dependencies: DaemonShutdownDependencies = {}
): Promise<void> {
  if (record.pid !== expected.lockPid) throw new Error('daemon runtime 与 owner record PID 不匹配，拒绝关闭。');
  if (!sameWorkspaceRoot(record.workspaceRoot, expected.workspaceRoot)) throw new Error('daemon runtime 工作区不匹配，拒绝关闭。');
  if (!loopbackRuntimeUrl(record.url)) throw new Error('daemon runtime 地址不是可信 loopback URL，拒绝关闭。');
  if (record.capability !== undefined && !/^[A-Za-z0-9_-]{43,}$/.test(record.capability)) throw new Error('daemon runtime capability 无效，拒绝关闭。');
  const fetchImpl = dependencies.fetch || fetch;
  const studioId = await healthStudioId(record.url, fetchImpl);
  if (studioId !== expected.studioId) throw new Error('daemon 健康端点未确认当前 Studio 身份，拒绝关闭。');
  const arguments_ = (dependencies.queryProcessArguments || queryProcessArguments)(record.pid);
  if (!arguments_) throw new Error('当前平台无法可靠查询 daemon 进程身份，拒绝关闭。');
  if (!matchesDaemonProcess(arguments_, expected.daemonEntry, expected.workspaceRoot)) throw new Error('PID 对应进程不是当前工作区 daemon，拒绝关闭。');
  if (!record.capability) {
    (dependencies.signal || ((pid, signal) => process.kill(pid, signal)))(record.pid, 'SIGTERM');
    return;
  }
  const response = await fetchImpl(new URL('/api/shutdown', record.url), {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + record.capability,
      'content-type': 'application/json',
      'x-daoge-operation-name': 'daemon-shutdown',
      'x-daoge-skill-protocol': SKILL_PROTOCOL_NAME + '/' + SKILL_PROTOCOL_VERSION
    },
    body: '{}'
  });
  const payload = await response.json() as { ok?: unknown; error?: { message?: unknown } };
  if (!response.ok || payload.ok !== true) throw new Error(typeof payload.error?.message === 'string' ? payload.error.message : 'Studio daemon 拒绝受控关闭。');
}
