import request from 'supertest';
import { app } from '../src/app';
import { google } from 'googleapis';
import { SQLiteTransactionRepository } from '../src/db/sqlite-transaction-repository';
import path from 'path';
import fs from 'fs';

// Mock googleapis
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

describe('Gmail API Integration', () => {
  const gmail = google.gmail('v1');
  const testDbPath = path.resolve(__dirname, '../data/test_gmail.db');
  let originalDatabaseUrl: string | undefined;

  beforeAll(() => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    // Create data directory if it does not exist
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
        // Ignore errors unlinking test db
      }
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch (err) {
        // Ignore errors unlinking test db
      }
    }
    process.env.DATABASE_URL = testDbPath;

    const { SQLiteTransactionRepository } = require('../src/db/sqlite-transaction-repository');
    const repository = new SQLiteTransactionRepository(testDbPath);
    await repository.initializeSchema();
    await (repository as any).run("DELETE FROM gold_transactions WHERE silver_tx_id IN ('del_silver_1', 'validation_test_silver_1', 'approve_test_silver_1', 'approve_test_silver_2') OR id IN ('del_gold_1', 'validation_test_gold_1', 'approve_test_gold_1')");
    await (repository as any).run("DELETE FROM silver_extracted_transactions WHERE id IN ('del_silver_1', 'validation_test_silver_1', 'approve_test_silver_1', 'approve_test_silver_2')");
    await (repository as any).run("DELETE FROM bronze_raw_inputs WHERE id IN ('detail_msg_1', 'test_raw_tx_1', 'test_raw_otp_1', 'del_bronze_1')");
    await (repository as any).run("DELETE FROM payment_mapping_rules");
    await (repository as any).run("DELETE FROM payment_methods");
    await (repository as any).run("DELETE FROM user_preferences");
    await repository.close();
  });

  /**
   * [FUNC-GMAIL-4] The system must display fetched emails.
   * [FUNC-GMAIL-2] Configuration: filters for multi-sender, start date, and end date.
   * This backend test verifies the fetch route correctly interacts with Gmail API mocks.
   */
  it('should fetch and format emails from Gmail with multi-sender and date range', async () => {
    // Mock list response
    (gmail.users.messages.list as jest.Mock).mockResolvedValue({
      data: { messages: [{ id: 'msg1' }] }
    });

    // Mock get response
    (gmail.users.messages.get as jest.Mock).mockResolvedValue({
      data: {
        id: 'msg1',
        snippet: 'Test Snippet',
        payload: {
          headers: [
            { name: 'From', value: 'sender@test.com' },
            { name: 'Subject', value: 'Test Subject' },
            { name: 'Date', value: '2023-01-01' }
          ]
        }
      }
    });

    const response = await request(app)
      .post('/api/gmail/fetch')
      .set('Authorization', 'Bearer valid-token')
      .send({
        accessToken: 'mock-token',
        filters: { 
          sender: ['test@example.com', 'receipts@store.com'], 
          startDate: '2023-01-01', 
          endDate: '2023-01-31', 
          subject: 'receipt' 
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.emails).toHaveLength(1);
    
    // Verify query construction (internal check)
    expect(gmail.users.messages.list).toHaveBeenCalledWith(expect.objectContaining({
      q: expect.stringContaining('(from:test@example.com OR from:receipts@store.com)')
    }));
    expect(gmail.users.messages.list).toHaveBeenCalledWith(expect.objectContaining({
      q: expect.stringContaining('after:2023/01/01')
    }));
    expect(gmail.users.messages.list).toHaveBeenCalledWith(expect.objectContaining({
      q: expect.stringContaining('before:2023/01/31')
    }));
  });

  /**
   * [FUNC-GMAIL-5] Pagination: Retrieve all emails across multiple pages.
   * [NFR-PERF-3] Data Processing: Handle pagination efficiently.
   */
  it('should fetch all emails across multiple pages using pagination', async () => {
    // Mock 1st page response with token
    (gmail.users.messages.list as jest.Mock)
      .mockResolvedValueOnce({
        data: { 
          messages: [{ id: 'page1-msg1' }], 
          nextPageToken: 'token-for-page-2' 
        }
      })
      // Mock 2nd page response without token
      .mockResolvedValueOnce({
        data: { 
          messages: [{ id: 'page2-msg1' }] 
        }
      });

    // Mock individual get calls
    (gmail.users.messages.get as jest.Mock).mockImplementation(({ id }) => {
      return Promise.resolve({
        data: {
          id,
          snippet: `Snippet for ${id}`,
          payload: {
            headers: [
              { name: 'From', value: 'sender@test.com' },
              { name: 'Subject', value: `Subject for ${id}` },
              { name: 'Date', value: '2023-01-01' }
            ]
          }
        }
      });
    });

    const response = await request(app)
      .post('/api/gmail/fetch')
      .set('Authorization', 'Bearer valid-token')
      .send({
        accessToken: 'mock-token',
        filters: { 
          sender: ['test@example.com'], 
          startDate: '2023-01-01', 
          endDate: '2023-01-31' 
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.emails).toHaveLength(2);
    expect(response.body.emails[0].id).toBe('page1-msg1');
    expect(response.body.emails[1].id).toBe('page2-msg1');
    
    // Verify list called twice
    expect(gmail.users.messages.list).toHaveBeenCalledTimes(2);
    expect(gmail.users.messages.list).toHaveBeenNthCalledWith(1, expect.objectContaining({ pageToken: undefined }));
    expect(gmail.users.messages.list).toHaveBeenLastCalledWith(expect.objectContaining({ pageToken: 'token-for-page-2' }));
  });

  /**
   * [NFR-SEC-4] Input Validation: Ensure mandatory fields are present.
   */
  it('should return 400 if sender list is empty or missing', async () => {
    const response = await request(app)
      .post('/api/gmail/fetch')
      .set('Authorization', 'Bearer valid-token')
      .send({ 
        accessToken: 'mock-token',
        filters: { sender: [], startDate: '2023-01-01', endDate: '2023-01-31' } 
      });
    
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('sender');
  });

  /**
   * [NFR-SEC-4] Input Validation: Ensure date range is present.
   */
  it('should return 400 if date range is missing', async () => {
    const response = await request(app)
      .post('/api/gmail/fetch')
      .set('Authorization', 'Bearer valid-token')
      .send({ 
        accessToken: 'mock-token',
        filters: { sender: ['test@example.com'] } 
      });
    
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/start.*end.*required/i);
  });

  it('should return 400 if accessToken is missing', async () => {
    const response = await request(app)
      .post('/api/gmail/fetch')
      .set('Authorization', 'Bearer valid-token')
      .send({ filters: {} });
    
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('required');
  });

  /**
   * [FUNC-GMAIL-6] Email Segregation: Analyze subject/snippet and mark transactional emails.
   * [NFR-GMAIL-2] Classification Performance: Categorization is run locally with keyword checking.
   */
  it('correctly categorizes emails as transactional by default, and non-transactional if subject contains OTP', async () => {
    const { GmailService } = require('../src/services/gmail-service');
    const service = new GmailService();
    
    // Transactional (subject does NOT contain OTP)
    expect(service.isTransaction('Your payment receipt', 'Hello user')).toBe(true);
    expect(service.isTransaction('Weekly sync meeting', 'Let us discuss our project milestones next Monday')).toBe(true);
    expect(service.isTransaction('Hello', 'You spent $10.00')).toBe(true);
    
    // Non-transactional (subject contains OTP)
    expect(service.isTransaction('OTP for transaction', 'You spent $10.00')).toBe(false);
    expect(service.isTransaction('Your otp code', 'Payment of rs. 500 is pending')).toBe(false);
  });

  /**
   * [FUNC-GMAIL-9] Email Detail View: Decodes base64 body content and strips HTML tags.
   */
  it('correctly decodes and sanitizes full email body', () => {
    const { GmailService } = require('../src/services/gmail-service');
    const service = new GmailService();
    
    // Test plain text part decoding
    const plainPayload = {
      mimeType: 'text/plain',
      body: {
        data: Buffer.from('Hello plain text world').toString('base64')
      }
    };
    expect(service.extractBody(plainPayload)).toBe('Hello plain text world');

    // Test HTML text part decoding and tag stripping
    const htmlPayload = {
      mimeType: 'text/html',
      body: {
        data: Buffer.from('<div>Hello <style>body{}</style><script>alert()</script>HTML <b>world</b></div>').toString('base64')
      }
    };
    expect(service.extractBody(htmlPayload)).toBe('Hello HTML world');

    // Test nested parts recursion
    const nestedPayload = {
      parts: [
        {
          mimeType: 'text/html',
          body: {
            data: Buffer.from('<p>Alternative HTML</p>').toString('base64')
          }
        },
        {
          mimeType: 'text/plain',
          body: {
            data: Buffer.from('Alternative plain text').toString('base64')
          }
        }
      ]
    };
    // Should prefer plain text part
    expect(service.extractBody(nestedPayload)).toBe('Alternative plain text');
  });

  /**
   * [FUNC-GMAIL-27] Ingestion Progress Tracking
   * Test verifies matching message IDs are fetched and individual detail fetch saves to Bronze raw.
   */
  it('should list message IDs and fetch detail for single message id, then save to db', async () => {
    // Mock list response
    (gmail.users.messages.list as jest.Mock).mockResolvedValue({
      data: { messages: [{ id: 'detail_msg_1' }] }
    });

    // Mock get response
    (gmail.users.messages.get as jest.Mock).mockResolvedValue({
      data: {
        id: 'detail_msg_1',
        snippet: 'Test Snippet',
        payload: {
          headers: [
            { name: 'From', value: 'sender@test.com' },
            { name: 'Subject', value: 'Test Subject' },
            { name: 'Date', value: '2023-01-01' }
          ]
        }
      }
    });

    // Test /api/gmail/fetch-list
    const listRes = await request(app)
      .post('/api/gmail/fetch-list')
      .set('Authorization', 'Bearer valid-token')
      .send({
        accessToken: 'mock-token',
        filters: { 
          sender: ['test@example.com'], 
          startDate: '2023-01-01', 
          endDate: '2023-01-31'
        }
      });

    expect(listRes.status).toBe(200);
    expect(listRes.body.messageIds).toEqual(['detail_msg_1']);

    // Test /api/gmail/fetch-detail
    const detailRes = await request(app)
      .post('/api/gmail/fetch-detail')
      .set('Authorization', 'Bearer valid-token')
      .send({
        accessToken: 'mock-token',
        messageId: 'detail_msg_1'
      });

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.status).toBe('fetched');
    expect(detailRes.body.email.id).toBe('detail_msg_1');
    expect(detailRes.body.email.subject).toBe('Test Subject');
  });

  /**
   * [BUG-002] Ingestion Status Persistence: Verify raw-emails endpoint returns hasTransaction correctly.
   * [BUG-003] ISO Date Normalization: Verify receivedAt ISO string normalization inside saveRawInput.
   */
  it('should return raw emails with hasTransaction derived correctly from payload/subject', async () => {
    const { SQLiteTransactionRepository } = require('../src/db/sqlite-transaction-repository');
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    await repository.saveRawInput({
      id: 'test_raw_tx_1',
      userId: 'user-123',
      sourceType: 'email',
      sender: 'store@shop.com',
      title: 'Order Receipt',
      snippet: 'Thanks for spending money',
      rawBody: 'Full email body',
      rawPayload: JSON.stringify({ id: 'test_raw_tx_1', hasTransaction: true }),
      receivedAt: '2023-01-10T10:00:00Z',
    });

    await repository.saveRawInput({
      id: 'test_raw_otp_1',
      userId: 'user-123',
      sourceType: 'email',
      sender: 'bank@auth.com',
      title: 'Your OTP Code',
      snippet: 'OTP is 123456',
      rawBody: 'Do not share',
      rawPayload: JSON.stringify({ id: 'test_raw_otp_1' }),
      receivedAt: '2023-01-11T10:00:00Z',
    });
    await repository.close();

    const response = await request(app)
      .get('/api/gmail/raw-emails')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(200);
    expect(response.body.emails).toBeDefined();
    
    const txEmail = response.body.emails.find((e: any) => e.id === 'test_raw_tx_1');
    const otpEmail = response.body.emails.find((e: any) => e.id === 'test_raw_otp_1');

    expect(txEmail).toBeDefined();
    expect(txEmail.hasTransaction).toBe(true);

    expect(otpEmail).toBeDefined();
    expect(otpEmail.hasTransaction).toBe(false);
  });

  /**
   * [BUG-002] Ingestion Status Persistence: Verify PUT raw-emails endpoint updates hasTransaction correctly.
   */
  it('should update raw email transactional classification status successfully', async () => {
    const { SQLiteTransactionRepository } = require('../src/db/sqlite-transaction-repository');
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    await repository.saveRawInput({
      id: 'test_raw_tx_1',
      userId: 'user-123',
      sourceType: 'email',
      sender: 'store@shop.com',
      title: 'Order Receipt',
      snippet: 'Thanks for spending money',
      rawBody: 'Full email body',
      rawPayload: JSON.stringify({ id: 'test_raw_tx_1', hasTransaction: true }),
      receivedAt: '2023-01-10T10:00:00Z',
    });
    await repository.close();

    // Perform PUT update to hasTransaction = false
    const updateRes = await request(app)
      .put('/api/gmail/raw-emails/test_raw_tx_1')
      .set('Authorization', 'Bearer valid-token')
      .send({ hasTransaction: false });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.status).toBe('updated');

    // Fetch raw email again and verify it is updated in database
    const fetchRes = await request(app)
      .get('/api/gmail/raw-emails')
      .set('Authorization', 'Bearer valid-token');

    const email = fetchRes.body.emails.find((e: any) => e.id === 'test_raw_tx_1');
    expect(email).toBeDefined();
    expect(email.hasTransaction).toBe(false);
  });

  /**
   * [FUNC-GMAIL-31] Pipeline Reversion & Raw Email Deletion: Verify revert-to-silver, revert-to-bronze, delete/restore Bronze.
   */
  it('should support reverting Gold to Silver, reverting Silver to Bronze, and soft deleting/restoring Bronze emails', async () => {
    const { SQLiteTransactionRepository } = require('../src/db/sqlite-transaction-repository');
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    // 1. Seed active records in Bronze, Silver, Gold
    await repository.saveRawInput({
      id: 'del_bronze_1',
      userId: 'user-123',
      sourceType: 'email',
      sender: 'sender@del.com',
      title: 'Raw Del Test',
      snippet: 'Raw text snippet',
      rawBody: 'Full email body',
      rawPayload: '{}',
      receivedAt: '2023-01-10T10:00:00Z',
    });

    await repository.savePendingTransaction({
      id: 'del_silver_1',
      bronzeInputId: 'del_bronze_1',
      userId: 'user-123',
      sourceType: 'email',
      merchantRaw: 'Del Merchant',
      amount: 45.99,
      currency: 'USD',
      transactionDate: '2023-01-10',
      status: 'pending',
      paymentMethod: 'Credit Card',
    });

    await repository.promoteToTransaction('del_silver_1', {
      id: 'del_gold_1',
      pendingTxId: 'del_silver_1',
      userId: 'user-123',
      sourceType: 'email',
      merchant: 'Del Merchant Approved',
      amount: 45.99,
      currency: 'USD',
      transactionDate: '2023-01-10',
      category: 'Food',
      paymentMethod: 'Credit Card',
    });

    await repository.close();

    // 2. Verify all are currently active and not deleted
    const initialEmailsRes = await request(app).get('/api/gmail/raw-emails').set('Authorization', 'Bearer valid-token');
    const initialSilverRes = await request(app).get('/api/gmail/silver-transactions').set('Authorization', 'Bearer valid-token');
    const initialGoldRes = await request(app).get('/api/gmail/gold-transactions').set('Authorization', 'Bearer valid-token');

    expect(initialEmailsRes.body.emails.some((e: any) => e.id === 'del_bronze_1')).toBe(true);
    expect(initialSilverRes.body.transactions.some((t: any) => t.id === 'del_silver_1')).toBe(true);
    expect(initialGoldRes.body.transactions.some((t: any) => t.id === 'del_gold_1')).toBe(true);

    // 3. Revert Gold to Silver
    const revertGoldRes = await request(app)
      .post('/api/gmail/revert-to-silver')
      .set('Authorization', 'Bearer valid-token')
      .send({ goldId: 'del_gold_1' });

    expect(revertGoldRes.status).toBe(200);
    expect(revertGoldRes.body.status).toBe('reverted');

    // Verify Gold is gone, Silver is still active
    const postRevertGoldRes = await request(app).get('/api/gmail/gold-transactions').set('Authorization', 'Bearer valid-token');
    const postRevertSilverRes = await request(app).get('/api/gmail/silver-transactions').set('Authorization', 'Bearer valid-token');
    expect(postRevertGoldRes.body.transactions.some((t: any) => t.id === 'del_gold_1')).toBe(false);
    expect(postRevertSilverRes.body.transactions.some((t: any) => t.id === 'del_silver_1')).toBe(true);

    // 4. Revert Silver to Bronze
    const revertSilverRes = await request(app)
      .post('/api/gmail/revert-to-bronze')
      .set('Authorization', 'Bearer valid-token')
      .send({ silverId: 'del_silver_1' });

    expect(revertSilverRes.status).toBe(200);
    expect(revertSilverRes.body.status).toBe('reverted');

    // Verify Silver is gone, Bronze is still active
    const postRevertSilverRes2 = await request(app).get('/api/gmail/silver-transactions').set('Authorization', 'Bearer valid-token');
    const postRevertBronzeRes = await request(app).get('/api/gmail/raw-emails').set('Authorization', 'Bearer valid-token');
    expect(postRevertSilverRes2.body.transactions.some((t: any) => t.id === 'del_silver_1')).toBe(false);
    expect(postRevertBronzeRes.body.emails.some((e: any) => e.id === 'del_bronze_1')).toBe(true);

    // 5. Soft-delete Bronze
    const deleteBronzeRes = await request(app)
      .post('/api/gmail/delete')
      .set('Authorization', 'Bearer valid-token')
      .send({ bronzeId: 'del_bronze_1' });

    expect(deleteBronzeRes.status).toBe(200);
    expect(deleteBronzeRes.body.status).toBe('deleted');

    // Verify Bronze is excluded from active, but exists in deleted
    const activeEmailsRes = await request(app).get('/api/gmail/raw-emails').set('Authorization', 'Bearer valid-token');
    const deletedRes = await request(app).get('/api/gmail/deleted').set('Authorization', 'Bearer valid-token');
    expect(activeEmailsRes.body.emails.some((e: any) => e.id === 'del_bronze_1')).toBe(false);
    expect(deletedRes.body.emails.some((e: any) => e.id === 'del_bronze_1')).toBe(true);

    // 6. Restore Bronze
    const restoreBronzeRes = await request(app)
      .post('/api/gmail/restore')
      .set('Authorization', 'Bearer valid-token')
      .send({ bronzeId: 'del_bronze_1' });

    expect(restoreBronzeRes.status).toBe(200);
    expect(restoreBronzeRes.body.status).toBe('restored');

    // Verify Bronze is active again
    const activeEmailsRes2 = await request(app).get('/api/gmail/raw-emails').set('Authorization', 'Bearer valid-token');
    expect(activeEmailsRes2.body.emails.some((e: any) => e.id === 'del_bronze_1')).toBe(true);
  });

  /**
   * [FUNC-GMAIL-32] Staging Validation & Error Status:
   * Verify missing required fields results in 'error' status upon extraction, and updating correct fields changes it to 'pending'.
   */
  it('should save pending transaction with status error if fields are missing, and transition status on updates', async () => {
    const { SQLiteTransactionRepository } = require('../src/db/sqlite-transaction-repository');
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    // 0. Seed raw input in Bronze to satisfy FK constraint
    await repository.saveRawInput({
      id: 'test_raw_tx_1',
      userId: 'user-123',
      sourceType: 'email',
      sender: 'sender@test.com',
      title: 'Test Subject',
      snippet: 'Test Snippet',
      rawBody: 'Full email body',
      rawPayload: '{}',
      receivedAt: '2023-01-10T10:00:00Z',
    });

    // 1. Save with missing amount and paymentMethod -> should get 'error' status
    await repository.savePendingTransaction({
      id: 'validation_test_silver_1',
      bronzeInputId: 'test_raw_tx_1',
      userId: 'user-123',
      sourceType: 'email',
      merchantRaw: 'Missing Fields Merchant',
      amount: 0,
      currency: 'USD',
      transactionDate: '2023-01-10',
      status: 'pending',
    });

    const txAfterSave = await repository.getSilverTransactionById('validation_test_silver_1', 'user-123');
    expect(txAfterSave).toBeDefined();
    expect(txAfterSave?.status).toBe('error');

    // 2. Try to promote this error transaction -> should fail
    await expect(repository.promoteToTransaction('validation_test_silver_1', {
      id: 'validation_test_gold_1',
      pendingTxId: 'validation_test_silver_1',
      userId: 'user-123',
      sourceType: 'email',
      merchant: 'Missing Fields Merchant',
      amount: 45.99,
      currency: 'USD',
      transactionDate: '2023-01-10',
      category: 'Food',
      paymentMethod: 'UPI',
    })).rejects.toThrow(/Cannot promote/);

    // 3. Update the fields to be valid -> should transition status to 'pending'
    await repository.updatePendingTransaction('validation_test_silver_1', 'user-123', {
      amount: 45.99,
      paymentMethod: 'UPI'
    });

    const txAfterFix = await repository.getSilverTransactionById('validation_test_silver_1', 'user-123');
    expect(txAfterFix?.status).toBe('pending');

    // 4. Update to remove merchant -> should transition status back to 'error'
    await repository.updatePendingTransaction('validation_test_silver_1', 'user-123', {
      merchantRaw: ''
    });

    const txAfterClear = await repository.getSilverTransactionById('validation_test_silver_1', 'user-123');
    expect(txAfterClear?.status).toBe('error');

    await repository.close();
  });

  /**
   * [FUNC-GMAIL-32] Staging Validation & Error Status:
   * Verify category is optional in /api/gmail/approve route.
   */
  it('should approve transaction successfully if category is missing (defaulting to Other), but fail if paymentMethod is missing', async () => {
    const { SQLiteTransactionRepository } = require('../src/db/sqlite-transaction-repository');
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    // 0. Seed raw input in Bronze to satisfy FK constraint
    await repository.saveRawInput({
      id: 'test_raw_tx_1',
      userId: 'user-123',
      sourceType: 'email',
      sender: 'sender@test.com',
      title: 'Test Subject',
      snippet: 'Test Snippet',
      rawBody: 'Full email body',
      rawPayload: '{}',
      receivedAt: '2023-01-10T10:00:00Z',
    });

    // 1. Seed valid pending transaction in silver staging
    await repository.savePendingTransaction({
      id: 'approve_test_silver_1',
      bronzeInputId: 'test_raw_tx_1',
      userId: 'user-123',
      sourceType: 'email',
      merchantRaw: 'Valid Merchant',
      amount: 25.50,
      currency: 'USD',
      transactionDate: '2023-01-10',
      status: 'pending',
      paymentMethod: 'UPI'
    });
    await repository.close();

    // 2. Approve with missing category -> should succeed
    const approveSuccess = await request(app)
      .post('/api/gmail/approve')
      .set('Authorization', 'Bearer valid-token')
      .send({
        silverId: 'approve_test_silver_1',
        merchant: 'Valid Merchant',
        amount: 25.50,
        currency: 'USD',
        date: '2023-01-10',
        paymentMethod: 'UPI'
      });

    expect(approveSuccess.status).toBe(200);
    expect(approveSuccess.body.status).toBe('approved');

    // Verify category defaulted to 'Other' in gold ledger
    const repo2 = new SQLiteTransactionRepository();
    await repo2.initializeSchema();
    const goldTxs = await repo2.getGoldTransactions('user-123');
    const approvedGold = goldTxs.find((g: any) => g.pendingTxId === 'approve_test_silver_1');
    expect(approvedGold).toBeDefined();
    expect(approvedGold?.category).toBe('Other');
    await repo2.close();

    // 3. Seed another pending transaction
    const repo3 = new SQLiteTransactionRepository();
    await repo3.initializeSchema();
    await repo3.savePendingTransaction({
      id: 'approve_test_silver_2',
      bronzeInputId: 'test_raw_tx_1',
      userId: 'user-123',
      sourceType: 'email',
      merchantRaw: 'Valid Merchant 2',
      amount: 15.00,
      currency: 'USD',
      transactionDate: '2023-01-10',
      status: 'pending',
      paymentMethod: 'UPI'
    });
    await repo3.close();

    // 4. Try to approve with missing paymentMethod -> should fail with 400
    const approveFail = await request(app)
      .post('/api/gmail/approve')
      .set('Authorization', 'Bearer valid-token')
      .send({
        silverId: 'approve_test_silver_2',
        merchant: 'Valid Merchant 2',
        amount: 15.00,
        currency: 'USD',
        date: '2023-01-10',
        category: 'Food'
      });

    expect(approveFail.status).toBe(400);
    expect(approveFail.body.error).toContain('required');
  });

  /**
   * [FUNC-GMAIL-31] / [NFR-USAB-7] Manual Gold Transaction Deletion & Restoration:
   * Verify soft-deleting a manual direct Gold entry and restoring it from Trash.
   */
  it('should soft-delete a direct manual Gold transaction and allow restoring it from the Trash', async () => {
    // 1. Create a direct manual Gold transaction
    const addRes = await request(app)
      .post('/api/pipeline/add-transaction')
      .set('Authorization', 'Bearer valid-token')
      .send({
        merchant: 'Manual Shop',
        amount: 45.99,
        currency: 'INR',
        transactionDate: '2023-01-15',
        category: 'Shopping',
        paymentMethod: 'UPI',
        notes: 'Manual entry test'
      });

    expect(addRes.status).toBe(200);
    expect(addRes.body.status).toBe('added');

    // Fetch gold transactions to find the ID of the created manual entry
    const { SQLiteTransactionRepository } = require('../src/db/sqlite-transaction-repository');
    const repo = new SQLiteTransactionRepository();
    await repo.initializeSchema();
    const activeGold = await repo.getGoldTransactions('user-123');
    const manualTx = activeGold.find((g: any) => g.merchant === 'Manual Shop');
    expect(manualTx).toBeDefined();
    const goldId = manualTx!.id;
    await repo.close();

    // 2. Soft-delete the manual transaction via revert-to-silver endpoint
    const deleteRes = await request(app)
      .post('/api/pipeline/revert-to-silver')
      .set('Authorization', 'Bearer valid-token')
      .send({ goldId });

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.status).toBe('reverted');

    // 3. Verify it is not returned in active Gold transactions
    const repo2 = new SQLiteTransactionRepository();
    await repo2.initializeSchema();
    const activeGoldAfterDelete = await repo2.getGoldTransactions('user-123');
    const manualTxAfterDelete = activeGoldAfterDelete.find((g: any) => g.id === goldId);
    expect(manualTxAfterDelete).toBeUndefined();

    // 4. Verify it is listed in the /deleted response
    const deletedRes = await request(app)
      .get('/api/pipeline/deleted')
      .set('Authorization', 'Bearer valid-token');

    expect(deletedRes.status).toBe(200);
    const deletedGoldTx = deletedRes.body.goldTransactions.find((g: any) => g.id === goldId);
    expect(deletedGoldTx).toBeDefined();
    expect(deletedGoldTx.merchant).toBe('Manual Shop');

    // 5. Restore the manual transaction via /restore endpoint
    const restoreRes = await request(app)
      .post('/api/pipeline/restore')
      .set('Authorization', 'Bearer valid-token')
      .send({ goldId });

    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.status).toBe('restored');

    // 6. Verify it is restored back to the Gold list
    const activeGoldAfterRestore = await repo2.getGoldTransactions('user-123');
    const manualTxAfterRestore = activeGoldAfterRestore.find((g: any) => g.id === goldId);
    expect(manualTxAfterRestore).toBeDefined();
    expect(manualTxAfterRestore?.merchant).toBe('Manual Shop');

    await repo2.close();
  });

  /**
   * [FUNC-GMAIL-33] Payment Standardization Config endpoints: GET, POST, PUT, DELETE.
   * [NFR-USAB-10] Payment Standardization Usability.
   */
  it('should manage payment methods and mapping rules and support CRUD', async () => {
    // 1. Get seeded payment methods (dynamic seeding check)
    const getMethodsRes = await request(app)
      .get('/api/ingestion/payment-methods')
      .set('Authorization', 'Bearer valid-token');
    expect(getMethodsRes.status).toBe(200);
    expect(getMethodsRes.body.paymentMethods).toBeDefined();
    // Default seeded methods length should be 4
    expect(getMethodsRes.body.paymentMethods.length).toBe(4);
    const upiMethod = getMethodsRes.body.paymentMethods.find((m: any) => m.name === 'UPI');
    expect(upiMethod).toBeDefined();

    // 2. Post new payment method
    const postMethodRes = await request(app)
      .post('/api/ingestion/payment-methods')
      .set('Authorization', 'Bearer valid-token')
      .send({ name: 'PayPal' });
    expect(postMethodRes.status).toBe(201);
    const newMethodId = postMethodRes.body.paymentMethod.id;
    expect(postMethodRes.body.paymentMethod.name).toBe('PayPal');

    // 3. Put update payment method
    const putMethodRes = await request(app)
      .put(`/api/ingestion/payment-methods/${newMethodId}`)
      .set('Authorization', 'Bearer valid-token')
      .send({ name: 'PayPal Standard' });
    expect(putMethodRes.status).toBe(200);

    // 4. Get payment mapping rules (dynamic seeding check)
    const getRulesRes = await request(app)
      .get('/api/ingestion/payment-rules')
      .set('Authorization', 'Bearer valid-token');
    expect(getRulesRes.status).toBe(200);
    expect(getRulesRes.body.paymentRules.length).toBe(4); // default rules

    // 5. Post new mapping rule
    const postRuleRes = await request(app)
      .post('/api/ingestion/payment-rules')
      .set('Authorization', 'Bearer valid-token')
      .send({ aliasPattern: 'ppal', paymentMethodId: newMethodId });
    expect(postRuleRes.status).toBe(201);
    const newRuleId = postRuleRes.body.paymentRule.id;

    // 6. Put update mapping rule
    const putRuleRes = await request(app)
      .put(`/api/ingestion/payment-rules/${newRuleId}`)
      .set('Authorization', 'Bearer valid-token')
      .send({ aliasPattern: 'paypal-pay', paymentMethodId: newMethodId });
    expect(putRuleRes.status).toBe(200);

    // 7. Delete mapping rule
    const deleteRuleRes = await request(app)
      .delete(`/api/ingestion/payment-rules/${newRuleId}`)
      .set('Authorization', 'Bearer valid-token');
    expect(deleteRuleRes.status).toBe(200);

    // 8. Delete payment method
    const deleteMethodRes = await request(app)
      .delete(`/api/ingestion/payment-methods/${newMethodId}`)
      .set('Authorization', 'Bearer valid-token');
    expect(deleteMethodRes.status).toBe(200);
  });

  /**
   * [FUNC-GMAIL-34] Auto-Standardization on Ingestion.
   * Checks that raw payment methods (e.g. "hdfc bank card") are auto-standardized to "HDFC Credit Card" based on mapping rules.
   */
  it('should auto-standardize payment methods using rules during ingestion/matching', async () => {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    
    // Seed and verify rule
    const standardized = await repository.standardizePaymentMethod('user-multi-and-test', 'hdfc card');
    expect(standardized).toBe('HDFC Credit Card');

    const standardizedUpi = await repository.standardizePaymentMethod('user-multi-and-test', 'My UPI Payment');
    expect(standardizedUpi).toBe('UPI');

    const unknownMethod = await repository.standardizePaymentMethod('user-multi-and-test', 'Unknown Method');
    expect(unknownMethod).toBe('Unknown Method'); // fallback to raw

    // Test multi-alias AND combination rule
    const methodId = crypto.randomUUID();
    await repository.savePaymentMethod({ id: methodId, userId: 'user-multi-and-test', name: 'ICICI Credit Card Custom' });
    await repository.savePaymentMappingRule({ id: crypto.randomUUID(), userId: 'user-multi-and-test', aliasPattern: 'icici + credit', paymentMethodId: methodId });

    const matchedAnd = await repository.standardizePaymentMethod('user-multi-and-test', 'icici bank credit card');
    expect(matchedAnd).toBe('ICICI Credit Card Custom');

    const unmatchedAnd = await repository.standardizePaymentMethod('user-multi-and-test', 'icici bank debit card');
    expect(unmatchedAnd).toBe('icici bank debit card'); // doesn't match since it lacks "credit"

    await repository.close();
  });

  /**
   * [BUG-012] Payment Mapping Priority Conflict.
   * Verify that standardizePaymentMethod prioritizes matching rules with more parts,
   * and tie-breaks using pattern length.
   */
  it('should prioritize more specific payment mapping rules based on number of parts and length [BUG-012]', async () => {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    const userId = 'user-priority-test';

    // 1. Create standardized payment methods
    const mHdfcId = crypto.randomUUID();
    const mRupayId = crypto.randomUUID();
    const mVisaId = crypto.randomUUID();
    const mCardGenericId = crypto.randomUUID();
    const mCardSpecificId = crypto.randomUUID();

    await repository.savePaymentMethod({ id: mHdfcId, userId, name: 'HDFC Credit Card' });
    await repository.savePaymentMethod({ id: mRupayId, userId, name: 'HDFC RuPay Credit Card' });
    await repository.savePaymentMethod({ id: mVisaId, userId, name: 'HDFC Visa Credit Card' });
    await repository.savePaymentMethod({ id: mCardGenericId, userId, name: 'HDFC Card Generic' });
    await repository.savePaymentMethod({ id: mCardSpecificId, userId, name: 'HDFC Credit Card Specific' });

    // 2. Save mapping rules
    await repository.savePaymentMappingRule({ id: crypto.randomUUID(), userId, aliasPattern: 'hdfc', paymentMethodId: mHdfcId });
    await repository.savePaymentMappingRule({ id: crypto.randomUUID(), userId, aliasPattern: 'hdfc + rupay', paymentMethodId: mRupayId });
    await repository.savePaymentMappingRule({ id: crypto.randomUUID(), userId, aliasPattern: 'hdfc + credit + visa', paymentMethodId: mVisaId });
    
    // Tie-breaker rules (both 2 parts)
    await repository.savePaymentMappingRule({ id: crypto.randomUUID(), userId, aliasPattern: 'hdfc + card', paymentMethodId: mCardGenericId });
    await repository.savePaymentMappingRule({ id: crypto.randomUUID(), userId, aliasPattern: 'hdfc + creditcard', paymentMethodId: mCardSpecificId });

    // 3. Scenario A: simple match (only "hdfc" matches)
    const resA = await repository.standardizePaymentMethod(userId, 'hdfc cash payment');
    expect(resA).toBe('HDFC Credit Card');

    // 4. Scenario B: priority match (both "hdfc" and "hdfc + rupay" match. "hdfc + rupay" has 2 parts, so it wins)
    const resB = await repository.standardizePaymentMethod(userId, 'hdfc rupay credit card');
    expect(resB).toBe('HDFC RuPay Credit Card');

    // 5. Scenario C: tie-breaker on pattern length (both "hdfc + card" and "hdfc + creditcard" match. "hdfc + creditcard" is longer, so it wins)
    const resC = await repository.standardizePaymentMethod(userId, 'hdfc creditcard statement');
    expect(resC).toBe('HDFC Credit Card Specific');

    await repository.close();
  });

  /**
   * [FUNC-GMAIL-44] Category Standardization & Normalization.
   * Verify that category names are normalized, variations mapped,
   * and casing standardized (Title Case) on insertion/update in DB.
   */
  it('should normalize and standardize category names on insert and update [FUNC-GMAIL-44]', async () => {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    const userId = 'user-category-norm';

    // 1. Ingest/Save pending transaction with whitespace/casing variations
    const rawId = 'raw_cat_norm_1';
    await repository.saveRawInput({
      id: rawId,
      userId,
      sourceType: 'email',
      sender: 'zomato@order.com',
      title: 'Food Order',
      snippet: 'Paid $12',
      rawBody: 'Zomato order details...',
      rawPayload: '{}',
      receivedAt: new Date().toISOString(),
      hasTransaction: true,
      status: 'unprocessed'
    });

    const pendingTxId = crypto.randomUUID();
    await repository.savePendingTransaction({
      id: pendingTxId,
      bronzeInputId: rawId,
      userId,
      sourceType: 'email',
      merchantRaw: 'Zomato',
      amount: 12.00,
      currency: 'INR',
      transactionDate: '2026-06-12',
      status: 'pending',
      paymentMethod: 'UPI',
      inferredCategory: '  online food order  ' // Extra spaces & lowercase
    });

    // Verify it was normalized to "Online Food Order"
    const pending = await repository.getSilverTransactionById(pendingTxId, userId);
    expect(pending?.inferredCategory).toBe('Online Food Order');

    // 2. Add direct manual Gold transaction with variation
    const goldId = crypto.randomUUID();
    await repository.addDirectGoldTransaction({
      id: goldId,
      userId,
      sourceType: 'manual',
      merchant: 'Supermarket',
      amount: 50.00,
      currency: 'INR',
      transactionDate: '2026-06-12',
      category: 'grocery', // variation of "Groceries"
      paymentMethod: 'Cash'
    });

    // Verify it was normalized to "Groceries"
    const goldTxs = await repository.getGoldTransactions(userId);
    const gold = goldTxs.find(tx => tx.id === goldId);
    expect(gold?.category).toBe('Groceries');

    // 3. Update pending transaction category to custom non-standard name
    await repository.updatePendingTransaction(pendingTxId, userId, {
      inferredCategory: 'gadgets'
    });
    const pendingUpdated = await repository.getSilverTransactionById(pendingTxId, userId);
    expect(pendingUpdated?.inferredCategory).toBe('Gadgets'); // Title Case

    // 4. Update gold transaction category to custom non-standard name
    await repository.updateGoldTransaction(goldId, userId, {
      category: 'health & fitness'
    });
    const goldTxsUpdated = await repository.getGoldTransactions(userId);
    const goldUpdated = goldTxsUpdated.find(tx => tx.id === goldId);
    expect(goldUpdated?.category).toBe('Health & Fitness'); // Title Case

    await repository.close();
  });

  /**
   * [FUNC-GMAIL-34] Retroactive standardization.
   * [NFR-USAB-10] Payment Standardization Usability.
   */
  it('should retroactively standardize payment methods for existing silver and gold records', async () => {
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    // 1. Prepare raw input, silver staging record with non-standard payment method
    const rawId = 'retro_raw_1';
    const silverId = 'retro_silver_1';
    
    // Cleanup any remnants
    await (repository as any).run('DELETE FROM gold_transactions WHERE silver_tx_id = ?', [silverId]);
    await (repository as any).run('DELETE FROM silver_extracted_transactions WHERE id = ?', [silverId]);
    await (repository as any).run('DELETE FROM bronze_raw_inputs WHERE id = ?', [rawId]);

    await repository.saveRawInput({
      id: rawId,
      userId: 'user-123',
      sourceType: 'email',
      sender: 'store@shop.com',
      title: 'Receipt for order',
      snippet: 'amount 10.00',
      rawBody: 'Payment by HDFC Card.',
      rawPayload: '{}',
      receivedAt: new Date().toISOString(),
    });

    await repository.savePendingTransaction({
      id: silverId,
      bronzeInputId: rawId,
      userId: 'user-123',
      sourceType: 'email',
      merchantRaw: 'Supermarket',
      merchantNormalized: 'Supermarket',
      amount: 10.00,
      currency: 'INR',
      transactionDate: '2026-06-01',
      status: 'pending',
      paymentMethod: 'hdfc card', // non-standard
    });

    // 2. Trigger retroactive standardization endpoint
    const response = await request(app)
      .post('/api/ingestion/standardize-retroactive')
      .set('Authorization', 'Bearer valid-token');
    expect(response.status).toBe(200);
    expect(response.body.updatedSilverCount).toBeGreaterThanOrEqual(1);

    // 3. Verify silver record was updated
    const silverTx = await repository.getSilverTransactionById(silverId, 'user-123');
    expect(silverTx?.paymentMethod).toBe('HDFC Credit Card');

    // Clean up
    await (repository as any).run('DELETE FROM silver_extracted_transactions WHERE id = ?', [silverId]);
    await (repository as any).run('DELETE FROM bronze_raw_inputs WHERE id = ?', [rawId]);

    await repository.close();
  });

  /**
   * [BUG-007] / [FUNC-GMAIL-36] Staging Rejection: Verify that updates with status 'rejected' are persisted.
   */
  it('should support updating a pending transaction to rejected status and persisting it', async () => {
    const { SQLiteTransactionRepository } = require('../src/db/sqlite-transaction-repository');
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    const rawId = 'reject_test_raw_1';
    const silverId = 'reject_test_silver_1';

    await repository.saveRawInput({
      id: rawId,
      userId: 'user-123',
      sourceType: 'email',
      sender: 'reject@test.com',
      title: 'Reject test raw',
      snippet: 'amount 12.00',
      rawBody: 'Raw content for reject test',
      rawPayload: '{}',
      receivedAt: new Date().toISOString(),
    });

    await repository.savePendingTransaction({
      id: silverId,
      bronzeInputId: rawId,
      userId: 'user-123',
      sourceType: 'email',
      merchantRaw: 'Supermarket',
      merchantNormalized: 'Supermarket',
      amount: 10.00,
      currency: 'INR',
      transactionDate: '2026-06-01',
      status: 'pending',
      paymentMethod: 'UPI',
    });

    // 1. Call API PUT route to change status to rejected
    const response = await request(app)
      .put(`/api/pipeline/silver-transactions/${silverId}`)
      .set('Authorization', 'Bearer valid-token')
      .send({ status: 'rejected' });

    expect(response.status).toBe(200);

    // 2. Fetch the transaction from the repository to verify the status
    const tx = await repository.getSilverTransactionById(silverId, 'user-123');
    expect(tx?.status).toBe('rejected');

    // Clean up
    await (repository as any).run('DELETE FROM silver_extracted_transactions WHERE id = ?', [silverId]);
    await (repository as any).run('DELETE FROM bronze_raw_inputs WHERE id = ?', [rawId]);
    await repository.close();
  });
});

describe('[FUNC-GMAIL-48] Reject Implies Non-Transactional Classification', () => {
  /**
   * [FUNC-GMAIL-48] Single rejection: rejecting a Bronze raw input via PUT must
   * atomically set status='rejected' AND hasTransaction=false.
   */
  it('should atomically set status=rejected and hasTransaction=false when the user rejects a single Bronze input', async () => {
    const { SQLiteTransactionRepository } = require('../src/db/sqlite-transaction-repository');
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    const rawId = 'func48_single_reject_raw_1';
    await repository.saveRawInput({
      id: rawId,
      userId: 'user-123',
      sourceType: 'email',
      sender: 'bank@hdfc.com',
      title: 'HDFC Transaction Alert',
      snippet: 'Your card was charged INR 500',
      rawBody: 'Full email body content',
      rawPayload: JSON.stringify({ id: rawId }),
      receivedAt: '2026-06-15T10:00:00Z',
    });
    await repository.close();

    // User rejects the single Bronze raw input
    const rejectRes = await request(app)
      .put(`/api/pipeline/raw-inputs/${rawId}`)
      .set('Authorization', 'Bearer valid-token')
      .send({ status: 'rejected' });

    expect(rejectRes.status).toBe(200);

    // Verify both fields changed atomically in the database
    const fetchRes = await request(app)
      .get('/api/pipeline/raw-inputs')
      .set('Authorization', 'Bearer valid-token');

    const record = fetchRes.body.emails.find((e: any) => e.id === rawId);
    expect(record).toBeDefined();
    expect(record.status).toBe('rejected');
    expect(record.hasTransaction).toBe(false);

    // Clean up
    const repo2 = new SQLiteTransactionRepository();
    await repo2.initializeSchema();
    await (repo2 as any).run('DELETE FROM bronze_raw_inputs WHERE id = ?', [rawId]);
    await repo2.close();
  });

  /**
   * [FUNC-GMAIL-48] Batch rejection: rejecting multiple Bronze raw inputs via POST reject-batch
   * must atomically set status='rejected' AND hasTransaction=false for all targeted records.
   */
  it('should atomically set status=rejected and hasTransaction=false for all inputs when the user batch-rejects Bronze records', async () => {
    const { SQLiteTransactionRepository } = require('../src/db/sqlite-transaction-repository');
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    const rawId1 = 'func48_batch_reject_raw_1';
    const rawId2 = 'func48_batch_reject_raw_2';

    for (const rawId of [rawId1, rawId2]) {
      await repository.saveRawInput({
        id: rawId,
        userId: 'user-123',
        sourceType: 'email',
        sender: 'bank@hdfc.com',
        title: `HDFC Alert ${rawId}`,
        snippet: 'Your card was charged',
        rawBody: 'Full email body content',
        rawPayload: JSON.stringify({ id: rawId }),
        receivedAt: '2026-06-15T10:00:00Z',
      });
    }
    await repository.close();

    // User batch-rejects both Bronze raw inputs
    const rejectRes = await request(app)
      .post('/api/pipeline/reject-batch')
      .set('Authorization', 'Bearer valid-token')
      .send({ rawEmailIds: [rawId1, rawId2] });

    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.status).toBe('rejected');

    // Verify both fields changed atomically in the database for each record
    const fetchRes = await request(app)
      .get('/api/pipeline/raw-inputs')
      .set('Authorization', 'Bearer valid-token');

    for (const rawId of [rawId1, rawId2]) {
      const record = fetchRes.body.emails.find((e: any) => e.id === rawId);
      expect(record).toBeDefined();
      expect(record.status).toBe('rejected');
      expect(record.hasTransaction).toBe(false);
    }

    // Clean up
    const repo2 = new SQLiteTransactionRepository();
    await repo2.initializeSchema();
    await (repo2 as any).run('DELETE FROM bronze_raw_inputs WHERE id IN (?, ?)', [rawId1, rawId2]);
    await repo2.close();
  });
});
