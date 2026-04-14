/**
 * HYDRO - Cloud Functions
 * Exports all cloud functions for student, admin, and maintenance dashboards
 */

const { initializeApp } = require('firebase-admin/app');

// Initialize Firebase Admin (required before using Firestore)
initializeApp();

// Import function modules
// NOTE: Auth user.create triggers are v1-only in firebase-functions.
// Phase 9.H disabled auto-provisioning; we intentionally do not deploy an Auth create trigger.
const admin = require("./admin/index");
const maintenance = require("./maintenance/index");
const shared = require("./shared/updateProfile");
const faq = require("./admin/faq");
const systemConfig = require("./shared/systemConfig");
const departments = require("./shared/departments");
const bootstrap = require('./bootstrap/index');
const account = require('./shared/account');
const loginAttempts = require('./shared/loginAttempts');
const auditTriggers = require('./triggers/audit-triggers');
const reportMedia = require('./shared/reportMedia');

// ==================== SHARED FUNCTIONS ====================
exports.updateUserProfile = shared.updateUserProfile;
exports.appendReportPhotos = reportMedia.appendReportPhotos;
exports.syncReportPhotosFromStorage = reportMedia.syncReportPhotosFromStorage;
exports.getSystemConfig = systemConfig.getSystemConfig;
exports.bootstrapFirstSuperAdmin = bootstrap.bootstrapFirstSuperAdmin;
exports.getBootstrapStatus = bootstrap.getBootstrapStatus;
exports.activateInvitedAccount = account.activateInvitedAccount;
exports.logUnprovisionedLogin = account.logUnprovisionedLogin;
exports.checkLoginAllowed = loginAttempts.checkLoginAllowed;
exports.recordLoginAttempt = loginAttempts.recordLoginAttempt;

// ==================== DEPARTMENT MANAGEMENT ====================
exports.manageDepartments = departments.manageDepartments;
exports.getDepartments = departments.getDepartments;

// ==================== FAQ FUNCTIONS ====================
exports.getFaqs = faq.getFaqs;
exports.getAllFaqsAdmin = faq.getAllFaqsAdmin;
exports.createFaq = faq.createFaq;
exports.updateFaq = faq.updateFaq;
exports.deleteFaq = faq.deleteFaq;

// ==================== STUDENT FUNCTIONS ====================
exports.onReportCreatedAudit = auditTriggers.onReportCreatedAudit;
exports.onReportImagesAddedAudit = auditTriggers.onReportImagesAddedAudit;

// ==================== ADMIN FUNCTIONS ====================
exports.getAllReports = admin.getAllReports;
exports.updateReportStatus = admin.updateReportStatus;
exports.assignTask = admin.assignTask;
exports.getMaintenanceStaff = admin.getMaintenanceStaff;
exports.createAnnouncement = admin.createAnnouncement;
exports.updateAnnouncement = admin.updateAnnouncement;
exports.deleteAnnouncementByAdmin = admin.deleteAnnouncementByAdmin;
exports.getAnalytics = admin.getAnalytics;
exports.searchUsers = admin.searchUsers;
exports.getAllUsers = admin.getAllUsers;
exports.updateUserRole = admin.updateUserRole;
exports.getLocations = admin.getLocations;
exports.createLocation = admin.createLocation;
exports.deleteLocation = admin.deleteLocation;
exports.createFloor = admin.createFloor;
exports.deleteFloor = admin.deleteFloor;
exports.logAuditDashboardViewed = admin.logAuditDashboardViewed;
exports.createUserByAdmin = admin.createUserByAdmin;
exports.resendInviteByAdmin = admin.resendInviteByAdmin;
exports.setUserArchiveStatus = admin.setUserArchiveStatus;
exports.getUnreadAnnouncementsCount = admin.getUnreadAnnouncementsCount;
exports.markAnnouncementsSeen = admin.markAnnouncementsSeen;

// ==================== MAINTENANCE FUNCTIONS ====================
exports.getMyTasks = maintenance.getMyTasks;
exports.getMyTaskBadgeCounts = maintenance.getMyTaskBadgeCounts;
exports.acceptTask = maintenance.acceptTask;
exports.startTask = maintenance.startTask;
exports.markTaskDone = maintenance.markTaskDone;
exports.getMyStats = maintenance.getMyStats;
exports.expireOverdueTasks = maintenance.expireOverdueTasks;

