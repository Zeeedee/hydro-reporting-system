import {
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import {
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';
import { auth, db } from '../firebase-config.js';
import { COLLECTIONS, ROLES, ROUTES, USER_FIELDS, USER_STATUS } from '../config/app-constants.js';

const functions = getFunctions(undefined, 'asia-southeast1');
const logUnprovisionedLogin = httpsCallable(functions, 'logUnprovisionedLogin');

function getBootstrapLoader() {
  let loader = document.getElementById('authBootstrapLoader');
  if (loader) return loader;

  loader = document.createElement('div');
  loader.id = 'authBootstrapLoader';
  loader.style.position = 'fixed';
  loader.style.inset = '0';
  loader.style.background = 'var(--light, #f8fafc)';
  loader.style.display = 'flex';
  loader.style.alignItems = 'center';
  loader.style.justifyContent = 'center';
  loader.style.zIndex = '99999';
  loader.style.flexDirection = 'column';
  loader.style.gap = '0.75rem';
  loader.innerHTML = `
    <div style="width:40px;height:40px;border:4px solid #cbd5e1;border-top-color:#1a5f7a;border-radius:50%;animation:hydroSpin 1s linear infinite;"></div>
    <div id="authBootstrapLoaderMessage" style="color:#334155;font-size:0.95rem;font-weight:600;">Checking account...</div>
  `;

  if (!document.getElementById('authBootstrapLoaderStyle')) {
    const style = document.createElement('style');
    style.id = 'authBootstrapLoaderStyle';
    style.textContent = '@keyframes hydroSpin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }

  document.body.appendChild(loader);
  return loader;
}

export function showBlockingLoader(message = 'Checking account...') {
  const loader = getBootstrapLoader();
  const label = loader.querySelector('#authBootstrapLoaderMessage');
  if (label) label.textContent = message;
  loader.style.display = 'flex';
}

export function hideBlockingLoader() {
  const loader = document.getElementById('authBootstrapLoader');
  if (loader) loader.style.display = 'none';
}

export function waitForAuthUser() {
  if (auth.currentUser) {
    return Promise.resolve(auth.currentUser);
  }

  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        resolve(user || null);
      },
      (error) => {
        unsubscribe();
        reject(error);
      }
    );
  });
}

export async function getUserRole(uid) {
  if (!uid) return ROLES.USER;
  const userDoc = await getDoc(doc(db, COLLECTIONS.USERS, uid));
  if (!userDoc.exists()) return ROLES.USER;
  return userDoc.data()?.[USER_FIELDS.ROLE] || ROLES.USER;
}

export async function getUserDoc(uid) {
  if (!uid) return null;
  const userDoc = await getDoc(doc(db, COLLECTIONS.USERS, uid));
  return userDoc.exists() ? (userDoc.data() || null) : null;
}

export function redirectToDashboard(role) {
  if (role === ROLES.ADMIN || role === ROLES.SUPER_ADMIN) {
    window.location.replace(ROUTES.ADMIN_DASHBOARD);
    return;
  }
  if (role === ROLES.MAINTENANCE) {
    window.location.replace(ROUTES.MAINTENANCE_DASHBOARD);
    return;
  }
  window.location.replace(ROUTES.STUDENT_DASHBOARD);
}

export async function ensureNotArchived(uid) {
  const userData = await getUserDoc(uid);
  if (!userData) {
    return { ok: true, userData: null };
  }

  if (userData[USER_FIELDS.IS_ARCHIVED] === true) {
    await signOut(auth);
    return {
      ok: false,
      reason: 'archived',
      message: 'Your account is archived. Contact admin.',
    };
  }

  return { ok: true, userData };
}

export async function requireActiveUser(uid) {
  const userData = await getUserDoc(uid);
  if (!userData) {
    try {
      await logUnprovisionedLogin({
        page: window.location.pathname,
        source: 'requireActiveUser',
      });
    } catch (_) {
      // Best-effort only.
    }
    await signOut(auth);
    return {
      ok: false,
      reason: 'profile-missing',
      message: 'Account not provisioned. Please contact an administrator.',
    };
  }

  if (userData[USER_FIELDS.IS_ARCHIVED] === true) {
    await signOut(auth);
    return {
      ok: false,
      reason: 'archived',
      message: 'Your account is archived. Contact admin.',
    };
  }

  const status = userData[USER_FIELDS.STATUS] || USER_STATUS.ACTIVE;
  const activated = userData[USER_FIELDS.ACTIVATED] !== false;
  if (!activated || status === USER_STATUS.INVITED || status === USER_STATUS.DISABLED) {
    await signOut(auth);
    return {
      ok: false,
      reason: 'not-active',
      message: 'Your account setup is not complete or currently suspended.',
    };
  }

  return { ok: true, userData };
}

export async function activateInvitedUser(uid) {
  const userRef = doc(db, COLLECTIONS.USERS, uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    return { ok: false, reason: 'profile-missing', message: 'Account profile not found.' };
  }

  const userData = snap.data() || {};
  if (userData[USER_FIELDS.IS_ARCHIVED] === true || userData[USER_FIELDS.STATUS] === USER_STATUS.DISABLED) {
    return { ok: false, reason: 'blocked', message: 'Your account is suspended. Contact admin.' };
  }

  if (userData[USER_FIELDS.STATUS] === USER_STATUS.INVITED || userData[USER_FIELDS.ACTIVATED] === false) {
    await updateDoc(userRef, {
      [USER_FIELDS.STATUS]: USER_STATUS.ACTIVE,
      [USER_FIELDS.ACTIVATED]: true,
      [USER_FIELDS.ACTIVATED_AT]: serverTimestamp(),
      [USER_FIELDS.UPDATED_AT]: serverTimestamp(),
    });

    return { ok: true, activatedNow: true };
  }

  return { ok: true, activatedNow: false };
}

export async function bootstrapAuthRedirect() {
  showBlockingLoader('Checking account...');
  try {
    const user = await waitForAuthUser();
    if (!user) {
      window.location.replace(ROUTES.SIGN_IN);
      return { redirected: true, reason: 'no-user' };
    }

    const activeCheck = await requireActiveUser(user.uid);
    if (!activeCheck.ok) {
      window.location.replace(`${ROUTES.SIGN_IN}?reason=${activeCheck.reason}`);
      return { redirected: true, reason: activeCheck.reason };
    }

    const role = activeCheck.userData?.role || (await getUserRole(user.uid));
    redirectToDashboard(role);
    return { redirected: true, reason: 'role-route' };
  } catch (_) {
    window.location.replace(ROUTES.SIGN_IN);
    return { redirected: true, reason: 'auth-error' };
  }
}
