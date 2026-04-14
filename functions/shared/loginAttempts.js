const crypto = require('node:crypto');
const { onCall, HttpsError } = require('firebase-functions/https');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { enforceRateLimit } = require('./rateLimit');

const db = getFirestore();

const COLLECTION = 'login_attempts';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRegex.test(email)) {
    throw new HttpsError('invalid-argument', 'A valid email is required.');
  }
  return email;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function getClientIp(request) {
  const raw = request?.rawRequest;
  const xf = String(raw?.headers?.['x-forwarded-for'] || '').trim();
  if (xf) {
    const first = xf.split(',')[0].trim();
    if (first) return first;
  }
  const direct = String(raw?.ip || raw?.socket?.remoteAddress || '').trim();
  if (direct) return direct;

  const fallback = String(request?.data?.ip || '').trim();
  return fallback || 'unknown';
}

function buildDocId(email, ip) {
  const emailHash = sha256(email);
  const ipHash = sha256(ip);
  return `${emailHash}_${ipHash}`;
}

function lockUntilTimestamp(nowMs) {
  return Timestamp.fromMillis(nowMs + LOCK_MINUTES * 60 * 1000);
}

exports.checkLoginAllowed = onCall({ region: 'asia-southeast1' }, async (request) => {
  const email = normalizeEmail(request?.data?.email);
  const ip = getClientIp(request);

  await enforceRateLimit({
    db,
    uid: `ip:${ip}`,
    action: 'login_check',
    windowSec: 60,
    max: 60,
    extraKey: sha256(email).slice(0, 16),
  });

  const ref = db.collection(COLLECTION).doc(buildDocId(email, ip));
  const snap = await ref.get();
  const data = snap.exists ? (snap.data() || {}) : {};

  const lockedUntil = data.lockedUntil;
  if (lockedUntil && typeof lockedUntil.toMillis === 'function') {
    const untilMs = lockedUntil.toMillis();
    if (untilMs > Date.now()) {
      return { allowed: false, lockedUntil: untilMs };
    }
  }

  return { allowed: true };
});

exports.recordLoginAttempt = onCall({ region: 'asia-southeast1' }, async (request) => {
  const email = normalizeEmail(request?.data?.email);
  const ip = getClientIp(request);
  const success = request?.data?.success;

  if (typeof success !== 'boolean') {
    throw new HttpsError('invalid-argument', 'success must be a boolean');
  }

  await enforceRateLimit({
    db,
    uid: `ip:${ip}`,
    action: 'login_record',
    windowSec: 60,
    max: 120,
    extraKey: sha256(email).slice(0, 16),
  });

  const nowMs = Date.now();
  const nowTs = Timestamp.fromMillis(nowMs);
  const ref = db.collection(COLLECTION).doc(buildDocId(email, ip));

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? (snap.data() || {}) : {};

    const lockedUntil = existing.lockedUntil;
    const lockedUntilMs = lockedUntil && typeof lockedUntil.toMillis === 'function'
      ? lockedUntil.toMillis()
      : 0;

    if (success) {
      // Budget optimization: don't create or keep writing "clean" docs.
      // Only write when we need to clear a lockout window or failed attempt counters.
      if (!snap.exists) {
        return;
      }

      const failedCount = Number(existing.failedCount || 0);
      if (failedCount === 0 && !existing.lockedUntil) {
        return;
      }

      tx.set(ref, {
        emailHash: sha256(email),
        ipHash: sha256(ip),
        failedCount: 0,
        firstFailedAt: null,
        lastFailedAt: null,
        lockedUntil: null,
        lastSuccessAt: nowTs,
        lastAttemptAt: nowTs,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    // If already locked, keep the lock window.
    if (lockedUntilMs > nowMs) {
      tx.set(ref, {
        emailHash: sha256(email),
        ipHash: sha256(ip),
        lastAttemptAt: nowTs,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    const firstFailedAt = existing.firstFailedAt;
    const firstFailedMs = firstFailedAt && typeof firstFailedAt.toMillis === 'function'
      ? firstFailedAt.toMillis()
      : 0;
    const windowMs = LOCK_MINUTES * 60 * 1000;
    const inWindow = firstFailedMs > 0 && (nowMs - firstFailedMs) <= windowMs;

    const prevCount = Number(existing.failedCount || 0);
    const nextCount = inWindow ? (prevCount + 1) : 1;

    const updates = {
      emailHash: sha256(email),
      ipHash: sha256(ip),
      failedCount: nextCount,
      firstFailedAt: inWindow ? firstFailedAt : nowTs,
      lastFailedAt: nowTs,
      lastAttemptAt: nowTs,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (nextCount >= MAX_FAILED) {
      updates.lockedUntil = lockUntilTimestamp(nowMs);
    }

    tx.set(ref, updates, { merge: true });
  });

  return { success: true };
});
