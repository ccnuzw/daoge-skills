# DAOGE 版本发布 SOP

适用仓库：

- `ccnuzw/daoge-skills`

适用 skill：

- `interactive-image-batch`

## 1. 发布前检查

发版前至少确认这几项：

1. 代码改动已经在本地完成并验证
2. README 已反映本次功能变化
3. 如涉及安装、路径、`.env`、唤醒方式变化，必须同步写进 README 或 release notes
4. 项目级、全局级路径兼容没有被破坏
5. 如有 zip 分发包，已重新生成

## 2. 本地检查命令

在导出仓目录执行：

```bash
git status --short
git log --oneline -3
```

如有脚本改动，至少做语法检查：

```bash
node --check skills/interactive-image-batch/scripts/run_batch.js
node --check skills/interactive-image-batch/scripts/render_completion_report.js
node --check skills/interactive-image-batch/scripts/render_result_hub.js
```

如有 zip 包分发，建议额外检查：

```bash
unzip -t interactive-image-batch.zip
```

## 3. 版本号规则

推荐遵循：

- Patch：`v1.0.1`
  适用于小修复、文档修正、兼容性补丁
- Minor：`v1.1.0`
  适用于新增功能、工作流增强、非破坏式升级
- Major：`v2.0.0`
  适用于重要重构、不兼容调整、安装方式变化

## 4. README 更新原则

以下变化必须同步 README：

- 安装命令变化
- 项目级 / 全局级路径变化
- `.env` 字段变化
- 唤醒方式变化
- 运行方式变化
- 大批量工作流变化

## 5. 标准发布流程

### 步骤 A：提交变更

```bash
git add .
git commit -m "你的版本说明"
git push origin main
```

### 步骤 B：准备 release notes

优先使用：

- `docs/release_notes_template_zh.md`

按版本类型选择对应模板，补全：

- 本次更新
- 影响范围
- 安装方式
- 升级建议

### 步骤 C：创建 tag / release

示例：

```bash
gh release create v1.0.1 interactive-image-batch.zip#interactive-image-batch.zip \
  --repo ccnuzw/daoge-skills \
  --title "DAOGE Skills v1.0.1" \
  --notes "这里填写整理后的 release notes"
```

如果本次不附带 zip，可以去掉资产部分。

## 6. 标准发布清单

每次发版至少应包含这些信息：

- 版本号
- 发布时间
- 影响 skill
- 主要修复或增强点
- 安装命令
- 是否需要重启 Codex
- 是否需要调整 `.env`
- 是否存在不兼容变化

## 7. 推荐发布文案结构

推荐顺序：

1. 版本定位
2. 本次更新
3. 影响范围
4. 安装方式
5. 升级建议

## 8. 发版后检查

发版后至少确认：

1. `main` 分支已 push
2. GitHub release 页面可打开
3. tag 已存在
4. zip 资产可下载
5. README 在线可读
6. 安装命令没有写错仓库名或 skill 名

可用命令：

```bash
gh release view v1.0.1 --repo ccnuzw/daoge-skills
git fetch origin --tags
git tag -l
```

## 9. 建议的发版节奏

- 文档修正 / 小修复：Patch
- 一轮能力增强打包后：Minor
- 工作流结构变化或兼容性变化：Major

## 10. 本仓推荐做法

当前仓库建议保持：

- README 负责用户安装和使用入口
- `docs/release_notes_template_zh.md` 负责 release notes 模板
- `docs/release_sop_zh.md` 负责维护者发版流程
- `interactive-image-batch.zip` 可作为 release 附件

## 11. 最小发版示例

适用于小修复：

```text
版本：v1.0.1
标题：DAOGE Skills v1.0.1
内容：
- 修复项目级安装兼容性
- 优化补跑命令的路径回退逻辑
- 完善 README 安装说明
```
