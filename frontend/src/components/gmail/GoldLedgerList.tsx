import React from 'react';
import type { GoldTransaction } from '../../hooks/use-gmail-integration';

interface GoldLedgerListProps {
  goldTransactions: GoldTransaction[];
  setSelectedGoldTransaction: (tx: GoldTransaction) => void;
  onDeleteClick: (tx: GoldTransaction) => void;
  startDate: string;
  setStartDate: (val: string) => void;
  endDate: string;
  setEndDate: (val: string) => void;
}

export const GoldLedgerList: React.FC<GoldLedgerListProps> = ({
  goldTransactions,
  setSelectedGoldTransaction,
  onDeleteClick,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
}) => {
  return (
    <div>
      <div className="border-b border-gray-100 bg-gray-50/70 flex justify-between items-center px-4 py-3">
        <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Gold Verified Transactions (Double-Entry Ledger)</span>
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{goldTransactions.length} Verified Items</span>
      </div>
      
      {/* Date Filter Bar */}
      <div className="flex flex-wrap items-center gap-4 bg-gray-50/30 px-4 py-2 border-b border-gray-100">
        <div className="flex items-center space-x-2">
          <label htmlFor="gold-start-date" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Start Date:</label>
          <input 
            id="gold-start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg outline-none text-xs font-bold text-gray-755 px-2.5 py-1 focus:border-indigo-500 transition-colors"
          />
        </div>
        <div className="flex items-center space-x-2">
          <label htmlFor="gold-end-date" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">End Date:</label>
          <input 
            id="gold-end-date"
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
                  <td onClick={() => setSelectedGoldTransaction(tx)} className="px-2 py-2.5 font-bold text-gray-900 max-w-[180px] cursor-pointer hover:text-emerald-750 transition-colors">
                    <div className="truncate">{tx.merchant}</div>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                      tx.sourceType === 'manual' 
                        ? 'bg-amber-50 text-amber-700 border border-amber-100' 
                        : 'bg-blue-50 text-blue-750 border border-blue-100'
                    }`}>
                      {tx.sourceType || 'email'}
                    </span>
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
