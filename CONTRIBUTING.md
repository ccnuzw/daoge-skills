# 贡献指南

感谢你为 DAOGE Skills 提交改进。请把一次变更限制在一个可解释主题内，并保持中文面向用户的文档风格。

## 提交前检查

涉及 `daoge-docs` 时必须运行：

```sh
python3 skills/daoge-docs/scripts/daoge_docs.py doctor --root . --json
python3 -m unittest discover -s skills/daoge-docs/scripts -p 'test_*.py' -v
python3 .github/scripts/validate_daoge_docs_skill.py
```

修改生成器、检查器、数据契约或工作台时，必须同步更新回归测试和相应 `references/`。不要直接修改生成后的项目浏览器、派生索引或机器证据。

## 提交内容

- 描述问题、影响范围与验证命令。
- 说明兼容性变化、升级影响和是否导致 Goal 过期。
- 不提交密钥、Token、个人路径、真实用户数据或不可复现的临时制品。
- 新增技术栈适配器时遵守 `skills/daoge-docs/references/stack-adapters.md`。

## 版本策略

`daoge-docs` 使用独立标签 `daoge-docs-vX.Y.Z`。破坏性数据契约或 Goal 清单变化必须提升主版本，并提供迁移说明；新增兼容能力提升次版本；修复提升补丁版本。
