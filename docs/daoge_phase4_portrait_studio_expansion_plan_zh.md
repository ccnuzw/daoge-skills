> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE 下一批模板扩充计划（三）

## 本轮目标

继续沿着商业视觉链补齐人物类入口：

1. `portrait-kv`
2. `studio-editorial`

本轮北极星目标：

**让 onboarding 覆盖“人物近景主视觉”与“棚拍编辑感大片”两类高频人像任务。**

## 选择原因

### `portrait-kv`

- 对应近景品牌主视觉、头肩海报、眼神气质导向人物图
- 能补齐当前 onboarding 对“人物近景商业图”的缺口

### `studio-editorial`

- 对应摄影棚、无缝纸背景、灯光结构明确的人像任务
- 能补齐当前 onboarding 对“棚拍编辑感”的缺口

## 本轮交付物

每个模板同时补齐：

1. 最小 example
2. catalog 入口
3. onboarding starter
4. intent 入口
5. smoke 覆盖

## 新 intent

本轮新增：

- `portrait`
- `studio`

## 验证要求

1. `portrait-kv` 和 `studio-editorial` 都能跑到 `prepare`
2. `--intent portrait` / `--intent studio` 可命中正确入口
3. quickstart 不默认撞重复提示词红灯
4. 全量 smoke 通过
