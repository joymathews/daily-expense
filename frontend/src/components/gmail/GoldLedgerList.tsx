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
      <div className="border-b border-gray-100 bg-gray-50/50 flex justify-between items-center px-4 py-2">
        <span className="text-[9px] font-black text-emerald-600 uppercase tracking-wider">Gold Verified Transactions (Double-Entry Ledger)</span>
        <span className="text-[9px] font-black text-gray-300 uppercase">{goldTransactions.length} Verified Items</span>
      </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-gray-50 text-[8px] font-black text-gray-400 uppercase tracking-tighter">
            <tr>
              <th className="px-4 py-2 text-left">Ledger Merchant</th>
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-right">Amount</th>
              <th className="px-4 py-2 text-center">Category</th>
              <th className="px-4 py-2 text-left">Lineage / Comments</th>
              <th className="px-4 py-2 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {goldTransactions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center">
                  <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">No validated ledger items found</p>
                </td>
              </tr>
            ) : (
              goldTransactions.map(tx => (
                <tr key={tx.id} className="hover:bg-gray-50 transition-colors text-[10px]">
                  <td className="px-4 py-2 font-bold text-gray-900">{tx.merchant}</td>
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{tx.transactionDate}</td>
                  <td className="px-4 py-2 font-black text-right text-emerald-600">{tx.amount.toFixed(2)} {tx.currency}</td>
                  <td className="px-4 py-2 text-center"><span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-bold uppercase text-[8px]">{tx.category}</span></td>
                  <td className="px-4 py-2 text-left">
                    <span className="text-[8px] text-blue-600 font-bold block uppercase tracking-tight truncate max-w-xs" title={tx.emailSubject}>
                      🔗 Email: {tx.emailSubject || 'Linked source raw receipt'}
                    </span>
                    <span className="text-[9px] text-gray-400 italic block">{tx.notes || 'No comments'}</span>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => setSelectedGoldTransaction(tx)}
                      className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[8px] font-black px-2.5 py-1 border border-emerald-200 rounded uppercase tracking-wider"
                    >
                      Correct Ledger
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
