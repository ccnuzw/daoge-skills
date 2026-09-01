import { ImageOperation, ImageProvider, ImageProviderCapabilities, ImageRequest, ImageRequestContext, ImageResult, ProviderError, ProviderValidationResult, staticCapabilitiesForProvider } from './contracts';
import { ProviderId, ResolvedProviderConfig } from '../studio/provider-config';
import { OutputTransport, resolveOutputSpec } from './output-spec';
import { decodeBoundedBase64, downloadHttpResource, HostResolver, HttpFetch, PinnedHttpTransport, readBoundedResponse } from './http-safety';

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * Math.ceil(MAX_DOWNLOAD_BYTES / 3) + 1024 * 1024;

interface HttpError extends Error { status?: number; }
interface ImagePayload { b64?: string; url?: string; revisedPrompt?: string; mediaType?: string; }

export interface HttpAdapterDependencies {
  fetch?: HttpFetch;
  downloadRequest?: PinnedHttpTransport;
  resolveHost?: HostResolver;
  maxDownloadRedirects?: number;
}

interface HttpTransport {
  fetch: HttpFetch;
  downloadRequest?: PinnedHttpTransport;
  resolveHost?: HostResolver;
  maxDownloadRedirects?: number;
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

function editEndpoint(baseUrl: string): string {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (/\/images\/(?:generations|edits)$/i.test(base)) return base.replace(/\/(?:generations|edits)$/i, '/edits');
  if (/\/v1$/i.test(base)) return base + '/images/edits';
  return base + '/v1/images/edits';
}

export function requestPathFor(config: ResolvedProviderConfig, operation: ImageOperation = 'generate'): string | null {
  try {
    const target = operation === 'edit' ? editEndpoint(config.baseUrl) : endpoint(config.baseUrl, config.providerId, config.model);
    return new URL(target).pathname || '/';
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
    response = await transport.fetch(target, { ...init, redirect: 'manual' });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new Error('Provider request failed before a response was received.');
  }
  await rejectRedirect(response);
  return response;
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
  const parts = /^(\d+)x(\d+)$/i.exec(transport.size || '');
  if (!parts) return result;
  const maxSide = Math.max(Number(parts[1]), Number(parts[2]));
  if (Math.abs(maxSide - 1024) <= 256) result.resolution = '1k';
  if (Math.abs(maxSide - 2048) <= 384) result.resolution = '2k';
  return result;
}

function requestBody(config: ResolvedProviderConfig, request: ImageRequest): Record<string, unknown> {
  const transport = outputTransport(config, request.output);
  if (config.providerId === 'gemini-image') {
    return { contents: [{ role: 'user', parts: [{ text: request.prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...(transport.aspectRatio ? { imageConfig: { aspectRatio: transport.aspectRatio } } : {}) } };
  }
  const body: Record<string, unknown> = { model: config.model, prompt: request.prompt, n: 1, size: transport.size || '1024x1024', response_format: 'b64_json' };
  if (config.providerId === 'xai-grok-image') Object.assign(body, xaiOptions(transport));
  return body;
}

async function readJson(response: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<Record<string, unknown>> {
  const buffer = await readBoundedResponse(response, maxBytes, 'Provider response exceeds the configured size limit.');
  const text = buffer.toString('utf8');
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { message: text.slice(0, 4096) }; }
}

function extractPayload(json: Record<string, unknown>, providerId: ProviderId): ImagePayload | null {
  if (providerId === 'gemini-image') {
    const candidates = Array.isArray(json.candidates) ? json.candidates as Array<Record<string, unknown>> : [];
    for (const candidate of candidates) {
      const content = candidate.content as Record<string, unknown> | undefined;
      const parts = Array.isArray(content?.parts) ? content?.parts as Array<Record<string, unknown>> : [];
      for (const part of parts) {
        const inline = (part.inlineData || part.inline_data) as Record<string, unknown> | undefined;
        if (typeof inline?.data === 'string') return { b64: inline.data, mediaType: imageMediaType(inline.mimeType || inline.mime_type), revisedPrompt: typeof part.text === 'string' ? part.text : undefined };
      }
    }
    return null;
  }
  const data = Array.isArray(json.data) ? json.data as Array<Record<string, unknown>> : [];
  const first = data[0] || json;
  if (typeof first.b64_json === 'string') return { b64: first.b64_json, revisedPrompt: typeof first.revised_prompt === 'string' ? first.revised_prompt : undefined };
  if (typeof first.base64 === 'string') return { b64: first.base64, revisedPrompt: typeof first.revised_prompt === 'string' ? first.revised_prompt : undefined };
  if (typeof first.url === 'string') return { url: first.url, revisedPrompt: typeof first.revised_prompt === 'string' ? first.revised_prompt : undefined };
  return null;
}

async function download(url: string, signal: AbortSignal, transport: HttpTransport): Promise<{ bytes: Buffer; mediaType: string }> {
  const result = await downloadHttpResource(url, {
    signal,
    maxBytes: MAX_DOWNLOAD_BYTES,
    request: transport.downloadRequest,
    resolveHost: transport.resolveHost,
    maxRedirects: transport.maxDownloadRedirects
  });
  return { bytes: result.bytes, mediaType: imageMediaType(result.contentType) };
}

function errorWithStatus(status: number, message: string): HttpError {
  const error = new Error('http ' + status + ': ' + message) as HttpError;
  error.status = status;
  return error;
}

function classify(error: unknown): ProviderError {
  const candidate = error as HttpError;
  const message = String(candidate?.message || error || 'Image Provider request failed.');
  const explicitStatus = Number.isInteger(candidate?.status) ? Number(candidate.status) : null;
  const match = /(?:http|status)\s+(\d{3})/i.exec(message);
  const status = explicitStatus || (match ? Number(match[1]) : null);
  const code = status ? 'http_' + status : 'provider_transport_error';
  if (/aborted|cancelled/i.test(message)) return { kind: 'cancelled', code, message };
  if (status === 429 || /resource_exhausted/i.test(message)) return { kind: 'rate_limited', code, message };
  if ((status !== null && [408, 409, 425, 500, 502, 503, 504].includes(status)) || /retryable|unavailable|deadline_exceeded|timed out/i.test(message)) return { kind: 'transient', code, message };
  if (status === 401 || status === 403 || /authentication failed|permission/i.test(message)) return { kind: 'permission', code, message };
  if ((status !== null && status >= 300 && status < 400) || status === 404 || /model or endpoint unavailable/i.test(message)) return { kind: 'invalid_config', code, message };
  if (status === 400 || status === 422 || /does not support|response format incompatible/i.test(message)) return { kind: 'invalid_request', code, message };
  return { kind: 'unknown_outcome', code, message };
}

function validateConfig(config: ResolvedProviderConfig): ProviderValidationResult {
  const missing: string[] = [];
  if (!config.baseUrl) missing.push('base_url');
  if (!config.apiKey) missing.push('api_key');
  if (!config.model) missing.push('model');
  return { valid: missing.length === 0, missing };
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
      maxDownloadRedirects: dependencies.maxDownloadRedirects
    };
  }
  validateConfig(config: ResolvedProviderConfig): ProviderValidationResult { return validateConfig(config); }
  capabilities(config: ResolvedProviderConfig): ImageProviderCapabilities { return staticCapabilitiesForProvider(config.providerId, config.referenceEnabled); }
  async generate(request: ImageRequest, context: ImageRequestContext): Promise<ImageResult> {
    const validation = validateConfig(this.config);
    if (!validation.valid) throw new Error('Provider configuration is incomplete: ' + validation.missing.join(', '));
    const timeout = Math.min(10 * 60 * 1000, Math.max(1000, Number(request.output.timeoutMs || 120000)));
    const signal = AbortSignal.any([context.abortSignal, AbortSignal.timeout(timeout)]);
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    if (this.config.providerId === 'gemini-image') headers['x-goog-api-key'] = this.config.apiKey;
    else headers.authorization = 'Bearer ' + this.config.apiKey;
    const target = endpoint(this.config.baseUrl, this.config.providerId, this.config.model);
    const response = await credentialedFetch(this.transport, target, { method: 'POST', headers, body: JSON.stringify(requestBody(this.config, request)), signal });
    const json = await readJson(response);
    if (!response.ok) throw errorWithStatus(response.status, String((json.error as Record<string, unknown> | undefined)?.message || json.message || 'Provider request failed.'));
    const payload = extractPayload(json, this.config.providerId);
    if (!payload) throw new Error('Provider response did not include image bytes.');
    const source = payload.b64 ? { bytes: decodeBoundedBase64(payload.b64, MAX_DOWNLOAD_BYTES), mediaType: payload.mediaType || 'image/png' } : await download(String(payload.url), signal, this.transport);
    if (!source.bytes.length) throw new Error('Provider response returned empty image bytes.');
    const providerRequestId = response.headers.get('x-request-id') || response.headers.get('request-id') || undefined;
    return { bytes: source.bytes, mediaType: source.mediaType, revisedPrompt: payload.revisedPrompt, externalRequestId: providerRequestId, safeMeta: { responseModel: this.config.model, outputFormat: source.mediaType, requestPath: requestPathFor(this.config), responseStatus: response.status, ...(providerRequestId ? { providerRequestId } : {}) } };
  }
  async edit(request: ImageRequest, context: ImageRequestContext): Promise<ImageResult> {
    const validation = validateConfig(this.config);
    if (!validation.valid) throw new Error('Provider configuration is incomplete: ' + validation.missing.join(', '));
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
    } else {
      throw errorWithStatus(422, 'The selected Provider does not support this managed reference or mask edit.');
    }
    const json = await readJson(response);
    if (!response.ok) throw errorWithStatus(response.status, String((json.error as Record<string, unknown> | undefined)?.message || json.message || 'Provider edit request failed.'));
    const payload = extractPayload(json, this.config.providerId);
    if (!payload) throw new Error('Provider edit response did not include image bytes.');
    const source = payload.b64 ? { bytes: decodeBoundedBase64(payload.b64, MAX_DOWNLOAD_BYTES), mediaType: payload.mediaType || 'image/png' } : await download(String(payload.url), signal, this.transport);
    if (!source.bytes.length) throw new Error('Provider edit response returned empty image bytes.');
    return { bytes: source.bytes, mediaType: source.mediaType, revisedPrompt: payload.revisedPrompt, externalRequestId: response.headers.get('x-request-id') || response.headers.get('request-id') || undefined, safeMeta: { responseModel: this.config.model, outputFormat: source.mediaType, managedReferenceCount: request.referenceAssets.length, usedMask: Boolean(request.maskAsset) } };
  }
  classifyError(error: unknown): ProviderError { return classify(error); }
}

export function createImageProvider(config: ResolvedProviderConfig, dependencies: HttpAdapterDependencies = {}): ImageProvider { return new HttpImageProvider(config, dependencies); }
