export const STUDIO_NAVIGATION_VIEWS = Object.freeze(['projects']);
export const PROJECT_NAVIGATION_VIEWS = Object.freeze(['lineage', 'assets', 'runs', 'deliveries']);

export function workbenchNavigationViews(hasProject) {
  return hasProject ? [...STUDIO_NAVIGATION_VIEWS, ...PROJECT_NAVIGATION_VIEWS] : [...STUDIO_NAVIGATION_VIEWS];
}
