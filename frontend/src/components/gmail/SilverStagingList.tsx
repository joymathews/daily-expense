import React, { useState } from 'react';
import type { SilverTransaction } from '../../hooks/use-gmail-integration';
import { MultiSelect } from '../MultiSelect';
import { getSignedAmount } from '../../utils/transaction-helper';

interface SilverStagingListProps {
  silverTransactions: SilverTransaction[];
  checkedSilverIds: string[];
  setCheckedSilverIds: React.Dispatch<React.SetStateAction<string[]>>;
  toggleSilverCheck: (id: string) => void;
  handleBatchApprove: () => void;
  handleReviewSilver: (tx: SilverTransaction) => void;
  onDeleteClick: (tx: SilverTransaction) => void;
  startDate: string;
  setStartDate: (val: string) => void;
  endDate: string;
  setEndDate: (val: string) => void;
}

export const SilverStagingList: React.FC<SilverStagingListProps> = (props) => {
  const {
    silverTransactions,
    checkedSilverIds,
    setCheckedSilverIds,
    toggleSilverCheck,
    handleBatchApprove,
    handleReviewSilver,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
  } = props;
  // Local Filter and Sort States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedCurrencies, setSelectedCurrencies] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'dateDesc' | 'dateAsc' | 'merchantAsc' | 'merchantDesc' | 'amountDesc' | 'amountAsc' | 'categoryAsc' | 'categoryDesc'>('dateDesc');

  // Filter out approved transactions first
  const visiblePending = silverTransactions.filter(tx => tx.status !== 'approved');
  const pendingCount = visiblePending.filter(t => t.status === 'pending' || t.status === 'error').length;
  const rejectedCount = visiblePending.filter(t => t.status === 'rejected').length;

  // Extract unique options dynamically from the pending transactions
  const uniqueCategories = Array.from(
    new Set(visiblePending.map(tx => tx.inferredCategory || 'Other'))
  ).sort((a, b) => a.localeCompare(b));

  const uniqueMethods = Array.from(
    new Set(visiblePending.map(tx => tx.paymentMethod || 'Unknown'))
  ).sort((a, b) => a.localeCompare(b));

  const uniqueCurrencies = Array.from(
    new Set(visiblePending.map(tx => tx.currency).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  // Client-side filtering logic
  const filteredTransactions = visiblePending.filter(tx => {
    // Category Filter
    if (selectedCategories.length > 0 && !selectedCategories.includes(tx.inferredCategory || 'Other')) {
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

    const merchant = (tx.merchantNormalized || tx.merchantRaw || '').toLowerCase();
    const subject = (tx.emailSubject || '').toLowerCase();
    const category = (tx.inferredCategory || 'Other').toLowerCase();
    const method = (tx.paymentMethod || 'Unknown').toLowerCase();
    const currency = (tx.currency || '').toLowerCase();

    return (
      merchant.includes(query) ||
      subject.includes(query) ||
      category.includes(query) ||
      method.includes(query) ||
      currency.includes(query) ||
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
        return (a.merchantNormalized || a.merchantRaw || '').localeCompare(b.merchantNormalized || b.merchantRaw || '');
      case 'merchantDesc':
        return (b.merchantNormalized || b.merchantRaw || '').localeCompare(a.merchantNormalized || a.merchantRaw || '');
      case 'amountAsc':
        return getSignedAmount(a) - getSignedAmount(b);
      case 'amountDesc':
        return getSignedAmount(b) - getSignedAmount(a);
      case 'categoryAsc':
        return (a.inferredCategory || 'Other').localeCompare(b.inferredCategory || 'Other');
      case 'categoryDesc':
        return (b.inferredCategory || 'Other').localeCompare(a.inferredCategory || 'Other');
      default:
        return 0;
    }
  });

  // Calculate local multi-select check bounds
  const selectables = sortedTransactions.filter(t => t.status !== 'error' && t.status !== 'rejected');
  const allChecked = selectables.length > 0 && selectables.every(t => checkedSilverIds.includes(t.id));

  const handleSelectAllSilver = () => {
    if (allChecked) {
      const selectableIds = selectables.map(t => t.id);
      setCheckedSilverIds(prev => prev.filter(id => !selectableIds.includes(id)));
    } else {
      const selectableIds = selectables.map(t => t.id);
      setCheckedSilverIds(prev => Array.from(new Set([...prev, ...selectableIds])));
    }
  };

  return (
    <div>
      <div className="border-b border-gray-100 bg-gray-50/70 flex flex-col sm:flex-row justify-between items-stretch sm:items-center px-4 py-3 gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">Silver Staging Table (Pending Approvals)</span>
          {checkedSilverIds.length > 0 && (
            <button
              onClick={handleBatchApprove}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1 rounded-lg transition-colors uppercase tracking-wider cursor-pointer"
            >
              🚀 Approve Selected ({checkedSilverIds.length})
            </button>
          )}
        </div>
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider self-start sm:self-auto">
          {pendingCount} Pending Items {rejectedCount > 0 && `| ${rejectedCount} Rejected`}
        </span>
      </div>
      
      {/* Unified Filters and Search Bar */}
      <div className="p-4 bg-gray-50/20 border-b border-gray-100 space-y-4">
        {/* Row 1: Sorting and Filters */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Sorting */}
          <div className="flex flex-col min-w-[150px]">
            <label htmlFor="silver-sort-select" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Sort By:
            </label>
            <select
              id="silver-sort-select"
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
            id="silver-category-filter"
            label="Category:"
            options={uniqueCategories}
            selectedValues={selectedCategories}
            onChange={setSelectedCategories}
            placeholder="All Categories"
          />

          {/* Payment Method Filter */}
          <MultiSelect
            id="silver-method-filter"
            label="Payment Method:"
            options={uniqueMethods}
            selectedValues={selectedMethods}
            onChange={setSelectedMethods}
            placeholder="All Payment Methods"
          />

          {/* Ingestion Source Filter */}
          <MultiSelect
            id="silver-source-filter"
            label="Source:"
            options={['Email Ingested', 'Manual Entry']}
            selectedValues={selectedSources}
            onChange={setSelectedSources}
            placeholder="All Ingestion Sources"
          />

          {/* Currency Filter */}
          <MultiSelect
            id="silver-currency-filter"
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
            <label htmlFor="silver-search-input" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Keyword Search:
            </label>
            <input
              id="silver-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search staging..."
              className="bg-white border border-gray-200 rounded-xl outline-none text-xs font-semibold text-gray-800 px-3.5 py-2 focus:border-indigo-500 transition-all shadow-sm"
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center space-x-2">
              <label htmlFor="silver-start-date" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Start Date:</label>
              <input 
                id="silver-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-white border border-gray-200 rounded-lg outline-none text-xs font-bold text-gray-755 px-2.5 py-1 focus:border-indigo-500 transition-colors shadow-sm"
              />
            </div>
            <div className="flex items-center space-x-2">
              <label htmlFor="silver-end-date" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">End Date:</label>
              <input 
                id="silver-end-date"
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
                  onChange={handleSelectAllSilver}
                  className="rounded text-indigo-600 focus:ring-indigo-500 border-gray-350 cursor-pointer"
                />
              </th>
              <th className="px-2 py-2.5 text-left">Date</th>
              <th className="px-2 py-2.5 text-left">Source</th>
              <th className="px-2 py-2.5 text-left">Merchant</th>
              <th className="px-2 py-2.5 text-center">Category</th>
              <th className="px-2 py-2.5 text-center">Method</th>
              <th className="px-2 py-2.5 text-right">Amount</th>
              <th className="px-2 py-2.5 text-center">Currency</th>
              <th className="px-2 py-2.5 text-center">Status / Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 bg-white">
            {sortedTransactions.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-2 py-12 text-center">
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">No matching pending transactions in staging</p>
                </td>
              </tr>
            ) : (
              sortedTransactions.map(tx => (
                <tr key={tx.id} className={`hover:bg-gray-50/50 transition-colors text-xs ${tx.status === 'error' ? 'bg-rose-50/30' : tx.status === 'rejected' ? 'bg-rose-50/10' : ''}`}>
                  <td className="px-2 py-2.5 text-center">
                    <input 
                      type="checkbox" 
                      checked={checkedSilverIds.includes(tx.id)}
                      disabled={tx.status === 'error' || tx.status === 'rejected'}
                      onChange={() => toggleSilverCheck(tx.id)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 border-gray-350 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                  </td>
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
                  <td onClick={() => handleReviewSilver(tx)} className="px-2 py-2.5 font-bold text-gray-900 max-w-[180px] cursor-pointer hover:text-indigo-650 transition-colors">
                    <div className="flex items-center gap-1.5">
                      <div className="truncate">{tx.merchantNormalized || tx.merchantRaw}</div>
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
                    <span className="bg-indigo-50/80 text-indigo-700 px-2 py-0.5 rounded font-bold uppercase text-[9px] border border-indigo-100/30 whitespace-nowrap">
                      {tx.inferredCategory || 'Other'}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <span className="bg-slate-50 text-slate-700 px-2 py-0.5 rounded font-bold uppercase text-[9px] border border-slate-100/30 truncate max-w-[120px] whitespace-nowrap" title={tx.paymentMethod}>
                      {tx.paymentMethod || 'Unknown'}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right font-bold text-gray-800 whitespace-nowrap">
                    {tx.amount.toFixed(2)}
                  </td>
                  <td className="px-2 py-2.5 text-center font-bold text-gray-555 whitespace-nowrap">
                    {tx.currency}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <div className="flex flex-col items-center">
                      <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[9px] border whitespace-nowrap ${
                        tx.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                        tx.status === 'rejected' ? 'bg-rose-50 text-rose-700 border-rose-100' :
                        tx.status === 'error' ? 'bg-rose-50 text-rose-700 border-rose-100' :
                        'bg-amber-50 text-amber-700 border-amber-100'
                      }`}>
                        {tx.status}
                      </span>
                    </div>
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
