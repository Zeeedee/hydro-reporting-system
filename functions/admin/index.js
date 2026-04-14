/**
 * Admin Cloud Functions
 * Handles report management, user management, announcements, analytics, and locations
 */

const { onCall, HttpsError } = require('firebase-functions/https');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { ensureAdmin, ensureSuperAdmin, ensureActiveUser, ROLES } = require('../shared/auth');
const {
    COLLECTIONS,
    USER_STATUS,
    ANNOUNCEMENT_AUDIENCE,
    ANNOUNCEMENT_TYPES,
    TASK_STATUS,
    TASK_PRIORITY,
    TASK_ACCEPTANCE_WINDOW_HOURS,
} = require('../shared/constants');
const { writeAuditLog } = require('../shared/audit');
const { enforceRateLimit, getPolicyForCallable } = require('../shared/rateLimit');

const db = getFirestore();
const adminAuth = getAuth();

function normalizeText(value) {
    return String(value || '').trim();
}

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

const SAFE_LOCATION_NAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9 &._()\-]{1,79}$/;
const SAFE_FLOOR_NAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9 &._()\-]{0,59}$/;

function validateLocationName(name) {
    const normalized = normalizeText(name);
    if (!normalized) {
        throw new HttpsError('invalid-argument', 'Location name is required');
    }
    if (normalized.length < 2 || normalized.length > 80) {
        throw new HttpsError('invalid-argument', 'Location name must be 2-80 characters');
    }
    if (!SAFE_LOCATION_NAME_REGEX.test(normalized)) {
        throw new HttpsError('invalid-argument', 'Location name contains invalid characters');
    }
    return normalized;
}

function validateFloorName(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
        throw new HttpsError('invalid-argument', 'Floor is required');
    }
    if (normalized.length < 1 || normalized.length > 60) {
        throw new HttpsError('invalid-argument', 'Floor must be 1-60 characters');
    }
    if (!SAFE_FLOOR_NAME_REGEX.test(normalized)) {
        throw new HttpsError('invalid-argument', 'Floor contains invalid characters');
    }
    return normalized;
}

function buildServerActionCodeSettings(flow = 'setup') {
    const base = process.env.APP_BASE_URL || 'http://localhost:5000/auth-action.html';
    const url = flow === 'setup' ? `${base}?flow=setup` : base;
    return {
        url,
        handleCodeInApp: false,
    };
}

function validateCreateUserPayload(data = {}) {
    const name = normalizeText(data.name);
    const email = normalizeText(data.email).toLowerCase();
    const role = normalizeText(data.role);

    if (!name || name.length < 2 || name.length > 120) {
        throw new HttpsError('invalid-argument', 'Name must be 2 to 120 characters.');
    }

    // Full name must contain letters and spaces only (allow hyphen and apostrophe).
    const namePattern = /^[\p{L} '\-]+$/u;
    if (!namePattern.test(name) || !/\p{L}/u.test(name)) {
        throw new HttpsError('invalid-argument', 'Full name must contain letters and spaces only.');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(email)) {
        throw new HttpsError('invalid-argument', 'A valid email is required.');
    }

    const allowedDomains = new Set([
        'phinmaed.com',
        'gmail.com',
        'yahoo.com',
        'outlook.com',
        'hotmail.com',
    ]);
    const at = email.lastIndexOf('@');
    const domain = at > 0 ? email.slice(at + 1) : '';
    if (!allowedDomains.has(domain)) {
        throw new HttpsError('invalid-argument', 'Email domain not allowed');
    }

    if (![ROLES.STUDENT, ROLES.MAINTENANCE, ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(role)) {
        throw new HttpsError('invalid-argument', 'Invalid role selected.');
    }

    return {
        name,
        email,
        role,
        department: normalizeText(data.department),
        phone: normalizeText(data.phone),
    };
}

// ==================== REPORT MANAGEMENT ====================

/**
 * Get all reports with pagination, sorted by urgency then date
 * @param {Object} data - { limit: number, startAfter?: string, status?: string, department?: string, startDate?: string, endDate?: string }
 * @returns {Object} { reports: Array, lastDoc: string|null, hasMore?: boolean }
 */
exports.getAllReports = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'getAllReports');
    const admin = await ensureAdmin(request);

    const { limit = 20, startAfter, status, department, startDate, endDate } = request.data || {};

    function parseDateOnly(value) {
        const raw = String(value || '').trim();
        if (!raw) return null;
        const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) {
            throw new HttpsError('invalid-argument', 'Date must be in YYYY-MM-DD format');
        }
        const y = Number(match[1]);
        const m = Number(match[2]);
        const d = Number(match[3]);
        if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
            throw new HttpsError('invalid-argument', 'Date is invalid');
        }
        if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) {
            throw new HttpsError('invalid-argument', 'Date is out of range');
        }
        return { y, m, d, raw };
    }

    // Manila midnight boundaries (UTC = Manila - 8h)
    const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
    function toManilaStartTimestamp(dateOnly) {
        const utcMs = Date.UTC(dateOnly.y, dateOnly.m - 1, dateOnly.d, 0, 0, 0, 0) - MANILA_OFFSET_MS;
        return Timestamp.fromMillis(utcMs);
    }
    function toManilaEndTimestamp(dateOnly) {
        const utcMs = Date.UTC(dateOnly.y, dateOnly.m - 1, dateOnly.d, 23, 59, 59, 999) - MANILA_OFFSET_MS;
        return Timestamp.fromMillis(utcMs);
    }

    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);
    if (start && end) {
        const startMs = toManilaStartTimestamp(start).toMillis();
        const endMs = toManilaEndTimestamp(end).toMillis();
        if (startMs > endMs) {
            throw new HttpsError('invalid-argument', 'Start date must be before or equal to end date');
        }
        const maxRangeDays = 365;
        const rangeDays = Math.ceil((endMs - startMs + 1) / (24 * 60 * 60 * 1000));
        if (rangeDays > maxRangeDays) {
            throw new HttpsError('invalid-argument', `Date range must be ${maxRangeDays} days or fewer`);
        }
    }

    const hasDateRange = Boolean(start || end);
    let query = db.collection(COLLECTIONS.REPORTS);
    if (hasDateRange) {
        // Required for range queries.
        query = query.orderBy('createdAt', 'desc');
        if (start) query = query.where('createdAt', '>=', toManilaStartTimestamp(start));
        if (end) query = query.where('createdAt', '<=', toManilaEndTimestamp(end));
    } else {
        // Default view: urgent first.
        query = query.orderBy('riskLevel', 'desc').orderBy('createdAt', 'desc');
    }

    // Apply filters
    if (status) {
        query = query.where('status', '==', status);
    }
    if (department) {
        query = query.where('building', '==', department);
    }

    // Optional audit: log filtered views (first page only).
    if (hasDateRange && !startAfter) {
        await writeAuditLog({
            actorUid: request.auth.uid,
            actorRole: admin.role,
            actorName: admin.name || admin.email,
            actionType: 'report_management_filtered',
            targetType: 'dashboard',
            targetId: 'admin_reports',
            metadata: {
                startDate: start ? start.raw : null,
                endDate: end ? end.raw : null,
                status: String(status || '').trim() || null,
                department: String(department || '').trim() || null,
            },
        }, { bestEffort: true });
    }

    // Pagination
    if (startAfter) {
        const lastDocSnap = await db.collection(COLLECTIONS.REPORTS).doc(startAfter).get();
        if (lastDocSnap.exists) {
            query = query.startAfter(lastDocSnap);
        }
    }

    query = query.limit(limit);

    const snapshot = await query.get();
    const reports = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));

    const lastDoc = snapshot.docs.length > 0
        ? snapshot.docs[snapshot.docs.length - 1].id
        : null;

    return { reports, lastDoc, hasMore: snapshot.size === Number(limit) && Boolean(lastDoc) };
});

/**
 * Update report status and priority
 * @param {Object} data - { reportId: string, status?: string, riskLevel?: string, notes?: string }
 */
exports.updateReportStatus = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'updateReportStatus');
    const admin = await ensureAdmin(request);

    const { reportId, status, riskLevel, notes } = request.data;

    if (!reportId) {
        throw new HttpsError('invalid-argument', 'Report ID is required');
    }

    const updateData = {
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: request.auth.uid
    };

    if (status) updateData.status = status;
    if (riskLevel) updateData.riskLevel = riskLevel;
    if (notes) updateData.adminNotes = notes;

    await db.collection(COLLECTIONS.REPORTS).doc(reportId).update(updateData);

    await writeAuditLog({
        actorUid: request.auth.uid,
        actorRole: admin.role,
        actorName: admin.name || admin.email,
        actionType: 'report_status_updated',
        targetType: 'report',
        targetId: reportId,
        metadata: {
            status: status || null,
            riskLevel: riskLevel || null,
            notesProvided: Boolean(notes),
        },
    }, { bestEffort: true });

    return { success: true };
});

/**
 * Assign task to maintenance staff
 * @param {Object} data - { reportId, assignedTo?: string, assignedToList?: string[], expectedResolution, notes }
 */
exports.assignTask = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'assignTask');
    const admin = await ensureAdmin(request);

    const { reportId, assignedTo, assignedToList, expectedResolution, notes } = request.data || {};

    const normalizedReportId = normalizeText(reportId);
    if (!normalizedReportId || normalizedReportId.length < 8 || normalizedReportId.length > 128) {
        throw new HttpsError('invalid-argument', 'Report ID is invalid');
    }

    const rawAssignees = Array.isArray(assignedToList) ? assignedToList : (assignedTo ? [assignedTo] : []);
    const normalizedAssignees = rawAssignees
        .map((v) => normalizeText(v))
        .filter((v) => v && v.length >= 6 && v.length <= 128);

    // Enforce uniqueness while preserving order.
    const uniqueAssignees = [];
    const seen = new Set();
    normalizedAssignees.forEach((uid) => {
        if (seen.has(uid)) return;
        seen.add(uid);
        uniqueAssignees.push(uid);
    });

    const MAX_ASSIGNEES = 10;
    if (!uniqueAssignees.length) {
        throw new HttpsError('invalid-argument', 'At least one assignee is required');
    }
    if (uniqueAssignees.length > MAX_ASSIGNEES) {
        throw new HttpsError('invalid-argument', `Too many assignees. Max is ${MAX_ASSIGNEES}.`);
    }

    const normalizedNotes = normalizeText(notes);
    if (normalizedNotes.length > 800) {
        throw new HttpsError('invalid-argument', 'Notes must be 800 characters or fewer');
    }

    let expectedResolutionDate = null;
    if (expectedResolution) {
        const parsed = new Date(expectedResolution);
        if (Number.isNaN(parsed.getTime())) {
            throw new HttpsError('invalid-argument', 'Expected resolution date is invalid');
        }
        expectedResolutionDate = parsed;
    }

    const reportSnap = await db.collection(COLLECTIONS.REPORTS).doc(normalizedReportId).get();
    if (!reportSnap.exists) {
        throw new HttpsError('not-found', 'Report not found');
    }
    const report = reportSnap.data() || {};

    const reportStatus = String(report.status || '').trim();
    const isResolved = reportStatus === 'resolved' || reportStatus === 'closed' || reportStatus === 'completed';
    if (isResolved) {
        await writeAuditLog({
            actorUid: request.auth.uid,
            actorRole: admin.role,
            actorName: admin.name || admin.email,
            actionType: 'assignment_blocked_resolved',
            targetType: 'report',
            targetId: normalizedReportId,
            metadata: {
                status: reportStatus || null,
                attemptedAssigneeUid: normalizedAssignedTo,
            },
        }, { bestEffort: true });

        throw new HttpsError('failed-precondition', 'Cannot assign staff to a resolved report.');
    }

    const rawRisk = String(report.riskLevel || '').trim().toLowerCase();
    const priority = Object.values(TASK_PRIORITY).includes(rawRisk) ? rawRisk : TASK_PRIORITY.LOW;

    const assignedAt = Timestamp.now();
    const acceptBy = Timestamp.fromMillis(assignedAt.toMillis() + TASK_ACCEPTANCE_WINDOW_HOURS * 60 * 60 * 1000);

    const studentId = String(report.studentId || '').trim();
    let reporterEmail = '';
    let reporterPhone = '';
    let reporterName = String(report.createdByName || report.studentName || '').trim();
    if (studentId) {
        const studentUserSnap = await db.collection(COLLECTIONS.USERS).doc(studentId).get().catch(() => null);
        if (studentUserSnap && studentUserSnap.exists) {
            const studentUser = studentUserSnap.data() || {};
            reporterEmail = String(studentUser.email || '').trim();
            reporterPhone = String(studentUser.phone || '').trim();
            if (!reporterName) {
                reporterName = String(studentUser.name || '').trim();
            }
        }
    }

    const batch = db.batch();

    // Create one task document per assignee (team job behavior).
    const taskRefs = uniqueAssignees.map(() => db.collection(COLLECTIONS.TASKS).doc());
    taskRefs.forEach((taskRef, idx) => {
        const assigneeUid = uniqueAssignees[idx];
        batch.set(taskRef, {
            reportId: normalizedReportId,
            assignedTo: assigneeUid,
            assignedBy: request.auth.uid,
            status: TASK_STATUS.ASSIGNED,
            priority,
            notes: normalizedNotes || '',
            expectedResolution: expectedResolutionDate,
            assignedAt,
            acceptBy,
            acceptedAt: null,
            startedAt: null,
            completedAt: null,
            expiredAt: null,
            closedAt: null,
            closedByUid: null,
            closedByName: null,
            closedByEmail: null,
            closedReason: null,
            closedByTaskId: null,
            performedByUid: null,
            performedByName: null,
            performedByEmail: null,
            durationSeconds: null,

            reporterUid: studentId || null,
            reporterName: reporterName || null,
            reporterEmail: reporterEmail || null,
            reporterPhone: reporterPhone || null,

            reportSnapshot: {
                building: report.building || '',
                floor: report.floor || '',
                location: report.location || report.area || '',
                issueType: report.issueType || '',
                description: report.description || '',
                riskLevel: report.riskLevel || '',
                photoUrls: Array.isArray(report.photoUrls) && report.photoUrls.length
                    ? report.photoUrls
                    : (report.photoUrl ? [report.photoUrl] : []),
            },
            createdAt: assignedAt,
            updatedAt: assignedAt,
        });
    });

    const primaryTaskRef = taskRefs[0];
    const taskIds = taskRefs.map((ref) => ref.id);

    // Update report with assignment info
    const reportRef = db.collection(COLLECTIONS.REPORTS).doc(normalizedReportId);
    batch.update(reportRef, {
        status: 'in_progress',
        // Legacy fields (keep populated for backward compatibility).
        assignedTo: uniqueAssignees[0],
        taskId: primaryTaskRef.id,
        // New multi-assignee fields.
        assignedToUids: uniqueAssignees,
        taskIds,
        updatedAt: FieldValue.serverTimestamp()
    });

    await batch.commit();

    await writeAuditLog({
        actorUid: request.auth.uid,
        actorRole: admin.role,
        actorName: admin.name || admin.email,
        actionType: 'task_assigned',
        targetType: 'task',
        targetId: primaryTaskRef.id,
        metadata: {
            reportId: normalizedReportId,
            assignedTo: uniqueAssignees[0],
            assignedToUids: uniqueAssignees,
            taskIds,
            priority,
            assignedAt: assignedAt.toDate().toISOString(),
            acceptBy: acceptBy.toDate().toISOString(),
            expectedResolution: expectedResolutionDate ? expectedResolutionDate.toISOString() : null,
            notesProvided: Boolean(normalizedNotes),
        },
    }, { bestEffort: true });

    return { success: true, taskId: primaryTaskRef.id, taskIds };
});

/**
 * Get maintenance staff with availability status
 * @param {Object} data - { department?: string }
 */
exports.getMaintenanceStaff = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'getMaintenanceStaff');
    await ensureAdmin(request);

    const { department } = request.data || {};

    let query = db.collection(COLLECTIONS.USERS).where('role', '==', ROLES.MAINTENANCE);

    if (department) {
        query = query.where('department', '==', department);
    }

    const usersSnap = await query.get();

    // Get active task counts for each staff member
    const staffList = await Promise.all(usersSnap.docs.map(async (doc) => {
        const userData = doc.data();

        // Count active tasks (assigned/accepted/in_progress)
        const tasksSnap = await db.collection(COLLECTIONS.TASKS)
            .where('assignedTo', '==', doc.id)
            .where('status', 'in', [TASK_STATUS.ASSIGNED, TASK_STATUS.ACCEPTED, TASK_STATUS.IN_PROGRESS, TASK_STATUS.LEGACY_PENDING])
            .get();

        const activeTasks = tasksSnap.size;

        return {
            id: doc.id,
            name: userData.name || userData.email,
            email: userData.email,
            phone: userData.phone || '',
            department: userData.department || '',
            avatarUrl: userData.avatarUrl || '',
            status: userData.status || 'active',
            activeTasks,
            availability: activeTasks >= 5 ? 'busy' : 'available'
        };
    }));

    return { staff: staffList };
});

// ==================== ANNOUNCEMENTS ====================

/**
 * Create a new announcement
 * @param {Object} data - { type, title, body, audience, isActive, pinned }
 */
exports.createAnnouncement = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'createAnnouncement');
    const admin = await ensureAdmin(request);

    const { type, title, message, body, audience, isActive, pinned, clientRequestId } = request.data || {};
    const normalizedBody = normalizeText(body || message);
    const normalizedAudience = normalizeText(audience || ANNOUNCEMENT_AUDIENCE.ALL);
    const normalizedType = normalizeText(type || ANNOUNCEMENT_TYPES.GENERAL);

    if (!title || !normalizedBody) {
        throw new HttpsError('invalid-argument', 'Title and body are required');
    }

    if (!Object.values(ANNOUNCEMENT_TYPES).includes(normalizedType)) {
        throw new HttpsError('invalid-argument', 'Invalid announcement type.');
    }

    if (!Object.values(ANNOUNCEMENT_AUDIENCE).includes(normalizedAudience)) {
        throw new HttpsError('invalid-argument', 'Invalid announcement audience.');
    }

    const announcement = {
        type: normalizedType,
        title: normalizeText(title),
        body: normalizedBody,
        audience: normalizedAudience,
        createdBy: request.auth.uid,
        createdByName: admin.name || admin.email,
        isActive: isActive !== false,
        pinned: pinned === true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    };

    const uid = request.auth.uid;
    const requestId = normalizeText(clientRequestId);
    const hasRequestId = Boolean(requestId);

    if (hasRequestId && (requestId.length < 8 || requestId.length > 128)) {
        throw new HttpsError('invalid-argument', 'clientRequestId is invalid.');
    }

    const annRef = db.collection(COLLECTIONS.ANNOUNCEMENTS).doc();
    const dedupRef = hasRequestId
        ? db.collection('request_dedup').doc(`${uid}_${requestId}`.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 480))
        : null;

    const txResult = await db.runTransaction(async (tx) => {
        if (dedupRef) {
            const existingSnap = await tx.get(dedupRef);
            if (existingSnap.exists) {
                const existing = existingSnap.data() || {};
                const existingId = normalizeText(existing.announcementId);
                if (existingId) {
                    return { id: existingId, deduped: true };
                }
                throw new HttpsError('already-exists', 'Duplicate request.');
            }
        }

        tx.set(annRef, {
            ...announcement,
            ...(hasRequestId ? { clientRequestId: requestId } : {}),
        });

        if (dedupRef) {
            tx.set(dedupRef, {
                uid,
                kind: 'createAnnouncement',
                announcementId: annRef.id,
                createdAt: FieldValue.serverTimestamp(),
            });
        }

        return { id: annRef.id, deduped: false };
    });

    if (!txResult.deduped) {
        await writeAuditLog('announcement_created', {
            actorUid: request.auth.uid,
            actorRole: admin.role,
            actorName: admin.name || admin.email,
            announcementId: txResult.id,
            audience: normalizedAudience,
            type: normalizedType,
        }, { bestEffort: true });
    }

    return { success: true, id: txResult.id, deduped: txResult.deduped === true };
});

/**
 * Soft delete an announcement.
 * @param {Object} data - { announcementId }
 */
exports.deleteAnnouncementByAdmin = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'deleteAnnouncementByAdmin');
    const admin = await ensureAdmin(request);

    const announcementId = normalizeText(request.data?.announcementId);
    if (!announcementId) {
        throw new HttpsError('invalid-argument', 'announcementId is required');
    }

    const ref = db.collection(COLLECTIONS.ANNOUNCEMENTS).doc(announcementId);
    const tx = await db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        if (!snap.exists) {
            throw new HttpsError('not-found', 'Announcement not found');
        }
        const data = snap.data() || {};
        if (data.isDeleted === true) {
            return { deleted: false, alreadyDeleted: true };
        }

        t.update(ref, {
            isDeleted: true,
            deletedAt: FieldValue.serverTimestamp(),
            deletedBy: request.auth.uid,
            // Backward compatible: disabled announcements should not show in feeds.
            isActive: false,
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { deleted: true, alreadyDeleted: false };
    });

    if (tx.deleted) {
        await writeAuditLog('announcement_deleted', {
            actorUid: request.auth.uid,
            actorRole: admin.role,
            actorName: admin.name || admin.email,
            announcementId,
        }, { bestEffort: true });
    }

    return { success: true, alreadyDeleted: tx.alreadyDeleted === true };
});

/**
 * Update or archive an announcement
 * @param {Object} data - { id, title?, body?, type?, audience?, isActive?, pinned? }
 */
exports.updateAnnouncement = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'updateAnnouncement');
    const admin = await ensureAdmin(request);

    const { id, ...updates } = request.data;

    if (!id) {
        throw new HttpsError('invalid-argument', 'Announcement ID is required');
    }

    const normalizedUpdates = {};
    if (updates.title !== undefined) normalizedUpdates.title = normalizeText(updates.title);
    if (updates.body !== undefined || updates.message !== undefined) normalizedUpdates.body = normalizeText(updates.body || updates.message);
    if (updates.type !== undefined) {
        const normalizedType = normalizeText(updates.type);
        if (!Object.values(ANNOUNCEMENT_TYPES).includes(normalizedType)) {
            throw new HttpsError('invalid-argument', 'Invalid announcement type.');
        }
        normalizedUpdates.type = normalizedType;
    }
    if (updates.audience !== undefined) {
        const normalizedAudience = normalizeText(updates.audience);
        if (!Object.values(ANNOUNCEMENT_AUDIENCE).includes(normalizedAudience)) {
            throw new HttpsError('invalid-argument', 'Invalid announcement audience.');
        }
        normalizedUpdates.audience = normalizedAudience;
    }
    if (updates.isActive !== undefined) normalizedUpdates.isActive = updates.isActive === true;
    if (updates.pinned !== undefined) normalizedUpdates.pinned = updates.pinned === true;

    normalizedUpdates.updatedAt = FieldValue.serverTimestamp();

    await db.collection(COLLECTIONS.ANNOUNCEMENTS).doc(id).update(normalizedUpdates);

    const actionType = normalizedUpdates.pinned !== undefined
        ? 'announcement_pinned'
        : normalizedUpdates.isActive === false
            ? 'announcement_disabled'
            : 'announcement_updated';

    await writeAuditLog(actionType, {
        actorUid: request.auth.uid,
        actorRole: admin.role,
        actorName: admin.name || admin.email,
        announcementId: id,
    }, { bestEffort: true });

    return { success: true };
});

// ==================== ANALYTICS ====================

/**
 * Get dashboard analytics data
 */
exports.getAnalytics = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'getAnalytics');
    await ensureAdmin(request);

    const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

    function toDateSafe(value) {
        if (!value) return null;
        if (typeof value.toDate === 'function') return value.toDate();
        if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function toManilaShift(date) {
        return new Date(date.getTime() + MANILA_OFFSET_MS);
    }

    function toManilaMonthKey(date) {
        const shifted = toManilaShift(date);
        const y = shifted.getUTCFullYear();
        const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
        return `${y}-${m}`;
    }

    function monthStartTimestampManila(year, monthIndex0) {
        // monthIndex0: 0-11, Manila midnight => UTC minus offset.
        const utcMs = Date.UTC(year, monthIndex0, 1, 0, 0, 0) - MANILA_OFFSET_MS;
        return Timestamp.fromMillis(utcMs);
    }

    const now = new Date();
    const nowManila = toManilaShift(now);
    const currentYear = nowManila.getUTCFullYear();
    const currentMonth0 = nowManila.getUTCMonth();

    const months = [];
    for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(currentYear, currentMonth0 - i, 1));
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        months.push(`${y}-${m}`);
    }

    const oldestMonthDate = new Date(Date.UTC(currentYear, currentMonth0 - 11, 1));
    const oldestStart = monthStartTimestampManila(oldestMonthDate.getUTCFullYear(), oldestMonthDate.getUTCMonth());

    const reportsSnap = await db.collection(COLLECTIONS.REPORTS)
        .where('createdAt', '>=', oldestStart)
        .get();

    const monthlyTrends = {};
    months.forEach((key) => { monthlyTrends[key] = 0; });

    const issueTypeDistribution = {};
    const buildingDistribution = {};

    const statusBreakdown = {
        open: 0,
        inProgress: 0,
        completed: 0,
    };

    let totalReports = 0;
    let urgentHighReports = 0;
    const recurringLocationCounts = {};
    const recurringWindowDays = 90;
    const recurringStartMs = now.getTime() - recurringWindowDays * 24 * 60 * 60 * 1000;

    reportsSnap.forEach((docSnap) => {
        const report = docSnap.data() || {};
        totalReports++;

        const status = String(report.status || '').trim();
        if (status === 'pending') statusBreakdown.open++;
        else if (status === 'in_progress') statusBreakdown.inProgress++;
        else if (status === 'resolved' || status === 'closed') statusBreakdown.completed++;

        const risk = String(report.riskLevel || '').trim();
        if (risk === 'urgent' || risk === 'high') urgentHighReports++;

        const issue = String(report.issueType || 'Other').trim() || 'Other';
        issueTypeDistribution[issue] = (issueTypeDistribution[issue] || 0) + 1;

        const building = String(report.building || 'Unknown').trim() || 'Unknown';
        buildingDistribution[building] = (buildingDistribution[building] || 0) + 1;

        const createdAtDate = toDateSafe(report.createdAt);
        if (createdAtDate) {
            const key = toManilaMonthKey(createdAtDate);
            if (monthlyTrends[key] !== undefined) {
                monthlyTrends[key] = (monthlyTrends[key] || 0) + 1;
            }

            // Recurring contamination areas (within window)
            const createdMs = createdAtDate.getTime();
            const isInWindow = createdMs >= recurringStartMs;
            const isContaminated = String(report.issueType || '').trim() === 'contaminated';
            if (isInWindow && isContaminated) {
                const floor = String(report.floor || '').trim();
                const location = String(report.location || report.area || '').trim();
                const key2 = `${building}||${floor}||${location}`;
                recurringLocationCounts[key2] = (recurringLocationCounts[key2] || 0) + 1;
            }
        }
    });

    const recurringContaminationAreas = Object.entries(recurringLocationCounts)
        .filter(([, count]) => Number(count) > 1)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 10)
        .map(([key, count]) => {
            const parts = String(key).split('||');
            return {
                building: parts[0] || 'Unknown',
                floor: parts[1] || '',
                location: parts[2] || '',
                count: Number(count) || 0,
            };
        });

    // Average resolution time definition (R5): task.completedAt - task.assignedAt
    // Paginated to avoid hard caps.
    const TASKS_PAGE_SIZE = 1000;
    const MAX_TASK_DOCS = 50000;

    const resolutionByMonth = {};
    months.forEach((key) => { resolutionByMonth[key] = { sumMs: 0, count: 0 }; });

    let tasksLastDoc = null;
    let tasksFetched = 0;
    let tasksTruncated = false;

    while (true) {
        let query = db.collection(COLLECTIONS.TASKS)
            .where('completedAt', '>=', oldestStart)
            .orderBy('completedAt', 'asc')
            .limit(TASKS_PAGE_SIZE);

        if (tasksLastDoc) {
            query = query.startAfter(tasksLastDoc);
        }

        const pageSnap = await query.get();
        if (pageSnap.empty) {
            break;
        }

        for (const docSnap of pageSnap.docs) {
            tasksFetched++;
            if (tasksFetched > MAX_TASK_DOCS) {
                tasksTruncated = true;
                break;
            }

            const task = docSnap.data() || {};
            const status = String(task.status || '').trim();
            if (![TASK_STATUS.COMPLETED, TASK_STATUS.LEGACY_DONE].includes(status)) {
                continue;
            }

            const completedAtDate = toDateSafe(task.completedAt);
            const assignedAtDate = toDateSafe(task.assignedAt);
            if (!completedAtDate || !assignedAtDate) continue;

            const key = toManilaMonthKey(completedAtDate);
            if (!resolutionByMonth[key]) continue;

            let durationMs = Math.max(0, completedAtDate.getTime() - assignedAtDate.getTime());
            if (typeof task.durationSeconds === 'number' && Number.isFinite(task.durationSeconds) && task.durationSeconds >= 0) {
                durationMs = task.durationSeconds * 1000;
            }

            resolutionByMonth[key].sumMs += durationMs;
            resolutionByMonth[key].count += 1;
        }

        if (tasksTruncated) {
            break;
        }

        tasksLastDoc = pageSnap.docs[pageSnap.docs.length - 1];
        if (pageSnap.size < TASKS_PAGE_SIZE) {
            break;
        }
    }

    const avgHoursByMonth = {};
    months.forEach((key) => {
        const bucket = resolutionByMonth[key];
        if (!bucket || bucket.count <= 0) {
            avgHoursByMonth[key] = null;
            return;
        }
        avgHoursByMonth[key] = Number((bucket.sumMs / bucket.count / (1000 * 60 * 60)).toFixed(2));
    });

    const currentKey = months[months.length - 1];
    const prevKey = months[months.length - 2];
    const currentAvgHours = avgHoursByMonth[currentKey];
    const prevAvgHours = avgHoursByMonth[prevKey];

    let deltaPct = null;
    if (typeof currentAvgHours === 'number' && typeof prevAvgHours === 'number' && prevAvgHours > 0) {
        deltaPct = Number((((currentAvgHours - prevAvgHours) / prevAvgHours) * 100).toFixed(1));
    }

    let bestMonth = null;
    let bestAvgHours = null;
    months.forEach((key) => {
        const avg = avgHoursByMonth[key];
        if (typeof avg !== 'number') return;
        if (bestAvgHours === null || avg < bestAvgHours) {
            bestAvgHours = avg;
            bestMonth = key;
        }
    });

    // Top buildings list for chart.
    const topBuildings = Object.entries(buildingDistribution)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 8)
        .reduce((acc, [name, count]) => {
            acc[name] = count;
            return acc;
        }, {});

    return {
        stats: {
            totalReports,
            openReports: statusBreakdown.open,
            inProgressReports: statusBreakdown.inProgress,
            completedReports: statusBreakdown.completed,
            urgentHighReports,
        },
        monthlyTrends,
        buildingDistribution: topBuildings,
        issueTypeDistribution,
        recurringContaminationAreas,
        statusBreakdown,
        resolutionTime: {
            definition: 'task.completedAt - task.assignedAt',
            truncated: tasksTruncated,
            scannedTasks: tasksFetched,
            currentMonthKey: currentKey,
            previousMonthKey: prevKey,
            currentAvgHours,
            previousAvgHours: prevAvgHours,
            deltaPct,
            bestMonth,
            bestAvgHours,
            avgHoursByMonth,
        },
    };
});

// ==================== USER MANAGEMENT ====================

/**
 * Search users by email or name
 * @param {Object} data - { query: string, role?: string, status?: string }
 */
exports.searchUsers = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'searchUsers');
    await ensureAdmin(request);

    const { query, role, status } = request.data;

    if (!query || query.length < 2) {
        throw new HttpsError('invalid-argument', 'Search query must be at least 2 characters');
    }

    // Search by email prefix (Firestore limitation - can't do contains)
    const queryLower = query.toLowerCase();

    let usersQuery = db.collection(COLLECTIONS.USERS)
        .orderBy('email')
        .startAt(queryLower)
        .endAt(queryLower + '\uf8ff')
        .limit(20);

    const emailResults = await usersQuery.get();

    // Also search by name
    let nameQuery = db.collection(COLLECTIONS.USERS)
        .orderBy('name')
        .startAt(query)
        .endAt(query + '\uf8ff')
        .limit(20);

    const nameResults = await nameQuery.get();

    // Combine and deduplicate results
    const usersMap = new Map();

    [...emailResults.docs, ...nameResults.docs].forEach(doc => {
        if (!usersMap.has(doc.id)) {
            const data = doc.data();

            // Apply filters
            if (role && data.role !== role) return;
            if (status && (data.status || USER_STATUS.ACTIVE) !== status) return;

            usersMap.set(doc.id, {
                id: doc.id,
                ...data
            });
        }
    });

    return { users: Array.from(usersMap.values()) };
});

/**
 * Get all users with pagination (for initial load)
 * @param {Object} data - { limit?: number, startAfter?: string, role?: string, status?: string }
 * @returns {Object} { users: Array, lastDoc: string|null, hasMore: boolean }
 */
exports.getAllUsers = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'getAllUsers');
    await ensureAdmin(request);

    const { limit = 20, startAfter, role, status } = request.data || {};

    let query = db.collection(COLLECTIONS.USERS).orderBy('name', 'asc');

    // Apply filters
    if (role) {
        query = query.where('role', '==', role);
    }

    if (status && status !== USER_STATUS.ACTIVE) {
        query = query.where('status', '==', status);
    }

    // Pagination
    if (startAfter) {
        const lastDocSnap = await db.collection(COLLECTIONS.USERS).doc(startAfter).get();
        if (lastDocSnap.exists) {
            query = query.startAfter(lastDocSnap);
        }
    }

    // Fetch extra to handle filtering and pagination
    const fetchLimit = status === USER_STATUS.ACTIVE ? (limit + 1) * 2 : limit + 1;
    query = query.limit(fetchLimit);

    const snapshot = await query.get();

    // Post-query filter for active status (includes users without status field)
    let docs = snapshot.docs;
    if (status === USER_STATUS.ACTIVE) {
        docs = docs.filter(doc => {
            const userData = doc.data();
            return !userData.status || userData.status === USER_STATUS.ACTIVE;
        });
    }

    // Apply pagination
    const hasMore = docs.length > limit;
    docs = hasMore ? docs.slice(0, limit) : docs;

    const users = docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));

    const lastDoc = docs.length > 0 ? docs[docs.length - 1].id : null;

    return { users, lastDoc, hasMore };
});

/**
 * Update user role and department
 * @param {Object} data - { userId, role?, department?, status? }
 */
exports.updateUserRole = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'updateUserRole');
    const admin = await ensureSuperAdmin(request);

    const { userId, role, department, status } = request.data;

    if (!userId) {
        throw new HttpsError('invalid-argument', 'User ID is required');
    }

    const validRoles = Object.values(ROLES);
    if (role && !validRoles.includes(role)) {
        throw new HttpsError('invalid-argument', `Invalid role. Must be one of: ${validRoles.join(', ')}`);
    }

    const updateData = {
        updatedAt: FieldValue.serverTimestamp()
    };

    if (role) updateData.role = role;
    if (department) updateData.department = department;
    if (status && Object.values(USER_STATUS).includes(status)) {
        updateData.status = status;
    }

    await db.collection(COLLECTIONS.USERS).doc(userId).update(updateData);

    await writeAuditLog('user_role_updated', {
        actorUid: request.auth.uid,
        actorRole: admin.role,
        actorName: admin.name || admin.email,
        targetUid: userId,
        role: updateData.role || null,
        status: updateData.status || null,
    }, { bestEffort: true });

    return { success: true };
});

// ==================== LOCATION MANAGEMENT ====================

/**
 * Create a location (building)
 * @param {Object} data - { name }
 */
exports.createLocation = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'createLocation');
    const admin = await ensureAdmin(request);
    const name = validateLocationName(request.data?.name);

    // Enforce uniqueness for building-level docs.
    const existingSnap = await db.collection(COLLECTIONS.LOCATIONS)
        .where('building', '==', name)
        .limit(10)
        .get();

    const alreadyExists = existingSnap.docs.some((doc) => {
        const data = doc.data() || {};
        return String(data.floor || '').trim() === '' && String(data.area || '').trim() === '';
    });

    if (alreadyExists) {
        throw new HttpsError('already-exists', 'Building already exists');
    }

    const newLocation = {
        building: name,
        floor: '',
        area: '',
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection(COLLECTIONS.LOCATIONS).add(newLocation);

    await writeAuditLog({
        actorUid: request.auth.uid,
        actorRole: admin.role,
        actorName: admin.name || admin.email,
        actionType: 'location_created',
        targetType: 'location',
        targetId: docRef.id,
        metadata: { building: name },
    }, { bestEffort: true });

    return { success: true, id: docRef.id };
});

/**
 * Create a floor under an existing building
 * @param {Object} data - { buildingId, floor }
 */
exports.createFloor = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'createFloor');
    const admin = await ensureAdmin(request);
    const buildingId = normalizeText(request.data?.buildingId);
    const floor = validateFloorName(request.data?.floor);

    if (!buildingId) {
        throw new HttpsError('invalid-argument', 'Building ID is required');
    }

    const buildingRef = db.collection(COLLECTIONS.LOCATIONS).doc(buildingId);
    const buildingSnap = await buildingRef.get();
    if (!buildingSnap.exists) {
        throw new HttpsError('not-found', 'Building not found');
    }

    const buildingData = buildingSnap.data() || {};
    const buildingName = normalizeText(buildingData.building);
    const buildingFloor = normalizeText(buildingData.floor);
    const buildingArea = normalizeText(buildingData.area);

    if (!buildingName || buildingFloor || buildingArea) {
        throw new HttpsError('failed-precondition', 'Invalid building record');
    }

    const existingSnap = await db.collection(COLLECTIONS.LOCATIONS)
        .where('building', '==', buildingName)
        .where('floor', '==', floor)
        .limit(1)
        .get();

    if (!existingSnap.empty) {
        throw new HttpsError('already-exists', 'Floor already exists for this building');
    }

    const newFloor = {
        building: buildingName,
        floor,
        area: '',
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection(COLLECTIONS.LOCATIONS).add(newFloor);

    await writeAuditLog({
        actorUid: request.auth.uid,
        actorRole: admin.role,
        actorName: admin.name || admin.email,
        actionType: 'location_created',
        targetType: 'location',
        targetId: docRef.id,
        metadata: {
            kind: 'floor',
            building: buildingName,
            floor,
        },
    }, { bestEffort: true });

    return { success: true, id: docRef.id };
});

/**
 * Delete a single floor record
 * @param {Object} data - { floorId }
 */
exports.deleteFloor = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'deleteFloor');
    const admin = await ensureAdmin(request);
    const floorId = normalizeText(request.data?.floorId);
    if (!floorId) {
        throw new HttpsError('invalid-argument', 'Floor ID is required');
    }

    const docRef = db.collection(COLLECTIONS.LOCATIONS).doc(floorId);
    const snap = await docRef.get();
    if (!snap.exists) {
        throw new HttpsError('not-found', 'Floor not found');
    }

    const data = snap.data() || {};
    const building = normalizeText(data.building);
    const floor = normalizeText(data.floor);
    const area = normalizeText(data.area);

    if (!building || !floor || area) {
        throw new HttpsError('failed-precondition', 'Record is not a floor');
    }

    await docRef.delete();

    await writeAuditLog({
        actorUid: request.auth.uid,
        actorRole: admin.role,
        actorName: admin.name || admin.email,
        actionType: 'location_deleted',
        targetType: 'location',
        targetId: floorId,
        metadata: {
            kind: 'floor',
            building,
            floor,
            deletedCount: 1,
        },
    }, { bestEffort: true });

    return { success: true };
});

/**
 * Delete a location document
 * @param {Object} data - { locationId }
 */
exports.deleteLocation = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'deleteLocation');
    const admin = await ensureAdmin(request);
    const locationId = normalizeText(request.data?.locationId);
    if (!locationId) {
        throw new HttpsError('invalid-argument', 'Location ID is required');
    }

    const docRef = db.collection(COLLECTIONS.LOCATIONS).doc(locationId);
    const snap = await docRef.get();
    if (!snap.exists) {
        throw new HttpsError('not-found', 'Location not found');
    }

    const location = snap.data() || {};
    const building = normalizeText(location.building);
    const floor = normalizeText(location.floor);
    const area = normalizeText(location.area);

    if (floor || area) {
        throw new HttpsError('failed-precondition', 'Use deleteFloor for floors.');
    }

    // Buildings-only: delete the selected doc and any legacy docs under the same building.
    let deletedCount = 0;
    if (building) {
        const sameBuildingSnap = await db.collection(COLLECTIONS.LOCATIONS)
            .where('building', '==', building)
            .get();

        if (!sameBuildingSnap.empty) {
            const batch = db.batch();
            sameBuildingSnap.docs.forEach((doc) => {
                batch.delete(doc.ref);
                deletedCount += 1;
            });
            await batch.commit();
        }
    } else {
        await docRef.delete();
        deletedCount = 1;
    }

    await writeAuditLog({
        actorUid: request.auth.uid,
        actorRole: admin.role,
        actorName: admin.name || admin.email,
        actionType: 'location_deleted',
        targetType: 'location',
        targetId: locationId,
        metadata: {
            building: building || null,
            deletedCount,
        },
    }, { bestEffort: true });

    return { success: true };
});

/**
 * Optional: log audit dashboard view
 */
exports.logAuditDashboardViewed = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'logAuditDashboardViewed');
    const admin = await ensureAdmin(request);
    await writeAuditLog({
        actorUid: request.auth.uid,
        actorRole: admin.role,
        actorName: admin.name || admin.email,
        actionType: 'audit_dashboard_viewed',
        targetType: 'dashboard',
        targetId: 'audit_logs',
        metadata: { path: '/admin/audit-logs.html' },
    }, { bestEffort: true });
    return { success: true };
});

/**
 * CRUD operations for locations
 * @param {Object} data - { action: 'create'|'update'|'delete', location: Object }
 */
exports.manageLocations = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'manageLocations');
    await ensureAdmin(request);
    throw new HttpsError('failed-precondition', 'manageLocations is deprecated. Use createLocation/deleteLocation (buildings only).');
});

/**
 * Get all active locations for student dropdown
 */
exports.getLocations = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'getLocations');
    await ensureActiveUser(request);

    const snapshot = await db.collection(COLLECTIONS.LOCATIONS)
        .where('active', '==', true)
        .get();

    const buildingsSet = new Set();
    snapshot.docs.forEach((doc) => {
        const data = doc.data() || {};
        const building = String(data.building || '').trim();
        const floor = String(data.floor || '').trim();
        const area = String(data.area || '').trim();
        if (building && !floor && !area) {
            buildingsSet.add(building);
        }
    });

    return { buildings: Array.from(buildingsSet).sort() };
});

/**
 * Invite user account by admin. User sets password via action link.
 */
exports.createUserByAdmin = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'createUserByAdmin');
    const admin = await ensureAdmin(request);
    const payload = validateCreateUserPayload(request.data || {});

    if (payload.role === ROLES.SUPER_ADMIN && admin.role !== ROLES.SUPER_ADMIN) {
        throw new HttpsError('permission-denied', 'Only super admin can create super admin accounts.');
    }

    const existingUsers = await adminAuth.getUserByEmail(payload.email).catch(() => null);
    if (existingUsers) {
        throw new HttpsError('already-exists', 'A user with this email already exists.');
    }

    const createdUser = await adminAuth.createUser({
        email: payload.email,
        emailVerified: false,
        displayName: payload.name,
        disabled: false,
    });

    const userDoc = {
        email: payload.email,
        name: payload.name,
        role: payload.role,
        department: payload.department || '',
        phone: payload.phone || '',
        status: USER_STATUS.INVITED,
        activated: false,
        invitedAt: FieldValue.serverTimestamp(),
        activatedAt: null,
        isArchived: false,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: request.auth.uid,
    };

    const batch = db.batch();
    batch.set(db.collection(COLLECTIONS.USERS).doc(createdUser.uid), userDoc);

    if (payload.role === ROLES.STUDENT) {
        batch.set(db.collection(COLLECTIONS.STUDENTS).doc(createdUser.uid), {
            email: payload.email,
            name: payload.name,
            phone: payload.phone || '',
            avatarUrl: '',
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
    }

    await batch.commit();

    const setupLink = await adminAuth.generatePasswordResetLink(payload.email, buildServerActionCodeSettings('setup'));

    await writeAuditLog('user_invited', {
        actorUid: request.auth.uid,
        actorRole: admin.role,
        actorName: admin.name || admin.email,
        targetUid: createdUser.uid,
        targetEmail: payload.email,
        targetRole: payload.role,
    }, { bestEffort: true });

    return {
        success: true,
        uid: createdUser.uid,
        setupLink,
        message: 'User invited. Password setup link generated.',
    };
});

/**
 * Resend invite metadata update (admin-only).
 * This callable does not send email; the client uses Firebase Auth templates.
 * @param {Object} data - { userId?: string, email?: string }
 */
exports.resendInviteByAdmin = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'resendInviteByAdmin');
    const admin = await ensureAdmin(request);

    const userIdRaw = normalizeText(request.data?.userId);
    const emailRaw = normalizeText(request.data?.email).toLowerCase();

    if (!userIdRaw && !emailRaw) {
        throw new HttpsError('invalid-argument', 'userId or email is required.');
    }

    let targetUid = userIdRaw;
    if (!targetUid) {
        const authUser = await adminAuth.getUserByEmail(emailRaw).catch(() => null);
        if (!authUser?.uid) {
            throw new HttpsError('not-found', 'User not found.');
        }
        targetUid = authUser.uid;
    }

    if (targetUid.length < 6 || targetUid.length > 128) {
        throw new HttpsError('invalid-argument', 'userId is invalid.');
    }

    const userRef = db.collection(COLLECTIONS.USERS).doc(targetUid);

    const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) {
            throw new HttpsError('not-found', 'User profile not found.');
        }

        const user = snap.data() || {};
        const status = String(user.status || '').trim();
        const activated = user.activated;
        const isArchived = user.isArchived === true;

        if (status !== USER_STATUS.INVITED || activated !== false || isArchived) {
            throw new HttpsError('failed-precondition', 'User is not in invited state.');
        }

        const prevCount = Number(user.inviteResendCount || 0);
        const nextCount = Number.isFinite(prevCount) && prevCount >= 0 ? prevCount + 1 : 1;

        tx.update(userRef, {
            invitedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            inviteResentAt: FieldValue.serverTimestamp(),
            inviteResendCount: FieldValue.increment(1),
            inviteLastResentBy: request.auth.uid,
        });

        return {
            email: normalizeText(user.email) || emailRaw,
            role: normalizeText(user.role),
            resendCount: nextCount,
        };
    });

    await writeAuditLog({
        actorUid: request.auth.uid,
        actorRole: admin.role,
        actorName: admin.name || admin.email,
        actionType: 'user_invite_resent',
        targetType: 'user',
        targetId: targetUid,
        metadata: {
            targetUid,
            targetEmail: result.email || null,
            targetRole: result.role || null,
            resendCount: result.resendCount || null,
        },
    }, { bestEffort: true });

    return {
        success: true,
        email: result.email,
        message: 'Invite resent metadata updated.',
    };
});

exports.setUserArchiveStatus = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'setUserArchiveStatus');
     const admin = await ensureAdmin(request);
    const { userId, isArchived } = request.data || {};

    if (!userId || typeof isArchived !== 'boolean') {
        throw new HttpsError('invalid-argument', 'userId and isArchived are required.');
    }

    await db.collection(COLLECTIONS.USERS).doc(userId).update({
        isArchived,
        updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditLog(isArchived ? 'user_archived' : 'user_restored', {
        actorUid: request.auth.uid,
        actorRole: admin.role,
        actorName: admin.name || admin.email,
        targetUid: userId,
    }, { bestEffort: true });

    return { success: true };
});

exports.getUnreadAnnouncementsCount = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'getUnreadAnnouncementsCount');
     const user = await ensureActiveUser(request);

    const userRef = db.collection(COLLECTIONS.USERS).doc(request.auth.uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
        return { unreadCount: 0 };
    }

    const userData = userSnap.data() || user || {};
    const role = userData.role || ROLES.STUDENT;
    const lastSeenAt = userData.announcementsLastSeenAt || null;

    let query = db.collection(COLLECTIONS.ANNOUNCEMENTS).where('isActive', '==', true);

    const audiences = role === ROLES.MAINTENANCE
        ? [ANNOUNCEMENT_AUDIENCE.ALL, ANNOUNCEMENT_AUDIENCE.MAINTENANCE]
        : role === ROLES.ADMIN || role === ROLES.SUPER_ADMIN
            ? [ANNOUNCEMENT_AUDIENCE.ALL, role]
            : [ANNOUNCEMENT_AUDIENCE.ALL, ANNOUNCEMENT_AUDIENCE.STUDENT];

    query = query.where('audience', 'in', audiences);

    if (lastSeenAt) {
        query = query.where('createdAt', '>', lastSeenAt);
    }

    const snap = await query.get();
    return { unreadCount: snap.size };
});

exports.markAnnouncementsSeen = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'markAnnouncementsSeen');
     const actor = await ensureActiveUser(request);

    await db.collection(COLLECTIONS.USERS).doc(request.auth.uid).set({
        announcementsLastSeenAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await writeAuditLog({
        actorUid: request.auth.uid,
        actorRole: actor.role,
        actorName: actor.name || actor.email,
        actionType: 'announcement_dashboard_viewed',
        targetType: 'dashboard',
        targetId: 'announcements',
        metadata: {
            callerRole: actor.role,
        },
    }, { bestEffort: true });

    return { success: true };
});
