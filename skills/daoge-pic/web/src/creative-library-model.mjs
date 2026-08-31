function text(value) { return typeof value === 'string' ? value.trim() : ''; }

function description(definition = {}) {
  return text(definition.summary) || text(definition.description) || '尚未补充说明。';
}

export function assetLabel(asset = {}) {
  return text(asset.display?.label) || (asset.kind === 'generated' ? '生成结果' : '导入素材');
}

export function creativeLibraryResources({ taskTypes = [], styleKits = [], brandKits = [], assets = [] } = {}) {
  return [
    ...taskTypes.map((item) => ({ id: 'task:' + item.id, resourceId: item.id, kind: 'task', title: item.name, source: item.source === 'official' ? '官方任务类型' : '自定义任务类型', summary: description(item.definition), definition: item.definition || {}, assetIds: [] })),
    ...styleKits.map((item) => ({ id: 'style:' + item.id, resourceId: item.id, kind: 'style', title: item.name, source: '风格包', summary: description(item.definition), definition: item.definition || {}, assetIds: item.assetIds || [] })),
    ...brandKits.map((item) => ({ id: 'brand:' + item.id, resourceId: item.id, kind: 'brand', title: item.name, source: '品牌包', summary: description(item.definition), definition: item.definition || {}, assetIds: item.assetIds || [] })),
    ...assets.filter((asset) => !asset.deletedAt).map((item) => ({ id: 'asset:' + item.id, resourceId: item.id, kind: 'asset', title: assetLabel(item), source: item.kind === 'generated' ? '生成素材' : '导入素材', summary: item.display?.taskName ? item.display.taskName + ' · ' + (item.display.roundPurpose || '创作') : '可作为风格或品牌参考的 Studio 素材。', definition: {}, assetIds: [] }))
  ];
}

export function filterCreativeLibraryResources(resources = [], { kind = 'all', query = '' } = {}) {
  const normalizedQuery = text(query).toLowerCase();
  return resources.filter((resource) => {
    if (kind !== 'all' && resource.kind !== kind) return false;
    if (!normalizedQuery) return true;
    return [resource.title, resource.source, resource.summary, ...Object.keys(resource.definition || {}), ...(Array.isArray(resource.definition?.fields) ? resource.definition.fields : [])].join(' ').toLowerCase().includes(normalizedQuery);
  });
}
