# DAOGE Pic v5.10.4（发布候选）

本候选版本集中解决 Windows 安装、工作区兼容、ACL 冷启动、后台 Worker 恢复和 Workbench 诊断体验。当前稳定 GitHub Release 仍为 5.10.3；只有 Windows Actions 四组矩阵通过并创建 `daoge-pic-v5.10.4` Release 后，才能移除“发布候选”标记。

## 主要变化

- 新工作区在创建 Studio 文件前拒绝 UNC、同步盘/系统目录、非本地固定磁盘、非 NTFS 与 junction/symlink。
- Windows daemon 身份查询改用系统 Windows PowerShell/CIM，并具有内外层超时；不依赖 WMIC。
- daemon owner 在一个 PowerShell 进程中批量设置并复核敏感目录、manifest、SQLite 与 sidecar DACL；Worker 不再重复修改 ACL。
- Generation/media Worker 只附加已初始化数据库，从零按需启动；持续负载渐进扩容，连续恢复失败后熔断并公开脱敏健康状态。
- 新增 `register-skill --scope project|user` 和无 Provider 调用的 `doctor --workspace <path> [--json true] [--redacted true]`。
- package smoke 使用隔离 pack 目录、中文空格 consumer 路径和真实 bin；Windows 实际执行 `daoge.cmd`。
- 交付目录保留安全 Unicode、规避 Windows 设备保留名，并使用短 ID 防止正规化碰撞。
- Workbench 新增运行健康横幅、安全重启、状态刷新、脱敏诊断复制，以及“安全关闭 → 重连 → 快照恢复 → 已恢复”反馈。

## 兼容性

- Node.js：`>=22.13.0`
- Skill protocol：`daoge-pic-skill-protocol 2.0.0`
- Runtime compatibility：`>=5.10.4 <6.0.0`
- Studio Schema：保持 v22
- Provider 配置：无需迁移；`Provider.db` 仍是受本地权限保护的明文 SQLite

## 安装

GitHub Release 创建后，项目级安装：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.10.4/daoge-pic-5.10.4.tgz"
npx daoge register-skill --scope project --workspace /absolute/workspace
npx daoge doctor --workspace /absolute/workspace
```

Windows PowerShell：

```powershell
npm.cmd install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.10.4/daoge-pic-5.10.4.tgz"
npx.cmd daoge register-skill --scope project --workspace "C:\Users\<用户名>\source\<项目名>"
npx.cmd daoge doctor --workspace "C:\Users\<用户名>\source\<项目名>"
```

目标 Skill 目录已存在时，`register-skill` 会拒绝覆盖。安装和注册完成后完整重启 Codex。

## 验证与候选制品

- macOS `npm test`：315 项，313 通过、0 失败、2 项仅 Windows 实机用例跳过。
- `npm run test:package`：122 个发布文件；清单、安装、真实 bin、注册、doctor 与 `sharp` 全部通过。
- `npm run bench:perf`：空 Studio control-plane 41.81 ms，需求前 media process 为 0；100000 pending 队列领取 1000 项为 128.03 ms，RSS 105.6 MiB。
- 浏览器实测 1440×1000 与 375×812；无横向溢出，移动端健康操作高度 44px，实际 daemon 重启完整显示恢复阶段。
- Windows Actions 已配置 Windows Server 2022/2025 × Node.js 22.13.0/24；分支推送前不把本地 macOS 结果写成 Windows runner 已通过。
- 本地候选制品：`daoge-pic-5.10.4.tgz`，350,241 bytes。
- SHA-256：`a3c8e6e2dfcdac35f9577c6d7685c3164380818769918a0b57491c50cfd50dd5`。
- 验证未调用真实图片 Provider，未产生计费生成请求。
