import { Router } from 'express';
import { GmailService } from '../services/gmail-service';
import { SQLiteTransactionRepository } from '../db/sqlite-transaction-repository';

const router = Router();
const gmailService = new GmailService();

/**
 * [FUNC-GMAIL-4], [FUNC-GMAIL-19] POST /api/ingestion/gmail/fetch
 * Fetches receipts from Gmail and saves raw inputs to the Bronze table.
 */
router.post(['/gmail/fetch', '/fetch'], async (req, res) => {
  const { accessToken, filters } = req.body;
  const userId = (req as any).auth?.sub;

  if (!accessToken) {
    return res.status(400).json({ error: 'Google Access Token is required' });
  }

  // [NFR-SEC-4] Input Validation
  if (!filters || !Array.isArray(filters.sender) || filters.sender.length === 0) {
    return res.status(400).json({ error: 'At least one sender email is required' });
  }

  if (!filters.startDate || !filters.endDate) {
    return res.status(400).json({ error: 'Start date and end date are required' });
  }

  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    const emails = await gmailService.fetchEmails(accessToken, filters);

    // Save to raw table (Bronze Layer)
    for (const email of emails) {
      await repository.saveRawInput({
        id: email.id,
        userId,
        sourceType: 'email',
        sender: email.sender,
        title: email.subject,
        snippet: email.snippet || '',
        rawBody: email.body || '',
        rawPayload: JSON.stringify(email),
        receivedAt: email.date,
      });
    }

    await repository.close();
    res.status(200).json({ emails });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch emails' });
  }
});

/**
 * [FUNC-GMAIL-27] POST /api/ingestion/gmail/fetch-list
 * Retrieves matching Gmail Message IDs.
 */
router.post(['/gmail/fetch-list', '/fetch-list'], async (req, res) => {
  const { accessToken, filters } = req.body;

  if (!accessToken) {
    return res.status(400).json({ error: 'Google Access Token is required' });
  }

  // [NFR-SEC-4] Input Validation
  if (!filters || !Array.isArray(filters.sender) || filters.sender.length === 0) {
    return res.status(400).json({ error: 'At least one sender email is required' });
  }

  if (!filters.startDate || !filters.endDate) {
    return res.status(400).json({ error: 'Start date and end date are required' });
  }

  try {
    const messageIds = await gmailService.fetchMessageIds(accessToken, filters);
    res.status(200).json({ messageIds });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list message IDs' });
  }
});

/**
 * [FUNC-GMAIL-27] POST /api/ingestion/gmail/fetch-detail
 * Fetches detail for a single Gmail message and processes/saves it.
 */
router.post(['/gmail/fetch-detail', '/fetch-detail'], async (req, res) => {
  const { accessToken, messageId } = req.body;
  const userId = (req as any).auth?.sub;

  if (!accessToken) {
    return res.status(400).json({ error: 'Google Access Token is required' });
  }
  if (!messageId) {
    return res.status(400).json({ error: 'messageId is required' });
  }

  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    // Deduplication check
    const exists = await repository.emailExists(messageId, userId);
    if (exists) {
      await repository.close();
      return res.status(200).json({ status: 'skipped', email: { id: messageId } });
    }

    const email = await gmailService.fetchEmailDetail(accessToken, messageId);

    // Save to raw table (Bronze Layer)
    await repository.saveRawInput({
      id: email.id,
      userId,
      sourceType: 'email',
      sender: email.sender,
      title: email.subject,
      snippet: email.snippet || '',
      rawBody: email.body || '',
      rawPayload: JSON.stringify(email),
      receivedAt: email.date,
    });

    await repository.close();
    res.status(200).json({ status: 'fetched', email });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch message details' });
  }
});

export default router;
