interface DaemonLifecycleHandlers {
  restart(): void;
  stop(): void;
}

let lifecycleHandlers: DaemonLifecycleHandlers | null = null;

export function installDaemonLifecycleHandlers(handlers: DaemonLifecycleHandlers): () => void {
  if (lifecycleHandlers) throw new Error('Daemon lifecycle handlers are already installed.');
  lifecycleHandlers = handlers;
  return () => { if (lifecycleHandlers === handlers) lifecycleHandlers = null; };
}

export function daemonRestartAvailable(): boolean { return lifecycleHandlers !== null; }
export function daemonShutdownAvailable(): boolean { return lifecycleHandlers !== null; }

export function requestDaemonRestart(): boolean {
  if (!lifecycleHandlers) return false;
  lifecycleHandlers.restart();
  return true;
}

export function requestDaemonShutdown(): boolean {
  if (!lifecycleHandlers) return false;
  lifecycleHandlers.stop();
  return true;
}
