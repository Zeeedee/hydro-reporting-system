import { auth } from './firebase-config.js';
import { ROLES, ROUTES } from './config/app-constants.js';
import { requireAuth } from './auth/auth-guard.js';

export function isMaintenance(role) {
  return role === ROLES.MAINTENANCE;
}

export async function initMaintenanceAuthGuard() {
  const { user, role, userData } = await requireAuth({
    allowedRoles: [ROLES.MAINTENANCE],
    loaderMessage: 'Loading maintenance access...',
  });

  window.currentUser = {
    uid: user.uid,
    email: user.email,
    role,
    ...(userData || {}),
  };

  return window.currentUser;
}

export async function maintenanceLogout() {
  try {
    await auth.signOut();
  } finally {
    window.location.replace(ROUTES.SIGN_IN);
  }
}
