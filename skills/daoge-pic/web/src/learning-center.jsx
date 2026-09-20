import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from './components/PageHeader.jsx';
import { Archive, BadgeCheck, BookOpen, Check, CircleAlert, Compass, FileCheck2, FolderKanban, GitFork, ImagePlus, Library, MessageSquare, Monitor, PackageCheck, RefreshCw, Search, ShieldCheck, Sparkles, UserRound, Workflow, X } from 'lucide-react';
import { LEARNING_FILTERS, LEARNING_PHASES, LEARNING_TOPICS } from './learning-center-content.mjs';
import { DOC_GLOSSARY_COPY, DOC_TERM_GLOSSARY } from './doc-face-copy.mjs';

function DocGlossaryPanel() {
  return <details className="learning-glossary" aria-label={DOC_GLOSSARY_COPY.summary}>
    <summary><span><strong>{DOC_GLOSSARY_COPY.summary}</strong><small>{DOC_GLOSSARY_COPY.note}</small></span><em>{DOC_GLOSSARY_COPY.foldLabel}</em></summary>
    <dl className="learning-glossary-list">
      {DOC_TERM_GLOSSARY.map(([term, plain]) => <div key={term}><dt>{term}</dt><dd>{plain}</dd></div>)}
    </dl>
  </details>;
}

const TOPIC_ICONS = { project: FolderKanban, session: Workflow, provider: Sparkles, plan: FileCheck2, check: Check, run: RefreshCw, history: BookOpen, asset: ImagePlus, reference: GitFork, library: Library, delivery: PackageCheck, recovery: Archive, safety: ShieldCheck };
function topicMatches(topic, query) {
  const haystack = [topic.kicker, topic.title, topic.summary, topic.studio, topic.conversation, ...topic.checkpoints].join(' ').toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

export function LearningCenter({ onDismiss, onNavigate }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [activeTopicId, setActiveTopicId] = useState('projects');
  const visibleTopics = useMemo(() => LEARNING_TOPICS.filter((topic) => (filter === 'all' || topic.group === filter) && topicMatches(topic, query)), [filter, query]);
  useEffect(() => {
    if (visibleTopics.length && !visibleTopics.some((topic) => topic.id === activeTopicId)) setActiveTopicId(visibleTopics[0].id);
  }, [visibleTopics, activeTopicId]);
  const activeTopic = visibleTopics.find((topic) => topic.id === activeTopicId) || null;

  return <section className="guide-stage guide-stage-full"><PageHeader kicker="DAOGE Pic 创作手册" title="从提出需求到资产交付" description="按创作动线读：建立项目、提出需求、生成运行、选片评审、资产交付。每个主题都写清「界面上怎么做」和「回对话怎么说」。"><button type="button" className="outline-button" onClick={() => onNavigate('projects')}><FolderKanban size={16} />项目</button><button type="button" className="outline-button" onClick={() => onNavigate('library')}><Library size={16} />规则资料</button><button type="button" className="icon-button" title="标记为已了解" aria-label="标记为已了解" onClick={onDismiss}><BadgeCheck size={17} /></button></PageHeader><DocGlossaryPanel /><div className="learning-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索主题或操作，比如：选片、交付、快捷键" aria-label="搜索学习主题" />{query && <button type="button" className="icon-button" title="清除搜索" aria-label="清除搜索" onClick={() => setQuery('')}><X size={15} /></button>}<span>{visibleTopics.length} 个主题</span></div><nav className="learning-phases" aria-label="创作主线">{LEARNING_PHASES.map((phase) => <button type="button" key={phase.id} className={activeTopicId === phase.id ? 'is-active' : ''} onClick={() => { setFilter('all'); setQuery(''); setActiveTopicId(phase.id); }}><span>{phase.number}</span><b>{phase.label}</b></button>)}</nav><div className="learning-filter-bar" role="group" aria-label="学习主题范围" data-block="page-filter">{LEARNING_FILTERS.map((item) => <button type="button" key={item.id} aria-pressed={filter === item.id} className={filter === item.id ? 'is-active' : ''} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div><div className="learning-workbench"><section className="learning-topic-index" aria-label="学习专题">{visibleTopics.length ? visibleTopics.map((topic) => { const Icon = TOPIC_ICONS[topic.icon]; return <button type="button" key={topic.id} className={topic.id === activeTopic?.id ? 'is-active' : ''} onClick={() => setActiveTopicId(topic.id)}><Icon size={18} strokeWidth={1.65} /><span><small>{topic.kicker}</small><b>{topic.title}</b></span><span className="learning-topic-arrow">›</span></button>; }) : <div className="learning-no-results"><Search size={20} /><p>没有匹配的学习主题</p><button type="button" className="outline-button" onClick={() => { setFilter('all'); setQuery(''); }}>清除筛选</button></div>}</section>{activeTopic && (() => { const Icon = TOPIC_ICONS[activeTopic.icon]; return <article className="learning-topic-detail"><header><div className="learning-topic-symbol"><Icon size={24} strokeWidth={1.45} /></div><div><p className="eyebrow">{activeTopic.kicker}</p><h3>{activeTopic.title}</h3><p>{activeTopic.summary}</p></div></header><div className="learning-responsibilities"><section><span>界面上怎么做</span><p>{activeTopic.studio}</p></section><section><span>回对话怎么说</span><p>{activeTopic.conversation}</p></section></div><section className="learning-checklist"><p className="eyebrow">记住这几条</p><ul>{activeTopic.checkpoints.map((item) => <li key={item}><Check size={15} /><span>{item}</span></li>)}</ul></section>{activeTopic.action && <button type="button" className="command-button learning-topic-action" onClick={() => onNavigate(activeTopic.action)}>{activeTopic.action === 'library' ? <Library size={16} /> : <FolderKanban size={16} />}{activeTopic.actionLabel}</button>}</article>; })()}</div><section className="learning-boundaries" data-region="learning-boundaries"><div><Compass size={18} /><span><b>使用边界</b>对话决定怎么出图，界面呈现结果并承接确认</span></div><div><Monitor size={18} /><span><b>界面</b>建项目、开批次、选片评审、交付与回收都在界面上完成；判定依据是状态与控件，不是文件夹或文件名</span></div><div><MessageSquare size={18} /><span><b>对话</b>计划、核算、出图、恢复与重试由对话发起；界面上的按钮会把请求排给在场 agent</span></div><div><UserRound size={18} /><span><b>你</b>确认计划与核实结果不明只能由你本人完成：未确认不出图，未核实不重放</span></div></section><footer><BookOpen size={16} />创作手册属于整个工作台；打开项目后，任务、批次与结果操作都在项目里。</footer></section>;
}