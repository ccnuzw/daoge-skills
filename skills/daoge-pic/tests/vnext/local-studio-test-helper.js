function studioHeaders(started, headers = {}) {
  return { authorization: 'Bearer ' + started.access.bearerToken, ...headers };
}

function fetchStudio(started, pathname, options = {}) {
  return fetch(started.url + pathname, { ...options, headers: studioHeaders(started, options.headers) });
}

async function requestJson(started, pathname, options = {}) {
  const response = await fetchStudio(started, pathname, {
    method: options.method || 'GET',
    headers: {
      accept: 'application/json',
      ...(options.body !== undefined ? { 'content-type': options.contentType || 'application/json' } : {}),
      ...(options.idempotencyKey || options.key ? { 'idempotency-key': options.idempotencyKey || options.key } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
      ...options.headers
    },
    body: options.body !== undefined ? (options.rawBody !== undefined ? options.rawBody : JSON.stringify(options.body)) : undefined,
    signal: options.signal
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

async function workbenchCookie(started) {
  const response = await fetch(started.url + '/api/auth/bootstrap', { method: 'POST', headers: { origin: started.url, accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ capability: started.access.bearerToken }) });
  if (!response.ok) throw new Error('Workbench bootstrap failed: ' + response.status);
  const setCookie = response.headers.get('set-cookie') || '';
  return setCookie.split(';', 1)[0];
}

async function requestJsonAsWorkbench(started, pathname, options = {}) {
  const cookie = options.cookie || await workbenchCookie(started);
  const method = options.method || (options.body === undefined ? 'GET' : 'POST');
  const response = await fetch(started.url + pathname, { method, headers: { accept: 'application/json', cookie, ...(options.body !== undefined ? { 'content-type': options.contentType || 'application/json' } : {}), ...(options.idempotencyKey || options.key ? { 'idempotency-key': options.idempotencyKey || options.key } : {}), ...(method !== 'GET' ? { origin: started.url } : {}), ...(options.headers || {}) }, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

module.exports = { fetchStudio, requestJson, studioHeaders, workbenchCookie, requestJsonAsWorkbench };
