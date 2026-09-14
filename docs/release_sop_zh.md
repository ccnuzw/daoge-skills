# DAOGE Pic vNext 发布 SOP

适用仓库：

- `ccnuzw/daoge-skills`

适用 Skill：

- `daoge-pic`

本 SOP 针对当前 vNext 发布模型：运行时版本、Skill protocol 版本和发布制品版本相互独立。当前工作树的运行时为 `5.14.0`，协议为 `daoge-pic-skill-protocol/2.0.0`，兼容范围为 `>=5.14.0 <6.0.0`。发布渠道是 GitHub Release 的不可变 `.tgz`，不是 npm registry；不要把工作树、`main` 或旧 daemon 当作正式发布物。

## 1. 发布前门禁

在仓库根目录执行：

```bash
git status --short --untracked-files=all
git diff --check
git log --oneline -3
```

逐项确认：

1. 所有本次需要发布的源码、迁移、构建脚本和回归测试都已纳入提交；未跟踪文件必须逐一审阅，不能把本地运行时目录、数据库、日志、Provider 配置或凭据加入提交。
2. `daoge-studio/runtime/`、`Provider.db`、`provider.env`、`*.sqlite-*`、`*.db-*` 和任何真实 API key 均不在提交、制品、日志或 release notes 中。
3. 版本元数据一致：`skills/daoge-pic/package.json`、`package-lock.json`、`protocol-version.json` 和编译产物的 runtime 常量均指向当前版本；协议仍单独保持 `2.0.0`。
4. README、`SKILL.md`、升级说明和验证证据使用 vNext 端点、CLI 与工作区目录，不再引用旧 `prepare` / `execute` / `ingest`、静态 `workspace/*.html` 或旧 daemon。
5. 生成证据在最终冻结前重新产生并检查；历史版本的测试计数、哈希和安装 URL 只能保留为历史事实。

## 2. 本地构建与回归

在仓库根目录执行：

```bash
npm --prefix skills/daoge-pic run typecheck:vnext
npm --prefix skills/daoge-pic run build
npm --prefix skills/daoge-pic test
npm --prefix skills/daoge-pic run verify:evidence:check
```

`npm test` 使用 `tests/vnext/test.env` 固定测试 secret backend 并清理宿主机代理变量；该文件是测试夹具，不是 Provider 运行时配置。若测试夹具或本次测试集合有变化，应先确认它们已提交，再运行完整回归。

如需重新生成工作树证据（会更新 `skills/daoge-pic/docs/vnext_verification_evidence_zh.md` 的标记区块），执行：

```bash
npm --prefix skills/daoge-pic run verify:evidence
```

在最终制品已生成后，连同 package smoke 一起生成证据：

```bash
npm --prefix skills/daoge-pic run verify:evidence -- --with-package
```

脚本、CLI 和证据生成器的语法检查：

```bash
node --check skills/daoge-pic/scripts/daoge.js
node --check skills/daoge-pic/scripts/build-lock.js
node --check skills/daoge-pic/scripts/build-vnext.js
node --check skills/daoge-pic/scripts/run-tests.js
node --check skills/daoge-pic/scripts/package-smoke.js
node --check skills/daoge-pic/scripts/verification-evidence.js
```

vNext 的契约测试包含在 `npm test` 的 `tests/vnext/*.test.js` 集合中；语法检查只针对当前 `scripts/` 下仍在使用的 JavaScript 入口。

## 3. 制品清单与 package smoke

`package.json` 的 `files` allowlist 是有意的运行时边界：正式包包含编译后的 `dist/`、`scripts/daoge.js` 启动器、运行时所需文档、协议清单、示例配置和许可证；源码、`tests/`、TypeScript/Vite 配置、构建/回归/证据脚本以及仓库根目录的发布说明不属于安装运行时。`directories.test` 仅是仓库元数据，不表示测试文件随包发布。

先预览清单，不要把预览结果当作最终制品：

```bash
(cd skills/daoge-pic && npm pack --dry-run --ignore-scripts --json)
```

预览必须满足：无 source/tests、无 source map、无旧 daemon、无 SQLite/日志/runtime/Provider 文件；必需的 `dist/vnext` CLI、Workbench、协议和文档入口均存在。正式 package smoke 还会安装临时 consumer，验证 bin、`register-skill`、`doctor` 和 `sharp`。

## 4. 生成不可变 .tgz 与校验文件

生成目标版本的不可变制品前，不要伪造文件大小、SHA-256、tag 或 Release URL。完成第 2 节门禁并确认工作树中不存在同名旧制品后，在仓库根目录执行：

```bash
(cd skills/daoge-pic && npm pack --pack-destination .)
(cd skills/daoge-pic && shasum -a 256 daoge-pic-5.14.0.tgz > daoge-pic-5.14.0.tgz.sha256)
npm --prefix skills/daoge-pic run test:package
npm --prefix skills/daoge-pic run verify:evidence -- --with-package
(cd skills/daoge-pic && shasum -a 256 -c daoge-pic-5.14.0.tgz.sha256)
```

`test:package` 使用 `--require-release-artifact`，因此必须在最终 tarball 真实生成后执行；它不会覆盖稳定制品。发布后包外记录 `.tgz` 与 `.sha256` sidecar，哈希不要写回包内文档，避免自引用。

本包不发布到 npm registry。不要执行 `npm publish` 作为本项目的正式发布步骤，也不要把 ZIP 当作 daoge-pic vNext 制品。

## 5. 创建 GitHub Release

发布说明必须先确认状态、安装命令、升级建议、重启要求、`.env` 迁移边界和不兼容变化均已写清。确认 tag 尚未存在后：

```bash
git tag -a daoge-pic-v5.14.0 -m "daoge-pic 5.14.0"
git push origin daoge-pic-v5.14.0
gh release create daoge-pic-v5.14.0 \
  skills/daoge-pic/daoge-pic-5.14.0.tgz#daoge-pic-5.14.0.tgz \
  skills/daoge-pic/daoge-pic-5.14.0.tgz.sha256#daoge-pic-5.14.0.tgz.sha256 \
  --repo ccnuzw/daoge-skills \
  --title "daoge-pic v5.14.0" \
  --notes-file docs/daoge_pic_5.14.0_release_notes_zh.md
```

## 6. 发布后验证

```bash
gh release view daoge-pic-v5.14.0 --repo ccnuzw/daoge-skills
git fetch origin --tags
git tag -l 'daoge-pic-v*'
```

确认 Release 同时包含 `.tgz` 和 `.tgz.sha256`，下载后的文件使用 sidecar 校验；安装命令必须指向该固定 Release 资产，而不是 `main` 或 npm registry。安装 consumer 后执行：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.14.0/daoge-pic-5.14.0.tgz"
npx daoge register-skill --scope project --workspace /absolute/workspace
npx daoge doctor --workspace /absolute/workspace
```

`doctor` 不读取 Provider 密钥、不连接 Provider、不产生计费请求。安装和注册后必须完整重启 Codex，使 Skill registry 重新加载。

## 7. 升级与兼容性边界

- 5.14.0 与 5.13.0 及更早版本的 daemon 不兼容；同一工作区不得混用旧 daemon、旧 CLI 和本版本运行时。协议名/版本仍是 `daoge-pic-skill-protocol/2.0.0`，不要把它写成制品版本。
- 这是 vNext 工作流：不使用旧 `prepare`、`execute`、`ingest`、`task_spec.json`、`results.html` 或静态工作区作为入口。运行必须经过会话计划、人工确认、preflight 和 daemon confirm token。
- 升级已有 Studio 前先执行 `backup-manifest` 与 `backup-upgrade-assess`，再按备份/恢复文档执行相应 dry-run 或受控恢复；不要在 daemon 运行时直接替换 SQLite。
- `provider.env` 只作为既有工作区的一次性迁移输入；新工作区不创建该文件。Provider Profile、密钥引用和 write-only 摘要的事实源是 `daoge-studio/Provider.db` 或显式系统凭据后端。不要把 API key 写入命令参数、日志、提交或 release notes。
- 安装、注册或升级完成后必须重启 Codex；Workbench/daemon 的安全状态按当前 Skill 协议处理，不以浏览器缓存或目录状态推断业务事实。
