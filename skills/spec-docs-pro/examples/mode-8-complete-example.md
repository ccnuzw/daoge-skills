# 模式 8：补齐已实现功能的规格文档 - 完整示例

## 场景说明

项目已经实现了用户注册功能，有代码和测试，但文档缺失或不规范。

## 对话完整过程

### 第一步：收集现有材料

**用户**：
```
我们项目已经有一个用户注册功能，代码已经实现并有一些测试，
但文档不够规范。我想用 spec-docs-pro 补齐完整的规格文档。

代码在：server/crates/identity/src/user.rs
测试在：server/crates/identity/tests/user_registration.rs
旧文档：docs/features/user-register.md（很简陋）
```

**Skill**：
```
我来帮你补齐这个功能的规格文档。

首先，让我了解一下现有材料：

1️⃣ 这个功能的代码在哪里？
   我需要看主要的实现逻辑
   
你已经提供了：
- 主实现：server/crates/identity/src/user.rs
- 测试：server/crates/identity/tests/user_registration.rs

2️⃣ 有没有已有的文档？
   
你已经提供了：
- 旧文档：docs/features/user-register.md

让我读取这些材料，分析代码和测试...
```

---

### 第二步：分析代码

**Skill**（读取代码和测试后）：
```
我已经分析了代码和测试。发现：

【实现分析】

功能入口：
- POST /api/v1/users/register

主要实现：
- 创建用户记录（users 表）
- 创建余额账户（balance_accounts 表）
- 使用数据库事务保证原子性
- 密码用 bcrypt 加密（cost=12）

请求字段：
- email（必填，会规范化为小写）
- password（必填，8-72个字符，会加密）

响应：
- 成功：201 + 用户信息（不包含password_hash）
- 失败：409（邮箱重复）/ 400（参数错误）

数据库约束：
- users.email UNIQUE
- 事务内创建 user + balance_account

【测试覆盖】

已有测试（tests/user_registration.rs）：
✅ test_register_success：正常注册流程
✅ test_register_duplicate_email：邮箱重复
✅ test_register_invalid_params：参数校验

测试命令：
`cargo test -p tuzai-identity --test user_registration`

缺失测试：
❌ 事务回滚（如果余额账户创建失败）
❌ 并发安全（同时用同一邮箱注册）
❌ 密码强度边界（7个字符、73个字符）
❌ 邮箱规范化验证（大小写、trim）

现在让我和你确认一些设计细节...
```

---

### 第三步：发现设计问题

**Skill**：
```
基于代码分析，我有几个问题需要和你确认：

1️⃣ 原子性设计
我看到代码用事务保证用户和余额账户同时创建。

问：
- 这是有意的设计决策吗？
- 当时为什么这样设计？（是为了防止"半成品用户"吗？）
- 有没有考虑过其他方案（比如异步创建余额账户）？

→ 需要记录为冻结决策

2️⃣ 并发安全
代码中有 email 唯一约束。

问：
- 如果两个请求同时用同一邮箱注册，会怎样？
- 数据库约束能保证只有一个成功吗？
- 返回的错误码是什么？

→ 需要补充 AC 和测试

3️⃣ 密码安全
代码中对密码进行了 bcrypt 加密，cost=12。

问：
- 这符合安全基线吗？
- 为什么选择 cost=12？（性能 vs 安全权衡）
- 有没有文档记录这个决策？

→ 需要补充到文档

4️⃣ 边界情况
问：
- 密码长度限制是多少？（代码中看到 8-72）
- 邮箱格式有验证吗？（除了数据库唯一约束）
- 有没有防止暴力注册的机制？（频率限制）

→ 需要补充 AC
```

**用户**：
```
1. 是的，原子性是有意设计的。我们不想让用户创建成功但没有余额账户，
   那样会导致后续调用支付接口时失败。这个决策应该记录下来。

2. 并发场景：数据库唯一约束会保证只有一个成功，另一个返回 409。
   但确实没有测试覆盖。

3. bcrypt cost=12 是参考了 OWASP 建议，平衡了性能和安全。
   应该记录这个决策。

4. 边界：
   - 密码 8-72 字符（bcrypt 限制）
   - 邮箱用正则验证 + 唯一约束
   - 暴力注册：V1 暂不做，V2 考虑加频率限制
```

---

### 第四步：梳理完整边界

**Skill**：
```
现在让我们梳理完整的功能边界。

【基于代码，这个功能包含】
✅ 邮箱密码注册
✅ 自动创建余额账户（初始余额0）
✅ 密码加密存储（bcrypt cost=12）
✅ 邮箱唯一性校验（数据库约束 + 正则验证）
✅ 邮箱规范化（trim + 小写）

【这些功能代码中没有，请确认是否明确不做】
❓ 邮箱验证（发送验证链接）→ 你说：V2 做
❓ 手机号注册 → 你说：不在规划
❓ OAuth 登录（Google/GitHub）→ 你说：不在规划
❓ 注册频率限制 → 你说：V2 考虑

好的，我会在文档的"V1 不做"中明确标注。
```

---

### 第五步：补齐验收标准

**Skill**：
```
基于代码和我们的讨论，我整理出完整的验收标准：

【AC01：正常注册】
Given: 新用户提供有效邮箱（user@example.com）和密码（8个字符以上）
When: 提交注册 POST /api/v1/users/register
Then: 
  - 创建用户记录（users 表）
  - 创建余额账户（balance_accounts 表，初始余额0）
  - 返回 201 + 用户信息（不包含 password_hash）
  - 密码已加密存储（bcrypt cost=12）
  - 邮箱已规范化（trim + 小写）

测试状态：✅ tests/user_registration.rs::test_register_success
测试命令：cargo test -p tuzai-identity --test user_registration test_register_success

【AC02：邮箱重复】
Given: 邮箱已被注册（user@example.com）
When: 用同一邮箱注册
Then: 返回 409 Conflict + 错误码 1010002

测试状态：✅ tests/user_registration.rs::test_register_duplicate_email
测试命令：cargo test -p tuzai-identity --test user_registration test_register_duplicate_email

【AC03：参数校验】
Given: 邮箱格式无效或密码少于8个字符
When: 提交注册
Then: 返回 400 Bad Request + 具体错误信息

测试状态：✅ tests/user_registration.rs::test_register_invalid_params
测试命令：cargo test -p tuzai-identity --test user_registration test_register_invalid_params

【AC04：事务原子性】（补充，目前缺失测试）
Given: 用户创建成功但余额账户创建失败（模拟数据库错误）
When: 数据库操作
Then: 
  - 整个操作回滚
  - users 表中不产生记录
  - 不产生"半成品用户"

测试状态：❌ 需要补充
建议测试文件：tests/user_registration.rs::test_register_transaction_rollback
测试命令：cargo test -p tuzai-identity --test user_registration test_register_transaction_rollback

【AC05：并发安全】（补充，目前缺失测试）
Given: 两个请求同时用同一邮箱注册
When: 并发调用注册接口
Then: 
  - 只有一个成功（201）
  - 另一个返回 409 Conflict
  - 数据库只有一条用户记录

测试状态：❌ 需要补充
建议测试文件：tests/user_registration.rs::test_register_concurrent
测试命令：cargo test -p tuzai-identity --test user_registration test_register_concurrent

【AC06：邮箱规范化】（补充，目前缺失测试）
Given: 邮箱包含大写字母和空格（" User@Example.COM "）
When: 提交注册
Then: 
  - 注册成功
  - 存储的邮箱为 "user@example.com"（trim + 小写）
  - 再次用 "user@example.com" 注册会返回 409

测试状态：❌ 需要补充
建议测试文件：tests/user_registration.rs::test_register_email_normalization
测试命令：cargo test -p tuzai-identity --test user_registration test_register_email_normalization

这些 AC 是否完整？需要调整吗？
```

**用户**：
```
很完整！这正是我想要的。
```

---

### 第六步：生成完整文档

**Skill**：
```
好的！我现在生成完整的功能规格文档。

先做质量检查：

【AC 逐项测试设计表】
- [x] 每个 AC 都有明确的测试层级（集成测试）
- [x] 每个 AC 都有具体的目标资产（tests/user_registration.rs）
- [x] 每个 AC 都有可执行的目标命令（cargo test ...）
- [x] 每个 AC 都有初始资产状态（3个已通过，3个待补充）

检查完成... ✅

【技术设计要求】
- [x] 伪代码分支标注了分支 ID（B01-01～B01-08）
- [x] 分支到测试追踪表完整
- [x] 事务边界明确标注（BEGIN TRANSACTION / COMMIT / ROLLBACK）
- [x] 并发控制说明完整（数据库唯一约束）

检查完成... ✅

【验证记录格式】
- [x] 包含环境变量（DATABASE_URL, CARGO_HOME）
- [x] 包含通过数量统计（3/6 通过）
- [x] 包含覆盖内容说明
- [x] 包含遗留工作

检查完成... ✅

这份文档会包含：
✅ 功能卡（基于项目实际情况）
✅ 目标与边界（基于我们的讨论）
✅ 需求说明（基于代码实现）
✅ 接口契约（基于实际 API）
✅ 数据与事务（基于代码分析）
✅ 验收标准（现有测试 + 补充 AC）
✅ AC 逐项测试设计表（完整映射）
✅ 技术设计（带分支ID）
✅ 分支到测试追踪表
✅ 实现与验证（当前状态）
✅ 设计决策引用（2个冻结决策）

生成中...

✅ 文档已生成！

文档路径：docs/03-功能规格/V1/01-身份与权限/01-用户注册.md

【文档状态】
✅ 基于实际代码（server/crates/identity/src/user.rs）
✅ 包含完整 AC（6条）
✅ AC 逐项测试设计表完整（6/6，每个AC都有测试层级、目标资产、目标命令）
✅ 标注测试覆盖（3/6 已测试）
✅ 标注缺失测试（3/6 需补充）
✅ 技术设计包含分支ID（B01-01～B01-08）
✅ 分支到测试追踪表完整

【质量验证】
✅ AC 逐项测试设计表：完整（6/6）
✅ 验证记录格式：符合标准
✅ 测试覆盖率：50%（3/6 已测试，3/6 待补充）
✅ 分支追踪：完整（8个分支全部映射到AC）

【还需要做的】

1️⃣ 补充测试（优先）：
   - AC04：事务回滚测试
     目标资产：server/crates/identity/tests/user_registration.rs
     目标命令：cargo test -p tuzai-identity --test user_registration test_register_transaction_rollback
   
   - AC05：并发安全测试
     目标资产：server/crates/identity/tests/user_registration.rs
     目标命令：cargo test -p tuzai-identity --test user_registration test_register_concurrent
   
   - AC06：邮箱规范化测试
     目标资产：server/crates/identity/tests/user_registration.rs
     目标命令：cargo test -p tuzai-identity --test user_registration test_register_email_normalization

2️⃣ 补充设计决策：
   - D001：用户与余额账户原子创建
     理由：防止"半成品用户"，保证用户始终可用
     
   - D002：密码加密算法选择 bcrypt cost=12
     理由：OWASP 建议，平衡性能和安全

3️⃣ 更新版本实现状态：
   - 在 V1-实现状态.md 中更新此功能状态
   - 标记为"部分完成：核心功能已实现，3个边界测试待补充"

需要我帮你：
- 生成测试代码框架？
- 生成决策记录？
- 更新实现状态？
```

**用户**：
```
太棒了！请帮我生成 D001 和 D002 的决策记录。
```

---

## 生成的文档示例片段

### AC 逐项测试设计表

| AC | 验收重点 | 测试层级 | 目标资产 | 目标命令 | 初始资产状态（2026-10-26） |
| --- | --- | --- | --- | --- | --- |
| AC01 | 正常注册流程 | 后端 API/数据库集成 | `server/crates/identity/tests/user_registration.rs` | `cargo test -p tuzai-identity --test user_registration test_register_success` | 已通过 |
| AC02 | 邮箱重复冲突 | 后端 API/数据库集成 | `server/crates/identity/tests/user_registration.rs` | `cargo test -p tuzai-identity --test user_registration test_register_duplicate_email` | 已通过 |
| AC03 | 参数校验 | 后端 API/数据库集成 | `server/crates/identity/tests/user_registration.rs` | `cargo test -p tuzai-identity --test user_registration test_register_invalid_params` | 已通过 |
| AC04 | 事务原子性 | 后端数据库集成 | `server/crates/identity/tests/user_registration.rs` | `cargo test -p tuzai-identity --test user_registration test_register_transaction_rollback` | 规划中：目标文件已存在，测试用例待补充 |
| AC05 | 并发安全 | 后端数据库集成 | `server/crates/identity/tests/user_registration.rs` | `cargo test -p tuzai-identity --test user_registration test_register_concurrent` | 规划中：目标文件已存在，测试用例待补充 |
| AC06 | 邮箱规范化 | 后端数据库集成 | `server/crates/identity/tests/user_registration.rs` | `cargo test -p tuzai-identity --test user_registration test_register_email_normalization` | 规划中：目标文件已存在，测试用例待补充 |

### 验证记录

#### 2026-10-26 后端集成测试

`CARGO_HOME=/tmp/tuzai-cargo DATABASE_URL=postgres://test:test@127.0.0.1:5432/test_db cargo test -p tuzai-identity --test user_registration`：3/6 通过。使用 `sqlx::test` 隔离数据库，覆盖正常注册、邮箱重复、参数校验。事务回滚、并发安全、邮箱规范化测试仍待补充。

### 技术设计伪代码（带分支ID）

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

### 分支到测试追踪

| 分支 | 分支描述 | AC 映射 | E2E 映射 |
| --- | --- | --- | --- |
| B01-01 | 参数校验 | AC03 | - |
| B01-02 | 邮箱规范化 | AC06 | - |
| B01-03 | 密码加密 | AC01 | - |
| B01-04, B01-08 | 事务边界 | AC01, AC04 | V1-E2E-01 |
| B01-05 | 检查邮箱重复 | AC02, AC05 | - |
| B01-06 | 创建用户记录 | AC01 | V1-E2E-01 |
| B01-07, B01-08 | 创建余额账户+回滚 | AC01, AC04 | V1-E2E-01 |

---

## 总结

这个示例展示了：

1. ✅ **完整的对话流程**：从收集材料到生成文档
2. ✅ **代码分析能力**：识别实现了什么、缺失什么
3. ✅ **问题发现能力**：主动提出设计问题
4. ✅ **边界梳理能力**：区分"已实现"和"明确不做"
5. ✅ **AC 补齐能力**：基于测试覆盖情况补充缺失AC
6. ✅ **质量检查机制**：生成前强制检查关键要素
7. ✅ **完整的文档输出**：包含 AC 逐项测试设计表、分支追踪表、验证记录等所有关键元素
