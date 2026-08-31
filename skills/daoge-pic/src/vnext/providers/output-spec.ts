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
  code: 'invalid_output_size' | 'invalid_aspect_ratio' | 'inconsistent_output_spec' | 'aspect_ratio_unsupported';
  message: string;
  field: 'output.size' | 'output.aspectRatio';
  supportedAspectRatios?: string[];
}

const SUPPORTED_ASPECT_RATIOS: Record<ProviderId, string[]> = {
  'openai-images': ['1:1'],
  'gemini-image': ['1:1', '4:3', '3:4', '16:9', '9:16'],
  'gemini-openai-compatible': ['1:1', '4:5', '5:4', '4:3', '3:4', '16:9', '9:16'],
  'xai-grok-image': ['1:1', '16:9', '9:16']
};

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

export function supportedAspectRatios(providerId: ProviderId): string[] { return [...SUPPORTED_ASPECT_RATIOS[providerId]]; }

export function resolveOutputSpec(input: { providerId: ProviderId; model: string; output?: Record<string, unknown> }): ResolvedOutputSpec | OutputSpecError {
  const output = record(input.output);
  const rawSize = output.size ?? output.dimensions;
  const size = rawSize === undefined || rawSize === null || rawSize === '' ? null : parseSize(rawSize);
  if (rawSize !== undefined && rawSize !== null && rawSize !== '' && !size) {
    return { ok: false, code: 'invalid_output_size', message: '输出尺寸必须使用例如 1024x1024 的格式。', field: 'output.size' };
  }
  if (output.size && output.dimensions && String(output.size).trim() !== String(output.dimensions).trim()) {
    return { ok: false, code: 'inconsistent_output_spec', message: '输出尺寸与 dimensions 不能同时指定为不同值。', field: 'output.size' };
  }
  const rawRatio = output.aspectRatio;
  const aspectRatio = rawRatio === undefined || rawRatio === null || rawRatio === '' ? null : canonicalAspectRatio(rawRatio);
  if (rawRatio !== undefined && rawRatio !== null && rawRatio !== '' && !aspectRatio) {
    return { ok: false, code: 'invalid_aspect_ratio', message: '输出画幅必须使用例如 1:1、4:5 或 16:9 的正整数比例。', field: 'output.aspectRatio' };
  }
  if (size && aspectRatio && !sizeMatchesAspectRatio(size, aspectRatio)) {
    return { ok: false, code: 'inconsistent_output_spec', message: '输出尺寸与画幅比例不一致。', field: 'output.aspectRatio' };
  }
  if (aspectRatio && !SUPPORTED_ASPECT_RATIOS[input.providerId].includes(aspectRatio)) {
    return { ok: false, code: 'aspect_ratio_unsupported', message: '当前 Provider/模型不支持 ' + aspectRatio + ' 画幅。', field: 'output.aspectRatio', supportedAspectRatios: supportedAspectRatios(input.providerId) };
  }
  const normalizedOutput: Record<string, unknown> = { ...output };
  if (size) { normalizedOutput.size = size.value; delete normalizedOutput.dimensions; }
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
