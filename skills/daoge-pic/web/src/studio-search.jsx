import { useEffect, useId, useState } from 'react';
import { Search } from 'lucide-react';
import { searchKeyAction } from './studio-search-model.mjs';

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
  return <div className="studio-search"><Search size={15} /><input role="combobox" aria-label="搜索 Studio" aria-autocomplete="list" aria-expanded={expanded} aria-controls={listId} aria-activedescendant={activeIndex >= 0 ? listId + '-option-' + activeIndex : undefined} value={query} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={onKeyDown} placeholder="搜索项目、任务或轮次" />{expanded && <div className="search-results" id={listId} role="listbox" aria-label="Studio 搜索结果">{loading ? <div className="search-feedback" role="status">正在搜索</div> : error ? <div className="search-feedback is-error" role="alert">{error}</div> : results.length ? results.map((result, index) => <button type="button" role="option" aria-selected={index === activeIndex} id={listId + '-option-' + index} className={index === activeIndex ? 'is-active' : ''} key={result.entityType + result.entityId} onMouseEnter={() => setActiveIndex(index)} onClick={() => commit(result)}><span>{result.entityType === 'project' ? '项目' : result.entityType === 'task' ? '任务' : '轮次'}</span><b>{result.label}</b><small>{result.status || result.purpose || ''}</small></button>) : <div className="search-feedback" role="status">没有匹配结果，请尝试项目名、任务名或轮次用途。</div>}</div>}</div>;
}
