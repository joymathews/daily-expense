export interface ExtractedTransaction {
  merchant: string;
  amount: number;
  currency: string;
  date: string; // ISO 8601 UTC string
  category: string;
  description?: string;
  paymentMethod?: string;
  transactionType?: 'expense' | 'refund' | 'transfer';
}

export interface ITransactionExtractor {
  extractTransaction(textBody: string, contextBlock?: string): Promise<ExtractedTransaction | null>;
  isAvailable(): Promise<boolean>;
}

import { RemoteHttpExtractor } from './remote-extractor';

export class TransactionExtractorFactory {
  static createExtractor(): ITransactionExtractor {
    const serviceUrl = process.env.LLM_EXTRACTION_SERVICE_URL || 'http://localhost:3002';
    const serviceSecret = process.env.LLM_EXTRACTION_SERVICE_SECRET || 'dev-internal-secret-key-123';
    return new RemoteHttpExtractor(serviceUrl, serviceSecret);
  }
}
