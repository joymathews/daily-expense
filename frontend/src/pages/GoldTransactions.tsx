import React, { useState } from 'react';
import { useGmailIntegration } from '../hooks/use-gmail-integration';
import type { GoldTransaction } from '../hooks/use-gmail-integration';
import { EmailDetailModal } from '../components/gmail/EmailDetailModal';
import { DeleteConfirmationModal } from '../components/gmail/DeleteConfirmationModal';
import { MultiSelect } from '../components/MultiSelect';

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
    fetchLlmLog,
  } = useGmailIntegration();

  // Search keyword state
  const [searchQuery, setSearchQuery] = useState('');

  // Filters state
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedCurrencies, setSelectedCurrencies] = useState<string[]>([]);

  // Sort state
  const [sortBy, setSortBy] = useState<'dateDesc' | 'dateAsc' | 'merchantAsc' | 'merchantDesc' | 'amountDesc' | 'amountAsc' | 'categoryAsc' | 'categoryDesc'>('dateDesc');

  // Dynamically extract unique categories and methods from gold transactions
  const uniqueCategories = Array.from(
    new Set(goldTransactions.map(tx => tx.category).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  // Spend panel collapse/visibility states
  const [isSpendPanelCollapsed, setIsSpendPanelCollapsed] = useState(false);
  const [hiddenCategories, setHiddenCategories] = useState<string[]>([]);
  const [isCustomizerOpen, setIsCustomizerOpen] = useState(false);



  const uniqueMethods = Array.from(
    new Set(goldTransactions.map(tx => tx.paymentMethod || 'Unknown'))
  ).sort((a, b) => a.localeCompare(b));

  const uniqueCurrencies = Array.from(
    new Set(goldTransactions.map(tx => tx.currency).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  // Modal control states
  const [selectedGoldTransaction, setSelectedGoldTransaction] = useState<GoldTransaction | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteLineage, setDeleteLineage] = useState<{ bronzeId?: string; silverId?: string; goldId?: string }>({});
  const [deleteSourceStage, setDeleteSourceStage] = useState<'bronze' | 'silver' | 'gold'>('gold');
  const [isDeleteManual, setIsDeleteManual] = useState(false);

  const handleGoldDeleteClick = (
    firstArg: GoldTransaction | 'bronze' | 'silver' | 'gold',
    secondArg?: { bronzeId?: string; silverId?: string; goldId?: string }
  ) => {
    setSelectedGoldTransaction(null);
    if (typeof firstArg === 'string') {
      const stage = firstArg;
      const lineage = secondArg || {};
      setDeleteLineage(lineage);
      setDeleteSourceStage(stage);
      
      const isManualGold = stage === 'gold' && !!lineage.goldId &&
        goldTransactions.some(g => g.id === lineage.goldId && g.sourceType === 'manual');
      setIsDeleteManual(isManualGold);
    } else {
      const tx = firstArg;
      setDeleteLineage({
        bronzeId: tx.bronzeInputId,
        silverId: tx.pendingTxId,
        goldId: tx.id,
      });
      setDeleteSourceStage('gold');
      setIsDeleteManual(tx.sourceType === 'manual');
    }
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

  // 1. Filter transactions by search query, category, payment method, and source type
  const filteredTransactions = goldTransactions.filter(tx => {
    // Check Category Filter (multi-select)
    if (selectedCategories.length > 0 && !selectedCategories.includes(tx.category)) {
      return false;
    }

    // Check Payment Method Filter (multi-select)
    if (selectedMethods.length > 0) {
      const method = tx.paymentMethod || 'Unknown';
      if (!selectedMethods.includes(method)) {
        return false;
      }
    }

    // Check Source Filter (multi-select)
    if (selectedSources.length > 0) {
      const sourceDisplay = tx.sourceType === 'manual' ? 'Manual Entry' : 'Email Ingested';
      if (!selectedSources.includes(sourceDisplay)) {
        return false;
      }
    }

    // Check Currency Filter (multi-select)
    if (selectedCurrencies.length > 0 && !selectedCurrencies.includes(tx.currency)) {
      return false;
    }

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

  const getSignedAmount = (t: GoldTransaction) => {
    if (t.transactionType === 'refund') return -t.amount;
    if (t.transactionType === 'transfer') return 0;
    return t.amount;
  };

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
      case 'categoryAsc':
        return a.category.localeCompare(b.category);
      case 'categoryDesc':
        return b.category.localeCompare(a.category);
      default:
        return 0;
    }
  });

  // Calculate dynamic spend aggregates for filtered transactions
  // Group by category, then currency (excluding transfers, refund acts as negative offset)
  const categorySpendTotals = sortedTransactions.reduce((acc, tx) => {
    if (tx.transactionType === 'transfer') return acc;
    
    const cat = tx.category || 'Other';
    const cur = tx.currency.toUpperCase();
    const amount = tx.transactionType === 'refund' ? -tx.amount : tx.amount;
    
    if (!acc[cat]) {
      acc[cat] = {};
    }
    acc[cat][cur] = (acc[cat][cur] || 0) + amount;
    return acc;
  }, {} as Record<string, Record<string, number>>);

  const visibleCategories = Object.keys(categorySpendTotals).filter(
    cat => !hiddenCategories.includes(cat)
  ).sort((a, b) => {
    const maxA = Math.max(...Object.values(categorySpendTotals[a] || {}));
    const maxB = Math.max(...Object.values(categorySpendTotals[b] || {}));
    return maxB - maxA;
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
        {/* Row 1: Sorting and Filters */}
        <div className="flex flex-wrap items-center gap-4">
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
              <option value="categoryAsc">Category (A-Z)</option>
              <option value="categoryDesc">Category (Z-A)</option>
            </select>
          </div>

          {/* Category Filter */}
          <MultiSelect
            id="category-filter"
            label="Category:"
            options={uniqueCategories}
            selectedValues={selectedCategories}
            onChange={setSelectedCategories}
            placeholder="All Categories"
          />

          {/* Payment Method Filter */}
          <MultiSelect
            id="method-filter"
            label="Payment Method:"
            options={uniqueMethods}
            selectedValues={selectedMethods}
            onChange={setSelectedMethods}
            placeholder="All Payment Methods"
          />

          {/* Ingestion Source Filter */}
          <MultiSelect
            id="source-filter"
            label="Source:"
            options={['Email Ingested', 'Manual Entry']}
            selectedValues={selectedSources}
            onChange={setSelectedSources}
            placeholder="All Ingestion Sources"
          />

          {/* Currency Filter */}
          <MultiSelect
            id="currency-filter"
            label="Currency:"
            options={uniqueCurrencies}
            selectedValues={selectedCurrencies}
            onChange={setSelectedCurrencies}
            placeholder="All Currencies"
          />
        </div>

        {/* Row 2: Keyword Search and Date Filters */}
        <div className="flex flex-wrap items-end justify-between gap-4 pt-4 border-t border-gray-100">
          <div className="flex flex-wrap items-center gap-4 flex-1">
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
          </div>

          {/* Clear Filters Button */}
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedCategories([]);
              setSelectedMethods([]);
              setSelectedSources([]);
              setSelectedCurrencies([]);
              setStartDate('');
              setEndDate('');
            }}
            className="bg-gray-55/60 hover:bg-gray-100 text-gray-600 hover:text-gray-850 text-[10px] font-bold px-4 py-2 rounded-xl transition-all uppercase tracking-wider cursor-pointer border border-gray-200 shadow-sm self-end"
          >
            🧹 Clear Filters
          </button>
        </div>

        {/* Aggregate Totals Summary */}
        <div className="pt-4 border-t border-gray-100 flex flex-wrap gap-4">
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

      {/* Category Spend Breakdown Panel */}
      <div className="bg-white border border-gray-150/60 rounded-3xl shadow-sm overflow-hidden flex flex-col">
        {/* Panel Header */}
        <div className="bg-gray-50/70 border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center">
            <span className="text-xs font-extrabold text-indigo-900 uppercase tracking-wider">
              📊 Category Spend Breakdown
            </span>
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider ml-3 bg-gray-100 px-2.5 py-0.5 rounded-full">
              {visibleCategories.length} Shown / {hiddenCategories.length} Hidden
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsCustomizerOpen(!isCustomizerOpen)}
              className="text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-750 transition-colors flex items-center gap-1 cursor-pointer"
            >
              ⚙️ Customize
            </button>
            <button
              onClick={() => setIsSpendPanelCollapsed(!isSpendPanelCollapsed)}
              className="text-[10px] font-bold uppercase tracking-wider text-indigo-650 hover:text-indigo-850 transition-colors flex items-center gap-1 cursor-pointer"
            >
              {isSpendPanelCollapsed ? 'Expand ▾' : 'Collapse ▴'}
            </button>
          </div>
        </div>

        {/* Customizer Checklist Block */}
        {isCustomizerOpen && (
          <div className="bg-slate-50/30 border-b border-gray-100 p-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                Select Categories to Display:
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setHiddenCategories([])}
                  className="text-[9px] font-bold uppercase text-indigo-600 hover:text-indigo-800 cursor-pointer"
                >
                  Show All
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => setHiddenCategories(uniqueCategories)}
                  className="text-[9px] font-bold uppercase text-red-500 hover:text-red-700 cursor-pointer"
                >
                  Hide All
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {uniqueCategories.map(cat => {
                const isVisible = !hiddenCategories.includes(cat);
                return (
                  <label
                    key={cat}
                    className={`inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer select-none ${
                      isVisible
                        ? 'bg-indigo-50/80 text-indigo-750 border-indigo-150 hover:bg-indigo-50'
                        : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onChange={() => {
                        if (isVisible) {
                          setHiddenCategories([...hiddenCategories, cat]);
                        } else {
                          setHiddenCategories(hiddenCategories.filter(c => c !== cat));
                        }
                      }}
                      className="mr-1.5 accent-indigo-650 cursor-pointer"
                    />
                    {cat}
                  </label>
                );
              })}
              {uniqueCategories.length === 0 && (
                <span className="text-xs text-gray-400 italic">No ledger categories available.</span>
              )}
            </div>
          </div>
        )}

        {/* Spend Cards Grid */}
        {!isSpendPanelCollapsed && (
          <div className="p-6">
            {visibleCategories.length === 0 ? (
              <div className="text-center py-8 bg-gray-50/30 border border-dashed border-gray-200 rounded-2xl">
                <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">
                  {Object.keys(categorySpendTotals).length === 0
                    ? 'No category spends to display'
                    : 'All category spend cards are hidden. Click "Customize" above to show them.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 animate-fade-in">
                {visibleCategories.map(cat => {
                  const currenciesSpend = categorySpendTotals[cat];
                  return (
                    <div
                      key={cat}
                      data-testid={`category-spend-card-${cat}`}
                      className="bg-emerald-50/30 hover:bg-emerald-50/50 border border-emerald-100/40 hover:border-emerald-100 rounded-2xl p-4 transition-all duration-200 hover:scale-[1.02] relative group shadow-sm flex flex-col justify-between min-h-[90px]"
                    >
                      {/* Hide button inside card */}
                      <button
                        onClick={() => setHiddenCategories([...hiddenCategories, cat])}
                        className="absolute top-2.5 right-2.5 text-emerald-350 hover:text-red-500 font-bold text-sm cursor-pointer transition-colors"
                        title={`Hide ${cat} spend card`}
                        aria-label={`Hide ${cat}`}
                      >
                        ×
                      </button>

                      <div className="space-y-2">
                        <span className="text-[10px] font-extrabold text-emerald-800 uppercase tracking-wider block pr-4">
                          {cat}
                        </span>
                        
                        <div className="space-y-1">
                          {Object.entries(currenciesSpend).map(([currency, total]) => {
                            let symbol = currency;
                            if (currency === 'INR') symbol = '₹';
                            else if (currency === 'USD') symbol = '$$';
                            else if (currency === 'EUR') symbol = '€';
                            else if (currency === 'GBP') symbol = '£';
                            
                            return (
                              <div key={currency} className="flex justify-between items-baseline">
                                <span className="text-[9px] font-extrabold text-emerald-850/60 uppercase tracking-wider">{currency}</span>
                                <span className="text-sm font-black text-emerald-600 Outfit">
                                  {symbol} {total.toFixed(2)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
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
                <th className="px-6 py-4 text-center">Currency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 bg-white">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center justify-center space-y-2.5">
                      <div className="w-8 h-8 border-4 border-indigo-650 border-t-transparent rounded-full animate-spin"></div>
                      <p className="text-xs font-extrabold text-indigo-600 uppercase tracking-widest animate-pulse">Loading Ledger Items...</p>
                    </div>
                  </td>
                </tr>
              ) : sortedTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center">
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
                        {tx.transactionType === 'transfer' && (
                          <span className="bg-indigo-100 text-indigo-800 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full whitespace-nowrap uppercase tracking-wider border border-indigo-250/30">
                            Transfer
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

                    {/* Amount */}
                    <td className={`px-6 py-4 font-extrabold text-right whitespace-nowrap ${
                      tx.transactionType === 'refund' ? 'text-emerald-600' :
                      tx.transactionType === 'transfer' ? 'text-indigo-500' :
                      'text-gray-800'
                    }`}>
                      {tx.transactionType === 'refund' ? '-' : ''}{tx.amount.toFixed(2)}
                    </td>

                    {/* Currency */}
                    <td className="px-6 py-4 font-bold text-center text-gray-650 whitespace-nowrap">
                      {tx.currency}
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
          fetchLlmLog={fetchLlmLog}
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
