import { SQLiteTransactionRepository } from '../src/db/sqlite-transaction-repository';

describe('Database Viewer Repository Integration', () => {
  let repository: SQLiteTransactionRepository;

  beforeEach(async () => {
    repository = new SQLiteTransactionRepository(':memory:');
    await repository.initializeSchema();
  });

  afterEach(async () => {
    await repository.close();
  });

  /**
   * [FUNC-DB-VIEWER-2] Table Selection & Schema Inspection
   * Verify that the database viewer listing returns all allowed application tables and schema column information.
   */
  it('should return allowed database tables with metadata', async () => {
    const tables = await repository.getInspectableTables();
    expect(tables).toBeDefined();
    expect(Array.isArray(tables)).toBe(true);
    
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('gold_transactions');
    expect(tableNames).toContain('silver_extracted_transactions');
    expect(tableNames).toContain('bronze_raw_inputs');
    expect(tableNames).toContain('user_cycles');
    expect(tableNames).toContain('fixed_charges');
    expect(tableNames).toContain('user_preferences');

    const goldMeta = tables.find(t => t.name === 'gold_transactions');
    expect(goldMeta).toBeDefined();
    expect(goldMeta?.columns).toContain('id');
    expect(goldMeta?.columns).toContain('user_id');
    expect(goldMeta?.columns).toContain('merchant');
  });

  /**
   * [FUNC-DB-VIEWER-3] Raw Data Explorer & Pagination
   * [NFR-DB-VIEWER-1] Raw Table Query Latency & Data Isolation
   * Verify retrieving paginated raw table records isolated by user ID.
   */
  it('should retrieve paginated raw table records isolated by user ID', async () => {
    const userIdA = 'user-viewer-a';
    const userIdB = 'user-viewer-b';

    // Insert gold records for User A
    await repository.addDirectGoldTransaction({
      id: 'gold-a-1',
      userId: userIdA,
      sourceType: 'manual',
      merchant: 'Supermarket Alpha',
      amount: 45,
      currency: 'INR',
      transactionDate: '2026-07-01',
      category: 'Groceries',
      paymentMethod: 'Credit Card',
      transactionType: 'expense'
    });

    await repository.addDirectGoldTransaction({
      id: 'gold-a-2',
      userId: userIdA,
      sourceType: 'manual',
      merchant: 'Tech Store',
      amount: 120,
      currency: 'INR',
      transactionDate: '2026-07-02',
      category: 'Electronics',
      paymentMethod: 'Credit Card',
      transactionType: 'expense'
    });

    // Insert gold record for User B
    await repository.addDirectGoldTransaction({
      id: 'gold-b-1',
      userId: userIdB,
      sourceType: 'manual',
      merchant: 'User B Merchant',
      amount: 99,
      currency: 'INR',
      transactionDate: '2026-07-03',
      category: 'Shopping',
      paymentMethod: 'UPI',
      transactionType: 'expense'
    });

    // Query rows for User A
    const resUserA = await repository.getTableRows('gold_transactions', userIdA, 10, 0);
    expect(resUserA.totalCount).toBe(2);
    expect(resUserA.rows).toHaveLength(2);
    expect(resUserA.columns).toContain('merchant');
    expect(resUserA.rows.some(r => r.id === 'gold-a-1')).toBe(true);
    expect(resUserA.rows.some(r => r.id === 'gold-a-2')).toBe(true);
    expect(resUserA.rows.some(r => r.id === 'gold-b-1')).toBe(false);

    // Test Search query filter
    const resSearch = await repository.getTableRows('gold_transactions', userIdA, 10, 0, 'Supermarket');
    expect(resSearch.totalCount).toBe(1);
    expect(resSearch.rows[0].id).toBe('gold-a-1');
  });

  /**
   * [FUNC-DB-VIEWER-3] Security Boundary: Prevent SQL injection via invalid table names.
   */
  it('should reject invalid or disallowed table names', async () => {
    await expect(
      repository.getTableRows('sqlite_master; DROP TABLE gold_transactions;', 'user-a', 10, 0)
    ).rejects.toThrow('Invalid or unauthorized table name');
  });
});
