# 规格文档质量要素示例

本文档展示 AC 逐项测试设计表、分支追踪表、验证记录的真实示例。

---

## 示例 1：AC 逐项测试设计表

### 场景：用户注册功能

**标准格式**：

| AC | 验收重点 | 测试层级 | 目标资产 | 目标命令 | 初始资产状态（2026-10-26） |
| --- | --- | --- | --- | --- | --- |
| AC01 | 正常注册流程 | 后端 API/数据库集成 + 前端交互 | `server/crates/identity/tests/user_registration.rs`<br>`frontend/apps/client/src/views/__tests__/user_registration.test.tsx` | `cd server && cargo test -p tuzai-identity --test user_registration ac01`<br>`cd frontend && pnpm --filter @tuzai/client test -- user_registration` | 后端：已通过<br>前端：规划中 |
| AC02 | 邮箱重复冲突 | 后端 API/数据库集成 | `server/crates/identity/tests/user_registration.rs` | `cd server && cargo test -p tuzai-identity --test user_registration ac02` | 已通过 |
| AC03 | 参数校验 | 后端 API 单元测试 | `server/crates/identity/tests/validation_tests.rs` | `cd server && cargo test -p tuzai-identity --test validation_tests email_validation` | 已通过 |
| AC04 | 事务原子性 | 后端数据库集成测试 | `server/crates/identity/tests/transaction_tests.rs` | `cd server && cargo test -p tuzai-identity --test transaction_tests rollback_on_failure` | 规划中：目标文件未创建 |
| AC05 | 并发安全 | 后端数据库集成测试 | `server/crates/identity/tests/concurrent_tests.rs` | `cd server && cargo test -p tuzai-identity --test concurrent_tests concurrent_registration` | 规划中：目标文件未创建 |
| AC06 | 邮箱规范化 | 后端 API/数据库集成 | `server/crates/identity/tests/user_registration.rs` | `cd server && cargo test -p tuzai-identity --test user_registration email_normalization` | 已通过 |

**关键要点**：
- ✅ 每个 AC 都有明确的测试层级（单元/集成/E2E/前后端）
- ✅ 目标资产是具体的文件路径（可以有多行）
- ✅ 目标命令是完整可执行的（包含目录切换、参数）
- ✅ 初始资产状态标注了日期和当前状态（已通过/规划中/目标文件未创建）

---

### 场景：余额扣费功能（高风险）

| AC | 验收重点 | 测试层级 | 目标资产 | 目标命令 | 初始资产状态（2026-10-26） |
| --- | --- | --- | --- | --- | --- |
| AC01 | 正常扣费流程 | 后端 API/数据库集成 + E2E | `server/crates/billing/tests/balance_deduction.rs` | `DATABASE_URL=postgres://... cargo test -p billing balance_deduction_success` | 已通过 |
| AC02 | 余额不足 | 后端 API/数据库集成 | `server/crates/billing/tests/balance_deduction.rs` | `DATABASE_URL=postgres://... cargo test -p billing insufficient_balance` | 已通过 |
| AC03 | 幂等性保证 | 后端数据库集成 | `server/crates/billing/tests/idempotency_tests.rs` | `DATABASE_URL=postgres://... cargo test -p billing duplicate_request_idempotent` | 已通过 |
| AC04 | 并发超扣防护 | 后端数据库并发测试 | `server/crates/billing/tests/concurrent_tests.rs` | `DATABASE_URL=postgres://... cargo test -p billing concurrent_deduction_no_overdraft` | 已通过 |
| AC05 | 事务回滚 | 后端数据库集成 | `server/crates/billing/tests/transaction_tests.rs` | `DATABASE_URL=postgres://... cargo test -p billing rollback_on_error` | 规划中 |
| AC06 | 审计日志记录 | 后端数据库集成 | `server/crates/billing/tests/audit_tests.rs` | `DATABASE_URL=postgres://... cargo test -p billing audit_log_complete` | 已通过 |
| AC07 | 金额精度保证 | 后端单元测试 | `server/crates/billing/tests/decimal_tests.rs` | `cargo test -p billing decimal_precision` | 已通过 |

**关键要点**：
- ✅ 高风险功能的 AC 更详细（7个 AC 覆盖所有边界）
- ✅ 环境变量直接写在命令中（DATABASE_URL）
- ✅ 并发、幂等、审计等关键场景都有独立 AC

---

## 示例 2：分支到测试追踪表

### 场景：用户注册功能

**技术设计伪代码**：

```text
FUNCTION register_user(email: String, password: String) -> Result<User>:
  // B01-01: 参数校验
  IF NOT is_valid_email(email):
    RETURN Err(1010001, "invalid_email")
  
  IF password.len() < 8 OR password.len() > 72:
    RETURN Err(1010003, "invalid_password")
  
  // B01-02: 邮箱规范化
  normalized_email = email.trim().to_lowercase()
  
  // B01-03: 密码加密
  password_hash = bcrypt::hash(password, cost=12)
  
  // B01-04: 开启数据库事务
  BEGIN TRANSACTION
  
  // B01-05: 检查邮箱是否已存在
  IF email_exists(normalized_email):
    ROLLBACK
    RETURN Err(1010002, "email_already_registered")
  
  // B01-06: 创建用户记录
  user_id = INSERT INTO users(email, password_hash, status) 
            VALUES (normalized_email, password_hash, 'active')
  
  // B01-07: 创建余额账户（原子性保证）
  account_id = INSERT INTO balance_accounts(user_id, balance, frozen_balance)
               VALUES (user_id, 0, 0)
  
  IF account_creation_failed:
    ROLLBACK  // B01-08: 失败回滚
    RETURN Err(1010004, "account_creation_failed")
  
  COMMIT
  
  RETURN Ok(user)
```

**分支到测试追踪表**：

| 分支 | 分支描述 | AC 映射 | E2E 映射 | NFR 映射 |
| --- | --- | --- | --- | --- |
| B01-01 | 参数校验 | AC03 | - | - |
| B01-02 | 邮箱规范化 | AC06 | - | - |
| B01-03 | 密码加密 | AC01 | - | V1-NFR-002（密码安全） |
| B01-04, B01-08 | 事务边界 | AC01, AC04 | V1-E2E-01 | V1-NFR-003（数据一致性） |
| B01-05 | 检查邮箱重复 | AC02, AC05 | - | - |
| B01-06 | 创建用户记录 | AC01 | V1-E2E-01 | - |
| B01-07, B01-08 | 创建余额账户+回滚 | AC01, AC04 | V1-E2E-01 | V1-NFR-003（数据一致性） |

**关键要点**：
- ✅ 每个分支 ID 与伪代码注释精确对应
- ✅ 一个分支可以映射多个 AC（用逗号分隔）
- ✅ 用波浪号（～）或逗号表示多个分支
- ✅ E2E 和 NFR 映射建立完整追踪链路

---

### 场景：余额扣费功能（高风险，更复杂）

**技术设计伪代码**：

```text
FUNCTION deduct_balance(user_id, amount, idempotency_key) -> Result<Transaction>:
  REQUIRE amount > 0
  
  // B19-01: 获取幂等锁
  lock = acquire_idempotency_lock(idempotency_key)
  IF NOT lock:
    existing = get_cached_result(idempotency_key)
    IF existing: RETURN existing  // B19-02: 幂等返回
    RETURN Err(4010005, "conflict")
  
  TRY:
    // B19-03: 开启数据库事务
    BEGIN TRANSACTION
    
    // B19-04: 查询并锁定用户余额
    balance = DB.lock_for_update(user_balances WHERE user_id = ?)
    IF NOT balance:
      ROLLBACK
      RETURN Err(4010002, "user_not_found")
    
    // B19-05: 检查余额是否充足
    available = balance.balance - balance.frozen_balance
    IF available < amount:  // B19-06: 余额不足
      ROLLBACK
      RETURN Err(4010001, "insufficient_balance")
    
    // B19-07: 扣减余额
    UPDATE user_balances 
    SET balance = balance - amount,
        updated_at = NOW()
    WHERE user_id = ?
    
    // B19-08: 记录交易流水
    transaction_id = INSERT INTO balance_transactions(...)
    
    // B19-09: 记录审计日志
    INSERT INTO audit_logs(...)
    
    // B19-10: 提交事务
    COMMIT
    ASSERT balance >= 0  // 数据完整性断言
    
    // B19-11: 保存幂等结果
    cache_result(idempotency_key, transaction)
    
    RETURN Success(transaction)
    
  CATCH (error):
    ROLLBACK
    RETURN Err(5000001, "internal_error")
    
  FINALLY:
    release_lock(lock)
```

**分支到测试追踪表**：

| 分支 | 分支描述 | AC 映射 | E2E 映射 | NFR 映射 |
| --- | --- | --- | --- | --- |
| B19-01 | 获取幂等锁 | AC03 | - | V1-NFR-004（幂等性） |
| B19-02 | 幂等返回 | AC03 | V1-E2E-06（重放） | V1-NFR-004（幂等性） |
| B19-03, B19-10 | 事务边界 | 所有 AC | V1-E2E-06, V1-E2E-08 | V1-NFR-003（资金事务） |
| B19-04 | 查询并锁定余额 | AC01, AC02, AC04 | - | V1-NFR-005（并发控制） |
| B19-05, B19-06 | 检查余额充足 | AC02 | V1-E2E-08 | - |
| B19-07 | 扣减余额 | AC01 | V1-E2E-06 | V1-NFR-003（资金事务） |
| B19-08 | 记录交易流水 | AC01, AC06 | V1-E2E-06 | - |
| B19-09 | 记录审计日志 | AC06 | - | V1-RG-007（审计） |
| B19-10 | 提交事务+断言 | AC01, AC05 | V1-E2E-06 | V1-NFR-003（资金事务） |
| B19-11 | 保存幂等结果 | AC03 | - | V1-NFR-004（幂等性） |

**关键要点**：
- ✅ 高风险功能分支更细（11个分支）
- ✅ 关键分支（事务、锁、幂等）明确映射到 NFR
- ✅ 多个分支可以映射到同一个 E2E（如 V1-E2E-06）

---

## 示例 3：验证记录

### 场景：用户注册功能 - 后端集成测试

**标准格式**：

#### 2026-10-26 后端集成测试

`CARGO_HOME=/tmp/tuzai-cargo DATABASE_URL=postgres://tag:tag@127.0.0.1:5432/tag cargo test -p tuzai-identity --test user_registration`：6/6 通过。使用 `sqlx::test` 隔离数据库，覆盖正常注册、重复邮箱、弱密码无写入、余额联动、失败无额外数据和邮箱规范化。前端交互与 E2E01 仍待补。

**关键要点**：
- ✅ 完整的环境变量（CARGO_HOME, DATABASE_URL）
- ✅ 精确的命令（包含包名、测试文件）
- ✅ 通过数量统计（6/6）
- ✅ 详细的覆盖内容说明（列出所有测试场景）
- ✅ 明确的遗留工作（前端交互与 E2E01 仍待补）

---

### 场景：余额扣费功能 - 后端集成测试

#### 2026-10-25 后端集成测试

`DATABASE_URL=postgres://billing:billing@127.0.0.1:5432/billing_test RUST_LOG=debug cargo test -p tuzai-billing --test balance_deduction -- --test-threads=1`：7/7 通过。使用 `SELECT FOR UPDATE` 锁定余额行，测试隔离环境覆盖正常扣费、余额不足、幂等重放、并发无超扣、事务回滚、审计日志完整性和金额精度。需要单线程运行（--test-threads=1）以测试并发锁行为。E2E-06（四桶金额核对）和 E2E-08（超扣防护）仍待补。

**关键要点**：
- ✅ 包含调试环境变量（RUST_LOG=debug）
- ✅ 说明了特殊参数的原因（--test-threads=1 用于测试并发）
- ✅ 列出所有7个测试场景
- ✅ 明确指出需要的 E2E 测试（E2E-06, E2E-08）

---

### 场景：用户注册功能 - 前端单元测试

#### 2026-10-24 前端单元测试

`cd frontend && NODE_ENV=test pnpm --filter @tuzai/client test -- user_registration --coverage`：4/4 通过。覆盖表单输入校验、提交按钮禁用、成功后跳转、错误提示展示。测试覆盖率：statements 95.2%, branches 87.5%, functions 100%, lines 94.8%。前端与后端 API 的集成测试（E2E01）仍待补。

**关键要点**：
- ✅ 包含工作目录切换（cd frontend）
- ✅ 包含环境变量（NODE_ENV=test）
- ✅ 包含覆盖率参数（--coverage）
- ✅ 报告了覆盖率指标（statements, branches, functions, lines）
- ✅ 明确遗留工作（集成测试）

---

### 场景：余额扣费功能 - E2E 测试

#### 2026-10-26 端到端测试

`DATABASE_URL=postgres://... REDIS_URL=redis://... BASE_URL=http://localhost:3000 npm run test:e2e -- balance-deduction.spec.ts`：3/5 通过。覆盖用户登录→充值→调用付费API→余额扣减→流水记录的完整链路（E2E-06）。通过场景：正常扣费、余额不足拦截、幂等重放。失败场景：并发超扣防护（E2E-08，偶现超扣0.01元，已记录 issue #234）、审计日志完整性（E2E-09，日志丢失问题待修复）。

**关键要点**：
- ✅ 包含所有环境变量（DATABASE_URL, REDIS_URL, BASE_URL）
- ✅ 说明测试的完整链路
- ✅ 区分通过和失败场景（3/5）
- ✅ 失败原因详细说明（偶现超扣、日志丢失）
- ✅ 关联到 issue 编号（#234）

---

### 场景：规格基线核验

#### 2026-10-20 规格基线核验

| 日期 | 环境 | 方法与证据 | 核验结果 |
| --- | --- | --- | --- |
| 2026-10-20 | local workspace | 文档 + 静态代码审计；对照 [V1 实现状态](../../../02-产品与版本/当前版本/V1-实现状态.md)；本次未运行自动化测试 | 规格：Ready；后端：开发中；前端：规划中；自动化验证：待补。本记录不构成测试通过证据。 |

**关键要点**：
- ✅ 明确说明这是静态审计，不是测试通过证据
- ✅ 标注了各组件的状态（规格/后端/前端/测试）
- ✅ 说明了方法（文档审计、代码审计）

---

## 反面示例（❌ 不要这样写）

### ❌ 不完整的 AC 逐项测试设计表

| AC | 测试命令 | 状态 |
| --- | --- | --- |
| AC01 | cargo test | 通过 |
| AC02 | cargo test | 通过 |

**问题**：
- ❌ 缺少验收重点
- ❌ 缺少测试层级
- ❌ 缺少目标资产（具体文件路径）
- ❌ 命令不完整（没有包名、测试名）
- ❌ 没有日期

---

### ❌ 不完整的验证记录

#### 2026-10-26 测试通过

`cargo test`：通过。

**问题**：
- ❌ 没有环境变量
- ❌ 命令不完整（没有包名、测试文件）
- ❌ 没有通过数量统计（N/M）
- ❌ 没有覆盖内容说明
- ❌ 没有遗留工作说明

---

### ❌ 缺失分支 ID 的伪代码

```text
FUNCTION register_user(email, password):
  IF NOT is_valid_email(email):
    RETURN Err("invalid_email")
  
  BEGIN TRANSACTION
    INSERT INTO users(...)
    INSERT INTO balance_accounts(...)
  COMMIT
```

**问题**：
- ❌ 没有分支 ID 标注（// B01-01, B01-02...）
- ❌ 没有错误码（只有错误键）
- ❌ 没有详细的事务操作说明

---

## 总结

### AC 逐项测试设计表必须包含

1. ✅ AC 编号和验收重点
2. ✅ 测试层级（单元/集成/E2E/前后端）
3. ✅ 目标资产（具体文件路径，可多行）
4. ✅ 目标命令（完整可执行，含参数）
5. ✅ 初始资产状态（日期 + 状态）

### 分支到测试追踪表必须包含

1. ✅ 分支 ID（与伪代码注释一一对应）
2. ✅ 分支描述（简要职责）
3. ✅ AC 映射（可多个，逗号分隔）
4. ✅ E2E 映射（可多个）
5. ✅ NFR 映射（如有）

### 验证记录必须包含

1. ✅ 完整的环境变量
2. ✅ 精确的命令（包含路径、包名、参数）
3. ✅ 通过数量统计（N/M 通过）
4. ✅ 详细的覆盖内容说明
5. ✅ 明确的遗留工作
6. ✅ 失败场景的详细原因（如有）
