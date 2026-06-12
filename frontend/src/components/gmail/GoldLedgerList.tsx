import React from 'react';
import type { GoldTransaction } from '../../hooks/use-gmail-integration';

interface GoldLedgerListProps {
  goldTransactions: GoldTransaction[];
  setSelectedGoldTransaction: (tx: GoldTransaction) => void;
  onDeleteClick: (tx: GoldTransaction) => void;
}

export const GoldLedgerList: React.FC<GoldLedgerListProps> = ({
  goldTransactions,
  setSelectedGoldTransaction,
  onDeleteClick,
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
              <th className="px-2 py-2.5 text-left">Date</th>
              <th className="px-2 py-2.5 text-left">Merchant</th>
              <th className="px-2 py-2.5 text-right">Amount</th>
              <th className="px-2 py-2.5 text-center">Category</th>
              <th className="px-2 py-2.5 text-center">Method</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 bg-white">
            {goldTransactions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-12 text-center">
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">No validated ledger items found</p>
                </td>
              </tr>
            ) : (
              goldTransactions.map(tx => (
                <tr key={tx.id} className="hover:bg-gray-50/50 transition-colors text-xs">
                  <td className="px-2 py-2.5 text-gray-500 max-w-[120px] truncate" title={tx.transactionDate}>
                    {tx.transactionDate}
                  </td>
                  <td onClick={() => setSelectedGoldTransaction(tx)} className="px-2 py-2.5 font-bold text-gray-900 max-w-[180px] truncate cursor-pointer hover:text-emerald-750 transition-colors" title={tx.merchant}>
                    {tx.merchant}
                  </td>
                  <td className="px-2 py-2.5 font-extrabold text-right text-emerald-600 whitespace-nowrap">{tx.amount.toFixed(2)} {tx.currency}</td>
                  <td className="px-2 py-2.5 text-center">
                    <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-bold uppercase text-[9px] border border-emerald-100/30 whitespace-nowrap">
                      {tx.category}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <span className="bg-slate-50 text-slate-700 px-2 py-0.5 rounded font-bold uppercase text-[9px] border border-slate-100/30 truncate max-w-[120px] whitespace-nowrap" title={tx.paymentMethod}>
                      {tx.paymentMethod || 'Unknown'}
                    </span>
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
