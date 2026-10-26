---
title: "V1-E2E-{编号} {E2E场景名称}"
version: V1
e2e_id: V1-E2E-{编号}
status: 规划中
updated: {YYYY-MM-DD}
---
# V1-E2E-{编号}（E2E{编号}）{E2E场景名称}

## E2E 场景卡

| 项目 | 内容 |
| --- | --- |
| 场景编号 | V1-E2E-{编号} |
| 场景名称 | {E2E场景名称} |
| 测试层级 | 端到端测试 |
| 覆盖功能 | {功能编号列表，例如：V1-FR-001, V1-FR-005, V1-FR-019} |
| 状态 | 规划中 / 执行中 / 已通过 |
| 优先级 | P0（核心主链路）/ P1（重要场景）/ P2（边界场景） |
| 更新时间 | {YYYY-MM-DD} |

## 场景目标

{一句话说明这个 E2E 场景验证什么核心能力或主链路}

例如：
- 验证用户从注册到首次调用付费API的完整链路
- 验证余额不足时的拦截和提示机制
- 验证并发调用时的超扣防护机制

---

## 前置条件（Given）

**重要说明**：前置条件必须详细到可以被自动化脚本或测试工程师精确复现。包含所有必要的数据状态、系统配置、外部依赖。

### 系统状态

- 数据库：{状态说明，例如：已执行全部 migration，处于干净状态}
- 缓存：{状态说明，例如：Redis 已启动且为空}
- 外部服务：{状态说明，例如：Mock 支付网关已配置，模拟成功响应}

### 测试数据

- 用户：{说明，例如：已注册用户 test_user@example.com，密码 Test1234，初始余额 100.00 CNY}
- 资源：{说明，例如：已创建 API Key key_123，绑定到 test_user，状态 active}
- 配置：{说明，例如：模型资产 gpt-4 已配置，价格 0.03 CNY/1K tokens}
- 权限：{说明，例如：test_user 具有调用权限，无管理员权限}

### 环境配置

- 应用环境：{说明，例如：staging 环境，BASE_URL=https://staging.example.com}
- 认证方式：{说明，例如：Bearer Token 或 API Key}
- 特殊配置：{说明，例如：启用审计日志，禁用频率限制}

---

## 执行步骤（When）

**重要说明**：步骤必须具体到可执行，包含具体的接口路径、参数、预期的中间状态。

### 步骤 1：{步骤名称，例如：用户登录}

**操作**：
```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "test_user@example.com",
  "password": "Test1234"
}
```

**预期中间结果**：
- HTTP 状态码：200 OK
- 返回 Token：`eyJhbGc...`
- Token 有效期：24 小时

### 步骤 2：{步骤名称，例如：查询余额}

**操作**：
```http
GET /api/v1/users/me/balance
Authorization: Bearer {token}
```

**预期中间结果**：
- HTTP 状态码：200 OK
- 响应数据：
  ```json
  {
    "balance": "100.00",
    "frozen_balance": "0.00",
    "currency": "CNY"
  }
  ```

### 步骤 3：{步骤名称，例如：调用付费API}

**操作**：
```http
POST /api/v1/chat/completions
Authorization: Bearer {api_key}
Content-Type: application/json

{
  "model": "gpt-4",
  "messages": [
    {"role": "user", "content": "Hello"}
  ]
}
```

**预期中间结果**：
- HTTP 状态码：200 OK
- 返回完整响应
- 响应时间：< 5 秒

### 步骤 4：{步骤名称，例如：验证余额扣减}

**操作**：
```http
GET /api/v1/users/me/balance
Authorization: Bearer {token}
```

**预期中间结果**：
- HTTP 状态码：200 OK
- 余额已扣减：`balance < 100.00`

### 步骤 5：{步骤名称，例如：验证交易流水}

**操作**：
```http
GET /api/v1/users/me/transactions?limit=1
Authorization: Bearer {token}
```

**预期中间结果**：
- HTTP 状态码：200 OK
- 最新交易记录存在，type="deduction"

---

## 预期结果（Then）

**重要说明**：预期结果必须包含所有副作用，不仅是接口响应，还包括数据库状态、缓存状态、日志记录等。

### 主要结果

1. **接口响应正确**：
   - 所有接口返回预期的 HTTP 状态码和响应体
   - 响应时间符合性能要求（< 5 秒）

2. **数据状态正确**：
   - `user_balances` 表：余额正确扣减，`balance` 和 `frozen_balance` 满足约束
   - `balance_transactions` 表：新增交易记录，金额、类型、时间戳正确
   - `consumption_records` 表：新增消费记录，关联到正确的 API Key 和模型
   - `api_keys` 表：`last_used_at` 字段已更新

3. **审计日志完整**：
   - `audit_logs` 表：记录了关键操作（登录、余额查询、API调用、余额扣减）
   - 日志包含：user_id, action, resource_type, resource_id, ip_address, user_agent, timestamp

4. **缓存状态正确**：
   - 余额缓存已更新（如有缓存机制）
   - Token 缓存有效（如有缓存机制）

### 副作用清单

| 副作用 | 预期状态 |
| --- | --- |
| `user_balances.balance` | 从 100.00 扣减到约 99.94（具体金额取决于实际消费） |
| `user_balances.frozen_balance` | 保持 0.00（无冻结金额） |
| `balance_transactions` 表 | 新增 1 条记录，type="deduction" |
| `consumption_records` 表 | 新增 1 条记录，关联到 API Key 和模型 |
| `api_keys.last_used_at` | 更新为最新调用时间 |
| `audit_logs` 表 | 新增至少 4 条记录（登录、查询余额、API调用、扣减余额） |

### 边界条件验证

- 余额不会变成负数（`balance >= 0`）
- 冻结余额不会超过余额（`0 <= frozen_balance <= balance`）
- 交易金额精确到分（Decimal 精度）
- 时间戳使用 UTC 时区

### 引用的设计决策

- **D027**：余额扣减与交易记录在同一事务中，保证一致性
- **D034**：使用四桶计价模型（input, output, cache_write, cache_read）
- **D049**：按实际消费扣费，不预冻结（区别于 hold 机制）

---

## 自动化测试映射

### 测试文件

| 测试文件 | 测试框架 | 说明 |
| --- | --- | --- |
| `tests/e2e/user_first_call.spec.ts` | Playwright | 完整的用户操作流程 |
| `tests/e2e/balance_deduction.spec.ts` | Playwright | 余额扣减验证 |
| `tests/integration/transaction_consistency.rs` | Rust + sqlx | 数据库一致性验证 |

### 执行命令

```bash
# 完整 E2E 测试
DATABASE_URL=postgres://... \
REDIS_URL=redis://... \
BASE_URL=http://localhost:3000 \
npm run test:e2e -- user_first_call.spec.ts

# 数据库一致性验证
DATABASE_URL=postgres://... \
cargo test -p integration-tests transaction_consistency
```

### 测试夹具

测试需要的夹具（fixtures）：
- `fixtures/users/test_user.json`：测试用户数据
- `fixtures/models/gpt4_pricing.json`：模型定价配置
- `fixtures/api_keys/active_key.json`：测试用的 API Key

---

## 验证证据

### 格式要求

验证记录必须包含：
1. 执行时间（精确到分钟）
2. 执行环境（staging / production / local）
3. 完整命令（包含所有环境变量）
4. 执行结果（通过/失败）
5. 截图或日志片段（如有）
6. 失败原因（如失败）

### 验证记录示例

#### 2026-10-26 14:30 Staging 环境

**环境**：
- 环境：staging (https://staging.example.com)
- 数据库：postgres://staging-db:5432/tuzai_staging
- Redis：redis://staging-redis:6379

**命令**：
```bash
DATABASE_URL=postgres://staging:***@staging-db:5432/tuzai_staging \
REDIS_URL=redis://staging-redis:6379 \
BASE_URL=https://staging.example.com \
npm run test:e2e -- user_first_call.spec.ts
```

**结果**：✅ 通过（5/5 步骤全部成功）

**详细验证**：
- ✅ 步骤1：登录成功，Token 有效
- ✅ 步骤2：初始余额 100.00 CNY
- ✅ 步骤3：API 调用成功，返回正常响应
- ✅ 步骤4：余额扣减到 99.94 CNY（扣减 0.06 CNY）
- ✅ 步骤5：交易记录存在，金额正确

**数据验证**：
```sql
-- 验证余额
SELECT balance, frozen_balance FROM user_balances WHERE user_id = 'test_user_id';
-- 结果：balance=99.94, frozen_balance=0.00 ✅

-- 验证交易记录
SELECT amount, type FROM balance_transactions WHERE user_id = 'test_user_id' ORDER BY created_at DESC LIMIT 1;
-- 结果：amount=-0.06, type='deduction' ✅

-- 验证审计日志
SELECT COUNT(*) FROM audit_logs WHERE user_id = 'test_user_id' AND created_at > NOW() - INTERVAL '5 minutes';
-- 结果：4 条记录 ✅
```

**截图**：
- 见 `docs/e2e-evidence/2026-10-26-user-first-call.png`

**遗留问题**：无

---

#### 2026-10-25 11:20 Local 环境

**环境**：
- 环境：local (http://localhost:3000)
- 数据库：postgres://localhost:5432/tuzai_test
- Redis：redis://localhost:6379

**命令**：
```bash
DATABASE_URL=postgres://test:test@localhost:5432/tuzai_test \
REDIS_URL=redis://localhost:6379 \
BASE_URL=http://localhost:3000 \
npm run test:e2e -- user_first_call.spec.ts
```

**结果**：❌ 失败（3/5 步骤成功，步骤4失败）

**详细验证**：
- ✅ 步骤1：登录成功
- ✅ 步骤2：初始余额 100.00 CNY
- ✅ 步骤3：API 调用成功
- ❌ 步骤4：余额未扣减，仍为 100.00 CNY
- ⏭️ 步骤5：未执行（因步骤4失败）

**失败原因**：
余额扣减逻辑未触发。检查日志发现异步任务队列连接失败：
```
Error: Redis connection refused at localhost:6379
```

**根本原因**：本地 Redis 未启动

**修复方案**：
1. 启动 Redis：`docker-compose up -d redis`
2. 重新执行测试

**后续操作**：已启动 Redis，2026-10-25 11:35 重新测试通过 ✅

---

## 非功能需求验证

### 性能要求

| 指标 | 要求 | 实际 | 状态 |
| --- | --- | --- | --- |
| 接口响应时间（P50） | < 200ms | 180ms | ✅ |
| 接口响应时间（P95） | < 500ms | 420ms | ✅ |
| 接口响应时间（P99） | < 1000ms | 850ms | ✅ |
| API 调用完整链路 | < 5s | 3.2s | ✅ |
| 数据库事务时间 | < 100ms | 65ms | ✅ |

### 并发要求

| 场景 | 并发数 | 成功率 | 平均响应时间 | 状态 |
| --- | --- | --- | --- | --- |
| 登录 | 100 QPS | 100% | 150ms | ✅ |
| 余额查询 | 200 QPS | 100% | 80ms | ✅ |
| API 调用 | 50 QPS | 99.8% | 3.5s | ✅ |

### 安全要求

- ✅ Token 有效期：24 小时
- ✅ Token 刷新机制：有效
- ✅ API Key 校验：有效
- ✅ 权限校验：有效（无权限用户被拦截）
- ✅ 敏感信息脱敏：password_hash 不出现在响应中

---

## 失败场景与回归

### 已知失败场景

1. **并发超扣**（已修复，见 issue #234）
   - 场景：多个并发请求同时扣减余额
   - 问题：偶现超扣 0.01 元
   - 修复：使用 `SELECT FOR UPDATE` 锁定余额行
   - 回归验证：E2E-08（并发超扣防护）

2. **审计日志丢失**（已修复，见 issue #267）
   - 场景：高并发下审计日志部分丢失
   - 问题：异步写入日志时队列满导致丢失
   - 修复：增加队列容量 + 失败重试机制
   - 回归验证：E2E-09（审计日志完整性）

### 回归测试要求

每次修改涉及以下功能时，必须回归此 E2E 场景：
- 用户登录（V1-FR-001）
- 余额查询（V1-FR-005）
- 余额扣减（V1-FR-019）
- API 调用（V1-FR-034）
- 交易记录（V1-FR-020）

---

## 依赖功能

| 功能编号 | 功能名称 | 依赖类型 | 说明 |
| --- | --- | --- | --- |
| V1-FR-001 | 用户注册与登录 | 强依赖 | 必须先登录才能调用 |
| V1-FR-005 | 余额查询 | 强依赖 | 验证余额状态 |
| V1-FR-019 | 余额扣减 | 强依赖 | 核心功能 |
| V1-FR-020 | 交易流水 | 强依赖 | 验证扣减记录 |
| V1-FR-034 | API 调用 | 强依赖 | 触发扣减的主操作 |

---

## 变更记录

- 2026-10-26：初始版本，定义完整 E2E 场景
- 2026-10-25：补充失败场景和回归要求
- 2026-10-24：更新性能指标和验证证据格式
