import { logOut, getStudentProfile } from './auth.js';
import { requireAuth } from './auth/auth-guard.js';
import { FIREBASE_PROJECT_ID } from './firebase-config.js';
import { ROLES } from './config/app-constants.js';
import { refreshStudentDashboard } from './student-dashboard-data.js';
import { initHydroLightbox } from './ui/lightbox.js';
import { logInfo, logWarn, logError } from './shared/logger.js';

const loadingOverlay = document.getElementById('loadingOverlay');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const logoutBtn = document.getElementById('logoutBtn');
const reportsWarningBanner = document.getElementById('reportsWarningBanner');

let currentUid = '';
let currentAuthUser = null;

function debounce(callback, wait = 250) {
  let timeoutId = null;
  return (...args) => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }

    timeoutId = window.setTimeout(() => {
      callback(...args);
    }, wait);
  };
}

function getInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'S';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

async function loadUserHeader(user) {
  const profile = await getStudentProfile();
  const displayName = profile?.name || user.displayName || user.email?.split('@')[0] || 'Student';
  const avatarUrl = profile?.avatarUrl || user.photoURL;

  if (userName) {
    userName.textContent = displayName;
  }

  if (!userAvatar) return;
  if (avatarUrl) {
    userAvatar.innerHTML = `<img src="${avatarUrl}" alt="Profile" data-hydro-lightbox data-lightbox-src="${avatarUrl}" data-lightbox-group="profile-${user.uid}" onerror="this.parentElement.textContent='${getInitials(displayName)}'; this.remove();">`;
    return;
  }

  userAvatar.textContent = getInitials(displayName);
}

const refreshHeaderDebounced = debounce(() => {
  if (!currentAuthUser) return;
  loadUserHeader(currentAuthUser)
    .then(() => {
      initHydroLightbox();
    })
    .catch((error) => {
      logWarn('[dashboard] header refresh failed', error);
    });
}, 250);

function showErrorState(message) {
  const main = document.querySelector('.main');
  if (!main) return;

  main.innerHTML = `
    <div style="text-align: center; padding: 4rem 2rem;">
      <i class="fa-solid fa-triangle-exclamation" style="font-size: 4rem; color: #dc2626; margin-bottom: 1rem;"></i>
      <h2 style="color: var(--text); margin-bottom: 0.5rem;">Something went wrong</h2>
      <p style="color: var(--gray); margin-bottom: 1.5rem;">${message}</p>
      <button onclick="location.reload()" style="padding: 0.75rem 1.5rem; background: var(--primary); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 500;">
        <i class="fa-solid fa-refresh" style="margin-right: 0.5rem;"></i>Refresh Page
      </button>
    </div>
  `;
}

function clearWarnings() {
  if (!reportsWarningBanner) return;
  reportsWarningBanner.textContent = '';
  reportsWarningBanner.classList.remove('is-visible');
}

function bindPageEvents() {
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      logOut();
    });
  }

  const debouncedRefresh = debounce(() => {
    if (!currentUid) return;
    refreshStudentDashboard(currentUid).catch((error) => {
      logError('[dashboard] refresh after submit failed', error);
    });
  }, 250);

  window.addEventListener('hydro:report-submitted', (event) => {
    const detail = event.detail || {};
    if (!currentUid || detail.uid !== currentUid) return;
    debouncedRefresh();
  });
}

async function bootstrapDashboard() {
  clearWarnings();
  bindPageEvents();
  let shouldHideLoadingOverlay = true;

  try {
    const authState = await requireAuth({
      allowedRoles: [ROLES.STUDENT],
      loaderMessage: 'Loading dashboard...',
    });
    const user = authState.user;

    currentUid = user.uid;
    currentAuthUser = user;
    logInfo(`[dashboard] uid=${currentUid} project=${FIREBASE_PROJECT_ID}`);

    await loadUserHeader(user);
    initHydroLightbox();
    await refreshStudentDashboard(currentUid);

    // Refresh header when coming back to the tab (helps after profile photo changes).
    window.addEventListener('focus', refreshHeaderDebounced);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshHeaderDebounced();
      }
    });
  } catch (error) {
    if (error?.message !== 'redirect') {
      logError('[dashboard] bootstrap failed', error);
      showErrorState('Unable to load dashboard data. Check connection / browser shields.');
    } else {
      shouldHideLoadingOverlay = false;
    }
  } finally {
    if (loadingOverlay && shouldHideLoadingOverlay) {
      loadingOverlay.classList.add('hidden');
    }
  }
}

bootstrapDashboard();
