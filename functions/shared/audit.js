const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { COLLECTIONS } = require('./constants');

const db = getFirestore();

// Canonical enums (expand as needed, but do not accept arbitrary values).
const ACTION_TYPES = Object.freeze([
    'superadmin_bootstrap',
    'user_invited',
    'user_invite_resent',
    'user_activated',
    'user_archived',
    'user_restored',
    'user_role_updated',

    'announcement_created',
    'announcement_updated',
    'announcement_disabled',
    'announcement_deleted',
    'announcement_pinned',

    'location_created',
    'location_updated',
    'location_deleted',

    'report_created',
    'report_status_updated',
    'report_images_added',
    'report_updated',
    'report_management_filtered',
    'assignment_blocked_resolved',
    'task_assigned',
    'task_accepted',
    'task_started',
    'task_completed',
    'task_closed_by_team',
    'task_expired',

    'profile_updated',
    'profile_photo_updated',

    'audit_dashboard_viewed',
    'announcement_dashboard_viewed',

    'login_blocked_unprovisioned',
]);

const TARGET_TYPES = Object.freeze([
    'auth',
    'user',
    'announcement',
    'location',
    'report',
    'task',
    'system',
    'dashboard',
    'unknown',
]);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeString(value, maxLen) {
    const raw = String(value == null ? '' : value);
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (trimmed.length <= maxLen) return trimmed;
    return trimmed.slice(0, maxLen);
}

function shouldRedactKey(key) {
    const normalized = String(key || '').toLowerCase();
    return [
        'password',
        'pass',
        'secret',
        'token',
        'apikey',
        'api_key',
        'bootstrapkey',
        'bootstrap_key',
        'authorization',
    ].some((needle) => normalized.includes(needle));
}

function sanitizeMetadata(value, options = {}) {
    const {
        maxDepth = 4,
        maxKeys = 60,
        maxString = 500,
        maxArray = 20,
        maxJsonBytes = 6000,
    } = options;

    const seen = new WeakSet();

    function walk(node, depth) {
        if (node == null) return null;
        if (typeof node === 'string') return sanitizeString(node, maxString);
        if (typeof node === 'number') return Number.isFinite(node) ? node : null;
        if (typeof node === 'boolean') return node;
        if (node instanceof Date) return node.toISOString();

        if (Array.isArray(node)) {
            if (depth >= maxDepth) return [];
            return node.slice(0, maxArray).map((item) => walk(item, depth + 1));
        }

        if (!isPlainObject(node)) {
            return sanitizeString(node, maxString);
        }

        if (seen.has(node)) {
            return '[Circular]';
        }
        seen.add(node);

        if (depth >= maxDepth) {
            return {};
        }

        const out = {};
        const entries = Object.entries(node).slice(0, maxKeys);
        for (const [key, val] of entries) {
            if (shouldRedactKey(key)) {
                out[key] = '[REDACTED]';
                continue;
            }
            out[key] = walk(val, depth + 1);
        }
        return out;
    }

    const sanitized = isPlainObject(value) ? walk(value, 0) : walk({ value }, 0);
    try {
        const json = JSON.stringify(sanitized);
        if (Buffer.byteLength(json, 'utf8') <= maxJsonBytes) {
            return sanitized;
        }
        return { truncated: true };
    } catch (_) {
        return { unsupported: true };
    }
}

function validateEnum(value, allowedValues, label) {
    const normalized = sanitizeString(value, 64);
    if (!normalized) {
        throw new Error(`${label} is required`);
    }
    if (!allowedValues.includes(normalized)) {
        throw new Error(`${label} is invalid`);
    }
    return normalized;
}

function normalizeLegacyWrite(actionType, payload = {}) {
    const actorUid = sanitizeString(payload.actorUid || payload.uid || '', 128);
    const actorRole = sanitizeString(payload.actorRole || payload.role || '', 64);
    const actorName = sanitizeString(payload.actorName || payload.actorDisplayName || payload.actorFullName || '', 160);

    const targetId = sanitizeString(
        payload.targetId ||
        payload.targetUid ||
        payload.userId ||
        payload.locationId ||
        payload.announcementId ||
        payload.reportId ||
        '',
        256
    );

    let targetType = 'unknown';
    if (payload.targetType) {
        targetType = sanitizeString(payload.targetType, 64);
    } else if (payload.targetUid || payload.userId) {
        targetType = 'user';
    } else if (payload.locationId) {
        targetType = 'location';
    } else if (payload.announcementId) {
        targetType = 'announcement';
    }

    const metadata = { ...payload };
    delete metadata.actorUid;
    delete metadata.actorRole;
    delete metadata.targetUid;
    delete metadata.targetId;
    delete metadata.targetType;
    delete metadata.userId;
    delete metadata.locationId;
    delete metadata.announcementId;

    return {
        actorUid,
        actorRole,
        actorName,
        actionType,
        targetType,
        targetId,
        metadata,
    };
}

async function resolveActorNameBestEffort(uid) {
    const actorUid = sanitizeString(uid, 128);
    if (!actorUid) return '';

    try {
        const snap = await db.collection(COLLECTIONS.USERS).doc(actorUid).get();
        if (!snap.exists) return '';
        const data = snap.data() || {};
        const name = sanitizeString(data.name || '', 160);
        if (name) return name;
        const email = sanitizeString(data.email || '', 200);
        if (email && email.includes('@')) return sanitizeString(email.split('@')[0], 160);
        return '';
    } catch (error) {
        console.error('[audit] failed to resolve actorName', error);
        return '';
    }
}

/**
 * Canonical audit writer.
 * 
 * writeAuditLog({ actorUid, actorRole, actionType, targetType, targetId, metadata }, { bestEffort })
 * 
 * Back-compat supported:
 * writeAuditLog(actionType, payload, options)
 */
async function writeAuditLog(arg1, arg2 = {}, arg3 = {}) {
    const options = isPlainObject(arg3)
        ? arg3
        : isPlainObject(arg2) && Object.prototype.hasOwnProperty.call(arg2, 'bestEffort')
            ? arg2
            : {};
    const bestEffort = options.bestEffort !== false;

    let entryInput;
    if (typeof arg1 === 'string') {
        entryInput = normalizeLegacyWrite(arg1, isPlainObject(arg2) ? arg2 : {});
    } else if (isPlainObject(arg1)) {
        entryInput = arg1;
    } else {
        entryInput = {};
    }

    try {
        const actionType = validateEnum(entryInput.actionType, ACTION_TYPES, 'actionType');
        const targetType = validateEnum(entryInput.targetType || 'unknown', TARGET_TYPES, 'targetType');

        const actorUid = sanitizeString(entryInput.actorUid, 128) || 'unknown';
        const actorRole = sanitizeString(entryInput.actorRole, 64) || 'unknown';
        let actorName = sanitizeString(entryInput.actorName, 160);
        const targetId = sanitizeString(entryInput.targetId, 256) || 'unknown';

        if (!actorName && actorUid !== 'unknown') {
            actorName = await resolveActorNameBestEffort(actorUid);
        }
        if (!actorName) {
            actorName = 'Unknown';
        }

        const metadata = sanitizeMetadata(entryInput.metadata || {});

        const entry = {
            timestamp: FieldValue.serverTimestamp(),
            // Keep legacy createdAt for older UI reads (do not rely on it for ordering).
            createdAt: FieldValue.serverTimestamp(),
            actorUid,
            actorName,
            actorRole,
            actionType,
            targetType,
            targetId,
            metadata,
        };

        await db.collection(COLLECTIONS.AUDIT_LOGS).add(entry);
    } catch (error) {
        if (bestEffort) {
            console.error('[audit] best-effort write failed', error);
            return;
        }
        throw error;
    }
}

module.exports = {
    writeAuditLog,
    ACTION_TYPES,
    TARGET_TYPES,
};
