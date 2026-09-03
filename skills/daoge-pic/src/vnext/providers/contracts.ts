import { ProviderId, ResolvedProviderConfig } from '../studio/provider-config';

export type ImageOperation = 'generate' | 'edit';
export const MAX_IMAGE_REQUEST_REFERENCE_ASSETS = 8;
export const MAX_IMAGE_REQUEST_MEDIA_BYTES = 64 * 1024 * 1024;
export const MAX_IMAGE_REQUEST_CACHED_MEDIA_BYTES = 256 * 1024 * 1024;
export type ProviderErrorKind = 'transient' | 'rate_limited' | 'unknown_outcome' | 'invalid_request' | 'invalid_config' | 'missing_asset' | 'permission' | 'unsupported' | 'cancelled';

export interface ImageProviderCapabilities {
  textToImage: boolean;
  referenceEdit: boolean;
  maskEdit: boolean;
  cancellation: boolean;
  reconciliation: boolean;
  idempotency: boolean;
  acceptedReferenceMediaTypes: string[];
}

export interface ProviderValidationResult {
  valid: boolean;
  missing: string[];
}

export interface ProviderError {
  kind: ProviderErrorKind;
  code: string;
  message: string;
  retryAfterMs?: number;
}

export interface ImageRequest {
  requestId: string;
  idempotencyKey: string;
  prompt: string;
  output: Record<string, unknown>;
  referenceAssets: Array<{ assetId: string; mediaType: string; bytes: Buffer }>;
  maskAsset?: { assetId: string; mediaType: string; bytes: Buffer };
}

export interface ImageRequestContext {
  abortSignal: AbortSignal;
}

export interface ImageResult {
  bytes: Buffer;
  mediaType: string;
  externalRequestId?: string;
  revisedPrompt?: string;
  safeMeta?: Record<string, unknown>;
}

export interface ImageProvider {
  id: ProviderId;
  validateConfig(config: ResolvedProviderConfig): ProviderValidationResult;
  capabilities(config: ResolvedProviderConfig): ImageProviderCapabilities;
  generate(request: ImageRequest, context: ImageRequestContext): Promise<ImageResult>;
  edit?(request: ImageRequest, context: ImageRequestContext): Promise<ImageResult>;
  classifyError(error: unknown): ProviderError;
  cancel?(externalRequestId: string, context: ImageRequestContext): Promise<void>;
  reconcile?(externalRequestId: string, context: ImageRequestContext): Promise<ImageResult | null>;
}

const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function staticCapabilitiesForProvider(providerId: ProviderId, referenceEnabled = false): ImageProviderCapabilities {
  if (providerId === 'openai-images') {
    return { textToImage: true, referenceEdit: true, maskEdit: true, cancellation: false, reconciliation: false, idempotency: false, acceptedReferenceMediaTypes: IMAGE_MEDIA_TYPES };
  }
  if (providerId === 'gemini-image') {
    return { textToImage: true, referenceEdit: referenceEnabled, maskEdit: false, cancellation: false, reconciliation: false, idempotency: false, acceptedReferenceMediaTypes: IMAGE_MEDIA_TYPES };
  }
  return { textToImage: true, referenceEdit: false, maskEdit: false, cancellation: false, reconciliation: false, idempotency: false, acceptedReferenceMediaTypes: IMAGE_MEDIA_TYPES };
}

export function classifyProviderFailure(error: unknown): ProviderError {
  const value = error as { status?: number; code?: string; message?: string };
  const status = Number(value && value.status);
  const code = String((value && value.code) || 'provider_error');
  const message = String((value && value.message) || 'Image provider request failed.');
  if (status === 429) return { kind: 'rate_limited', code, message };
  if (status >= 500 || status === 408 || status === 425) return { kind: 'transient', code, message };
  if (status === 401 || status === 403) return { kind: 'permission', code, message };
  if (status === 400 || status === 422) return { kind: 'invalid_request', code, message };
  return { kind: 'unknown_outcome', code, message };
}
