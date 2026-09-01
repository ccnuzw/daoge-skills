import { matchesDaemonProcess, ProcessArgumentsQuery, queryProcessArguments } from './process-identity';

export interface RecordedDaemonIdentity {
  pid: number;
  url: string;
  workspaceRoot: string;
}

export interface DaemonSignalDependencies {
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

export async function signalVerifiedDaemon(
  record: RecordedDaemonIdentity,
  expected: { workspaceRoot: string; studioId: string; lockPid: number; daemonEntry: string },
  dependencies: DaemonSignalDependencies = {}
): Promise<void> {
  if (record.pid !== expected.lockPid) throw new Error('daemon runtime 与锁文件 PID 不匹配，拒绝发送终止信号。');
  if (record.workspaceRoot !== expected.workspaceRoot) throw new Error('daemon runtime 工作区不匹配，拒绝发送终止信号。');
  if (!loopbackRuntimeUrl(record.url)) throw new Error('daemon runtime 地址不是可信 loopback URL，拒绝发送终止信号。');
  const studioId = await healthStudioId(record.url, dependencies.fetch || fetch);
  if (studioId !== expected.studioId) throw new Error('daemon 健康端点未确认当前 Studio 身份，拒绝发送终止信号。');
  const arguments_ = (dependencies.queryProcessArguments || queryProcessArguments)(record.pid);
  if (!arguments_) throw new Error('当前平台无法可靠查询 daemon 进程身份，拒绝发送终止信号。');
  if (!matchesDaemonProcess(arguments_, expected.daemonEntry, expected.workspaceRoot)) throw new Error('PID 对应进程不是当前工作区 daemon，拒绝发送终止信号。');
  (dependencies.signal || ((pid, signal) => process.kill(pid, signal)))(record.pid, 'SIGTERM');
}
