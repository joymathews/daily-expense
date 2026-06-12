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
  bronzeFilter: 'all' | 'processed' | 'unprocessed';
  setBronzeFilter: (filter: 'all' | 'processed' | 'unprocessed') => void;
  onDeleteClick: (email: GmailMessage) => void;
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
  bronzeFilter,
  setBronzeFilter,
  onDeleteClick,
}) => {
  return (
    <div>
      <div className="border-b border-gray-100 bg-gray-50/70 flex flex-col md:flex-row justify-between items-stretch md:items-center px-4 py-2 gap-3">
        <div className="flex space-x-4">
          <button
            type="button"
            onClick={() => setActiveTab('transaction')}
            className={`py-2 px-1.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
              bronzeSubTab === 'transaction'
                ? 'border-indigo-600 text-indigo-750'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Transactions
            <span className={`ml-2 px-2 py-0.5 text-[10px] rounded-full font-bold transition-colors ${
              bronzeSubTab === 'transaction' ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-200 text-gray-650'
            }`}>
              {rawEmails.filter(e => e.hasTransaction).length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('non-transaction')}
            className={`py-2 px-1.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
              bronzeSubTab === 'non-transaction'
                ? 'border-indigo-600 text-indigo-750'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Non-Transactional (For Review)
            <span className={`ml-2 px-2 py-0.5 text-[10px] rounded-full font-bold transition-colors ${
              bronzeSubTab === 'non-transaction' ? 'bg-amber-105 text-amber-900' : 'bg-gray-200 text-gray-655'
            }`}>
              {rawEmails.filter(e => !e.hasTransaction).length}
            </span>
          </button>
        </div>
        
        <div className="flex flex-wrap items-center justify-between md:justify-end gap-3">
          {checkedEmailIds.length > 0 && (
            <button
              onClick={handleBatchExtract}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm transition-all uppercase tracking-wider cursor-pointer"
            >
              🚀 Extract Selected ({checkedEmailIds.length})
            </button>
          )}
          <div className="flex items-center space-x-2">
            <label htmlFor="bronze-status-filter" className="text-xs font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">Filter:</label>
            <select
              id="bronze-status-filter"
              value={bronzeFilter}
              onChange={(e) => setBronzeFilter(e.target.value as 'all' | 'processed' | 'unprocessed')}
              className="bg-white border border-gray-200 text-xs font-bold text-gray-700 px-2.5 py-1 rounded-lg outline-none cursor-pointer focus:border-indigo-500"
            >
              <option value="all">All</option>
              <option value="processed">Processed</option>
              <option value="unprocessed">Unprocessed</option>
            </select>
            <span className="text-xs font-bold text-gray-400 uppercase whitespace-nowrap pl-1">{visibleRawEmails.length} Items</span>
          </div>
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 text-center w-10">
                <input 
                  type="checkbox" 
                  checked={unprocessedEmails.length > 0 && unprocessedEmails.every(e => checkedEmailIds.includes(e.id))}
                  onChange={toggleSelectAll}
                  disabled={unprocessedEmails.length === 0}
                  className="rounded text-indigo-600 focus:ring-indigo-500 border-gray-350 cursor-pointer"
                />
              </th>
              <th className="px-4 py-3 text-left">Sender</th>
              <th className="px-4 py-3 text-left">Subject / Details</th>
              <th className="px-4 py-3 text-right">Received Date</th>
              <th className="px-4 py-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 bg-white">
            {visibleRawEmails.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center">
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">
                    {isLoading ? 'Scanning Pipeline...' : 'No data in this view'}
                  </p>
                </td>
              </tr>
            ) : (
              visibleRawEmails.map(email => (
                <tr key={email.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3 text-center">
                    <input 
                      type="checkbox" 
                      checked={checkedEmailIds.includes(email.id)}
                      onChange={() => toggleEmailCheck(email.id)}
                      disabled={isEmailProcessed(email)}
                      className={`rounded text-indigo-600 focus:ring-indigo-500 border-gray-350 ${
                        isEmailProcessed(email) ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
                      }`}
                    />
                  </td>
                  <td onClick={() => setSelectedEmail(email)} className="px-4 py-3 whitespace-nowrap cursor-pointer">
                    <div className="text-xs font-bold text-gray-800">{email.sender.split('<')[0].trim()}</div>
                    <div className="text-[10px] text-gray-400 truncate max-w-[120px]" title={email.sender}>{email.sender}</div>
                  </td>
                  <td onClick={() => setSelectedEmail(email)} className="px-4 py-3 cursor-pointer">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-xs font-semibold text-gray-900 leading-tight">{email.subject}</span>
                      {isEmailProcessed(email) && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-100">
                          ✓ Processed
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-400 line-clamp-1 italic max-w-lg">{email.snippet}</div>
                  </td>
                  <td onClick={() => setSelectedEmail(email)} className="px-4 py-3 whitespace-nowrap text-right text-xs font-semibold text-gray-500 uppercase cursor-pointer">
                    {new Date(email.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center">
                    {bronzeSubTab === 'non-transaction' ? (
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => onDeleteClick(email)}
                          className="bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold px-2.5 py-1 border border-rose-200/50 rounded-lg uppercase tracking-wider cursor-pointer transition-colors shadow-sm"
                          data-testid={`delete-bronze-${email.id}`}
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <>
                        {isEmailProcessed(email) ? (
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => onDeleteClick(email)}
                              className="bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold px-2.5 py-1 border border-rose-200/50 rounded-lg uppercase tracking-wider cursor-pointer transition-colors shadow-sm"
                              data-testid={`delete-bronze-${email.id}`}
                            >
                              Delete
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => extractSelectedEmails([email.id])}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1 rounded-lg uppercase cursor-pointer transition-all shadow-sm"
                            >
                              Extract
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteClick(email)}
                              className="bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold px-2.5 py-1 border border-rose-200/50 rounded-lg uppercase tracking-wider cursor-pointer transition-colors shadow-sm"
                              data-testid={`delete-bronze-${email.id}`}
                            >
                              Delete
                            </button>
                          </div>
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
