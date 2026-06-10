import React from 'react';
import type { GmailMessage } from '../../hooks/use-gmail-integration';

interface BronzeEmailListProps {
  visibleRawEmails: GmailMessage[];
  checkedEmailIds: string[];
  unprocessedEmails: GmailMessage[];
  isLoading: boolean;
  isEmailProcessed: (email: GmailMessage) => boolean;
  toggleEmailCheck: (id: string) => void;
  toggleSelectAll: () => void;
  handleBatchExtract: () => void;
  setSelectedEmail: (email: GmailMessage) => void;
  markAsTransaction: (id: string) => void;
  markAsNonTransaction: (id: string) => void;
  extractSelectedEmails: (ids: string[]) => Promise<void>;
  bronzeSubTab: 'transaction' | 'non-transaction';
  setActiveTab: (tab: 'bronze' | 'silver' | 'gold' | 'transaction' | 'non-transaction') => void;
  rawEmails: GmailMessage[];
}

export const BronzeEmailList: React.FC<BronzeEmailListProps> = ({
  visibleRawEmails,
  checkedEmailIds,
  unprocessedEmails,
  isLoading,
  isEmailProcessed,
  toggleEmailCheck,
  toggleSelectAll,
  handleBatchExtract,
  setSelectedEmail,
  markAsTransaction,
  markAsNonTransaction,
  extractSelectedEmails,
  bronzeSubTab,
  setActiveTab,
  rawEmails,
}) => {
  return (
    <div>
      <div className="border-b border-gray-100 bg-gray-50/50 flex justify-between items-center px-4">
        <div className="flex space-x-4">
          <button
            type="button"
            onClick={() => setActiveTab('transaction')}
            className={`py-2 px-1 text-[9px] font-black uppercase tracking-widest border-b-2 transition-all ${
              bronzeSubTab === 'transaction'
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Transactions
            <span className={`ml-1.5 px-1.5 py-0.5 text-[8px] rounded-full font-bold ${
              bronzeSubTab === 'transaction' ? 'bg-orange-100 text-orange-800' : 'bg-gray-200 text-gray-600'
            }`}>
              {rawEmails.filter(e => e.hasTransaction).length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('non-transaction')}
            className={`py-2 px-1 text-[9px] font-black uppercase tracking-widest border-b-2 transition-all ${
              bronzeSubTab === 'non-transaction'
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Non-Transactional (For Review)
            <span className={`ml-1.5 px-1.5 py-0.5 text-[8px] rounded-full font-bold ${
              bronzeSubTab === 'non-transaction' ? 'bg-amber-100 text-amber-800' : 'bg-gray-200 text-gray-600'
            }`}>
              {rawEmails.filter(e => !e.hasTransaction).length}
            </span>
          </button>
        </div>
        
        {checkedEmailIds.length > 0 && (
          <button
            onClick={handleBatchExtract}
            className="bg-blue-600 hover:bg-blue-700 text-white text-[8px] font-black px-2.5 py-1 rounded transition-colors uppercase tracking-wider"
          >
            🚀 Extract Selected ({checkedEmailIds.length} Batch)
          </button>
        )}
        <span className="text-[9px] font-black text-gray-300 uppercase">{visibleRawEmails.length} Items</span>
      </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-gray-50 text-[8px] font-black text-gray-400 uppercase tracking-tighter">
            <tr>
              <th className="px-4 py-2 text-center w-8">
                <input 
                  type="checkbox" 
                  checked={unprocessedEmails.length > 0 && unprocessedEmails.every(e => checkedEmailIds.includes(e.id))}
                  onChange={toggleSelectAll}
                  disabled={unprocessedEmails.length === 0}
                />
              </th>
              <th className="px-4 py-2 text-left">Sender</th>
              <th className="px-4 py-2 text-left">Subject / Details</th>
              <th className="px-4 py-2 text-right">Date</th>
              <th className="px-4 py-2 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {visibleRawEmails.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center">
                  <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">
                    {isLoading ? 'Scanning...' : 'No Data Fetch required'}
                  </p>
                </td>
              </tr>
            ) : (
              visibleRawEmails.map(email => (
                <tr key={email.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2 text-center">
                    <input 
                      type="checkbox" 
                      checked={checkedEmailIds.includes(email.id)}
                      onChange={() => toggleEmailCheck(email.id)}
                      disabled={isEmailProcessed(email)}
                      className={isEmailProcessed(email) ? "opacity-50 cursor-not-allowed" : ""}
                    />
                  </td>
                  <td onClick={() => setSelectedEmail(email)} className="px-4 py-2 whitespace-nowrap cursor-pointer">
                    <div className="text-[10px] font-bold text-gray-700">{email.sender.split('<')[0].trim()}</div>
                  </td>
                  <td onClick={() => setSelectedEmail(email)} className="px-4 py-2 cursor-pointer">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold text-gray-900 leading-tight">{email.subject}</span>
                      {isEmailProcessed(email) && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-green-50 text-green-700 border border-green-200">
                          ✓ Processed
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] text-gray-400 line-clamp-1 italic">{email.snippet}</div>
                  </td>
                  <td onClick={() => setSelectedEmail(email)} className="px-4 py-2 whitespace-nowrap text-right text-[9px] font-bold text-gray-400 uppercase cursor-pointer">
                    {new Date(email.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-center space-x-1">
                    {bronzeSubTab === 'non-transaction' ? (
                      <button
                        type="button"
                        onClick={() => markAsTransaction(email.id)}
                        className="bg-orange-50 hover:bg-orange-100 text-orange-600 text-[8px] font-bold px-1.5 py-0.5 border border-orange-100 rounded uppercase"
                      >
                        Mark Tx
                      </button>
                    ) : (
                      <>
                        {isEmailProcessed(email) ? (
                          <>
                            <button
                              type="button"
                              disabled
                              className="bg-gray-50 text-gray-300 text-[8px] font-bold px-1.5 py-0.5 border border-gray-100 rounded uppercase cursor-not-allowed"
                            >
                              Unmark Tx
                            </button>
                            <button
                              type="button"
                              disabled
                              className="bg-gray-100 text-gray-400 text-[8px] font-bold px-1.5 py-0.5 rounded border border-gray-200 uppercase cursor-not-allowed"
                            >
                              Processed
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => markAsNonTransaction(email.id)}
                              className="bg-amber-50 hover:bg-amber-100 text-amber-600 text-[8px] font-bold px-1.5 py-0.5 border border-amber-100 rounded uppercase"
                            >
                              Unmark Tx
                            </button>
                            <button
                              type="button"
                              onClick={() => extractSelectedEmails([email.id])}
                              className="bg-blue-600 hover:bg-blue-700 text-white text-[8px] font-bold px-1.5 py-0.5 rounded uppercase"
                            >
                              Extract
                            </button>
                          </>
                        )}
                      </>
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
