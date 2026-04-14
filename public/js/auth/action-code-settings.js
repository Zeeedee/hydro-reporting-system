import { ROUTES } from '../config/app-constants.js';

export function buildActionCodeSettings({ flow = 'reset' } = {}) {
  const actionHost = window.location.origin;
  const actionPath = ROUTES.AUTH_ACTION || '/auth-action.html';
  const continueUrl = flow === 'setup'
    ? `${actionHost}${actionPath}?flow=setup`
    : `${actionHost}${actionPath}`;

  return {
    url: continueUrl,
    handleCodeInApp: false,
  };
}
