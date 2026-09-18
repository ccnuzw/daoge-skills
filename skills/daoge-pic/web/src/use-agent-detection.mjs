import { useCallback, useRef, useState } from 'react';

/**
 * C1 侦查的读取（方案 4.6-1）。
 *
 * 「侦查」是**自动但不打扰**：扫宿主目录有代价，所以不在页面加载时扫，
 * 只在连接面板展开（调用方 `detect()`）时取一次；已经有结果就不重复打盘。
 */
export function useAgentDetection({ api, reportError }) {
  const [detection, setDetection] = useState(null);
  const [loading, setLoading] = useState(false);
  const epoch = useRef(0);

  const detect = useCallback(async (force = false) => {
    if (!force && (detection || loading)) return;
    const current = ++epoch.current;
    setLoading(true);
    try {
      const data = await api('/api/agents/detect');
      if (epoch.current === current) setDetection(data);
    } catch (error) {
      if (epoch.current === current) reportError(error, '无法读取 agent 侦查结果。', { operation: 'detect-agents', phase: 'loading' });
    } finally {
      if (epoch.current === current) setLoading(false);
    }
  }, [api, detection, loading, reportError]);

  return { detection, loading, detect };
}