const { onCall, HttpsError } = require('firebase-functions/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { COLLECTIONS, USER_STATUS } = require('./constants');
const { writeAuditLog } = require('./audit');
const { enforceRateLimit, getPolicyForCallable } = require('./rateLimit');

const db = getFirestore();

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

exports.activateInvitedAccount = onCall({ region: 'asia-southeast1' }, async (request) => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Authentication required');
    }

    await enforceCallableRateLimit(request, 'activateInvitedAccount');

    const uid = request.auth.uid;
    const userRef = db.collection(COLLECTIONS.USERS).doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
        throw new HttpsError('not-found', 'User profile not found');
    }

    const userData = userSnap.data() || {};
    if (userData.isArchived === true || userData.status === USER_STATUS.DISABLED) {
        throw new HttpsError('permission-denied', 'Account is disabled');
    }

    const shouldActivate = userData.activated === false || userData.status === USER_STATUS.INVITED;
    if (shouldActivate) {
        await userRef.set({
            activated: true,
            status: USER_STATUS.ACTIVE,
            activatedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        await writeAuditLog('user_activated', {
            actorUid: uid,
            actorName: userData.name || userData.email,
            targetUid: uid,
            context: 'auth_action_setup',
        }, { bestEffort: true });
    }

    return {
        success: true,
        activated: shouldActivate,
    };
});

// Best-effort audit marker for blocked logins when a Firestore user profile is missing.
exports.logUnprovisionedLogin = onCall({ region: 'asia-southeast1' }, async (request) => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Authentication required');
    }

    await enforceCallableRateLimit(request, 'logUnprovisionedLogin');

    const uid = String(request.auth.uid || '').trim();
    if (!uid) {
        throw new HttpsError('invalid-argument', 'Missing uid');
    }

    const userSnap = await db.collection(COLLECTIONS.USERS).doc(uid).get();
    if (userSnap.exists) {
        return { success: true, recorded: false };
    }

    const email = String(request.auth.token?.email || '').trim().toLowerCase();
    const actorName = email && email.includes('@') ? String(email).split('@')[0] : 'Unknown';

    await writeAuditLog({
        actorUid: uid,
        actorRole: 'unknown',
        actorName,
        actionType: 'login_blocked_unprovisioned',
        targetType: 'auth',
        targetId: email || uid,
        metadata: {
            uid,
            email,
            reason: 'missing_user_doc',
            page: String(request.data?.page || ''),
            source: String(request.data?.source || 'client'),
        },
    }, { bestEffort: true });

    return { success: true, recorded: true };
});
