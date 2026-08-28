import request from 'supertest';
import app from '../src/server';

describe('LLM Extraction Service API', () => {
  const serviceSecret = 'dev-internal-secret-key-123';

  it('GET /health - should return healthy status without requiring authentication', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.service).toBe('llm-extraction-service');
  });

  it('POST /api/v1/extract - should reject request without internal service key with 401', async () => {
    const res = await request(app)
      .post('/api/v1/extract')
      .send({ textBody: 'Payment of $10 to Uber' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Unauthorized');
  });

  it('POST /api/v1/extract - should return 400 if textBody is missing', async () => {
    const res = await request(app)
      .post('/api/v1/extract')
      .set('X-Internal-Service-Key', serviceSecret)
      .send({ textBody: '' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
