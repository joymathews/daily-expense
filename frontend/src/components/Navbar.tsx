import React from 'react';
import { Link, useLocation } from 'react-router-dom';

interface NavbarProps {
  onSignOut: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ onSignOut }) => {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-gray-200 h-12">
      <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between">
        <div className="flex items-center space-x-4 text-sm font-semibold">
          <Link to="/" className="flex items-center text-blue-600 font-black tracking-tighter">
            <span style={{ fontSize: '20px', marginRight: '4px' }}>$</span>
            DAILY EXPENSE
          </Link>
          
          <div className="flex items-center space-x-1">
            <Link
              to="/"
              className={`px-3 py-1 rounded transition-colors ${
                isActive('/') ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Dashboard
            </Link>
            <Link
              to="/gmail"
              className={`px-3 py-1 rounded transition-colors ${
                isActive('/gmail') ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Gmail Fetch
            </Link>
          </div>
        </div>
        
        <button
          onClick={onSignOut}
          className="text-[10px] font-black text-gray-400 hover:text-red-500 uppercase tracking-widest border border-gray-100 px-2 py-1 rounded transition-colors"
        >
          Sign Out
        </button>
      </div>
    </nav>
  );
};

export default Navbar;
