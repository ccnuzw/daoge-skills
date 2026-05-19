# DAOGE 使用入口

这份文档只解决 4 个问题：

1. 我第一次使用，应该从哪里开始
2. 我的任务属于哪一类
3. 我应该运行哪条命令
4. 跑完以后应该看哪个结果

如果你是第一次用这套 skill，**先看这份，不要先看大 README，也不要先看 100 多个 example。**

如果你已经知道自己属于哪类任务，但不知道系统里的名字怎么对应，再看：

- [references/template_map_zh.md](./references/template_map_zh.md)

---

## 一、先记住一句话

这套系统的标准路径只有这一条：

**选任务类型 -> 选一个入口 -> 生成预检面板 -> 确认后再执行**

你不需要一开始就理解：

- `template_registry`
- `variant_axes`
- `prompt_slots`
- `prompt_draft_bundle`
- `family`
- `tier`

这些是维护层概念，不是第一次使用必须理解的东西。

---

## 二、第一次使用，推荐你只用这 3 种入口

### 入口 1：看最常用的 6 个起步任务

```bash
node scripts/run_example_catalog_prepare.js --starter true
```

适合：

- 你不知道该选哪个模板
- 你希望第一屏只看到最常用、最不容易选错的入口

当前默认只列这 6 个：

- `portrait`：人物主视觉
- `studio`：摄影棚大片
- `ecommerce`：电商主图
- `packaging`：品牌包装
- `cinematic`：电影分镜
- `oralboard`：口播分镜整板

如果你要看完整入口，不要在这里翻更多命令，直接去：

- [references/template_map_zh.md](./references/template_map_zh.md)
- `references/examples/examples_catalog.html`

---

### 入口 2：按中文任务意图进入

第一次使用，最推荐你只记这 6 个：

```bash
node scripts/run_example_catalog_prepare.js --intent portrait
node scripts/run_example_catalog_prepare.js --intent studio
node scripts/run_example_catalog_prepare.js --intent ecommerce
node scripts/run_example_catalog_prepare.js --intent packaging
node scripts/run_example_catalog_prepare.js --intent cinematic
node scripts/run_example_catalog_prepare.js --intent oralboard
```

它们大致对应：

- `ecommerce`：电商主图
- `portrait`：人物主视觉海报
- `studio`：摄影棚人物大片
- `packaging`：品牌包装 / 包装系统
- `cinematic`：连续分镜
- `oralboard`：口播分镜整板

其它入口例如：

- `ui`
- `academic`
- `detail`
- `social`
- `abtest`
- `lookbook`
- `financeboard`
- `expertboard`

不要放在第一次记忆里，后面按任务地图再选。

---

### 入口 3：按具体 example 直接跑

如果你已经知道要跑哪个入口，可以直接：

```bash
node scripts/run_example_catalog_prepare.js \
  --example-id ui-mockup-board \
  --output-dir /tmp/daoge-example-demo
```

适合：

- 你已经熟悉这套系统
- 你已经知道具体 example id

---

## 三、怎么判断自己属于哪类任务

先按中文任务想，不要先按模板名想。

### 人物与品牌视觉

如果你要的是：

- 人物海报
- 品牌人物封面
- 近景肖像主视觉

优先用：

- `--intent portrait`

如果你要的是：

- 摄影棚时尚大片
- 时尚棚拍
- 美妆棚拍
- 高定人物棚拍

优先用：

- `--intent studio`

---

### 电商与商业出图

如果你要的是：

- 电商主图
- 干净白底主图
- 平铺产品图

优先用：

- `--intent ecommerce`

如果你要的是：

- 详情页组图
- 卖点页
- 对比说明页

优先从 `README` 里的 `detail-page-set` 相关入口继续往下选。

如果你要的是：

- 社媒九宫格
- 上新 feed
- 品牌社媒组图

优先从 `README` 里的 `social-grid` 相关入口继续往下选。

---

### 包装、信息图、说明图

如果你要的是：

- 礼盒包装
- 限定包装
- 品牌包装系统

优先用：

- `--intent packaging`

如果你要的是：

- 信息图
- 技术图
- 学术图
- 汇报页 / 幻灯页

先去主 `README.md` 的“常用任务入口”里找对应大类，不要直接浏览全部 catalog。

---

### 分镜与口播板

如果你要的是：

- 连续镜头分镜
- 广告分镜
- 产品演示分镜

优先用：

- `--intent cinematic`

如果你要的是：

- 口播分镜整板
- 主持人口播板
- 专家讲解板
- 案例见证板

优先用：

- `--intent oralboard`

---

## 四、你真正需要看的结果文件

第一次使用时，只看这两个：

- `prepare/preflight_board.html`
- `prepare/prompt_preview.html`

解释：

- `preflight_board.html`
  - 看这次任务能不能开跑
  - 看有没有红灯 / 黄灯 / 绿灯
- `prompt_preview.html`
  - 看这次生成的 prompt 是否符合你的预期

如果你只做预检，不执行，到这里就够了。

---

## 五、最推荐的新手动作

### 方法 A：最稳

```bash
node scripts/run_example_catalog_prepare.js --starter true
```

看完推荐入口，再挑一个 example id 跑。

### 方法 B：最快

```bash
node scripts/run_example_catalog_prepare.js --intent portrait --output-dir /tmp/daoge-portrait-demo
```

适合已经知道自己要做人像类任务的人。

### 方法 C：最可控

```bash
node scripts/render_example_catalog_board.js
```

然后打开：

- `references/examples/examples_catalog.html`

先看分类，再决定跑哪个入口。

---

## 六、第一次使用时，不建议你做的事

先不要：

- 直接读 `template_registry_zh.json`
- 直接读全部 `examples.catalog.json`
- 一开始就理解所有 `variant`
- 试图从 100 多个入口里盲选

正确顺序是：

1. 先按任务类型判断自己属于哪类
2. 再选一个 starter / intent
3. 先看预检面板
4. 再决定是否继续执行

---

## 七、如果你是维护者

如果你不是普通使用者，而是要继续扩模板或改系统，再去看这些文档：

- `README.md`
- `references/examples/README.md`
- `references/template_authoring_zh.md`
- `references/template_registry_zh.json`
- `docs/daoge_*`

普通使用者不要从这些开始。
