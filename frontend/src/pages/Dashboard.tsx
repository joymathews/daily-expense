import React from 'react';
import { Link } from 'react-router-dom';

interface DashboardProps {
  userEmail: string;
}

const Dashboard: React.FC<DashboardProps> = ({ userEmail }) => {
  return (
    <div className="w-full max-w-5xl space-y-4">
      <div className="border-b border-gray-100 pb-4">
        <h1 className="text-xl font-black text-gray-900">
          HI, <span className="text-blue-600 uppercase">{userEmail.split('@')[0]}</span>
        </h1>
        <p className="text-xs text-gray-400 font-bold uppercase tracking-tight">System Status: Active</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white border border-gray-100 p-4 rounded shadow-sm">
          <div className="text-[9px] font-black text-gray-400 uppercase mb-1">Inbox</div>
          <div className="text-sm font-bold text-gray-800">Gmail Connected</div>
        </div>
        <div className="bg-white border border-gray-100 p-4 rounded shadow-sm">
          <div className="text-[9px] font-black text-gray-400 uppercase mb-1">Identity</div>
          <div className="text-sm font-bold text-gray-800">AWS Cognito Verified</div>
        </div>
        <div className="bg-white border border-gray-100 p-4 rounded shadow-sm">
          <div className="text-[9px] font-black text-gray-400 uppercase mb-1">Server</div>
          <div className="text-sm font-bold text-green-600">Operational (100ms)</div>
        </div>
      </div>

      <div className="bg-blue-600 text-white p-6 rounded shadow-lg flex flex-col md:flex-row md:items-center justify-between space-y-4 md:space-y-0">
        <div>
          <h2 className="text-lg font-black uppercase italic">Start Extracting</h2>
          <p className="text-xs font-bold text-blue-100 uppercase opacity-80">No digital expenses found in database yet.</p>
        </div>
        <Link 
          to="/gmail"
          className="bg-white text-blue-600 text-[10px] font-black px-6 py-2 rounded shadow hover:bg-gray-50 transition-all uppercase tracking-widest text-center"
        >
          Go to Fetcher
        </Link>
      </div>
    </div>
  );
};

export default Dashboard;
