/**
 * HYDRO - Firebase Configuration (Frontend)
 * 
 * PRODUCTION ONLY - Always connects to real Firebase
 * 
 * SECURITY NOTES:
 * - This uses the CLIENT SDK only (not firebase-admin)
 * - These config values are safe to expose (they are public identifiers)
 * - Actual security is enforced by Firestore/Storage Security Rules
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { initializeAppCheck, ReCaptchaV3Provider, getToken } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-check.js';
import { getFirestore, enableIndexedDbPersistence } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import {
    browserLocalPersistence,
    browserSessionPersistence,
    getAuth,
    inMemoryPersistence,
    setPersistence
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';
import { logInfo, logWarn, logError } from './shared/logger.js';

// ═══════════════════════════════════════════════════════════════
// FIREBASE CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    // IMPORTANT: Replace these placeholders with values from your Firebase Web App.
    appId: "YOUR_APP_ID",
    measurementId: "YOUR_MEASUREMENT_ID"
};
export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;

// ═══════════════════════════════════════════════════════════════
// INITIALIZE FIREBASE
// ═══════════════════════════════════════════════════════════════

const app = initializeApp(firebaseConfig);

// ═══════════════════════════════════════════════════════════════
// APP CHECK (Phase 12)
// ═══════════════════════════════════════════════════════════════

// Public site key (reCAPTCHA v3). Safe to ship in frontend.
// NOTE: The reCAPTCHA SECRET KEY must be configured in Firebase Console -> App Check.
// You can override per-environment via `window.__HYDRO_APP_CHECK_SITE_KEY` or a meta tag.
const APP_CHECK_SITE_KEY = 'YOUR_RECAPTCHA_SITE_KEY';

function isLocalhostHost() {
    const host = String(globalThis.location?.hostname || '').trim();
    return /^(localhost|127\.0\.0\.1)$/i.test(host);
}

function showGlobalBlockingMessage(message) {
    try {
        const text = String(message || '').trim();
        if (!text || !globalThis.document?.body) return;
        if (document.getElementById('hydroAppCheckBanner')) return;

        const banner = document.createElement('div');
        banner.id = 'hydroAppCheckBanner';
        banner.style.position = 'fixed';
        banner.style.left = '12px';
        banner.style.right = '12px';
        banner.style.top = '12px';
        banner.style.zIndex = '9999';
        banner.style.padding = '12px 14px';
        banner.style.borderRadius = '12px';
        banner.style.border = '1px solid #fecaca';
        banner.style.background = '#fef2f2';
        banner.style.color = '#991b1b';
        banner.style.fontWeight = '800';
        banner.style.boxShadow = '0 10px 30px rgba(15, 23, 42, 0.18)';
        banner.style.whiteSpace = 'pre-line';
        banner.textContent = text;
        document.body.appendChild(banner);
    } catch (_) {
        // best-effort only
    }
}

function getAppCheckKey() {
    const override = String(globalThis.__HYDRO_APP_CHECK_SITE_KEY || '').trim();
    if (override) return override;

    const fromMeta = String(document?.querySelector?.('meta[name="hydro-app-check-site-key"]')?.getAttribute?.('content') || '').trim();
    if (fromMeta) return fromMeta;

    return String(APP_CHECK_SITE_KEY || '').trim();
}

function maskKey(key) {
    const value = String(key || '').trim();
    if (value.length <= 10) return value;
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

try {
    if (isLocalhostHost()) {
        // Dev-only: enable App Check debug token flow.
        // Token will print in console when App Check is enabled in Firebase console.
        globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }

    const key = getAppCheckKey();
    if (key) {
        const appCheck = initializeAppCheck(app, {
            provider: new ReCaptchaV3Provider(key),
            isTokenAutoRefreshEnabled: true,
        });
        logInfo('[app-check] initialized', { siteKey: maskKey(key) });

        // Best-effort: fetch a token once to surface configuration errors
        // (e.g., reCAPTCHA domain mismatch) with a visible message.
        Promise.race([
            getToken(appCheck, false),
            new Promise((_, reject) => setTimeout(() => reject(new Error('app-check-timeout')), 8000)),
        ])
            .then(() => {
                logInfo('[app-check] token ok');
            })
            .catch((error) => {
                const host = String(globalThis.location?.hostname || '').trim();
                const code = String(error?.code || '');
                logWarn('[app-check] token failed', code, error);
                showGlobalBlockingMessage(
                    `Security check blocked (App Check).\n\n` +
                    `1) Disable Brave Shields/ad-blockers for this site and reload.\n` +
                    `2) Ensure these domains are allowed: www.google.com, www.recaptcha.net, www.gstatic.com\n\n` +
                    `If the issue persists, contact admin. (Domain: ${host})`
                );
            });
    } else {
        logWarn('[app-check] site key not set; App Check not initialized');
    }
} catch (error) {
    logError('[app-check] init failed', error);
    showGlobalBlockingMessage(
        'Security check failed to initialize.\n\n' +
        'Disable Brave Shields/ad-blockers for this site and reload.\n' +
        'If it still fails, try another browser.'
    );
}

// Initialize services
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

async function configureAuthPersistence() {
    const options = [
        { label: 'local', value: browserLocalPersistence },
        { label: 'session', value: browserSessionPersistence },
        { label: 'memory', value: inMemoryPersistence },
    ];

    for (const option of options) {
        try {
            await setPersistence(auth, option.value);
            logInfo(`[auth] persistence: ${option.label}`);
            return;
        } catch (_) {
            // try next persistence fallback
        }
    }

    logInfo('[auth] persistence: memory');
}

configureAuthPersistence().catch(() => {
    logInfo('[auth] persistence: memory');
});

// ═══════════════════════════════════════════════════════════════
// OFFLINE PERSISTENCE
// ═══════════════════════════════════════════════════════════════

// Enable offline persistence for Firestore
// This allows the app to work offline and sync when back online
try {
    enableIndexedDbPersistence(db).catch((err) => {
        logInfo(`[firestore] persistence disabled: ${err?.code || err?.message || 'unavailable'}`);
    });
} catch (err) {
    logInfo(`[firestore] persistence disabled: ${err?.code || err?.message || 'unavailable'}`);
}

logInfo('Firebase connected:', firebaseConfig.projectId);

// ═══════════════════════════════════════════════════════════════
// NETWORK STATUS
// ═══════════════════════════════════════════════════════════════

// Track online/offline status
let isOnline = navigator.onLine;

window.addEventListener('online', () => {
    isOnline = true;
    logInfo('Network: Online');
    document.dispatchEvent(new CustomEvent('networkStatusChange', { detail: { online: true } }));
});

window.addEventListener('offline', () => {
    isOnline = false;
    logInfo('Network: Offline');
    document.dispatchEvent(new CustomEvent('networkStatusChange', { detail: { online: false } }));
});

export function getNetworkStatus() {
    return isOnline;
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export function getCurrentUser() {
    return auth.currentUser;
}

export function getCurrentUserId() {
    return auth.currentUser?.uid || null;
}


