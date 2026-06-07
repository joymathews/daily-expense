import React, { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';

interface GmailMessage {
  id: string;
  sender: string;
  subject: string;
  date: string;
  snippet: string;
}

const GmailIntegration: React.FC = () => {
  const [sender, setSender] = useState('');
  const [subject, setSubject] = useState('');
  const [emails, setEmails] = useState<GmailMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // [HOOKS] Must be called at the top level, no try-catch
  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/gmail/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accessToken: tokenResponse.access_token,
            filters: { sender, subject }
          }),
        });
        if (!response.ok) throw new Error('Failed to fetch emails');
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

  return (
    <div className="w-full max-w-5xl space-y-4">
      <div className="flex items-center justify-between border-b border-gray-100 pb-4">
        <div>
          <h2 className="text-xl font-black text-gray-900 uppercase italic">Fetcher</h2>
          <p className="text-[10px] text-gray-400 font-bold uppercase">Retrieve receipts from Google Cloud</p>
        </div>
        
        <button 
          onClick={() => login()}
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
              <label className="block text-[8px] font-black text-gray-400 uppercase mb-1">Sender Email</label>
              <input 
                type="text" 
                placeholder="expenses@..."
                className="w-full px-2 py-1.5 bg-gray-50 border border-gray-100 focus:bg-white focus:border-blue-500 rounded outline-none text-[11px] text-gray-700"
                value={sender}
                onChange={(e) => setSender(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[8px] font-black text-gray-400 uppercase mb-1">Email Subject</label>
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
          <div className="px-4 py-2 border-b border-gray-50 bg-gray-50/50 flex justify-between items-center">
            <h3 className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Inbox Records</h3>
            <span className="text-[9px] font-black text-gray-300 uppercase">{emails.length} Found</span>
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50 text-[8px] font-black text-gray-400 uppercase tracking-tighter">
                <tr>
                  <th className="px-4 py-2 text-left">Sender</th>
                  <th className="px-4 py-2 text-left">Details</th>
                  <th className="px-4 py-2 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {emails.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-10 text-center">
                      <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">
                        {isLoading ? 'Scanning...' : 'No Data Fetch required'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  emails.map((email) => (
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
