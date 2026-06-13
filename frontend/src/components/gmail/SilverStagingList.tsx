import React from 'react';
import type { SilverTransaction } from '../../hooks/use-gmail-integration';

interface SilverStagingListProps {
  silverTransactions: SilverTransaction[];
  checkedSilverIds: string[];
  toggleSelectAllSilver: () => void;
  toggleSilverCheck: (id: string) => void;
  handleBatchApprove: () => void;
  handleReviewSilver: (tx: SilverTransaction) => void;
  onDeleteClick: (tx: SilverTransaction) => void;
  startDate: string;
  setStartDate: (val: string) => void;
  endDate: string;
  setEndDate: (val: string) => void;
}

export const SilverStagingList: React.FC<SilverStagingListProps> = ({
  silverTransactions,
  checkedSilverIds,
  toggleSelectAllSilver,
  toggleSilverCheck,
  handleBatchApprove,
  handleReviewSilver,
  onDeleteClick,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
}) => {
  const visibleTransactions = silverTransactions.filter(tx => tx.status !== 'approved');
  const pendingCount = silverTransactions.filter(t => t.status === 'pending' || t.status === 'error').length;
  const rejectedCount = silverTransactions.filter(t => t.status === 'rejected').length;

  return (
    <div>
      <div className="border-b border-gray-100 bg-gray-50/70 flex flex-col sm:flex-row justify-between items-stretch sm:items-center px-4 py-3 gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">Silver Staging Table (Pending Approvals)</span>
          {checkedSilverIds.length > 0 && (
            <button
              onClick={handleBatchApprove}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1 rounded-lg transition-colors uppercase tracking-wider cursor-pointer"
            >
              🚀 Approve Selected ({checkedSilverIds.length})
            </button>
          )}
        </div>
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider self-start sm:self-auto">
          {pendingCount} Pending Items {rejectedCount > 0 && `| ${rejectedCount} Rejected`}
        </span>
      </div>
      
      {/* Date Filter Bar */}
      <div className="flex flex-wrap items-center gap-4 bg-gray-50/30 px-4 py-2 border-b border-gray-100">
        <div className="flex items-center space-x-2">
          <label htmlFor="silver-start-date" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Start Date:</label>
          <input 
            id="silver-start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg outline-none text-xs font-bold text-gray-755 px-2.5 py-1 focus:border-indigo-500 transition-colors"
          />
        </div>
        <div className="flex items-center space-x-2">
          <label htmlFor="silver-end-date" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">End Date:</label>
          <input 
            id="silver-end-date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg outline-none text-xs font-bold text-gray-755 px-2.5 py-1 focus:border-indigo-500 transition-colors"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            <tr>
              <th className="px-2 py-2.5 text-center w-8">
                <input 
                  type="checkbox" 
                  checked={
                    visibleTransactions.filter(t => t.status !== 'error' && t.status !== 'rejected').length > 0 && 
                    checkedSilverIds.length === visibleTransactions.filter(t => t.status !== 'error' && t.status !== 'rejected').length
                  }
                  onChange={toggleSelectAllSilver}
                  className="rounded text-indigo-600 focus:ring-indigo-500 border-gray-350 cursor-pointer"
                />
              </th>
              <th className="px-2 py-2.5 text-left">Date</th>
              <th className="px-2 py-2.5 text-left">Merchant</th>
              <th className="px-2 py-2.5 text-right">Amount</th>
              <th className="px-2 py-2.5 text-center">Category</th>
              <th className="px-2 py-2.5 text-center">Method</th>
              <th className="px-2 py-2.5 text-center">Status / Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 bg-white">
            {visibleTransactions.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2 py-12 text-center">
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">No pending transactions in staging</p>
                </td>
              </tr>
            ) : (
              visibleTransactions.map(tx => (
                <tr key={tx.id} className={`hover:bg-gray-50/50 transition-colors text-xs ${tx.status === 'error' ? 'bg-rose-50/30' : tx.status === 'rejected' ? 'bg-rose-50/10' : ''}`}>
                  <td className="px-2 py-2.5 text-center">
                    <input 
                      type="checkbox" 
                      checked={checkedSilverIds.includes(tx.id)}
                      disabled={tx.status === 'error' || tx.status === 'rejected'}
                      onChange={() => toggleSilverCheck(tx.id)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 border-gray-350 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="px-2 py-2.5 text-gray-500 max-w-[120px] truncate" title={tx.transactionDate}>
                    {tx.transactionDate}
                  </td>
                  <td onClick={() => handleReviewSilver(tx)} className="px-2 py-2.5 font-bold text-gray-900 max-w-[180px] cursor-pointer hover:text-indigo-650 transition-colors">
                    <div className="truncate">{tx.merchantNormalized || tx.merchantRaw}</div>
                    <span className="block text-[10px] font-normal text-gray-400 truncate max-w-[160px]" title={tx.emailSubject}>{tx.emailSubject || 'Source Raw Email'}</span>
                  </td>
                  <td className="px-2 py-2.5 text-right font-bold text-gray-800 whitespace-nowrap">
                    {tx.amount.toFixed(2)} {tx.currency}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <span className="bg-indigo-50/80 text-indigo-700 px-2 py-0.5 rounded font-bold uppercase text-[9px] border border-indigo-100/30 whitespace-nowrap">
                      {tx.inferredCategory || 'Other'}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <span className="bg-slate-50 text-slate-700 px-2 py-0.5 rounded font-bold uppercase text-[9px] border border-slate-100/30 truncate max-w-[120px] whitespace-nowrap" title={tx.paymentMethod}>
                      {tx.paymentMethod || 'Unknown'}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <div className="flex flex-col items-center">
                      <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[9px] border whitespace-nowrap ${
                        tx.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                        tx.status === 'rejected' ? 'bg-rose-50 text-rose-700 border-rose-100' :
                        tx.status === 'error' ? 'bg-rose-50 text-rose-700 border-rose-100' :
                        'bg-amber-50 text-amber-700 border-amber-100'
                      }`}>
                        {tx.status}
                      </span>
                    </div>
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
