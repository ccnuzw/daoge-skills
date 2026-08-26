import path from 'node:path';
import { runStudioDaemon } from '../runtime/daemon';

function valueAfter(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] || '').trim() || null : null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const workspaceRoot = valueAfter(args, '--workspace');
  if (!workspaceRoot) throw new Error('Studio daemon requires --workspace with a stable workspace root.');
  const port = Number(valueAfter(args, '--port') || '0');
  await runStudioDaemon({ workspaceRoot, providerTemplatePath: path.resolve(__dirname, '../../../references/provider.env.example'), port: Number.isInteger(port) && port >= 0 ? port : 0 });
}

void main().catch((error) => { process.stderr.write((error instanceof Error ? error.message : 'Studio daemon failed.') + '\n'); process.exitCode = 1; });
