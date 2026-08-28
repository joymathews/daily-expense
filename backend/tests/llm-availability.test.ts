import request from 'supertest';
import { app } from '../src/app';
import { RemoteHttpExtractor } from '../src/services/remote-extractor';

describe('LLM Service Availability & Health Probing [FUNC-GMAIL-56] [NFR-LLM-4]', () => {
  const serviceUrl = 'http://localhost:3002';
  const serviceSecret = 'dev-internal-secret-key-123';
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('RemoteHttpExtractor.isAvailable() should return true when /health responds 200 OK', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200
    } as any);

    const extractor = new RemoteHttpExtractor(serviceUrl, serviceSecret);
    const available = await extractor.isAvailable();
    expect(available).toBe(true);
  });

  it('RemoteHttpExtractor.isAvailable() should return false when service connection throws error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const extractor = new RemoteHttpExtractor(serviceUrl, serviceSecret);
    const available = await extractor.isAvailable();
    expect(available).toBe(false);
  });

  it('GET /api/pipeline/llm-status should return 503 when LLM microservice is offline', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const response = await request(app)
      .get('/api/pipeline/llm-status')
      .set('Authorization', 'Bearer valid-token');
    expect(response.status).toBe(503);
    expect(response.body).toEqual(
      expect.objectContaining({
        available: false,
        code: 'LLM_SERVICE_UNAVAILABLE'
      })
    );
  });

  it('POST /api/pipeline/extract should return 503 Service Unavailable when LLM service is offline', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const response = await request(app)
      .post('/api/pipeline/extract')
      .set('Authorization', 'Bearer valid-token')
      .send({ rawEmailIds: ['raw-input-123'] });

    expect(response.status).toBe(503);
    expect(response.body).toEqual(
      expect.objectContaining({
        code: 'LLM_SERVICE_UNAVAILABLE',
        error: expect.stringContaining('LLM extraction service is unavailable')
      })
    );
  });
});
