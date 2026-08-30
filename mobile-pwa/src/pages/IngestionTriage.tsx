import React, { useState, useEffect } from 'react';
import { getApiUrl, getAuthHeaders } from '../api-config';
import { formatDate } from '@daily-expense/financial-core';
import { useGoogleLogin } from '@react-oauth/google';

interface RawInputEmail {
  id: string;
  sender: string;
  title: string;
  snippet: string;
  rawBody: string;
  receivedAt: string;
  status?: string;
  hasTransaction?: boolean;
}

interface SilverTransaction {
  id: string;
  bronzeInputId: string;
  merchantRaw?: string;
  merchantNormalized?: string;
  amount: number;
  currency: string;
  transactionDate: string;
  inferredCategory?: string;
  paymentMethod?: string;
  transactionType?: 'expense' | 'refund' | 'transfer' | 'fixed';
  sourceTitle?: string;
  sourceSender?: string;
  sourceReceivedAt?: string;
}

const formatDateTime = (isoString?: string): string => {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoString;
  }
};

export const IngestionTriage: React.FC = () => {
  // Fetch Config state
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const [isFetchDrawerOpen, setIsFetchDrawerOpen] = useState<boolean>(false);

  // Queue state
  const [rawEmails, setRawEmails] = useState<RawInputEmail[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [extractStatusMessage, setExtractStatusMessage] = useState<string | null>(null);
  const [extractErrorMessage, setExtractErrorMessage] = useState<string | null>(null);

  // Silver verification queue
  const [silverQueue, setSilverQueue] = useState<SilverTransaction[]>([]);
  const [silverIndex, setSilverIndex] = useState<number>(0);
  const [activeSilver, setActiveSilver] = useState<SilverTransaction | null>(null);
  const [showSourceModal, setShowSourceModal] = useState<boolean>(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  // Multi-Sender Pill State
  const [savedSenderSuggestions, setSavedSenderSuggestions] = useState<string[]>([]);
  const [selectedSenders, setSelectedSenders] = useState<string[]>([]);
  const [isAddingCustomSender, setIsAddingCustomSender] = useState<boolean>(false);
  const [customSenderInput, setCustomSenderInput] = useState<string>('');
  const [isDeckComplete, setIsDeckComplete] = useState<boolean>(false);
  const [rejectedIds, setRejectedIds] = useState<string[]>([]);
  const [expandedRejectedList, setExpandedRejectedList] = useState<boolean>(true);

  const STANDARD_CATEGORIES = [
    'Food & Dining',
    'Shopping',
    'Groceries',
    'Bills & Utilities',
    'Entertainment',
    'Travel & Commute',
    'Healthcare',
    'Investments',
    'Other',
  ];
  const [categorySuggestions, setCategorySuggestions] = useState<string[]>(STANDARD_CATEGORIES);
  const [isCustomCategory, setIsCustomCategory] = useState<boolean>(false);
  const [customCategoryInput, setCustomCategoryInput] = useState<string>('');

  const STANDARD_PAYMENT_METHODS = [
    'Credit Card',
    'HDFC Credit Card',
    'ICICI Credit Card',
    'UPI',
    'Debit Card',
    'Cash',
    'Net Banking',
  ];
  const [paymentMethodSuggestions, setPaymentMethodSuggestions] = useState<string[]>(STANDARD_PAYMENT_METHODS);
  const [isCustomPaymentMethod, setIsCustomPaymentMethod] = useState<boolean>(false);
  const [customPaymentMethodInput, setCustomPaymentMethodInput] = useState<string>('');

  // Initialize dates: default to 1 day before today (start) and 1 day after today (end)
  useEffect(() => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000);
    const tomorrow = new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000);
    const start = yesterday.toISOString().split('T')[0];
    const end = tomorrow.toISOString().split('T')[0];
    setStartDate(start);
    setEndDate(end);

    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    try {
      const headers = await getAuthHeaders();
      const [rawRes, senderRes, silverRes, goldRes, pmRes] = await Promise.allSettled([
        fetch(getApiUrl('/api/pipeline/raw-inputs'), { headers }).then((r) => r.json()),
        fetch(getApiUrl('/api/ingestion/fetcher-emails'), { headers }).then((r) => r.json()),
        fetch(getApiUrl('/api/pipeline/silver-transactions'), { headers }).then((r) => r.json()),
        fetch(getApiUrl('/api/pipeline/gold-transactions'), { headers }).then((r) => r.json()),
        fetch(getApiUrl('/api/ingestion/payment-methods'), { headers }).then((r) => r.json()),
      ]);

      // 1. Process Senders
      if (senderRes.status === 'fulfilled') {
        const val = senderRes.value;
        const senders: string[] = Array.isArray(val?.fetcherEmails)
          ? val.fetcherEmails
          : Array.isArray(val?.emails)
          ? val.emails
          : [];
        setSavedSenderSuggestions(senders);
        // Pre-select ALL saved senders by default
        setSelectedSenders(senders);
      }

      // 2. Extract & Merge Dynamic DB Categories & Payment Methods
      const customCats = new Set<string>(STANDARD_CATEGORIES);
      const customPms = new Set<string>(STANDARD_PAYMENT_METHODS);

      if (pmRes.status === 'fulfilled' && Array.isArray(pmRes.value?.paymentMethods)) {
        pmRes.value.paymentMethods.forEach((pm: any) => {
          const name = typeof pm === 'string' ? pm : pm.name;
          if (name?.trim()) customPms.add(name.trim());
        });
      }

      if (goldRes.status === 'fulfilled' && Array.isArray(goldRes.value?.transactions)) {
        goldRes.value.transactions.forEach((tx: any) => {
          if (tx.inferredCategory?.trim()) customCats.add(tx.inferredCategory.trim());
          if (tx.category?.trim()) customCats.add(tx.category.trim());
          if (tx.paymentMethod?.trim()) customPms.add(tx.paymentMethod.trim());
        });
      }
      if (silverRes.status === 'fulfilled' && Array.isArray(silverRes.value?.transactions)) {
        silverRes.value.transactions.forEach((tx: any) => {
          if (tx.inferredCategory?.trim()) customCats.add(tx.inferredCategory.trim());
          if (tx.paymentMethod?.trim()) customPms.add(tx.paymentMethod.trim());
        });
      }
      setCategorySuggestions(Array.from(customCats));
      setPaymentMethodSuggestions(Array.from(customPms));

      // 3. Process Pending Silver Transactions (Resume Silver review directly if pending items exist)
      let hasPendingSilver = false;
      if (silverRes.status === 'fulfilled' && Array.isArray(silverRes.value?.transactions)) {
        const pendingSilverList: SilverTransaction[] = silverRes.value.transactions
          .filter((tx: any) => tx.status === 'pending' || !tx.status)
          .map((tx: any) => ({
            id: tx.id,
            bronzeInputId: tx.bronzeInputId || '',
            merchantRaw: tx.merchantRaw || tx.merchantNormalized || 'Merchant',
            merchantNormalized: tx.merchantNormalized || tx.merchantRaw || 'Merchant',
            amount: tx.amount || 0,
            currency: tx.currency || 'INR',
            transactionDate: tx.transactionDate || '',
            inferredCategory: tx.inferredCategory || 'Other',
            paymentMethod: tx.paymentMethod || 'Credit Card',
            transactionType: tx.transactionType || 'expense',
            sourceTitle: tx.sourceTitle,
            sourceSender: tx.sourceSender,
            sourceReceivedAt: tx.sourceReceivedAt,
          }));

        if (pendingSilverList.length > 0) {
          hasPendingSilver = true;
          setSilverQueue(pendingSilverList);
          setSilverIndex(0);
          setActiveSilver(pendingSilverList[0]);
          setRawEmails([]);
        }
      }

      // 4. Process Raw Bronze Emails (only if not already in Silver review)
      if (!hasPendingSilver && rawRes.status === 'fulfilled') {
        const emails = rawRes.value?.emails || [];
        const unprocessed = emails.filter((e: RawInputEmail) => e.status !== 'processed' && e.status !== 'rejected');
        setRawEmails(unprocessed);
      }

      // Proactively wake up cloud AI extraction microservice in background while user reviews cards
      fetch(getApiUrl('/api/pipeline/llm-status'), { headers }).catch(() => {
        // Silent background wake-up probe
      });
    } catch (_err) {
      // Handled gracefully
    }
  };

  const toggleSender = (email: string) => {
    setSelectedSenders((prev) =>
      prev.includes(email) ? prev.filter((s) => s !== email) : [...prev, email]
    );
  };

  const handleAddCustomSender = () => {
    const trimmed = customSenderInput.trim();
    if (!trimmed) return;
    if (!savedSenderSuggestions.includes(trimmed)) {
      setSavedSenderSuggestions((prev) => [...prev, trimmed]);
    }
    if (!selectedSenders.includes(trimmed)) {
      setSelectedSenders((prev) => [...prev, trimmed]);
    }
    setCustomSenderInput('');
    setIsAddingCustomSender(false);
  };

  // 1. Fetch Receipts via Gmail with Real Google OAuth
  const triggerGmailFetch = async (accessToken: string) => {
    setIsFetching(true);
    setFetchMessage('Connecting to Gmail & fetching receipts...');

    try {
      const headers = await getAuthHeaders();

      // Auto-persist any newly added senders to database
      for (const s of selectedSenders) {
        try {
          await fetch(getApiUrl('/api/ingestion/fetcher-emails'), {
            method: 'POST',
            headers,
            body: JSON.stringify({ email: s }),
          });
        } catch (_e) {
          // Ignore if already saved
        }
      }

      const res = await fetch(getApiUrl('/api/ingestion/gmail/fetch'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          accessToken,
          filters: {
            sender: selectedSenders,
            startDate,
            endDate,
          },
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setFetchMessage(`Fetched ${data.emails?.length || 0} emails!`);
        await loadInitialData();
        setCurrentIndex(0);
        setActiveSilver(null);
        setIsFetchDrawerOpen(false);
      } else {
        setFetchMessage(`Fetch notice: ${data.error || 'Check configuration'}`);
        await loadInitialData();
      }
    } catch (err: any) {
      setFetchMessage(`Error: ${err.message}`);
    } finally {
      setIsFetching(false);
      setTimeout(() => setFetchMessage(null), 4000);
    }
  };

  const googleLogin = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    onSuccess: (tokenResponse) => {
      if (tokenResponse.access_token) {
        triggerGmailFetch(tokenResponse.access_token);
      }
    },
    onError: (err) => {
      console.warn('Google login failed:', err);
      setFetchMessage('Google Authentication was cancelled or failed.');
      setTimeout(() => setFetchMessage(null), 4000);
    },
  });

  const handleFetchEmails = () => {
    if (selectedSenders.length === 0) {
      alert('Please select at least one sender email address.');
      return;
    }
    // Launch Google OAuth
    googleLogin();
  };

  const currentEmail = rawEmails[currentIndex] || null;
  const isCurrentRejected = currentEmail ? rejectedIds.includes(currentEmail.id) : false;

  // 2. Reject Bronze Email (Deferred until final extraction confirmation)
  const handleRejectBronze = () => {
    if (!currentEmail) return;
    if (!rejectedIds.includes(currentEmail.id)) {
      setRejectedIds((prev) => [...prev, currentEmail.id]);
    }
    setActionSuccessMessage('Marked for Rejection (can be restored anytime)');
    setTimeout(() => setActionSuccessMessage(null), 2500);

    if (currentIndex < rawEmails.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setIsDeckComplete(true);
    }
  };

  // 3. Keep current card & advance to next card (or transition to Deck Completion summary if on last card)
  const handleKeepAndNext = () => {
    if (!currentEmail) return;
    if (rejectedIds.includes(currentEmail.id)) {
      setRejectedIds((prev) => prev.filter((id) => id !== currentEmail.id));
    }
    if (currentIndex < rawEmails.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setIsDeckComplete(true);
    }
  };

  // 4. Restore a rejected email back into the active extraction list
  const handleRestoreRejected = (emailId: string) => {
    setRejectedIds((prev) => prev.filter((id) => id !== emailId));
    setActionSuccessMessage('✓ Restored receipt to extraction queue');
    setTimeout(() => setActionSuccessMessage(null), 2500);
  };

  // 5. Batch AI Extraction: Commits rejections atomically & extracts kept Bronze emails
  const handleBatchExtract = async () => {
    const keptEmails = rawEmails.filter((e) => !rejectedIds.includes(e.id));
    const targetIds = keptEmails.map((e) => e.id);

    setIsExtracting(true);
    setExtractStatusMessage(`⚡ Initializing AI Engine... Extracting ${targetIds.length} receipt${targetIds.length > 1 ? 's' : ''}`);

    try {
      const headers = await getAuthHeaders();

      // Commit deferred rejections to backend
      for (const rejId of rejectedIds) {
        try {
          await fetch(getApiUrl(`/api/pipeline/raw-inputs/${rejId}`), {
            method: 'PUT',
            headers,
            body: JSON.stringify({
              hasTransaction: false,
              status: 'rejected',
            }),
          });
        } catch (_e) {
          // Handled
        }
      }

      if (targetIds.length === 0) {
        setRawEmails([]);
        setIsDeckComplete(false);
        setRejectedIds([]);
        setIsExtracting(false);
        setActionSuccessMessage('All reviewed emails marked non-transactional and archived');
        setTimeout(() => setActionSuccessMessage(null), 3000);
        return;
      }

      setExtractErrorMessage(null);

      // 2. Extraction attempt with auto-retry loop for cloud AI cold-start resilience
      const MAX_AI_RETRIES = 3;
      const isTest = typeof window !== 'undefined' && (window as any).__VITEST__;
      const RETRY_DELAYS_MS = isTest ? [30, 50, 80] : [2000, 3500, 5000];
      let extractionSuccess = false;
      let attempt = 0;

      while (attempt <= MAX_AI_RETRIES && !extractionSuccess) {
        if (attempt > 0) {
          const waitMs = RETRY_DELAYS_MS[attempt - 1] || 3000;
          setExtractStatusMessage(
            `⚡ Cloud AI Engine is waking up from standby... Retrying connection (Attempt ${attempt + 1} of ${MAX_AI_RETRIES + 1})`
          );
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }

        try {
          const res = await fetch(getApiUrl('/api/pipeline/extract'), {
            method: 'POST',
            headers,
            body: JSON.stringify({
              rawEmailIds: targetIds,
            }),
          });

          const data = await res.json();

          if (res.ok && data.extracted && data.extracted.length > 0) {
            extractionSuccess = true;
            const mappedSilver: SilverTransaction[] = data.extracted.map((extractedTx: any) => {
              const matchingRaw = rawEmails.find((e) => e.id === extractedTx.bronzeInputId) || currentEmail;
              return {
                id: extractedTx.id,
                bronzeInputId: extractedTx.bronzeInputId || matchingRaw?.id || '',
                merchantRaw: extractedTx.merchantRaw || extractedTx.merchantNormalized || matchingRaw?.sender || 'Merchant',
                merchantNormalized: extractedTx.merchantNormalized || extractedTx.merchantRaw || 'Merchant',
                amount: extractedTx.amount || 0,
                currency: extractedTx.currency || 'INR',
                transactionDate: extractedTx.transactionDate || (matchingRaw?.receivedAt ? matchingRaw.receivedAt.split('T')[0] : ''),
                inferredCategory: extractedTx.inferredCategory || 'Other',
                paymentMethod: extractedTx.paymentMethod || 'Credit Card',
                transactionType: extractedTx.transactionType || 'expense',
                sourceTitle: matchingRaw?.title,
                sourceSender: matchingRaw?.sender,
                sourceReceivedAt: matchingRaw?.receivedAt,
              };
            });

            setSilverQueue(mappedSilver);
            setSilverIndex(0);
            setActiveSilver(mappedSilver[0]);
            setRawEmails([]);
            setRejectedIds([]);
            setIsDeckComplete(false);
            return;
          } else if (res.status === 503 || data?.code === 'LLM_SERVICE_UNAVAILABLE') {
            attempt++;
            if (attempt > MAX_AI_RETRIES) {
              const errDetail =
                data?.error ||
                data?.message ||
                'Cloud AI Engine is taking longer than expected to wake up. Please check your cloud service and tap Retry.';
              setExtractErrorMessage(errDetail);
            }
          } else {
            // Unrecoverable non-503 response (e.g. 400 bad payload)
            const errDetail = data?.error || data?.message || `AI Extraction failed (Status ${res.status}). No transactions were extracted.`;
            setExtractErrorMessage(errDetail);
            return;
          }
        } catch (err: any) {
          attempt++;
          if (attempt > MAX_AI_RETRIES) {
            setExtractErrorMessage(err?.message || 'Network error while contacting AI extraction service.');
          }
        }
      }
    } catch (err: any) {
      setExtractErrorMessage(err?.message || 'Unexpected error occurred during extraction.');
    } finally {
      setIsExtracting(false);
      setExtractStatusMessage(null);
    }
  };

  // 4. Revert Silver back to Bronze
  const handleRevertSilverToBronze = async () => {
    if (!activeSilver) return;
    try {
      const headers = await getAuthHeaders();
      await fetch(getApiUrl('/api/pipeline/revert-to-bronze'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ silverId: activeSilver.id }),
      });

      // Advance silver queue
      const nextIndex = silverIndex + 1;
      if (nextIndex < silverQueue.length) {
        setSilverIndex(nextIndex);
        setActiveSilver(silverQueue[nextIndex]);
      } else {
        setActiveSilver(null);
        setSilverQueue([]);
        await loadInitialData();
      }

      setActionSuccessMessage('Reverted back to Bronze Raw Email');
      setTimeout(() => setActionSuccessMessage(null), 2500);
    } catch (err: any) {
      alert(`Failed to revert: ${err.message}`);
    }
  };

  const updateActiveSilverField = (field: keyof SilverTransaction, value: any) => {
    if (!activeSilver) return;
    const updated = { ...activeSilver, [field]: value };
    setActiveSilver(updated);
    setSilverQueue((prev) => prev.map((item, idx) => (idx === silverIndex ? updated : item)));
  };

  // 5. Save & Accept Silver -> Promote to Gold Ledger
  const handleSaveAndAcceptSilver = async () => {
    if (!activeSilver) return;

    try {
      const headers = await getAuthHeaders();

      // First update Silver record edits
      await fetch(getApiUrl(`/api/pipeline/silver-transactions/${activeSilver.id}`), {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          merchantNormalized: activeSilver.merchantNormalized,
          amount: Number(activeSilver.amount) || 0,
          currency: activeSilver.currency,
          transactionDate: activeSilver.transactionDate,
          inferredCategory: activeSilver.inferredCategory,
          paymentMethod: activeSilver.paymentMethod,
          transactionType: activeSilver.transactionType,
        }),
      });

      // Then approve to Gold with complete transaction fields
      const approveRes = await fetch(getApiUrl('/api/pipeline/approve'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          silverId: activeSilver.id,
          merchant: activeSilver.merchantNormalized || activeSilver.merchantRaw || 'Merchant',
          amount: Number(activeSilver.amount) || 0,
          currency: activeSilver.currency || 'INR',
          date: activeSilver.transactionDate || new Date().toISOString().split('T')[0],
          category: activeSilver.inferredCategory || 'Other',
          paymentMethod: activeSilver.paymentMethod || 'Credit Card',
          transactionType: activeSilver.transactionType || 'expense',
        }),
      });

      if (approveRes.ok) {
        setActionSuccessMessage(`✓ Transaction saved and promoted to Gold Ledger!`);
        setTimeout(() => setActionSuccessMessage(null), 3000);

        // Remove from raw list & advance silver queue
        const updatedRaw = rawEmails.filter((e) => e.id !== activeSilver.bronzeInputId);
        setRawEmails(updatedRaw);

        const nextIndex = silverIndex + 1;
        if (nextIndex < silverQueue.length) {
          setSilverIndex(nextIndex);
          setActiveSilver(silverQueue[nextIndex]);
        } else {
          setActiveSilver(null);
          setSilverQueue([]);
          setCurrentIndex(0);
          await loadInitialData();
        }
      } else {
        const errData = await approveRes.json().catch(() => ({}));
        alert(errData.error || 'Failed to approve transaction to Gold ledger.');
      }
    } catch (err: any) {
      alert(`Save & Accept error: ${err.message}`);
    }
  };

  // Full-Page Source Email View Modal
  if (activeSilver && showSourceModal) {
    return (
      <div className="max-w-md mx-auto px-4 pt-3 pb-8 space-y-3.5" data-testid="source-email-reader-view">
        <div className="bg-white border-2 border-indigo-400/40 rounded-3xl p-5 shadow-sm space-y-3">
          
          {/* Top Bar with Back Button */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setShowSourceModal(false)}
                className="p-1 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 active:scale-95 transition-all text-xs font-bold flex items-center space-x-1 cursor-pointer"
                data-testid="back-to-edit-btn"
              >
                <span>◀</span>
                <span>Back to Edit</span>
              </button>
            </div>
            <span className="text-3xs font-extrabold text-slate-400 uppercase tracking-wider">Source Inspector</span>
          </div>

          {/* Email Headers */}
          {(() => {
            const silverSourceEmail = rawEmails.find((e) => e.id === activeSilver?.bronzeInputId) || currentEmail;
            return (
              <>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 Outfit truncate">
                    {activeSilver.sourceTitle || silverSourceEmail?.title}
                  </h3>
                  <p className="text-3xs text-slate-500 font-medium">
                    <span>From: </span><span className="text-slate-700 font-semibold">{activeSilver.sourceSender || silverSourceEmail?.sender || 'Unknown'}</span>
                    <span> • Date: </span><span className="text-indigo-600 font-semibold">{activeSilver.sourceReceivedAt ? formatDate(activeSilver.sourceReceivedAt.split('T')[0]) : 'N/A'}</span>
                  </p>
                </div>

                {/* Email Body Message */}
                <div className="pt-2 border-t border-slate-100 space-y-1">
                  <span className="text-3xs font-bold uppercase tracking-wider text-slate-400 block">Message Content</span>
                  <div
                    className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-2xs text-slate-700 font-mono leading-relaxed whitespace-pre-wrap max-h-[60vh] overflow-y-auto"
                    data-testid="source-email-message-body"
                  >
                    {silverSourceEmail?.rawBody || silverSourceEmail?.snippet || 'No raw email payload content available.'}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      </div>
    );
  }

  // Full-Page Silver Verification Card
  if (activeSilver) {
    const silverSourceEmail = rawEmails.find((e) => e.id === activeSilver?.bronzeInputId) || currentEmail;
    const emailDateStr = activeSilver.sourceReceivedAt || silverSourceEmail?.receivedAt || activeSilver.transactionDate;
    const senderStr = activeSilver.sourceSender || silverSourceEmail?.sender || 'Unknown Sender';

    return (
      <div className="max-w-md mx-auto px-4 pt-3 pb-8 space-y-3.5" data-testid="silver-extraction-card">
        <div className="bg-white border-2 border-indigo-400/40 rounded-3xl p-4.5 shadow-sm space-y-3.5">
          
          {/* Header with Queue progress, Step Navigation Controls & Close button */}
          <div className="space-y-1.5 border-b border-slate-100 pb-2.5">
            {/* Row 1: Stage Badge on left, Navigation & Close on right */}
            <div className="flex items-center justify-between text-2xs">
              <div className="flex items-center space-x-2 min-w-0 pr-2">
                <span className="font-extrabold text-indigo-600 uppercase tracking-wider bg-indigo-50 border border-indigo-200/70 px-2.5 py-0.5 rounded-lg text-3xs whitespace-nowrap flex-shrink-0">
                  Silver Stage {silverIndex + 1} of {silverQueue.length || 1}
                </span>
              </div>

              <div className="flex items-center space-x-1 flex-shrink-0">
                {/* Silver Step Traversal Buttons - Icon Only */}
                {silverQueue.length > 1 && (
                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      disabled={silverIndex === 0}
                      onClick={() => {
                        const newIdx = Math.max(0, silverIndex - 1);
                        setSilverIndex(newIdx);
                        setActiveSilver(silverQueue[newIdx]);
                      }}
                      className="w-7 h-7 flex items-center justify-center bg-slate-50 border border-slate-200 rounded-lg text-3xs font-bold text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer active:scale-95 shadow-2xs"
                      data-testid="silver-prev-btn"
                      title="Previous Card"
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      disabled={silverIndex === silverQueue.length - 1}
                      onClick={() => {
                        const newIdx = Math.min(silverQueue.length - 1, silverIndex + 1);
                        setSilverIndex(newIdx);
                        setActiveSilver(silverQueue[newIdx]);
                      }}
                      className="w-7 h-7 flex items-center justify-center bg-slate-50 border border-slate-200 rounded-lg text-3xs font-bold text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer active:scale-95 shadow-2xs"
                      data-testid="silver-next-btn"
                      title="Next Card"
                    >
                      ▶
                    </button>
                  </div>
                )}

                <button
                  onClick={() => setActiveSilver(null)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100 active:scale-95 transition-all shadow-2xs cursor-pointer flex-shrink-0"
                  data-testid="back-to-bronze-btn"
                  title="Close Silver Review & Return to Queue"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Row 2: Date of Email directly below Silver Stage Heading */}
            {emailDateStr && (
              <div className="w-full">
                <span className="text-3xs font-semibold text-slate-500 tracking-wide block" data-testid="silver-received-date">
                  {formatDateTime(emailDateStr)}
                </span>
              </div>
            )}

            {/* Row 3: Full-Width Sender Email Address in dedicated line with clickable Source Viewer */}
            <div className="w-full">
              <button
                type="button"
                onClick={() => setShowSourceModal(true)}
                className="w-full text-left text-3xs text-slate-500 font-medium hover:text-indigo-600 transition-colors flex items-center justify-between cursor-pointer group"
                data-testid="view-source-email-btn"
              >
                <div className="truncate pr-1">
                  <span className="text-slate-400">From: </span>
                  <span className="font-semibold text-slate-800 break-all group-hover:text-indigo-600" data-testid="silver-sender-address">
                    {senderStr}
                  </span>
                </div>
                <span className="text-indigo-600 font-bold flex-shrink-0 text-3xs group-hover:underline">
                  View Source ↗
                </span>
              </button>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-3">
            {/* Merchant */}
            <div>
              <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Merchant Name:</label>
              <input
                type="text"
                value={activeSilver.merchantNormalized || ''}
                onChange={(e) => updateActiveSilverField('merchantNormalized', e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-bold focus:outline-none focus:border-indigo-500 focus:bg-white"
                data-testid="silver-merchant-input"
              />
            </div>

            {/* Amount & Currency */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Amount (₹):</label>
                <input
                  type="number"
                  step="0.01"
                  value={activeSilver.amount || ''}
                  onChange={(e) => updateActiveSilverField('amount', parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-extrabold focus:outline-none focus:border-indigo-500 focus:bg-white"
                  data-testid="silver-amount-input"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-3xs font-bold uppercase text-slate-500">Currency:</label>
                  {activeSilver.currency && activeSilver.currency !== 'INR' && (
                    <span className="text-[9px] font-extrabold text-amber-700 bg-amber-50 border border-amber-300 px-1 py-0.2 rounded" title="AI detected non-INR currency">
                      AI: {activeSilver.currency}
                    </span>
                  )}
                </div>
                <select
                  value={activeSilver.currency || 'INR'}
                  onChange={(e) => updateActiveSilverField('currency', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs text-slate-900 font-semibold focus:outline-none focus:border-indigo-500 focus:bg-white cursor-pointer truncate"
                  data-testid="silver-currency-select"
                >
                  <option value="INR">INR (₹)</option>
                  {activeSilver.currency && activeSilver.currency !== 'INR' && (
                    <option value={activeSilver.currency}>{activeSilver.currency} (Detected)</option>
                  )}
                </select>
              </div>
            </div>

            {/* Category & Payment Method */}
            <div className="grid grid-cols-2 gap-2">
              {/* Category Field */}
              <div>
                <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Category:</label>
                {isCustomCategory ? (
                  <div className="flex items-center space-x-1">
                    <input
                      type="text"
                      placeholder="New category..."
                      value={customCategoryInput}
                      onChange={(e) => setCustomCategoryInput(e.target.value)}
                      className="w-full bg-slate-50 border border-indigo-400 rounded-xl px-2 py-1.5 text-xs text-slate-900 font-semibold focus:outline-none focus:bg-white"
                      data-testid="silver-custom-category-input"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (customCategoryInput.trim()) {
                          const cat = customCategoryInput.trim();
                          updateActiveSilverField('inferredCategory', cat);
                          if (!categorySuggestions.includes(cat)) {
                            setCategorySuggestions((prev) => [...prev, cat]);
                          }
                        }
                        setIsCustomCategory(false);
                      }}
                      className="px-2 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-3xs active:scale-95 cursor-pointer flex-shrink-0"
                      data-testid="set-custom-category-btn"
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCustomCategory(false)}
                      className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-3xs active:scale-95 cursor-pointer flex-shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <select
                    value={activeSilver.inferredCategory || 'Other'}
                    onChange={(e) => {
                      if (e.target.value === '__ADD_NEW__') {
                        setIsCustomCategory(true);
                        setCustomCategoryInput('');
                      } else {
                        updateActiveSilverField('inferredCategory', e.target.value);
                      }
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs text-slate-900 font-semibold focus:outline-none focus:border-indigo-500 focus:bg-white cursor-pointer truncate"
                    data-testid="silver-category-select"
                  >
                    {Array.from(new Set([...categorySuggestions, activeSilver.inferredCategory].filter(Boolean))).map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                    <option value="__ADD_NEW__" className="text-indigo-600 font-bold">+ Add Custom Category...</option>
                  </select>
                )}
              </div>

              {/* Payment Method Field */}
              <div>
                <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Payment Method:</label>
                {isCustomPaymentMethod ? (
                  <div className="flex items-center space-x-1">
                    <input
                      type="text"
                      placeholder="New method..."
                      value={customPaymentMethodInput}
                      onChange={(e) => setCustomPaymentMethodInput(e.target.value)}
                      className="w-full bg-slate-50 border border-indigo-400 rounded-xl px-2 py-1.5 text-xs text-slate-900 font-medium focus:outline-none focus:bg-white"
                      data-testid="silver-custom-method-input"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (customPaymentMethodInput.trim()) {
                          const pm = customPaymentMethodInput.trim();
                          updateActiveSilverField('paymentMethod', pm);
                          if (!paymentMethodSuggestions.includes(pm)) {
                            setPaymentMethodSuggestions((prev) => [...prev, pm]);
                          }
                        }
                        setIsCustomPaymentMethod(false);
                      }}
                      className="px-2 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-3xs active:scale-95 cursor-pointer flex-shrink-0"
                      data-testid="set-custom-method-btn"
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCustomPaymentMethod(false)}
                      className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-3xs active:scale-95 cursor-pointer flex-shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <select
                    value={activeSilver.paymentMethod || 'Credit Card'}
                    onChange={(e) => {
                      if (e.target.value === '__ADD_NEW__') {
                        setIsCustomPaymentMethod(true);
                        setCustomPaymentMethodInput('');
                      } else {
                        updateActiveSilverField('paymentMethod', e.target.value);
                      }
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs text-slate-900 font-medium focus:outline-none focus:border-indigo-500 focus:bg-white cursor-pointer truncate"
                    data-testid="silver-payment-method-select"
                  >
                    {Array.from(new Set([...paymentMethodSuggestions, activeSilver.paymentMethod].filter(Boolean))).map((pm) => (
                      <option key={pm} value={pm}>{pm}</option>
                    ))}
                    <option value="__ADD_NEW__" className="text-indigo-600 font-bold">+ Add Custom Method...</option>
                  </select>
                )}
              </div>
            </div>

            {/* Date & Type */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Transaction Date:</label>
                <input
                  type="date"
                  value={activeSilver.transactionDate}
                  onChange={(e) => updateActiveSilverField('transactionDate', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-900 font-medium focus:outline-none focus:border-indigo-500 focus:bg-white"
                  data-testid="silver-date-input"
                />
              </div>

              <div>
                <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Transaction Type:</label>
                <select
                  value={activeSilver.transactionType || 'expense'}
                  onChange={(e) => updateActiveSilverField('transactionType', e.target.value as any)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2.5 text-xs text-slate-900 font-semibold focus:outline-none focus:border-indigo-500 focus:bg-white cursor-pointer"
                  data-testid="silver-type-select"
                >
                  <option value="expense">Expense</option>
                  <option value="refund">Refund</option>
                  <option value="transfer">Transfer (Own)</option>
                  <option value="fixed">Fixed Charge</option>
                </select>
              </div>
            </div>
          </div>

          {/* Equal Sized Sticky Actions Footer */}
          <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-3">
            <button
              onClick={handleRevertSilverToBronze}
              className="w-full bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-bold py-3.5 rounded-2xl text-xs flex items-center justify-center space-x-1 active:scale-95 transition-all cursor-pointer shadow-2xs min-h-[48px]"
              data-testid="revert-silver-btn"
            >
              <span>↩</span>
              <span>Revert to Raw</span>
            </button>

            <button
              onClick={handleSaveAndAcceptSilver}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3.5 rounded-2xl text-xs flex items-center justify-center space-x-1.5 shadow-sm shadow-emerald-600/20 active:scale-95 transition-all cursor-pointer min-h-[48px]"
              data-testid="save-accept-silver-btn"
            >
              <span>✓</span>
              <span>Save & Accept</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-3 pb-8 space-y-3.5" data-testid="mobile-ingestion-triage">
      
      {/* Top Slim Header Bar */}
      <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
        <div className="flex items-center space-x-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Triage</span>
          {rawEmails.length > 0 ? (
            <span className="font-extrabold text-indigo-700 bg-indigo-50 border border-indigo-200/80 px-2 py-0.5 rounded-lg text-3xs">
              📬 Card {currentIndex + 1} of {rawEmails.length}
            </span>
          ) : (
            <span className="font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-lg text-3xs">
              🎉 Queue Clean
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsFetchDrawerOpen(!isFetchDrawerOpen)}
          className={`flex items-center space-x-1.5 text-2xs font-bold px-3 py-1.5 rounded-xl border transition-all active:scale-95 cursor-pointer shadow-2xs ${
            isFetchDrawerOpen
              ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo-600/20'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
          data-testid="toggle-fetch-criteria-btn"
        >
          <span>⚙️</span>
          <span>{isFetchDrawerOpen ? 'Close Settings' : 'Fetch Filters'}</span>
          <span className="text-3xs">{isFetchDrawerOpen ? '▲' : '▼'}</span>
        </button>
      </div>

      {/* Success Notification Banner */}
      {actionSuccessMessage && (
        <div
          className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-2.5 rounded-2xl text-xs font-semibold flex items-center space-x-2 shadow-xs animate-fade-in"
          data-testid="action-success-banner"
        >
          <span>✓</span>
          <span>{actionSuccessMessage}</span>
        </div>
      )}

      {/* LLM Cold Start & Extraction Progress Banner */}
      {extractStatusMessage && (
        <div
          className="bg-indigo-50 border border-indigo-200 text-indigo-900 px-4 py-3 rounded-2xl text-xs font-bold flex items-center space-x-2.5 shadow-xs animate-pulse"
          data-testid="extract-progress-banner"
        >
          <span className="text-sm">⚡</span>
          <span>{extractStatusMessage}</span>
        </div>
      )}

      {/* 1. Fetch Criteria Card (Collapsible Drawer / Slide-Over Modal) */}
      <div
        className={`bg-white border border-slate-200/80 rounded-3xl p-4.5 shadow-sm space-y-3.5 transition-all duration-200 ${
          isFetchDrawerOpen || rawEmails.length === 0 ? 'block' : 'hidden'
        }`}
        data-testid="fetch-criteria-card"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Gmail Receipt Fetcher</h2>
            <span className="text-3xs text-slate-400 font-medium">Select target banks & date window</span>
          </div>
          {rawEmails.length > 0 && (
            <button
              type="button"
              onClick={() => setIsFetchDrawerOpen(false)}
              className="text-slate-400 hover:text-slate-600 text-xs p-1 cursor-pointer"
              data-testid="close-fetch-drawer-btn"
            >
              ✕
            </button>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-3xs font-bold uppercase text-slate-500">Target Senders (From Database):</label>
              <span className="text-3xs font-semibold text-indigo-600">
                {selectedSenders.length} of {savedSenderSuggestions.length} active
              </span>
            </div>
            
            {/* Interactive Senders Pill Grid */}
            <div className="flex flex-wrap gap-2 pt-0.5" data-testid="fetcher-sender-pills">
              {savedSenderSuggestions.map((email) => {
                const isSelected = selectedSenders.includes(email);
                return (
                  <button
                    key={email}
                    type="button"
                    onClick={() => toggleSender(email)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center space-x-1.5 transition-all duration-200 active:scale-95 cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-50 text-indigo-700 border border-indigo-300 shadow-2xs'
                        : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'
                    }`}
                    data-testid={`sender-pill-${email}`}
                  >
                    <span>{isSelected ? '✓' : '○'}</span>
                    <span className="truncate max-w-[200px]">{email}</span>
                  </button>
                );
              })}

              {/* Add Custom Sender Button */}
              {!isAddingCustomSender ? (
                <button
                  type="button"
                  onClick={() => setIsAddingCustomSender(true)}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-50 border border-dashed border-slate-300 text-indigo-600 hover:border-indigo-400 flex items-center space-x-1 active:scale-95 cursor-pointer"
                  data-testid="add-sender-pill-btn"
                >
                  <span>+</span>
                  <span>Add</span>
                </button>
              ) : (
                <div className="flex items-center space-x-1.5 w-full mt-1">
                  <input
                    type="email"
                    value={customSenderInput}
                    onChange={(e) => setCustomSenderInput(e.target.value)}
                    placeholder="e.g. receipts@swiggy.in"
                    className="flex-1 bg-white border border-indigo-400 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    data-testid="fetcher-sender-input"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddCustomSender();
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomSender}
                    className="px-3 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold active:scale-95 cursor-pointer"
                    data-testid="confirm-add-sender-btn"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingCustomSender(false);
                      setCustomSenderInput('');
                    }}
                    className="px-2 py-2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">Start Date:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white"
                data-testid="fetcher-start-date"
              />
            </div>
            <div>
              <label className="text-3xs font-bold uppercase text-slate-500 block mb-1">End Date:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white"
                data-testid="fetcher-end-date"
              />
            </div>
          </div>

          <button
            onClick={handleFetchEmails}
            disabled={isFetching}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-2xl text-xs flex items-center justify-center space-x-2 transition-all shadow-sm shadow-indigo-600/20 active:scale-98 cursor-pointer"
            data-testid="fetch-emails-btn"
          >
            <span className={isFetching ? 'animate-spin' : ''}>🔄</span>
            <span>{isFetching ? 'Fetching Receipts...' : 'Fetch New Receipts'}</span>
          </button>

          {fetchMessage && (
            <p className="text-3xs text-indigo-600 text-center font-medium">{fetchMessage}</p>
          )}
        </div>
      </div>

      {/* 2. Deck Completion Summary Screen (Option 1: Deferred Commit & Restore) */}
      {isDeckComplete && rawEmails.length > 0 ? (() => {
        const keptEmails = rawEmails.filter((e) => !rejectedIds.includes(e.id));
        const rejectedEmails = rawEmails.filter((e) => rejectedIds.includes(e.id));

        return (
          <div
            className="bg-white border-2 border-indigo-400/40 rounded-3xl p-5 shadow-sm text-center space-y-4 animate-fade-in"
            data-testid="deck-complete-card"
          >
            <div className="w-12 h-12 bg-indigo-50 border border-indigo-200 rounded-2xl flex items-center justify-center mx-auto text-xl shadow-2xs">
              📋
            </div>

            <div className="space-y-1">
              <h2 className="text-base font-extrabold text-slate-900 Outfit">Screening Complete!</h2>
              <p className="text-xs text-slate-500 font-medium">
                You reviewed {rawEmails.length} receipt{rawEmails.length > 1 ? 's' : ''}. Review choices before AI extraction:
              </p>
            </div>

            {/* Kept & Rejected Breakdown */}
            <div className="space-y-2.5 text-left">
              {/* Kept Receipts Section */}
              <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-emerald-900">
                  <span className="flex items-center space-x-1.5">
                    <span>✓</span>
                    <span>Ready for AI Extraction ({keptEmails.length})</span>
                  </span>
                </div>
                {keptEmails.length > 0 ? (
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {keptEmails.map((e) => (
                      <div
                        key={e.id}
                        className="text-3xs text-emerald-900 bg-white/90 rounded-xl p-2 border border-emerald-100 flex items-center justify-between shadow-2xs"
                      >
                        <span className="truncate max-w-[220px] font-semibold">{e.title}</span>
                        <span className="text-emerald-700 font-bold ml-1 flex-shrink-0 text-3xs">Kept</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-3xs text-emerald-700 italic">No receipts selected for extraction.</p>
                )}
              </div>

              {/* Rejected Receipts Section with Restore Action */}
              {rejectedEmails.length > 0 && (
                <div className="bg-rose-50/70 border border-rose-200 rounded-2xl p-3.5 space-y-2">
                  <div
                    onClick={() => setExpandedRejectedList(!expandedRejectedList)}
                    className="flex items-center justify-between text-xs font-bold text-rose-900 cursor-pointer"
                  >
                    <span className="flex items-center space-x-1.5">
                      <span>✕</span>
                      <span>Marked for Rejection ({rejectedEmails.length})</span>
                    </span>
                    <span className="text-3xs text-rose-600 font-semibold">{expandedRejectedList ? 'Hide ▲' : 'Show ▼'}</span>
                  </div>

                  {expandedRejectedList && (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pt-1 border-t border-rose-200/60">
                      {rejectedEmails.map((e) => (
                        <div
                          key={e.id}
                          className="text-3xs text-rose-900 bg-white/90 rounded-xl p-2 border border-rose-200 flex items-center justify-between shadow-2xs"
                        >
                          <div className="min-w-0 pr-2">
                            <p className="font-bold truncate">{e.title}</p>
                            <p className="text-slate-500 text-[9px] truncate">{e.sender}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRestoreRejected(e.id)}
                            className="px-2.5 py-1 bg-rose-100 hover:bg-rose-200 text-rose-800 font-extrabold rounded-lg text-3xs border border-rose-300 active:scale-95 transition-all cursor-pointer flex-shrink-0"
                            data-testid={`restore-email-${e.id}`}
                          >
                            ↩ Restore
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* AI Extraction Error Banner */}
            {extractErrorMessage && (
              <div
                className="bg-rose-50 border border-rose-200 text-rose-800 p-3.5 rounded-2xl text-xs space-y-1 text-left shadow-2xs animate-fade-in"
                data-testid="extraction-error-banner"
              >
                <div className="flex items-center space-x-1.5 font-bold text-rose-900">
                  <span>⚠️</span>
                  <span>AI Extraction Failed</span>
                </div>
                <p className="text-3xs text-rose-700 font-medium leading-relaxed">
                  {extractErrorMessage}
                </p>
              </div>
            )}

            {/* Sticky Actions */}
            <div className="space-y-2 pt-1">
              <button
                onClick={handleBatchExtract}
                disabled={isExtracting}
                className={`w-full text-white font-extrabold py-3.5 rounded-2xl text-xs flex items-center justify-center space-x-2 shadow-sm active:scale-95 transition-all cursor-pointer min-h-[48px] ${
                  extractErrorMessage
                    ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20'
                    : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20'
                }`}
                data-testid="batch-extract-btn"
              >
                <span className={isExtracting ? 'animate-spin' : ''}>{extractErrorMessage ? '🔄' : '🚀'}</span>
                <span>
                  {isExtracting
                    ? 'Extracting via AI...'
                    : extractErrorMessage
                    ? `Retry Extraction (${keptEmails.length} Receipts)`
                    : keptEmails.length > 0
                    ? `Confirm & Extract (${keptEmails.length} Receipts)`
                    : 'Confirm & Archive Rejections'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsDeckComplete(false);
                  setCurrentIndex(0);
                }}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-2xl text-xs flex items-center justify-center space-x-1.5 active:scale-95 transition-all cursor-pointer shadow-2xs"
                data-testid="review-again-btn"
              >
                <span>◀</span>
                <span>Flip Back & Review Cards</span>
              </button>
            </div>
          </div>
        );
      })() : rawEmails.length === 0 ? (
        <div className="bg-white border border-slate-200/80 rounded-3xl p-8 text-center space-y-2 shadow-xs">
          <span className="text-3xl block mb-2">🎉</span>
          <h3 className="text-sm font-bold text-slate-900 Outfit">Triage Queue Clean!</h3>
          <p className="text-xs text-slate-500">All fetched email receipts have been reviewed and processed.</p>
        </div>
      ) : (
        /* Full-Screen Bronze Card Deck */
        <div
          className="bg-white border-2 border-indigo-400/40 rounded-3xl p-4.5 shadow-sm space-y-3.5"
          data-testid="bronze-email-card"
        >
          {/* Card Queue Header & Step Controls */}
          <div className="space-y-1.5 border-b border-slate-100 pb-2.5">
            {/* Row 1: Date & Time + Step Controls */}
            <div className="flex items-center justify-between text-2xs">
              <span className="text-3xs font-semibold text-slate-500 tracking-wide" data-testid="bronze-received-date">
                {currentEmail ? formatDateTime(currentEmail.receivedAt) : ''}
              </span>

              {/* Queue Step Buttons */}
              {rawEmails.length > 1 && (
                <div className="flex items-center space-x-1 flex-shrink-0">
                  <button
                    type="button"
                    disabled={currentIndex === 0}
                    onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                    className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-3xs font-bold text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer active:scale-95"
                  >
                    ◀ Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (currentIndex < rawEmails.length - 1) {
                        setCurrentIndex((prev) => prev + 1);
                      } else {
                        setIsDeckComplete(true);
                      }
                    }}
                    className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-3xs font-bold text-slate-700 cursor-pointer active:scale-95"
                  >
                    {currentIndex < rawEmails.length - 1 ? 'Next ▶' : 'Summary ▶'}
                  </button>
                </div>
              )}
            </div>

            {/* Row 2: Full Sender Email Address occupying full card width without breaking */}
            <div className="w-full">
              <p className="text-xs font-bold text-slate-800 break-all leading-tight" data-testid="bronze-sender">
                {currentEmail?.sender}
              </p>
            </div>
          </div>

          {/* Subject & Message Content Body */}
          <div className="space-y-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900 Outfit" data-testid="bronze-subject">
                {currentEmail?.title}
              </h3>
            </div>

            <div>
              <div
                className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 text-2xs text-slate-700 font-mono leading-relaxed max-h-[46vh] overflow-y-auto whitespace-pre-wrap shadow-2xs"
                data-testid="bronze-snippet"
              >
                {currentEmail?.snippet || currentEmail?.rawBody || 'No message content available'}
              </div>
            </div>
          </div>

          {/* Rejection Warning Banner Placed in between Message Content and Action Buttons */}
          {isCurrentRejected && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 px-3.5 py-2.5 rounded-2xl text-xs font-bold flex items-center justify-between shadow-2xs animate-fade-in">
              <span className="flex items-center space-x-1.5">
                <span>✕</span>
                <span>This receipt is marked for Rejection</span>
              </span>
            </div>
          )}

          {/* Screening Actions: Reject OR Keep & Next */}
          <div className="pt-2.5 border-t border-slate-100">
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleRejectBronze}
                className={`w-full font-bold py-3.5 rounded-2xl text-xs flex items-center justify-center space-x-1.5 active:scale-95 transition-all cursor-pointer shadow-2xs min-h-[48px] border ${
                  isCurrentRejected
                    ? 'bg-rose-100 border-rose-300 text-rose-800'
                    : 'bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700'
                }`}
                data-testid="reject-bronze-btn"
              >
                <span>✕</span>
                <span>{isCurrentRejected ? 'Stay Rejected ▶' : 'Reject (Non-Tx)'}</span>
              </button>

              <button
                onClick={handleKeepAndNext}
                disabled={isExtracting}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-3.5 rounded-2xl text-xs flex items-center justify-center space-x-1.5 shadow-sm shadow-indigo-600/20 active:scale-95 transition-all cursor-pointer min-h-[48px]"
                data-testid="accept-bronze-btn"
              >
                <span className={isExtracting ? 'animate-spin' : ''}>✓</span>
                <span>
                  {isCurrentRejected
                    ? '↩ Undo & Keep ▶'
                    : currentIndex < rawEmails.length - 1
                    ? 'Keep & Next ▶'
                    : 'Finish Screening ▶'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
