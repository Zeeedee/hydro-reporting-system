const SAFE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SAFE_PHONE_REGEX = /^(\+?\d{10,15}|\d{3,4}-\d{3}-\d{4})$/;
const SAFE_NAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9 &._()\-]*$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,16}$/;

function toStringValue(value) {
  return String(value == null ? '' : value);
}

export function normalizeInput(value) {
  return toStringValue(value).trim();
}

export function validateRequired(value, label = 'Field') {
  const normalized = normalizeInput(value);
  if (!normalized) {
    return { valid: false, error: `${label} is required.` };
  }
  return { valid: true, value: normalized };
}

export function validateLength(value, { min = 0, max = Infinity, label = 'Field' } = {}) {
  const normalized = normalizeInput(value);
  if (normalized.length < min) {
    return { valid: false, error: `${label} must be at least ${min} characters.` };
  }
  if (normalized.length > max) {
    return { valid: false, error: `${label} must be ${max} characters or less.` };
  }
  return { valid: true, value: normalized };
}

export function validateEmail(email) {
  const normalized = normalizeInput(email).toLowerCase();
  if (!normalized) return { valid: false, error: 'Email is required.' };
  if (!SAFE_EMAIL_REGEX.test(normalized)) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }
  return { valid: true, value: normalized };
}

export function validatePhone(phone, { required = false } = {}) {
  const normalized = normalizeInput(phone);
  if (!normalized && !required) {
    return { valid: true, value: '' };
  }
  if (!normalized && required) {
    return { valid: false, error: 'Phone is required.' };
  }
  if (!SAFE_PHONE_REGEX.test(normalized)) {
    return { valid: false, error: 'Please enter a valid phone number.' };
  }
  return { valid: true, value: normalized };
}

export function validateEnum(value, allowedValues = [], label = 'Field') {
  const normalized = normalizeInput(value);
  if (!allowedValues.includes(normalized)) {
    return { valid: false, error: `${label} has an invalid value.` };
  }
  return { valid: true, value: normalized };
}

export function validateSafeName(value, { min = 2, max = 80, label = 'Field' } = {}) {
  const normalized = normalizeInput(value);
  if (!normalized) {
    return { valid: false, error: `${label} is required.` };
  }
  if (normalized.length < min) {
    return { valid: false, error: `${label} must be at least ${min} characters.` };
  }
  if (normalized.length > max) {
    return { valid: false, error: `${label} must be ${max} characters or less.` };
  }
  if (!SAFE_NAME_REGEX.test(normalized)) {
    return { valid: false, error: `${label} contains invalid characters.` };
  }
  return { valid: true, value: normalized };
}

export function validatePassword(password) {
  const raw = toStringValue(password);
  const errors = [];

  if (raw.length < 8 || raw.length > 16) {
    errors.push('Password must be 8-16 characters');
  }

  if (!PASSWORD_REGEX.test(raw)) {
    errors.push('Must include uppercase, lowercase, number, and special character');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function firstValidationError(checks = []) {
  const failed = checks.find((result) => !result.valid);
  return failed ? failed.error : '';
}
