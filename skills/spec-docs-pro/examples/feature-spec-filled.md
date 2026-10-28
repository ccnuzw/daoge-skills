---
title: "01 用户注册"
version: V1
feature_id: V1-FR-001
domain: 账户与权限
spec_status: Ready
risk: 标准
track: 账户与权限
updated: 2026-10-28
---
# 01 用户注册

> 示例说明：本文件演示放在 `docs/03-功能规格/V1/01-账户/01-用户注册.md` 时的完整写法。文中的相对链接、测试路径和命令都按该位置和一个 Node.js 项目编写，在 skill 目录内打开时链接不可用。

## 功能卡

| 项目 | 内容 |
| --- | --- |
| 编号 | V1-FR-001 |
| 领域 | 账户与权限 |
| 规格状态 | Ready |
| 风险等级 | 标准（多表写入，已用单事务约束） |
| 上游依赖 | 无 |
| 下游影响 | V1-FR-002 用户登录 |
| 规格负责人 | 后端负责人 |
| 实现状态 | 见 [V1 实现状态](../../../02-产品与版本/当前版本/V1-实现状态.md) |

## 目标

让新用户用唯一邮箱和密码创建账户，并在同一事务中获得零余额账户。

## 功能边界

包含：

- 邮箱密码注册，邮箱规范化（去首尾空格、转小写）后全局唯一
- 密码强哈希存储
- 同事务创建零余额账户（D001）

不包含：

- 邮箱验证（原因：V2 规划）
- 第三方登录（原因：不在产品范围）
- 注册限流（原因：属于发布门禁 V1-RG-001，由 V1-FR-028 负责）

## 来源与追踪

- 需求来源：[V1 产品需求](../../../02-产品与版本/当前版本/V1-产品需求.md#账户)
- 相关决策：D001 用户与余额账户原子创建
- 跨功能验收：V1-E2E-01 注册到首次调用

## 需求说明

### 用户故事

作为访客，我希望用邮箱注册账户，以便登录后使用平台。

### 业务规则

1. 邮箱规范化后全局唯一，大小写和首尾空格不同的邮箱视为同一个。
2. 密码 8～72 个字符，只保存强哈希，明文不进日志和响应。
3. 用户与余额账户必须同时存在（D001）。

### 主流程

1. 访客提交邮箱和密码。
2. 服务端规范化邮箱并校验密码强度。
3. 在同一事务中创建用户和零余额账户。
4. 返回用户信息（不含密码哈希）。

### 异常与边界

- 邮箱格式不合法或密码不满足规则：400，不写入任何数据。
- 邮箱已注册：409，不创建第二个用户。
- 两个请求同时注册同一邮箱：只有一个成功，另一个 409。
- 余额账户插入失败：用户记录同步回滚。

### 页面与交互

注册页包含邮箱、密码两个字段；提交中禁用按钮；成功后跳转登录页；失败时在对应字段下显示错误提示。

## 接口契约

公共响应、鉴权和错误码约定以 [V1 接口契约](../../../04-技术架构/当前版本/V1-接口契约.md) 为准。

### 接口清单

| 方法 | 路径 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| POST | `/api/v1/users` | 无 | 注册 |

### 请求字段

| 字段 | 位置 | 类型 | 必填 | 规则 |
| --- | --- | --- | --- | --- |
| email | body | string | 是 | 规范化后为合法邮箱，最长 254 |
| password | body | string | 是 | 8～72 字符；不记录、不回显 |

### 成功响应

```json
{
  "code": 0,
  "data": { "id": "usr_01J...", "email": "user@example.com", "created_at": "2026-10-28T08:00:00Z" },
  "request_id": "req_x"
}
```

### 错误矩阵

| 错误码 | 错误键 | HTTP | 场景 | 用户提示 |
| --- | --- | --- | --- | --- |
| 1010001 | invalid_email | 400 | 邮箱格式不合法 | 请输入有效邮箱 |
| 1010002 | weak_password | 400 | 密码不满足规则 | 密码需 8～72 个字符 |
| 1010003 | email_already_registered | 409 | 邮箱已注册 | 该邮箱已注册 |

## 数据与事务

### 读写数据

| 数据 | 操作 | 字段 |
| --- | --- | --- |
| `users` | W | id, email, password_hash, status, created_at |
| `balances` | W | user_id, amount, frozen |

### 约束与事务

- `users.email` 唯一索引，并发注册由唯一约束兜底。
- `balances.amount`、`balances.frozen` 初始为 0，非负。
- 用户与余额在同一事务中写入，任一失败全部回滚（D001）。

### 状态与生命周期

不适用：注册只创建 active 用户，本功能不涉及状态流转；禁用与删除见 V1-FR-025。

## 验收标准

#### AC01 正常注册

Given 邮箱 `new@example.com` 未注册，密码 `Passw0rd!`。

When POST `/api/v1/users`。

Then 返回 201；`users` 新增 1 条 active 记录；`balances` 新增 1 条 amount=0 的记录；响应不含 password_hash。

#### AC02 重复邮箱规范化

Given `User@Example.com` 已注册。

When 使用 ` user@example.com ` 再次注册。

Then 返回 409 `email_already_registered`；`users` 中该邮箱仍只有 1 条。

#### AC03 余额账户失败回滚

Given 测试中注入故障，使 `balances` 插入失败。

When 提交合法注册。

Then 返回 500；`users` 中没有该邮箱记录。

#### AC04 并发注册同一邮箱

Given 邮箱 `race@example.com` 未注册。

When 同时发出 2 个注册请求。

Then 恰好 1 个返回 201，另 1 个返回 409；`users` 中只有 1 条记录。

#### AC05 弱密码

Given 密码为 `short`。

When 提交注册。

Then 返回 400 `weak_password`；不写入任何数据。

#### AC 逐项测试设计

| AC | 验收重点 | 测试层级 | 目标资产 | 目标命令 | 证据状态 |
| --- | --- | --- | --- | --- | --- |
| AC01 | 正常注册 | 集成 | `tests/integration/register.test.ts` | `pnpm test -- tests/integration/register.test.ts -t AC01` | 本地通过 |
| AC02 | 重复邮箱规范化 | 集成 | `tests/integration/register.test.ts` | `pnpm test -- tests/integration/register.test.ts -t AC02` | 本地通过 |
| AC03 | 失败回滚 | 集成（故障注入） | `tests/integration/register.test.ts` | `pnpm test -- tests/integration/register.test.ts -t AC03` | 本地通过 |
| AC04 | 并发注册 | 集成（并发） | `tests/integration/register-concurrency.test.ts` | `pnpm test -- register-concurrency` | 未创建 |
| AC05 | 弱密码 | 单元 | `src/users/password.test.ts` | `pnpm test -- src/users/password.test.ts` | 本地通过 |

## 技术设计

### 单元契约

| 函数 | 前置条件 | 返回 / 后置条件 | 副作用 |
| --- | --- | --- | --- |
| `registerUser(email, password) -> User` | 无 | 用户与余额同时存在，或都不存在 | 单事务写 `users`、`balances` |

### 伪代码

```text
FUNCTION registerUser(email, password):
  email = normalize(email)                                         // B01-01
  IF NOT validEmail(email): RETURN Err(invalid_email)              // B01-02
  IF NOT strongPassword(password): RETURN Err(weak_password)       // B01-03
  hash = hashPassword(password)
  BEGIN TRANSACTION
    INSERT users ON CONFLICT(email) → RETURN Err(email_already_registered)   // B01-04
    INSERT balances(user_id, 0, 0)                                 // B01-05
  COMMIT OR ROLLBACK BOTH                                          // B01-06
  RETURN redact(user)
```

### 分支到测试追踪

| 分支 | 功能 AC | 跨功能验收 |
| --- | --- | --- |
| B01-01～02 | AC02 | - |
| B01-03 | AC05 | - |
| B01-04 | AC02、AC04 | - |
| B01-05～06 | AC01、AC03 | `V1-E2E-01` |

## 实现与验证

### 工程落点

- 代码：`src/users/register.ts`
- 数据迁移：`migrations/0001_users_balances.sql`
- 测试：`tests/integration/register.test.ts`

### 当前差距

- AC04 并发测试未创建。
- 前端注册页交互测试与 V1-E2E-01 待补。

### 验证记录

#### 2026-10-28 后端集成测试（本地）

`DATABASE_URL=postgres://test:***@127.0.0.1:5432/app_test pnpm test -- tests/integration/register.test.ts src/users/password.test.ts`：4/4 通过。覆盖 AC01、AC02、AC03（故障注入使余额插入失败）、AC05。AC04 未创建；本记录为本地证据，不构成预发或生产验证。

## 变更记录

| 日期 | 变更 | 关联决策 |
| --- | --- | --- |
| 2026-10-20 | 初始版本 | D001 |
| 2026-10-28 | 新增 AC04 并发注册 | - |
