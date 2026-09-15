import fs from 'node:fs';
import path from 'node:path';
import type { StudioPaths } from './workspace';

// 为什么需要这个文件：
//
// `providerSecretBackendPolicy()` 的默认值是 system（OS 保护的密钥后端），且 **fail-closed**
// —— 这是刻意的安全设计，不能为了省事改成 plaintext。但有些工作区在明文后端时期就写入了
// Profile，之后官方入口 `daoge open` 启动的 daemon 走 system，读写就被 409 拒绝。
// 在此之前唯一的解法是每次启动前手动 export 环境变量，而官方入口根本不经过 shell。
//
// 所以这里提供一个**显式的、落盘的、工作区级**开关：不弱化默认值，只是让「我已经决定这个
// 工作区用哪种后端」这件事持久化下来。没有这个文件时的行为与以前完全一致。

export const SECRET_BACKEND_ENV = 'DAOGE_PIC_PROVIDER_SECRET_BACKEND';
export type SecretBackendChoice = 'plaintext' | 'system';

const FILE_NAME = 'secret-backend.json';
export const SECRET_BACKEND_CHOICES: readonly SecretBackendChoice[] = Object.freeze(['plaintext', 'system']);

function configFile(paths: StudioPaths): string {
  return path.join(paths.runtimeDir, FILE_NAME);
}

function normalize(value: unknown): SecretBackendChoice | null {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'plaintext' || text === 'sqlite-plaintext' || text === 'sqlite') return 'plaintext';
  if (text === 'system') return 'system';
  return null;
}

export function readWorkspaceSecretBackend(paths: StudioPaths): SecretBackendChoice | null {
  const file = configFile(paths);
  if (!fs.existsSync(file)) return null;
  try {
    return normalize((JSON.parse(fs.readFileSync(file, 'utf8')) as { backend?: unknown } | null)?.backend);
  } catch {
    // 配置文件损坏时当作没配：宁可回到 fail-closed 的默认值，也不要猜。
    return null;
  }
}

export function writeWorkspaceSecretBackend(paths: StudioPaths, backend: SecretBackendChoice): void {
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  fs.writeFileSync(configFile(paths), JSON.stringify({ backend, updatedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
}

// 只注入这一个变量：通用 env 注入会让一个工作区文件拥有改写任意进程环境的能力，白名单更安全。
// 已经显式 export 过的不覆盖 —— 命令行上的意图优先于落盘配置。
export function daemonEnvWithSecretBackend(paths: StudioPaths, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (base[SECRET_BACKEND_ENV]) return base;
  const backend = readWorkspaceSecretBackend(paths);
  if (!backend) return base;
  return { ...base, [SECRET_BACKEND_ENV]: backend };
}
