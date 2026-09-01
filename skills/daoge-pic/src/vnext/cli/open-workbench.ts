import { ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';

export interface OpenerDependencies {
  platform?: NodeJS.Platform;
  spawn?: (command: string, args: readonly string[]) => ChildProcess;
}

export async function openWorkbenchUrl(url: string, dependencies: OpenerDependencies = {}): Promise<void> {
  const platform = dependencies.platform || process.platform;
  let command: string;
  let args: readonly string[];
  if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (platform === 'linux') {
    command = 'xdg-open';
    args = [url];
  } else if (platform === 'win32') {
    command = 'rundll32.exe';
    args = ['url.dll,FileProtocolHandler', url];
  } else {
    throw new Error('当前平台不支持安全打开 Workbench。');
  }

  const launch = dependencies.spawn || ((executable: string, executableArgs: readonly string[]) => spawn(executable, executableArgs, { detached: true, stdio: 'ignore', windowsHide: true }));
  const child = launch(command, args);
  try {
    await once(child, 'spawn');
  } catch {
    throw new Error('无法启动系统浏览器打开 Workbench。');
  }
  child.unref();
}
