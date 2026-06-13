import { SQLiteTransactionRepository } from '../src/db/sqlite-transaction-repository';
import crypto from 'crypto';

describe('Transaction User Isolation Integration', () => {
  let repository: SQLiteTransactionRepository;

  beforeEach(async () => {
    // Spin up an isolated in-memory SQLite database
    repository = new SQLiteTransactionRepository(':memory:');
    await repository.initializeSchema();
  });

  afterEach(async () => {
    await repository.close();
  });

  /**
   * [FUNC-AUTH-4] Transaction User Isolation: Raw inputs (Bronze) must be isolated by user.
   * [NFR-SEC-5] Data Segregation Enforcement: Verify user A cannot see or access user B's raw inputs.
   */
  it('should isolate raw inputs (Bronze) by user ID', async () => {
    const emailAId = 'email_user_a';
    const emailBId = 'email_user_b';

    // Save input for user A
    await repository.saveRawInput({
      id: emailAId,
      userId: 'user-a',
      sourceType: 'email',
      sender: 'store@market.com',
      title: 'User A Receipt',
      snippet: 'Spent $10',
      rawBody: 'Receipt details for User A',
      rawPayload: '{}',
      receivedAt: '2023-01-15T12:00:00Z',
    });

    // Save input for user B
    await repository.saveRawInput({
      id: emailBId,
      userId: 'user-b',
      sourceType: 'email',
      sender: 'taxi@ride.com',
      title: 'User B Receipt',
      snippet: 'Spent $15',
      rawBody: 'Receipt details for User B',
      rawPayload: '{}',
      receivedAt: '2023-01-16T12:00:00Z',
    });

    // Verify User A only sees User A's raw inputs
    const rawEmailsA = await repository.getRawInputs('user-a');
    expect(rawEmailsA).toHaveLength(1);
    expect(rawEmailsA[0].id).toBe(emailAId);

    // Verify User B only sees User B's raw inputs
    const rawEmailsB = await repository.getRawInputs('user-b');
    expect(rawEmailsB).toHaveLength(1);
    expect(rawEmailsB[0].id).toBe(emailBId);

    // Verify getRawInputById is isolated
    const emailAForA = await repository.getRawInputById(emailAId, 'user-a');
    expect(emailAForA).toBeDefined();
    expect(emailAForA!.id).toBe(emailAId);

    const emailAForB = await repository.getRawInputById(emailAId, 'user-b');
    expect(emailAForB).toBeUndefined();
  });

  /**
   * [FUNC-AUTH-4] Transaction User Isolation: Staging transactions (Silver) must be isolated by user.
   * [NFR-SEC-5] Data Segregation Enforcement: Verify user A cannot see or access user B's staging transactions.
   */
  it('should isolate staging transactions (Silver) by user ID', async () => {
    const emailAId = 'email_user_a';
    const emailBId = 'email_user_b';
    const silverAId = 'silver_user_a';
    const silverBId = 'silver_user_b';

    // Save raw inputs
    await repository.saveRawInput({
      id: emailAId,
      userId: 'user-a',
      sourceType: 'email',
      sender: 'store@market.com',
      title: 'User A Receipt',
      snippet: 'Spent $10',
      rawBody: 'Receipt details A',
      rawPayload: '{}',
      receivedAt: '2023-01-15T12:00:00Z',
    });

    await repository.saveRawInput({
      id: emailBId,
      userId: 'user-b',
      sourceType: 'email',
      sender: 'taxi@ride.com',
      title: 'User B Receipt',
      snippet: 'Spent $15',
      rawBody: 'Receipt details B',
      rawPayload: '{}',
      receivedAt: '2023-01-16T12:00:00Z',
    });

    // Save pending transactions (Silver)
    await repository.savePendingTransaction({
      id: silverAId,
      bronzeInputId: emailAId,
      userId: 'user-a',
      sourceType: 'email',
      merchantRaw: 'Market Store',
      amount: 10.00,
      currency: 'USD',
      transactionDate: '2023-01-15',
      status: 'pending',
      paymentMethod: 'Credit Card',
    });

    await repository.savePendingTransaction({
      id: silverBId,
      bronzeInputId: emailBId,
      userId: 'user-b',
      sourceType: 'email',
      merchantRaw: 'Taxi Ride',
      amount: 15.00,
      currency: 'USD',
      transactionDate: '2023-01-16',
      status: 'pending',
      paymentMethod: 'Credit Card',
    });

    // Verify User A only sees User A's Silver transactions
    const silverA = await repository.getSilverTransactions('user-a');
    expect(silverA).toHaveLength(1);
    expect(silverA[0].id).toBe(silverAId);

    // Verify User B only sees User B's Silver transactions
    const silverB = await repository.getSilverTransactions('user-b');
    expect(silverB).toHaveLength(1);
    expect(silverB[0].id).toBe(silverBId);

    // Verify lookup isolation
    const searchAForA = await repository.getSilverTransactionById(silverAId, 'user-a');
    expect(searchAForA).toBeDefined();

    const searchAForB = await repository.getSilverTransactionById(silverAId, 'user-b');
    expect(searchAForB).toBeUndefined();
  });

  /**
   * [FUNC-AUTH-4] Transaction User Isolation: Ledger transactions (Gold) must be isolated by user.
   * [NFR-SEC-5] Data Segregation Enforcement: Verify user A cannot see or access user B's ledger transactions.
   */
  it('should isolate ledger transactions (Gold) by user ID', async () => {
    const goldAId = 'gold_user_a';
    const goldBId = 'gold_user_b';

    // Directly insert Gold transactions for user-a and user-b
    await (repository as any).run(
      `INSERT INTO gold_transactions (id, user_id, merchant, amount_cents, currency, transaction_date, category, payment_method) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [goldAId, 'user-a', 'Uber Inc', 1450, 'USD', '2023-01-15', 'Transport', 'Credit Card']
    );

    await (repository as any).run(
      `INSERT INTO gold_transactions (id, user_id, merchant, amount_cents, currency, transaction_date, category, payment_method) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [goldBId, 'user-b', 'Starbucks', 450, 'USD', '2023-01-16', 'Food', 'Credit Card']
    );

    // Verify User A only lists User A's Gold transactions
    const goldA = await repository.getGoldTransactions('user-a');
    expect(goldA).toHaveLength(1);
    expect(goldA[0].id).toBe(goldAId);

    // Verify User B only lists User B's Gold transactions
    const goldB = await repository.getGoldTransactions('user-b');
    expect(goldB).toHaveLength(1);
    expect(goldB[0].id).toBe(goldBId);

    // Verify update updates only User A's transaction when User A requests
    await repository.updateGoldTransaction(goldAId, 'user-a', { merchant: 'Uber Edited' });
    const updatedGoldA = await repository.getGoldTransactions('user-a');
    expect(updatedGoldA[0].merchant).toBe('Uber Edited');

    // Verify User B trying to update User A's transaction has no effect
    await repository.updateGoldTransaction(goldAId, 'user-b', { merchant: 'Hacked merchant' });
    const afterHackAttempt = await repository.getGoldTransactions('user-a');
    expect(afterHackAttempt[0].merchant).toBe('Uber Edited'); // stays unchanged
  });
});
