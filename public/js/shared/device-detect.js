/**
 * Device Detection Utility
 * Provides responsive layout helpers based on device/viewport size
 */

/**
 * Get current device type based on viewport width
 * @returns {'mobile'|'tablet'|'desktop'} Device type
 */
export function getDeviceType() {
    const width = window.innerWidth;
    if (width < 768) return 'mobile';
    if (width < 1024) return 'tablet';
    return 'desktop';
}

/**
 * Check if current device is mobile
 * @returns {boolean}
 */
export function isMobile() {
    return getDeviceType() === 'mobile';
}

/**
 * Check if current device is tablet
 * @returns {boolean}
 */
export function isTablet() {
    return getDeviceType() === 'tablet';
}

/**
 * Check if current device is desktop
 * @returns {boolean}
 */
export function isDesktop() {
    return getDeviceType() === 'desktop';
}

/**
 * Add listener for device type changes
 * @param {function(string): void} callback - Called with device type when it changes
 * @returns {function(): void} Cleanup function to remove listener
 */
export function onDeviceChange(callback) {
    let currentDevice = getDeviceType();

    const handleResize = () => {
        const newDevice = getDeviceType();
        if (newDevice !== currentDevice) {
            currentDevice = newDevice;
            callback(newDevice);
        }
    };

    window.addEventListener('resize', handleResize);

    // Return cleanup function
    return () => window.removeEventListener('resize', handleResize);
}

/**
 * Get appropriate number of items per row based on device
 * @param {Object} options - Items per device {mobile: 1, tablet: 2, desktop: 4}
 * @returns {number}
 */
export function getItemsPerRow(options = {}) {
    const defaults = { mobile: 1, tablet: 2, desktop: 4 };
    const config = { ...defaults, ...options };
    return config[getDeviceType()];
}
