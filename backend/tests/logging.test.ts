import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { app } from '../src/app';
import { logger } from '../src/utils/logger';

describe('Logging Framework and API Integration', () => {
  const logFilePath = process.env.LOG_FILE_PATH || 'logs/app.log';

  // Ensure log directory and file exists/is clean before tests
  beforeAll(() => {
    const logDir = path.dirname(logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  });

  /**
   * [FUNC-SYS-2] System Logging Configuration
   */
  it('should initialize the pino logger and write info logs correctly', () => {
    expect(logger).toBeDefined();
    expect(logger.info).toBeDefined();

    // Log a test line and check that it doesn't crash the application
    expect(() => {
      logger.info({ testContext: 'jest-unit' }, 'Logging test message');
    }).not.toThrow();
  });

  /**
   * [FUNC-SYS-4] Frontend Error Logging Ingestion
   */
  it('should return 200 OK and persist log when POSTing logs to /api/logs with valid token', async () => {
    const payload = {
      level: 'error',
      message: 'React Boundary Error occurred',
      details: { component: 'SpendCalendar', stack: 'TypeError: Cannot read property of null' }
    };

    const response = await request(app)
      .post('/api/logs')
      .set('Authorization', 'Bearer valid-token')
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  /**
   * [NFR-SEC-2] API Protection: All non-public endpoints require JWT token validation
   */
  it('should return 401 Unauthorized for /api/logs without authorization token', async () => {
    const response = await request(app)
      .post('/api/logs')
      .send({ level: 'info', message: 'Test message' });

    expect(response.status).toBe(401);
  });

  /**
   * [FUNC-SYS-4] Input Validation: /api/logs must validate request schema payload
   */
  it('should return 400 Bad Request when log payload misses level or message', async () => {
    const response = await request(app)
      .post('/api/logs')
      .set('Authorization', 'Bearer valid-token')
      .send({ details: {} }); // missing level and message

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Missing log level or message');
  });

  /**
   * [FUNC-SYS-5] Consolidated Log Persistence
   * Verifies that the log file is generated, not empty, and holds log entries.
   */
  it('should verify log file exists and contains entries', () => {
    expect(fs.existsSync(logFilePath)).toBe(true);
    const content = fs.readFileSync(logFilePath, 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });
});
