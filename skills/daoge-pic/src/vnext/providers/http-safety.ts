import { lookup } from 'node:dns/promises';
import { once } from 'node:events';
import fsp from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import http, { IncomingMessage } from 'node:http';
import https from 'node:https';
import { isIP, LookupFunction, Socket } from 'node:net';
import { Readable } from 'node:stream';
import tls from 'node:tls';
import { proxyAuthorization, resolveProxyFor } from './proxy-config';

export type HttpFetch = typeof fetch;

export type HostResolver = (hostname: string, signal?: AbortSignal) => Promise<readonly string[]>;

export interface PinnedHttpResponse {
  response: Response;
  remoteAddress: string;
}

export interface PinnedRequestInit {
  signal: AbortSignal;
  headers: Readonly<Record<string, string>>;
  method?: string;
  body?: Uint8Array | string;
  /**
   * Proxy to dial instead of the target. When set, `addresses` are the proxy's
   * resolved addresses and the request is issued in proxy form (absolute URI
   * for HTTP, CONNECT tunnel for HTTPS).
   */
  proxy?: URL;
  /** Target addresses validated locally and used as the proxy destination. */
  targetAddresses?: readonly string[];
}

export type PinnedHttpTransport = (url: URL, addresses: readonly string[], init: PinnedRequestInit) => Promise<PinnedHttpResponse>;

export interface SafeDownloadOptions {
  signal: AbortSignal;
  maxBytes: number;
  maxRedirects?: number;
  request?: PinnedHttpTransport;
  resolveHost?: HostResolver;
  allowPrivate?: boolean;
  privateAddressPolicy?: PrivateAddressPolicy;
  /** Overrides the proxy resolved from the environment; `null` forces a direct request. */
  proxy?: URL | null;
}

export interface DownloadedResource {
  bytes: Buffer;
  contentType: string | null;
}

const DEFAULT_MAX_REDIRECTS = 5;
const DNS_TIMEOUT_MS = 10_000;

export const defaultHostResolver: HostResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => entry.address);
};

async function cancelBody(response: Response): Promise<void> {
  if (!response.body || response.body.locked) return;
  await response.body.cancel().catch(() => undefined);
}

function declaredLength(response: Response): number | null {
  const value = response.headers.get('content-length');
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : null;
}
async function readChunkWithAbort(reader: ReadableStreamDefaultReader<Uint8Array>, signal?: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) return reader.read();
  if (signal.aborted) throw signal.reason || new Error('Response read aborted.');
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason || new Error('Response read aborted.'));
    signal.addEventListener('abort', onAbort, { once: true });
    reader.read().then((result) => { signal.removeEventListener('abort', onAbort); resolve(result); }, (error) => { signal.removeEventListener('abort', onAbort); reject(error); });
  });
}

export async function readBoundedResponse(response: Response, maxBytes: number, limitMessage: string, signal?: AbortSignal): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('A non-negative response size limit is required.');
  const length = declaredLength(response);
  if (length !== null && length > maxBytes) {
    await cancelBody(response);
    throw new Error(limitMessage);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const output = length === null ? null : Buffer.allocUnsafe(length);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await readChunkWithAbort(reader, signal);
      if (result.done) break;
      const chunk = result.value;
      if (chunk.byteLength > maxBytes - total) {
        await reader.cancel().catch(() => undefined);
        throw new Error(limitMessage);
      }
      total += chunk.byteLength;
      if (output) Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).copy(output, total - chunk.byteLength);
      else chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    }
  } finally {
    reader.releaseLock();
  }
  return output ? output.subarray(0, total) : Buffer.concat(chunks, total);
}
export async function readResponseToFile(response: Response, destination: string, maxBytes: number, limitMessage: string, signal?: AbortSignal): Promise<number> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('A non-negative response size limit is required.');
  const length = declaredLength(response);
  if (length !== null && length > maxBytes) {
    await cancelBody(response);
    throw new Error(limitMessage);
  }
  if (!response.body) throw new Error('Response did not include a body.');
  const handle = await fsp.open(destination, 'wx', 0o600);
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const result = await readChunkWithAbort(reader, signal);
      if (result.done) break;
      const chunk = result.value;
      if (chunk.byteLength > maxBytes - total) {
        await reader.cancel().catch(() => undefined);
        throw new Error(limitMessage);
      }
      total += chunk.byteLength;
      let offset = 0;
      while (offset < chunk.byteLength) {
        const written = await handle.write(chunk, offset, chunk.byteLength - offset);
        if (!written.bytesWritten) throw new Error('Response could not be written completely.');
        offset += written.bytesWritten;
      }
    }
    await handle.sync();
    await handle.close();
    reader.releaseLock();
    return total;
  } catch (error) {
    reader.releaseLock();
    await handle.close().catch(() => undefined);
    await fsp.rm(destination, { force: true });
    throw error;
  }
}


type JsonImageCapture = 'base64' | 'url' | 'mediaType' | 'revisedPrompt' | 'responseModel' | 'usage';

export interface JsonImageFileResponse {
  filePath?: string;
  byteSize?: number;
  url?: string;
  mediaType?: string;
  revisedPrompt?: string;
  responseModel?: string;
  usage?: Record<string, unknown>;
}

function jsonCaptureForKey(value: string): JsonImageCapture | null {
  const key = value.trim();
  if (key === 'b64_json' || key === 'base64' || key === 'data') return 'base64';
  if (key === 'url') return 'url';
  if (key === 'mimeType' || key === 'mime_type' || key === 'mediaType') return 'mediaType';
  if (key === 'revised_prompt' || key === 'revisedPrompt') return 'revisedPrompt';
  if (key === 'model') return 'responseModel';
  if (key === 'usage') return 'usage';
  return null;
}

function decodeJsonEscape(value: string): string {
  if (value === 'n') return '\n';
  if (value === 'r') return '\r';
  if (value === 't') return '\t';
  if (value === 'b') return '\b';
  if (value === 'f') return '\f';
  if (value === '/' || value === '\\' || value === '"') return value;
  return value;
}

class Base64FileWriter {
  private carry = '';
  private total = 0;

  constructor(private readonly handle: FileHandle, private readonly maxBytes: number) {}

  get byteSize(): number { return this.total; }

  async append(value: string): Promise<void> {
    if (!value) return;
    const combined = this.carry + value;
    const firstPadding = combined.indexOf('=');
    const content = firstPadding < 0 ? combined : combined.slice(0, firstPadding);
    const padding = firstPadding < 0 ? '' : combined.slice(firstPadding);
    if (!/^[A-Za-z0-9+/]*$/.test(content) || (padding && !/^=+$/.test(padding))) throw new Error('Provider response included invalid base64 image data.');
    if (firstPadding >= 0) {
      this.carry = combined;
      return;
    }
    const completeLength = combined.length - (combined.length % 4);
    if (completeLength) await this.writeDecoded(combined.slice(0, completeLength));
    this.carry = combined.slice(completeLength);
  }

  async finish(): Promise<void> {
    const value = this.carry;
    const firstPadding = value.indexOf('=');
    const content = firstPadding < 0 ? value : value.slice(0, firstPadding);
    const padding = firstPadding < 0 ? '' : value.slice(firstPadding);
    if (!/^[A-Za-z0-9+/]*$/.test(content) || (padding && !/^=+$/.test(padding))) throw new Error('Provider response included invalid base64 image data.');
    if (content.length % 4 === 1 || (padding && value.length % 4 !== 0) || padding.length > 2) throw new Error('Provider response included invalid base64 image data.');
    if (value) await this.writeDecoded(value);
    this.carry = '';
  }

  private async writeDecoded(value: string): Promise<void> {
    const bytes = Buffer.from(value, 'base64');
    if (!bytes.length) return;
    if (this.total > this.maxBytes - bytes.length) throw new Error('Provider base64 image exceeds the configured size limit.');
    let offset = 0;
    while (offset < bytes.length) {
      const written = await this.handle.write(bytes, offset, bytes.length - offset);
      if (!written.bytesWritten) throw new Error('Provider image could not be written completely.');
      offset += written.bytesWritten;
    }
    this.total += bytes.length;
  }
}

export async function readJsonImageResponseToFile(response: Response, destination: string, maxBytes: number, maxDecodedBytes: number, signal?: AbortSignal): Promise<JsonImageFileResponse> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes < 0) throw new Error('Non-negative response size limits are required.');
  const length = declaredLength(response);
  if (length !== null && length > maxBytes) {
    await cancelBody(response);
    throw new Error('Provider response exceeds the configured size limit.');
  }
  if (!response.body) throw new Error('Provider response did not include a body.');
  const handle = await fsp.open(destination, 'wx', 0o600);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let inString = false;
  let escaped = false;
  // Collects the four hex digits of a \uXXXX escape. JSON encoders emit this form
  // for characters such as '&', and providers hand back long pre-signed URLs where
  // every '&' arrives as \u0026. Without decoding it the URL keeps a literal
  // "u0026" and the signature query parameters are destroyed.
  let unicodeEscape: string | null = null;
  let pendingString: string | null = null;
  let expectingValue = false;
  let nextCapture: JsonImageCapture | null = null;
  let activeCapture: JsonImageCapture | null = null;
  let current = '';
  let base64Chunk = '';
  let base64Writer: Base64FileWriter | null = null;
  let base64Found = false;
  let url: string | undefined;
  let mediaType: string | undefined;
  let revisedPrompt: string | undefined;
  let responseModel: string | undefined;
  let usage: Record<string, unknown> | undefined;
  let activeJsonCapture: { text: string; depth: number; inString: boolean; escaped: boolean } | null = null;
  const flushBase64 = async (): Promise<void> => {
    if (!base64Writer || !base64Chunk) return;
    await base64Writer.append(base64Chunk);
    base64Chunk = '';
  };
  const consume = async (text: string): Promise<void> => {
    for (const character of text) {
      if (activeJsonCapture) {
        if (activeJsonCapture.text.length < 8192) activeJsonCapture.text += character;
        if (activeJsonCapture.inString) {
          if (activeJsonCapture.escaped) activeJsonCapture.escaped = false;
          else if (character === '\\') activeJsonCapture.escaped = true;
          else if (character === '"') activeJsonCapture.inString = false;
        } else if (character === '"') activeJsonCapture.inString = true;
        else if (character === '{' || character === '[') activeJsonCapture.depth += 1;
        else if (character === '}' || character === ']') {
          activeJsonCapture.depth -= 1;
          if (!activeJsonCapture.depth) {
            try {
              const parsed = JSON.parse(activeJsonCapture.text) as unknown;
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) usage = parsed as Record<string, unknown>;
            } catch { /* ignore malformed optional metadata */ }
            activeJsonCapture = null;
          }
        }
        continue;
      }
      if (inString) {
        if (unicodeEscape !== null) {
          unicodeEscape += character;
          if (unicodeEscape.length === 4) {
            const codePoint = Number.parseInt(unicodeEscape, 16);
            unicodeEscape = null;
            if (!Number.isFinite(codePoint)) throw new Error('Provider response JSON contained an invalid unicode escape.');
            if (activeCapture === 'base64') throw new Error('Provider response included invalid base64 image data.');
            if (current.length < 16384) current += String.fromCharCode(codePoint);
          }
          continue;
        }
        if (escaped) {
          escaped = false;
          if (activeCapture === 'base64') throw new Error('Provider response included invalid base64 image data.');
          if (character === 'u') {
            unicodeEscape = '';
            continue;
          }
          current += decodeJsonEscape(character);
          continue;
        }
        if (character === '\\') {
          escaped = true;
          continue;
        }
        if (character === '"') {
          inString = false;
          if (activeCapture === 'base64') {
            await flushBase64();
            await base64Writer?.finish();
            base64Found = true;
          } else if (activeCapture === 'url' && !url) url = current;
          else if (activeCapture === 'mediaType' && !mediaType) mediaType = current;
          else if (activeCapture === 'revisedPrompt' && !revisedPrompt) revisedPrompt = current;
          else if (activeCapture === 'responseModel' && !responseModel) responseModel = current;
          else pendingString = current;
          activeCapture = null;
          current = '';
          expectingValue = false;
          nextCapture = null;
          continue;
        }
        if (activeCapture === 'base64') {
          base64Chunk += character;
          if (base64Chunk.length >= 65536) await flushBase64();
        } else if (current.length < 16384) current += character;
        continue;
      }
      if (character === '"') {
        inString = true;
        current = '';
        const capture = expectingValue ? nextCapture : null;
        activeCapture = capture === 'base64' && base64Writer ? null : capture === 'usage' ? null : capture;
        if (activeCapture === 'base64') base64Writer = new Base64FileWriter(handle, maxDecodedBytes);
        expectingValue = false;
        continue;
      }
      if (/\s/.test(character)) continue;
      if (character === ':' && pendingString !== null) {
        expectingValue = true;
        nextCapture = jsonCaptureForKey(pendingString);
        pendingString = null;
        continue;
      }
      if (expectingValue && nextCapture === 'usage' && character === '{') {
        activeJsonCapture = { text: '{', depth: 1, inString: false, escaped: false };
        expectingValue = false;
        nextCapture = null;
        pendingString = null;
        continue;
      }
      if (expectingValue) {
        expectingValue = false;
        nextCapture = null;
      }
      pendingString = null;
    }
  };
  try {
    while (true) {
      const result = await readChunkWithAbort(reader, signal);
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Provider response exceeds the configured size limit.');
      }
      await consume(decoder.decode(result.value, { stream: true }));
    }
    await consume(decoder.decode());
    if (inString || escaped || unicodeEscape !== null || activeJsonCapture) throw new Error('Provider response JSON was incomplete.');
    await flushBase64();
    const completedWriter = base64Writer as Base64FileWriter | null;
    if (completedWriter) await completedWriter.finish();
    await handle.sync();
    await handle.close();
    reader.releaseLock();
    if (base64Found && completedWriter) return { filePath: destination, byteSize: completedWriter.byteSize, mediaType, revisedPrompt, responseModel, usage };
    await fsp.rm(destination, { force: true });
    return { url, mediaType, revisedPrompt, responseModel, usage };
  } catch (error) {
    reader.releaseLock();
    await handle.close().catch(() => undefined);
    await fsp.rm(destination, { force: true });
    throw error;
  }
}

function ipv4Bytes(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  const bytes = address.split('.').map(Number);
  return bytes.length === 4 && bytes.every((value) => Number.isInteger(value) && value >= 0 && value <= 255) ? bytes : null;
}

function ipv6Bytes(address: string): number[] | null {
  const withoutZone = address.split('%', 1)[0].toLowerCase();
  if (isIP(withoutZone) !== 6) return null;
  const halves = withoutZone.split('::');
  if (halves.length > 2) return null;

  const parseHalf = (value: string): number[] | null => {
    if (!value) return [];
    const groups: number[] = [];
    for (const part of value.split(':')) {
      const ipv4 = ipv4Bytes(part);
      if (ipv4) {
        groups.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };

  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] || '');
  if (!left || !right) return null;
  const omitted = 8 - left.length - right.length;
  if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) return null;
  const groups = [...left, ...Array.from({ length: omitted }, () => 0), ...right];
  if (groups.length !== 8) return null;
  return groups.flatMap((group) => [group >>> 8, group & 0xff]);
}

const FORBIDDEN_IPV4_PREFIXES: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4]
];

const FORBIDDEN_IPV6_PREFIXES: ReadonlyArray<readonly [readonly number[], number]> = [
  [[0x20, 0x01, 0x00], 23],
  [[0x20, 0x01, 0x0d, 0xb8], 32],
  [[0x20, 0x02], 16],
  [[0x3f, 0xff, 0x00], 20]
];

function matchesPrefix(bytes: readonly number[], network: readonly number[], prefixLength: number): boolean {
  const completeBytes = Math.floor(prefixLength / 8);
  for (let index = 0; index < completeBytes; index += 1) {
    if (bytes[index] !== network[index]) return false;
  }
  const remainingBits = prefixLength % 8;
  if (!remainingBits) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (bytes[completeBytes] & mask) === (network[completeBytes] & mask);
}

function isForbiddenIpv4(bytes: number[]): boolean {
  const value = (((bytes[0] * 0x1000000) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3]) >>> 0);
  return FORBIDDEN_IPV4_PREFIXES.some(([network, prefixLength]) => (value >>> (32 - prefixLength)) === (network >>> (32 - prefixLength)));
}

function isForbiddenIpv6(bytes: number[]): boolean {
  const globalUnicast = (bytes[0] & 0xe0) === 0x20;
  return !globalUnicast || FORBIDDEN_IPV6_PREFIXES.some(([network, prefixLength]) => matchesPrefix(bytes, network, prefixLength));
}

function assertPublicAddress(address: string): void {
  if (address.includes('%')) throw new Error('Provider image host resolved to a non-public address.');
  const ipv4 = ipv4Bytes(address);
  if (ipv4) {
    if (isForbiddenIpv4(ipv4)) throw new Error('Provider image host resolved to a non-public address.');
    return;
  }
  const ipv6 = ipv6Bytes(address);
  if (ipv6) {
    if (isForbiddenIpv6(ipv6)) throw new Error('Provider image host resolved to a non-public address.');
    return;
  }
  throw new Error('Provider image host resolution returned an invalid address.');
}

export type PrivateAddressPolicy = 'local_proxy' | 'enterprise_private';

function isLoopbackIpv4(bytes: readonly number[]): boolean { return bytes[0] === 127; }
function isPrivateIpv4(bytes: readonly number[]): boolean {
  return bytes[0] === 10 || (bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31) || (bytes[0] === 192 && bytes[1] === 168);
}
function isLoopbackIpv6(bytes: readonly number[]): boolean { return bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1; }
function isPrivateIpv6(bytes: readonly number[]): boolean { return (bytes[0] & 0xfe) === 0xfc; }

/**
 * Ranges a local proxy or TUN adapter legitimately presents to this process: loopback, RFC 2544 benchmark space
 * (the usual fake-IP range a TUN resolver hands out) and CGNAT/overlay space used by mesh VPNs. Link-local and
 * metadata addresses, documentation ranges, multicast and reserved space stay forbidden, so choosing
 * `local_proxy` never widens access to them. Before this, a TUN fake-IP such as 198.18.x was rejected on every
 * request even though the operator had deliberately selected the local-proxy trust mode.
 */
const LOCAL_PROXY_IPV4_PREFIXES: ReadonlyArray<readonly [number, number]> = [
  [0x7f000000, 8],
  [0x64400000, 10],
  [0xc6120000, 15]
];

function isLocalProxyIpv4(bytes: readonly number[]): boolean {
  const value = (((bytes[0] * 0x1000000) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3]) >>> 0);
  return LOCAL_PROXY_IPV4_PREFIXES.some(([network, prefixLength]) => (value >>> (32 - prefixLength)) === (network >>> (32 - prefixLength)));
}

/** Whether an address may be dialled under a trust mode, without throwing. */
function permittedByPolicy(address: string, policy: PrivateAddressPolicy | null): boolean {
  if (address.includes('%')) return false;
  const ipv4 = ipv4Bytes(address);
  if (ipv4) {
    if (!isForbiddenIpv4(ipv4)) return true;
    if (policy === 'local_proxy' && isLocalProxyIpv4(ipv4)) return true;
    if (policy === 'enterprise_private' && isPrivateIpv4(ipv4)) return true;
    return false;
  }
  const ipv6 = ipv6Bytes(address);
  if (ipv6) {
    if (!isForbiddenIpv6(ipv6)) return true;
    if (policy === 'local_proxy' && (isLoopbackIpv6(ipv6) || isPrivateIpv6(ipv6))) return true;
    if (policy === 'enterprise_private' && isPrivateIpv6(ipv6)) return true;
    return false;
  }
  return false;
}

function assertAllowedAddress(address: string, policy: PrivateAddressPolicy | null): void {
  if (!policy) {
    assertPublicAddress(address);
    return;
  }
  if (address.includes('%')) throw new Error('Provider endpoint resolved to a non-public address.');
  if (permittedByPolicy(address, policy)) return;
  if (!ipv4Bytes(address) && !ipv6Bytes(address)) throw new Error('Provider endpoint resolution returned an invalid address.');
  throw new Error('Provider endpoint resolved to a forbidden private or reserved address.');
}

/**
 * A proxy is an egress hop the operator named by hand, so it is accepted
 * wherever the endpoint trust mode allows it *or* wherever a local proxy
 * legitimately lives (loopback, CGNAT/overlay, TUN fake-IP). Requiring a public
 * proxy address would break the ordinary case — corporate proxies and local
 * transparent proxies sit on private addresses. Link-local, metadata,
 * multicast and reserved ranges stay forbidden under every mode.
 */
function assertAllowedProxyAddress(address: string, _policy: PrivateAddressPolicy | null): void {
  // The proxy is a separately configured network hop, not the request target.
  // Permit normal corporate/private and local/TUN proxy ranges regardless of
  // the target trust mode, while retaining the common reserved-range denylist.
  if (permittedByPolicy(address, 'enterprise_private') || permittedByPolicy(address, 'local_proxy')) return;
  throw new Error('Configured HTTP proxy resolved to a forbidden address.');
}


function hostnameWithoutBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function addressBytes(address: string): number[] | null {
  const normalized = address.toLowerCase().startsWith('::ffff:') ? address.slice(7) : address;
  return ipv4Bytes(normalized) || ipv6Bytes(normalized);
}

function sameAddress(left: string, right: string): boolean {
  const leftBytes = addressBytes(hostnameWithoutBrackets(left));
  const rightBytes = addressBytes(hostnameWithoutBrackets(right));
  return Boolean(leftBytes && rightBytes && leftBytes.length === rightBytes.length && leftBytes.every((value, index) => value === rightBytes[index]));
}

interface SafeUrlTarget {
  url: URL;
  /** Addresses of the next hop: target for direct requests, proxy otherwise. */
  addresses: readonly string[];
  /** Locally validated target pins, including for proxied requests. */
  targetAddresses: readonly string[];
  proxy: URL | null;
}

async function resolveAllowedHost(hostname: string, resolver: HostResolver, signal: AbortSignal, privateAddressPolicy: PrivateAddressPolicy | null, assert: (address: string, policy: PrivateAddressPolicy | null) => void = assertAllowedAddress): Promise<readonly string[]> {
  if (isIP(hostname)) {
    assert(hostname, privateAddressPolicy);
    return [hostname];
  }
  let addresses: readonly string[];
  try {
    const timeout = AbortSignal.timeout(DNS_TIMEOUT_MS);
    const resolutionSignal = AbortSignal.any([signal, timeout]);
    addresses = await Promise.race([
      resolver(hostname, resolutionSignal),
      new Promise<readonly string[]>((_, reject) => resolutionSignal.addEventListener('abort', () => reject(resolutionSignal.reason || new Error('DNS resolution aborted.')), { once: true }))
    ]);
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('Provider image host DNS resolution failed.');
  }
  if (!addresses.length) throw new Error('Provider image host DNS resolution returned no addresses.');
  for (const address of addresses) assert(address, privateAddressPolicy);
  return [...new Set(addresses)];
}

/**
 * Validates every target locally before either a direct or proxy request. A
 * proxy must never become a DNS-policy bypass: target pins are passed to the
 * proxy transport, while the separately resolved proxy pins identify the only
 * local next hop that may be dialled.
 */
async function assertSafeUrl(value: string, resolver: HostResolver, signal: AbortSignal, privateAddressPolicy: PrivateAddressPolicy | null = null, proxy: URL | null = null): Promise<SafeUrlTarget> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Provider image URL is invalid.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Provider image URL must use HTTP or HTTPS.');
  if (parsed.username || parsed.password) throw new Error('Provider image URL must not contain credentials.');

  const hostname = hostnameWithoutBrackets(parsed.hostname);
  if (!hostname) throw new Error('Provider image URL requires a host.');
  const targetAddresses = await resolveAllowedHost(hostname, resolver, signal, privateAddressPolicy);
  if (!proxy) return { url: parsed, addresses: targetAddresses, targetAddresses, proxy: null };

  const proxyHostname = hostnameWithoutBrackets(proxy.hostname);
  if (!proxyHostname) throw new Error('Configured HTTP proxy is missing a host.');
  const proxyAddresses = await resolveAllowedHost(proxyHostname, resolver, signal, privateAddressPolicy, assertAllowedProxyAddress);
  return { url: parsed, addresses: proxyAddresses, targetAddresses, proxy };
}

function pinnedLookup(addresses: readonly string[]): LookupFunction {
  const pinned = addresses.map((address) => ({ address, family: isIP(address) }));
  if (pinned.some((entry) => entry.family !== 4 && entry.family !== 6)) {
    throw new Error('Provider image host resolution returned an invalid address.');
  }
  return (_hostname, options, callback) => {
    if (options.all) callback(null, pinned);
    else callback(null, pinned[0].address, pinned[0].family);
  };
}

function proxyPort(proxy: URL): number {
  return proxy.port ? Number(proxy.port) : proxy.protocol === 'https:' ? 443 : 80;
}

function authorityForHost(hostname: string, port: number): string {
  return (isIP(hostname) === 6 ? '[' + hostname + ']' : hostname) + ':' + port;
}

function proxyDestinationUrl(url: URL, address: string): string {
  const destination = new URL(url.toString());
  destination.hostname = isIP(address) === 6 ? '[' + address + ']' : address;
  return destination.toString();
}

function proxyAgent(proxy: URL): http.Agent {
  return proxy.protocol === 'https:'
    ? new https.Agent({ keepAlive: false, maxCachedSessions: 0 })
    : new http.Agent({ keepAlive: false });
}

/**
 * An HTTPS Agent whose only socket is an already-established CONNECT tunnel.
 * Node 22 does not honor a per-request createConnection hook when agent:false;
 * overriding the Agent method makes a direct target connection impossible.
 */
class TunnelHttpsAgent extends https.Agent {
  private tunnel: Socket | null;

  constructor(tunnel: Socket) {
    super({ keepAlive: false, maxCachedSessions: 0 });
    this.tunnel = tunnel;
  }

  override createConnection(options: https.RequestOptions): tls.TLSSocket {
    const tunnel = this.tunnel;
    if (!tunnel) throw new Error('HTTP proxy tunnel was already consumed.');
    this.tunnel = null;
    return tls.connect({
      socket: tunnel,
      servername: options.servername,
      rejectUnauthorized: options.rejectUnauthorized,
      ca: options.ca,
      cert: options.cert,
      key: options.key,
      ALPNProtocols: ['http/1.1']
    });
  }
}

/** Opens a pinned HTTP(S)-proxy connection and requests a CONNECT tunnel. */
function openProxyTunnel(proxy: URL, proxyAddresses: readonly string[], targetHost: string, targetAddresses: readonly string[] | undefined, targetPort: number, authorization: string | null, signal: AbortSignal): Promise<Socket> {
  const host = hostnameWithoutBrackets(proxy.hostname);
  // CONNECT by the locally pinned target IP, while TLS SNI remains targetHost.
  // This prevents a proxy-side DNS rebinding from selecting a different host.
  const targetAddress = targetAddresses?.[0] || targetHost;
  const authority = authorityForHost(targetAddress, targetPort);
  const requestModule = proxy.protocol === 'https:' ? https : http;
  const request = requestModule.request({
    host,
    port: proxyPort(proxy),
    method: 'CONNECT',
    path: authority,
    headers: { host: authority, ...(authorization ? { 'proxy-authorization': authorization } : {}) },
    signal,
    agent: proxyAgent(proxy),
    lookup: pinnedLookup(proxyAddresses),
    ...(proxy.protocol === 'https:' ? { servername: host } : {})
  });
  return new Promise<Socket>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.once('connect', (response, socket, head) => {
      if (settled) {
        socket.destroy();
        return;
      }
      if (response.statusCode !== 200) {
        socket.destroy();
        fail(new Error('HTTP proxy refused the CONNECT tunnel with status ' + response.statusCode + '.'));
        return;
      }
      if (head.length) {
        socket.destroy();
        fail(new Error('HTTP proxy sent unexpected bytes before target TLS negotiation.'));
        return;
      }
      settled = true;
      resolve(socket);
    });
    request.once('error', fail);
    request.end();
  });
}

export const pinnedHttpTransport: PinnedHttpTransport = async (url, addresses, init) => {
  const lookupPinned = pinnedLookup(addresses);
  if (init.proxy) {
    const authorization = proxyAuthorization(init.proxy);
    const targetHost = hostnameWithoutBrackets(url.hostname);
    if (url.protocol === 'https:') {
      const targetPort = url.port ? Number(url.port) : 443;
      const tunnel = await openProxyTunnel(init.proxy, addresses, targetHost, init.targetAddresses, targetPort, authorization, init.signal);
      const servername = hostnameWithoutBrackets(url.hostname);
      const request = https.request(url, {
        method: init.method || 'GET',
        headers: init.headers,
        signal: init.signal,
        servername,
        agent: new TunnelHttpsAgent(tunnel)
      });
      return finishRequest(request, init);
    }
    const requestModule = init.proxy.protocol === 'https:' ? https : http;
    const request = requestModule.request({
      host: hostnameWithoutBrackets(init.proxy.hostname),
      port: proxyPort(init.proxy),
      method: init.method || 'GET',
      // The target hostname was independently resolved and policy-checked
      // before the proxy receives this absolute URI. Host preserves virtual
      // hosting; the proxy remains the configured network trust boundary.
      path: proxyDestinationUrl(url, init.targetAddresses?.[0] || targetHost),
      headers: { ...init.headers, host: url.host, ...(authorization ? { 'proxy-authorization': authorization } : {}) },
      signal: init.signal,
      agent: proxyAgent(init.proxy),
      lookup: lookupPinned,
      ...(init.proxy.protocol === 'https:' ? { servername: hostnameWithoutBrackets(init.proxy.hostname) } : {})
    });
    return finishRequest(request, init);
  }
  const request = (url.protocol === 'https:' ? https : http).request(url, {
    method: init.method || 'GET',
    headers: init.headers,
    signal: init.signal,
    lookup: lookupPinned,
    ...(url.protocol === 'https:' ? { servername: hostnameWithoutBrackets(url.hostname) } : {})
  });
  return finishRequest(request, init);
};

async function finishRequest(request: ReturnType<typeof http.request>, init: PinnedRequestInit): Promise<PinnedHttpResponse> {
  if (init.body !== undefined) request.write(init.body);
  request.end();
  const [incoming] = await once(request, 'response', { signal: init.signal }) as [IncomingMessage];
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const remoteAddress = incoming.socket.remoteAddress || '';
  const body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
  return { response: new Response(body, { status: incoming.statusCode || 500, statusText: incoming.statusMessage, headers }), remoteAddress };
};

export interface PinnedEndpointRequestOptions {
  signal: AbortSignal;
  headers: Readonly<Record<string, string>>;
  method?: string;
  body?: Uint8Array | string;
  allowPrivate?: boolean;
  privateAddressPolicy?: PrivateAddressPolicy;
  request?: PinnedHttpTransport;
  resolveHost?: HostResolver;
  /** Overrides the proxy resolved from the environment; `null` forces a direct request. */
  proxy?: URL | null;
}

function parseTargetUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error('Provider image URL is invalid.');
  }
}

function proxyOption(explicit: URL | null | undefined, target: URL): URL | null {
  return explicit === undefined ? resolveProxyFor(target) : explicit;
}

export async function requestPinnedHttpEndpoint(value: string, options: PinnedEndpointRequestOptions): Promise<PinnedHttpResponse> {
  const request = options.request || pinnedHttpTransport;
  const resolver = options.resolveHost || defaultHostResolver;
  const privateAddressPolicy = options.privateAddressPolicy || (options.allowPrivate === true ? 'enterprise_private' : null);
  const proxy = proxyOption(options.proxy, parseTargetUrl(value));
  const target = await assertSafeUrl(value, resolver, options.signal, privateAddressPolicy, proxy);
  let result: PinnedHttpResponse;
  try {
    result = await request(target.url, target.addresses, { headers: options.headers, signal: options.signal, method: options.method, body: options.body, ...(target.proxy ? { proxy: target.proxy, targetAddresses: target.targetAddresses } : {}) });
  } catch (error) {
    if (options.signal.aborted) throw error;
    throw new Error('Provider endpoint request failed.');
  }
  try {
    (target.proxy ? assertAllowedProxyAddress : assertAllowedAddress)(hostnameWithoutBrackets(result.remoteAddress), privateAddressPolicy);
    if (!target.addresses.some((address) => sameAddress(address, result.remoteAddress))) throw new Error('Provider connection remote address did not match the pinned DNS result.');
    return result;
  } catch (error) {
    await cancelBody(result.response);
    throw error;
  }
}


function redirectLocation(response: Response): string | null {
  return response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
}

/**
 * Surfaces the underlying transport failure instead of hiding it behind a generic
 * message. Without this a closed proxy port, a DNS failure and a TLS rejection all
 * look identical in the Studio error records, which makes them very hard to tell apart.
 * Credential-shaped fragments are stripped because the text is persisted.
 */
export function describeTransportFailure(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (message) parts.push(message);
    current = current instanceof Error ? (current as Error & { cause?: unknown }).cause : undefined;
  }
  return parts
    .join(' <- ')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
    .replace(/sk-[A-Za-z0-9._-]{8,}/g, 'sk-***')
    .slice(0, 300);
}

export async function downloadHttpResource(value: string, options: SafeDownloadOptions): Promise<DownloadedResource> {
  const request = options.request || pinnedHttpTransport;
  const resolver = options.resolveHost || defaultHostResolver;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  // Image downloads used to ignore the endpoint trust mode entirely: neither the DNS check nor the
  // remote-address check honoured it, so a `local_proxy` or `enterprise_private` profile could reach the API
  // and then fail on the image host. The policy now travels with the download.
  const privateAddressPolicy = options.privateAddressPolicy || (options.allowPrivate === true ? 'enterprise_private' : null);
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) throw new Error('A non-negative redirect limit is required.');

  let current = value;
  for (let redirects = 0; ; redirects += 1) {
    // NO_PROXY is evaluated per hop: a redirect can leave the exempted host,
    // and then the new target has to go through the proxy like any other.
    const target = await assertSafeUrl(current, resolver, options.signal, privateAddressPolicy, proxyOption(options.proxy, parseTargetUrl(current)));
    let result: PinnedHttpResponse;
    try {
      result = await request(target.url, target.addresses, {
        headers: { accept: 'image/png, image/jpeg, image/webp' },
        signal: options.signal,
        ...(target.proxy ? { proxy: target.proxy, targetAddresses: target.targetAddresses } : {})
      });
    } catch (error) {
      if (options.signal.aborted) throw error;
      throw new Error('Provider image download request failed: ' + describeTransportFailure(error), { cause: error });
    }
    const { response, remoteAddress } = result;
    try {
      (target.proxy ? assertAllowedProxyAddress : assertAllowedAddress)(hostnameWithoutBrackets(remoteAddress), privateAddressPolicy);
      if (!target.addresses.some((address) => sameAddress(address, remoteAddress))) {
        throw new Error('Provider image connection remote address did not match the pinned DNS result.');
      }
    } catch (error) {
      await cancelBody(response);
      throw error;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = redirectLocation(response);
      await cancelBody(response);
      if (!location) throw new Error('Provider image download redirect did not include a location.');
      if (redirects >= maxRedirects) throw new Error('Provider image download exceeded the redirect limit.');
      try {
        current = new URL(location, target.url).toString();
      } catch {
        throw new Error('Provider image download redirect location is invalid.');
      }
      continue;
    }

    if (!response.ok) {
      await cancelBody(response);
      const error = new Error('http ' + response.status + ': Provider image download failed.') as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    const bytes = await readBoundedResponse(response, options.maxBytes, 'Provider image download exceeds the configured size limit.', options.signal);
    return { bytes, contentType: response.headers.get('content-type') };
  }
}
export async function downloadHttpResourceToFile(value: string, destination: string, options: SafeDownloadOptions): Promise<{ filePath: string; byteSize: number; contentType: string | null }> {
  const request = options.request || pinnedHttpTransport;
  const resolver = options.resolveHost || defaultHostResolver;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const privateAddressPolicy = options.privateAddressPolicy || (options.allowPrivate === true ? 'enterprise_private' : null);
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) throw new Error('A non-negative redirect limit is required.');
  let current = value;
  for (let redirects = 0; ; redirects += 1) {
    const target = await assertSafeUrl(current, resolver, options.signal, privateAddressPolicy, proxyOption(options.proxy, parseTargetUrl(current)));
    let result: PinnedHttpResponse;
    try {
      result = await request(target.url, target.addresses, { headers: { accept: 'image/png, image/jpeg, image/webp' }, signal: options.signal, ...(target.proxy ? { proxy: target.proxy, targetAddresses: target.targetAddresses } : {}) });
    } catch (error) {
      if (options.signal.aborted) throw error;
      throw new Error('Provider image download request failed: ' + describeTransportFailure(error), { cause: error });
    }
    const { response, remoteAddress } = result;
    try {
      (target.proxy ? assertAllowedProxyAddress : assertAllowedAddress)(hostnameWithoutBrackets(remoteAddress), privateAddressPolicy);
      if (!target.addresses.some((address) => sameAddress(address, remoteAddress))) throw new Error('Provider image connection remote address did not match the pinned DNS result.');
    } catch (error) {
      await cancelBody(response);
      throw error;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = redirectLocation(response);
      await cancelBody(response);
      if (!location) throw new Error('Provider image download redirect did not include a location.');
      if (redirects >= maxRedirects) throw new Error('Provider image download exceeded the redirect limit.');
      try { current = new URL(location, target.url).toString(); } catch { throw new Error('Provider image download redirect location is invalid.'); }
      continue;
    }
    if (!response.ok) {
      await cancelBody(response);
      const error = new Error('http ' + response.status + ': Provider image download failed.') as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    const byteSize = await readResponseToFile(response, destination, options.maxBytes, 'Provider image download exceeds the configured size limit.', options.signal);
    return { filePath: destination, byteSize, contentType: response.headers.get('content-type') };
  }
}
export async function probeHttpEndpoint(value: string, headers: Readonly<Record<string, string>>, signal: AbortSignal, allowPrivate = false, privateAddressPolicy?: PrivateAddressPolicy): Promise<{ reachable: boolean; status: number }> {
  const result = await requestPinnedHttpEndpoint(value, {
    headers,
    signal,
    privateAddressPolicy: privateAddressPolicy || (allowPrivate ? 'enterprise_private' : undefined)
  });
  try {
    const status = result.response.status;
    return { reachable: !(status >= 300 && status < 400) && status !== 401 && status !== 403 && status < 500, status };
  } finally {
    await cancelBody(result.response);
  }
}

export function decodeBoundedBase64(value: string, maxDecodedBytes: number): Buffer {
  if (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes < 0) throw new Error('A non-negative decoded image size limit is required.');
  const maxEncodedLength = 4 * Math.ceil(maxDecodedBytes / 3);
  if (value.length > maxEncodedLength) throw new Error('Provider base64 image exceeds the configured size limit.');

  const firstPadding = value.indexOf('=');
  const contentLength = firstPadding < 0 ? value.length : firstPadding;
  const paddingLength = firstPadding < 0 ? 0 : value.length - firstPadding;
  if ((paddingLength > 0 && (paddingLength > 2 || value.length % 4 !== 0)) || contentLength % 4 === 1) {
    throw new Error('Provider response included invalid base64 image data.');
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isBase64 = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47;
    if (index < contentLength ? !isBase64 : code !== 61) throw new Error('Provider response included invalid base64 image data.');
  }

  const decodedLength = paddingLength > 0 ? (value.length / 4) * 3 - paddingLength : Math.floor(value.length * 3 / 4);
  if (decodedLength > maxDecodedBytes) throw new Error('Provider base64 image exceeds the configured size limit.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== decodedLength) throw new Error('Provider response included invalid base64 image data.');
  return bytes;
}
