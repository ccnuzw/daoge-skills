# DAOGE Pic v5.6.0

本次发布完成 DAOGE Pic Studio 的本地安全、持久恢复、媒体一致性和 Workbench 交互升级。

## 新增能力

- 本地 daemon 使用高熵 capability；Workbench 通过 URL fragment 换取 `HttpOnly`、`SameSite=Strict` Cookie，失败时保留凭据并可安全重试。
- Provider 图片 URL 下载加入 SSRF 防护、DNS pin、远端地址校验、重定向逐跳验证和响应大小上限。
- 媒体导入、生成、回收、恢复与交付使用 journal、受验证 snapshot 和流式 ZIP。
- Workbench 增加 Generation History、SSE cursor/快照恢复、搜索、三阶段交付、冻结文件领取和真实模态图片查看。

## 关键修复

- 媒体路径从工作区根逐级拒绝符号链接，启动对账不会访问或移动工作区外文件。
- 单次运行并发正确支持 `1..30`，并始终受工作区 Worker 上限约束。
- 交付 journal、幂等回执和用户任务类型完成 Studio 隔离；歧义迁移数据进入隔离表。
- 交付批次选择和计划版本对比不再跨项目或轮次残留。
- 图片查看器使用 portal、全屏 backdrop 和 `inert`，阻止模态期间的背景操作。

## 验证

- `npm test`：207/207 通过。
- package smoke：86 个文件，临时安装、`daoge` bin、`--help` 和运行时资产检查通过。
- Chromium：桌面 1440×1000 与移动 390×844 验证通过。
- 制品 SHA-256：`19467b05624e18494e087982b0d261edd28cadc486602089e6a636bc986fe27a`。

## 安装

项目级安装：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.6.0/daoge-pic-5.6.0.tgz"
node -e "const fs=require('node:fs'),path=require('node:path');const source=path.resolve('node_modules/daoge-pic'),dest=path.resolve('.agents/skills/daoge-pic');if(fs.existsSync(dest))throw new Error('Skill destination already exists: '+dest);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.symlinkSync(source,dest,process.platform==='win32'?'junction':'dir')"
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.6.0/daoge-pic-5.6.0.tgz"
node -e "const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');const source=path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'daoge-pic'),dest=path.join(os.homedir(),'.codex','skills','daoge-pic');if(fs.existsSync(dest))throw new Error('Skill destination already exists: '+dest);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.symlinkSync(source,dest,process.platform==='win32'?'junction':'dir')"
```

注册命令在目标已存在时失败，不删除或覆盖已有 Skill。完成安装和注册后重启 Codex。已有 `provider.env` 配置保持不变；首次启动会自动迁移 Studio Schema。
