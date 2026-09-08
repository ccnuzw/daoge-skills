export const STUDIO_NAVIGATION_VIEWS = Object.freeze(['projects', 'guide']);
export const PROJECT_NAVIGATION_VIEWS = Object.freeze(['project-overview', 'lineage', 'tasks', 'runs', 'assets', 'deliveries', 'trash']);

export function workbenchNavigationViews(hasProject) {
  return hasProject ? [...STUDIO_NAVIGATION_VIEWS, ...PROJECT_NAVIGATION_VIEWS] : [...STUDIO_NAVIGATION_VIEWS];
}
