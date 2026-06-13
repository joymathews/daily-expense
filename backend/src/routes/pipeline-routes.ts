import { Router } from 'express';
import crypto from 'crypto';
import { SQLiteTransactionRepository } from '../db/sqlite-transaction-repository';
import { TransactionExtractorFactory } from '../services/transaction-extractor';

const router = Router();

/**
 * [FUNC-GMAIL-15], [FUNC-GMAIL-16] GET /api/pipeline/raw-inputs
 * Retrieves raw inputs (Bronze) with optional date filtering.
 */
router.get(['/raw-inputs', '/raw-emails'], async (req, res) => {
  const { startDate, endDate } = req.query;
  const userId = (req as any).auth?.sub;
  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    const inputs = await repository.getRawInputs(userId, {
      startDate: startDate as string,
      endDate: endDate as string,
    });

    await repository.close();
    res.status(200).json({ emails: inputs }); // key 'emails' kept for frontend backwards compatibility
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch raw inputs' });
  }
});

/**
 * [FUNC-GMAIL-8], [FUNC-GMAIL-10] PUT /api/pipeline/raw-inputs/:id
 * Updates raw input (Bronze) transactional classification status.
 */
router.put(['/raw-inputs/:id', '/raw-emails/:id'], async (req, res) => {
  const id = req.params.id as string;
  const { hasTransaction, status } = req.body;
  const userId = (req as any).auth?.sub;

  if (hasTransaction === undefined && status === undefined) {
    return res.status(400).json({ error: 'hasTransaction (boolean) or status (string) is required' });
  }

  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    // Check ownership
    const input = await repository.getRawInputById(id, userId);
    if (!input) {
      await repository.close();
      return res.status(404).json({ error: 'Raw input not found or unauthorized' });
    }

    if (hasTransaction !== undefined) {
      if (typeof hasTransaction !== 'boolean') {
        await repository.close();
        return res.status(400).json({ error: 'hasTransaction must be a boolean' });
      }
      await repository.updateRawInputClassification(id, userId, hasTransaction);
    }

    if (status !== undefined) {
      if (!['unprocessed', 'processed', 'rejected'].includes(status)) {
        await repository.close();
        return res.status(400).json({ error: "status must be 'unprocessed', 'processed', or 'rejected'" });
      }
      await repository.updateRawInputStatus(id, userId, status);
    }

    await repository.close();
    res.status(200).json({ status: 'updated' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update raw input' });
  }
});

/**
 * [FUNC-GMAIL-15], [FUNC-GMAIL-16] GET /api/pipeline/silver-transactions
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
 * [FUNC-GMAIL-15], [FUNC-GMAIL-16] GET /api/pipeline/gold-transactions
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
 * [FUNC-GMAIL-18] PUT /api/pipeline/silver-transactions/:id
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
 * [FUNC-GMAIL-18] PUT /api/pipeline/gold-transactions/:id
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
 * [FUNC-GMAIL-13] POST /api/pipeline/approve
 * Stage 3: Confirms a staging transaction and promotes it to the Gold ledger.
 */
router.post('/approve', async (req, res) => {
  const { silverId, merchant, amount, currency, date, category, notes, paymentMethod } = req.body;
  const userId = (req as any).auth?.sub;

  if (!silverId || !merchant || amount === undefined || !currency || !date || !paymentMethod) {
    return res.status(400).json({ error: 'All transaction details (silverId, merchant, amount, currency, date, paymentMethod) are required' });
  }

  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    await repository.promoteToTransaction(silverId, {
      id: crypto.randomUUID(),
      pendingTxId: silverId,
      userId,
      sourceType: 'email',
      merchant,
      amount: parseFloat(amount),
      currency,
      transactionDate: date,
      category: category || 'Other',
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
 * [FUNC-GMAIL-22] POST /api/pipeline/approve-batch
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
          sourceType: tx.sourceType || 'email',
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
 * [FUNC-GMAIL-17] POST /api/pipeline/extract
 * Stage 2: Synchronously extracts transaction details for single or batch raw inputs via Ollama LLM.
 */
router.post('/extract', async (req, res) => {
  const { rawEmailIds } = req.body; // key rawEmailIds kept for frontend compatibility
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
      const rawInput = await repository.getRawInputById(id, userId);
      if (!rawInput) {
        continue;
      }

      // Deduplication check
      const existingSilver = await repository.getSilverTransactionByInputId(id, userId);
      if (existingSilver) {
        results.push(existingSilver);
        continue;
      }

      const extracted = await extractor.extractTransaction(rawInput.rawBody);
      if (extracted) {
        const standardizedMethod = await repository.standardizePaymentMethod(userId, extracted.paymentMethod);
        const pendingTx = {
          id: crypto.randomUUID(),
          bronzeInputId: rawInput.id,
          userId,
          sourceType: rawInput.sourceType || 'email',
          merchantRaw: extracted.merchant,
          merchantNormalized: extracted.merchant,
          amount: extracted.amount,
          currency: extracted.currency,
          transactionDate: extracted.date,
          inferredCategory: extracted.category,
          confidenceScore: 0.95,
          status: 'pending' as const,
          paymentMethod: standardizedMethod,
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
 * [FUNC-CORE-2] POST /api/pipeline/add-transaction
 * Directly inserts manual validated transaction records into the Gold ledger.
 */
router.post('/add-transaction', async (req, res) => {
  const { merchant, amount, currency, transactionDate, category, paymentMethod, notes } = req.body;
  const userId = (req as any).auth?.sub;

  if (!merchant || amount === undefined || !transactionDate || !category || !paymentMethod) {
    return res.status(400).json({ error: 'merchant, amount, transactionDate, category, and paymentMethod are required' });
  }

  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    await repository.addDirectGoldTransaction({
      id: crypto.randomUUID(),
      userId,
      sourceType: 'manual',
      merchant,
      amount: numericAmount,
      currency: currency || 'INR',
      transactionDate,
      category,
      notes: notes || '',
      paymentMethod,
    });

    await repository.close();
    res.status(200).json({ status: 'added' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to add manual transaction' });
  }
});

/**
 * [FUNC-GMAIL-31] POST /api/pipeline/revert-to-silver
 * Reverts a Gold transaction back to Silver staging.
 */
router.post('/revert-to-silver', async (req, res) => {
  const { goldId } = req.body;
  const userId = (req as any).auth?.sub;

  if (!goldId) {
    return res.status(400).json({ error: 'goldId is required' });
  }

  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    await repository.revertGoldToSilver(userId, goldId);
    await repository.close();
    res.status(200).json({ status: 'reverted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Reversion failed' });
  }
});

/**
 * [FUNC-GMAIL-31] POST /api/pipeline/revert-to-bronze
 * Reverts a Silver staging transaction back to unprocessed Bronze raw input.
 */
router.post('/revert-to-bronze', async (req, res) => {
  const { silverId } = req.body;
  const userId = (req as any).auth?.sub;

  if (!silverId) {
    return res.status(400).json({ error: 'silverId is required' });
  }

  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    await repository.revertSilverToBronze(userId, silverId);
    await repository.close();
    res.status(200).json({ status: 'reverted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Reversion failed' });
  }
});

/**
 * [FUNC-GMAIL-31] POST /api/pipeline/delete
 * Soft deletes a Bronze raw input record.
 */
router.post('/delete', async (req, res) => {
  const { bronzeId } = req.body;
  const userId = (req as any).auth?.sub;

  if (!bronzeId) {
    return res.status(400).json({ error: 'bronzeId is required' });
  }

  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    await repository.deleteBronzeInput(userId, bronzeId);
    await repository.close();
    res.status(200).json({ status: 'deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Deletion failed' });
  }
});

/**
 * [FUNC-GMAIL-31] POST /api/pipeline/restore
 * Restores a soft-deleted Bronze raw input or Gold manual transaction.
 */
router.post('/restore', async (req, res) => {
  const { bronzeId, goldId } = req.body;
  const userId = (req as any).auth?.sub;

  if (!bronzeId && !goldId) {
    return res.status(400).json({ error: 'Either bronzeId or goldId is required' });
  }

  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    if (bronzeId) {
      await repository.restoreBronzeInput(userId, bronzeId);
    } else if (goldId) {
      await repository.restoreGoldTransaction(userId, goldId);
    }
    await repository.close();
    res.status(200).json({ status: 'restored' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Restoration failed' });
  }
});

/**
 * [FUNC-GMAIL-31] GET /api/pipeline/deleted
 * Retrieves all soft-deleted raw input records and deleted manual gold transactions.
 */
router.get('/deleted', async (req, res) => {
  const userId = (req as any).auth?.sub;

  try {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    const inputs = await repository.getDeletedRawInputs(userId);
    const goldTx = await repository.getDeletedGoldTransactions(userId);
    await repository.close();
    res.status(200).json({
      emails: inputs,
      silverTransactions: [],
      goldTransactions: goldTx
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch deleted records' });
  }
});

export default router;
