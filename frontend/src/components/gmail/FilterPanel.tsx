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
  addSender,
  removeSender,
  handleKeyDown,
  error,
}) => {
  return (
    <div className="lg:col-span-1 bg-white p-4 border border-gray-100 rounded space-y-4">
      <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest border-b pb-2 mb-2">Filters</div>
      <div className="space-y-3">
        <div>
          <label htmlFor="sender-input" className="block text-[8px] font-black text-gray-400 uppercase mb-1">Sender Emails</label>
          <div className="flex flex-wrap gap-1 mb-2">
            {senders.map(email => (
              <span key={email} className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-100">
                {email}
                <button onClick={() => removeSender(email)} className="ml-1 text-blue-400 hover:text-blue-600">×</button>
              </span>
            ))}
          </div>
          <input 
            id="sender-input"
            type="text" 
            placeholder="Add sender email..."
            className="w-full px-2 py-1.5 bg-gray-50 border border-gray-100 focus:bg-white focus:border-blue-500 rounded outline-none text-[11px] text-gray-700"
            value={currentSender}
            onChange={(e) => setCurrentSender(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <p className="text-[8px] text-gray-400 mt-1">Press Enter to add multiple senders</p>
        </div>
        <div>
          <label htmlFor="start-date" className="block text-[8px] font-black text-gray-400 uppercase mb-1">Start Date</label>
          <input 
            id="start-date"
            type="date" 
            className="w-full px-2 py-1.5 bg-gray-50 border border-gray-100 focus:bg-white focus:border-blue-500 rounded outline-none text-[11px] text-gray-700"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="end-date" className="block text-[8px] font-black text-gray-400 uppercase mb-1">End Date</label>
          <input 
            id="end-date"
            type="date" 
            className="w-full px-2 py-1.5 bg-gray-50 border border-gray-100 focus:bg-white focus:border-blue-500 rounded outline-none text-[11px] text-gray-700"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-[8px] font-black text-gray-400 uppercase mb-1">Email Subject (Optional)</label>
          <input 
            type="text" 
            placeholder="receipt..."
            className="w-full px-2 py-1.5 bg-gray-50 border border-gray-100 focus:bg-white focus:border-blue-500 rounded outline-none text-[11px] text-gray-700"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
      </div>
      {error && <div className="p-2 bg-red-50 text-red-600 text-[10px] font-bold rounded">{error}</div>}
    </div>
  );
};
