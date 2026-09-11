import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ImageOperation, ImageProvider, ImageProviderCapabilities, ImageRequest, ImageRequestContext, ImageResult, ProviderError, ProviderModelSummary, ProviderValidationResult, staticCapabilitiesForProvider } from './contracts';
import { ProviderId, ResolvedProviderConfig } from '../studio/provider-config';
import { providerDescriptor, providerEndpointPolicyIssues } from './descriptors';
import { OutputTransport, resolveOutputSpec } from './output-spec';
import { HostResolver, HttpFetch, PinnedHttpTransport, PrivateAddressPolicy, downloadHttpResourceToFile, readJsonImageResponseToFile, readBoundedResponse, requestPinnedHttpEndpoint } from './http-safety';

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * Math.ceil(MAX_DOWNLOAD_BYTES / 3) + 1024 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;
const MAX_MODELS_RESPONSE_BYTES = 512 * 1024;
const MAX_IN_MEMORY_IMAGE_BYTES = 1024 * 1024;
const XAI_DESCRIPTOR = providerDescriptor('xai-grok-image');

interface HttpError extends Error { status?: number; retryAfterMs?: number; code?: string; }
interface ImageSource { bytes?: Buffer; filePath?: string; byteSize?: number; mediaType: string; revisedPrompt?: string; safeMeta?: Record<string, unknown>; }

export interface HttpAdapterDependencies {
  fetch?: HttpFetch;
  downloadRequest?: PinnedHttpTransport;
  resolveHost?: HostResolver;
  maxDownloadRedirects?: number;
  allowPrivate?: boolean;
  privateAddressPolicy?: PrivateAddressPolicy;
}

interface HttpTransport {
  fetch: HttpFetch;
  downloadRequest?: PinnedHttpTransport;
  resolveHost?: HostResolver;
  maxDownloadRedirects?: number;
  privateAddressPolicy: PrivateAddressPolicy | null;
}


function endpoint(baseUrl: string, providerId: ProviderId, model: string): string {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('Provider base URL is required.');
  if (providerId === 'gemini-image') {
    if (/\/models\/[^/]+:generateContent$/i.test(base)) return base;
    const name = encodeURIComponent(String(model || '').trim().replace(/^models\//, ''));
    if (!name) throw new Error('Gemini model is required.');
    if (/\/v1(?:beta)?$/i.test(base)) return base + '/models/' + name + ':generateContent';
    return base + '/v1beta/models/' + name + ':generateContent';
  }
  if (/\/images\/generations$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return base + '/images/generations';
  return base + '/v1/images/generations';
}

function modelsEndpoint(baseUrl: string, providerId: ProviderId): string {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('Provider base URL is required.');
  if (providerId === 'gemini-image') {
    if (/\/models\/[^/]+:generateContent$/i.test(base)) return base.replace(/\/models\/[^/]+:generateContent$/i, '/models');
    if (/\/v1(?:beta)?$/i.test(base)) return base + '/models';
    return base + '/v1beta/models';
  }
  if (/\/models$/i.test(base)) return base;
  if (/\/images\/(?:generations|edits)$/i.test(base)) return base.replace(/\/images\/(?:generations|edits)$/i, '/models');
  if (/\/v1$/i.test(base)) return base + '/models';
  return base + '/v1/models';
}

function credentialHeaders(config: ResolvedProviderConfig, contentType = false): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (contentType) headers['content-type'] = 'application/json';
  if (config.providerId === 'gemini-image') headers['x-goog-api-key'] = config.apiKey;
  else headers.authorization = 'Bearer ' + config.apiKey;
  return headers;
}
function privateAddressPolicyFor(config: ResolvedProviderConfig): PrivateAddressPolicy | null {
  if (!config.endpointTrustMode) return 'local_proxy';
  if (config.endpointTrustMode === 'local_proxy') return 'local_proxy';
  if (config.endpointTrustMode === 'enterprise_private') return 'enterprise_private';
  return null;
}

function editEndpoint(baseUrl: string): string {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (/\/images\/(?:generations|edits)$/i.test(base)) return base.replace(/\/(?:generations|edits)$/i, '/edits');
  if (/\/v1$/i.test(base)) return base + '/images/edits';
  return base + '/v1/images/edits';
}
export function requestEndpointFor(config: ResolvedProviderConfig, operation: ImageOperation = 'generate'): string | null {
  try {
    return operation === 'edit' ? editEndpoint(config.baseUrl) : endpoint(config.baseUrl, config.providerId, config.model);
  } catch {
    return null;
  }
}

export function requestPathFor(config: ResolvedProviderConfig, operation: ImageOperation = 'generate'): string | null {
  try {
    const target = requestEndpointFor(config, operation);
    return target ? new URL(target).pathname || '/' : null;
  } catch {
    return null;
  }
}

async function rejectRedirect(response: Response): Promise<void> {
  if (response.status >= 300 && response.status < 400) {
    if (response.body && !response.body.locked) await response.body.cancel().catch(() => undefined);
    throw errorWithStatus(response.status, 'Provider credentialed endpoint redirected; configure the final API endpoint directly.');
  }
}

async function credentialedFetch(transport: HttpTransport, target: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    if (transport.fetch === globalThis.fetch) {
      const request = new Request(target, { ...init, redirect: 'manual' });
      const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : new Uint8Array(await request.arrayBuffer());
      const headers: Record<string, string> = {};
      request.headers.forEach((value, name) => { headers[name] = value; });
      const result = await requestPinnedHttpEndpoint(target, { signal: request.signal, headers, method: request.method, body, privateAddressPolicy: transport.privateAddressPolicy || undefined, request: transport.downloadRequest, resolveHost: transport.resolveHost });
      response = result.response;
    } else {
      response = await transport.fetch(target, { ...init, redirect: 'manual' });
    }
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new Error('Provider request failed before a response was received.');
  }
  await rejectRedirect(response);
  return response;
}

async function credentialedModelListFetch(transport: HttpTransport, target: string, headers: Record<string, string>, signal: AbortSignal): Promise<Response> {
  return credentialedFetch(transport, target, { method: 'GET', headers, signal });
}

function extension(mediaType: string): string { if (mediaType === 'image/jpeg') return '.jpg'; if (mediaType === 'image/webp') return '.webp'; if (mediaType === 'image/gif') return '.gif'; return '.png'; }

function imageMediaType(value: unknown): string {
  const text = String(value || '').toLowerCase();
  if (text.includes('jpeg') || text.includes('jpg')) return 'image/jpeg';
  if (text.includes('webp')) return 'image/webp';
  return 'image/png';
}

function outputTransport(config: ResolvedProviderConfig, output: Record<string, unknown>): OutputTransport {
  const resolved = resolveOutputSpec({ providerId: config.providerId, model: config.model, output });
  if (!resolved.ok) throw errorWithStatus(422, resolved.code + ': ' + resolved.message);
  return resolved.transport;
}

function xaiOptions(transport: OutputTransport): Record<string, string> {
  const result: Record<string, string> = {};
  if (transport.aspectRatio) result.aspect_ratio = transport.aspectRatio;
  if (transport.resolution) result.resolution = transport.resolution;
  if (transport.quality) result.quality = transport.quality;
  return result;
}

function xaiReferenceImage(reference: { assetId: string; mediaType: string; bytes: Buffer }): Record<string, string> {
  if (!XAI_DESCRIPTOR.reference.acceptedMediaTypes.includes(reference.mediaType)) throw errorWithStatus(422, 'Grok edit supports ' + XAI_DESCRIPTOR.reference.acceptedMediaTypes.join(', ') + ' reference assets only.');
  return { url: 'data:' + reference.mediaType + ';base64,' + reference.bytes.toString('base64') };
}

function xaiEditBody(config: ResolvedProviderConfig, request: ImageRequest, transport: OutputTransport): Record<string, unknown> {
  if (request.maskAsset) throw errorWithStatus(422, 'Grok edit does not support mask assets.');
  if (request.referenceAssets.length > XAI_DESCRIPTOR.reference.maxCount) throw errorWithStatus(422, 'Grok edit supports at most ' + XAI_DESCRIPTOR.reference.maxCount + ' reference assets.');
  const images = request.referenceAssets.map(xaiReferenceImage);
  return { model: config.model, prompt: request.prompt, n: 1, response_format: 'b64_json', ...xaiOptions(transport), ...(images.length === 1 ? { image: images[0] } : { images }) };
}

function requestBody(config: ResolvedProviderConfig, request: ImageRequest): Record<string, unknown> {
  const transport = outputTransport(config, request.output);
  if (config.providerId === 'gemini-image') {
    return { contents: [{ role: 'user', parts: [{ text: request.prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...(transport.aspectRatio ? { imageConfig: { aspectRatio: transport.aspectRatio } } : {}) } };
  }
  if (config.providerId === 'xai-grok-image') return { model: config.model, prompt: request.prompt, n: 1, response_format: 'b64_json', ...xaiOptions(transport) };
  return { model: config.model, prompt: request.prompt, n: 1, size: transport.size || '1024x1024', response_format: 'b64_json' };
}

async function readJson(response: Response, signal: AbortSignal, maxBytes = MAX_RESPONSE_BYTES): Promise<Record<string, unknown>> {
  const buffer = await readBoundedResponse(response, maxBytes, 'Provider response exceeds the configured size limit.', signal);
  const text = buffer.toString('utf8');
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { message: text.slice(0, 4096) }; }
}

function providerModelSummaries(config: ResolvedProviderConfig, json: Record<string, unknown>): ProviderModelSummary[] {
  const rows = config.providerId === 'gemini-image' ? json.models : json.data;
  if (!Array.isArray(rows)) return [];
  const models: ProviderModelSummary[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    const id = String(record.id || record.name || '').trim();
    if (!id) continue;
    if (config.providerId === 'gemini-image') {
      const methods = Array.isArray(record.supportedGenerationMethods) ? record.supportedGenerationMethods.filter((method): method is string => typeof method === 'string') : [];
      if (methods.length && !methods.includes('generateContent')) continue;
      const label = String(record.displayName || id.replace(/^models\//, '')).trim() || id;
      models.push({ id, label, ownedBy: methods.length ? methods.join(', ') : null });
      continue;
    }
    models.push({ id, label: id, ownedBy: typeof record.owned_by === 'string' ? record.owned_by : null });
  }
  return models.slice(0, 200);
}

async function imageSourceFromResponse(response: Response, signal: AbortSignal, transport: HttpTransport): Promise<ImageSource> {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'daoge-pic-provider-'));
  const filePath = path.join(directory, 'result.part');
  try {
    const parsed = await readJsonImageResponseToFile(response, filePath, MAX_RESPONSE_BYTES, MAX_DOWNLOAD_BYTES, signal);
    let mediaType = imageMediaType(parsed.mediaType || 'image/png');
    let byteSize = Number(parsed.byteSize) || 0;
    if (!parsed.filePath) {
      if (!parsed.url) throw new Error('Provider response did not include image bytes.');
      const downloaded = await downloadHttpResourceToFile(parsed.url, filePath, { signal, maxBytes: MAX_DOWNLOAD_BYTES, request: transport.downloadRequest, resolveHost: transport.resolveHost, maxRedirects: transport.maxDownloadRedirects });
      mediaType = imageMediaType(downloaded.contentType);
      byteSize = downloaded.byteSize;
    }
    if (!byteSize) {
      const stat = await fsp.stat(filePath);
      byteSize = stat.size;
    }
    if (!byteSize) throw new Error('Provider response returned empty image bytes.');
    const safeMeta = { ...(parsed.responseModel ? { responseModel: parsed.responseModel } : {}), ...(parsed.usage ? { usage: parsed.usage } : {}) };
    if (byteSize <= MAX_IN_MEMORY_IMAGE_BYTES) {
      const bytes = await fsp.readFile(filePath);
      await fsp.rm(directory, { recursive: true, force: true });
      return { bytes, byteSize: bytes.length, mediaType, revisedPrompt: parsed.revisedPrompt, safeMeta };
    }
    return { filePath, byteSize, mediaType, revisedPrompt: parsed.revisedPrompt, safeMeta };
  } catch (error) {
    await fsp.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60 * 60 * 1000, Math.round(seconds * 1000));
  const when = Date.parse(value);
  if (!Number.isFinite(when)) return undefined;
  return Math.min(60 * 60 * 1000, Math.max(0, when - Date.now()));
}

function providerErrorCode(json: Record<string, unknown> | null | undefined): string | undefined {
  const error = json?.error;
  if (error && typeof error === 'object' && !Array.isArray(error) && 'code' in error && typeof error.code === 'string') return error.code;
  if (typeof json?.code === 'string') return json.code;
  return undefined;
}

function errorWithStatus(status: number, message: string, details: { retryAfterMs?: number; code?: string } = {}): HttpError {
  const error = new Error('http ' + status + ': ' + message) as HttpError;
  error.status = status;
  error.retryAfterMs = details.retryAfterMs;
  error.code = details.code;
  return error;
}

function classify(error: unknown): ProviderError {
  const candidate = error as HttpError;
  const message = String(candidate?.message || error || 'Image Provider request failed.');
  const explicitStatus = Number.isInteger(candidate?.status) ? Number(candidate.status) : null;
  const match = /(?:http|status)\s+(\d{3})/i.exec(message);
  const status = explicitStatus || (match ? Number(match[1]) : null);
  const code = candidate?.code || (status ? 'http_' + status : 'provider_transport_error');
  const retryAfter = Number.isFinite(candidate?.retryAfterMs) ? Number(candidate.retryAfterMs) : undefined;
  if (/aborted|cancelled/i.test(message)) return { kind: 'cancelled', code, message };
  if (status === 429 || /resource_exhausted|rate_limit/i.test(message) || /rate[_-]?limit|resource[_-]?exhausted/i.test(code)) return { kind: 'rate_limited', code, message, ...(retryAfter ? { retryAfterMs: retryAfter } : {}) };
  if ((status !== null && [408, 409, 425, 500, 502, 503, 504].includes(status)) || /retryable|unavailable|deadline_exceeded|timed out/i.test(message)) return { kind: 'transient', code, message, ...(retryAfter ? { retryAfterMs: retryAfter } : {}) };
  if (status === 401 || status === 403 || /authentication failed|permission|permission_denied|invalid_api_key/i.test(message) || /permission|auth|api[_-]?key/i.test(code)) return { kind: 'permission', code, message };
  if ((status !== null && status >= 300 && status < 400) || status === 404 || /model or endpoint unavailable|model_not_found/i.test(message) || /model|endpoint/i.test(code)) return { kind: 'invalid_config', code, message };
  if (status === 400 || status === 422 || /does not support|response format incompatible/i.test(message)) return { kind: 'invalid_request', code, message };
  return { kind: 'unknown_outcome', code, message };
}

function validateConfig(config: ResolvedProviderConfig): ProviderValidationResult {
  const missing: string[] = [];
  if (!config.baseUrl) missing.push('base_url');
  if (!config.apiKey) missing.push('api_key');
  if (!config.model) missing.push('model');
  const errors = config.baseUrl && config.endpointTrustMode
    ? providerEndpointPolicyIssues(config.providerId, config.baseUrl, config.endpointTrustMode).filter((issue) => issue.level === 'error').map((issue) => issue.code)
    : [];
  return { valid: missing.length === 0 && errors.length === 0, missing, ...(errors.length ? { errors } : {}) };
}

class HttpImageProvider implements ImageProvider {
  readonly id: ProviderId;
  private readonly config: ResolvedProviderConfig;
  private readonly transport: HttpTransport;

  constructor(config: ResolvedProviderConfig, dependencies: HttpAdapterDependencies = {}) {
    this.id = config.providerId;
    this.config = config;
    this.transport = {
      fetch: dependencies.fetch || globalThis.fetch,
      downloadRequest: dependencies.downloadRequest,
      resolveHost: dependencies.resolveHost,
      maxDownloadRedirects: dependencies.maxDownloadRedirects,
      privateAddressPolicy: dependencies.privateAddressPolicy || (dependencies.allowPrivate ? 'enterprise_private' : privateAddressPolicyFor(config))
    };
  }
  validateConfig(config: ResolvedProviderConfig): ProviderValidationResult { return validateConfig(config); }
  capabilities(config: ResolvedProviderConfig): ImageProviderCapabilities { return staticCapabilitiesForProvider(config.providerId, config.referenceEnabled); }
  async generate(request: ImageRequest, context: ImageRequestContext): Promise<ImageResult> {
    const validation = validateConfig(this.config);
    if (!validation.valid) throw new Error('Provider configuration is invalid: ' + [...validation.missing, ...(validation.errors || [])].join(', '));
    const timeout = Math.min(10 * 60 * 1000, Math.max(1000, Number(request.output.timeoutMs || 120000)));
    const signal = AbortSignal.any([context.abortSignal, AbortSignal.timeout(timeout)]);
    const headers = credentialHeaders(this.config, true);
    const target = endpoint(this.config.baseUrl, this.config.providerId, this.config.model);
    const response = await credentialedFetch(this.transport, target, { method: 'POST', headers, body: JSON.stringify(requestBody(this.config, request)), signal });
    const json = response.ok ? null : await readJson(response, signal, MAX_ERROR_RESPONSE_BYTES);
    if (!response.ok) throw errorWithStatus(response.status, String((json?.error as Record<string, unknown> | undefined)?.message || json?.message || 'Provider request failed.'), { retryAfterMs: retryAfterMs(response), code: providerErrorCode(json) });
    const source = await imageSourceFromResponse(response, signal, this.transport);
    const providerRequestId = response.headers.get('x-request-id') || response.headers.get('request-id') || undefined;
    return { ...source, externalRequestId: providerRequestId, safeMeta: { ...(source.safeMeta || {}), responseModel: (source.safeMeta || {}).responseModel || this.config.model, outputFormat: source.mediaType, requestPath: requestPathFor(this.config), responseStatus: response.status, ...(providerRequestId ? { providerRequestId } : {}) } };
  }
  async edit(request: ImageRequest, context: ImageRequestContext): Promise<ImageResult> {
    const validation = validateConfig(this.config);
    if (!validation.valid) throw new Error('Provider configuration is invalid: ' + [...validation.missing, ...(validation.errors || [])].join(', '));
    if (!request.referenceAssets.length) throw errorWithStatus(422, 'An edit request requires at least one managed reference asset.');
    const timeout = Math.min(10 * 60 * 1000, Math.max(1000, Number(request.output.timeoutMs || 120000)));
    const output = outputTransport(this.config, request.output);
    const signal = AbortSignal.any([context.abortSignal, AbortSignal.timeout(timeout)]);
    let response: Response;
    if (this.config.providerId === 'openai-images') {
      const body = new FormData();
      body.set('model', this.config.model);
      body.set('prompt', request.prompt);
      body.set('n', '1');
      body.set('size', output.size || '1024x1024');
      body.set('response_format', 'b64_json');
      for (const reference of request.referenceAssets) body.append('image', new Blob([new Uint8Array(reference.bytes)], { type: reference.mediaType }), reference.assetId + extension(reference.mediaType));
      if (request.maskAsset) body.set('mask', new Blob([new Uint8Array(request.maskAsset.bytes)], { type: request.maskAsset.mediaType }), request.maskAsset.assetId + '.png');
      response = await credentialedFetch(this.transport, editEndpoint(this.config.baseUrl), { method: 'POST', headers: { authorization: 'Bearer ' + this.config.apiKey, accept: 'application/json' }, body, signal });
    } else if (this.config.providerId === 'gemini-image' && this.config.referenceEnabled && !request.maskAsset) {
      const parts: Array<Record<string, unknown>> = [{ text: request.prompt }];
      for (const reference of request.referenceAssets) parts.push({ inlineData: { data: reference.bytes.toString('base64'), mimeType: reference.mediaType } });
      response = await credentialedFetch(this.transport, endpoint(this.config.baseUrl, this.config.providerId, this.config.model), { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'x-goog-api-key': this.config.apiKey }, body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...(output.aspectRatio ? { imageConfig: { aspectRatio: output.aspectRatio } } : {}) } }), signal });
    } else if (this.config.providerId === 'xai-grok-image') {
      response = await credentialedFetch(this.transport, editEndpoint(this.config.baseUrl), { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer ' + this.config.apiKey }, body: JSON.stringify(xaiEditBody(this.config, request, output)), signal });
    } else {
      throw errorWithStatus(422, 'The selected Provider does not support this managed reference or mask edit.');
    }
    const json = response.ok ? null : await readJson(response, signal, MAX_ERROR_RESPONSE_BYTES);
    if (!response.ok) throw errorWithStatus(response.status, String((json?.error as Record<string, unknown> | undefined)?.message || json?.message || 'Provider edit request failed.'), { retryAfterMs: retryAfterMs(response), code: providerErrorCode(json) });
    const source = await imageSourceFromResponse(response, signal, this.transport);
    const providerRequestId = response.headers.get('x-request-id') || response.headers.get('request-id') || undefined;
    return { ...source, externalRequestId: providerRequestId, safeMeta: { ...(source.safeMeta || {}), responseModel: (source.safeMeta || {}).responseModel || this.config.model, outputFormat: source.mediaType, requestPath: requestPathFor(this.config, 'edit'), responseStatus: response.status, managedReferenceCount: request.referenceAssets.length, usedMask: Boolean(request.maskAsset), ...(providerRequestId ? { providerRequestId } : {}) } };
  }
  async listModels(context: ImageRequestContext): Promise<ProviderModelSummary[]> {
    const validation = validateConfig(this.config);
    if (!validation.valid) throw new Error('Provider configuration is invalid: ' + [...validation.missing, ...(validation.errors || [])].join(', '));
    const timeout = Math.min(10 * 60 * 1000, Math.max(1000, Number(this.config.limits?.requestTimeoutMs || 30000)));
    const signal = AbortSignal.any([context.abortSignal, AbortSignal.timeout(timeout)]);
    const response = await credentialedModelListFetch(this.transport, modelsEndpoint(this.config.baseUrl, this.config.providerId), credentialHeaders(this.config), signal);
    const json = await readJson(response, signal, response.ok ? MAX_MODELS_RESPONSE_BYTES : MAX_ERROR_RESPONSE_BYTES);
    if (!response.ok) throw errorWithStatus(response.status, String((json?.error as Record<string, unknown> | undefined)?.message || json?.message || 'Provider model list request failed.'), { retryAfterMs: retryAfterMs(response), code: providerErrorCode(json) });
    return providerModelSummaries(this.config, json);
  }
  classifyError(error: unknown): ProviderError { return classify(error); }
}

export function createImageProvider(config: ResolvedProviderConfig, dependencies: HttpAdapterDependencies = {}): ImageProvider { return new HttpImageProvider(config, dependencies); }
