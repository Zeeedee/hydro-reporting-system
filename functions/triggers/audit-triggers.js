const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/firestore');
const { COLLECTIONS } = require('../shared/constants');
const { writeAuditLog } = require('../shared/audit');

function toStringValue(value) {
  return String(value == null ? '' : value).trim();
}

exports.onReportCreatedAudit = onDocumentCreated(
  {
    region: 'asia-southeast1',
    document: `${COLLECTIONS.REPORTS}/{reportId}`,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) {
      return;
    }

    const reportId = toStringValue(event.params?.reportId);
    const report = snap.data() || {};

    const actorUid = toStringValue(report.studentId || report.createdBy || report.userId || report.uid);
    const snapshotRole = toStringValue(report.reporterSnapshot && report.reporterSnapshot.role);
    const actorRole = snapshotRole || toStringValue(report.actorRole) || 'unknown';
      await writeAuditLog(
        {
        actorUid: actorUid || 'unknown',
        actorRole,
        actionType: 'report_created',
        targetType: 'report',
        targetId: reportId || snap.id,
          metadata: {
            building: report.building || null,
            floor: report.floor || null,
            location: report.location || report.area || null,
            issueType: report.issueType || null,
            riskLevel: report.riskLevel || null,
            status: report.status || null,
            imageCount: Array.isArray(report.photoUrls) ? report.photoUrls.length : 0,
            reporterRole: snapshotRole || null,
          },
        },
        { bestEffort: true }
      );
    }
);

exports.onReportImagesAddedAudit = onDocumentUpdated(
  {
    region: 'asia-southeast1',
    document: `${COLLECTIONS.REPORTS}/{reportId}`,
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    if (!before || !after) return;

    const reportId = toStringValue(event.params?.reportId);
    const beforeData = before.data() || {};
    const afterData = after.data() || {};

    const beforeUrls = Array.isArray(beforeData.photoUrls) ? beforeData.photoUrls.filter(Boolean) : [];
    const afterUrls = Array.isArray(afterData.photoUrls) ? afterData.photoUrls.filter(Boolean) : [];

    const hasNewImages = afterUrls.length > beforeUrls.length;

    if (hasNewImages) {
      const addedCount = afterUrls.length - beforeUrls.length;
      const actorUid = toStringValue(afterData.studentId || afterData.createdBy || afterData.userId || afterData.uid);
      const snapshotRole = toStringValue(afterData.reporterSnapshot && afterData.reporterSnapshot.role);

      await writeAuditLog(
        {
          actorUid: actorUid || 'unknown',
          actorRole: snapshotRole || 'unknown',
          actionType: 'report_images_added',
          targetType: 'report',
          targetId: reportId || after.id,
          metadata: {
            addedCount,
            imageCount: afterUrls.length,
            reporterRole: snapshotRole || null,
          },
        },
        { bestEffort: true }
      );
    }

    // Best-effort "report_updated" for non-status content changes (avoid duplicating report_status_updated).
    const contentFields = ['building', 'floor', 'location', 'area', 'issueType', 'description'];
    const changed = [];
    contentFields.forEach((field) => {
      const beforeVal = toStringValue(beforeData[field]);
      const afterVal = toStringValue(afterData[field]);
      if (beforeVal !== afterVal) {
        changed.push(field);
      }
    });

    if (changed.length) {
      const actorUid = toStringValue(afterData.updatedBy || afterData.studentId || afterData.createdBy || afterData.userId || afterData.uid);
      await writeAuditLog(
        {
          actorUid: actorUid || 'unknown',
          actorRole: toStringValue(afterData.updatedBy) ? 'admin' : 'unknown',
          actionType: 'report_updated',
          targetType: 'report',
          targetId: reportId || after.id,
          metadata: {
            fieldsChanged: changed,
          },
        },
        { bestEffort: true }
      );
    }
  }
);
