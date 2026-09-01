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

module.exports = { fetchStudio, requestJson, studioHeaders };
