import { useEffect, useMemo, useState } from 'react';
import { BookOpen, FolderKanban, Library, Palette, Search, Tag, X } from 'lucide-react';
import { creativeLibraryResources, filterCreativeLibraryResources } from './creative-library-model.mjs';

const FILTERS = [
  { id: 'all', label: '全部规则' },
  { id: 'task', label: '任务类型' },
  { id: 'style', label: '风格包' },
  { id: 'brand', label: '品牌包' }
];

const META = {
  task: { Icon: FolderKanban, label: '任务类型' },
  style: { Icon: Palette, label: '风格包' },
  brand: { Icon: Tag, label: '品牌包' }
};

function definitionEntries(definition = {}) {
  const hidden = /(api[_-]?key|authorization|secret|token|base[_-]?url|endpoint|password|storage.*path|content.*hash)/i;
  const labels = { summary: '说明', description: '说明', fields: '建议字段', constraints: '约束', palette: '色彩', audience: '受众' };
  return Object.entries(definition).filter(([key]) => !hidden.test(key)).map(([key, value]) => [labels[key] || key.replaceAll('_', ' '), Array.isArray(value) ? value.join(' · ') : ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '已配置内容']);
}

function ResourceIcon({ kind, size = 17 }) {
  const Icon = META[kind]?.Icon || BookOpen;
  return <Icon size={size} strokeWidth={1.7} />;
}

export function CreativeLibrary({ taskTypes, styleKits, brandKits, sharedAssets, onOpenProjects, onOpenSharedAssets }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(null);
  const resources = useMemo(() => creativeLibraryResources({ taskTypes, styleKits, brandKits, assets: [] }), [taskTypes, styleKits, brandKits]);
  const visible = useMemo(() => filterCreativeLibraryResources(resources, { kind: filter, query }), [resources, filter, query]);

  useEffect(() => {
    if (visible.length && !visible.some((item) => item.id === activeId)) setActiveId(visible[0].id);
  }, [visible, activeId]);

  const active = visible.find((item) => item.id === activeId) || null;
  const linked = active?.assetIds?.map((id) => sharedAssets.find((asset) => asset.id === id)).filter(Boolean) || [];
  const counts = { task: taskTypes.length, style: styleKits.length, brand: brandKits.length };

  return <section className="creative-library">
    <header className="library-masthead">
      <div>
        <p className="eyebrow">规则资料</p>
        <h2>任务类型 / 风格包 / 品牌包</h2>
        <p>这里只管理规则定义。共享图片在单独“共享素材”标签里查看，不和规则资料混放。</p>
      </div>
      <div className="library-masthead-actions">
        <button type="button" className="outline-button" onClick={onOpenProjects}><FolderKanban size={16} />项目</button>
        <button type="button" className="command-button" onClick={onOpenSharedAssets}><Library size={16} />共享素材</button>
      </div>
    </header>

    <section className="library-metrics is-three" aria-label="创作资料统计">
      <div><span>任务类型</span><b>{counts.task}</b></div>
      <div><span>风格包</span><b>{counts.style}</b></div>
      <div><span>品牌包</span><b>{counts.brand}</b></div>
    </section>

    <details className="library-boundary library-boundary-top">
      <summary><BookOpen size={16} />规则资料说明</summary>
      <div><Library size={18} /><span>项目图片不出现在这里。需要跨项目使用的图片，必须从项目资产明确共享。</span></div>
      <div><BookOpen size={18} /><span>规则资料不自动绑定任务、改写已确认计划或触发生成；使用前仍要回到会话形成计划快照。</span></div>
    </details>

    <div className="library-toolbar">
      <div className="library-search">
        <Search size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索规则资料" placeholder="搜索任务类型、风格或品牌规则" />
        {query && <button type="button" className="icon-button" title="清除搜索" aria-label="清除搜索" onClick={() => setQuery('')}><X size={15} /></button>}
      </div>
      <div className="library-filters" role="group" aria-label="规则资料类型">
        {FILTERS.map((item) => <button type="button" aria-pressed={filter === item.id} className={filter === item.id ? 'is-active' : ''} key={item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}
      </div>
      <span className="library-resource-count">{visible.length} 项</span>
    </div>

    <div className="library-workbench">
      <section className="library-resource-index" aria-label="规则资料">
        {visible.length ? visible.map((resource) => <button type="button" className={resource.id === active?.id ? 'is-active' : ''} key={resource.id} onClick={() => setActiveId(resource.id)}>
          <ResourceIcon kind={resource.kind} />
          <span><b>{resource.title}</b><small>{META[resource.kind].label} · {resource.source}</small></span>
        </button>) : <div className="library-empty"><BookOpen size={24} /><p>没有符合条件的规则资料。</p></div>}
      </section>

      {active ? <article className="library-resource-detail">
        <header>
          <div className="library-resource-symbol"><ResourceIcon kind={active.kind} size={22} /></div>
          <div><p className="eyebrow">{META[active.kind].label}</p><h3>{active.title}</h3><span>{active.source}</span></div>
        </header>
        <p>{active.summary}</p>
        <section className="library-definition"><h4>可见配置</h4><dl>{definitionEntries(active.definition).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></section>
        {linked.length ? <section className="library-linked-assets"><h4>已绑定共享素材</h4><div>{linked.map((asset) => <figure key={asset.id}><img src={asset.thumbnailUrl || ''} alt="" /><figcaption>{asset.display?.label || asset.id}</figcaption></figure>)}</div></section> : null}
      </article> : <article className="library-resource-detail is-empty"><BookOpen size={26} /><h3>选择一项规则资料</h3><p>查看可复用的任务、风格或品牌规则。</p></article>}
    </div>
  </section>;
}
