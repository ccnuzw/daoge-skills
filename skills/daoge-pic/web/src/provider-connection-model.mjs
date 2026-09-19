/**
 * provider「配置即测」的判定（方案 7.11.4 · 施工单 P1）。纯函数，可单测。
 *
 * 连接测试现在是「点了才测」。改成保存 / 切换后**自动测一次**——「配完就安心」。
 * 判据是「这次改动会不会影响连接」：身份（profile）变了、版本变了、模型 / 服务商变了、
 * 或密钥被替换过。只是改名之类，不该再打一次网络。
 */
export function profileChangeNeedsTest(previous, next) {
  if (!next) return false;
  if (!previous) return true;
  return previous.profileId !== next.profileId
    || Number(previous.configVersion) !== Number(next.configVersion)
    || previous.providerId !== next.providerId
    || previous.model !== next.model
    || next.secretChanged === true;
}