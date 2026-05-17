const fs = require('fs');
const path = require('path');
const {
  sanitize,
  normalizeApiPathOverride,
  resolveProviderPathOverride,
  detectMimeType,
  fileToDataUrl,
} = require('./run_batch_shared');

function supportsResponsesReferenceMode(pathOverride, operationMode) {
  if (operationMode === 'masked-edit') return false;
  return /\/responses(?:\/|$)/i.test(String(pathOverride || '').trim());
}

function supportsResponsesGenerateMode(pathOverride) {
  return /\/responses(?:\/|$)/i.test(String(pathOverride || '').trim());
}

function parseSseEvents(text) {
  const chunks = String(text || '').split(/\n\n/);
  const events = [];
  for (const rawChunk of chunks) {
    const lines = rawChunk.split(/\n/);
    let eventType = null;
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith('event:')) eventType = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) continue;
    const dataText = dataLines.join('\n');
    if (dataText === '[DONE]') {
      events.push({ type: eventType || 'done', done: true, data: null });
      continue;
    }
    try {
      events.push({ type: eventType || 'message', done: false, data: JSON.parse(dataText) });
    } catch {
      events.push({ type: eventType || 'message', done: false, data: { raw: dataText } });
    }
  }
  return events;
}

function extractResponsesImagePayload(text) {
  const events = parseSseEvents(text);
  let finalB64 = null;
  let revisedPrompt = null;
  let responseModel = null;
  let responseSize = null;
  let errorMessage = null;

  for (const event of events) {
    const data = event.data || {};
    if (data.error && !errorMessage) {
      errorMessage = typeof data.error === 'string' ? data.error : sanitize(JSON.stringify(data.error));
    }
    if (data.response?.model && !responseModel) responseModel = data.response.model;

    const responseOutput = Array.isArray(data.response?.output) ? data.response.output : [];
    for (const item of responseOutput) {
      if (item?.type === 'image_generation_call' && item?.result) {
        finalB64 = item.result;
        revisedPrompt = item.revised_prompt || revisedPrompt;
        responseSize = item.size || responseSize;
      }
    }

    if (data.item?.type === 'image_generation_call' && data.item?.result) {
      finalB64 = data.item.result;
      revisedPrompt = data.item.revised_prompt || revisedPrompt;
      responseSize = data.item.size || responseSize;
    }
  }

  return { finalB64, revisedPrompt, responseModel, responseSize, errorMessage };
}

function buildApiEndpoint(baseUrl, kind, options = {}) {
  const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  const overridePath = normalizeApiPathOverride(options.overridePath);
  if (overridePath) {
    if (/^https?:\/\//i.test(overridePath)) return overridePath.replace(/\/+$/, '');
    const normalizedOverride = overridePath.startsWith('/') ? overridePath : `/${overridePath}`;
    return `${normalizedBase}${normalizedOverride}`.replace(/\/+$/, '');
  }
  if (kind === 'edits') {
    if (/\/v1$/i.test(normalizedBase)) return `${normalizedBase}/images/edits`;
    if (/\/images\/edits$/i.test(normalizedBase)) return normalizedBase;
    return `${normalizedBase}/v1/images/edits`;
  }
  if (/\/v1$/i.test(normalizedBase)) return `${normalizedBase}/images/generations`;
  if (/\/images\/generations$/i.test(normalizedBase)) return normalizedBase;
  return `${normalizedBase}/v1/images/generations`;
}

function extractImagePayload(json) {
  const directData = json?.data?.[0];
  if (directData?.b64_json) {
    return {
      b64: directData.b64_json,
      revisedPrompt: directData.revised_prompt || null,
    };
  }
  if (directData?.base64) {
    return {
      b64: directData.base64,
      revisedPrompt: directData.revised_prompt || null,
    };
  }

  const outputs = Array.isArray(json?.output) ? json.output : [];
  for (const output of outputs) {
    const contents = Array.isArray(output?.content) ? output.content : [];
    for (const content of contents) {
      const candidate = content?.image_base64 || content?.b64_json || content?.base64;
      if (candidate) {
        return {
          b64: candidate,
          revisedPrompt: content?.revised_prompt || output?.revised_prompt || null,
        };
      }
    }
  }

  if (json?.image_base64 || json?.b64_json || json?.base64) {
    return {
      b64: json.image_base64 || json.b64_json || json.base64,
      revisedPrompt: json?.revised_prompt || null,
    };
  }

  return null;
}

function appendFileToForm(form, fieldName, filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`reference file not found: ${absolutePath}`);
  const buffer = fs.readFileSync(absolutePath);
  const blob = new Blob([buffer], { type: detectMimeType(absolutePath) });
  form.append(fieldName, blob, path.basename(absolutePath));
}

async function requestImage({ baseUrl, apiKey, model, prompt, size, outputFormat, timeoutMs, generatePath }) {
  const endpoint = buildApiEndpoint(baseUrl, 'generations', {
    overridePath: resolveProviderPathOverride({
      baseUrl,
      model,
      kind: 'generations',
      explicitOverride: generatePath,
    }),
  });
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        size,
        output_format: outputFormat,
        prompt,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`fetch failed for ${endpoint}: ${sanitize(error?.message || error)}`);
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`non-json response (${res.status}): ${text.slice(0, 300)}`);
  }

  const payload = extractImagePayload(json);
  if (!res.ok || !payload?.b64) {
    throw new Error(`http ${res.status}: ${sanitize(json?.error?.message || 'missing image payload')}`);
  }

  return {
    b64: payload.b64,
    revisedPrompt: payload.revisedPrompt,
    responseSize: json.size || null,
    responseModel: json.model || model,
  };
}

async function requestResponsesImageGenerate({ baseUrl, apiKey, toolModel, responsesModel, prompt, size, outputFormat, timeoutMs, generatePath }) {
  const endpoint = buildApiEndpoint(baseUrl, 'generations', {
    overridePath: resolveProviderPathOverride({
      baseUrl,
      model: toolModel,
      kind: 'generations',
      explicitOverride: generatePath,
    }),
  });

  const requestBody = {
    model: responsesModel,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
        ],
      },
    ],
    stream: true,
    tools: [
      {
        type: 'image_generation',
        model: toolModel,
        partial_images: 2,
        size,
        output_format: outputFormat,
      },
    ],
  };

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`fetch failed for ${endpoint}: ${sanitize(error?.message || error)}`);
  }

  const text = await res.text();
  const payload = extractResponsesImagePayload(text);
  if (!res.ok) {
    throw new Error(`http ${res.status}: ${sanitize(payload.errorMessage || text.slice(0, 300) || 'responses image generation failed')}`);
  }
  if (!payload.finalB64) {
    throw new Error(`responses image generation returned no final image payload from ${endpoint}`);
  }

  return {
    b64: payload.finalB64,
    revisedPrompt: payload.revisedPrompt,
    responseSize: payload.responseSize || size,
    responseModel: payload.responseModel || responsesModel,
  };
}

async function requestImageEdit({ baseUrl, apiKey, model, prompt, size, outputFormat, timeoutMs, referenceImages, maskImage, editPath }) {
  const endpoint = buildApiEndpoint(baseUrl, 'edits', {
    overridePath: resolveProviderPathOverride({
      baseUrl,
      model,
      kind: 'edits',
      explicitOverride: editPath,
    }),
  });
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('output_format', outputFormat);
  referenceImages.forEach((imagePath) => appendFileToForm(form, 'image[]', imagePath));
  if (maskImage) appendFileToForm(form, 'mask', maskImage);

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`fetch failed for ${endpoint}: ${sanitize(error?.message || error)}`);
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`non-json response (${res.status}): ${text.slice(0, 300)}`);
  }

  const payload = extractImagePayload(json);
  if (!res.ok || !payload?.b64) {
    throw new Error(`http ${res.status}: ${sanitize(json?.error?.message || 'missing image payload')}`);
  }

  return {
    b64: payload.b64,
    revisedPrompt: payload.revisedPrompt,
    responseSize: json.size || null,
    responseModel: json.model || model,
  };
}

async function requestResponsesImageEdit({ baseUrl, apiKey, toolModel, responsesModel, prompt, size, outputFormat, timeoutMs, referenceImages, editPath }) {
  const endpoint = buildApiEndpoint(baseUrl, 'edits', {
    overridePath: resolveProviderPathOverride({
      baseUrl,
      model: toolModel,
      kind: 'edits',
      explicitOverride: editPath,
    }),
  });

  const requestBody = {
    model: responsesModel,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          ...referenceImages.map((imagePath) => ({
            type: 'input_image',
            image_url: fileToDataUrl(imagePath),
          })),
        ],
      },
    ],
    stream: true,
    tools: [
      {
        type: 'image_generation',
        model: toolModel,
        partial_images: 2,
        size,
        output_format: outputFormat,
      },
    ],
  };

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`fetch failed for ${endpoint}: ${sanitize(error?.message || error)}`);
  }

  const text = await res.text();
  const payload = extractResponsesImagePayload(text);
  if (!res.ok) {
    throw new Error(`http ${res.status}: ${sanitize(payload.errorMessage || text.slice(0, 300) || 'responses image edit failed')}`);
  }
  if (!payload.finalB64) {
    throw new Error(`responses image edit returned no final image payload from ${endpoint}`);
  }

  return {
    b64: payload.finalB64,
    revisedPrompt: payload.revisedPrompt,
    responseSize: payload.responseSize || size,
    responseModel: payload.responseModel || responsesModel,
  };
}

async function requestWithFallback({ primary, fallback, fileBase, label }) {
  try {
    return await primary();
  } catch (primaryError) {
    console.log(`[fallback] ${fileBase} ${label}: ${sanitize(primaryError?.message || primaryError)} -> Images API`);
    try {
      return await fallback();
    } catch (fallbackError) {
      throw new Error(`${sanitize(primaryError?.message || primaryError)} | fallback failed: ${sanitize(fallbackError?.message || fallbackError)}`);
    }
  }
}

module.exports = {
  supportsResponsesReferenceMode,
  supportsResponsesGenerateMode,
  requestImage,
  requestResponsesImageGenerate,
  requestImageEdit,
  requestResponsesImageEdit,
  requestWithFallback,
};
