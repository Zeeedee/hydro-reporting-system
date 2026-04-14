import { logOut, getStudentProfile } from './auth.js';
import { requireAuth } from './auth/auth-guard.js';
import { getAnnouncementsList, markAnnouncementsSeen } from './notifications.js';
import { ROLES } from './config/app-constants.js';
import { formatTimestampManila } from './timezone.js';
import { initHydroLightbox } from './ui/lightbox.js';
import { logError } from './shared/logger.js';

const BLOCKED_BANNER_MESSAGE =
  'Unable to load announcements. Disable Brave Shields / Tracking Prevention or try a normal window.';

const loadingOverlay = document.getElementById('loadingOverlay');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const logoutBtn = document.getElementById('logoutBtn');
const announcementsDiv = document.getElementById('announcementsList');
const announcementsStatus = document.getElementById('announcementsStatus');
const warningBanner = document.getElementById('notificationsWarningBanner');

function getInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'S';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

function setWarningBanner(message = '') {
  if (!warningBanner) return;
  if (!message) {
    warningBanner.textContent = '';
    warningBanner.classList.remove('is-visible');
    return;
  }
  warningBanner.textContent = message;
  warningBanner.classList.add('is-visible');
}

function setConnectionStatus(element, isConnected) {
  if (!element) return;
  const dot = element.querySelector('.dot');
  const text = element.querySelector('span:last-child');
  if (!dot || !text) return;

  if (isConnected) {
    dot.classList.remove('offline');
    text.textContent = 'Loaded';
    return;
  }

  dot.classList.add('offline');
  text.textContent = 'Offline';
}

function renderLoading(container, message) {
  if (!container) return;
  container.innerHTML = `
    <div class="empty-state">
      <i class="fa-regular fa-clock"></i>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function renderEmpty(container, message) {
  if (!container) return;
  container.innerHTML = `
    <div class="empty-state">
      <i class="fa-regular fa-bell-slash"></i>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function renderError(container, message, onRetry) {
  if (!container) return;
  container.innerHTML = `
    <div class="empty-state" style="color:#ef4444;">
      <i class="fa-solid fa-exclamation-circle"></i>
      <p>${escapeHtml(message)}</p>
      <button type="button" class="btn btn-primary" data-notifications-retry style="margin-top:1rem;">Retry</button>
    </div>
  `;

  const retryButton = container.querySelector('[data-notifications-retry]');
  if (retryButton && typeof onRetry === 'function') {
    retryButton.addEventListener('click', () => onRetry());
  }
}

function renderCards(container, notifications, type) {
  if (!container) return;
  if (!Array.isArray(notifications) || !notifications.length) {
    renderEmpty(container, 'No announcements at this time.');
    return;
  }

  container.innerHTML = notifications
    .map((item) => {
      const isExpired = item.expiresAt instanceof Date && item.expiresAt.getTime() < Date.now();
      const statusText = isExpired ? 'Expired' : 'Active';
      const statusClass = isExpired ? 'expired' : 'active';
      const icon = item.type === 'alert'
        ? 'fa-solid fa-triangle-exclamation'
        : item.type === 'maintenance'
          ? 'fa-solid fa-wrench'
          : 'fa-solid fa-circle-info';

      const cardClass = item.type === 'alert' ? 'urgent' : item.type === 'maintenance' ? 'planned' : '';
      const pinnedBadge = item.pinned ? '<span class="notification-status active" style="margin-left:8px;">Pinned</span>' : '';

      return `
        <div class="notification-card ${cardClass}">
          <div class="notification-header">
            <div class="notification-title">
              <i class="${icon}"></i>
              ${escapeHtml(item.title || 'Announcement')}
              <span class="notification-status ${statusClass}">${statusText}</span>
              ${pinnedBadge}
            </div>
            <div class="notification-time">${formatTimestampManila(item.createdAt)}</div>
          </div>
          <div class="notification-desc">${escapeHtml(item.message || '')}</div>
          ${
            item.scheduledDate
              ? `<div class="notification-time" style="margin-top:8px;"><i class="fa-solid fa-clock"></i> Scheduled: ${formatTimestampManila(item.scheduledDate)}</div>`
              : ''
          }
        </div>
      `;
    })
    .join('');
}

async function loadHeader(user) {
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

async function loadAnnouncements(role = 'student') {
  setWarningBanner('');
  renderLoading(announcementsDiv, 'Loading announcements...');

  const result = await getAnnouncementsList({ limit: 50, role });
  if (!result.success) {
    setConnectionStatus(announcementsStatus, false);
    setWarningBanner(BLOCKED_BANNER_MESSAGE);
    renderError(announcementsDiv, result.error || 'Failed to load announcements.', () => {
      loadAnnouncements(role).catch((error) => logError('[announcements] retry failed', error));
    });
    return;
  }

  setConnectionStatus(announcementsStatus, true);
  renderCards(announcementsDiv, result.announcements, 'announcements');
}

async function bootstrap() {
  let shouldHideLoadingOverlay = true;
  try {
    const authState = await requireAuth({
      allowedRoles: [ROLES.STUDENT],
      loaderMessage: 'Loading announcements...',
    });
    const user = authState.user;
    const role = authState.role;
    markAnnouncementsSeen().catch(() => {});
    await loadHeader(user);
    initHydroLightbox();
    await loadAnnouncements(role);
  } catch (error) {
    if (error?.message !== 'redirect') {
      logError('[notifications] bootstrap failed', error);
      setWarningBanner(BLOCKED_BANNER_MESSAGE);
      renderError(announcementsDiv, 'Failed to load announcements.', () => {
        loadAnnouncements().catch(() => {});
      });
    } else {
      shouldHideLoadingOverlay = false;
    }
  } finally {
    if (loadingOverlay && shouldHideLoadingOverlay) {
      loadingOverlay.classList.add('hidden');
    }
  }
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    logOut();
  });
}

bootstrap();
