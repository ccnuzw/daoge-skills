import fs from 'node:fs';
import { StudioPaths } from './workspace';

export const PROVIDER_IDS = [
  'openai-images',
  'gemini-image',
  'gemini-openai-compatible',
  'xai-grok-image'
] as const;

export type ProviderId = typeof PROVIDER_IDS[number];

export interface ProviderCapabilities {
  generate: boolean;
  edit: boolean;
  referenceImage: boolean;
  mask: boolean;
}

export interface ResolvedProviderConfig {
  providerId: ProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
  referenceEnabled: boolean;
}

export interface SafeProviderStatus {
  providerId: ProviderId | null;
  configured: boolean;
  missing: string[];
  model: string | null;
  endpoint: string | null;
  capabilities: ProviderCapabilities | null;
}

const CAPABILITIES: Record<ProviderId, ProviderCapabilities> = {
  'openai-images': { generate: true, edit: true, referenceImage: true, mask: true },
  'gemini-image': { generate: true, edit: true, referenceImage: false, mask: false },
  'gemini-openai-compatible': { generate: true, edit: false, referenceImage: false, mask: false },
  'xai-grok-image': { generate: true, edit: false, referenceImage: false, mask: false }
};

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseProviderEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separator = normalized.indexOf('=');
    if (separator <= 0) continue;
    const key = normalized.slice(0, separator).trim();
    const value = unquote(normalized.slice(separator + 1).trim());
    if (key) values[key] = value;
  }
  return values;
}

function valueFor(env: Record<string, string>, key: string): string {
  return String(env[key] || '').trim();
}

function isProviderId(value: string): value is ProviderId {
  return PROVIDER_IDS.includes(value as ProviderId);
}

function endpointIdentity(raw: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol + '//' + url.host;
  } catch {
    return null;
  }
}

function valuesForProvider(providerId: ProviderId, env: Record<string, string>): ResolvedProviderConfig {
  if (providerId === 'openai-images') {
    return { providerId, baseUrl: valueFor(env, 'OPENAI_BASE_URL'), apiKey: valueFor(env, 'OPENAI_API_KEY'), model: valueFor(env, 'OPENAI_MODEL'), referenceEnabled: true };
  }
  if (providerId === 'gemini-image') {
    return { providerId, baseUrl: valueFor(env, 'GEMINI_IMAGE_BASE_URL'), apiKey: valueFor(env, 'GEMINI_IMAGE_API_KEY'), model: valueFor(env, 'GEMINI_IMAGE_MODEL'), referenceEnabled: valueFor(env, 'GEMINI_IMAGE_ENABLE_REFERENCE').toLowerCase() === 'true' };
  }
  if (providerId === 'gemini-openai-compatible') {
    return { providerId, baseUrl: valueFor(env, 'GEMINI_OPENAI_BASE_URL'), apiKey: valueFor(env, 'GEMINI_OPENAI_API_KEY'), model: valueFor(env, 'GEMINI_OPENAI_MODEL'), referenceEnabled: false };
  }
  return { providerId, baseUrl: valueFor(env, 'XAI_IMAGE_BASE_URL'), apiKey: valueFor(env, 'XAI_IMAGE_API_KEY'), model: valueFor(env, 'XAI_IMAGE_MODEL'), referenceEnabled: false };
}

export function capabilitiesForProvider(config: ResolvedProviderConfig): ProviderCapabilities {
  const capabilities = { ...CAPABILITIES[config.providerId] };
  if (config.providerId === 'gemini-image') capabilities.referenceImage = config.referenceEnabled;
  return capabilities;
}

export function loadProviderConfig(paths: StudioPaths): ResolvedProviderConfig | null {
  if (!fs.existsSync(paths.providerEnvPath)) return null;
  const env = parseProviderEnv(fs.readFileSync(paths.providerEnvPath, 'utf8'));
  const providerId = valueFor(env, 'IMAGE_PROVIDER');
  if (!isProviderId(providerId)) return null;
  return valuesForProvider(providerId, env);
}

export function providerStatus(paths: StudioPaths): SafeProviderStatus {
  const config = loadProviderConfig(paths);
  if (!config) {
    return { providerId: null, configured: false, missing: ['IMAGE_PROVIDER'], model: null, endpoint: null, capabilities: null };
  }
  const missing: string[] = [];
  if (!config.baseUrl) missing.push('base_url');
  if (!config.apiKey) missing.push('api_key');
  if (!config.model) missing.push('model');
  return {
    providerId: config.providerId,
    configured: missing.length === 0,
    missing,
    model: config.model || null,
    endpoint: endpointIdentity(config.baseUrl),
    capabilities: capabilitiesForProvider(config)
  };
}

export function providerSnapshot(config: ResolvedProviderConfig): Omit<ResolvedProviderConfig, 'apiKey' | 'baseUrl'> & { endpoint: string | null; capabilities: ProviderCapabilities } {
  return {
    providerId: config.providerId,
    model: config.model,
    referenceEnabled: config.referenceEnabled,
    endpoint: endpointIdentity(config.baseUrl),
    capabilities: capabilitiesForProvider(config)
  };
}
