import React from 'react';
import { NavLink } from 'react-router-dom';

export const BottomNav: React.FC = () => {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-xl border-t border-slate-200/80 pb-safe shadow-lg shadow-slate-900/5"
      data-testid="mobile-bottom-nav"
    >
      <div className="max-w-md mx-auto flex items-center justify-around px-3 py-2">
        
        {/* Tab 1: Compass / Summary */}
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex flex-col items-center justify-center w-24 py-1.5 rounded-2xl transition-all duration-200 ${
              isActive
                ? 'text-indigo-600 font-bold bg-indigo-50/90 shadow-2xs'
                : 'text-slate-400 hover:text-slate-700'
            }`
          }
          data-testid="nav-compass"
        >
          <span className="text-xl leading-none mb-1">📊</span>
          <span className="text-[11px] Outfit font-bold tracking-tight">Compass</span>
        </NavLink>

        {/* Tab 2: Sync & Ingestion */}
        <NavLink
          to="/triage"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center w-24 py-1.5 rounded-2xl transition-all duration-200 ${
              isActive
                ? 'text-indigo-600 font-bold bg-indigo-50/90 shadow-2xs'
                : 'text-slate-400 hover:text-slate-700'
            }`
          }
          data-testid="nav-triage"
        >
          <span className="text-xl leading-none mb-1">📥</span>
          <span className="text-[11px] Outfit font-bold tracking-tight">Triage</span>
        </NavLink>

        {/* Tab 3: Gold Ledger */}
        <NavLink
          to="/ledger"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center w-24 py-1.5 rounded-2xl transition-all duration-200 ${
              isActive
                ? 'text-indigo-600 font-bold bg-indigo-50/90 shadow-2xs'
                : 'text-slate-400 hover:text-slate-700'
            }`
          }
          data-testid="nav-ledger"
        >
          <span className="text-xl leading-none mb-1">📋</span>
          <span className="text-[11px] Outfit font-bold tracking-tight">Ledger</span>
        </NavLink>

      </div>
    </nav>
  );
};
