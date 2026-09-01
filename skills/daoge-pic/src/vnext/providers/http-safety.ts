import { lookup } from 'node:dns/promises';
import { once } from 'node:events';
import http, { IncomingMessage } from 'node:http';
import https from 'node:https';
import { isIP, LookupFunction } from 'node:net';
import { Readable } from 'node:stream';

export type HttpFetch = typeof fetch;

export type HostResolver = (hostname: string) => Promise<readonly string[]>;

export interface PinnedHttpResponse {
  response: Response;
  remoteAddress: string;
}

export type PinnedHttpTransport = (url: URL, addresses: readonly string[], init: { signal: AbortSignal; headers: Readonly<Record<string, string>> }) => Promise<PinnedHttpResponse>;

export interface SafeDownloadOptions {
  signal: AbortSignal;
  maxBytes: number;
  maxRedirects?: number;
  request?: PinnedHttpTransport;
  resolveHost?: HostResolver;
}

export interface DownloadedResource {
  bytes: Buffer;
  contentType: string | null;
}

const DEFAULT_MAX_REDIRECTS = 5;

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

export async function readBoundedResponse(response: Response, maxBytes: number, limitMessage: string): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('A non-negative response size limit is required.');
  const length = declaredLength(response);
  if (length !== null && length > maxBytes) {
    await cancelBody(response);
    throw new Error(limitMessage);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      if (chunk.byteLength > maxBytes - total) {
        await reader.cancel().catch(() => undefined);
        throw new Error(limitMessage);
      }
      total += chunk.byteLength;
      chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
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

interface SafeUrlTarget { url: URL; addresses: readonly string[]; }

async function assertSafeUrl(value: string, resolver: HostResolver): Promise<SafeUrlTarget> {
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
  if (isIP(hostname)) {
    assertPublicAddress(hostname);
    return { url: parsed, addresses: [hostname] };
  }

  let addresses: readonly string[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new Error('Provider image host DNS resolution failed.');
  }
  if (!addresses.length) throw new Error('Provider image host DNS resolution returned no addresses.');
  for (const address of addresses) assertPublicAddress(address);
  return { url: parsed, addresses: [...new Set(addresses)] };
}

export const pinnedHttpTransport: PinnedHttpTransport = async (url, addresses, init) => {
  const pinned = addresses.map((address) => ({ address, family: isIP(address) }));
  if (pinned.some((entry) => entry.family !== 4 && entry.family !== 6)) {
    throw new Error('Provider image host resolution returned an invalid address.');
  }
  const lookupPinned: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, pinned);
    else callback(null, pinned[0].address, pinned[0].family);
  };
  const request = (url.protocol === 'https:' ? https : http).request(url, {
    method: 'GET',
    headers: init.headers,
    signal: init.signal,
    lookup: lookupPinned,
    ...(url.protocol === 'https:' ? { servername: hostnameWithoutBrackets(url.hostname) } : {})
  });
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

function redirectLocation(response: Response): string | null {
  return response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
}

export async function downloadHttpResource(value: string, options: SafeDownloadOptions): Promise<DownloadedResource> {
  const request = options.request || pinnedHttpTransport;
  const resolver = options.resolveHost || defaultHostResolver;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) throw new Error('A non-negative redirect limit is required.');

  let current = value;
  for (let redirects = 0; ; redirects += 1) {
    const target = await assertSafeUrl(current, resolver);
    let result: PinnedHttpResponse;
    try {
      result = await request(target.url, target.addresses, {
        headers: { accept: 'image/png, image/jpeg, image/webp' },
        signal: options.signal
      });
    } catch (error) {
      if (options.signal.aborted) throw error;
      throw new Error('Provider image download request failed.');
    }
    const { response, remoteAddress } = result;
    try {
      assertPublicAddress(hostnameWithoutBrackets(remoteAddress));
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
    const bytes = await readBoundedResponse(response, options.maxBytes, 'Provider image download exceeds the configured size limit.');
    return { bytes, contentType: response.headers.get('content-type') };
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
