import React, { useState, useEffect } from 'react';
import { getApiUrl, getAuthHeaders } from '../api-config';
import { formatDate } from '@daily-expense/financial-core';

interface RawInputEmail {
  id: string;
  sender: string;
  title: string;
  snippet: string;
  rawBody: string;
  receivedAt: string;
  status?: string;
  hasTransaction?: boolean;
}

interface SilverTransaction {
  id: string;
  bronzeInputId: string;
  merchantRaw?: string;
  merchantNormalized?: string;
  amount: number;
  currency: string;
  transactionDate: string;
  inferredCategory?: string;
  paymentMethod?: string;
  transactionType?: 'expense' | 'refund' | 'transfer' | 'fixed';
  sourceTitle?: string;
  sourceSender?: string;
  sourceReceivedAt?: string;
}

export const IngestionTriage: React.FC = () => {
  // Fetch Config state
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);

  // Queue state
  const [rawEmails, setRawEmails] = useState<RawInputEmail[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  
  // Current active Silver card being verified
  const [activeSilver, setActiveSilver] = useState<SilverTransaction | null>(null);
  const [showSourceModal, setShowSourceModal] = useState<boolean>(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  // Multi-Sender Pill State
  const [savedSenderSuggestions, setSavedSenderSuggestions] = useState<string[]>([]);
  const [selectedSenders, setSelectedSenders] = useState<string[]>([]);
  const [isAddingCustomSender, setIsAddingCustomSender] = useState<boolean>(false);
  const [customSenderInput, setCustomSenderInput] = useState<string>('');

  const [categorySuggestions] = useState<string[]>([
    'Food & Dining',
    'Shopping',
    'Groceries',
    'Bills & Utilities',
    'Entertainment',
    'Travel & Commute',
    'Healthcare',
    'Investments',
    'Other',
  ]);

  // Initialize dates and load initial raw inputs & sender emails
  useEffect(() => {
    const today = new Date();
    const end = today.toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const start = thirtyDaysAgo.toISOString().split('T')[0];
    setStartDate(start);
    setEndDate(end);

    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    try {
      const headers = await getAuthHeaders();
      const [rawRes, senderRes] = await Promise.allSettled([
        fetch(getApiUrl('/api/pipeline/raw-inputs'), { headers }).then((r) => r.json()),
        fetch(getApiUrl('/api/ingestion/fetcher-emails'), { headers }).then((r) => r.json()),
      ]);

      if (rawRes.status === 'fulfilled') {
        const emails = rawRes.value?.emails || [];
        const unprocessed = emails.filter((e: RawInputEmail) => e.status !== 'processed' && e.status !== 'rejected');
        setRawEmails(unprocessed);
      }

      if (senderRes.status === 'fulfilled') {
        const val = senderRes.value;
        const senders: string[] = Array.isArray(val?.fetcherEmails)
          ? val.fetcherEmails
          : Array.isArray(val?.emails)
          ? val.emails
          : [];
        setSavedSenderSuggestions(senders);
        // Pre-select ALL saved senders by default
        setSelectedSenders(senders);
      }
    } catch (_err) {
      // Handled gracefully
    }
  };

  const toggleSender = (email: string) => {
    setSelectedSenders((prev) =>
      prev.includes(email) ? prev.filter((s) => s !== email) : [...prev, email]
    );
  };

  const handleAddCustomSender = () => {
    const trimmed = customSenderInput.trim();
    if (!trimmed) return;
    if (!savedSenderSuggestions.includes(trimmed)) {
      setSavedSenderSuggestions((prev) => [...prev, trimmed]);
    }
    if (!selectedSenders.includes(trimmed)) {
      setSelectedSenders((prev) => [...prev, trimmed]);
    }
    setCustomSenderInput('');
    setIsAddingCustomSender(false);
  };

  // 1. Fetch Receipts via Gmail
  const handleFetchEmails = async () => {
    if (selectedSenders.length === 0) {
      alert('Please select at least one sender email address.');
      return;
    }

    setIsFetching(true);
    setFetchMessage('Connecting to Gmail & fetching receipts...');

    try {
      const headers = await getAuthHeaders();

      // Auto-persist any newly added senders to database
      for (const s of selectedSenders) {
        try {
          await fetch(getApiUrl('/api/ingestion/fetcher-emails'), {
            method: 'POST',
            headers,
            body: JSON.stringify({ email: s }),
          });
        } catch (_e) {
          // Ignore if already saved
        }
      }

      const res = await fetch(getApiUrl('/api/ingestion/gmail/fetch'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          accessToken: 'demo-mobile-token', // Handled by server or demo token
          filters: {
            sender: selectedSenders,
            startDate,
            endDate,
          },
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setFetchMessage(`Fetched ${data.emails?.length || 0} emails!`);
        await loadInitialData();
        setCurrentIndex(0);
        setActiveSilver(null);
      } else {
        setFetchMessage(`Fetch notice: ${data.error || 'Check configuration'}`);
        await loadInitialData();
      }
    } catch (err: any) {
      setFetchMessage(`Error: ${err.message}`);
    } finally {
      setIsFetching(false);
      setTimeout(() => setFetchMessage(null), 4000);
    }
  };

  const currentEmail = rawEmails[currentIndex] || null;

  // 2. Reject Bronze Email (Mark non-transactional & reject)
  const handleRejectBronze = async () => {
    if (!currentEmail) return;
    try {
      const headers = await getAuthHeaders();
      await fetch(getApiUrl(`/api/pipeline/raw-inputs/${currentEmail.id}`), {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          hasTransaction: false,
          status: 'rejected',
        }),
      });

      setActionSuccessMessage('Email marked as Non-Transactional and Rejected');
      setTimeout(() => setActionSuccessMessage(null), 2500);

      // Advance to next email
      const updated = rawEmails.filter((_, idx) => idx !== currentIndex);
      setRawEmails(updated);
      if (currentIndex >= updated.length) {
        setCurrentIndex(Math.max(0, updated.length - 1));
      }
    } catch (err: any) {
      alert(`Failed to reject: ${err.message}`);
    }
  };

  // 3. Accept Bronze Email & Immediately Extract to Silver
  const handleAcceptBronze = async () => {
    if (!currentEmail) return;
    setIsExtracting(true);

    try {
      const headers = await getAuthHeaders();

      // Trigger LLM Extraction for this specific email
      const res = await fetch(getApiUrl('/api/pipeline/extract'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          rawEmailIds: [currentEmail.id],
        }),
      });

      const data = await res.json();
      if (res.ok && data.extracted && data.extracted.length > 0) {
        const extractedTx = data.extracted[0];
        setActiveSilver({
          id: extractedTx.id,
          bronzeInputId: currentEmail.id,
          merchantRaw: extractedTx.merchantRaw || extractedTx.merchantNormalized || currentEmail.sender,
          merchantNormalized: extractedTx.merchantNormalized || extractedTx.merchantRaw || 'Merchant',
          amount: extractedTx.amount || 0,
          currency: extractedTx.currency || 'INR',
          transactionDate: extractedTx.transactionDate || currentEmail.receivedAt.split('T')[0],
          inferredCategory: extractedTx.inferredCategory || 'Other',
          paymentMethod: extractedTx.paymentMethod || 'Credit Card',
          transactionType: extractedTx.transactionType || 'expense',
          sourceTitle: currentEmail.title,
          sourceSender: currentEmail.sender,
          sourceReceivedAt: currentEmail.receivedAt,
        });
      } else {
        // Fallback draft Silver record if LLM extraction returned 503 or empty
        setActiveSilver({
          id: `draft-${Date.now()}`,
          bronzeInputId: currentEmail.id,
          merchantRaw: currentEmail.title,
          merchantNormalized: currentEmail.title,
          amount: 0,
          currency: 'INR',
          transactionDate: currentEmail.receivedAt.split('T')[0],
          inferredCategory: 'Other',
          paymentMethod: 'Credit Card',
          transactionType: 'expense',
          sourceTitle: currentEmail.title,
          sourceSender: currentEmail.sender,
          sourceReceivedAt: currentEmail.receivedAt,
        });
      }
    } catch (err: any) {
      alert(`Extraction error: ${err.message}`);
    } finally {
      setIsExtracting(false);
    }
  };

  // 4. Revert Silver back to Bronze
  const handleRevertSilverToBronze = async () => {
    if (!activeSilver) return;
    try {
      const headers = await getAuthHeaders();
      await fetch(getApiUrl('/api/pipeline/revert-to-bronze'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ silverId: activeSilver.id }),
      });

      setActiveSilver(null);
      setActionSuccessMessage('Reverted back to Bronze Raw Email');
      setTimeout(() => setActionSuccessMessage(null), 2500);
    } catch (err: any) {
      alert(`Failed to revert: ${err.message}`);
    }
  };

  // 5. Save & Accept Silver -> Promote to Gold Ledger
  const handleSaveAndAcceptSilver = async () => {
    if (!activeSilver) return;

    try {
      const headers = await getAuthHeaders();

      // First update Silver record edits
      await fetch(getApiUrl(`/api/pipeline/silver-transactions/${activeSilver.id}`), {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          merchantNormalized: activeSilver.merchantNormalized,
          amount: Number(activeSilver.amount) || 0,
          currency: activeSilver.currency,
          transactionDate: activeSilver.transactionDate,
          inferredCategory: activeSilver.inferredCategory,
          paymentMethod: activeSilver.paymentMethod,
          transactionType: activeSilver.transactionType,
        }),
      });

      // Then approve to Gold
      const approveRes = await fetch(getApiUrl('/api/pipeline/approve'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          silverIds: [activeSilver.id],
        }),
      });

      if (approveRes.ok) {
        setActionSuccessMessage(`✓ Transaction saved and promoted to Gold Ledger!`);
        setTimeout(() => setActionSuccessMessage(null), 3000);

        // Remove from raw list & reset active silver
        const updated = rawEmails.filter((_, idx) => idx !== currentIndex);
        setRawEmails(updated);
        setActiveSilver(null);
        if (currentIndex >= updated.length) {
          setCurrentIndex(Math.max(0, updated.length - 1));
        }
      } else {
        alert('Failed to approve transaction to Gold ledger.');
      }
    } catch (err: any) {
      alert(`Save & Accept error: ${err.message}`);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-28 space-y-6" data-testid="mobile-ingestion-triage">
      
      {/* Header */}
      <div>
        <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Ingestion Pipeline</span>
        <h1 className="text-2xl font-extrabold text-slate-900 Outfit">Receipt Triage</h1>
      </div>

      {/* Success Notification Banner */}
      {actionSuccessMessage && (
        <div
          className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-2xl text-xs font-semibold flex items-center space-x-2 shadow-xs"
          data-testid="action-success-banner"
        >
          <span>✓</span>
          <span>{actionSuccessMessage}</span>
        </div>
      )}

      {/* 1. Fetch Criteria Card */}
      <div className="bg-white border border-slate-200/80 rounded-3xl p-5 space-y-4 shadow-xs" data-testid="fetch-criteria-card">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Fetch Email Receipts</h2>
          <span className="text-3xs text-slate-400 font-medium">Gmail Sync</span>
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-3xs font-bold uppercase text-slate-500">Target Senders (From Database):</label>
              <span className="text-3xs font-semibold text-indigo-600">
                {selectedSenders.length} of {savedSenderSuggestions.length} active
              </span>
            </div>
            
            {/* Interactive Senders Pill Grid */}
            <div className="flex flex-wrap gap-2 pt-0.5" data-testid="fetcher-sender-pills">
              {savedSenderSuggestions.map((email) => {
                const isSelected = selectedSenders.includes(email);
                return (
                  <button
                    key={email}
                    type="button"
                    onClick={() => toggleSender(email)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center space-x-1.5 transition-all duration-200 active:scale-95 cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-50 text-indigo-700 border border-indigo-300 shadow-2xs'
                        : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'
                    }`}
                    data-testid={`sender-pill-${email}`}
                  >
                    <span>{isSelected ? '✓' : '○'}</span>
                    <span className="truncate max-w-[200px]">{email}</span>
                  </button>
                );
              })}

              {/* Add Custom Sender Button */}
              {!isAddingCustomSender ? (
                <button
                  type="button"
                  onClick={() => setIsAddingCustomSender(true)}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-50 border border-dashed border-slate-300 text-indigo-600 hover:border-indigo-400 flex items-center space-x-1 active:scale-95 cursor-pointer"
                  data-testid="add-sender-pill-btn"
                >
                  <span>+</span>
                  <span>Add</span>
                </button>
              ) : (
                <div className="flex items-center space-x-1.5 w-full mt-1">
                  <input
                    type="email"
                    value={customSenderInput}
                    onChange={(e) => setCustomSenderInput(e.target.value)}
                    placeholder="e.g. receipts@swiggy.in"
                    className="flex-1 bg-white border border-indigo-400 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    data-testid="fetcher-sender-input"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddCustomSender();
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomSender}
                    className="px-3 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold active:scale-95 cursor-pointer"
                    data-testid="confirm-add-sender-btn"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingCustomSender(false);
                      setCustomSenderInput('');
                    }}
                    className="px-2 py-2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Start Date:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white"
                data-testid="fetcher-start-date"
              />
            </div>
            <div>
              <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">End Date:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white"
                data-testid="fetcher-end-date"
              />
            </div>
          </div>

          <button
            onClick={handleFetchEmails}
            disabled={isFetching}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-2xl text-xs flex items-center justify-center space-x-2 transition-all shadow-sm shadow-indigo-600/20 active:scale-98 cursor-pointer"
            data-testid="fetch-emails-btn"
          >
            <span className={isFetching ? 'animate-spin' : ''}>🔄</span>
            <span>{isFetching ? 'Fetching Receipts...' : 'Fetch New Receipts'}</span>
          </button>

          {fetchMessage && (
            <p className="text-3xs text-indigo-600 text-center font-medium">{fetchMessage}</p>
          )}
        </div>
      </div>

      {/* 2. Triage Stage: Bronze Card OR Active Silver Card */}
      {rawEmails.length === 0 && !activeSilver ? (
        <div className="bg-white border border-slate-200/80 rounded-3xl p-8 text-center space-y-2 shadow-xs">
          <span className="text-3xl block mb-2">🎉</span>
          <h3 className="text-sm font-bold text-slate-900 Outfit">Triage Queue Clean!</h3>
          <p className="text-xs text-slate-500">All fetched email receipts have been reviewed and processed.</p>
        </div>
      ) : activeSilver ? (
        
        /* ------------------------------------------------------------- */
        /* SILVER EXTRACTION CARD (Immediate transition after Accept)   */
        /* ------------------------------------------------------------- */
        <div
          className="bg-white border-2 border-indigo-400/40 rounded-3xl p-6 shadow-sm space-y-4"
          data-testid="silver-extraction-card"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
              <span className="text-xs font-bold uppercase tracking-wider text-amber-700">Stage 2: Verify & Edit</span>
            </div>
            <button
              onClick={() => setShowSourceModal(true)}
              className="text-3xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg hover:bg-indigo-100 transition-colors"
              data-testid="view-source-email-btn"
            >
              📄 View Source Email
            </button>
          </div>

          {/* Reference Info (Read-only) */}
          <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3 text-2xs text-slate-500 space-y-1">
            <div className="flex justify-between">
              <span>Source Sender:</span>
              <span className="text-slate-800 font-semibold">{activeSilver.sourceSender || 'Unknown'}</span>
            </div>
            <div className="flex justify-between">
              <span>Email Date (Reference):</span>
              <span className="text-indigo-600 font-bold">
                {activeSilver.sourceReceivedAt ? formatDate(activeSilver.sourceReceivedAt.split('T')[0]) : 'N/A'}
              </span>
            </div>
          </div>

          {/* Editable Fields */}
          <div className="space-y-3 pt-1">
            
            {/* Merchant */}
            <div>
              <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Merchant:</label>
              <input
                type="text"
                value={activeSilver.merchantNormalized || ''}
                onChange={(e) => setActiveSilver({ ...activeSilver, merchantNormalized: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 font-bold focus:outline-none focus:border-indigo-500 focus:bg-white"
                data-testid="silver-merchant-input"
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
                  value={activeSilver.amount}
                  onChange={(e) => setActiveSilver({ ...activeSilver, amount: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 font-extrabold Outfit focus:outline-none focus:border-indigo-500 focus:bg-white"
                  data-testid="silver-amount-input"
                />
              </div>
              <div>
                <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Currency:</label>
                <select
                  value={activeSilver.currency}
                  onChange={(e) => setActiveSilver({ ...activeSilver, currency: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs text-slate-900 font-semibold focus:outline-none focus:border-indigo-500 focus:bg-white cursor-pointer"
                  data-testid="silver-currency-select"
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
                  list="category-options"
                  value={activeSilver.inferredCategory || ''}
                  onChange={(e) => setActiveSilver({ ...activeSilver, inferredCategory: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium focus:outline-none focus:border-indigo-500 focus:bg-white"
                  data-testid="silver-category-input"
                />
                <datalist id="category-options">
                  {categorySuggestions.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Payment Method:</label>
                <input
                  type="text"
                  value={activeSilver.paymentMethod || ''}
                  onChange={(e) => setActiveSilver({ ...activeSilver, paymentMethod: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium focus:outline-none focus:border-indigo-500 focus:bg-white"
                  data-testid="silver-method-input"
                />
              </div>
            </div>

            {/* Date & Type */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Transaction Date:</label>
                <input
                  type="date"
                  value={activeSilver.transactionDate}
                  onChange={(e) => setActiveSilver({ ...activeSilver, transactionDate: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium focus:outline-none focus:border-indigo-500 focus:bg-white"
                  data-testid="silver-date-input"
                />
              </div>

              <div>
                <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Transaction Type:</label>
                <select
                  value={activeSilver.transactionType || 'expense'}
                  onChange={(e) => setActiveSilver({ ...activeSilver, transactionType: e.target.value as any })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs text-slate-900 font-semibold focus:outline-none focus:border-indigo-500 focus:bg-white cursor-pointer"
                  data-testid="silver-type-select"
                >
                  <option value="expense">Expense</option>
                  <option value="refund">Refund</option>
                  <option value="transfer">Transfer (Own)</option>
                  <option value="fixed">Fixed Charge</option>
                </select>
              </div>
            </div>

          </div>

          {/* Bottom Actions: Revert OR Save & Accept */}
          <div className="pt-4 border-t border-slate-100 flex items-center space-x-3">
            <button
              onClick={handleRevertSilverToBronze}
              className="flex-1 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-bold py-3 rounded-2xl text-xs active:scale-95 transition-all cursor-pointer"
              data-testid="revert-silver-btn"
            >
              ↩ Revert to Raw
            </button>

            <button
              onClick={handleSaveAndAcceptSilver}
              className="flex-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3 rounded-2xl text-xs flex items-center justify-center space-x-1.5 shadow-sm shadow-emerald-600/20 active:scale-95 transition-all cursor-pointer"
              data-testid="save-accept-silver-btn"
            >
              <span>✓</span>
              <span>Save & Accept to Gold</span>
            </button>
          </div>
        </div>

      ) : (

        /* ------------------------------------------------------------- */
        /* BRONZE EMAIL CARD (Step 1 Review)                             */
        /* ------------------------------------------------------------- */
        <div
          className="bg-white border border-slate-200/80 rounded-3xl p-6 shadow-xs space-y-4"
          data-testid="bronze-email-card"
        >
          {/* Card Queue Header */}
          <div className="flex items-center justify-between text-2xs text-slate-500 border-b border-slate-100 pb-3">
            <span className="font-bold text-indigo-600 uppercase tracking-wider">
              Email {currentIndex + 1} of {rawEmails.length}
            </span>
            <span className="font-medium">{currentEmail ? formatDate(currentEmail.receivedAt.split('T')[0]) : ''}</span>
          </div>

          {/* Email Content */}
          <div className="space-y-2">
            <span className="text-3xs font-black uppercase tracking-wider text-slate-400 block">Sender:</span>
            <p className="text-xs font-semibold text-slate-800" data-testid="bronze-sender">
              {currentEmail?.sender}
            </p>

            <span className="text-3xs font-black uppercase tracking-wider text-slate-400 block pt-1">Subject:</span>
            <h3 className="text-sm font-extrabold text-slate-900 Outfit" data-testid="bronze-subject">
              {currentEmail?.title}
            </h3>

            <span className="text-3xs font-black uppercase tracking-wider text-slate-400 block pt-1">Content Snippet:</span>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 font-mono leading-relaxed max-h-36 overflow-y-auto" data-testid="bronze-snippet">
              {currentEmail?.snippet || currentEmail?.rawBody || 'No snippet available'}
            </div>
          </div>

          {/* Actions: Reject OR Accept */}
          <div className="pt-4 border-t border-slate-100 flex items-center space-x-3">
            <button
              onClick={handleRejectBronze}
              className="flex-1 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-bold py-3 rounded-2xl text-xs flex items-center justify-center space-x-1 active:scale-95 transition-all cursor-pointer"
              data-testid="reject-bronze-btn"
            >
              <span>✕</span>
              <span>Reject (Non-Tx)</span>
            </button>

            <button
              onClick={handleAcceptBronze}
              disabled={isExtracting}
              className="flex-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-3 rounded-2xl text-xs flex items-center justify-center space-x-2 shadow-sm shadow-indigo-600/20 active:scale-95 transition-all cursor-pointer"
              data-testid="accept-bronze-btn"
            >
              <span className={isExtracting ? 'animate-spin' : ''}>✓</span>
              <span>{isExtracting ? 'Extracting via LLM...' : 'Accept & Extract'}</span>
            </button>
          </div>

        </div>
      )}

      {/* View Source Email Modal */}
      {showSourceModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white border border-slate-200 rounded-3xl p-6 space-y-4 max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">Source Raw Email</h3>
              <button
                onClick={() => setShowSourceModal(false)}
                className="text-slate-400 hover:text-slate-700 text-base font-bold cursor-pointer"
                data-testid="close-source-modal-btn"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto text-2xs text-slate-700 font-mono space-y-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <p><span className="text-indigo-600 font-bold">Subject:</span> {activeSilver?.sourceTitle}</p>
              <p><span className="text-indigo-600 font-bold">Sender:</span> {activeSilver?.sourceSender}</p>
              <p><span className="text-indigo-600 font-bold">Date:</span> {activeSilver?.sourceReceivedAt}</p>
              <div className="border-t border-slate-200 pt-2 text-3xs whitespace-pre-wrap leading-relaxed">
                {currentEmail?.rawBody || currentEmail?.snippet || 'Raw email payload content available.'}
              </div>
            </div>

            <button
              onClick={() => setShowSourceModal(false)}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 rounded-xl text-xs cursor-pointer shadow-xs"
            >
              Close
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
