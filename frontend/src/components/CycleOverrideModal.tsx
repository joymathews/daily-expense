import React, { useState } from 'react';
import type { UserCycleFrontend } from '../utils/cycle-helper';
import { formatLocalTransactionTime } from '../utils/transaction-helper';

export interface GoldTxOption {
  id: string;
  merchant: string;
  amount: number;
  currency: string;
  transactionDate: string;
  sourceReceivedAt?: string;
  category: string;
}

interface CycleOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  cycle?: UserCycleFrontend | null;
  transactions: GoldTxOption[];
  onSaveOverride: (payload: {
    startType: 'default' | 'transaction' | 'date';
    startTransactionId?: string;
    startDate: string;
    startTimestamp: string;
    cycleName?: string;
  }) => Promise<void>;
  onResetDefault?: (cycleId: string) => Promise<void>;
}

export const CycleOverrideModal: React.FC<CycleOverrideModalProps> = ({
  isOpen,
  onClose,
  cycle,
  transactions,
  onSaveOverride,
  onResetDefault,
}) => {
  const [startType, setStartType] = useState<'default' | 'transaction' | 'date'>('transaction');
  const [selectedTxId, setSelectedTxId] = useState<string>('');
  const [customDate, setCustomDate] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const todayStr = new Date().toISOString().split('T')[0];
  const eligibleTransactions = (transactions || []).filter(tx => tx.transactionDate <= todayStr);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (startType === 'default') {
        if (onResetDefault && cycle) {
          await onResetDefault(cycle.id);
        }
        onClose();
        return;
      }

      if (startType === 'transaction') {
        const targetTx = transactions.find((t) => t.id === selectedTxId);
        if (!targetTx) {
          throw new Error('Please select a transaction to set as Cycle Start Anchor');
        }
        const startIso = targetTx.sourceReceivedAt || `${targetTx.transactionDate}T00:00:00.000Z`;
        await onSaveOverride({
          startType: 'transaction',
          startTransactionId: targetTx.id,
          startDate: targetTx.transactionDate,
          startTimestamp: startIso,
          cycleName: `Cycle from ${targetTx.merchant} (${targetTx.transactionDate})`,
        });
      } else {
        if (!customDate) {
          throw new Error('Please enter a valid start date');
        }
        await onSaveOverride({
          startType: 'date',
          startDate: customDate,
          startTimestamp: `${customDate}T00:00:00.000Z`,
          cycleName: `Cycle from ${customDate}`,
        });
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update cycle');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-lg w-full p-6 relative">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
          Configure Cycle Start
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">
          Set how this cycle's start date and time is determined. Preceding cycle boundaries will recalculate automatically.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-rose-50 text-rose-700 text-xs rounded-lg border border-rose-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Mode Selector */}
          <div className="space-y-2">
            <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <input
                type="radio"
                name="startType"
                value="transaction"
                checked={startType === 'transaction'}
                onChange={() => setStartType('transaction')}
                className="text-indigo-600 focus:ring-indigo-500"
              />
              <div>
                <span className="font-semibold text-slate-900 dark:text-white block">
                  ⚓ Select Transaction Anchor
                </span>
                <span className="text-slate-500 text-[11px]">
                  Lock cycle start to a specific transaction timestamp (e.g. Salary Credit)
                </span>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <input
                type="radio"
                name="startType"
                value="date"
                checked={startType === 'date'}
                onChange={() => setStartType('date')}
                className="text-indigo-600 focus:ring-indigo-500"
              />
              <div>
                <span className="font-semibold text-slate-900 dark:text-white block">
                  📅 Custom Calendar Date
                </span>
                <span className="text-slate-500 text-[11px]">
                  Manually choose a custom start date (YYYY-MM-DD)
                </span>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <input
                type="radio"
                name="startType"
                value="default"
                checked={startType === 'default'}
                onChange={() => setStartType('default')}
                className="text-indigo-600 focus:ring-indigo-500"
              />
              <div>
                <span className="font-semibold text-slate-900 dark:text-white block">
                  ⚙️ Default Recurring Rule
                </span>
                <span className="text-slate-500 text-[11px]">
                  Reset to recurring start-day preference (e.g. 17th of month)
                </span>
              </div>
            </label>
          </div>

          {/* Conditional Inputs */}
          {startType === 'transaction' && (
            <div className="mt-3">
              <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                Choose Start Anchor Transaction:
              </label>
              <select
                value={selectedTxId}
                onChange={(e) => setSelectedTxId(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">-- Select Transaction --</option>
                {eligibleTransactions.map((tx) => {
                  const localTime = formatLocalTransactionTime(tx.sourceReceivedAt);
                  const dateLabel = localTime ? `${tx.transactionDate} ${localTime}` : tx.transactionDate;
                  return (
                    <option key={tx.id} value={tx.id}>
                      [{dateLabel}] - {tx.merchant} ({tx.currency} {tx.amount.toLocaleString()}) [{tx.category}]
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {startType === 'date' && (
            <div className="mt-3">
              <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                Choose Start Date:
              </label>
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow-sm transition-all disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save & Recalculate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
