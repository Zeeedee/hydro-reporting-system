/**
 * Department Management Cloud Functions
 * Super Admin-only CRUD operations for departments
 */

const { onCall, HttpsError } = require('firebase-functions/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { ensureSuperAdmin, ensureActiveUser } = require('./auth');
const { COLLECTIONS } = require('./constants');
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
 * Manage departments (CRUD) - Super Admin only
 * @param {Object} data - { action: 'create'|'update'|'delete', department: Object }
 */
exports.manageDepartments = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'manageDepartments');
    // Only Super Admin can manage departments
    await ensureSuperAdmin(request);

    const { action, department } = request.data;

    if (!action) {
        throw new HttpsError('invalid-argument', 'Action is required');
    }

    switch (action) {
        case 'create': {
            if (!department || !department.name) {
                throw new HttpsError('invalid-argument', 'Department name is required');
            }

            // Check for duplicate name
            const existingSnap = await db.collection(COLLECTIONS.DEPARTMENTS)
                .where('name', '==', department.name)
                .limit(1)
                .get();

            if (!existingSnap.empty) {
                throw new HttpsError('already-exists', 'A department with this name already exists');
            }

            const newDepartment = {
                name: department.name.trim(),
                description: department.description || '',
                active: true,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                createdBy: request.auth.uid
            };

            const docRef = await db.collection(COLLECTIONS.DEPARTMENTS).add(newDepartment);
            return { success: true, id: docRef.id };
        }

        case 'update': {
            if (!department || !department.id) {
                throw new HttpsError('invalid-argument', 'Department ID is required for update');
            }

            const updateData = {
                updatedAt: FieldValue.serverTimestamp()
            };

            if (department.name !== undefined) {
                updateData.name = department.name.trim();
            }
            if (department.description !== undefined) {
                updateData.description = department.description;
            }
            if (department.active !== undefined) {
                updateData.active = department.active;
            }

            await db.collection(COLLECTIONS.DEPARTMENTS).doc(department.id).update(updateData);
            return { success: true };
        }

        case 'delete': {
            if (!department || !department.id) {
                throw new HttpsError('invalid-argument', 'Department ID is required for delete');
            }

            // Check if any users are assigned to this department
            const usersInDept = await db.collection(COLLECTIONS.USERS)
                .where('department', '==', department.id)
                .limit(1)
                .get();

            if (!usersInDept.empty) {
                throw new HttpsError(
                    'failed-precondition',
                    'Cannot delete department with assigned users. Reassign users first.'
                );
            }

            await db.collection(COLLECTIONS.DEPARTMENTS).doc(department.id).delete();
            return { success: true };
        }

        default:
            throw new HttpsError('invalid-argument', 'Invalid action. Use create, update, or delete');
    }
});

/**
 * Get all departments
 * Any authenticated user can view departments (for dropdowns)
 */
exports.getDepartments = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'getDepartments');
    await ensureActiveUser(request);

    const snapshot = await db.collection(COLLECTIONS.DEPARTMENTS)
        .where('active', '==', true)
        .orderBy('name')
        .get();

    const departments = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));

    return { departments };
});
