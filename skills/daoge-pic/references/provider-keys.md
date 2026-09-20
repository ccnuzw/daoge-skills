# Provider、密钥与端点信任

本文件是 SKILL.md 的**按需**附录：配置生成服务、处理密钥后端、判断端点信任模式时读。

## Descriptor 与配置入口

- Provider 能力、端点信任、参考图/遮罩能力、媒体类型和输出规格来自版本化 Provider Descriptor；Profile store、API、Workbench、预检和 HTTP adapter 必须消费同一份 Descriptor。
- Workbench 可管理 Profile、模型、端点信任模式和限额；API Key 与完整 Base URL 只写不回显。页面打开、加载或保存不得自动连接 Provider；显式连接测试和模型列表读取只在用户点击时访问 Provider。

## 端点信任模式

- `compatible_public` 必须使用 HTTPS；需要 HTTP 时只能显式选择 `local_proxy` 或 `enterprise_private`，并接受对应私网地址策略。
- 端点信任模式决定允许解析到哪些非公有地址：`local_proxy` 放行 loopback、CGNAT/overlay（100.64.0.0/10，含 Tailscale 等）、RFC 2544 benchmark 段（198.18.0.0/15，即 TUN／虚拟网卡代理常用的 fake-IP）与 IPv6 ULA 和回环；`enterprise_private` 放行 RFC1918、IPv6 ULA 与回环。
- **任何模式都不放行** link-local、云元数据（169.254.169.254）、文档、多播与保留段。使用 TUN 代理（本地代理接管 DNS 并返回 fake-IP）时必须显式选择 `local_proxy`，此时公有主机名的告警是正常的。

## 工作区与运行时目录

- 运行时必须是 Node.js `22.17.0` 或更高版本。
- 每次必须使用稳定工作区根目录（`--workspace` 或 `DAOGE_WORKSPACE_ROOT`；cwd 回退只在祖先里确有已落盘 Studio 时成立），不得回退到任意当前目录；请求根没有 manifest 但祖先存在有效 Studio 时，默认拒绝初始化并改用父级稳定工作区。
- 运行时目录形态固定为 `<workspace>/daoge-studio`、`<workspace>/daoge-assets`、`<workspace>/daoge-deliveries`。`studio.db` 是业务事实源；`Provider.db` 是 Provider Profile、密钥引用与 write-only 摘要的唯一运行时事实源。