---
title: "{编号} {中文功能名} - 技术设计"
version: V1
feature_id: V1-FR-{编号}
design_version: 1.0
updated: {YYYY-MM-DD}
---
# {编号} {中文功能名} - 技术设计

## 设计概述

本文档为功能 [{编号} {中文功能名}](./{编号}-{中文功能名}.md) 的技术设计。该功能属于高风险类型（{风险原因，例如：涉及资金操作/权限控制/外部回调}），需要独立技术设计文档。

**文档来源引用**：
来源：[需求](./{编号}-{中文功能名}.md#需求说明) · [API](./{编号}-{中文功能名}.md#接口契约) · [数据](./{编号}-{中文功能名}.md#数据与事务) · [验收](./{编号}-{中文功能名}.md#验收标准)

## 风险评估

| 风险类型 | 严重程度 | 缓解措施 |
| --- | --- | --- |
| {风险，例如：资金不一致} | 高/中/低 | {措施，例如：数据库事务 + 幂等键 + 余额约束} |
| {风险，例如：并发冲突} | 高/中/低 | {措施，例如：SELECT FOR UPDATE + 重试} |
| {风险，例如：外部依赖故障} | 高/中/低 | {措施，例如：补偿任务 + 告警} |

## 核心函数签名

### 单元契约

**重要说明**：每个核心函数必须明确前置条件、后置条件和副作用，这是验证正确性的基础。

| 函数 | 前置条件 | 返回 | 副作用 |
| --- | --- | --- | --- |
| `{functionName}({param1}: {Type1}, {param2}: {Type2}) -> {ReturnType}` | {前置条件，例如：用户已认证；amount_cny ≥ 0} | {返回说明，例如：holding 状态或余额不足} | {副作用，例如：锁余额行并增加 frozen_balance；币种固定 CNY} |
| `{helperFunction}({param}: {Type}) -> {ReturnType}` | {前置条件} | {返回说明} | {副作用或"无"} |

### 主入口函数详细契约

```typescript
async function {functionName}(
  {param1}: {Type1},
  {param2}: {Type2},
  context: {RequestContext}
): Promise<Result<{ReturnType}, {ErrorType}>>
```

**前置条件：**
- {前置条件 1，例如：用户已认证且 active}
- {前置条件 2，例如：余额充足（balance - frozen_balance >= amount）}
- {前置条件 3，例如：幂等键未使用}

**后置条件：**
- {后置条件 1，例如：余额已扣减}
- {后置条件 2，例如：流水已记录}
- {后置条件 3，例如：幂等键已消费}

**副作用：**
- {副作用 1，例如：修改 user_balances.balance 和 frozen_balance}
- {副作用 2，例如：插入 balance_transactions 记录}
- {副作用 3，例如：插入 consumption_records 记录}

### 关键子函数契约

```typescript
async function {helperFunction}(
  {param}: {Type}
): Promise<{ReturnType}>
```

**职责：**{说明该函数职责，例如：估算冻结金额的保守上限}

**幂等性：**{是否幂等，如何保证，例如：纯函数，无副作用}

**事务边界：**{是否开启事务，范围是什么，例如：不开启事务，由调用方控制}

## 伪代码实现

**核心要求**：
1. 每个关键分支必须标注分支追踪 ID（格式：// B{编号}-{序号}）
2. 明确标注事务边界（BEGIN TRANSACTION / COMMIT / ROLLBACK）
3. 显式说明数据库锁（例如：DB.lock_user_balance）
4. 包含具体错误码（例如：4010001, "insufficient_balance"）
5. 使用 REQUIRE/ASSERT 说明约束

### 主流程伪代码

```text
FUNCTION {functionName}({params}) -> Result<{ReturnType}>:
  REQUIRE {约束，例如：amount_cny >= 0}
  
  // B{编号}-01: 验证输入和权限
  IF NOT validate_input({params}):
    RETURN Err({错误码}, "{error_key}")
  
  IF NOT check_permission(context.user, {resource}):
    RETURN Err({错误码}, "{error_key}")
  
  // B{编号}-02: 获取幂等锁（分布式锁或数据库唯一约束）
  idempotency_key = generate_key({params})
  lock = acquire_lock(idempotency_key)
  IF NOT lock:
    existing = get_result(idempotency_key)
    IF existing:
      RETURN existing  // 幂等返回
    RETURN Err({错误码}, "{error_key}")
  
  TRY:
    // B{编号}-03: 开启数据库事务
    BEGIN TRANSACTION
    
    // B{编号}-04: 查询和锁定关键资源
    resource = DB.lock_for_update({resource_id})  // SELECT FOR UPDATE
    IF NOT resource OR NOT resource.is_valid():
      ROLLBACK
      RETURN Err({错误码}, "{error_key}")
    
    // B{编号}-05: 业务规则校验
    IF NOT check_business_rule(resource, {params}):
      ROLLBACK
      RETURN Err({错误码}, "{error_key}")
    
    // B{编号}-06: 执行核心业务逻辑
    result = perform_core_logic(resource, {params})
    
    // B{编号}-07: 记录审计日志（同事务）
    audit_log = create_audit_log(context.user, {action}, result)
    DB.insert(audit_log)
    
    // B{编号}-08: 提交事务
    COMMIT
    ASSERT balance >= 0 AND 0 <= frozen_balance <= balance  // 数据完整性断言
    
    // B{编号}-09: 异步副作用（事务外）
    ASYNC {
      send_notification(result)
      trigger_downstream_event(result)
    }
    
    // B{编号}-10: 保存幂等结果并返回
    save_idempotent_result(idempotency_key, result)
    RETURN Success(result)
    
  CATCH (error):
    ROLLBACK
    log_error(error, {context})
    RETURN Err({错误码}, "{error_key}")
    
  FINALLY:
    release_lock(lock)
```

### 补偿逻辑伪代码

```text
FUNCTION compensate_{operation}({params}) -> Result<void>:
  // B{编号}-11: 补偿逻辑（用于失败恢复）
  BEGIN TRANSACTION
  
  original = DB.lock_for_update({id})
  IF original.status != {expected_status}:
    ROLLBACK
    RETURN Err({错误码}, "{error_key}")
  
  // 执行反向操作
  revert_operation(original)
  
  // 记录补偿审计
  compensation_log = create_compensation_log({reason})
  DB.insert(compensation_log)
  
  COMMIT
  RETURN Success()
```

### 估算函数伪代码（如适用）

```text
FUNCTION estimate_{operation}(request, snapshot) -> Decimal:
  REQUIRE validate_complete_snapshot(snapshot)
  
  // B{编号}-12: 保守估算逻辑
  input_unit = MAX(for every tier:
                   tier.input_price,
                   tier.cache_write_price,
                   tier.cache_read_price)
  output_unit = MAX(for every tier: tier.output_price)
  output_limit = MIN_POSITIVE(request.max_output_tokens,
                              snapshot.max_tokens,
                              protocol_hard_limit)
  
  RETURN ((estimated_input_tokens * input_unit) +
          (output_limit * output_unit)) / 1_000_000 * snapshot.rate
```

## 分支到测试追踪

**关键说明**：此表是技术设计的核心输出，建立从实现分支到验收条件再到测试的完整追踪链路。每个分支 ID 必须与伪代码中的注释一一对应。

| 分支 ID | 分支描述 | AC 映射 | E2E 映射 | NFR 映射 |
| --- | --- | --- | --- | --- |
| B{编号}-01 | 验证输入和权限 | AC01, AC03 | - | V1-NFR-004（管理权限服务端强制） |
| B{编号}-02 | 获取幂等锁 | AC04, AC05 | - | - |
| B{编号}-03 | 开启数据库事务 | 所有 AC | V1-E2E-{编号} | V1-NFR-003（资金事务） |
| B{编号}-04 | 查询和锁定资源 | AC02, AC06 | - | - |
| B{编号}-05 | 业务规则校验 | AC01, AC02 | - | - |
| B{编号}-06 | 执行核心逻辑 | AC01 | V1-E2E-{编号} | V1-NFR-003（资金事务） |
| B{编号}-07 | 记录审计日志 | AC07 | - | V1-NFR-002（日志安全）, V1-RG-007（审计） |
| B{编号}-08 | 提交事务 | 所有 AC | - | V1-NFR-003（资金事务） |
| B{编号}-09 | 异步副作用 | AC08 | - | - |
| B{编号}-10 | 幂等结果保存 | AC04, AC05 | - | - |
| B{编号}-11 | 补偿逻辑 | AC09 | V1-E2E-{编号} | V1-NFR-003（资金事务） |
| B{编号}-12 | 保守估算逻辑 | AC08 | V1-E2E-{编号} | - |

**填写规范**：
- **分支 ID**：必须与伪代码注释精确对应
- **分支描述**：简要说明该分支的职责
- **AC 映射**：列出该分支覆盖的所有 AC 编号（用逗号分隔）
- **E2E 映射**：列出相关的端到端场景（用逗号分隔）
- **NFR 映射**：列出相关的非功能需求（用逗号分隔）

## 并发控制

### 并发场景

1. **场景 1：{并发场景描述，例如：同一用户并发充值}**
   - **冲突点**：{冲突描述，例如：user_balances 表的 balance 和 frozen_balance 字段}
   - **控制方式**：{控制方式，例如：SELECT FOR UPDATE on user_balances WHERE user_id = ?}
   - **预期行为**：{预期行为，例如：串行执行，后者等待前者完成}
   - **失败策略**：{失败策略，例如：超时后返回 503，建议重试}

2. **场景 2：{并发场景描述，例如：管理员并发操作同一资源}**
   - **冲突点**：{冲突描述}
   - **控制方式**：{控制方式}
   - **预期行为**：{预期行为}
   - **失败策略**：{失败策略}

### 锁策略

| 资源 | 锁类型 | 持锁时长 | 失败策略 |
| --- | --- | --- | --- |
| {资源，例如：user_balances} | SELECT FOR UPDATE | 事务内（< 5秒） | 重试 / 返回错误 |
| {资源，例如：幂等键} | 分布式锁（Redis SETNX） | 操作完成前（< 30秒） | 返回冲突错误 |
| {资源} | {锁类型} | {时长} | {策略} |

### 死锁预防

- {预防措施 1，例如：统一锁顺序：先用户后订单，避免循环等待}
- {预防措施 2，例如：事务内操作时间 < 5 秒，超时自动回滚}
- {预防措施 3，例如：外部调用在事务外，不在持锁期间访问网络}

## 事务边界

### 主事务

```
BEGIN TRANSACTION (Isolation Level: {READ COMMITTED / REPEATABLE READ / SERIALIZABLE})
  1. SELECT FOR UPDATE {核心资源}
  2. {业务逻辑写入}
  3. INSERT audit_log
COMMIT
```

**范围：**{事务包含的操作，例如：余额扣减、流水记录、审计日志}

**隔离级别：**{隔离级别及理由，例如：READ COMMITTED，避免幻读但允许不可重复读}

**超时：**{事务超时时间，例如：5 秒}

**失败回滚：**{回滚策略，例如：任一步失败全部回滚，保证原子性}

### 外部调用处理

外部调用（{例如：微信支付、发送邮件、上游 API}）不在主事务内：

1. 主事务提交后调用外部服务
2. 外部调用失败 → 记录补偿任务到数据库
3. 补偿任务由后台 worker 定时重试（指数退避：1s -> 2s -> 4s -> 8s）
4. 达到最大重试次数后人工介入

**原因**：外部调用不可靠，持续时间不可控，不能阻塞事务提交。

## 幂等保证

### 幂等键生成

```
idempotency_key = sha256({关键参数组合})
```

**关键参数：**
- {参数 1，例如：user_id}
- {参数 2，例如：request_id}
- {参数 3，例如：operation_type}

### 幂等实现

1. **请求前**：生成幂等键（客户端生成或服务端根据参数生成）
2. **执行前**：检查是否已处理（查询幂等记录表或使用 UNIQUE 约束）
3. **执行中**：原子写入业务记录和幂等记录（同一事务）
4. **执行后**：保存结果和幂等键关联
5. **重复请求**：直接返回已保存结果，不重复执行

### 幂等存储

- **存储位置：**{Redis / PostgreSQL / 两者结合}
- **过期时间：**{例如：24 小时}
- **清理策略**：{例如：定时清理过期记录，保留最近 7 天}

## 错误处理

### 错误分类

| 错误类型 | HTTP | 错误码 | 处理策略 |
| --- | --- | --- | --- |
| 输入验证失败 | 400 | {错误码，例如：1010001} | 立即返回，不重试 |
| 权限不足 | 403 | {错误码} | 立即返回，记录审计 |
| 资源不存在 | 404 | {错误码} | 立即返回，不重试 |
| 业务规则冲突 | 409 | {错误码} | 立即返回，不重试 |
| 余额不足 | 402 | {错误码} | 立即返回，引导充值 |
| 外部依赖故障 | 502/503 | {错误码} | 记录补偿任务，后台重试 |
| 数据库异常 | 500 | {错误码} | 事务回滚，告警 |

### 补偿任务

外部依赖失败时创建补偿任务：

```json
{
  "task_id": "{UUID}",
  "task_type": "{任务类型}",
  "payload": {原始请求参数},
  "retry_count": 0,
  "max_retries": 3,
  "next_retry_at": "{时间戳}",
  "status": "pending"
}
```

**重试策略**：指数退避，1s -> 2s -> 4s -> 8s，最多 3 次

**失败处理**：达到最大重试次数后，状态标记为 failed，发送告警通知人工处理

## 性能考虑

### 数据库查询

- **索引要求**：
  - `{表名}.{字段}` (B-tree 索引)
  - `{表名}.({字段1}, {字段2})` (复合索引)
  - `{表名}.{字段} WHERE {条件}` (部分索引)

- **查询计划**：已验证 EXPLAIN，避免全表扫描

- **N+1 问题**：使用 JOIN / 批量查询避免循环查询

### 缓存策略

| 缓存项 | 存储 | TTL | 更新策略 |
| --- | --- | --- | --- |
| {缓存项，例如：用户余额} | Redis | {时长，例如：60秒} | Write-through / Cache-aside |
| {缓存项} | {存储} | {TTL} | {策略} |

### 热路径优化

- {优化点 1，例如：避免事务内调用外部服务}
- {优化点 2，例如：异步发送通知，不阻塞主流程}
- {优化点 3，例如：批量写入审计日志，减少 IO}

## 安全考虑

### 敏感数据处理

| 数据类型 | 存储方式 | 日志策略 | 传输加密 |
| --- | --- | --- | --- |
| {例如：密码} | Argon2/bcrypt 哈希 | 禁止记录 | HTTPS |
| {例如：API Key} | AES-256-GCM 加密 | 只记录前缀 | HTTPS |
| {例如：支付凭证} | 加密存储 | 禁止记录 | HTTPS + 签名验证 |

### 注入防护

- **SQL 注入**：使用参数化查询，禁止字符串拼接
- **XSS**：前端输出转义，CSP 策略
- **SSRF**：外部 URL 白名单校验，禁止私有 IP
- **CSV 注入**：导出时转义 `=+-@`

### 权限校验

```
function check_permission(user, resource, action) -> bool:
  // 1. 验证用户身份有效
  IF NOT user.is_active():
    RETURN false
  
  // 2. 验证角色权限
  IF NOT user.has_role({required_role}):
    RETURN false
  
  // 3. 验证资源所有权（如需要）
  IF resource.owner_id != user.id AND NOT user.is_admin():
    RETURN false
  
  RETURN true
```

## 测试策略

### 单元测试

- **B{编号}-01**：输入验证分支（各种非法输入）
- **B{编号}-05**：业务规则校验（边界条件）
- **B{编号}-06**：核心逻辑（隔离依赖，使用 mock）

### 集成测试

- **B{编号}-03～08**：完整事务流程（真实数据库）
- **并发测试**：多线程并发执行，验证锁和事务
- **失败恢复**：模拟各环节失败，验证回滚

### E2E 测试

- **V1-E2E-{编号}**：端到端业务场景
- **幂等测试**：重复提交相同请求，验证只执行一次
- **补偿测试**：外部依赖失败后补偿任务执行

## 部署与监控

### 发布检查清单

- [ ] Migration 已在预发布环境验证
- [ ] 索引已创建，查询计划已验证
- [ ] 幂等键存储已配置（Redis/DB）
- [ ] 补偿任务 worker 已部署
- [ ] 告警规则已配置（错误率、延迟）
- [ ] 回滚方案已准备

### 监控指标

| 指标 | 阈值 | 告警级别 |
| --- | --- | --- |
| 请求成功率 | < 99.5% | P1 |
| P99 延迟 | > {时长} | P2 |
| 事务失败率 | > 1% | P1 |
| 补偿任务堆积 | > 100 | P2 |
| 数据库连接数 | > {数量} | P2 |

### 日志记录

**注意**：日志中不得包含密码、完整 API Key、支付凭证等敏感信息。

```
log.info("operation_started", {
  user_id: user.id,
  operation: "{operation_name}",
  idempotency_key: key,
  params_summary: {非敏感参数摘要}
})

log.info("operation_completed", {
  user_id: user.id,
  operation: "{operation_name}",
  idempotency_key: key,
  result_summary: {结果摘要},
  duration_ms: elapsed
})

log.error("operation_failed", {
  user_id: user.id,
  operation: "{operation_name}",
  idempotency_key: key,
  error_type: error.type,
  error_message: error.message,
  stack_trace: error.stack  // 生产环境脱敏
})
```

## 回滚方案

### 回滚触发条件

- {条件 1，例如：错误率 > 5%}
- {条件 2，例如：数据不一致报告}
- {条件 3，例如：严重性能劣化（P99 > 10s）}

### 回滚步骤

1. {步骤 1，例如：切流量到旧版本（通过 feature flag 或负载均衡）}
2. {步骤 2，例如：停止补偿任务 worker}
3. {步骤 3，例如：数据修复脚本（如需要）}
4. {步骤 4，例如：验证数据一致性}

### 数据兼容性

- **向前兼容**：新代码能处理旧数据（migration 添加列时使用默认值）
- **向后兼容**：旧代码能处理新数据（回滚时，新增列对旧代码透明）
- **迁移脚本**：{如有必要，说明数据迁移脚本位置}

## 技术债务与后续优化

### 已知限制

- {限制 1，例如：当前不支持分布式事务，跨服务调用无法保证强一致性}
- {限制 2，例如：补偿任务最多重试 3 次，超过后需人工介入}

### 未来优化方向

- {优化 1，例如：引入 Saga 模式处理长事务}
- {优化 2，例如：使用 CQRS 分离读写，提升查询性能}
- {优化 3，例如：异步化提升吞吐量}

---

## 变更记录

| 版本 | 日期 | 变更内容 | 变更人 |
| --- | --- | --- | --- |
| 1.0 | {日期} | 初始版本 | {姓名/角色} |

## 审查与批准

| 角色 | 姓名 | 审查日期 | 状态 |
| --- | --- | --- | --- |
| 技术负责人 | {姓名} | {日期} | 待审查 / 已批准 |
| 架构师 | {姓名} | {日期} | 待审查 / 已批准 |
| 安全审查 | {姓名} | {日期} | 待审查 / 已批准 |

---

**重要提示**：任何测试报告和错误详情只能记录资源 ID、URL 规范化结果和密钥版本，不能记录原始 Key、密文或可重放请求。
