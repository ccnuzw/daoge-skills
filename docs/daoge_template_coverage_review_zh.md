# DAOGE 模板覆盖度盘点

日期：2026-05-18

## 盘点目标

对 `interactive-image-batch` 当前模板体系做一次覆盖度盘点，明确：

- 哪些主链模板已经接近满覆盖
- 哪些模板仍处于部分覆盖
- 下一轮扩容最值的方向是什么

本次盘点依据：

- `references/template_registry_zh.json`
- `references/examples/examples.catalog.json`

覆盖度口径：

- `variantCount`：模板注册表里定义的正式变体数
- `coveredCount`：当前已经接入 catalog 的变体数

## 总体判断

当前体系已经不再是“只有主链模板和少量 demo”。

它已经进入三个非常清楚的层级：

1. 主链模板完整
2. 高价值商业变体大量接入
3. 部分家族已经达到满覆盖或接近满覆盖

其中最值得注意的是：

- `infographic-board`：**6/6**
- `technical-diagram`：**7/7**
- `visual-doc-slide`：**4/4**
- `detail-page-set`：**4/4**
- `social-grid`：**4/4**
- `brand-packaging-board`：**5/5**

这说明“说明型 / 商业结构型 / 多图系统型”这几条线已经基本补齐。

## 已满覆盖家族

这些模板当前已经把注册表中的正式变体全部接入到 catalog。

### 说明型 / 信息结构

- `infographic-board`：6/6
- `technical-diagram`：7/7
- `visual-doc-slide`：4/4

### 商业结构型

- `detail-page-set`：4/4
- `social-grid`：4/4
- `brand-packaging-board`：5/5

### 其他已满覆盖

- `oral-storyboard-board`：3/3
- `type-layout-poster`：2/2
- `asset-prop-sheet`：2/2

## 高覆盖但未满的家族

这些模板已经进入“可用且有代表性”，但仍存在少量尾项缺口。

### 商业视觉

- `campaign-poster`：3/4  
  已覆盖：
  - `co-brand-kv`
  - `product-hero`
  - `people-hero`
  缺：
  - `campaign-extension`

### 叙事分镜

- `cinematic-storyboard`：3/4  
  缺：
  - `mood-sequence`

- `illustrated-scene-set`：3/4  
  缺：
  - `minimalist-mood-scene`

### 地图 / 学术 / 资产身份

- `academic-figure-board`：3/5  
  缺：
  - `method-pipeline-overview`
  - `research-overview-poster`

- `map-route-board`：3/5  
  缺：
  - `itinerary-day-trip-map`
  - `food-map`

- `avatar-profile-pack`：3/5  
  缺：
  - `character-grid-portrait`
  - `cultural-portrait-series`

## 覆盖明显偏薄的家族

### `ui-mockup-board`

覆盖度：**1/6**

已覆盖：

- `landing-page-case-study`

缺失：

- `social-interface-mockup`
- `live-commerce-ui`
- `product-card-overlay`
- `short-video-cover-ui`
- `chat-interface-scene`

这是当前最明显的结构性缺口。

原因不是这个家族不重要，而是它目前还是“有主链，有 starter，但变体层没铺开”。

如果下一轮继续扩，`ui-mockup-board` 应该是第一优先级。

### `ab-ad-test`

覆盖度：**2/4**

已覆盖：

- `single-variable`
- `benefit-stack`

缺失：

- `audience-angle`
- `layout-test`

这条线已经可用，但还没有把“人群角度”和“版式测试”补齐。

## 单变体模板

这些模板注册表里没有多变体结构，或当前就只有一个主入口，因此不适合再用“覆盖率不足”来定义：

- `studio-editorial`
- `ecommerce-clean`
- `lookbook`
- `portrait-kv`
- `image-edit`

对它们来说，下一步如果继续做，应该是：

- 补 example 深度
- 补场景派生样例
- 补 onboarding 入口

而不是强造新变体。

## 当前最合理的下一轮优先级

### 第一优先级

- `ui-mockup-board`

原因：

- 覆盖度最低：1/6
- 用户场景高频
- 和当前已经很强的说明型主线形成互补

建议优先补：

1. `social-interface-mockup`
2. `live-commerce-ui`
3. `chat-interface-scene`

### 第二优先级

- `ab-ad-test`
- `campaign-poster`

建议补：

- `ab-ad-test.audience-angle`
- `ab-ad-test.layout-test`
- `campaign-poster.campaign-extension`

### 第三优先级

- `avatar-profile-pack`
- `academic-figure-board`
- `map-route-board`

这些都已经不是“明显缺”，而是“可以继续做深”。

## 最终判断

如果从全局来看，当前模板体系已经进入：

- **主链稳定**
- **高频说明型满覆盖**
- **商业结构型高覆盖**
- **个别家族存在结构性薄点**

因此下一轮不建议再平均撒点。

最值的策略是：

1. 先集中补 `ui-mockup-board`
2. 再补 `ab-ad-test` 与 `campaign-poster` 的剩余尾项
3. 最后再看是否要回到身份资产、学术图和地图家族继续做深
