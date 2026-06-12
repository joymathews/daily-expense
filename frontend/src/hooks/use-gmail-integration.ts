import { useState, useEffect } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { fetchAuthSession } from 'aws-amplify/auth';

export interface FetchProgress {
  status: 'idle' | 'started' | 'fetching' | 'completed' | 'error';
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
  extracted?: {
    id: string;
    merchant: string;
    amount: number;
    currency: string;
    date: string;
    category: string;
    status: 'pending' | 'approved' | 'rejected';
    paymentMethod?: string;
  };
}

export interface SilverTransaction {
  id: string;
  rawEmailId: string;
  merchantRaw: string;
  merchantNormalized?: string;
  amount: number;
  currency: string;
  transactionDate: string;
  inferredCategory?: string;
  confidenceScore?: number;
  status: 'pending' | 'approved' | 'rejected';
  extractedAt?: string;
  emailSubject?: string;
  emailSender?: string;
  emailReceivedAt?: string;
  paymentMethod?: string;
}

export interface GoldTransaction {
  id: string;
  pendingTxId?: string;
  userId: string;
  merchant: string;
  amount: number;
  currency: string;
  transactionDate: string;
  category: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  emailSubject?: string;
  emailSender?: string;
  emailReceivedAt?: string;
  bronzeEmailId?: string;
  paymentMethod?: string;
}

export const useGmailIntegration = () => {
  const [senders, setSenders] = useState<string[]>([]);
  const [currentSender, setCurrentSender] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [subject, setSubject] = useState('');
  const [emails, setEmails] = useState<GmailMessage[]>([]); // backwards compatibility for tests
  
  // Medallion Layer States
  const [rawEmails, setRawEmails] = useState<GmailMessage[]>([]);
  const [silverTransactions, setSilverTransactions] = useState<SilverTransaction[]>([]);
  const [goldTransactions, setGoldTransactions] = useState<GoldTransaction[]>([]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchProgress, setFetchProgress] = useState<FetchProgress>({
    status: 'idle',
    current: 0,
    total: 0
  });
  const [activeTab, setActiveTab] = useState<'bronze' | 'silver' | 'gold' | 'transaction' | 'non-transaction'>('bronze');
  const [selectedEmail, setSelectedEmail] = useState<GmailMessage | null>(null);

  // Helper to fetch authorization headers dynamically
  const getAuthHeaders = async () => {
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
      const url = queryString ? `/api/gmail/raw-emails?${queryString}` : '/api/gmail/raw-emails';
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
          subject: e.subject,
          date: e.receivedAt || e.date,
          snippet: e.snippet,
          body: e.rawBody || e.body || '',
          hasTransaction: e.hasTransaction !== undefined ? !!e.hasTransaction : false,
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
      const url = queryString ? `/api/gmail/silver-transactions?${queryString}` : '/api/gmail/silver-transactions';
      const authHeaders = await getAuthHeaders();
      const res = await fetch(url, {
        headers: {
          ...authHeaders,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setSilverTransactions(data.transactions || []);
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
      const url = queryString ? `/api/gmail/gold-transactions?${queryString}` : '/api/gmail/gold-transactions';
      const authHeaders = await getAuthHeaders();
      const res = await fetch(url, {
        headers: {
          ...authHeaders,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setGoldTransactions(data.transactions || []);
      }
    } catch (err) {
      console.warn('Failed to load gold transactions silently (normal in test mocks):', err);
    }
  };

  const loadAllLayers = async (start = startDate, end = endDate) => {
    setIsLoading(true);
    await Promise.all([
      loadRawEmails(start, end),
      loadSilverTransactions(start, end),
      loadGoldTransactions(start, end),
    ]);
    setIsLoading(false);
  };

  useEffect(() => {
    loadAllLayers();
  }, []);

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
      await fetch(`/api/gmail/raw-emails/${id}`, {
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
      await fetch(`/api/gmail/raw-emails/${id}`, {
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

  const extractSelectedEmails = async (emailIds: string[]) => {
    setIsLoading(true);
    setError(null);
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch('/api/gmail/extract', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ rawEmailIds: emailIds }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Extraction failed');
      }
      const data = await response.json();
      
      // Update local rawEmails and emails state
      const updateState = (prev: GmailMessage[]) =>
        prev.map(email => {
          const match = (data.extracted || []).find((e: any) => e.rawEmailId === email.id);
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
              }
            };
          }
          return email;
        });

      setRawEmails(updateState);
      setEmails(updateState);

      await loadSilverTransactions();
    } catch (err: any) {
      setError(err.message);
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
        const response = await fetch('/api/gmail/fetch-list', {
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
            const detailRes = await fetch('/api/gmail/fetch-detail', {
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
                setFetchProgress(prev => ({
                  status: 'fetching',
                  current: i + 1,
                  total: messageIds.length,
                  currentSubject: email.subject,
                }));
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
      const response = await fetch(`/api/gmail/silver-transactions/${id}`, {
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
      const response = await fetch(`/api/gmail/gold-transactions/${id}`, {
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
    paymentMethod?: string
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch('/api/gmail/approve', {
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
      const response = await fetch('/api/gmail/approve-batch', {
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
    isLoading,
    isFetching,
    error,
    fetchProgress,
    setFetchProgress,
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
    updateSilverTransaction,
    updateGoldTransaction,
    handleFetchClick,
    approveTransaction,
    approveTransactionsBatch,
    loadAllLayers,
  };
};
