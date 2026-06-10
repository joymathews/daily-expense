import React, { useState, useEffect } from 'react';
import type { GmailMessage, GoldTransaction } from '../../hooks/use-gmail-integration';

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
    notes?: string
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
      setShowRawInGoldMode(false);
      setRawBodyForGoldLineage('');
      
      // Load raw body for lineage if we have a bronze ID
      if (selectedGoldTransaction.bronzeEmailId) {
        fetch(`/api/gmail/raw-emails`)
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
    } else {
      setMerchant('');
      setAmount(0);
      setCategory('');
      setDate('');
      setNotes('');
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
        notes
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

  return (
    <div 
      data-testid="email-detail-modal"
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
    >
      <div className="bg-white rounded border border-gray-100 shadow-xl max-w-xl w-full overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
          <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest truncate max-w-[80%]">
            {isGoldMode ? `Correct Gold Ledger: ${selectedGoldTransaction?.merchant}` : emailSubject}
          </h3>
          <button 
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 text-xs font-bold uppercase tracking-wider transition-colors"
          >
            Close
          </button>
        </div>
        
        {/* Lineage Info Header */}
        <div className="px-4 py-2 border-b border-gray-50 bg-white/50 text-[10px] space-y-1">
          <div><span className="font-bold text-gray-400 uppercase">Original Sender:</span> <span className="text-gray-700 font-bold">{emailSender}</span></div>
          <div><span className="font-bold text-gray-400 uppercase">Received At:</span> <span className="text-gray-700 font-bold">{emailDate}</span></div>
          {isGoldMode && selectedGoldTransaction?.pendingTxId && (
            <div className="text-[9px] text-blue-600 font-bold uppercase tracking-tight">
              Lineage Linked: Gold ➔ Silver Staging ({selectedGoldTransaction.pendingTxId.substring(0, 8)}) ➔ Bronze Raw ({selectedGoldTransaction.bronzeEmailId?.substring(0, 8)})
            </div>
          )}
        </div>

        {/* Scrollable Body */}
        <div className="p-4 overflow-y-auto flex-1 bg-white space-y-4">
          
          {/* Main Edit Form for Gold Corrections or Silver Pending */}
          {(isGoldMode || (selectedEmail?.extracted && selectedEmail.extracted.status === 'pending')) ? (
            <div className="border border-blue-100 rounded bg-blue-50/20 p-4 space-y-3">
              <div className="text-[10px] font-black text-blue-600 uppercase tracking-widest border-b border-blue-50 pb-1 mb-2">
                {isGoldMode ? 'Ledger Corrections (Gold Table)' : 'Staging Area (LLM Extracted Details)'}
              </div>
              
              <div className="grid grid-cols-2 gap-3 text-[10px]">
                <div>
                  <label htmlFor="modal-merchant" className="block font-black text-gray-400 uppercase mb-0.5">Merchant</label>
                  <input 
                    id="modal-merchant"
                    type="text" 
                    className="w-full px-2 py-1 bg-white border border-gray-200 focus:border-blue-500 rounded outline-none text-xs text-gray-700"
                    value={merchant}
                    onChange={(e) => setMerchant(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="modal-amount" className="block font-black text-gray-400 uppercase mb-0.5">Amount</label>
                  <input 
                    id="modal-amount"
                    type="number" 
                    step="0.01"
                    className="w-full px-2 py-1 bg-white border border-gray-200 focus:border-blue-500 rounded outline-none text-xs text-gray-700"
                    value={amount}
                    onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <label htmlFor="modal-category" className="block font-black text-gray-400 uppercase mb-0.5">Category</label>
                  <input 
                    id="modal-category"
                    type="text" 
                    className="w-full px-2 py-1 bg-white border border-gray-200 focus:border-blue-500 rounded outline-none text-xs text-gray-700"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="modal-date" className="block font-black text-gray-400 uppercase mb-0.5">Date</label>
                  <input 
                    id="modal-date"
                    type="date" 
                    className="w-full px-2 py-1 bg-white border border-gray-200 focus:border-blue-500 rounded outline-none text-xs text-gray-700"
                    value={date ? date.split('T')[0] : ''}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <div className="col-span-2">
                  <label htmlFor="modal-notes" className="block font-black text-gray-400 uppercase mb-0.5">Notes / Comments</label>
                  <input 
                    id="modal-notes"
                    type="text" 
                    placeholder="Add comments..."
                    className="w-full px-2 py-1 bg-white border border-gray-200 focus:border-blue-500 rounded outline-none text-xs text-gray-700"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>
            </div>
          ) : (
            selectedEmail?.extracted && (
              <div className="border border-blue-100 rounded bg-blue-50/20 p-3 space-y-2">
                <div className="text-[10px] font-black text-blue-600 uppercase tracking-widest border-b border-blue-50 pb-1">
                  Staging Area (LLM Extracted Details)
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-700">
                  <div><span className="font-bold text-gray-400 uppercase">Merchant:</span> {selectedEmail.extracted.merchant}</div>
                  <div><span className="font-bold text-gray-400 uppercase">Amount:</span> {selectedEmail.extracted.amount} {selectedEmail.extracted.currency}</div>
                  <div><span className="font-bold text-gray-400 uppercase">Category:</span> {selectedEmail.extracted.category}</div>
                  <div><span className="font-bold text-gray-400 uppercase">Date:</span> {selectedEmail.extracted.date.split('T')[0]}</div>
                </div>
              </div>
            )
          )}

          {/* Decoded Plain Text Body (for raw review) */}
          {(!isGoldMode || showRawInGoldMode) && (
            <div>
              <div className="text-[10px] font-black text-gray-400 uppercase mb-2">Message Body (Bronze Raw Data)</div>
              <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700 bg-gray-50/50 p-3 rounded border border-gray-100 max-h-48 overflow-y-auto leading-relaxed">
                {isGoldMode ? rawBodyForGoldLineage : selectedEmail?.body}
              </pre>
            </div>
          )}

          {isGoldMode && !showRawInGoldMode && (
            <button
              type="button"
              onClick={() => setShowRawInGoldMode(true)}
              className="text-[9px] font-black text-blue-600 hover:text-blue-800 uppercase tracking-wider flex items-center space-x-1"
            >
              <span>🔍 Trace Lineage: View Source Bronze Raw Email</span>
            </button>
          )}
        </div>

        {/* Actions Footer */}
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <span className="text-[8px] font-black text-gray-400 uppercase">Status:</span>
            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase ${
              isGoldMode || selectedEmail?.extracted?.status === 'approved'
                ? 'bg-green-100 text-green-800'
                : selectedEmail?.hasTransaction 
                  ? 'bg-blue-100 text-blue-800' 
                  : 'bg-amber-100 text-amber-800'
            }`}>
              {isGoldMode || selectedEmail?.extracted?.status === 'approved' ? 'Approved Ledger' : selectedEmail?.hasTransaction ? 'Transactional' : 'Non-Transactional'}
            </span>
          </div>
          
          <div className="flex space-x-2">
            {(isGoldMode || (selectedEmail?.extracted && selectedEmail.extracted.status === 'pending')) ? (
              <button
                type="button"
                onClick={handleSave}
                className="bg-green-600 hover:bg-green-700 text-white text-[9px] font-bold px-3 py-1.5 rounded transition-colors uppercase tracking-wider"
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
                  className="bg-amber-50 hover:bg-amber-100 text-amber-600 text-[9px] font-bold px-3 py-1.5 rounded transition-colors border border-amber-200 uppercase tracking-wider"
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
                  className="bg-blue-50 hover:bg-blue-100 text-blue-600 text-[9px] font-bold px-3 py-1.5 rounded transition-colors border border-blue-200 uppercase tracking-wider"
                >
                  Mark Tx
                </button>
              )
            ) : null}
            
            <button
              type="button"
              onClick={handleClose}
              className="bg-white hover:bg-gray-100 text-gray-500 text-[9px] font-bold px-3 py-1.5 rounded transition-colors border border-gray-200 uppercase tracking-wider"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
