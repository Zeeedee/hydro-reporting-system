import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  updateProfile,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, getDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';
import { COLLECTIONS, ROUTES, USER_FIELDS, ROLES } from './config/app-constants.js';
import { validateEmail, validatePassword as sharedValidatePassword } from './validation/validation.js';
import { handleRateLimitError } from './shared/rate-limit-ui.js';
import { logError } from './shared/logger.js';
import {
  requireActiveUser,
  getUserRole,
  redirectToDashboard,
} from './auth/auth-bootstrap.js';

export function validatePassword(password) {
  const result = sharedValidatePassword(password);
  if (result.valid) {
    return { valid: true };
  }
  return { valid: false, error: result.errors[0], errors: result.errors };
}

export async function signUp() {
  return {
    success: false,
    error: 'Public sign up is disabled. Please contact admin for account creation.',
  };
}

export async function signIn(email, password) {
  const emailCheck = validateEmail(email);
  if (!emailCheck.valid) {
    return { success: false, error: emailCheck.error };
  }

  if (!String(password || '').trim()) {
    return { success: false, error: 'Password is required.' };
  }

  try {
    // Brute-force protection (best-effort).
    try {
      const functions = getFunctions(undefined, 'asia-southeast1');
      const checkLoginAllowed = httpsCallable(functions, 'checkLoginAllowed');
      const check = await checkLoginAllowed({ email: emailCheck.value });
      const allowed = check?.data?.allowed !== false;
      if (!allowed) {
        return {
          success: false,
          error: 'Too many failed attempts. Please wait and try again.',
          errorCode: 'login-locked',
        };
      }
    } catch (_) {
      // If the lockout check fails, do not block sign-in.
    }

    const userCredential = await signInWithEmailAndPassword(auth, emailCheck.value, password);
    const user = userCredential.user;

    // Record successful password authentication (best-effort).
    try {
      const functions = getFunctions(undefined, 'asia-southeast1');
      const recordLoginAttempt = httpsCallable(functions, 'recordLoginAttempt');
      await recordLoginAttempt({ email: emailCheck.value, success: true });
    } catch (_) {
      // ignore
    }

    const activeCheck = await requireActiveUser(user.uid);
    if (!activeCheck.ok) {
      return {
        success: false,
        error: activeCheck.message,
        errorCode: activeCheck.reason,
      };
    }

    const role = activeCheck.userData?.[USER_FIELDS.ROLE] || (await getUserRole(user.uid));

    return {
      success: true,
      user,
      role,
    };
  } catch (error) {
    if (String(error?.code || '') === 'auth/multi-factor-auth-required') {
      // First factor succeeded; reset lockout counters (best-effort).
      try {
        const functions = getFunctions(undefined, 'asia-southeast1');
        const recordLoginAttempt = httpsCallable(functions, 'recordLoginAttempt');
        await recordLoginAttempt({ email: emailCheck.value, success: true });
      } catch (_) {
        // ignore
      }

      try {
        sessionStorage.setItem(
          'hydro:mfa:pending',
          JSON.stringify({
            email: emailCheck.value,
            operationType: error?.operationType || error?.customData?.operationType || 'signIn',
            customData: error?.customData || null,
            createdAt: Date.now(),
          })
        );
      } catch (_) {
        // Best-effort only.
      }

      window.location.replace(ROUTES.ADMIN_MFA_CHALLENGE);
      return { success: false, error: '', errorCode: 'mfa-required' };
    }

    // Record credential failures (best-effort).
    try {
      const code = String(error?.code || '');
      const shouldRecord = [
        'auth/wrong-password',
        'auth/user-not-found',
        'auth/invalid-credential',
      ].includes(code);
      if (shouldRecord) {
        const functions = getFunctions(undefined, 'asia-southeast1');
        const recordLoginAttempt = httpsCallable(functions, 'recordLoginAttempt');
        await recordLoginAttempt({ email: emailCheck.value, success: false });
      }
    } catch (_) {
      // ignore
    }

    const accessError = normalizeAccessError(error);
    if (accessError) {
      return {
        success: false,
        error: accessError.message,
        errorCode: accessError.code,
      };
    }

    return {
      success: false,
      error: getAuthErrorMessage(error.code),
      errorCode: error.code,
    };
  }
}

export async function logOut() {
  try {
    await signOut(auth);
  } finally {
    window.location.replace(ROUTES.SIGN_IN);
  }
}

export function initAuthGuard(requireAuth = true, onAuthReady = null) {
  const authPages = ['login.html', 'signup.html', 'auth-action.html', 'bootstrap.html'];
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const isAuthPage = authPages.includes(currentPage);

  onAuthStateChanged(auth, async (user) => {
    if (requireAuth && !user && !isAuthPage) {
      window.location.replace(ROUTES.SIGN_IN);
      return;
    }

    if (user && isAuthPage) {
      try {
        const activeCheck = await requireActiveUser(user.uid);
        if (!activeCheck.ok) {
          return;
        }
        const role = activeCheck.userData?.[USER_FIELDS.ROLE] || (await getUserRole(user.uid));
        redirectToDashboard(role);
        return;
      } catch (_) {
        return;
      }
    }

    if (onAuthReady) {
      onAuthReady(user);
    }
  });
}

export async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;

  if (!user || !user.email) {
    return { success: false, error: 'No user logged in' };
  }

  const passwordCheck = validatePassword(newPassword);
  if (!passwordCheck.valid) {
    return { success: false, error: passwordCheck.error };
  }

  try {
    if (currentPassword) {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
    }

    await updatePassword(user, newPassword);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: getAuthErrorMessage(error.code),
    };
  }
}

export async function getStudentProfile() {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    // Canonical profile lives in users/{uid}.
    // students/{uid} may exist for legacy pages; merge it if present.
    const [userSnap, studentSnap] = await Promise.all([
      getDoc(doc(db, COLLECTIONS.USERS, user.uid)),
      getDoc(doc(db, COLLECTIONS.STUDENTS, user.uid)),
    ]);

    if (!userSnap.exists() && !studentSnap.exists()) {
      return null;
    }

    const base = userSnap.exists() ? (userSnap.data() || {}) : {};
    const extra = studentSnap.exists() ? (studentSnap.data() || {}) : {};
    const id = userSnap.exists() ? userSnap.id : studentSnap.id;
    return { id, ...base, ...extra };
  } catch (_) {
    return null;
  }
}

export async function updateStudentProfile(data) {
  const user = auth.currentUser;
  if (!user) {
    return { success: false, error: 'No user logged in' };
  }

  const { email, createdAt, ...safeData } = data || {};

  try {
    const functions = getFunctions(undefined, 'asia-southeast1');
    const callable = httpsCallable(functions, 'updateUserProfile');

    const payload = {
      name: safeData.name !== undefined ? String(safeData.name || '').trim() : undefined,
      phone: safeData.phone !== undefined ? String(safeData.phone || '').trim() : undefined,
      avatarUrl: safeData.avatarUrl !== undefined ? String(safeData.avatarUrl || '').trim() : undefined,
    };

    await callable(payload);

    if (payload.name) {
      await updateProfile(user, { displayName: payload.name });
    }

    return { success: true };
  } catch (error) {
    logError('[auth] updateUserProfile failed', error);
    const isLimited = handleRateLimitError(error);
    return {
      success: false,
      error: isLimited
        ? 'Too many actions. Please wait a bit and try again.'
        : String(error?.message || 'Failed to update profile. Please try again.'),
    };
  }
}

function getAuthErrorMessage(code) {
  const messages = {
    'auth/email-already-in-use': 'This email is already registered. Please sign in.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/weak-password': 'Password must meet the required policy.',
    'auth/user-not-found': 'No account found with this email address.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/invalid-credential': 'Invalid email or password. Please check and try again.',
    'auth/too-many-requests': 'Too many failed attempts. Please wait a few minutes and try again.',
    'auth/user-disabled': 'This account has been suspended. Please contact support.',
    'auth/requires-recent-login': 'Please sign out and sign in again before changing your password.',
    'auth/network-request-failed': 'Network error. Please check your internet connection.',
  };

  return messages[code] || 'An unexpected error occurred. Please try again.';
}

function normalizeAccessError(error) {
  const message = String(error?.message || '');
  const code = String(error?.code || '');

  const blockedByClient =
    message.includes('ERR_BLOCKED_BY_CLIENT') ||
    message.includes('blocked by client') ||
    code.includes('blocked') ||
    code === 'unavailable';

  if (blockedByClient) {
    return {
      code: 'firestore-blocked',
      message: 'Browser privacy settings are blocking Firestore. Disable ad blocker or Shields, then try again.',
    };
  }

  const networkBlocked =
    code === 'failed-precondition' ||
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    message.toLowerCase().includes('network') ||
    message.toLowerCase().includes('firestore');

  if (networkBlocked) {
    return {
      code: 'firestore-unavailable',
      message: 'Unable to load account profile right now. Check your internet or try again in a moment.',
    };
  }

  return null;
}

export { redirectToDashboard, getUserRole, ROLES };
