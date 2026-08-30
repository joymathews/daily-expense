import React, { useState, useEffect } from 'react';
import { getApiUrl, getAuthHeaders } from '../api-config';
import {
  formatCurrency,
  formatDate,
  getActiveCycleRange,
  getSignedAmount,
  FinancialTransaction,
} from '@daily-expense/financial-core';

export const GoldLedger: React.FC = () => {
  const [loading, setLoading] = useState<boolean>(true);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [cycleInfo, setCycleInfo] = useState<{ start: string; end: string; today: string }>({
    start: '',
    end: '',
    today: '',
  });
  
  // Selected transaction for bottom sheet / detail card
  const [selectedTx, setSelectedTx] = useState<FinancialTransaction | null>(null);
  const [showSourceModal, setShowSourceModal] = useState<boolean>(false);
  const [sourceEmailBody, setSourceEmailBody] = useState<string | null>(null);
  const [isLoadingEmailBody, setIsLoadingEmailBody] = useState<boolean>(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect(() => {
    const bronzeId = selectedTx?.bronzeInputId || (selectedTx as any)?.bronzeEmailId || (selectedTx as any)?.rawEmailId;
    if (selectedTx && bronzeId) {
      setIsLoadingEmailBody(true);
      setSourceEmailBody(null);
      getAuthHeaders()
        .then((headers) => fetch(getApiUrl('/api/pipeline/raw-emails'), { headers }))
        .then((res) => res.json())
        .then((data) => {
          const emails = data.emails || [];
          const match = emails.find((e: any) => e.id === bronzeId);
          if (match) {
            setSourceEmailBody(match.rawBody || match.snippet || '');
          } else {
            setSourceEmailBody('Source raw email not found in active records.');
          }
        })
        .catch((err) => {
          console.warn('Failed to load raw email content', err);
          setSourceEmailBody('Failed to load email content.');
        })
        .finally(() => setIsLoadingEmailBody(false));
    } else {
      setSourceEmailBody(null);
    }
  }, [selectedTx?.id, selectedTx?.bronzeInputId]);

  const [categorySuggestions] = useState<string[]>([
    'Food & Dining',
    'Groceries',
    'Shopping',
    'Utilities',
    'Transportation',
    'Medical & Healthcare',
    'Entertainment',
    'Investments',
    'Other',
  ]);

  const loadTransactions = async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      // 1. Fetch user cycle boundaries & preferences
      const [prefRes, cycleRes] = await Promise.allSettled([
        fetch(getApiUrl('/api/pipeline/user-preferences'), { headers }).then((r) => r.json()),
        fetch(getApiUrl('/api/pipeline/user-cycles'), { headers }).then((r) => r.json()),
      ]);

      let cycleStart = '';
      let cycleEnd = '';

      if (cycleRes.status === 'fulfilled' && cycleRes.value?.activeCycle?.startDate) {
        cycleStart = cycleRes.value.activeCycle.startDate;
        cycleEnd = cycleRes.value.activeCycle.endDate || '';
      } else {
        const billingCycleStartDay =
          prefRes.status === 'fulfilled' && prefRes.value?.billingCycleStartDay
            ? prefRes.value.billingCycleStartDay
            : 17;
        const activeRange = getActiveCycleRange(billingCycleStartDay, now);
        cycleStart = activeRange.start;
        cycleEnd = activeRange.end;
      }

      setCycleInfo({ start: cycleStart, end: cycleEnd, today: todayStr });

      // 2. Query Gold Ledger constrained strictly from current cycle start to current date (today)
      const queryUrl = `/api/pipeline/gold-transactions?startDate=${cycleStart}&endDate=${todayStr}`;
      const res = await fetch(getApiUrl(queryUrl), { headers });
      const data = await res.json();

      if (Array.isArray(data?.transactions)) {
        // Enforce strict cycle start to current date filtering
        const scopedTransactions = data.transactions
          .filter((tx: FinancialTransaction) => {
            if (!tx.transactionDate) return false;
            return tx.transactionDate >= cycleStart && tx.transactionDate <= todayStr;
          })
          .sort((a: any, b: any) => b.transactionDate.localeCompare(a.transactionDate));

        setTransactions(scopedTransactions);
      }
    } catch (_err) {
      // Handled gracefully
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTransactions();
  }, []);

  // Filter by search query (merchant, category, method, currency)
  const filteredTxs = transactions.filter((tx) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (tx.merchant && tx.merchant.toLowerCase().includes(q)) ||
      (tx.category && tx.category.toLowerCase().includes(q)) ||
      (tx.paymentMethod && tx.paymentMethod.toLowerCase().includes(q)) ||
      (tx.currency && tx.currency.toLowerCase().includes(q)) ||
      (tx.transactionType && tx.transactionType.toLowerCase().includes(q))
    );
  });

  // 1. Save Changes to Gold Transaction
  const handleSaveChanges = async () => {
    if (!selectedTx || !selectedTx.id) return;
    setIsSaving(true);

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(getApiUrl(`/api/pipeline/gold-transactions/${selectedTx.id}`), {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          merchant: selectedTx.merchant,
          amount: Number(selectedTx.amount) || 0,
          currency: selectedTx.currency || 'INR',
          category: selectedTx.category,
          transactionDate: selectedTx.transactionDate,
          paymentMethod: selectedTx.paymentMethod,
          transactionType: selectedTx.transactionType,
          notes: selectedTx.notes,
        }),
      });

      if (res.ok) {
        setActionSuccessMessage('✓ Transaction corrections saved!');
        setTimeout(() => setActionSuccessMessage(null), 2500);

        // Update in local state
        setTransactions((prev) =>
          prev.map((t) => (t.id === selectedTx.id ? { ...t, ...selectedTx } : t))
        );
        setSelectedTx(null);
      } else {
        alert('Failed to update transaction.');
      }
    } catch (err: any) {
      alert(`Save error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // 2. Revert Gold Transaction to Silver
  const handleRevertToSilver = async () => {
    if (!selectedTx || !selectedTx.id) return;

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(getApiUrl('/api/pipeline/revert-to-silver'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ goldId: selectedTx.id }),
      });

      if (res.ok) {
        setActionSuccessMessage('Transaction reverted to Silver Staging stage');
        setTimeout(() => setActionSuccessMessage(null), 2500);

        setTransactions((prev) => prev.filter((t) => t.id !== selectedTx.id));
        setSelectedTx(null);
      } else {
        alert('Failed to revert transaction to Silver.');
      }
    } catch (err: any) {
      alert(`Revert error: ${err.message}`);
    }
  };

  if (selectedTx && showSourceModal) {
    return (
      <div className="max-w-md mx-auto px-4 pt-3 pb-8 space-y-3" data-testid="source-email-reader-view">
        {/* Header with Back button */}
        <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5">
          <button
            onClick={() => setShowSourceModal(false)}
            className="flex items-center space-x-1.5 text-xs font-bold text-slate-700 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-xl active:scale-95 shadow-2xs hover:bg-slate-200 transition-colors cursor-pointer"
            data-testid="back-to-edit-btn"
          >
            <span>←</span>
            <span>Back to Edit</span>
          </button>
          <span className="text-3xs font-bold uppercase tracking-wider text-indigo-600">
            Source Email
          </span>
        </div>

        {/* Compact Email Details */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs space-y-2.5">
          <div>
            <h3 className="text-sm font-bold text-slate-900 Outfit truncate">
              {selectedTx.sourceTitle || selectedTx.merchant}
            </h3>
            <p className="text-3xs text-slate-500 font-medium">
              <span>From: </span><span className="text-slate-700 font-semibold">{selectedTx.sourceSender || 'Unknown'}</span>
              <span> • Date: </span><span className="text-indigo-600 font-semibold">{selectedTx.sourceReceivedAt ? formatDate(selectedTx.sourceReceivedAt.split('T')[0]) : selectedTx.transactionDate}</span>
            </p>
          </div>

          {/* Email Body Message */}
          <div className="pt-2 border-t border-slate-100 space-y-1">
            <span className="text-3xs font-bold uppercase tracking-wider text-slate-400 block">Message Content</span>
            <div
              className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-2xs text-slate-700 font-mono leading-relaxed whitespace-pre-wrap max-h-[60vh] overflow-y-auto"
              data-testid="source-email-message-body"
            >
              {isLoadingEmailBody
                ? 'Loading email message content...'
                : sourceEmailBody || 'No raw message body payload attached to this record.'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (selectedTx) {
    return (
      <div className="max-w-md mx-auto px-4 pt-3 pb-8 space-y-4" data-testid="transaction-detail-modal">
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs space-y-3.5">
          
          {/* Compact Header: Title + Back Icon */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="min-w-0 pr-2">
              <h2 className="text-base font-bold text-slate-900 Outfit truncate" data-testid="edit-header-merchant">
                {selectedTx.merchant}
              </h2>
              {/* Inline Source Date & Sender Address Link */}
              <button
                type="button"
                onClick={() => setShowSourceModal(true)}
                className="inline-flex items-center space-x-1 text-3xs text-indigo-600 hover:text-indigo-800 font-semibold hover:underline transition-colors cursor-pointer text-left truncate max-w-[280px]"
                data-testid="detail-view-source-btn"
              >
                <span>📄</span>
                <span>
                  {selectedTx.sourceReceivedAt ? formatDate(selectedTx.sourceReceivedAt.split('T')[0]) : selectedTx.transactionDate || 'Source Email'}
                </span>
                {selectedTx.sourceSender && (
                  <span className="text-slate-500 font-medium truncate">
                    • {selectedTx.sourceSender}
                  </span>
                )}
                <span className="text-[9px]">↗</span>
              </button>
            </div>

            <button
              onClick={() => setSelectedTx(null)}
              className="p-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100 active:scale-95 transition-all shadow-2xs cursor-pointer flex-shrink-0"
              data-testid="close-detail-modal-btn"
              aria-label="Back to Transactions"
            >
              <span className="text-xs font-bold">←</span>
            </button>
          </div>

          {/* Editable Fields */}
          <div className="space-y-3">
            {/* Merchant */}
            <div>
              <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Merchant Name:</label>
              <input
                type="text"
                value={selectedTx.merchant || ''}
                onChange={(e) => setSelectedTx({ ...selectedTx, merchant: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 font-bold focus:outline-none focus:border-indigo-500 focus:bg-white"
                data-testid="edit-tx-merchant"
              />
            </div>

            {/* Amount & Currency */}
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Amount:</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={selectedTx.amount}
                  onChange={(e) => setSelectedTx({ ...selectedTx, amount: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 font-extrabold Outfit focus:outline-none focus:border-indigo-500 focus:bg-white"
                  data-testid="edit-tx-amount"
                />
              </div>
              <div>
                <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Currency:</label>
                <select
                  value={selectedTx.currency || 'INR'}
                  onChange={(e) => setSelectedTx({ ...selectedTx, currency: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2.5 text-xs text-slate-900 font-semibold focus:outline-none focus:border-indigo-500 focus:bg-white cursor-pointer"
                  data-testid="edit-tx-currency"
                >
                  <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                </select>
              </div>
            </div>

            {/* Category & Payment Method */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Category:</label>
                <input
                  type="text"
                  list="category-options-ledger"
                  value={selectedTx.category || ''}
                  onChange={(e) => setSelectedTx({ ...selectedTx, category: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-900 font-medium focus:outline-none focus:border-indigo-500 focus:bg-white"
                  data-testid="edit-tx-category"
                />
                <datalist id="category-options-ledger">
                  {categorySuggestions.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Payment Method:</label>
                <input
                  type="text"
                  value={selectedTx.paymentMethod || ''}
                  onChange={(e) => setSelectedTx({ ...selectedTx, paymentMethod: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-900 font-medium focus:outline-none focus:border-indigo-500 focus:bg-white"
                  data-testid="edit-tx-method"
                />
              </div>
            </div>

            {/* Transaction Date & Type */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Date:</label>
                <input
                  type="date"
                  value={selectedTx.transactionDate}
                  onChange={(e) => setSelectedTx({ ...selectedTx, transactionDate: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-900 font-medium focus:outline-none focus:border-indigo-500 focus:bg-white"
                  data-testid="edit-tx-date"
                />
              </div>

              <div>
                <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Type:</label>
                <select
                  value={selectedTx.transactionType || 'expense'}
                  onChange={(e) => setSelectedTx({ ...selectedTx, transactionType: e.target.value as any })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2.5 text-xs text-slate-900 font-semibold focus:outline-none focus:border-indigo-500 focus:bg-white cursor-pointer"
                  data-testid="edit-tx-type"
                >
                  <option value="expense">Expense</option>
                  <option value="refund">Refund</option>
                  <option value="transfer">Transfer (Own)</option>
                  <option value="fixed">Fixed Charge</option>
                </select>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-3">
            <button
              onClick={handleRevertToSilver}
              className="w-full bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 font-bold py-3.5 rounded-2xl text-xs flex items-center justify-center space-x-1 active:scale-95 transition-all cursor-pointer shadow-2xs min-h-[48px]"
              data-testid="revert-to-silver-btn"
            >
              <span>↩</span>
              <span>Revert to Silver</span>
            </button>

            <button
              onClick={handleSaveChanges}
              disabled={isSaving}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-3.5 rounded-2xl text-xs flex items-center justify-center space-x-1.5 shadow-sm shadow-indigo-600/20 active:scale-95 transition-all cursor-pointer min-h-[48px]"
              data-testid="save-tx-changes-btn"
            >
              <span>{isSaving ? 'Saving...' : '✓ Save Changes'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-28 space-y-5" data-testid="mobile-gold-ledger">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Confirmed Ledger</span>
          <h1 className="text-2xl font-extrabold text-slate-900 Outfit">Transactions</h1>
        </div>
        <button
          onClick={loadTransactions}
          disabled={loading}
          className="p-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs flex items-center space-x-1.5 active:scale-95 shadow-2xs hover:bg-slate-50 cursor-pointer"
          data-testid="refresh-ledger-btn"
        >
          <span className={loading ? 'animate-spin inline-block' : ''}>🔄</span>
          <span className="font-semibold">Refresh</span>
        </button>
      </div>

      {/* Cycle Scope Header Banner */}
      {cycleInfo.start && (
        <div
          className="bg-white border border-slate-200/80 rounded-2xl p-3.5 flex items-center justify-between shadow-xs"
          data-testid="cycle-scope-banner"
        >
          <div className="space-y-0.5">
            <div className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600">Active Cycle Scope</span>
            </div>
            <p className="text-xs font-bold text-slate-900">
              {formatDate(cycleInfo.start)} – <span className="text-emerald-600 font-extrabold">Today ({formatDate(cycleInfo.today)})</span>
            </p>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-slate-400 uppercase font-black tracking-wider block">Cycle Spend</span>
            <span className="text-sm font-black text-slate-900 Outfit" data-testid="cycle-spend-total">
              {formatCurrency(
                filteredTxs.reduce((acc, tx) => {
                  if (tx.transactionType === 'transfer') return acc;
                  return acc + getSignedAmount(tx);
                }, 0),
                filteredTxs[0]?.currency || 'INR'
              )}
            </span>
          </div>
        </div>
      )}

      {/* Success Notification Banner */}
      {actionSuccessMessage && (
        <div
          className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-2xl text-xs font-semibold flex items-center space-x-2 shadow-xs"
          data-testid="ledger-success-banner"
        >
          <span>✓</span>
          <span>{actionSuccessMessage}</span>
        </div>
      )}

      {/* Search Filter Bar */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search merchant, category, currency..."
          className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 shadow-2xs"
          data-testid="ledger-search-input"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-xs font-bold cursor-pointer"
          >
            ✕
          </button>
        )}
      </div>

      {/* Transactions Feed List */}
      <div className="space-y-2.5" data-testid="ledger-transactions-list">
        {loading ? (
          <div className="text-center py-12 text-slate-400 text-xs">
            <span className="animate-spin inline-block text-lg mb-2">🔄</span>
            <p>Loading confirmed ledger...</p>
          </div>
        ) : filteredTxs.length === 0 ? (
          <div className="bg-white border border-slate-200/80 rounded-3xl p-8 text-center space-y-2 shadow-xs">
            <span className="text-2xl block mb-1">🔍</span>
            <p className="text-xs text-slate-500">No transactions found matching your criteria.</p>
          </div>
        ) : (
          filteredTxs.map((tx) => {
            const isRefund = tx.transactionType === 'refund';
            const isTransfer = tx.transactionType === 'transfer';
            const isFixed = tx.transactionType === 'fixed';

            return (
              <div
                key={tx.id}
                onClick={() => setSelectedTx({ ...tx })}
                className="bg-white active:bg-slate-50 border border-slate-200/80 hover:border-indigo-300 rounded-2xl p-4 transition-all flex items-center justify-between cursor-pointer shadow-xs"
                data-testid={`tx-row-${tx.id}`}
              >
                {/* Left details */}
                <div className="space-y-1 pr-2 min-w-0">
                  <div className="flex items-center space-x-1.5">
                    <h4 className="text-sm font-extrabold text-slate-900 Outfit truncate" data-testid="tx-merchant-name">
                      {tx.merchant || 'Unknown Merchant'}
                    </h4>
                    {isRefund && (
                      <span className="bg-rose-50 text-rose-700 text-[9px] font-black uppercase px-1.5 py-0.5 rounded border border-rose-200">
                        Refund
                      </span>
                    )}
                    {isTransfer && (
                      <span className="bg-indigo-50 text-indigo-700 text-[9px] font-black uppercase px-1.5 py-0.5 rounded border border-indigo-200">
                        Transfer
                      </span>
                    )}
                    {isFixed && (
                      <span className="bg-purple-50 text-purple-700 text-[9px] font-black uppercase px-1.5 py-0.5 rounded border border-purple-200">
                        Fixed
                      </span>
                    )}
                  </div>

                  <div className="flex items-center space-x-2 text-3xs text-slate-400">
                    <span className="font-medium text-slate-500">{formatDate(tx.transactionDate)}</span>
                    <span>•</span>
                    <span className="text-slate-600 font-semibold truncate">{tx.category || 'Other'}</span>
                  </div>
                </div>

                {/* Right Amount & Currency Display */}
                <div className="text-right flex-shrink-0">
                  <span
                    className={`text-sm font-black Outfit block ${
                      isRefund ? 'text-rose-600' : isTransfer ? 'text-indigo-600' : 'text-slate-900'
                    }`}
                    data-testid="tx-amount-display"
                  >
                    {isRefund ? '-' : ''}
                    {formatCurrency(tx.amount, tx.currency || 'INR')}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block" data-testid="tx-currency-tag">
                    {tx.currency || 'INR'}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

    </div>
  );
};
