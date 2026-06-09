import { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';

export interface GmailMessage {
  id: string;
  sender: string;
  subject: string;
  date: string;
  snippet: string;
  body: string;
  hasTransaction: boolean;
}

export const useGmailIntegration = () => {
  const [senders, setSenders] = useState<string[]>([]);
  const [currentSender, setCurrentSender] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [subject, setSubject] = useState('');
  const [emails, setEmails] = useState<GmailMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'transaction' | 'non-transaction'>('transaction');
  const [selectedEmail, setSelectedEmail] = useState<GmailMessage | null>(null);

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

  const markAsTransaction = (id: string) => {
    setEmails(prevEmails =>
      prevEmails.map(email =>
        email.id === id ? { ...email, hasTransaction: true } : email
      )
    );
  };

  const markAsNonTransaction = (id: string) => {
    setEmails(prevEmails =>
      prevEmails.map(email =>
        email.id === id ? { ...email, hasTransaction: false } : email
      )
    );
  };

  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      if (senders.length === 0 || !startDate || !endDate) {
        setError("Please provide at least one sender and a date range.");
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/gmail/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accessToken: tokenResponse.access_token,
            filters: { sender: senders, startDate, endDate, subject }
          }),
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to fetch emails');
        }
        const data = await response.json();
        setEmails(data.emails || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    },
    onError: () => setError("Google Login failed. Please check your credentials."),
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
  });

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
  };
};
