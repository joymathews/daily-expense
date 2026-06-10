import React, { useState } from 'react';
import { useGmailIntegration } from '../hooks/use-gmail-integration';
import type { GoldTransaction } from '../hooks/use-gmail-integration';
import { FilterPanel } from '../components/gmail/FilterPanel';
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
    emails, // compatibility
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
  const visibleRawEmails = rawEmails.filter(email => 
    bronzeSubTab === 'transaction' ? email.hasTransaction : !email.hasTransaction
  );

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
          
          {/* Bronze Inbox layout */}
          {isBronzeActive && (
            <div>
              <div className="border-b border-gray-100 bg-gray-50/50 flex justify-between items-center px-4">
                <div className="flex space-x-4">
                  <button
                    type="button"
                    onClick={() => setActiveTab('transaction')}
                    className={`py-2 px-1 text-[9px] font-black uppercase tracking-widest border-b-2 transition-all ${
                      bronzeSubTab === 'transaction'
                        ? 'border-orange-500 text-orange-600'
                        : 'border-transparent text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    Transactions
                    <span className={`ml-1.5 px-1.5 py-0.5 text-[8px] rounded-full font-bold ${
                      bronzeSubTab === 'transaction' ? 'bg-orange-100 text-orange-800' : 'bg-gray-200 text-gray-600'
                    }`}>
                      {rawEmails.filter(e => e.hasTransaction).length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('non-transaction')}
                    className={`py-2 px-1 text-[9px] font-black uppercase tracking-widest border-b-2 transition-all ${
                      bronzeSubTab === 'non-transaction'
                        ? 'border-orange-500 text-orange-600'
                        : 'border-transparent text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    Non-Transactional (For Review)
                    <span className={`ml-1.5 px-1.5 py-0.5 text-[8px] rounded-full font-bold ${
                      bronzeSubTab === 'non-transaction' ? 'bg-amber-100 text-amber-800' : 'bg-gray-200 text-gray-600'
                    }`}>
                      {rawEmails.filter(e => !e.hasTransaction).length}
                    </span>
                  </button>
                </div>
                
                {checkedEmailIds.length > 0 && (
                  <button
                    onClick={handleBatchExtract}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-[8px] font-black px-2.5 py-1 rounded transition-colors uppercase tracking-wider"
                  >
                    🚀 Extract Selected ({checkedEmailIds.length} Batch)
                  </button>
                )}
                <span className="text-[9px] font-black text-gray-300 uppercase">{visibleRawEmails.length} Items</span>
              </div>
              
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-gray-50 text-[8px] font-black text-gray-400 uppercase tracking-tighter">
                    <tr>
                      <th className="px-4 py-2 text-center w-8">
                        <input 
                          type="checkbox" 
                          checked={unprocessedEmails.length > 0 && unprocessedEmails.every(e => checkedEmailIds.includes(e.id))}
                          onChange={toggleSelectAll}
                          disabled={unprocessedEmails.length === 0}
                        />
                      </th>
                      <th className="px-4 py-2 text-left">Sender</th>
                      <th className="px-4 py-2 text-left">Subject / Details</th>
                      <th className="px-4 py-2 text-right">Date</th>
                      <th className="px-4 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {visibleRawEmails.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center">
                          <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">
                            {isLoading ? 'Scanning...' : 'No Data Fetch required'}
                          </p>
                        </td>
                      </tr>
                    ) : (
                      visibleRawEmails.map(email => (
                        <tr key={email.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-2 text-center">
                            <input 
                              type="checkbox" 
                              checked={checkedEmailIds.includes(email.id)}
                              onChange={() => toggleEmailCheck(email.id)}
                              disabled={isEmailProcessed(email)}
                              className={isEmailProcessed(email) ? "opacity-50 cursor-not-allowed" : ""}
                            />
                          </td>
                          <td onClick={() => setSelectedEmail(email)} className="px-4 py-2 whitespace-nowrap cursor-pointer">
                            <div className="text-[10px] font-bold text-gray-700">{email.sender.split('<')[0].trim()}</div>
                          </td>
                          <td onClick={() => setSelectedEmail(email)} className="px-4 py-2 cursor-pointer">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] font-bold text-gray-900 leading-tight">{email.subject}</span>
                              {isEmailProcessed(email) && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-green-50 text-green-700 border border-green-200">
                                  ✓ Processed
                                </span>
                              )}
                            </div>
                            <div className="text-[9px] text-gray-400 line-clamp-1 italic">{email.snippet}</div>
                          </td>
                          <td onClick={() => setSelectedEmail(email)} className="px-4 py-2 whitespace-nowrap text-right text-[9px] font-bold text-gray-400 uppercase cursor-pointer">
                            {new Date(email.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap text-center space-x-1">
                            {bronzeSubTab === 'non-transaction' ? (
                              <button
                                type="button"
                                onClick={() => markAsTransaction(email.id)}
                                className="bg-orange-50 hover:bg-orange-100 text-orange-600 text-[8px] font-bold px-1.5 py-0.5 border border-orange-100 rounded uppercase"
                              >
                                Mark Tx
                              </button>
                            ) : (
                              <>
                                {isEmailProcessed(email) ? (
                                  <>
                                    <button
                                      type="button"
                                      disabled
                                      className="bg-gray-50 text-gray-300 text-[8px] font-bold px-1.5 py-0.5 border border-gray-100 rounded uppercase cursor-not-allowed"
                                    >
                                      Unmark Tx
                                    </button>
                                    <button
                                      type="button"
                                      disabled
                                      className="bg-gray-100 text-gray-400 text-[8px] font-bold px-1.5 py-0.5 rounded border border-gray-200 uppercase cursor-not-allowed"
                                    >
                                      Processed
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => markAsNonTransaction(email.id)}
                                      className="bg-amber-50 hover:bg-amber-100 text-amber-600 text-[8px] font-bold px-1.5 py-0.5 border border-amber-100 rounded uppercase"
                                    >
                                      Unmark Tx
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => extractSelectedEmails([email.id])}
                                      className="bg-blue-600 hover:bg-blue-700 text-white text-[8px] font-bold px-1.5 py-0.5 rounded uppercase"
                                    >
                                      Extract
                                    </button>
                                  </>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Silver Staging view */}
          {activeTab === 'silver' && (
            <div>
              <div className="border-b border-gray-100 bg-gray-50/50 flex justify-between items-center px-4 py-2">
                <div className="flex items-center space-x-4">
                  <span className="text-[9px] font-black text-blue-600 uppercase tracking-wider">Silver Staging Table (Pending Approvals)</span>
                  {checkedSilverIds.length > 0 && (
                    <button
                      onClick={handleBatchApprove}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-[8px] font-black px-2.5 py-1 rounded transition-colors uppercase tracking-wider"
                    >
                      🚀 Approve Selected ({checkedSilverIds.length} Batch)
                    </button>
                  )}
                </div>
                <span className="text-[9px] font-black text-gray-300 uppercase">{silverTransactions.length} Pending Items</span>
              </div>
              
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-gray-50 text-[8px] font-black text-gray-400 uppercase tracking-tighter">
                    <tr>
                      <th className="px-4 py-2 text-center w-8">
                        <input 
                          type="checkbox" 
                          checked={silverTransactions.length > 0 && checkedSilverIds.length === silverTransactions.length}
                          onChange={toggleSelectAllSilver}
                        />
                      </th>
                      <th className="px-4 py-2 text-left">Extracted Merchant</th>
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                      <th className="px-4 py-2 text-center">Category</th>
                      <th className="px-4 py-2 text-center">Status</th>
                      <th className="px-4 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {silverTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center">
                          <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">No pending transactions in staging</p>
                        </td>
                      </tr>
                    ) : (
                      silverTransactions.map(tx => (
                        <tr key={tx.id} className="hover:bg-gray-50 transition-colors text-[10px]">
                          <td className="px-4 py-2 text-center">
                            <input 
                              type="checkbox" 
                              checked={checkedSilverIds.includes(tx.id)}
                              onChange={() => toggleSilverCheck(tx.id)}
                            />
                          </td>
                          <td className="px-4 py-2 font-bold text-gray-900">
                            {tx.merchantNormalized || tx.merchantRaw}
                            <span className="block text-[8px] font-normal text-gray-400 truncate max-w-xs">{tx.emailSubject || 'Source Raw Email'}</span>
                          </td>
                          <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{tx.transactionDate}</td>
                          <td className="px-4 py-2 font-bold text-right text-gray-800">{tx.amount.toFixed(2)} {tx.currency}</td>
                          <td className="px-4 py-2 text-center"><span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-bold uppercase text-[8px]">{tx.inferredCategory || 'Other'}</span></td>
                          <td className="px-4 py-2 text-center">
                            <span className={`px-1.5 py-0.5 rounded-full font-bold uppercase text-[8px] ${
                              tx.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                            }`}>
                              {tx.status}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-center">
                            <button
                              onClick={() => handleReviewSilver(tx)}
                              className="bg-blue-600 hover:bg-blue-700 text-white text-[8px] font-bold px-2 py-1 rounded uppercase tracking-wider"
                            >
                              Review & Approve
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Gold Ledger view */}
          {activeTab === 'gold' && (
            <div>
              <div className="border-b border-gray-100 bg-gray-50/50 flex justify-between items-center px-4 py-2">
                <span className="text-[9px] font-black text-emerald-600 uppercase tracking-wider">Gold Verified Transactions (Double-Entry Ledger)</span>
                <span className="text-[9px] font-black text-gray-300 uppercase">{goldTransactions.length} Verified Items</span>
              </div>
              
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-gray-50 text-[8px] font-black text-gray-400 uppercase tracking-tighter">
                    <tr>
                      <th className="px-4 py-2 text-left">Ledger Merchant</th>
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                      <th className="px-4 py-2 text-center">Category</th>
                      <th className="px-4 py-2 text-left">Lineage / Comments</th>
                      <th className="px-4 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {goldTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center">
                          <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">No validated ledger items found</p>
                        </td>
                      </tr>
                    ) : (
                      goldTransactions.map(tx => (
                        <tr key={tx.id} className="hover:bg-gray-50 transition-colors text-[10px]">
                          <td className="px-4 py-2 font-bold text-gray-900">{tx.merchant}</td>
                          <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{tx.transactionDate}</td>
                          <td className="px-4 py-2 font-black text-right text-emerald-600">{tx.amount.toFixed(2)} {tx.currency}</td>
                          <td className="px-4 py-2 text-center"><span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-bold uppercase text-[8px]">{tx.category}</span></td>
                          <td className="px-4 py-2 text-left">
                            <span className="text-[8px] text-blue-600 font-bold block uppercase tracking-tight truncate max-w-xs" title={tx.emailSubject}>
                              🔗 Email: {tx.emailSubject || 'Linked source raw receipt'}
                            </span>
                            <span className="text-[9px] text-gray-400 italic block">{tx.notes || 'No comments'}</span>
                          </td>
                          <td className="px-4 py-2 text-center">
                            <button
                              onClick={() => setSelectedGoldTransaction(tx)}
                              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[8px] font-black px-2.5 py-1 border border-emerald-200 rounded uppercase tracking-wider"
                            >
                              Correct Ledger
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
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
      />
    </div>
  );
};

export default GmailIntegration;
