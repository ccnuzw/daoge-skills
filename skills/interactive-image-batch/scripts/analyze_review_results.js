const fs = require('fs');
const path = require('path');
const { parseArgs, readJson, writeJson, parseEnvFile, fileExists } = require('./script_utils');

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function sanitizeReviewItem(item) {
  return {
    index: item.index || null,
    title: item.title || item.slug || item.index || 'untitled',
    slot_id: item.slotId || item.slot_id || null,
    request_mode: item.requestMode || item.request_mode || 'prompt-only',
    scene: item.scene || null,
    composition: item.composition || null,
    timecode: item.timecode || null,
    text_policy: item.textPolicy || item.text_policy || null,
    output: item.output || null,
  };
}

function resolveEnvFile(candidates) {
  for (const candidate of candidates) {
    if (candidate && fileExists(candidate)) return path.resolve(candidate);
  }
  return null;
}

async function requestReviewAnalysis({ baseUrl, apiKey, model, items, timeoutMs }) {
  const endpoint = `${String(baseUrl).replace(/\/+$/, '')}/responses`;
  const content = [
    {
      type: 'input_text',
      text: [
        '你是一个图片审阅助手。',
        '任务：根据图片和附带元数据，判断每个结果图更适合保留、复核还是重跑。',
        '重点观察：参考图贴合度、遮罩边界/融合感、主体完整性、文案留白风险、构图稳定性。',
        '只输出 JSON，字段必须包含 items。',
      ].join('\n'),
    },
  ];

  items.forEach((item) => {
    const absolutePath = path.resolve(item.output);
    const mime = absolutePath.toLowerCase().endsWith('.png')
      ? 'image/png'
      : (absolutePath.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    const b64 = fs.readFileSync(absolutePath).toString('base64');
    content.push({
      type: 'input_text',
      text: JSON.stringify({
        index: item.index,
        title: item.title,
        slot_id: item.slot_id,
        request_mode: item.request_mode,
        scene: item.scene,
        composition: item.composition,
        timecode: item.timecode,
        text_policy: item.text_policy,
        output: absolutePath,
      }),
    });
    content.push({
      type: 'input_image',
      image_url: `data:${mime};base64,${b64}`,
    });
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'review_analysis',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    output: { type: 'string' },
                    verdict: { type: 'string' },
                    confidence: { type: 'number' },
                    score: { type: 'number' },
                    risk_tags: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    reason: { type: 'string' },
                    next_action: { type: 'string' },
                  },
                  required: ['output', 'verdict', 'confidence', 'score', 'risk_tags', 'reason', 'next_action'],
                },
              },
            },
            required: ['items'],
          },
        },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`review analysis failed: ${payload?.error?.message || response.status}`);
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const parts = Array.isArray(item.content) ? item.content : [];
    for (const part of parts) {
      const candidate = part?.text || part?.output_text || part?.json || null;
      if (!candidate) continue;
      const parsed = typeof candidate === 'string' ? JSON.parse(candidate) : candidate;
      if (Array.isArray(parsed?.items)) return parsed.items;
    }
  }
  throw new Error('review analysis returned no items');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['success-file']) throw new Error('Missing required flag: --success-file');

  const successFile = path.resolve(args['success-file']);
  const outputDir = path.resolve(args['output-dir'] || path.dirname(successFile));
  const outputFile = path.resolve(args['output-file'] || path.join(outputDir, 'review_analysis.json'));
  const maxItems = Math.max(1, Number(args['max-items'] || 8));
  const success = readJson(successFile)
    .filter((item) => item && item.ok && item.output)
    .slice(0, maxItems)
    .map(sanitizeReviewItem);

  const envFile = resolveEnvFile([
    args['env-file'],
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '..', '.env'),
  ]);
  if (!envFile) {
    writeJson(outputFile, {
      enabled: false,
      reason: 'env-not-found',
      items: [],
    });
    console.log(JSON.stringify({ outputFile, enabled: false, reason: 'env-not-found' }, null, 2));
    return;
  }

  const env = parseEnvFile(envFile);
  if (!env.OPENAI_BASE_URL || !env.OPENAI_API_KEY) {
    writeJson(outputFile, {
      enabled: false,
      reason: 'missing-openai-env',
      items: [],
    });
    console.log(JSON.stringify({ outputFile, enabled: false, reason: 'missing-openai-env' }, null, 2));
    return;
  }

  const items = await requestReviewAnalysis({
    baseUrl: env.OPENAI_BASE_URL,
    apiKey: env.OPENAI_API_KEY,
    model: args['responses-model'] || env.OPENAI_RESPONSES_MODEL || 'gpt-5.4',
    items: success,
    timeoutMs: Number(args['vision-timeout-ms'] || 90000),
  });

  writeJson(outputFile, {
    enabled: true,
    reason: 'ok',
    envFile,
    itemCount: success.length,
    items,
  });
  console.log(JSON.stringify({
    outputFile,
    enabled: true,
    itemCount: success.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(String(error.message || error));
  process.exit(1);
});
