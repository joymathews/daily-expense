import React from 'react';
import type { GoldTransaction } from '../../hooks/use-gmail-integration';

interface GoldLedgerListProps {
  goldTransactions: GoldTransaction[];
  setSelectedGoldTransaction: (tx: GoldTransaction) => void;
}

export const GoldLedgerList: React.FC<GoldLedgerListProps> = ({
  goldTransactions,
  setSelectedGoldTransaction,
}) => {
  return (
    <div>
      <div className="border-b border-gray-100 bg-gray-50/70 flex justify-between items-center px-4 py-3">
        <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Gold Verified Transactions (Double-Entry Ledger)</span>
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{goldTransactions.length} Verified Items</span>
      </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            <tr>
              <th className="px-2 py-2.5 text-left">Merchant</th>
              <th className="px-2 py-2.5 text-left">Date</th>
              <th className="px-2 py-2.5 text-right">Amount</th>
              <th className="px-2 py-2.5 text-center">Category</th>
              <th className="px-2 py-2.5 text-left">Lineage / Comments</th>
              <th className="px-2 py-2.5 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 bg-white">
            {goldTransactions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-12 text-center">
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">No validated ledger items found</p>
                </td>
              </tr>
            ) : (
              goldTransactions.map(tx => (
                <tr key={tx.id} className="hover:bg-gray-50/50 transition-colors text-xs">
                  <td className="px-2 py-2.5 font-bold text-gray-900">{tx.merchant}</td>
                  <td className="px-2 py-2.5 text-gray-500 whitespace-nowrap">{tx.transactionDate}</td>
                  <td className="px-2 py-2.5 font-extrabold text-right text-emerald-600 whitespace-nowrap">{tx.amount.toFixed(2)} {tx.currency}</td>
                  <td className="px-2 py-2.5 text-center">
                    <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md font-bold uppercase text-[9px] border border-emerald-100/30">
                      {tx.category}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-left max-w-[180px]">
                    <span 
                      className="text-[10px] text-indigo-600 font-semibold block uppercase tracking-wide truncate max-w-[160px] cursor-help" 
                      title={tx.emailSubject || 'Linked source raw receipt'}
                    >
                      🔗 Email: {tx.emailSubject || 'Linked source raw receipt'}
                    </span>
                    <span className="text-[11px] text-gray-400 italic block truncate max-w-[160px]" title={tx.notes || undefined}>
                      {tx.notes || 'No comments'}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <button
                      onClick={() => setSelectedGoldTransaction(tx)}
                      className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold px-3 py-1 border border-emerald-200/50 rounded-lg uppercase tracking-wider cursor-pointer transition-colors shadow-sm"
                    >
                      Correct
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
