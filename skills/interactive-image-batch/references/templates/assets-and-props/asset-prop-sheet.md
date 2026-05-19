# 资产道具板模板

用于图标资产、道具资产、游戏截图 mockup 和拟物化小型视觉资产板。

## 适用范围

- retro skeuomorphic icons
- game screenshot mockup
- 单体道具资产
- 小型图标板
- prop sheet

## 不适用范围

- 头像资产包
- 品牌包装系统板
- 大型场景插画
- 论文图或信息图

## 必问字段

- 这是图标板、道具板、游戏截图 mockup 还是单体资产组
- 重点是单体可读性、系列统一性，还是界面中的嵌入展示
- 更偏拟物、轻 3D、扁平图形，还是游戏风格截图
- 是否需要多角度、多状态或成套展示
- 文字策略是不留字、标签留位还是局部说明留位

## 推荐字段

- `content_brief`
- `style_requirements`
- `text_policy`
- `asset_role`
- `surface_style`
- `presentation_mode`
- `state_variation`
- `scale_readability`

## 模板变体

- `retro-skeuomorphic-icons`: 复古拟物图标板。
- `game-screenshot-mockup`: 游戏截图 mockup。

## 推荐 variant_axes

- `asset_role`: icon sheet, prop lineup, collectible item, screenshot mockup
- `surface_style`: retro skeuomorphic, glossy game UI, matte collectible, soft 3d prop
- `presentation_mode`: isolated board, staged lineup, ui-embedded mockup, inventory sheet
- `state_variation`: single state, hover-active pair, rarity set, multi-angle view

## 自动补全建议

- `lighting`: asset-readable highlights, edge separation, small-scale clarity
- `composition`: sheet-style layout, isolated asset spacing, prop-lineup hierarchy
- `mood`: collectible polish, utility clarity, playful asset precision

## 强约束

- 必须明确资产类型和使用场景
- 单体轮廓、材质和小尺寸可读性必须优先
- 多资产任务要说明系列一致性
- 文本策略只保留必要标签或留位

## 反模式

- 把道具板写成海报或场景图
- 资产之间尺寸逻辑混乱
- 只有风格词，没有使用场景
- 小尺寸下轮廓和材质不可读
