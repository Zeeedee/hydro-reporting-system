import { auth } from './firebase-config.js';
import { ROUTES } from './config/app-constants.js';
import {
  TotpMultiFactorGenerator,
  getMultiFactorResolver,
  signInWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { requireActiveUser, getUserRole, redirectToDashboard } from './auth/auth-bootstrap.js';

const STORAGE_KEY = 'hydro:mfa:pending';
let requirePasswordForChallenge = false;

function setVerifyBusy(busy) {
  const btn = document.getElementById('verifyBtn');
  if (!btn) return;
  btn.disabled = !!busy;
  btn.dataset.busy = busy ? '1' : '0';
  if (busy) {
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>Verifying...';
  } else {
    btn.innerHTML = '<i class="fa-solid fa-circle-check"></i>Verify';
  }
}

function showMessage(kind, text) {
  const box = document.getElementById('messageBox');
  if (!box) return;
  box.className = `message show ${kind}`;
  box.textContent = text;
}

function clearMessage() {
  const box = document.getElementById('messageBox');
  if (!box) return;
  box.className = 'message';
  box.textContent = '';
}

function normalizeOtp(value) {
  return String(value || '').replace(/\s+/g, '').replace(/[^0-9]/g, '').trim();
}

function clampOtp(value) {
  const normalized = normalizeOtp(value);
  return normalized.slice(0, 6);
}

function setOtpValue(input) {
  if (!input) return;
  const next = clampOtp(input.value);
  if (input.value !== next) {
    input.value = next;
  }
}

function setVerifyEnabled(enabled) {
  const btn = document.getElementById('verifyBtn');
  if (!btn) return;
  if (btn.dataset.busy === '1') return;
  btn.disabled = !enabled;
}

function showPasswordField(show) {
  const field = document.getElementById('passwordField');
  if (!field) return;
  field.classList.toggle('hidden', !show);
}

function getPasswordValue() {
  return String(document.getElementById('password')?.value || '');
}

function buildResolverFromPending(pending) {
  const operationType = pending?.operationType || pending?.customData?.operationType || 'signIn';
  const errorLike = {
    code: 'auth/multi-factor-auth-required',
    customData: pending?.customData,
    operationType,
  };

  try {
    return getMultiFactorResolver(auth, errorLike);
  } catch (error) {
    // Usually auth/argument-error if payload isn't complete.
    throw error;
  }
}

async function resolveTotpSignIn(resolver, otp) {
  const hint = (resolver.hints || []).find((h) => h?.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  if (!hint) {
    throw new Error('No supported TOTP factor found for this account.');
  }
  const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, otp);
  return resolver.resolveSignIn(assertion);
}

function loadPending() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function clearPending() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (_) {
    // ignore
  }
}

async function completeSignInWithTotp(pending, otp) {
  if (!pending) {
    const err = new Error('MFA session expired. Please sign in again.');
    err.code = 'mfa-session-missing';
    throw err;
  }

  // Preferred path: reconstruct resolver from stored customData.
  if (pending?.customData) {
    const resolver = buildResolverFromPending(pending);
    return resolveTotpSignIn(resolver, otp);
  }

  const err = new Error('MFA session data is incomplete. Please sign in again.');
  err.code = 'mfa-session-incomplete';
  throw err;
}

async function completeSignInWithPassword(email, password, otp) {
  // Trigger real MFA-required error from Firebase by attempting first factor again.
  try {
    await signInWithEmailAndPassword(auth, email, password);
    throw new Error('MFA challenge was not required. Please continue signing in.');
  } catch (error) {
    if (String(error?.code || '') !== 'auth/multi-factor-auth-required') {
      throw error;
    }
    const resolver = getMultiFactorResolver(auth, error);
    return resolveTotpSignIn(resolver, otp);
  }
}

async function init() {
  const pending = loadPending();
  if (!pending) {
    showMessage('error', 'MFA session not found. Please sign in again.');
    showPasswordField(false);
    return;
  }

  const subtitle = document.getElementById('subtitle');
  if (subtitle && pending.email) {
    subtitle.textContent = `Enter the 6-digit code from your authenticator app for ${pending.email}.`;
  }

  const otpInput = document.getElementById('otp');
  const passwordInput = document.getElementById('password');
  const verifyBtn = document.getElementById('verifyBtn');
  const backBtn = document.getElementById('backBtn');

  setVerifyBusy(false);
  setVerifyEnabled(false);

  backBtn?.addEventListener('click', () => {
    clearPending();
    window.location.replace(ROUTES.SIGN_IN);
  });

  const refreshVerifyEnabled = () => {
    const otp = clampOtp(otpInput?.value);
    const hasOtp = otp.length === 6;
    if (!requirePasswordForChallenge) {
      setVerifyEnabled(hasOtp);
      return;
    }
    const hasPassword = String(passwordInput?.value || '').trim().length > 0;
    setVerifyEnabled(hasOtp && hasPassword);
  };

  otpInput?.addEventListener('input', () => {
    setOtpValue(otpInput);
    refreshVerifyEnabled();
  });
  passwordInput?.addEventListener('input', refreshVerifyEnabled);

  const onVerify = async () => {
    clearMessage();
    setOtpValue(otpInput);
    const otp = clampOtp(otpInput?.value);
    if (!otp || otp.length !== 6) {
      showMessage('error', 'Enter the 6-digit code from your authenticator app.');
      otpInput?.focus();
      return;
    }

    setVerifyBusy(true);
    try {
      showMessage('info', 'Verifying code...');

      let userCredential;
      if (requirePasswordForChallenge) {
        const email = String(pending?.email || '').trim();
        const password = getPasswordValue();
        if (!email) {
          throw new Error('Email missing. Please sign in again.');
        }
        if (!password.trim()) {
          showMessage('error', 'Enter your password to continue.');
          passwordInput?.focus();
          return;
        }
        userCredential = await completeSignInWithPassword(email, password, otp);
      } else {
        userCredential = await completeSignInWithTotp(pending, otp);
      }

      clearPending();

      const user = userCredential?.user;
      if (!user?.uid) {
        throw new Error('Sign-in completed, but no user was returned.');
      }

      const active = await requireActiveUser(user.uid);
      if (!active.ok) {
        window.location.replace(`${ROUTES.SIGN_IN}?reason=${active.reason}`);
        return;
      }

      const role = active.userData?.role || (await getUserRole(user.uid));
      let continueTo = '';
      try {
        continueTo = String(sessionStorage.getItem('hydro:mfa:continue') || '').trim();
        sessionStorage.removeItem('hydro:mfa:continue');
      } catch (_) {
        continueTo = '';
      }

      if (continueTo && continueTo.startsWith('/')) {
        window.location.replace(continueTo);
        return;
      }

      redirectToDashboard(role);
    } catch (error) {
      const code = String(error?.code || '');
      if (code === 'auth/invalid-verification-code' || code === 'auth/missing-verification-code') {
        showMessage('error', 'Invalid code. Check the app and try again.');
        return;
      }

      // If we can't reconstruct the resolver (common on strict browser/session conditions),
      // ask for password once and re-trigger MFA-required to get a fresh resolver.
      if (!requirePasswordForChallenge && (code === 'auth/argument-error' || String(error?.message || '').includes('argument-error'))) {
        requirePasswordForChallenge = true;
        showPasswordField(true);
        showMessage('info', 'For security, please enter your password, then click Verify again.');
        passwordInput?.focus();
        refreshVerifyEnabled();
        return;
      }

      showMessage('error', String(error?.message || 'Unable to verify code. Please try again.'));
    } finally {
      setVerifyBusy(false);
      refreshVerifyEnabled();
    }
  };

  verifyBtn?.addEventListener('click', onVerify);
  otpInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onVerify();
    }
  });

  // Best-effort autofocus.
  otpInput?.focus();
}

init().catch(() => {
  showMessage('error', 'MFA challenge failed to load. Please sign in again.');
});
