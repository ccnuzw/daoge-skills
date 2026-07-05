const fs = require('fs');
const path = require('path');

function parseEnvFile(filePath) {
  const out = {};
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`缺少环境配置文件：${absolutePath}\n下一步：创建 .env，并填写 OPENAI_BASE_URL 和 OPENAI_API_KEY；或执行时传 --env-file /path/to/.env。`);
  }
  const raw = fs.readFileSync(absolutePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const normalizedLine = line.replace(/^\s*export\s+/, '');
    const idx = normalizedLine.indexOf('=');
    if (idx === -1) continue;
    const key = normalizedLine.slice(0, idx).trim();
    let value = normalizedLine.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value.trim();
  }
  return out;
}

function loadImageEnv(filePath) {
  const envFile = path.resolve(filePath || path.join(process.cwd(), '.env'));
  const env = parseEnvFile(envFile);
  if (!env.OPENAI_BASE_URL || !env.OPENAI_API_KEY) {
    throw new Error(`环境配置缺少 OPENAI_BASE_URL 或 OPENAI_API_KEY：${envFile}\n下一步：补齐这两个值后重跑 node scripts/daoge.js execute --output-dir out --env-file ${envFile}`);
  }
  return { envFile, env };
}

module.exports = { parseEnvFile, loadImageEnv };
