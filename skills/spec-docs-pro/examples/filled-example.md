# Spec-Docs-Pro 完整填充示例

本文档展示如何使用升级后的模板生成与 TUZAI 项目同等质量的功能规格文档。

## 示例场景

为一个 API 平台项目创建"用户注册"功能的完整规格文档。

---

## 功能主文档示例（完整版）

```markdown
---
title: "01 用户注册"
version: V1
feature_id: V1-FR-001
domain: 身份与权限
status: 本地验证
updated: 2026-10-25
---
# 01 用户注册

## 功能卡

| 项目 | 内容 |
| --- | --- |
| 领域 | 身份 |
| 状态 | 本地验证 |
| 上游依赖 | 平台数据库、统一错误响应与 Request ID |
| 版本 | V1 |
| 规格负责人 | Identity / Client |
| 规格状态 | Ready |
| 规格版本 | 1.0 |
| 更新时间 | 2026-10-25 |

## 目标

让新用户使用唯一邮箱创建平台账户，并在同一业务结果中获得初始余额账户。

## 功能边界

包含：

- 邮箱、密码和可选名称注册
- 邮箱唯一性与输入校验
- 密码安全哈希
- 自动创建零余额账户

不包含：

- 邮箱验证
- OAuth、微信登录
- 找回密码

## 来源与追踪

- 主 PRD 4.1
- V1 README 4.1
- E2E01

下游影响：02、05、21

## 完成定义

需求、API、数据约束和错误口径冻结；关键验收用例通过；实现文档记录可复现的验证证据。

---

## 需求说明

### 用户故事

作为新用户，我希望使用邮箱和密码注册账号，以便开始使用平台服务。

### 前置依赖

- PostgreSQL 数据库
- 统一错误响应中间件
- Request ID 生成机制

### 范围

- 邮箱规范化（trim + 小写）
- 密码强度校验（8～72 字符）
- Argon2 哈希存储
- 用户与余额账户原子创建

### 业务规则

1. 邮箱规范化后全局唯一
2. 密码只保存强哈希，不保存明文
3. 用户与余额账户必须同时可用
4. 注册成功用户状态为 active

### 主流程

1. 新用户访问注册页面
2. 输入邮箱、密码、可选姓名
3. 点击"注册"按钮
4. 系统验证输入合法性
5. 系统创建用户和余额账户
6. 返回用户信息（不含密码哈希）

### 异常与边界

- 邮箱格式不合法 → 返回验证错误
- 邮箱已存在 → 返回冲突错误
- 密码弱（< 8 字符）→ 返回验证错误
- 数据库写入失败 → 事务回滚

### 页面与交互

`/auth/register` 页面。字段为邮箱（必填）、密码（必填）、姓名（可选）；点击注册按钮提交；提交中显示加载状态；成功后跳转登录页；失败显示错误提示。

公共交互遵循 [界面规范](../../../04-技术架构/当前版本/V1-界面规范.md)。

### 字段规则

| 字段 | 类型 | 必填 | 规则 |
| --- | --- | --- | --- |
| email | string | 是 | trim 后小写；合法邮箱；最长 254 |
| password | string | 是 | 8～72 字符；禁止写日志 |
| name | string | 否 | trim；1～100；空值由前端生成默认值 |

### V1 不做

- 邮箱验证码
- 手机号注册
- OAuth 第三方登录

---

## 接口契约

### 公共约定

用户端接口沿用 [V1 API Contract](../../../04-技术架构/当前版本/V1-接口契约.md) 的 `code/data/request_id` 响应。

### 接口清单

| 接口 | 鉴权 | 用途 |
| --- | --- | --- |
| POST `/api/user/auth/register` | 无鉴权 | 用户注册 |

### 契约要求

- 邮箱规范化后全局唯一
- 密码只保存强哈希
- 用户与余额账户必须同时可用

### 错误场景

- 邮箱格式不合法
- 邮箱已存在
- 密码弱

### 字段级契约

#### 请求与查询字段

| 字段 | 位置 | 类型 | 必填 | 规则 |
| --- | --- | --- | --- | --- |
| email | body | string | 是 | trim 后转小写；合法邮箱；最长 254 |
| password | body | string | 是 | 8～72 字符；不记录、不回显 |
| name | body | string | 否 | trim；1～100；空值由邮箱前缀生成 |

#### 接口结果

| 接口 | 请求/查询 | 成功 data |
| --- | --- | --- |
| POST /api/user/auth/register | email, password, name | UserView：id, email, name, status, created_at |

主写接口请求示例：

```json
{
  "email": "user@example.com",
  "password": "SecurePass123",
  "name": "张三"
}
```

### 成功响应示例

```json
{
  "code": 0,
  "data": {
    "id": "019f4e2b-8c3a-7890-abcd-ef1234567890",
    "email": "user@example.com",
    "name": "张三",
    "status": "active",
    "created_at": "2026-10-25T08:00:00Z"
  },
  "request_id": "req_abc123"
}
```

### 错误矩阵

| code | error_key | HTTP | 提示 |
| --- | --- | --- | --- |
| 1010001 | invalid_email | 400 | 邮箱格式不正确 |
| 1010002 | password_too_weak | 400 | 密码长度至少 8 个字符 |
| 1010003 | email_already_exists | 409 | 该邮箱已被注册 |
| 9010001 | database_error | 500 | 系统错误，请稍后重试 |

---

## 数据与事务

### 涉及数据

- `identity.users`：用户身份、密码哈希和状态
- `billing.user_balances`：余额账户

### 约束与事务

1. `users.email` 唯一
2. 余额初始值和冻结余额均为 0
3. 用户创建与余额创建需要原子一致

### 字段读写矩阵

| 数据 | 操作 | 字段 |
| --- | --- | --- |
| identity.users | W | email, password_hash, name, status, created_at |
| billing.user_balances | W | user_id, balance, frozen_balance, created_at |

### 状态与生命周期

- 初始状态：active
- 用户创建成功即为 active，不需要激活流程

### 物理约束与迁移

- users.email VARCHAR(254) NOT NULL UNIQUE
- users.password_hash TEXT NOT NULL，只存强哈希
- users.status VARCHAR(20) CHECK(status IN ('active', 'disabled'))，默认 active
- user_balances.balance DECIMAL(20, 12) NOT NULL DEFAULT 0
- user_balances.frozen_balance DECIMAL(20, 12) NOT NULL DEFAULT 0
- 外键：user_balances.user_id → users.id ON DELETE CASCADE

---

## 验收标准

### 功能验收

#### AC01 正常注册

Given 使用未注册邮箱和合法密码。

When 提交注册。

Then 创建 active 用户和零余额账户，响应不包含 password_hash。

#### AC02 重复邮箱

Given 邮箱已存在。

When 再次注册同一规范化邮箱。

Then 返回冲突错误且不创建第二个用户。

#### AC03 密码安全

Given 任何合法注册。

When 查询数据库。

Then password_hash 为 Argon2 哈希，不保存明文。

#### AC04 用户余额联动

Given 正常注册。

When 用户创建成功。

Then 自动创建 user_balances 记录，balance = 0, frozen_balance = 0。

#### AC05 事务原子性

Given 模拟余额创建失败。

When 提交注册。

Then 用户和余额均不创建，无脏数据。

#### AC06 邮箱规范化

Given 邮箱包含大写和首尾空格。

When 提交注册。

Then 以规范化邮箱唯一存储。

### 自动化测试映射

以下文件为目标落点。2026-10-25 后端目标文件已创建并通过 6 个测试；前端和 E2E 状态见下表。

| AC 范围 | 自动化重点 | 建议测试文件 | 建议命令 | 当前状态 |
| --- | --- | --- | --- | --- |
| AC01–AC02 | 主流程、基础失败分支 | `server/crates/identity/tests/user_registration.rs` | `cd server && cargo test -p identity --test user_registration` | 2026-10-25 后端通过 |
| AC03–AC04 | 状态、事务或数据约束 | `server/crates/identity/tests/user_registration.rs` | `cd server && cargo test -p identity --test user_registration` | 2026-10-25 后端通过 |
| AC05–AC06 | 权限、幂等或边界场景 | `server/crates/identity/tests/user_registration.rs` | `cd server && cargo test -p identity --test user_registration` | 2026-10-25 后端通过 |

完整回归命令：`cd server && cargo test --workspace`。

#### AC 逐项测试设计

**关键说明**：此表是验收标准的核心，每个 AC 必须明确测试层级、目标资产、目标命令和初始状态。

| AC | 验收重点 | 测试层级 | 目标资产 | 目标命令 | 初始资产状态（2026-10-25） |
| --- | --- | --- | --- | --- | --- |
| AC01 | 正常注册 | 后端 API/数据库集成 + 前端交互 | `server/crates/identity/tests/user_registration.rs`<br>`frontend/apps/client/src/views/__tests__/user_registration.test.tsx` | `cd server && cargo test -p identity --test user_registration ac01`<br>`cd frontend && pnpm --filter @app/client test -- user_registration` | 后端已创建并通过<br>前端规划中 |
| AC02 | 重复邮箱冲突 | 后端集成测试 | `server/crates/identity/tests/user_registration.rs` | `cd server && cargo test -p identity --test user_registration ac02` | 已创建并通过 |
| AC03 | 密码哈希安全 | 后端单元测试 | `server/crates/identity/tests/user_registration.rs` | `cd server && cargo test -p identity --test user_registration ac03` | 已创建并通过 |
| AC04 | 余额账户联动 | 后端集成测试 | `server/crates/identity/tests/user_registration.rs` | `cd server && cargo test -p identity --test user_registration ac04` | 已创建并通过 |
| AC05 | 事务原子性 | 后端集成测试 | `server/crates/identity/tests/user_registration.rs` | `cd server && cargo test -p identity --test user_registration ac05` | 已创建并通过 |
| AC06 | 邮箱规范化 | 后端单元测试 | `server/crates/identity/tests/user_registration.rs` | `cd server && cargo test -p identity --test user_registration ac06` | 已创建并通过 |

### 测试映射追踪

- Unit：AC03、AC06（密码哈希、邮箱规范化）
- Integration：AC01～AC06（完整流程、数据库隔离）
- E2E：V1-E2E-01（用户注册登录充值完整链路）

---

## 实现与验证

### 工程落点

- 后端：`server/crates/identity/src/user_registration.rs`
- 前端：`frontend/apps/client/src/pages/auth/Register.tsx`
- 数据：migration `0001_create_users_table.sql`, `0002_create_user_balances_table.sql`
- 测试：`server/crates/identity/tests/user_registration.rs`

### 验证记录

#### 2026-10-25 规格基线核验

| 日期 | 环境 | 方法与证据 | 核验结果 |
| --- | --- | --- | --- |
| 2026-10-25 | local workspace | 文档 + 静态代码审计 | 规格：Ready；后端：已实现；前端：部分实现；E2E：待补。本记录不构成测试通过证据。 |

#### 2026-10-25 后端集成测试

`CARGO_HOME=/tmp/tuzai-cargo DATABASE_URL=postgres://test:test@127.0.0.1:5432/testdb cargo test -p identity --test user_registration`：6/6 通过。使用 `sqlx::test` 隔离数据库，覆盖正常注册、重复邮箱、弱密码无写入、余额联动、失败无额外数据和邮箱规范化。前端交互与 E2E01 仍待补。

---

## 技术设计

来源：[需求](#需求说明) · [API](#接口契约) · [数据](#数据与事务) · [验收](#验收标准)

### 单元契约

| 函数 | 前置条件 | 返回/后置条件 | 副作用 |
| --- | --- | --- | --- |
| `register_user(input, request_id) -> Result<UserView>` | 输入已验证格式 | 成功返回不含密码的用户视图 | 单事务写 `users`/`user_balances` |
| `normalize_email(email) -> String` | 非空字符串 | trim 后小写 | 无 |
| `hash_password(password) -> String` | 8～72 字符 | Argon2 哈希 | 无 |

### 伪代码

```text
FUNCTION register_user(input, request_id) -> Result<UserView>:
  email = normalize_email(input.email)                         // B01-01
  IF NOT valid_password(input.password): RETURN Err(1010002)   // B01-02
  password_hash = hash_password(input.password)                // B01-03
  BEGIN TRANSACTION
    IF users.exists(email): ROLLBACK; RETURN Err(1010003)      // B01-04
    user = users.insert(email, password_hash, status=active)
    balance = user_balances.insert(user.id, balance=0)         // B01-05
  COMMIT OR ROLLBACK BOTH                                      // B01-06
  RETURN redact_secrets(user, balance)
```

### 分支到测试追踪

| 分支 | 功能 AC | 跨功能验收 |
| --- | --- | --- |
| B01-01～02 | AC02、AC06 | `V1-E2E-01` |
| B01-03 | AC03 | `V1-NFR-002`（日志安全） |
| B01-04 | AC02 | `V1-E2E-01` |
| B01-05～06 | AC01、AC04、AC05 | `V1-E2E-01` |

当前为本地验证；测试资产与执行证据状态以功能 "验收标准"章节 为准。
```

---

## 关键要点对比

### ❌ 不合格的文档（缺少关键元素）

```markdown
## 验收标准

### AC01 正常注册
Given 用户输入邮箱密码。
When 提交。
Then 注册成功。

### 验证记录
（开发完成后填写）
```

### ✅ 合格的文档（包含所有关键元素）

```markdown
## 验收标准

### AC01 正常注册
Given 使用未注册邮箱和合法密码。
When 提交注册。
Then 创建 active 用户和零余额账户，响应不包含 password_hash。

#### AC 逐项测试设计

| AC | 验收重点 | 测试层级 | 目标资产 | 目标命令 | 初始资产状态（2026-10-25） |
| --- | --- | --- | --- | --- | --- |
| AC01 | 正常注册 | 后端 API/数据库集成 + 前端交互 | `server/crates/identity/tests/user_registration.rs` | `cd server && cargo test -p identity --test user_registration ac01` | 后端已创建并通过 |

### 验证记录

#### 2026-10-25 后端集成测试

`CARGO_HOME=/tmp cargo test -p identity --test user_registration`：6/6 通过。覆盖正常注册、重复邮箱、弱密码、余额联动、事务回滚、邮箱规范化。前端待补。
```

---

## 技术设计示例对比

### ❌ 不合格的伪代码（缺少分支 ID）

```text
function register_user(input):
  validate input
  hash password
  create user
  create balance
  return user
```

### ✅ 合格的伪代码（包含分支 ID）

```text
FUNCTION register_user(input, request_id) -> Result<UserView>:
  email = normalize_email(input.email)                         // B01-01
  IF NOT valid_password(input.password): RETURN Err(1010002)   // B01-02
  password_hash = hash_password(input.password)                // B01-03
  BEGIN TRANSACTION
    IF users.exists(email): ROLLBACK; RETURN Err(1010003)      // B01-04
    user = users.insert(email, password_hash, status=active)
    balance = user_balances.insert(user.id, balance=0)         // B01-05
  COMMIT OR ROLLBACK BOTH                                      // B01-06
  RETURN redact_secrets(user, balance)
```

### 必须包含的分支追踪表

```markdown
| 分支 | 功能 AC | 跨功能验收 |
| --- | --- | --- |
| B01-01～02 | AC02、AC06 | `V1-E2E-01` |
| B01-03 | AC03 | `V1-NFR-002` |
| B01-04 | AC02 | `V1-E2E-01` |
| B01-05～06 | AC01、AC04、AC05 | `V1-E2E-01` |
```

---

## 总结

升级后的 Skill 生成的文档包含：

✅ **AC 逐项测试设计表**（测试层级、目标资产、命令、状态）  
✅ **详细验证记录**（环境+命令+N/M通过+覆盖+遗留）  
✅ **带分支 ID 的伪代码**（// B01-01）  
✅ **分支到测试追踪表**（B01-01 → AC01 → E2E-01）  
✅ **详细的 Given/When/Then**（包含所有前置条件和副作用）  
✅ **完整的单元契约**（前置/后置/副作用）  

达到与 TUZAI 项目样例文档**完全相同**的质量水平！
