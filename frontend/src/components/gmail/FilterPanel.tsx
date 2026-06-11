import React from 'react';

interface FilterPanelProps {
  senders: string[];
  currentSender: string;
  setCurrentSender: (val: string) => void;
  startDate: string;
  setStartDate: (val: string) => void;
  endDate: string;
  setEndDate: (val: string) => void;
  subject: string;
  setSubject: (val: string) => void;
  addSender: () => void;
  removeSender: (email: string) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  error: string | null;
}

export const FilterPanel: React.FC<FilterPanelProps> = ({
  senders,
  currentSender,
  setCurrentSender,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  subject,
  setSubject,
  removeSender,
  handleKeyDown,
  error,
}) => {
  return (
    <div className="bg-white p-5 border border-gray-100 rounded-2xl shadow-sm space-y-5">
      <div className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-50 pb-2 mb-1">
        Fetcher Config
      </div>
      <div className="space-y-4">
        <div>
          <label htmlFor="sender-input" className="block text-xs font-bold text-gray-500 uppercase tracking-tight mb-1.5">
            Sender Emails
          </label>
          {senders.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {senders.map(email => (
                <span key={email} className="inline-flex items-center px-2 py-1 rounded-md text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100/50">
                  {email}
                  <button 
                    onClick={() => removeSender(email)} 
                    className="ml-1.5 text-indigo-400 hover:text-indigo-600 font-bold cursor-pointer"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <input 
            id="sender-input"
            type="text" 
            placeholder="Add sender email..."
            className="w-full px-3 py-2 bg-gray-50/50 border border-gray-200 focus:bg-white focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all duration-200"
            value={currentSender}
            onChange={(e) => setCurrentSender(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <p className="text-[10px] font-medium text-gray-400 mt-1">Press Enter to add multiple senders</p>
        </div>
        
        <div>
          <label htmlFor="start-date" className="block text-xs font-bold text-gray-500 uppercase tracking-tight mb-1.5">
            Start Date
          </label>
          <input 
            id="start-date"
            type="date" 
            className="w-full px-3 py-2 bg-gray-50/50 border border-gray-200 focus:bg-white focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all duration-200"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        
        <div>
          <label htmlFor="end-date" className="block text-xs font-bold text-gray-500 uppercase tracking-tight mb-1.5">
            End Date
          </label>
          <input 
            id="end-date"
            type="date" 
            className="w-full px-3 py-2 bg-gray-50/50 border border-gray-200 focus:bg-white focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all duration-200"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        
        <div>
          <label htmlFor="subject-input" className="block text-xs font-bold text-gray-500 uppercase tracking-tight mb-1.5">
            Email Subject <span className="text-gray-400 font-medium">(Optional)</span>
          </label>
          <input 
            id="subject-input"
            type="text" 
            placeholder="receipt..."
            className="w-full px-3 py-2 bg-gray-50/50 border border-gray-200 focus:bg-white focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all duration-200"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
      </div>
      
      {error && (
        <div className="p-3 bg-red-50 text-red-600 text-xs font-bold rounded-xl border border-red-100/50">
          {error}
        </div>
      )}
    </div>
  );
};

