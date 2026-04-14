const { HttpsError } = require('firebase-functions/https');
const { FieldValue } = require('firebase-admin/firestore');

const RATE_LIMITS_COLLECTION = 'rate_limits';

function normalizeKeyPart(value) {
  const text = String(value == null ? '' : value).trim();
  return text || 'default';
}

function buildDocId({ uid, action, extraKey }) {
  const baseKey = `${uid}:${action}:${extraKey || 'default'}`;
  const safe = baseKey.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 400);
  return safe;
}

async function enforceRateLimit({ db, uid, action, windowSec, max, extraKey }) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const normalizedAction = normalizeKeyPart(action);
  const normalizedExtraKey = normalizeKeyPart(extraKey);

  const sec = Number(windowSec);
  const maxCount = Number(max);
  if (!Number.isFinite(sec) || sec <= 0) {
    throw new HttpsError('internal', 'Rate limit window is invalid.');
  }
  if (!Number.isFinite(maxCount) || maxCount <= 0) {
    throw new HttpsError('internal', 'Rate limit max is invalid.');
  }

  const epochSeconds = Math.floor(Date.now() / 1000);
  const windowKey = Math.floor(epochSeconds / sec);
  const docId = buildDocId({ uid: normalizedUid, action: normalizedAction, extraKey: normalizedExtraKey });

  const ref = db.collection(RATE_LIMITS_COLLECTION).doc(docId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, {
        uid: normalizedUid,
        action: normalizedAction,
        extraKey: normalizedExtraKey,
        windowKey,
        count: 1,
        firstSeenAt: FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    const data = snap.data() || {};

    // New time window: reset counter in-place to avoid creating a new document per window.
    if (Number(data.windowKey) !== windowKey) {
      tx.set(ref, {
        uid: normalizedUid,
        action: normalizedAction,
        extraKey: normalizedExtraKey,
        windowKey,
        count: 1,
        firstSeenAt: FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    const count = Number(data.count || 0);
    if (count >= maxCount) {
      throw new HttpsError('resource-exhausted', 'Too many actions. Please try again later.');
    }

    tx.update(ref, {
      count: FieldValue.increment(1),
      lastSeenAt: FieldValue.serverTimestamp(),
    });
  });
}

const DEFAULT_POLICY = Object.freeze({
  action: 'default',
  windowSec: 600,
  max: 60,
});

function buildPhotoLinkPolicies(data) {
  const reportId = normalizeKeyPart(data && data.reportId);
  return [
    { action: 'photo_link', windowSec: 600, max: 6, extraKey: reportId },
    { action: 'photo_link_daily', windowSec: 86400, max: 30, extraKey: reportId },
  ];
}

const EXACT_POLICIES = Object.freeze({
  // Photo attach/link callables.
  appendReportPhotos: buildPhotoLinkPolicies,

  // Maintenance task lifecycle.
  acceptTask: { action: 'task_status_change', windowSec: 60, max: 10 },
  startTask: { action: 'task_status_change', windowSec: 60, max: 10 },
  markTaskDone: { action: 'task_status_change', windowSec: 60, max: 10 },

  // Admin task assignment.
  assignTask: { action: 'task_assign', windowSec: 600, max: 30 },

  // Announcements.
  createAnnouncement: { action: 'announcement_create', windowSec: 3600, max: 5 },
  deleteAnnouncementByAdmin: { action: 'announcement_delete', windowSec: 3600, max: 20 },

  // Additional expensive/sensitive operations.
  syncReportPhotosFromStorage: { action: 'photo_sync', windowSec: 600, max: 10 },
  getAnalytics: { action: 'analytics', windowSec: 60, max: 10 },
  createUserByAdmin: { action: 'user_provision', windowSec: 3600, max: 10 },
  resendInviteByAdmin: { action: 'invite_resend', windowSec: 3600, max: 20 },
  bootstrapFirstSuperAdmin: { action: 'bootstrap', windowSec: 600, max: 5 },
  logUnprovisionedLogin: { action: 'unprovisioned_login', windowSec: 600, max: 10 },
});

function policyFromExact(callableName, data) {
  const entry = EXACT_POLICIES[callableName];
  if (!entry) return null;
  if (typeof entry === 'function') {
    return entry(data);
  }
  return entry;
}

function policyFromPatterns(callableName, data) {
  const name = String(callableName || '').trim();
  if (!name) return null;

  // Fallback: treat any future photo-link callables with the same dual policy.
  if (/photo/i.test(name) && (/append/i.test(name) || /sync/i.test(name) || /upload/i.test(name))) {
    return buildPhotoLinkPolicies(data);
  }

  // Fallback: task status changes.
  if (/task/i.test(name) && /(accept|start|done|complete)/i.test(name)) {
    return { action: 'task_status_change', windowSec: 60, max: 10 };
  }

  return null;
}

function getPolicyForCallable({ callableName, data } = {}) {
  const name = String(callableName || '').trim();
  if (!name) return DEFAULT_POLICY;

  return (
    policyFromExact(name, data) ||
    policyFromPatterns(name, data) ||
    DEFAULT_POLICY
  );
}

module.exports = {
  enforceRateLimit,
  getPolicyForCallable,
};
