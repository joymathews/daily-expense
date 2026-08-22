import React from 'react';
import { formatCycleLabel, type UserCycleFrontend } from '../utils/cycle-helper';

interface CycleSelectorDropdownProps {
  cycles: UserCycleFrontend[];
  selectedCycle: UserCycleFrontend | null;
  onSelectCycle: (cycle: UserCycleFrontend) => void;
  className?: string;
}

export const CycleSelectorDropdown: React.FC<CycleSelectorDropdownProps> = ({
  cycles,
  selectedCycle,
  onSelectCycle,
  className = '',
}) => {
  if (!cycles || cycles.length === 0) return null;

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
        Cycle:
      </span>
      <select
        value={selectedCycle?.id || ''}
        onChange={(e) => {
          const found = cycles.find((c) => c.id === e.target.value);
          if (found) onSelectCycle(found);
        }}
        className="bg-white/80 dark:bg-slate-800/80 backdrop-blur border border-indigo-200 dark:border-indigo-900/50 text-indigo-900 dark:text-indigo-200 text-xs font-medium rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm transition-all min-w-[240px]"
        aria-label="Select Billing Cycle"
      >
        {cycles.map((cycle) => (
          <option key={cycle.id} value={cycle.id}>
            {cycle.isCurrent ? '⭐ Active: ' : ''}
            {formatCycleLabel(cycle)}
          </option>
        ))}
      </select>
    </div>
  );
};
