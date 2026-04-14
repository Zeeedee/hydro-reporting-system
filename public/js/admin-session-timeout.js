import { auth } from './firebase-config.js';
import { ROUTES } from './config/app-constants.js';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

let timeoutId = null;
let initialized = false;
let activityHandler = null;

function clearExistingTimer() {
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

function scheduleTimeout(timeoutMs, onTimeout) {
  clearExistingTimer();
  timeoutId = setTimeout(onTimeout, timeoutMs);
}

function buildDefaultOnTimeout() {
  return async () => {
    try {
      await auth.signOut();
    } finally {
      window.location.replace(ROUTES.SIGN_IN);
    }
  };
}

export function initAdminSessionTimeout({ timeoutMs = DEFAULT_TIMEOUT_MS, onTimeout } = {}) {
  if (initialized) {
    scheduleTimeout(timeoutMs, onTimeout || buildDefaultOnTimeout());
    return;
  }

  initialized = true;
  const timeoutHandler = onTimeout || buildDefaultOnTimeout();

  activityHandler = () => scheduleTimeout(timeoutMs, timeoutHandler);

  const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
  for (const evt of events) {
    window.addEventListener(evt, activityHandler, { passive: true });
  }

  // Start immediately.
  activityHandler();
}

export function stopAdminSessionTimeout() {
  clearExistingTimer();

  if (activityHandler) {
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    for (const evt of events) {
      window.removeEventListener(evt, activityHandler);
    }
  }

  activityHandler = null;
  initialized = false;
}
