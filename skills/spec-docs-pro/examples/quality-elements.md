# 质量要素：好与不好的写法

技术栈只是示例。命令按项目实际工具链写（npm / pnpm / pytest / go test / cargo test / mvn 等）。

## 1. AC

不好：

```markdown
#### AC01 注册
用户可以注册成功。
```

问题：没有前置条件和可验证的结果，测试无法据此编写。

好：

```markdown
#### AC02 重复邮箱

Given `User@Example.com` 已注册。

When 使用 ` user@example.com `（首尾空格、大小写不同）再次注册。

Then 返回 409 `email_already_registered`；`users` 表仍只有 1 条该邮箱记录；不创建余额账户。
```

## 2. AC 逐项测试设计

不好：

| AC | 测试命令 | 状态 |
| --- | --- | --- |
| AC01 | npm test | 通过 |

问题：没有测试层级和目标文件；命令跑的是整个仓库；“通过”没有说明在什么环境通过。

好：

| AC | 验收重点 | 测试层级 | 目标资产 | 目标命令 | 证据状态 |
| --- | --- | --- | --- | --- | --- |
| AC01 | 正常注册 | 集成 | `tests/integration/register.test.ts` | `pnpm test -- tests/integration/register.test.ts -t AC01` | 本地通过 |
| AC02 | 重复邮箱规范化 | 集成 | `tests/integration/register.test.ts` | `pnpm test -- tests/integration/register.test.ts -t AC02` | 本地通过 |
| AC03 | 余额账户失败回滚 | 集成（故障注入） | `tests/integration/register.test.ts` | `pnpm test -- tests/integration/register.test.ts -t AC03` | 已创建 |
| AC04 | 并发注册同一邮箱 | 集成（并发） | `tests/integration/register-concurrency.test.ts` | `pnpm test -- register-concurrency` | 未创建 |

## 3. 分支 ID 与追踪

伪代码：

```text
FUNCTION register(email, password):
  email = normalize(email)                                   // B01-01
  IF NOT strong(password): RETURN Err(weak_password)         // B01-02
  BEGIN TRANSACTION
    INSERT users ... ON CONFLICT(email) → RETURN Err(email_already_registered)   // B01-03
    INSERT balances(user_id, 0)                              // B01-04
  COMMIT OR ROLLBACK BOTH                                    // B01-05
```

追踪表（每个分支 ID 都出现，指向具体 AC）：

| 分支 | 功能 AC | 跨功能验收 |
| --- | --- | --- |
| B01-01 | AC02 | - |
| B01-02 | AC05 | - |
| B01-03 | AC02、AC04 | - |
| B01-04～05 | AC01、AC03 | `V1-E2E-01` |

## 4. 验证记录

不好：

> 2026-10-26 测试通过。

好：

> #### 2026-10-26 后端集成测试（本地）
>
> `DATABASE_URL=postgres://test:***@127.0.0.1:5432/app_test pnpm test -- tests/integration/register.test.ts`：3/3 通过。覆盖 AC01 正常注册、AC02 重复邮箱规范化、AC03 回滚（故障注入使余额插入失败）。AC04 并发测试未创建；前端交互与 V1-E2E-01 待补。本记录为本地证据，不构成预发或生产验证。

要点：完整命令（密钥打码）、N/M、覆盖了哪些 AC、遗留工作、证据级别。

## 5. 不适用

不好：删掉“状态与生命周期”章节。

好：

```markdown
### 状态与生命周期

不适用：注册只创建 active 用户，本功能不涉及状态流转；禁用与删除见 V1-FR-025。
```
