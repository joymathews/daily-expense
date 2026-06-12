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
}

export const SilverStagingList: React.FC<SilverStagingListProps> = ({
  silverTransactions,
  checkedSilverIds,
  toggleSelectAllSilver,
  toggleSilverCheck,
  handleBatchApprove,
  handleReviewSilver,
  onDeleteClick,
}) => {
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
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider self-start sm:self-auto">{silverTransactions.length} Pending Items</span>
      </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            <tr>
              <th className="px-2 py-2.5 text-center w-8">
                <input 
                  type="checkbox" 
                  checked={silverTransactions.length > 0 && checkedSilverIds.length === silverTransactions.length}
                  onChange={toggleSelectAllSilver}
                  className="rounded text-indigo-600 focus:ring-indigo-500 border-gray-350 cursor-pointer"
                />
              </th>
              <th className="px-2 py-2.5 text-left">Date</th>
              <th className="px-2 py-2.5 text-left">Merchant</th>
              <th className="px-2 py-2.5 text-right">Amount</th>
              <th className="px-2 py-2.5 text-center">Category & Method</th>
              <th className="px-2 py-2.5 text-center">Status / Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 bg-white">
            {silverTransactions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-12 text-center">
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">No pending transactions in staging</p>
                </td>
              </tr>
            ) : (
              silverTransactions.map(tx => (
                <tr key={tx.id} className="hover:bg-gray-50/50 transition-colors text-xs">
                  <td className="px-2 py-2.5 text-center">
                    <input 
                      type="checkbox" 
                      checked={checkedSilverIds.includes(tx.id)}
                      onChange={() => toggleSilverCheck(tx.id)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 border-gray-350 cursor-pointer"
                    />
                  </td>
                  <td className="px-2 py-2.5 text-gray-500 max-w-[120px] truncate" title={tx.transactionDate}>
                    {tx.transactionDate}
                  </td>
                  <td className="px-2 py-2.5 font-bold text-gray-900 max-w-[180px]">
                    <div className="truncate">{tx.merchantNormalized || tx.merchantRaw}</div>
                    <span className="block text-[10px] font-normal text-gray-400 truncate max-w-[160px]" title={tx.emailSubject}>{tx.emailSubject || 'Source Raw Email'}</span>
                  </td>
                  <td className="px-2 py-2.5 text-right font-bold text-gray-800 whitespace-nowrap">
                    {tx.amount.toFixed(2)} {tx.currency}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="bg-indigo-50/80 text-indigo-700 px-2 py-0.5 rounded font-bold uppercase text-[9px] border border-indigo-100/30 whitespace-nowrap">
                        {tx.inferredCategory || 'Other'}
                      </span>
                      <span className="bg-slate-50 text-slate-700 px-2 py-0.5 rounded font-bold uppercase text-[9px] border border-slate-100/30 truncate max-w-[120px] whitespace-nowrap" title={tx.paymentMethod}>
                        {tx.paymentMethod || 'Unknown'}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <div className="flex flex-col items-center gap-1.5">
                      <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[9px] border whitespace-nowrap ${
                        tx.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'
                      }`}>
                        {tx.status}
                      </span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleReviewSilver(tx)}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider cursor-pointer shadow-sm transition-all duration-150 whitespace-nowrap"
                        >
                          Review
                        </button>
                        <button
                          onClick={() => onDeleteClick(tx)}
                          className="bg-rose-50 hover:bg-rose-100 text-rose-700 text-[10px] font-bold px-2.5 py-1 border border-rose-200/50 rounded-lg uppercase tracking-wider cursor-pointer shadow-sm transition-colors whitespace-nowrap"
                          data-testid={`delete-silver-${tx.id}`}
                        >
                          Delete
                        </button>
                      </div>
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
