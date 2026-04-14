/**
 * Maintenance Dashboard JavaScript
 * Handles data fetching and rendering for maintenance dashboard
 */

import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';
import { db } from './firebase-config.js';
import { collection, query, where, orderBy, getDocs } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { ANNOUNCEMENT_AUDIENCE, COLLECTIONS } from './config/app-constants.js';
import { formatTimestampManila } from './timezone.js';
import { handleRateLimitError } from './shared/rate-limit-ui.js';
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

// ==================== TASK MANAGEMENT ====================

/**
 * Get tasks assigned to current user
 * @returns {Promise<Array>}
 */
export async function getMyTasks() {
    try {
        const result = await callCallable('getMyTasks');
        return result.data.tasks;
    } catch (error) {
        logError('Error fetching tasks:', error);
        throw error;
    }
}

/**
 * Accept a pending task
 * @param {string} taskId 
 */
export async function acceptTask(taskId) {
    return await callCallable('acceptTask', { taskId });
}

/**
 * Start an accepted task
 * @param {string} taskId
 */
export async function startTask(taskId) {
    return await callCallable('startTask', { taskId });
}

/**
 * Get maintenance notification badge counts
 */
export async function getMyTaskBadgeCounts() {
    const result = await callCallable('getMyTaskBadgeCounts', {});
    return result.data;
}

/**
 * Mark a task as done
 * @param {string} taskId 
 * @param {string} notes - Work report / completion notes
 */
export async function markTaskDone(taskId, notes) {
    return await callCallable('markTaskDone', { taskId, notes });
}

/**
 * Get maintenance statistics
 * @returns {Promise<Object>}
 */
export async function getMyStats() {
    try {
        const result = await callCallable('getMyStats');
        return result.data;
    } catch (error) {
        handleRateLimitError(error);
        logError('Error fetching stats:', error);
        return {
            totalResolved: 0,
            pendingTasks: 0,
            inProgressTasks: 0,
            resolvedThisWeek: 0
        };
    }
}

// ==================== ANNOUNCEMENTS ====================

/**
 * Get announcements for maintenance team
 */
export async function getMaintenanceAnnouncements() {
    try {
        const announcementsQuery = query(
            collection(db, COLLECTIONS.ANNOUNCEMENTS),
            where('isActive', '==', true),
            orderBy('createdAt', 'desc')
        );

        const snapshot = await getDocs(announcementsQuery);

        return snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(a => {
                const audience = String(a.audience || ANNOUNCEMENT_AUDIENCE.ALL);
                return audience === ANNOUNCEMENT_AUDIENCE.ALL || audience === ANNOUNCEMENT_AUDIENCE.MAINTENANCE;
            });
    } catch (error) {
        logError('Error fetching announcements:', error);
        return [];
    }
}

// ==================== DAILY REPORTS ====================

/**
 * Get today's task summary
 */
export async function getTodayTasks() {
    try {
        const tasks = await getMyTasks();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return tasks.filter(task => {
            const taskDate = task.createdAt?.toDate?.() || new Date(task.createdAt?.seconds * 1000 || 0);
            taskDate.setHours(0, 0, 0, 0);
            return taskDate.getTime() === today.getTime();
        });
    } catch (error) {
        logError('Error fetching today tasks:', error);
        return [];
    }
}

/**
 * Get time ago string
 */
export function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

    return formatTimestampManila(date, { hour: undefined, minute: undefined });
}
