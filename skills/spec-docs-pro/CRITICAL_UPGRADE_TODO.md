# Spec-Docs-Pro 关键升级任务

## 立即执行（已识别但未完成）

### 1. 模板深度不足
- [ ] `feature-main.md` 缺少 AC 逐项测试设计表
- [ ] `feature-main.md` 缺少详细的验证记录格式
- [ ] `technical-design.md` 伪代码缺少分支 ID 标注
- [ ] `technical-design.md` 缺少分支到测试追踪表

### 2. 指令精度不足
- [ ] `instructions.md` 没有要求生成 AC 逐项测试设计
- [ ] `instructions.md` 没有要求在伪代码中标注分支 ID
- [ ] `instructions.md` 没有要求创建分支到测试追踪表
- [ ] `instructions.md` 缺少验证记录的详细规范

### 3. 缺少关键模板
- [ ] 缺少 `e2e-spec.md` 模板（E2E 场景规范）
- [ ] 缺少 `validation-checklist.md`（质量检查清单）
- [ ] 缺少 `interface-contract.md`（接口契约公共基线）
- [ ] 缺少 `data-model.md`（数据模型公共基线）

### 4. 示例不足
- [ ] `usage-examples.md` 缺少实际生成文档的完整示例
- [ ] 没有展示 AC 逐项测试设计的示例
- [ ] 没有展示分支追踪的示例
- [ ] 没有展示验证记录的示例

## 当前问题总结

**症状**：Skill 提供了框架，但生成的文档缺少关键细节

**根本原因**：
1. 模板过于抽象，缺少具体格式要求
2. 指令没有强制要求这些关键元素
3. 缺少完整的填充示例
4. 没有质量检查机制

**影响**：用户使用 Skill 后仍然无法生成与样例同等质量的文档

## 升级优先级

### P0 - 必须立即修复
1. 更新 `feature-main.md` 添加 AC 逐项测试设计
2. 更新 `technical-design.md` 添加分支追踪
3. 更新 `instructions.md` 强制要求这些元素
4. 添加详细填充示例

### P1 - 尽快完成
5. 创建 `e2e-spec.md` 模板
6. 创建 `validation-checklist.md`
7. 增强 `usage-examples.md`

### P2 - 后续增强
8. 创建公共基线模板
9. 添加文档浏览器的搜索功能增强
10. 创建自动化检查脚本

## 执行计划

**第一阶段**（立即执行）：
- 深度更新现有 2 个核心模板
- 重写 instructions.md 的关键部分
- 添加真实示例

**第二阶段**（后续）：
- 创建缺失的模板
- 完善工具脚本
- 添加质量检查

**预期结果**：
用户使用升级后的 Skill，能够生成包含：
- AC 逐项测试设计表
- 带分支 ID 的伪代码
- 分支到测试追踪表
- 详细的验证记录
- 完整的 E2E 规范

的高质量文档。
