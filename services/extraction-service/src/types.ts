export interface ExtractedTransaction {
  merchant: string;
  amount: number;
  currency: string;
  date: string; // YYYY-MM-DD
  category: string;
  description?: string;
  paymentMethod?: string;
  transactionType?: 'expense' | 'refund' | 'transfer';
}

export interface ExtractionRequest {
  textBody: string;
  contextBlock?: string;
}

export interface ExtractionResponse {
  success: boolean;
  transaction?: ExtractedTransaction;
  error?: string;
  metadata?: {
    provider: string;
    model: string;
    latencyMs: number;
  };
}

export interface ILLMProvider {
  name: string;
  extractTransaction(textBody: string, contextBlock?: string): Promise<ExtractedTransaction | null>;
}
