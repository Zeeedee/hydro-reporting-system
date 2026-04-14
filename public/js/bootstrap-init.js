import {
  signInWithEmailAndPassword,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';
import { auth } from './firebase-config.js';
import { ROUTES } from './config/app-constants.js';
import { redirectToDashboard, showBlockingLoader, hideBlockingLoader, waitForAuthUser } from './auth/auth-bootstrap.js';
import { handleRateLimitError } from './shared/rate-limit-ui.js';

const signInBtn = document.getElementById('signInBtn');
const operatorEmailInput = document.getElementById('operatorEmail');
const operatorPasswordInput = document.getElementById('operatorPassword');
const bootstrapBtn = document.getElementById('bootstrapBtn');
const signOutBtn = document.getElementById('signOutBtn');
const signedOutSection = document.getElementById('signedOutSection');
const signedInSection = document.getElementById('signedInSection');
const message = document.getElementById('msg');
const bootstrapKeyInput = document.getElementById('bootstrapKey');
const confirmTextInput = document.getElementById('confirmText');

const functions = getFunctions(undefined, 'asia-southeast1');
const bootstrapFirstSuperAdmin = httpsCallable(functions, 'bootstrapFirstSuperAdmin');
const getBootstrapStatus = httpsCallable(functions, 'getBootstrapStatus');

function showMessage(text, type = 'error') {
  if (!message) return;
  message.className = `message show ${type === 'ok' ? 'ok' : 'error'}`;
  message.textContent = text;
}

function clearMessage() {
  if (!message) return;
  message.className = 'message';
  message.textContent = '';
}

function setSignedInUi(isSignedIn) {
  signedOutSection?.classList.toggle('hidden', isSignedIn);
  signedInSection?.classList.toggle('hidden', !isSignedIn);
}

function validateOperatorSignInInput(email, password) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPassword = String(password || '').trim();

  if (!normalizedEmail) return 'Operator email is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedEmail)) return 'Enter a valid operator email.';
  if (!normalizedPassword) return 'Operator password is required.';
  if (normalizedPassword.length < 6 || normalizedPassword.length > 128) return 'Operator password length is invalid.';

  return '';
}

function getSignInErrorMessage(error) {
  const code = String(error?.code || '');
  if (code === 'auth/user-not-found') return 'Operator account not found. Create it in Firebase Authentication first.';
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') return 'Invalid operator credentials. Check email/password and try again.';
  if (code === 'auth/too-many-requests') return 'Too many failed sign in attempts. Wait a moment and retry.';
  if (code === 'auth/network-request-failed') return 'Network error. Check your connection and try again.';
  return 'Operator sign in failed. Try again.';
}

function validateBootstrapInput(rawKey, confirmText) {
  const key = String(rawKey || '').trim();
  const confirm = String(confirmText || '').trim();
  if (!key) return 'Bootstrap key is required.';
  if (key.length < 12 || key.length > 128) return 'Bootstrap key must be 12-128 characters.';
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return 'Bootstrap key has invalid characters.';
  if (confirm !== 'CONFIRM') return 'Type CONFIRM to continue.';
  return '';
}

signInBtn?.addEventListener('click', async () => {
  clearMessage();
  const inputError = validateOperatorSignInInput(operatorEmailInput?.value, operatorPasswordInput?.value);
  if (inputError) {
    showMessage(inputError);
    return;
  }

  signInBtn.disabled = true;
  showBlockingLoader('Signing in operator...');
  try {
    await signInWithEmailAndPassword(
      auth,
      String(operatorEmailInput.value).trim().toLowerCase(),
      String(operatorPasswordInput.value)
    );
    setSignedInUi(true);
  } catch (error) {
    showMessage(getSignInErrorMessage(error));
  } finally {
    hideBlockingLoader();
    signInBtn.disabled = false;
  }
});

signOutBtn?.addEventListener('click', async () => {
  await signOut(auth);
  setSignedInUi(false);
});

bootstrapBtn?.addEventListener('click', async () => {
  clearMessage();
  const error = validateBootstrapInput(bootstrapKeyInput?.value, confirmTextInput?.value);
  if (error) {
    showMessage(error);
    return;
  }

  bootstrapBtn.disabled = true;
  showBlockingLoader('Bootstrapping super admin...');
  try {
    const result = await bootstrapFirstSuperAdmin({ bootstrapKey: String(bootstrapKeyInput.value).trim() });
    showMessage(result.data?.message || 'Bootstrap completed.', 'ok');
    setTimeout(() => {
      redirectToDashboard('super_admin');
    }, 350);
  } catch (errorResult) {
    if (handleRateLimitError(errorResult)) {
      showMessage('Too many actions. Please wait a bit and try again.');
      return;
    }
    const messageText = String(errorResult?.message || 'Bootstrap failed.');
    if (messageText.toLowerCase().includes('already completed')) {
      showMessage('Bootstrap already completed. Redirecting to Sign In...', 'ok');
      setTimeout(() => {
        window.location.replace(ROUTES.SIGN_IN);
      }, 450);
      return;
    }
    showMessage(messageText);
  } finally {
    hideBlockingLoader();
    bootstrapBtn.disabled = false;
  }
});

(async function init() {
  showBlockingLoader('Checking bootstrap session...');
  try {
    const user = await waitForAuthUser();
    setSignedInUi(Boolean(user));

    if (!user) {
      showMessage('Sign in as operator to check bootstrap status.', 'error');
      return;
    }

    const status = await getBootstrapStatus();
    if (status.data?.hasSuperAdmin) {
      showMessage('Bootstrap already completed. Redirecting to Sign In...', 'ok');
      setTimeout(() => {
        window.location.replace(ROUTES.SIGN_IN);
      }, 500);
      return;
    }

    if (!status.data?.bootstrapDocExists || status.data?.bootstrapEnabled !== true) {
      showMessage('Bootstrap is not armed. Create systemConfig/bootstrap first.', 'error');
      return;
    }
  } finally {
    hideBlockingLoader();
  }
})();
