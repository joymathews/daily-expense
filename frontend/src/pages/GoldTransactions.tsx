import React, { useState, useEffect, useMemo } from 'react';
import { useGmailIntegration } from '../hooks/use-gmail-integration';
import type { GoldTransaction } from '../hooks/use-gmail-integration';
import { EmailDetailModal } from '../components/gmail/EmailDetailModal';
import { DeleteConfirmationModal } from '../components/gmail/DeleteConfirmationModal';
import { MultiSelect } from '../components/MultiSelect';
import {
  getSignedAmount,
  computeDailySpendTimeline,
  formatLocalTransactionTime
} from '../utils/transaction-helper';
import { BatchEditModal } from '../components/gmail/BatchEditModal';
import { useUserCycles } from '../hooks/use-user-cycles';
import { CycleSelectorDropdown } from '../components/CycleSelectorDropdown';
import { CycleOverrideModal } from '../components/CycleOverrideModal';
import { filterTransactionsByCycle } from '../utils/cycle-helper';

const GoldTransactions: React.FC = () => {
  const { cycles, selectedCycle, setSelectedCycle, setCycleOverride, removeCycleOverride } = useUserCycles();
  const [isCycleModalOpen, setIsCycleModalOpen] = useState(false);

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
    updateGoldTransactionsBatch,
    revertOrDeleteRecord,
    paymentMethods,
    isLoading,
    fetchLlmLog,
  } = useGmailIntegration({ defaultToCycleRange: true });

  useEffect(() => {
    if (selectedCycle) {
      setStartDate(selectedCycle.startDate);
      if (selectedCycle.endDate) {
        setEndDate(selectedCycle.endDate);
      } else {
        setEndDate(new Date().toISOString().split('T')[0]);
      }
    }
  }, [selectedCycle]);

  // Search keyword state

  const [searchQuery, setSearchQuery] = useState('');

  // Filters state
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedCurrencies, setSelectedCurrencies] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);

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
  const [isTimelineCollapsed, setIsTimelineCollapsed] = useState(false);
  const [showAverageLine, setShowAverageLine] = useState(true);
  const [showTrendLine, setShowTrendLine] = useState(true);
  const [showCategoryBreakdown, setShowCategoryBreakdown] = useState(false);
  const [showDailyTimeline, setShowDailyTimeline] = useState(false);



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
  const [checkedGoldIds, setCheckedGoldIds] = useState<string[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isBatchEditModalOpen, setIsBatchEditModalOpen] = useState(false);

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

  // 1. Filter transactions by selected billing cycle (intra-day precision) and criteria
  const cycleFilteredTxs = useMemo(() => {
    if (!selectedCycle) return goldTransactions;
    const filtered = filterTransactionsByCycle(goldTransactions, selectedCycle);
    return (filtered.length === 0 && goldTransactions.length > 0) ? goldTransactions : filtered;
  }, [goldTransactions, selectedCycle]);

  const filteredTransactions = cycleFilteredTxs.filter(tx => {
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

    // Check Transaction Type Filter (multi-select)
    if (selectedTypes.length > 0) {
      const typeDisplay = tx.transactionType === 'refund' ? 'Refund' : tx.transactionType === 'transfer' ? 'Transfer' : 'Expense';
      if (!selectedTypes.includes(typeDisplay)) {
        return false;
      }
    }

    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;

    return (
      tx.merchant.toLowerCase().includes(query) ||
      tx.category.toLowerCase().includes(query) ||
      (tx.notes && tx.notes.toLowerCase().includes(query)) ||
      (tx.paymentMethod && tx.paymentMethod.toLowerCase().includes(query)) ||
      tx.sourceType.toLowerCase().includes(query) ||
      (tx.transactionType && tx.transactionType.toLowerCase().includes(query)) ||
      tx.amount.toString().includes(query) ||
      tx.currency.toLowerCase().includes(query)
    );
  });

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

  // Calculate dynamic spend aggregates for filtered transactions
  // Group by category, then currency (excluding transfers, refund acts as negative offset)
  const categorySpendTotals = sortedTransactions.reduce((acc, tx) => {
    if (tx.transactionType === 'transfer') return acc;
    
    const cat = tx.category || 'Other';
    const cur = tx.currency.toUpperCase();
    const amount = getSignedAmount(tx);
    
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


  const getTimelineDateRange = () => {
    if (startDate && endDate) {
      return { start: startDate, end: endDate };
    }
    if (sortedTransactions.length === 0) {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const start = `${year}-${month}-01`;
      const lastDay = new Date(year, today.getMonth() + 1, 0).getDate();
      const end = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
      return { start, end };
    }
    const dates = sortedTransactions.map(tx => tx.transactionDate).sort();
    const start = startDate || dates[0];
    const end = endDate || dates[dates.length - 1];
    return { start, end };
  };

  const timelineRange = getTimelineDateRange();
  const chartPoints = computeDailySpendTimeline(sortedTransactions, timelineRange.start, timelineRange.end);
  const maxDailyAmount = chartPoints.length > 0 ? Math.max(...chartPoints.map(p => p.amount)) : 0;

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
        <div className="flex items-center gap-3">
          <CycleSelectorDropdown
            cycles={cycles}
            selectedCycle={selectedCycle}
            onSelectCycle={setSelectedCycle}
          />
          <button
            type="button"
            onClick={() => setIsCycleModalOpen(true)}
            className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-lg border border-indigo-200 shadow-sm transition-all"
          >
            ⚙️ Configure Cycle
          </button>
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

          {/* Transaction Type Filter */}
          <MultiSelect
            id="type-filter"
            label="Type:"
            options={['Expense', 'Refund', 'Transfer']}
            selectedValues={selectedTypes}
            onChange={setSelectedTypes}
            placeholder="All Types"
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

            {/* Visual Panels Visibility Toggles */}
            <div className="flex items-center gap-4 border-l border-gray-200 pl-4 h-10 self-end">
              <label className="inline-flex items-center text-[10px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer select-none">
                <input
                  id="toggle-category-breakdown"
                  type="checkbox"
                  checked={showCategoryBreakdown}
                  onChange={(e) => setShowCategoryBreakdown(e.target.checked)}
                  className="mr-1.5 accent-indigo-650 cursor-pointer"
                />
                Show Category Breakdown
              </label>
              <label className="inline-flex items-center text-[10px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer select-none">
                <input
                  id="toggle-daily-timeline"
                  type="checkbox"
                  checked={showDailyTimeline}
                  onChange={(e) => setShowDailyTimeline(e.target.checked)}
                  className="mr-1.5 accent-indigo-650 cursor-pointer"
                />
                Show Daily Spend Timeline
              </label>
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
              setSelectedTypes([]);
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
      {showCategoryBreakdown && (
        <div className="bg-white border border-gray-150/60 rounded-3xl shadow-sm overflow-hidden flex flex-col" data-testid="category-spend-breakdown-panel">
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
      )}

      {/* Daily Spend Timeline (Chart panel driven by main filters context) */}
      {showDailyTimeline && (
        <div className="bg-white border border-gray-150/60 rounded-3xl shadow-sm overflow-hidden flex flex-col" data-testid="analysis-daily-spend-chart">
        {/* Panel Header */}
        <div className="bg-gray-50/70 border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center">
            <span className="text-xs font-extrabold text-indigo-900 uppercase tracking-wider">
              📈 Daily Spend Timeline
            </span>
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider ml-3 bg-gray-100 px-2.5 py-0.5 rounded-full">
              {timelineRange.start} to {timelineRange.end}
            </span>
          </div>
          <div className="flex items-center gap-4">
            {!isTimelineCollapsed && (
              <div className="flex items-center gap-3 border-r border-gray-200 pr-4 mr-1">
                <label className="inline-flex items-center text-[10px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showAverageLine}
                    onChange={(e) => setShowAverageLine(e.target.checked)}
                    className="mr-1.5 accent-indigo-650 cursor-pointer"
                  />
                  Avg
                </label>
                <label className="inline-flex items-center text-[10px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showTrendLine}
                    onChange={(e) => setShowTrendLine(e.target.checked)}
                    className="mr-1.5 accent-amber-500 cursor-pointer"
                  />
                  Trend
                </label>
              </div>
            )}
            <button
              onClick={() => setIsTimelineCollapsed(!isTimelineCollapsed)}
              className="text-[10px] font-bold uppercase tracking-wider text-indigo-650 hover:text-indigo-850 transition-colors flex items-center gap-1 cursor-pointer"
            >
              {isTimelineCollapsed ? 'Expand ▾' : 'Collapse ▴'}
            </button>
          </div>
        </div>

        {!isTimelineCollapsed && (
          <div className="p-6">
            {chartPoints.length === 0 ? (
              <div className="flex items-center justify-center h-80 border border-dashed border-gray-200 rounded-2xl bg-gray-50/20">
                <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">No transaction spend data for selected filter</p>
              </div>
            ) : (
              <div className="w-full relative pt-2">
                {/* SVG Render */}
                <svg viewBox="0 0 1000 220" className="w-full h-80 overflow-visible">
                  {/* Gradients */}
                  <defs>
                    <linearGradient id="chartGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#6366f1" />
                      <stop offset="100%" stopColor="#ffffff" />
                    </linearGradient>
                  </defs>

                  {/* SVG Chart Grid Lines & Axes */}
                  <line x1={70} y1={20} x2={980} y2={20} stroke="#f1f5f9" strokeWidth="1" />
                  <line x1={70} y1={100} x2={980} y2={100} stroke="#f1f5f9" strokeWidth="1" />
                  <line x1={70} y1={180} x2={980} y2={180} stroke="#cbd5e1" strokeWidth="1" />

                  <line x1={70} y1={20} x2={70} y2={180} stroke="#cbd5e1" strokeWidth="1" />

                  <line x1={65} y1={20} x2={70} y2={20} stroke="#cbd5e1" strokeWidth="1" />
                  <line x1={65} y1={100} x2={70} y2={100} stroke="#cbd5e1" strokeWidth="1" />
                  <line x1={65} y1={180} x2={70} y2={180} stroke="#cbd5e1" strokeWidth="1" />

                  <text x={60} y="23" textAnchor="end" fill="#64748b" className="text-[9px] font-bold font-sans">
                    ₹{maxDailyAmount.toFixed(0)}
                  </text>
                  <text x={60} y="103" textAnchor="end" fill="#64748b" className="text-[9px] font-bold font-sans">
                    ₹{(maxDailyAmount / 2).toFixed(0)}
                  </text>
                  <text x={60} y="183" textAnchor="end" fill="#64748b" className="text-[9px] font-bold font-sans">
                    ₹0
                  </text>

                  {(() => {
                    const chartMinX = 70;
                    const chartMaxX = 980;
                    const chartMinY = 20;
                    const chartMaxY = 180;
                    const chartWidth = chartMaxX - chartMinX;
                    const chartHeight = chartMaxY - chartMinY;

                    const stepX = chartPoints.length > 1 ? chartWidth / (chartPoints.length - 1) : chartWidth;

                    const coordinates = chartPoints.map((pt, index) => {
                      const x = chartMinX + index * stepX;
                      const y = maxDailyAmount > 0
                        ? chartMaxY - (pt.amount / maxDailyAmount) * chartHeight
                        : chartMaxY;
                      return { x, y };
                    });

                    const linePath = coordinates.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
                    const areaPath = coordinates.length > 0
                      ? `${linePath} L ${coordinates[coordinates.length - 1].x} ${chartMaxY} L ${coordinates[0].x} ${chartMaxY} Z`
                      : '';

                    // Calculate Average daily spend
                    const totalSpend = chartPoints.reduce((sum, p) => sum + p.amount, 0);
                    const averageDailySpend = chartPoints.length > 0 ? totalSpend / chartPoints.length : 0;
                    const averageY = maxDailyAmount > 0 ? chartMaxY - (averageDailySpend / maxDailyAmount) * chartHeight : chartMaxY;

                    // Calculate Linear Regression Trend (y = mx + c)
                    const n = chartPoints.length;
                    let slope = 0;
                    let intercept = 0;
                    if (n > 1) {
                      let sumX = 0;
                      let sumY = 0;
                      let sumXY = 0;
                      let sumXX = 0;
                      for (let i = 0; i < n; i++) {
                        sumX += i;
                        sumY += chartPoints[i].amount;
                        sumXY += i * chartPoints[i].amount;
                        sumXX += i * i;
                      }
                      const denominator = n * sumXX - sumX * sumX;
                      if (denominator !== 0) {
                        slope = (n * sumXY - sumX * sumY) / denominator;
                        intercept = (sumY - slope * sumX) / n;
                      } else {
                        slope = 0;
                        intercept = averageDailySpend;
                      }
                    } else if (n === 1) {
                      slope = 0;
                      intercept = chartPoints[0].amount;
                    }

                    const trendStartY = maxDailyAmount > 0 ? chartMaxY - (Math.max(0, intercept) / maxDailyAmount) * chartHeight : chartMaxY;
                    const trendEndY = maxDailyAmount > 0 ? chartMaxY - (Math.max(0, slope * (n - 1) + intercept) / maxDailyAmount) * chartHeight : chartMaxY;

                    const formatDateLabel = (d: string) => {
                      if (!d) return '';
                      const parts = d.split('-');
                      if (parts.length < 3) return d;
                      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                      const day = parseInt(parts[2], 10);
                      const monthIdx = parseInt(parts[1], 10) - 1;
                      return `${day} ${months[monthIdx] || ''}`;
                    };

                    const firstDateLabel = chartPoints.length > 0 ? formatDateLabel(chartPoints[0].date) : '';
                    const lastDateLabel = chartPoints.length > 1 ? formatDateLabel(chartPoints[chartPoints.length - 1].date) : '';
                    const middleIndex = chartPoints.length > 2 ? Math.floor(chartPoints.length / 2) : -1;
                    const middleDateLabel = middleIndex !== -1 ? formatDateLabel(chartPoints[middleIndex].date) : '';

                    return (
                      <>
                        {areaPath && <path d={areaPath} fill="url(#chartGrad)" className="opacity-30" />}
                        {linePath && <path d={linePath} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" />}
                        
                        {/* Average Line */}
                        {showAverageLine && chartPoints.length > 0 && maxDailyAmount > 0 && (
                          <>
                            <line x1={chartMinX} y1={averageY} x2={chartMaxX} y2={averageY} stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 4" />
                            <text x={chartMaxX - 5} y={averageY - 6} textAnchor="end" fill="#94a3b8" className="text-[8px] font-bold font-sans">
                              Avg: ₹{averageDailySpend.toFixed(1)}
                            </text>
                          </>
                        )}

                        {/* Trend Line */}
                        {showTrendLine && chartPoints.length > 1 && maxDailyAmount > 0 && (
                          <>
                            <line x1={chartMinX} y1={trendStartY} x2={chartMaxX} y2={trendEndY} stroke="#f59e0b" strokeWidth="2" strokeDasharray="3 3" />
                            <text x={chartMinX + 15} y={trendStartY - 6} textAnchor="start" fill="#f59e0b" className="text-[8px] font-bold font-sans">
                              Trend
                            </text>
                          </>
                        )}

                        {coordinates.map((c, i) => (
                          <g key={i} className="group cursor-pointer">
                            <circle cx={c.x} cy={c.y} r="3" fill="#6366f1" />
                            <circle cx={c.x} cy={c.y} r="6" fill="#6366f1" className="opacity-0 hover:opacity-20 transition-all" />
                            <title>{`${chartPoints[i].date}: ₹${chartPoints[i].amount.toFixed(2)}`}</title>
                          </g>
                        ))}

                        {chartPoints.length > 0 && (
                          <>
                            <line x1={chartMinX} y1="180" x2={chartMinX} y2="185" stroke="#cbd5e1" strokeWidth="1" />
                            <text x={chartMinX} y="198" textAnchor="middle" fill="#64748b" className="text-[8px] font-bold font-sans">
                              {firstDateLabel}
                            </text>

                            {middleIndex !== -1 && (
                              <>
                                <line x1={chartMinX + middleIndex * stepX} y1="180" x2={chartMinX + middleIndex * stepX} y2="185" stroke="#cbd5e1" strokeWidth="1" />
                                <text x={chartMinX + middleIndex * stepX} y="198" textAnchor="middle" fill="#64748b" className="text-[8px] font-bold font-sans">
                                  {middleDateLabel}
                                </text>
                              </>
                            )}

                            {lastDateLabel && (
                              <>
                                <line x1={chartMaxX} y1="180" x2={chartMaxX} y2="185" stroke="#cbd5e1" strokeWidth="1" />
                                <text x={chartMaxX} y="198" textAnchor="middle" fill="#64748b" className="text-[8px] font-bold font-sans">
                                  {lastDateLabel}
                                </text>
                              </>
                            )}
                          </>
                        )}
                      </>
                    );
                  })()}
                </svg>
              </div>
            )}
          </div>
        )}
      </div>
      )}

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
                <th className="px-6 py-4 text-center w-8">
                  <input 
                    type="checkbox" 
                    checked={allChecked}
                    onChange={handleSelectAllGold}
                    className="rounded text-indigo-600 focus:ring-indigo-500 border-gray-350 cursor-pointer"
                  />
                </th>
                {checkedGoldIds.length > 0 ? (
                  <th colSpan={7} className="px-6 py-4 text-left bg-indigo-50/50">
                    <div className="flex items-center space-x-3">
                      <span className="text-xs font-bold text-indigo-700">{checkedGoldIds.length} Selected</span>
                      <div className="relative inline-block text-left">
                        <button
                          type="button"
                          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                          className="bg-white border border-indigo-200 text-indigo-700 text-[10px] font-bold px-3 py-1.5 rounded-lg uppercase tracking-wider flex items-center gap-1 shadow-sm hover:bg-indigo-50 transition-colors cursor-pointer"
                          id="ledger-bulk-actions-btn"
                          data-testid="ledger-bulk-actions-btn"
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
                                data-testid="ledger-bulk-edit-btn"
                                className="w-full text-left px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50 font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                              >
                                ✏️ Batch Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setIsDropdownOpen(false);
                                  setCheckedGoldIds([]);
                                }}
                                className="w-full text-left px-4 py-2.5 text-xs text-gray-500 hover:bg-gray-50 font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
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
                    <th className="px-6 py-4 text-left">Date</th>
                    <th className="px-6 py-4 text-left">Source</th>
                    <th className="px-6 py-4 text-left">Merchant</th>
                    <th className="px-6 py-4 text-left">Category</th>
                    <th className="px-6 py-4 text-left">Method</th>
                    <th className="px-6 py-4 text-right">Amount</th>
                    <th className="px-6 py-4 text-center">Currency</th>
                  </>
                )}
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
                    <td className="px-6 py-4 text-center">
                      <input 
                        type="checkbox" 
                        checked={checkedGoldIds.includes(tx.id)}
                        onChange={() => toggleGoldCheck(tx.id)}
                        className="rounded text-indigo-600 focus:ring-indigo-500 border-gray-350 cursor-pointer"
                      />
                    </td>
                    {/* Date */}
                    <td className="px-6 py-4 text-gray-500 whitespace-nowrap" title={tx.sourceReceivedAt || tx.transactionDate}>
                      <div className="flex flex-col">
                        <span className="font-semibold text-gray-800">{tx.transactionDate}</span>
                        {formatLocalTransactionTime(tx.sourceReceivedAt) && (
                          <span className="text-[9px] font-bold text-indigo-600 uppercase tracking-wide">
                            🕒 {formatLocalTransactionTime(tx.sourceReceivedAt)}
                          </span>
                        )}
                      </div>
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
                        {tx.transactionType === 'fixed' && (
                          <span className="bg-blue-50 text-blue-750 text-[8px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap uppercase tracking-wider border border-blue-100">
                            Fixed Charge
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

                    {/* Amount */}
                    <td className={`px-6 py-4 font-extrabold text-right whitespace-nowrap ${
                      tx.transactionType === 'refund' ? 'text-emerald-600' :
                      tx.transactionType === 'transfer' ? 'text-indigo-500' :
                      tx.transactionType === 'fixed' ? 'text-blue-600/70' :
                      'text-gray-805'
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

      {/* Cycle Override Configuration Modal */}
      <CycleOverrideModal
        isOpen={isCycleModalOpen}
        onClose={() => setIsCycleModalOpen(false)}
        cycle={selectedCycle}
        transactions={goldTransactions.map(tx => ({
          id: tx.id,
          merchant: tx.merchant,
          amount: tx.amount,
          currency: tx.currency,
          transactionDate: tx.transactionDate,
          sourceReceivedAt: tx.sourceReceivedAt,
          category: tx.category,
        }))}
        onSaveOverride={async (payload) => {
          await setCycleOverride(payload);
        }}
        onResetDefault={async (cycleId) => {
          await removeCycleOverride(cycleId);
        }}
      />

      <BatchEditModal
        isOpen={isBatchEditModalOpen}
        onClose={() => setIsBatchEditModalOpen(false)}
        onSave={async (updates) => {
          await updateGoldTransactionsBatch(checkedGoldIds, updates);
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

export default GoldTransactions;
