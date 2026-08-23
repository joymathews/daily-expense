import { ILLMProvider, ExtractedTransaction } from '../types';
import { PromptBuilder } from '../prompt-builder';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export class OllamaProvider implements ILLMProvider {
  name = 'ollama';

  constructor(
    private endpoint: string,
    private modelName: string
  ) {}

  async extractTransaction(textBody: string, contextBlock: string = ''): Promise<ExtractedTransaction | null> {
    const systemInstruction = PromptBuilder.buildSystemInstruction(contextBlock);

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
        logger.warn('Ollama returned empty message content');
        return null;
      }

      const parsedJSON = JSON.parse(contentString.trim());

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
      logger.error({ error, emailSnippet: textBody.substring(0, 100) }, 'Ollama extraction failed');
      return null;
    }
  }
}
