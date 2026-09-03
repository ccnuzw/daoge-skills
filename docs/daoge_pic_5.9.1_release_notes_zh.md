# DAOGE Pic v5.9.1

本版本修复参考素材跨项目越界问题：参考图和遮罩只能来自当前项目资产，或来自当前 Studio 明确共享的素材。

## 安全修复

- 新增统一项目素材访问判定，覆盖当前项目、项目任务、项目轮次和项目生成结果。
- 参考图和遮罩支持显式 `shared_across_projects` 共享关系，但不会因此混入项目资产集合。
- 计划创建、计划准备、计划确认、预检、dry-run、运行排队和 Worker 读取前均重复校验素材边界。
- 同一 Studio 下其他项目的未共享素材不再可被引用。
- 共享关系撤销后，预检和 Worker 会阻止继续处理，且不会调用外部图片 Provider。
- 历史越界计划保留原版本，不自动猜测替换用户素材；需要重新提交合法计划或显式共享素材。

## 文档与验证

- 同步更新 Skill 规范、使用 README、vNext 规格、学习中心和验证证据。
- 新增跨项目未共享素材、共享撤销、历史越界计划和 Worker 无 Provider 调用回归测试。
- 需要 Node.js 22 LTS 或更高版本。

## 安装

项目级安装：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.9.1/daoge-pic-5.9.1.tgz"
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.9.1/daoge-pic-5.9.1.tgz"
```

安装并注册 Skill 后，需要完整重启 Codex，使其重新加载 Skill registry。
