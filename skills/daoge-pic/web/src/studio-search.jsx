import { useEffect, useId, useState } from 'react';
import { Search } from 'lucide-react';
import { searchKeyAction } from './studio-search-model.mjs';
import { purposeLabel } from './purpose-labels.mjs';
import { statusPresentation } from './status-presentation.mjs';

// 搜索结果里的实体类型说人话；图是主角，必须能搜到也能认出来（方案 7.8.1）。
const RESULT_TYPE_LABELS = { project: '项目', task: '任务', round: '批次', asset: '图' };

// 副标题优先说状态人话（复用既有状态展示表，不再让 awaiting_confirmation 之类的枚举裸奔），
// 没有状态可说时退回批次目的人话；两者都取不到就不渲染。
function resultSubtitle(result) {
  if (result.status) return statusPresentation(result.entityType, result.status).label;
  return purposeLabel(result.purpose) || '';
}

export function StudioSearch({ query, results, loading, error, onQueryChange, onOpenResult }) {
  const listId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);
  useEffect(() => setActiveIndex(results.length ? 0 : -1), [results]);
  const expanded = Boolean(query.trim());
  const commit = (result) => {
    if (!result) return;
    setActiveIndex(-1);
    onOpenResult(result);
  };
  const onKeyDown = (event) => {
    const next = searchKeyAction(activeIndex, event.key, results.length);
    if (next.preventDefault) event.preventDefault();
    if (next.action === 'navigate') setActiveIndex(next.index);
    else if (next.action === 'commit') commit(results[next.index]);
    else if (next.action === 'clear') onQueryChange('');
  };
  return <div className="studio-search"><Search size={15} /><input role="combobox" aria-label="搜索 Studio" aria-autocomplete="list" aria-expanded={expanded} aria-controls={listId} aria-activedescendant={activeIndex >= 0 ? listId + '-option-' + activeIndex : undefined} value={query} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={onKeyDown} placeholder="搜索项目、任务、批次或图片" />{expanded && <div className="search-results" id={listId} role="listbox" aria-label="Studio 搜索结果">{loading ? <div className="search-feedback" role="status">正在搜索</div> : error ? <div className="search-feedback is-error" role="alert">{error}</div> : results.length ? results.map((result, index) => <button type="button" role="option" aria-selected={index === activeIndex} id={listId + '-option-' + index} className={index === activeIndex ? 'is-active' : ''} key={result.entityType + result.entityId} onMouseEnter={() => setActiveIndex(index)} onClick={() => commit(result)}><span>{RESULT_TYPE_LABELS[result.entityType] || ''}</span><b>{result.label}</b><small>{resultSubtitle(result)}</small></button>) : <div className="search-feedback" role="status">没有匹配结果，请尝试项目名、任务名、批次或图片描述。</div>}</div>}</div>;
}
