import { Router } from 'express';
import crypto from 'crypto';
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

    // Auto-save fetcher email list targets to database
    for (const senderEmail of filters.sender) {
      if (senderEmail && typeof senderEmail === 'string') {
        await repository.saveFetcherEmail(userId, senderEmail.trim().toLowerCase());
      }
    }

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

    // Auto-save fetcher email list targets to database
    for (const senderEmail of filters.sender) {
      if (senderEmail && typeof senderEmail === 'string') {
        await repository.saveFetcherEmail(userId, senderEmail.trim().toLowerCase());
      }
    }
    await repository.close();

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

/**
 * GET /api/ingestion/payment-methods
 */
router.get('/payment-methods', async (req, res) => {
  const userId = (req as any).auth?.sub;
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    const methods = await repository.getPaymentMethods(userId);
    await repository.close();
    res.status(200).json({ paymentMethods: methods });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch payment methods' });
  }
});

/**
 * POST /api/ingestion/payment-methods
 */
router.post('/payment-methods', async (req, res) => {
  const userId = (req as any).auth?.sub;
  const { name } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Payment method name is required' });
  }
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    const id = crypto.randomUUID();
    await repository.savePaymentMethod({ id, userId, name: name.trim() });
    await repository.close();
    res.status(201).json({ paymentMethod: { id, userId, name: name.trim() } });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save payment method' });
  }
});

/**
 * PUT /api/ingestion/payment-methods/:id
 */
router.put('/payment-methods/:id', async (req, res) => {
  const userId = (req as any).auth?.sub;
  const { id } = req.params;
  const { name } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Payment method name is required' });
  }
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    await repository.updatePaymentMethod(id, userId, name.trim());
    await repository.close();
    res.status(200).json({ message: 'Payment method updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update payment method' });
  }
});

/**
 * DELETE /api/ingestion/payment-methods/:id
 */
router.delete('/payment-methods/:id', async (req, res) => {
  const userId = (req as any).auth?.sub;
  const { id } = req.params;
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    await repository.deletePaymentMethod(id, userId);
    await repository.close();
    res.status(200).json({ message: 'Payment method deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete payment method' });
  }
});

/**
 * GET /api/ingestion/payment-rules
 */
router.get('/payment-rules', async (req, res) => {
  const userId = (req as any).auth?.sub;
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    const rules = await repository.getPaymentMappingRules(userId);
    await repository.close();
    res.status(200).json({ paymentRules: rules });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch payment rules' });
  }
});

/**
 * POST /api/ingestion/payment-rules
 */
router.post('/payment-rules', async (req, res) => {
  const userId = (req as any).auth?.sub;
  const { aliasPattern, paymentMethodId } = req.body;
  if (!aliasPattern || aliasPattern.trim() === '') {
    return res.status(400).json({ error: 'Alias pattern is required' });
  }
  if (!paymentMethodId) {
    return res.status(400).json({ error: 'Payment method ID is required' });
  }
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    const id = crypto.randomUUID();
    await repository.savePaymentMappingRule({ id, userId, aliasPattern: aliasPattern.trim(), paymentMethodId });
    await repository.close();
    res.status(201).json({ paymentRule: { id, userId, aliasPattern: aliasPattern.trim(), paymentMethodId } });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save payment rule' });
  }
});

/**
 * PUT /api/ingestion/payment-rules/:id
 */
router.put('/payment-rules/:id', async (req, res) => {
  const userId = (req as any).auth?.sub;
  const { id } = req.params;
  const { aliasPattern, paymentMethodId } = req.body;
  if (!aliasPattern || aliasPattern.trim() === '') {
    return res.status(400).json({ error: 'Alias pattern is required' });
  }
  if (!paymentMethodId) {
    return res.status(400).json({ error: 'Payment method ID is required' });
  }
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    await repository.updatePaymentMappingRule(id, userId, aliasPattern.trim(), paymentMethodId);
    await repository.close();
    res.status(200).json({ message: 'Payment rule updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update payment rule' });
  }
});

/**
 * DELETE /api/ingestion/payment-rules/:id
 */
router.delete('/payment-rules/:id', async (req, res) => {
  const userId = (req as any).auth?.sub;
  const { id } = req.params;
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    await repository.deletePaymentMappingRule(id, userId);
    await repository.close();
    res.status(200).json({ message: 'Payment rule deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete payment rule' });
  }
});

/**
 * POST /api/ingestion/standardize-retroactive
 */
router.post('/standardize-retroactive', async (req, res) => {
  const userId = (req as any).auth?.sub;
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    // 1. Fetch Silver (pending + error)
    const silverTxList = await repository.getSilverTransactions(userId);
    let updatedSilverCount = 0;
    for (const tx of silverTxList) {
      const standardized = await repository.standardizePaymentMethod(userId, tx.paymentMethod);
      if (standardized !== tx.paymentMethod) {
        await repository.updatePendingTransaction(tx.id, userId, { paymentMethod: standardized });
        updatedSilverCount++;
      }
    }

    // 2. Fetch Gold (confirmed)
    const goldTxList = await repository.getGoldTransactions(userId);
    let updatedGoldCount = 0;
    for (const tx of goldTxList) {
      const standardized = await repository.standardizePaymentMethod(userId, tx.paymentMethod);
      if (standardized !== tx.paymentMethod) {
        await repository.updateGoldTransaction(tx.id, userId, { paymentMethod: standardized });
        updatedGoldCount++;
      }
    }

    await repository.close();
    res.status(200).json({
      message: 'Retroactive standardization completed successfully',
      updatedSilverCount,
      updatedGoldCount,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed retroactive standardization' });
  }
});

/**
 * GET /api/ingestion/fetcher-emails
 */
router.get('/fetcher-emails', async (req, res) => {
  const userId = (req as any).auth?.sub;
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    const emails = await repository.getFetcherEmails(userId);
    await repository.close();
    res.status(200).json({ fetcherEmails: emails });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch saved sender emails' });
  }
});

/**
 * POST /api/ingestion/fetcher-emails
 */
router.post('/fetcher-emails', async (req, res) => {
  const userId = (req as any).auth?.sub;
  const { email } = req.body;

  if (!email || typeof email !== 'string' || email.trim() === '') {
    return res.status(400).json({ error: 'Email address is required' });
  }

  const trimmedEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    return res.status(400).json({ error: 'Invalid email address format' });
  }

  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    await repository.saveFetcherEmail(userId, trimmedEmail);
    await repository.close();
    res.status(201).json({ fetcherEmail: trimmedEmail });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save sender email' });
  }
});

/**
 * DELETE /api/ingestion/fetcher-emails/:email
 */
router.delete('/fetcher-emails/:email', async (req, res) => {
  const userId = (req as any).auth?.sub;
  const { email } = req.params;

  if (!email || typeof email !== 'string' || email.trim() === '') {
    return res.status(400).json({ error: 'Email parameter is required' });
  }

  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    await repository.deleteFetcherEmail(userId, email.trim().toLowerCase());
    await repository.close();
    res.status(200).json({ message: 'Fetcher email deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete sender email' });
  }
});

export default router;


