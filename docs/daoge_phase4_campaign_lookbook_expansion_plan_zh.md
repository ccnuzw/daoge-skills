# DAOGE 下一批模板扩充计划（二）

## 本轮目标

在上一批补齐电商、社媒和测试类入口后，本轮继续补 **商业主视觉** 和 **系列组图** 两类高价值模板：

1. `campaign-poster`
2. `lookbook`

本轮北极星目标：

**让 catalog 和 onboarding 同时覆盖“单张主视觉”与“多张系列组图”两种典型商业工作流。**

## 选择原因

### `campaign-poster`

- 对应品牌主视觉、联名 KV、广告海报
- 是最典型的商业单张入口
- 能补齐当前 onboarding 对“品牌海报”这一类任务的缺口

### `lookbook`

- 对应系列服装、款式轮换、同一视觉系统下的多张组图
- 能补齐当前 onboarding 对“系列感”任务的缺口
- 与 `campaign-poster` 形成“单张海报 / 系列组图”配对

## 本轮交付物

每个模板都要同时补齐：

1. 最小 example
2. catalog 入口
3. onboarding starter
4. intent 入口
5. smoke 覆盖

## 新 intent

本轮新增：

- `poster`
- `lookbook`

## 验证要求

1. `campaign-poster` 和 `lookbook` 都能跑到 `prepare`
2. `--intent poster` / `--intent lookbook` 可命中正确入口
3. quickstart 不默认撞重复提示词红灯
4. 全量 smoke 通过
