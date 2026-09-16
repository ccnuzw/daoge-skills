import { useCallback, useEffect, useRef, useState } from 'react';
import { createLatestRequestGate } from './use-route-refresh.mjs';
import { isAbortError, normalizeRequestError } from './error-model.mjs';

/**
 * 项目总览页的「质量指标」。
 *
 * 只在 project-overview 视图且已选中项目时才拉数据，切走就立刻取消并清空 ——
 * 免得离开页面后仍在写已经不存在的状态。
 *
 * @param {object} input
 * @param {(path: string, options?: object) => Promise<any>} input.api
 * @param {string|null} input.projectId 当前选中的项目
 * @param {string} input.view 当前视图
 */
export function useProjectQualityMetrics({ api, projectId, view }) {
  const qualityMetricsRequests = useRef(null);
  qualityMetricsRequests.current ||= createLatestRequestGate();
  const [qualityMetrics, setQualityMetrics] = useState(null);
  const [qualityMetricsLoading, setQualityMetricsLoading] = useState(false);
  const [qualityMetricsError, setQualityMetricsError] = useState(null);
  const refreshQualityMetrics = useCallback(async () => {
    if (!projectId) {
      qualityMetricsRequests.current.cancel();
      setQualityMetrics(null);
      setQualityMetricsError(null);
      setQualityMetricsLoading(false);
      return false;
    }
    const request = qualityMetricsRequests.current.begin(projectId);
    setQualityMetricsLoading(true);
    setQualityMetricsError(null);
    setQualityMetrics(null);
    try {
      const data = await api('/api/projects/' + encodeURIComponent(projectId) + '/quality-metrics', { signal: request.signal });
      if (!request.isCurrent()) return false;
      setQualityMetrics(data.metrics || null);
      return true;
    } catch (nextError) {
      if (isAbortError(nextError) || !request.isCurrent()) return false;
      setQualityMetricsError(normalizeRequestError(nextError, '无法读取项目质量指标。', { operation: 'load-quality-metrics', phase: 'loading' }));
      return false;
    } finally {
      if (request.isCurrent()) setQualityMetricsLoading(false);
    }
  }, [projectId]);
  useEffect(() => {
    if (view !== 'project-overview' || !projectId) {
      qualityMetricsRequests.current.cancel();
      setQualityMetrics(null);
      setQualityMetricsError(null);
      setQualityMetricsLoading(false);
      return undefined;
    }
    void refreshQualityMetrics();
    return () => qualityMetricsRequests.current.cancel();
  }, [refreshQualityMetrics, projectId, view]);
  useEffect(() => () => qualityMetricsRequests.current?.cancel(), []);
  return { qualityMetrics, qualityMetricsLoading, qualityMetricsError, refreshQualityMetrics };
}
