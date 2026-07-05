# DAOGE 中文任务地图

这份文档的目标不是讲实现细节，而是回答：

- 我脑子里的任务，应该映射到哪个入口
- 哪个是起步入口
- 哪个是细分版本
- 我什么时候该停在起步入口，什么时候再往下选细分版本

如果你是普通使用者，这份文档比任务地图源文件更适合看。

---

## 一、先理解 4 种名字

这套系统里常见 4 类名字：

### 1. 任务大类

这是你脑子里的中文任务：

- 人物主视觉
- 摄影棚大片
- 电商主图
- 详情页组图
- 社媒九宫格
- 品牌包装
- 电影分镜
- 口播分镜整板

这是**普通用户最应该先思考的一层**。

### 2. 起步入口

这是最适合直接起步的入口，比如：

- `--intent portrait`
- `--intent studio`
- `--intent ecommerce`
- `--intent packaging`
- `--intent cinematic`
- `--intent oralboard`

这是**第一次使用最推荐的层**。

### 3. 任务类型名

这是系统内部的任务类型名，比如：

- `portrait-kv`
- `studio-editorial`
- `ecommerce-clean`
- `brand-packaging-board`

它适合：

- 你已经明确自己属于哪条任务主线
- 你准备继续细分

### 4. 细分版本

这是任务类型下的细分版本，比如：

- `portrait-kv-headline-safe-portrait-kv`
- `studio-editorial-beauty-detail-studio`
- `ecommerce-clean-flatlay-commerce`

它适合：

- 你已经知道自己不是“泛任务”
- 而是某一种更具体的业务场景

---

## 二、最推荐的新手入口

如果你完全不知道怎么选，先用：

```bash
node scripts/daoge.js prepare --task-spec /abs/path/task_spec.json --output-dir out
```

默认第一屏只保留 6 个最常用起步入口：

| 中文任务 | 起步入口 | 任务类型名 |
|---|---|---|
| 肖像主视觉 | `portrait` | `portrait-kv` |
| 棚拍大片 | `studio` | `studio-editorial` |
| 电商主图 | `ecommerce` | `ecommerce-clean` |
| 品牌包装板 | `packaging` | `brand-packaging-board` |
| 电影分镜组 | `cinematic` | `cinematic-storyboard` |
| 口播分镜整板 | `oralboard` | `oral-storyboard-board` |

如果这 6 个都不符合，再继续看完整推荐起步任务：

| 中文任务 | 起步入口 | 任务类型名 |
|---|---|---|
| UI 界面视觉稿 | `ui` | `ui-mockup-board` |
| 学术图板 | `academic` | `academic-figure-board` |
| 品牌包装板 | `packaging` | `brand-packaging-board` |
| 地图路线板 | `map` | `map-route-board` |
| 排版海报 | `typography` | `type-layout-poster` |
| 电商主图 | `ecommerce` | `ecommerce-clean` |
| 详情页组图 | `detail` | `detail-page-set` |
| 社媒九宫格 | `social` | `social-grid` |
| 广告 A/B 测试组 | `abtest` | `ab-ad-test` |
| 品牌海报 | `poster` | `campaign-poster` |
| 系列 Lookbook | `lookbook` | `lookbook` |
| 肖像主视觉 | `portrait` | `portrait-kv` |
| 棚拍大片 | `studio` | `studio-editorial` |
| 电影分镜组 | `cinematic` | `cinematic-storyboard` |
| 口播分镜整板 | `oralboard` | `oral-storyboard-board` |
| 财经口播分镜整板 | `financeboard` | `oral-storyboard-board` |
| 主持人口播板 | `hostboard` | `oral-storyboard-board` |
| 产品解说板 | `productboard` | `oral-storyboard-board` |
| 教育科普板 | `eduboard` | `oral-storyboard-board` |
| 专家解说板 | `expertboard` | `oral-storyboard-board` |
| 案例见证板 | `testimonialboard` | `oral-storyboard-board` |

---

## 三、按中文任务找任务类型名

### 人物与时尚视觉

| 中文任务 | 任务类型名 | 什么时候用 |
|---|---|---|
| 肖像主视觉 | `portrait-kv` | 近景人物海报、品牌人物封面、人物气质主导的 KV |
| 棚拍大片 | `studio-editorial` | 摄影棚人物大片、时尚棚拍、美妆棚拍、高定棚拍 |
| 系列 Lookbook | `lookbook` | 多张时尚组图、系列服装展示、整身与细节混排 |

### 电商与商业视觉

| 中文任务 | 任务类型名 | 什么时候用 |
|---|---|---|
| 电商主图 | `ecommerce-clean` | 白底主图、纯净商品图、平台安全主图 |
| 详情页组图 | `detail-page-set` | 卖点页、对比页、功能堆栈页、场景证明页 |
| 社媒九宫格 | `social-grid` | 上新 feed、九宫格系统、品牌社媒图 |
| 广告 A/B 测试组 | `ab-ad-test` | 测卖点、测 CTA、测首屏钩子、测人群、测版式 |
| 品牌海报 | `campaign-poster` | 单张主视觉、产品英雄海报、活动延展海报 |
| 品牌包装板 | `brand-packaging-board` | 礼盒、限定包装、包装系统、标签设计 |

### 信息与说明型视觉

| 中文任务 | 任务类型名 | 什么时候用 |
|---|---|---|
| 信息图 | `infographic-board` | 对比信息图、步骤信息图、手绘信息图、 Bento 信息图 |
| 技术图解 | `technical-diagram` | 流程图、时序图、ER 图、拓扑图、状态机 |
| 学术图板 | `academic-figure-board` | 论文图、机制图、方法流程总览、研究海报 |
| 视觉文档页 | `visual-doc-slide` | 汇报页、解释页、前后对照页、数据摘要页 |
| 排版海报 | `type-layout-poster` | 双语排版、标题海报、图文平衡排版 |
| 地图路线板 | `map-route-board` | 路线图、城市导览图、门店分布图、美食地图 |

### 资产与编辑

| 中文任务 | 任务类型名 | 什么时候用 |
|---|---|---|
| 头像资产包 | `avatar-profile-pack` | 头像、贴纸、角色头像、3D icon、自拍风格迁移 |
| 图像编辑 | `image-edit` | 局部修复、材质替换、光线统一、风格对齐 |
| 资产道具板 | `asset-prop-sheet` | 道具板、图标板、收藏品板、道具阵列 |

### 分镜与叙事

| 中文任务 | 任务类型名 | 什么时候用 |
|---|---|---|
| 电影分镜组 | `cinematic-storyboard` | 广告分镜、产品演示分镜、微电影分镜、 reveal 分镜 |
| 口播分镜整板 | `oral-storyboard-board` | 主持人口播、专家讲解、案例见证、产品解说整板 |
| 插画场景组 | `illustrated-scene-set` | 绘本感场景、概念场景、情绪场景 |

---

## 四、什么时候该继续选细分版本

只有当你已经明确：

- 不是泛任务
- 而是很具体的业务分型

再往下选细分版本。

### 例 1：人物主视觉

如果你只知道自己要“人物主视觉”，先用：

- `--intent portrait`

如果你已经明确是：

- 要给后期压标题
  - 选 `portrait-kv-headline-safe-portrait-kv`
- 要做侧脸轮廓气质图
  - 选 `portrait-kv-profile-silhouette-kv`
- 要做人物和产品联动海报
  - 选 `portrait-kv-product-linked-portrait-kv`

### 例 2：棚拍大片

如果你只知道自己要“棚拍人物图”，先用：

- `--intent studio`

如果你已经明确是：

- 强调肩线与剪裁
  - 选 `studio-editorial-sharp-tailoring-studio`
- 强调近景皮肤和妆发
  - 选 `studio-editorial-beauty-detail-studio`
- 强调动作连续性
  - 选 `studio-editorial-gesture-sequence-studio`

### 例 3：口播分镜整板

如果你只知道自己要“口播整板”，先用：

- `--intent oralboard`

如果你已经明确是：

- 专家解说
  - 选 `--intent expertboard`
- 案例见证
  - 选 `--intent testimonialboard`
- 产品解说
  - 选 `--intent productboard`

---

## 五、最推荐的使用顺序

### 新手顺序

1. 先看 [../../README.md](../README.md)
2. 再看这份中文任务地图
3. 然后运行：

```bash
node scripts/daoge.js prepare --task-spec /abs/path/task_spec.json --starter true
```

4. 或直接按任务意图运行：

```bash
node scripts/daoge.js prepare --task-spec /abs/path/task_spec.json --intent portrait --output-dir out
```

5. 看工作台主链：
   - `workspace/index.html`
   - `workspace/prepare.html`
   - `workspace/results.html`
   - `workspace/issues.html`（有失败、待复核或补跑候选时再看）

### 进阶顺序

1. 先确定任务类型名
2. 再判断是否真的需要某个细分版本
3. 再运行具体示例入口

---

## 六、这份文档不负责什么

这份文档不负责：

- 解释所有内部 JSON 字段
- 解释治理文档
- 解释 smoke 测试
- 解释模板注册表的工程实现

这些属于维护层，不属于一线使用层。

如果你是维护者，再继续看：

- `README.md`
- `references/examples/README.md`
- `references/template_authoring_zh.md`
- `references/template_registry_zh.json`
