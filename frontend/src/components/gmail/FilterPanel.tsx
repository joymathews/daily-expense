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
  isFetching?: boolean;
  onFetchClick?: () => void;
  fetcherEmails?: string[];
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
  isFetching = false,
  onFetchClick,
  fetcherEmails = [],
}) => {
  return (
    <div className="w-full bg-white p-4 border border-gray-100 rounded-2xl shadow-sm flex flex-col gap-4">
      <div className="flex flex-col lg:flex-row lg:items-start gap-4">
        {/* Title block: Vertical border on desktop, horizontal border on mobile */}
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider shrink-0 lg:border-r lg:border-gray-100 lg:pr-4 lg:py-2 border-b border-gray-50 pb-2 lg:pb-2 lg:border-b-0 w-full lg:w-auto">
          Fetcher Config
        </div>

        {/* Main Form Fields Container (flows horizontally on desktop, vertically on mobile) */}
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
          <div className="min-w-0">
            <label htmlFor="sender-input" className="block text-[11px] font-bold text-gray-500 uppercase tracking-tight mb-1.5 whitespace-nowrap">
              Sender Emails <span className="text-gray-400 font-normal text-[9px] normal-case ml-1">(press enter to add)</span>
            </label>
            <input 
              id="sender-input"
              type="text" 
              placeholder="Add sender email..."
              list="fetcher-emails-list"
              className="w-full px-3 py-1.5 bg-gray-55/50 border border-gray-200 focus:bg-white focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all duration-200"
              value={currentSender}
              onChange={(e) => setCurrentSender(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <datalist id="fetcher-emails-list" data-testid="fetcher-emails-datalist">
              {fetcherEmails.map(email => (
                <option key={email} value={email} />
              ))}
            </datalist>
          </div>
          
          <div className="min-w-0">
            <label htmlFor="start-date" className="block text-[11px] font-bold text-gray-500 uppercase tracking-tight mb-1.5">
              Start Date
            </label>
            <input 
              id="start-date"
              type="date" 
              className="w-full px-3 py-1.5 bg-gray-50/50 border border-gray-200 focus:bg-white focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all duration-200"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          
          <div className="min-w-0">
            <label htmlFor="end-date" className="block text-[11px] font-bold text-gray-500 uppercase tracking-tight mb-1.5">
              End Date
            </label>
            <input 
              id="end-date"
              type="date" 
              className="w-full px-3 py-1.5 bg-gray-50/50 border border-gray-200 focus:bg-white focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all duration-200"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          
          <div className="min-w-0">
            <label htmlFor="subject-input" className="block text-[11px] font-bold text-gray-500 uppercase tracking-tight mb-1.5">
              Email Subject <span className="text-gray-400 font-medium text-[9px]">(Optional)</span>
            </label>
            <input 
              id="subject-input"
              type="text" 
              placeholder="receipt..."
              className="w-full px-3 py-1.5 bg-gray-50/50 border border-gray-200 focus:bg-white focus:border-indigo-500 rounded-xl outline-none text-xs text-gray-700 transition-all duration-200"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Row 2: Tag List Area (spans full width below inputs, aligned with them on desktop) */}
      {senders.length > 0 && (
        <div className="lg:pl-[120px] flex flex-wrap gap-1.5 py-1">
          {senders.map(email => (
            <span key={email} className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-750 border border-indigo-100/50 shadow-sm animate-fade-in">
              {email}
              <button 
                onClick={() => removeSender(email)} 
                className="ml-1.5 text-indigo-400 hover:text-indigo-650 font-bold cursor-pointer"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Row 3: Fetch Action Button (right aligned, separated by divider spacing) */}
      {onFetchClick && (
        <div className="pt-3 border-t border-gray-50 flex justify-end">
          <button 
            onClick={onFetchClick}
            disabled={isFetching}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-xs font-bold px-6 py-2.5 rounded-xl shadow-md hover:shadow-lg transition-all uppercase tracking-wider cursor-pointer text-center"
          >
            {isFetching ? 'Processing...' : 'Authorize & Fetch'}
          </button>
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-50 text-red-600 text-xs font-bold rounded-xl border border-red-100/50 w-full">
          {error}
        </div>
      )}
    </div>
  );
};

