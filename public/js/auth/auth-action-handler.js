import {
  confirmPasswordReset,
  signInWithEmailAndPassword,
  verifyPasswordResetCode,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';
import { auth } from '../firebase-config.js';
import { ROUTES } from '../config/app-constants.js';
import { validatePassword, validatePhone, firstValidationError } from '../validation/validation.js';
import { getUserRole, redirectToDashboard } from './auth-bootstrap.js';
import { handleRateLimitError } from '../shared/rate-limit-ui.js';

const params = new URLSearchParams(window.location.search);
const mode = String(params.get('mode') || '').trim();
const oobCode = String(params.get('oobCode') || '').trim();
const continueUrlRaw = String(params.get('continueUrl') || '').trim();

let parsedFlow = String(params.get('flow') || '').trim();
if (!parsedFlow && continueUrlRaw) {
  try {
    const continueUrl = new URL(continueUrlRaw);
    parsedFlow = String(continueUrl.searchParams.get('flow') || '').trim();
  } catch (_) {
    parsedFlow = '';
  }
}

if (!parsedFlow) {
  parsedFlow = 'reset';
}

const isSetupFlow = parsedFlow === 'setup';
let resetEmail = '';

const functions = getFunctions(undefined, 'asia-southeast1');
const activateInvitedAccount = httpsCallable(functions, 'activateInvitedAccount');
const updateUserProfile = httpsCallable(functions, 'updateUserProfile');

const title = document.getElementById('title');
const subtitle = document.getElementById('subtitle');
const messageBox = document.getElementById('messageBox');

const loadingState = document.getElementById('loadingState');
const resetState = document.getElementById('resetState');
const resultState = document.getElementById('resultState');

const resetForm = document.getElementById('resetForm');
const resetSubmitBtn = document.getElementById('resetSubmitBtn');
const newPasswordInput = document.getElementById('newPassword');
const confirmPasswordInput = document.getElementById('confirmPassword');
const setupFields = document.getElementById('setupFields');
const setupPhoneInput = document.getElementById('setupPhone');

const goToSignInBtn = document.getElementById('goToSignInBtn');

// Ensure correct CTA label as early as possible.
if (resetSubmitBtn) {
  resetSubmitBtn.textContent = isSetupFlow ? 'Complete Setup' : 'Update Password';
}

function showMessage(kind, message) {
  messageBox.className = `message show ${kind}`;
  messageBox.textContent = message;
}

function hideMessage() {
  messageBox.className = 'message';
  messageBox.textContent = '';
}

function showSection(section) {
  [loadingState, resetState, resultState].forEach((el) => {
    if (!el) return;
    el.classList.add('hidden');
  });
  if (section) {
    section.classList.remove('hidden');
  }
}

function goToSignIn() {
  window.location.replace(ROUTES.SIGN_IN);
}

function setRuleValidity(ruleName, valid) {
  const row = document.querySelector(`[data-rule="${ruleName}"]`);
  if (!row) return;
  row.classList.toggle('valid', valid);
  row.classList.toggle('invalid', !valid);
}

function evaluateResetForm() {
  const newPassword = String(newPasswordInput?.value || '');
  const confirmPassword = String(confirmPasswordInput?.value || '');
  const passwordCheck = validatePassword(newPassword);

  const lengthValid = !(newPassword.length < 8 || newPassword.length > 16);
  const mixValid = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,16}$/.test(newPassword);
  const matchValid = newPassword.length > 0 && newPassword === confirmPassword;

  setRuleValidity('length', lengthValid);
  setRuleValidity('mix', mixValid);
  setRuleValidity('match', matchValid);

  const passwordOk = passwordCheck.valid && matchValid;

  let setupOk = true;
  if (isSetupFlow) {
    const phoneCheck = validatePhone(String(setupPhoneInput?.value || ''), { required: true });
    setupOk = phoneCheck.valid;
  }

  const canSubmit = passwordOk && setupOk;
  if (resetSubmitBtn) {
    resetSubmitBtn.disabled = !canSubmit;
  }

  return { canSubmit, passwordCheck, matchValid };
}

function bindPasswordUi() {
  document.querySelectorAll('[data-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.getAttribute('data-toggle');
      const input = document.getElementById(targetId);
      if (!input) return;
      const icon = button.querySelector('i');
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      if (icon) {
        icon.className = isPassword ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
      }
    });
  });

  [newPasswordInput, confirmPasswordInput].forEach((input) => {
    if (!input) return;
    input.addEventListener('input', () => {
      hideMessage();
      evaluateResetForm();
    });
  });

  if (isSetupFlow) {
    if (setupPhoneInput) {
      setupPhoneInput.addEventListener('input', () => {
        hideMessage();
        evaluateResetForm();
      });
    }
  }
}

async function initResetPasswordMode() {
  title.textContent = isSetupFlow ? 'Set Up Your Account' : 'Reset Password';
  subtitle.textContent = isSetupFlow ? 'Create your password to activate your account' : 'Set a new password to continue';

  if (setupFields) {
    setupFields.classList.toggle('hidden', !isSetupFlow);
  }

  if (resetSubmitBtn) {
    resetSubmitBtn.textContent = isSetupFlow ? 'Complete Setup' : 'Update Password';
  }

  if (!oobCode) {
    showSection(resultState);
    showMessage('error', 'Invalid reset link. Request a new password reset email.');
    return;
  }

  try {
    resetEmail = await verifyPasswordResetCode(auth, oobCode);
    showSection(resetState);
    showMessage('info', `${isSetupFlow ? 'Set up account for' : 'Reset password for'} ${resetEmail}`);
    bindPasswordUi();
    evaluateResetForm();
  } catch (_) {
    showSection(resultState);
    showMessage('error', 'This reset link is invalid or expired. Please request a new one.');
  }
}

async function initUnsupportedMode() {
  title.textContent = 'Account Action';
  subtitle.textContent = 'Unsupported action mode';
  showSection(resultState);
  showMessage('error', 'This action link is not supported. Please return to sign in.');
}

if (resetForm) {
  resetForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideMessage();

    const { canSubmit, passwordCheck, matchValid } = evaluateResetForm();
    if (!canSubmit) {
      if (!passwordCheck.valid) {
        showMessage('error', passwordCheck.errors[0]);
      } else if (!matchValid) {
        showMessage('error', 'Passwords must match.');
      } else if (isSetupFlow) {
        const setupError = firstValidationError([
          validatePhone(String(setupPhoneInput?.value || ''), { required: true }),
        ]);
        showMessage('error', setupError || 'Please complete required fields.');
      }
      return;
    }

    const originalLabel = resetSubmitBtn.textContent;
    resetSubmitBtn.disabled = true;
    resetSubmitBtn.textContent = isSetupFlow ? 'Completing...' : 'Updating...';

    try {
      await confirmPasswordReset(auth, oobCode, String(newPasswordInput.value));

      if (!resetEmail) {
        throw new Error('Reset email is missing.');
      }

      await signInWithEmailAndPassword(auth, resetEmail, String(newPasswordInput.value));

      const activationResult = await activateInvitedAccount();
      if (!activationResult?.data?.success) {
        throw new Error('Activation failed.');
      }

      if (isSetupFlow) {
        const phoneCheck = validatePhone(String(setupPhoneInput?.value || ''), { required: true });
        const setupError = firstValidationError([phoneCheck]);
        if (setupError) {
          throw new Error(setupError);
        }
        await updateUserProfile({ phone: phoneCheck.value });
      }

      const role = await getUserRole(auth.currentUser?.uid);
      showMessage('success', isSetupFlow ? 'Account setup complete. Redirecting...' : 'Password updated. Redirecting...');
      setTimeout(() => {
        redirectToDashboard(role);
      }, 500);

      showSection(resultState);
    } catch (error) {
      if (handleRateLimitError(error)) {
        showMessage('error', 'Too many actions. Please wait a bit and try again.');
        resetSubmitBtn.disabled = false;
        resetSubmitBtn.textContent = originalLabel;
        return;
      }
      const code = String(error?.code || '');
      if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
        showMessage('error', 'This reset link is invalid or expired. Please request a new one.');
      } else if (code === 'functions/permission-denied') {
        showMessage('error', 'Your account cannot be activated. Contact admin.');
      } else {
        const msg = String(error?.message || '').trim();
        if (msg && msg.length <= 180 && (isSetupFlow || msg.toLowerCase().includes('password'))) {
          showMessage('error', msg);
        } else {
          showMessage('error', 'Failed to reset password. Please try again with a new reset link.');
        }
      }
      resetSubmitBtn.disabled = false;
      resetSubmitBtn.textContent = originalLabel;
      return;
    }

    resetSubmitBtn.textContent = originalLabel;
  });
}

if (goToSignInBtn) {
  goToSignInBtn.addEventListener('click', goToSignIn);
}

(async function init() {
  showSection(loadingState);
  if (mode === 'resetPassword') {
    await initResetPasswordMode();
    return;
  }
  await initUnsupportedMode();
})();
