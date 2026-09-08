const START_TIME_ERROR = /Cannot read properties of undefined \(reading ['"]startTime['"]\)/;
const LOCAL_APP_STACK = /\/(?:src|assets)\//;
const INJECTED_SOURCE = /^(?:VM\d+|<anonymous>|)$/;

function errorMessage(input) {
  return String(input?.message || input?.reason?.message || input?.error?.message || input || '');
}

function errorStack(input) {
  return String(input?.stack || input?.error?.stack || input?.reason?.stack || '');
}

function errorSource(input) {
  return String(input?.filename || input?.source || '');
}

function isLocalAppError(stack, source) {
  return LOCAL_APP_STACK.test(stack) || LOCAL_APP_STACK.test(source);
}

export function isInjectedDiagnosticsStartTimeError(input = {}) {
  const message = errorMessage(input);
  const stack = errorStack(input);
  const source = errorSource(input);
  if (!START_TIME_ERROR.test(message) || isLocalAppError(stack, source)) return false;
  if (stack.includes('reportAllChanges') && (stack.includes('<anonymous>') || INJECTED_SOURCE.test(source))) return true;
  return INJECTED_SOURCE.test(source) && !stack;
}

function swallowInjectedDiagnosticsError(error) {
  return isInjectedDiagnosticsStartTimeError(error);
}

function guardedCallback(callback) {
  if (typeof callback !== 'function') return callback;
  return function daogePicGuardedBrowserCallback(...args) {
    try {
      const result = callback.apply(this, args);
      if (result && typeof result.then === 'function') {
        return result.catch((error) => {
          if (swallowInjectedDiagnosticsError(error)) return undefined;
          throw error;
        });
      }
      return result;
    } catch (error) {
      if (swallowInjectedDiagnosticsError(error)) return undefined;
      throw error;
    }
  };
}

function replaceGlobalCallbackScheduler(target, name, wrap) {
  const original = target?.[name];
  if (typeof original !== 'function') return () => undefined;
  try {
    target[name] = wrap(original);
    return () => { target[name] = original; };
  } catch {
    return () => undefined;
  }
}

function installAsyncCallbackGuards(target) {
  return [
    replaceGlobalCallbackScheduler(target, 'setTimeout', (original) => function setTimeoutGuard(callback, delay, ...args) { return original.call(this, guardedCallback(callback), delay, ...args); }),
    replaceGlobalCallbackScheduler(target, 'setInterval', (original) => function setIntervalGuard(callback, delay, ...args) { return original.call(this, guardedCallback(callback), delay, ...args); }),
    replaceGlobalCallbackScheduler(target, 'requestAnimationFrame', (original) => function requestAnimationFrameGuard(callback) { return original.call(this, guardedCallback(callback)); }),
    replaceGlobalCallbackScheduler(target, 'queueMicrotask', (original) => function queueMicrotaskGuard(callback) { return original.call(this, guardedCallback(callback)); })
  ];
}

export function installBrowserErrorGuard(target = globalThis) {
  if (!target?.addEventListener || target.__DAOGE_PIC_BROWSER_ERROR_GUARD__) return () => undefined;
  target.__DAOGE_PIC_BROWSER_ERROR_GUARD__ = true;
  const restoreSchedulers = installAsyncCallbackGuards(target);

  const onError = (event) => {
    if (!isInjectedDiagnosticsStartTimeError(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation?.();
  };
  const onUnhandledRejection = (event) => {
    if (!isInjectedDiagnosticsStartTimeError(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation?.();
  };
  const previousOnError = target.onerror;
  target.onerror = function daogePicWindowOnError(message, source, lineno, colno, error) {
    if (isInjectedDiagnosticsStartTimeError({ message, filename: source, error })) return true;
    return typeof previousOnError === 'function' ? previousOnError.apply(this, arguments) : false;
  };

  target.addEventListener('error', onError, true);
  target.addEventListener('unhandledrejection', onUnhandledRejection, true);
  return () => {
    target.removeEventListener('error', onError, true);
    target.removeEventListener('unhandledrejection', onUnhandledRejection, true);
    target.onerror = previousOnError;
    for (const restore of restoreSchedulers.reverse()) restore();
    target.__DAOGE_PIC_BROWSER_ERROR_GUARD__ = false;
  };
}
