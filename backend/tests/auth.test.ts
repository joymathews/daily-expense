import request from 'supertest';
import { app } from '../src/app';

describe('Authentication Middleware', () => {
  /**
   * [FUNC-AUTH-2] The system must remain inaccessible to unauthenticated users.
   * [NFR-ARCH-4] API Security: Validate AWS Cognito JWT.
   */
  it('should return 401 Unauthorized for /api/private without a token', async () => {
    const response = await request(app).get('/api/private');
    expect(response.status).toBe(401);
  });

  it('should return 200 OK for /api/private with a valid-token (mocked)', async () => {
    const response = await request(app)
      .get('/api/private')
      .set('Authorization', 'Bearer valid-token');
    expect(response.status).toBe(200);
    expect(response.body.message).toContain('private route');
  });

  /**
   * [FUNC-SKEL-SYS-1] Health-check endpoint should remain public.
   */
  it('should return 200 OK for /api/health (public route)', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
  });
});
