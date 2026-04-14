import { initAdminAuthGuard, adminLogout } from '../admin-auth.js';
import { db } from '../firebase-config.js';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  Timestamp,
  where,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { AUDIT_ACTION_TYPES, COLLECTIONS, ROLES } from '../config/app-constants.js';
import { formatTimestampManila } from '../timezone.js';
import { logAuditDashboardViewed } from '../admin.js';
import { logWarn, logError } from '../shared/logger.js';

const PAGE_SIZE = 25;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

const tbody = document.getElementById('auditLogsTbody');
const errorBanner = document.getElementById('auditError');
const pageLabel = document.getElementById('pageLabel');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');

const filterFrom = document.getElementById('filterFrom');
const filterTo = document.getElementById('filterTo');
const filterRole = document.getElementById('filterRole');
const filterAction = document.getElementById('filterAction');
const filterSearch = document.getElementById('filterSearch');

const metadataModal = document.getElementById('metadataModal');
const metadataPre = document.getElementById('metadataPre');
const closeMetadataModal = document.getElementById('closeMetadataModal');

const ACTION_TYPES = AUDIT_ACTION_TYPES;

const ROLE_FILTERS = Object.freeze([
  { value: '', label: 'All' },
  { value: ROLES.SUPER_ADMIN, label: 'Super Admin' },
  { value: ROLES.ADMIN, label: 'Admin' },
  { value: ROLES.MAINTENANCE, label: 'Maintenance' },
  { value: ROLES.STUDENT, label: 'Student' },
]);

let isLoading = false;
let pageIndex = 0;
const pageStack = [];

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

function setError(message = '') {
  if (!errorBanner) return;
  errorBanner.textContent = message;
  errorBanner.classList.toggle('is-visible', Boolean(message));
}

function showLoadingRow(message = 'Loading audit logs...') {
  if (!tbody) return;
  tbody.innerHTML = `<tr><td class="loading-row" colspan="8"><span class="inline-spinner" aria-hidden="true"></span>${escapeHtml(message)}</td></tr>`;
}

function parseDateInputToUtcStart(dateStr) {
  if (!dateStr) return null;
  const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return null;
  const utcMs = Date.UTC(year, month - 1, day, 0, 0, 0) - MANILA_OFFSET_MS;
  return new Date(utcMs);
}

function parseDateInputToUtcEnd(dateStr) {
  if (!dateStr) return null;
  const start = parseDateInputToUtcStart(dateStr);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

function getTimestampValue(docData) {
  return docData?.timestamp || docData?.createdAt || null;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    const parsed = new Date(value.seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function metadataSummary(meta) {
  if (!meta || typeof meta !== 'object') return '';
  try {
    const keys = Object.keys(meta);
    if (!keys.length) return '';
    return keys.slice(0, 4).map((k) => `${k}`).join(', ') + (keys.length > 4 ? ', ...' : '');
  } catch (_) {
    return '';
  }
}

function matchesSearch(row, searchTerm) {
  if (!searchTerm) return true;
  const needle = searchTerm.toLowerCase();
  const metaString = row.metadata ? JSON.stringify(row.metadata).toLowerCase() : '';
  return (
    String(row.actorName || '').toLowerCase().includes(needle) ||
    String(row.actorUid || '').toLowerCase().includes(needle) ||
    String(row.targetId || '').toLowerCase().includes(needle) ||
    String(row.actionType || '').toLowerCase().includes(needle) ||
    String(row.targetType || '').toLowerCase().includes(needle) ||
    metaString.includes(needle)
  );
}

function applyLocalFilters(rows) {
  const role = String(filterRole?.value || '');
  const action = String(filterAction?.value || '');
  const search = String(filterSearch?.value || '').trim();

  return rows.filter((row) => {
    if (role && String(row.actorRole || '') !== role) return false;
    if (action && String(row.actionType || '') !== action) return false;
    if (!matchesSearch(row, search)) return false;
    return true;
  });
}

function openMetadataModal(meta) {
  if (!metadataModal || !metadataPre) return;
  try {
    metadataPre.textContent = JSON.stringify(meta || {}, null, 2);
  } catch (_) {
    metadataPre.textContent = '{ "error": "Unable to render metadata" }';
  }
  metadataModal.classList.remove('hidden');
}

function closeMetadata() {
  if (!metadataModal) return;
  metadataModal.classList.add('hidden');
}

function renderRows(rows, rawCount) {
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td class="loading-row" colspan="8">No audit logs found.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((row, idx) => {
      const ts = toDate(row.timestamp);
      const tsText = ts ? formatTimestampManila(ts) : '-';
      const metaText = metadataSummary(row.metadata);
      return `
        <tr>
          <td>${escapeHtml(tsText)}</td>
          <td>${escapeHtml(row.actorName || '-') }</td>
          <td>${escapeHtml(row.actorUid || '-') }</td>
          <td>${escapeHtml(row.actorRole || '-') }</td>
          <td>${escapeHtml(row.actionType || '-') }</td>
          <td>${escapeHtml(row.targetType || '-') }</td>
          <td>${escapeHtml(row.targetId || '-') }</td>
          <td class="meta-cell">
            ${escapeHtml(metaText || '')}
            <div style="margin-top:6px;">
              <button type="button" class="btn-view" data-meta-index="${idx}">View</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('[data-meta-index]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-meta-index') || -1);
      const row = rows[idx];
      if (!row) return;
      openMetadataModal(row.metadata || {});
    });
  });

  const suffix = rawCount !== rows.length ? ` (filtered ${rows.length}/${rawCount})` : '';
  if (pageLabel) {
    pageLabel.textContent = `Page ${pageIndex + 1}${suffix}`;
  }
}

function setPagerState({ hasPrev, hasNext }) {
  if (prevBtn) prevBtn.disabled = !hasPrev || isLoading;
  if (nextBtn) nextBtn.disabled = !hasNext || isLoading;
}

async function fetchPage(startAfterDoc = null) {
  const fromDate = parseDateInputToUtcStart(filterFrom?.value);
  const toDate = parseDateInputToUtcEnd(filterTo?.value);

  let q = query(
    collection(db, COLLECTIONS.AUDIT_LOGS),
    orderBy('timestamp', 'desc'),
    limit(PAGE_SIZE)
  );

  if (fromDate) {
    q = query(q, where('timestamp', '>=', Timestamp.fromDate(fromDate)));
  }
  if (toDate) {
    q = query(q, where('timestamp', '<=', Timestamp.fromDate(toDate)));
  }
  if (startAfterDoc) {
    q = query(q, startAfter(startAfterDoc));
  }

  const snap = await getDocs(q);
  return snap.docs;
}

async function loadInitial() {
  setError('');
  showLoadingRow();
  isLoading = true;
  setPagerState({ hasPrev: false, hasNext: false });

  try {
    pageStack.length = 0;
    pageIndex = 0;
    const docs = await fetchPage();
    pageStack.push(docs);
    renderCurrentPage();
  } catch (error) {
    logError('[audit-logs] fetch failed', error);
    setError(error?.message || 'Failed to load audit logs.');
    showLoadingRow('Failed to load audit logs.');
  } finally {
    isLoading = false;
    updatePager();
  }
}

function normalizeDoc(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    timestamp: getTimestampValue(data),
    actorUid: data.actorUid || '',
    actorName: data.actorName || '',
    actorRole: data.actorRole || '',
    actionType: data.actionType || '',
    targetType: data.targetType || '',
    targetId: data.targetId || '',
    metadata: data.metadata || {},
  };
}

function renderCurrentPage() {
  const docs = pageStack[pageIndex] || [];
  const normalized = docs.map(normalizeDoc);
  const filtered = applyLocalFilters(normalized);
  renderRows(filtered, normalized.length);
}

function updatePager() {
  const hasPrev = pageIndex > 0;
  const currentDocs = pageStack[pageIndex] || [];
  const hasNext = currentDocs.length === PAGE_SIZE;
  setPagerState({ hasPrev, hasNext });
}

async function goNext() {
  if (isLoading) return;
  const currentDocs = pageStack[pageIndex] || [];
  if (currentDocs.length < PAGE_SIZE) return;
  const lastDoc = currentDocs[currentDocs.length - 1];

  isLoading = true;
  setPagerState({ hasPrev: true, hasNext: false });
  showLoadingRow('Loading next page...');

  try {
    const docs = await fetchPage(lastDoc);
    pageStack.push(docs);
    pageIndex += 1;
    renderCurrentPage();
  } catch (error) {
    logError('[audit-logs] next failed', error);
    setError(error?.message || 'Failed to load next page.');
    renderCurrentPage();
  } finally {
    isLoading = false;
    updatePager();
  }
}

function goPrev() {
  if (isLoading) return;
  if (pageIndex === 0) return;
  pageIndex -= 1;
  setError('');
  renderCurrentPage();
  updatePager();
}

function initSelectOptions(select, options) {
  if (!select) return;
  select.innerHTML = options
    .map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`)
    .join('');
}

function initActionOptions() {
  if (!filterAction) return;
  const opts = [{ value: '', label: 'All' }].concat(
    ACTION_TYPES.map((value) => ({ value, label: value }))
  );
  initSelectOptions(filterAction, opts);
}

function bindFilters() {
  const handler = () => {
    // Date range affects server query; reset pagination.
    loadInitial().catch(() => {});
  };

  [filterFrom, filterTo].forEach((el) => {
    if (el) el.addEventListener('change', handler);
  });

  // Local-only filters.
  [filterRole, filterAction, filterSearch].forEach((el) => {
    if (!el) return;
    const evt = el === filterSearch ? 'input' : 'change';
    el.addEventListener(evt, () => {
      setError('');
      renderCurrentPage();
      updatePager();
    });
  });
}

async function bootstrap() {
  await initAdminAuthGuard();
  try {
    await logAuditDashboardViewed();
  } catch (error) {
    logWarn('[audit-logs] view log failed', error);
  }

  initSelectOptions(filterRole, ROLE_FILTERS);
  initActionOptions();
  bindFilters();

  if (prevBtn) prevBtn.addEventListener('click', () => goPrev());
  if (nextBtn) nextBtn.addEventListener('click', () => goNext());
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', adminLogout);

  if (closeMetadataModal) closeMetadataModal.addEventListener('click', closeMetadata);
  if (metadataModal) {
    metadataModal.addEventListener('click', (event) => {
      if (event.target === metadataModal) {
        closeMetadata();
      }
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMetadata();
    }
  });

  await loadInitial();
}

bootstrap().catch((error) => {
  logError('[audit-logs] bootstrap failed', error);
  setError(error?.message || 'Failed to load audit logs page.');
  showLoadingRow('Failed to load audit logs.');
});
