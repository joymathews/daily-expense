import { ILLMProvider, ExtractedTransaction } from '../types';
import { PromptBuilder } from '../prompt-builder';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export class AzureOpenAIProvider implements ILLMProvider {
  name = 'azure-openai';

  constructor(
    private endpoint: string,
    private apiKey: string,
    private deploymentName: string,
    private apiVersion: string = '2024-02-15-preview'
  ) {}

  async extractTransaction(textBody: string, contextBlock: string = ''): Promise<ExtractedTransaction | null> {
    const systemInstruction = PromptBuilder.buildSystemInstruction(contextBlock);
    const targetUrl = `${this.endpoint.replace(/\/$/, '')}/openai/deployments/${this.deploymentName}/chat/completions?api-version=${this.apiVersion}`;

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: `Email Content:\n${textBody}` }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1
        })
      });

      if (!response.ok) {
        throw new Error(`Azure OpenAI API responded with status ${response.status}`);
      }

      const responseData = await response.json();
      const contentString = responseData.choices?.[0]?.message?.content;
      if (!contentString) {
        logger.warn('Azure OpenAI returned empty content');
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
      logger.error({ error, emailSnippet: textBody.substring(0, 100) }, 'Azure OpenAI extraction failed');
      return null;
    }
  }
}
