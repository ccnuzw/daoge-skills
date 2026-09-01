export const STUDIO_NAVIGATION_VIEWS = Object.freeze(['projects', 'library', 'shared-assets', 'guide']);
export const PROJECT_NAVIGATION_VIEWS = Object.freeze(['project-overview', 'tasks', 'assets', 'deliveries', 'trash']);

export function workbenchNavigationViews(hasProject) {
  return hasProject ? [...STUDIO_NAVIGATION_VIEWS, ...PROJECT_NAVIGATION_VIEWS] : [...STUDIO_NAVIGATION_VIEWS];
}
