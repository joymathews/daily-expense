import React, { useState } from 'react';
import type { GoldTransaction } from '../../hooks/use-gmail-integration';
import { MultiSelect } from '../MultiSelect';
import { getSignedAmount } from '../../utils/transaction-helper';

interface GoldLedgerListProps {
  goldTransactions: GoldTransaction[];
  setSelectedGoldTransaction: (tx: GoldTransaction) => void;
  onDeleteClick: (tx: GoldTransaction) => void;
  startDate: string;
  setStartDate: (val: string) => void;
  endDate: string;
  setEndDate: (val: string) => void;
}

export const GoldLedgerList: React.FC<GoldLedgerListProps> = (props) => {
  const {
    goldTransactions,
    setSelectedGoldTransaction,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
  } = props;
  // Local Filter/Sort States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedCurrencies, setSelectedCurrencies] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'dateDesc' | 'dateAsc' | 'merchantAsc' | 'merchantDesc' | 'amountDesc' | 'amountAsc' | 'categoryAsc' | 'categoryDesc'>('dateDesc');

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
              <th className="px-2 py-2.5 text-left">Date</th>
              <th className="px-2 py-2.5 text-left">Source</th>
              <th className="px-2 py-2.5 text-left">Merchant</th>
              <th className="px-2 py-2.5 text-center">Category</th>
              <th className="px-2 py-2.5 text-center">Method</th>
              <th className="px-2 py-2.5 text-left">Notes</th>
              <th className="px-2 py-2.5 text-right">Amount</th>
              <th className="px-2 py-2.5 text-center">Currency</th>
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
                  <td className="px-2 py-2.5 text-gray-500 max-w-[120px] truncate" title={tx.transactionDate}>
                    {tx.transactionDate}
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
                  <td className="px-2 py-2.5 text-left text-gray-555 max-w-[180px] truncate" title={tx.notes}>
                    {tx.notes || '-'}
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
    </div>
  );
};
