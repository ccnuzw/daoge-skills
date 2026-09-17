// 全站唯一一句「到这一步为止，出图了吗？花钱了吗？」。
//
// 为什么单独成模块：这句话此前在 8 个地方各写了一遍，而且越写越长——原版一句话里塞了
// 6 个工程词（Studio 事实源 / 草稿上下文 / Provider / Agent / 预检 / Generation Run），
// 用户要读 8 次才知道自己在哪一步。没有单一来源就必然再次漂移，所以：
//   - 草稿阶段（新建项目/任务/批次、选参考、评审不采用、创作动作面板）一律复用这一句；
//   - 需要追加本步独有的动作提示时，用 DRAFT_BOUNDARY_COPY + '尾巴' 拼接，不要另写整句；
//   - 唯一讲清「确认之后会怎样」的长句在 main.jsx 的 confirmationPlanSummary，只在确认出图弹窗出现。
// 守卫测试 tests/vnext/terminology-guard.test.js 会拦住手写副本。
export const DRAFT_BOUNDARY_COPY = '这一步只记草稿，不出图，也不产生费用。';
