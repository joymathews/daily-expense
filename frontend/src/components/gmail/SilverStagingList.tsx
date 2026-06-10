import React from 'react';
import type { SilverTransaction } from '../../hooks/use-gmail-integration';

interface SilverStagingListProps {
  silverTransactions: SilverTransaction[];
  checkedSilverIds: string[];
  toggleSelectAllSilver: () => void;
  toggleSilverCheck: (id: string) => void;
  handleBatchApprove: () => void;
  handleReviewSilver: (tx: SilverTransaction) => void;
}

export const SilverStagingList: React.FC<SilverStagingListProps> = ({
  silverTransactions,
  checkedSilverIds,
  toggleSelectAllSilver,
  toggleSilverCheck,
  handleBatchApprove,
  handleReviewSilver,
}) => {
  return (
    <div>
      <div className="border-b border-gray-100 bg-gray-50/50 flex justify-between items-center px-4 py-2">
        <div className="flex items-center space-x-4">
          <span className="text-[9px] font-black text-blue-600 uppercase tracking-wider">Silver Staging Table (Pending Approvals)</span>
          {checkedSilverIds.length > 0 && (
            <button
              onClick={handleBatchApprove}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-[8px] font-black px-2.5 py-1 rounded transition-colors uppercase tracking-wider"
            >
              🚀 Approve Selected ({checkedSilverIds.length} Batch)
            </button>
          )}
        </div>
        <span className="text-[9px] font-black text-gray-300 uppercase">{silverTransactions.length} Pending Items</span>
      </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-gray-50 text-[8px] font-black text-gray-400 uppercase tracking-tighter">
            <tr>
              <th className="px-4 py-2 text-center w-8">
                <input 
                  type="checkbox" 
                  checked={silverTransactions.length > 0 && checkedSilverIds.length === silverTransactions.length}
                  onChange={toggleSelectAllSilver}
                />
              </th>
              <th className="px-4 py-2 text-left">Extracted Merchant</th>
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-right">Amount</th>
              <th className="px-4 py-2 text-center">Category</th>
              <th className="px-4 py-2 text-center">Status</th>
              <th className="px-4 py-2 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {silverTransactions.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center">
                  <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">No pending transactions in staging</p>
                </td>
              </tr>
            ) : (
              silverTransactions.map(tx => (
                <tr key={tx.id} className="hover:bg-gray-50 transition-colors text-[10px]">
                  <td className="px-4 py-2 text-center">
                    <input 
                      type="checkbox" 
                      checked={checkedSilverIds.includes(tx.id)}
                      onChange={() => toggleSilverCheck(tx.id)}
                    />
                  </td>
                  <td className="px-4 py-2 font-bold text-gray-900">
                    {tx.merchantNormalized || tx.merchantRaw}
                    <span className="block text-[8px] font-normal text-gray-400 truncate max-w-xs">{tx.emailSubject || 'Source Raw Email'}</span>
                  </td>
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{tx.transactionDate}</td>
                  <td className="px-4 py-2 font-bold text-right text-gray-800">{tx.amount.toFixed(2)} {tx.currency}</td>
                  <td className="px-4 py-2 text-center"><span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-bold uppercase text-[8px]">{tx.inferredCategory || 'Other'}</span></td>
                  <td className="px-4 py-2 text-center">
                    <span className={`px-1.5 py-0.5 rounded-full font-bold uppercase text-[8px] ${
                      tx.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {tx.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => handleReviewSilver(tx)}
                      className="bg-blue-600 hover:bg-blue-700 text-white text-[8px] font-bold px-2 py-1 rounded uppercase tracking-wider"
                    >
                      Review & Approve
                    </button>
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
