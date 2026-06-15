import { useState, useEffect } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { fetchAuthSession } from 'aws-amplify/auth';

export interface FetchProgress {
  status: 'idle' | 'started' | 'fetching' | 'completed' | 'error';
  current: number;
  total: number;
  currentSubject?: string;
}

export interface ExtractionProgress {
  status: 'idle' | 'started' | 'extracting' | 'completed' | 'error';
  current: number;
  total: number;
  currentSubject?: string;
}

export interface GmailMessage {
  id: string;
  sender: string;
  subject: string;
  date: string;
  snippet: string;
  body: string;
  hasTransaction: boolean;
  sourceType?: string;
  status?: 'unprocessed' | 'processed' | 'rejected';
  extracted?: {
    id: string;
    merchant: string;
    amount: number;
    currency: string;
    date: string;
    category: string;
    status: 'pending' | 'approved' | 'rejected' | 'error';
    paymentMethod?: string;
    transactionType?: 'expense' | 'refund';
    parentTransactionId?: string;
  };
  deletedAt?: string;
}

export interface SilverTransaction {
  id: string;
  bronzeInputId: string;
  rawEmailId: string; // Compatibility
  sourceType: string;
  merchantRaw: string;
  merchantNormalized?: string;
  amount: number;
  currency: string;
  transactionDate: string;
  inferredCategory?: string;
  confidenceScore?: number;
  status: 'pending' | 'approved' | 'rejected' | 'error';
  extractedAt?: string;
  sourceTitle?: string;
  sourceSender?: string;
  sourceReceivedAt?: string;
  emailSubject?: string; // Compatibility
  emailSender?: string; // Compatibility
  emailReceivedAt?: string; // Compatibility
  paymentMethod?: string;
  deletedAt?: string;
  transactionType?: 'expense' | 'refund';
  parentTransactionId?: string;
}

export interface GoldTransaction {
  id: string;
  pendingTxId?: string;
  userId: string;
  sourceType: string;
  merchant: string;
  amount: number;
  currency: string;
  transactionDate: string;
  category: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  sourceTitle?: string;
  sourceSender?: string;
  sourceReceivedAt?: string;
  bronzeInputId?: string;
  rawEmailId?: string; // Compatibility
  emailSubject?: string; // Compatibility
  emailSender?: string; // Compatibility
  emailReceivedAt?: string; // Compatibility
  paymentMethod?: string;
  deletedAt?: string;
  transactionType?: 'expense' | 'refund';
  parentTransactionId?: string;
}

export interface PaymentMethod {
  id: string;
  userId: string;
  name: string;
}

export interface PaymentMappingRule {
  id: string;
  userId: string;
  aliasPattern: string;
  paymentMethodId: string;
  paymentMethodName?: string;
}

export interface LlmAccuracyStats {
  overallAccuracy: number;
  merchantAccuracy: number;
  amountAccuracy: number;
  categoryAccuracy: number;
  paymentMethodAccuracy: number;
  totalTested: number;
}

export interface LlmExtractionLog {
  id: string;
  userId: string;
  bronzeInputId: string;
  extractedMerchant: string;
  extractedAmount: number;
  extractedCurrency: string;
  extractedDate: string;
  extractedCategory: string;
  extractedPaymentMethod: string;
  extractedTransactionType: string;
  confidenceScore?: number;
  extractedAt?: string;
}

export const useGmailIntegration = () => {
  const [senders, setSenders] = useState<string[]>([]);
  const [currentSender, setCurrentSender] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [paymentRules, setPaymentRules] = useState<PaymentMappingRule[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [subject, setSubject] = useState('');
  const [emails, setEmails] = useState<GmailMessage[]>([]); // backwards compatibility for tests
  
  // Medallion Layer States
  const [rawEmails, setRawEmails] = useState<GmailMessage[]>([]);
  const [silverTransactions, setSilverTransactions] = useState<SilverTransaction[]>([]);
  const [goldTransactions, setGoldTransactions] = useState<GoldTransaction[]>([]);
  const [deletedRawEmails, setDeletedRawEmails] = useState<GmailMessage[]>([]);
  const [deletedSilverTransactions, setDeletedSilverTransactions] = useState<SilverTransaction[]>([]);
  const [deletedGoldTransactions, setDeletedGoldTransactions] = useState<GoldTransaction[]>([]);
  const [llmAccuracyStats, setLlmAccuracyStats] = useState<LlmAccuracyStats | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchProgress, setFetchProgress] = useState<FetchProgress>({
    status: 'idle',
    current: 0,
    total: 0
  });
  const [extractionProgress, setExtractionProgress] = useState<ExtractionProgress>({
    status: 'idle',
    current: 0,
    total: 0
  });
  const [activeTab, setActiveTab] = useState<'bronze' | 'silver' | 'gold' | 'transaction' | 'non-transaction' | 'trash'>('bronze');
  const [selectedEmail, setSelectedEmail] = useState<GmailMessage | null>(null);

  // Helper to fetch authorization headers dynamically
  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      return token ? { 'Authorization': `Bearer ${token}` } : {};
    } catch (err) {
      console.warn('Failed to fetch auth session (normal in tests):', err);
      return {};
    }
  };

  // Loaders
  const loadRawEmails = async (start = startDate, end = endDate) => {
    try {
      const query = new URLSearchParams();
      if (start) query.append('startDate', start);
      if (end) query.append('endDate', end);
      const queryString = query.toString();
      const url = queryString ? `/api/pipeline/raw-inputs?${queryString}` : '/api/pipeline/raw-inputs';
      const authHeaders = await getAuthHeaders();
      const res = await fetch(url, {
        headers: {
          ...authHeaders,
        },
      });
      if (res.ok) {
        const data = await res.json();
        const mapped = (data.emails || []).map((e: any) => ({
          id: e.id,
          sender: e.sender,
          subject: e.title || e.subject,
          date: e.receivedAt || e.date,
          snippet: e.snippet,
          body: e.rawBody || e.body || '',
          hasTransaction: e.hasTransaction !== undefined ? !!e.hasTransaction : false,
          sourceType: e.sourceType || 'email',
          extracted: e.extracted,
          status: e.status,
        }));
        setRawEmails(mapped);
        // Backwards compatibility for tests that read "emails"
        setEmails(mapped);
      }
    } catch (err) {
      console.warn('Failed to load raw emails silently (normal in test mocks):', err);
    }
  };

  const loadSilverTransactions = async (start = startDate, end = endDate) => {
    try {
      const query = new URLSearchParams();
      if (start) query.append('startDate', start);
      if (end) query.append('endDate', end);
      const queryString = query.toString();
      const url = queryString ? `/api/pipeline/silver-transactions?${queryString}` : '/api/pipeline/silver-transactions';
      const authHeaders = await getAuthHeaders();
      const res = await fetch(url, {
        headers: {
          ...authHeaders,
        },
      });
      if (res.ok) {
        const data = await res.json();
        const mapped = (data.transactions || []).map((tx: any) => ({
          ...tx,
          emailSubject: tx.sourceTitle || tx.emailSubject,
          emailSender: tx.sourceSender || tx.emailSender,
          emailReceivedAt: tx.sourceReceivedAt || tx.emailReceivedAt,
          rawEmailId: tx.bronzeInputId || tx.rawEmailId,
        }));
        setSilverTransactions(mapped);
      }
    } catch (err) {
      console.warn('Failed to load silver transactions silently (normal in test mocks):', err);
    }
  };

  const loadGoldTransactions = async (start = startDate, end = endDate) => {
    try {
      const query = new URLSearchParams();
      if (start) query.append('startDate', start);
      if (end) query.append('endDate', end);
      const queryString = query.toString();
      const url = queryString ? `/api/pipeline/gold-transactions?${queryString}` : '/api/pipeline/gold-transactions';
      const authHeaders = await getAuthHeaders();
      const res = await fetch(url, {
        headers: {
          ...authHeaders,
        },
      });
      if (res.ok) {
        const data = await res.json();
        const mapped = (data.transactions || []).map((tx: any) => ({
          ...tx,
          emailSubject: tx.sourceTitle || tx.emailSubject,
          emailSender: tx.sourceSender || tx.emailSender,
          emailReceivedAt: tx.sourceReceivedAt || tx.emailReceivedAt,
          bronzeEmailId: tx.bronzeInputId || tx.bronzeEmailId,
          rawEmailId: tx.bronzeInputId || tx.bronzeEmailId,
        }));
        setGoldTransactions(mapped);
      }
    } catch (err) {
      console.warn('Failed to load gold transactions silently (normal in test mocks):', err);
    }
  };

  const loadDeletedLayers = async () => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/pipeline/deleted', {
        headers: {
          ...authHeaders,
        },
      });
      if (res.ok) {
        const data = await res.json();
        const mapped = (data.emails || []).map((e: any) => ({
          id: e.id,
          sender: e.sender,
          subject: e.title || e.subject,
          date: e.receivedAt || e.date,
          snippet: e.snippet,
          body: e.rawBody || e.body || '',
          hasTransaction: e.hasTransaction !== undefined ? !!e.hasTransaction : false,
          sourceType: e.sourceType || 'email',
          deletedAt: e.deletedAt,
          extracted: e.extracted,
        }));
        setDeletedRawEmails(mapped);
        setDeletedSilverTransactions((data.silverTransactions || []).map((tx: any) => ({
          ...tx,
          emailSubject: tx.sourceTitle || tx.emailSubject,
          emailSender: tx.sourceSender || tx.emailSender,
          emailReceivedAt: tx.sourceReceivedAt || tx.emailReceivedAt,
          rawEmailId: tx.bronzeInputId || tx.rawEmailId,
        })));
        setDeletedGoldTransactions((data.goldTransactions || []).map((tx: any) => ({
          ...tx,
          emailSubject: tx.sourceTitle || tx.emailSubject,
          emailSender: tx.sourceSender || tx.emailSender,
          emailReceivedAt: tx.sourceReceivedAt || tx.emailReceivedAt,
          bronzeEmailId: tx.bronzeInputId || tx.bronzeEmailId,
          rawEmailId: tx.bronzeInputId || tx.bronzeEmailId,
        })));
      }
    } catch (err) {
      console.warn('Failed to load deleted layers silently (normal in test mocks):', err);
    }
  };

  const loadPaymentMethods = async () => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/ingestion/payment-methods', {
        headers: { ...authHeaders }
      });
      if (res.ok) {
        const data = await res.json();
        setPaymentMethods(data.paymentMethods || []);
      }
    } catch (err) {
      console.warn('Failed to load payment methods:', err);
    }
  };

  const loadPaymentRules = async () => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/ingestion/payment-rules', {
        headers: { ...authHeaders }
      });
      if (res.ok) {
        const data = await res.json();
        setPaymentRules(data.paymentRules || []);
      }
    } catch (err) {
      console.warn('Failed to load payment rules:', err);
    }
  };

  const loadLlmAccuracyStats = async () => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/pipeline/llm-accuracy-stats', {
        headers: { ...authHeaders }
      });
      if (res.ok) {
        const data = await res.json();
        setLlmAccuracyStats(data.stats || null);
      }
    } catch (err) {
      console.warn('Failed to load LLM accuracy stats:', err);
    }
  };

  const fetchLlmLog = async (bronzeId: string): Promise<LlmExtractionLog | null> => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/pipeline/llm-logs/${bronzeId}`, {
        headers: { ...authHeaders }
      });
      if (res.ok) {
        const data = await res.json();
        return data.log || null;
      }
    } catch (err) {
      console.warn('Failed to load LLM log for raw input:', err);
    }
    return null;
  };

  const loadAllLayers = async (start = startDate, end = endDate) => {
    setIsLoading(true);
    await Promise.all([
      loadRawEmails(start, end),
      loadSilverTransactions(start, end),
      loadGoldTransactions(start, end),
      loadDeletedLayers(),
      loadPaymentMethods(),
      loadPaymentRules(),
      loadLlmAccuracyStats(),
    ]);
    setIsLoading(false);
  };

  useEffect(() => {
    loadAllLayers(startDate, endDate);
  }, [startDate, endDate]);

  useEffect(() => {
    loadPaymentMethods();
    loadPaymentRules();
  }, []);

  const addPaymentMethod = async (name: string) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/ingestion/payment-methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({ name })
      });
      if (res.ok) {
        await loadPaymentMethods();
        await loadPaymentRules();
      } else {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to add payment method');
      }
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const updatePaymentMethod = async (id: string, name: string) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/ingestion/payment-methods/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({ name })
      });
      if (res.ok) {
        await loadPaymentMethods();
        await loadPaymentRules();
      } else {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to update payment method');
      }
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const deletePaymentMethod = async (id: string) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/ingestion/payment-methods/${id}`, {
        method: 'DELETE',
        headers: { ...authHeaders }
      });
      if (res.ok) {
        await loadPaymentMethods();
        await loadPaymentRules();
      } else {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to delete payment method');
      }
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const addPaymentRule = async (aliasPattern: string, paymentMethodId: string) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/ingestion/payment-rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({ aliasPattern, paymentMethodId })
      });
      if (res.ok) {
        await loadPaymentRules();
      } else {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to add payment rule');
      }
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const updatePaymentRule = async (id: string, aliasPattern: string, paymentMethodId: string) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/ingestion/payment-rules/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({ aliasPattern, paymentMethodId })
      });
      if (res.ok) {
        await loadPaymentRules();
      } else {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to update payment rule');
      }
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const deletePaymentRule = async (id: string) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/ingestion/payment-rules/${id}`, {
        method: 'DELETE',
        headers: { ...authHeaders }
      });
      if (res.ok) {
        await loadPaymentRules();
      } else {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to delete payment rule');
      }
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const applyRetroactiveStandardization = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/ingestion/standardize-retroactive', {
        method: 'POST',
        headers: { ...authHeaders }
      });
      if (res.ok) {
        await loadAllLayers();
      } else {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed retroactive standardization');
      }
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const addSender = () => {
    if (currentSender && !senders.includes(currentSender)) {
      setSenders([...senders, currentSender]);
      setCurrentSender('');
    }
  };

  const removeSender = (email: string) => {
    setSenders(senders.filter(s => s !== email));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSender();
    }
  };

  const markAsTransaction = async (id: string) => {
    setRawEmails(prev =>
      prev.map(email =>
        email.id === id ? { ...email, hasTransaction: true } : email
      )
    );
    setEmails(prev =>
      prev.map(email =>
        email.id === id ? { ...email, hasTransaction: true } : email
      )
    );

    try {
      const authHeaders = await getAuthHeaders();
      await fetch(`/api/pipeline/raw-inputs/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ hasTransaction: true }),
      });
    } catch (err) {
      console.error('Failed to update classification on server:', err);
    }
  };

  const markAsNonTransaction = async (id: string) => {
    setRawEmails(prev =>
      prev.map(email =>
        email.id === id ? { ...email, hasTransaction: false } : email
      )
    );
    setEmails(prev =>
      prev.map(email =>
        email.id === id ? { ...email, hasTransaction: false } : email
      )
    );

    try {
      const authHeaders = await getAuthHeaders();
      await fetch(`/api/pipeline/raw-inputs/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ hasTransaction: false }),
      });
    } catch (err) {
      console.error('Failed to update classification on server:', err);
    }
  };

  const rejectBronzeInput = async (id: string) => {
    // Optimistically mark as rejected AND non-transactional so the record
    // immediately moves from the Transactions sub-tab to Non-Transactional
    setRawEmails(prev =>
      prev.map(email =>
        email.id === id ? { ...email, status: 'rejected', hasTransaction: false } : email
      )
    );
    setEmails(prev =>
      prev.map(email =>
        email.id === id ? { ...email, status: 'rejected', hasTransaction: false } : email
      )
    );

    try {
      const authHeaders = await getAuthHeaders();
      await fetch(`/api/pipeline/raw-inputs/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ status: 'rejected' }),
      });
    } catch (err) {
      console.error('Failed to update status on server:', err);
    }
  };

  const rejectBronzeInputsBatch = async (ids: string[]) => {
    if (ids.length === 0) return;

    // Optimistically mark all targeted records as rejected AND non-transactional
    setRawEmails(prev =>
      prev.map(email =>
        ids.includes(email.id) ? { ...email, status: 'rejected', hasTransaction: false } : email
      )
    );
    setEmails(prev =>
      prev.map(email =>
        ids.includes(email.id) ? { ...email, status: 'rejected', hasTransaction: false } : email
      )
    );

    try {
      const authHeaders = await getAuthHeaders();
      await fetch('/api/pipeline/reject-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ rawEmailIds: ids }),
      });
    } catch (err) {
      console.error('Failed to batch reject raw inputs on server:', err);
    }
  };

  const updateBronzeStatus = async (id: string, status: 'unprocessed' | 'processed' | 'rejected') => {
    setRawEmails(prev =>
      prev.map(email =>
        email.id === id ? { ...email, status } : email
      )
    );
    setEmails(prev =>
      prev.map(email =>
        email.id === id ? { ...email, status } : email
      )
    );

    try {
      const authHeaders = await getAuthHeaders();
      await fetch(`/api/pipeline/raw-inputs/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ status }),
      });
    } catch (err) {
      console.error('Failed to update status on server:', err);
    }
  };

  const extractSelectedEmails = async (emailIds: string[]) => {
    if (emailIds.length === 0) return;

    setIsLoading(true);
    setError(null);
    setExtractionProgress({ status: 'started', current: 0, total: emailIds.length });

    try {
      const authHeaders = await getAuthHeaders();
      const extractedResults: any[] = [];

      setExtractionProgress({ status: 'extracting', current: 0, total: emailIds.length });

      for (let i = 0; i < emailIds.length; i++) {
        const id = emailIds[i];
        
        // Find subject for visual feedback
        const currentEmail = rawEmails.find(e => e.id === id);
        const subject = currentEmail ? currentEmail.subject : 'email';

        setExtractionProgress(prev => ({
          ...prev,
          status: 'extracting',
          current: i + 1,
          currentSubject: subject,
        }));

        try {
          const response = await fetch('/api/pipeline/extract', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              ...authHeaders,
            },
            body: JSON.stringify({ rawEmailIds: [id] }),
          });

          if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || `Extraction failed for message ${id}`);
          }

          const data = await response.json();
          const matches = data.extracted || [];
          extractedResults.push(...matches);

          // Update local rawEmails and emails state
          const updateState = (prev: GmailMessage[]) =>
            prev.map(email => {
              const match = matches.find((e: any) => e.bronzeInputId === email.id);
              if (match) {
                return {
                  ...email,
                  hasTransaction: true,
                  extracted: {
                    id: match.id,
                    merchant: match.merchantNormalized || match.merchantRaw,
                    amount: match.amount,
                    currency: match.currency,
                    date: match.transactionDate,
                    category: match.inferredCategory || 'Other',
                    status: match.status,
                    paymentMethod: match.paymentMethod,
                    transactionType: match.transactionType,
                    parentTransactionId: match.parentTransactionId,
                  }
                };
              }
              return email;
            });

          setRawEmails(updateState);
          setEmails(updateState);
        } catch (singleErr) {
          console.warn(`Extraction failed for email ID ${id}:`, singleErr);
        }
      }

      setExtractionProgress(prev => ({
        ...prev,
        status: 'completed',
        current: emailIds.length,
      }));

      await loadSilverTransactions();
    } catch (err: any) {
      setError(err.message);
      setExtractionProgress(prev => ({ ...prev, status: 'error' }));
    } finally {
      setIsLoading(false);
    }
  };

  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      if (senders.length === 0 || !startDate || !endDate) {
        setError("Please provide at least one sender and a date range.");
        return;
      }

      setIsFetching(true);
      setError(null);
      setFetchProgress({ status: 'started', current: 0, total: 0 });
      try {
        const authHeaders = await getAuthHeaders();
        const response = await fetch('/api/ingestion/gmail/fetch-list', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          body: JSON.stringify({
            accessToken: tokenResponse.access_token,
            filters: { sender: senders, startDate, endDate, subject }
          }),
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to fetch email list');
        }
        const data = await response.json();
        const messageIds = data.messageIds || [];

        if (messageIds.length === 0) {
          setFetchProgress({ status: 'completed', current: 0, total: 0 });
          await loadAllLayers();
          return;
        }

        setFetchProgress({ status: 'fetching', current: 0, total: messageIds.length });
        const fetchedEmails: GmailMessage[] = [];

        for (let i = 0; i < messageIds.length; i++) {
          const msgId = messageIds[i];
          try {
            const detailRes = await fetch('/api/ingestion/gmail/fetch-detail', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...authHeaders,
              },
              body: JSON.stringify({
                accessToken: tokenResponse.access_token,
                messageId: msgId,
              }),
            });

            if (detailRes.ok) {
              const detailData = await detailRes.json();
              const { email } = detailData;
              if (email) {
                const mapped = {
                  id: email.id,
                  sender: email.sender,
                  subject: email.subject,
                  date: email.date,
                  snippet: email.snippet,
                  body: email.body || '',
                  hasTransaction: email.hasTransaction,
                  extracted: email.extracted,
                };
                fetchedEmails.push(mapped);
                setEmails([...fetchedEmails]);
                setRawEmails([...fetchedEmails]);
                setFetchProgress({
                  status: 'fetching',
                  current: i + 1,
                  total: messageIds.length,
                  currentSubject: email.subject,
                });
              }
            }
          } catch (detailErr) {
            console.warn(`Failed to fetch details for message ${msgId}:`, detailErr);
          }
        }

        setEmails(fetchedEmails);
        setRawEmails(fetchedEmails);

        setFetchProgress({ status: 'completed', current: messageIds.length, total: messageIds.length });
        await loadAllLayers();
      } catch (err: any) {
        setError(err.message);
        setFetchProgress(prev => ({ ...prev, status: 'error' }));
      } finally {
        setIsFetching(false);
      }
    },
    onError: () => setError("Google Login failed. Please check your credentials."),
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
  });

  const updateSilverTransaction = async (id: string, updates: Partial<SilverTransaction>) => {
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`/api/pipeline/silver-transactions/${id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(updates),
      });
      if (response.ok) {
        await loadSilverTransactions();
      }
    } catch (err) {
      console.error('Failed to update silver transaction:', err);
    }
  };

  const updateGoldTransaction = async (id: string, updates: Partial<GoldTransaction>) => {
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`/api/pipeline/gold-transactions/${id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(updates),
      });
      if (response.ok) {
        await loadGoldTransactions();
      }
    } catch (err) {
      console.error('Failed to update gold transaction:', err);
    }
  };

  const approveTransaction = async (
    silverId: string,
    merchant: string,
    amount: number,
    currency: string,
    date: string,
    category: string,
    notes?: string,
    paymentMethod?: string,
    transactionType?: 'expense' | 'refund',
    parentTransactionId?: string
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch('/api/pipeline/approve', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          silverId,
          merchant,
          amount,
          currency,
          date,
          category,
          notes,
          paymentMethod,
          transactionType,
          parentTransactionId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to approve transaction');
      }

      // Promote status locally in emails state for test compatibility
      const updateFn = (prevEmails: GmailMessage[]): GmailMessage[] =>
        prevEmails.map(email =>
          email.extracted?.id === silverId 
            ? {
                ...email,
                hasTransaction: true,
                extracted: {
                  ...email.extracted!,
                  status: 'approved' as const,
                  merchant,
                  amount,
                  category,
                  date,
                  paymentMethod,
                  transactionType,
                  parentTransactionId,
                }
              } 
            : email
        );
      
      setEmails(updateFn);
      setRawEmails(updateFn);

      // If selectedEmail matches, update it
      if (selectedEmail && selectedEmail.extracted?.id === silverId) {
        setSelectedEmail({
          ...selectedEmail,
          hasTransaction: true,
          extracted: {
            ...selectedEmail.extracted!,
            status: 'approved' as const,
            merchant,
            amount,
            category,
            date,
            paymentMethod,
            transactionType,
            parentTransactionId,
          },
        });
      }

      await loadSilverTransactions();
      await loadGoldTransactions();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const approveTransactionsBatch = async (silverIds: string[]) => {
    setIsLoading(true);
    setError(null);
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch('/api/pipeline/approve-batch', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ silverIds }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to approve transactions in batch');
      }

      const data = await response.json();
      const approvedIds = data.approvedIds || silverIds;

      const updateFn = (prevEmails: GmailMessage[]) =>
        prevEmails.map(email =>
          email.extracted && approvedIds.includes(email.extracted.id)
            ? {
                ...email,
                hasTransaction: true,
                extracted: { ...email.extracted, status: 'approved' as const },
              }
            : email
        );

      setEmails(updateFn);
      setRawEmails(updateFn);

      await loadSilverTransactions();
      await loadGoldTransactions();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const revertOrDeleteRecord = async (
    stage: 'bronze' | 'silver' | 'gold',
    ids: { bronzeId?: string; silverId?: string; goldId?: string }
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const authHeaders = await getAuthHeaders();
      let url = '';
      let body: any = {};
      if (stage === 'gold') {
        url = '/api/pipeline/revert-to-silver';
        body = { goldId: ids.goldId };
      } else if (stage === 'silver') {
        url = '/api/pipeline/revert-to-bronze';
        body = { silverId: ids.silverId };
      } else {
        url = '/api/pipeline/delete';
        body = { bronzeId: ids.bronzeId };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `Failed to perform ${stage} operation`);
      }
      await loadAllLayers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const restoreBronzeEmail = async (bronzeId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/pipeline/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ bronzeId }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to restore record');
      }
      await loadAllLayers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const restoreGoldTransaction = async (goldId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/pipeline/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ goldId }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to restore record');
      }
      await loadAllLayers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const addDirectTransaction = async (tx: {
    merchant: string;
    amount: number;
    currency: string;
    transactionDate: string;
    category: string;
    paymentMethod: string;
    notes?: string;
    transactionType?: 'expense' | 'refund';
    parentTransactionId?: string;
  }) => {
    setIsLoading(true);
    setError(null);
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch('/api/pipeline/add-transaction', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(tx),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add manual transaction');
      }

      await loadGoldTransactions();
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const handleFetchClick = () => {
    if (senders.length === 0 || !startDate || !endDate) {
      setError("Sender and Date Range are mandatory.");
      return;
    }
    login();
  };

  return {
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
    rawEmails,
    silverTransactions,
    goldTransactions,
    deletedRawEmails,
    deletedSilverTransactions,
    deletedGoldTransactions,
    isLoading,
    isFetching,
    error,
    fetchProgress,
    setFetchProgress,
    extractionProgress,
    setExtractionProgress,
    activeTab,
    setActiveTab,
    selectedEmail,
    setSelectedEmail,
    addSender,
    removeSender,
    handleKeyDown,
    markAsTransaction,
    markAsNonTransaction,
    rejectBronzeInput,
    rejectBronzeInputsBatch,
    updateBronzeStatus,
    extractSelectedEmails,
    updateSilverTransaction,
    updateGoldTransaction,
    handleFetchClick,
    approveTransaction,
    approveTransactionsBatch,
    loadAllLayers,
    revertOrDeleteRecord,
    restoreBronzeEmail,
    restoreGoldTransaction,
    loadDeletedLayers,
    addDirectTransaction,
    paymentMethods,
    paymentRules,
    loadPaymentMethods,
    loadPaymentRules,
    addPaymentMethod,
    updatePaymentMethod,
    deletePaymentMethod,
    addPaymentRule,
    updatePaymentRule,
    deletePaymentRule,
    applyRetroactiveStandardization,
    llmAccuracyStats,
    fetchLlmLog,
    loadLlmAccuracyStats,
  };
};
