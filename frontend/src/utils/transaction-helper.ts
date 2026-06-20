export interface HasAmountAndTransactionType {
  amount: number;
  transactionType?: string | null;
}

/**
 * Returns the signed financial value of a transaction.
 * Expenses are positive, refunds are negative offsets, and transfers are 0.
 */
export const getSignedAmount = (t: HasAmountAndTransactionType): number => {
  if (t.transactionType === 'refund') return -t.amount;
  if (t.transactionType === 'transfer') return 0;
  return t.amount;
};
