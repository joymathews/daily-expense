import React from 'react';
import { GmailMessage } from '../../hooks/use-gmail-integration';

interface EmailDetailModalProps {
  selectedEmail: GmailMessage | null;
  setSelectedEmail: (email: GmailMessage | null) => void;
  markAsTransaction: (id: string) => void;
  markAsNonTransaction: (id: string) => void;
}

export const EmailDetailModal: React.FC<EmailDetailModalProps> = ({
  selectedEmail,
  setSelectedEmail,
  markAsTransaction,
  markAsNonTransaction,
}) => {
  if (!selectedEmail) return null;

  return (
    <div 
      data-testid="email-detail-modal"
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
    >
      <div className="bg-white rounded border border-gray-100 shadow-xl max-w-xl w-full overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
          <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest truncate max-w-[80%]">
            {selectedEmail.subject}
          </h3>
          <button 
            onClick={() => setSelectedEmail(null)}
            className="text-gray-400 hover:text-gray-600 text-xs font-bold uppercase tracking-wider transition-colors"
          >
            Close
          </button>
        </div>
        
        {/* Meta */}
        <div className="px-4 py-2 border-b border-gray-50 bg-white/50 text-[10px] space-y-1">
          <div><span className="font-bold text-gray-400 uppercase">From:</span> <span className="text-gray-700 font-bold">{selectedEmail.sender}</span></div>
          <div><span className="font-bold text-gray-400 uppercase">Date:</span> <span className="text-gray-700 font-bold">{selectedEmail.date}</span></div>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 overflow-y-auto flex-1 bg-white">
          <div className="text-[10px] font-black text-gray-400 uppercase mb-2">Message Body</div>
          <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700 bg-gray-50/50 p-3 rounded border border-gray-100 max-h-72 overflow-y-auto leading-relaxed">
            {selectedEmail.body}
          </pre>
        </div>

        {/* Actions Footer */}
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <span className="text-[8px] font-black text-gray-400 uppercase">Status:</span>
            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase ${
              selectedEmail.hasTransaction 
                ? 'bg-blue-100 text-blue-800' 
                : 'bg-amber-100 text-amber-800'
            }`}>
              {selectedEmail.hasTransaction ? 'Transactional' : 'Non-Transactional'}
            </span>
          </div>
          <div className="flex space-x-2">
            {selectedEmail.hasTransaction ? (
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
            )}
            <button
              type="button"
              onClick={() => setSelectedEmail(null)}
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
