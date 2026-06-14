import { ITransactionExtractor, ExtractedTransaction } from './transaction-extractor';

export class OllamaExtractor implements ITransactionExtractor {
  constructor(
    private modelName: string,
    private endpoint: string
  ) { }

  async extractTransaction(textBody: string): Promise<ExtractedTransaction | null> {
    const systemInstruction = `
You are a precise financial parser. Extract transaction details from the email text and return ONLY a valid JSON object matching this schema:
{
  "merchant": "string",
  "amount": number,
  "currency": "string",
  "date": "string",
  "category": "string",
  "description": "string",
  "paymentMethod": "string",
  "transactionType": "string"
}

Ensure:
- "amount" is a raw decimal number (e.g. 10.50). Do not prefix with currency symbols.
- "currency" is a 3-letter ISO code (e.g. "USD", "INR", "EUR").
- "date" is a standardized YYYY-MM-DD string.
- "paymentMethod" must identify the bank name (e.g., "HDFC", "ICICI", "SBI") and payment mode (e.g., "UPI", "NEFT", "Credit Card", "Rupay Credit Card") where available. The output should combine these details (e.g., "HDFC Credit Card", "SBI UPI", "ICICI NEFT", "HDFC Rupay Credit Card"). If you cannot confidently identify the payment method, return "Unknown".
- "transactionType" must be "refund" if the email indicates a refund, reversal, reversal of debit, credit received, chargeback, or purchase cancellation. Otherwise, it must be "expense".
- If any field cannot be found, set it to a default (e.g. category to "Other").
`;

    try {
      const response = await fetch(`${this.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: `Email Content:\n${textBody}` }
          ],
          format: 'json',
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API responded with status ${response.status}`);
      }

      const responseData = await response.json();
      const contentString = responseData.message?.content;
      if (!contentString) {
        return null;
      }

      const parsedJSON = JSON.parse(contentString.trim());

      // Enforce data checks
      return {
        merchant: parsedJSON.merchant || 'Unknown Merchant',
        amount: typeof parsedJSON.amount === 'number' ? parsedJSON.amount : parseFloat(parsedJSON.amount || '0'),
        currency: (parsedJSON.currency || 'USD').toUpperCase(),
        date: parsedJSON.date || new Date().toISOString().split('T')[0],
        category: parsedJSON.category || 'Other',
        description: parsedJSON.description || undefined,
        paymentMethod: parsedJSON.paymentMethod || 'Unknown',
        transactionType: parsedJSON.transactionType === 'refund' ? 'refund' : 'expense'
      };
    } catch (error) {
      console.error('Ollama extraction failed:', error);
      return null;
    }
  }
}
