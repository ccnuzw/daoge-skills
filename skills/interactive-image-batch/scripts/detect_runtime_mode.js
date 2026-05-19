const fs = require('fs');
const path = require('path');
const { parseArgs, parseEnvFile, writeJson } = require('./script_utils');

function hasFile(filePath) {
  try {
    return fs.existsSync(path.resolve(filePath));
  } catch {
    return false;
  }
}

function truthy(value) {
  return new Set(['1', 'true', 'yes', 'on', 'y']).has(String(value || '').trim().toLowerCase());
}

function normalizeHostSignal(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return 'none';
  if (['native', 'image-tool', 'host-native', 'true', 'yes', '1'].includes(value)) return 'image-tool';
  if (['advisor', 'prompt-only', 'text-only'].includes(value)) return 'advisor';
  return value;
}

function buildSummary(mode, state) {
  if (mode === 'local-batch-runner') {
    return '检测到本地 runner、.env 和有效凭证，优先走 DAOGE 完整 prepare/execute 主线。';
  }
  if (mode === 'host-native-image-tool') {
    if (state.hasOpenaiBaseUrl && state.hasOpenaiApiKey) {
      return '检测到宿主原生图像工具信号，并且当前显式偏好 host-native 路径，优先输出 DAOGE 轻量交接包。';
    }
    return '检测到宿主原生图像工具信号，但本地 runner 凭证不完整，优先走 DAOGE 轻量 host-native 路径。';
  }
  if (mode === 'local-runner-missing-credentials') {
    return '检测到本地 runner 环境，但缺少 OPENAI_BASE_URL 或 OPENAI_API_KEY，当前不应进入本地 execute。';
  }
  return '未检测到可执行的本地 runner 或宿主图像工具，当前应退化为 prompt-advisor 路径。';
}

function detectMode(state) {
  if (state.hasLocalRunner && state.hasOpenaiBaseUrl && state.hasOpenaiApiKey) {
    return 'local-batch-runner';
  }
  if (state.hostNativeSignal === 'image-tool') {
    return 'host-native-image-tool';
  }
  if (state.hasLocalRunner && (!state.hasOpenaiBaseUrl || !state.hasOpenaiApiKey)) {
    return 'local-runner-missing-credentials';
  }
  return 'prompt-advisor';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const skillRoot = path.resolve(args['skill-root'] || path.join(__dirname, '..'));
  const cwd = path.resolve(args.cwd || process.cwd());
  const envFile = path.resolve(args['env-file'] || path.join(cwd, '.env'));
  const env = hasFile(envFile) ? parseEnvFile(envFile) : {};

  const hasLocalRunner = hasFile(path.join(skillRoot, 'scripts', 'run_batch.js'))
    && hasFile(path.join(skillRoot, 'scripts', 'daoge_prepare_run.js'));
  const hasOpenaiBaseUrl = Boolean(String(env.OPENAI_BASE_URL || '').trim());
  const hasOpenaiApiKey = Boolean(String(env.OPENAI_API_KEY || '').trim());
  const hostNativeSignal = normalizeHostSignal(args['host-native-signal'] || env.DAOGE_HOST_NATIVE_SIGNAL || process.env.DAOGE_HOST_NATIVE_SIGNAL);
  const preferHostNative = truthy(args['prefer-host-native'] || env.DAOGE_PREFER_HOST_NATIVE || process.env.DAOGE_PREFER_HOST_NATIVE);

  const state = {
    skillRoot,
    cwd,
    envFile: hasFile(envFile) ? envFile : null,
    hasOpenaiBaseUrl,
    hasOpenaiApiKey,
    hasLocalRunner,
    hostNativeSignal,
    preferHostNative,
    has_openai_base_url: hasOpenaiBaseUrl,
    has_openai_api_key: hasOpenaiApiKey,
    has_local_runner: hasLocalRunner,
    host_native_signal: hostNativeSignal,
    prefer_host_native: preferHostNative,
  };

  let mode = detectMode({
    hasLocalRunner,
    hasOpenaiBaseUrl,
    hasOpenaiApiKey,
    hostNativeSignal,
  });

  if (preferHostNative && hostNativeSignal === 'image-tool' && mode === 'local-batch-runner') {
    mode = 'host-native-image-tool';
  }

  let recommendation = 'use-local-runner';
  if (mode === 'host-native-image-tool') recommendation = 'use-host-native-light-path';
  if (mode === 'prompt-advisor') recommendation = 'use-prompt-advisor';
  if (mode === 'local-runner-missing-credentials') recommendation = 'collect-credentials-or-downgrade';

  const result = {
    mode,
    recommendation,
    ...state,
    summary: buildSummary(mode, state),
  };

  const outputPath = args['output-file'] ? path.resolve(args['output-file']) : null;
  if (outputPath) writeJson(outputPath, result);
  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
