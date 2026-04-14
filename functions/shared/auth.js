/**
 * Shared Authentication & Role Verification Helpers
 * Used by admin and maintenance cloud functions for role-based access control
 */

const { getFirestore } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/https');
const { COLLECTIONS, USER_STATUS } = require('./constants');

const db = getFirestore();

// Valid roles in the system
const ROLES = {
    USER: 'student',
    STUDENT: 'student',
    ADMIN: 'admin',
    SUPER_ADMIN: 'super_admin',
    MAINTENANCE: 'maintenance'
};

/**
 * Get user document from Firestore
 * @param {string} uid - User ID
 * @returns {Promise<Object|null>} User document data or null
 */
async function getUserDoc(uid) {
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(uid).get();
    return userDoc.exists ? userDoc.data() : null;
}

/**
 * Verify if a user has the specified role
 * @param {string} uid - User ID
 * @param {string|string[]} allowedRoles - Role or array of roles to check
 * @returns {Promise<Object>} User document if role matches
 * @throws {HttpsError} If user not found or role doesn't match
 */
async function verifyRole(uid, allowedRoles) {
    const user = await getUserDoc(uid);

    if (!user) {
        throw new HttpsError('not-found', 'User profile not found');
    }

    if (user.isArchived === true) {
        throw new HttpsError('permission-denied', 'Account is archived');
    }

    if (user.activated === false || user.status === USER_STATUS.INVITED || user.status === USER_STATUS.DISABLED) {
        throw new HttpsError('permission-denied', 'Account is not active');
    }

    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

    if (!roles.includes(user.role)) {
        throw new HttpsError(
            'permission-denied',
            `Access denied. Required role: ${roles.join(' or ')}`
        );
    }

    return user;
}

/**
 * Ensure caller has an active account, regardless of role
 * @param {Object} context - Firebase callable request
 * @returns {Promise<Object>} User document
 */
async function ensureActiveUser(context) {
    if (!context.auth) {
        throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const user = await getUserDoc(context.auth.uid);
    if (!user) {
        throw new HttpsError('not-found', 'User profile not found');
    }

    if (user.isArchived === true) {
        throw new HttpsError('permission-denied', 'Account is archived');
    }

    if (user.activated === false || user.status === USER_STATUS.INVITED || user.status === USER_STATUS.DISABLED) {
        throw new HttpsError('permission-denied', 'Account is not active');
    }

    return user;
}

/**
 * Ensure the caller is an admin or super admin
 * @param {Object} context - Firebase Functions call context
 * @returns {Promise<Object>} User document
 * @throws {HttpsError} If not authenticated or not admin
 */
async function ensureAdmin(context) {
    if (!context.auth) {
        throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const user = await verifyRole(context.auth.uid, [ROLES.ADMIN, ROLES.SUPER_ADMIN]);
    return user;
}

/**
 * Ensure the caller is a super admin
 * @param {Object} context - Firebase Functions call context
 * @returns {Promise<Object>} User document
 * @throws {HttpsError} If not authenticated or not super admin
 */
async function ensureSuperAdmin(context) {
    if (!context.auth) {
        throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const user = await verifyRole(context.auth.uid, ROLES.SUPER_ADMIN);
    return user;
}

/**
 * Ensure the caller is a maintenance staff member
 * @param {Object} context - Firebase Functions call context
 * @returns {Promise<Object>} User document
 * @throws {HttpsError} If not authenticated or not maintenance
 */
async function ensureMaintenance(context) {
    if (!context.auth) {
        throw new HttpsError('unauthenticated', 'Authentication required');
    }

    return verifyRole(context.auth.uid, ROLES.MAINTENANCE);
}

/**
 * Get authenticated user's UID from context
 * @param {Object} context - Firebase Functions call context
 * @returns {string} User UID
 * @throws {HttpsError} If not authenticated
 */
function getAuthUid(context) {
    if (!context.auth) {
        throw new HttpsError('unauthenticated', 'Authentication required');
    }
    return context.auth.uid;
}

module.exports = {
    ROLES,
    getUserDoc,
    verifyRole,
    ensureActiveUser,
    ensureAdmin,
    ensureSuperAdmin,
    ensureMaintenance,
    getAuthUid
};
