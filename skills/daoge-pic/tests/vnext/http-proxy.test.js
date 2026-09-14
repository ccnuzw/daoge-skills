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
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDBYo+BIztN9gSV
CIBppQS3kepAr3QsvL16z4CY64Cfzr3xErvzUjt8Ib0En+bmJghdq8L16S3CLcB4
tXbf6ElXMcLkCfsB1wQT9kDTehjof27Va6Fkjbf5rvo3GOHh6vK2IueUBJnjhiRH
c3Mrj3oAx93FJw5T2kw3G7BW7bwK3nfz5dMXDYjLUNC6CjHMjlxG6C+xeCw6r4p5
bJbnwVBTuR6temiJoQ4hnVOTetwfaG3OUCsoTrLqOX1JcEf9/4p9OZW2lxo+oInI
XS6VX4Ze96RdQKC45ROKI21zN+n2ofdfqHhTvVcuKCn9gXSc4S0DwmiwsnINAUyR
B/RFG5hJAgMBAAECggEAAyelpLCGSVLP/KhwroiJJ6ot5/6UxsgQz/NDq1BS6bMt
6RlqTza9DrI0NbeaxOVuRyzurM6wNutCfmr4ygAC9kpds2pa7yBACkf/AxQ1BNH+
D7rw8prXRgUDQv6DwjOa4GV4YV35LruOVaC+Cmy4S6ahvmjRNIVVWfl4f9U4DKCm
O/+1Pl/0bBSu7y3DNP2feRyNDEOBVnm+zxiuVLQslnX0E40ar1Zhz5jTKN5v3/lS
QumVOlu/LHGtIrnOMGdzQ1Dq27lv4d+XvcpeW+VQ+jF5JsCx5DwhT74BgxNofXK9
RLefpwdHbU89B6SrhmAAhqnfpojokCJoT1qRALX1gQKBgQDlKMMty1+iWRxRmo7l
jqTh2N+HNN4nhe4QbMHToIxGW7b5lTw0PsbHA7cBFjUmnzeGQIccqq25nlGzuAxh
bAo6ALNxBU6slRJdpWggCvpBepAQaECkSvW/p2ukoRw4PbLE0Qz6GaBfj9vQG7iW
+g5YbpZTvu0U0jMDxzRS0riLYQKBgQDYCR+23+JiyUF2ap5IgoMWP5Oxq3BpWtOb
IULdIA7HVSPlmjcLXMEuVwNkew3mugxfqABVVrneJ4G6OjVuFQ68Fx5OCqSBx9mw
GGVHJP2+AYxUQIowAWJTt3aOawJMRk7XYZQudRx/wg4ECBY+em6He9DSANdrG13X
Wf+aHhLd6QKBgCDgGjAlrxChbBig7cMtFaZ48Ih7IyvUYPTmRWBQ9g7Z9YQUztBH
+Uhv1f9H6lQiH1sZQsjwC4BHoD0COHR5hXYQx619L24+7KWWpzuBl6lxJd3UtwFa
56qZIC48FspSv6TQwOXYa1OKVeSjNXYjZY92PgbBq02DYmI2X+FJ7cPBAoGBAKqU
6bnYpkUibNI39auDgkZ7BP/xQt2tnhCL/uPjgEfc7m9JidUq9E7G3iLlF2Dr3wFZ
Aopf5HuJ7mFBvRajAfN6va8ZsDPZvgXR/YZjqwfw6QFNxM+LCDzaTH6/+ByKF47x
ubPFPS+T5sVALXA/9C5+kbCAgZhND5gPtEfZH0ShAoGBAMO52FKIhaVazYzgZWHK
an5KhWpGO53wLGzrUbCidMnmgGJNmDFo+exj+b1YD+cE6PMA9gzaN2/ndQ8ORmVk
JBMZPB5XyOi4XB5s/BBaRFXP8LRluv75CiAXMsLCxtZui8btVXQ1y/NuTF5WrRAA
6JIe8ek+eHlbCS/8rjTpwPTn
-----END PRIVATE KEY-----`;
const tlsCert = `-----BEGIN CERTIFICATE-----
MIIDRDCCAiygAwIBAgIUKYhIf8OUzvV519PBT3MDNSQNeDIwDQYJKoZIhvcNAQEL
BQAwFjEUMBIGA1UEAwwLdGFyZ2V0LnRlc3QwHhcNMjYwOTE0MTQ0MTM1WhcNMjYw
OTE2MTQ0MTM1WjAWMRQwEgYDVQQDDAt0YXJnZXQudGVzdDCCASIwDQYJKoZIhvcN
AQEBBQADggEPADCCAQoCggEBAMFij4EjO032BJUIgGmlBLeR6kCvdCy8vXrPgJjr
gJ/OvfESu/NSO3whvQSf5uYmCF2rwvXpLcItwHi1dt/oSVcxwuQJ+wHXBBP2QNN6
GOh/btVroWSNt/mu+jcY4eHq8rYi55QEmeOGJEdzcyuPegDH3cUnDlPaTDcbsFbt
vAred/Pl0xcNiMtQ0LoKMcyOXEboL7F4LDqvinlslufBUFO5Hq16aImhDiGdU5N6
3B9obc5QKyhOsuo5fUlwR/3/in05lbaXGj6gichdLpVfhl73pF1AoLjlE4ojbXM3
6fah91+oeFO9Vy4oKf2BdJzhLQPCaLCycg0BTJEH9EUbmEkCAwEAAaOBiTCBhjAd
BgNVHQ4EFgQU9DrPEhXJCtPspHo45RQb2gYwQQkwHwYDVR0jBBgwFoAU9DrPEhXJ
CtPspHo45RQb2gYwQQkwDwYDVR0TAQH/BAUwAwEB/zAzBgNVHREELDAqggt0YXJn
ZXQudGVzdIIKcHJveHkudGVzdIIJbG9jYWxob3N0hwR/AAABMA0GCSqGSIb3DQEB
CwUAA4IBAQCIBvuLXqKbd38tnmJCd17rkQvMm/sqhNAAimOTXmcdR8I7moppIEEn
kxa/75hdyIqjhUEwrrK21v/mgiHcqFZzkCBZzX2mDQl+OxT5x4nPci1oc8jBtg32
WW/A13EBkQgLSXEQtb/kWJIDUL36kVtE+W6pGK84SIwzLsFGjWXWf49ai25vGWMu
kQ6L4xpNjxI7RDYumOmhXVgKao0IJt+qtLJ/VmQreV1WzVegl7t2UGOSn+kEn0hj
om1Zq4K2Y15RQkGODr2l+3LOrYGP5Je/g9oavygqVdMMk0yPTclcQ5Vh+P9jX8Dj
CaO8ngI/jU91pOgXlLL4AfoBXE+TPu/0
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
  await withProxy(async ({ seen, originPort, proxyPort, origin }) => {
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
  await withProxy(async ({ seen, originPort, proxyPort, origin }) => {
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
