import React, { useState } from 'react';
import { useGmailIntegration } from '../hooks/use-gmail-integration';
import type { GoldTransaction } from '../hooks/use-gmail-integration';
import { EmailDetailModal } from '../components/gmail/EmailDetailModal';
import { DeleteConfirmationModal } from '../components/gmail/DeleteConfirmationModal';

const GoldTransactions: React.FC = () => {
  const {
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    rawEmails,
    silverTransactions,
    goldTransactions,
    updateGoldTransaction,
    updateSilverTransaction,
    revertOrDeleteRecord,
    paymentMethods,
    isLoading,
  } = useGmailIntegration();

  // Search keyword state
  const [searchQuery, setSearchQuery] = useState('');

  // Sort state
  const [sortBy, setSortBy] = useState<'dateDesc' | 'dateAsc' | 'merchantAsc' | 'merchantDesc' | 'amountDesc' | 'amountAsc'>('dateDesc');

  // Modal control states
  const [selectedGoldTransaction, setSelectedGoldTransaction] = useState<GoldTransaction | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteLineage, setDeleteLineage] = useState<{ bronzeId?: string; silverId?: string; goldId?: string }>({});
  const [deleteSourceStage, setDeleteSourceStage] = useState<'bronze' | 'silver' | 'gold'>('gold');
  const [isDeleteManual, setIsDeleteManual] = useState(false);

  const handleGoldDeleteClick = (tx: GoldTransaction) => {
    setSelectedGoldTransaction(null);
    setDeleteLineage({
      bronzeId: tx.bronzeInputId,
      silverId: tx.pendingTxId,
      goldId: tx.id,
    });
    setDeleteSourceStage('gold');
    setIsDeleteManual(tx.sourceType === 'manual');
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    setIsDeleteModalOpen(false);
    await revertOrDeleteRecord(deleteSourceStage, {
      bronzeId: deleteLineage.bronzeId,
      silverId: deleteLineage.silverId,
      goldId: deleteLineage.goldId,
    });
  };

  // 1. Filter transactions by search query
  const filteredTransactions = goldTransactions.filter(tx => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;

    return (
      tx.merchant.toLowerCase().includes(query) ||
      tx.category.toLowerCase().includes(query) ||
      (tx.notes && tx.notes.toLowerCase().includes(query)) ||
      (tx.paymentMethod && tx.paymentMethod.toLowerCase().includes(query)) ||
      tx.sourceType.toLowerCase().includes(query) ||
      tx.amount.toString().includes(query) ||
      tx.currency.toLowerCase().includes(query)
    );
  });

  const getSignedAmount = (t: GoldTransaction) => t.transactionType === 'refund' ? -t.amount : t.amount;

  // 2. Sort transactions
  const sortedTransactions = [...filteredTransactions].sort((a, b) => {
    switch (sortBy) {
      case 'dateAsc':
        return new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime();
      case 'dateDesc':
        return new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime();
      case 'merchantAsc':
        return a.merchant.localeCompare(b.merchant);
      case 'merchantDesc':
        return b.merchant.localeCompare(a.merchant);
      case 'amountAsc':
        return getSignedAmount(a) - getSignedAmount(b);
      case 'amountDesc':
        return getSignedAmount(b) - getSignedAmount(a);
      default:
        return 0;
    }
  });

  // 3. Compute currency totals
  const currencyTotals = sortedTransactions.reduce((acc, tx) => {
    const cur = tx.currency.toUpperCase();
    acc[cur] = (acc[cur] || 0) + getSignedAmount(tx);
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="w-full max-w-7xl space-y-8 animate-fade-in px-4 font-sans">
      {/* Page Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-150/60 pb-5 gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 Outfit sm:text-3xl">
            Gold Ledger Transactions
          </h1>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600 mt-1">
            Confirmed Ledger Items & Verified Financial Accounts
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-gray-150/60 rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center gap-4 justify-between">
          <div className="flex flex-wrap items-center gap-4 flex-grow">
            {/* Keyword Search */}
            <div className="flex flex-col min-w-[200px] flex-grow md:max-w-xs">
              <label htmlFor="search-input" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                Keyword Search:
              </label>
              <input
                id="search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by keyword..."
                className="bg-gray-50/50 border border-gray-200 rounded-xl outline-none text-xs font-semibold text-gray-800 px-3.5 py-2 focus:border-indigo-500 focus:bg-white transition-all shadow-inner"
              />
            </div>

            {/* Date Filters */}
            <div className="flex items-center gap-3">
              <div className="flex flex-col">
                <label htmlFor="start-date" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                  Start Date:
                </label>
                <input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-gray-50/50 border border-gray-200 rounded-xl outline-none text-xs font-bold text-gray-800 px-3.5 py-2 focus:border-indigo-500 focus:bg-white transition-all"
                />
              </div>
              <div className="flex flex-col">
                <label htmlFor="end-date" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                  End Date:
                </label>
                <input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-gray-50/50 border border-gray-200 rounded-xl outline-none text-xs font-bold text-gray-800 px-3.5 py-2 focus:border-indigo-500 focus:bg-white transition-all"
                />
              </div>
            </div>

            {/* Sorting */}
            <div className="flex flex-col min-w-[150px]">
              <label htmlFor="sort-select" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                Sort By:
              </label>
              <select
                id="sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-gray-50/50 border border-gray-200 rounded-xl outline-none text-xs font-bold text-gray-800 px-3.5 py-2 focus:border-indigo-500 focus:bg-white transition-all cursor-pointer"
              >
                <option value="dateDesc">Date (Newest First)</option>
                <option value="dateAsc">Date (Oldest First)</option>
                <option value="merchantAsc">Merchant (A-Z)</option>
                <option value="merchantDesc">Merchant (Z-A)</option>
                <option value="amountDesc">Amount (High to Low)</option>
                <option value="amountAsc">Amount (Low to High)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Aggregate Totals Summary */}
        <div className="pt-2 border-t border-gray-100 flex flex-wrap gap-4">
          <div className="w-full">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">Total Expenses Summary</span>
            <div className="flex flex-wrap gap-3">
              {Object.keys(currencyTotals).length === 0 ? (
                <div className="bg-gray-50 border border-gray-200/50 rounded-xl px-4 py-2.5 text-xs font-bold text-gray-400 uppercase tracking-widest">
                  No Expenses to aggregate
                </div>
              ) : (
                Object.entries(currencyTotals).map(([currency, total]) => (
                  <div
                    key={currency}
                    className="bg-emerald-50/40 border border-emerald-100/50 rounded-2xl px-4 py-2.5 flex items-baseline gap-2 shadow-sm"
                  >
                    <span className="text-[10px] font-extrabold text-emerald-800 uppercase tracking-wider">{currency}</span>
                    <span className="text-lg font-black text-emerald-600 Outfit">
                      {total.toFixed(2)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Ledger Table Section */}
      <div className="bg-white border border-gray-150/60 rounded-3xl overflow-hidden shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50/70 flex justify-between items-center px-6 py-4">
          <span className="text-xs font-extrabold text-emerald-800 uppercase tracking-wider">
            Double-Entry Verified Ledger
          </span>
          <span className="text-xs font-extrabold text-gray-400 uppercase tracking-wider">
            {sortedTransactions.length} Verified {sortedTransactions.length === 1 ? 'Item' : 'Items'}
          </span>
        </div>

        <div className="overflow-x-auto w-full">
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4 text-left">Date</th>
                <th className="px-6 py-4 text-left">Source</th>
                <th className="px-6 py-4 text-left">Merchant</th>
                <th className="px-6 py-4 text-left">Category</th>
                <th className="px-6 py-4 text-left">Method</th>
                <th className="px-6 py-4 text-left">Notes</th>
                <th className="px-6 py-4 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 bg-white">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center justify-center space-y-2.5">
                      <div className="w-8 h-8 border-4 border-indigo-650 border-t-transparent rounded-full animate-spin"></div>
                      <p className="text-xs font-extrabold text-indigo-600 uppercase tracking-widest animate-pulse">Loading Ledger Items...</p>
                    </div>
                  </td>
                </tr>
              ) : sortedTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
                    <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">No verified ledger items found</p>
                  </td>
                </tr>
              ) : (
                sortedTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50/35 transition-all text-xs">
                    {/* Date */}
                    <td className="px-6 py-4 text-gray-500 whitespace-nowrap" title={tx.transactionDate}>
                      {tx.transactionDate}
                    </td>

                    {/* Source Type */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[8px] font-bold uppercase tracking-wider ${
                        tx.sourceType === 'manual'
                          ? 'bg-amber-50 text-amber-700 border border-amber-100'
                          : 'bg-blue-50 text-blue-750 border border-blue-100'
                      }`}>
                        {tx.sourceType || 'email'}
                      </span>
                    </td>

                    {/* Merchant (Clickable text identifier to open modal) */}
                    <td
                      onClick={() => setSelectedGoldTransaction(tx)}
                      className="px-6 py-4 font-bold text-gray-900 cursor-pointer hover:text-emerald-700 hover:underline transition-colors max-w-[200px]"
                      title="Click to correct or view details"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="truncate">{tx.merchant}</span>
                        {tx.transactionType === 'refund' && (
                          <span className="bg-emerald-100 text-emerald-800 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full whitespace-nowrap uppercase tracking-wider border border-emerald-250/30">
                            Refund
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Category */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-bold uppercase text-[9px] border border-emerald-100/30">
                        {tx.category}
                      </span>
                    </td>

                    {/* Payment Method */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="bg-slate-50 text-slate-700 px-2 py-0.5 rounded font-bold uppercase text-[9px] border border-slate-100/30 max-w-[120px] truncate" title={tx.paymentMethod}>
                        {tx.paymentMethod || 'Unknown'}
                      </span>
                    </td>

                    {/* Notes */}
                    <td className="px-6 py-4 text-gray-500 max-w-[240px] truncate" title={tx.notes}>
                      {tx.notes || '-'}
                    </td>

                    {/* Amount + Currency */}
                    <td className={`px-6 py-4 font-extrabold text-right whitespace-nowrap ${tx.transactionType === 'refund' ? 'text-emerald-600' : 'text-gray-800'}`}>
                      {tx.transactionType === 'refund' ? '-' : ''}{tx.amount.toFixed(2)} {tx.currency}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Editing Detail Modal */}
      {(selectedGoldTransaction) && (
        <EmailDetailModal
          selectedEmail={null}
          setSelectedEmail={() => {}}
          markAsTransaction={async () => {}}
          markAsNonTransaction={async () => {}}
          approveTransaction={async () => {}}
          selectedGoldTransaction={selectedGoldTransaction}
          setSelectedGoldTransaction={setSelectedGoldTransaction}
          updateGoldTransaction={updateGoldTransaction}
          updateSilverTransaction={updateSilverTransaction}
          rawEmails={rawEmails}
          silverTransactions={silverTransactions}
          goldTransactions={goldTransactions}
          onDeleteClick={handleGoldDeleteClick}
          extractSelectedEmails={async () => {}}
          paymentMethods={paymentMethods}
        />
      )}

      {/* Delete/Reversion Modal */}
      <DeleteConfirmationModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
        lineage={deleteLineage}
        sourceStage={deleteSourceStage}
        isManual={isDeleteManual}
      />
    </div>
  );
};

export default GoldTransactions;
