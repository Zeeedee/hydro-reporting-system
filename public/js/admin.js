/**
 * Admin Dashboard JavaScript
 * Handles data fetching and rendering for admin dashboard
 */

import { db } from './firebase-config.js';
import {
    collection,
    query,
    orderBy,
    limit,
    getDocs,
    where,
    Timestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';
import { COLLECTIONS } from './config/app-constants.js';
import { formatTimestampManila } from './timezone.js';
import { handleRateLimitError, isRateLimitError } from './shared/rate-limit-ui.js';
import { logError } from './shared/logger.js';

const functions = getFunctions(undefined, 'asia-southeast1');

async function callCallable(name, data) {
    const callable = httpsCallable(functions, name);
    try {
        return await callable(data);
    } catch (error) {
        handleRateLimitError(error);
        throw error;
    }
}

// ==================== DASHBOARD STATS ====================

/**
 * Fetch dashboard statistics
 * @returns {Promise<Object>} Stats object
 */
export async function getDashboardStats() {
    try {
        const result = await callCallable('getAnalytics');
        return result.data;
    } catch (error) {
        logError('Error fetching analytics:', error);
        if (isRateLimitError(error)) throw error;
        // Fallback to direct Firestore query
        return await getStatsFromFirestore();
    }
}

/**
 * Fallback: Get stats directly from Firestore
 */
async function getStatsFromFirestore() {
    const reportsSnap = await getDocs(collection(db, COLLECTIONS.REPORTS));

    let total = 0;
    let open = 0;
    let inProgress = 0;
    let completed = 0;
    let urgentHigh = 0;
    const buildings = {};
    const issues = {};
    const monthlyTrends = {};

    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
    });

    reportsSnap.forEach(doc => {
        const report = doc.data();
        total++;

        const status = String(report.status || '').trim();
        if (status === 'pending') open++;
        else if (status === 'in_progress') inProgress++;
        else if (status === 'resolved' || status === 'closed') completed++;

        const risk = String(report.riskLevel || '').trim();
        if (risk === 'urgent' || risk === 'high') urgentHigh++;

        const issue = String(report.issueType || 'Other').trim() || 'Other';
        issues[issue] = (issues[issue] || 0) + 1;

        const building = String(report.building || 'Unknown').trim() || 'Unknown';
        buildings[building] = (buildings[building] || 0) + 1;

        const createdAt = report.createdAt?.toDate ? report.createdAt.toDate() : (report.createdAt ? new Date(report.createdAt) : null);
        if (createdAt && !Number.isNaN(createdAt.getTime())) {
            const parts = fmt.formatToParts(createdAt);
            const year = parts.find(p => p.type === 'year')?.value;
            const month = parts.find(p => p.type === 'month')?.value;
            if (year && month) {
                const key = `${year}-${month}`;
                monthlyTrends[key] = (monthlyTrends[key] || 0) + 1;
            }
        }
    });

    return {
        stats: {
            totalReports: total,
            openReports: open,
            inProgressReports: inProgress,
            completedReports: completed,
            urgentHighReports: urgentHigh,
        },
        monthlyTrends,
        buildingDistribution: buildings,
        issueTypeDistribution: issues,
        recurringContaminationAreas: [],
        statusBreakdown: { open, inProgress, completed },
        resolutionTime: { currentAvgHours: null, previousAvgHours: null, deltaPct: null, bestMonth: null, bestAvgHours: null },
    };
}

// ==================== REPORTS ====================

/**
 * Fetch all reports with pagination
 * @param {Object} options - {limit, startAfter, status, department}
 * @returns {Promise<Object>} {reports, lastDoc}
 */
export async function getAllReports(options = {}) {
    try {
        const result = await callCallable('getAllReports', options);
        return result.data;
    } catch (error) {
        logError('Error fetching reports:', error);
        handleRateLimitError(error);
        throw error;
    }
}

/**
 * Update report status
 * @param {string} reportId 
 * @param {Object} updates - {status, riskLevel, notes}
 */
export async function updateReportStatus(reportId, updates) {
    return await callCallable('updateReportStatus', { reportId, ...updates });
}

/**
 * Assign task to maintenance staff
 * @param {string} reportId 
 * @param {string|string[]} assignedTo - Staff user ID or list of staff user IDs
 * @param {Date} expectedResolution 
 * @param {string} notes 
 */
export async function assignTask(reportId, assignedTo, expectedResolution, notes) {
    const payload = {
        reportId,
        expectedResolution: expectedResolution?.toISOString(),
        notes
    };

    if (Array.isArray(assignedTo)) {
        payload.assignedToList = assignedTo;
    } else {
        payload.assignedTo = assignedTo;
    }

    return await callCallable('assignTask', payload);
}

/**
 * Get maintenance staff list
 * @param {string} department - Optional department filter
 */
export async function getMaintenanceStaff(department = null) {
    const result = await callCallable('getMaintenanceStaff', { department });
    return result.data.staff;
}

// ==================== ANNOUNCEMENTS ====================

/**
 * Fetch all announcements
 */
export async function getAnnouncements() {
    const announcementsSnap = await getDocs(
        query(collection(db, COLLECTIONS.ANNOUNCEMENTS), orderBy('createdAt', 'desc'))
    );

    return announcementsSnap.docs
        .filter((doc) => doc.data()?.isDeleted !== true)
        .map(doc => ({
        id: doc.id,
        ...doc.data()
    }));
}

/**
 * Create a new announcement
 */
export async function createAnnouncement(data) {
    return await callCallable('createAnnouncement', data);
}

/**
 * Update or archive announcement
 */
export async function updateAnnouncement(id, updates) {
    return await callCallable('updateAnnouncement', { id, ...updates });
}

/**
 * Soft delete announcement
 */
export async function deleteAnnouncementByAdmin(announcementId) {
    return await callCallable('deleteAnnouncementByAdmin', { announcementId });
}

// ==================== USER MANAGEMENT ====================

/**
 * Search users by email or name
 */
export async function searchUsers(queryStr, role = null, status = null) {
    const result = await callCallable('searchUsers', { query: queryStr, role, status });
    return result.data.users;
}

/**
 * Get all users with pagination (initial load)
 * @param {Object} options - { limit?, startAfter?, role?, status? }
 * @returns {Object} { users: Array, lastDoc: string, hasMore: boolean }
 */
export async function getAllUsers(options = {}) {
    const result = await callCallable('getAllUsers', options);
    return result.data;
}

/**
 * Update user role
 */
export async function updateUserRole(userId, role, department, status) {
    return await callCallable('updateUserRole', { userId, role, department, status });
}

// ==================== LOCATIONS ====================

export async function createLocation(name) {
    return await callCallable('createLocation', { name });
}

export async function deleteLocation(locationId) {
    return await callCallable('deleteLocation', { locationId });
}

export async function createFloor(buildingId, floor) {
    return await callCallable('createFloor', { buildingId, floor });
}

export async function deleteFloor(floorId) {
    return await callCallable('deleteFloor', { floorId });
}

export async function logAuditDashboardViewed() {
    return await callCallable('logAuditDashboardViewed', {});
}

/**
 * Get building list (for dropdown)
 */
export async function getLocations() {
    const result = await callCallable('getLocations');
    return result.data.buildings || [];
}

// ==================== RECENT ACTIVITY ====================

/**
 * Get recent activity log
 */
export async function getRecentActivity(maxItems = 10) {
    const reportsQuery = query(
        collection(db, COLLECTIONS.REPORTS),
        orderBy('createdAt', 'desc'),
        limit(maxItems)
    );

    const snapshot = await getDocs(reportsQuery);

    return snapshot.docs.map(doc => {
        const data = doc.data();
        const date = data.createdAt?.toDate?.() || new Date();

        return {
            id: doc.id,
            type: 'report',
            title: `New ${data.issueType} report`,
            description: `${data.building}${data.floor ? `, ${data.floor}` : ''} - ${data.location || data.area || 'Unknown location'}`,
            status: data.status,
            timestamp: date,
            timeAgo: getTimeAgo(date)
        };
    });
}

/**
 * Get human-readable time ago string
 */
function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

    return formatTimestampManila(date, { hour: undefined, minute: undefined });
}
