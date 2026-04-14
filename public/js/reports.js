/**
 * HYDRO - Reports Module (Frontend)
 * 
 * Handles water issue report operations: create, read, list with pagination.
 * 
 * SECURITY NOTES:
 * - All operations use Firestore client SDK
 * - Security Rules enforce that students can only:
 *   - Read their own reports
 *   - Create reports with status='pending'
 *   - Cannot update or delete reports
 */

import { db, auth, storage } from './firebase-config.js';
import {
    collection,
    doc,
    addDoc,
    getDoc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    startAfter,
    serverTimestamp,
    Timestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import {
    ref,
    uploadBytes,
    getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';
import { formatTimestampManila } from './timezone.js';
import { COLLECTIONS } from './config/app-constants.js';
import { handleRateLimitError } from './shared/rate-limit-ui.js';
import { logError, logWarn } from './shared/logger.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const REPORTS_COLLECTION = COLLECTIONS.REPORTS;
const REPORTS_PER_PAGE = 10;
const functions = getFunctions(undefined, 'asia-southeast1');

// Default values (used when dynamic config fails)
const DEFAULT_BUILDINGS = ['Building A', 'Building B', 'CMA', 'MBA', 'Gymnasium'];
const DEFAULT_ISSUE_TYPES = [
    'no_water',
    'leak',
    'contaminated',
    'low_pressure',
    'clogged',
    'clogged_toilet',
    'leaking_pipes',
    'discoloration',
    'odor',
    'flooding',
    'pipe_damage',
    'other'
];
const DEFAULT_RISK_LEVELS = ['low', 'medium', 'high', 'urgent'];
const DEFAULT_STATUSES = ['pending', 'in_progress', 'resolved'];

// Dynamic values (populated by loadSystemConfig)
export let VALID_BUILDINGS = [...DEFAULT_BUILDINGS];
export let VALID_ISSUE_TYPES = [...DEFAULT_ISSUE_TYPES];
export let VALID_RISK_LEVELS = [...DEFAULT_RISK_LEVELS];
export let VALID_STATUSES = [...DEFAULT_STATUSES];

// System config cache
let systemConfigLoaded = false;
let systemConfig = null;

/**
 * Load system configuration from Cloud Function
 * Call this on page load to populate dynamic dropdowns
 */
export async function loadSystemConfig() {
    if (systemConfigLoaded && systemConfig) {
        return systemConfig;
    }

    try {
        const getSystemConfig = httpsCallable(functions, 'getSystemConfig');
        const result = await getSystemConfig();

        if (result.data.success) {
            systemConfig = result.data;

            // Update valid values from config
            if (Array.isArray(systemConfig.buildings)) {
                VALID_BUILDINGS = systemConfig.buildings;
            }
            if (systemConfig.issueTypes && systemConfig.issueTypes.length > 0) {
                VALID_ISSUE_TYPES = systemConfig.issueTypes.map(t => t.value || t.label || t);
            }
            if (systemConfig.riskLevels && systemConfig.riskLevels.length > 0) {
                VALID_RISK_LEVELS = systemConfig.riskLevels.map(r => r.value || r);
            }
            if (systemConfig.reportStatuses && systemConfig.reportStatuses.length > 0) {
                VALID_STATUSES = systemConfig.reportStatuses.map(s => s.value || s);
            }

            systemConfigLoaded = true;
            return systemConfig;
        }
    } catch (error) {
        logError('Failed to load system config, using defaults:', error);
        handleRateLimitError(error);
    }

    return {
        buildings: DEFAULT_BUILDINGS,
        issueTypes: DEFAULT_ISSUE_TYPES.map(t => ({ value: t, label: t.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) })),
        riskLevels: DEFAULT_RISK_LEVELS.map(r => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) })),
        reportStatuses: DEFAULT_STATUSES.map(s => ({ value: s, label: s.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) }))
    };
}

// ═══════════════════════════════════════════════════════════════
// CREATE REPORT
// ═══════════════════════════════════════════════════════════════

/**
 * Submit a new water issue report
 * 
 * @param {Object} reportData - Report data
 * @param {string} reportData.building - Building name
 * @param {string} reportData.floor - Floor name
 * @param {string} reportData.location - Specific location
 * @param {string} reportData.issueType - Type of issue
 * @param {string} reportData.riskLevel - 'low' or 'urgent'
 * @param {string} reportData.description - Optional description
 * @param {File} photoFile - Optional photo file
 * @returns {Object} { success: boolean, reportId?: string, error?: string }
 */
export async function createReport(reportData, photoFile = null) {
    const user = auth.currentUser;

    if (!user) {
        return { success: false, error: 'Please sign in to submit a report.' };
    }

    // Client-side validation (also enforced by Security Rules)
    if (!VALID_BUILDINGS.includes(reportData.building)) {
        return { success: false, error: 'Please select a valid building.' };
    }

    if (!reportData.floor || String(reportData.floor).trim().length === 0) {
        return { success: false, error: 'Please select the floor.' };
    }

    if (!reportData.location || reportData.location.trim().length === 0) {
        return { success: false, error: 'Please specify the location.' };
    }

    if (!VALID_ISSUE_TYPES.includes(reportData.issueType)) {
        return { success: false, error: 'Please select a valid issue type.' };
    }

    if (!VALID_RISK_LEVELS.includes(reportData.riskLevel)) {
        return { success: false, error: 'Please select a valid risk level.' };
    }

    try {
        // Prepare report document
        const report = {
            studentId: user.uid,
            studentName: user.displayName || user.email?.split('@')[0] || 'Student',
            building: reportData.building,
            floor: String(reportData.floor).trim(),
            location: reportData.location.trim(),
            issueType: reportData.issueType,
            riskLevel: reportData.riskLevel,
            description: reportData.description?.trim() || '',
            photoUrl: '',
            status: 'pending', // Must be 'pending' per Security Rules
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        };

        // Create the report document first
        const docRef = await addDoc(collection(db, REPORTS_COLLECTION), report);

        // Upload photo if provided
        if (photoFile) {
            try {
                const photoUrl = await uploadReportPhoto(user.uid, docRef.id, photoFile);
                // Note: We can't update the document after creation (Security Rules)
                // In production, you'd handle this differently or allow update for photoUrl only
                report.photoUrl = photoUrl;
            } catch (uploadError) {
                logWarn('Photo upload failed, report created without photo:', uploadError);
            }
        }

        return {
            success: true,
            reportId: docRef.id
        };
    } catch (error) {
        logError('Error creating report:', error);

        // Handle specific Firestore errors
        if (error.code === 'permission-denied') {
            return { success: false, error: 'Permission denied. Please check your login status.' };
        }

        return {
            success: false,
            error: 'Failed to submit report. Please try again.'
        };
    }
}

// ═══════════════════════════════════════════════════════════════
// GET STUDENT REPORTS (Paginated)
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch reports for the current student with pagination
 * 
 * @param {Object} options - Query options
 * @param {string} options.status - Filter by status (optional)
 * @param {DocumentSnapshot} options.lastDoc - Last document for pagination
 * @param {number} options.pageSize - Number of reports per page
 * @returns {Object} { success: boolean, reports?: Array, lastDoc?: DocumentSnapshot, hasMore?: boolean, error?: string }
 */
export async function getStudentReports(options = {}) {
    const user = auth.currentUser;

    if (!user) {
        return { success: false, error: 'Please sign in to view your reports.' };
    }

    const { status, lastDoc, pageSize = REPORTS_PER_PAGE } = options;

    try {
        // Build query
        let q = query(
            collection(db, REPORTS_COLLECTION),
            where('studentId', '==', user.uid),
            orderBy('createdAt', 'desc'),
            limit(pageSize + 1) // Fetch one extra to check if there are more
        );

        // Add status filter if provided
        if (status && VALID_STATUSES.includes(status)) {
            q = query(
                collection(db, REPORTS_COLLECTION),
                where('studentId', '==', user.uid),
                where('status', '==', status),
                orderBy('createdAt', 'desc'),
                limit(pageSize + 1)
            );
        }

        // Add pagination cursor
        if (lastDoc) {
            q = query(q, startAfter(lastDoc));
        }

        const snapshot = await getDocs(q);
        const docs = snapshot.docs;

        // Check if there are more results
        const hasMore = docs.length > pageSize;
        const reports = docs.slice(0, pageSize).map(doc => ({
            id: doc.id,
            ...doc.data(),
            // Convert Firestore Timestamp to Date
            createdAt: doc.data().createdAt?.toDate() || new Date(),
            updatedAt: doc.data().updatedAt?.toDate() || new Date(),
        }));

        return {
            success: true,
            reports,
            lastDoc: docs.length > 0 ? docs[Math.min(docs.length - 1, pageSize - 1)] : null,
            hasMore
        };
    } catch (error) {
        logError('Error fetching reports:', error);
        return {
            success: false,
            error: 'Failed to load reports. Please try again.'
        };
    }
}

// ═══════════════════════════════════════════════════════════════
// GET SINGLE REPORT
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch a single report by ID
 * Security Rules ensure only the owner can read it
 * 
 * @param {string} reportId - The report document ID
 * @returns {Object} { success: boolean, report?: Object, error?: string }
 */
export async function getReportById(reportId) {
    const user = auth.currentUser;

    if (!user) {
        return { success: false, error: 'Please sign in to view your reports.' };
    }

    try {
        const docRef = doc(db, REPORTS_COLLECTION, reportId);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            return { success: false, error: 'Report not found.' };
        }

        const data = docSnap.data();

        // Security check (also enforced by rules, but good for UX)
        if (data.studentId !== user.uid) {
            return { success: false, error: 'You do not have permission to view this report.' };
        }

        return {
            success: true,
            report: {
                id: docSnap.id,
                ...data,
                createdAt: data.createdAt?.toDate() || new Date(),
                updatedAt: data.updatedAt?.toDate() || new Date(),
            }
        };
    } catch (error) {
        logError('Error fetching report:', error);

        if (error.code === 'permission-denied') {
            return { success: false, error: 'You do not have permission to view this report.' };
        }

        return {
            success: false,
            error: 'Failed to load report. Please try again.'
        };
    }
}

// ═══════════════════════════════════════════════════════════════
// GET REPORT STATS
// ═══════════════════════════════════════════════════════════════

/**
 * Get report statistics for the current student
 * Counts reports by status for dashboard display
 * 
 * @returns {Object} { success: boolean, stats?: Object, error?: string }
 */
export async function getReportStats() {
    const user = auth.currentUser;

    if (!user) {
        return { success: false, error: 'Please sign in to continue.' };
    }

    try {
        // Fetch all reports for the student (limited for performance)
        const q = query(
            collection(db, REPORTS_COLLECTION),
            where('studentId', '==', user.uid),
            limit(100) // Reasonable limit for counting
        );

        const snapshot = await getDocs(q);

        // Count by status
        const stats = {
            total: 0,
            pending: 0,
            in_progress: 0,
            resolved: 0
        };

        snapshot.forEach(doc => {
            const status = doc.data().status;
            stats.total++;
            if (status === 'pending') stats.pending++;
            else if (status === 'in_progress') stats.in_progress++;
            else if (status === 'resolved') stats.resolved++;
        });

        return { success: true, stats };
    } catch (error) {
        logError('Error fetching stats:', error);
        return {
            success: false,
            error: 'Failed to load statistics.'
        };
    }
}

// ═══════════════════════════════════════════════════════════════
// GET TODAY'S REPORTS
// ═══════════════════════════════════════════════════════════════

/**
 * Get reports created today for the current student
 * 
 * @returns {Object} { success: boolean, reports?: Array, error?: string }
 */
export async function getTodayReports() {
    const user = auth.currentUser;

    if (!user) {
        return { success: false, error: 'Please sign in to continue.' };
    }

    try {
        // Get start of today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTimestamp = Timestamp.fromDate(today);

        const q = query(
            collection(db, REPORTS_COLLECTION),
            where('studentId', '==', user.uid),
            where('createdAt', '>=', todayTimestamp),
            orderBy('createdAt', 'desc'),
            limit(10)
        );

        const snapshot = await getDocs(q);
        const reports = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate() || new Date(),
        }));

        return { success: true, reports };
    } catch (error) {
        logError('Error fetching today\'s reports:', error);
        return {
            success: false,
            error: 'Failed to load today\'s reports.'
        };
    }
}

// ═══════════════════════════════════════════════════════════════
// PHOTO UPLOAD (with client-side compression)
// ═══════════════════════════════════════════════════════════════

/**
 * Upload a report photo to Firebase Storage
 * Compresses the image client-side before upload
 * 
 * @param {string} studentId - Student's user ID
 * @param {string} reportId - Report document ID
 * @param {File} file - Image file to upload
 * @returns {string} Download URL of the uploaded photo
 */
async function uploadReportPhoto(studentId, reportId, file) {
    // Compress the image first
    const compressedFile = await compressImage(file, 800, 0.8);

    // Create storage reference (R phase path)
    const storageRef = ref(storage, `reports/${reportId}/photo.jpg`);

    // Upload the file
    const snapshot = await uploadBytes(storageRef, compressedFile, {
        contentType: 'image/jpeg'
    });

    // Get and return the download URL
    return await getDownloadURL(snapshot.ref);
}

/**
 * Compress an image file client-side
 * 
 * @param {File} file - Original image file
 * @param {number} maxWidth - Maximum width in pixels
 * @param {number} quality - JPEG quality (0-1)
 * @returns {Promise<Blob>} Compressed image blob
 */
export function compressImage(file, maxWidth = 800, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = () => {
            // Calculate new dimensions
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }

            // Create canvas and draw resized image
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to blob
            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to compress image'));
                    }
                },
                'image/jpeg',
                quality
            );
        };

        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = URL.createObjectURL(file);
    });
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Format Date for Display
// ═══════════════════════════════════════════════════════════════

/**
 * Format a date for display in the UI
 * 
 * @param {Date} date - Date object
 * @returns {string} Formatted date string
 */
export function formatReportDate(date) {
    if (!date) return '';

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const reportDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (reportDate.getTime() === today.getTime()) {
        return 'Today';
    }

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (reportDate.getTime() === yesterday.getTime()) {
        return 'Yesterday';
    }

    return formatTimestampManila(date, {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: undefined,
        minute: undefined,
    });
}
