import request from 'supertest';
import { app } from '../src/app';
import { SQLiteTransactionRepository } from '../src/db/sqlite-transaction-repository';
import path from 'path';
import fs from 'fs';

describe('User Preferences API', () => {
  const testDbPath = path.resolve(__dirname, '../data/test_user_preferences.db');
  let originalDatabaseUrl: string | undefined;

  beforeAll(() => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    const dataDir = path.dirname(testDbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  });

  afterAll(async () => {
    if (originalDatabaseUrl) {
      process.env.DATABASE_URL = originalDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch (err) {
        // Ignore
      }
    }
  });

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch (err) {
        // Ignore
      }
    }
    process.env.DATABASE_URL = testDbPath;

    const repository = new SQLiteTransactionRepository(testDbPath);
    await repository.initializeSchema();
    await (repository as any).run("DELETE FROM user_preferences");
    await repository.close();
  });

  /**
   * [FUNC-ANALYSIS-1] User Settings Configuration:
   * Verification of GET and PUT operations for user preferences.
   * [NFR-ANALYSIS-1] Preference Ingress Performance:
   * Verification of API retrieval/updating.
   * [NFR-ANALYSIS-3] Settings Input Validation:
   * Validation of cycle start day and expected salary.
   */
  it('should get default user preferences if not configured yet', async () => {
    const res = await request(app)
      .get('/api/pipeline/user-preferences')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      billingCycleStartDay: 17,
      expectedSalary: 100000
    });
  });

  it('should support updating user preferences with valid settings', async () => {
    // 1. Update preferences
    const updateRes = await request(app)
      .put('/api/pipeline/user-preferences')
      .set('Authorization', 'Bearer valid-token')
      .send({ billingCycleStartDay: 5, expectedSalary: 75000 });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.status).toBe('updated');

    // 2. Retrieve to verify persistence
    const getRes = await request(app)
      .get('/api/pipeline/user-preferences')
      .set('Authorization', 'Bearer valid-token');

    expect(getRes.status).toBe(200);
    expect(getRes.body).toEqual({
      billingCycleStartDay: 5,
      expectedSalary: 75000
    });
  });

  it('should enforce user isolation for preferences', async () => {
    // Set preferences for user-a
    const updateResA = await request(app)
      .put('/api/pipeline/user-preferences')
      .set('Authorization', 'Bearer user-a-token')
      .send({ billingCycleStartDay: 10, expectedSalary: 50000 });
    expect(updateResA.status).toBe(200);

    // Set preferences for user-b
    const updateResB = await request(app)
      .put('/api/pipeline/user-preferences')
      .set('Authorization', 'Bearer user-b-token')
      .send({ billingCycleStartDay: 20, expectedSalary: 90000 });
    expect(updateResB.status).toBe(200);

    // Verify user-a preferences are isolated
    const getResA = await request(app)
      .get('/api/pipeline/user-preferences')
      .set('Authorization', 'Bearer user-a-token');
    expect(getResA.status).toBe(200);
    expect(getResA.body.expectedSalary).toBe(50000);
    expect(getResA.body.billingCycleStartDay).toBe(10);

    // Verify user-b preferences are isolated
    const getResB = await request(app)
      .get('/api/pipeline/user-preferences')
      .set('Authorization', 'Bearer user-b-token');
    expect(getResB.status).toBe(200);
    expect(getResB.body.expectedSalary).toBe(90000);
    expect(getResB.body.billingCycleStartDay).toBe(20);
  });

  it('should reject invalid billing cycle start days', async () => {
    // Start day < 1
    const resUnder = await request(app)
      .put('/api/pipeline/user-preferences')
      .set('Authorization', 'Bearer valid-token')
      .send({ billingCycleStartDay: 0, expectedSalary: 100000 });
    expect(resUnder.status).toBe(400);
    expect(resUnder.body.error).toContain('billingCycleStartDay');

    // Start day > 28
    const resOver = await request(app)
      .put('/api/pipeline/user-preferences')
      .set('Authorization', 'Bearer valid-token')
      .send({ billingCycleStartDay: 29, expectedSalary: 100000 });
    expect(resOver.status).toBe(400);
    expect(resOver.body.error).toContain('billingCycleStartDay');

    // Start day is not a number
    const resNan = await request(app)
      .put('/api/pipeline/user-preferences')
      .set('Authorization', 'Bearer valid-token')
      .send({ billingCycleStartDay: 'invalid', expectedSalary: 100000 });
    expect(resNan.status).toBe(400);
  });

  it('should reject invalid expected monthly salaries', async () => {
    // Negative salary
    const resNeg = await request(app)
      .put('/api/pipeline/user-preferences')
      .set('Authorization', 'Bearer valid-token')
      .send({ billingCycleStartDay: 17, expectedSalary: -500 });
    expect(resNeg.status).toBe(400);
    expect(resNeg.body.error).toContain('expectedSalary');

    // Zero salary
    const resZero = await request(app)
      .put('/api/pipeline/user-preferences')
      .set('Authorization', 'Bearer valid-token')
      .send({ billingCycleStartDay: 17, expectedSalary: 0 });
    expect(resZero.status).toBe(400);

    // Nan salary
    const resNan = await request(app)
      .put('/api/pipeline/user-preferences')
      .set('Authorization', 'Bearer valid-token')
      .send({ billingCycleStartDay: 17, expectedSalary: 'invalid' });
    expect(resNan.status).toBe(400);
  });
});
