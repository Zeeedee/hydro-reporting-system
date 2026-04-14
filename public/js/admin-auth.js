import { auth } from './firebase-config.js';
import { ROLES, ROUTES } from './config/app-constants.js';
import { requireAuth } from './auth/auth-guard.js';
import { initAdminSessionTimeout } from './admin-session-timeout.js';

export function isAdmin(role) {
  return role === ROLES.ADMIN || role === ROLES.SUPER_ADMIN;
}

export function isSuperAdmin(role) {
  return role === ROLES.SUPER_ADMIN;
}

export async function initAdminAuthGuard() {
  const { user, role, userData } = await requireAuth({
    allowedRoles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
    showLoader: false,
  });

  window.currentUser = {
    uid: user.uid,
    email: user.email,
    role,
    ...(userData || {}),
  };

  initAdminSessionTimeout();

  return window.currentUser;
}

export async function adminLogout() {
  try {
    await auth.signOut();
  } finally {
    window.location.replace(ROUTES.SIGN_IN);
  }
}
