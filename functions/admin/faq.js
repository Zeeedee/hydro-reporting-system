/**
 * FAQ Management Cloud Functions
 * Admin-only CRUD operations for FAQs
 */

const { onCall, HttpsError } = require('firebase-functions/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { ensureAdmin } = require('../shared/auth');
const { COLLECTIONS } = require('../shared/constants');
const { enforceRateLimit, getPolicyForCallable } = require('../shared/rateLimit');

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
 * Get all FAQs (public - for student FAQ page)
 */
exports.getFaqs = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'getFaqs');
    try {
        const snapshot = await db.collection(COLLECTIONS.FAQS)
            .where('active', '==', true)
            .orderBy('order', 'asc')
            .get();

        const faqs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        return { success: true, faqs };
    } catch (error) {
        console.error('Error fetching FAQs:', error);
        throw new HttpsError('internal', 'Failed to fetch FAQs');
    }
});

/**
 * Get all FAQs for admin (includes inactive)
 */
exports.getAllFaqsAdmin = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'getAllFaqsAdmin');
    await ensureAdmin(request);

    try {
        const snapshot = await db.collection(COLLECTIONS.FAQS)
            .orderBy('order', 'asc')
            .get();

        const faqs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        return { success: true, faqs };
    } catch (error) {
        console.error('Error fetching FAQs:', error);
        throw new HttpsError('internal', 'Failed to fetch FAQs');
    }
});

/**
 * Create a new FAQ
 */
exports.createFaq = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'createFaq');
    await ensureAdmin(request);

    const { question, answer, category, order } = request.data;

    if (!question || !answer) {
        throw new HttpsError('invalid-argument', 'Question and answer are required');
    }

    try {
        const docRef = await db.collection(COLLECTIONS.FAQS).add({
            question: question.trim(),
            answer: answer.trim(),
            category: category || 'General',
            order: order || 0,
            active: true,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        return { success: true, id: docRef.id };
    } catch (error) {
        console.error('Error creating FAQ:', error);
        throw new HttpsError('internal', 'Failed to create FAQ');
    }
});

/**
 * Update an existing FAQ
 */
exports.updateFaq = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'updateFaq');
    await ensureAdmin(request);

    const { id, question, answer, category, order, active } = request.data;

    if (!id) {
        throw new HttpsError('invalid-argument', 'FAQ ID is required');
    }

    try {
        const updateData = {
            updatedAt: FieldValue.serverTimestamp()
        };

        if (question !== undefined) updateData.question = question.trim();
        if (answer !== undefined) updateData.answer = answer.trim();
        if (category !== undefined) updateData.category = category;
        if (order !== undefined) updateData.order = order;
        if (active !== undefined) updateData.active = active;

        await db.collection(COLLECTIONS.FAQS).doc(id).update(updateData);

        return { success: true };
    } catch (error) {
        console.error('Error updating FAQ:', error);
        throw new HttpsError('internal', 'Failed to update FAQ');
    }
});

/**
 * Delete a FAQ
 */
exports.deleteFaq = onCall({ region: 'asia-southeast1' }, async (request) => {
    await enforceCallableRateLimit(request, 'deleteFaq');
    await ensureAdmin(request);

    const { id } = request.data;

    if (!id) {
        throw new HttpsError('invalid-argument', 'FAQ ID is required');
    }

    try {
        await db.collection(COLLECTIONS.FAQS).doc(id).delete();
        return { success: true };
    } catch (error) {
        console.error('Error deleting FAQ:', error);
        throw new HttpsError('internal', 'Failed to delete FAQ');
    }
});
