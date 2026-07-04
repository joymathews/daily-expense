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
}

import { OllamaExtractor } from './ollama-extractor';

export class TransactionExtractorFactory {
  static createExtractor(): ITransactionExtractor {
    const provider = process.env.LLM_PROVIDER || 'ollama';

    if (provider === 'ollama') {
      const model = process.env.LLM_MODEL || 'qwen2.5-coder:7b';
      const endpoint = process.env.LLM_ENDPOINT || 'http://localhost:11434';
      return new OllamaExtractor(model, endpoint);
    }

    // Default to Ollama fallback
    return new OllamaExtractor('qwen2.5-coder:7b', 'http://localhost:11434');
  }
}
