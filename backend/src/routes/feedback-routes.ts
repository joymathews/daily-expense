import { Router } from 'express';
import { SQLiteTransactionRepository } from '../db/sqlite-transaction-repository';

const router = Router();

/**
 * [FUNC-FEEDBACK-2, FUNC-FEEDBACK-3] GET /api/feedback/settings
 * Returns the authenticated user's LLM feedback learning settings.
 */
router.get('/settings', async (req, res) => {
  const userId = (req as any).auth?.sub;
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    const settings = await repository.getFeedbackSettings(userId);
    await repository.close();
    res.status(200).json({ settings });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch feedback settings' });
  }
});

/**
 * [FUNC-FEEDBACK-2, FUNC-FEEDBACK-3] PUT /api/feedback/settings
 * Updates the authenticated user's LLM feedback learning settings.
 */
router.put('/settings', async (req, res) => {
  const userId = (req as any).auth?.sub;
  const { isEnabled, maxExamples } = req.body;

  if (typeof isEnabled !== 'boolean') {
    return res.status(400).json({ error: 'isEnabled (boolean) is required' });
  }

  const clampedMax = Math.min(50, Math.max(1, parseInt(maxExamples ?? '10', 10)));
  if (isNaN(clampedMax)) {
    return res.status(400).json({ error: 'maxExamples must be an integer between 1 and 50' });
  }

  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    await repository.saveFeedbackSettings(userId, { isEnabled, maxExamples: clampedMax });
    await repository.close();
    res.status(200).json({ settings: { isEnabled, maxExamples: clampedMax } });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update feedback settings' });
  }
});

/**
 * [FUNC-FEEDBACK-4] GET /api/feedback/examples
 * Returns all stored correction examples for the authenticated user.
 */
router.get('/examples', async (req, res) => {
  const userId = (req as any).auth?.sub;
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    const examples = await repository.listCorrectionExamples(userId);
    await repository.close();
    res.status(200).json({ examples });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch correction examples' });
  }
});

/**
 * [FUNC-FEEDBACK-4] DELETE /api/feedback/examples/:id
 * Deletes a single correction example by ID.
 */
router.delete('/examples/:id', async (req, res) => {
  const userId = (req as any).auth?.sub;
  const { id } = req.params;
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    await repository.deleteCorrectionExample(id, userId);
    await repository.close();
    res.status(200).json({ message: 'Correction example deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete correction example' });
  }
});

/**
 * [FUNC-FEEDBACK-4] DELETE /api/feedback/examples
 * Clears all correction examples for the authenticated user.
 */
router.delete('/examples', async (req, res) => {
  const userId = (req as any).auth?.sub;
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    await repository.clearAllCorrectionExamples(userId);
    await repository.close();
    res.status(200).json({ message: 'All correction examples cleared' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to clear correction examples' });
  }
});

/**
 * [FUNC-FEEDBACK-1] GET /api/feedback/effectiveness
 * Returns statistical data representing the effectiveness of LLM correction learning.
 */
router.get('/effectiveness', async (req, res) => {
  const userId = (req as any).auth?.sub;
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    const effectiveness = await repository.getFeedbackEffectiveness(userId);
    await repository.close();
    res.status(200).json({ effectiveness });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch feedback effectiveness statistics' });
  }
});

export default router;
