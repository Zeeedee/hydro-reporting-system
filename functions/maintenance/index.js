/**
 * Maintenance Cloud Functions
 * Handles task management for maintenance staff
 */

const { onCall, HttpsError } = require('firebase-functions/https');
const { onSchedule } = require('firebase-functions/scheduler');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { ensureMaintenance, getAuthUid } = require('../shared/auth');
const {
    COLLECTIONS,
    TASK_STATUS,
    TASK_PRIORITY,
} = require('../shared/constants');
const { writeAuditLog } = require('../shared/audit');
const { enforceRateLimit, getPolicyForCallable } = require('../shared/rateLimit');

const db = getFirestore();

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

function normalizeStatus(raw) {
    const value = String(raw || '').trim();
    if (value === TASK_STATUS.LEGACY_PENDING) return TASK_STATUS.ASSIGNED;
    if (value === TASK_STATUS.LEGACY_DONE) return TASK_STATUS.COMPLETED;
    return value;
}

function isOverdueForAcceptance(task) {
    const acceptBy = task?.acceptBy;
    if (!acceptBy || typeof acceptBy.toMillis !== 'function') return false;
    if (task?.acceptedAt) return false;
    const status = normalizeStatus(task?.status);
    if (![TASK_STATUS.ASSIGNED, TASK_STATUS.LEGACY_PENDING].includes(status)) return false;
    return acceptBy.toMillis() < Date.now();
}

function isValidPriority(value) {
    return Object.values(TASK_PRIORITY).includes(String(value || '').trim());
}

/**
 * Get tasks assigned to the current maintenance user
 * @param {Object} data - { status?: string, limit?: number, startAfter?: string }
 */
exports.getMyTasks = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'getMyTasks');
    await ensureMaintenance(request);
    const uid = getAuthUid(request);

    const payload = request.data || {};
    const status = normalizeText(payload.status);
    const startAfter = normalizeText(payload.startAfter);
    const rawLimit = Number(payload.limit || 20);
    const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.floor(rawLimit))) : 20;

    let query = db.collection(COLLECTIONS.TASKS)
        .where('assignedTo', '==', uid)
        .orderBy('assignedAt', 'desc');

    if (status) {
        const allowed = [
            TASK_STATUS.ASSIGNED,
            TASK_STATUS.ACCEPTED,
            TASK_STATUS.IN_PROGRESS,
            TASK_STATUS.COMPLETED,
            TASK_STATUS.EXPIRED,
            TASK_STATUS.CLOSED_BY_TEAM,
            TASK_STATUS.LEGACY_PENDING,
            TASK_STATUS.LEGACY_DONE,
        ];
        if (!allowed.includes(status)) {
            throw new HttpsError('invalid-argument', 'Invalid task status filter');
        }
        query = query.where('status', '==', status);
    }

    if (startAfter) {
        const lastDoc = await db.collection(COLLECTIONS.TASKS).doc(startAfter).get();
        if (lastDoc.exists) {
            query = query.startAfter(lastDoc);
        }
    }

    query = query.limit(limit);

    const snapshot = await query.get();

    // Fetch associated report details for each task
    const tasks = await Promise.all(snapshot.docs.map(async (doc) => {
        const task = doc.data() || {};

        // Get report details
        const reportData = task.reportSnapshot && typeof task.reportSnapshot === 'object'
            ? task.reportSnapshot
            : {};

        // Backfill report data when snapshot missing or photos missing.
        const needsPhotos = !Array.isArray(reportData.photoUrls) || reportData.photoUrls.length === 0;
        if ((!reportData.building || needsPhotos) && task.reportId) {
            const reportDoc = await db.collection(COLLECTIONS.REPORTS).doc(task.reportId).get();
            if (reportDoc.exists) {
                const report = reportDoc.data() || {};
                reportData.building = report.building;
                reportData.floor = report.floor;
                reportData.location = report.location || report.area;
                reportData.issueType = report.issueType;
                reportData.description = report.description;
                reportData.riskLevel = report.riskLevel;
                reportData.photoUrls = Array.isArray(report.photoUrls) && report.photoUrls.length
                    ? report.photoUrls
                    : (report.photoUrl ? [report.photoUrl] : []);
            }
        }

        return {
            id: doc.id,
            ...task,
            status: isOverdueForAcceptance(task) ? TASK_STATUS.EXPIRED : normalizeStatus(task.status),
            priority: isValidPriority(task.priority) ? task.priority : String(reportData.riskLevel || TASK_PRIORITY.LOW),
            report: reportData,
        };
    }));

    // "Team job" helper tasks should not appear in maintenance dashboards.
    const visibleTasks = status
        ? tasks
        : tasks.filter((t) => normalizeStatus(t.status) !== TASK_STATUS.CLOSED_BY_TEAM);

    const lastDoc = snapshot.docs.length > 0
        ? snapshot.docs[snapshot.docs.length - 1].id
        : null;

    return { tasks: visibleTasks, lastDoc };
});

exports.getMyTaskBadgeCounts = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'getMyTaskBadgeCounts');
    await ensureMaintenance(request);
    const uid = getAuthUid(request);

    const openStatuses = [TASK_STATUS.ASSIGNED, TASK_STATUS.ACCEPTED, TASK_STATUS.IN_PROGRESS, TASK_STATUS.LEGACY_PENDING];

    const awaitingSnap = await db.collection(COLLECTIONS.TASKS)
        .where('assignedTo', '==', uid)
        .where('status', 'in', [TASK_STATUS.ASSIGNED, TASK_STATUS.LEGACY_PENDING])
        .get();

    const awaitingDocs = awaitingSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
    const expiredOverdue = awaitingDocs.filter((t) => isOverdueForAcceptance(t)).length;
    const awaitingAcceptance = Math.max(0, awaitingDocs.length - expiredOverdue);

    const urgentSnap = await db.collection(COLLECTIONS.TASKS)
        .where('assignedTo', '==', uid)
        .where('status', 'in', openStatuses)
        .where('priority', '==', TASK_PRIORITY.URGENT)
        .get();

    const urgentDocs = urgentSnap.docs.map((docSnap) => (docSnap.data() || {}));
    const urgentOpen = urgentDocs.filter((t) => !isOverdueForAcceptance(t) && normalizeStatus(t.status) !== TASK_STATUS.EXPIRED).length;

    return {
        awaitingAcceptance,
        urgentOpen,
        expiredOverdue,
    };
});

/**
 * Accept a pending task
 * @param {Object} data - { taskId: string }
 */
exports.acceptTask = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'acceptTask');
    const actor = await ensureMaintenance(request);
    const uid = getAuthUid(request);

    const taskId = normalizeText(request.data?.taskId);

    if (!taskId) {
        throw new HttpsError('invalid-argument', 'Task ID is required');
    }

    // Verify task is assigned to this user and is pending
    const taskDoc = await db.collection(COLLECTIONS.TASKS).doc(taskId).get();

    if (!taskDoc.exists) {
        throw new HttpsError('not-found', 'Task not found');
    }

    const task = taskDoc.data() || {};

    if (task.assignedTo !== uid) {
        throw new HttpsError('permission-denied', 'This task is not assigned to you');
    }

    const normalizedStatus = normalizeStatus(task.status);
    if (![TASK_STATUS.ASSIGNED, TASK_STATUS.LEGACY_PENDING].includes(normalizedStatus)) {
        throw new HttpsError('failed-precondition', 'Task is not awaiting acceptance');
    }

    const acceptBy = task.acceptBy;
    const acceptedAtExisting = task.acceptedAt;
    const isExpired =
        !acceptedAtExisting && acceptBy && typeof acceptBy.toMillis === 'function' && acceptBy.toMillis() < Date.now();
    if (isExpired) {
        await taskDoc.ref.set({
            status: TASK_STATUS.EXPIRED,
            expiredAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        }, { merge: true });

        await writeAuditLog({
            actorUid: uid,
            actorRole: actor.role,
            actorName: actor.name || actor.email,
            actionType: 'task_expired',
            targetType: 'task',
            targetId: taskId,
            metadata: {
                reportId: task.reportId || null,
                reason: 'acceptBy_elapsed',
                assignedTo: task.assignedTo || null,
                assignedAt: task.assignedAt?.toDate?.() ? task.assignedAt.toDate().toISOString() : null,
                acceptBy: task.acceptBy?.toDate?.() ? task.acceptBy.toDate().toISOString() : null,
            },
        }, { bestEffort: true });

        throw new HttpsError('failed-precondition', 'Task acceptance window has expired');
    }

    const batch = db.batch();

    const acceptedAt = Timestamp.now();
    batch.update(taskDoc.ref, {
        status: TASK_STATUS.ACCEPTED,
        acceptedAt,
        performedByUid: uid,
        performedByName: actor.name || actor.email || null,
        performedByEmail: actor.email || null,
        updatedAt: acceptedAt,
    });

    // Update report status
    if (task.reportId) {
        const reportRef = db.collection(COLLECTIONS.REPORTS).doc(task.reportId);
        batch.update(reportRef, {
            status: 'in_progress',
            updatedAt: FieldValue.serverTimestamp()
        });
    }

    await batch.commit();

    await writeAuditLog({
        actorUid: uid,
        actorRole: actor.role,
        actorName: actor.name || actor.email,
        actionType: 'task_accepted',
        targetType: 'task',
        targetId: taskId,
        metadata: {
            reportId: task.reportId || null,
            acceptedAt: acceptedAt.toDate().toISOString(),
            acceptBy: task.acceptBy?.toDate?.() ? task.acceptBy.toDate().toISOString() : null,
        },
    }, { bestEffort: true });

    return { success: true };
});

exports.startTask = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'startTask');
    const actor = await ensureMaintenance(request);
    const uid = getAuthUid(request);

    const taskId = normalizeText(request.data?.taskId);
    if (!taskId) {
        throw new HttpsError('invalid-argument', 'Task ID is required');
    }

    const taskDoc = await db.collection(COLLECTIONS.TASKS).doc(taskId).get();
    if (!taskDoc.exists) {
        throw new HttpsError('not-found', 'Task not found');
    }

    const task = taskDoc.data() || {};
    if (task.assignedTo !== uid) {
        throw new HttpsError('permission-denied', 'This task is not assigned to you');
    }

    const status = normalizeStatus(task.status);
    if (status !== TASK_STATUS.ACCEPTED && status !== TASK_STATUS.IN_PROGRESS) {
        throw new HttpsError('failed-precondition', 'Task must be accepted before starting');
    }

    if (status === TASK_STATUS.IN_PROGRESS && task.startedAt) {
        return { success: true, alreadyStarted: true };
    }

    const startedAt = Timestamp.now();
    await taskDoc.ref.set({
        status: TASK_STATUS.IN_PROGRESS,
        startedAt,
        performedByUid: uid,
        performedByName: actor.name || actor.email || null,
        performedByEmail: actor.email || null,
        updatedAt: startedAt,
    }, { merge: true });

    if (task.reportId) {
        const reportRef = db.collection(COLLECTIONS.REPORTS).doc(task.reportId);
        await reportRef.set({
            status: 'in_progress',
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    }

    await writeAuditLog({
        actorUid: uid,
        actorRole: actor.role,
        actorName: actor.name || actor.email,
        actionType: 'task_started',
        targetType: 'task',
        targetId: taskId,
        metadata: {
            reportId: task.reportId || null,
            startedAt: startedAt.toDate().toISOString(),
        },
    }, { bestEffort: true });

    return { success: true };
});

/**
 * Mark a task as done
 * @param {Object} data - { taskId: string, notes: string }
 */
exports.markTaskDone = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'markTaskDone');
    const actor = await ensureMaintenance(request);
    const uid = getAuthUid(request);

    const taskId = normalizeText(request.data?.taskId);
    const notes = normalizeText(request.data?.notes);

    if (!notes) {
        throw new HttpsError('invalid-argument', 'Work report is required to complete a task');
    }

    if (notes.length > 800) {
        throw new HttpsError('invalid-argument', 'Notes must be 800 characters or fewer');
    }

    if (!taskId) {
        throw new HttpsError('invalid-argument', 'Task ID is required');
    }

    // Verify task is assigned to this user
    const taskDoc = await db.collection(COLLECTIONS.TASKS).doc(taskId).get();

    if (!taskDoc.exists) {
        throw new HttpsError('not-found', 'Task not found');
    }

    const task = taskDoc.data();

    if (task.assignedTo !== uid) {
        throw new HttpsError('permission-denied', 'This task is not assigned to you');
    }

    const status = normalizeStatus(task.status);
    if (status === TASK_STATUS.COMPLETED || status === TASK_STATUS.LEGACY_DONE) {
        throw new HttpsError('failed-precondition', 'Task is already completed');
    }

    if (status !== TASK_STATUS.IN_PROGRESS) {
        throw new HttpsError('failed-precondition', 'Task must be in progress before completion');
    }

    let report = null;
    if (task.reportId) {
        const reportDoc = await db.collection(COLLECTIONS.REPORTS).doc(task.reportId).get();
        if (!reportDoc.exists) {
            throw new HttpsError('failed-precondition', 'Associated report was not found');
        }
        report = reportDoc.data() || {};

        const legacyTaskId = String(report.taskId || '').trim();
        const taskIds = Array.isArray(report.taskIds) ? report.taskIds.map((v) => String(v || '').trim()).filter(Boolean) : [];
        const isCurrent = taskIds.includes(taskId) || legacyTaskId === taskId;
        if (!isCurrent) {
            // Prevent stale/reassigned tasks from resolving a report.
            throw new HttpsError('failed-precondition', 'This task is no longer active for the report. Please refresh.');
        }
    }

    const batch = db.batch();
    let closedTaskIds = [];

    // Update task
    const completedAt = Timestamp.now();
    const startedAt = task.startedAt || task.acceptedAt || task.assignedAt || null;
    const startMs = startedAt?.toMillis ? startedAt.toMillis() : null;
    const durationSeconds = startMs ? Math.max(0, Math.floor((completedAt.toMillis() - startMs) / 1000)) : null;

    const taskUpdate = {
        status: TASK_STATUS.COMPLETED,
        completedAt,
        durationSeconds,
        updatedAt: completedAt,
        performedByUid: uid,
        performedByName: actor.name || actor.email || null,
        performedByEmail: actor.email || null,
    };
    taskUpdate.completionNotes = notes;
    batch.update(taskDoc.ref, taskUpdate);

    // Update report to resolved
    if (task.reportId) {
        const reportRef = db.collection(COLLECTIONS.REPORTS).doc(task.reportId);
        batch.update(reportRef, {
            status: 'resolved',
            resolvedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        // Close all other active tasks for the same report (team-job behavior).
        let relatedSnap = null;
        try {
            relatedSnap = await db.collection(COLLECTIONS.TASKS)
                .where('reportId', '==', String(task.reportId || '').trim())
                .limit(80)
                .get();
        } catch (_) {
            relatedSnap = null;
        }

        closedTaskIds = [];
        if (relatedSnap && !relatedSnap.empty) {
            relatedSnap.docs.forEach((docSnap) => {
                if (docSnap.id === taskId) return;
                const data = docSnap.data() || {};
                const s = normalizeStatus(data.status);
                const isTerminal = [
                    TASK_STATUS.COMPLETED,
                    TASK_STATUS.EXPIRED,
                    TASK_STATUS.CLOSED_BY_TEAM,
                    TASK_STATUS.LEGACY_DONE,
                ].includes(s) || String(data.status || '').trim() === TASK_STATUS.LEGACY_DONE;
                if (isTerminal) return;

                closedTaskIds.push(docSnap.id);
                batch.set(docSnap.ref, {
                    status: TASK_STATUS.CLOSED_BY_TEAM,
                    closedAt: completedAt,
                    closedByUid: uid,
                    closedByName: actor.name || actor.email || null,
                    closedByEmail: actor.email || null,
                    closedReason: 'team_completed',
                    closedByTaskId: taskId,
                    updatedAt: completedAt,
                }, { merge: true });
            });
        }
    }

    await batch.commit();

    await writeAuditLog({
        actorUid: uid,
        actorRole: actor.role,
        actorName: actor.name || actor.email,
        actionType: 'task_completed',
        targetType: 'task',
        targetId: taskId,
        metadata: {
            reportId: task.reportId || null,
            notesProvided: Boolean(notes),
            durationSeconds,
            startedAt: task.startedAt?.toDate?.() ? task.startedAt.toDate().toISOString() : (task.acceptedAt?.toDate?.() ? task.acceptedAt.toDate().toISOString() : null),
            completedAt: completedAt.toDate().toISOString(),
        },
    }, { bestEffort: true });

    // Best-effort audit trail for helper task closures (after commit).
    if (closedTaskIds.length) {
        closedTaskIds.forEach((closedTaskId) => {
            writeAuditLog({
                actorUid: uid,
                actorRole: actor.role,
                actorName: actor.name || actor.email,
                actionType: 'task_closed_by_team',
                targetType: 'task',
                targetId: closedTaskId,
                metadata: {
                    reportId: task.reportId || null,
                    closedByTaskId: taskId,
                    closedAt: completedAt.toDate().toISOString(),
                },
            }, { bestEffort: true }).catch(() => {});
        });
    }

    return { success: true };
});

/**
 * Get maintenance dashboard stats
 */
exports.getMyStats = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'getMyStats');
    await ensureMaintenance(request);
    const uid = getAuthUid(request);

    const tasksSnap = await db.collection(COLLECTIONS.TASKS)
        .where('assignedTo', '==', uid)
        .get();

    let totalResolved = 0;
    let pendingTasks = 0;
    let acceptedTasks = 0;
    let inProgressTasks = 0;
    let resolvedThisWeek = 0;

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    tasksSnap.forEach(doc => {
        const task = doc.data();

        const status = normalizeStatus(task.status);

        if (status === TASK_STATUS.COMPLETED || task.status === TASK_STATUS.LEGACY_DONE) {
            totalResolved++;

            // Check if resolved this week
            if (task.completedAt) {
                const completedDate = task.completedAt.toDate
                    ? task.completedAt.toDate()
                    : new Date(task.completedAt);
                if (completedDate >= weekAgo) {
                    resolvedThisWeek++;
                }
            }
        } else if (status === TASK_STATUS.ASSIGNED || task.status === TASK_STATUS.LEGACY_PENDING) {
            pendingTasks++;
        } else if (status === TASK_STATUS.ACCEPTED) {
            acceptedTasks++;
        } else if (status === TASK_STATUS.IN_PROGRESS) {
            inProgressTasks++;
        }
    });

    return {
        totalResolved,
        pendingTasks,
        acceptedTasks,
        inProgressTasks,
        resolvedThisWeek
    };
});

exports.expireOverdueTasks = onSchedule({ schedule: 'every 15 minutes', region: 'asia-southeast1' }, async () => {
    const now = Timestamp.now();
    let snapshot = null;
    try {
        // Avoid composite index requirements by querying acceptBy only.
        snapshot = await db.collection(COLLECTIONS.TASKS)
            .where('acceptBy', '<', now)
            .limit(300)
            .get();
    } catch (error) {
        console.error('[tasks] expireOverdueTasks query failed', error);
    }

    if (snapshot && snapshot.empty) {
        snapshot = null;
    }

    const updates = [];
    snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        if (data.acceptedAt) return;
        const status = normalizeStatus(data.status);
        if (![TASK_STATUS.ASSIGNED, TASK_STATUS.LEGACY_PENDING].includes(status)) return;
        if (!data.acceptBy || typeof data.acceptBy.toMillis !== 'function') return;
        if (data.acceptBy.toMillis() >= now.toMillis()) return;
        updates.push({ ref: docSnap.ref, data });
    });

    if (snapshot && !updates.length) {
        snapshot = null;
    }

    if (updates.length) {
        for (const item of updates) {
            const taskId = item.ref.id;
            try {
                await item.ref.set({
                    status: TASK_STATUS.EXPIRED,
                    expiredAt: now,
                    updatedAt: now,
                }, { merge: true });

                await writeAuditLog({
                    actorUid: 'system',
                    actorRole: 'system',
                    actorName: 'System',
                    actionType: 'task_expired',
                    targetType: 'task',
                    targetId: taskId,
                    metadata: {
                        reportId: item.data.reportId || null,
                        assignedTo: item.data.assignedTo || null,
                        assignedAt: item.data.assignedAt?.toDate?.() ? item.data.assignedAt.toDate().toISOString() : null,
                        acceptBy: item.data.acceptBy?.toDate?.() ? item.data.acceptBy.toDate().toISOString() : null,
                    },
                }, { bestEffort: true });
            } catch (error) {
                console.error('[tasks] expireOverdueTasks update failed', taskId, error);
            }
        }
    }

    // Lightweight cleanup for ephemeral collections to keep storage and index growth bounded.
    // This is NOT a rate limiter change; it only deletes stale documents.
    async function deleteOldDocs({ collectionName, timestampField, olderThanMs, batchSize = 300, maxBatches = 2 }) {
        const cutoff = Timestamp.fromMillis(Date.now() - olderThanMs);
        for (let i = 0; i < maxBatches; i += 1) {
            let snap;
            try {
                snap = await db.collection(collectionName)
                    .where(timestampField, '<', cutoff)
                    .orderBy(timestampField)
                    .limit(batchSize)
                    .get();
            } catch (error) {
                console.error(`[cleanup] query failed ${collectionName}.${timestampField}`, error);
                return;
            }

            if (snap.empty) return;

            const batch = db.batch();
            snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
            try {
                await batch.commit();
            } catch (error) {
                console.error(`[cleanup] delete failed ${collectionName}`, error);
                return;
            }

            if (snap.size < batchSize) return;
        }
    }

    // Keep at least >1 day (max rate limit window) worth of history.
    await deleteOldDocs({
        collectionName: 'rate_limits',
        timestampField: 'lastSeenAt',
        olderThanMs: 3 * 24 * 60 * 60 * 1000,
        batchSize: 300,
        maxBatches: 2,
    });

    // Login lock window is short; keep a rolling 30-day history.
    await deleteOldDocs({
        collectionName: 'login_attempts',
        timestampField: 'lastAttemptAt',
        olderThanMs: 30 * 24 * 60 * 60 * 1000,
        batchSize: 300,
        maxBatches: 2,
    });
});
