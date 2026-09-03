# DAOGE Pic v5.9.0

本次为 Workbench 性能与体验综合版本。除本轮性能治理外，也合并了工作树中此前完成但尚未发布的确认对话框、学习中心、Provider 连接测试和视觉可读性改进。

## 性能改进

- 使用基于内容哈希的 WebP 缩略图缓存，资产网格、共享素材、交付历史、运行结果和轮次对比不再默认加载原图。
- 原图与交付图片支持 ETag、条件请求、单 Range 和断点传输。
- 大媒体校验、上传、生成落盘、交付导出、ZIP 和启动媒体恢复改为异步分块处理，降低 Node 事件循环阻塞。
- Schema v20 增加查询索引；资产评审、项目选片、交付列表和任务轮次对比消除主要 N+1 查询。
- SSE 使用进程内唤醒、100 条有界批次和 2000 条事件窗口；运行项状态合并为运行级通知。
- 参考素材最多 8 张、合计最多 64 MiB；同一 Worker 的并发运行项共享引用素材缓存，缓存总量为 256 MiB。
- Workbench 资产、选片和上下文刷新解耦；全选本页和清空选片使用批量事务 API，多图导入采用 4 路有界并发。

## 体验改进

- 删除、归档、Provider 删除和清除连接信息统一使用可访问确认对话框。
- 项目与任务搜索使用索引和延迟查询；交付历史使用 Map 查找；任务对比显式提示历史截断。
- Provider 连接测试失败时提供可操作的客户端错误信息。
- `sharp` 与 `vite` 升级到已修复版本，生产依赖审计无漏洞。

## 兼容性

- 现有工作区自动迁移到 Schema v20，保留项目、任务、轮次、运行和资产数据。
- 需要 Node.js 22 LTS 或更高版本。
- 安装固定使用本版本 GitHub Release `.tgz`；安装并注册 Skill 后需要完整重启 Codex。

## 安装

项目级安装：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.9.0/daoge-pic-5.9.0.tgz"
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.9.0/daoge-pic-5.9.0.tgz"
```

安装后按 [daoge-pic README](../skills/daoge-pic/README.md) 完成 Skill 注册，并完整重启 Codex。
