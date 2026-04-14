const STORAGE_KEY = 'hydro:debug';

export function isDebugEnabled() {
  try {
    if (globalThis.__HYDRO_DEBUG__ === true) return true;
  } catch (_) {
    // ignore
  }

  try {
    return String(localStorage.getItem(STORAGE_KEY) || '') === '1';
  } catch (_) {
    return false;
  }
}

export function logInfo(...args) {
  if (!isDebugEnabled()) return;
  try {
    console.info(...args);
  } catch (_) {
    // ignore
  }
}

export function logWarn(...args) {
  if (!isDebugEnabled()) return;
  try {
    console.warn(...args);
  } catch (_) {
    // ignore
  }
}

export function logError(...args) {
  if (!isDebugEnabled()) return;
  try {
    console.error(...args);
  } catch (_) {
    // ignore
  }
}
