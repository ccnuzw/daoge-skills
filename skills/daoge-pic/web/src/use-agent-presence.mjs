import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Agent 在场的读取（方案 4.6）。
 *
 * 在场是**时间**的函数，不是事件的函数：agent 可能在没有任何事件的情况下变离线。
 * 所以除了随事件重取，还按固定间隔重取一次——否则状态卡会一直停在「刚才还在」。
 */
export function useAgentPresence({ api, eventRevision, reportError, pollMs = 30000 }) {
  const [presence, setPresence] = useState(null);
  const gate = useRef(null);
  gate.current ||= { epoch: 0 };

  const refresh = useCallback(async () => {
    const epoch = ++gate.current.epoch;
    try {
      const data = await api('/api/agents');
      if (gate.current.epoch === epoch) setPresence(data);
    } catch (error) {
      if (gate.current.epoch === epoch) reportError(error, '无法读取 agent 在场状态。', { operation: 'load-agent-presence', phase: 'loading' });
    }
  }, [api, reportError]);

  useEffect(() => { void refresh(); }, [refresh, eventRevision]);
  useEffect(() => {
    if (!Number.isFinite(pollMs) || pollMs <= 0) return undefined;
    const timer = window.setInterval(() => { void refresh(); }, pollMs);
    return () => window.clearInterval(timer);
  }, [refresh, pollMs]);
  return { presence, refresh };
}
