import { ROLES, ROUTES } from '../config/app-constants.js';
import {
  waitForAuthUser,
  getUserRole,
  showBlockingLoader,
  hideBlockingLoader,
  requireActiveUser,
  redirectToDashboard,
} from './auth-bootstrap.js';

let pendingAuthPromise = null;

function markAuthReady() {
  try {
    const root = document.documentElement;
    root.classList.remove('hydro-auth-pending');
    root.classList.add('hydro-auth-ready');
  } catch (_) {
    // Best-effort only.
  }
}

function normalizeRoleList(roles = []) {
  if (!Array.isArray(roles)) return [];
  return roles.filter(Boolean);
}

function canAccessRole(userRole, allowedRoles) {
  if (!allowedRoles.length) return true;
  if (allowedRoles.includes(userRole)) return true;
  if (userRole === ROLES.SUPER_ADMIN && allowedRoles.includes(ROLES.ADMIN)) return true;
  return false;
}

export function requireRole(role, allowedRoles = []) {
  return canAccessRole(role, normalizeRoleList(allowedRoles));
}

export function requireAuth(options = {}) {
  const {
    allowedRoles = [],
    loaderMessage = 'Checking account...',
    showLoader = false,
  } = options;

  if (pendingAuthPromise) {
    return pendingAuthPromise;
  }

  const roles = normalizeRoleList(allowedRoles);
  if (showLoader) {
    showBlockingLoader(loaderMessage);
  }

  pendingAuthPromise = new Promise((resolve, reject) => {
    waitForAuthUser()
      .then(async (user) => {
        if (!user?.uid) {
          window.location.replace(ROUTES.SIGN_IN);
          throw new Error('redirect');
        }

        const active = await requireActiveUser(user.uid);
        if (!active.ok) {
          window.location.replace(`${ROUTES.SIGN_IN}?reason=${active.reason}`);
          throw new Error('redirect');
        }

        const role = active.userData?.role || (await getUserRole(user.uid));

        if (!requireRole(role, roles)) {
          redirectToDashboard(role);
          throw new Error('redirect');
        }

        markAuthReady();
        resolve({ user, role, userData: active.userData || null });
      })
      .catch((error) => {
        if (error?.message !== 'redirect') {
          window.location.replace(ROUTES.SIGN_IN);
        }
        reject(error);
      })
      .finally(() => {
        pendingAuthPromise = null;
        if (showLoader) {
          hideBlockingLoader();
        }
      });
  });

  return pendingAuthPromise;
}
