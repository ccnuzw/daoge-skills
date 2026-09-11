import { capabilityShapeForProvider, isProviderId as descriptorIsProviderId, providerDescriptor, providerEndpointPolicyIssues, PROVIDER_ADAPTER_VERSION, PROVIDER_DESCRIPTOR_VERSION, PROVIDER_IDS, ProviderEndpointTrustMode, ProviderId, ProviderProfileLimits } from '../providers/descriptors';

export { PROVIDER_ADAPTER_VERSION, PROVIDER_DESCRIPTOR_VERSION, PROVIDER_IDS, ProviderEndpointTrustMode, ProviderId, ProviderProfileLimits } from '../providers/descriptors';

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
  endpointTrustMode: ProviderEndpointTrustMode;
  limits: ProviderProfileLimits;
  descriptorVersion: number;
  adapterVersion: string;
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
  descriptorVersion: number | null;
  adapterVersion: string | null;
  endpointTrustMode: ProviderEndpointTrustMode | null;
  endpointPolicyWarnings: string[];
  limits: ProviderProfileLimits;
}

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
  return descriptorIsProviderId(value);
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
  let config: Omit<ResolvedProviderConfig, 'profileId' | 'profileName' | 'configVersion' | 'options' | 'endpointTrustMode' | 'limits' | 'descriptorVersion' | 'adapterVersion'>;
  if (providerId === 'openai-images') config = { providerId, baseUrl: valueFor(env, 'OPENAI_BASE_URL'), apiKey: valueFor(env, 'OPENAI_API_KEY'), model: valueFor(env, 'OPENAI_MODEL'), referenceEnabled: true };
  else if (providerId === 'gemini-image') config = { providerId, baseUrl: valueFor(env, 'GEMINI_IMAGE_BASE_URL'), apiKey: valueFor(env, 'GEMINI_IMAGE_API_KEY'), model: valueFor(env, 'GEMINI_IMAGE_MODEL'), referenceEnabled: valueFor(env, 'GEMINI_IMAGE_ENABLE_REFERENCE').toLowerCase() === 'true' };
  else if (providerId === 'gemini-openai-compatible') config = { providerId, baseUrl: valueFor(env, 'GEMINI_OPENAI_BASE_URL'), apiKey: valueFor(env, 'GEMINI_OPENAI_API_KEY'), model: valueFor(env, 'GEMINI_OPENAI_MODEL'), referenceEnabled: false };
  else config = { providerId, baseUrl: valueFor(env, 'XAI_IMAGE_BASE_URL'), apiKey: valueFor(env, 'XAI_IMAGE_API_KEY'), model: valueFor(env, 'XAI_IMAGE_MODEL'), referenceEnabled: false };
  const descriptor = providerDescriptor(providerId);
  return { profileId: 'legacy-env-import', profileName: 'Imported ' + providerId, configVersion: 1, options: { referenceEnabled: config.referenceEnabled }, endpointTrustMode: descriptor.endpoint.defaultTrustMode, limits: {}, descriptorVersion: PROVIDER_DESCRIPTOR_VERSION, adapterVersion: PROVIDER_ADAPTER_VERSION, ...config };
}

export function capabilitiesForProvider(config: ResolvedProviderConfig): ProviderCapabilities {
  return capabilityShapeForProvider(config.providerId, config.referenceEnabled);
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
    endpointTrustMode: config.endpointTrustMode,
    limits: config.limits,
    descriptorVersion: config.descriptorVersion,
    adapterVersion: config.adapterVersion,
    endpoint: endpointIdentity(config.baseUrl),
    capabilities: capabilitiesForProvider(config)
  };
}

export function endpointPolicyWarnings(config: ResolvedProviderConfig): string[] {
  return providerEndpointPolicyIssues(config.providerId, config.baseUrl, config.endpointTrustMode).filter((issue) => issue.level === 'warning').map((issue) => issue.message);
}
