import React, { useState, useMemo } from 'react';
import type { GoldTransaction, SilverTransaction } from '../../hooks/use-gmail-integration';
import { MultiSelect } from '../MultiSelect';
import { getSignedAmount, formatLocalTransactionTime } from '../../utils/transaction-helper';
import { BatchEditModal } from './BatchEditModal';

interface GoldLedgerListProps {
  goldTransactions: GoldTransaction[];
  setSelectedGoldTransaction: (tx: GoldTransaction) => void;
  onDeleteClick: (tx: GoldTransaction) => void;
  startDate: string;
  setStartDate: (val: string) => void;
  endDate: string;
  setEndDate: (val: string) => void;
  onBatchEditSave: (ids: string[], updates: any) => Promise<void>;
  paymentMethods: Array<{ id: string; name: string }>;
  silverTransactions: SilverTransaction[];
}

export const GoldLedgerList: React.FC<GoldLedgerListProps> = (props) => {
  const {
    goldTransactions,
    setSelectedGoldTransaction,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    onBatchEditSave,
    paymentMethods,
    silverTransactions,
  } = props;
  // Local Filter/Sort States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedCurrencies, setSelectedCurrencies] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'dateDesc' | 'dateAsc' | 'merchantAsc' | 'merchantDesc' | 'amountDesc' | 'amountAsc' | 'categoryAsc' | 'categoryDesc'>('dateDesc');
  const [checkedGoldIds, setCheckedGoldIds] = useState<string[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isBatchEditModalOpen, setIsBatchEditModalOpen] = useState(false);

  // Extract unique options from the confirmed transactions list
  const uniqueCategories = Array.from(
    new Set(goldTransactions.map(tx => tx.category).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const uniqueMethods = Array.from(
    new Set(goldTransactions.map(tx => tx.paymentMethod || 'Unknown'))
  ).sort((a, b) => a.localeCompare(b));

  const uniqueCurrencies = Array.from(
    new Set(goldTransactions.map(tx => tx.currency).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  // Client-side filtering logic
  const filteredTransactions = goldTransactions.filter(tx => {
    // Category Filter
    if (selectedCategories.length > 0 && !selectedCategories.includes(tx.category)) {
      return false;
    }

    // Method Filter
    if (selectedMethods.length > 0 && !selectedMethods.includes(tx.paymentMethod || 'Unknown')) {
      return false;
    }

    // Source Filter
    if (selectedSources.length > 0) {
      const sourceDisplay = tx.sourceType === 'manual' ? 'Manual Entry' : 'Email Ingested';
      if (!selectedSources.includes(sourceDisplay)) {
        return false;
      }
    }

    // Currency Filter
    if (selectedCurrencies.length > 0 && !selectedCurrencies.includes(tx.currency)) {
      return false;
    }

    // Search Query Filter
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;

    return (
      tx.merchant.toLowerCase().includes(query) ||
      tx.category.toLowerCase().includes(query) ||
      (tx.notes || '').toLowerCase().includes(query) ||
      (tx.paymentMethod || '').toLowerCase().includes(query) ||
      (tx.currency || '').toLowerCase().includes(query) ||
      (tx.transactionType || '').toLowerCase().includes(query) ||
      tx.amount.toString().includes(query)
    );
  });

  // Sorting logic
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
      case 'categoryAsc':
        return a.category.localeCompare(b.category);
      case 'categoryDesc':
        return b.category.localeCompare(a.category);
      default:
        return 0;
    }
  });

  const selectables = sortedTransactions;
  const allChecked = selectables.length > 0 && selectables.every(t => checkedGoldIds.includes(t.id));

  const handleSelectAllGold = () => {
    if (allChecked) {
      const selectableIds = selectables.map(t => t.id);
      setCheckedGoldIds(prev => prev.filter(id => !selectableIds.includes(id)));
    } else {
      const selectableIds = selectables.map(t => t.id);
      setCheckedGoldIds(prev => Array.from(new Set([...prev, ...selectableIds])));
    }
  };

  const toggleGoldCheck = (id: string) => {
    setCheckedGoldIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <div>
      <div className="border-b border-gray-100 bg-gray-50/70 flex justify-between items-center px-4 py-3">
        <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Gold Verified Transactions (Double-Entry Ledger)</span>
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{sortedTransactions.length} Verified Items</span>
      </div>
      
      {/* Unified Filters and Search Bar */}
      <div className="p-4 bg-gray-50/20 border-b border-gray-100 space-y-4">
        {/* Row 1: Sorting and Filters */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Sorting */}
          <div className="flex flex-col min-w-[150px]">
            <label htmlFor="gold-sort-select" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Sort By:
            </label>
            <select
              id="gold-sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-white border border-gray-200 rounded-xl outline-none text-xs font-bold text-gray-800 px-3.5 py-2 focus:border-indigo-500 transition-all cursor-pointer shadow-sm"
            >
              <option value="dateDesc">Date (Newest First)</option>
              <option value="dateAsc">Date (Oldest First)</option>
              <option value="merchantAsc">Merchant (A-Z)</option>
              <option value="merchantDesc">Merchant (Z-A)</option>
              <option value="amountDesc">Amount (High to Low)</option>
              <option value="amountAsc">Amount (Low to High)</option>
              <option value="categoryAsc">Category (A-Z)</option>
              <option value="categoryDesc">Category (Z-A)</option>
            </select>
          </div>

          {/* Category Filter */}
          <MultiSelect
            id="gold-category-filter"
            label="Category:"
            options={uniqueCategories}
            selectedValues={selectedCategories}
            onChange={setSelectedCategories}
            placeholder="All Categories"
          />

          {/* Payment Method Filter */}
          <MultiSelect
            id="gold-method-filter"
            label="Payment Method:"
            options={uniqueMethods}
            selectedValues={selectedMethods}
            onChange={setSelectedMethods}
            placeholder="All Payment Methods"
          />

          {/* Ingestion Source Filter */}
          <MultiSelect
            id="gold-source-filter"
            label="Source:"
            options={['Email Ingested', 'Manual Entry']}
            selectedValues={selectedSources}
            onChange={setSelectedSources}
            placeholder="All Ingestion Sources"
          />

          {/* Currency Filter */}
          <MultiSelect
            id="gold-currency-filter"
            label="Currency:"
            options={uniqueCurrencies}
            selectedValues={selectedCurrencies}
            onChange={setSelectedCurrencies}
            placeholder="All Currencies"
          />
        </div>

        {/* Row 2: Keyword Search and Date Filters */}
        <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-gray-100/60">
          {/* Keyword Search */}
          <div className="flex flex-col min-w-[200px] flex-grow md:max-w-xs">
            <label htmlFor="gold-search-input" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Keyword Search:
            </label>
            <input
              id="gold-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search verified ledger..."
              className="bg-white border border-gray-200 rounded-xl outline-none text-xs font-semibold text-gray-800 px-3.5 py-2 focus:border-indigo-500 transition-all shadow-sm"
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center space-x-2">
              <label htmlFor="gold-start-date" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Start Date:</label>
              <input 
                id="gold-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-white border border-gray-200 rounded-lg outline-none text-xs font-bold text-gray-755 px-2.5 py-1 focus:border-indigo-500 transition-colors shadow-sm"
              />
            </div>
            <div className="flex items-center space-x-2">
              <label htmlFor="gold-end-date" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">End Date:</label>
              <input 
                id="gold-end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-white border border-gray-200 rounded-lg outline-none text-xs font-bold text-gray-755 px-2.5 py-1 focus:border-indigo-500 transition-colors shadow-sm"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            <tr>
              <th className="px-2 py-2.5 text-center w-8">
                <input 
                  type="checkbox" 
                  checked={allChecked}
                  onChange={handleSelectAllGold}
                  className="rounded text-indigo-600 focus:ring-indigo-500 border-gray-350 cursor-pointer"
                />
              </th>
              {checkedGoldIds.length > 0 ? (
                <th colSpan={7} className="px-2 py-2 text-left bg-indigo-50/50">
                  <div className="flex items-center space-x-3">
                    <span className="text-xs font-bold text-indigo-700">{checkedGoldIds.length} Selected</span>
                    <div className="relative inline-block text-left">
                      <button
                        type="button"
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className="bg-white border border-indigo-200 text-indigo-700 text-[10px] font-bold px-3 py-1 rounded-lg uppercase tracking-wider flex items-center gap-1 shadow-sm hover:bg-indigo-50 transition-colors cursor-pointer"
                        id="gold-pipeline-bulk-actions-btn"
                        data-testid="gold-pipeline-bulk-actions-btn"
                      >
                        Bulk Actions ▾
                      </button>
                      {isDropdownOpen && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setIsDropdownOpen(false)} />
                          <div className="absolute left-0 mt-1 w-44 bg-white border border-gray-150 rounded-xl shadow-xl z-20 overflow-hidden divide-y divide-gray-50">
                            <button
                              type="button"
                              onClick={() => {
                                setIsDropdownOpen(false);
                                setIsBatchEditModalOpen(true);
                              }}
                              data-testid="gold-pipeline-bulk-edit-btn"
                              className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                              ✏️ Batch Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setIsDropdownOpen(false);
                                setCheckedGoldIds([]);
                              }}
                              className="w-full text-left px-4 py-2 text-xs text-gray-500 hover:bg-gray-50 font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                              ✕ Deselect All
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </th>
              ) : (
                <>
                  <th className="px-2 py-2.5 text-left">Date</th>
                  <th className="px-2 py-2.5 text-left">Source</th>
                  <th className="px-2 py-2.5 text-left">Merchant</th>
                  <th className="px-2 py-2.5 text-center">Category</th>
                  <th className="px-2 py-2.5 text-center">Method</th>
                  <th className="px-2 py-2.5 text-right">Amount</th>
                  <th className="px-2 py-2.5 text-center">Currency</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 bg-white">
            {sortedTransactions.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2 py-12 text-center">
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">No matching validated ledger items found</p>
                </td>
              </tr>
            ) : (
              sortedTransactions.map(tx => (
                <tr key={tx.id} className="hover:bg-gray-50/50 transition-colors text-xs">
                  <td className="px-2 py-2.5 text-center">
                    <input 
                      type="checkbox" 
                      checked={checkedGoldIds.includes(tx.id)}
                      onChange={() => toggleGoldCheck(tx.id)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 border-gray-350 cursor-pointer"
                    />
                  </td>
                  <td className="px-2 py-2.5 text-gray-500 whitespace-nowrap" title={tx.sourceReceivedAt || tx.transactionDate}>
                    <div className="flex flex-col">
                      <span className="font-semibold text-gray-800">{tx.transactionDate}</span>
                      {formatLocalTransactionTime(tx.sourceReceivedAt) && (
                        <span className="text-[9px] font-bold text-indigo-600 uppercase tracking-wide">
                          🕒 {formatLocalTransactionTime(tx.sourceReceivedAt)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 whitespace-nowrap">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                      tx.sourceType === 'manual' 
                        ? 'bg-amber-50 text-amber-700 border border-amber-100' 
                        : 'bg-blue-50 text-blue-750 border border-blue-100'
                    }`}>
                      {tx.sourceType || 'email'}
                    </span>
                  </td>
                  <td onClick={() => setSelectedGoldTransaction(tx)} className="px-2 py-2.5 font-bold text-gray-900 max-w-[180px] cursor-pointer hover:text-emerald-750 transition-colors">
                    <div className="flex items-center gap-1.5">
                      <div className="truncate">{tx.merchant}</div>
                      {tx.transactionType === 'refund' && (
                        <span className="bg-emerald-100 text-emerald-800 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full whitespace-nowrap uppercase tracking-wider border border-emerald-250/30">
                          Refund
                        </span>
                      )}
                      {tx.transactionType === 'transfer' && (
                        <span className="bg-indigo-100 text-indigo-800 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full whitespace-nowrap uppercase tracking-wider border border-indigo-250/30">
                          Transfer
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-bold uppercase text-[9px] border border-emerald-100/30 whitespace-nowrap">
                      {tx.category}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <span className="bg-slate-50 text-slate-700 px-2 py-0.5 rounded font-bold uppercase text-[9px] border border-slate-100/30 truncate max-w-[120px] whitespace-nowrap" title={tx.paymentMethod}>
                      {tx.paymentMethod || 'Unknown'}
                    </span>
                  </td>
                  <td className={`px-2 py-2.5 font-extrabold text-right whitespace-nowrap ${
                    tx.transactionType === 'refund' ? 'text-emerald-600' :
                    tx.transactionType === 'transfer' ? 'text-indigo-500' :
                    'text-gray-800'
                  }`}>
                    {tx.transactionType === 'refund' ? '-' : ''}{tx.amount.toFixed(2)}
                  </td>
                  <td className="px-2 py-2.5 text-center font-bold text-gray-555 whitespace-nowrap">
                    {tx.currency}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <BatchEditModal
        isOpen={isBatchEditModalOpen}
        onClose={() => setIsBatchEditModalOpen(false)}
        onSave={async (updates) => {
          await onBatchEditSave(checkedGoldIds, updates);
          setCheckedGoldIds([]);
        }}
        selectedCount={checkedGoldIds.length}
        paymentMethods={paymentMethods}
        goldTransactions={goldTransactions}
        silverTransactions={silverTransactions}
      />
    </div>
  );
};
