import request from 'supertest';
import { app } from '../src/app';
import { google } from 'googleapis';

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

  beforeEach(async () => {
    jest.clearAllMocks();
    const { SQLiteTransactionRepository } = require('../src/db/sqlite-transaction-repository');
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();
    await (repository as any).run("DELETE FROM gold_transactions WHERE silver_tx_id IN ('del_silver_1', 'validation_test_silver_1', 'approve_test_silver_1', 'approve_test_silver_2') OR id IN ('del_gold_1', 'validation_test_gold_1', 'approve_test_gold_1')");
    await (repository as any).run("DELETE FROM silver_extracted_transactions WHERE id IN ('del_silver_1', 'validation_test_silver_1', 'approve_test_silver_1', 'approve_test_silver_2')");
    await (repository as any).run("DELETE FROM bronze_raw_emails WHERE id IN ('detail_msg_1', 'test_raw_tx_1', 'test_raw_otp_1', 'del_bronze_1')");
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
   * [BUG-003] ISO Date Normalization: Verify receivedAt ISO string normalization inside saveRawEmail.
   */
  it('should return raw emails with hasTransaction derived correctly from payload/subject', async () => {
    const { SQLiteTransactionRepository } = require('../src/db/sqlite-transaction-repository');
    const repository = new SQLiteTransactionRepository();
    await repository.initializeSchema();

    await repository.saveRawEmail({
      id: 'test_raw_tx_1',
      userId: 'user-123',
      sender: 'store@shop.com',
      subject: 'Order Receipt',
      snippet: 'Thanks for spending money',
      rawBody: 'Full email body',
      rawPayload: JSON.stringify({ id: 'test_raw_tx_1', hasTransaction: true }),
      receivedAt: '2023-01-10T10:00:00Z',
    });

    await repository.saveRawEmail({
      id: 'test_raw_otp_1',
      userId: 'user-123',
      sender: 'bank@auth.com',
      subject: 'Your OTP Code',
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

    await repository.saveRawEmail({
      id: 'test_raw_tx_1',
      userId: 'user-123',
      sender: 'store@shop.com',
      subject: 'Order Receipt',
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
    await repository.saveRawEmail({
      id: 'del_bronze_1',
      userId: 'user-123',
      sender: 'sender@del.com',
      subject: 'Raw Del Test',
      snippet: 'Raw text snippet',
      rawBody: 'Full email body',
      receivedAt: '2023-01-10T10:00:00Z',
    });

    await repository.savePendingTransaction({
      id: 'del_silver_1',
      rawEmailId: 'del_bronze_1',
      userId: 'user-123',
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

    // Verify Gold is gone, Silver is still active (status reset to pending/error)
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

    // 0. Seed raw email in Bronze to satisfy FK constraint
    await repository.saveRawEmail({
      id: 'test_raw_tx_1',
      userId: 'user-123',
      sender: 'sender@test.com',
      subject: 'Test Subject',
      snippet: 'Test Snippet',
      rawBody: 'Full email body',
      receivedAt: '2023-01-10T10:00:00Z',
    });

    // 1. Save with missing amount and paymentMethod -> should get 'error' status
    await repository.savePendingTransaction({
      id: 'validation_test_silver_1',
      rawEmailId: 'test_raw_tx_1',
      userId: 'user-123',
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

    // 0. Seed raw email in Bronze to satisfy FK constraint
    await repository.saveRawEmail({
      id: 'test_raw_tx_1',
      userId: 'user-123',
      sender: 'sender@test.com',
      subject: 'Test Subject',
      snippet: 'Test Snippet',
      rawBody: 'Full email body',
      receivedAt: '2023-01-10T10:00:00Z',
    });

    // 1. Seed valid pending transaction in silver staging
    await repository.savePendingTransaction({
      id: 'approve_test_silver_1',
      rawEmailId: 'test_raw_tx_1',
      userId: 'user-123',
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
      rawEmailId: 'test_raw_tx_1',
      userId: 'user-123',
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
});
