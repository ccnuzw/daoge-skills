/**
 * 界面 ↔ 后台服务的版本协商（方案 9.4）。纯函数，可单测。
 *
 * 大版本切换期最难看的坏法：新界面连旧 daemon（或反过来），每个请求都神秘失败。
 * 所以进门先握手一次，不兼容时给一句人话，而不是把 400 甩给用户。
 *
 * 握手用的是**不带协议头**的 `/api/studio`：只有这样才能读到对方的版本，
 * 而不是先被对方的版本检查拦下。
 */

export const PROTOCOL_NAME = 'daoge-pic-skill-protocol';
export const WORKBENCH_PROTOCOL_VERSION = '3.0.0';

/** 读的是 daemon 的 `/api/studio` 返回体。 */
export function negotiateStudioVersion(studio, options = {}) {
  const expectedVersion = String(options.expectedVersion || WORKBENCH_PROTOCOL_VERSION);
  const expectedName = String(options.expectedName || PROTOCOL_NAME);
  const protocol = studio && typeof studio === 'object' ? studio.protocol : null;
  const daemonName = protocol && typeof protocol.name === 'string' ? protocol.name : '';
  const daemonVersion = protocol && typeof protocol.version === 'string' ? protocol.version : '';
  const runtimeVersion = protocol && typeof protocol.runtimeVersion === 'string' ? protocol.runtimeVersion : '';
  const supportedRange = protocol && typeof protocol.supportedRange === 'string' ? protocol.supportedRange : '';

  if (!daemonName || !daemonVersion) {
    return {
      compatible: false,
      reason: 'unknown',
      daemonProtocol: daemonVersion || null,
      daemonRuntime: runtimeVersion || null,
      message: '无法确认本地 Studio 的版本。请重启 Studio 后刷新页面。'
    };
  }
  if (daemonName !== expectedName) {
    return {
      compatible: false,
      reason: 'protocol-name',
      daemonProtocol: daemonVersion,
      daemonRuntime: runtimeVersion || null,
      message: '本地 Studio 用的不是同一个协作协议，界面无法对接。请确认启动的是本版本的 daoge-pic。'
    };
  }
  // 同主版本才算兼容：协议是 breaking 升级的载体（大版本升级 = 协议升主版本）。
  const expectedMajor = expectedVersion.split('.')[0];
  const daemonMajor = daemonVersion.split('.')[0];
  if (daemonMajor === expectedMajor) {
    return { compatible: true, reason: '', daemonProtocol: daemonVersion, daemonRuntime: runtimeVersion || null, message: '' };
  }
  // 界面比后台新：后台太旧；界面比后台旧：界面（多半是浏览器缓存的旧产物）太旧。
  const frontendBehind = Number(daemonMajor) > Number(expectedMajor);
  return {
    compatible: false,
    reason: frontendBehind ? 'frontend-behind' : 'daemon-behind',
    daemonProtocol: daemonVersion,
    daemonRuntime: runtimeVersion || null,
    supportedRange: supportedRange || null,
    message: frontendBehind
      ? '本地后台服务（协议 ' + daemonVersion + '）比这个界面新。界面多半是浏览器缓存的旧版本，请强制刷新（或清缓存）后重试。'
      : '本地后台服务（协议 ' + daemonVersion + '）比这个界面旧。请重启/升级 Studio（daoge restart）后再刷新页面。'
  };
}

/** 握手请求本身不能带协议头，否则会被对方的版本检查先拦下。 */
export function versionProbeRequest(options = {}) {
  return {
    method: 'GET',
    credentials: /** @type {'same-origin'} */ ('same-origin'),
    headers: { accept: 'application/json', ...(options.headers || {}) },
    signal: options.signal
  };
}
