/**
 * Report media helpers (R1/R2/R8)
 * - Students: append report photo URLs to their own report (max 3)
 * - Admins: sync photo URLs from Storage into a report doc (repair tool)
 */

const { onCall, HttpsError } = require('firebase-functions/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const crypto = require('crypto');

const { COLLECTIONS } = require('./constants');
const { ensureActiveUser, ensureAdmin } = require('./auth');
const { enforceRateLimit, getPolicyForCallable } = require('./rateLimit');

const db = getFirestore();
const storage = getStorage();

async function enforceCallableRateLimit(request, callableName) {
  const uid = request?.auth?.uid;
  const policy = getPolicyForCallable({ callableName, data: request?.data });
  const policies = Array.isArray(policy) ? policy : [policy];
  for (const entry of policies) {
    await enforceRateLimit({
      db,
      uid,
      action: entry.action,
      windowSec: entry.windowSec,
      max: entry.max,
      extraKey: entry.extraKey,
    });
  }
}

const MAX_REPORT_PHOTOS = 3;
const MAX_URL_LENGTH = 1500;

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeHttpsUrl(url) {
  const value = normalizeText(url);
  if (!value) return '';
  if (value.length > MAX_URL_LENGTH) {
    throw new HttpsError('invalid-argument', 'Photo URL is too long');
  }
  if (!value.startsWith('https://')) {
    throw new HttpsError('invalid-argument', 'Photo URL must be https');
  }
  return value;
}

function uniqueUrls(urls) {
  const out = [];
  const seen = new Set();
  urls.forEach((u) => {
    const v = normalizeHttpsUrl(u);
    if (!v) return;
    if (seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  return out;
}

exports.appendReportPhotos = onCall({ region: 'asia-southeast1' }, async (request) => {
  await ensureActiveUser(request);
  await enforceCallableRateLimit(request, 'appendReportPhotos');

  const uid = request.auth.uid;
  const reportId = normalizeText(request.data?.reportId);
  const photoUrls = request.data?.photoUrls;

  if (!reportId || reportId.length < 8 || reportId.length > 128) {
    throw new HttpsError('invalid-argument', 'Report ID is invalid');
  }

  if (!Array.isArray(photoUrls)) {
    throw new HttpsError('invalid-argument', 'photoUrls must be an array');
  }

  const additions = uniqueUrls(photoUrls);
  if (!additions.length) {
    throw new HttpsError('invalid-argument', 'No photos to attach');
  }

  if (additions.length > MAX_REPORT_PHOTOS) {
    throw new HttpsError('invalid-argument', `You can upload up to ${MAX_REPORT_PHOTOS} photos`);
  }

  const reportRef = db.collection(COLLECTIONS.REPORTS).doc(reportId);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(reportRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Report not found');
    }

    const report = snap.data() || {};
    const owner = normalizeText(report.studentId);
    if (!owner || owner !== uid) {
      throw new HttpsError('permission-denied', 'Permission denied');
    }

    const current = Array.isArray(report.photoUrls)
      ? report.photoUrls.map((u) => normalizeText(u)).filter(Boolean)
      : [];

    const merged = [...current];
    additions.forEach((url) => {
      if (merged.length >= MAX_REPORT_PHOTOS) return;
      if (merged.includes(url)) return;
      merged.push(url);
    });

    if (merged.length > MAX_REPORT_PHOTOS) {
      throw new HttpsError('failed-precondition', `You can upload up to ${MAX_REPORT_PHOTOS} photos`);
    }

    tx.update(reportRef, {
      photoUrls: merged,
      photoUrl: merged[0] || '',
      updatedAt: FieldValue.serverTimestamp(),
    });

    return merged;
  });

  return { success: true, photoUrls: result };
});

function buildDownloadUrl(bucketName, objectPath, token) {
  const encoded = encodeURIComponent(objectPath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encoded}?alt=media&token=${token}`;
}

async function ensureDownloadToken(file) {
  const [metadata] = await file.getMetadata();
  const custom = metadata && metadata.metadata ? metadata.metadata : {};
  const existing = normalizeText(custom.firebaseStorageDownloadTokens);
  if (existing) {
    // Tokens can be comma-separated.
    return existing.split(',')[0].trim();
  }

  const token = crypto.randomUUID();
  await file.setMetadata({
    metadata: {
      ...custom,
      firebaseStorageDownloadTokens: token,
    },
  });
  return token;
}

exports.syncReportPhotosFromStorage = onCall({ region: 'asia-southeast1' }, async (request) => {
  await ensureAdmin(request);
  await enforceCallableRateLimit(request, 'syncReportPhotosFromStorage');

  const reportId = normalizeText(request.data?.reportId);
  if (!reportId || reportId.length < 8 || reportId.length > 128) {
    throw new HttpsError('invalid-argument', 'Report ID is invalid');
  }

  const prefix = `reports/${reportId}/`;
  const bucket = storage.bucket();
  const [files] = await bucket.getFiles({ prefix });

  if (!files || files.length === 0) {
    return { success: true, photoUrls: [], scanned: 0 };
  }

  // Stable order (by name). Cap to 3.
  const sorted = [...files].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const chosen = sorted.slice(0, MAX_REPORT_PHOTOS);

  const urls = [];
  for (const file of chosen) {
    try {
      const token = await ensureDownloadToken(file);
      urls.push(buildDownloadUrl(bucket.name, file.name, token));
    } catch (error) {
      console.warn('syncReportPhotosFromStorage: file skipped', file.name, error);
    }
  }

  const reportRef = db.collection(COLLECTIONS.REPORTS).doc(reportId);
  await reportRef.update({
    photoUrls: urls,
    photoUrl: urls[0] || '',
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { success: true, photoUrls: urls, scanned: files.length };
});
