const { onCall, HttpsError } = require('firebase-functions/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const crypto = require('crypto');
const { COLLECTIONS, SYSTEM_CONFIG_DOCS, USER_STATUS } = require('../shared/constants');
const { ROLES } = require('../shared/auth');
const { writeAuditLog } = require('../shared/audit');
const { enforceRateLimit: enforceGlobalRateLimit, getPolicyForCallable } = require('../shared/rateLimit');

const db = getFirestore();
const adminAuth = getAuth();

function normalizeBootstrapKey(value) {
    return String(value || '').trim();
}

function hashBootstrapKey(value) {
    return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

async function enforceRateLimit(uid) {
    const rateRef = db.collection(COLLECTIONS.SECURITY_LOGS).doc(`bootstrap_${uid}`);

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(rateRef);
        const nowMs = Date.now();
        const windowMs = 60 * 1000;
        const maxAttempts = 5;

        const data = snap.exists ? (snap.data() || {}) : {};
        const windowStartedAt = data.windowStartedAt?.toMillis ? data.windowStartedAt.toMillis() : 0;
        const attempts = Number(data.attempts || 0);

        const sameWindow = nowMs - windowStartedAt < windowMs;
        const nextAttempts = sameWindow ? attempts + 1 : 1;

        if (sameWindow && nextAttempts > maxAttempts) {
            throw new HttpsError('resource-exhausted', 'Too many bootstrap attempts. Please wait and retry.');
        }

        tx.set(rateRef, {
            attempts: nextAttempts,
            windowStartedAt: sameWindow ? data.windowStartedAt : FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            uid,
        }, { merge: true });
    });
}

async function enforceCallableRateLimit(request, callableName) {
    const uid = request?.auth?.uid;
    const policy = getPolicyForCallable({ callableName, data: request?.data });
    const policies = Array.isArray(policy) ? policy : [policy];
    for (const entry of policies) {
        await enforceGlobalRateLimit({
            db,
            uid,
            action: entry.action,
            windowSec: entry.windowSec,
            max: entry.max,
            extraKey: entry.extraKey,
        });
    }
}

exports.bootstrapFirstSuperAdmin = onCall({ region: 'asia-southeast1' }, async (request) => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const uid = request.auth.uid;
    await enforceCallableRateLimit(request, 'bootstrapFirstSuperAdmin');
    await enforceRateLimit(uid);

    const bootstrapKey = normalizeBootstrapKey(request.data?.bootstrapKey);
    if (!bootstrapKey || bootstrapKey.length < 12 || bootstrapKey.length > 128 || !/^[A-Za-z0-9_-]+$/.test(bootstrapKey)) {
        console.warn('[bootstrap] invalid key format from', uid);
        throw new HttpsError('invalid-argument', 'Invalid bootstrap key format.');
    }

    const bootstrapRef = db.collection(COLLECTIONS.SYSTEM_CONFIG).doc(SYSTEM_CONFIG_DOCS.BOOTSTRAP);
    const bootstrapSnap = await bootstrapRef.get();
    if (!bootstrapSnap.exists) {
        throw new HttpsError('failed-precondition', 'Bootstrap is not armed.');
    }

    const bootstrapConfig = bootstrapSnap.data() || {};
    if (bootstrapConfig.bootstrapEnabled !== true) {
        throw new HttpsError('failed-precondition', 'Bootstrap already completed.');
    }

    const expectedHash = String(bootstrapConfig.bootstrapSecretHash || '').trim().toLowerCase();
    const providedHash = hashBootstrapKey(bootstrapKey).toLowerCase();
    if (!expectedHash || expectedHash !== providedHash) {
        console.warn('[bootstrap] key mismatch for uid', uid);
        throw new HttpsError('permission-denied', 'Invalid bootstrap key.');
    }

    const superAdminSnap = await db.collection(COLLECTIONS.USERS)
        .where('role', '==', ROLES.SUPER_ADMIN)
        .limit(1)
        .get();

    if (!superAdminSnap.empty) {
        await bootstrapRef.set({
            bootstrapEnabled: false,
            lockedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        throw new HttpsError('failed-precondition', 'Bootstrap already completed.');
    }

    const authUser = await adminAuth.getUser(uid);
    const email = String(authUser?.email || request.auth.token?.email || '').trim().toLowerCase();
    if (!email) {
        throw new HttpsError('failed-precondition', 'Authenticated account has no email.');
    }

    const userRef = db.collection(COLLECTIONS.USERS).doc(uid);
    await userRef.set({
        email,
        role: ROLES.SUPER_ADMIN,
        status: USER_STATUS.ACTIVE,
        activated: true,
        invitedAt: FieldValue.serverTimestamp(),
        activatedAt: FieldValue.serverTimestamp(),
        createdBy: 'system_bootstrap',
        isArchived: false,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await bootstrapRef.set({
        bootstrapEnabled: false,
        lockedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await writeAuditLog('superadmin_bootstrap', {
        actorUid: uid,
        actorName: email ? String(email).split('@')[0] : 'Unknown',
        actorEmail: email,
        result: 'success',
    }, { bestEffort: true });

    return {
        success: true,
        role: ROLES.SUPER_ADMIN,
        message: 'Bootstrap completed. Redirecting to admin dashboard.',
    };
});

exports.getBootstrapStatus = onCall({ region: 'asia-southeast1' }, async (request) => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Authentication required');
    }

    await enforceCallableRateLimit(request, 'getBootstrapStatus');
    const bootstrapRef = db.collection(COLLECTIONS.SYSTEM_CONFIG).doc(SYSTEM_CONFIG_DOCS.BOOTSTRAP);
    const bootstrapSnap = await bootstrapRef.get();
    const bootstrapConfig = bootstrapSnap.exists ? (bootstrapSnap.data() || {}) : {};

    const superAdminSnap = await db.collection(COLLECTIONS.USERS)
        .where('role', '==', ROLES.SUPER_ADMIN)
        .limit(1)
        .get();

    return {
        bootstrapDocExists: bootstrapSnap.exists,
        bootstrapEnabled: bootstrapConfig.bootstrapEnabled === true,
        hasSuperAdmin: !superAdminSnap.empty,
    };
});
