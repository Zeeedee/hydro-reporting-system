import { auth } from './firebase-config.js';
import { ROUTES, ROLES } from './config/app-constants.js';
import { requireAuth } from './auth/auth-guard.js';
import { redirectToDashboard } from './auth/auth-bootstrap.js';
import {
  EmailAuthProvider,
  TotpMultiFactorGenerator,
  multiFactor,
  reauthenticateWithCredential,
  reload,
  sendEmailVerification,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

const params = new URLSearchParams(window.location.search);
const continueParam = String(params.get('continue') || '').trim();
const manageMode = String(params.get('manage') || '').trim() === '1';

function getSafeContinuePath() {
  if (continueParam && continueParam.startsWith('/')) return continueParam;
  return ROUTES.ADMIN_DASHBOARD;
}

function showMessage(kind, text) {
  const box = document.getElementById('messageBox');
  if (!box) return;
  box.className = `message show ${kind}`;
  box.textContent = text;
}

function setInlineNotice(text) {
  const box = document.getElementById('manageBox');
  if (!box) return;
  if (!text) {
    box.style.display = 'none';
    box.textContent = '';
    return;
  }
  box.style.display = 'block';
  box.className = 'message show info';
  box.textContent = text;
}

function setManageActionsVisible(visible) {
  const actions = document.getElementById('manageActions');
  if (!actions) return;
  actions.style.display = visible ? 'flex' : 'none';
}

function clearQr() {
  const canvas = document.getElementById('qrCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function renderQr(text) {
  clearQr();
  const canvas = document.getElementById('qrCanvas');
  if (!canvas) return;
  const uri = String(text || '').trim();
  if (!uri) return;

  const QrCreator = window.QrCreator;
  if (!QrCreator || typeof QrCreator.render !== 'function') {
    return;
  }

  try {
    QrCreator.render(
      {
        text: uri,
        size: 200,
        ecLevel: 'M',
        radius: 0.2,
        quiet: 1,
        fill: '#0f172a',
        background: '#ffffff',
      },
      canvas
    );
  } catch (_) {
    // Best-effort only.
  }
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

function buildTotpUri({ issuer, accountName, secretKey }) {
  const safeIssuer = String(issuer || '').trim() || 'HYDRO';
  const safeAccount = String(accountName || '').trim();
  const safeSecret = String(secretKey || '').trim();
  if (!safeAccount || !safeSecret) return '';

  const label = `${encodeURIComponent(safeIssuer)}:${encodeURIComponent(safeAccount)}`;
  const params = new URLSearchParams();
  params.set('secret', safeSecret);
  params.set('issuer', safeIssuer);
  // Defaults are widely supported; leaving algorithm/digits/period implicit.
  return `otpauth://totp/${label}?${params.toString()}`;
}

function hasTotpFactor(user) {
  const factors = multiFactor(user).enrolledFactors || [];
  return factors.some((factor) => factor?.factorId === TotpMultiFactorGenerator.FACTOR_ID);
}

function storePostEnrollContinue() {
  try {
    sessionStorage.setItem('hydro:mfa:continue', getSafeContinuePath());
  } catch (_) {
    // ignore
  }
}

let currentUser = null;
let totpSecret = null;
let autoGenerateAttempted = false;
let setupMethod = 'qr';

function setSetupMethod(method) {
  setupMethod = method === 'manual' ? 'manual' : 'qr';

  const qrBtn = document.getElementById('methodQrBtn');
  const manualBtn = document.getElementById('methodManualBtn');
  const qrPane = document.getElementById('qrPane');
  const howtoPane = document.getElementById('howtoPane');
  const howtoQrCard = document.getElementById('howtoQrCard');
  const howtoManualCard = document.getElementById('howtoManualCard');

  if (qrBtn) {
    qrBtn.classList.toggle('active', setupMethod === 'qr');
    qrBtn.setAttribute('aria-selected', setupMethod === 'qr' ? 'true' : 'false');
  }
  if (manualBtn) {
    manualBtn.classList.toggle('active', setupMethod === 'manual');
    manualBtn.setAttribute('aria-selected', setupMethod === 'manual' ? 'true' : 'false');
  }

  if (qrPane) qrPane.classList.toggle('hidden', setupMethod !== 'qr');

  if (howtoPane) {
    howtoPane.classList.toggle('manual-only', setupMethod === 'manual');
  }
  if (howtoQrCard) howtoQrCard.classList.toggle('hidden', setupMethod === 'manual');
  if (howtoManualCard) howtoManualCard.classList.toggle('hidden', false);
}

function setGenerateUiState({ busy, hasSecret }) {
  const generateBtn = document.getElementById('generateBtn');
  const regenBtn = document.getElementById('regenerateBtn');

  if (generateBtn) {
    generateBtn.disabled = !!busy;
    generateBtn.innerHTML = busy
      ? '<i class="fa-solid fa-spinner fa-spin"></i>Generating...'
      : '<i class="fa-solid fa-key"></i>Generate secret';
  }
  if (regenBtn) {
    regenBtn.disabled = !!busy || !hasSecret;
  }
}

async function ensureEmailVerified() {
  const status = document.getElementById('verifyStatus');
  const enrollSection = document.getElementById('enrollSection');
  const verifySection = document.getElementById('verifySection');

  if (!currentUser) return;

  const emailEl = document.getElementById('accountEmail');
  if (emailEl) emailEl.textContent = String(currentUser.email || '');

  if (!currentUser.emailVerified) {
    if (status) status.textContent = 'Email not verified. Verify your email to continue.';
    if (verifySection) verifySection.classList.remove('hidden');
    if (enrollSection) enrollSection.classList.add('hidden');
    return false;
  }

  if (status) status.textContent = 'Email verified.';
  if (verifySection) verifySection.classList.add('hidden');
  if (enrollSection) enrollSection.classList.remove('hidden');
  return true;
}

async function tryReauthenticateIfNeeded(error) {
  if (String(error?.code || '') !== 'auth/requires-recent-login') {
    throw error;
  }

  const passwordInput = document.getElementById('reauthPassword');
  const password = String(passwordInput?.value || '');
  if (!password.trim()) {
    showMessage('info', 'For security, please re-enter your password to continue.');
    passwordInput?.focus();
    throw error;
  }

  if (!currentUser?.email) {
    throw error;
  }

  const credential = EmailAuthProvider.credential(currentUser.email, password);
  await reauthenticateWithCredential(currentUser, credential);
}

async function generateSecret() {
  clearMessage();
  totpSecret = null;

  setGenerateUiState({ busy: true, hasSecret: false });

  const secretKeyEl = document.getElementById('secretKey');
  const totpUriEl = document.getElementById('totpUri');
  if (secretKeyEl) secretKeyEl.value = '';
  if (totpUriEl) totpUriEl.value = '';
  renderQr('');

  try {
    const session = await multiFactor(currentUser).getSession();
    totpSecret = await TotpMultiFactorGenerator.generateSecret(session);
  } catch (error) {
    try {
      await tryReauthenticateIfNeeded(error);
      const session = await multiFactor(currentUser).getSession();
      totpSecret = await TotpMultiFactorGenerator.generateSecret(session);
    } catch (finalError) {
      const code = String(finalError?.code || error?.code || '');

      if (code === 'auth/requires-recent-login') {
        // tryReauthenticateIfNeeded already showed the correct guidance.
        setGenerateUiState({ busy: false, hasSecret: false });
        return;
      }

      if (code === 'auth/operation-not-allowed') {
        showMessage('error', 'TOTP MFA is not enabled for this project. Run the enable script and try again.');
        setGenerateUiState({ busy: false, hasSecret: false });
        return;
      }

      showMessage('error', String(finalError?.message || 'Unable to generate a TOTP secret. Please try again.'));
      setGenerateUiState({ busy: false, hasSecret: false });
      return;
    }
  }

  const secretKey = String(totpSecret?.secretKey || '');
  const uri = buildTotpUri({ issuer: 'HYDRO', accountName: currentUser.email, secretKey });

  if (secretKeyEl) secretKeyEl.value = secretKey;
  if (totpUriEl) totpUriEl.value = uri;
  renderQr(uri);

  setGenerateUiState({ busy: false, hasSecret: !!secretKey });

  showMessage('info', 'Secret generated. Add it to your authenticator app, then enter the 6-digit code to enable MFA.');
}

async function regenerateSecret() {
  if (!currentUser) return;
  if (!confirm('Regenerate the secret? This will create a new QR/code and invalidate the old one (unless you already enrolled).')) {
    return;
  }
  await generateSecret();
}

async function maybeAutoGenerateSecret() {
  if (autoGenerateAttempted) return;
  autoGenerateAttempted = true;

  if (!currentUser) return;
  if (!currentUser.emailVerified) return;
  if (hasTotpFactor(currentUser)) return;
  if (totpSecret) return;

  // Best-effort: if it requires recent login, we will prompt for password.
  await generateSecret();
}

async function resetMfa() {
  clearMessage();
  setInlineNotice('');

  if (!confirm('Disable MFA for this account? You can enable it again later.')) {
    return;
  }

  const runUnenroll = async () => {
    const factors = multiFactor(currentUser).enrolledFactors || [];
    const totpFactors = factors.filter((f) => f?.factorId === TotpMultiFactorGenerator.FACTOR_ID);
    if (!totpFactors.length) {
      showMessage('info', 'MFA is already disabled for this account.');
      return false;
    }

    for (const factor of totpFactors) {
      // The SDK supports passing the MultiFactorInfo directly.
      await multiFactor(currentUser).unenroll(factor);
    }
    return true;
  };

  try {
    const didDisable = await runUnenroll();
    if (!didDisable) return;

    totpSecret = null;
    const secretKeyEl = document.getElementById('secretKey');
    const totpUriEl = document.getElementById('totpUri');
    if (secretKeyEl) secretKeyEl.value = '';
    if (totpUriEl) totpUriEl.value = '';
    renderQr('');
    showMessage('ok', 'MFA disabled. You can enable it again by generating a new secret.');
  } catch (error) {
    const code = String(error?.code || '');
    if (code === 'auth/requires-recent-login') {
      try {
        await tryReauthenticateIfNeeded(error);
        const didDisable = await runUnenroll();
        if (!didDisable) return;
        totpSecret = null;
        const secretKeyEl = document.getElementById('secretKey');
        const totpUriEl = document.getElementById('totpUri');
        if (secretKeyEl) secretKeyEl.value = '';
        if (totpUriEl) totpUriEl.value = '';
        renderQr('');
        showMessage('ok', 'MFA disabled. You can enable it again by generating a new secret.');
      } catch (finalError) {
        const finalCode = String(finalError?.code || code);
        if (finalCode === 'auth/requires-recent-login') {
          // tryReauthenticateIfNeeded already showed the guidance.
          return;
        }
        showMessage('error', String(finalError?.message || 'Unable to disable MFA.'));
      }
      return;
    }
    if (code === 'auth/user-token-expired') {
      showMessage('info', 'Session expired. Please sign in again and retry.');
      try {
        await signOut(auth);
      } finally {
        window.location.replace(ROUTES.SIGN_IN);
      }
      return;
    }

    showMessage('error', String(error?.message || 'Unable to disable MFA.'));
  }
}

async function enrollTotp() {
  clearMessage();

  const otpInput = document.getElementById('otp');
  const rawOtp = normalizeOtp(otpInput?.value);
  if (!totpSecret) {
    showMessage('error', 'Generate a secret first.');
    return;
  }
  if (!rawOtp || rawOtp.length < 6) {
    showMessage('error', 'Enter the 6-digit code from your authenticator app.');
    otpInput?.focus();
    return;
  }

  try {
    const assertion = TotpMultiFactorGenerator.assertionForEnrollment(totpSecret, rawOtp);
    await multiFactor(currentUser).enroll(assertion, 'Authenticator app');
    storePostEnrollContinue();
    showMessage('ok', 'MFA enabled. Please sign in again to complete setup.');
    try {
      await signOut(auth);
    } finally {
      window.location.replace(ROUTES.SIGN_IN);
    }
  } catch (error) {
    const code = String(error?.code || '');
    if (code === 'auth/invalid-verification-code' || code === 'auth/missing-verification-code') {
      showMessage('error', 'Invalid code. Check the app and try again.');
      return;
    }
    await tryReauthenticateIfNeeded(error);
    showMessage('error', String(error?.message || 'Failed to enable MFA. Please try again.'));
  }
}

function copyValue(inputId) {
  const el = document.getElementById(inputId);
  const value = String(el?.value || '');
  if (!value) return;
  navigator.clipboard?.writeText(value).then(
    () => showMessage('ok', 'Copied to clipboard.'),
    () => showMessage('error', 'Could not copy. Please copy manually.')
  );
}

async function init() {
  const { user, role } = await requireAuth({
    allowedRoles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
    showLoader: false,
  });
  currentUser = user;

  if (role !== ROLES.ADMIN && role !== ROLES.SUPER_ADMIN) {
    redirectToDashboard(role);
    return;
  }

  // If already enrolled, get out of the way.
  if (hasTotpFactor(currentUser) && currentUser.emailVerified && !manageMode) {
    window.location.replace(getSafeContinuePath());
    return;
  }

  await ensureEmailVerified();

  // Setup method toggle.
  setSetupMethod('qr');
  setGenerateUiState({ busy: false, hasSecret: false });
  document.getElementById('methodQrBtn')?.addEventListener('click', () => setSetupMethod('qr'));
  document.getElementById('methodManualBtn')?.addEventListener('click', () => setSetupMethod('manual'));

  if (hasTotpFactor(currentUser) && currentUser.emailVerified && manageMode) {
    setInlineNotice('MFA is enabled for this account. Use "Disable MFA" to turn it off, or re-enroll with a new secret if you changed devices.');
    setManageActionsVisible(true);
  } else {
    setInlineNotice('');
    setManageActionsVisible(false);
  }

  document.getElementById('sendVerifyBtn')?.addEventListener('click', async () => {
    clearMessage();
    try {
      await sendEmailVerification(currentUser);
      showMessage('ok', 'Verification email sent. Check your inbox and verify, then click "I\'ve verified".');
    } catch (error) {
      showMessage('error', String(error?.message || 'Could not send verification email.'));
    }
  });

  document.getElementById('refreshVerifyBtn')?.addEventListener('click', async () => {
    clearMessage();
    try {
      await reload(currentUser);
      await ensureEmailVerified();
      if (currentUser.emailVerified && hasTotpFactor(currentUser)) {
        window.location.replace(getSafeContinuePath());
      }
    } catch (_) {
      showMessage('error', 'Unable to refresh account state. Please reload the page.');
    }
  });

  document.getElementById('generateBtn')?.addEventListener('click', generateSecret);
  document.getElementById('regenerateBtn')?.addEventListener('click', regenerateSecret);
  document.getElementById('enrollBtn')?.addEventListener('click', enrollTotp);
  document.getElementById('copySecretBtn')?.addEventListener('click', () => copyValue('secretKey'));
  document.getElementById('copyUriBtn')?.addEventListener('click', () => copyValue('totpUri'));

  document.getElementById('resetMfaBtn')?.addEventListener('click', resetMfa);
  document.getElementById('goBackBtn')?.addEventListener('click', () => {
    window.location.replace(getSafeContinuePath());
  });

  document.getElementById('signOutBtn')?.addEventListener('click', async () => {
    try {
      await signOut(auth);
    } finally {
      window.location.replace(ROUTES.SIGN_IN);
    }
  });

  // Auto-generate on first open (when eligible).
  await maybeAutoGenerateSecret();
}

init().catch((error) => {
  if (String(error?.message || '') === 'redirect') return;
  showMessage('error', 'Unable to load security setup. Please sign in again.');
  window.location.replace(ROUTES.SIGN_IN);
});
