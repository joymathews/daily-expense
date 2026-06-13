import React, { useState } from 'react';
import { useGmailIntegration } from '../hooks/use-gmail-integration';
import { FilterPanel } from '../components/gmail/FilterPanel';

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
  } = useGmailIntegration();

  const [activeSubTab, setActiveSubTab] = useState<'gmail' | 'manual'>('gmail');

  // Manual Transaction Form state
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState('Food');
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [notes, setNotes] = useState('');

  // Form validation/submit states
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      });

      setSuccessMessage(`Successfully added transaction for ${merchant.trim()}!`);
      // Clear fields
      setMerchant('');
      setAmount('');
      setNotes('');
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
      <div className="flex border border-gray-150/60 bg-white rounded-2xl p-1.5 shadow-sm max-w-md mx-auto">
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
                <select
                  id="manual-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="border border-gray-250 rounded-xl px-3.5 py-2 text-xs focus:ring-2 focus:ring-indigo-550/30 focus:border-indigo-600 outline-none transition-all font-semibold bg-white cursor-pointer"
                >
                  <option value="Food">Food</option>
                  <option value="Travel">Travel</option>
                  <option value="Transport">Transport</option>
                  <option value="Shopping">Shopping</option>
                  <option value="Utilities">Utilities</option>
                  <option value="Entertainment">Entertainment</option>
                  <option value="Other">Other</option>
                </select>
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
                  <option value="UPI">UPI</option>
                  <option value="Credit Card">Credit Card</option>
                  <option value="Debit Card">Debit Card</option>
                  <option value="Net Banking">Net Banking</option>
                  <option value="Cash">Cash</option>
                </select>
              </div>

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
      </div>
    </div>
  );
};

export default DataIngestion;
