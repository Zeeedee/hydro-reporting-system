import { db, storage } from '../firebase-config.js';
import {
  addDoc,
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  Timestamp,
  where,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';
import { getDownloadURL, ref, uploadBytesResumable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';
import { getReportFormOptions } from './reports-options.js';
import { REPORT_MEDIA } from '../config/app-constants.js';
import {
  FIELD,
  REPORTS_COLLECTION,
  RISK_LEVEL,
  STATUS,
  normalizeIssueType,
  normalizeRiskLevel,
  normalizeStatus,
  validateReportPayload,
} from './reports-schema.js';
import { logInfo, logError } from '../shared/logger.js';

const GENERIC_REPORTS_ERROR = 'Unable to load reports. Check connection / browser shields.';
const BLOCKED_BROWSER_ERROR =
  'Unable to load reports. Disable Brave Shields / Tracking Prevention or try a normal browser window.';
const INDEX_REQUIRED_ERROR = 'Index required. Create Firestore index for studentId + createdAt.';
const TIMESTAMP_WARNING = 'Some reports are missing timestamps. Ask admin to migrate old records.';
const RULES_ALIGNMENT_ERROR =
  'Permission denied. Submitted values may not match Firestore rules. Refresh options and try again.';
const RATE_LIMIT_ERROR = 'Too many actions. Please wait a bit and try again.';

const functions = getFunctions(undefined, 'asia-southeast1');

async function appendReportPhotosViaCallable(reportId, photoUrls) {
  const callable = httpsCallable(functions, 'appendReportPhotos');
  const res = await callable({ reportId, photoUrls });
  const data = res?.data || {};
  return {
    success: Boolean(data.success),
    photoUrls: Array.isArray(data.photoUrls) ? data.photoUrls : [],
  };
}

function reportsCollection() {
  return collection(db, REPORTS_COLLECTION);
}

function logQueryStart(type, uid) {
  logInfo(`[reports] query start type=${type} uid=${uid}`);
}

function logQueryResult(count) {
  logInfo(`[reports] result count=${count}`);
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function normalizeDate(value) {
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

function mapReportDocument(docSnap) {
  const data = docSnap.data();
  const createdAtDate = normalizeDate(data[FIELD.CREATED_AT]);

  return {
    id: docSnap.id,
    [FIELD.STUDENT_ID]: data[FIELD.STUDENT_ID],
    [FIELD.STATUS]: normalizeStatus(data[FIELD.STATUS]),
    [FIELD.CREATED_AT]: createdAtDate,
    [FIELD.BUILDING]: data[FIELD.BUILDING] || '',
    [FIELD.FLOOR]: data[FIELD.FLOOR] || '',
    [FIELD.LOCATION]: data[FIELD.LOCATION] || '',
    [FIELD.ISSUE_TYPE]: normalizeIssueType(data[FIELD.ISSUE_TYPE]),
    [FIELD.RISK_LEVEL]: normalizeRiskLevel(data[FIELD.RISK_LEVEL]),
    [FIELD.DESCRIPTION]: data[FIELD.DESCRIPTION] || '',
    [FIELD.CREATED_BY_NAME]: data[FIELD.CREATED_BY_NAME] || '',
    photoUrl: data.photoUrl || '',
    photoUrls: Array.isArray(data.photoUrls) ? data.photoUrls : [],
    hasValidTimestamp: Boolean(createdAtDate),
  };
}

function sortByCreatedAtDesc(reports) {
  return [...reports].sort((a, b) => {
    const aDate = a[FIELD.CREATED_AT];
    const bDate = b[FIELD.CREATED_AT];
    const aTime = aDate instanceof Date ? aDate.getTime() : -1;
    const bTime = bDate instanceof Date ? bDate.getTime() : -1;
    return bTime - aTime;
  });
}

function getTodayRange() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  return {
    startDate: todayStart,
    endDate: tomorrowStart,
    start: Timestamp.fromDate(todayStart),
    end: Timestamp.fromDate(tomorrowStart),
  };
}

function isToday(dateValue, startDate, endDate) {
  if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return false;
  return dateValue >= startDate && dateValue < endDate;
}

function hasMissingTimestamps(reports) {
  return reports.some((report) => !(report[FIELD.CREATED_AT] instanceof Date));
}

function detectReportError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  const combined = `${code} ${message}`;

  if (combined.includes('resource-exhausted')) {
    return { code: 'rate-limit', message: RATE_LIMIT_ERROR };
  }

  const isBlocked =
    combined.includes('err_blocked_by_client') ||
    combined.includes('failed to fetch') ||
    combined.includes('tracking prevention') ||
    combined.includes('blocked access') ||
    combined.includes('blocked by client') ||
    combined.includes('storage');

  if (isBlocked) {
    return { code: 'blocked-client', message: BLOCKED_BROWSER_ERROR };
  }

  if (combined.includes('permission-denied')) {
    return { code: 'permission-denied', message: RULES_ALIGNMENT_ERROR };
  }

  if (code === 'failed-precondition' && combined.includes('index')) {
    return { code: 'index-required', message: INDEX_REQUIRED_ERROR };
  }

  return { code: 'query-failed', message: GENERIC_REPORTS_ERROR };
}

function isTimestampSortError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();

  if (code === 'failed-precondition' && message.includes('index')) {
    return false;
  }

  return (
    message.includes('order by') ||
    message.includes('orderby') ||
    message.includes('createdat') ||
    message.includes('timestamp') ||
    code === 'invalid-argument'
  );
}

async function fetchStudentReportsWithoutOrder(uid, limitSize = 300) {
  const fallbackQuery = query(reportsCollection(), where(FIELD.STUDENT_ID, '==', uid), limit(limitSize));
  const snapshot = await getDocs(fallbackQuery);
  return snapshot.docs.map(mapReportDocument);
}

async function runFallbackPagedQuery(uid, normalizedStatus, pageSize, cursor) {
  const fallbackReports = await fetchStudentReportsWithoutOrder(uid, 500);
  const filtered = fallbackReports.filter((report) => {
    if (!normalizedStatus) return true;
    return normalizeStatus(report[FIELD.STATUS]) === normalizedStatus;
  });
  const sorted = sortByCreatedAtDesc(filtered);
  const offset =
    cursor && typeof cursor === 'object' && Number.isInteger(cursor.__fallbackOffset)
      ? cursor.__fallbackOffset
      : 0;

  const pageReports = sorted.slice(offset, offset + pageSize);
  const hasMore = sorted.length > offset + pageSize;
  const nextCursor = hasMore ? { __fallbackOffset: offset + pageSize } : null;

  logQueryResult(pageReports.length);
  return {
    success: true,
    reports: pageReports,
    hasMore,
    nextCursor,
    warning: TIMESTAMP_WARNING,
    warningCode: 'missing-timestamp',
    fallback: true,
  };
}

export async function createStudentReport(uid, payload) {
  if (!uid) {
    return { success: false, error: 'Missing student uid.', errorCode: 'missing-uid' };
  }

  const formOptions = await getReportFormOptions();

  const normalizedPayload = {
    [FIELD.BUILDING]: String(payload?.[FIELD.BUILDING] || '').trim(),
    [FIELD.FLOOR]: String(payload?.[FIELD.FLOOR] || '').trim(),
    [FIELD.LOCATION]: String(payload?.[FIELD.LOCATION] || '').trim(),
    [FIELD.ISSUE_TYPE]: String(payload?.[FIELD.ISSUE_TYPE] || '').trim(),
    // Risk level is admin-managed; student submissions default to the lowest severity.
    [FIELD.RISK_LEVEL]: String(payload?.[FIELD.RISK_LEVEL] || '').trim() || 'low',
    [FIELD.DESCRIPTION]: String(payload?.[FIELD.DESCRIPTION] || '').trim(),
    [FIELD.CREATED_BY_NAME]: String(payload?.[FIELD.CREATED_BY_NAME] || '').trim(),
    [FIELD.REPORTER_SNAPSHOT]: payload?.[FIELD.REPORTER_SNAPSHOT] || null,
  };

  const validation = validateReportPayload(normalizedPayload, {
    allowedIssueTypes: formOptions.issueTypes,
    // Risk level is admin-managed; ensure validation accepts the enforced student default.
    allowedRiskLevels: Array.isArray(formOptions.riskLevels)
      ? Array.from(new Set([...formOptions.riskLevels, RISK_LEVEL.LOW]))
      : [RISK_LEVEL.LOW],
    allowedBuildings: formOptions.buildings,
    buildingFloors: formOptions.buildingFloors,
  });
  if (!validation.ok) {
    return {
      success: false,
      error: validation.errors[0],
      errors: validation.errors,
      errorCode: 'validation-error',
    };
  }
  const validatedPayload = validation.normalized || normalizedPayload;

  const reportDoc = {
    [FIELD.STUDENT_ID]: uid,
    [FIELD.STATUS]: STATUS.PENDING,
    [FIELD.CREATED_AT]: serverTimestamp(),
    [FIELD.UPDATED_AT]: serverTimestamp(),
    [FIELD.BUILDING]: validatedPayload[FIELD.BUILDING],
    [FIELD.FLOOR]: validatedPayload[FIELD.FLOOR],
    [FIELD.LOCATION]: validatedPayload[FIELD.LOCATION],
    [FIELD.ISSUE_TYPE]: validatedPayload[FIELD.ISSUE_TYPE],
    [FIELD.RISK_LEVEL]: validatedPayload[FIELD.RISK_LEVEL],
    [FIELD.DESCRIPTION]: validatedPayload[FIELD.DESCRIPTION],
    photoUrl: '',
    photoUrls: [],
  };

  if (hasValue(validatedPayload[FIELD.CREATED_BY_NAME])) {
    reportDoc[FIELD.CREATED_BY_NAME] = validatedPayload[FIELD.CREATED_BY_NAME];
  }

  if (validatedPayload[FIELD.REPORTER_SNAPSHOT] && typeof validatedPayload[FIELD.REPORTER_SNAPSHOT] === 'object') {
    reportDoc[FIELD.REPORTER_SNAPSHOT] = validatedPayload[FIELD.REPORTER_SNAPSHOT];
  }

  try {
    const docRef = await addDoc(reportsCollection(), reportDoc);

    return {
      success: true,
      reportId: docRef.id,
      report: {
        id: docRef.id,
        ...reportDoc,
        [FIELD.CREATED_AT]: new Date(),
      },
    };
  } catch (error) {
    logError('[reports] create error', error);
    const details = detectReportError(error);
    return { success: false, error: details.message, errorCode: details.code };
  }
}

export async function uploadStudentReportPhoto(uid, reportId, file, options = {}) {
  if (!uid || !reportId || !file) {
    return { success: false, error: 'Missing photo upload fields.', errorCode: 'missing-fields' };
  }

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  const mimeType = String(file.type || '');
  if (!REPORT_MEDIA.ALLOWED_IMAGE_MIME_TYPES.includes(mimeType)) {
    return {
      success: false,
      error: 'Photo must be a JPG, PNG, or WebP image.',
      errorCode: 'invalid-file-type',
    };
  }

  if (Number(file.size || 0) > REPORT_MEDIA.MAX_IMAGE_BYTES) {
    return { success: false, error: 'Photo must be 5MB or smaller.', errorCode: 'file-too-large' };
  }

  try {
    const safeName = String(file.name || 'photo')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .slice(0, 80);
    const storageRef = ref(storage, `reports/${reportId}/${Date.now()}-${safeName}`);

    const uploadTask = uploadBytesResumable(storageRef, file, {
      contentType: mimeType || 'image/jpeg',
    });

    await new Promise((resolve, reject) => {
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          if (!onProgress) return;
          try {
            onProgress({
              bytesTransferred: snapshot.bytesTransferred,
              totalBytes: snapshot.totalBytes,
              state: snapshot.state,
            });
          } catch (_) {
            // Best-effort only.
          }
        },
        (error) => reject(error),
        () => resolve()
      );
    });

    const url = await getDownloadURL(uploadTask.snapshot.ref);

    return {
      success: true,
      url,
      bytes: Number(file.size || 0),
    };
  } catch (error) {
    logError('[reports] photo upload failed', error);
    const details = detectReportError(error);
    return { success: false, error: details.message, errorCode: details.code };
  }
}

export async function setReportPhotoUrlsOnce(uid, reportId, photoUrls = []) {
  if (!uid || !reportId || !Array.isArray(photoUrls)) {
    return { success: false, error: 'Missing photo update fields.', errorCode: 'missing-fields' };
  }

  const cleaned = photoUrls
    .map((url) => String(url || '').trim())
    .filter(Boolean);

  if (!cleaned.length) {
    return { success: false, error: 'No photos to attach.', errorCode: 'missing-photos' };
  }

  if (cleaned.length > REPORT_MEDIA.MAX_IMAGES) {
    return { success: false, error: `You can upload up to ${REPORT_MEDIA.MAX_IMAGES} photos.`, errorCode: 'too-many-photos' };
  }

  try {
    const reportRef = doc(db, REPORTS_COLLECTION, reportId);
    const reportSnap = await getDoc(reportRef);
    if (!reportSnap.exists()) {
      return { success: false, error: 'Report not found.', errorCode: 'report-not-found' };
    }

    const existing = reportSnap.data() || {};
    if (existing[FIELD.STUDENT_ID] !== uid) {
      return { success: false, error: 'Permission denied.', errorCode: 'permission-denied' };
    }

    const hasPhotoUrl = typeof existing.photoUrl === 'string' && existing.photoUrl.trim().length > 0;
    const hasPhotoUrls = Array.isArray(existing.photoUrls) && existing.photoUrls.length > 0;
    if (hasPhotoUrl || hasPhotoUrls) {
      return { success: false, error: 'Photos already attached for this report.', errorCode: 'photo-already-set' };
    }

    const res = await appendReportPhotosViaCallable(reportId, cleaned.slice(0, REPORT_MEDIA.MAX_IMAGES));
    if (!res.success) {
      return { success: false, error: 'Unable to attach photos.', errorCode: 'attach-failed' };
    }
    return { success: true, photoUrls: res.photoUrls };
  } catch (error) {
    logError('[reports] photo urls update failed', error);
    const details = detectReportError(error);
    return { success: false, error: details.message, errorCode: details.code };
  }
}

export async function appendReportPhotoUrls(uid, reportId, photoUrlsToAdd = []) {
  if (!uid || !reportId || !Array.isArray(photoUrlsToAdd)) {
    return { success: false, error: 'Missing photo update fields.', errorCode: 'missing-fields' };
  }

  const additions = photoUrlsToAdd
    .map((url) => String(url || '').trim())
    .filter(Boolean);

  if (!additions.length) {
    return { success: false, error: 'No photos to attach.', errorCode: 'missing-photos' };
  }

  try {
    const res = await appendReportPhotosViaCallable(reportId, additions);
    if (!res.success) {
      return { success: false, error: 'Unable to attach photos.', errorCode: 'attach-failed' };
    }
    return { success: true, photoUrls: res.photoUrls };
  } catch (error) {
    logError('[reports] photo urls append failed', error);
    const details = detectReportError(error);
    return { success: false, error: details.message, errorCode: details.code };
  }
}

export async function setReportPhotoUrlOnce(uid, reportId, photoUrl) {
  const single = String(photoUrl || '').trim();
  if (!single) {
    return { success: false, error: 'Missing photo update fields.', errorCode: 'missing-fields' };
  }
  return setReportPhotoUrlsOnce(uid, reportId, [single]);
}

export async function getStudentReportsCounts(uid) {
  if (!uid) {
    return { success: false, error: 'Missing student uid.', errorCode: 'missing-uid', stats: null };
  }

  logQueryStart('counts', uid);

  try {
    const totalQuery = query(reportsCollection(), where(FIELD.STUDENT_ID, '==', uid));
    const pendingQuery = query(
      reportsCollection(),
      where(FIELD.STUDENT_ID, '==', uid),
      where(FIELD.STATUS, '==', STATUS.PENDING)
    );
    const inProgressQuery = query(
      reportsCollection(),
      where(FIELD.STUDENT_ID, '==', uid),
      where(FIELD.STATUS, '==', STATUS.IN_PROGRESS)
    );
    const resolvedQuery = query(
      reportsCollection(),
      where(FIELD.STUDENT_ID, '==', uid),
      where(FIELD.STATUS, '==', STATUS.RESOLVED)
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

    logQueryResult(stats.total);
    return { success: true, stats };
  } catch (error) {
    logError('[reports] counts error', error);
    const details = detectReportError(error);
    return { success: false, error: details.message, errorCode: details.code, stats: null };
  }
}

export async function getStudentReportsToday(uid) {
  if (!uid) {
    return { success: false, error: 'Missing student uid.', errorCode: 'missing-uid', reports: [] };
  }

  logQueryStart('today', uid);

  const { startDate, endDate, start, end } = getTodayRange();

  try {
    const todayQuery = query(
      reportsCollection(),
      where(FIELD.STUDENT_ID, '==', uid),
      where(FIELD.CREATED_AT, '>=', start),
      where(FIELD.CREATED_AT, '<', end),
      orderBy(FIELD.CREATED_AT, 'desc')
    );

    const snapshot = await getDocs(todayQuery);
    const reports = snapshot.docs.map(mapReportDocument);
    logQueryResult(reports.length);

    return {
      success: true,
      reports,
      warning: hasMissingTimestamps(reports) ? TIMESTAMP_WARNING : '',
      warningCode: hasMissingTimestamps(reports) ? 'missing-timestamp' : '',
    };
  } catch (error) {
    const details = detectReportError(error);
    if (details.code === 'index-required' || details.code === 'blocked-client') {
      logError('[reports] today query failed', error);
      return { success: false, error: details.message, errorCode: details.code, reports: [] };
    }

    if (!isTimestampSortError(error)) {
      logError('[reports] today query failed', error);
      return { success: false, error: details.message, errorCode: details.code, reports: [] };
    }

    try {
      const fallbackReports = await fetchStudentReportsWithoutOrder(uid);
      const todayReports = sortByCreatedAtDesc(
        fallbackReports.filter((report) => isToday(report[FIELD.CREATED_AT], startDate, endDate))
      );

      logQueryResult(todayReports.length);
      return {
        success: true,
        reports: todayReports,
        warning: TIMESTAMP_WARNING,
        warningCode: 'missing-timestamp',
        fallback: true,
      };
    } catch (fallbackError) {
      logError('[reports] today fallback failed', fallbackError);
      const fallbackDetails = detectReportError(fallbackError);
      return {
        success: false,
        error: fallbackDetails.message,
        errorCode: fallbackDetails.code,
        reports: [],
      };
    }
  }
}

export async function getStudentReportsPaged(uid, options = {}) {
  if (!uid) {
    return {
      success: false,
      error: 'Missing student uid.',
      errorCode: 'missing-uid',
      reports: [],
      hasMore: false,
      nextCursor: null,
    };
  }

  const pageSize = Number.isInteger(options.pageSize) ? options.pageSize : 10;
  const cursor = options.cursor || null;
  const normalizedStatus = options.status ? normalizeStatus(options.status) : '';

  logQueryStart('paged', uid);

  const hasFallbackCursor =
    cursor && typeof cursor === 'object' && Number.isInteger(cursor.__fallbackOffset);
  if (hasFallbackCursor) {
    try {
      return await runFallbackPagedQuery(uid, normalizedStatus, pageSize, cursor);
    } catch (fallbackError) {
      logError('[reports] paged fallback cursor query failed', fallbackError);
      const fallbackDetails = detectReportError(fallbackError);
      return {
        success: false,
        error: fallbackDetails.message,
        errorCode: fallbackDetails.code,
        reports: [],
        hasMore: false,
        nextCursor: null,
      };
    }
  }

  try {
    const constraints = [where(FIELD.STUDENT_ID, '==', uid)];
    if (normalizedStatus) {
      constraints.push(where(FIELD.STATUS, '==', normalizedStatus));
    }
    constraints.push(orderBy(FIELD.CREATED_AT, 'desc'));
    constraints.push(limit(pageSize + 1));

    // Skip startAfter when using fallback cursor object.
    if (cursor && !(typeof cursor === 'object' && '__fallbackOffset' in cursor)) {
      constraints.push(startAfter(cursor));
    }

    const pagedQuery = query(reportsCollection(), ...constraints);
    const snapshot = await getDocs(pagedQuery);
    const docs = snapshot.docs;

    const hasMore = docs.length > pageSize;
    const pageDocs = hasMore ? docs.slice(0, pageSize) : docs;
    const reports = pageDocs.map(mapReportDocument);
    const nextCursor = pageDocs.length ? pageDocs[pageDocs.length - 1] : null;

    logQueryResult(reports.length);

    return {
      success: true,
      reports,
      hasMore,
      nextCursor,
      warning: hasMissingTimestamps(reports) ? TIMESTAMP_WARNING : '',
      warningCode: hasMissingTimestamps(reports) ? 'missing-timestamp' : '',
    };
  } catch (error) {
    const details = detectReportError(error);
    if (details.code === 'index-required' || details.code === 'blocked-client') {
      logError('[reports] paged query failed', error);
      return {
        success: false,
        error: details.message,
        errorCode: details.code,
        reports: [],
        hasMore: false,
        nextCursor: null,
      };
    }

    if (!isTimestampSortError(error)) {
      logError('[reports] paged query failed', error);
      return {
        success: false,
        error: details.message,
        errorCode: details.code,
        reports: [],
        hasMore: false,
        nextCursor: null,
      };
    }

    try {
      return await runFallbackPagedQuery(uid, normalizedStatus, pageSize, cursor);
    } catch (fallbackError) {
      logError('[reports] paged fallback failed', fallbackError);
      const fallbackDetails = detectReportError(fallbackError);
      return {
        success: false,
        error: fallbackDetails.message,
        errorCode: fallbackDetails.code,
        reports: [],
        hasMore: false,
        nextCursor: null,
      };
    }
  }
}
