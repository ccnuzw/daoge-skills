const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const test = require('node:test');
const tls = require('node:tls');

const { noProxyApplies, proxyAuthorization, resolveProxyFor } = require('../../dist/vnext/providers/proxy-config');
const { downloadHttpResource, pinnedHttpTransport, probeHttpEndpoint, requestPinnedHttpEndpoint } = require('../../dist/vnext/providers/http-safety');

const target = (value) => new URL(value);

const tlsKey = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQC+G7OorCNS5wIb
iMjpNEanh7hnC0lAkZ6T8aib1Pj3zfsi6e5Hwz9oBSBdp7jx0iEmtCWX9G9GhG8f
2iSv1FzeTr5UDmnl0W1eABWRi1dARNtYv9MMbwdtP41hCxnL9f60YnhQRF11REXC
kSDIbZrgQJUygdjrK2BEsNsir1psRKfZr86cjb1MJuhPuRl5gvlaXty1xcxT6uRk
uCfKtLozE1YQzxM5vwH52u2AwCpaLCFxYRH7uHgr2Kx8Xo1bGAMwApFpZe4TksCN
/KGyTGj2uJt8+CfR/Tf/OdY229RDJxenL8IfUc8bXfQmzITKemgx1WoY9lMgZ22u
+VYCz5QZAgMBAAECggEASGbld/5DH74yG8lu9v39UK2MSdZPCiPLeL3HAL5OKZZN
qIDeSn9uRQ/6wSBw+8wS6xod3S7vODSU29UpNrvSuKnVq86nfyrRE8VFcZ5XVvdC
cJzx5GDeu7lB/20KYJbp78o21x8KVvBu/whlq1+u5exCxi8UrY/iBJc0hhOxhNzC
NpFF/2SzfgfIrrxu9UHnfk+ZTqNiCS3n1Su/cYxyGbxFDk6jkiyEbuGZ0xSBJzPb
Z9YOyoMee0ySlA8H+JNcxt07vXZb2voX2RwgM+UHz+EwWwr3skD5SGkbZvRrKePo
Jer6/xj5QOgII6lvQVl2xsT7WXCobTcIBUUYx9VI5wKBgQDxXuRa4zhK0QcjT7od
vHAhUnvLUg+861yRJAh/xmebFeTnbSswbU/7O2SuYGFfaYS7Tok5DjAVVl3ehHBz
yCEn2BABfG8LPw9Nh3KP4jHksxb3LcvGJr+ltBA5CYdVyGWj9gQ7txsAAqe7Va13
vgB3qPFFGame4ybshKckLkEIvwKBgQDJoWvZdna3N+ov0TrUJrU5WodaIIIELpIe
uk7rfKX9C3bjFkAwEEZx5/mm+QsE+Zj6IHgYblTFDAYZ1ddR1J0L2EH2dYJ8T9L8
bRxjIyy1s7XoD+WhAaFXoc/DR56eDnSRZFN9paq7E6xB1ekOTWDA0D0ao43a/sTj
r/FsR0GBJwKBgQDixmr6UZ1j/bwdGx0cLx2S0TJqNvF+aAuSei5aDojtFsb4AIOh
fjK1MnpHs1oJENSaPxGCP6hBg+Gx3PDid1dfXgq7urOB939jMi0arkR+QR0Eo0xf
IazR/Ll5PVCf8iY8xDn5+PEvM09wHPFcHXHG+z2j1JafJ4A8m+2FesezdQKBgQDB
YdiWkU/7Gd26TuolX5qgj3sRrewFJsVuQzI+GSb6M2yrEEQv1Ow7g0mmI2W2N83I
2CtXAzq6YnXXgYkqKskU+y0IvFuR7t1kzSFU0/+lpd7p25VZfr7H1aH2oVI4NZUH
fTm2YJYHJy8nVYpY9U2+n/p6+jKrv34HAlCCkTT6MQKBgQCaJReNCbVlzooyL2iK
fxzCVPYf4Tj++2HWzeVahdYUfttK0PBSSGsw69YB7OTSeHiGs8UKNtax/iusIhbJ
BvvmjG6C1ykCwmuSJIhHq2tlk7LeGnTLQs1bcM8WY5TYLOhbW4COtgl3nKZ7JGdK
Yas4TGVVCnKy6xOBXayTp1rRfg==
-----END PRIVATE KEY-----`;
const tlsCert = `-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUC5HY1ak7z5xv5m2ToVKRKqqNbA0wDQYJKoZIhvcNAQEL
BQAwFjEUMBIGA1UEAwwLdGFyZ2V0LnRlc3QwHhcNMjYwOTE3MTkxMzEwWhcNMzYw
OTE0MTkxMzEwWjAWMRQwEgYDVQQDDAt0YXJnZXQudGVzdDCCASIwDQYJKoZIhvcN
AQEBBQADggEPADCCAQoCggEBAL4bs6isI1LnAhuIyOk0RqeHuGcLSUCRnpPxqJvU
+PfN+yLp7kfDP2gFIF2nuPHSISa0JZf0b0aEbx/aJK/UXN5OvlQOaeXRbV4AFZGL
V0BE21i/0wxvB20/jWELGcv1/rRieFBEXXVERcKRIMhtmuBAlTKB2OsrYESw2yKv
WmxEp9mvzpyNvUwm6E+5GXmC+Vpe3LXFzFPq5GS4J8q0ujMTVhDPEzm/Afna7YDA
KlosIXFhEfu4eCvYrHxejVsYAzACkWll7hOSwI38obJMaPa4m3z4J9H9N/851jbb
1EMnF6cvwh9Rzxtd9CbMhMp6aDHVahj2UyBnba75VgLPlBkCAwEAAaNrMGkwHQYD
VR0OBBYEFB90Ybs2sD2ht2rpA30sZgI4RFnPMB8GA1UdIwQYMBaAFB90Ybs2sD2h
t2rpA30sZgI4RFnPMA8GA1UdEwEB/wQFMAMBAf8wFgYDVR0RBA8wDYILdGFyZ2V0
LnRlc3QwDQYJKoZIhvcNAQELBQADggEBAE0MGx+D3zKeh+tvkbDm62qZw4zdZRSA
FcCGZJ9Nw9V20v3mjZpjh8JS2i31fl41nFfmG0g3jHhojpDOrcNFrPLPq/a5bC/B
b84CrHyR9VG1FCRHC4gfXELdgBdeC36nf1SRi8qXK3F5RImgFuAsutxOU7RGnaYs
4WYo9OXr6fxQlEx6KIEL+bpSFq6TvjnrsCsTLZocGUZNg147zxD4WErpvBEF8j0+
gmKTfk+2X2KvoEDM9rlnqUhuGKcqq8JvKuaRw06fDWVZZD6g6vedEbfr2H/4a2Iv
cp2GLbVA6JXWEUfB8wKIOz6EVRqLxals0iWlvK2coaemYsC6ADWC4WU=
-----END CERTIFICATE-----`;

test('no proxy is used when none is configured', () => {
  assert.equal(resolveProxyFor(target('https://api.example.test/v1'), {}), null);
});

test('HTTPS_PROXY applies to https targets and HTTP_PROXY to http targets', () => {
  assert.equal(resolveProxyFor(target('https://api.example.test/v1'), { https_proxy: 'http://proxy.test:3128' }).href, 'http://proxy.test:3128/');
  assert.equal(resolveProxyFor(target('http://api.example.test/v1'), { http_proxy: 'http://proxy.test:3128' }).href, 'http://proxy.test:3128/');
  assert.equal(resolveProxyFor(target('https://api.example.test/v1'), { http_proxy: 'http://proxy.test:3128' }), null, 'an http proxy must not be assumed for https targets');
  assert.equal(resolveProxyFor(target('https://api.example.test/v1'), { all_proxy: 'http://proxy.test:3128' }).href, 'http://proxy.test:3128/');
});

test('a SOCKS proxy fails loudly instead of silently going direct', () => {
  assert.throws(() => resolveProxyFor(target('https://api.example.test/v1'), { https_proxy: 'socks5://proxy.test:1080' }), /must use http or https/);
  assert.throws(() => resolveProxyFor(target('https://api.example.test/v1'), { https_proxy: 'not a url' }), /not a valid URL/);
});

test('NO_PROXY exempts matching hosts, subdomains and ports', () => {
  const env = { https_proxy: 'http://proxy.test:3128', no_proxy: 'internal.test, .example.org, 10.0.0.5, cdn.test:8443' };
  assert.equal(noProxyApplies(target('https://internal.test/v1'), env), true);
  assert.equal(noProxyApplies(target('https://api.internal.test/v1'), env), true, 'a bare host also covers its subdomains');
  assert.equal(noProxyApplies(target('https://files.example.org/x'), env), true);
  assert.equal(noProxyApplies(target('https://example.org/x'), env), true);
  assert.equal(noProxyApplies(target('https://10.0.0.5/x'), env), true);
  assert.equal(noProxyApplies(target('https://cdn.test:8443/x'), env), true);
  assert.equal(noProxyApplies(target('https://cdn.test/x'), env), false, 'a port-specific exemption must not exempt other ports');
  assert.equal(noProxyApplies(target('https://notinternal.test/v1'), env), false);
  assert.equal(noProxyApplies(target('https://internal.test.evil.test/v1'), env), false, 'suffix matching must not cross a dot boundary');
  assert.equal(resolveProxyFor(target('https://internal.test/v1'), { https_proxy: 'http://proxy.test:3128', no_proxy: 'internal.test' }), null);
  assert.equal(resolveProxyFor(target('https://api.example.test/v1'), { https_proxy: 'http://proxy.test:3128', no_proxy: 'internal.test' }).href, 'http://proxy.test:3128/');
});

test('NO_PROXY * exempts every target', () => {
  assert.equal(resolveProxyFor(target('https://anything.test/v1'), { https_proxy: 'http://proxy.test:3128', no_proxy: '*' }), null);
});

test('proxy credentials are carried as a Basic proxy-authorization header value', () => {
  const proxy = new URL('http://alice:s%40cret@proxy.test:3128');
  assert.equal(proxyAuthorization(proxy), 'Basic ' + Buffer.from('alice:s@cret').toString('base64'));
  assert.equal(proxyAuthorization(new URL('http://proxy.test:3128')), null);
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

/**
 * A minimal forward proxy: plain HTTP requests arrive with an absolute request
 * URI and are re-issued to the origin; HTTPS targets arrive as CONNECT.
 */
async function withProxy(operation, options = {}) {
  const seen = { absoluteUri: null, authorization: null, connect: null, originRequests: 0 };
  const origin = http.createServer((request, response) => {
    seen.originRequests += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"origin":true}');
  });
  const proxy = http.createServer((request, response) => {
    seen.absoluteUri = request.url;
    seen.authorization = request.headers['proxy-authorization'] || null;
    const forwarded = new URL(request.url);
    const upstream = http.request({ host: forwarded.hostname, port: forwarded.port, path: forwarded.pathname + forwarded.search, method: request.method, headers: { host: forwarded.host } }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on('error', () => { response.writeHead(502); response.end(); });
    upstream.end();
  });
  // Node delivers CONNECT on the server's own 'connect' event, never as a
  // normal request: a proxy that only handles 'request' would silently ignore
  // every HTTPS target.
  proxy.on('connect', (request, clientSocket) => {
    seen.connect = request.url;
    seen.authorization = request.headers['proxy-authorization'] || null;
    if (options.refuseTunnel) {
      clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      clientSocket.destroy();
      return;
    }
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    // Return invalid TLS bytes after CONNECT so the target TLS handshake fails
    // deterministically instead of leaving a half-closed socket pending.
    clientSocket.end('not a TLS server');
  });
  const originPort = await listen(origin);
  const proxyPort = await listen(proxy);
  try {
    return await operation({ seen, originPort, proxyPort, origin: 'http://127.0.0.1:' + originPort });
  } finally {
    await Promise.all([close(origin), close(proxy)]);
  }
}

test('an HTTP request goes through the proxy as an absolute URI and never dials the target directly', async () => {
  await withProxy(async ({ seen, proxyPort, origin }) => {
    const result = await requestPinnedHttpEndpoint(origin + '/v1/images/generations', {
      signal: new AbortController().signal,
      headers: { accept: 'application/json' },
      privateAddressPolicy: 'local_proxy',
      proxy: new URL('http://127.0.0.1:' + proxyPort)
    });
    assert.equal(seen.absoluteUri, origin + '/v1/images/generations', 'the proxy must receive the absolute URI');
    assert.equal(seen.originRequests, 1, 'the proxy forwards to the origin exactly once');
    assert.equal(result.response.status, 200);
    assert.deepEqual(await result.response.json(), { origin: true });
    assert.equal(seen.connect, null);
  });
});

test('proxy credentials are sent to the proxy and not to the origin', async () => {
  await withProxy(async ({ seen, proxyPort, origin }) => {
    await requestPinnedHttpEndpoint(origin + '/v1/images/generations', {
      signal: new AbortController().signal,
      headers: { accept: 'application/json' },
      privateAddressPolicy: 'local_proxy',
      proxy: new URL('http://alice:secret@127.0.0.1:' + proxyPort)
    });
    assert.equal(seen.authorization, 'Basic ' + Buffer.from('alice:secret').toString('base64'));
  });
});

test('an HTTPS target is tunnelled with CONNECT rather than reached directly', async () => {
  await withProxy(async ({ seen, proxyPort }) => {
    await assert.rejects(() => requestPinnedHttpEndpoint('https://api.example.test/v1/images/generations', {
      signal: new AbortController().signal,
      headers: { accept: 'application/json' },
      privateAddressPolicy: 'local_proxy',
      resolveHost: async (hostname) => hostname === 'api.example.test' ? ['93.184.216.34'] : ['127.0.0.1'],
      proxy: new URL('http://127.0.0.1:' + proxyPort)
    }));
    assert.equal(seen.connect, '93.184.216.34:443', 'CONNECT must use the locally validated target pin');
    assert.equal(seen.originRequests, 0, 'nothing may be dialled outside the tunnel');
  });
});

test('a proxy that refuses the tunnel surfaces a clear error', async () => {
  await withProxy(async ({ proxyPort }) => {
    await assert.rejects(() => pinnedHttpTransport(new URL('https://api.example.test/v1'), ['127.0.0.1'], {
      signal: new AbortController().signal,
      headers: {},
      proxy: new URL('http://127.0.0.1:' + proxyPort)
    }), /proxy refused the CONNECT tunnel with status 403/);
  }, { refuseTunnel: true });
});

test('an explicit null proxy forces a direct request even when the environment sets one', async () => {
  const previous = process.env.https_proxy;
  process.env.https_proxy = 'http://127.0.0.1:1';
  try {
    await withProxy(async ({ origin }) => {
      const result = await requestPinnedHttpEndpoint(origin + '/direct', {
        signal: new AbortController().signal,
        headers: {},
        privateAddressPolicy: 'local_proxy',
        proxy: null
      });
      assert.equal(result.response.status, 200);
    });
  } finally {
    if (previous === undefined) delete process.env.https_proxy;
    else process.env.https_proxy = previous;
  }
});

test('HTTPS target traffic traverses the CONNECT tunnel and never opens a direct target connection', async () => {
  const originalTlsConnect = tls.connect;
  tls.connect = (options, ...args) => originalTlsConnect.call(tls, { ...options, ca: tlsCert }, ...args);
  const seen = { connect: null, proxyUpstreamPort: null, targetRemotePorts: [], servername: null, requests: 0 };
  const tunnelSockets = [];
  const origin = https.createServer({ key: tlsKey, cert: tlsCert }, (request, response) => {
    seen.requests += 1;
    request.resume();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"tunnel":true}');
  });
  origin.on('secureConnection', (socket) => {
    seen.targetRemotePorts.push(socket.remotePort);
    seen.servername = socket.servername;
  });
  const proxy = http.createServer();
  proxy.on('connect', (request, clientSocket) => {
    seen.connect = request.url;
    const separator = request.url.lastIndexOf(':');
    const host = request.url.slice(0, separator).replace(/^\[|\]$/g, '');
    const port = Number(request.url.slice(separator + 1));
    const upstream = net.connect({ host, port });
    tunnelSockets.push(clientSocket, upstream);
    upstream.once('connect', () => {
      seen.proxyUpstreamPort = upstream.localPort;
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      clientSocket.pipe(upstream).pipe(clientSocket);
    });
    upstream.once('error', (error) => clientSocket.destroy(error));
  });
  const originPort = await listen(origin);
  const proxyPort = await listen(proxy);
  try {
    const result = await requestPinnedHttpEndpoint('https://target.test:' + originPort + '/provider', {
      signal: new AbortController().signal,
      headers: { accept: 'application/json' },
      privateAddressPolicy: 'local_proxy',
      resolveHost: async () => ['127.0.0.1'],
      proxy: new URL('http://proxy.test:' + proxyPort)
    });
    assert.equal(result.response.status, 200);
    assert.deepEqual(await result.response.json(), { tunnel: true });
    assert.equal(seen.connect, '127.0.0.1:' + originPort);
    assert.equal(seen.servername, 'target.test', 'target TLS must retain the original SNI hostname');
    assert.equal(seen.requests, 1);
    assert.deepEqual(seen.targetRemotePorts, [seen.proxyUpstreamPort], 'the target must receive only the proxy upstream socket, never a direct client connection');
  } finally {
    for (const socket of tunnelSockets) socket.destroy();
    await Promise.all([close(origin), close(proxy)]);
    tls.connect = originalTlsConnect;
  }
});

test('an HTTPS proxy completes TLS before receiving CONNECT', async () => {
  const previousTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const events = [];
  const proxy = https.createServer({ key: tlsKey, cert: tlsCert });
  proxy.on('secureConnection', () => events.push('tls'));
  proxy.on('connect', (_request, socket) => {
    events.push('connect');
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  const proxyPort = await listen(proxy);
  try {
    await assert.rejects(() => pinnedHttpTransport(new URL('https://target.test/v1'), ['127.0.0.1'], {
      signal: new AbortController().signal,
      headers: {},
      proxy: new URL('https://proxy.test:' + proxyPort),
      targetAddresses: ['93.184.216.34']
    }), /proxy refused the CONNECT tunnel with status 403/);
    assert.deepEqual(events, ['tls', 'connect']);
  } finally {
    await close(proxy);
    if (previousTlsSetting === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting;
  }
});

test('proxy mode validates target DNS before transport and fails closed', async () => {
  for (const [name, resolveHost, pattern] of [
    ['private', async (hostname) => hostname === 'private.test' ? ['10.0.0.8'] : ['93.184.216.34'], /non-public/],
    ['link-local', async (hostname) => hostname === 'private.test' ? ['169.254.1.2'] : ['93.184.216.34'], /non-public/],
    ['metadata', async (hostname) => hostname === 'private.test' ? ['169.254.169.254'] : ['93.184.216.34'], /non-public/],
    ['unresolved', async (hostname) => { if (hostname === 'private.test') throw new Error('NXDOMAIN'); return ['93.184.216.34']; }, /DNS resolution failed/]
  ]) {
    let transports = 0;
    await assert.rejects(() => requestPinnedHttpEndpoint('https://private.test/v1', {
      signal: new AbortController().signal,
      headers: {},
      proxy: new URL('http://proxy.test:3128'),
      resolveHost,
      request: async () => { transports += 1; throw new Error('must not run'); }
    }), pattern, name);
    assert.equal(transports, 0, name + ' target must be rejected before proxy transport');
  }
});

test('proxy mode pins the proxy separately and verifies the actual proxy peer', async () => {
  const calls = [];
  await assert.rejects(() => requestPinnedHttpEndpoint('https://target.test/v1', {
    signal: new AbortController().signal,
    headers: {},
    proxy: new URL('http://proxy.test:3128'),
    resolveHost: async (hostname) => hostname === 'target.test' ? ['93.184.216.34'] : ['10.20.30.40'],
    request: async (url, addresses, init) => {
      calls.push({ url: String(url), addresses, targetAddresses: init.targetAddresses });
      return { response: new Response('{}', { headers: { 'content-type': 'application/json' } }), remoteAddress: '10.20.30.41' };
    }
  }), /did not match the pinned DNS result/);
  assert.deepEqual(calls, [{ url: 'https://target.test/v1', addresses: ['10.20.30.40'], targetAddresses: ['93.184.216.34'] }]);
});

test('proxy mode validates and pins every download redirect target', async () => {
  const resolved = [];
  const requested = [];
  await assert.rejects(() => downloadHttpResource('https://first.test/image', {
    signal: new AbortController().signal,
    maxBytes: 1024,
    proxy: new URL('http://proxy.test:3128'),
    resolveHost: async (hostname) => {
      resolved.push(hostname);
      if (hostname === 'first.test') return ['93.184.216.34'];
      if (hostname === 'proxy.test') return ['10.20.30.40'];
      return ['169.254.169.254'];
    },
    request: async (url, addresses, init) => {
      requested.push({ url: String(url), addresses, targetAddresses: init.targetAddresses });
      return { response: new Response(null, { status: 302, headers: { location: 'https://metadata.test/latest' } }), remoteAddress: '10.20.30.40' };
    }
  }), /non-public/);
  assert.deepEqual(resolved, ['first.test', 'proxy.test', 'metadata.test']);
  assert.deepEqual(requested, [{ url: 'https://first.test/image', addresses: ['10.20.30.40'], targetAddresses: ['93.184.216.34'] }]);
});

test('endpoint probing uses the same environment-proxy path as provider requests', async () => {
  const previous = process.env.http_proxy;
  try {
    await withProxy(async ({ seen, proxyPort, origin }) => {
      process.env.http_proxy = 'http://127.0.0.1:' + proxyPort;
      const result = await probeHttpEndpoint(origin + '/probe', { accept: 'application/json' }, new AbortController().signal, false, 'local_proxy');
      assert.deepEqual(result, { reachable: true, status: 200 });
      assert.equal(seen.absoluteUri, origin + '/probe');
    });
  } finally {
    if (previous === undefined) delete process.env.http_proxy;
    else process.env.http_proxy = previous;
  }
});
