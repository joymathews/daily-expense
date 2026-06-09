import React, { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';

interface GmailMessage {
  id: string;
  sender: string;
  subject: string;
  date: string;
  snippet: string;
  hasTransaction: boolean;
}

const GmailIntegration: React.FC = () => {
  const [senders, setSenders] = useState<string[]>([]);
  const [currentSender, setCurrentSender] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [subject, setSubject] = useState('');
  const [emails, setEmails] = useState<GmailMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'transaction' | 'non-transaction'>('transaction');

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

  // [HOOKS] Must be called at the top level, no try-catch
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
        <div className="lg:col-span-1 bg-white p-4 border border-gray-100 rounded space-y-4">
          <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest border-b pb-2 mb-2">Filters</div>
          <div className="space-y-3">
            <div>
              <label htmlFor="sender-input" className="block text-[8px] font-black text-gray-400 uppercase mb-1">Sender Emails</label>
              <div className="flex flex-wrap gap-1 mb-2">
                {senders.map(email => (
                  <span key={email} className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-100">
                    {email}
                    <button onClick={() => removeSender(email)} className="ml-1 text-blue-400 hover:text-blue-600">×</button>
                  </span>
                ))}
              </div>
              <input 
                id="sender-input"
                type="text" 
                placeholder="Add sender email..."
                className="w-full px-2 py-1.5 bg-gray-50 border border-gray-100 focus:bg-white focus:border-blue-500 rounded outline-none text-[11px] text-gray-700"
                value={currentSender}
                onChange={(e) => setCurrentSender(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <p className="text-[8px] text-gray-400 mt-1">Press Enter to add multiple senders</p>
            </div>
            <div>
              <label htmlFor="start-date" className="block text-[8px] font-black text-gray-400 uppercase mb-1">Start Date</label>
              <input 
                id="start-date"
                type="date" 
                className="w-full px-2 py-1.5 bg-gray-50 border border-gray-100 focus:bg-white focus:border-blue-500 rounded outline-none text-[11px] text-gray-700"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="end-date" className="block text-[8px] font-black text-gray-400 uppercase mb-1">End Date</label>
              <input 
                id="end-date"
                type="date" 
                className="w-full px-2 py-1.5 bg-gray-50 border border-gray-100 focus:bg-white focus:border-blue-500 rounded outline-none text-[11px] text-gray-700"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[8px] font-black text-gray-400 uppercase mb-1">Email Subject (Optional)</label>
              <input 
                type="text" 
                placeholder="receipt..."
                className="w-full px-2 py-1.5 bg-gray-50 border border-gray-100 focus:bg-white focus:border-blue-500 rounded outline-none text-[11px] text-gray-700"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
          </div>
          {error && <div className="p-2 bg-red-50 text-red-600 text-[10px] font-bold rounded">{error}</div>}
        </div>

        <div className="lg:col-span-3 bg-white border border-gray-100 rounded overflow-hidden">
          <div className="border-b border-gray-100 bg-gray-50/50 flex justify-between items-center px-4">
            <div className="flex space-x-4">
              <button
                type="button"
                onClick={() => setActiveTab('transaction')}
                className={`py-2 px-1 text-[9px] font-black uppercase tracking-widest border-b-2 transition-all ${
                  activeTab === 'transaction'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                Transactions
                <span className={`ml-1.5 px-1.5 py-0.5 text-[8px] rounded-full font-bold ${
                  activeTab === 'transaction' ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-600'
                }`}>
                  {emails.filter(e => e.hasTransaction).length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('non-transaction')}
                className={`py-2 px-1 text-[9px] font-black uppercase tracking-widest border-b-2 transition-all ${
                  activeTab === 'non-transaction'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                Non-Transactional (For Review)
                <span className={`ml-1.5 px-1.5 py-0.5 text-[8px] rounded-full font-bold ${
                  activeTab === 'non-transaction' ? 'bg-amber-100 text-amber-800' : 'bg-gray-200 text-gray-600'
                }`}>
                  {emails.filter(e => !e.hasTransaction).length}
                </span>
              </button>
            </div>
            <span className="text-[9px] font-black text-gray-300 uppercase">{emails.length} Total</span>
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50 text-[8px] font-black text-gray-400 uppercase tracking-tighter">
                <tr>
                  <th className="px-4 py-2 text-left">Sender</th>
                  <th className="px-4 py-2 text-left">Details</th>
                  <th className="px-4 py-2 text-right">Date</th>
                  <th className="px-4 py-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {emails.filter(email => activeTab === 'transaction' ? email.hasTransaction : !email.hasTransaction).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center">
                      <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">
                        {isLoading ? 'Scanning...' : 'No Data Fetch required'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  emails
                    .filter(email => activeTab === 'transaction' ? email.hasTransaction : !email.hasTransaction)
                    .map((email) => (
                      <tr key={email.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2 whitespace-nowrap">
                          <div className="text-[10px] font-bold text-gray-700">{email.sender.split('<')[0].trim()}</div>
                        </td>
                        <td className="px-4 py-2">
                          <div className="text-[10px] font-bold text-gray-900 leading-tight">{email.subject}</div>
                          <div className="text-[9px] text-gray-400 line-clamp-1 italic">{email.snippet}</div>
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-right text-[9px] font-bold text-gray-400 uppercase">
                          {new Date(email.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-center">
                          {activeTab === 'non-transaction' ? (
                            <button
                              type="button"
                              onClick={() => markAsTransaction(email.id)}
                              className="bg-blue-50 hover:bg-blue-100 text-blue-600 text-[8px] font-bold px-1.5 py-0.5 rounded transition-colors border border-blue-200 uppercase tracking-wider"
                            >
                              Mark Tx
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => markAsNonTransaction(email.id)}
                              className="bg-amber-50 hover:bg-amber-100 text-amber-600 text-[8px] font-bold px-1.5 py-0.5 rounded transition-colors border border-amber-200 uppercase tracking-wider"
                            >
                              Unmark Tx
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
};

export default GmailIntegration;
