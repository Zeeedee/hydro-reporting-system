/**
 * HYDRO - Manila Timezone Helpers (Frontend)
 * 
 * All times in the HYDRO system should be displayed in Manila timezone (Asia/Manila, UTC+8).
 * Import this in your pages to format dates consistently.
 * 
 * Usage:
 *   import { formatManilaDate, formatManilaDateOnly } from './js/timezone.js';
 *   const formattedDate = formatManilaDate(timestamp);
 */

export const MANILA_TIMEZONE = 'Asia/Manila';

/**
 * Canonical timestamp formatter (Asia/Manila).
 * 
 * Requirement: use Intl.DateTimeFormat with timeZone: "Asia/Manila".
 */
export function formatTimestampManila(value, options = {}) {
    return formatManilaDate(value, options);
}

/**
 * Get current date/time in Manila timezone
 * @returns {Date} Current date in Manila time
 */
export function getManilaDate() {
    // A Date in JS is an instant in time; Manila is handled at display layer.
    return new Date();
}

/**
 * Format a date to Manila timezone string
 * @param {Date|Object|number} date - Date object, Firestore Timestamp, or epoch ms
 * @param {Object} options - Intl.DateTimeFormat options
 * @returns {string} Formatted date string in Manila time
 */
export function formatManilaDate(date, options = {}) {
    let dateObj;

    if (!date) {
        dateObj = new Date();
    } else if (date.toDate && typeof date.toDate === 'function') {
        // Firestore Timestamp
        dateObj = date.toDate();
    } else if (date.seconds) {
        // Firestore Timestamp from JSON
        dateObj = new Date(date.seconds * 1000);
    } else if (typeof date === 'number') {
        // Epoch milliseconds
        dateObj = new Date(date);
    } else {
        dateObj = new Date(date);
    }

    const mergedOptions = {
        timeZone: MANILA_TIMEZONE,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        ...options
    };

    Object.keys(mergedOptions).forEach((key) => {
        if (mergedOptions[key] === undefined) {
            delete mergedOptions[key];
        }
    });

    return new Intl.DateTimeFormat('en-PH', mergedOptions).format(dateObj);
}

/**
 * Format date only (no time) in Manila timezone
 * @param {Date|Object|number} date 
 * @returns {string}
 */
export function formatManilaDateOnly(date) {
    return formatManilaDate(date, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: undefined,
        minute: undefined
    });
}

/**
 * Format time only (no date) in Manila timezone
 * @param {Date|Object|number} date 
 * @returns {string}
 */
export function formatManilaTimeOnly(date) {
    return formatManilaDate(date, {
        year: undefined,
        month: undefined,
        day: undefined,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

/**
 * Format relative time (e.g., "2 hours ago")
 * @param {Date|Object|number} date 
 * @returns {string}
 */
export function formatRelativeTime(date) {
    let dateObj;

    if (date.toDate && typeof date.toDate === 'function') {
        dateObj = date.toDate();
    } else if (date.seconds) {
        dateObj = new Date(date.seconds * 1000);
    } else {
        dateObj = new Date(date);
    }

    const now = new Date();
    const diff = now - dateObj;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return formatManilaDateOnly(dateObj);
}
