import { ITransactionExtractor, ExtractedTransaction } from './transaction-extractor';
import { logger } from '../utils/logger';

export class OllamaExtractor implements ITransactionExtractor {
  constructor(
    private modelName: string,
    private endpoint: string
  ) { }

  async extractTransaction(textBody: string, contextBlock: string = ''): Promise<ExtractedTransaction | null> {
    logger.debug(
      { model: this.modelName, endpoint: this.endpoint, emailLength: textBody.length },
      'Ollama extraction task started'
    );
    if (contextBlock) {
      logger.trace({ contextBlock }, 'Injecting few-shot feedback examples to LLM prompt');
    }

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
- "paymentMethod" must identify the bank name (e.g., "HDFC", "ICICI", "SBI", to find bank name scan the entire text) and payment mode (e.g., "UPI", "NEFT", "Credit Card", "Rupay Credit Card",to find payment method scan the entire text) where available. The output should combine these details (e.g., "HDFC Credit Card", "SBI UPI", "ICICI NEFT", "HDFC Rupay Credit Card"). If you cannot confidently identify the payment method, return "Unknown".
- "transactionType" must be "refund" if the email indicates a refund, reversal, reversal of debit, credit received, chargeback, or purchase cancellation. Otherwise, it must be "expense".
- "category" must represent the transaction type inferred from the overall text context. Map it to one of these standard categories:
  1. "Groceries" (e.g., supermarket receipts, Instamart, BigBasket, local grocery shopping)
  2. "Cabs & Transport" (e.g., Uber, Ola, Rapido, train/metro tickets)
  3. "Utilities" (e.g., cooking gas, electricity, water bills, building maintenance charges)
  4. "Internet & Telecom" (e.g., broadband internet recharge, mobile bills)
  5. "Entertainment Subscriptions" (e.g., Netflix, Amazon Prime, Spotify, YouTube Premium)
  6. "Cloud & Software Services" (e.g., AWS, Azure, software subscriptions, Medium premium, developer tools)
  7. "Shopping" (e.g., Amazon, Flipkart, clothes, electronics, retail shopping)
  8. "Restaurant & Dining" (e.g., dine-in restaurant receipts, coffee shops, bakeries)
  9. "Online Food Order" (e.g., Swiggy, Zomato, food delivery)
  10. "Medical & Healthcare" (e.g., pharmacy bills, hospital expenses, doctor consultations)
  11. "Other" (use as fallback if no category fits or context is unclear)
- If any field cannot be found, set it to a default.
`;

    // Prepend few-shot correction block when the feedback feature provides one.
    const fullSystemInstruction = contextBlock
      ? `${contextBlock}\n\n${systemInstruction}`
      : systemInstruction;

    logger.debug(
      { 
        systemPrompt: fullSystemInstruction, 
        userPrompt: `Email Content:\n${textBody}` 
      },
      'Sending chat completion request to Ollama LLM'
    );

    try {
      const response = await fetch(`${this.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          messages: [
            { role: 'system', content: fullSystemInstruction },
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
        logger.warn('Ollama returned empty message content');
        return null;
      }

      logger.info({ rawLlmResponse: contentString }, 'Received raw JSON response from Ollama LLM');

      const parsedJSON = JSON.parse(contentString.trim());

      const result: ExtractedTransaction = {
        merchant: parsedJSON.merchant || 'Unknown Merchant',
        amount: typeof parsedJSON.amount === 'number' ? parsedJSON.amount : parseFloat(parsedJSON.amount || '0'),
        currency: (parsedJSON.currency || 'USD').toUpperCase(),
        date: parsedJSON.date || new Date().toISOString().split('T')[0],
        category: parsedJSON.category || 'Other',
        description: parsedJSON.description || undefined,
        paymentMethod: parsedJSON.paymentMethod || 'Unknown',
        transactionType: parsedJSON.transactionType === 'refund' ? 'refund' : 'expense'
      };

      logger.info({ transaction: result }, 'Ollama transaction extraction completed successfully');
      return result;
    } catch (error) {
      logger.error({ error, emailSnippet: textBody.substring(0, 200) }, 'Ollama extraction failed');
      return null;
    }
  }
}
