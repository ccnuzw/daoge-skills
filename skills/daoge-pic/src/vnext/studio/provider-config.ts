
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
  profileId: string;
  profileName: string;
  configVersion: number;
  providerId: ProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
  options: Record<string, unknown>;
  referenceEnabled: boolean;
}

export interface SafeProviderStatus {
  profileId: string | null;
  profileName: string | null;
  configVersion: number | null;
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

export function isProviderId(value: string): value is ProviderId {
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
  let config: Omit<ResolvedProviderConfig, 'profileId' | 'profileName' | 'configVersion' | 'options'>;
  if (providerId === 'openai-images') config = { providerId, baseUrl: valueFor(env, 'OPENAI_BASE_URL'), apiKey: valueFor(env, 'OPENAI_API_KEY'), model: valueFor(env, 'OPENAI_MODEL'), referenceEnabled: true };
  else if (providerId === 'gemini-image') config = { providerId, baseUrl: valueFor(env, 'GEMINI_IMAGE_BASE_URL'), apiKey: valueFor(env, 'GEMINI_IMAGE_API_KEY'), model: valueFor(env, 'GEMINI_IMAGE_MODEL'), referenceEnabled: valueFor(env, 'GEMINI_IMAGE_ENABLE_REFERENCE').toLowerCase() === 'true' };
  else if (providerId === 'gemini-openai-compatible') config = { providerId, baseUrl: valueFor(env, 'GEMINI_OPENAI_BASE_URL'), apiKey: valueFor(env, 'GEMINI_OPENAI_API_KEY'), model: valueFor(env, 'GEMINI_OPENAI_MODEL'), referenceEnabled: false };
  else config = { providerId, baseUrl: valueFor(env, 'XAI_IMAGE_BASE_URL'), apiKey: valueFor(env, 'XAI_IMAGE_API_KEY'), model: valueFor(env, 'XAI_IMAGE_MODEL'), referenceEnabled: false };
  return { profileId: 'legacy-env-import', profileName: 'Imported ' + providerId, configVersion: 1, options: { referenceEnabled: config.referenceEnabled }, ...config };
}

export function capabilitiesForProvider(config: ResolvedProviderConfig): ProviderCapabilities {
  const capabilities = { ...CAPABILITIES[config.providerId] };
  if (config.providerId === 'gemini-image') capabilities.referenceImage = config.referenceEnabled;
  return capabilities;
}

export function configFromProviderEnv(env: Record<string, string>): ResolvedProviderConfig | null {
  const providerId = valueFor(env, 'IMAGE_PROVIDER');
  if (!isProviderId(providerId)) return null;
  return valuesForProvider(providerId, env);
}

export function providerSnapshot(config: ResolvedProviderConfig): Omit<ResolvedProviderConfig, 'apiKey' | 'baseUrl' | 'options'> & { endpoint: string | null; capabilities: ProviderCapabilities } {
  return {
    profileId: config.profileId,
    profileName: config.profileName,
    configVersion: config.configVersion,
    providerId: config.providerId,
    model: config.model,
    referenceEnabled: config.referenceEnabled,
    endpoint: endpointIdentity(config.baseUrl),
    capabilities: capabilitiesForProvider(config)
  };
}
