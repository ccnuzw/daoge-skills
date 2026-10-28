# spec-docs-pro

规格驱动开发的设计顾问 skill。写功能规格时主动发现原子性、并发、幂等、外部调用、资金与权限方面的设计漏洞，并按统一标准维护 `docs/` 文档体系。附带两个零依赖的 Node.js 脚本：文档一致性检查和离线文档浏览器生成。

当前版本：2.0.0（见 [CHANGELOG.md](CHANGELOG.md)）

## 能做什么

| 场景 | 示例提示词 |
| --- | --- |
| 初始化文档体系 | 用 spec-docs-pro 为 CloudSync 初始化文档体系，领域：文件管理、权限、同步 |
| 写功能规格 | 用 spec-docs-pro 写 V1 用户注册的功能规格，包含邮箱密码注册，不含 OAuth |
| 补齐已有代码的规格 | 用 spec-docs-pro 给 src/users/register.ts 补规格 |
| 冻结决策 / ADR | 删除到底是软删除还是物理删除？用 spec-docs-pro 记成冻结决策，选软删除 |
| 状态回写 | V1-FR-001 后端测试 8/8 通过，用 spec-docs-pro 更新实现状态 |
| 版本规划 | 用 spec-docs-pro 规划 V1～V3 并生成功能演进矩阵 |
| 门禁检查 | 用 spec-docs-pro 检查 V1 能否进入开发 |
| 文档浏览器 | 用 spec-docs-pro 生成文档浏览器 |

## 直接使用脚本

```bash
# 检查文档一致性（只读；有错误时退出码 1，可用于 CI）
node <skill>/scripts/check-docs.mjs --docs docs

# 生成离线文档浏览器 → docs/90-参考资料/产品文档浏览器.html
node <skill>/scripts/generate-browser.mjs --docs docs

# skill 自测
node <skill>/tests/run-tests.mjs
node <skill>/tests/run-tests.mjs --browser /path/to/node_modules/playwright   # 含浏览器渲染测试
```

需要 Node.js 18 或更高版本，无第三方依赖。

项目名、浏览器输出目录、功能与能力主线的映射等可以在 `docs/spec-docs.config.json` 中配置，模板见 [assets/templates/spec-docs.config.json](assets/templates/spec-docs.config.json)。

## 目录结构

```
spec-docs-pro/
├── SKILL.md                 agent 入口：任务路由、硬规则、脚本说明
├── references/              按需读取的说明
│   ├── modes/               8 个工作模式的步骤
│   ├── design-review.md     提问方法与高风险识别
│   ├── status-and-ids.md    状态词表与编号规则（唯一定义）
│   ├── doc-structure.md     目录结构与规模裁剪
│   └── check-rules.md       check-docs 规则说明
├── assets/
│   ├── templates/           文档模板
│   └── browser/             浏览器查看器（HTML / CSS / JS，不含项目数据）
├── scripts/                 check-docs.mjs、generate-browser.mjs、lib/
├── examples/                完整功能主文档示例、质量要素好坏对比
├── tests/                   脚本自测与测试夹具
└── evals/                   skill 行为评测用例
```

## 安装

```bash
# 固定版本
npx skills add https://github.com/ccnuzw/daoge-skills/tree/spec-docs-pro-v2.0.0/skills/spec-docs-pro -a codex

# 跟随 main 分支
npx skills add ccnuzw/daoge-skills -a codex -s spec-docs-pro
```

`-a` 指定宿主，按实际使用的 Agent 替换。安装后重启宿主，使其重新加载 Skill。

## 从 1.x 升级

2.0.0 有两处不兼容变化，已有项目升级后按下面处理：

1. **重新生成文档浏览器。** 数据格式改为 `window.SPEC_DOCS_DATA`，旧的数据文件不能被新查看器读取：

   ```bash
   node <skill>/scripts/generate-browser.mjs --docs docs
   ```

2. **实现状态只放在实现状态表。** 功能主文档 frontmatter 的 `status` 改为 `spec_status`（Draft / Ready / Deprecated），功能卡去掉“状态”行，实现状态写到 `V{n}-实现状态.md` 的“状态”列。运行 `check-docs.mjs` 会用 ST002、ST004、ST005 列出需要调整的位置，旧写法与标准写法的对照见 [references/status-and-ids.md](references/status-and-ids.md) 第 8 节。

这两项不改也能继续使用：浏览器会尽量从旧格式中推断状态，检查脚本只报警告。

## 许可

MIT
