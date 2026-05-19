# DAOGE 下一批模板扩充计划

## 本轮目标

这一批不新增全新大类，而是优先把 **已经在主链里的高频模板** 接入完整的示例层和 onboarding 层。

本轮北极星目标：

**让更多主链模板不仅“存在于注册表”，而且能被 example catalog、intent 入口和 quickstart 真实消费。**

## 本轮纳入范围

优先纳入以下 5 个高频模板：

1. `ecommerce-clean`
2. `detail-page-set`
3. `social-grid`
4. `ab-ad-test`
5. `image-edit`

## 选择原因

### `ecommerce-clean`

- 电商主图是高频刚需
- 容易成为新用户第一条商业任务
- 与 `detail-page-set` 形成主图 / 详情页配套

### `detail-page-set`

- 电商详情页组图是现有体系里明显缺少 onboarding 入口的一类
- 能体现 DAOGE 的“多张图各司其职”能力

### `social-grid`

- 社媒矩阵是高频商业任务
- 适合展示“多张图统一系统”的能力

### `ab-ad-test`

- 能体现 DAOGE 的结构化测试思维
- 对商业投放用户有明显价值

### `image-edit`

- 能把“已有图像上的工作”接入 onboarding
- 不是纯文生图，能补齐另一条高频入口

## 本轮交付物

每个模板都必须同步补齐：

1. 模板文档
   - 若已有，则只核对是否够支撑 example
2. 最小 example
3. catalog 入口
4. 如合适，挂 onboarding 推荐或 intent
5. smoke 覆盖

## 设计原则

### 1. 每个模板至少先给一个主链 example

不要一上来做太多变体，先保证“主链可跑”。

### 2. onboarding 只挂最适合新手的入口

不是每个模板都要立刻进推荐起步或 intent。

### 3. image-edit 允许保持更谨慎的 onboarding

因为它依赖已有图像，可能不适合和纯 quickstart 一样激进地推到推荐起步。

## 初步接入判断

### 适合直接进入 onboarding 的

- `ecommerce-clean`
- `detail-page-set`
- `social-grid`
- `ab-ad-test`

### 先接 catalog，不急着进推荐起步的

- `image-edit`

## 验证要求

1. 新 example 能通过 `build_example_quickstart`
2. 新 example 能通过 `run_example_quickstart_prepare`
3. catalog 能列出新增入口
4. 如接入 intent，`--intent` 能命中新入口
5. 全量 smoke 继续通过
