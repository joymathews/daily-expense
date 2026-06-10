import React, { useState } from 'react';
import { useGmailIntegration } from '../hooks/use-gmail-integration';
import type { GoldTransaction } from '../hooks/use-gmail-integration';
import { FilterPanel } from '../components/gmail/FilterPanel';
import { EmailDetailModal } from '../components/gmail/EmailDetailModal';
import { BronzeEmailList } from '../components/gmail/BronzeEmailList';
import { SilverStagingList } from '../components/gmail/SilverStagingList';
import { GoldLedgerList } from '../components/gmail/GoldLedgerList';

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
    rawEmails,
    silverTransactions,
    goldTransactions,
    isLoading,
    isFetching,
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
    extractSelectedEmails,
    updateGoldTransaction,
    handleFetchClick,
    approveTransaction,
    approveTransactionsBatch,
  } = useGmailIntegration();

  // Multi-select state for Bronze batch extraction
  const [checkedEmailIds, setCheckedEmailIds] = useState<string[]>([]);

  // Multi-select state for Silver batch approval
  const [checkedSilverIds, setCheckedSilverIds] = useState<string[]>([]);
  
  // Local Gold transaction state for modal editing
  const [selectedGoldTransaction, setSelectedGoldTransaction] = useState<GoldTransaction | null>(null);

  // Ingestion status filtering for Bronze section
  const [bronzeFilter, setBronzeFilter] = useState<'all' | 'processed' | 'unprocessed'>('all');

  // Manage Bronze layer sub-tabs (compatibility with Vitest tests)
  const isBronzeActive = activeTab === 'bronze' || activeTab === 'transaction' || activeTab === 'non-transaction';
  const bronzeSubTab = (activeTab === 'non-transaction') ? 'non-transaction' : 'transaction';

  // Helper to determine if an email has already been processed
  const isEmailProcessed = (email: typeof rawEmails[0]) => {
    if (email.extracted) return true;
    const inSilver = silverTransactions.some(tx => tx.rawEmailId === email.id);
    const inGold = goldTransactions.some(tx => tx.bronzeEmailId === email.id);
    return inSilver || inGold;
  };

  // Filter raw emails for Bronze view
  const visibleRawEmails = rawEmails.filter(email => {
    const tabMatch = bronzeSubTab === 'transaction' ? email.hasTransaction : !email.hasTransaction;
    if (!tabMatch) return false;
    
    if (bronzeFilter === 'processed') {
      return isEmailProcessed(email);
    } else if (bronzeFilter === 'unprocessed') {
      return !isEmailProcessed(email);
    }
    return true;
  });

  const unprocessedEmails = visibleRawEmails.filter(e => !isEmailProcessed(e));

  const toggleEmailCheck = (id: string) => {
    setCheckedEmailIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    const allUnprocessedChecked = unprocessedEmails.length > 0 && unprocessedEmails.every(e => checkedEmailIds.includes(e.id));
    if (allUnprocessedChecked && unprocessedEmails.length > 0) {
      setCheckedEmailIds(prev => prev.filter(id => !unprocessedEmails.some(e => e.id === id)));
    } else {
      const newIds = unprocessedEmails.map(e => e.id);
      setCheckedEmailIds(prev => Array.from(new Set([...prev, ...newIds])));
    }
  };

  const handleBatchExtract = async () => {
    if (checkedEmailIds.length === 0) return;
    await extractSelectedEmails(checkedEmailIds);
    setCheckedEmailIds([]);
  };

  const toggleSilverCheck = (id: string) => {
    setCheckedSilverIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAllSilver = () => {
    if (checkedSilverIds.length === silverTransactions.length) {
      setCheckedSilverIds([]);
    } else {
      setCheckedSilverIds(silverTransactions.map(t => t.id));
    }
  };

  const handleBatchApprove = async () => {
    if (checkedSilverIds.length === 0) return;
    await approveTransactionsBatch(checkedSilverIds);
    setCheckedSilverIds([]);
  };

  const handleReviewSilver = async (silverTx: any) => {
    // Look up raw email content to show in the modal alongside staging details
    const raw = rawEmails.find(e => e.id === silverTx.rawEmailId);
    if (raw) {
      setSelectedEmail({
        ...raw,
        extracted: {
          id: silverTx.id,
          merchant: silverTx.merchantNormalized || silverTx.merchantRaw,
          amount: silverTx.amount,
          currency: silverTx.currency,
          date: silverTx.transactionDate,
          category: silverTx.inferredCategory || 'Other',
          status: silverTx.status,
        }
      });
    } else {
      // Fetch fallback
      try {
        const res = await fetch(`/api/gmail/raw-emails`);
        if (res.ok) {
          const data = await res.json();
          const match = (data.emails || []).find((e: any) => e.id === silverTx.rawEmailId);
          if (match) {
            setSelectedEmail({
              id: match.id,
              sender: match.sender,
              subject: match.subject,
              date: match.receivedAt,
              snippet: match.snippet,
              body: match.rawBody,
              hasTransaction: true,
              extracted: {
                id: silverTx.id,
                merchant: silverTx.merchantNormalized || silverTx.merchantRaw,
                amount: silverTx.amount,
                currency: silverTx.currency,
                date: silverTx.transactionDate,
                category: silverTx.inferredCategory || 'Other',
                status: silverTx.status,
              }
            });
          }
        }
      } catch (err) {
        console.error('Failed to resolve raw email lineage for Silver row', err);
      }
    }
  };

  return (
    <div className="w-full max-w-5xl space-y-4">
      <div className="flex items-center justify-between border-b border-gray-100 pb-4">
        <div>
          <h2 className="text-xl font-black text-gray-900 uppercase italic">Fetcher</h2>
          <p className="text-[10px] text-gray-400 font-bold uppercase">Strict data layers: Bronze Raw ➔ Silver Staging ➔ Gold Ledger</p>
        </div>
        
        <button 
          onClick={handleFetchClick}
          disabled={isFetching}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-[10px] font-black px-6 py-2 rounded shadow transition-all uppercase tracking-widest"
        >
          {isFetching ? 'Processing...' : 'Authorize & Fetch'}
        </button>
      </div>

      {/* Main Tab bar (Medallion Layers) */}
      <div className="flex border-b border-gray-200 bg-white rounded p-1.5 shadow-sm space-x-2">
        <button
          onClick={() => setActiveTab('bronze')}
          className={`px-4 py-1.5 rounded text-[10px] font-black uppercase tracking-wider transition-colors ${
            isBronzeActive ? 'bg-orange-500 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          🟫 Bronze (Raw Emails)
        </button>
        <button
          onClick={() => setActiveTab('silver')}
          className={`px-4 py-1.5 rounded text-[10px] font-black uppercase tracking-wider transition-colors ${
            activeTab === 'silver' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          🟦 Silver (Staging Queue)
        </button>
        <button
          onClick={() => setActiveTab('gold')}
          className={`px-4 py-1.5 rounded text-[10px] font-black uppercase tracking-wider transition-colors ${
            activeTab === 'gold' ? 'bg-emerald-500 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          🟩 Gold (Confirmed Ledger)
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

        <div className="lg:col-span-3 bg-white border border-gray-100 rounded overflow-hidden shadow-sm">
          {isBronzeActive && (
            <BronzeEmailList
              visibleRawEmails={visibleRawEmails}
              checkedEmailIds={checkedEmailIds}
              unprocessedEmails={unprocessedEmails}
              isLoading={isLoading}
              isEmailProcessed={isEmailProcessed}
              toggleEmailCheck={toggleEmailCheck}
              toggleSelectAll={toggleSelectAll}
              handleBatchExtract={handleBatchExtract}
              setSelectedEmail={setSelectedEmail}
              markAsTransaction={markAsTransaction}
              markAsNonTransaction={markAsNonTransaction}
              extractSelectedEmails={extractSelectedEmails}
              bronzeSubTab={bronzeSubTab}
              setActiveTab={setActiveTab}
              rawEmails={rawEmails}
              bronzeFilter={bronzeFilter}
              setBronzeFilter={setBronzeFilter}
            />
          )}

          {activeTab === 'silver' && (
            <SilverStagingList
              silverTransactions={silverTransactions}
              checkedSilverIds={checkedSilverIds}
              toggleSelectAllSilver={toggleSelectAllSilver}
              toggleSilverCheck={toggleSilverCheck}
              handleBatchApprove={handleBatchApprove}
              handleReviewSilver={handleReviewSilver}
            />
          )}

          {activeTab === 'gold' && (
            <GoldLedgerList
              goldTransactions={goldTransactions}
              setSelectedGoldTransaction={setSelectedGoldTransaction}
            />
          )}
        </div>
      </div>

      <EmailDetailModal
        selectedEmail={selectedEmail}
        setSelectedEmail={setSelectedEmail}
        markAsTransaction={markAsTransaction}
        markAsNonTransaction={markAsNonTransaction}
        approveTransaction={approveTransaction}
        selectedGoldTransaction={selectedGoldTransaction}
        setSelectedGoldTransaction={setSelectedGoldTransaction}
        updateGoldTransaction={updateGoldTransaction}
      />
    </div>
  );
};

export default GmailIntegration;
