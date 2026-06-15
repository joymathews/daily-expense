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
  handleBatchReject: () => void;
  setSelectedEmail: (email: GmailMessage) => void;
  markAsTransaction: (id: string) => void;
  markAsNonTransaction: (id: string) => void;
  extractSelectedEmails: (ids: string[]) => Promise<void>;
  bronzeSubTab: 'transaction' | 'non-transaction';
  setActiveTab: (tab: 'bronze' | 'silver' | 'gold' | 'transaction' | 'non-transaction') => void;
  rawEmails: GmailMessage[];
  bronzeFilter: 'all' | 'unprocessed' | 'rejected';
  setBronzeFilter: (filter: 'all' | 'unprocessed' | 'rejected') => void;
  onDeleteClick: (email: GmailMessage) => void;
  startDate: string;
  setStartDate: (val: string) => void;
  endDate: string;
  setEndDate: (val: string) => void;
  rejectBronzeInput?: (id: string) => Promise<void> | void;
}

export const BronzeEmailList: React.FC<BronzeEmailListProps> = (props) => {
  const {
    visibleRawEmails,
    checkedEmailIds,
    unprocessedEmails,
    isLoading,
    isEmailProcessed,
    toggleEmailCheck,
    toggleSelectAll,
    handleBatchExtract,
    handleBatchReject,
    setSelectedEmail,
    bronzeSubTab,
    setActiveTab,
    rawEmails,
    bronzeFilter,
    setBronzeFilter,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
  } = props;
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
              bronzeSubTab === 'transaction' ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-200 text-gray-655'
            }`}>
              {rawEmails.filter(e => e.hasTransaction && !isEmailProcessed(e)).length}
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
              {rawEmails.filter(e => !e.hasTransaction && !isEmailProcessed(e)).length}
            </span>
          </button>
        </div>
        
        <div className="flex flex-wrap items-center justify-between md:justify-end gap-3">
          {checkedEmailIds.length > 0 && (
            <div className="flex space-x-2">
              <button
                onClick={handleBatchExtract}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm transition-all uppercase tracking-wider cursor-pointer"
              >
                🚀 Extract Selected ({checkedEmailIds.length})
              </button>
              <button
                onClick={handleBatchReject}
                className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm transition-all uppercase tracking-wider cursor-pointer"
                data-testid="batch-reject-btn"
              >
                Reject Selected ({checkedEmailIds.length})
              </button>
            </div>
          )}
          <div className="flex items-center space-x-3 bg-gray-50/50 border border-gray-200/50 rounded-xl px-3 py-1">
            <div className="flex items-center space-x-1.5">
              <label htmlFor="bronze-start-date" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Start:</label>
              <input 
                id="bronze-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-white border border-gray-200 text-xs font-bold text-gray-750 px-2 py-0.5 rounded-lg outline-none cursor-pointer focus:border-indigo-500"
              />
            </div>
            <div className="flex items-center space-x-1.5">
              <label htmlFor="bronze-end-date" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">End:</label>
              <input 
                id="bronze-end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-white border border-gray-200 text-xs font-bold text-gray-750 px-2 py-0.5 rounded-lg outline-none cursor-pointer focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <label htmlFor="bronze-status-filter" className="text-xs font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">Filter:</label>
            <select
              id="bronze-status-filter"
              value={bronzeFilter}
              onChange={(e) => setBronzeFilter(e.target.value as 'all' | 'unprocessed' | 'rejected')}
              className="bg-white border border-gray-200 text-xs font-bold text-gray-750 px-2.5 py-1 rounded-lg outline-none cursor-pointer focus:border-indigo-500"
            >
              <option value="all">All</option>
              <option value="unprocessed">Unprocessed</option>
              <option value="rejected">Rejected</option>
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
              <th className="px-4 py-3 text-left">Sender / Source</th>
              <th className="px-4 py-3 text-left">Title / Details</th>
              <th className="px-4 py-3 text-right">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 bg-white">
            {visibleRawEmails.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center">
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
                      disabled={isEmailProcessed(email) || email.status === 'rejected'}
                      className={`rounded text-indigo-600 focus:ring-indigo-500 border-gray-350 ${
                        isEmailProcessed(email) || email.status === 'rejected' ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
                      }`}
                    />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-xs font-bold text-gray-800">{email.sender.split('<')[0].trim()}</div>
                    <div className="text-[10px] text-gray-400 truncate max-w-[120px]" title={email.sender}>{email.sender}</div>
                  </td>
                  <td onClick={() => setSelectedEmail(email)} className="px-4 py-3 cursor-pointer hover:text-indigo-650 transition-colors">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-xs font-semibold text-gray-900 leading-tight">{email.subject}</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider ${
                        email.sourceType === 'manual' 
                          ? 'bg-amber-50 text-amber-700 border border-amber-100' 
                          : 'bg-blue-50 text-blue-750 border border-blue-100'
                      }`}>
                        {email.sourceType || 'email'}
                      </span>
                      {email.status === 'rejected' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-105">
                          ✗ Rejected
                        </span>
                      ) : (email.status === 'processed' || isEmailProcessed(email)) ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-100">
                          ✓ Processed
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-gray-50 text-gray-500 border border-gray-200">
                          Unprocessed
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-400 line-clamp-1 italic max-w-lg">{email.snippet}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right text-xs font-semibold text-gray-500 uppercase">
                    {new Date(email.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
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
