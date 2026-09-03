export const PROJECT_PAGE_SIZE = 12;
export const TASK_OVERVIEW_PAGE_SIZE = 8;
export const TASK_PAGE_SIZE = 12;

function searchableText(values) {
  return values.map((value) => String(value || '').toLocaleLowerCase('zh-CN')).join('\n');
}

export function createProjectSearchIndex(projects) {
  return projects.map((project) => ({ project, searchable: searchableText([project.name, project.description]) }));
}

export function createTaskSearchIndex(tasks) {
  return tasks.map((task) => ({ task, searchable: searchableText([task.name]) }));
}

export function filterProjectIndex(index, query, status) {
  const needle = String(query || '').trim().toLocaleLowerCase('zh-CN');
  return index.filter(({ project }) => status === 'all' || project.status === status).filter(({ searchable }) => !needle || searchable.includes(needle)).map(({ project }) => project);
}

export function filterTaskIndex(index, query, status) {
  const needle = String(query || '').trim().toLocaleLowerCase('zh-CN');
  return index.filter(({ task }) => {
    if (status === 'open') return !['completed', 'archived'].includes(task.status);
    return status === 'all' || task.status === status;
  }).filter(({ searchable }) => !needle || searchable.includes(needle)).map(({ task }) => task);
}

export function filterProjects(projects, query, status) {
  return filterProjectIndex(createProjectSearchIndex(projects), query, status);
}

export function filterTasks(tasks, query, status) {
  return filterTaskIndex(createTaskSearchIndex(tasks), query, status);
}

export function paginateWorkspaceItems(items, requestedPage, pageSize) {
  const size = Math.max(1, Math.floor(Number(pageSize) || 1));
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(totalPages, Math.max(1, Math.floor(Number(requestedPage) || 1)));
  return { items: items.slice((page - 1) * size, page * size), page, totalPages, total: items.length };
}
