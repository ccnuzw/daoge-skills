/**
 * 就地创建的路由（方案 4.3「画布外 / 创建」· 施工单 G2）。纯函数，可单测。
 *
 * 「建任务不该是离开画布的理由」：建完结构必须**留在画布**，且新建的那个实体成为焦点。
 * 之前「为此任务新建批次」会先 `onNavigate(route)` 跳到提示词视图，再弹创建框——
 * 人建完就被带离了画布。
 *
 * 只支持 task / round：别的 kind 若是悄悄跳走，比报错更糟。
 */
const IN_PLACE_KINDS = Object.freeze(['task', 'round']);

/**
 * @param {{ kind?: string, id?: string, taskId?: string | null, roundId?: string | null, view?: string, [key: string]: unknown }} [route]
 */
export function inPlaceCreationRoute(route = {}) {
  const kind = route.kind;
  if (!IN_PLACE_KINDS.includes(kind)) throw new Error('就地创建只支持 task / round，收到：' + String(kind));
  const next = { ...route, view: 'lineage' };
  delete next.kind;
  delete next.id;
  if (kind === 'task') return { ...next, taskId: route.id ?? next.taskId ?? null, roundId: null };
  return { ...next, roundId: route.id ?? next.roundId ?? null };
}