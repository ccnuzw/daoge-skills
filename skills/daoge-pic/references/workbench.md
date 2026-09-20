# Workbench 边界与可访问性

本文件是 SKILL.md 的**按需**附录：需要向用户解释界面能做什么 / 不能做什么，
或需要判断「界面状态算不算事实」时读。

Workbench 可用于：项目/任务/轮次导航与直接创建、创作谱系、Generation History、SSE 状态、素材导入、范围筛选、搜索、放大/双图对比、选择、批注、来源检查、共享、回收、恢复、交付历史、下载/复制和 ZIP。Workbench **不提供开放式对话**；它提供一个**受限请求入口**（请求—回执—追问，无对话历史）：用户说出的那句话进入共享请求队列，由在场 Agent 按 SKILL.md「请求队列」节接单。Workbench 不直接调用 Provider，不展示 Provider 密钥。

Workbench 顶部持续显示 daemon 与 Worker 池脱敏健康状态；SSE cursor 失效或本地事件批次溢出时，必须先完成权威快照恢复，再推进 cursor。图片查看、确认、搜索和错误状态必须保持可访问性：`role="dialog"`、`aria-modal`、焦点约束、Escape 关闭、live region 和可见焦点。

Workbench 不可用于：开放式对话（受限请求入口不属于开放式对话）、绕过会话确认、一键触发 Provider 生成、展示 Provider 密钥、直接指定任意绝对路径、匿名访问、跨 Studio 访问，或把浏览器状态、文件夹和 SSE 当业务事实。