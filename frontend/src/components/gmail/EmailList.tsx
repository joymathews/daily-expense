import React from 'react';
import type { GmailMessage } from '../../hooks/use-gmail-integration';

interface EmailListProps {
  emails: GmailMessage[];
  activeTab: 'transaction' | 'non-transaction';
  setActiveTab: (tab: 'transaction' | 'non-transaction') => void;
  isLoading: boolean;
  setSelectedEmail: (email: GmailMessage) => void;
  markAsTransaction: (id: string) => void;
  markAsNonTransaction: (id: string) => void;
}

export const EmailList: React.FC<EmailListProps> = ({
  emails,
  activeTab,
  setActiveTab,
  isLoading,
  setSelectedEmail,
  markAsTransaction,
  markAsNonTransaction,
}) => {
  const filteredEmails = emails.filter(email => 
    activeTab === 'transaction' ? email.hasTransaction : !email.hasTransaction
  );

  return (
    <div className="lg:col-span-3 bg-white border border-gray-100 rounded overflow-hidden">
      <div className="border-b border-gray-100 bg-gray-50/50 flex justify-between items-center px-4">
        <div className="flex space-x-4">
          <button
            type="button"
            onClick={() => setActiveTab('transaction')}
            className={`py-2 px-1 text-[9px] font-black uppercase tracking-widest border-b-2 transition-all ${
              activeTab === 'transaction'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Transactions
            <span className={`ml-1.5 px-1.5 py-0.5 text-[8px] rounded-full font-bold ${
              activeTab === 'transaction' ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-600'
            }`}>
              {emails.filter(e => e.hasTransaction).length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('non-transaction')}
            className={`py-2 px-1 text-[9px] font-black uppercase tracking-widest border-b-2 transition-all ${
              activeTab === 'non-transaction'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Non-Transactional (For Review)
            <span className={`ml-1.5 px-1.5 py-0.5 text-[8px] rounded-full font-bold ${
              activeTab === 'non-transaction' ? 'bg-amber-100 text-amber-800' : 'bg-gray-200 text-gray-600'
            }`}>
              {emails.filter(e => !e.hasTransaction).length}
            </span>
          </button>
        </div>
        <span className="text-[9px] font-black text-gray-300 uppercase">{emails.length} Total</span>
      </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-gray-50 text-[8px] font-black text-gray-400 uppercase tracking-tighter">
            <tr>
              <th className="px-4 py-2 text-left">Sender</th>
              <th className="px-4 py-2 text-left">Details</th>
              <th className="px-4 py-2 text-right">Date</th>
              <th className="px-4 py-2 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filteredEmails.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center">
                  <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">
                    {isLoading ? 'Scanning...' : 'No Data Fetch required'}
                  </p>
                </td>
              </tr>
            ) : (
              filteredEmails.map((email) => (
                <tr key={email.id} className="hover:bg-gray-50 transition-colors">
                  <td onClick={() => setSelectedEmail(email)} className="px-4 py-2 whitespace-nowrap cursor-pointer">
                    <div className="text-[10px] font-bold text-gray-700">{email.sender.split('<')[0].trim()}</div>
                  </td>
                  <td onClick={() => setSelectedEmail(email)} className="px-4 py-2 cursor-pointer">
                    <div className="text-[10px] font-bold text-gray-900 leading-tight">{email.subject}</div>
                    <div className="text-[9px] text-gray-400 line-clamp-1 italic">{email.snippet}</div>
                  </td>
                  <td onClick={() => setSelectedEmail(email)} className="px-4 py-2 whitespace-nowrap text-right text-[9px] font-bold text-gray-400 uppercase cursor-pointer">
                    {new Date(email.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-center">
                    {activeTab === 'non-transaction' ? (
                      <button
                        type="button"
                        onClick={() => markAsTransaction(email.id)}
                        className="bg-blue-50 hover:bg-blue-100 text-blue-600 text-[8px] font-bold px-1.5 py-0.5 rounded transition-colors border border-blue-200 uppercase tracking-wider"
                      >
                        Mark Tx
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => markAsNonTransaction(email.id)}
                        className="bg-amber-50 hover:bg-amber-100 text-amber-600 text-[8px] font-bold px-1.5 py-0.5 rounded transition-colors border border-amber-200 uppercase tracking-wider"
                      >
                        Unmark Tx
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
