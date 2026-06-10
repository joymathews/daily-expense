import crypto from 'crypto';
import { ITransactionRepository } from '../db/transaction-repository';
import { ITransactionExtractor } from './transaction-extractor';

export class TransactionIngestionService {
  constructor(
    private repo: ITransactionRepository,
    private extractor: ITransactionExtractor
  ) {}

  /**
   * Process a single email: check duplicates, log raw (Bronze), extract staging transaction if transactional (Silver).
   */
  async processEmail(email: {
    id: string;
    sender: string;
    subject: string;
    snippet: string;
    rawBody: string;
    rawPayload: string;
    receivedAt: string;
    isTransactional: boolean;
  }): Promise<{ status: 'skipped' | 'ingested' | 'extracted'; extracted?: any }> {
    // 1. Deduplication check
    const exists = await this.repo.emailExists(email.id);
    if (exists) {
      return { status: 'skipped' };
    }

    // 2. Save raw email to the database (Bronze / Raw)
    await this.repo.saveRawEmail({
      id: email.id,
      sender: email.sender,
      subject: email.subject,
      snippet: email.snippet,
      rawBody: email.rawBody,
      rawPayload: email.rawPayload,
      receivedAt: email.receivedAt,
    });

    // 3. Extract transaction details if classified as transactional
    if (email.isTransactional) {
      const extracted = await this.extractor.extractTransaction(email.rawBody);
      if (extracted) {
        const pendingTx = {
          id: crypto.randomUUID(),
          rawEmailId: email.id,
          merchantRaw: extracted.merchant,
          merchantNormalized: extracted.merchant,
          amount: extracted.amount,
          currency: extracted.currency,
          transactionDate: extracted.date,
          inferredCategory: extracted.category,
          confidenceScore: 0.95,
          status: 'pending' as const,
        };
        await this.repo.savePendingTransaction(pendingTx);
        return { status: 'extracted', extracted: pendingTx };
      }
    }

    return { status: 'ingested' };
  }
}
