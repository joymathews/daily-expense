import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
import { useGmailIntegration } from '../hooks/use-gmail-integration';

interface DashboardProps {
  userEmail: string;
}

const Dashboard: React.FC<DashboardProps> = ({ userEmail }) => {
  const { llmAccuracyStats } = useGmailIntegration();
  const [metrics, setMetrics] = useState({
    bronzeCount: 0,
    bronzeProcessedCount: 0,
    bronzeUnprocessedCount: 0,
    bronzeRejectedCount: 0,
    silverCount: 0,
    silverRejectedCount: 0,
    goldCount: 0,
    goldTotalAmount: 0,
  });
  const [weeklyTrendData, setWeeklyTrendData] = useState<{ day: string; date: string; amount: number }[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadMetrics = async () => {
      let authHeaders = {};
      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString();
        if (token) {
          authHeaders = { 'Authorization': `Bearer ${token}` };
        }
      } catch (err) {
        console.warn('Failed to fetch auth session (normal in tests):', err);
      }

      Promise.all([
        fetch('/api/pipeline/raw-inputs', { headers: authHeaders }).then(res => res.json()).catch(() => ({ emails: [] })),
        fetch('/api/pipeline/silver-transactions', { headers: authHeaders }).then(res => res.json()).catch(() => ({ transactions: [] })),
        fetch('/api/pipeline/gold-transactions', { headers: authHeaders }).then(res => res.json()).catch(() => ({ transactions: [] })),
      ])
        .then(([raw, silver, gold]) => {
          const goldTxs = gold.transactions || [];
          const silverTxs = silver.transactions || [];
          const rawEmails = raw.emails || [];
          
          let bronzeProcessed = 0;
          let bronzeRejected = 0;
          let bronzeUnprocessed = 0;

          rawEmails.forEach((email: any) => {
            if (email.status === 'processed') {
              bronzeProcessed++;
            } else if (email.status === 'rejected') {
              bronzeRejected++;
            } else if (email.status === 'unprocessed') {
              bronzeUnprocessed++;
            } else {
              // Fallback check for legacy/mock data
              const inSilver = silverTxs.some((tx: any) => tx.rawEmailId === email.id || tx.bronzeInputId === email.id);
              const inGold = goldTxs.some((tx: any) => tx.rawEmailId === email.id || tx.bronzeInputId === email.id);
              if (inSilver || inGold) {
                bronzeProcessed++;
              } else {
                bronzeUnprocessed++;
              }
            }
          });

          const pendingStaging = silverTxs.filter((tx: any) => tx.status === 'pending' || tx.status === 'error');
          const rejectedStaging = silverTxs.filter((tx: any) => tx.status === 'rejected');
          const total = goldTxs.reduce((sum: number, tx: any) => {
            if (tx.transactionType === 'transfer') return sum; // transfers are neutral
            const signedAmt = tx.transactionType === 'refund' ? -tx.amount : tx.amount;
            return sum + signedAmt;
          }, 0);
          setMetrics({
            bronzeCount: rawEmails.length,
            bronzeProcessedCount: bronzeProcessed,
            bronzeUnprocessedCount: bronzeUnprocessed,
            bronzeRejectedCount: bronzeRejected,
            silverCount: pendingStaging.length,
            silverRejectedCount: rejectedStaging.length,
            goldCount: goldTxs.length,
            goldTotalAmount: total,
          });

          // Calculate real weekly trend data based on current local date (today)
          const endDateObj = new Date();
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const trendData = [];
          for (let i = 6; i >= 0; i--) {
            const d = new Date(endDateObj.getTime());
            d.setDate(endDateObj.getDate() - i);
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const dayName = dayNames[d.getDay()];
            const formattedDate = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

            const amount = goldTxs
              .filter((tx: any) => tx.transactionDate === dateStr)
              .reduce((sum: number, tx: any) => {
                if (tx.transactionType === 'transfer') return sum;
                if (tx.transactionType === 'fixed') return sum;
                const signedAmt = tx.transactionType === 'refund' ? -tx.amount : tx.amount;
                return sum + signedAmt;
              }, 0);

            trendData.push({
              day: dayName,
              date: formattedDate,
              amount: Math.max(0, amount),
            });
          }
          setWeeklyTrendData(trendData);
          setIsLoading(false);
        })
        .catch((err) => {
          console.error('Failed to load dashboard metrics', err);
          setIsLoading(false);
        });
    };

    loadMetrics();
  }, []);

  const maxWeeklyAmount = Math.max(...weeklyTrendData.map(d => d.amount), 100);

  return (
    <div className="w-full max-w-5xl space-y-8 animate-fade-in">
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-100 pb-6 gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
            Hi, <span className="bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent uppercase">{userEmail.split('@')[0]}</span>
          </h1>
          <p className="text-xs sm:text-sm font-semibold text-gray-400 uppercase tracking-wider mt-1">
            Personal Expense Ledger System
          </p>
        </div>
        <div className="flex items-center space-x-3 bg-white border border-gray-100 rounded-xl px-4 py-2 shadow-sm self-start md:self-auto">
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span className="text-xs font-bold text-gray-600 uppercase tracking-widest">
            Cognito Session: Active
          </span>
        </div>
      </div>

      {/* Medallion Pipeline Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Bronze Metric Card */}
        <div className="bg-white border border-gray-100/90 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all duration-200 group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-amber-600 bg-amber-50 px-2.5 py-1 rounded-md uppercase tracking-wider">
              🟫 Bronze Layer
            </span>
            <span className="text-xs text-gray-400 font-bold uppercase">Raw Inbox</span>
          </div>
          <div className="mt-6 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-gray-900 leading-none" data-testid="dashboard-bronze-count">
              {isLoading ? '...' : metrics.bronzeCount}
            </span>
            <span className="text-sm font-bold text-gray-400 uppercase">Emails</span>
          </div>
          {!isLoading && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/50 px-2 py-0.5 rounded-full uppercase tracking-wider" data-testid="dashboard-bronze-processed">
                {metrics.bronzeProcessedCount} Processed
              </span>
              <span className="text-[9px] font-bold text-amber-750 bg-amber-50 border border-amber-200/50 px-2 py-0.5 rounded-full uppercase tracking-wider" data-testid="dashboard-bronze-unprocessed">
                {metrics.bronzeUnprocessedCount} Unprocessed
              </span>
              <span className="text-[9px] font-bold text-rose-700 bg-rose-50 border border-rose-200/50 px-2 py-0.5 rounded-full uppercase tracking-wider" data-testid="dashboard-bronze-rejected">
                {metrics.bronzeRejectedCount} Rejected
              </span>
            </div>
          )}
          <div className="mt-4 border-t border-gray-50 pt-4 text-xs font-semibold text-gray-500 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-amber-400 rounded-full"></span>
            Fetched from Google API
          </div>
        </div>

        {/* Silver Metric Card */}
        <div className="bg-white border border-gray-100/90 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all duration-200 group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-md uppercase tracking-wider">
              🟦 Silver Layer
            </span>
            <span className="text-xs text-gray-400 font-bold uppercase">Staging</span>
          </div>
          <div className="mt-6 flex items-baseline justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-gray-900 leading-none" data-testid="dashboard-silver-count">
                {isLoading ? '...' : metrics.silverCount}
              </span>
              <span className="text-sm font-bold text-gray-400 uppercase">Pending</span>
            </div>
            {!isLoading && metrics.silverRejectedCount > 0 && (
              <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200/50 px-2.5 py-0.5 rounded-full uppercase tracking-wider" data-testid="dashboard-rejected-badge">
                {metrics.silverRejectedCount} Rejected
              </span>
            )}
          </div>
          <div className="mt-4 border-t border-gray-50 pt-4 text-xs font-semibold text-gray-500 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></span>
            LLM Extracted Details
          </div>
        </div>

        {/* Gold Metric Card */}
        <div className="bg-white border border-gray-100/90 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all duration-200 group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md uppercase tracking-wider">
              🟩 Gold Layer
            </span>
            <span className="text-xs text-gray-400 font-bold uppercase">Ledger</span>
          </div>
          <div className="mt-6 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-gray-900 leading-none" data-testid="dashboard-gold-count">
              {isLoading ? '...' : metrics.goldCount}
            </span>
            <span className="text-sm font-bold text-gray-400 uppercase">Approved</span>
          </div>
          <div className="mt-4 border-t border-gray-50 pt-4 text-xs font-semibold text-emerald-600 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></span>
            Total amount: {metrics.goldTotalAmount.toFixed(2)} INR
          </div>
        </div>
      </div>
      
      {/* LLM Parser Performance Section */}
      {llmAccuracyStats && (
        <div className="bg-white border border-gray-150/60 rounded-3xl p-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-100 pb-4 mb-6 gap-4">
            <div>
              <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider flex items-center gap-2">
                <span>🤖</span> LLM Parser Performance
              </h3>
              <p className="text-xs text-gray-400 font-semibold uppercase mt-0.5">
                Accuracy Metrics vs Human Confirmations
              </p>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                Total Tested Transactions
              </span>
              <span className="text-sm font-extrabold text-indigo-600 Outfit">
                {llmAccuracyStats.totalTested} items
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-6 items-center">
            {/* Overall Accuracy Gauge */}
            <div className="md:col-span-2 flex flex-col items-center justify-center p-6 bg-gradient-to-br from-indigo-50/40 to-blue-50/40 rounded-2xl border border-indigo-100/35 relative overflow-hidden text-center">
              <div className="absolute top-0 right-0 -mt-4 -mr-4 w-16 h-16 bg-indigo-500/10 rounded-full blur-lg"></div>
              <span className="text-[10px] font-black text-indigo-800 uppercase tracking-widest mb-2">
                Overall Accuracy
              </span>
              <div className="relative flex items-center justify-center">
                <span className="text-5xl font-black text-indigo-600 Outfit" data-testid="llm-overall-accuracy">
                  {llmAccuracyStats.overallAccuracy}%
                </span>
              </div>
              <p className="text-[10px] text-gray-555 font-medium uppercase mt-3 tracking-wider">
                Across all parsed fields
              </p>
            </div>

            {/* Field Breakdown Progress Bars */}
            <div className="md:col-span-3 space-y-4">
              <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider block mb-1">
                Accuracy by Field
              </span>
              
              {/* Merchant */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-bold uppercase tracking-wider">
                  <span className="text-gray-500">Merchant</span>
                  <span className="text-indigo-650" data-testid="llm-merchant-accuracy">{llmAccuracyStats.merchantAccuracy}%</span>
                </div>
                <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden border border-gray-200/20">
                  <div 
                    className="bg-indigo-600 h-full rounded-full transition-all duration-500"
                    style={{ width: `${llmAccuracyStats.merchantAccuracy}%` }}
                  ></div>
                </div>
              </div>

              {/* Amount */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-bold uppercase tracking-wider">
                  <span className="text-gray-500">Amount</span>
                  <span className="text-indigo-650" data-testid="llm-amount-accuracy">{llmAccuracyStats.amountAccuracy}%</span>
                </div>
                <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden border border-gray-200/20">
                  <div 
                    className="bg-indigo-600 h-full rounded-full transition-all duration-500"
                    style={{ width: `${llmAccuracyStats.amountAccuracy}%` }}
                  ></div>
                </div>
              </div>

              {/* Category */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-bold uppercase tracking-wider">
                  <span className="text-gray-500">Category</span>
                  <span className="text-indigo-650" data-testid="llm-category-accuracy">{llmAccuracyStats.categoryAccuracy}%</span>
                </div>
                <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden border border-gray-200/20">
                  <div 
                    className="bg-indigo-600 h-full rounded-full transition-all duration-500"
                    style={{ width: `${llmAccuracyStats.categoryAccuracy}%` }}
                  ></div>
                </div>
              </div>

              {/* Payment Method */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-bold uppercase tracking-wider">
                  <span className="text-gray-500">Payment Method</span>
                  <span className="text-indigo-650" data-testid="llm-payment-accuracy">{llmAccuracyStats.paymentMethodAccuracy}%</span>
                </div>
                <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden border border-gray-200/20">
                  <div 
                    className="bg-indigo-600 h-full rounded-full transition-all duration-500"
                    style={{ width: `${llmAccuracyStats.paymentMethodAccuracy}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Grid: Graph + Call to Action */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        
        {/* Weekly Trend Bar Widget */}
        <div className="lg:col-span-2 bg-white border border-gray-100/90 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider">Expense Trend</h3>
            <p className="text-xs text-gray-400 font-semibold uppercase mt-0.5">Weekly Ledger Visualizer</p>
          </div>

          {metrics.goldCount === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-center py-6">
              <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mb-3 text-gray-400 border border-gray-100">
                📊
              </div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                No verified data to display
              </p>
            </div>
          ) : (
            <div className="mt-6 flex items-end justify-between h-44 px-2">
              {weeklyTrendData.map((d, index) => {
                const heightPercent = Math.max(8, (d.amount / maxWeeklyAmount) * 100);
                return (
                  <div key={index} className="flex flex-col items-center flex-1 group">
                    <div className="text-[10px] font-bold text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity mb-1.5 h-4 flex items-center justify-center">
                      ₹{d.amount.toFixed(0)}
                    </div>
                    {/* The track of the bar */}
                    <div className="w-8 sm:w-10 h-28 bg-slate-50 border border-slate-100 rounded-xl relative flex items-end overflow-hidden shadow-inner group-hover:border-indigo-100/80 transition-all duration-300">
                      {/* The filled part of the bar */}
                      <div 
                        style={{ height: `${heightPercent}%` }}
                        className="w-full bg-gradient-to-t from-indigo-600 to-indigo-400 rounded-t-sm transition-all duration-500 ease-out group-hover:from-indigo-500 group-hover:to-blue-400 relative shadow-sm"
                      >
                        {/* Top highlight shine */}
                        <div className="w-full h-[2px] bg-white/20 absolute top-0 left-0 right-0"></div>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase mt-2 group-hover:text-gray-900 transition-colors block text-center leading-tight">
                      {d.day}
                      <span className="block text-[8px] font-medium text-gray-400 mt-0.5">{d.date}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Action / Banner Card */}
        <div className="lg:col-span-1 bg-gradient-to-br from-indigo-600 via-indigo-700 to-blue-700 text-white rounded-2xl p-6 shadow-md hover:shadow-lg transition-all duration-300 flex flex-col justify-between group">
          <div className="space-y-4">
            <span className="text-[10px] font-black tracking-widest text-indigo-100 bg-indigo-500/35 border border-indigo-400/20 px-3 py-1 rounded-full uppercase self-start inline-block">
              Automation Hub
            </span>
            <div className="space-y-1">
              <h2 className="text-xl font-bold uppercase italic tracking-tight">Start Extracting</h2>
              <p className="text-xs font-bold text-indigo-100/80 uppercase tracking-tight">
                Import and structure digital receipts.
              </p>
            </div>
          </div>
          
          <div className="mt-8 space-y-4">
            <p className="text-[11px] text-indigo-100 font-semibold leading-relaxed border-l-2 border-indigo-300/40 pl-3">
              Automatically scans raw emails for keywords, isolates merchant details via LLM models, and confirms double-entry records.
            </p>
            <Link 
              to="/gmail"
              className="bg-white text-indigo-600 hover:text-indigo-700 text-xs font-black py-3 rounded-xl shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all uppercase tracking-widest text-center block w-full border border-transparent cursor-pointer"
            >
              Go to Fetcher ➔
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Dashboard;
