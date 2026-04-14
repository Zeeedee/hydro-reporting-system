export const COLLECTIONS = Object.freeze({
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

export const ROLES = Object.freeze({
  USER: 'student',
  STUDENT: 'student',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
  MAINTENANCE: 'maintenance',
});

export const USER_STATUS = Object.freeze({
  INVITED: 'invited',
  ACTIVE: 'active',
  DISABLED: 'disabled',
});

export const USER_FIELDS = Object.freeze({
  ROLE: 'role',
  NAME: 'name',
  EMAIL: 'email',
  PHONE: 'phone',
  STATUS: 'status',
  ACTIVATED: 'activated',
  INVITED_AT: 'invitedAt',
  ACTIVATED_AT: 'activatedAt',
  CREATED_BY: 'createdBy',
  IS_ARCHIVED: 'isArchived',
  CREATED_AT: 'createdAt',
  UPDATED_AT: 'updatedAt',
  ANNOUNCEMENTS_LAST_SEEN_AT: 'announcementsLastSeenAt',
});

export const ANNOUNCEMENT_FIELDS = Object.freeze({
  TITLE: 'title',
  BODY: 'body',
  TYPE: 'type',
  AUDIENCE: 'audience',
  IS_ACTIVE: 'isActive',
  PINNED: 'pinned',
  CREATED_AT: 'createdAt',
  CREATED_BY: 'createdBy',
  UPDATED_AT: 'updatedAt',
});

export const ANNOUNCEMENT_AUDIENCE = Object.freeze({
  ALL: 'all',
  STUDENT: 'student',
  MAINTENANCE: 'maintenance',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
});

export const ANNOUNCEMENT_TYPES = Object.freeze({
  GENERAL: 'general',
  MAINTENANCE: 'maintenance',
  ALERT: 'alert',
  UPDATE: 'update',
});

export const ROUTES = Object.freeze({
  SIGN_IN: '/login.html',
  AUTH_ACTION: '/auth-action.html',
  BOOTSTRAP: '/bootstrap.html',
  USER_DASHBOARD: '/index.html',
  STUDENT_DASHBOARD: '/index.html',
  ADMIN_DASHBOARD: '/admin/index.html',
  ADMIN_MFA_ENROLL: '/admin/mfa-enroll.html',
  ADMIN_MFA_CHALLENGE: '/admin/mfa-challenge.html',
  MAINTENANCE_DASHBOARD: '/maintenance/index.html',
  ANNOUNCEMENTS: '/notifications.html',
  ADMIN_ANNOUNCEMENTS: '/admin/announcements.html',
});

export const TIMEZONES = Object.freeze({
  MANILA: 'Asia/Manila',
});

export const REPORT_MEDIA = Object.freeze({
  MAX_IMAGES: 3,
  MAX_IMAGE_BYTES: 5 * 1024 * 1024,
  ALLOWED_IMAGE_MIME_TYPES: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
});

export const AUDIT_ACTION_TYPES = Object.freeze([
  'superadmin_bootstrap',
  'user_invited',
  'user_activated',
  'user_archived',
  'user_restored',
  'user_role_updated',
  'announcement_created',
  'announcement_updated',
  'announcement_disabled',
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

  'login_blocked_unprovisioned',

  'profile_updated',
  'profile_photo_updated',

  'audit_dashboard_viewed',
  'announcement_dashboard_viewed',
]);

export const AUDIT_TARGET_TYPES = Object.freeze([
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

export const TASK_STATUS = Object.freeze({
  ASSIGNED: 'assigned',
  ACCEPTED: 'accepted',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  EXPIRED: 'expired',
  CLOSED_BY_TEAM: 'closed_by_team',
});

export const TASK_PRIORITY = Object.freeze({
  URGENT: 'urgent',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
});
