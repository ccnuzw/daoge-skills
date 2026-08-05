# Provider 配置指南

DAOGE 当前支持四个图片 provider：

- `openai-images`：默认 provider，保留原有 OpenAI Images 行为。
- `gemini-image`：Gemini 原生 `generateContent` 风格 provider，不按 OpenAI Images API 兼容处理。
- `gemini-openai-compatible`：Gemini OpenAI-compatible 图片接口 provider，走 `/images/generations` 风格。
- `xai-grok-image`：xAI/Grok 图片生成 provider，当前只实现 text-to-image。

## OpenAI Images

`.env` 示例：

```env
IMAGE_PROVIDER=openai-images
OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-image-2
OPENAI_RESPONSES_MODEL=gpt-5.4
```

执行：

```bash
node scripts/daoge.js execute --output-dir out --env-file .env --batch-size 1 --concurrency 1
```

## Gemini 图片 Provider

`.env` 示例：

```env
IMAGE_PROVIDER=gemini-image
GEMINI_IMAGE_BASE_URL=
GEMINI_IMAGE_API_KEY=
GEMINI_IMAGE_MODEL=
GEMINI_IMAGE_AUTH_MODE=x-goog-api-key
```

可选项：

- `GEMINI_IMAGE_GENERATE_PATH`：覆盖请求路径，支持 `{model}` 占位符。
- `GEMINI_IMAGE_AUTH_MODE`：`x-goog-api-key`、`bearer`、`query-key`。
- `GEMINI_IMAGE_ENABLE_REFERENCE=1`：只有探测确认代理支持 `inlineData` 参考图输入后再开启。
- `GEMINI_IMAGE_MAX_RESPONSE_BYTES`：响应体大小上限，默认 128MB。

执行：

```bash
node scripts/daoge.js execute --provider gemini-image --output-dir out --env-file .env --batch-size 1 --concurrency 1
```

## 真实探测

默认不发真实网络请求。需要同时满足：

- `.env` 里有 `GEMINI_IMAGE_BASE_URL`、`GEMINI_IMAGE_API_KEY`、`GEMINI_IMAGE_MODEL`
- 环境变量 `RUN_PROVIDER_INTEGRATION=1`

探测命令：

```bash
RUN_PROVIDER_INTEGRATION=1 node scripts/probe_gemini_image_provider.js .env
```

未传路径时，探测脚本会依次查找当前目录、上一级、上两级、上三级的 `.env`。

集成测试：

```bash
RUN_PROVIDER_INTEGRATION=1 npm run test:integration
```

集成测试同样会查找当前目录到上三级的 `.env`；仍需显式设置 `RUN_PROVIDER_INTEGRATION=1` 才会发真实请求。

探测脚本会测试 `generateContent` 路径和鉴权方式，只输出状态码、路径、响应结构摘要、是否解析到 `inlineData.data`，不写入响应原文、图片内容或密钥。

## 本地探测结论

此前已用用户本地 `.env` 和显式 `RUN_PROVIDER_INTEGRATION=1` 做真实探测。文档只记录结构结论，不记录 baseurl、密钥、响应原文或图片内容。

已验证过的协议形状：

- endpoint 路径：`POST /v1beta/models/{model}:generateContent`。
- 鉴权方式：`x-goog-api-key` header。
- 请求体：`contents[].parts[].text` + `generationConfig.responseModalities=["TEXT","IMAGE"]`。
- 响应结构：`candidates[].content.parts[].inlineData.data`。
- 代理协议：此前成功响应表现为 Gemini 原生 `generateContent` 风格，不是 OpenAI Images API。

本轮回归探测现状：

- `/v1beta/models/{model}:generateContent` + `x-goog-api-key` 连续返回 500 摘要，标记为可重试，未解析到 `inlineData.data`。
- `/v1/models/{model}:generateContent` + `x-goog-api-key` 返回 404 摘要。
- 结论：代码路径和单元测试未退化，但当前代理真实原生生图请求未跑通。下一步需要用户确认代理侧 Gemini 原生服务是否临时异常、模型是否仍可用、或是否需要更新 `GEMINI_IMAGE_GENERATE_PATH` / `GEMINI_IMAGE_AUTH_MODE`。

实现策略：

- 支持路径覆盖，代理若改路径，可用 `GEMINI_IMAGE_GENERATE_PATH` 指定。
- 支持 `x-goog-api-key`、`bearer`、`query-key` 三种鉴权构造，但当前已验证的是 `x-goog-api-key`。
- 错误解析 `error.code`、`error.status`、`error.message`；`401/403` 归为认证失败，`404` 归为模型或 endpoint 不可用。
- `408/409/429/5xx` 和 `RESOURCE_EXHAUSTED`、`UNAVAILABLE`、`DEADLINE_EXCEEDED`、`ABORTED` 视为可重试。
- 参考图默认关闭；本轮只验证文本生图，未验证参考图输入。
- `size`、`quality` 对 Gemini provider 标记为不保证生效，不向上层伪装为 OpenAI Images 能力。

还需要用户确认：

- 是否要继续探测参考图 `inlineData` 输入。
- 是否有代理侧自定义 size/quality 参数。

## Gemini OpenAI-compatible Provider

官方 Gemini OpenAI-compatible 文档描述的图片接口是 OpenAI-style `images/generations`。本 provider 不复用 `gemini-image` 原生 `generateContent` 逻辑。

`.env` 示例：

```env
IMAGE_PROVIDER=gemini-openai-compatible
GEMINI_OPENAI_BASE_URL=
GEMINI_OPENAI_API_KEY=
GEMINI_OPENAI_MODEL=
GEMINI_OPENAI_IMAGE_GENERATE_PATH=
```

可选项：

- `GEMINI_OPENAI_IMAGE_GENERATE_PATH`：覆盖图片生成路径。
- `GEMINI_OPENAI_MAX_RESPONSE_BYTES`：JSON 响应体上限，默认 128MB。
- `GEMINI_OPENAI_MAX_DOWNLOAD_BYTES`：当响应返回 URL 时，下载图片上限，默认 64MB。

别名：

- `gemini-openai`
- `gemini-oai`

默认 endpoint 规则：

- 如果 base URL 已含 `/openai`，默认拼 `/images/generations`。
- 否则默认拼 `/v1beta/openai/images/generations`。
- 如果设置 `GEMINI_OPENAI_IMAGE_GENERATE_PATH`，以该路径为准。

请求结构：

```json
{
  "model": "环境变量里的模型名",
  "prompt": "提示词",
  "n": 1,
  "response_format": "b64_json"
}
```

默认鉴权：

- `Authorization: Bearer <key>`

响应解析：

- 优先读取 `data[0].b64_json`。
- 若返回 `data[0].url`，会下载图片并转成 base64 给上层。
- URL 下载会检查大小、超时和 `content-type: image/*`。

执行：

```bash
node scripts/daoge.js execute --provider gemini-openai-compatible --output-dir out --env-file .env --batch-size 1 --concurrency 1
```

受控探测：

```bash
RUN_PROVIDER_INTEGRATION=1 node scripts/probe_gemini_openai_provider.js .env
```

未传路径时，探测脚本会查找当前目录、上一级、上两级、上三级的 `.env`。

探测会尝试：

- 路径：`/v1beta/openai/images/generations`、`/openai/images/generations`、`/v1/images/generations`、`/images/generations`。
- 鉴权：Bearer、`x-goog-api-key`、query `key`。
- 请求体：`model`、`prompt`、`n: 1`、`response_format: b64_json`。

探测输出只包含 path、auth mode、status、是否解析到 `data[0].b64_json` 或 `data[0].url`、mime/格式摘要和脱敏错误摘要。

本轮用户代理探测结论：

- 已从仓库外 `.env` 读取 Gemini OpenAI-compatible 配置。
- `/v1beta/openai/images/generations`：Bearer、`x-goog-api-key`、query `key` 都返回 404 摘要，未解析到 `data[0].b64_json` 或 `data[0].url`。
- `/openai/images/generations`：三种鉴权都返回 200，但响应结构没有 `data[]`，未解析到图片字段。
- `/v1/images/generations`：Bearer、`x-goog-api-key` 返回 404 摘要；query `key` 返回 400 摘要。
- `/images/generations`：Bearer、`x-goog-api-key` 返回 404 摘要；query `key` 返回 400 摘要。
- 结论：当前用户代理未确认支持 Gemini OpenAI-compatible 图片接口。`gemini-openai-compatible` provider 已实现，但该代理需要用户确认实际图片接口路径、是否只支持文本模型 OpenAI-compatible、或是否需要代理侧单独开通 Images API。
- 文档不记录真实 baseurl、密钥、响应原文或图片内容。

## xAI/Grok 图片 Provider

`.env` 示例：

```env
IMAGE_PROVIDER=xai-grok-image
XAI_IMAGE_BASE_URL=https://api.x.ai/v1
XAI_IMAGE_API_KEY=
XAI_IMAGE_MODEL=grok-imagine-image-quality
XAI_IMAGE_RESPONSE_FORMAT=
```

可选项：

- `XAI_IMAGE_RESPONSE_FORMAT=b64_json`：请求 base64 响应。
- `XAI_IMAGE_RESPONSE_FORMAT=url`：请求 URL 响应；provider 会下载并转 base64。
- `XAI_IMAGE_MAX_RESPONSE_BYTES`：JSON 响应体上限，默认 128MB。
- `XAI_IMAGE_MAX_DOWNLOAD_BYTES`：URL 下载图片上限，默认 64MB。

别名：

- `grok-image`
- `xai-image`

请求结构：

```json
{
  "model": "grok-imagine-image-quality",
  "prompt": "提示词",
  "n": 1,
  "response_format": "可选",
  "aspect_ratio": "可选",
  "resolution": "可选"
}
```

尺寸映射：

- `1024x1024` 附近：`aspect_ratio=1:1`、`resolution=1k`。
- `1792x1024` 或 16:9 附近：`aspect_ratio=16:9`。
- `1024x1792` 或 9:16 附近：`aspect_ratio=9:16`。
- 最大边接近 2048：`resolution=2k`。
- 尺寸无法可靠判断时，不传 `aspect_ratio` 或 `resolution`。

执行：

```bash
node scripts/daoge.js execute --provider xai-grok-image --output-dir out --env-file .env --batch-size 1 --concurrency 1
```

真实 xAI 集成测试使用独立开关：

```bash
RUN_XAI_PROVIDER_INTEGRATION=1 npm run test:integration
```

当前限制：

- xAI reference/edit 本轮未实现，`edit` 会明确报错。
- 后续需要单独探测官方 image editing/reference 请求体和响应格式。

## 切换 provider

优先级：

1. CLI `--provider`
2. `.env` 的 `IMAGE_PROVIDER`
3. 默认 `openai-images`

示例：

```bash
node scripts/daoge.js execute --provider openai-images --output-dir out --env-file .env --dry-run true
node scripts/daoge.js execute --provider gemini-image --output-dir out --env-file .env --batch-size 1
node scripts/daoge.js execute --provider gemini-openai-compatible --output-dir out --env-file .env --batch-size 1
node scripts/daoge.js execute --provider xai-grok-image --output-dir out --env-file .env --batch-size 1
```

安全约束：

- 密钥只放 `.env`。
- 不把真实 key、baseurl、响应原文或图片内容贴进聊天、代码、测试、文档或提交历史。
- 所有真实网络测试必须显式设置对应 `RUN_*_INTEGRATION=1`。
