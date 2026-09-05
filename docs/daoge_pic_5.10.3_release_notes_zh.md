# DAOGE Pic v5.10.3

本版本修复 Workbench 与智能体会话都能预检和入队时，同一份人工计划可能生成两个批次的问题。确认、预检和运行创建现在具有单一职责，并由 daemon 在 Provider 调用前执行轮次级防重。

## 确认与运行入口

- Workbench 人工确认闸门只提交计划确认，不再从浏览器执行预检或创建 Generation Run。
- 确认成功后，Workbench 明确提示返回当前智能体会话继续；预检和运行创建只接受 Bearer Skill/CLI。
- 已加载旧 Workbench 页面尝试从 Cookie 调用预检或入队时会收到 `403`，不会触发 Provider。
- Skill 在确认后先检查当前会话摘要和 Generation History；已有运行时直接选择并汇报，不再提交第二次预检。

## 轮次级重复运行防护

- 每个 Creative Round 的已确认计划只允许创建一个初始 Generation Run。
- 首个运行创建后，其他预检证据、幂等键、客户端或并发入口会收到带已有运行信息的 `409` 冲突。
- 重复预检和重复入队不会写入新的运行或幂等回执，也不会调用 Provider。
- 失败项继续在原运行中受控重试；用户明确要求再次生成时，创建新的变体、优化或补图轮次。
- 历史工作区中的既有重复运行保持可查看，不执行破坏性迁移或删除。

## 协议与升级

- Skill 协议仍为 `daoge-pic-skill-protocol 2.0.0`，确认令牌结构不变。
- 运行时兼容下限提升为 `>=5.10.3 <6.0.0`，避免新 Skill 与旧 daemon 混用后绕过防重。
- 本版本不改变 Studio Schema，也不要求迁移 Provider 配置。
- 安装后需要完整重启 Codex；已有 Studio daemon 需要由 5.10.3 CLI 受控重启后才应用新运行边界。

## 验证与制品

- `npm test`：295 项通过，0 失败、0 取消、0 跳过。
- `npm run test:package`：116 个发布文件，`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`，临时 consumer 安装、bin 与 help 检查通过。
- `npm audit --omit=dev --offline`：0 个漏洞。
- 验证未调用真实图片 Provider，未产生计费生成请求。
- 制品 `daoge-pic-5.10.3.tgz`：332,272 bytes。
- SHA-256：`29b6887a5cb91f479537c51d60750c25ea0581b6661fda6e9c82d42ce7914413`。

项目级安装：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.10.3/daoge-pic-5.10.3.tgz"
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.10.3/daoge-pic-5.10.3.tgz"
```

安装并注册 Skill 后，需要完整重启 Codex，使其重新加载 Skill registry。
