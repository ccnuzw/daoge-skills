import { useEffect, useMemo, useState } from 'react';
import { BookOpen, FolderKanban, Library, Palette, Search, Tag, X } from 'lucide-react';
import { creativeLibraryResources, filterCreativeLibraryResources } from './creative-library-model.mjs';

const FILTERS = [
  { id: 'all', label: '全部资料' },
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

export function CreativeLibrary({ taskTypes, styleKits, brandKits, sharedAssets, onOpenProjects, onOpenSharedAssets }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(null);
  const resources = useMemo(() => creativeLibraryResources({ taskTypes, styleKits, brandKits, assets: [] }), [taskTypes, styleKits, brandKits]);
  const visible = useMemo(() => filterCreativeLibraryResources(resources, { kind: filter, query }), [resources, filter, query]);
  useEffect(() => { if (visible.length && !visible.some((item) => item.id === activeId)) setActiveId(visible[0].id); }, [visible, activeId]);
  const active = visible.find((item) => item.id === activeId) || null;
  const linked = active?.assetIds?.map((id) => sharedAssets.find((asset) => asset.id === id)).filter(Boolean) || [];
  const counts = { task: taskTypes.length, style: styleKits.length, brand: brandKits.length };
  return <section className="creative-library"><header className="library-masthead"><div><p className="eyebrow">Studio 创作资料库</p><h2>沉淀创作方法，不混入项目图片</h2><p>这里保留可复用的任务结构、风格规则和品牌规则。每个项目的生成结果与参考图只在项目资产中管理。</p></div><div className="library-masthead-actions"><button type="button" className="outline-button" onClick={onOpenProjects}><FolderKanban size={16} />查看项目</button><button type="button" className="command-button" onClick={onOpenSharedAssets}><Library size={16} />查看共享素材</button></div></header><section className="library-metrics is-three" aria-label="创作资料统计"><div><span>任务类型</span><b>{counts.task}</b><small>明确创作字段</small></div><div><span>风格包</span><b>{counts.style}</b><small>可复用视觉规则</small></div><div><span>品牌包</span><b>{counts.brand}</b><small>可复用品牌规则</small></div></section><div className="library-boundary library-boundary-top"><div><Library size={18} /><span>项目图片不出现在这里。需要跨项目使用的图片，必须从项目资产明确共享。</span></div><div><BookOpen size={18} /><span>资料库不自动改变已确认计划，也不会触发生成。</span></div></div><div className="library-toolbar"><div className="library-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索创作资料库" placeholder="搜索任务类型、风格或品牌规则" />{query && <button type="button" className="icon-button" title="清除搜索" aria-label="清除搜索" onClick={() => setQuery('')}><X size={15} /></button>}</div><div className="library-filters" role="group" aria-label="资料类型">{FILTERS.map((item) => <button type="button" aria-pressed={filter === item.id} className={filter === item.id ? 'is-active' : ''} key={item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div><span className="library-resource-count">{visible.length} 项结果</span></div><div className="library-workbench"><section className="library-resource-index" aria-label="创作资料">{visible.length ? visible.map((resource) => { const Icon = META[resource.kind].Icon; return <button type="button" className={resource.id === active?.id ? 'is-active' : ''} key={resource.id} onClick={() => setActiveId(resource.id)}><Icon size={18} strokeWidth={1.55} /><span><small>{resource.source}</small><b>{resource.title}</b><em>{resource.summary}</em></span><span className="library-resource-arrow">›</span></button>; }) : <div className="library-no-results"><Search size={20} /><p>没有匹配的创作资料</p><button type="button" className="outline-button" onClick={() => { setFilter('all'); setQuery(''); }}>清除筛选</button></div>}</section>{active && <article className="library-resource-detail"><header><div className={'library-resource-symbol ' + active.kind}>{(() => { const Icon = META[active.kind].Icon; return <Icon size={23} strokeWidth={1.55} />; })()}</div><div><p className="eyebrow">{active.source}</p><h3>{active.title}</h3><p>{active.summary}</p></div></header><section className="library-definition"><p className="eyebrow">资料内容</p>{definitionEntries(active.definition).length ? <dl>{definitionEntries(active.definition).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl> : <p>此资料尚未记录结构化字段。</p>}</section>{['style', 'brand'].includes(active.kind) && <section className="library-linked-assets"><header><div><p className="eyebrow">共享参考素材</p><span>{linked.length} 张已明确共享的素材</span></div></header>{linked.length ? <div>{linked.map((asset) => <figure key={asset.id}><img src={'/api/assets/' + encodeURIComponent(asset.id) + '/file'} alt="" /><figcaption>共享素材</figcaption></figure>)}</div> : <p>项目图片不会显示在资料库中。需要跨项目引用时，先在项目资产中明确共享。</p>}</section>}<footer><BookOpen size={16} /><span>{active.kind === 'task' ? '任务类型帮助会话建立任务时澄清创作目标与字段。' : '资料不会自动写入任务、轮次、计划或生成请求。'}</span></footer></article>}</div></section>;
}
