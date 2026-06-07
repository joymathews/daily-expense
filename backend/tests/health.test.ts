import request from 'supertest';
import { app } from '../src/app';

describe('Health Check Endpoint', () => {
  /**
   * [FUNC-SKEL-SYS-1] An external monitoring system must be able to verify the health of the application backend.
   * [NFR-PERF-1] The backend must expose a GET /api/health endpoint returning {"status": "ok"}.
   */
  it('should return 200 OK and status ok', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
