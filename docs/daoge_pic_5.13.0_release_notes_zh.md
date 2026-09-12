# DAOGE Pic v5.13.0 发布说明

- 发布日期：2026-09-12
- Git 标签：`daoge-pic-v5.13.0`
- 分发方式：GitHub Release 不可变 `.tgz` 资产，不发布到 npm registry
- Skill protocol：`daoge-pic-skill-protocol/2.0.0`
- 运行时兼容范围：`>=5.13.0 <6.0.0`

## 发布摘要

v5.13.0 收口了本轮创作者工作台更新，并把源码、编译产物、CLI/API 契约、安装包门禁和发布材料统一到同一版本。创作谱系继续作为项目工作区首页，新增完整坐标系小地图与视口定位；资产状态图例、图片预览和确认动作保持可访问且可恢复。任务与轮次创建恢复通用推荐默认值，模板只覆盖自身提供的默认值，其余回退到稳定通用值。

## 主要变更

### Workbench 与创作体验

- 创作谱系新增可拖动/可点击小地图，使用完整节点坐标系计算视口矩形，定位不会触发画布框选。
- 项目资产和交付页面复用资产状态图例，统一解释未定、成果、未采用、可继续和交付冻结状态。
- 图片检查器放大范围恢复到 0.75x-2x，保留清晰的缩放边界。
- 归档和资产回收站使用共享可访问确认弹窗，确认后复用同一动作处理，显示忙碌与错误状态，不重复弹窗。
- 谱系中的运行和运行项只展示状态及“回到当前 Agent 会话处理”的边界说明；需要 Bearer Skill/CLI 的重试、暂停、恢复、取消不会伪装成无效的 Workbench 操作。

### 结构化创建

- 任务目标恢复探索 6 张、变体 4 张、精修 4 张、编辑 2 张的通用推荐值；探索默认画幅为 4:5。
- 轮次目的恢复探索 6 张/4:5、精修 4 张、变体 4 张、编辑 2 张、补图 2 张/16:9 的推荐值。
- 项目模板提供的字段优先使用模板值，未覆盖的目标回退到通用推荐；创建仍只写 Studio API/SQLite，不触发 Provider、预检或 Generation Run。

### Runtime、CLI 与发布门禁

- 运行时版本升至 5.13.0，协议版本继续保持 2.0.0。
- 当前计划写入路径统一为 `/api/rounds/<round-id>/plan`，退役 `/prepare` 不再执行。
- 受控 daemon shutdown 使用 `daemon-shutdown`，发布包不包含旧 `legacy-daemon`。
- package smoke 强制校验发布 tarball 的 package name/version、protocol manifest、编译后的 runtime 常量、TypeScript 声明、必需入口、allowlist、退役文件和敏感文件；缺失当前版本制品时 fail-closed。
- 包含本轮新增的 `daemon-shutdown`、创作谱系小地图模型和资产状态图例文件及对应回归测试。

## 验证结果

- `npm test`：363 项测试，361 通过、0 失败、2 项仅 Windows 实机用例跳过。
- `npm run build`：TypeScript 与 Vite Workbench 构建通过，转换 1620 个模块；主 Workbench chunk 595.71 kB 的大小提示为非阻断 warning。
- `npm run test:package`：发布清单 130 个文件，`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`；临时 consumer 安装、真实 bin、register-skill、doctor 和 `sharp` 全部通过。
- 定向 Workbench/谱系回归：17 项通过；所有验证均未调用真实图片 Provider，未产生计费生成请求。

## 发布制品

- 文件：`daoge-pic-5.13.0.tgz`
- 大小：480,424 bytes
- npm shasum：`ad67294b26fa50704aa0459e7d9f0eecad8ed242`
- SHA-256：`d2774a8d905a510b743b61f89292bc366a7b764af258dfae6fba0bd576ec552e`
- GitHub Release 资产：https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.13.0/daoge-pic-5.13.0.tgz
- checksum sidecar：`skills/daoge-pic/daoge-pic-5.13.0.tgz.sha256`

## 安装

项目级安装：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.13.0/daoge-pic-5.13.0.tgz"
npx daoge register-skill --scope project --workspace /absolute/workspace
npx daoge doctor --workspace /absolute/workspace
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.13.0/daoge-pic-5.13.0.tgz"
```

5.12.0 及更早版本的发布说明、checksum 和历史制品保持不可变，不与本版本 daemon 混用。