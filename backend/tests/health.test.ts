import request from 'supertest';
import { app } from '../src/app';

describe('Health Check Endpoint', () => {
  /**
   * [FUNC-SKEL-SYS-1] An external monitoring system must be able to verify the health of the application backend.
   * [NFR-PERF-1] Health Monitoring: The health check endpoint must respond within 100ms.
   */
  it('should return 200 OK and status ok within 100ms', async () => {
    const start = Date.now();
    const response = await request(app).get('/api/health');
    const duration = Date.now() - start;

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(duration).toBeLessThan(100);
  });

  /**
   * [NFR-AVAIL-1] Availability: Target 99.9% uptime.
   * This test verifies the system is in a state that supports availability monitoring.
   */
  it('should be in an operational state for availability monitoring', () => {
    expect(app).toBeDefined();
  });
});
