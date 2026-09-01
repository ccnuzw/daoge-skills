# DAOGE Release Notes 模板

适用仓库：

- `ccnuzw/daoge-skills`

适用对象：

- `daoge-pic`

## Patch 版本模板

适用于：

- `v1.0.1`
- `v1.0.2`
- `v1.0.3`

```md
# DAOGE Skills vX.Y.Z

本次为小版本修复发布，重点是稳定性、兼容性和易用性增强。

## 本次更新

- 修复：
- 优化：
- 兼容性：

## 影响范围

- `daoge-pic`

## 安装

以下命令固定使用本版本 GitHub Release 的不可变 `.tgz`，不会跟随 `main`。npm 安装提供 `daoge` CLI 和运行时，link/junction 注册让 Codex 发现 Skill；两步缺一不可。

项目级安装（在项目根目录执行）：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v<VERSION>/daoge-pic-<VERSION>.tgz"
node -e "const fs=require('node:fs'),path=require('node:path');const source=path.resolve('node_modules/daoge-pic'),dest=path.resolve('.agents/skills/daoge-pic');if(fs.existsSync(dest))throw new Error('Skill destination already exists: '+dest);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.symlinkSync(source,dest,process.platform==='win32'?'junction':'dir')"
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v<VERSION>/daoge-pic-<VERSION>.tgz"
node -e "const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');const source=path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'daoge-pic'),dest=path.join(os.homedir(),'.codex','skills','daoge-pic');if(fs.existsSync(dest))throw new Error('Skill destination already exists: '+dest);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.symlinkSync(source,dest,process.platform==='win32'?'junction':'dir')"
```

注册命令在目标已存在时失败，不删除或覆盖已有 Skill 目录。安装和注册完成后重启 Codex。

## 升级建议

- 如目标 Skill 目录已存在，请先确认其来源并自行处理，不要直接覆盖
- 保持项目根目录 `.env` 不变即可继续使用
```

## Minor 版本模板

适用于：

- `v1.1.0`
- `v1.2.0`

```md
# DAOGE Skills vX.Y.0

本次为功能增强版本，新增能力和工作流优化为主。

## 新增能力

- 新增：
- 新增：

## 优化项

- 优化：
- 优化：

## 修复项

- 修复：

## 兼容性说明

- 项目级安装：`.agents/skills/daoge-pic/`
- 全局安装：`~/.codex/skills/daoge-pic/`
- 运行仍依赖项目根目录 `.env`

## 安装

以下命令固定使用本版本 GitHub Release 的不可变 `.tgz`，不会跟随 `main`。npm 安装提供 `daoge` CLI 和运行时，link/junction 注册让 Codex 发现 Skill；两步缺一不可。

项目级安装（在项目根目录执行）：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v<VERSION>/daoge-pic-<VERSION>.tgz"
node -e "const fs=require('node:fs'),path=require('node:path');const source=path.resolve('node_modules/daoge-pic'),dest=path.resolve('.agents/skills/daoge-pic');if(fs.existsSync(dest))throw new Error('Skill destination already exists: '+dest);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.symlinkSync(source,dest,process.platform==='win32'?'junction':'dir')"
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v<VERSION>/daoge-pic-<VERSION>.tgz"
node -e "const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');const source=path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'daoge-pic'),dest=path.join(os.homedir(),'.codex','skills','daoge-pic');if(fs.existsSync(dest))throw new Error('Skill destination already exists: '+dest);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.symlinkSync(source,dest,process.platform==='win32'?'junction':'dir')"
```

注册命令在目标已存在时失败，不删除或覆盖已有 Skill 目录。安装和注册完成后重启 Codex。

## 升级建议

- 建议先看 README 中的安装和验证说明
- 如新增运行参数，请同步更新 README
- 如涉及提示词工作流变更，请在 release 中明确写出
```

## Major 版本模板

适用于：

- `v2.0.0`

```md
# DAOGE Skills vX.0.0

本次为主版本升级，包含重要能力升级或兼容性变化。

## 重点变化

- 变化：
- 变化：

## 新增能力

- 新增：

## 不兼容变更

- 变更：
- 影响：
- 迁移方式：

## 安装

以下命令固定使用本版本 GitHub Release 的不可变 `.tgz`，不会跟随 `main`。npm 安装提供 `daoge` CLI 和运行时，link/junction 注册让 Codex 发现 Skill；两步缺一不可。

项目级安装（在项目根目录执行）：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v<VERSION>/daoge-pic-<VERSION>.tgz"
node -e "const fs=require('node:fs'),path=require('node:path');const source=path.resolve('node_modules/daoge-pic'),dest=path.resolve('.agents/skills/daoge-pic');if(fs.existsSync(dest))throw new Error('Skill destination already exists: '+dest);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.symlinkSync(source,dest,process.platform==='win32'?'junction':'dir')"
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v<VERSION>/daoge-pic-<VERSION>.tgz"
node -e "const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');const source=path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'daoge-pic'),dest=path.join(os.homedir(),'.codex','skills','daoge-pic');if(fs.existsSync(dest))throw new Error('Skill destination already exists: '+dest);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.symlinkSync(source,dest,process.platform==='win32'?'junction':'dir')"
```

注册命令在目标已存在时失败，不删除或覆盖已有 Skill 目录。安装和注册完成后重启 Codex。

## 升级前建议

- 先备份旧版 Skill 目录，并确认现有 link/junction 的来源后再处理
- 如有自定义修改，请先对比差异
- 升级后重启 Codex，再执行一次 DAOGE 唤醒验证
```

## 常用句式

- 本次发布重点提升 DAOGE 在批量生图场景下的稳定性与可维护性。
- 本次更新主要修复项目级安装、续跑命令兼容性和运行文档完整性问题。
- 本次版本不涉及 `.env` 字段变更，已有配置可继续沿用。
- 建议升级后重启 Codex，并通过 `刀哥，我来了` 做一次唤醒验证。
