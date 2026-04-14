import { requireAuth } from '../auth/auth-guard.js';
import {
  appendReportPhotoUrls,
  createStudentReport,
  uploadStudentReportPhoto,
} from '../reports/reports-service.js';
import {
  getFallbackReportFormOptions,
  getReportFormOptions,
  toIssueTypeLabel,
} from '../reports/reports-options.js';
import { FIELD, RISK_LEVEL, validateReportPayload } from '../reports/reports-schema.js';
import { REPORT_MEDIA } from '../config/app-constants.js';
import { logInfo, logWarn, logError } from '../shared/logger.js';

const MODAL_ID = 'submitReportModal';
const FORM_ID = 'submitReportForm';
const TOAST_ID = 'submitReportToast';
const DEFAULT_SELECTORS = ['[data-open-submit-modal]'];

let initialized = false;
let bound = false;
let openSelectors = [...DEFAULT_SELECTORS];
let onSubmittedHandler = null;
let escHandler = null;
let previousBodyOverflow = '';
let currentFormOptions = getFallbackReportFormOptions();
let formWarnings = [];

function getElement(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value || '');
  return div.innerHTML;
}

function ensureModalStyles() {
  if (getElement('submitReportModalStyles')) return;

  const style = document.createElement('style');
  style.id = 'submitReportModalStyles';
  style.textContent = `
    .submit-report-modal {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.45);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 3000;
      padding: 1rem;
      opacity: 0;
      pointer-events: none;
    }
    .submit-report-modal.is-open,
    .submit-report-modal.active {
      display: flex !important;
      opacity: 1 !important;
      pointer-events: auto !important;
    }
    .submit-report-dialog {
      width: min(100%, 560px);
      max-height: calc(100vh - 2rem);
      overflow: auto;
      background: #fff;
      border-radius: 12px;
      border: 1px solid var(--gray-light);
      padding: 1rem 1rem 1.1rem;
    }
    .submit-report-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.9rem;
    }
    .submit-report-title {
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--text);
    }
    .submit-report-close {
      border: 0;
      background: transparent;
      cursor: pointer;
      color: var(--gray);
      font-size: 1rem;
    }
    .submit-report-grid {
      display: grid;
      gap: 0.8rem;
    }
    .submit-report-field label {
      display: block;
      margin-bottom: 0.35rem;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text);
    }
    .submit-report-help {
      margin-top: 0.35rem;
      font-size: 0.8rem;
      color: var(--gray);
      line-height: 1.35;
    }
    .submit-report-field input,
    .submit-report-field select,
    .submit-report-field textarea {
      width: 100%;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 0.62rem 0.7rem;
      font-size: 0.9rem;
      font-family: inherit;
      background: #fff;
      color: var(--text);
    }
    .submit-report-field textarea {
      min-height: 84px;
      resize: vertical;
    }
    .submit-report-error,
    .submit-report-warning,
    .submit-report-success {
      display: none;
      border-radius: 8px;
      padding: 0.55rem 0.7rem;
      font-size: 0.86rem;
      margin-bottom: 0.7rem;
    }
    .submit-report-error.is-visible {
      display: block;
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #b91c1c;
    }
    .submit-report-success.is-visible {
      display: block;
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      color: #065f46;
    }
    .submit-report-warning.is-visible {
      display: block;
      background: #fffbeb;
      border: 1px solid #fcd34d;
      color: #92400e;
    }
    .submit-report-actions {
      margin-top: 0.95rem;
      display: flex;
      justify-content: flex-end;
      gap: 0.6rem;
    }
    .submit-report-progress {
      display: none;
      border: 1px solid var(--gray-light);
      background: #f8fafc;
      border-radius: 10px;
      padding: 0.65rem 0.75rem;
      margin: 0.65rem 0 0.85rem;
    }
    .submit-report-progress.is-visible {
      display: block;
    }
    .submit-report-progress-top {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 0.45rem;
    }
    .submit-report-progress-step {
      font-weight: 700;
      font-size: 0.86rem;
      color: var(--text);
    }
    .submit-report-progress-pct {
      font-weight: 700;
      font-size: 0.86rem;
      color: var(--gray);
      white-space: nowrap;
    }
    .submit-report-progress-bar {
      height: 10px;
      border-radius: 999px;
      background: #e2e8f0;
      overflow: hidden;
    }
    .submit-report-progress-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, var(--primary) 0%, var(--cyan) 100%);
      transition: width 0.12s ease;
    }
    .submit-report-btn {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 0.58rem 0.85rem;
      font-size: 0.9rem;
      cursor: pointer;
      background: #fff;
      color: var(--text);
    }
    .submit-report-btn.submit-primary {
      border-color: var(--primary);
      background: var(--primary);
      color: #fff;
      min-width: 124px;
    }
    .submit-report-btn:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }
    .submit-report-toast {
      position: fixed;
      left: 50%;
      bottom: 1.25rem;
      transform: translateX(-50%);
      background: #0f172a;
      color: #fff;
      border-radius: 999px;
      font-size: 0.85rem;
      padding: 0.5rem 0.85rem;
      z-index: 3100;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .submit-report-toast.is-visible {
      opacity: 0.94;
    }
  `;

  document.head.appendChild(style);
}

function ensureModalMarkup() {
  if (getElement(MODAL_ID)) return;

  document.body.insertAdjacentHTML(
    'beforeend',
    `
    <div id="${MODAL_ID}" class="submit-report-modal" aria-hidden="true">
      <div class="submit-report-dialog" role="dialog" aria-modal="true" aria-labelledby="submitReportTitle">
        <div class="submit-report-head">
          <h2 id="submitReportTitle" class="submit-report-title">Submit New Water Report</h2>
          <button type="button" class="submit-report-close" data-submit-modal-close aria-label="Close">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div id="submitReportError" class="submit-report-error"></div>
        <div id="submitReportWarning" class="submit-report-warning"></div>
        <div id="submitReportSuccess" class="submit-report-success"></div>
        <div id="submitReportProgress" class="submit-report-progress" aria-live="polite">
          <div class="submit-report-progress-top">
            <div id="submitReportProgressStep" class="submit-report-progress-step">Validating...</div>
            <div id="submitReportProgressPct" class="submit-report-progress-pct">0%</div>
          </div>
          <div class="submit-report-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <div id="submitReportProgressFill" class="submit-report-progress-fill"></div>
          </div>
        </div>
        <form id="${FORM_ID}" novalidate>
          <div class="submit-report-grid">
            <div class="submit-report-field">
              <label for="submitReportBuilding">Building</label>
              <select id="submitReportBuilding" required>
                <option value="">Select building</option>
              </select>
            </div>
            <div class="submit-report-field">
              <label for="submitReportFloor">Floor</label>
              <select id="submitReportFloor" required disabled>
                <option value="">Select building first</option>
              </select>
            </div>
            <div class="submit-report-field">
              <label for="submitReportLocation">Specific Location</label>
              <input id="submitReportLocation" type="text" maxlength="120" placeholder="e.g. Room 203 near stairs" required />
            </div>
            <div class="submit-report-field">
              <label for="submitReportIssueType">Issue Type</label>
              <select id="submitReportIssueType" required>
                <option value="">Select issue type</option>
              </select>
            </div>
            <div class="submit-report-field">
              <label for="submitReportDescription">Description (optional)</label>
              <textarea id="submitReportDescription" maxlength="1000" placeholder="Add useful details..."></textarea>
            </div>
            <div class="submit-report-field">
              <label for="submitReportPhoto">Photos *</label>
              <input id="submitReportPhoto" type="file" accept="image/jpeg,image/png,image/webp" multiple />
              <div class="submit-report-help">At least 1 photo required (up to ${REPORT_MEDIA.MAX_IMAGES}).</div>
            </div>
          </div>
          <div class="submit-report-actions">
            <button type="button" class="submit-report-btn" data-submit-modal-close>Close</button>
            <button id="submitReportSubmitBtn" type="submit" class="submit-report-btn submit-primary">Submit Report</button>
          </div>
        </form>
      </div>
    </div>
    <div id="${TOAST_ID}" class="submit-report-toast" role="status" aria-live="polite"></div>
  `
  );
}

function getOpenSelector() {
  return openSelectors.join(',');
}

function showError(message) {
  const errorElement = getElement('submitReportError');
  const warningElement = getElement('submitReportWarning');
  const successElement = getElement('submitReportSuccess');
  if (!errorElement || !successElement || !warningElement) return;
  warningElement.classList.remove('is-visible');
  successElement.classList.remove('is-visible');
  errorElement.textContent = message;
  errorElement.classList.add('is-visible');
}

function showWarning(message) {
  const errorElement = getElement('submitReportError');
  const warningElement = getElement('submitReportWarning');
  if (!errorElement || !warningElement) return;
  errorElement.classList.remove('is-visible');
  warningElement.textContent = message;
  warningElement.classList.add('is-visible');
}

function showSuccess(message) {
  const errorElement = getElement('submitReportError');
  const warningElement = getElement('submitReportWarning');
  const successElement = getElement('submitReportSuccess');
  if (!errorElement || !successElement || !warningElement) return;
  errorElement.classList.remove('is-visible');
  warningElement.classList.remove('is-visible');
  successElement.textContent = message;
  successElement.classList.add('is-visible');
}

function resetMessages() {
  const errorElement = getElement('submitReportError');
  const warningElement = getElement('submitReportWarning');
  const successElement = getElement('submitReportSuccess');
  if (errorElement) errorElement.classList.remove('is-visible');
  if (warningElement) warningElement.classList.remove('is-visible');
  if (successElement) successElement.classList.remove('is-visible');
}

function showToast(message) {
  const toast = getElement(TOAST_ID);
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add('is-visible');
  window.setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 1800);
}

function setProgressVisible(isVisible) {
  const container = getElement('submitReportProgress');
  if (!container) return;
  container.classList.toggle('is-visible', Boolean(isVisible));
}

function setProgress(step, pct) {
  const stepEl = getElement('submitReportProgressStep');
  const pctEl = getElement('submitReportProgressPct');
  const fillEl = getElement('submitReportProgressFill');
  const bar = getElement('submitReportProgress')?.querySelector('[role="progressbar"]');

  const safePct = Math.max(0, Math.min(100, Number(pct) || 0));
  if (stepEl) stepEl.textContent = String(step || 'Working...');
  if (pctEl) pctEl.textContent = `${safePct.toFixed(0)}%`;
  if (fillEl) fillEl.style.width = `${safePct}%`;
  if (bar) {
    try {
      bar.setAttribute('aria-valuenow', String(safePct.toFixed(0)));
    } catch (_) {
      // Best-effort only.
    }
  }
}

function resetProgress() {
  setProgressVisible(false);
  setProgress('Validating...', 0);
}

async function compressReportImage(file, options = {}) {
  const { maxDimension = 1600, quality = 0.82 } = options;
  if (!file) return null;

  const type = String(file.type || '');
  if (!REPORT_MEDIA.ALLOWED_IMAGE_MIME_TYPES.includes(type)) {
    return file;
  }

  const blob = file;
  let bitmap = null;
  try {
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(blob);
    }
  } catch (_) {
    bitmap = null;
  }

  if (!bitmap) {
    // Fallback path.
    const img = new Image();
    const url = URL.createObjectURL(blob);
    try {
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = url;
      });
      bitmap = img;
    } finally {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {
      }
    }
  }

  const width = Number(bitmap.width || bitmap.naturalWidth || 0);
  const height = Number(bitmap.height || bitmap.naturalHeight || 0);
  if (!width || !height) {
    return file;
  }

  const maxSide = Math.max(width, height);
  const shouldResize = maxSide > maxDimension;
  const scale = shouldResize ? maxDimension / maxSide : 1;
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  // Skip re-encoding very small files.
  if (!shouldResize && Number(file.size || 0) <= 350 * 1024 && type === 'image/jpeg') {
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);

  try {
    if (bitmap && typeof bitmap.close === 'function') {
      bitmap.close();
    }
  } catch (_) {
  }

  const outBlob = await new Promise((resolve) => {
    canvas.toBlob(
      (b) => resolve(b),
      'image/jpeg',
      Math.max(0.5, Math.min(0.92, Number(quality) || 0.82))
    );
  });

  if (!outBlob) return file;
  if (Number(outBlob.size || 0) > REPORT_MEDIA.MAX_IMAGE_BYTES) {
    // Keep original; client-side validation already enforces 5MB.
    return file;
  }

  const safeName = String(file.name || 'photo')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(0, 64);
  const nextName = safeName ? `${safeName}.jpg` : 'photo.jpg';
  return new File([outBlob], nextName, { type: 'image/jpeg' });
}

function setSubmitting(isSubmitting) {
  const submitButton = getElement('submitReportSubmitBtn');
  if (!submitButton) return;
  const buildingsConfigured = Array.isArray(currentFormOptions?.buildings) && currentFormOptions.buildings.length > 0;
  const buildingSelect = getElement('submitReportBuilding');
  const buildingSelected = Boolean(String(buildingSelect?.value || '').trim());
  const floorsConfigured = buildingSelected ? getFloorsForBuilding(buildingSelect.value).length > 0 : true;

  submitButton.disabled = isSubmitting || !buildingsConfigured || !floorsConfigured;
  submitButton.textContent = isSubmitting ? 'Submitting...' : 'Submit Report';
}

function buildPayloadFromForm() {
  return {
    [FIELD.BUILDING]: getElement('submitReportBuilding')?.value || '',
    [FIELD.FLOOR]: getElement('submitReportFloor')?.value || '',
    [FIELD.LOCATION]: getElement('submitReportLocation')?.value || '',
    [FIELD.ISSUE_TYPE]: getElement('submitReportIssueType')?.value || '',
    // Risk level is admin-managed; student submissions default to the lowest severity.
    [FIELD.RISK_LEVEL]: RISK_LEVEL.LOW,
    [FIELD.DESCRIPTION]: getElement('submitReportDescription')?.value || '',
  };
}

function getSelectedPhotoFiles() {
  const input = getElement('submitReportPhoto');
  if (!input || !input.files || !input.files.length) return [];
  return Array.from(input.files);
}

function validatePhotoFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return 'Please upload at least 1 photo.';
  }

  if (files.length > REPORT_MEDIA.MAX_IMAGES) {
    return `You can upload up to ${REPORT_MEDIA.MAX_IMAGES} photos.`;
  }

  for (const file of files) {
    const mimeType = String(file?.type || '');
    if (!REPORT_MEDIA.ALLOWED_IMAGE_MIME_TYPES.includes(mimeType)) {
      return 'Photos must be JPG, PNG, or WebP.';
    }
    if (Number(file?.size || 0) > REPORT_MEDIA.MAX_IMAGE_BYTES) {
      return 'Each photo must be 5MB or smaller.';
    }
  }

  return null;
}

function populateSelect(selectId, values, { includePlaceholder = false, toLabel } = {}) {
  const select = getElement(selectId);
  if (!select) return;

  const options = [];
  if (includePlaceholder) {
    const placeholder =
      selectId === 'submitReportBuilding'
        ? 'Select building'
        : selectId === 'submitReportFloor'
          ? 'Select floor'
          : 'Select issue type';
    options.push(`<option value="">${placeholder}</option>`);
  }

  values.forEach((value) => {
    const label = typeof toLabel === 'function' ? toLabel(value) : value;
    options.push(`<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`);
  });

  select.innerHTML = options.join('');
}

let floorBindingsAttached = false;

function getFloorsForBuilding(buildingName) {
  const building = String(buildingName || '').trim();
  if (!building) return [];
  const floors = currentFormOptions && typeof currentFormOptions === 'object' ? currentFormOptions.buildingFloors : null;
  const list = floors && typeof floors === 'object' ? floors[building] : null;
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

function populateFloorSelect() {
  const buildingSelect = getElement('submitReportBuilding');
  const floorSelect = getElement('submitReportFloor');
  if (!floorSelect) return;

  const buildingValue = buildingSelect ? String(buildingSelect.value || '').trim() : '';
  const floors = getFloorsForBuilding(buildingValue);

  if (!buildingValue) {
    floorSelect.disabled = true;
    floorSelect.innerHTML = '<option value="">Select building first</option>';
    return;
  }

  if (!floors.length) {
    floorSelect.disabled = true;
    floorSelect.innerHTML = '<option value="">No floors configured</option>';
    return;
  }

  floorSelect.disabled = false;
  populateSelect('submitReportFloor', floors, { includePlaceholder: true });
}

function updateSubmissionAvailability() {
  const buildingSelect = getElement('submitReportBuilding');
  const floorSelect = getElement('submitReportFloor');
  const submitButton = getElement('submitReportSubmitBtn');
  if (!buildingSelect || !submitButton || !floorSelect) return;

  const buildingsConfigured = Array.isArray(currentFormOptions?.buildings) && currentFormOptions.buildings.length > 0;
  const buildingSelected = Boolean(String(buildingSelect.value || '').trim());
  const floorsForBuilding = getFloorsForBuilding(buildingSelect.value);
  const floorsConfigured = buildingSelected ? floorsForBuilding.length > 0 : true;

  buildingSelect.disabled = !buildingsConfigured;
  submitButton.disabled = !buildingsConfigured;

  if (!buildingsConfigured) {
    floorSelect.disabled = true;
    floorSelect.innerHTML = '<option value="">No buildings configured</option>';
    showWarning('No buildings configured yet. Please contact an admin to add buildings.');
    return;
  }

  populateFloorSelect();

  if (buildingSelected && !floorsConfigured) {
    submitButton.disabled = true;
    showWarning('No floors configured for the selected building. Please contact an admin.');
  }
}

async function populateFormOptions() {
  let options = null;
  try {
    options = await getReportFormOptions();
  } catch (_) {
    options = getFallbackReportFormOptions();
  }

  const safeBuildings = Array.isArray(options.buildings) ? options.buildings : [];

  currentFormOptions = {
    ...options,
    buildings: safeBuildings,
  };
  formWarnings = Array.isArray(options.warnings) ? options.warnings.filter(Boolean) : [];

  populateSelect('submitReportBuilding', safeBuildings, { includePlaceholder: true });
  populateSelect('submitReportFloor', [], { includePlaceholder: true });
  populateSelect('submitReportIssueType', options.issueTypes, { includePlaceholder: true, toLabel: toIssueTypeLabel });

  if (!floorBindingsAttached) {
    const buildingSelect = getElement('submitReportBuilding');
    if (buildingSelect) {
      buildingSelect.addEventListener('change', () => {
        const floorSelect = getElement('submitReportFloor');
        if (floorSelect) {
          floorSelect.value = '';
        }
        updateSubmissionAvailability();
      });
    }
    floorBindingsAttached = true;
  }

  updateSubmissionAvailability();

  if (formWarnings.length) {
    showWarning(formWarnings[0]);
  }
}

function openModal(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const modal = getElement(MODAL_ID);
  if (!modal) return;
  logInfo('[submit-modal] open');
  resetMessages();
  resetProgress();
  if (formWarnings.length) {
    showWarning(formWarnings[0]);
  }

  previousBodyOverflow = document.body.style.overflow || '';
  document.body.style.overflow = 'hidden';

  modal.classList.add('is-open');
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  const modal = getElement(MODAL_ID);
  if (!modal) return;

  modal.classList.remove('is-open');
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = previousBodyOverflow;
  resetProgress();
}

async function submitHandler(event) {
  event.preventDefault();
  resetMessages();
  resetProgress();
  setProgressVisible(true);
  setProgress('Validating...', 2);

  const payload = buildPayloadFromForm();
  const validation = validateReportPayload(payload, {
    allowedIssueTypes: currentFormOptions.issueTypes,
    // Risk level is admin-managed; ensure validation accepts the enforced student default.
    allowedRiskLevels: Array.isArray(currentFormOptions.riskLevels)
      ? Array.from(new Set([...currentFormOptions.riskLevels, RISK_LEVEL.LOW]))
      : [RISK_LEVEL.LOW],
    allowedBuildings: currentFormOptions.buildings,
    buildingFloors: currentFormOptions.buildingFloors,
  });
  if (!validation.ok) {
    showError(validation.errors[0]);
    setProgressVisible(false);
    return;
  }

  setSubmitting(true);

  try {
    setProgress('Checking account...', 6);
    const authState = await requireAuth({ loaderMessage: 'Checking account...' });
    const user = authState.user;
    const role = authState.role;
    const userData = authState.userData || {};

    payload[FIELD.CREATED_BY_NAME] = userData.name || user.displayName || user.email || '';
    payload[FIELD.REPORTER_SNAPSHOT] = {
      uid: user.uid,
      name: String(userData.name || user.displayName || '').trim(),
      email: String(userData.email || user.email || '').trim(),
      phoneNumber: String(userData.phone || '').trim(),
      role: String(role || '').trim(),
    };

    const photoFiles = getSelectedPhotoFiles();
    const photoValidationError = validatePhotoFiles(photoFiles);
    if (photoValidationError) {
      showError(photoValidationError);
      setProgressVisible(false);
      return;
    }

    setProgress('Saving report...', 14);
    const result = await createStudentReport(user.uid, payload);
    if (!result.success) {
      showError(result.error || 'Unable to submit report.');
      setProgressVisible(false);
      return;
    }

    let attachedPhotoUrls = [];
    let failedUploads = 0;
    let autoClose = true;

    if (photoFiles.length) {
      setProgress('Optimizing images...', 20);
      const optimized = [];
      let optimizedCount = 0;
      const optimizedFiles = await Promise.all(
        photoFiles.map(async (file) => {
          const next = await compressReportImage(file);
          optimizedCount++;
          const pct = 20 + (optimizedCount / Math.max(1, photoFiles.length)) * 10;
          setProgress(`Optimizing images... (${optimizedCount}/${photoFiles.length})`, pct);
          return next || file;
        })
      );
      optimized.push(...optimizedFiles);

      setProgress('Uploading images...', 32);
      const totals = optimized.map((f) => Number(f?.size || 0));
      const totalBytes = totals.reduce((a, b) => a + b, 0) || 1;
      const transferred = new Array(optimized.length).fill(0);

      function updateUploadProgress() {
        const sum = transferred.reduce((a, b) => a + b, 0);
        const uploadPct = (sum / totalBytes) * 100;
        // Map uploads into 32%..86%
        const pct = 32 + Math.max(0, Math.min(54, (uploadPct / 100) * 54));
        setProgress('Uploading images...', pct);
      }

      const uploadPromises = optimized.map((file, idx) =>
        uploadStudentReportPhoto(user.uid, result.reportId, file, {
          onProgress: (snap) => {
            const bytes = Number(snap?.bytesTransferred || 0);
            transferred[idx] = bytes;
            updateUploadProgress();
          },
        })
      );

      const settled = await Promise.allSettled(uploadPromises);
      const uploadUrls = [];
      const failedNames = [];
      settled.forEach((res, idx) => {
        if (res.status === 'fulfilled' && res.value?.success && res.value.url) {
          uploadUrls.push(res.value.url);
          return;
        }
        failedUploads++;
        const name = optimized[idx]?.name || photoFiles[idx]?.name || `Photo ${idx + 1}`;
        failedNames.push(String(name));
      });

      if (failedNames.length) {
        autoClose = false;
        showWarning(`Some photos failed to upload: ${failedNames.join(', ')}`);
      }

      if (uploadUrls.length) {
        setProgress('Linking photos...', 90);
        const attachResult = await appendReportPhotoUrls(user.uid, result.reportId, uploadUrls);
        if (attachResult.success) {
          attachedPhotoUrls = attachResult.photoUrls || uploadUrls;
        } else {
          logWarn('[submit-modal] photo metadata update failed', attachResult.errorCode, attachResult.error);
          autoClose = false;
          showError(
            `Report submitted, but failed to link uploaded photos. ` +
              `Ask an admin to link photos for Report ID: ${result.reportId}`
          );
        }
      }
    }

    if (failedUploads > 0) {
      showToast('Report submitted, but some photos failed to upload.');
    }

    setProgress('Done', 100);
    if (autoClose) {
      showSuccess('Report submitted!');
      showToast('Report submitted!');
    } else {
      showToast('Report submitted. Review messages before closing.');
    }

    const eventDetail = {
      uid: user.uid,
      reportId: result.reportId,
      report: {
        ...result.report,
        photoUrl: attachedPhotoUrls[0] || result.report?.photoUrl || '',
        photoUrls: attachedPhotoUrls.length ? attachedPhotoUrls : (result.report?.photoUrls || []),
      },
    };

    window.dispatchEvent(new CustomEvent('hydro:report-submitted', { detail: eventDetail }));
    // Backward compatibility for existing listeners.
    window.dispatchEvent(new CustomEvent('hydro:reportCreated', { detail: eventDetail }));

    if (typeof onSubmittedHandler === 'function') {
      await onSubmittedHandler(eventDetail);
    }

    if (autoClose) {
      window.setTimeout(() => {
        const form = getElement(FORM_ID);
        if (form) form.reset();
        closeModal();
      }, 500);
    }
  } catch (error) {
    if (error?.message !== 'redirect') {
      logError('Submit report error:', error);
      showError('Unable to submit report. Check connection / browser shields.');
    }
  } finally {
    setSubmitting(false);
    if (getElement('submitReportError')?.classList.contains('is-visible')) {
      // Keep progress visible to preserve last step context.
    } else if (getElement('submitReportWarning')?.classList.contains('is-visible')) {
      // Keep visible.
    } else {
      // Hide on clean success.
      setProgressVisible(false);
    }
  }
}

function bindGlobalEvents() {
  if (bound) return;
  bound = true;

  document.addEventListener('click', (event) => {
    const modal = getElement(MODAL_ID);
    if (!modal) return;

    const trigger = event.target.closest(getOpenSelector());
    if (trigger) {
      event.preventDefault();
      event.stopPropagation();
      logInfo('[submit-modal] trigger clicked');
      openModal();
      return;
    }

    if (event.target === modal || event.target.closest('[data-submit-modal-close]')) {
      event.preventDefault();
      closeModal();
    }
  });

  escHandler = (event) => {
    if (event.key === 'Escape') {
      closeModal();
    }
  };
  document.addEventListener('keydown', escHandler);

  const form = getElement(FORM_ID);
  if (form) {
    form.addEventListener('submit', submitHandler);
  }
}

export function initSubmitReportModal(options = {}) {
  if (Array.isArray(options.openButtonSelectors) && options.openButtonSelectors.length) {
    openSelectors = Array.from(new Set([...openSelectors, ...options.openButtonSelectors]));
  }
  if (typeof options.onSubmitted === 'function') {
    onSubmittedHandler = options.onSubmitted;
  }

  ensureModalStyles();
  ensureModalMarkup();
  bindGlobalEvents();
  populateFormOptions().catch((error) => {
    logWarn('Failed to populate report form options:', error);
  });

  initialized = true;
  return { openModal, closeModal };
}

export function openSubmitReportModal(event) {
  if (!initialized) {
    initSubmitReportModal();
  }
  openModal(event);
}

export function closeSubmitReportModal() {
  closeModal();
}
