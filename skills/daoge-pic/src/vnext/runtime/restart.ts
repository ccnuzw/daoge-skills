let restartHandler: (() => void) | null = null;

export function installDaemonRestartHandler(handler: () => void): () => void {
  if (restartHandler) throw new Error('A daemon restart handler is already installed.');
  restartHandler = handler;
  return () => { if (restartHandler === handler) restartHandler = null; };
}
export function daemonRestartAvailable(): boolean {
  return restartHandler !== null;
}

export function requestDaemonRestart(): boolean {
  if (!restartHandler) return false;
  restartHandler();
  return true;
}
