import React from 'react';
import { Link, useLocation } from 'react-router-dom';

interface NavbarProps {
  onSignOut: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ onSignOut }) => {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="sticky top-0 z-50 bg-white/85 backdrop-blur-md border-b border-gray-100/80 h-14 transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between">
        <div className="flex items-center space-x-6 h-full">
          <Link to="/" className="flex items-center text-indigo-600 hover:text-indigo-700 font-extrabold tracking-tight text-base transition-colors">
            <span className="text-xl mr-1 font-semibold bg-indigo-50 text-indigo-600 w-6 h-6 rounded-md flex items-center justify-center shadow-sm">
              $
            </span>
            DAILY EXPENSE
          </Link>
          
          <div className="flex items-center space-x-2">
            <Link
              to="/"
              className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all duration-200 ${
                isActive('/') 
                  ? 'bg-indigo-50/70 text-indigo-700 shadow-sm' 
                  : 'text-gray-500 hover:text-gray-950 hover:bg-gray-50/50'
              }`}
            >
              Dashboard
            </Link>
            <Link
              to="/ingestion"
              className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all duration-200 ${
                isActive('/ingestion') 
                  ? 'bg-indigo-50/70 text-indigo-700 shadow-sm' 
                  : 'text-gray-500 hover:text-gray-950 hover:bg-gray-50/50'
              }`}
            >
              Data Ingestion
            </Link>
            <Link
              to="/pipeline"
              className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all duration-200 ${
                isActive('/pipeline') 
                  ? 'bg-indigo-50/70 text-indigo-700 shadow-sm' 
                  : 'text-gray-500 hover:text-gray-950 hover:bg-gray-50/50'
              }`}
            >
              Transaction Pipeline
            </Link>
            <Link
              to="/transactions"
              className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all duration-200 ${
                isActive('/transactions') 
                  ? 'bg-indigo-50/70 text-indigo-700 shadow-sm' 
                  : 'text-gray-500 hover:text-gray-950 hover:bg-gray-50/50'
              }`}
            >
              Ledger
            </Link>
            <Link
              to="/analytics"
              className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all duration-200 ${
                isActive('/analytics') 
                  ? 'bg-indigo-50/70 text-indigo-700 shadow-sm' 
                  : 'text-gray-500 hover:text-gray-950 hover:bg-gray-50/50'
              }`}
            >
              Analytics
            </Link>
            <Link
              to="/insights"
              className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all duration-200 ${
                isActive('/insights') 
                  ? 'bg-indigo-50/70 text-indigo-700 shadow-sm' 
                  : 'text-gray-500 hover:text-gray-950 hover:bg-gray-50/50'
              }`}
            >
              Insights
            </Link>
          </div>
        </div>
        
        <button
          onClick={onSignOut}
          className="text-xs font-bold text-gray-550 hover:text-red-600 hover:bg-red-50 hover:border-red-100 uppercase tracking-wider border border-gray-200 px-3 py-1.5 rounded-md shadow-sm transition-all duration-200 cursor-pointer"
        >
          Sign Out
        </button>
      </div>
    </nav>
  );
};

export default Navbar;
