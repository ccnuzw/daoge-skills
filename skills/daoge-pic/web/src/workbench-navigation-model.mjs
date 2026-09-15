export const STUDIO_NAVIGATION_VIEWS = Object.freeze(['projects']);
// 「生成历史」(runs) 不进一级入口：它只在任务内联页签里出现。
export const PROJECT_NAVIGATION_VIEWS = Object.freeze(['lineage', 'assets', 'deliveries']);

export function workbenchNavigationViews(hasProject) {
  return hasProject ? [...STUDIO_NAVIGATION_VIEWS, ...PROJECT_NAVIGATION_VIEWS] : [...STUDIO_NAVIGATION_VIEWS];
}
