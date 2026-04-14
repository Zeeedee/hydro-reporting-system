import {
  RULES_FALLBACK_BUILDINGS,
  RULES_FALLBACK_ISSUE_TYPES,
  RULES_FALLBACK_RISK_LEVELS,
  STATUS,
  normalizeIssueType,
  normalizeRiskLevel,
  normalizeStatus,
  toIssueTypeLabel as schemaIssueTypeLabel,
  toRiskLevelLabel as schemaRiskLevelLabel,
} from './reports-schema.js';
import { logWarn } from '../shared/logger.js';

const DEFAULT_STATUSES = [STATUS.PENDING, STATUS.IN_PROGRESS, STATUS.RESOLVED];

let cachedOptions = null;
let pendingLoad = null;

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractConfigArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStringArray(rawValues, fallbackValues, mapItem) {
  const mapped = unique(
    rawValues.map((item) => {
      if (typeof mapItem === 'function') {
        return mapItem(item);
      }
      return String(item || '').trim();
    })
  );

  return mapped.length ? mapped : [...fallbackValues];
}

function buildFallback() {
  const issueTypeLabels = {};
  RULES_FALLBACK_ISSUE_TYPES.forEach((value) => {
    issueTypeLabels[value] = schemaIssueTypeLabel(value);
  });

  const riskLevelLabels = {};
  RULES_FALLBACK_RISK_LEVELS.forEach((value) => {
    riskLevelLabels[value] = schemaRiskLevelLabel(value);
  });

  return {
    buildings: [],
    issueTypes: [...RULES_FALLBACK_ISSUE_TYPES],
    riskLevels: [...RULES_FALLBACK_RISK_LEVELS],
    statuses: [...DEFAULT_STATUSES],
    issueTypeLabels,
    riskLevelLabels,
    warnings: ['No buildings configured yet. Please contact an admin to add buildings.'],
    buildingFloors: {},
  };
}

function normalizeSystemConfig(config) {
  const fallback = buildFallback();
  const safeConfig = config || {};
  const warnings = [];

  const configBuildings = extractConfigArray(safeConfig.buildings);
  const buildingsRaw = unique(configBuildings.map((item) => String(item || '').trim())).filter(Boolean);
  if (safeConfig.locationsConfigured === false || !buildingsRaw.length) {
    warnings.push('No buildings configured yet. Please contact an admin to add buildings.');
  }

  // Buildings should be admin-configured. Do not silently fall back to defaults
  // when the server indicates no buildings exist.
  const buildings = buildingsRaw;

  const rawBuildingFloors = safeConfig && typeof safeConfig === 'object' ? safeConfig.buildingFloors : null;
  const buildingFloors = {};
  if (rawBuildingFloors && typeof rawBuildingFloors === 'object') {
    Object.entries(rawBuildingFloors).forEach(([building, floors]) => {
      const key = String(building || '').trim();
      if (!key) return;
      const list = Array.isArray(floors) ? floors : [];
      const normalizedFloors = unique(list.map((item) => String(item || '').trim())).filter(Boolean);
      buildingFloors[key] = normalizedFloors;
    });
  }

  const issueTypeLabels = { ...fallback.issueTypeLabels };
  const issueTypeValues = [];
  extractConfigArray(safeConfig.issueTypes).forEach((item) => {
    const rawValue = typeof item === 'string' ? item : item?.value || item?.label || '';
    const normalizedValue = normalizeIssueType(rawValue);
    if (!normalizedValue) return;
    issueTypeValues.push(normalizedValue);

    const label = typeof item === 'object' && item?.label
      ? String(item.label).trim()
      : schemaIssueTypeLabel(normalizedValue);
    issueTypeLabels[normalizedValue] = label || schemaIssueTypeLabel(normalizedValue);
  });
  const issueTypes = unique(issueTypeValues).length ? unique(issueTypeValues) : fallback.issueTypes;

  const riskLevelLabels = { ...fallback.riskLevelLabels };
  const riskLevelValues = [];
  extractConfigArray(safeConfig.riskLevels).forEach((item) => {
    const rawValue = typeof item === 'string' ? item : item?.value || item?.label || '';
    const normalizedValue = normalizeRiskLevel(rawValue);
    if (!normalizedValue) return;
    riskLevelValues.push(normalizedValue);

    const label = typeof item === 'object' && item?.label
      ? String(item.label).trim()
      : schemaRiskLevelLabel(normalizedValue);
    riskLevelLabels[normalizedValue] = label || schemaRiskLevelLabel(normalizedValue);
  });
  const riskLevels = unique(riskLevelValues).length ? unique(riskLevelValues) : fallback.riskLevels;

  const statuses = normalizeStringArray(
    extractConfigArray(safeConfig.reportStatuses),
    fallback.statuses,
    (item) => {
      const raw = typeof item === 'string' ? item : item?.value || item?.label || '';
      return normalizeStatus(raw);
    }
  );

  return {
    buildings,
    buildingFloors,
    issueTypes,
    riskLevels,
    statuses,
    issueTypeLabels,
    riskLevelLabels,
    warnings,
  };
}

async function loadSystemConfigSafely() {
  try {
    const module = await import('../reports.js');
    if (module && typeof module.loadSystemConfig === 'function') {
      return await module.loadSystemConfig();
    }
  } catch (error) {
    logWarn('[reports] system config module unavailable, using fallback options:', error?.message || error);
  }
  return null;
}

export async function getReportFormOptions() {
  if (cachedOptions) {
    return cachedOptions;
  }
  if (pendingLoad) {
    return pendingLoad;
  }

  pendingLoad = (async () => {
    try {
      const config = await loadSystemConfigSafely();
      if (config) {
        cachedOptions = normalizeSystemConfig(config);
      } else {
        cachedOptions = buildFallback();
      }
    } catch (error) {
      logWarn('[reports] using fallback form options:', error?.message || error);
      cachedOptions = buildFallback();
    }

    return cachedOptions;
  })();

  return pendingLoad.finally(() => {
    pendingLoad = null;
  });
}

export function getFallbackReportFormOptions() {
  return buildFallback();
}

export function toRiskLevelLabel(value) {
  const normalized = normalizeRiskLevel(value);
  if (cachedOptions?.riskLevelLabels?.[normalized]) {
    return cachedOptions.riskLevelLabels[normalized];
  }
  return schemaRiskLevelLabel(normalized);
}

export function toIssueTypeLabel(value) {
  const normalized = normalizeIssueType(value);
  if (cachedOptions?.issueTypeLabels?.[normalized]) {
    return cachedOptions.issueTypeLabels[normalized];
  }
  return schemaIssueTypeLabel(normalized);
}
