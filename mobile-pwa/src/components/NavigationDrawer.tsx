import React from 'react';
import { NavLink } from 'react-router-dom';

interface NavigationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  user?: any;
  onSignOut?: () => void;
}

export const NavigationDrawer: React.FC<NavigationDrawerProps> = ({
  isOpen,
  onClose,
  user,
  onSignOut,
}) => {
  if (!isOpen) return null;

  const navItems = [
    {
      to: '/',
      label: 'Compass',
      icon: '🧭',
      desc: 'Safe-to-spend allowance & velocity',
      testId: 'nav-drawer-compass',
    },
    {
      to: '/triage',
      label: 'Receipt Triage',
      icon: '📥',
      desc: 'Email ingestion & extraction',
      testId: 'nav-drawer-triage',
    },
    {
      to: '/ledger',
      label: 'Confirmed Ledger',
      icon: '💳',
      desc: 'Current cycle transactions feed',
      testId: 'nav-drawer-ledger',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex" data-testid="navigation-drawer-backdrop">
      
      {/* Dimmed Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        data-testid="drawer-backdrop-click"
      />

      {/* Drawer Panel */}
      <div
        className="relative z-10 w-72 max-w-[85vw] bg-white h-full shadow-2xl flex flex-col justify-between p-5 border-r border-slate-200/80 animate-in slide-in-from-left duration-200"
        data-testid="navigation-drawer-panel"
      >
        
        {/* Top Header & Brand */}
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center space-x-2">
              <span className="text-lg font-black tracking-tight text-indigo-600 Outfit">
                DAILY EXPENSE
              </span>
              <span className="bg-indigo-50 border border-indigo-200/80 text-indigo-700 text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md shadow-2xs">
                Mobile
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              data-testid="close-drawer-btn"
              aria-label="Close Navigation Menu"
            >
              ✕
            </button>
          </div>

          {/* User Profile Card */}
          {user && (
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 flex items-center space-x-3 shadow-2xs">
              <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white font-black text-sm flex items-center justify-center shadow-xs">
                {(user.signInDetails?.loginId || user.username || 'U')[0].toUpperCase()}
              </div>
              <div className="overflow-hidden">
                <span className="text-[10px] uppercase font-black text-slate-400 tracking-wider block">Signed In As</span>
                <span className="text-xs font-bold text-slate-800 truncate block">
                  {user.signInDetails?.loginId || user.username}
                </span>
              </div>
            </div>
          )}

          {/* Navigation Links */}
          <nav className="space-y-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-2 block">
              Menu Navigation
            </span>
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                end={item.to === '/'}
                data-testid={item.testId}
                className={({ isActive }) =>
                  `flex items-start space-x-3 px-3.5 py-3 rounded-2xl transition-all ${
                    isActive
                      ? 'bg-indigo-50/90 text-indigo-700 font-bold border border-indigo-200/80 shadow-2xs'
                      : 'text-slate-700 hover:bg-slate-50 font-medium'
                  }`
                }
              >
                <span className="text-lg mt-0.5">{item.icon}</span>
                <div className="flex-1">
                  <span className="text-sm font-bold block">{item.label}</span>
                  <span className="text-[11px] text-slate-400 font-normal block leading-tight">{item.desc}</span>
                </div>
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Footer with Sign Out */}
        <div className="pt-4 border-t border-slate-100">
          {onSignOut && (
            <button
              onClick={() => {
                onClose();
                onSignOut();
              }}
              className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl text-xs font-bold text-rose-600 bg-rose-50/80 hover:bg-rose-100/80 border border-rose-200 transition-colors active:scale-98 shadow-2xs cursor-pointer"
              data-testid="drawer-signout-btn"
            >
              <span>🚪</span>
              <span>Log Out</span>
            </button>
          )}
        </div>

      </div>

    </div>
  );
};
