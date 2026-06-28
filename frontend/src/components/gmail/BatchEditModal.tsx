import React, { useState, useMemo } from 'react';
import { STANDARD_CATEGORIES } from '../../utils/transaction-helper';

interface BatchEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (updates: any) => Promise<void>;
  selectedCount: number;
  paymentMethods: Array<{ id: string; name: string }>;
  goldTransactions: any[];
  silverTransactions: any[];
}

export const BatchEditModal: React.FC<BatchEditModalProps> = ({
  isOpen,
  onClose,
  onSave,
  selectedCount,
  paymentMethods,
  goldTransactions,
  silverTransactions,
}) => {
  // Enabled Toggles
  const [enableMerchant, setEnableMerchant] = useState(false);
  const [enableAmount, setEnableAmount] = useState(false);
  const [enableCurrency, setEnableCurrency] = useState(false);
  const [enableCategory, setEnableCategory] = useState(false);
  const [enableMethod, setEnableMethod] = useState(false);
  const [enableDate, setEnableDate] = useState(false);
  const [enableType, setEnableType] = useState(false);
  const [enableNotes, setEnableNotes] = useState(false);

  // Field Values
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [category, setCategory] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [date, setDate] = useState('');
  const [transactionType, setTransactionType] = useState('expense');
  const [notes, setNotes] = useState('');

  // Validation States
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Dynamic autocomplete categories
  const allCategories = useMemo(() => {
    const customGoldCategories = goldTransactions?.map(tx => tx.category) || [];
    const customSilverCategories = silverTransactions?.map(tx => tx.inferredCategory) || [];
    const combined = [
      ...STANDARD_CATEGORIES,
      ...customGoldCategories,
      ...customSilverCategories
    ].filter(Boolean).map(c => c.trim());

    const seen = new Set<string>();
    const unique: string[] = [];
    for (const cat of combined) {
      const lower = cat.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        unique.push(cat);
      }
    }
    return unique.sort((a, b) => a.localeCompare(b));
  }, [goldTransactions, silverTransactions]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const updates: any = {};
    let hasSelectedField = false;

    if (enableMerchant) {
      if (!merchant.trim()) {
        setErrorMsg('Merchant name cannot be empty');
        return;
      }
      updates.merchant = merchant.trim();
      updates.merchantRaw = merchant.trim();
      updates.merchantNormalized = merchant.trim();
      hasSelectedField = true;
    }

    if (enableAmount) {
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        setErrorMsg('Amount must be a positive number');
        return;
      }
      updates.amount = numAmount;
      hasSelectedField = true;
    }

    if (enableCurrency) {
      if (!currency.trim()) {
        setErrorMsg('Currency is required');
        return;
      }
      updates.currency = currency.trim();
      hasSelectedField = true;
    }

    if (enableCategory) {
      updates.category = category.trim() || 'Other';
      updates.inferredCategory = category.trim() || 'Other';
      hasSelectedField = true;
    }

    if (enableMethod) {
      updates.paymentMethod = paymentMethod || 'Unknown';
      hasSelectedField = true;
    }

    if (enableDate) {
      if (!date) {
        setErrorMsg('Please specify a valid transaction date');
        return;
      }
      updates.transactionDate = date;
      hasSelectedField = true;
    }

    if (enableType) {
      updates.transactionType = transactionType;
      hasSelectedField = true;
    }

    if (enableNotes) {
      updates.notes = notes.trim();
      hasSelectedField = true;
    }

    if (!hasSelectedField) {
      setErrorMsg('Please toggle and set at least one field to edit');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave(updates);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to apply batch changes');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm" data-testid="batch-edit-modal">
      <div className="bg-white rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden border border-gray-100 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div>
            <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider">
              Batch Edit: {selectedCount} Selected Transactions
            </h3>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-1">
              Toggle fields to overwrite. Unselected fields will remain unchanged.
            </p>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 hover:bg-gray-150 rounded-xl transition-colors text-gray-400 hover:text-gray-700 cursor-pointer"
            aria-label="Close modal"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 flex-1">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-100 text-rose-700 text-xs font-bold rounded-xl">
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Merchant */}
            <div className="flex flex-col space-y-1">
              <div className="flex items-center space-x-2">
                <input 
                  id="toggle-merchant"
                  type="checkbox"
                  checked={enableMerchant}
                  onChange={(e) => setEnableMerchant(e.target.checked)}
                  className="rounded text-indigo-650 focus:ring-indigo-500 border-gray-300 cursor-pointer w-4 h-4"
                />
                <label htmlFor="batch-merchant" className="text-[10px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer">
                  Merchant
                </label>
              </div>
              <input
                id="batch-merchant"
                type="text"
                disabled={!enableMerchant}
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="Starbucks, Uber, Amazon..."
                className={`border rounded-xl px-3 py-2 text-xs font-semibold outline-none transition-all ${
                  enableMerchant ? 'border-indigo-600 bg-white' : 'border-gray-200 bg-gray-50/50 text-gray-400'
                }`}
              />
            </div>

            {/* Amount */}
            <div className="flex flex-col space-y-1">
              <div className="flex items-center space-x-2">
                <input 
                  id="toggle-amount"
                  type="checkbox"
                  checked={enableAmount}
                  onChange={(e) => setEnableAmount(e.target.checked)}
                  className="rounded text-indigo-650 focus:ring-indigo-500 border-gray-300 cursor-pointer w-4 h-4"
                />
                <label htmlFor="batch-amount" className="text-[10px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer">
                  Amount
                </label>
              </div>
              <input
                id="batch-amount"
                type="number"
                step="any"
                disabled={!enableAmount}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className={`border rounded-xl px-3 py-2 text-xs font-semibold outline-none transition-all ${
                  enableAmount ? 'border-indigo-600 bg-white' : 'border-gray-200 bg-gray-50/50 text-gray-400'
                }`}
              />
            </div>

            {/* Currency */}
            <div className="flex flex-col space-y-1">
              <div className="flex items-center space-x-2">
                <input 
                  id="toggle-currency"
                  type="checkbox"
                  checked={enableCurrency}
                  onChange={(e) => setEnableCurrency(e.target.checked)}
                  className="rounded text-indigo-650 focus:ring-indigo-500 border-gray-300 cursor-pointer w-4 h-4"
                />
                <label htmlFor="batch-currency" className="text-[10px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer">
                  Currency
                </label>
              </div>
              <select
                id="batch-currency"
                disabled={!enableCurrency}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className={`border rounded-xl px-3 py-2 text-xs font-semibold outline-none cursor-pointer transition-all ${
                  enableCurrency ? 'border-indigo-600 bg-white' : 'border-gray-200 bg-gray-50/50 text-gray-400'
                }`}
              >
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
              </select>
            </div>

            {/* Category */}
            <div className="flex flex-col space-y-1">
              <div className="flex items-center space-x-2">
                <input 
                  id="toggle-category"
                  type="checkbox"
                  checked={enableCategory}
                  onChange={(e) => setEnableCategory(e.target.checked)}
                  className="rounded text-indigo-650 focus:ring-indigo-500 border-gray-300 cursor-pointer w-4 h-4"
                />
                <label htmlFor="batch-category" className="text-[10px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer">
                  Category
                </label>
              </div>
              <input
                id="batch-category"
                type="text"
                list="batch-categories-list"
                disabled={!enableCategory}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Groceries, Shopping..."
                className={`border rounded-xl px-3 py-2 text-xs font-semibold outline-none transition-all ${
                  enableCategory ? 'border-indigo-600 bg-white' : 'border-gray-200 bg-gray-50/50 text-gray-400'
                }`}
              />
              <datalist id="batch-categories-list" data-testid="batch-categories-list">
                {allCategories.map(opt => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
            </div>

            {/* Payment Method */}
            <div className="flex flex-col space-y-1">
              <div className="flex items-center space-x-2">
                <input 
                  id="toggle-method"
                  type="checkbox"
                  checked={enableMethod}
                  onChange={(e) => setEnableMethod(e.target.checked)}
                  className="rounded text-indigo-650 focus:ring-indigo-500 border-gray-300 cursor-pointer w-4 h-4"
                />
                <label htmlFor="batch-method" className="text-[10px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer">
                  Payment Method
                </label>
              </div>
              <select
                id="batch-method"
                disabled={!enableMethod}
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className={`border rounded-xl px-3 py-2 text-xs font-semibold outline-none cursor-pointer transition-all ${
                  enableMethod ? 'border-indigo-600 bg-white' : 'border-gray-200 bg-gray-50/50 text-gray-400'
                }`}
              >
                <option value="">Select Payment Method</option>
                {paymentMethods.map(m => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>

            {/* Date */}
            <div className="flex flex-col space-y-1">
              <div className="flex items-center space-x-2">
                <input 
                  id="toggle-date"
                  type="checkbox"
                  checked={enableDate}
                  onChange={(e) => setEnableDate(e.target.checked)}
                  className="rounded text-indigo-650 focus:ring-indigo-500 border-gray-300 cursor-pointer w-4 h-4"
                />
                <label htmlFor="batch-date" className="text-[10px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer">
                  Transaction Date
                </label>
              </div>
              <input
                id="batch-date"
                type="date"
                disabled={!enableDate}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`border rounded-xl px-3 py-2 text-xs font-semibold outline-none transition-all ${
                  enableDate ? 'border-indigo-600 bg-white' : 'border-gray-200 bg-gray-50/50 text-gray-400'
                }`}
              />
            </div>

            {/* Transaction Type */}
            <div className="flex flex-col space-y-1">
              <div className="flex items-center space-x-2">
                <input 
                  id="toggle-type"
                  type="checkbox"
                  checked={enableType}
                  onChange={(e) => setEnableType(e.target.checked)}
                  className="rounded text-indigo-650 focus:ring-indigo-500 border-gray-300 cursor-pointer w-4 h-4"
                />
                <label htmlFor="batch-type" className="text-[10px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer">
                  Transaction Type
                </label>
              </div>
              <select
                id="batch-type"
                disabled={!enableType}
                value={transactionType}
                onChange={(e) => setTransactionType(e.target.value)}
                className={`border rounded-xl px-3 py-2 text-xs font-semibold outline-none cursor-pointer transition-all ${
                  enableType ? 'border-indigo-600 bg-white' : 'border-gray-200 bg-gray-50/50 text-gray-400'
                }`}
              >
                <option value="expense">Expense</option>
                <option value="refund">Refund</option>
                <option value="transfer">Transfer (Own Account)</option>
                <option value="fixed">Fixed Charge</option>
              </select>
            </div>

            {/* Notes */}
            <div className="flex flex-col space-y-1 md:col-span-2">
              <div className="flex items-center space-x-2">
                <input 
                  id="toggle-notes"
                  type="checkbox"
                  checked={enableNotes}
                  onChange={(e) => setEnableNotes(e.target.checked)}
                  className="rounded text-indigo-650 focus:ring-indigo-500 border-gray-300 cursor-pointer w-4 h-4"
                />
                <label htmlFor="batch-notes" className="text-[10px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer">
                  Notes
                </label>
              </div>
              <textarea
                id="batch-notes"
                disabled={!enableNotes}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Batch modification notes..."
                rows={2}
                className={`border rounded-xl px-3 py-2 text-xs font-semibold outline-none resize-none transition-all ${
                  enableNotes ? 'border-indigo-600 bg-white' : 'border-gray-200 bg-gray-50/50 text-gray-400'
                }`}
              />
            </div>

          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-gray-100 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-500 hover:text-gray-700 text-xs font-bold rounded-xl transition-all cursor-pointer shadow-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-755 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Saving Changes...' : 'Save Changes'}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
