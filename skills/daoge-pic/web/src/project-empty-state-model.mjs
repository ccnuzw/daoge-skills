// 项目列表空态的**三形态**（方案 4.7）。
//
// 方案点名的那个错：三种场景（全新用户 / 搜索无果 / 筛选无果）**共用了一句
// 「还没有匹配项目。」**—— 那是搜索无结果的说法，全新用户第一次打开会以为是自己操作错了。
//
// 判定的**优先级**也是方案的一半：**先分「有没有项目」这个大前提**，
// 才轮到「搜不到 / 筛不到」。全新用户哪怕带着默认筛选，也必须看到「建第一个项目」。

/**
 * @param {{ hasAnyProject?: boolean, hasQuery?: boolean, hasStatusFilter?: boolean }} input
 * @returns {{ kind: 'first-run'|'no-search-match'|'no-filter-match'|'generic', title: string, body: string, cta?: string }}
 */
export function projectEmptyState({ hasAnyProject = false, hasQuery = false, hasStatusFilter = false } = {}) {
  // ① 全新用户优先于一切 —— 他连容器都没有，搜索与筛选都是不存在的语境。
  if (!hasAnyProject) {
    return {
      kind: 'first-run',
      title: '这里还没有项目',
      body: '先建一个，把要出的图放进去。它也是后面每一批图的归处。',
      // 首运行唯一的行动入口就在眼前 —— 不用去找「新建」按钮在哪。
      cta: '新建项目'
    };
  }
  // ② 有项目但搜不到：给「换个词」，不推新建。
  if (hasQuery) {
    return {
      kind: 'no-search-match',
      title: '没有匹配的项目',
      body: '换个词再搜一次，或者清掉搜索词看全部。'
    };
  }
  // ③ 有项目但筛不到：给「清筛选」。
  if (hasStatusFilter) {
    return {
      kind: 'no-filter-match',
      title: '当前筛选下没有项目',
      body: '清掉筛选，看看全部项目。'
    };
  }
  // 兜底（有项目、无搜索、无筛选却列表为空——理论上不该发生）：按首运行处理，多给一个入口无害。
  return {
    kind: 'generic',
    title: '这里还没有项目',
    body: '先建一个，把要出的图放进去。',
    cta: '新建项目'
  };
}
