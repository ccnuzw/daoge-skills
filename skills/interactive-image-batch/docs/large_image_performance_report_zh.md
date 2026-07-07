# 大图后处理性能报告

日期：2026-07-07

## 背景

本轮目标是验证真实大文件场景下 `refreshWorkspace`、资产复制、结果页渲染、provider 内存保护的瓶颈，并确认上一轮 hardlink、结果页限量渲染、包体积优化没有回退。

本报告只记录可复现结论；基准产物均写入系统临时目录，单场景结束后删除，未提交大图或日志产物。

## 基准方法

- 构造 10MB、30MB、80MB 本地图片占位文件。
- 分别模拟 100、1000 条 `success` 结果。
- 每条结果指向同一个源文件，用于放大 `assets/results` 复制压力。
- 运行 `refreshWorkspace({ outputDir, taskSpecFile, manifestFile })`。
- 记录刷新耗时、`assets/` 磁盘占用、推荐/交付 hardlink 成功率、`results.html` 大小、`asset_library.json` 大小、RSS 近似变化。

## 数据

| 单文件大小 | 结果数 | 刷新耗时 | assets 占用 | hardlink 成功 | results.html | asset_library.json | RSS 变化 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10MB | 100 | 970.7ms | 1000.0MiB | 6/6 | 61,262B | 192,499B | +8.1MiB |
| 10MB | 1000 | 7137.0ms | 10055.9MiB | 6/6 | 71,675B | 1,765,712B | +31.6MiB |
| 30MB | 100 | 1949.5ms | 3004.1MiB | 6/6 | 61,262B | 192,499B | +1.8MiB |
| 30MB | 1000 | 17703.5ms | 30060.6MiB | 6/6 | 71,675B | 1,765,712B | +18.0MiB |
| 80MB | 100 | 4540.4ms | 8008.7MiB | 6/6 | 61,262B | 192,499B | +1.8MiB |
| 80MB | 1000 | 45528.1ms | 80061.9MiB | 6/6 | 71,675B | 1,765,712B | -3.7MiB |

## 结论

主要瓶颈是 `assets/results` 首次实体复制，随图片大小和结果数近似线性增长。80MB x 1000 条场景约 45.5 秒，磁盘占用约 80GB。

上一轮 hardlink 优化有效。推荐图和交付图的 hardlink 成功率为 100%，没有继续放大磁盘占用。

结果页限量渲染有效。1000 条结果的 `results.html` 保持在约 72KB，没有随结果数线性膨胀。

`asset_library.json` 仍随结果数线性增长。1000 条约 1.77MB，当前可接受；继续瘦身需要调整 public/internal 字段重复，可能触碰契约，建议暂缓。

RSS 变化没有显示持续增长风险。本轮读写路径主要受磁盘吞吐影响，不是 Node heap。

## 本轮代码修订

- `batch_executor` 将图片、meta、batch manifest 写入改为 `fs.promises.writeFile`，减少事件循环同步阻塞。
- `openai_images` 增加 provider 响应大小保护，默认响应文本上限 128MB。
- `openai_images` 增加参考图大小保护：单文件 50MB，multipart 总量 200MB，Responses data URL 路径总量 32MB。
- `openai_images` 对无 `content-length` 的 stream response 做累计字节限制；无 stream reader fallback 也会读后检查大小。
- 新增 provider 和 batch executor 单元测试。

## 后续建议

短期不建议拆 `asset_library` schema。收益有限，契约风险更高。

若要继续优化大图后处理，优先考虑避免 `assets/results` 对同源文件重复实体复制：可评估 canonical result 也使用 hardlink 或 copy-on-write clone，失败再 copy。

若要继续优化 provider 内存，单独做 Responses SSE 流式解析，不要和后处理 IO 优化混在同一轮。
