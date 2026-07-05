# DAOGE Phase5 变体深化计划

## 目标

在已经完成主链模板扩容之后，开始把第二层模板变体做成真实可运行的 example 入口。

这一步的目标不是再扩新大类，而是让已有主链模板从“只有一个最小入口”升级为“主链下有多条真实子模板路径”。

## 为什么现在做变体深化

当前体系已经有：

- 22 个主链模板
- 11 个 catalog example
- 完整的注册表、检测、预检和 smoke 闭环

但当前仍偏“每类一个总入口”。这对治理足够，对真实复用还不够。

继续扩新大类的收益已经开始下降，而补变体会直接提升：

1. 模板谱系宽度
2. catalog 的可用度
3. quickstart 的示范价值
4. 用户对“这个类到底能做什么”的理解速度

## 第一批变体深化原则

本阶段不追求一次把所有 variant 都变成 example。

先挑满足以下条件的变体：

1. 与主链模板同属高频任务
2. 变体边界清楚
3. 对 catalog 的感知价值高
4. 和现有 example 差异足够明显

## 第一批建议落地的 6 个变体

### 1. academic-figure-board

- `mechanism-diagram`

理由：

- 和 `graphical-abstract` 差异明显
- 能代表“机制图”这一条独立使用路径

### 2. brand-packaging-board

- `cosmetic-packaging`

理由：

- 比 `brand-identity-board` 更强调包装材质和零售外观
- 适合作为包装类更具体的落地入口

### 3. illustrated-scene-set

- `picture-book-scene`

理由：

- 和 `healing-scene` 相比更强调绘本叙事表面
- 适合展示插画模板的系列感能力

### 4. map-route-board

- `store-distribution-map`

理由：

- 和 `travel-route-map` 的路线逻辑完全不同
- 能体现地图类不只是“路线图”

### 5. type-layout-poster

- `title-safe-poster`

理由：

- 和 `bilingual-layout-visual` 的版面目标差异清楚
- 能体现排版类模板的安全区意识

### 6. asset-prop-sheet

- `game-screenshot-mockup`

理由：

- 和 `retro-skeuomorphic-icons` 的展示场景完全不同
- 能体现资产类模板的嵌入式 mockup 路径

## 本阶段建议修改内容

1. 在 `references/examples/*` 下新增 6 个 variant example
2. 在 `examples.catalog.json` 中加入这 6 个变体级入口
3. 在 README / examples README 中把 catalog 改写为“主链 + 变体混合入口”
4. 在 smoke 中增加：
   - catalog list 能看到这些 id
   - catalog html 能看到这些 id
   - 至少 1 个新变体走通 `scripts/daoge.js prepare`

## 命名建议

建议 example id 直接体现主链和变体关系，例如：

- `academic-figure-board-mechanism-diagram`
- `brand-packaging-board-cosmetic-packaging`
- `illustrated-scene-set-picture-book-scene`
- `map-route-board-store-distribution-map`
- `type-layout-poster-title-safe-poster`
- `asset-prop-sheet-game-screenshot-mockup`

## 完成标准

满足以下条件，本阶段才算完成：

1. 新增 6 个变体级 example
2. catalog 数量继续增长
3. smoke 和统一入口全绿
4. 至少 1 个变体 example 能从 catalog 一键跑到预检面板
