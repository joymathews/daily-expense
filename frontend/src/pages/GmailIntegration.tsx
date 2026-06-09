import React from 'react';
import { useGmailIntegration } from '../hooks/use-gmail-integration';
import { FilterPanel } from '../components/gmail/FilterPanel';
import { EmailList } from '../components/gmail/EmailList';
import { EmailDetailModal } from '../components/gmail/EmailDetailModal';

const GmailIntegration: React.FC = () => {
  const {
    senders,
    currentSender,
    setCurrentSender,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    subject,
    setSubject,
    emails,
    isLoading,
    error,
    activeTab,
    setActiveTab,
    selectedEmail,
    setSelectedEmail,
    addSender,
    removeSender,
    handleKeyDown,
    markAsTransaction,
    markAsNonTransaction,
    handleFetchClick,
  } = useGmailIntegration();

  return (
    <div className="w-full max-w-5xl space-y-4">
      <div className="flex items-center justify-between border-b border-gray-100 pb-4">
        <div>
          <h2 className="text-xl font-black text-gray-900 uppercase italic">Fetcher</h2>
          <p className="text-[10px] text-gray-400 font-bold uppercase">Retrieve receipts from Google Cloud</p>
        </div>
        
        <button 
          onClick={handleFetchClick}
          disabled={isLoading}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-[10px] font-black px-6 py-2 rounded shadow transition-all uppercase tracking-widest"
        >
          {isLoading ? 'Processing...' : 'Authorize & Fetch'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
        <FilterPanel
          senders={senders}
          currentSender={currentSender}
          setCurrentSender={setCurrentSender}
          startDate={startDate}
          setStartDate={setStartDate}
          endDate={endDate}
          setEndDate={setEndDate}
          subject={subject}
          setSubject={setSubject}
          addSender={addSender}
          removeSender={removeSender}
          handleKeyDown={handleKeyDown}
          error={error}
        />

        <EmailList
          emails={emails}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isLoading={isLoading}
          setSelectedEmail={setSelectedEmail}
          markAsTransaction={markAsTransaction}
          markAsNonTransaction={markAsNonTransaction}
        />
      </div>

      <EmailDetailModal
        selectedEmail={selectedEmail}
        setSelectedEmail={setSelectedEmail}
        markAsTransaction={markAsTransaction}
        markAsNonTransaction={markAsNonTransaction}
      />
    </div>
  );
};

export default GmailIntegration;
