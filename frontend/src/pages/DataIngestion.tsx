import React, { useState } from 'react';
import { useGmailIntegration } from '../hooks/use-gmail-integration';
import { FilterPanel } from '../components/gmail/FilterPanel';

const STANDARD_CATEGORIES = [
  'Groceries',
  'Cabs & Transport',
  'Travel',
  'Utilities',
  'Internet & Telecom',
  'Entertainment Subscriptions',
  'Cloud & Software Services',
  'Shopping',
  'Restaurant & Dining',
  'Online Food Order',
  'Medical & Healthcare',
  'Other'
];

const DataIngestion: React.FC = () => {
  const {
    senders,
    currentSender,
    setCurrentSender,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    subject,
    setSubject,
    isFetching,
    error,
    addSender,
    removeSender,
    handleKeyDown,
    handleFetchClick,
    fetchProgress,
    setFetchProgress,
    addDirectTransaction,
    paymentMethods,
    paymentRules,
    addPaymentMethod,
    updatePaymentMethod,
    deletePaymentMethod,
    addPaymentRule,
    updatePaymentRule,
    deletePaymentRule,
    applyRetroactiveStandardization,
    goldTransactions,
    isLoading,
  } = useGmailIntegration();

  const [activeSubTab, setActiveSubTab] = useState<'gmail' | 'manual' | 'standardization'>('gmail');

  // Manual Transaction Form state
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState('Other');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [transactionType, setTransactionType] = useState<'expense' | 'refund'>('expense');
  const [parentTransactionId, setParentTransactionId] = useState('');

  const parentCandidates = goldTransactions.filter(tx => tx.transactionType !== 'refund');

  // Payment Standardization state
  const [newMethodName, setNewMethodName] = useState('');
  const [editingMethodId, setEditingMethodId] = useState<string | null>(null);
  const [editingMethodName, setEditingMethodName] = useState('');

  const [newRulePattern, setNewRulePattern] = useState('');
  const [newRuleMethodId, setNewRuleMethodId] = useState('');
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingRulePattern, setEditingRulePattern] = useState('');
  const [editingRuleMethodId, setEditingRuleMethodId] = useState('');

  // Form validation/submit states
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync newRuleMethodId with first payment method
  React.useEffect(() => {
    if (paymentMethods.length > 0 && !newRuleMethodId) {
      setNewRuleMethodId(paymentMethods[0].id);
    }
  }, [paymentMethods, newRuleMethodId]);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setSuccessMessage(null);

    // Validation checks
    if (!merchant.trim()) {
      setValidationError('Merchant name is required');
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setValidationError('Amount must be a positive number');
      return;
    }
    if (!transactionDate) {
      setValidationError('Transaction date is required');
      return;
    }
    if (!category) {
      setValidationError('Category is required');
      return;
    }
    if (!paymentMethod) {
      setValidationError('Payment method is required');
      return;
    }

    setIsSubmitting(true);
    try {
      await addDirectTransaction({
        merchant: merchant.trim(),
        amount: parsedAmount,
        currency,
        transactionDate,
        category,
        paymentMethod,
        notes: notes.trim() || undefined,
        transactionType,
        parentTransactionId: parentTransactionId || undefined,
      });

      setSuccessMessage(`Successfully added transaction for ${merchant.trim()}!`);
      // Clear fields
      setMerchant('');
      setAmount('');
      setNotes('');
      setTransactionType('expense');
      setParentTransactionId('');
    } catch (err: any) {
      setValidationError(err.message || 'Failed to submit transaction');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8">
      {/* Header section */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
          Data Ingestion Control
        </h1>
        <p className="text-sm text-gray-500 max-w-2xl mx-auto">
          Ingest raw financial records. Pull receipts from Gmail automatically or record ledger entries manually.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border border-gray-150/60 bg-white rounded-2xl p-1.5 shadow-sm w-full">
        <button
          onClick={() => {
            setActiveSubTab('gmail');
            setValidationError(null);
            setSuccessMessage(null);
          }}
          className={`flex-1 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
            activeSubTab === 'gmail'
              ? 'bg-indigo-50 text-indigo-750 shadow-sm'
              : 'text-gray-500 hover:text-gray-950'
          }`}
        >
          📧 Gmail Ingestion
        </button>
        <button
          onClick={() => {
            setActiveSubTab('manual');
            setValidationError(null);
            setSuccessMessage(null);
          }}
          className={`flex-1 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
            activeSubTab === 'manual'
              ? 'bg-indigo-50 text-indigo-750 shadow-sm'
              : 'text-gray-500 hover:text-gray-950'
          }`}
        >
          ✍️ Direct Ledger Entry
        </button>
        <button
          onClick={() => {
            setActiveSubTab('standardization');
            setValidationError(null);
            setSuccessMessage(null);
          }}
          className={`flex-1 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
            activeSubTab === 'standardization'
              ? 'bg-indigo-50 text-indigo-750 shadow-sm'
              : 'text-gray-500 hover:text-gray-950'
          }`}
        >
          ⚙️ Payment Standardization
        </button>
      </div>

      {/* Content wrapper */}
      <div className="transition-all duration-300">
        {activeSubTab === 'gmail' && (
          <div className="space-y-6 animate-fade-in">
            {/* Filter configuration panel */}
            <FilterPanel
              senders={senders}
              currentSender={currentSender}
              setCurrentSender={setCurrentSender}
              startDate={startDate}
              setStartDate={setStartDate}
              endDate={endDate}
              setEndDate={setEndDate}
              subject={subject}
              setSubject={setSubject}
              addSender={addSender}
              removeSender={removeSender}
              handleKeyDown={handleKeyDown}
              error={error}
              isFetching={isFetching}
              onFetchClick={handleFetchClick}
            />

            {/* Ingestion Progress Tracker */}
            {fetchProgress && fetchProgress.status !== 'idle' && (
              <div 
                data-testid="ingestion-progress-widget"
                className="bg-gradient-to-r from-indigo-50/70 to-blue-50/70 border border-indigo-100/50 backdrop-blur-md rounded-2xl p-5 shadow-sm space-y-3 relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 -mt-6 -mr-6 w-24 h-24 bg-indigo-450/10 rounded-full blur-xl animate-pulse"></div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    {fetchProgress.status === 'started' || fetchProgress.status === 'fetching' ? (
                      <div className="flex space-x-1">
                        <span className="w-2.5 h-2.5 bg-indigo-650 rounded-full animate-bounce"></span>
                        <span className="w-2.5 h-2.5 bg-indigo-650 rounded-full animate-bounce delay-100"></span>
                        <span className="w-2.5 h-2.5 bg-indigo-650 rounded-full animate-bounce delay-200"></span>
                      </div>
                    ) : fetchProgress.status === 'completed' ? (
                      <span className="text-lg">✅</span>
                    ) : (
                      <span className="text-lg">❌</span>
                    )}
                    <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-900">
                      {fetchProgress.status === 'started' && 'Initializing Google Gmail Connection...'}
                      {fetchProgress.status === 'fetching' && `Ingesting receipts (${fetchProgress.current} of ${fetchProgress.total})`}
                      {fetchProgress.status === 'completed' && 'Ingestion Completed Successfully!'}
                      {fetchProgress.status === 'error' && 'Ingestion Failed'}
                    </h4>
                  </div>
                  {fetchProgress.status === 'fetching' && (
                    <span className="text-xs font-extrabold text-indigo-750 whitespace-nowrap bg-indigo-100/60 px-2 py-0.5 rounded-md">
                      {Math.round((fetchProgress.current / fetchProgress.total) * 100)}%
                    </span>
                  )}
                </div>

                {fetchProgress.status === 'fetching' && fetchProgress.currentSubject && (
                  <p className="text-xs text-gray-500 font-medium truncate max-w-lg">
                    <span className="font-bold text-indigo-400/80 uppercase text-[10px] tracking-wider block">Current Message</span>
                    {fetchProgress.currentSubject}
                  </p>
                )}

                {fetchProgress.status === 'completed' && (
                  <p className="text-xs text-emerald-705 font-bold uppercase tracking-wider">
                    🎉 Loaded {fetchProgress.total} raw receipt email(s) into your Bronze layer.
                  </p>
                )}

                {/* Progress bar */}
                {(fetchProgress.status === 'fetching' || fetchProgress.status === 'completed') && (
                  <div className="w-full bg-indigo-100/30 h-2.5 rounded-full overflow-hidden border border-indigo-200/20">
                    <div 
                      className="bg-gradient-to-r from-indigo-600 to-blue-500 h-full rounded-full transition-all duration-300 ease-out shadow-sm"
                      style={{ width: `${fetchProgress.total > 0 ? (fetchProgress.current / fetchProgress.total) * 100 : 0}%` }}
                    ></div>
                  </div>
                )}

                {fetchProgress.status === 'completed' && (
                  <div className="pt-1 flex justify-end">
                    <button 
                      onClick={() => setFetchProgress({ status: 'idle', current: 0, total: 0 })}
                      className="text-[10px] font-bold text-indigo-600 hover:text-indigo-850 uppercase tracking-wider border border-indigo-200/40 hover:bg-indigo-50 px-2.5 py-1 rounded-md transition-all shadow-sm bg-white cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeSubTab === 'manual' && (
          <div className="bg-white border border-gray-150/70 shadow-sm rounded-2xl p-6 md:p-8 space-y-6 animate-fade-in">
            <h3 className="text-base font-bold text-gray-900 uppercase tracking-wider border-b border-gray-100 pb-3">
              Direct Ledger transaction entry
            </h3>

            {/* Validation & Success Banners */}
            {validationError && (
              <div className="bg-red-50 border border-red-200 text-red-750 text-xs px-4 py-3 rounded-xl font-semibold">
                ⚠️ {validationError}
              </div>
            )}
            {successMessage && (
              <div className="bg-emerald-55/70 border border-emerald-200 text-emerald-805 text-xs px-4 py-3 rounded-xl font-semibold">
                🎉 {successMessage}
              </div>
            )}

            <form onSubmit={handleManualSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Merchant */}
              <div className="flex flex-col space-y-1.5">
                <label htmlFor="manual-merchant" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Merchant Name *</label>
                <input
                  id="manual-merchant"
                  type="text"
                  placeholder="e.g. Uber, Starbucks, Amazon"
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                  className="border border-gray-250 rounded-xl px-3.5 py-2 text-xs focus:ring-2 focus:ring-indigo-550/30 focus:border-indigo-600 outline-none transition-all font-semibold"
                />
              </div>

              {/* Amount */}
              <div className="flex flex-col space-y-1.5">
                <label htmlFor="manual-amount" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Amount *</label>
                <input
                  id="manual-amount"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="border border-gray-250 rounded-xl px-3.5 py-2 text-xs focus:ring-2 focus:ring-indigo-550/30 focus:border-indigo-600 outline-none transition-all font-semibold"
                />
              </div>

              {/* Currency */}
              <div className="flex flex-col space-y-1.5">
                <label htmlFor="manual-currency" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Currency *</label>
                <select
                  id="manual-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="border border-gray-250 rounded-xl px-3.5 py-2 text-xs focus:ring-2 focus:ring-indigo-550/30 focus:border-indigo-600 outline-none transition-all font-semibold bg-white cursor-pointer"
                >
                  <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                </select>
              </div>

              {/* Date */}
              <div className="flex flex-col space-y-1.5">
                <label htmlFor="manual-date" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Transaction Date *</label>
                <input
                  id="manual-date"
                  type="date"
                  value={transactionDate}
                  onChange={(e) => setTransactionDate(e.target.value)}
                  className="border border-gray-250 rounded-xl px-3.5 py-2 text-xs focus:ring-2 focus:ring-indigo-550/30 focus:border-indigo-600 outline-none transition-all font-semibold cursor-pointer"
                />
              </div>

              {/* Category */}
              <div className="flex flex-col space-y-1.5">
                <label htmlFor="manual-category" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Category *</label>
                <input
                  id="manual-category"
                  type="text"
                  list="manual-categories-list"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="border border-gray-250 rounded-xl px-3.5 py-2 text-xs focus:ring-2 focus:ring-indigo-550/30 focus:border-indigo-600 outline-none transition-all font-semibold bg-white"
                />
                <datalist id="manual-categories-list">
                  {STANDARD_CATEGORIES.map(opt => (
                    <option key={opt} value={opt} />
                  ))}
                </datalist>
              </div>

              {/* Payment Method */}
              <div className="flex flex-col space-y-1.5">
                <label htmlFor="manual-method" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Payment Method *</label>
                <select
                  id="manual-method"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="border border-gray-250 rounded-xl px-3.5 py-2 text-xs focus:ring-2 focus:ring-indigo-550/30 focus:border-indigo-600 outline-none transition-all font-semibold bg-white cursor-pointer"
                >
                  <option value="">Select Payment Method</option>
                  {paymentMethods.map(m => (
                    <option key={m.id} value={m.name}>{m.name}</option>
                  ))}
                </select>
              </div>

              {/* Transaction Type */}
              <div className="flex flex-col space-y-1.5">
                <label htmlFor="manual-type" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Transaction Type *</label>
                <select
                  id="manual-type"
                  value={transactionType}
                  onChange={(e) => {
                    setTransactionType(e.target.value as 'expense' | 'refund');
                    if (e.target.value !== 'refund') {
                      setParentTransactionId('');
                    }
                  }}
                  className="border border-gray-250 rounded-xl px-3.5 py-2 text-xs focus:ring-2 focus:ring-indigo-550/30 focus:border-indigo-600 outline-none transition-all font-semibold bg-white cursor-pointer"
                >
                  <option value="expense">Expense</option>
                  <option value="refund">Refund</option>
                </select>
              </div>

              {/* Link to Purchase */}
              {transactionType === 'refund' && (
                <div className="flex flex-col space-y-1.5 md:col-span-2">
                  <label htmlFor="manual-parent" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Link to Original Purchase</label>
                  <select
                    id="manual-parent"
                    value={parentTransactionId}
                    onChange={(e) => setParentTransactionId(e.target.value)}
                    className="border border-gray-250 rounded-xl px-3.5 py-2 text-xs focus:ring-2 focus:ring-indigo-550/30 focus:border-indigo-600 outline-none transition-all font-semibold bg-white cursor-pointer"
                  >
                    <option value="">No Linked Purchase (Optional)</option>
                    {parentCandidates.map(tx => (
                      <option key={tx.id} value={tx.id}>
                        {tx.transactionDate} - {tx.merchant} ({tx.amount.toFixed(2)} {tx.currency})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Notes */}
              <div className="flex flex-col space-y-1.5 md:col-span-2">
                <label htmlFor="manual-notes" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Notes (Optional)</label>
                <textarea
                  id="manual-notes"
                  placeholder="Add details, tags, or description..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="border border-gray-250 rounded-xl px-3.5 py-2 text-xs focus:ring-2 focus:ring-indigo-550/30 focus:border-indigo-600 outline-none transition-all font-semibold resize-none"
                />
              </div>

              {/* Submit Button */}
              <div className="md:col-span-2 pt-3 flex justify-end">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-wider px-6 py-2.5 rounded-xl shadow-md shadow-indigo-200/50 hover:shadow-lg transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Logging...' : '📝 Save Transaction'}
                </button>
              </div>
            </form>
          </div>
        )}

        {activeSubTab === 'standardization' && (
          <div className="space-y-8 animate-fade-in text-left">
            {/* Retroactive Standardization Panel */}
            <div className="bg-gradient-to-r from-indigo-50/40 to-blue-50/40 border border-indigo-100/50 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <h4 className="text-sm font-extrabold text-indigo-955 uppercase tracking-wider">
                  Retroactive Standardization
                </h4>
                <p className="text-xs text-gray-500 max-w-lg font-medium">
                  Apply all active mapping rules to existing transactions in the Silver staging queue and Gold ledger to normalize historical data.
                </p>
              </div>
              <button
                onClick={async () => {
                  try {
                    await applyRetroactiveStandardization();
                    setSuccessMessage('Standardization rules applied retroactively to all transaction stages!');
                  } catch (err: any) {
                    setValidationError(err.message || 'Failed retroactive standardization');
                  }
                }}
                disabled={isLoading}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-wider px-5 py-3 rounded-xl shadow-md transition-all cursor-pointer whitespace-nowrap"
              >
                🔄 Apply Rules Retroactively
              </button>
            </div>

            {/* Config Grids */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Payment Methods Panel */}
              <div className="bg-white border border-gray-150/70 shadow-sm rounded-2xl p-6 space-y-6">
                <h3 className="text-xs font-extrabold text-gray-900 uppercase tracking-wider border-b border-gray-100 pb-3">
                  Standardized Payment Methods
                </h3>
                
                {/* Inline add form */}
                <form 
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!newMethodName.trim()) return;
                    try {
                      await addPaymentMethod(newMethodName.trim());
                      setNewMethodName('');
                    } catch (err: any) {
                      setValidationError(err.message || 'Failed to add method');
                    }
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    placeholder="New Payment Method name"
                    value={newMethodName}
                    onChange={(e) => setNewMethodName(e.target.value)}
                    className="flex-1 border border-gray-250 rounded-xl px-3 py-2 text-xs font-semibold focus:ring-2 focus:ring-indigo-550/30 outline-none"
                  />
                  <button
                    type="submit"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer font-bold"
                  >
                    Add
                  </button>
                </form>

                {/* List of methods */}
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {paymentMethods.map((m) => (
                    <div 
                      key={m.id} 
                      className="flex items-center justify-between bg-gray-50/50 hover:bg-gray-50 border border-gray-100 rounded-xl p-3 transition-all"
                    >
                      {editingMethodId === m.id ? (
                        <div className="flex items-center gap-2 w-full">
                          <input
                            type="text"
                            value={editingMethodName}
                            onChange={(e) => setEditingMethodName(e.target.value)}
                            className="flex-1 border border-gray-250 rounded-lg px-2 py-1 text-xs font-semibold outline-none"
                          />
                          <button
                            onClick={async () => {
                              if (!editingMethodName.trim()) return;
                              try {
                                await updatePaymentMethod(m.id, editingMethodName.trim());
                                setEditingMethodId(null);
                              } catch (err: any) {
                                setValidationError(err.message || 'Failed to update method');
                              }
                            }}
                            className="text-[10px] font-bold uppercase text-emerald-600 hover:text-emerald-700 cursor-pointer"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingMethodId(null)}
                            className="text-[10px] font-bold uppercase text-gray-500 hover:text-gray-600 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="text-xs font-bold text-gray-800">{m.name}</span>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => {
                                setEditingMethodId(m.id);
                                setEditingMethodName(m.name);
                              }}
                              className="text-[10px] font-bold uppercase text-indigo-600 hover:text-indigo-700 cursor-pointer"
                            >
                              Edit
                            </button>
                            <button
                              onClick={async () => {
                                if (confirm('Are you sure you want to delete this payment method? This will also remove any mapping rules linked to it.')) {
                                  try {
                                    await deletePaymentMethod(m.id);
                                  } catch (err: any) {
                                    setValidationError(err.message || 'Failed to delete method');
                                  }
                                }
                              }}
                              className="text-[10px] font-bold uppercase text-red-500 hover:text-red-700 cursor-pointer"
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {paymentMethods.length === 0 && (
                    <div className="text-center py-4 text-xs font-medium text-gray-400">
                      No payment methods configured.
                    </div>
                  )}
                </div>
              </div>

              {/* Alias Mapping Rules Panel */}
              <div className="bg-white border border-gray-150/70 shadow-sm rounded-2xl p-6 space-y-6">
                <h3 className="text-xs font-extrabold text-gray-900 uppercase tracking-wider border-b border-gray-100 pb-3">
                  Alias Mapping Rules
                </h3>

                {/* Inline add rule form */}
                <form 
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!newRulePattern.trim() || !newRuleMethodId) return;
                    try {
                      await addPaymentRule(newRulePattern.trim(), newRuleMethodId);
                      setNewRulePattern('');
                    } catch (err: any) {
                      setValidationError(err.message || 'Failed to add rule');
                    }
                  }}
                  className="space-y-4 bg-gray-50/50 border border-gray-100 rounded-2xl p-4"
                >
                  <div className="space-y-1">
                    <label htmlFor="new-rule-pattern" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Raw Alias Pattern</label>
                    <input
                      id="new-rule-pattern"
                      type="text"
                      placeholder="Pattern (e.g. hdfc, icici)"
                      value={newRulePattern}
                      onChange={(e) => setNewRulePattern(e.target.value)}
                      className="w-full border border-gray-250 rounded-xl px-3 py-2 text-xs font-semibold focus:ring-2 focus:ring-indigo-550/30 focus:border-indigo-600 outline-none transition-all bg-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="new-rule-method" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Map to Standard Method</label>
                    <select
                      id="new-rule-method"
                      value={newRuleMethodId}
                      onChange={(e) => setNewRuleMethodId(e.target.value)}
                      className="w-full border border-gray-250 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-550/30 focus:border-indigo-600 transition-all bg-white cursor-pointer"
                    >
                      <option value="">Select Standard Method...</option>
                      {paymentMethods.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer transition-all shadow-sm hover:shadow-md font-bold"
                  >
                    Add Mapping Rule
                  </button>
                </form>

                {/* List of rules */}
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {paymentRules.map((r) => (
                    <div 
                      key={r.id} 
                      className="flex flex-col bg-gray-50/50 hover:bg-gray-50 border border-gray-100 rounded-xl p-3 gap-2 transition-all"
                    >
                      {editingRuleId === r.id ? (
                        <div className="flex flex-col gap-3 w-full bg-indigo-50/20 border border-indigo-100 rounded-xl p-3 text-left">
                          <div className="space-y-2">
                            <div>
                              <label htmlFor={`edit-pattern-${r.id}`} className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Pattern</label>
                              <input
                                id={`edit-pattern-${r.id}`}
                                type="text"
                                value={editingRulePattern}
                                onChange={(e) => setEditingRulePattern(e.target.value)}
                                className="w-full border border-gray-250 rounded-lg px-2 py-1 text-xs font-semibold outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>
                            <div>
                              <label htmlFor={`edit-method-${r.id}`} className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Maps to</label>
                              <select
                                id={`edit-method-${r.id}`}
                                value={editingRuleMethodId}
                                onChange={(e) => setEditingRuleMethodId(e.target.value)}
                                className="w-full border border-gray-250 rounded-lg px-2 py-1 text-xs font-semibold outline-none bg-white focus:ring-1 focus:ring-indigo-500"
                              >
                                {paymentMethods.map(m => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="flex justify-end gap-3 pt-2 border-t border-indigo-100/50">
                            <button
                              onClick={async () => {
                                if (!editingRulePattern.trim() || !editingRuleMethodId) return;
                                try {
                                  await updatePaymentRule(r.id, editingRulePattern.trim(), editingRuleMethodId);
                                  setEditingRuleId(null);
                                } catch (err: any) {
                                  setValidationError(err.message || 'Failed to update rule');
                                }
                              }}
                              className="text-[10px] font-bold uppercase text-emerald-600 hover:text-emerald-700 cursor-pointer"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingRuleId(null)}
                              className="text-[10px] font-bold uppercase text-gray-500 hover:text-gray-600 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between w-full">
                          <div className="flex flex-col text-left">
                            <span className="text-xs font-extrabold text-gray-800">
                              Pattern: <code className="bg-indigo-50/60 px-1 py-0.5 rounded text-indigo-750 font-mono">"{r.aliasPattern}"</code>
                            </span>
                            <span className="text-[10px] text-gray-400 font-bold uppercase mt-0.5">
                              Maps to: <span className="text-indigo-650">{r.paymentMethodName || 'Unknown'}</span>
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => {
                                setEditingRuleId(r.id);
                                setEditingRulePattern(r.aliasPattern);
                                setEditingRuleMethodId(r.paymentMethodId);
                              }}
                              className="text-[10px] font-bold uppercase text-indigo-600 hover:text-indigo-700 cursor-pointer"
                            >
                              Edit
                            </button>
                            <button
                              onClick={async () => {
                                if (confirm('Are you sure you want to delete this mapping rule?')) {
                                  try {
                                    await deletePaymentRule(r.id);
                                  } catch (err: any) {
                                    setValidationError(err.message || 'Failed to delete rule');
                                  }
                                }
                              }}
                              className="text-[10px] font-bold uppercase text-red-500 hover:text-red-700 cursor-pointer"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {paymentRules.length === 0 && (
                    <div className="text-center py-4 text-xs font-medium text-gray-400">
                      No mapping rules configured.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DataIngestion;
