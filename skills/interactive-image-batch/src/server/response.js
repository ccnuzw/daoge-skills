function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function ok(res, data, statusCode = 200) {
  sendJson(res, statusCode, { ok: true, data });
}

function fail(res, statusCode, code, message, nextAction = '请检查请求参数后重试') {
  sendJson(res, statusCode, {
    ok: false,
    error: { code, message, nextAction },
  });
}

class HttpError extends Error {
  constructor(statusCode, code, message, nextAction = '请检查请求参数后重试') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.nextAction = nextAction;
  }
}

async function readBody(req, options = {}) {
  const limitBytes = Number(options.limitBytes || 1024 * 1024);
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) {
      throw new HttpError(413, 'BODY_TOO_LARGE', '请求内容过大。', '请减少请求内容后重试');
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '请求内容不是有效 JSON。', '请检查请求格式后重试');
  }
}

async function readJsonObjectBody(req, options = {}) {
  const body = await readBody(req, options);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'BODY_OBJECT_REQUIRED', '请求内容必须是 JSON 对象。', '请提交形如 {"key":"value"} 的 JSON 对象');
  }
  return body;
}

module.exports = { sendJson, ok, fail, readBody, readJsonObjectBody, HttpError };
