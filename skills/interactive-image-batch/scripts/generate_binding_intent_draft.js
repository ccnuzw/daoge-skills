const path = require('path');
const {
  parseArgs,
  readJson,
  writeJson,
  parseEnvFile,
} = require('./script_utils');
const {
  buildSlotMap,
  inferSequentialSlotIds,
  buildAssetRecords,
  splitCliList,
} = require('./reference_asset_analysis');

async function requestBindingIntentDraft({ baseUrl, apiKey, model, instruction, assets, slots, timeoutMs }) {
  const endpoint = `${String(baseUrl).replace(/\/+$/, '')}/responses`;
  const payload = {
    model,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: [
              '你是 storyboard 素材绑定规划助手。',
              '你的任务是把用户的中文绑定说明转成 binding intent draft。',
              '不要直接返回最终执行 JSON，只返回意图草案。',
              '如果用户表达不完整，也要尽量保留不确定性和候选项。',
            ].join('\n'),
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify({
              instruction,
              assets: assets.map((asset, index) => ({
                asset_index: index,
                path: path.resolve(asset.path),
                label: asset.label || null,
                notes: asset.notes || null,
                current_type: asset.type || 'reference',
                explicit_slot_id: asset.slot_id || null,
              })),
              slots: slots.map((slot) => ({
                slot_id: slot.slot_id,
                role: slot.role || null,
                shot_label: slot.shot_label || null,
                scene: slot.scene || null,
                prompt_hints: slot.prompt_hints || [],
              })),
            }, null, 2),
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'binding_intent_draft',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            slot_order: {
              type: 'array',
              items: { type: 'string' },
            },
            asset_intents: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  asset_index: { type: 'number' },
                  target_slot_id: { type: ['string', 'null'] },
                  intended_type: { type: 'string' },
                  confidence: { type: 'number' },
                  reason: { type: 'string' },
                },
                required: ['asset_index', 'target_slot_id', 'intended_type', 'confidence', 'reason'],
              },
            },
            prompt_only_slots: {
              type: 'array',
              items: { type: 'string' },
            },
            unresolved_questions: {
              type: 'array',
              items: { type: 'string' },
            },
            summary: { type: 'string' },
          },
          required: ['slot_order', 'asset_intents', 'prompt_only_slots', 'unresolved_questions', 'summary'],
        },
      },
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`binding intent draft failed: ${json?.error?.message || response.status}`);
  }
  const output = Array.isArray(json.output) ? json.output : [];
  for (const item of output) {
    const contents = Array.isArray(item.content) ? item.content : [];
    for (const contentItem of contents) {
      const candidate = contentItem?.text || contentItem?.output_text || contentItem?.json || null;
      if (!candidate) continue;
      return typeof candidate === 'string' ? JSON.parse(candidate) : candidate;
    }
  }
  throw new Error('binding intent draft returned no content');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['task-spec']) throw new Error('Missing required flag: --task-spec');
  if (!args['binding-text']) throw new Error('Missing required flag: --binding-text');

  const taskSpecPath = path.resolve(args['task-spec']);
  const taskSpec = readJson(taskSpecPath);
  const plan = taskSpec.storyboard_plan || {};
  if (plan.enabled !== true) throw new Error('task_spec.storyboard_plan.enabled must be true');
  const contentManifestPath = path.isAbsolute(plan.content_manifest)
    ? plan.content_manifest
    : path.resolve(path.dirname(taskSpecPath), plan.content_manifest);
  const contentManifest = readJson(contentManifestPath);
  const { slots } = buildSlotMap(contentManifest);

  const assets = buildAssetRecords(splitCliList(args.references || ''), 'cli');
  const orderedSlotIds = args['slot-order']
    ? splitCliList(args['slot-order'])
    : inferSequentialSlotIds(slots, { generateOnly: String(args['generate-only'] || 'true').trim().toLowerCase() !== 'false' });

  const envFile = path.resolve(args['env-file'] || path.join(process.cwd(), '.env'));
  const env = parseEnvFile(envFile);
  if (!env.OPENAI_BASE_URL || !env.OPENAI_API_KEY) {
    throw new Error(`Missing OPENAI_BASE_URL or OPENAI_API_KEY in ${envFile}`);
  }

  const draft = await requestBindingIntentDraft({
    baseUrl: env.OPENAI_BASE_URL,
    apiKey: env.OPENAI_API_KEY,
    model: args['responses-model'] || env.OPENAI_RESPONSES_MODEL || 'gpt-5.4',
    instruction: args['binding-text'],
    assets,
    slots: orderedSlotIds.length ? orderedSlotIds.map((slotId) => slots.find((slot) => slot.slot_id === slotId)).filter(Boolean) : slots,
    timeoutMs: Number(args['timeout-ms'] || 90000),
  });

  const outputPath = path.resolve(args['output-file'] || path.join(path.dirname(taskSpecPath), 'binding_intent_draft.json'));
  writeJson(outputPath, {
    taskSpecPath,
    contentManifestPath,
    binding_text: args['binding-text'],
    orderedSlotIds,
    draft,
  });

  console.log(JSON.stringify({
    outputPath,
    assetIntentCount: Array.isArray(draft.asset_intents) ? draft.asset_intents.length : 0,
    unresolvedQuestionCount: Array.isArray(draft.unresolved_questions) ? draft.unresolved_questions.length : 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(String(error.message || error));
  process.exit(1);
});
