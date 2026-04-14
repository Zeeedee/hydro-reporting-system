const TOAST_ID = 'hydroRateLimitToast';
const DEFAULT_MESSAGE = 'Too many actions. Please wait a bit and try again.';

let lastShownAt = 0;
let hideTimer = null;

export function isRateLimitError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code.includes('resource-exhausted') || message.includes('resource-exhausted');
}

function getOrCreateToast() {
  if (!globalThis.document) return null;

  let toast = document.getElementById(TOAST_ID);
  if (toast) return toast;

  toast = document.createElement('div');
  toast.id = TOAST_ID;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.style.position = 'fixed';
  toast.style.left = '12px';
  toast.style.right = '12px';
  toast.style.bottom = '12px';
  toast.style.zIndex = '99999';
  toast.style.padding = '10px 12px';
  toast.style.borderRadius = '12px';
  toast.style.border = '1px solid #fecaca';
  toast.style.background = '#fef2f2';
  toast.style.color = '#991b1b';
  toast.style.fontWeight = '800';
  toast.style.boxShadow = '0 10px 30px rgba(15, 23, 42, 0.18)';
  toast.style.display = 'none';
  toast.style.maxWidth = '720px';
  toast.style.margin = '0 auto';
  toast.style.textAlign = 'center';

  document.body.appendChild(toast);
  return toast;
}

export function showRateLimitToast(message = DEFAULT_MESSAGE, { durationMs = 3500 } = {}) {
  const toast = getOrCreateToast();
  if (!toast) return;

  const now = Date.now();
  if (now - lastShownAt < 2500) {
    return;
  }
  lastShownAt = now;

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  toast.textContent = String(message || DEFAULT_MESSAGE);
  toast.style.display = 'block';

  hideTimer = setTimeout(() => {
    toast.style.display = 'none';
  }, Math.max(1000, Number(durationMs) || 3500));
}

export function handleRateLimitError(error, message = DEFAULT_MESSAGE) {
  if (!isRateLimitError(error)) return false;
  showRateLimitToast(message);
  return true;
}
