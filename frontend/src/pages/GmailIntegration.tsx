import React, { useState } from 'react';
import { useGmailIntegration } from '../hooks/use-gmail-integration';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { GoldTransaction } from '../hooks/use-gmail-integration';
import { FilterPanel } from '../components/gmail/FilterPanel';
import { EmailDetailModal } from '../components/gmail/EmailDetailModal';
import { BronzeEmailList } from '../components/gmail/BronzeEmailList';
import { SilverStagingList } from '../components/gmail/SilverStagingList';
import { GoldLedgerList } from '../components/gmail/GoldLedgerList';
import { DeleteConfirmationModal } from '../components/gmail/DeleteConfirmationModal';

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
    deletedRawEmails,
    deletedSilverTransactions,
    deletedGoldTransactions,
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
    fetchProgress,
    setFetchProgress,
    extractionProgress,
    setExtractionProgress,
    deleteRecords,
    restoreRecords,
    loadDeletedLayers,
  } = useGmailIntegration();

  // Multi-select state for Bronze batch extraction
  const [checkedEmailIds, setCheckedEmailIds] = useState<string[]>([]);

  // Multi-select state for Silver batch approval
  const [checkedSilverIds, setCheckedSilverIds] = useState<string[]>([]);
  
  // Local Gold transaction state for modal editing
  const [selectedGoldTransaction, setSelectedGoldTransaction] = useState<GoldTransaction | null>(null);

  // Ingestion status filtering for Bronze section
  const [bronzeFilter, setBronzeFilter] = useState<'all' | 'processed' | 'unprocessed'>('all');

  // Delete modal trigger states
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteLineage, setDeleteLineage] = useState<{ bronzeId?: string; silverId?: string; goldId?: string }>({});
  const [deleteSourceStage, setDeleteSourceStage] = useState<'bronze' | 'silver' | 'gold'>('bronze');

  const handleDeleteClick = (
    stage: 'bronze' | 'silver' | 'gold',
    lineage: { bronzeId?: string; silverId?: string; goldId?: string }
  ) => {
    setSelectedEmail(null);
    setSelectedGoldTransaction(null);
    setDeleteLineage(lineage);
    setDeleteSourceStage(stage);
    setIsDeleteModalOpen(true);
  };

  const handleBronzeDeleteClick = (email: typeof rawEmails[0]) => {
    const silver = silverTransactions.find(tx => tx.rawEmailId === email.id);
    const gold = goldTransactions.find(tx => tx.bronzeEmailId === email.id || (silver && tx.pendingTxId === silver.id));
    handleDeleteClick('bronze', {
      bronzeId: email.id,
      silverId: silver?.id,
      goldId: gold?.id,
    });
  };

  const handleSilverDeleteClick = (tx: typeof silverTransactions[0]) => {
    const gold = goldTransactions.find(g => g.pendingTxId === tx.id || g.bronzeEmailId === tx.rawEmailId);
    handleDeleteClick('silver', {
      bronzeId: tx.rawEmailId,
      silverId: tx.id,
      goldId: gold?.id,
    });
  };

  const handleGoldDeleteClick = (tx: typeof goldTransactions[0]) => {
    handleDeleteClick('gold', {
      bronzeId: tx.bronzeEmailId,
      silverId: tx.pendingTxId,
      goldId: tx.id,
    });
  };

  const handleConfirmDelete = async (targets: string[]) => {
    setIsDeleteModalOpen(false);
    await deleteRecords(
      deleteLineage.bronzeId,
      deleteLineage.silverId,
      deleteLineage.goldId,
      targets
    );
  };

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
          paymentMethod: silverTx.paymentMethod,
        }
      });
    } else {
      // Fetch fallback
      try {
        let authHeaders = {};
        try {
          const session = await fetchAuthSession();
          const token = session.tokens?.idToken?.toString();
          if (token) {
            authHeaders = { 'Authorization': `Bearer ${token}` };
          }
        } catch (err) {
          console.warn('Failed to fetch auth token in fallback:', err);
        }
        const res = await fetch(`/api/gmail/raw-emails`, { headers: authHeaders });
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
                paymentMethod: silverTx.paymentMethod,
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
    <div className="w-full max-w-5xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-gray-100 pb-4 gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-gray-900 uppercase tracking-tight">Gmail Ingestion Pipeline</h2>
          <p className="text-xs text-gray-400 font-semibold uppercase mt-0.5">Medallion Data Architecture: Bronze Raw ➔ Silver Staging ➔ Gold Ledger</p>
        </div>
      </div>

      {/* [FUNC-GMAIL-27] Premium Ingestion Progress Tracker Widget */}
      {fetchProgress.status !== 'idle' && (
        <div 
          data-testid="ingestion-progress-widget"
          className="bg-gradient-to-r from-indigo-50/70 to-blue-50/70 border border-indigo-100/50 backdrop-blur-md rounded-2xl p-5 shadow-sm space-y-3 animate-fade-in relative overflow-hidden"
        >
          {/* Subtle micro-animation backdrop glow */}
          <div className="absolute top-0 right-0 -mt-6 -mr-6 w-24 h-24 bg-indigo-400/10 rounded-full blur-xl animate-pulse"></div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {fetchProgress.status === 'started' || fetchProgress.status === 'fetching' ? (
                <div className="flex space-x-1">
                  <span className="w-2.5 h-2.5 bg-indigo-600 rounded-full animate-bounce"></span>
                  <span className="w-2.5 h-2.5 bg-indigo-600 rounded-full animate-bounce delay-100"></span>
                  <span className="w-2.5 h-2.5 bg-indigo-600 rounded-full animate-bounce delay-200"></span>
                </div>
              ) : fetchProgress.status === 'completed' ? (
                <span className="text-lg">✅</span>
              ) : (
                <span className="text-lg">❌</span>
              )}
              <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-900">
                {fetchProgress.status === 'started' && 'Initializing Google Gmail Connection...'}
                {fetchProgress.status === 'fetching' && `Ingesting receipts (${fetchProgress.current} of ${fetchProgress.total})`}
                {fetchProgress.status === 'completed' && 'Ingestion Completed Successfully!'}
                {fetchProgress.status === 'error' && 'Ingestion Failed'}
              </h4>
            </div>
            {fetchProgress.status === 'fetching' && (
              <span className="text-xs font-extrabold text-indigo-700 whitespace-nowrap bg-indigo-100/60 px-2 py-0.5 rounded-md">
                {Math.round((fetchProgress.current / fetchProgress.total) * 100)}%
              </span>
            )}
          </div>

          {fetchProgress.status === 'fetching' && fetchProgress.currentSubject && (
            <p className="text-xs text-gray-500 font-medium truncate max-w-lg">
              <span className="font-bold text-indigo-400/80 uppercase text-[10px] tracking-wider block">Current Message</span>
              {fetchProgress.currentSubject}
            </p>
          )}

          {fetchProgress.status === 'completed' && (
            <p className="text-xs text-emerald-700 font-bold uppercase tracking-wider">
              🎉 Loaded {fetchProgress.total} raw receipt email(s) into your Bronze layer.
            </p>
          )}

          {/* Progress Bar Container */}
          {(fetchProgress.status === 'fetching' || fetchProgress.status === 'completed') && (
            <div className="w-full bg-indigo-100/30 h-2.5 rounded-full overflow-hidden border border-indigo-200/20">
              <div 
                className="bg-gradient-to-r from-indigo-600 to-blue-500 h-full rounded-full transition-all duration-300 ease-out shadow-sm"
                style={{ width: `${fetchProgress.total > 0 ? (fetchProgress.current / fetchProgress.total) * 100 : 0}%` }}
              ></div>
            </div>
          )}

          {fetchProgress.status === 'completed' && (
            <div className="pt-1 flex justify-end">
              <button 
                onClick={() => setFetchProgress({ status: 'idle', current: 0, total: 0 })}
                className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 uppercase tracking-wider border border-indigo-200/40 hover:bg-indigo-50 px-2.5 py-1 rounded-md transition-all shadow-sm bg-white cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      {/* [FUNC-GMAIL-28] Premium Extraction Progress Tracker Widget */}
      {extractionProgress && extractionProgress.status !== 'idle' && (
        <div 
          data-testid="extraction-progress-widget"
          className="bg-gradient-to-r from-purple-50/70 to-indigo-50/70 border border-purple-100/50 backdrop-blur-md rounded-2xl p-5 shadow-sm space-y-3 animate-fade-in relative overflow-hidden"
        >
          {/* Subtle micro-animation backdrop glow */}
          <div className="absolute top-0 right-0 -mt-6 -mr-6 w-24 h-24 bg-purple-400/10 rounded-full blur-xl animate-pulse"></div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {extractionProgress.status === 'started' || extractionProgress.status === 'extracting' ? (
                <div className="flex space-x-1">
                  <span className="w-2.5 h-2.5 bg-purple-600 rounded-full animate-bounce"></span>
                  <span className="w-2.5 h-2.5 bg-purple-600 rounded-full animate-bounce delay-100"></span>
                  <span className="w-2.5 h-2.5 bg-purple-600 rounded-full animate-bounce delay-200"></span>
                </div>
              ) : extractionProgress.status === 'completed' ? (
                <span className="text-lg">✅</span>
              ) : (
                <span className="text-lg">❌</span>
              )}
              <h4 className="text-xs font-bold uppercase tracking-wider text-purple-900">
                {extractionProgress.status === 'started' && 'Initializing Ollama LLM Extraction...'}
                {extractionProgress.status === 'extracting' && `Extracting transaction details (${extractionProgress.current} of ${extractionProgress.total})`}
                {extractionProgress.status === 'completed' && 'Extraction Completed Successfully!'}
                {extractionProgress.status === 'error' && 'Extraction Failed'}
              </h4>
            </div>
            {extractionProgress.status === 'extracting' && (
              <span className="text-xs font-extrabold text-purple-700 whitespace-nowrap bg-purple-100/60 px-2 py-0.5 rounded-md">
                {Math.round((extractionProgress.current / extractionProgress.total) * 100)}%
              </span>
            )}
          </div>

          {extractionProgress.status === 'extracting' && extractionProgress.currentSubject && (
            <p className="text-xs text-gray-500 font-medium truncate max-w-lg">
              <span className="font-bold text-purple-400/80 uppercase text-[10px] tracking-wider block">Current Email</span>
              {extractionProgress.currentSubject}
            </p>
          )}

          {extractionProgress.status === 'completed' && (
            <p className="text-xs text-emerald-700 font-bold uppercase tracking-wider">
              🎉 Successfully processed and extracted {extractionProgress.total} email(s) into your Silver layer.
            </p>
          )}

          {/* Progress Bar Container */}
          {(extractionProgress.status === 'extracting' || extractionProgress.status === 'completed') && (
            <div className="w-full bg-purple-100/30 h-2.5 rounded-full overflow-hidden border border-purple-200/20">
              <div 
                className="bg-gradient-to-r from-purple-600 to-indigo-500 h-full rounded-full transition-all duration-300 ease-out shadow-sm"
                style={{ width: `${extractionProgress.total > 0 ? (extractionProgress.current / extractionProgress.total) * 100 : 0}%` }}
              ></div>
            </div>
          )}

          {extractionProgress.status === 'completed' && (
            <div className="pt-1 flex justify-end">
              <button 
                onClick={() => setExtractionProgress({ status: 'idle', current: 0, total: 0 })}
                className="text-[10px] font-bold text-purple-600 hover:text-purple-800 uppercase tracking-wider border border-purple-200/40 hover:bg-purple-50 px-2.5 py-1 rounded-md transition-all shadow-sm bg-white cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Tab bar (Medallion Layers) */}
      <div className="flex flex-wrap border border-gray-100 bg-white rounded-xl p-1.5 shadow-sm gap-2">
        <button
          onClick={() => setActiveTab('bronze')}
          className={`flex items-center px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
            isBronzeActive 
              ? 'bg-amber-50 text-amber-900 border border-amber-200/50 shadow-sm' 
              : 'text-gray-500 hover:bg-gray-50 border border-transparent'
          }`}
        >
          <span className={`w-2.5 h-2.5 rounded-full mr-2 ${isBronzeActive ? 'bg-amber-500 shadow-sm shadow-amber-400/50' : 'bg-amber-300'}`}></span>
          Bronze (Raw Emails)
        </button>
        <button
          onClick={() => setActiveTab('silver')}
          className={`flex items-center px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
            activeTab === 'silver' 
              ? 'bg-indigo-50 text-indigo-900 border border-indigo-200/50 shadow-sm' 
              : 'text-gray-500 hover:bg-gray-50 border border-transparent'
          }`}
        >
          <span className={`w-2.5 h-2.5 rounded-full mr-2 ${activeTab === 'silver' ? 'bg-indigo-500 shadow-sm shadow-indigo-400/50' : 'bg-indigo-300'}`}></span>
          Silver (Staging Queue)
        </button>
        <button
          onClick={() => setActiveTab('gold')}
          className={`flex items-center px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
            activeTab === 'gold' 
              ? 'bg-emerald-50 text-emerald-950 border border-emerald-200/50 shadow-sm' 
              : 'text-gray-500 hover:bg-gray-50 border border-transparent'
          }`}
        >
          <span className={`w-2.5 h-2.5 rounded-full mr-2 ${activeTab === 'gold' ? 'bg-emerald-500 shadow-sm shadow-emerald-400/50' : 'bg-emerald-300'}`}></span>
          Gold (Confirmed Ledger)
        </button>
        <button
          onClick={() => setActiveTab('trash')}
          className={`flex items-center px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
            activeTab === 'trash' 
              ? 'bg-rose-50 text-rose-900 border border-rose-200/50 shadow-sm' 
              : 'text-gray-500 hover:bg-gray-50 border border-transparent'
          }`}
          data-testid="trash-tab-btn"
        >
          <span className={`w-2.5 h-2.5 rounded-full mr-2 ${activeTab === 'trash' ? 'bg-rose-500 shadow-sm shadow-rose-400/50' : 'bg-rose-300'}`}></span>
          Trash Bin
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 items-start">
        {isBronzeActive && (
          <div className="xl:col-span-1 space-y-4">
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
            
            <button 
              onClick={handleFetchClick}
              disabled={isFetching}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-xs font-bold py-3 rounded-xl shadow-md hover:shadow-lg transition-all uppercase tracking-wider cursor-pointer text-center"
            >
              {isFetching ? 'Processing...' : 'Authorize & Fetch'}
            </button>
          </div>
        )}

        <div className={`${isBronzeActive ? 'xl:col-span-4' : 'xl:col-span-5 w-full'} bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm`}>
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
              onDeleteClick={handleBronzeDeleteClick}
              startDate={startDate}
              setStartDate={setStartDate}
              endDate={endDate}
              setEndDate={setEndDate}
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
              onDeleteClick={handleSilverDeleteClick}
              startDate={startDate}
              setStartDate={setStartDate}
              endDate={endDate}
              setEndDate={setEndDate}
            />
          )}

          {activeTab === 'gold' && (
            <GoldLedgerList
              goldTransactions={goldTransactions}
              setSelectedGoldTransaction={setSelectedGoldTransaction}
              onDeleteClick={handleGoldDeleteClick}
              startDate={startDate}
              setStartDate={setStartDate}
              endDate={endDate}
              setEndDate={setEndDate}
            />
          )}

          {activeTab === 'trash' && (
            <div className="space-y-8 p-5">
              {/* Trash Bin Header */}
              <div className="border-b border-gray-100 pb-3 flex justify-between items-center bg-gray-50/70 -mx-5 -mt-5 px-5 py-3">
                <span className="text-xs font-bold text-rose-700 uppercase tracking-wider">Recycle Bin / Soft-Deleted Records</span>
                <button
                  onClick={() => loadDeletedLayers()}
                  className="bg-gray-100 hover:bg-gray-200 border border-gray-250/30 text-gray-700 text-[10px] font-bold px-3 py-1 rounded-lg uppercase tracking-wider cursor-pointer transition-colors shadow-sm"
                >
                  🔄 Refresh Trash
                </button>
              </div>

              {/* Deleted Bronze Emails */}
              <div className="border border-gray-100 rounded-xl overflow-hidden shadow-sm bg-white">
                <div className="bg-gray-50/50 px-4 py-2.5 border-b border-gray-100 flex justify-between items-center">
                  <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">Bronze: Deleted Raw Emails ({deletedRawEmails.length})</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-100 text-xs">
                    <thead className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      <tr>
                        <th className="px-3 py-2 text-left">Sender</th>
                        <th className="px-3 py-2 text-left">Subject</th>
                        <th className="px-3 py-2 text-left">Deleted At</th>
                        <th className="px-3 py-2 text-center w-24">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 bg-white">
                      {deletedRawEmails.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-3 py-8 text-center text-gray-400 font-bold uppercase tracking-wider text-[10px]">No deleted raw emails</td>
                        </tr>
                      ) : (
                        deletedRawEmails.map(email => (
                          <tr key={email.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="px-3 py-2 text-gray-700 font-bold max-w-[120px] truncate" title={email.sender}>{email.sender.split('<')[0].trim()}</td>
                            <td className="px-3 py-2 text-gray-900 font-semibold max-w-[200px] truncate" title={email.subject}>{email.subject}</td>
                            <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{email.deletedAt ? new Date(email.deletedAt).toLocaleString() : 'Unknown'}</td>
                            <td className="px-3 py-2 text-center whitespace-nowrap">
                              <button
                                onClick={() => restoreRecords(email.id, undefined, undefined, ['bronze'])}
                                className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2.5 py-1 border border-emerald-200/50 rounded-lg uppercase tracking-wider cursor-pointer transition-colors shadow-sm animate-fade-in"
                                data-testid={`restore-bronze-${email.id}`}
                              >
                                Restore
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Deleted Silver Transactions */}
              <div className="border border-gray-100 rounded-xl overflow-hidden shadow-sm bg-white">
                <div className="bg-gray-50/50 px-4 py-2.5 border-b border-gray-100 flex justify-between items-center">
                  <span className="text-xs font-bold text-indigo-800 uppercase tracking-wider">Silver: Deleted Staging Queue ({deletedSilverTransactions.length})</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-100 text-xs">
                    <thead className="bg-gray-55 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      <tr>
                        <th className="px-3 py-2 text-left">Date</th>
                        <th className="px-3 py-2 text-left">Merchant</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2 text-left">Deleted At</th>
                        <th className="px-3 py-2 text-center w-24">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 bg-white">
                      {deletedSilverTransactions.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-8 text-center text-gray-400 font-bold uppercase tracking-wider text-[10px]">No deleted staging transactions</td>
                        </tr>
                      ) : (
                        deletedSilverTransactions.map(tx => (
                          <tr key={tx.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{tx.transactionDate}</td>
                            <td className="px-3 py-2 text-gray-900 font-bold max-w-[150px] truncate" title={tx.merchantNormalized || tx.merchantRaw}>{tx.merchantNormalized || tx.merchantRaw}</td>
                            <td className="px-3 py-2 text-right font-extrabold text-gray-700 whitespace-nowrap">{tx.amount.toFixed(2)} {tx.currency}</td>
                            <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{tx.deletedAt ? new Date(tx.deletedAt).toLocaleString() : 'Unknown'}</td>
                            <td className="px-3 py-2 text-center whitespace-nowrap">
                              <button
                                onClick={() => restoreRecords(tx.rawEmailId, tx.id, undefined, ['silver'])}
                                className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2.5 py-1 border border-emerald-200/50 rounded-lg uppercase tracking-wider cursor-pointer transition-colors shadow-sm animate-fade-in"
                                data-testid={`restore-silver-${tx.id}`}
                              >
                                Restore
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Deleted Gold Transactions */}
              <div className="border border-gray-100 rounded-xl overflow-hidden shadow-sm bg-white">
                <div className="bg-gray-50/50 px-4 py-2.5 border-b border-gray-100 flex justify-between items-center">
                  <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Gold: Deleted Verified Ledger ({deletedGoldTransactions.length})</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-100 text-xs">
                    <thead className="bg-gray-55 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      <tr>
                        <th className="px-3 py-2 text-left">Date</th>
                        <th className="px-3 py-2 text-left">Merchant</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2 text-left">Deleted At</th>
                        <th className="px-3 py-2 text-center w-24">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 bg-white">
                      {deletedGoldTransactions.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-8 text-center text-gray-400 font-bold uppercase tracking-wider text-[10px]">No deleted verified transactions</td>
                        </tr>
                      ) : (
                        deletedGoldTransactions.map(tx => (
                          <tr key={tx.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{tx.transactionDate}</td>
                            <td className="px-3 py-2 text-gray-900 font-bold max-w-[150px] truncate" title={tx.merchant}>{tx.merchant}</td>
                            <td className="px-3 py-2 text-right font-extrabold text-emerald-600 whitespace-nowrap">{tx.amount.toFixed(2)} {tx.currency}</td>
                            <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{tx.deletedAt ? new Date(tx.deletedAt).toLocaleString() : 'Unknown'}</td>
                            <td className="px-3 py-2 text-center whitespace-nowrap">
                              <button
                                onClick={() => restoreRecords(tx.bronzeEmailId, tx.pendingTxId, tx.id, ['gold'])}
                                className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2.5 py-1 border border-emerald-200/50 rounded-lg uppercase tracking-wider cursor-pointer transition-colors shadow-sm animate-fade-in"
                                data-testid={`restore-gold-${tx.id}`}
                              >
                                Restore
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
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
        rawEmails={rawEmails}
        silverTransactions={silverTransactions}
        goldTransactions={goldTransactions}
        onDeleteClick={handleDeleteClick}
      />

      <DeleteConfirmationModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
        lineage={deleteLineage}
        sourceStage={deleteSourceStage}
      />
    </div>
  );
};

export default GmailIntegration;
