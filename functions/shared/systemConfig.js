/**
 * System Configuration Cloud Function
 * Provides dynamic data for buildings, issue types, departments, and risk levels
 */

const { onCall, HttpsError } = require('firebase-functions/https');
const { getFirestore } = require('firebase-admin/firestore');
const { COLLECTIONS } = require('./constants');
const { enforceRateLimit, getPolicyForCallable } = require('./rateLimit');

const db = getFirestore();

async function enforceCallableRateLimit(request, callableName) {
    const uid = request?.auth?.uid;
    const policy = getPolicyForCallable({ callableName, data: request?.data });
    const policies = Array.isArray(policy) ? policy : [policy];
    for (const entry of policies) {
        await enforceRateLimit({
            db,
            uid,
            action: entry.action,
            windowSec: entry.windowSec,
            max: entry.max,
            extraKey: entry.extraKey,
        });
    }
}

/**
 * Get system configuration (buildings from locations, issue types, departments, risk levels)
 * Auth required - callable endpoints are rate limited per-user
 */
exports.getSystemConfig = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'getSystemConfig');
    try {
        // Locations: buildings + floors.
        const locationsSnapshot = await db.collection(COLLECTIONS.LOCATIONS)
            .where('active', '==', true)
            .get();

        const buildingsSet = new Set();
        const floorsMap = new Map(); // building -> floors[]

        locationsSnapshot.docs.forEach(doc => {
            const data = doc.data() || {};
            const building = String(data.building || '').trim();
            const floor = String(data.floor || '').trim();
            const area = String(data.area || '').trim();

            // Buildings.
            if (building && !area) {
                if (!floorsMap.has(building)) {
                    floorsMap.set(building, new Set());
                }

                if (!floor) {
                    buildingsSet.add(building);
                } else {
                    buildingsSet.add(building);
                    floorsMap.get(building).add(floor);
                }
            }
        });

        // Convert to array format. When empty, caller UI should block submissions
        // until an admin configures buildings.
        const buildingsFromLocations = Array.from(buildingsSet).sort();
        const buildings = buildingsFromLocations;
        const buildingFloors = {};
        floorsMap.forEach((floors, building) => {
            buildingFloors[building] = Array.from(floors).sort();
        });

        // Canonical issueType values (stored in reports), with display labels for UI.
        const issueTypes = [
            { value: 'no_water', label: 'No Water' },
            { value: 'leak', label: 'Leak' },
            { value: 'contaminated', label: 'Contaminated Water' },
            { value: 'low_pressure', label: 'Low Pressure' },
            { value: 'clogged', label: 'Clogged' },
            { value: 'clogged_toilet', label: 'Clogged Toilet' },
            { value: 'leaking_pipes', label: 'Leaking Pipes' },
            { value: 'discoloration', label: 'Discoloration' },
            { value: 'odor', label: 'Strange Odor' },
            { value: 'flooding', label: 'Flooding' },
            { value: 'pipe_damage', label: 'Pipe Damage' },
            { value: 'other', label: 'Other' }
        ];

        // Canonical riskLevel values (stored in reports), with display labels for UI.
        const riskLevels = [
            { value: 'low', label: 'Low', color: '#10b981' },
            { value: 'medium', label: 'Medium', color: '#f59e0b' },
            { value: 'high', label: 'High', color: '#ef4444' },
            { value: 'urgent', label: 'Urgent', color: '#dc2626' }
        ];

        // Static departments (could be moved to Firestore config collection later)
        const departments = [
            'Administration',
            'Engineering',
            'IT Department',
            'Facilities',
            'Student Services',
            'Academic Affairs',
            'Finance',
            'Human Resources',
            'Security',
            'Maintenance'
        ];

        // Report statuses
        const reportStatuses = [
            { value: 'pending', label: 'Pending', color: '#f59e0b' },
            { value: 'in_progress', label: 'In Progress', color: '#3b82f6' },
            { value: 'resolved', label: 'Resolved', color: '#10b981' }
        ];

        return {
            success: true,
            buildings,
            locationsConfigured: buildingsFromLocations.length > 0,
            buildingFloors,
            issueTypes,
            riskLevels,
            departments,
            reportStatuses
        };
    } catch (error) {
        console.error('Error fetching system config:', error);
        throw new HttpsError('internal', 'Failed to fetch system configuration');
    }
});
