/**
 * Standard HTTP proxy environment handling (`HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`).
 *
 * This exists because the Provider transport resolves DNS itself and dials a
 * pinned address rather than handing a URL to `fetch`, so it inherited none of
 * Node's or curl's proxy behaviour: on a network where the only egress is a
 * corporate HTTP proxy, every Provider call failed at connect time.
 *
 * Security note: proxy and target hostnames are resolved and policy-checked
 * independently. The transport dials only a pinned proxy address and sends a
 * pinned target address to that proxy, retaining the target hostname for HTTP
 * Host and HTTPS SNI. Proxy environment variables still select the network
 * hop, so they remain part of the process trust boundary.
 */

export type ProxyEnv = Readonly<Record<string, string | undefined>>;

function defaultPort(protocol: string): number {
  return protocol === 'https:' ? 443 : 80;
}

function readEnv(env: ProxyEnv, names: readonly string[]): string {
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** Lowercase variable names win, matching curl: they are the POSIX convention. */
function proxyUrlFor(protocol: string, env: ProxyEnv): string {
  if (protocol === 'https:') return readEnv(env, ['https_proxy', 'HTTPS_PROXY']) || readEnv(env, ['all_proxy', 'ALL_PROXY']);
  if (protocol === 'http:') return readEnv(env, ['http_proxy', 'HTTP_PROXY']) || readEnv(env, ['all_proxy', 'ALL_PROXY']);
  return '';
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function entryMatches(targetHost: string, targetPort: number, entry: string): boolean {
  const trimmed = entry.trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed === '*') return true;
  let rawHost = trimmed;
  let port: number | null = null;
  if (trimmed.startsWith('[')) {
    const closing = trimmed.indexOf(']');
    if (closing < 0) return false;
    rawHost = trimmed.slice(1, closing);
    const suffix = trimmed.slice(closing + 1);
    if (suffix) {
      if (!/^:\d+$/.test(suffix)) return false;
      port = Number(suffix.slice(1));
    }
  } else if ((trimmed.match(/:/g) || []).length === 1) {
    const separator = trimmed.lastIndexOf(':');
    const suffix = trimmed.slice(separator + 1);
    if (/^\d+$/.test(suffix)) {
      rawHost = trimmed.slice(0, separator);
      port = Number(suffix);
    }
  }
  const host = normalizeHost(rawHost);
  if (port !== null && port !== targetPort) return false;
  if (!host) return false;
  // A bare host also covers its subdomains. Conventions differ here (curl
  // requires a leading dot), but the safer failure mode is to over-exempt:
  // sending a subdomain of an exempted internal host to an external proxy
  // leaks internal traffic and hostnames, whereas going direct merely fails.
  const suffix = '.' + host.replace(/^\*?\./, '');
  return targetHost === suffix.slice(1) || targetHost.endsWith(suffix);
}

/** True when `NO_PROXY` exempts this target and the request should go direct. */
export function noProxyApplies(target: URL, env: ProxyEnv): boolean {
  const list = readEnv(env, ['no_proxy', 'NO_PROXY']);
  if (!list) return false;
  const host = normalizeHost(target.hostname);
  const port = target.port ? Number(target.port) : defaultPort(target.protocol);
  return list.split(',').some((entry) => entryMatches(host, port, entry));
}

/**
 * Returns the proxy to use for `target`, or null when the request is direct.
 * Throws when a proxy is configured but is not an HTTP(S) URL we can dial —
 * most notably `socks://`, which needs a SOCKS client this transport does not
 * have, and must fail loudly rather than silently fall back to a direct
 * connection that the network will refuse.
 */
export function resolveProxyFor(target: URL, env: ProxyEnv = process.env): URL | null {
  if (noProxyApplies(target, env)) return null;
  const raw = proxyUrlFor(target.protocol, env);
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Configured HTTP proxy is not a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Configured HTTP proxy must use http or https; ' + parsed.protocol + ' is not supported.');
  }
  if (!parsed.hostname) throw new Error('Configured HTTP proxy is missing a host.');
  return parsed;
}

/** `Basic` credentials carried in the proxy URL, if any. */
export function proxyAuthorization(proxy: URL): string | null {
  if (!proxy.username && !proxy.password) return null;
  const raw = decodeURIComponent(proxy.username) + ':' + decodeURIComponent(proxy.password);
  return 'Basic ' + Buffer.from(raw, 'utf8').toString('base64');
}
