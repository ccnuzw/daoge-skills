> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE 第三轮体验优化计划

## 本轮目标

第三轮不再继续扩模板数量，也不再继续做展示字段治理，而是转入 **首次上手体验优化**。

当前系统的问题不是“能力不够”，而是：

- catalog 入口已经超过 20 个
- 新用户第一次进入时，仍然需要自己判断该从哪个 example 开始
- README 和 CLI 入口更偏工程视角，不够像产品化引导

本轮的北极星目标是：

**把“第一次使用 DAOGE examples”这条路径压缩成更容易理解、更容易选择的 onboarding 流程。**

## 本轮范围

只做 onboarding 第一批优化，不改主执行链：

1. 给 example catalog 增加“推荐起步”元数据
2. 给 catalog HTML 增加推荐起步区
3. 给 CLI 入口增加“只看推荐起步例子”的能力
4. 同步更新 README 和 examples README
5. 用 smoke 验证推荐入口不会破坏现有 catalog 和 prepare 链路

## 设计原则

### 1. 不打断现有用户

已有：

- `--list true`
- `--example-id ...`
- `render_example_catalog_board.js`

这些入口必须继续保持兼容。

### 2. 新用户先解决“选哪个”

不是先解决“怎么跑命令”，而是先解决：

- 如果我是第一次来
- 我应该先点哪个 example

### 3. 推荐起步只保留少量代表入口

推荐起步区不追求覆盖全部能力，只挑少量高代表性入口：

- UI 视觉稿
- 学术图
- 品牌包装
- 地图路线
- 排版海报

这些入口覆盖：

- 页面型任务
- 信息型任务
- 商业视觉
- 导览类任务
- 文字主导类任务

## 计划落地项

### A. 数据层

在 `references/examples/examples.catalog.json` 中补充 onboarding 元数据，例如：

- `recommended_start`
- `starter_reason`
- `difficulty`

### B. 入口层

在 `scripts/daoge.js prepare` 中新增：

- `--starter true`

用于只列出推荐起步例子。

### C. 展示层

在 `scripts/render_example_catalog_board.js` 中新增：

- 推荐起步区
- 推荐说明文案
- 推荐入口卡片

### D. 文档层

同步更新：

- `skills/interactive-image-batch/README.md`
- `skills/interactive-image-batch/references/examples/README.md`

## 验证要求

本轮完成后必须验证：

1. `scripts/daoge.js prepare --task-spec /abs/path/task_spec.json --output-dir out` 能输出推荐入口
2. HTML catalog 中能看到“推荐起步”区
3. 现有 `--list true` 和 `--example-id` 不回归
4. 全量 smoke 继续全绿

## 完成标准

满足以下条件才算本轮完成：

1. 新用户不需要先读完整 catalog，也能快速决定起步 example
2. CLI 和 HTML 两条入口都能看到推荐起步
3. 不破坏现有 example -> prepare 链路
