import { ITransactionExtractor, ExtractedTransaction } from './transaction-extractor';
import { logger } from '../utils/logger';

export class RemoteHttpExtractor implements ITransactionExtractor {
  constructor(
    private serviceUrl: string,
    private serviceSecret: string
  ) {}

  async extractTransaction(textBody: string, contextBlock: string = ''): Promise<ExtractedTransaction | null> {
    logger.debug(
      { serviceUrl: this.serviceUrl, textLength: textBody.length },
      'Sending extraction request to Remote LLM Microservice'
    );

    try {
      const response = await fetch(`${this.serviceUrl.replace(/\/$/, '')}/api/v1/extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Service-Key': this.serviceSecret
        },
        body: JSON.stringify({ textBody, contextBlock })
      });

      if (!response.ok) {
        logger.error({ status: response.status }, 'Remote LLM Microservice returned error status');
        return null;
      }

      const data = await response.json();
      if (!data.success || !data.transaction) {
        logger.warn({ data }, 'Remote LLM Microservice response indicated failure or empty transaction');
        return null;
      }

      logger.info({ transaction: data.transaction, metadata: data.metadata }, 'Remote LLM extraction succeeded');
      return data.transaction;
    } catch (error) {
      logger.error({ error, serviceUrl: this.serviceUrl }, 'Failed to communicate with Remote LLM Microservice');
      return null;
    }
  }
}
