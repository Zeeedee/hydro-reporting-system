const COLLECTIONS = Object.freeze({
    USERS: 'users',
    STUDENTS: 'students',
    REPORTS: 'reports',
    TASKS: 'tasks',
    ANNOUNCEMENTS: 'announcements',
    LOCATIONS: 'locations',
    FAQS: 'faqs',
    DEPARTMENTS: 'departments',
    AUDIT_LOGS: 'audit_logs',
    SYSTEM_CONFIG: 'systemConfig',
    SECURITY_LOGS: 'securityLogs',
});

const USER_STATUS = Object.freeze({
    INVITED: 'invited',
    ACTIVE: 'active',
    DISABLED: 'disabled',
});

const SYSTEM_CONFIG_DOCS = Object.freeze({
    BOOTSTRAP: 'bootstrap',
});

const ANNOUNCEMENT_AUDIENCE = Object.freeze({
    ALL: 'all',
    STUDENT: 'student',
    MAINTENANCE: 'maintenance',
    ADMIN: 'admin',
    SUPER_ADMIN: 'super_admin',
});

const ANNOUNCEMENT_TYPES = Object.freeze({
    GENERAL: 'general',
    MAINTENANCE: 'maintenance',
    ALERT: 'alert',
    UPDATE: 'update',
});

const TASK_STATUS = Object.freeze({
    ASSIGNED: 'assigned',
    ACCEPTED: 'accepted',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    EXPIRED: 'expired',
    // Terminal status for "team job" helper tasks when another assignee completed the work.
    CLOSED_BY_TEAM: 'closed_by_team',

    // Legacy values still present in existing documents.
    LEGACY_PENDING: 'pending',
    LEGACY_DONE: 'done',
});

const TASK_PRIORITY = Object.freeze({
    URGENT: 'urgent',
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low',
});

// Default task acceptance window.
const TASK_ACCEPTANCE_WINDOW_HOURS = 24;

module.exports = {
    COLLECTIONS,
    USER_STATUS,
    SYSTEM_CONFIG_DOCS,
    ANNOUNCEMENT_AUDIENCE,
    ANNOUNCEMENT_TYPES,
    TASK_STATUS,
    TASK_PRIORITY,
    TASK_ACCEPTANCE_WINDOW_HOURS,
};
