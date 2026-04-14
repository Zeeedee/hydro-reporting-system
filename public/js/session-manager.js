/**
 * HYDRO - Session Manager
 * 
 * Centralized state management for user session, profile, and role.
 * Caches data in memory for instant display on SPA navigation.
 * Uses Firebase Auth as source of truth - cache invalidated on signout.
 * 
 * Usage:
 *   import { session } from './session-manager.js';
 *   
 *   // Get cached data instantly (may be null on cold start)
 *   const profile = session.profile;
 *   const user = session.user;
 *   const role = session.role;
 *   
 *   // Wait for session to be ready
 *   session.onReady((sessionData) => {
 *     console.log('Session ready:', sessionData);
 *   });
 *   
 *   // Check roles
 *   if (session.isAdmin) { ... }
 *   if (session.isMaintenance) { ... }
 *   if (session.isStudent) { ... }
 */

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { COLLECTIONS, ROLES } from './config/app-constants.js';
import { logInfo, logWarn, logError } from './shared/logger.js';

class SessionManager {
    static #instance = null;

    // Private cached state
    #user = null;
    #profile = null;
    #role = null;
    #isReady = false;
    #readyCallbacks = [];
    #authUnsubscribe = null;
    #isInitializing = false;

    constructor() {
        if (SessionManager.#instance) {
            return SessionManager.#instance;
        }
        SessionManager.#instance = this;
        this.#initializeAuth();
    }

    /**
     * Initialize Firebase Auth listener
     */
    #initializeAuth() {
        if (this.#isInitializing) return;
        this.#isInitializing = true;

        logInfo('[Session] Initializing...');

        this.#authUnsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                logInfo('[Session] User authenticated:', user.uid);
                this.#user = user;

                // Load profile and role
                await this.#loadUserData(user);
            } else {
                logInfo('[Session] User signed out, clearing state');
                this.#clearState();
            }

            // Mark as ready and notify listeners
            this.#isReady = true;
            this.#notifyReady();
        });
    }

    /**
     * Load user role and profile from Firestore
     */
    async #loadUserData(user) {
        try {
            // Try to get user document for role
            const userDoc = await getDoc(doc(db, COLLECTIONS.USERS, user.uid));
            if (!userDoc.exists()) {
                logWarn('[Session] Missing users/{uid}; signing out');
                this.#clearState();
                try {
                    await signOut(auth);
                } catch (_) {
                    // Best-effort only.
                }
                return;
            }

            const userData = userDoc.data() || {};
            this.#role = userData.role || ROLES.USER;
            this.#profile = { id: userDoc.id, ...userData };

            // Student profiles may have extra fields in students collection.
            if (this.#role === ROLES.USER || this.#role === ROLES.STUDENT) {
                const studentDoc = await getDoc(doc(db, COLLECTIONS.STUDENTS, user.uid));
                if (studentDoc.exists()) {
                    this.#profile = {
                        ...(this.#profile || {}),
                        id: studentDoc.id,
                        ...studentDoc.data(),
                    };
                }
            }

            logInfo('[Session] Loaded:', { role: this.#role, hasProfile: !!this.#profile });
        } catch (error) {
            logError('[Session] Error loading user data:', error);
            // Continue anyway - UI will show basic info from auth user
        }
    }

    /**
     * Clear all cached state
     */
    #clearState() {
        this.#user = null;
        this.#profile = null;
        this.#role = null;
    }

    /**
     * Notify all ready callbacks
     */
    #notifyReady() {
        const data = {
            user: this.#user,
            profile: this.#profile,
            role: this.#role
        };

        this.#readyCallbacks.forEach(callback => {
            try {
                callback(data);
            } catch (e) {
                logError('[Session] Callback error:', e);
            }
        });

        // Clear callbacks after notifying
        this.#readyCallbacks = [];
    }

    // ==================== Public API ====================

    /**
     * Get cached Firebase Auth user (may be null)
     */
    get user() {
        return this.#user;
    }

    /**
     * Get cached user profile (may be null)
     */
    get profile() {
        return this.#profile;
    }

    /**
     * Get cached user role
     */
    get role() {
        return this.#role;
    }

    /**
     * Check if session is ready
     */
    get isReady() {
        return this.#isReady;
    }

    /**
     * Check if user is authenticated
     */
    get isAuthenticated() {
        return !!this.#user;
    }

    /**
     * Check if user is admin
     */
    get isAdmin() {
        return this.#role === ROLES.ADMIN || this.#role === ROLES.SUPER_ADMIN;
    }

    /**
     * Check if user is super admin
     */
    get isSuperAdmin() {
        return this.#role === ROLES.SUPER_ADMIN;
    }

    /**
     * Check if user is maintenance staff
     */
    get isMaintenance() {
        return this.#role === ROLES.MAINTENANCE;
    }

    /**
     * Check if user is student
     */
    get isStudent() {
        return this.#role === ROLES.USER || this.#role === ROLES.STUDENT || !this.#role;
    }

    /**
     * Get display name from profile or auth user
     */
    get displayName() {
        return this.#profile?.name ||
            this.#user?.displayName ||
            this.#user?.email?.split('@')[0] ||
            'User';
    }

    /**
     * Get avatar URL if available
     */
    get avatarUrl() {
        return this.#profile?.avatarUrl || this.#user?.photoURL || null;
    }

    /**
     * Register callback to be called when session is ready
     * If already ready, callback is called immediately
     */
    onReady(callback) {
        if (this.#isReady) {
            // Already ready, call immediately
            callback({
                user: this.#user,
                profile: this.#profile,
                role: this.#role
            });
        } else {
            // Queue callback
            this.#readyCallbacks.push(callback);
        }
    }

    /**
     * Refresh profile from Firestore (useful after profile updates)
     */
    async refreshProfile() {
        if (!this.#user) return null;

        try {
            await this.#loadUserData(this.#user);
            return this.#profile;
        } catch (error) {
            logError('[Session] Error refreshing profile:', error);
            return null;
        }
    }

    /**
     * Get initials from display name
     */
    getInitials() {
        const name = this.displayName;
        if (!name) return '--';
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    }
}

// Create and export singleton instance
export const session = new SessionManager();

// Also export the class for testing purposes
export { SessionManager };
