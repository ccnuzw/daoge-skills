import { useEffect, useRef, useState } from 'react';
import { createStudioSearchCoordinator } from './studio-search-model.mjs';

const EMPTY = Object.freeze([]);

/**
 * Studio 的全局搜索：管查询词、结果、loading 与错误，以及「打开某条结果」时的路由跳转。
 *
 * 单独拆出来的原因不是它复杂，而是它**自成一体**：只依赖一个请求函数和「跳转到哪」，
 * 与工作台其余状态没有往来。把这类边界清楚的切片先搬走，main.jsx 里剩下的
 * 纠缠部分才看得清。
 *
 * @param {object} input
 * @param {(path: string, options?: object) => Promise<any>} input.api
 * @param {(changes: object) => void} input.navigateRoute 打开结果后跳转用
 */
export function useStudioSearch({ api, navigateRoute }) {
  const searchCoordinatorRef = useRef(null);
  searchCoordinatorRef.current ||= createStudioSearchCoordinator({
    request: async (query, signal) => (await api('/api/search?q=' + encodeURIComponent(query) + '&limit=12', { signal })).results || [],
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancelSchedule: (timer) => window.clearTimeout(timer)
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(EMPTY);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  useEffect(() => {
    searchCoordinatorRef.current.search(searchQuery, (state) => {
      setSearchResults(state.results);
      setSearchError(state.error);
      setSearchLoading(state.loading);
    });
    return () => searchCoordinatorRef.current.cancel();
  }, [searchQuery]);
  useEffect(() => () => searchCoordinatorRef.current.dispose(), []);
  const openSearchResult = (result) => {
    // 图与批次都落在它所属的批次上下文里（图的「批次」来自后端解析的 roundId）：
    // 搜到一张图 = 跳到产出它的那一批，人就地能看见它。
    const focusedRoundId = result.entityType === 'round' ? result.entityId : result.entityType === 'asset' ? result.roundId || null : null;
    const changes = result.entityType === 'project'
      ? { view: 'lineage', projectId: result.projectId, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' }
      : { view: 'lineage', projectId: result.projectId, taskId: result.taskId, roundId: focusedRoundId, compareRoundIds: focusedRoundId ? [focusedRoundId] : [], runId: null, assetScope: focusedRoundId ? 'round' : 'task' };
    setSearchResults(EMPTY);
    setSearchQuery('');
    navigateRoute(changes);
  };
  return { searchQuery, setSearchQuery, searchResults, searchLoading, searchError, openSearchResult };
}
