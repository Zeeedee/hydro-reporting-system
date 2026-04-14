const TOAST_ID = 'hydroNoticeToast';

function getStylesForType(type) {
  const t = String(type || 'info');
  if (t === 'success' || t === 'ok') {
    return {
      border: '#a7f3d0',
      background: '#ecfdf5',
      color: '#065f46',
    };
  }
  if (t === 'error') {
    return {
      border: '#fecaca',
      background: '#fef2f2',
      color: '#991b1b',
    };
  }
  if (t === 'warning') {
    return {
      border: '#fed7aa',
      background: '#fff7ed',
      color: '#9a3412',
    };
  }

  return {
    border: '#bfdbfe',
    background: '#eff6ff',
    color: '#1e3a8a',
  };
}

function getOrCreateToast() {
  let el = document.getElementById(TOAST_ID);
  if (el) return el;

  el = document.createElement('div');
  el.id = TOAST_ID;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.style.position = 'fixed';
  el.style.left = '12px';
  el.style.right = '12px';
  el.style.bottom = '12px';
  el.style.zIndex = '99999';
  el.style.padding = '10px 12px';
  el.style.borderRadius = '12px';
  el.style.border = '1px solid #bfdbfe';
  el.style.background = '#eff6ff';
  el.style.color = '#1e3a8a';
  el.style.fontWeight = '700';
  el.style.boxShadow = '0 10px 30px rgba(15, 23, 42, 0.16)';
  el.style.display = 'none';
  el.style.maxWidth = '760px';
  el.style.margin = '0 auto';
  el.style.textAlign = 'center';
  el.style.lineHeight = '1.35';

  document.body.appendChild(el);
  return el;
}

let hideTimer = null;

export function showToast(message, { type = 'info', timeoutMs = 3500 } = {}) {
  const el = getOrCreateToast();
  if (!el) return;

  const styles = getStylesForType(type);
  el.style.borderColor = styles.border;
  el.style.background = styles.background;
  el.style.color = styles.color;
  el.textContent = String(message || '').trim();

  if (!el.textContent) {
    el.style.display = 'none';
    return;
  }

  el.style.display = 'block';

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  const ms = Math.max(1500, Math.min(12000, Number(timeoutMs) || 3500));
  hideTimer = window.setTimeout(() => {
    el.style.display = 'none';
  }, ms);
}
