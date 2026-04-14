/**
* Shared Profile Update Cloud Function
* Allows users to update their own profile data
*/

const { onCall, HttpsError } = require('firebase-functions/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { COLLECTIONS } = require('./constants');
const { ensureActiveUser } = require('./auth');
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

 /**
  * Update current user's profile
  * Can update: name, phone, avatarUrl
  * Cannot update: email, role, status (protected fields)
  * 
  */
exports.updateUserProfile = onCall({ region: 'asia-southeast1' }, async (request) => {
    const actor = await ensureActiveUser(request);
    await enforceCallableRateLimit(request, 'updateUserProfile');

    const data = request?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new HttpsError('invalid-argument', 'Invalid profile update payload.');
    }

    const allowedKeys = new Set(['name', 'phone', 'avatarUrl']);
    for (const key of Object.keys(data)) {
        if (!allowedKeys.has(key)) {
            throw new HttpsError('invalid-argument', 'Unsupported profile field(s).');
        }
    }

    const { name, phone, avatarUrl } = data;
    const userId = request.auth.uid;

    const normalizeText = (value) => String(value == null ? '' : value).trim();

    const nextName = name !== undefined ? normalizeText(name) : null;
    const nextPhone = phone !== undefined ? normalizeText(phone) : null;
    const nextAvatarUrl = avatarUrl !== undefined ? normalizeText(avatarUrl) : null;

    if (nextName !== null) {
        if (nextName.length < 2 || nextName.length > 120) {
            throw new HttpsError('invalid-argument', 'Name must be 2 to 120 characters');
        }
    }

    if (nextPhone !== null) {
        if (nextPhone.length > 40) {
            throw new HttpsError('invalid-argument', 'Phone number is too long');
        }
        const phoneRegex = /^[0-9+()\-\s]*$/;
        if (!phoneRegex.test(nextPhone)) {
            throw new HttpsError('invalid-argument', 'Phone number contains invalid characters');
        }
    }

    if (nextAvatarUrl !== null) {
        if (nextAvatarUrl && nextAvatarUrl.length > 1500) {
            throw new HttpsError('invalid-argument', 'Avatar URL is too long');
        }
        if (nextAvatarUrl && !nextAvatarUrl.startsWith('https://')) {
            throw new HttpsError('invalid-argument', 'Avatar URL must be https');
        }
    }

    // Build update data - only include fields that were provided
    const updateData = {
        updatedAt: FieldValue.serverTimestamp()
    };

    if (nextName !== null && nextName) {
        updateData.name = nextName;
    }
    if (nextPhone !== null) {
        updateData.phone = nextPhone;
    }
    if (nextAvatarUrl !== null) {
        updateData.avatarUrl = nextAvatarUrl;
    }

    try {
        // Get current user data
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();
        const before = userDoc.exists ? (userDoc.data() || {}) : {};

        // Update users collection (for role-based access system)
        if (userDoc.exists) {
            await userRef.update(updateData);
        }

        // Also update students collection if user is a student
        const studentRef = db.collection(COLLECTIONS.STUDENTS).doc(userId);
        const studentDoc = await studentRef.get();

        if (studentDoc.exists) {
            await studentRef.update(updateData);
        } else if (actor.role === 'student') {
            // Backward compatibility: ensure students/{uid} exists for student self-service pages.
            await studentRef.set({
                ...updateData,
                createdAt: FieldValue.serverTimestamp(),
                uid: userId,
            }, { merge: true });
        }

        const changedFields = [];
        if (updateData.name !== undefined && String(before.name || '').trim() !== String(updateData.name || '').trim()) {
            changedFields.push('name');
        }
        if (updateData.phone !== undefined && String(before.phone || '').trim() !== String(updateData.phone || '').trim()) {
            changedFields.push('phone');
        }
        if (updateData.avatarUrl !== undefined && String(before.avatarUrl || '').trim() !== String(updateData.avatarUrl || '').trim()) {
            changedFields.push('avatarUrl');
        }

        if (changedFields.length) {
            const avatarOnly = changedFields.length === 1 && changedFields[0] === 'avatarUrl';

            if (!avatarOnly) {
                await writeAuditLog({
                    actorUid: userId,
                    actorRole: actor.role,
                    actorName: actor.name || actor.email,
                    actionType: 'profile_updated',
                    targetType: 'user',
                    targetId: userId,
                    metadata: { fieldsChanged: changedFields.filter((f) => f !== 'avatarUrl') },
                }, { bestEffort: true });
            }

            if (changedFields.includes('avatarUrl')) {
                await writeAuditLog({
                    actorUid: userId,
                    actorRole: actor.role,
                    actorName: actor.name || actor.email,
                    actionType: 'profile_photo_updated',
                    targetType: 'user',
                    targetId: userId,
                    metadata: { field: 'avatarUrl' },
                }, { bestEffort: true });
            }
        }

        return { success: true };
    } catch (error) {
        // Re-throw HttpsErrors as-is
        if (error instanceof HttpsError) {
            throw error;
        }
        console.error('Profile update error:', error);
        throw new HttpsError('internal', 'Failed to update profile. Please try again.');
    }
});
