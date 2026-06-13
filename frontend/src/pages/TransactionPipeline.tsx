import React, { useState } from 'react';
import { useGmailIntegration } from '../hooks/use-gmail-integration';
import type { GoldTransaction } from '../hooks/use-gmail-integration';
import { EmailDetailModal } from '../components/gmail/EmailDetailModal';
import { BronzeEmailList } from '../components/gmail/BronzeEmailList';
import { SilverStagingList } from '../components/gmail/SilverStagingList';
import { GoldLedgerList } from '../components/gmail/GoldLedgerList';
import { DeleteConfirmationModal } from '../components/gmail/DeleteConfirmationModal';

const TransactionPipeline: React.FC = () => {
  const {
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    rawEmails,
    silverTransactions,
    goldTransactions,
    deletedRawEmails,
    deletedSilverTransactions,
    deletedGoldTransactions,
    isLoading,
    activeTab,
    setActiveTab,
    selectedEmail,
    setSelectedEmail,
    markAsTransaction,
    markAsNonTransaction,
    extractSelectedEmails,
    updateSilverTransaction,
    updateGoldTransaction,
    approveTransaction,
    approveTransactionsBatch,
    extractionProgress,
    setExtractionProgress,
    revertOrDeleteRecord,
    restoreBronzeEmail,
    restoreGoldTransaction,
    loadDeletedLayers,
    paymentMethods,
    rejectBronzeInput,
    rejectBronzeInputsBatch,
    updateBronzeStatus,
  } = useGmailIntegration();

  console.log('DEBUG: rawEmails length =', rawEmails.length, 'rawEmails =', rawEmails);

  // Multi-select state for Bronze batch extraction
  const [checkedEmailIds, setCheckedEmailIds] = useState<string[]>([]);

  // Multi-select state for Silver batch approval
  const [checkedSilverIds, setCheckedSilverIds] = useState<string[]>([]);
  
  // Local Gold transaction state for modal editing
  const [selectedGoldTransaction, setSelectedGoldTransaction] = useState<GoldTransaction | null>(null);

  // Ingestion status filtering for Bronze section
  const [bronzeFilter, setBronzeFilter] = useState<'all' | 'processed' | 'unprocessed' | 'rejected'>('all');

  // Delete modal trigger states
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteLineage, setDeleteLineage] = useState<{ bronzeId?: string; silverId?: string; goldId?: string }>({});
  const [deleteSourceStage, setDeleteSourceStage] = useState<'bronze' | 'silver' | 'gold'>('bronze');
  const [isDeleteManual, setIsDeleteManual] = useState(false);

  const handleDeleteClick = (
    stage: 'bronze' | 'silver' | 'gold',
    lineage: { bronzeId?: string; silverId?: string; goldId?: string }
  ) => {
    setSelectedEmail(null);
    setSelectedGoldTransaction(null);
    setDeleteLineage(lineage);
    setDeleteSourceStage(stage);
    
    // Check if the record being deleted is a manual Gold transaction
    const isManualGold = stage === 'gold' && !!lineage.goldId && 
      goldTransactions.some(g => g.id === lineage.goldId && g.sourceType === 'manual');
      
    setIsDeleteManual(isManualGold);
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

  const handleConfirmDelete = async () => {
    setIsDeleteModalOpen(false);
    await revertOrDeleteRecord(deleteSourceStage, {
      bronzeId: deleteLineage.bronzeId,
      silverId: deleteLineage.silverId,
      goldId: deleteLineage.goldId,
    });
  };

  // Manage Bronze layer sub-tabs (compatibility with Vitest tests)
  const isBronzeActive = activeTab === 'bronze' || activeTab === 'transaction' || activeTab === 'non-transaction';
  const bronzeSubTab = (activeTab === 'non-transaction') ? 'non-transaction' : 'transaction';

  // Helper to determine if an email has already been processed
  const isEmailProcessed = (email: typeof rawEmails[0]) => {
    if (email.status === 'processed' || email.status === 'rejected') return true;
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
      return email.status === 'processed' || (email.status !== 'rejected' && isEmailProcessed(email));
    } else if (bronzeFilter === 'unprocessed') {
      return email.status === 'unprocessed' || (!email.status && !isEmailProcessed(email));
    } else if (bronzeFilter === 'rejected') {
      return email.status === 'rejected';
    }
    return true;
  });

  const unprocessedEmails = visibleRawEmails.filter(e => e.status === 'unprocessed' || (!e.status && !isEmailProcessed(e)));

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

  const handleBatchReject = async () => {
    if (checkedEmailIds.length === 0) return;
    await rejectBronzeInputsBatch(checkedEmailIds);
    setCheckedEmailIds([]);
  };

  const toggleSilverCheck = (id: string) => {
    setCheckedSilverIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAllSilver = () => {
    const selectables = silverTransactions.filter(t => t.status !== 'error' && t.status !== 'approved' && t.status !== 'rejected');
    if (checkedSilverIds.length === selectables.length) {
      setCheckedSilverIds([]);
    } else {
      setCheckedSilverIds(selectables.map(t => t.id));
    }
  };

  const handleBatchApprove = async () => {
    if (checkedSilverIds.length === 0) return;
    await approveTransactionsBatch(checkedSilverIds);
    setCheckedSilverIds([]);
  };

  const handleReviewSilver = async (silverTx: any) => {
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
      setSelectedEmail({
        id: silverTx.bronzeInputId,
        sender: silverTx.sourceSender || 'Direct',
        subject: silverTx.sourceTitle || silverTx.merchantRaw,
        date: silverTx.sourceReceivedAt || silverTx.transactionDate,
        snippet: 'Manual or external raw data staging record',
        body: 'Details directly stage loaded',
        hasTransaction: true,
        sourceType: silverTx.sourceType,
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
  };

  return (
    <div className="w-full max-w-7xl space-y-8 animate-fade-in px-4">
      {/* Page Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-100 pb-5 gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 Outfit sm:text-3xl">
            Medallion Transaction Pipeline
          </h1>
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 mt-1">
            Data Lake (Bronze) ➔ Analytics Staging (Silver) ➔ Verified Ledger (Gold)
          </p>
        </div>
      </div>

      {/* Extraction progress tracker widget */}
      {extractionProgress && extractionProgress.status !== 'idle' && (
        <div 
          data-testid="extraction-progress-widget"
          className="bg-gradient-to-r from-purple-50/70 to-indigo-50/70 border border-purple-100/50 backdrop-blur-md rounded-2xl p-5 shadow-sm space-y-3 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 -mt-6 -mr-6 w-24 h-24 bg-purple-400/10 rounded-full blur-xl animate-pulse"></div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {extractionProgress.status === 'started' || extractionProgress.status === 'extracting' ? (
                <div className="flex space-x-1">
                  <span className="w-2.5 h-2.5 bg-purple-650 rounded-full animate-bounce"></span>
                  <span className="w-2.5 h-2.5 bg-purple-650 rounded-full animate-bounce delay-100"></span>
                  <span className="w-2.5 h-2.5 bg-purple-650 rounded-full animate-bounce delay-200"></span>
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
              <span className="text-xs font-extrabold text-purple-705 whitespace-nowrap bg-purple-100/60 px-2 py-0.5 rounded-md">
                {Math.round((extractionProgress.current / extractionProgress.total) * 100)}%
              </span>
            )}
          </div>

          {extractionProgress.status === 'extracting' && extractionProgress.currentSubject && (
            <p className="text-xs text-gray-500 font-medium truncate max-w-lg">
              <span className="font-bold text-purple-400/80 uppercase text-[10px] tracking-wider block">Current Record</span>
              {extractionProgress.currentSubject}
            </p>
          )}

          {extractionProgress.status === 'completed' && (
            <p className="text-xs text-emerald-705 font-bold uppercase tracking-wider">
              🎉 Successfully processed and extracted {extractionProgress.total} record(s) into your Silver layer.
            </p>
          )}

          {/* Progress bar */}
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
                className="text-[10px] font-bold text-purple-600 hover:text-purple-850 uppercase tracking-wider border border-purple-200/40 hover:bg-purple-50 px-2.5 py-1 rounded-md transition-all shadow-sm bg-white cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Tab bar (Medallion Layers) */}
      <div className="w-full flex flex-wrap border border-gray-150/60 bg-white rounded-2xl p-1.5 shadow-sm gap-2">
        <button
          onClick={() => setActiveTab('bronze')}
          className={`flex items-center px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
            isBronzeActive 
              ? 'bg-amber-50 text-amber-900 border border-amber-200/50 shadow-sm' 
              : 'text-gray-500 hover:bg-gray-50/55 border border-transparent'
          }`}
        >
          <span className={`w-2 h-2 rounded-full mr-2 ${isBronzeActive ? 'bg-amber-500 shadow-sm' : 'bg-amber-300'}`}></span>
          Bronze (Raw Inputs)
        </button>
        <button
          onClick={() => setActiveTab('silver')}
          className={`flex items-center px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
            activeTab === 'silver' 
              ? 'bg-indigo-50 text-indigo-900 border border-indigo-200/50 shadow-sm' 
              : 'text-gray-500 hover:bg-gray-50/55 border border-transparent'
          }`}
        >
          <span className={`w-2 h-2 rounded-full mr-2 ${activeTab === 'silver' ? 'bg-indigo-500 shadow-sm' : 'bg-indigo-300'}`}></span>
          Silver (Staging Queue)
        </button>
        <button
          onClick={() => setActiveTab('gold')}
          className={`flex items-center px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
            activeTab === 'gold' 
              ? 'bg-emerald-50 text-emerald-950 border border-emerald-200/50 shadow-sm' 
              : 'text-gray-500 hover:bg-gray-50/55 border border-transparent'
          }`}
        >
          <span className={`w-2 h-2 rounded-full mr-2 ${activeTab === 'gold' ? 'bg-emerald-500 shadow-sm' : 'bg-emerald-300'}`}></span>
          Gold (Confirmed Ledger)
        </button>
        <button
          onClick={() => setActiveTab('trash')}
          className={`flex items-center px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
            activeTab === 'trash' 
              ? 'bg-rose-50 text-rose-900 border border-rose-200/50 shadow-sm' 
              : 'text-gray-500 hover:bg-gray-50/55 border border-transparent'
          }`}
          data-testid="trash-tab-btn"
        >
          <span className={`w-2 h-2 rounded-full mr-2 ${activeTab === 'trash' ? 'bg-rose-500 shadow-sm' : 'bg-rose-300'}`}></span>
          Trash Bin
        </button>
      </div>

      {/* Main lists view card */}
      <div className="w-full bg-white border border-gray-150/60 rounded-3xl overflow-hidden shadow-sm">
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
            handleBatchReject={handleBatchReject}
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
            rejectBronzeInput={rejectBronzeInput}
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
          <div className="space-y-8 p-6">
            <div className="border-b border-gray-100 pb-3 flex justify-between items-center bg-gray-50/50 -mx-6 -mt-6 px-6 py-4">
              <span className="text-xs font-bold text-rose-700 uppercase tracking-wider">Recycle Bin / Soft-Deleted Records</span>
              <button
                onClick={() => loadDeletedLayers()}
                className="bg-gray-100 hover:bg-gray-200 border border-gray-250/20 text-gray-700 text-[10px] font-bold px-3 py-1.5 rounded-lg uppercase tracking-wider cursor-pointer transition-colors shadow-sm"
              >
                🔄 Refresh Trash
              </button>
            </div>

            {/* Deleted Bronze inputs */}
            <div className="border border-gray-100 rounded-2xl overflow-hidden shadow-sm bg-white">
              <div className="bg-gray-50/50 px-4 py-2.5 border-b border-gray-100 flex justify-between items-center">
                <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">Bronze: Deleted Raw Inputs ({deletedRawEmails.length})</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100 text-xs">
                  <thead className="bg-gray-50 font-bold text-gray-400 uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="px-4 py-3 text-left">Sender / Source</th>
                      <th className="px-4 py-3 text-left">Title</th>
                      <th className="px-4 py-3 text-left">Received At</th>
                      <th className="px-4 py-3 text-left">Deleted At</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 bg-white">
                    {deletedRawEmails.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-gray-400 font-medium">No deleted raw inputs</td>
                      </tr>
                    ) : (
                      deletedRawEmails.map(email => (
                        <tr key={email.id} className="hover:bg-gray-50/30">
                          <td className="px-4 py-3 font-semibold text-gray-800">{email.sender}</td>
                          <td className="px-4 py-3 text-gray-600 truncate max-w-xs">{email.subject}</td>
                          <td className="px-4 py-3 text-gray-555">{email.date}</td>
                          <td className="px-4 py-3 text-rose-500 font-medium">{email.deletedAt}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => restoreBronzeEmail(email.id)}
                              data-testid={`restore-bronze-${email.id}`}
                              className="text-[10px] font-bold text-indigo-650 hover:text-indigo-850 uppercase tracking-wider bg-indigo-50 hover:bg-indigo-100/70 border border-indigo-100/40 px-2.5 py-1 rounded-md transition-colors cursor-pointer"
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

            {/* Deleted Gold manual transactions */}
            <div className="border border-gray-100 rounded-2xl overflow-hidden shadow-sm bg-white mt-6">
              <div className="bg-gray-50/50 px-4 py-2.5 border-b border-gray-100 flex justify-between items-center">
                <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Gold: Deleted Manual Transactions ({deletedGoldTransactions.length})</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100 text-xs">
                  <thead className="bg-gray-50 font-bold text-gray-400 uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="px-4 py-3 text-left">Merchant</th>
                      <th className="px-4 py-3 text-left">Amount</th>
                      <th className="px-4 py-3 text-left">Category</th>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">Deleted At</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 bg-white">
                    {deletedGoldTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-gray-400 font-medium">No deleted manual transactions</td>
                      </tr>
                    ) : (
                      deletedGoldTransactions.map(tx => (
                        <tr key={tx.id} className="hover:bg-gray-50/30">
                          <td className="px-4 py-3 font-semibold text-gray-800">{tx.merchant}</td>
                          <td className="px-4 py-3 text-gray-650 font-semibold">{tx.amount.toFixed(2)} {tx.currency}</td>
                          <td className="px-4 py-3 text-gray-555">{tx.category}</td>
                          <td className="px-4 py-3 text-gray-555">{tx.transactionDate}</td>
                          <td className="px-4 py-3 text-rose-500 font-medium">{tx.deletedAt}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => restoreGoldTransaction(tx.id)}
                              data-testid={`restore-gold-${tx.id}`}
                              className="text-[10px] font-bold text-indigo-650 hover:text-indigo-850 uppercase tracking-wider bg-indigo-50 hover:bg-indigo-100/70 border border-indigo-100/40 px-2.5 py-1 rounded-md transition-colors cursor-pointer"
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

      <EmailDetailModal
        selectedEmail={selectedEmail}
        setSelectedEmail={setSelectedEmail}
        markAsTransaction={markAsTransaction}
        markAsNonTransaction={markAsNonTransaction}
        approveTransaction={approveTransaction}
        selectedGoldTransaction={selectedGoldTransaction}
        setSelectedGoldTransaction={setSelectedGoldTransaction}
        updateGoldTransaction={updateGoldTransaction}
        updateSilverTransaction={updateSilverTransaction}
        rawEmails={rawEmails}
        silverTransactions={silverTransactions}
        goldTransactions={goldTransactions}
        onDeleteClick={handleDeleteClick}
        extractSelectedEmails={extractSelectedEmails}
        paymentMethods={paymentMethods}
        rejectBronzeInput={rejectBronzeInput}
        updateBronzeStatus={updateBronzeStatus}
      />

      <DeleteConfirmationModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
        lineage={deleteLineage}
        sourceStage={deleteSourceStage}
        isManual={isDeleteManual}
      />
    </div>
  );
};

export default TransactionPipeline;
