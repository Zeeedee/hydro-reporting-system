/**
 * HYDRO - Manila Timezone Helpers
 * 
 * All times in the HYDRO system should be displayed in Manila timezone (Asia/Manila, UTC+8).
 * These helpers ensure consistent timezone handling across frontend and backend.
 */

const MANILA_TIMEZONE = 'Asia/Manila';

/**
 * Get current date/time in Manila timezone
 * @returns {Date} Current date in Manila time
 */
function getManilaDate() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: MANILA_TIMEZONE }));
}

/**
 * Format a date to Manila timezone string
 * @param {Date|Object|number} date - Date object, Firestore Timestamp, or epoch ms
 * @param {Object} options - Intl.DateTimeFormat options
 * @returns {string} Formatted date string in Manila time
 */
function formatManilaDate(date, options = {}) {
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

    const defaultOptions = {
        timeZone: MANILA_TIMEZONE,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        ...options
    };

    return dateObj.toLocaleString('en-PH', defaultOptions);
}

/**
 * Format date only (no time) in Manila timezone
 * @param {Date|Object|number} date 
 * @returns {string}
 */
function formatManilaDateOnly(date) {
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
function formatManilaTimeOnly(date) {
    return formatManilaDate(date, {
        year: undefined,
        month: undefined,
        day: undefined,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

// Export for Node.js (Cloud Functions)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        MANILA_TIMEZONE,
        getManilaDate,
        formatManilaDate,
        formatManilaDateOnly,
        formatManilaTimeOnly
    };
}

// Export for ES modules (Frontend)
if (typeof window !== 'undefined') {
    window.hydroTimezone = {
        MANILA_TIMEZONE,
        getManilaDate,
        formatManilaDate,
        formatManilaDateOnly,
        formatManilaTimeOnly
    };
}
