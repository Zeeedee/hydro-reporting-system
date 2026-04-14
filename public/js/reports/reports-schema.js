export const COLLECTION_REPORTS = 'reports';
export const REPORTS_COLLECTION = COLLECTION_REPORTS;

export const FIELD_STUDENT_ID = 'studentId';
export const FIELD_CREATED_AT = 'createdAt';
export const FIELD_STATUS = 'status';

export const STATUS_PENDING = 'pending';
export const STATUS_IN_PROGRESS = 'in_progress';
export const STATUS_RESOLVED = 'resolved';
export const STATUS_CLOSED = 'closed';

export const FIELD = Object.freeze({
  STUDENT_ID: FIELD_STUDENT_ID,
  STATUS: FIELD_STATUS,
  CREATED_AT: FIELD_CREATED_AT,
  BUILDING: 'building',
  FLOOR: 'floor',
  LOCATION: 'location',
  ISSUE_TYPE: 'issueType',
  RISK_LEVEL: 'riskLevel',
  DESCRIPTION: 'description',
  UPDATED_AT: 'updatedAt',
  CREATED_BY_NAME: 'createdByName',
  REPORTER_SNAPSHOT: 'reporterSnapshot',
});

export const STATUS = Object.freeze({
  PENDING: STATUS_PENDING,
  IN_PROGRESS: STATUS_IN_PROGRESS,
  RESOLVED: STATUS_RESOLVED,
  CLOSED: STATUS_CLOSED,
});

// Canonical issueType values stored in Firestore.
export const ISSUE_TYPE = Object.freeze({
  NO_WATER: 'no_water',
  LEAK: 'leak',
  CONTAMINATED: 'contaminated',
  LOW_PRESSURE: 'low_pressure',
  CLOGGED: 'clogged',
  CLOGGED_TOILET: 'clogged_toilet',
  LEAKING_PIPES: 'leaking_pipes',
  DISCOLORATION: 'discoloration',
  ODOR: 'odor',
  FLOODING: 'flooding',
  PIPE_DAMAGE: 'pipe_damage',
  OTHER: 'other',
});

// Canonical riskLevel values stored in Firestore.
export const RISK_LEVEL = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent',
});

// Keep fallback values aligned with Firestore rules when dynamic config is unavailable.
export const RULES_FALLBACK_ISSUE_TYPES = Object.freeze(Object.values(ISSUE_TYPE));
export const RULES_FALLBACK_RISK_LEVELS = Object.freeze(Object.values(RISK_LEVEL));
export const RULES_FALLBACK_BUILDINGS = Object.freeze(['Building A', 'Building B', 'CMA', 'MBA', 'Gymnasium']);

const CANONICAL_STATUS_MAP = Object.freeze({
  pending: STATUS.PENDING,
  in_progress: STATUS.IN_PROGRESS,
  'in progress': STATUS.IN_PROGRESS,
  inprogress: STATUS.IN_PROGRESS,
  resolved: STATUS.RESOLVED,
  closed: STATUS.CLOSED,
});

const ISSUE_TYPE_LABELS = Object.freeze({
  [ISSUE_TYPE.NO_WATER]: 'No Water',
  [ISSUE_TYPE.LEAK]: 'Leak',
  [ISSUE_TYPE.CONTAMINATED]: 'Contaminated Water',
  [ISSUE_TYPE.LOW_PRESSURE]: 'Low Pressure',
  [ISSUE_TYPE.CLOGGED]: 'Clogged',
  [ISSUE_TYPE.CLOGGED_TOILET]: 'Clogged Toilet',
  [ISSUE_TYPE.LEAKING_PIPES]: 'Leaking Pipes',
  [ISSUE_TYPE.DISCOLORATION]: 'Discoloration',
  [ISSUE_TYPE.ODOR]: 'Strange Odor',
  [ISSUE_TYPE.FLOODING]: 'Flooding',
  [ISSUE_TYPE.PIPE_DAMAGE]: 'Pipe Damage',
  [ISSUE_TYPE.OTHER]: 'Other',
});

const CANONICAL_ISSUE_TYPE_MAP = Object.freeze({
  [ISSUE_TYPE.NO_WATER]: ISSUE_TYPE.NO_WATER,
  'no water': ISSUE_TYPE.NO_WATER,
  'no water supply': ISSUE_TYPE.NO_WATER,
  [ISSUE_TYPE.LEAK]: ISSUE_TYPE.LEAK,
  [ISSUE_TYPE.CONTAMINATED]: ISSUE_TYPE.CONTAMINATED,
  contamination: ISSUE_TYPE.CONTAMINATED,
  'water contamination': ISSUE_TYPE.CONTAMINATED,
  contaminated_water: ISSUE_TYPE.CONTAMINATED,
  [ISSUE_TYPE.LOW_PRESSURE]: ISSUE_TYPE.LOW_PRESSURE,
  'low pressure': ISSUE_TYPE.LOW_PRESSURE,
  'low water pressure': ISSUE_TYPE.LOW_PRESSURE,
  [ISSUE_TYPE.CLOGGED]: ISSUE_TYPE.CLOGGED,
  [ISSUE_TYPE.CLOGGED_TOILET]: ISSUE_TYPE.CLOGGED_TOILET,
  'clogged toilet': ISSUE_TYPE.CLOGGED_TOILET,
  [ISSUE_TYPE.LEAKING_PIPES]: ISSUE_TYPE.LEAKING_PIPES,
  'leaking pipes': ISSUE_TYPE.LEAKING_PIPES,
  [ISSUE_TYPE.DISCOLORATION]: ISSUE_TYPE.DISCOLORATION,
  'water discoloration': ISSUE_TYPE.DISCOLORATION,
  [ISSUE_TYPE.ODOR]: ISSUE_TYPE.ODOR,
  'strange odor': ISSUE_TYPE.ODOR,
  [ISSUE_TYPE.FLOODING]: ISSUE_TYPE.FLOODING,
  [ISSUE_TYPE.PIPE_DAMAGE]: ISSUE_TYPE.PIPE_DAMAGE,
  'pipe damage': ISSUE_TYPE.PIPE_DAMAGE,
  [ISSUE_TYPE.OTHER]: ISSUE_TYPE.OTHER,
});

const RISK_LEVEL_LABELS = Object.freeze({
  [RISK_LEVEL.LOW]: 'Low',
  [RISK_LEVEL.MEDIUM]: 'Medium',
  [RISK_LEVEL.HIGH]: 'High',
  [RISK_LEVEL.URGENT]: 'Urgent',
});

const CANONICAL_RISK_LEVEL_MAP = Object.freeze({
  low: RISK_LEVEL.LOW,
  medium: RISK_LEVEL.MEDIUM,
  high: RISK_LEVEL.HIGH,
  urgent: RISK_LEVEL.URGENT,
  critical: RISK_LEVEL.URGENT,
});

export function normalizeStatus(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return STATUS.PENDING;

  const normalized = raw.replace(/[\s-]+/g, '_');
  return CANONICAL_STATUS_MAP[raw] || CANONICAL_STATUS_MAP[normalized] || STATUS.PENDING;
}

export function normalizeIssueType(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return ISSUE_TYPE.OTHER;

  const normalized = raw.replace(/[\s-]+/g, '_');
  return CANONICAL_ISSUE_TYPE_MAP[raw] || CANONICAL_ISSUE_TYPE_MAP[normalized] || ISSUE_TYPE.OTHER;
}

export function normalizeRiskLevel(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return RISK_LEVEL.LOW;

  return CANONICAL_RISK_LEVEL_MAP[raw] || RISK_LEVEL.LOW;
}

export function toIssueTypeLabel(value) {
  const normalized = normalizeIssueType(value);
  return ISSUE_TYPE_LABELS[normalized] || ISSUE_TYPE_LABELS[ISSUE_TYPE.OTHER];
}

export function toRiskLevelLabel(value) {
  const normalized = normalizeRiskLevel(value);
  return RISK_LEVEL_LABELS[normalized] || RISK_LEVEL_LABELS[RISK_LEVEL.LOW];
}

export function validateReportPayload(payload, options = {}) {
  const errors = [];
  const safePayload = payload || {};

  const allowedIssueTypes = Array.isArray(options.allowedIssueTypes) && options.allowedIssueTypes.length
    ? options.allowedIssueTypes.map((value) => normalizeIssueType(value))
    : RULES_FALLBACK_ISSUE_TYPES;
  const allowedRiskLevels = Array.isArray(options.allowedRiskLevels) && options.allowedRiskLevels.length
    ? options.allowedRiskLevels.map((value) => normalizeRiskLevel(value))
    : RULES_FALLBACK_RISK_LEVELS;

  const allowedBuildings = Array.isArray(options.allowedBuildings) ? options.allowedBuildings.map((v) => String(v || '').trim()).filter(Boolean) : [];
  const buildingFloors = options && typeof options === 'object' && options.buildingFloors && typeof options.buildingFloors === 'object'
    ? options.buildingFloors
    : {};

  const building = String(safePayload[FIELD.BUILDING] || '').trim();
  const floor = String(safePayload[FIELD.FLOOR] || '').trim();
  const location = String(safePayload[FIELD.LOCATION] || '').trim();
  const issueTypeRaw = String(safePayload[FIELD.ISSUE_TYPE] || '').trim();
  const riskLevelRaw = String(safePayload[FIELD.RISK_LEVEL] || '').trim();
  const issueType = normalizeIssueType(issueTypeRaw);
  const riskLevel = normalizeRiskLevel(riskLevelRaw);
  const description = String(safePayload[FIELD.DESCRIPTION] || '').trim();
  const reporterSnapshot = safePayload[FIELD.REPORTER_SNAPSHOT];

  if (!allowedBuildings.length) {
    errors.push('No buildings configured yet. Please contact an admin.');
  } else {
    if (!building) errors.push('Building is required.');
    if (building && !allowedBuildings.includes(building)) {
      errors.push('Building is not allowed by system rules.');
    }

    if (!floor) errors.push('Floor is required.');
    if (floor && floor.length > 60) errors.push('Floor must be 60 characters or less.');
    if (building && floor) {
      const allowedFloors = Array.isArray(buildingFloors?.[building]) ? buildingFloors[building] : [];
      if (!allowedFloors.length) {
        errors.push('No floors configured for the selected building.');
      } else if (!allowedFloors.includes(floor)) {
        errors.push('Floor is not allowed for the selected building.');
      }
    }
  }
  if (!location) errors.push('Location is required.');
  if (!issueTypeRaw) errors.push('Issue type is required.');
  if (issueTypeRaw && !allowedIssueTypes.includes(issueType)) errors.push('Issue type is not allowed by system rules.');
  if (!riskLevelRaw) errors.push('Risk level is required.');
  if (!allowedRiskLevels.includes(riskLevel)) errors.push(`Risk level must be one of: ${allowedRiskLevels.join(', ')}.`);
  if (description.length > 1000) errors.push('Description must be 1000 characters or less.');

  // Optional reporter snapshot for admin-side rendering.
  if (reporterSnapshot !== undefined && reporterSnapshot !== null) {
    const snap = reporterSnapshot;
    const isObj = Boolean(snap) && typeof snap === 'object' && !Array.isArray(snap);
    if (!isObj) {
      errors.push('Reporter snapshot is invalid.');
    } else {
      const uid = String(snap.uid || '').trim();
      const name = String(snap.name || '').trim();
      const email = String(snap.email || '').trim();
      const phoneNumber = String(snap.phoneNumber || '').trim();
      const role = String(snap.role || '').trim();

      if (uid && uid.length > 128) errors.push('Reporter snapshot uid is too long.');
      if (name && name.length > 160) errors.push('Reporter name is too long.');
      if (email && email.length > 200) errors.push('Reporter email is too long.');
      if (phoneNumber && phoneNumber.length > 40) errors.push('Reporter phone is too long.');
      if (role && role.length > 32) errors.push('Reporter role is too long.');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      ...safePayload,
      [FIELD.BUILDING]: building,
      [FIELD.FLOOR]: floor,
      [FIELD.LOCATION]: location,
      [FIELD.ISSUE_TYPE]: issueType,
      [FIELD.RISK_LEVEL]: riskLevel,
      [FIELD.DESCRIPTION]: description,
      [FIELD.REPORTER_SNAPSHOT]: reporterSnapshot || null,
    },
  };
}
