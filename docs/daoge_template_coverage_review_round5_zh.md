# DAOGE 模板覆盖盘点 Round 5

日期：2026-05-19

## 结论先行

当前 `interactive-image-batch` 已经进入 **显式正式变体全覆盖且结构稳定** 的状态。

基线数据：

- 主链模板：`22`
- catalog 入口：`95+`
- 显式 `variants` 家族覆盖：`22 / 22`
- `missing: []` 的模板家族：`22 / 22`

也就是说，本轮不再存在“注册表里声明了正式变体，但 catalog / example 没跟上”的结构性缺口。

## Round 5 关键观察

### 1. 低变体数家族已经不是“缺口”，只是“是否值得继续做深”的价值判断

当前正式变体数较低但已覆盖完整的家族：

- `lookbook`：`3`
- `ab-ad-test`：`4`
- `asset-prop-sheet`：`4`
- `campaign-poster`：`4`
- `cinematic-storyboard`：`4`
- `detail-page-set`：`4`
- `illustrated-scene-set`：`4`
- `social-grid`：`4`
- `type-layout-poster`：`4`
- `visual-doc-slide`：`4`

这些都不是“漏补”，而是后续是否继续扩正式变体的产品决策。

### 2. 第二梯队已经进入较舒适的业务覆盖区间

正式变体数 `5` 的家族：

- `academic-figure-board`
- `avatar-profile-pack`
- `brand-packaging-board`
- `ecommerce-clean`
- `image-edit`
- `map-route-board`
- `oral-storyboard-board`
- `portrait-kv`
- `studio-editorial`

这批家族现在已经从“主模板存在”进入“有足够实际可用入口”的状态，继续扩要看真实业务拉动，而不是为了补齐而补齐。

### 3. 说明型与接口型主线已经明显更厚

当前变体数最高的家族：

- `technical-diagram`：`7`
- `infographic-board`：`6`
- `ui-mockup-board`：`6`

这说明：

- 说明型模板主线已经足够厚
- 静态视觉里最“工具型 / 高频需求型”的家族，已经形成产品目录优势

这三条线短期不建议继续平均扩。

## 当前建议优先级

### P1：继续扩但要非常克制

如果必须继续扩正式变体，最值得继续做的不是“变体数最少”，而是“业务价值高且变体边界清晰”的家族：

1. `lookbook`
2. `campaign-poster`
3. `detail-page-set`
4. `social-grid`

原因：

- 都属于商业交付高频任务
- 继续扩一到两个变体的产品收益，会高于继续加冷门说明图尾项
- 家族边界也相对稳定，不容易和其他模板发生重叠

### P2：建议转入真实业务试运行

以下家族已经不急着继续扩正式变体，更值得拿现有入口去做真实任务回归：

- `oral-storyboard-board`
- `portrait-kv`
- `studio-editorial`
- `image-edit`
- `ecommerce-clean`

原因：

- 这些家族已经具备 5 个左右正式变体
- 继续加量容易进入“有目录但缺真实使用反馈”的阶段
- 更应该通过真实项目确认：哪些入口被高频使用，哪些值得升格成下一批正式变体

### P3：可以视为短期封板

当前建议短期封板的家族：

- `technical-diagram`
- `infographic-board`
- `ui-mockup-board`
- `academic-figure-board`
- `map-route-board`

原因：

- 这几条线的谱系已经足够厚
- 继续扩的边际收益明显下降
- 更适合转去做真实业务筛选，而不是继续堆 catalog 数量

## 本轮最终判断

Round 5 不再是“继续扫缺口”的阶段，而是：

- **正式变体治理已经完成**
- **下一步应转向价值驱动扩展**
- **是否继续扩某条家族，应该由真实业务拉动，而不是目录完备焦虑**

## 下一步建议

二选一即可：

1. 继续做一小批高价值商业视觉扩展  
   优先：`lookbook` / `campaign-poster` / `detail-page-set`

2. 进入一轮真实业务试运行  
   优先：`oral-storyboard-board` / `portrait-kv` / `image-edit`

如果必须继续扩正式变体，我建议下一步先做 `lookbook`。  
如果目标是让系统更像成熟产品，我建议下一步先做真实业务试运行。
