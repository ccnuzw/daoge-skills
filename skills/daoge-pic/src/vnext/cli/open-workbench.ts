import { ChildProcess, spawn } from 'node:child_process';

export interface OpenerDependencies {
  platform?: NodeJS.Platform;
  spawn?: (command: string, args: readonly string[]) => ChildProcess;
  launchGraceMs?: number;
}

export async function openWorkbenchUrl(url: string, dependencies: OpenerDependencies = {}): Promise<void> {
  const platform = dependencies.platform || process.platform;
  let attempts: ReadonlyArray<{ command: string; args: readonly string[] }>;
  if (platform === 'darwin') {
    attempts = [{ command: 'open', args: [url] }];
  } else if (platform === 'linux') {
    attempts = [{ command: 'xdg-open', args: [url] }];
  } else if (platform === 'win32') {
    attempts = [
      { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] },
      { command: 'explorer.exe', args: [url] }
    ];
  } else {
    throw new Error('当前平台不支持安全打开 Workbench。');
  }

  const launch = dependencies.spawn || ((executable: string, executableArgs: readonly string[]) => spawn(executable, executableArgs, { detached: true, stdio: 'ignore', windowsHide: true }));
  const launchGraceMs = Math.max(1, dependencies.launchGraceMs ?? 150);
  for (const attempt of attempts) {
    try {
      const child = launch(attempt.command, attempt.args);
      await new Promise<void>((resolve, reject) => {
        let timer: NodeJS.Timeout | undefined;
        let settled = false;
        const finish = (error?: Error): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child.removeListener('error', onError);
          child.removeListener('exit', onExit);
          if (error) reject(error); else resolve();
        };
        const onError = (error: Error): void => finish(error);
        const onExit = (code: number | null): void => finish(code === 0 ? undefined : new Error('System opener exited before accepting the URL.'));
        child.once('error', onError);
        child.once('exit', onExit);
        child.once('spawn', () => { timer = setTimeout(() => finish(), launchGraceMs); });
      });
      child.unref();
      return;
    } catch {
      // Windows security policy can block or immediately terminate one system opener while leaving the other available.
    }
  }
  throw new Error('无法启动系统浏览器打开 Workbench。请检查默认 HTTP/HTTPS 浏览器关联或运行 daoge doctor。');
}
