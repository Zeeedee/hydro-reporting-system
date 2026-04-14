import { db } from './firebase-config.js';
import {
  collection,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { FIELD, REPORTS_COLLECTION, STATUS, normalizeStatus, toIssueTypeLabel } from './reports/reports-schema.js';
import { formatTimestampManila } from './timezone.js';
import { logWarn, logError } from './shared/logger.js';

const MANILA_TIMEZONE = 'Asia/Manila';
const REPORTS_LIMIT = 25;

const STATS_LOADING_TEXT = '...';
const STATS_ERROR_TEXT = '\u2014';

const STATS_GENERIC_ERROR = 'Unable to load stats. Check connection or browser privacy shields.';
const STATS_INDEX_ERROR = 'Index required: create composite index for reports(studentId, status).';
const LEGACY_STATUS_WARNING = 'Some reports have legacy statuses; counts may exclude them.';

const REPORTS_GENERIC_ERROR = 'Unable to load reports. Check connection / browser shields.';
const REPORTS_INDEX_ERROR = 'Index required: create composite index for reports(studentId, createdAt).';

const warningMessages = new Map();

function reportsCollection() {
  return collection(db, REPORTS_COLLECTION);
}

function getById(id) {
  return document.getElementById(id);
}

function setWarningMessage(key, message = '') {
  if (message) {
    warningMessages.set(key, message);
  } else {
    warningMessages.delete(key);
  }

  const warningBanner = getById('reportsWarningBanner');
  if (!warningBanner) return;

  const merged = Array.from(new Set(Array.from(warningMessages.values())));
  if (!merged.length) {
    warningBanner.textContent = '';
    warningBanner.classList.remove('is-visible');
    return;
  }

  warningBanner.textContent = merged.join(' ');
  warningBanner.classList.add('is-visible');
}

function setStatText(id, value) {
  const element = getById(id);
  if (element) {
    element.textContent = value;
  }
}

function setStatsDisplay(value) {
  setStatText('statTotal', value);
  setStatText('statPending', value);
  setStatText('statInProgress', value);
  setStatText('statResolved', value);
}

function setStatsLoading() {
  setStatsDisplay(STATS_LOADING_TEXT);
}

function setStatsError() {
  setStatsDisplay(STATS_ERROR_TEXT);
}

function formatReportDate(dateValue) {
  if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return '-';

  return formatTimestampManila(dateValue, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: undefined,
    minute: undefined,
  });
}

function escapeHtml(value) {
  const temp = document.createElement('div');
  temp.textContent = value == null ? '' : String(value);
  return temp.innerHTML;
}

function normalizeReportDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getStatusBadge(statusInput) {
  const status = normalizeStatus(statusInput);
  if (status === STATUS.RESOLVED) {
    return '<span class="status status-resolved"><i class="fa-solid fa-circle-check"></i> Resolved</span>';
  }
  if (status === STATUS.IN_PROGRESS) {
    return '<span class="status status-progress"><i class="fa-solid fa-screwdriver-wrench"></i> In Progress</span>';
  }
  return '<span class="status status-pending"><i class="fa-solid fa-clock"></i> Pending</span>';
}

function toReportRow(docSnap) {
  const data = docSnap.data();
  const createdAt = normalizeReportDate(data[FIELD.CREATED_AT]);
  const issueTypeValue = String(data[FIELD.ISSUE_TYPE] || '').trim();
  const issueTypeLabel = issueTypeValue ? toIssueTypeLabel(issueTypeValue) : '-';
  const building = String(data[FIELD.BUILDING] || '').trim();
  const floor = String(data[FIELD.FLOOR] || '').trim();
  const buildingLabel = building ? `${building}${floor ? `, ${floor}` : ''}` : '-';
  return `
    <tr>
      <td>${formatReportDate(createdAt)}</td>
      <td>${escapeHtml(buildingLabel)}</td>
      <td>${escapeHtml(data[FIELD.LOCATION] || '-')}</td>
      <td>${escapeHtml(issueTypeLabel)}</td>
      <td>${getStatusBadge(data[FIELD.STATUS])}</td>
    </tr>
  `;
}

function renderReportsLoading() {
  const tbody = getById('dailyReportsTbody');
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="5" class="empty-state">
        <p>Loading...</p>
      </td>
    </tr>
  `;
}

function renderReportsEmpty() {
  const tbody = getById('dailyReportsTbody');
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="5" class="empty-state">
        <i class="fa-regular fa-folder-open"></i>
        <p>No reports today yet.</p>
      </td>
    </tr>
  `;
}

function renderReportsRows(docs) {
  const tbody = getById('dailyReportsTbody');
  if (!tbody) return;

  tbody.innerHTML = docs.map((docSnap) => toReportRow(docSnap)).join('');
}

function renderReportsError(message, onRetry) {
  const tbody = getById('dailyReportsTbody');
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="5" class="empty-state">
        <p>${escapeHtml(message)}</p>
        <button type="button" class="btn btn-primary" id="dailyReportsRetryBtn">Retry</button>
      </td>
    </tr>
  `;

  const retryButton = getById('dailyReportsRetryBtn');
  if (retryButton && typeof onRetry === 'function') {
    retryButton.addEventListener('click', () => {
      onRetry();
    });
  }
}

function isIndexError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code.includes('failed-precondition') && message.includes('index');
}

function parseDatePartsInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const partValue = (type) => Number(parts.find((part) => part.type === type)?.value || 0);

  return {
    year: partValue('year'),
    month: partValue('month'),
    day: partValue('day'),
    hour: partValue('hour'),
    minute: partValue('minute'),
    second: partValue('second'),
  };
}

function getTimeZoneOffsetMs(date, timeZone) {
  const zoned = parseDatePartsInTimeZone(date, timeZone);
  const asUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
  return asUtc - date.getTime();
}

function zonedDateTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0, timeZone }) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffsetMs(guess, timeZone);
  return new Date(guess.getTime() - offset);
}

function getManilaDayRange(now = new Date()) {
  const parts = parseDatePartsInTimeZone(now, MANILA_TIMEZONE);
  const startDate = zonedDateTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    timeZone: MANILA_TIMEZONE,
  });

  // Asia/Manila has no DST, so +24h is the next local midnight.
  const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);

  return {
    startDate,
    endDate,
    start: Timestamp.fromDate(startDate),
    end: Timestamp.fromDate(endDate),
  };
}

export async function loadStudentStats(uid) {
  if (!uid) {
    setStatsError();
    setWarningMessage('stats', STATS_GENERIC_ERROR);
    return {
      success: false,
      error: 'Missing student uid.',
      errorCode: 'missing-uid',
      stats: null,
    };
  }

  setStatsLoading();
  setWarningMessage('stats', '');
  setWarningMessage('legacy-status', '');

  const pendingStatus = normalizeStatus(STATUS.PENDING);
  const inProgressStatus = normalizeStatus(STATUS.IN_PROGRESS);
  const resolvedStatus = normalizeStatus(STATUS.RESOLVED);
  const normalizedStatuses = [pendingStatus, inProgressStatus, resolvedStatus];

  try {
    const totalQuery = query(reportsCollection(), where(FIELD.STUDENT_ID, '==', uid));
    const pendingQuery = query(
      reportsCollection(),
      where(FIELD.STUDENT_ID, '==', uid),
      where(FIELD.STATUS, '==', pendingStatus)
    );
    const inProgressQuery = query(
      reportsCollection(),
      where(FIELD.STUDENT_ID, '==', uid),
      where(FIELD.STATUS, '==', inProgressStatus)
    );
    const resolvedQuery = query(
      reportsCollection(),
      where(FIELD.STUDENT_ID, '==', uid),
      where(FIELD.STATUS, '==', resolvedStatus)
    );
    const [totalSnap, pendingSnap, inProgressSnap, resolvedSnap] = await Promise.all([
      getCountFromServer(totalQuery),
      getCountFromServer(pendingQuery),
      getCountFromServer(inProgressQuery),
      getCountFromServer(resolvedQuery),
    ]);

    const stats = {
      total: totalSnap.data().count || 0,
      pending: pendingSnap.data().count || 0,
      in_progress: inProgressSnap.data().count || 0,
      resolved: resolvedSnap.data().count || 0,
    };

    setStatText('statTotal', String(stats.total));
    setStatText('statPending', String(stats.pending));
    setStatText('statInProgress', String(stats.in_progress));
    setStatText('statResolved', String(stats.resolved));

    let legacyStatusCount = 0;
    try {
      const legacyStatusQuery = query(
        reportsCollection(),
        where(FIELD.STUDENT_ID, '==', uid),
        where(FIELD.STATUS, 'not-in', normalizedStatuses)
      );
      const legacyStatusSnap = await getCountFromServer(legacyStatusQuery);
      legacyStatusCount = legacyStatusSnap.data().count || 0;
      if (legacyStatusCount > 0) {
        setWarningMessage('legacy-status', LEGACY_STATUS_WARNING);
      }
    } catch (legacyStatusError) {
      logWarn('[dashboard] legacy status check failed', legacyStatusError);
    }

    return { success: true, stats, legacyStatusCount };
  } catch (error) {
    logError('[dashboard] stats query failed', error);

    setStatsError();
    setWarningMessage('stats', isIndexError(error) ? STATS_INDEX_ERROR : STATS_GENERIC_ERROR);

    return {
      success: false,
      error: isIndexError(error) ? STATS_INDEX_ERROR : STATS_GENERIC_ERROR,
      errorCode: isIndexError(error) ? 'index-required' : 'query-failed',
      stats: null,
    };
  }
}

export async function loadTodayReports(uid) {
  if (!uid) {
    renderReportsError(REPORTS_GENERIC_ERROR, () => {
      loadTodayReports(uid).catch(() => {});
    });
    return {
      success: false,
      error: 'Missing student uid.',
      errorCode: 'missing-uid',
      reports: [],
    };
  }

  renderReportsLoading();
  setWarningMessage('reports', '');

  const { start, end } = getManilaDayRange();

  try {
    const todayQuery = query(
      reportsCollection(),
      where(FIELD.STUDENT_ID, '==', uid),
      where(FIELD.CREATED_AT, '>=', start),
      where(FIELD.CREATED_AT, '<', end),
      orderBy(FIELD.CREATED_AT, 'desc'),
      limit(REPORTS_LIMIT)
    );

    const snapshot = await getDocs(todayQuery);
    if (snapshot.empty) {
      renderReportsEmpty();
      return { success: true, reports: [] };
    }

    renderReportsRows(snapshot.docs);

    const reports = snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        ...data,
        [FIELD.STATUS]: normalizeStatus(data[FIELD.STATUS]),
        [FIELD.CREATED_AT]: normalizeReportDate(data[FIELD.CREATED_AT]),
      };
    });

    return { success: true, reports };
  } catch (error) {
    const isMissingIndex = isIndexError(error);
    const message = isMissingIndex ? REPORTS_INDEX_ERROR : REPORTS_GENERIC_ERROR;
    logError('[dashboard] today reports query failed', error);

    renderReportsError(message, () => {
      loadTodayReports(uid).catch(() => {});
    });

    return {
      success: false,
      error: message,
      errorCode: isMissingIndex ? 'index-required' : 'query-failed',
      reports: [],
    };
  }
}

export async function refreshStudentDashboard(uid) {
  const [statsResult, reportsResult] = await Promise.all([loadStudentStats(uid), loadTodayReports(uid)]);

  return {
    success: Boolean(statsResult.success && reportsResult.success),
    statsResult,
    reportsResult,
  };
}
