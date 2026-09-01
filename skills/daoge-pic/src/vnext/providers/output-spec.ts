import { ProviderId } from '../studio/provider-config';

export interface OutputTransport {
  size?: string;
  aspectRatio?: string;
}

export interface ResolvedOutputSpec {
  ok: true;
  output: Record<string, unknown>;
  transport: OutputTransport;
}

export interface OutputSpecError {
  ok: false;
  code: 'invalid_output_size' | 'invalid_output_resolution' | 'invalid_aspect_ratio' | 'inconsistent_output_spec' | 'aspect_requires_explicit_size';
  message: string;
  field: 'output.size' | 'output.resolution' | 'output.aspectRatio';
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function gcd(left: number, right: number): number { return right ? gcd(right, left % right) : left; }

function canonicalAspectRatio(value: unknown): string | null {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(typeof value === 'string' ? value.trim() : '');
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return null;
  const divisor = gcd(width, height);
  return width / divisor + ':' + height / divisor;
}

function parseSize(value: unknown): { value: string; width: number; height: number } | null {
  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(typeof value === 'string' ? value.trim() : '');
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width && height ? { value: width + 'x' + height, width, height } : null;
}

function sizeMatchesAspectRatio(size: { width: number; height: number }, ratio: string): boolean {
  const [width, height] = ratio.split(':').map(Number);
  return size.width * height === size.height * width;
}

function parseResolution(value: unknown): { value: string; longestEdge: number } | null {
  const match = /^(\d{1,2})k$/i.exec(typeof value === 'string' ? value.trim() : '');
  if (!match) return null;
  const multiplier = Number(match[1]);
  if (!multiplier) return null;
  return { value: multiplier + 'K', longestEdge: multiplier * 1024 };
}

function sizeForResolution(resolution: { longestEdge: number }, ratio: string | null): { value: string; width: number; height: number } | null {
  if (!ratio) return { value: resolution.longestEdge + 'x' + resolution.longestEdge, width: resolution.longestEdge, height: resolution.longestEdge };
  const [width, height] = ratio.split(':').map(Number);
  const unit = Math.floor(resolution.longestEdge / Math.max(width, height));
  if (!unit) return null;
  const resolvedWidth = width * unit;
  const resolvedHeight = height * unit;
  return { value: resolvedWidth + 'x' + resolvedHeight, width: resolvedWidth, height: resolvedHeight };
}

export function resolveOutputSpec(input: { providerId: ProviderId; model: string; output?: Record<string, unknown> }): ResolvedOutputSpec | OutputSpecError {
  const output = record(input.output);
  const rawSize = output.size ?? output.dimensions;
  const explicitSize = rawSize === undefined || rawSize === null || rawSize === '' ? null : parseSize(rawSize);
  if (rawSize !== undefined && rawSize !== null && rawSize !== '' && !explicitSize) {
    return { ok: false, code: 'invalid_output_size', message: '输出尺寸必须使用例如 1024x1024 的格式。', field: 'output.size' };
  }
  if (output.size && output.dimensions && String(output.size).trim() !== String(output.dimensions).trim()) {
    return { ok: false, code: 'inconsistent_output_spec', message: '输出尺寸与 dimensions 不能同时指定为不同值。', field: 'output.size' };
  }
  const rawResolution = output.resolution;
  const resolution = rawResolution === undefined || rawResolution === null || rawResolution === '' ? null : parseResolution(rawResolution);
  if (rawResolution !== undefined && rawResolution !== null && rawResolution !== '' && !resolution) {
    return { ok: false, code: 'invalid_output_resolution', message: '输出分辨率必须使用例如 1K 或 2K 的格式。', field: 'output.resolution' };
  }
  const rawRatio = output.aspectRatio;
  const aspectRatio = rawRatio === undefined || rawRatio === null || rawRatio === '' ? null : canonicalAspectRatio(rawRatio);
  if (rawRatio !== undefined && rawRatio !== null && rawRatio !== '' && !aspectRatio) {
    return { ok: false, code: 'invalid_aspect_ratio', message: '输出画幅必须使用例如 1:1、4:5 或 16:9 的正整数比例。', field: 'output.aspectRatio' };
  }
  const resolutionSize = resolution ? sizeForResolution(resolution, aspectRatio) : null;
  if (resolution && !resolutionSize) {
    return { ok: false, code: 'invalid_output_resolution', message: '无法将输出分辨率转换为有效尺寸。', field: 'output.resolution' };
  }
  if (explicitSize && resolutionSize && explicitSize.value !== resolutionSize.value) {
    return { ok: false, code: 'inconsistent_output_spec', message: '输出尺寸与 resolution 归一化后的尺寸不一致。', field: 'output.size' };
  }
  const size = explicitSize || resolutionSize;
  if (size && aspectRatio && !sizeMatchesAspectRatio(size, aspectRatio)) {
    return { ok: false, code: 'inconsistent_output_spec', message: '输出尺寸与画幅比例不一致。', field: 'output.aspectRatio' };
  }
  // OpenAI-compatible image endpoints receive a concrete size rather than an aspect-ratio field.
  if (input.providerId === 'openai-images' && aspectRatio && aspectRatio !== '1:1' && !size) {
    return { ok: false, code: 'aspect_requires_explicit_size', message: '当前 Provider 需要用明确尺寸传递非方形画幅。', field: 'output.size' };
  }
  const normalizedOutput: Record<string, unknown> = { ...output };
  if (size) { normalizedOutput.size = size.value; delete normalizedOutput.dimensions; }
  if (resolution) normalizedOutput.resolution = resolution.value;
  if (aspectRatio) normalizedOutput.aspectRatio = aspectRatio;
  const transport: OutputTransport = {};
  if (input.providerId === 'gemini-image') {
    if (aspectRatio) transport.aspectRatio = aspectRatio;
  } else if (input.providerId === 'xai-grok-image') {
    transport.size = size?.value || '1024x1024';
    if (aspectRatio) transport.aspectRatio = aspectRatio;
  } else if (input.providerId === 'gemini-openai-compatible') {
    transport.size = size?.value || aspectRatio || '1024x1024';
  } else {
    transport.size = size?.value || '1024x1024';
  }
  return { ok: true, output: normalizedOutput, transport };
}
