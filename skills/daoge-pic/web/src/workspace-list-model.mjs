export const PROJECT_PAGE_SIZE = 12;
export const TASK_OVERVIEW_PAGE_SIZE = 8;
export const TASK_PAGE_SIZE = 12;


export function filterProjects(projects, query, status) {
  const needle = String(query || '').trim().toLocaleLowerCase('zh-CN');
  return projects.filter((project) => {
    if (status !== 'all' && project.status !== status) return false;
    return !needle || [project.name, project.description].some((value) => String(value || '').toLocaleLowerCase('zh-CN').includes(needle));
  });
}

export function filterTasks(tasks, query, status) {
  const needle = String(query || '').trim().toLocaleLowerCase('zh-CN');
  return tasks.filter((task) => {
    if (status === 'open' && ['completed', 'archived'].includes(task.status)) return false;
    if (status !== 'all' && status !== 'open' && task.status !== status) return false;
    return !needle || String(task.name || '').toLocaleLowerCase('zh-CN').includes(needle);
  });
}

export function paginateWorkspaceItems(items, requestedPage, pageSize) {
  const size = Math.max(1, Math.floor(Number(pageSize) || 1));
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(totalPages, Math.max(1, Math.floor(Number(requestedPage) || 1)));
  return { items: items.slice((page - 1) * size, page * size), page, totalPages, total: items.length };
}
