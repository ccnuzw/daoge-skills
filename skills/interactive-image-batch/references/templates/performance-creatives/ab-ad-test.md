# 广告 A/B 测试组模板

用于批量测试投放素材、卖点、构图、情绪、场景和 CTA 留白。

## 适用范围

- 广告投放素材 A/B 测试
- 单变量或少变量创意测试
- 转化导向素材对比
- 同主体、多表达方向的对照组任务

## 不适用范围

- 单张品牌海报
- 没有控制变量意识的自由创作
- 连续叙事分镜
- 纯详情页商品拆解图

## 必问字段

- 要测试的核心变量
- 目标人群和投放场景
- 每个变量需要几张
- 控制项：哪些内容必须保持一致
- 是否需要标题、CTA 或按钮安全区

## 推荐字段

- `ad_test_hypothesis`
- `controlled_variables`
- `text_policy`
- `commercial_role`
- `camera_language`
- `variation_requirements`

## 模板变体

- `single-variable`: 单变量测试，每张只变化一个维度。
- `benefit-stack`: 卖点栈测试，比较不同产品利益表达。
- `audience-angle`: 人群角度测试，比较不同使用场景和情绪。
- `layout-test`: 构图和 CTA 留白测试。

## 推荐 variant_axes

- `ad_test_hypothesis`: 测试假设。
- `controlled_variables`: 保持一致的控制项。
- `camera_language`: 镜头或构图变量。
- `value_proposition`: 卖点变量。
- `cta_zone`: CTA 留白位置。

## 自动补全建议

- `controlled_variables`: keep subject, product, visual quality, and layout baseline stable
- `text_policy`: leave clean headline and CTA-safe space, do not render readable text
- `commercial_role`: paid-social ad creative, conversion-oriented hero visual

## 强约束

- 测试假设必须清楚，不能所有维度一起乱变
- 控制项必须稳定，否则结果不可比较
- 每张图必须保留投放结构，而不是纯艺术图
- CTA 或标题安全区必须提前规划

## 反模式

- 每张图都随机变化，无法判断哪个变量有效
- 没有测试假设
- 投放素材像艺术图但没有转化结构
- CTA 或标题区域被主体占满
