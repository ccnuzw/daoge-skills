import { createLocalCapability } from '../api/local-auth';
import { runStudioDaemon, StudioDaemonOptions } from '../runtime/daemon';
import { WorkbenchPresence } from '../runtime/workbench-presence';

function valueAfter(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] || '').trim() || null : null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const workspaceRoot = valueAfter(args, '--workspace');
  if (!workspaceRoot) throw new Error('Studio daemon requires --workspace with a stable workspace root.');
  const requestedPort = valueAfter(args, '--port');
  const port = requestedPort === null ? undefined : Number(requestedPort);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error('Studio daemon --port must be an integer between 0 and 65535.');
  const options: StudioDaemonOptions = { workspaceRoot, port, capability: createLocalCapability(), sessionToken: createLocalCapability(), workbenchPresence: new WorkbenchPresence() };
  while (await runStudioDaemon(options) === 'restart') { /* restart after graceful release with the same in-memory Workbench authorization */ }
}

void main().catch((error) => { process.stderr.write((error instanceof Error ? error.message : 'Studio daemon failed.') + '\n'); process.exitCode = 1; });
