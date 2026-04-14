import { showToast } from './ui/notice.js';
import { logError, logInfo } from './shared/logger.js';

function bindSubmitFailureFallback(error) {
  const triggers = document.querySelectorAll('[data-open-submit-modal], .submit-btn, .sidebar-submit-btn');
  triggers.forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      logError('[submit-modal] unavailable: initialization failed', error);
      showToast('Report form is temporarily unavailable. Please refresh and try again.', { type: 'error' });
    });
  });
}

async function initReportSubmit() {
  try {
    const modalModule = await import('./ui/submit-report-modal.js');
    const { initSubmitReportModal, openSubmitReportModal, closeSubmitReportModal } = modalModule;

    initSubmitReportModal({
      openButtonSelectors: ['[data-open-submit-modal]'],
    });

    window.openSubmitReportModal = openSubmitReportModal;
    window.closeSubmitReportModal = closeSubmitReportModal;
    logInfo('[submit-modal] initialized');
  } catch (error) {
    logError('[submit-modal] init failed', error);
    bindSubmitFailureFallback(error);
  }
}

function startInit() {
  initReportSubmit().catch((error) => {
    logError('[submit-modal] unexpected init error', error);
    bindSubmitFailureFallback(error);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startInit);
} else {
  startInit();
}
