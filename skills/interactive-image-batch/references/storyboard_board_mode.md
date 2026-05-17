# Storyboard board mode

用于“分镜版大板”而不是单张海报的场景。

核心思路不是把整张分镜板当成一条 prompt 去硬生，而是拆成三层：

1. `content_manifest.json`
   - 定义每个分镜格要表达什么
   - 每格可以有自己的 `reference_images`
   - 也可以完全不挂图，只走提示词
   - 每格可以有自己的 `prompt_hints`、`continuity_notes`、`camera_move`

2. `layout_manifest.json`
   - 定义画布尺寸和各区域位置
   - 区域可以变化，不强绑某个固定 2x3 版式
   - 通过 `bindings` 把 region 绑定到 content slot

3. `render_config.json`
   - 定义这是 `storyboard_board`
   - 定义当前是 `per-slot` 生成，还是后续外部拼装
   - 定义 `reference_mode`

4. `reference_bindings.json`（可选但推荐）
   - 专门记录“哪张图对应哪个分镜”
   - 支持一图多格、一格多图、部分格子无图
   - 也支持“哪张图是某个分镜的遮罩图”
   - 让上传的图片和分镜对应关系独立于正文内容

## 设计原则

- 内容层和版式层分离，避免每次换布局都重写提示词结构
- 参考图优先挂在 slot 上，而不是只挂全局参考
- 一个分镜板里的不同格子可以有不同参考图组合
- 某些格子完全可以不挂参考图，直接靠提示词 + 模型能力生成
- 左信息区、KV 收尾、shot 镜头区都可以独立建 slot
- `brand_panel` 这类纯文本区默认 `generate_image=false`
- `shot`、`kv`、`packshot`、`endcard` 默认可生图

## 当前本地开发版支持到哪里

- 已支持：
  - `task_spec.storyboard_plan`
  - layout/content/render 三个 manifest 的校验
- `reference_bindings.json`
- 生成 slot blueprint
- 把 per-slot 的参考图、镜头备注、连续性备注带入 prompt slot 元数据
- 支持通过 `mask_asset_ids` 把上传的遮罩图绑定到某个分镜
- runner 按 slot 自动分流：
    - `prompt-only` -> `images/generations`
    - `reference-assisted` -> `images/edits`
    - `masked-edit` -> `images/edits + mask`
  - 在 preview / preflight 中看见 storyboard 摘要
  - 对会导致执行失败的参考图/遮罩图缺失做阻断校验，而不是只给 warning

- 仍未完成：
  - 还没有做联网实跑级别的 provider 回归验证
  - 遮罩编辑仍受模型自身边界影响，不保证像素级精确贴边

## 推荐字段

每个 content slot 推荐至少带：

- `slot_id`
- `role`
- `sequence`
- `shot_label`
- `reference_mode`
- `prompt_hints`
- `reference_images`
- `reference_bindings`
- `mask_image`
- `reference_notes`
- `continuity_notes`
- `camera_move`
- `timecode`

## 典型角色

- `brand_panel`
- `shot`
- `kv`
- `packshot`
- `endcard`

`reference_mode` 推荐值：

- `prompt-only`
- `reference-assisted`
- `hybrid`
- `masked-edit`

`reference_bindings.json` 推荐字段：

- `reference_assets[]`
- `slot_assignments[]`
- `defaults`

`slot_assignments[]` 推荐补充字段：

- `asset_ids`
- `mask_asset_ids`
- `reference_mode`
- `notes`

中文映射建议：

- 普通参考图：放进 `asset_ids`
- 遮罩图：放进 `mask_asset_ids`
- 如果用户说“我补一张遮罩图，只改分镜3右下角礼盒”，推荐写成：

```json
{
  "slot_id": "shot_3",
  "asset_ids": ["ref_01"],
  "mask_asset_ids": ["mask_01"],
  "reference_mode": "masked-edit",
  "notes": "只改右下角礼盒"
}
```

## 典型 render_config

```json
{
  "render_mode": "storyboard_board",
  "generation_mode": "per-slot",
  "assembly_mode": "external-compositor",
  "reference_mode": "hybrid"
}
```
