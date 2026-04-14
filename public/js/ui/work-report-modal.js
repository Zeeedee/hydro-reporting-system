let stylesInjected = false;
let markupInjected = false;

const MODAL_ID = 'hydroWorkReportModal';

function getEl(id) {
  return document.getElementById(id);
}

function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .hydro-work-report-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.55);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      z-index: 3500;
    }
    .hydro-work-report-overlay.is-open { display: flex; }
    .hydro-work-report-dialog {
      width: min(100%, 560px);
      background: #fff;
      border-radius: 14px;
      border: 1px solid rgba(148, 163, 184, 0.45);
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.25);
      overflow: hidden;
    }
    .hydro-work-report-head {
      padding: 1rem 1rem 0.75rem;
      border-bottom: 1px solid rgba(148, 163, 184, 0.35);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .hydro-work-report-title {
      margin: 0;
      font-size: 1rem;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: -0.01em;
    }
    .hydro-work-report-close {
      appearance: none;
      background: transparent;
      border: none;
      padding: 0.25rem 0.4rem;
      font-size: 1.25rem;
      line-height: 1;
      cursor: pointer;
      color: #475569;
    }
    .hydro-work-report-body {
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }
    .hydro-work-report-help {
      font-size: 0.85rem;
      color: #475569;
      line-height: 1.35;
    }
    .hydro-work-report-textarea {
      width: 100%;
      min-height: 120px;
      resize: vertical;
      padding: 0.75rem;
      border-radius: 12px;
      border: 1px solid rgba(148, 163, 184, 0.6);
      outline: none;
      font-size: 0.95rem;
      color: #0f172a;
    }
    .hydro-work-report-textarea:focus {
      border-color: rgba(14, 116, 144, 0.55);
      box-shadow: 0 0 0 4px rgba(14, 116, 144, 0.12);
    }
    .hydro-work-report-error {
      display: none;
      padding: 0.65rem 0.75rem;
      border-radius: 12px;
      background: rgba(220, 38, 38, 0.08);
      border: 1px solid rgba(220, 38, 38, 0.25);
      color: #b91c1c;
      font-weight: 700;
      font-size: 0.85rem;
    }
    .hydro-work-report-error.is-visible { display: block; }
    .hydro-work-report-foot {
      padding: 0.95rem 1rem 1rem;
      border-top: 1px solid rgba(148, 163, 184, 0.35);
      display: flex;
      gap: 0.6rem;
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    .hydro-work-report-btn {
      appearance: none;
      border: 1px solid rgba(148, 163, 184, 0.65);
      background: #fff;
      color: #0f172a;
      padding: 0.65rem 0.95rem;
      border-radius: 999px;
      font-weight: 900;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .hydro-work-report-btn.primary {
      border-color: rgba(14, 116, 144, 0.65);
      background: rgba(14, 116, 144, 0.95);
      color: #fff;
    }
    .hydro-work-report-btn.primary:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }
  `;
  document.head.appendChild(style);
}

function ensureMarkup() {
  if (markupInjected) return;
  markupInjected = true;
  document.body.insertAdjacentHTML(
    'beforeend',
    `
      <div class="hydro-work-report-overlay" id="${MODAL_ID}" aria-hidden="true">
        <div class="hydro-work-report-dialog" role="dialog" aria-modal="true" aria-labelledby="hydroWorkReportTitle">
          <div class="hydro-work-report-head">
            <h2 class="hydro-work-report-title" id="hydroWorkReportTitle">Work Report</h2>
            <button class="hydro-work-report-close" type="button" id="hydroWorkReportClose" aria-label="Close">&times;</button>
          </div>
          <div class="hydro-work-report-body">
            <div class="hydro-work-report-help" id="hydroWorkReportHelp">Describe the work completed. This is required to close the job.</div>
            <div class="hydro-work-report-error" id="hydroWorkReportError"></div>
            <textarea class="hydro-work-report-textarea" id="hydroWorkReportText" maxlength="800" placeholder="What was done? Materials used? Follow-ups needed?"></textarea>
            <div class="hydro-work-report-help" id="hydroWorkReportCount">0 / 800</div>
          </div>
          <div class="hydro-work-report-foot">
            <button class="hydro-work-report-btn" type="button" id="hydroWorkReportCancel">Cancel</button>
            <button class="hydro-work-report-btn primary" type="button" id="hydroWorkReportSubmit">Submit & Complete</button>
          </div>
        </div>
      </div>
    `
  );
}

function setOpen(open) {
  const overlay = getEl(MODAL_ID);
  if (!overlay) return;
  overlay.classList.toggle('is-open', !!open);
  overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function setError(message) {
  const el = getEl('hydroWorkReportError');
  if (!el) return;
  if (!message) {
    el.textContent = '';
    el.classList.remove('is-visible');
    return;
  }
  el.textContent = String(message);
  el.classList.add('is-visible');
}

export async function requestWorkReport(options = {}) {
  ensureStyles();
  ensureMarkup();

  const title = String(options.title || 'Work Report').trim() || 'Work Report';
  const help = String(options.help || 'Describe the work completed. This is required to close the job.').trim();
  const maxLen = Number.isFinite(Number(options.maxLength)) ? Math.max(50, Math.min(2000, Number(options.maxLength))) : 800;

  const overlay = getEl(MODAL_ID);
  const titleEl = getEl('hydroWorkReportTitle');
  const helpEl = getEl('hydroWorkReportHelp');
  const textEl = getEl('hydroWorkReportText');
  const countEl = getEl('hydroWorkReportCount');
  const cancelBtn = getEl('hydroWorkReportCancel');
  const submitBtn = getEl('hydroWorkReportSubmit');
  const closeBtn = getEl('hydroWorkReportClose');

  if (!overlay || !titleEl || !helpEl || !textEl || !countEl || !cancelBtn || !submitBtn || !closeBtn) {
    // Last-resort fallback.
    const fallback = window.prompt('Work report (required):');
    const normalized = String(fallback || '').trim();
    return normalized ? normalized.slice(0, 800) : null;
  }

  titleEl.textContent = title;
  helpEl.textContent = help;
  textEl.value = '';
  textEl.maxLength = String(maxLen);
  setError('');
  countEl.textContent = `0 / ${maxLen}`;
  submitBtn.disabled = false;

  const previousOverflow = document.body.style.overflow || '';
  document.body.style.overflow = 'hidden';
  setOpen(true);
  textEl.focus();

  function updateCount() {
    const len = String(textEl.value || '').length;
    countEl.textContent = `${len} / ${maxLen}`;
  }

  updateCount();

  return await new Promise((resolve) => {
    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      document.body.style.overflow = previousOverflow;
      setOpen(false);
      setError('');
      textEl.removeEventListener('input', onInput);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      submitBtn.removeEventListener('click', onSubmit);
      overlay.removeEventListener('click', onOverlay);
      window.removeEventListener('keydown', onKeyDown);
    };

    const onInput = () => {
      setError('');
      updateCount();
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onSubmit = () => {
      const value = String(textEl.value || '').trim();
      if (!value) {
        setError('Work report is required.');
        textEl.focus();
        return;
      }
      submitBtn.disabled = true;
      cleanup();
      resolve(value.slice(0, maxLen));
    };

    const onOverlay = (e) => {
      if (e && e.target === overlay) onCancel();
    };

    const onKeyDown = (e) => {
      if (!e) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        onSubmit();
      }
    };

    textEl.addEventListener('input', onInput);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    submitBtn.addEventListener('click', onSubmit);
    overlay.addEventListener('click', onOverlay);
    window.addEventListener('keydown', onKeyDown);
  });
}
