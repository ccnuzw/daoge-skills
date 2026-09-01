export async function bootstrapLocalStudioSession(options = {}) {
  const location = options.location || window.location;
  const history = options.history || window.history;
  const fetchImpl = options.fetchImpl || window.fetch.bind(window);
  const fragment = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
  const capability = fragment.get('capability');
  if (!capability) return false;

  let response;
  try {
    response = await fetchImpl('/api/auth/bootstrap', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ capability })
    });
  } catch {
    throw new Error('无法连接到本地 Studio，授权尚未完成。请重试。');
  }

  let payload;
  try {
    if (!response || typeof response.json !== 'function') throw new Error('invalid response');
    payload = await response.json();
  } catch {
    throw new Error('本地 Studio 授权响应无效。');
  }
  if (!response.ok || payload?.ok !== true || payload?.data?.authenticated !== true) throw new Error('本地 Studio 授权失败。请重试。');
  history.replaceState(history.state, '', String(location.pathname || '/') + String(location.search || ''));
  return true;
}
