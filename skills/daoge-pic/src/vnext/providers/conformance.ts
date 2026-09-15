import { ImageProvider, ImageRequest, ImageResult, ImageProviderCapabilities, ProviderErrorKind, ProviderValidationResult, staticCapabilitiesForProvider } from './contracts';
import { ProviderId, PROVIDER_ADAPTER_VERSION, PROVIDER_DESCRIPTOR_VERSION, ProviderDescriptor, isProviderId, providerDescriptor } from './descriptors';
import { HttpAdapterDependencies, createImageProvider, requestPathFor } from './http-adapters';
import { ResolvedProviderConfig } from '../studio/provider-config';
import { sanitizeProviderImageResult } from './response-sanitizer';
import { PinnedHttpResponse } from './http-safety';

/** Stable, non-sensitive check identifiers emitted by the offline provider gate. */
export type ProviderConformanceCode =
  | 'provider_id'
  | 'descriptor'
  | 'capability'
  | 'validation'
  | 'request_construction'
  | 'response_sanitization'
  | 'error_classification'
  | 'unsupported_capability'
  | 'redirect_safety';

export interface ProviderConformanceCheck {
  code: ProviderConformanceCode;
  status: 'pass' | 'fail';
}

export interface ProviderConformanceResult {
  providerId: string;
  status: 'pass' | 'fail';
  checks: readonly ProviderConformanceCheck[];
  failedCodes: readonly ProviderConformanceCode[];
  descriptorVersion: number | null;
  adapterVersion: string | null;
}

export interface ProviderConformanceSuiteResult {
  status: 'pass' | 'fail';
  results: readonly ProviderConformanceResult[];
  descriptorVersion: number;
  adapterVersion: string;
}

export interface OfflineProviderFixture {
  /** A response body is kept in memory only and is never included in the result. */
  successBody?: Record<string, unknown>;
  successStatus?: number;
  redirectStatus?: number;
  redirectLocation?: string;
  /** The fake download body is used when a recorded response contains an image URL. */
  downloadBody?: Uint8Array;
}

export interface RecordedProviderRequest {
  method: string;
  path: string;
  headerNames: readonly string[];
  hasAuthorization: boolean;
  hasGoogleApiKey: boolean;
  redirectMode: string | null;
  bodyKind: 'json' | 'multipart' | 'empty' | 'unknown';
  bodyKeys: readonly string[];
}

export interface OfflineProviderTransport {
  dependencies: HttpAdapterDependencies;
  readonly requests: readonly RecordedProviderRequest[];
}

export interface ProviderConformanceOptions {
  config?: Partial<ResolvedProviderConfig>;
  fixture?: OfflineProviderFixture;
  /** Test-only replacement; production callers should use the built-in HTTP adapter. */
  provider?: ImageProvider;
}

const FIXTURE_BASE_URL = 'https://provider-fixture.invalid/v1';
const FIXTURE_KEY = 'offline-conformance-key';
const FIXTURE_IMAGE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ', 'base64');
const DEFAULT_MODEL = 'offline-fixture-model';

function defaultResponseBody(providerId: ProviderId): Record<string, unknown> {
  if (providerId === 'gemini-image') {
    return { candidates: [{ content: { parts: [{ inlineData: { data: FIXTURE_IMAGE.toString('base64'), mimeType: 'image/png' } }] } }] };
  }
  return { created: 1, model: DEFAULT_MODEL, data: [{ b64_json: FIXTURE_IMAGE.toString('base64'), mime_type: 'image/png', revised_prompt: 'offline fixture' }] };
}

function responseBody(providerId: ProviderId, fixture: OfflineProviderFixture): Record<string, unknown> {
  return fixture.successBody || defaultResponseBody(providerId);
}

function bodyShape(body: unknown): { kind: RecordedProviderRequest['bodyKind']; keys: string[] } {
  if (body === undefined || body === null) return { kind: 'empty', keys: [] };
  if (typeof body === 'string' || body instanceof Uint8Array) {
    try {
      const parsed = JSON.parse(typeof body === 'string' ? body : Buffer.from(body).toString('utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { kind: 'json', keys: Object.keys(parsed as Record<string, unknown>).sort() };
    } catch {
      return { kind: 'unknown', keys: [] };
    }
    return { kind: 'unknown', keys: [] };
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const keys: string[] = [];
    body.forEach((_value, key) => { keys.push(key); });
    return { kind: 'multipart', keys: keys.sort() };
  }
  return { kind: 'unknown', keys: [] };
}

function safePath(input: RequestInfo | URL): string {
  try {
    return new URL(String(input)).pathname || '/';
  } catch {
    return '/';
  }
}

/**
 * Creates a deterministic transport for conformance checks. It never delegates to
 * global fetch or DNS. Request records intentionally retain only shape metadata.
 */
export function createOfflineProviderTransport(providerId: ProviderId, fixture: OfflineProviderFixture = {}): OfflineProviderTransport {
  const requests: RecordedProviderRequest[] = [];
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    const shape = bodyShape(init.body);
    const headerNames: string[] = [];
    headers.forEach((_value, name) => { headerNames.push(name); });
    requests.push({
      method: String(init.method || 'GET').toUpperCase(),
      path: safePath(input),
      headerNames: headerNames.sort(),
      hasAuthorization: headers.has('authorization'),
      hasGoogleApiKey: headers.has('x-goog-api-key'),
      redirectMode: typeof init.redirect === 'string' ? init.redirect : null,
      bodyKind: shape.kind,
      bodyKeys: shape.keys
    });
    if (fixture.redirectStatus !== undefined) {
      return new Response(null, {
        status: fixture.redirectStatus,
        headers: fixture.redirectLocation ? { location: fixture.redirectLocation } : {}
      });
    }
    const status = fixture.successStatus ?? 200;
    return new Response(JSON.stringify(responseBody(providerId, fixture)), {
      status,
      headers: { 'content-type': 'application/json' }
    });
  };
  const downloadBody = fixture.downloadBody ? Buffer.from(fixture.downloadBody) : FIXTURE_IMAGE;
  const dependencies: HttpAdapterDependencies = {
    fetch,
    resolveHost: async () => ['93.184.216.34'],
    downloadRequest: async (url, addresses, _init): Promise<PinnedHttpResponse> => ({
      response: new Response(downloadBody, { status: 200, headers: { 'content-type': 'image/png' } }),
      remoteAddress: addresses[0] || '93.184.216.34'
    })
  };
  return { dependencies, requests };
}

function fixtureConfig(providerId: ProviderId, descriptor: ProviderDescriptor, overrides: Partial<ResolvedProviderConfig> = {}): ResolvedProviderConfig {
  const referenceEnabled = overrides.referenceEnabled ?? descriptor.reference.supported;
  return {
    profileId: 'offline-conformance',
    profileName: 'Offline Conformance',
    configVersion: 1,
    baseUrl: FIXTURE_BASE_URL,
    apiKey: FIXTURE_KEY,
    model: descriptor.modelExamples[0] || DEFAULT_MODEL,
    options: { referenceEnabled },
    referenceEnabled,
    endpointTrustMode: 'compatible_public',
    limits: {},
    descriptorVersion: PROVIDER_DESCRIPTOR_VERSION,
    adapterVersion: PROVIDER_ADAPTER_VERSION,
    ...overrides,
    providerId
  };
}

function equalCapabilities(actual: ImageProviderCapabilities, expected: ImageProviderCapabilities): boolean {
  return actual.textToImage === expected.textToImage && actual.referenceEdit === expected.referenceEdit && actual.maskEdit === expected.maskEdit && actual.cancellation === expected.cancellation && actual.reconciliation === expected.reconciliation && actual.idempotency === expected.idempotency && actual.acceptedReferenceMediaTypes.join('\u0000') === expected.acceptedReferenceMediaTypes.join('\u0000');
}

function validValidation(value: ProviderValidationResult): boolean {
  return value.valid === true && value.missing.length === 0 && (!value.errors || value.errors.length === 0);
}

function checkErrorKinds(provider: ImageProvider): boolean {
  const expected: Array<[unknown, ProviderErrorKind]> = [
    [{ status: 429, code: 'rate_limit_exceeded', message: 'rate limited' }, 'rate_limited'],
    [{ status: 400, code: 'invalid_request', message: 'invalid request' }, 'invalid_request'],
    [{ status: 401, code: 'invalid_api_key', message: 'authentication failed' }, 'permission'],
    [{ status: 503, code: 'unavailable', message: 'temporarily unavailable' }, 'transient'],
    [new Error('socket closed after request write'), 'unknown_outcome']
  ];
  try {
    return expected.every(([error, kind]) => provider.classifyError(error).kind === kind);
  } catch {
    return false;
  }
}

function isUnsupportedProviderError(provider: ImageProvider, error: unknown): boolean {
  try {
    const kind = provider.classifyError(error).kind;
    return kind === 'invalid_request' || kind === 'unsupported';
  } catch {
    return false;
  }
}

function conformanceRequest(providerId: ProviderId): ImageRequest {
  return {
    requestId: 'offline-conformance-request',
    idempotencyKey: 'offline-conformance-idempotency',
    prompt: 'offline conformance fixture',
    output: providerId === 'xai-grok-image' ? { aspectRatio: '1:1', resolution: '1K', quality: 'low' } : { size: '1024x1024' },
    referenceAssets: []
  };
}

function unsupportedRequest(): ImageRequest {
  return {
    requestId: 'offline-unsupported-request',
    idempotencyKey: 'offline-unsupported-idempotency',
    prompt: 'offline unsupported capability fixture',
    output: { size: '1024x1024' },
    referenceAssets: [{ assetId: 'offline-reference', mediaType: 'image/png', bytes: FIXTURE_IMAGE }],
    maskAsset: { assetId: 'offline-mask', mediaType: 'image/png', bytes: FIXTURE_IMAGE }
  };
}

function passed(code: ProviderConformanceCode, value: boolean): ProviderConformanceCheck {
  return { code, status: value ? 'pass' : 'fail' };
}

/** Run every provider check without network access or external side effects. */
export async function runProviderConformance(providerId: ProviderId, options: ProviderConformanceOptions = {}): Promise<ProviderConformanceResult> {
  if (!isProviderId(providerId)) {
    return { providerId: String(providerId), status: 'fail', checks: [{ code: 'provider_id', status: 'fail' }], failedCodes: ['provider_id'], descriptorVersion: null, adapterVersion: null };
  }
  const descriptor = providerDescriptor(providerId);
  const transport = createOfflineProviderTransport(providerId, options.fixture);
  const config = fixtureConfig(providerId, descriptor, options.config);
  const provider = options.provider || createImageProvider(config, transport.dependencies);
  const checks: ProviderConformanceCheck[] = [];
  checks.push(passed('provider_id', provider.id === providerId));
  checks.push(passed('descriptor', descriptor.id === providerId && descriptor.descriptorVersion === PROVIDER_DESCRIPTOR_VERSION && descriptor.adapterVersion === PROVIDER_ADAPTER_VERSION));

  let capabilitiesOk = false;
  try { capabilitiesOk = equalCapabilities(provider.capabilities(config), staticCapabilitiesForProvider(providerId, config.referenceEnabled)); } catch { capabilitiesOk = false; }
  checks.push(passed('capability', capabilitiesOk));

  let validationOk = false;
  try { validationOk = validValidation(provider.validateConfig(config)); } catch { validationOk = false; }
  checks.push(passed('validation', validationOk));

  let generated: ImageResult | null = null;
  let generationOk = false;
  try {
    generated = await provider.generate(conformanceRequest(providerId), { abortSignal: new AbortController().signal });
    generationOk = Boolean(generated && generated.mediaType && (Buffer.isBuffer(generated.bytes) || typeof generated.filePath === 'string'));
  } catch { generationOk = false; }
  const request = transport.requests[0];
  const expectedPath = requestPathFor(config);
  const requestOk = generationOk && Boolean(request && request.method === 'POST' && request.path === expectedPath && request.redirectMode === 'manual' && request.hasAuthorization === (descriptor.authScheme === 'bearer') && request.hasGoogleApiKey === (descriptor.authScheme === 'x-goog-api-key'));
  checks.push(passed('request_construction', requestOk));

  let sanitizationOk = false;
  if (generated) {
    try {
      const sanitized = sanitizeProviderImageResult({ ...generated, safeMeta: { ...(generated.safeMeta || {}), reflected: config.apiKey + config.baseUrl } }, { apiKey: config.apiKey, baseUrl: config.baseUrl });
      const serialized = JSON.stringify(sanitized);
      sanitizationOk = !serialized.includes(config.apiKey) && !serialized.includes(config.baseUrl) && Boolean(sanitized.safeMeta);
    } catch { sanitizationOk = false; }
  }
  checks.push(passed('response_sanitization', sanitizationOk));
  checks.push(passed('error_classification', checkErrorKinds(provider)));

  let unsupportedOk = true;
  const capabilities = (() => { try { return provider.capabilities(config); } catch { return null; } })();
  if (capabilities && !capabilities.referenceEdit) {
    try {
      if (!provider.edit) unsupportedOk = false;
      else {
        await provider.edit(unsupportedRequest(), { abortSignal: new AbortController().signal });
        unsupportedOk = false;
      }
    } catch (error) {
      unsupportedOk = isUnsupportedProviderError(provider, error);
    }
  }
  if (capabilities && !capabilities.maskEdit && capabilities.referenceEdit && provider.edit) {
    try {
      await provider.edit(unsupportedRequest(), { abortSignal: new AbortController().signal });
      unsupportedOk = false;
    } catch (error) {
      unsupportedOk = unsupportedOk && isUnsupportedProviderError(provider, error);
    }
  }
  checks.push(passed('unsupported_capability', unsupportedOk));

  let redirectOk = false;
  const redirectTransport = createOfflineProviderTransport(providerId, { redirectStatus: 307, redirectLocation: 'https://redirected.invalid/final' });
  try {
    const redirectProvider = options.provider || createImageProvider(config, redirectTransport.dependencies);
    await redirectProvider.generate(conformanceRequest(providerId), { abortSignal: new AbortController().signal });
  } catch {
    const request = redirectTransport.requests[0];
    redirectOk = Boolean(request && redirectTransport.requests.length === 1 && request.redirectMode === 'manual');
  }
  checks.push(passed('redirect_safety', redirectOk));

  const failedCodes = checks.filter((check) => check.status === 'fail').map((check) => check.code);
  return { providerId, status: failedCodes.length ? 'fail' : 'pass', checks, failedCodes, descriptorVersion: descriptor.descriptorVersion, adapterVersion: descriptor.adapterVersion };
}

export async function runProviderConformanceSuite(options: ProviderConformanceOptions = {}): Promise<ProviderConformanceSuiteResult> {
  const results: ProviderConformanceResult[] = [];
  for (const providerId of ['openai-images', 'gemini-image', 'gemini-openai-compatible', 'xai-grok-image'] as const) {
    results.push(await runProviderConformance(providerId, options));
  }
  return {
    status: results.every((result) => result.status === 'pass') ? 'pass' : 'fail',
    results,
    descriptorVersion: PROVIDER_DESCRIPTOR_VERSION,
    adapterVersion: PROVIDER_ADAPTER_VERSION
  };
}

/**
 * Real endpoint canaries are deliberately outside this offline runner. A caller
 * must explicitly opt in and inject its transport before any canary abstraction
 * may be used; this guard prevents accidental fallback to global fetch.
 */
export function assertProviderCanaryOptIn(options: { enabled?: boolean; transport?: HttpAdapterDependencies } = {}): void {
  if (options.enabled !== true) throw new Error('provider_canary_opt_in_required');
  if (!options.transport || !options.transport.fetch || options.transport.fetch === globalThis.fetch) throw new Error('provider_canary_transport_required');
}
export const runAllProviderConformance = runProviderConformanceSuite;
