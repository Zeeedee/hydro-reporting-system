import { db } from './firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import {
  ANNOUNCEMENT_AUDIENCE,
  ANNOUNCEMENT_FIELDS,
  ANNOUNCEMENT_TYPES,
  COLLECTIONS,
  ROLES,
} from './config/app-constants.js';
import { formatTimestampManila } from './timezone.js';
import { handleRateLimitError } from './shared/rate-limit-ui.js';
import { logError } from './shared/logger.js';

const ANNOUNCEMENTS_COLLECTION = COLLECTIONS.ANNOUNCEMENTS;
const DEFAULT_LIMIT = 40;

const functions = getFunctions(undefined, 'asia-southeast1');

export const NOTIFICATION_TYPES = ANNOUNCEMENT_TYPES;

const LEGACY_TYPE_MAP = Object.freeze({
  urgent_alert: NOTIFICATION_TYPES.ALERT,
  urgent: NOTIFICATION_TYPES.ALERT,
  planned_maintenance: NOTIFICATION_TYPES.MAINTENANCE,
  maintenance: NOTIFICATION_TYPES.MAINTENANCE,
  planned: NOTIFICATION_TYPES.MAINTENANCE,
  update: NOTIFICATION_TYPES.UPDATE,
  general: NOTIFICATION_TYPES.GENERAL,
});

const GENERIC_NOTIFICATIONS_ERROR = 'Unable to load announcements.';
const BLOCKED_NOTIFICATIONS_ERROR =
  'Unable to load announcements. Disable Brave Shields / Tracking Prevention or try a normal window.';
const INDEX_NOTIFICATIONS_ERROR = 'Index required: create composite index for announcements(createdAt).';

function normalizeType(typeInput, categoryInput) {
  const raw = String(typeInput || categoryInput || '').trim().toLowerCase();
  if (!raw) return NOTIFICATION_TYPES.GENERAL;
  return LEGACY_TYPE_MAP[raw] || LEGACY_TYPE_MAP[raw.replace(/[\s-]+/g, '_')] || NOTIFICATION_TYPES.UPDATE;
}

function normalizeDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    const parsed = new Date(value.seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeNotification(docSnap) {
  const data = docSnap.data() || {};
  const type = normalizeType(data.type, data.category);
  const message = String(data[ANNOUNCEMENT_FIELDS.BODY] || data.body || data.description || '').trim();
  const isActive = data[ANNOUNCEMENT_FIELDS.IS_ACTIVE] !== false;

  return {
    id: docSnap.id,
    type,
    title: String(data[ANNOUNCEMENT_FIELDS.TITLE] || data.subject || 'Announcement'),
    message,
    createdAt: normalizeDate(data.createdAt) || new Date(),
    expiresAt: normalizeDate(data.expiresAt),
    scheduledDate: normalizeDate(data.scheduledDate),
    audience: String(data[ANNOUNCEMENT_FIELDS.AUDIENCE] || ANNOUNCEMENT_AUDIENCE.ALL),
    isActive,
    pinned: data[ANNOUNCEMENT_FIELDS.PINNED] === true,
    raw: data,
  };
}

function splitByType(notifications) {
  const urgent = [];
  const maintenance = [];
  const updates = [];

  notifications.forEach((item) => {
    if (item.type === NOTIFICATION_TYPES.ALERT) {
      urgent.push(item);
      return;
    }
    if (item.type === NOTIFICATION_TYPES.MAINTENANCE) {
      maintenance.push(item);
      return;
    }
    updates.push(item);
  });

  return { urgent, maintenance, updates };
}

function isVisibleToRole(item, role = 'student') {
  const audience = String(item?.audience || ANNOUNCEMENT_AUDIENCE.ALL);
  if (audience === ANNOUNCEMENT_AUDIENCE.ALL) return true;
  if (role === ROLES.MAINTENANCE) {
    return audience === ANNOUNCEMENT_AUDIENCE.MAINTENANCE;
  }
  if (role === ROLES.ADMIN || role === ROLES.SUPER_ADMIN) {
    return audience === ANNOUNCEMENT_AUDIENCE.ADMIN || audience === ANNOUNCEMENT_AUDIENCE.SUPER_ADMIN;
  }
  return audience === ANNOUNCEMENT_AUDIENCE.STUDENT;
}

function detectNotificationsError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  const combined = `${code} ${message}`;

  const isBlocked =
    combined.includes('err_blocked_by_client') ||
    combined.includes('blocked by client') ||
    combined.includes('tracking prevention') ||
    combined.includes('failed to fetch') ||
    combined.includes('network');

  if (isBlocked) {
    return { code: 'blocked-client', message: BLOCKED_NOTIFICATIONS_ERROR };
  }
  if (code.includes('failed-precondition') && combined.includes('index')) {
    return { code: 'index-required', message: INDEX_NOTIFICATIONS_ERROR };
  }

  return { code: 'query-failed', message: GENERIC_NOTIFICATIONS_ERROR };
}

async function fetchActiveNotifications(maxResults = DEFAULT_LIMIT, role = ROLES.USER) {
  const audienceTargets = role === ROLES.MAINTENANCE
    ? [ANNOUNCEMENT_AUDIENCE.ALL, ANNOUNCEMENT_AUDIENCE.MAINTENANCE]
    : role === ROLES.ADMIN || role === ROLES.SUPER_ADMIN
      ? [ANNOUNCEMENT_AUDIENCE.ALL, ANNOUNCEMENT_AUDIENCE.ADMIN, ANNOUNCEMENT_AUDIENCE.SUPER_ADMIN]
      : [ANNOUNCEMENT_AUDIENCE.ALL, ANNOUNCEMENT_AUDIENCE.STUDENT];

  const announcementsQuery = query(
    collection(db, ANNOUNCEMENTS_COLLECTION),
    where('isActive', '==', true),
    where('audience', 'in', audienceTargets),
    orderBy('createdAt', 'desc'),
    limit(maxResults)
  );

  const snapshot = await getDocs(announcementsQuery);
  return snapshot.docs
    .map((docSnap) => normalizeNotification(docSnap))
    .filter((item) => item.isActive);
}

export async function getActiveNotifications(maxResults = DEFAULT_LIMIT, role = ROLES.USER) {
  try {
    const notifications = await fetchActiveNotifications(maxResults, role);
    return { success: true, notifications };
  } catch (error) {
    logError('[notifications] fetch failed', error);
    const details = detectNotificationsError(error);
    return { success: false, error: details.message, errorCode: details.code, notifications: [] };
  }
}

export async function getUrgentAlerts(maxResults = 10) {
  const result = await getActiveNotifications(Math.max(maxResults * 3, DEFAULT_LIMIT), ROLES.USER);
  if (!result.success) {
    return { ...result, alerts: [] };
  }
  const { urgent } = splitByType(result.notifications);
  return { success: true, alerts: urgent.slice(0, maxResults), notifications: urgent.slice(0, maxResults) };
}

export async function getPlannedMaintenance(maxResults = 20) {
  const result = await getActiveNotifications(Math.max(maxResults * 3, DEFAULT_LIMIT), ROLES.USER);
  if (!result.success) {
    return { ...result, maintenance: [] };
  }
  const { maintenance } = splitByType(result.notifications);
  return { success: true, maintenance: maintenance.slice(0, maxResults), notifications: maintenance.slice(0, maxResults) };
}

export async function getNotificationsFeed({ urgentLimit = 10, maintenanceLimit = 20, role = ROLES.USER } = {}) {
  const result = await getActiveNotifications(DEFAULT_LIMIT, role);
  if (!result.success) {
    return {
      success: false,
      error: result.error,
      errorCode: result.errorCode,
      urgent: [],
      maintenance: [],
    };
  }

  const allowed = result.notifications.filter((item) => isVisibleToRole(item, role));
  const split = splitByType(allowed);
  return {
    success: true,
    urgent: split.urgent.slice(0, urgentLimit),
    maintenance: split.maintenance.slice(0, maintenanceLimit),
  };
}

export function subscribeToNotifications(onUpdate, maxResults = DEFAULT_LIMIT) {
  const audienceTargets = [ANNOUNCEMENT_AUDIENCE.ALL, ANNOUNCEMENT_AUDIENCE.STUDENT];
  const notificationsQuery = query(
    collection(db, ANNOUNCEMENTS_COLLECTION),
    where('isActive', '==', true),
    where('audience', 'in', audienceTargets),
    orderBy('createdAt', 'desc'),
    limit(maxResults)
  );

  return onSnapshot(
    notificationsQuery,
    (snapshot) => {
      const notifications = snapshot.docs
        .map((docSnap) => normalizeNotification(docSnap))
        .filter((item) => item.isActive);
      const split = splitByType(notifications);
      onUpdate({
        notifications,
        urgent: split.urgent,
        maintenance: split.maintenance,
        updates: split.updates,
        hasNew: snapshot.docChanges().some((change) => change.type === 'added'),
      });
    },
    (error) => {
      logError('[notifications] subscribe failed', error);
      const details = detectNotificationsError(error);
      onUpdate({
        notifications: [],
        urgent: [],
        maintenance: [],
        updates: [],
        hasNew: false,
        error: details.message,
        errorCode: details.code,
      });
    }
  );
}

export function formatNotificationTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

  return formatTimestampManila(date, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    hour: undefined,
    minute: undefined,
  });
}

// ==================== UNREAD / SEEN (CALLABLES) ====================

export async function getUnreadAnnouncementsCount() {
  try {
    const callable = httpsCallable(functions, 'getUnreadAnnouncementsCount');
    const result = await callable({});
    const count = Number(result?.data?.unreadCount || 0);
    return { success: true, unreadCount: Number.isFinite(count) ? count : 0 };
  } catch (error) {
    logError('[notifications] unread count failed', error);
    handleRateLimitError(error);
    return { success: false, unreadCount: 0 };
  }
}

export async function markAnnouncementsSeen() {
  try {
    const callable = httpsCallable(functions, 'markAnnouncementsSeen');
    await callable({});
    return { success: true };
  } catch (error) {
    logError('[notifications] mark seen failed', error);
    handleRateLimitError(error);
    return { success: false };
  }
}

export async function getAnnouncementsList({ limit: maxResults = DEFAULT_LIMIT, role = ROLES.USER } = {}) {
  const result = await getActiveNotifications(maxResults, role);
  if (!result.success) {
    return { success: false, error: result.error, errorCode: result.errorCode, announcements: [] };
  }

  const allowed = result.notifications.filter((item) => isVisibleToRole(item, role));
  const sorted = [...allowed].sort((a, b) => {
    const pinnedDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pinnedDiff !== 0) return pinnedDiff;
    const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
    const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
    return bTime - aTime;
  });

  return { success: true, announcements: sorted };
}

export function getNotificationIcon(type) {
  if (type === NOTIFICATION_TYPES.ALERT) return 'fa-solid fa-triangle-exclamation';
  if (type === NOTIFICATION_TYPES.MAINTENANCE) return 'fa-solid fa-calendar-check';
  return 'fa-solid fa-circle-info';
}

export function getNotificationClass(type) {
  if (type === NOTIFICATION_TYPES.ALERT) return 'urgent';
  if (type === NOTIFICATION_TYPES.MAINTENANCE) return 'planned';
  return '';
}
