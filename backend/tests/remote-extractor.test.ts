import { RemoteHttpExtractor } from '../src/services/remote-extractor';
import { TransactionExtractorFactory } from '../src/services/transaction-extractor';

describe('RemoteHttpExtractor Unit Tests', () => {
  const serviceUrl = 'http://localhost:3002';
  const serviceSecret = 'dev-internal-secret-key-123';
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should instantiate RemoteHttpExtractor when LLM_EXTRACTION_MODE is remote', () => {
    process.env.LLM_EXTRACTION_MODE = 'remote';
    const extractor = TransactionExtractorFactory.createExtractor();
    expect(extractor.constructor.name).toBe('RemoteHttpExtractor');
  });

  it('should send POST request with X-Internal-Service-Key and return transaction object on success', async () => {
    const mockTransaction = {
      merchant: 'Uber Inc',
      amount: 14.5,
      currency: 'USD',
      date: '2026-06-12',
      category: 'Cabs & Transport',
      paymentMethod: 'HDFC Credit Card',
      transactionType: 'expense'
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        success: true,
        transaction: mockTransaction
      })
    } as any);

    const extractor = new RemoteHttpExtractor(serviceUrl, serviceSecret);
    const result = await extractor.extractTransaction('Your payment of $14.50 to Uber was successful');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3002/api/v1/extract',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Service-Key': serviceSecret
        },
        body: JSON.stringify({
          textBody: 'Your payment of $14.50 to Uber was successful',
          contextBlock: ''
        })
      })
    );

    expect(result).toEqual(mockTransaction);
  });

  it('should return null if remote service returns error status', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500
    } as any);

    const extractor = new RemoteHttpExtractor(serviceUrl, serviceSecret);
    const result = await extractor.extractTransaction('Bad payload');

    expect(result).toBeNull();
  });
});
