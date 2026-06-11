import { Router } from 'express';
import crypto from 'crypto';
import { GmailService } from '../services/gmail-service';
import { SQLiteTransactionRepository } from '../db/sqlite-transaction-repository';
import { TransactionExtractorFactory } from '../services/transaction-extractor';

const router = Router();
const gmailService = new GmailService();

/**
 * [FUNC-GMAIL-4], [FUNC-GMAIL-19] POST /api/gmail/fetch
 * Stage 1: Fetches receipts from Gmail and saves raw emails to the Bronze table.
 * No Ollama extraction is run.
 */
router.post('/fetch', async (req, res) => {
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
      await repository.saveRawEmail({
        id: email.id,
        userId,
        sender: email.sender,
        subject: email.subject,
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
 * [FUNC-GMAIL-17] POST /api/gmail/extract
 * Stage 2: Synchronously extracts transaction details for single or batch raw emails via Ollama LLM.
 * Saves to silver_extracted_transactions (Silver Staging).
 */
router.post('/extract', async (req, res) => {
  const { rawEmailIds } = req.body;
  const userId = (req as any).auth?.sub;

  if (!rawEmailIds || !Array.isArray(rawEmailIds) || rawEmailIds.length === 0) {
    return res.status(400).json({ error: 'rawEmailIds array is required' });
  }

  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    const extractor = TransactionExtractorFactory.createExtractor();
    const results: any[] = [];

    for (const id of rawEmailIds) {
      const rawEmail = await repository.getRawEmailById(id, userId);
      if (!rawEmail) {
        continue;
      }

      // If already extracted and status is approved, don't run again
      const existingSilver = await repository.getSilverTransactionByEmailId(id, userId);
      if (existingSilver) {
        results.push(existingSilver);
        continue;
      }

      const extracted = await extractor.extractTransaction(rawEmail.rawBody);
      if (extracted) {
        const pendingTx = {
          id: crypto.randomUUID(),
          rawEmailId: rawEmail.id,
          userId,
          merchantRaw: extracted.merchant,
          merchantNormalized: extracted.merchant,
          amount: extracted.amount,
          currency: extracted.currency,
          transactionDate: extracted.date,
          inferredCategory: extracted.category,
          confidenceScore: 0.95,
          status: 'pending' as const,
          paymentMethod: extracted.paymentMethod,
        };
        await repository.savePendingTransaction(pendingTx);
        results.push(pendingTx);
      }
    }

    await repository.close();
    res.status(200).json({ extracted: results });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Extraction failed' });
  }
});

/**
 * [FUNC-GMAIL-15], [FUNC-GMAIL-16] GET /api/gmail/raw-emails
 * Retrieves raw emails (Bronze) with optional date filtering.
 */
router.get('/raw-emails', async (req, res) => {
  const { startDate, endDate } = req.query;
  const userId = (req as any).auth?.sub;
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    const emails = await repository.getRawEmails(userId, {
      startDate: startDate as string,
      endDate: endDate as string,
    });

    await repository.close();
    res.status(200).json({ emails });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch raw emails' });
  }
});

/**
 * [FUNC-GMAIL-15], [FUNC-GMAIL-16] GET /api/gmail/silver-transactions
 * Retrieves Silver staging transactions with optional date filtering.
 */
router.get('/silver-transactions', async (req, res) => {
  const { startDate, endDate } = req.query;
  const userId = (req as any).auth?.sub;
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    const transactions = await repository.getSilverTransactions(userId, {
      startDate: startDate as string,
      endDate: endDate as string,
    });

    await repository.close();
    res.status(200).json({ transactions });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch silver transactions' });
  }
});

/**
 * [FUNC-GMAIL-15], [FUNC-GMAIL-16] GET /api/gmail/gold-transactions
 * Retrieves Gold confirmed transactions with optional date filtering.
 */
router.get('/gold-transactions', async (req, res) => {
  const { startDate, endDate } = req.query;
  const userId = (req as any).auth?.sub;
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    const transactions = await repository.getGoldTransactions(userId, {
      startDate: startDate as string,
      endDate: endDate as string,
    });

    await repository.close();
    res.status(200).json({ transactions });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch gold transactions' });
  }
});

/**
 * [FUNC-GMAIL-18] PUT /api/gmail/silver-transactions/:id
 * Updates a pending Silver staging transaction.
 */
router.put('/silver-transactions/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const userId = (req as any).auth?.sub;
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    await repository.updatePendingTransaction(id, userId, updates);

    await repository.close();
    res.status(200).json({ status: 'updated' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update silver transaction' });
  }
});

/**
 * [FUNC-GMAIL-18] PUT /api/gmail/gold-transactions/:id
 * Updates an approved Gold transaction ledger record.
 */
router.put('/gold-transactions/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const userId = (req as any).auth?.sub;
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    await repository.updateGoldTransaction(id, userId, updates);

    await repository.close();
    res.status(200).json({ status: 'updated' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update gold transaction' });
  }
});

/**
 * [FUNC-GMAIL-13] POST /api/gmail/approve
 * Stage 3: Confirms a staging transaction and promotes it to the Gold ledger.
 */
router.post('/approve', async (req, res) => {
  const { silverId, merchant, amount, currency, date, category, notes, paymentMethod } = req.body;
  const userId = (req as any).auth?.sub;

  if (!silverId || !merchant || amount === undefined || !currency || !date || !category) {
    return res.status(400).json({ error: 'All transaction details are required' });
  }

  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    await repository.promoteToTransaction(silverId, {
      id: crypto.randomUUID(),
      pendingTxId: silverId,
      userId,
      merchant,
      amount: parseFloat(amount),
      currency,
      transactionDate: date,
      category,
      notes: notes || '',
      paymentMethod,
    });

    await repository.close();
    res.status(200).json({ status: 'approved' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to approve transaction' });
  }
});

/**
 * [FUNC-GMAIL-22] POST /api/gmail/approve-batch
 * Confirms multiple pending transactions in staging and promotes them to the Gold ledger.
 */
router.post('/approve-batch', async (req, res) => {
  const { silverIds } = req.body;
  const userId = (req as any).auth?.sub;

  if (!silverIds || !Array.isArray(silverIds) || silverIds.length === 0) {
    return res.status(400).json({ error: 'silverIds array is required' });
  }

  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    const approvedIds: string[] = [];

    for (const silverId of silverIds) {
      const tx = await repository.getSilverTransactionById(silverId, userId);
      if (tx && tx.status === 'pending') {
        await repository.promoteToTransaction(silverId, {
          id: crypto.randomUUID(),
          pendingTxId: silverId,
          userId,
          merchant: tx.merchantNormalized || tx.merchantRaw,
          amount: tx.amount,
          currency: tx.currency,
          transactionDate: tx.transactionDate,
          category: tx.inferredCategory || 'Other',
          notes: 'Batch approved',
          paymentMethod: tx.paymentMethod,
        });
        approvedIds.push(silverId);
      }
    }

    await repository.close();
    res.status(200).json({ status: 'approved', approvedIds });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to approve transactions in batch' });
  }
});

/**
 * [FUNC-GMAIL-12] Fetch pending staging transactions (legacy backup)
 */
router.get('/pending', async (req, res) => {
  const userId = (req as any).auth?.sub;
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    const pending = await repository.getPendingTransactions(userId);

    await repository.close();
    res.status(200).json({ pending });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch pending transactions' });
  }
});

export default router;
