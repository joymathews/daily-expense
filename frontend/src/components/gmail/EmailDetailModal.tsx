import React, { useState, useEffect } from 'react';
import type { GmailMessage, GoldTransaction, SilverTransaction, PaymentMethod } from '../../hooks/use-gmail-integration';
import { fetchAuthSession } from 'aws-amplify/auth';
import { formatToUserTimezone } from '../../utils/date-formatter';

interface EmailDetailModalProps {
  selectedEmail: GmailMessage | null;
  setSelectedEmail: (email: GmailMessage | null) => void;
  markAsTransaction: (id: string) => void;
  markAsNonTransaction: (id: string) => void;
  approveTransaction: (
    silverId: string,
    merchant: string,
    amount: number,
    currency: string,
    date: string,
    category: string,
    notes?: string,
    paymentMethod?: string,
    transactionType?: 'expense' | 'refund' | 'transfer' | 'fixed',
    parentTransactionId?: string
  ) => Promise<void>;
  
  // Gold Transaction corrections support
  selectedGoldTransaction?: GoldTransaction | null;
  setSelectedGoldTransaction?: (tx: GoldTransaction | null) => void;
  updateGoldTransaction?: (id: string, updates: Partial<GoldTransaction>) => Promise<void>;
  updateSilverTransaction?: (id: string, updates: Partial<SilverTransaction>) => Promise<void>;

  // Lineage lists
  rawEmails: GmailMessage[];
  silverTransactions: SilverTransaction[];
  goldTransactions: GoldTransaction[];
  onDeleteClick: (
    sourceStage: 'bronze' | 'silver' | 'gold',
    lineage: { bronzeId?: string; silverId?: string; goldId?: string }
  ) => void;
  extractSelectedEmails?: (ids: string[]) => Promise<void>;
  paymentMethods?: PaymentMethod[];
  rejectBronzeInput?: (id: string) => Promise<void> | void;
  updateBronzeStatus?: (id: string, status: 'unprocessed' | 'processed' | 'rejected') => Promise<void> | void;
  fetchLlmLog?: (bronzeId: string) => Promise<any | null>;
}

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

export const EmailDetailModal: React.FC<EmailDetailModalProps> = ({
  selectedEmail,
  setSelectedEmail,
  markAsTransaction,
  markAsNonTransaction,
  approveTransaction,
  selectedGoldTransaction,
  setSelectedGoldTransaction,
  updateGoldTransaction,
  updateSilverTransaction,
  rawEmails,
  silverTransactions,
  goldTransactions,
  onDeleteClick,
  extractSelectedEmails,
  paymentMethods = [],
  rejectBronzeInput,
  updateBronzeStatus,
  fetchLlmLog,
}) => {
  // Staging / Gold shared inputs state
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState(0);
  const [currency, setCurrency] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [transactionType, setTransactionType] = useState('expense');
  const [parentTransactionId, setParentTransactionId] = useState('');
  
  // Lineage toggle state
  const [showRawInGoldMode, setShowRawInGoldMode] = useState(false);
  const [rawBodyForGoldLineage, setRawBodyForGoldLineage] = useState('');
  const [llmLog, setLlmLog] = useState<any | null>(null);

  const bronzeInputIdForLog = selectedGoldTransaction?.bronzeInputId || selectedEmail?.id;

  useEffect(() => {
    if (bronzeInputIdForLog && fetchLlmLog) {
      fetchLlmLog(bronzeInputIdForLog)
        .then(log => setLlmLog(log))
        .catch(err => console.warn('Failed to load LLM log for modal', err));
    } else {
      setLlmLog(null);
    }
  }, [bronzeInputIdForLog, fetchLlmLog]);

  // Dynamically attach extracted silver record if selectedEmail has none, for pipeline backward-compatibility
  if (selectedEmail && !selectedEmail.extracted && silverTransactions) {
    const silverRecord = silverTransactions.find(tx => tx.rawEmailId === selectedEmail.id);
    if (silverRecord) {
      selectedEmail.extracted = {
        id: silverRecord.id,
        merchant: silverRecord.merchantNormalized || silverRecord.merchantRaw,
        amount: silverRecord.amount,
        currency: silverRecord.currency,
        date: silverRecord.transactionDate,
        category: silverRecord.inferredCategory || 'Other',
        status: silverRecord.status as any,
        paymentMethod: silverRecord.paymentMethod,
        transactionType: silverRecord.transactionType,
        parentTransactionId: silverRecord.parentTransactionId,
      };
    }
  }

  const isGoldMode = !!selectedGoldTransaction;
  const isBronze = !selectedGoldTransaction && (!selectedEmail?.extracted || (selectedEmail.extracted.status !== 'approved' && selectedEmail.extracted.status !== 'pending' && selectedEmail.extracted.status !== 'error' && selectedEmail.extracted.status !== 'rejected'));
  const isSilver = !selectedGoldTransaction && selectedEmail?.extracted && (selectedEmail.extracted.status === 'pending' || selectedEmail.extracted.status === 'error' || selectedEmail.extracted.status === 'rejected');
  const isGold = isGoldMode || (selectedEmail?.extracted && selectedEmail.extracted.status === 'approved');

  const isMerchantInvalid = isSilver && !merchant.trim();
  const isAmountInvalid = isSilver && (amount === undefined || amount === null || isNaN(amount) || amount === 0);
  const isDateInvalid = isSilver && (!date.trim() || date === 'N/A');
  const isMethodInvalid = isSilver && (!paymentMethod.trim() || paymentMethod === 'Unknown' || paymentMethod === 'N/A');
  const isCurrencyInvalid = isSilver && !currency.trim();
  const hasValidationErrors = isMerchantInvalid || isAmountInvalid || isDateInvalid || isMethodInvalid || isCurrencyInvalid;

  const handleUpdateSilver = async () => {
    if (selectedEmail?.extracted && updateSilverTransaction) {
      await updateSilverTransaction(selectedEmail.extracted.id, {
        merchantRaw: merchant,
        merchantNormalized: merchant,
        amount: amount,
        currency: currency,
        transactionDate: date,
        paymentMethod: paymentMethod,
        inferredCategory: category,
        transactionType: transactionType as any,
        parentTransactionId: parentTransactionId || null as any,
      });
      
      const isErr = !merchant.trim() || !date.trim() || date === 'N/A' || amount === 0 || !paymentMethod.trim() || paymentMethod === 'Unknown' || paymentMethod === 'N/A' || !currency.trim();
      const updatedStatus = isErr ? 'error' : 'pending';

      setSelectedEmail({
        ...selectedEmail,
        extracted: {
          ...selectedEmail.extracted,
          merchant,
          amount,
          currency,
          date,
          category,
          paymentMethod,
          status: updatedStatus,
          transactionType: transactionType as any,
          parentTransactionId: parentTransactionId || undefined,
        }
      });
    }
  };

  const handleRejectSilver = async () => {
    if (selectedEmail?.extracted && updateSilverTransaction) {
      await updateSilverTransaction(selectedEmail.extracted.id, {
        status: 'rejected',
      });
      setSelectedEmail({
        ...selectedEmail,
        extracted: {
          ...selectedEmail.extracted,
          status: 'rejected',
        }
      });
    }
  };

  // Resolve parent transaction candidates for linkages
  const parentCandidates = React.useMemo(() => {
    return goldTransactions.filter(
      (tx) =>
        tx.transactionType !== 'refund' &&
        tx.transactionType !== 'transfer' &&
        (!selectedGoldTransaction || tx.id !== selectedGoldTransaction.id)
    );
  }, [goldTransactions, selectedGoldTransaction]);

  // Resolve related records for the selected item (lineage tracking)
  const resolvedLineage = React.useMemo(() => {
    let bronzeRecord: GmailMessage | null = null;
    let silverRecord: SilverTransaction | null = null;
    let goldRecord: GoldTransaction | null = null;

    if (selectedGoldTransaction) {
      goldRecord = selectedGoldTransaction;
      if (selectedGoldTransaction.bronzeInputId) {
        bronzeRecord = rawEmails.find(e => e.id === selectedGoldTransaction.bronzeInputId) || null;
      }
      if (selectedGoldTransaction.pendingTxId) {
        silverRecord = silverTransactions.find(tx => tx.id === selectedGoldTransaction.pendingTxId) || null;
      }
    } else if (selectedEmail) {
      bronzeRecord = selectedEmail;
      // Find in Silver Staging
      silverRecord = silverTransactions.find(tx => tx.rawEmailId === selectedEmail.id) || null;
      // Find in Gold confirmed
      goldRecord = goldTransactions.find(tx => tx.bronzeInputId === selectedEmail.id || (silverRecord && tx.pendingTxId === silverRecord.id)) || null;
    }

    return { bronzeRecord, silverRecord, goldRecord };
  }, [selectedEmail, selectedGoldTransaction, rawEmails, silverTransactions, goldTransactions]);

  // Sync inputs with selected active item
  useEffect(() => {
    if (selectedGoldTransaction) {
      setMerchant(selectedGoldTransaction.merchant);
      setAmount(selectedGoldTransaction.amount);
      setCurrency(selectedGoldTransaction.currency || '');
      setCategory(selectedGoldTransaction.category);
      setDate(selectedGoldTransaction.transactionDate || '');
      setNotes(selectedGoldTransaction.notes || '');
      setPaymentMethod(selectedGoldTransaction.paymentMethod || '');
      setTransactionType(selectedGoldTransaction.transactionType || 'expense');
      setParentTransactionId(selectedGoldTransaction.parentTransactionId || '');
      setShowRawInGoldMode(false);
      setRawBodyForGoldLineage('');
      
      // Load raw body for lineage if we have a bronze ID
      if (selectedGoldTransaction.bronzeInputId) {
        fetchAuthSession()
          .then(session => {
            const token = session.tokens?.idToken?.toString();
            const headers: Record<string, string> = token ? { 'Authorization': `Bearer ${token}` } : {};
            return fetch(`/api/gmail/raw-emails`, { headers });
          })
          .then(res => res.json())
          .then(data => {
            const match = (data.emails || []).find((e: any) => e.id === selectedGoldTransaction.bronzeInputId);
            if (match) {
              setRawBodyForGoldLineage(match.rawBody || '');
            }
          })
          .catch(err => console.warn('Failed to load raw email body for lineage', err));
      }
    } else if (selectedEmail && selectedEmail.extracted) {
      setMerchant(selectedEmail.extracted.merchant);
      setAmount(selectedEmail.extracted.amount);
      setCurrency(selectedEmail.extracted.currency || '');
      setCategory(selectedEmail.extracted.category);
      setDate(selectedEmail.extracted.date);
      setNotes('');
      setPaymentMethod(selectedEmail.extracted.paymentMethod || '');
      setTransactionType(selectedEmail.extracted.transactionType || 'expense');
      setParentTransactionId(selectedEmail.extracted.parentTransactionId || '');
    } else {
      setMerchant('');
      setAmount(0);
      setCurrency('');
      setCategory('');
      setDate('');
      setNotes('');
      setPaymentMethod('');
      setTransactionType('expense');
      setParentTransactionId('');
    }
  }, [selectedEmail, selectedGoldTransaction]);

  if (!selectedEmail && !selectedGoldTransaction) return null;



  const handleSave = async () => {
    if (isGoldMode && selectedGoldTransaction && updateGoldTransaction) {
      await updateGoldTransaction(selectedGoldTransaction.id, {
        merchant,
        amount,
        currency,
        category,
        transactionDate: date,
        notes,
        paymentMethod,
        transactionType: transactionType as any,
        parentTransactionId: parentTransactionId || null as any,
      });
      setSelectedGoldTransaction!(null);
    } else if (selectedEmail && selectedEmail.extracted) {
      await approveTransaction(
        selectedEmail.extracted.id,
        merchant,
        amount,
        currency,
        date,
        category,
        notes,
        paymentMethod,
        transactionType as any,
        parentTransactionId || undefined
      );
    }
  };

  const handleClose = () => {
    if (isGoldMode) {
      setSelectedGoldTransaction!(null);
    } else {
      setSelectedEmail(null);
    }
  };

  const emailSubject = isGoldMode ? (selectedGoldTransaction?.emailSubject || 'Ledger Record') : selectedEmail?.subject;
  const emailSender = isGoldMode ? (selectedGoldTransaction?.emailSender || 'N/A') : selectedEmail?.sender;
  const emailDate = formatToUserTimezone(isGoldMode ? (selectedGoldTransaction?.emailReceivedAt || 'N/A') : selectedEmail?.date, true);



  return (
    <div 
      data-testid="email-detail-modal"
      className="fixed inset-0 bg-gray-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in"
    >
      <div className="bg-white rounded-2xl border border-gray-100 shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider truncate max-w-[80%]">
            {isGoldMode ? `Correct Gold Ledger: ${selectedGoldTransaction?.merchant}` : emailSubject}
          </h3>
          <button 
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-700 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
        
        {/* Lineage Info Header */}
        <div className="px-5 py-3 border-b border-gray-100 bg-white text-xs space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-gray-500">
            <div><span className="font-bold text-gray-400 uppercase text-[10px] tracking-wider block">Original Sender</span> <span className="text-gray-800 font-semibold">{emailSender}</span></div>
            <div><span className="font-bold text-gray-400 uppercase text-[10px] tracking-wider block">Received At</span> <span className="text-gray-800 font-semibold">{emailDate}</span></div>
          </div>
          
          {/* Visual Medallion Pipeline Tracker */}
          <div className="pt-3 border-t border-gray-50 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className={`w-3 h-3 rounded-full flex items-center justify-center text-[8px] font-black text-white ${isBronze ? 'bg-amber-500 ring-4 ring-amber-100' : 'bg-amber-400'}`}></span>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isBronze ? 'text-amber-700 font-extrabold' : 'text-gray-400'}`}>Bronze Raw</span>
            </div>
            <div className={`flex-1 h-[2px] mx-3 ${isSilver || isGold ? 'bg-indigo-300' : 'bg-gray-100'}`}></div>
            <div className="flex items-center space-x-2">
              <span className={`w-3 h-3 rounded-full flex items-center justify-center text-[8px] font-black text-white ${isSilver ? 'bg-indigo-600 ring-4 ring-indigo-100' : isGold ? 'bg-indigo-400' : 'bg-gray-200'}`}></span>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isSilver ? 'text-indigo-700 font-extrabold' : 'text-gray-400'}`}>Silver Staging</span>
            </div>
            <div className={`flex-1 h-[2px] mx-3 ${isGold ? 'bg-emerald-300' : 'bg-gray-100'}`}></div>
            <div className="flex items-center space-x-2">
              <span className={`w-3 h-3 rounded-full flex items-center justify-center text-[8px] font-black text-white ${isGold ? 'bg-emerald-500 ring-4 ring-emerald-100' : 'bg-gray-200'}`}></span>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isGold ? 'text-emerald-700 font-extrabold' : 'text-gray-400'}`}>Gold Ledger</span>
            </div>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="p-5 overflow-y-auto flex-1 bg-white space-y-5">
          
          {/* Medallion Pipeline Lineage Explorer */}
          <div className="border border-gray-150/70 rounded-2xl bg-gray-50/30 p-4 space-y-3">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-150/70 pb-2 flex items-center justify-between">
              <span>🔗 Medallion Data Lineage Linkages</span>
              <span className="text-[10px] text-gray-400 lowercase font-medium">Trace data evolution</span>
            </div>
            
            <div className="space-y-2.5">
              {/* Bronze Row */}
              <div className="flex items-start space-x-3 text-xs">
                <span className="flex-shrink-0 w-16 text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 border border-amber-200/50 px-1.5 py-0.5 rounded text-center">
                  Bronze
                </span>
                <div className="flex-1 min-w-0">
                  {resolvedLineage.bronzeRecord ? (
                    <div>
                      <div className="font-bold text-gray-800 truncate" title={resolvedLineage.bronzeRecord.subject}>
                        {resolvedLineage.bronzeRecord.subject}
                      </div>
                      <div className="text-[10px] text-gray-450 truncate">
                        Sender: {resolvedLineage.bronzeRecord.sender} | Date: {formatToUserTimezone(resolvedLineage.bronzeRecord.date, true)}
                      </div>
                    </div>
                  ) : (
                    <span className="text-gray-450 italic">No Bronze raw email found</span>
                  )}
                </div>
              </div>

              {/* Silver Row */}
              <div className="flex items-start space-x-3 text-xs">
                <span className="flex-shrink-0 w-16 text-[10px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 border border-indigo-200/50 px-1.5 py-0.5 rounded text-center">
                  Silver
                </span>
                <div className="flex-1 min-w-0">
                  {resolvedLineage.silverRecord ? (
                    <div>
                      <div className="font-bold text-gray-800">
                        {resolvedLineage.silverRecord.merchantNormalized || resolvedLineage.silverRecord.merchantRaw} -{' '}
                        <span className="text-indigo-600 font-extrabold">
                          {resolvedLineage.silverRecord.amount.toFixed(2)} {resolvedLineage.silverRecord.currency}
                        </span>
                        {resolvedLineage.silverRecord.transactionType === 'refund' && (
                          <span className="ml-1.5 bg-emerald-100 text-emerald-800 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                            Refund
                          </span>
                        )}
                        {resolvedLineage.silverRecord.transactionType === 'transfer' && (
                          <span className="ml-1.5 bg-indigo-100 text-indigo-800 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                            Transfer
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-450">
                        Category: {resolvedLineage.silverRecord.inferredCategory || 'N/A'} | Status: {resolvedLineage.silverRecord.status} | Method: {resolvedLineage.silverRecord.paymentMethod || 'Unknown'}
                      </div>
                    </div>
                  ) : (
                    <span className="text-gray-450 italic">Pending LLM extraction / No staging record found</span>
                  )}
                </div>
              </div>

              {/* Gold Row */}
              <div className="flex items-start space-x-3 text-xs">
                <span className="flex-shrink-0 w-16 text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 border border-emerald-200/50 px-1.5 py-0.5 rounded text-center">
                  Gold
                </span>
                <div className="flex-1 min-w-0">
                  {resolvedLineage.goldRecord ? (
                    <div>
                      <div className="font-bold text-gray-800">
                        {resolvedLineage.goldRecord.merchant} -{' '}
                        <span className="text-emerald-600 font-extrabold">
                          {resolvedLineage.goldRecord.transactionType === 'refund' ? '-' : ''}{resolvedLineage.goldRecord.amount.toFixed(2)} {resolvedLineage.goldRecord.currency}
                        </span>
                        {resolvedLineage.goldRecord.transactionType === 'refund' && (
                          <span className="ml-1.5 bg-emerald-100 text-emerald-800 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                            Refund
                          </span>
                        )}
                        {resolvedLineage.goldRecord.transactionType === 'transfer' && (
                          <span className="ml-1.5 bg-indigo-100 text-indigo-800 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                            Transfer
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-450 truncate">
                        Category: {resolvedLineage.goldRecord.category} | Method: {resolvedLineage.goldRecord.paymentMethod || 'Unknown'} {resolvedLineage.goldRecord.notes ? `| Notes: ${resolvedLineage.goldRecord.notes}` : ''}
                        {resolvedLineage.goldRecord.parentTransactionId && ` | Linked Purchase ID: ${resolvedLineage.goldRecord.parentTransactionId}`}
                      </div>
                    </div>
                  ) : (
                    <span className="text-gray-450 italic">Not approved or promoted to confirmed ledger yet</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Main Edit Form for Gold Corrections or Silver Pending/Error */}
          {(isGoldMode || (selectedEmail?.extracted && (selectedEmail.extracted.status === 'pending' || selectedEmail.extracted.status === 'error' || selectedEmail.extracted.status === 'rejected'))) ? (
            <div className="border border-indigo-100/50 rounded-2xl bg-indigo-50/15 p-5 space-y-4">
              <div className="text-xs font-bold text-indigo-700 uppercase tracking-wider border-b border-indigo-100/35 pb-2">
                {isGoldMode ? 'Ledger Corrections (Gold Table)' : 'Staging Area (LLM Extracted Details)'}
              </div>

              {isSilver && selectedEmail?.extracted?.status === 'error' && (
                <div data-testid="staging-error-alert" className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3 text-xs font-semibold mb-2">
                  ⚠️ This staging record is missing required fields (merchant, date, amount, or payment method) and cannot be approved until they are corrected.
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <label htmlFor="modal-merchant" className="block font-bold text-gray-500 uppercase tracking-wide mb-1">Merchant</label>
                  <input 
                    id="modal-merchant"
                    type="text" 
                    className={`w-full px-3 py-2 bg-white border focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all shadow-sm ${
                      isMerchantInvalid ? 'border-rose-300 bg-rose-50/5' : 'border-gray-200'
                    }`}
                    value={merchant}
                    onChange={(e) => setMerchant(e.target.value)}
                  />
                  {isMerchantInvalid && <span className="text-[10px] text-rose-600 font-bold mt-1 block">Merchant name is required</span>}
                </div>
                <div>
                  <label htmlFor="modal-amount" className="block font-bold text-gray-500 uppercase tracking-wide mb-1">Amount</label>
                  <input 
                    id="modal-amount"
                    type="number" 
                    step="0.01"
                    className={`w-full px-3 py-2 bg-white border focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all shadow-sm ${
                      isAmountInvalid ? 'border-rose-300 bg-rose-50/5' : 'border-gray-200'
                    }`}
                    value={amount}
                    onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                  />
                  {isAmountInvalid && <span className="text-[10px] text-rose-600 font-bold mt-1 block">Valid non-zero amount is required</span>}
                </div>
                <div>
                  <label htmlFor="modal-currency" className="block font-bold text-gray-500 uppercase tracking-wide mb-1">Currency</label>
                  <input 
                    id="modal-currency"
                    type="text" 
                    className={`w-full px-3 py-2 bg-white border focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all shadow-sm ${
                      isCurrencyInvalid ? 'border-rose-300 bg-rose-50/5' : 'border-gray-200'
                    }`}
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                    placeholder="e.g. INR, USD"
                  />
                  {isCurrencyInvalid && <span className="text-[10px] text-rose-600 font-bold mt-1 block">Currency code is required</span>}
                </div>
                <div>
                  <label htmlFor="modal-category" className="block font-bold text-gray-500 uppercase tracking-wide mb-1">Category</label>
                  <input 
                    id="modal-category"
                    type="text"
                    list="modal-categories-list"
                    className="w-full px-3 py-2 bg-white border border-gray-200 focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all shadow-sm"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  />
                  <datalist id="modal-categories-list">
                    {STANDARD_CATEGORIES.map(opt => (
                      <option key={opt} value={opt} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label htmlFor="modal-date" className="block font-bold text-gray-500 uppercase tracking-wide mb-1">Date</label>
                  <input 
                    id="modal-date"
                    type="date" 
                    className={`w-full px-3 py-2 bg-white border focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all shadow-sm ${
                      isDateInvalid ? 'border-rose-300 bg-rose-50/5' : 'border-gray-200'
                    }`}
                    value={date ? date.split('T')[0] : ''}
                    onChange={(e) => setDate(e.target.value)}
                  />
                  {isDateInvalid && <span className="text-[10px] text-rose-600 font-bold mt-1 block">Valid transaction date is required</span>}
                </div>
                <div>
                  <label htmlFor="modal-payment-method" className="block font-bold text-gray-500 uppercase tracking-wide mb-1">Payment Method</label>
                  <select 
                    id="modal-payment-method"
                    className={`w-full px-3 py-2 bg-white border focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all shadow-sm cursor-pointer ${
                      isMethodInvalid ? 'border-rose-300 bg-rose-50/5' : 'border-gray-200'
                    }`}
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    <option value="">Select Payment Method</option>
                    {paymentMethods.map(m => (
                      <option key={m.id} value={m.name}>{m.name}</option>
                    ))}
                    {paymentMethod && !paymentMethods.some(m => m.name === paymentMethod) && (
                      <option value={paymentMethod}>{paymentMethod}</option>
                    )}
                  </select>
                  {isMethodInvalid && <span className="text-[10px] text-rose-600 font-bold mt-1 block">Payment method is required</span>}
                </div>
                <div>
                  <label htmlFor="modal-transaction-type" className="block font-bold text-gray-500 uppercase tracking-wide mb-1">Transaction Type</label>
                  <select 
                    id="modal-transaction-type"
                    className="w-full px-3 py-2 bg-white border border-gray-200 focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all shadow-sm cursor-pointer"
                    value={transactionType}
                    onChange={(e) => {
                      setTransactionType(e.target.value);
                      if (e.target.value !== 'refund') {
                        setParentTransactionId('');
                      }
                    }}
                  >
                    <option value="expense">Expense</option>
                    <option value="refund">Refund</option>
                    <option value="transfer">Transfer (Own Account)</option>
                    <option value="fixed">Fixed Charge</option>
                  </select>
                </div>
                {transactionType === 'refund' && (
                  <div className="col-span-1 md:col-span-2">
                    <label htmlFor="modal-parent-link" className="block font-bold text-gray-500 uppercase tracking-wide mb-1">Link to Purchase (Reversal)</label>
                    <select 
                      id="modal-parent-link"
                      className="w-full px-3 py-2 bg-white border border-gray-200 focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-750 transition-all shadow-sm cursor-pointer"
                      value={parentTransactionId}
                      onChange={(e) => setParentTransactionId(e.target.value)}
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
                <div className="col-span-1 md:col-span-2">
                  <label htmlFor="modal-notes" className="block font-bold text-gray-500 uppercase tracking-wide mb-1">Notes / Comments</label>
                  <input 
                    id="modal-notes"
                    type="text" 
                    placeholder="Add ledger review comments..."
                    className="w-full px-3 py-2 bg-white border border-gray-200 focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all shadow-sm"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>

              {isSilver && llmLog && (
                <div data-testid="silver-llm-extracted-preview" className="mt-4 border-t border-indigo-100/35 pt-4 space-y-2.5">
                  <div className="text-[11px] font-bold text-gray-550 uppercase tracking-wider flex items-center gap-1.5">
                    <span>🤖 Original LLM Extracted Details (Read-Only)</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-gray-50/60 p-3.5 rounded-xl border border-gray-150/50 text-xs">
                    <div>
                      <span className="font-bold text-gray-400 uppercase text-[9px] tracking-wide block mb-0.5">Merchant</span>
                      <span className="font-semibold text-gray-800">{llmLog.extractedMerchant || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="font-bold text-gray-400 uppercase text-[9px] tracking-wide block mb-0.5">Amount</span>
                      <span className="font-semibold text-gray-800">
                        {llmLog.extractedAmount !== undefined && llmLog.extractedAmount !== null
                          ? `${llmLog.extractedAmount.toFixed(2)} ${llmLog.extractedCurrency || 'INR'}`
                          : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="font-bold text-gray-400 uppercase text-[9px] tracking-wide block mb-0.5">Category</span>
                      <span className="font-semibold text-gray-800">{llmLog.extractedCategory || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="font-bold text-gray-400 uppercase text-[9px] tracking-wide block mb-0.5">Payment Method</span>
                      <span className="font-semibold text-gray-850 truncate block" title={llmLog.extractedPaymentMethod || 'Unknown'}>
                        {llmLog.extractedPaymentMethod || 'Unknown'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            selectedEmail?.extracted && (
              <div className="border border-indigo-150 rounded-2xl bg-indigo-50/15 p-4 space-y-3">
                <div className="text-xs font-bold text-indigo-700 uppercase tracking-wider border-b border-indigo-100/35 pb-1.5">
                  Staging Area (LLM Extracted Details)
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs text-gray-700">
                  <div><span className="font-bold text-gray-400 uppercase text-[10px] tracking-wide block">Merchant</span> <span className="font-semibold text-gray-900">{selectedEmail.extracted.merchant}</span></div>
                  <div><span className="font-bold text-gray-400 uppercase text-[10px] tracking-wide block">Amount</span> <span className="font-semibold text-gray-900">{selectedEmail.extracted.amount} {selectedEmail.extracted.currency}</span></div>
                  <div><span className="font-bold text-gray-400 uppercase text-[10px] tracking-wide block">Category</span> <span className="font-semibold text-gray-900">{selectedEmail.extracted.category}</span></div>
                  <div><span className="font-bold text-gray-400 uppercase text-[10px] tracking-wide block">Date</span> <span className="font-semibold text-gray-900">{selectedEmail.extracted.date.split('T')[0]}</span></div>
                  <div><span className="font-bold text-gray-400 uppercase text-[10px] tracking-wide block">Method</span> <span className="font-semibold text-gray-900">{selectedEmail.extracted.paymentMethod || 'Unknown'}</span></div>
                </div>
              </div>
            )
          )}

          {/* Collapsible Lineage Trace for Gold Mode */}
          {isGoldMode && showRawInGoldMode && (
            <div className="space-y-4 pt-2 border-t border-gray-100">
              {resolvedLineage.silverRecord && (
                <div data-testid="lineage-silver-card" className="border border-indigo-100/60 rounded-2xl bg-indigo-50/10 p-4 space-y-2.5 shadow-sm animate-fade-in">
                  <div className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider border-b border-indigo-100/30 pb-1.5 flex justify-between items-center">
                    <span>📥 Silver Staging Capture (Pre-Correction)</span>
                    <span className="text-[9px] text-gray-400 font-medium">Original staging record</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3.5 text-xs text-gray-650">
                    <div>
                      <span className="font-bold text-gray-400 uppercase text-[9px] tracking-wide block mb-0.5">Merchant</span>
                      <span className="font-semibold text-gray-800">{resolvedLineage.silverRecord.merchantNormalized || resolvedLineage.silverRecord.merchantRaw}</span>
                    </div>
                    <div>
                      <span className="font-bold text-gray-400 uppercase text-[9px] tracking-wide block mb-0.5">Amount</span>
                      <span className="font-semibold text-gray-800">{resolvedLineage.silverRecord.amount.toFixed(2)} {resolvedLineage.silverRecord.currency}</span>
                    </div>
                    <div>
                      <span className="font-bold text-gray-400 uppercase text-[9px] tracking-wide block mb-0.5">Category</span>
                      <span className="font-semibold text-gray-800">{resolvedLineage.silverRecord.inferredCategory || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="font-bold text-gray-400 uppercase text-[9px] tracking-wide block mb-0.5">Date</span>
                      <span className="font-semibold text-gray-800">{resolvedLineage.silverRecord.transactionDate}</span>
                    </div>
                    <div>
                      <span className="font-bold text-gray-400 uppercase text-[9px] tracking-wide block mb-0.5">Method</span>
                      <span className="font-semibold text-gray-800">{resolvedLineage.silverRecord.paymentMethod || 'Unknown'}</span>
                    </div>
                    <div>
                      <span className="font-bold text-gray-400 uppercase text-[9px] tracking-wide block mb-0.5">Type</span>
                      <span className="font-semibold text-gray-800 capitalize">{resolvedLineage.silverRecord.transactionType || 'expense'}</span>
                    </div>
                  </div>
                </div>
              )}

              {llmLog && (
                <div data-testid="llm-accuracy-comparison" className="border border-indigo-100/60 rounded-2xl bg-indigo-50/10 p-4 space-y-2.5 shadow-sm animate-fade-in">
                  <div className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider border-b border-indigo-100/30 pb-1.5 flex justify-between items-center">
                    <span>🤖 LLM Extraction Audit (Original vs Confirmed)</span>
                    <span className="text-[9px] text-gray-400 font-medium">Original predictions</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-[11px] divide-y divide-gray-100">
                      <thead>
                        <tr className="text-gray-400 font-bold uppercase text-[9px] tracking-wider text-left">
                          <th className="pb-1.5">Field</th>
                          <th className="pb-1.5">LLM Extracted</th>
                          <th className="pb-1.5">Final Ledger</th>
                          <th className="pb-1.5 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 text-gray-700">
                        <tr>
                          <td className="py-1.5 font-bold text-gray-400 uppercase text-[9px] tracking-wide">Merchant</td>
                          <td className="py-1.5 font-semibold text-gray-800">{llmLog.extractedMerchant}</td>
                          <td className="py-1.5 font-semibold text-gray-800">{merchant}</td>
                          <td className="py-1.5 text-right">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                              (merchant || '').trim().toLowerCase() === (llmLog.extractedMerchant || '').trim().toLowerCase()
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-100/30'
                                : 'bg-amber-50 text-amber-700 border border-amber-100/30'
                            }`}>
                              {(merchant || '').trim().toLowerCase() === (llmLog.extractedMerchant || '').trim().toLowerCase() ? '✅ Match' : '📝 Corrected'}
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td className="py-1.5 font-bold text-gray-400 uppercase text-[9px] tracking-wide">Amount</td>
                          <td className="py-1.5 font-semibold text-gray-800">{(llmLog.extractedAmount).toFixed(2)} {llmLog.extractedCurrency}</td>
                          <td className="py-1.5 font-semibold text-gray-800">{amount.toFixed(2)} {llmLog.extractedCurrency}</td>
                          <td className="py-1.5 text-right">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                              amount === llmLog.extractedAmount
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-100/30'
                                : 'bg-amber-50 text-amber-700 border border-amber-100/30'
                            }`}>
                              {amount === llmLog.extractedAmount ? '✅ Match' : '📝 Corrected'}
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td className="py-1.5 font-bold text-gray-400 uppercase text-[9px] tracking-wide">Category</td>
                          <td className="py-1.5 font-semibold text-gray-800">{llmLog.extractedCategory || 'N/A'}</td>
                          <td className="py-1.5 font-semibold text-gray-800">{category || 'N/A'}</td>
                          <td className="py-1.5 text-right">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                              (category || '').trim().toLowerCase() === (llmLog.extractedCategory || '').trim().toLowerCase()
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-100/30'
                                : 'bg-amber-50 text-amber-700 border border-amber-100/30'
                            }`}>
                              {(category || '').trim().toLowerCase() === (llmLog.extractedCategory || '').trim().toLowerCase() ? '✅ Match' : '📝 Corrected'}
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td className="py-1.5 font-bold text-gray-400 uppercase text-[9px] tracking-wide">Payment Method</td>
                          <td className="py-1.5 font-semibold text-gray-800">{llmLog.extractedPaymentMethod || 'Unknown'}</td>
                          <td className="py-1.5 font-semibold text-gray-800">{paymentMethod || 'Unknown'}</td>
                          <td className="py-1.5 text-right">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                              (paymentMethod || '').trim().toLowerCase() === (llmLog.extractedPaymentMethod || '').trim().toLowerCase()
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-100/30'
                                : 'bg-amber-50 text-amber-700 border border-amber-100/30'
                            }`}>
                              {(paymentMethod || '').trim().toLowerCase() === (llmLog.extractedPaymentMethod || '').trim().toLowerCase() ? '✅ Match' : '📝 Corrected'}
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {(rawBodyForGoldLineage || resolvedLineage.bronzeRecord?.body) && (
                <div>
                  <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Message Body (Bronze Raw Data)</div>
                  <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700 bg-gray-50/50 p-4 rounded-2xl border border-gray-150/70 max-h-48 overflow-y-auto leading-relaxed">
                    {rawBodyForGoldLineage || resolvedLineage.bronzeRecord?.body}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Standard raw email body for non-Gold mode */}
          {!isGoldMode && selectedEmail?.body && (
            <div>
              <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Message Body (Bronze Raw Data)</div>
              <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700 bg-gray-50/50 p-4 rounded-2xl border border-gray-150/70 max-h-48 overflow-y-auto leading-relaxed">
                {selectedEmail.body}
              </pre>
            </div>
          )}

          {/* Lineage Toggle Button */}
          {isGoldMode && (
            <button
              type="button"
              onClick={() => setShowRawInGoldMode(!showRawInGoldMode)}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-850 uppercase tracking-wider flex items-center space-x-1.5 cursor-pointer mt-2"
            >
              <span>{showRawInGoldMode ? '🔼 Collapse Lineage Trace' : '🔍 Trace Lineage: View Staging & Raw Source'}</span>
            </button>
          )}
        </div>

        {/* Actions Footer */}
        <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Status:</span>
            <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase border ${
              isGoldMode || selectedEmail?.extracted?.status === 'approved'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50'
                : selectedEmail?.extracted?.status === 'rejected'
                  ? 'bg-rose-50 text-rose-700 border-rose-200/50'
                  : selectedEmail?.extracted?.status === 'error'
                    ? 'bg-rose-50 text-rose-700 border-rose-200/50'
                    : selectedEmail?.extracted?.status === 'pending'
                      ? 'bg-indigo-50 text-indigo-750 border-indigo-200/50'
                      : selectedEmail?.status === 'rejected'
                        ? 'bg-rose-50 text-rose-700 border-rose-200/50'
                        : selectedEmail?.status === 'processed'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50'
                          : selectedEmail?.hasTransaction 
                            ? 'bg-indigo-50 text-indigo-750 border-indigo-200/50' 
                            : 'bg-amber-50 text-amber-700 border-amber-200/50'
            }`}>
              {isGoldMode || selectedEmail?.extracted?.status === 'approved'
                ? 'Approved Ledger'
                : selectedEmail?.extracted?.status === 'rejected'
                  ? 'Rejected'
                  : selectedEmail?.extracted?.status === 'error'
                    ? 'Error (Missing Fields)'
                    : selectedEmail?.extracted?.status === 'pending'
                      ? 'Staging Review'
                      : selectedEmail?.status === 'rejected'
                        ? 'Rejected'
                        : selectedEmail?.status === 'processed'
                          ? 'Processed'
                          : selectedEmail?.hasTransaction
                            ? 'Transactional'
                            : 'Non-Transactional'}
            </span>
          </div>
          
          <div className="flex flex-wrap gap-2 w-full sm:w-auto justify-end">
            {(isGoldMode || (selectedEmail?.extracted && (selectedEmail.extracted.status === 'pending' || selectedEmail.extracted.status === 'error' || selectedEmail.extracted.status === 'rejected'))) ? (
              <>
                {isSilver && (
                  <button
                    type="button"
                    onClick={handleUpdateSilver}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors uppercase tracking-wider cursor-pointer shadow-sm"
                  >
                    Save Updates
                  </button>
                )}
                {isSilver && selectedEmail?.extracted?.status !== 'rejected' && (
                  <button
                    type="button"
                    onClick={handleRejectSilver}
                    className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors uppercase tracking-wider cursor-pointer shadow-sm"
                    data-testid="modal-reject-btn"
                  >
                    Reject
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={hasValidationErrors}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors uppercase tracking-wider cursor-pointer shadow-sm"
                >
                  {isGoldMode ? 'Save Corrections' : 'Approve & Save'}
                </button>
              </>
            ) : selectedEmail && !selectedEmail.extracted && !resolvedLineage.silverRecord && !resolvedLineage.goldRecord ? (
              // Raw non-extracted email operations
              selectedEmail.status === 'rejected' ? (
                <button
                  type="button"
                  onClick={async () => {
                    if (updateBronzeStatus) {
                      await updateBronzeStatus(selectedEmail.id, 'unprocessed');
                      setSelectedEmail({ ...selectedEmail, status: 'unprocessed' });
                    }
                  }}
                  className="bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-bold px-4 py-2 rounded-xl transition-colors border border-amber-200/50 uppercase tracking-wider cursor-pointer shadow-sm animate-fade-in"
                  data-testid="modal-restore-btn"
                >
                  Restore to Unprocessed
                </button>
              ) : (
                <>
                  {selectedEmail.hasTransaction ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          markAsNonTransaction(selectedEmail.id);
                          setSelectedEmail({ ...selectedEmail, hasTransaction: false });
                        }}
                        className="bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-bold px-4 py-2 rounded-xl transition-colors border border-amber-200/50 uppercase tracking-wider cursor-pointer shadow-sm"
                      >
                        Unmark Tx
                      </button>
                      {extractSelectedEmails && (
                        <button
                          type="button"
                          onClick={async () => {
                            await extractSelectedEmails([selectedEmail.id]);
                            handleClose();
                          }}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors uppercase tracking-wider cursor-pointer shadow-sm"
                          data-testid="modal-extract-btn"
                        >
                          Extract
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        markAsTransaction(selectedEmail.id);
                        setSelectedEmail({ ...selectedEmail, hasTransaction: true });
                      }}
                      className="bg-indigo-55 hover:bg-indigo-100 text-indigo-700 text-xs font-bold px-4 py-2 rounded-xl transition-colors border border-indigo-200/50 uppercase tracking-wider cursor-pointer shadow-sm"
                    >
                      Mark Tx
                    </button>
                  )}
                  {rejectBronzeInput && (
                    <button
                      type="button"
                      onClick={async () => {
                        await rejectBronzeInput(selectedEmail.id);
                        setSelectedEmail({ ...selectedEmail, status: 'rejected' });
                      }}
                      className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors uppercase tracking-wider cursor-pointer shadow-sm"
                      data-testid="modal-bronze-reject-btn"
                    >
                      Reject
                    </button>
                  )}
                </>
              )
            ) : null}
            
            <button
              type="button"
              onClick={() => {
                const lineage = {
                  bronzeId: resolvedLineage.bronzeRecord?.id,
                  silverId: resolvedLineage.silverRecord?.id,
                  goldId: resolvedLineage.goldRecord?.id,
                };
                const currentStage = resolvedLineage.goldRecord 
                  ? 'gold' 
                  : (resolvedLineage.silverRecord ? 'silver' : 'bronze');
                onDeleteClick(currentStage, lineage);
              }}
              className="bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold px-4 py-2 rounded-xl border border-rose-200/50 uppercase tracking-wider cursor-pointer transition-colors shadow-sm"
              data-testid="modal-delete-btn"
            >
              {resolvedLineage.goldRecord 
                ? (resolvedLineage.goldRecord.sourceType === 'manual' ? 'Delete' : 'Revert to Staging') 
                : (resolvedLineage.silverRecord ? 'Revert to Raw' : 'Delete')}
            </button>

            <button
              type="button"
              onClick={handleClose}
              className="bg-white hover:bg-gray-100 text-gray-500 text-xs font-bold px-4 py-2 rounded-xl transition-colors border border-gray-200 uppercase tracking-wider cursor-pointer shadow-sm"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

