import request from 'supertest';
import { app } from '../src/app';
import { SQLiteTransactionRepository } from '../src/db/sqlite-transaction-repository';
import path from 'path';
import fs from 'fs';
import { google } from 'googleapis';

jest.mock('googleapis', () => {
  const mList = jest.fn();
  const mGet = jest.fn();
  return {
    google: {
      auth: {
        OAuth2: jest.fn().mockImplementation(() => ({
          setCredentials: jest.fn(),
        })),
      },
      gmail: jest.fn().mockImplementation(() => ({
        users: {
          messages: {
            list: mList,
            get: mGet,
          },
        },
      })),
    },
  };
});

describe('Fetcher Emails Integration', () => {
  const testDbPath = path.resolve(__dirname, '../data/test_fetcher_emails.db');
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
    await (repository as any).run("DELETE FROM fetcher_emails");
    await repository.close();
  });

  /**
   * [FUNC-GMAIL-51] Persistent Fetcher Sender Emails:
   * Verification of GET, POST, and DELETE operations.
   */
  it('should support saving, getting, and deleting fetcher emails', async () => {
    // 1. Initially get should return empty array
    const getRes1 = await request(app)
      .get('/api/ingestion/fetcher-emails')
      .set('Authorization', 'Bearer valid-token');
    
    expect(getRes1.status).toBe(200);
    expect(getRes1.body.fetcherEmails).toEqual([]);

    // 2. Add an email
    const postRes1 = await request(app)
      .post('/api/ingestion/fetcher-emails')
      .set('Authorization', 'Bearer valid-token')
      .send({ email: 'billing@amazon.com' });
    
    expect(postRes1.status).toBe(201);
    expect(postRes1.body.fetcherEmail).toBe('billing@amazon.com');

    // 3. Add same email again -> should ignore/not duplicate
    const postRes2 = await request(app)
      .post('/api/ingestion/fetcher-emails')
      .set('Authorization', 'Bearer valid-token')
      .send({ email: 'BILLING@AMAZON.COM' }); // Case insensitivity / duplication
    
    expect(postRes2.status).toBe(201);

    // 4. Add another email
    await request(app)
      .post('/api/ingestion/fetcher-emails')
      .set('Authorization', 'Bearer valid-token')
      .send({ email: 'uber@uber.com' });

    // 5. Get list -> should return sorted unique emails
    const getRes2 = await request(app)
      .get('/api/ingestion/fetcher-emails')
      .set('Authorization', 'Bearer valid-token');
    
    expect(getRes2.status).toBe(200);
    expect(getRes2.body.fetcherEmails).toEqual(['billing@amazon.com', 'uber@uber.com']);

    // 6. Delete one email
    const deleteRes = await request(app)
      .delete('/api/ingestion/fetcher-emails/billing@amazon.com')
      .set('Authorization', 'Bearer valid-token');
    
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.message).toContain('deleted');

    // 7. Get list again -> should have only uber
    const getRes3 = await request(app)
      .get('/api/ingestion/fetcher-emails')
      .set('Authorization', 'Bearer valid-token');
    
    expect(getRes3.status).toBe(200);
    expect(getRes3.body.fetcherEmails).toEqual(['uber@uber.com']);
  });

  /**
   * [FUNC-GMAIL-51] Persistent Fetcher Sender Emails / [NFR-SEC-5] Data Segregation
   * Tests database boundaries to ensure user isolation is strictly enforced.
   */
  it('should enforce user isolation for fetcher emails', async () => {
    // 1. Save email under user 'user-1'
    const repository = new SQLiteTransactionRepository(testDbPath);
    await repository.initializeSchema();
    await repository.saveFetcherEmail('user-1', 'sender@user1.com');
    await repository.saveFetcherEmail('user-2', 'sender@user2.com');
    await repository.close();

    // 2. Fetch list using token matching 'user-1' (in mocks or default request token sub)
    // Note: checkJwt mock maps 'Bearer valid-token' to sub: 'user-123' if not specified, let's verify checking route with sub
    // In our JWT validation middleware, it reads req.auth.sub.
    // Let's verify.
    const resUser = await request(app)
      .get('/api/ingestion/fetcher-emails')
      .set('Authorization', 'Bearer valid-token'); // valid-token has req.auth.sub = 'user-123' or 'testuser' depending on test-jwt-setup

    expect(resUser.status).toBe(200);
    // Since request has different user id, it shouldn't see 'user-1' or 'user-2' emails
    expect(resUser.body.fetcherEmails).toEqual([]);
  });

  /**
   * [FUNC-GMAIL-51] / [NFR-SEC-4] Input Validation:
   * Verify invalid email format is rejected.
   */
  it('should reject invalid email formats', async () => {
    const res = await request(app)
      .post('/api/ingestion/fetcher-emails')
      .set('Authorization', 'Bearer valid-token')
      .send({ email: 'not-an-email' });
    
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('format');
  });

  /**
   * [FUNC-GMAIL-51] Persistent Fetcher Sender Emails:
   * Auto-save senders during fetch and fetch-list trigger.
   */
  it('should automatically save sender email targets in DB when fetching or listing emails', async () => {
    const gmail = google.gmail('v1');
    (gmail.users.messages.list as jest.Mock).mockResolvedValue({
      data: { messages: [] }
    });

    const fetchListRes = await request(app)
      .post('/api/ingestion/gmail/fetch-list')
      .set('Authorization', 'Bearer valid-token')
      .send({
        accessToken: 'mock-token',
        filters: {
          sender: ['auto-saved@fetch.com'],
          startDate: '2023-01-01',
          endDate: '2023-01-31'
        }
      });

    expect(fetchListRes.status).toBe(200);

    // Verify it is saved in database and returned in GET list
    const getRes = await request(app)
      .get('/api/ingestion/fetcher-emails')
      .set('Authorization', 'Bearer valid-token');

    expect(getRes.status).toBe(200);
    expect(getRes.body.fetcherEmails).toContain('auto-saved@fetch.com');
  });
});
