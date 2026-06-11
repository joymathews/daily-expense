import React, { useState, useEffect } from 'react';
import type { GmailMessage, GoldTransaction } from '../../hooks/use-gmail-integration';
import { fetchAuthSession } from 'aws-amplify/auth';

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
    paymentMethod?: string
  ) => Promise<void>;
  
  // Gold Transaction corrections support
  selectedGoldTransaction?: GoldTransaction | null;
  setSelectedGoldTransaction?: (tx: GoldTransaction | null) => void;
  updateGoldTransaction?: (id: string, updates: Partial<GoldTransaction>) => Promise<void>;
}

export const EmailDetailModal: React.FC<EmailDetailModalProps> = ({
  selectedEmail,
  setSelectedEmail,
  markAsTransaction,
  markAsNonTransaction,
  approveTransaction,
  selectedGoldTransaction,
  setSelectedGoldTransaction,
  updateGoldTransaction,
}) => {
  // Staging / Gold shared inputs state
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  
  // Lineage toggle state
  const [showRawInGoldMode, setShowRawInGoldMode] = useState(false);
  const [rawBodyForGoldLineage, setRawBodyForGoldLineage] = useState('');

  // Sync inputs with selected active item
  useEffect(() => {
    if (selectedGoldTransaction) {
      setMerchant(selectedGoldTransaction.merchant);
      setAmount(selectedGoldTransaction.amount);
      setCategory(selectedGoldTransaction.category);
      setDate(selectedGoldTransaction.transactionDate || '');
      setNotes(selectedGoldTransaction.notes || '');
      setPaymentMethod(selectedGoldTransaction.paymentMethod || '');
      setShowRawInGoldMode(false);
      setRawBodyForGoldLineage('');
      
      // Load raw body for lineage if we have a bronze ID
      if (selectedGoldTransaction.bronzeEmailId) {
        fetchAuthSession()
          .then(session => {
            const token = session.tokens?.idToken?.toString();
            const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
            return fetch(`/api/gmail/raw-emails`, { headers });
          })
          .then(res => res.json())
          .then(data => {
            const match = (data.emails || []).find((e: any) => e.id === selectedGoldTransaction.bronzeEmailId);
            if (match) {
              setRawBodyForGoldLineage(match.rawBody || '');
            }
          })
          .catch(err => console.warn('Failed to load raw email body for lineage', err));
      }
    } else if (selectedEmail && selectedEmail.extracted) {
      setMerchant(selectedEmail.extracted.merchant);
      setAmount(selectedEmail.extracted.amount);
      setCategory(selectedEmail.extracted.category);
      setDate(selectedEmail.extracted.date);
      setNotes('');
      setPaymentMethod(selectedEmail.extracted.paymentMethod || '');
    } else {
      setMerchant('');
      setAmount(0);
      setCategory('');
      setDate('');
      setNotes('');
      setPaymentMethod('');
    }
  }, [selectedEmail, selectedGoldTransaction]);

  if (!selectedEmail && !selectedGoldTransaction) return null;

  const isGoldMode = !!selectedGoldTransaction;

  const handleSave = async () => {
    if (isGoldMode && selectedGoldTransaction && updateGoldTransaction) {
      await updateGoldTransaction(selectedGoldTransaction.id, {
        merchant,
        amount,
        category,
        transactionDate: date,
        notes,
        paymentMethod,
      });
      setSelectedGoldTransaction!(null);
    } else if (selectedEmail && selectedEmail.extracted) {
      await approveTransaction(
        selectedEmail.extracted.id,
        merchant,
        amount,
        selectedEmail.extracted.currency,
        date,
        category,
        notes,
        paymentMethod
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
  const emailDate = isGoldMode ? (selectedGoldTransaction?.emailReceivedAt || 'N/A') : selectedEmail?.date;

  const isBronze = !selectedGoldTransaction && (!selectedEmail?.extracted || selectedEmail.extracted.status !== 'approved');
  const isSilver = !selectedGoldTransaction && selectedEmail?.extracted && selectedEmail.extracted.status === 'pending';
  const isGold = isGoldMode || (selectedEmail?.extracted && selectedEmail.extracted.status === 'approved');

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
          
          {/* Main Edit Form for Gold Corrections or Silver Pending */}
          {(isGoldMode || (selectedEmail?.extracted && selectedEmail.extracted.status === 'pending')) ? (
            <div className="border border-indigo-100/50 rounded-2xl bg-indigo-50/15 p-5 space-y-4">
              <div className="text-xs font-bold text-indigo-700 uppercase tracking-wider border-b border-indigo-100/35 pb-2">
                {isGoldMode ? 'Ledger Corrections (Gold Table)' : 'Staging Area (LLM Extracted Details)'}
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <label htmlFor="modal-merchant" className="block font-bold text-gray-500 uppercase tracking-wide mb-1">Merchant</label>
                  <input 
                    id="modal-merchant"
                    type="text" 
                    className="w-full px-3 py-2 bg-white border border-gray-200 focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all shadow-sm"
                    value={merchant}
                    onChange={(e) => setMerchant(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="modal-amount" className="block font-bold text-gray-500 uppercase tracking-wide mb-1">Amount</label>
                  <input 
                    id="modal-amount"
                    type="number" 
                    step="0.01"
                    className="w-full px-3 py-2 bg-white border border-gray-200 focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all shadow-sm"
                    value={amount}
                    onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <label htmlFor="modal-category" className="block font-bold text-gray-500 uppercase tracking-wide mb-1">Category</label>
                  <input 
                    id="modal-category"
                    type="text" 
                    className="w-full px-3 py-2 bg-white border border-gray-200 focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all shadow-sm"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="modal-date" className="block font-bold text-gray-500 uppercase tracking-wide mb-1">Date</label>
                  <input 
                    id="modal-date"
                    type="date" 
                    className="w-full px-3 py-2 bg-white border border-gray-200 focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all shadow-sm"
                    value={date ? date.split('T')[0] : ''}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="modal-payment-method" className="block font-bold text-gray-500 uppercase tracking-wide mb-1">Payment Method</label>
                  <input 
                    id="modal-payment-method"
                    type="text" 
                    placeholder="e.g. UPI, HDFC credit card"
                    className="w-full px-3 py-2 bg-white border border-gray-200 focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all shadow-sm"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  />
                </div>
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

          {/* Decoded Plain Text Body (for raw review) */}
          {(!isGoldMode || showRawInGoldMode) && (
            <div>
              <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Message Body (Bronze Raw Data)</div>
              <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700 bg-gray-50/50 p-4 rounded-2xl border border-gray-150/70 max-h-48 overflow-y-auto leading-relaxed">
                {isGoldMode ? rawBodyForGoldLineage : selectedEmail?.body}
              </pre>
            </div>
          )}

          {isGoldMode && !showRawInGoldMode && (
            <button
              type="button"
              onClick={() => setShowRawInGoldMode(true)}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-850 uppercase tracking-wider flex items-center space-x-1.5 cursor-pointer"
            >
              <span>🔍 Trace Lineage: View Source Bronze Raw Email</span>
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
                : selectedEmail?.hasTransaction 
                  ? 'bg-indigo-50 text-indigo-750 border-indigo-200/50' 
                  : 'bg-amber-50 text-amber-700 border-amber-200/50'
            }`}>
              {isGoldMode || selectedEmail?.extracted?.status === 'approved' ? 'Approved Ledger' : selectedEmail?.hasTransaction ? 'Transactional' : 'Non-Transactional'}
            </span>
          </div>
          
          <div className="flex space-x-3 w-full sm:w-auto justify-end">
            {(isGoldMode || (selectedEmail?.extracted && selectedEmail.extracted.status === 'pending')) ? (
              <button
                type="button"
                onClick={handleSave}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors uppercase tracking-wider cursor-pointer shadow-sm"
              >
                {isGoldMode ? 'Save Corrections' : 'Approve & Save'}
              </button>
            ) : selectedEmail && !selectedEmail.extracted ? (
              // Raw non-extracted email operations
              selectedEmail.hasTransaction ? (
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
              )
            ) : null}
            
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

