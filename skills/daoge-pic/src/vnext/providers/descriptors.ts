export const PROVIDER_DESCRIPTOR_VERSION = 1;
export const PROVIDER_ADAPTER_VERSION = 'http-image-v1';

export const PROVIDER_IDS = [
  'openai-images',
  'gemini-image',
  'gemini-openai-compatible',
  'xai-grok-image'
] as const;

export type ProviderId = typeof PROVIDER_IDS[number];
export type ProviderEndpointTrustMode = 'official' | 'compatible_public' | 'local_proxy' | 'enterprise_private';
export const PROVIDER_ENDPOINT_TRUST_MODES: readonly ProviderEndpointTrustMode[] = ['official', 'compatible_public', 'local_proxy', 'enterprise_private'];

export interface ProviderReferenceDescriptor {
  supported: boolean;
  defaultEnabled: boolean;
  enableOptionKey: 'referenceEnabled' | null;
  maxCount: number;
  acceptedMediaTypes: readonly string[];
}

export interface ProviderMaskDescriptor {
  supported: boolean;
  acceptedMediaTypes: readonly string[];
}

export interface ProviderOutputDescriptor {
  transport: 'openai-size' | 'gemini-aspect' | 'xai-options';
  aspectRatios: 'integer' | readonly string[];
  resolutions: readonly string[];
  resolutionTransportValues: readonly string[];
  qualities: readonly string[];
  defaultSize: string;
  requiresExplicitSizeForNonSquareAspect: boolean;
}

export interface ProviderEndpointDescriptor {
  defaultTrustMode: ProviderEndpointTrustMode;
  allowedTrustModes: readonly ProviderEndpointTrustMode[];
  officialHosts: readonly string[];
  examples: readonly string[];
  help: string;
}

export interface ProviderProfileLimits {
  maxRunItems?: number;
  maxExecutionConcurrency?: number;
  requestTimeoutMs?: number;
  maxRetryAttempts?: number;
}

export interface ProviderDescriptor {
  id: ProviderId;
  displayName: string;
  descriptorVersion: number;
  adapterVersion: string;
  authScheme: 'bearer' | 'x-goog-api-key';
  modelExamples: readonly string[];
  operations: { generate: boolean; edit: boolean };
  reference: ProviderReferenceDescriptor;
  mask: ProviderMaskDescriptor;
  output: ProviderOutputDescriptor;
  endpoint: ProviderEndpointDescriptor;
}

export interface SafeProviderDescriptor {
  id: ProviderId;
  displayName: string;
  descriptorVersion: number;
  adapterVersion: string;
  authScheme: 'bearer' | 'x-goog-api-key';
  modelExamples: readonly string[];
  operations: { generate: boolean; edit: boolean };
  reference: ProviderReferenceDescriptor;
  mask: ProviderMaskDescriptor;
  output: ProviderOutputDescriptor;
  endpoint: ProviderEndpointDescriptor;
}

const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
const XAI_REFERENCE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const XAI_ASPECT_RATIOS = ['auto', '1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', '9:19.5', '19.5:9', '9:20', '20:9', '1:2', '2:1', '21:9', '5:2'] as const;
const XAI_RESOLUTIONS = ['1K', '2K'] as const;
const XAI_RESOLUTION_TRANSPORT_VALUES = ['1k', '2k'] as const;
const XAI_QUALITIES = ['low', 'medium', 'auto'] as const;

const DESCRIPTORS: Record<ProviderId, ProviderDescriptor> = {
  'openai-images': {
    id: 'openai-images',
    displayName: 'OpenAI Images',
    descriptorVersion: PROVIDER_DESCRIPTOR_VERSION,
    adapterVersion: PROVIDER_ADAPTER_VERSION,
    authScheme: 'bearer',
    modelExamples: ['gpt-image-2', 'gpt-image-1'],
    operations: { generate: true, edit: true },
    reference: { supported: true, defaultEnabled: true, enableOptionKey: null, maxCount: 8, acceptedMediaTypes: IMAGE_MEDIA_TYPES },
    mask: { supported: true, acceptedMediaTypes: ['image/png'] },
    output: { transport: 'openai-size', aspectRatios: 'integer', resolutions: [], resolutionTransportValues: [], qualities: [], defaultSize: '1024x1024', requiresExplicitSizeForNonSquareAspect: true },
    endpoint: { defaultTrustMode: 'compatible_public', allowedTrustModes: PROVIDER_ENDPOINT_TRUST_MODES, officialHosts: ['api.openai.com'], examples: ['https://api.openai.com/v1'], help: 'OpenAI Images 或兼容 /v1 images endpoint。' }
  },
  'gemini-image': {
    id: 'gemini-image',
    displayName: 'Gemini Image',
    descriptorVersion: PROVIDER_DESCRIPTOR_VERSION,
    adapterVersion: PROVIDER_ADAPTER_VERSION,
    authScheme: 'x-goog-api-key',
    modelExamples: ['gemini-2.5-flash-image', 'models/gemini-2.5-flash-image'],
    operations: { generate: true, edit: true },
    reference: { supported: true, defaultEnabled: false, enableOptionKey: 'referenceEnabled', maxCount: 8, acceptedMediaTypes: IMAGE_MEDIA_TYPES },
    mask: { supported: false, acceptedMediaTypes: [] },
    output: { transport: 'gemini-aspect', aspectRatios: 'integer', resolutions: [], resolutionTransportValues: [], qualities: [], defaultSize: '1024x1024', requiresExplicitSizeForNonSquareAspect: false },
    endpoint: { defaultTrustMode: 'compatible_public', allowedTrustModes: PROVIDER_ENDPOINT_TRUST_MODES, officialHosts: ['generativelanguage.googleapis.com'], examples: ['https://generativelanguage.googleapis.com', 'https://generativelanguage.googleapis.com/v1beta'], help: 'Gemini generateContent endpoint；可填写根地址、/v1beta 或完整模型 endpoint。' }
  },
  'gemini-openai-compatible': {
    id: 'gemini-openai-compatible',
    displayName: 'Gemini OpenAI Compatible',
    descriptorVersion: PROVIDER_DESCRIPTOR_VERSION,
    adapterVersion: PROVIDER_ADAPTER_VERSION,
    authScheme: 'bearer',
    modelExamples: ['gemini-2.5-flash-image'],
    operations: { generate: true, edit: false },
    reference: { supported: false, defaultEnabled: false, enableOptionKey: null, maxCount: 0, acceptedMediaTypes: IMAGE_MEDIA_TYPES },
    mask: { supported: false, acceptedMediaTypes: [] },
    output: { transport: 'openai-size', aspectRatios: 'integer', resolutions: [], resolutionTransportValues: [], qualities: [], defaultSize: '1024x1024', requiresExplicitSizeForNonSquareAspect: false },
    endpoint: { defaultTrustMode: 'compatible_public', allowedTrustModes: PROVIDER_ENDPOINT_TRUST_MODES, officialHosts: [], examples: ['https://your-gemini-compatible.example/v1'], help: 'OpenAI-compatible images endpoint；实际能力取决于代理实现。' }
  },
  'xai-grok-image': {
    id: 'xai-grok-image',
    displayName: 'xAI Grok Image',
    descriptorVersion: PROVIDER_DESCRIPTOR_VERSION,
    adapterVersion: PROVIDER_ADAPTER_VERSION,
    authScheme: 'bearer',
    modelExamples: ['grok-imagine-image', 'grok-2-image'],
    operations: { generate: true, edit: true },
    reference: { supported: true, defaultEnabled: true, enableOptionKey: null, maxCount: 5, acceptedMediaTypes: XAI_REFERENCE_MEDIA_TYPES },
    mask: { supported: false, acceptedMediaTypes: [] },
    output: { transport: 'xai-options', aspectRatios: XAI_ASPECT_RATIOS, resolutions: XAI_RESOLUTIONS, resolutionTransportValues: XAI_RESOLUTION_TRANSPORT_VALUES, qualities: XAI_QUALITIES, defaultSize: '1024x1024', requiresExplicitSizeForNonSquareAspect: false },
    endpoint: { defaultTrustMode: 'compatible_public', allowedTrustModes: PROVIDER_ENDPOINT_TRUST_MODES, officialHosts: ['api.x.ai'], examples: ['https://api.x.ai/v1'], help: 'xAI image endpoint；Grok 使用官方 aspect_ratio/resolution/quality 参数。' }
  }
};

export function isProviderId(value: string): value is ProviderId {
  return PROVIDER_IDS.includes(value as ProviderId);
}

export function isProviderEndpointTrustMode(value: string): value is ProviderEndpointTrustMode {
  return (PROVIDER_ENDPOINT_TRUST_MODES as readonly string[]).includes(value);
}

export function providerDescriptor(providerId: ProviderId): ProviderDescriptor {
  return DESCRIPTORS[providerId];
}

export function safeProviderDescriptors(): SafeProviderDescriptor[] {
  return PROVIDER_IDS.map((id) => DESCRIPTORS[id]);
}

export function referenceEnabledForProvider(providerId: ProviderId, requested: boolean): boolean {
  const descriptor = providerDescriptor(providerId);
  if (descriptor.reference.enableOptionKey === 'referenceEnabled') return requested === true;
  return descriptor.reference.defaultEnabled;
}

export function capabilityShapeForProvider(providerId: ProviderId, requestedReferenceEnabled = false): { generate: boolean; edit: boolean; referenceImage: boolean; mask: boolean } {
  const descriptor = providerDescriptor(providerId);
  const referenceEnabled = referenceEnabledForProvider(providerId, requestedReferenceEnabled);
  return {
    generate: descriptor.operations.generate,
    edit: descriptor.operations.edit,
    referenceImage: descriptor.reference.supported && referenceEnabled,
    mask: descriptor.mask.supported
  };
}

function hostMatches(value: string, hosts: readonly string[]): boolean {
  const host = value.toLowerCase();
  return hosts.some((candidate) => host === candidate || host.endsWith('.' + candidate));
}

function localLikeHost(value: string): boolean {
  const host = value.toLowerCase();
  return host === 'localhost' || host.endsWith('.local') || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) || host === '::1' || host.startsWith('fc') || host.startsWith('fd');
}

export interface ProviderEndpointPolicyIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

export function providerEndpointPolicyIssues(providerId: ProviderId, baseUrl: string, trustMode: ProviderEndpointTrustMode): ProviderEndpointPolicyIssue[] {
  const issues: ProviderEndpointPolicyIssue[] = [];
  const descriptor = providerDescriptor(providerId);
  if (!descriptor.endpoint.allowedTrustModes.includes(trustMode)) issues.push({ level: 'error', code: 'endpoint_trust_mode_unsupported', message: '该 Provider 不支持所选端点信任模式。' });
  if (!baseUrl) return issues;
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { return issues; }
  if (trustMode === 'official') {
    if (parsed.protocol !== 'https:') issues.push({ level: 'error', code: 'official_endpoint_requires_https', message: '官方端点信任模式必须使用 HTTPS。' });
    if (!descriptor.endpoint.officialHosts.length || !hostMatches(parsed.hostname, descriptor.endpoint.officialHosts)) issues.push({ level: 'error', code: 'official_endpoint_host_mismatch', message: '官方端点信任模式必须使用该 Provider 的官方 host。' });
  }
  if (trustMode === 'compatible_public') {
    if (parsed.protocol !== 'https:') issues.push({ level: 'error', code: 'public_endpoint_requires_https', message: '公开兼容端点必须使用 HTTPS；如需 HTTP 代理请切换到本地代理或企业内网模式。' });
    if (localLikeHost(parsed.hostname)) issues.push({ level: 'warning', code: 'public_endpoint_looks_private', message: '该端点看起来像本机或内网；如使用代理请切换到本地代理或企业内网模式。' });
  }
  if (trustMode === 'local_proxy' && !localLikeHost(parsed.hostname)) issues.push({ level: 'warning', code: 'local_proxy_not_local', message: '本地代理模式通常应指向 localhost 或内网回环地址。' });
  if (trustMode === 'enterprise_private' && parsed.protocol !== 'https:') issues.push({ level: 'warning', code: 'enterprise_endpoint_prefers_https', message: '企业内网端点建议使用 HTTPS，避免密钥在网络中明文传输。' });
  return issues;
}
