import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
import { useGmailIntegration } from '../hooks/use-gmail-integration';
import { getActiveCycleRange, computeSalaryAllocation, getDatesInRange } from '../utils/transaction-helper';

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
  const [salaryAllocation, setSalaryAllocation] = useState({
    mutualFundSpend: 0,
    mutualFundPercent: 0,
    consumptionSpend: 0,
    consumptionPercent: 0,
    totalSaved: 0,
    unspentPercent: 0,
  });
  const [billingCycleRange, setBillingCycleRange] = useState({ start: '', end: '' });
  const [activeFixedCharges, setActiveFixedCharges] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hoveredPoint, setHoveredPoint] = useState<{ day: string; date: string; amount: number; x: number; y: number } | null>(null);

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
        fetch('/api/pipeline/user-preferences', { headers: authHeaders }).then(res => res.json()).catch(() => ({ billingCycleStartDay: 17, expectedSalary: 100000 })),
        fetch('/api/pipeline/fixed-charges', { headers: authHeaders }).then(res => res.json()).catch(() => ({ fixedCharges: [] })),
      ])
        .then(([raw, silver, gold, prefs, fcData]) => {
          const goldTxs = gold.transactions || [];
          const silverTxs = silver.transactions || [];
          const rawEmails = raw.emails || [];
          const cycleStartDay = prefs.billingCycleStartDay ?? 17;
          const expectedSalary = prefs.expectedSalary ?? 100000;
          const fixedChargesList = fcData.fixedCharges || [];

          const range = getActiveCycleRange(cycleStartDay);
          setBillingCycleRange(range);

          const allocation = computeSalaryAllocation(goldTxs, range, expectedSalary, fixedChargesList);
          setSalaryAllocation(allocation);

          const activeFCs = (fixedChargesList || []).filter((fc: any) => {
            return fc.startDate <= range.end && fc.endDate >= range.start;
          });
          setActiveFixedCharges(activeFCs);
          
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
          
          // Filter to transactions up to current date (local timezone)
          const todayObj = new Date();
          const todayStr = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, '0')}-${String(todayObj.getDate()).padStart(2, '0')}`;
          
          const total = goldTxs
            .filter((tx: any) => tx.transactionDate <= todayStr)
            .reduce((sum: number, tx: any) => {
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

          // Calculate billing cycle trend data based on cycle range (up to current date)
          const trendEndLimit = todayStr < range.start ? range.start : (todayStr > range.end ? range.end : todayStr);
          const cycleDates = getDatesInRange(range.start, trendEndLimit);
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const trendData = cycleDates.map((dateStr: string) => {
            const dateParts = dateStr.split('-').map(Number);
            const d = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
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

            return {
              day: dayName,
              date: formattedDate,
              amount: Math.max(0, amount),
            };
          });
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
  const totalTrendSpend = weeklyTrendData.reduce((sum, d) => sum + d.amount, 0);
  const averageDailySpend = weeklyTrendData.length > 0 ? totalTrendSpend / weeklyTrendData.length : 0;

  return (
    <div className="w-full max-w-5xl space-y-10 animate-fade-in">
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

      {/* Section I: Ledger Analytics & Financial Health */}
      <div className="space-y-6">
        <div className="flex items-center space-x-2">
          <span className="text-lg">📈</span>
          <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest">
            Ledger Analytics & Financial Health
          </h2>
        </div>

        {/* Salary Allocation Split Buckets (Locked strictly to Billing Cycle dates) */}
        {!isLoading && (
          <div className="bg-white border border-gray-100/90 rounded-2xl p-6 shadow-sm flex flex-col justify-between" data-testid="salary-allocation-panel">
            <div>
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-2 flex items-center gap-2">
                <span>📊</span> Salary Allocation Breakdown
              </h3>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-5">
                Active Cycle: {billingCycleRange.start || 'N/A'} to {billingCycleRange.end || 'N/A'}
              </p>

              <div className="space-y-5">
                {/* Segmented Stack Progress Bar */}
                <div className="w-full h-5 bg-gray-100 rounded-full overflow-hidden flex shadow-inner">
                  {salaryAllocation.mutualFundPercent > 0 && (
                    <div
                      style={{ width: `${salaryAllocation.mutualFundPercent}%` }}
                      className="bg-indigo-500 h-full transition-all duration-300"
                      title={`Invested Wealth: ${salaryAllocation.mutualFundPercent.toFixed(1)}%`}
                      data-testid="bucket-mutual-funds-bar"
                    />
                  )}
                  {salaryAllocation.consumptionPercent > 0 && (
                    <div
                      style={{ width: `${salaryAllocation.consumptionPercent}%` }}
                      className="bg-rose-500 h-full transition-all duration-300"
                      title={`Consumption Spend: ${salaryAllocation.consumptionPercent.toFixed(1)}%`}
                      data-testid="bucket-consumption-bar"
                    />
                  )}
                  {salaryAllocation.unspentPercent > 0 && (
                    <div
                      style={{ width: `${salaryAllocation.unspentPercent}%` }}
                      className="bg-emerald-500 h-full transition-all duration-300"
                      title={`Unspent / Savings: ${salaryAllocation.unspentPercent.toFixed(1)}%`}
                      data-testid="bucket-savings-bar"
                    />
                  )}
                </div>

                {/* Legend with Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 text-left">
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 bg-indigo-500 rounded-full shrink-0"></div>
                    <div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Invested Wealth</span>
                      <span className="text-sm font-black text-indigo-750 Outfit">₹{salaryAllocation.mutualFundSpend.toFixed(2)} ({salaryAllocation.mutualFundPercent.toFixed(1)}%)</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 bg-rose-500 rounded-full shrink-0"></div>
                    <div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Consumption Expenses</span>
                      <span className="text-sm font-black text-rose-750 Outfit">₹{salaryAllocation.consumptionSpend.toFixed(2)} ({salaryAllocation.consumptionPercent.toFixed(1)}%)</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 bg-emerald-500 rounded-full shrink-0"></div>
                    <div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Unspent (Liquid Savings)</span>
                      <span className="text-sm font-black text-emerald-750 Outfit">₹{salaryAllocation.totalSaved.toFixed(2)} ({salaryAllocation.unspentPercent.toFixed(1)}%)</span>
                    </div>
                  </div>
                </div>

                {/* Active Fixed Charges itemized list */}
                {activeFixedCharges.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-100 text-left">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">
                      Includes Fixed Charges:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {activeFixedCharges.map(fc => (
                        <span 
                          key={fc.id} 
                          className="inline-flex items-center bg-gray-50 border border-gray-150 px-2.5 py-1 rounded-xl text-xs font-bold text-gray-650"
                        >
                          {fc.name} (₹{fc.amount.toFixed(2)})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        <div className="w-full bg-white border border-gray-100/90 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-50 pb-4 mb-2">
            <div>
              <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider">Expense Trend</h3>
              <p className="text-xs text-gray-400 font-semibold uppercase mt-0.5">Billing Cycle Ledger Visualizer</p>
            </div>
            {weeklyTrendData.length > 0 && (
              <div className="flex items-center gap-2 bg-indigo-50/50 border border-indigo-100/30 rounded-xl px-3.5 py-1.5 self-start sm:self-auto shadow-sm">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Avg Daily Spend:</span>
                <span className="text-xs font-black text-indigo-650 Outfit" data-testid="dashboard-avg-spend-value">₹{averageDailySpend.toFixed(2)}</span>
              </div>
            )}
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
            <div className="w-full relative mt-6">
              {/* SVG Render */}
              <svg viewBox="0 0 1000 220" className="w-full h-56 overflow-visible select-none">
                {/* Gradients */}
                <defs>
                  <linearGradient id="dashboardChartGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* SVG Chart Grid Lines & Axes */}
                <line x1={50} y1={20} x2={970} y2={20} stroke="#f1f5f9" strokeWidth="1" />
                <line x1={50} y1={100} x2={970} y2={100} stroke="#f1f5f9" strokeWidth="1" />
                <line x1={50} y1={180} x2={970} y2={180} stroke="#cbd5e1" strokeWidth="1.5" />

                {/* Left Y Axis line */}
                <line x1={50} y1={20} x2={50} y2={180} stroke="#cbd5e1" strokeWidth="1" />

                {/* Left Y Axis Ticks */}
                <line x1={45} y1={20} x2={50} y2={20} stroke="#cbd5e1" strokeWidth="1" />
                <line x1={45} y1={100} x2={50} y2={100} stroke="#cbd5e1" strokeWidth="1" />
                <line x1={45} y1={180} x2={50} y2={180} stroke="#cbd5e1" strokeWidth="1" />

                {/* Y Axis Values */}
                <text x={40} y={23} textAnchor="end" fill="#64748b" className="text-[9px] font-bold font-sans">
                  ₹{maxWeeklyAmount.toFixed(0)}
                </text>
                <text x={40} y={103} textAnchor="end" fill="#64748b" className="text-[9px] font-bold font-sans">
                  ₹{(maxWeeklyAmount / 2).toFixed(0)}
                </text>
                <text x={40} y={183} textAnchor="end" fill="#64748b" className="text-[9px] font-bold font-sans">
                  ₹0
                </text>

                {(() => {
                  const chartMinX = 50;
                  const chartMaxX = 970;
                  const chartMinY = 20;
                  const chartMaxY = 180;
                  const chartWidth = chartMaxX - chartMinX;
                  const chartHeight = chartMaxY - chartMinY;

                  const stepX = weeklyTrendData.length > 1 ? chartWidth / (weeklyTrendData.length - 1) : chartWidth;

                  const coordinates = weeklyTrendData.map((d, index) => {
                    const x = chartMinX + index * stepX;
                    const y = maxWeeklyAmount > 0
                      ? chartMaxY - (d.amount / maxWeeklyAmount) * chartHeight
                      : chartMaxY;
                    return { x, y, d };
                  });

                   const linePath = coordinates.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
                  const areaPath = coordinates.length > 0
                    ? `${linePath} L ${coordinates[coordinates.length - 1].x} ${chartMaxY} L ${coordinates[0].x} ${chartMaxY} Z`
                    : '';

                  const averageY = maxWeeklyAmount > 0
                    ? chartMaxY - (averageDailySpend / maxWeeklyAmount) * chartHeight
                    : chartMaxY;

                  return (
                    <>
                      {/* Filled Area */}
                      {areaPath && <path d={areaPath} fill="url(#dashboardChartGrad)" />}

                      {/* Average Line */}
                      {weeklyTrendData.length > 0 && maxWeeklyAmount > 0 && (
                        <>
                          <line x1={chartMinX} y1={averageY} x2={chartMaxX} y2={averageY} stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="4 4" />
                          <text x={chartMaxX - 5} y={averageY - 5} textAnchor="end" fill="#94a3b8" className="text-[8px] font-bold font-sans">
                            Avg: ₹{averageDailySpend.toFixed(0)}
                          </text>
                        </>
                      )}

                      {/* Line Curve */}
                      {linePath && (
                        <path
                          d={linePath}
                          fill="none"
                          stroke="#6366f1"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      )}

                      {/* X Axis Date Labels */}
                      {coordinates.map((c, i) => (
                        <g key={i}>
                          <line x1={c.x} y1="180" x2={c.x} y2="184" stroke="#cbd5e1" strokeWidth="1" />
                          <text
                            x={c.x}
                            y="196"
                            textAnchor="middle"
                            fill="#475569"
                            className="text-[9px] font-extrabold font-sans"
                          >
                            {c.d.day}
                          </text>
                          <text
                            x={c.x}
                            y="207"
                            textAnchor="middle"
                            fill="#94a3b8"
                            className="text-[8px] font-bold font-sans"
                          >
                            {c.d.date}
                          </text>
                        </g>
                      ))}

                      {/* Interactive Circles / Markers */}
                      {coordinates.map((c, i) => (
                        <g
                          key={i}
                          className="cursor-pointer"
                          onMouseEnter={() => setHoveredPoint({ ...c.d, x: c.x, y: c.y })}
                          onMouseLeave={() => setHoveredPoint(null)}
                        >
                          <circle
                            cx={c.x}
                            cy={c.y}
                            r="4.5"
                            fill="#ffffff"
                            stroke="#6366f1"
                            strokeWidth="2.5"
                            className="transition-all duration-150 hover:r-[6.5]"
                          />
                          <title>{`${c.d.date}: ₹${c.d.amount.toFixed(0)}`}</title>
                          {/* Invisible larger hover zone */}
                          <circle
                            cx={c.x}
                            cy={c.y}
                            r="15"
                            fill="transparent"
                            className="opacity-0"
                          />
                        </g>
                      ))}
                    </>
                  );
                })()}
              </svg>

              {/* Dynamic HTML Tooltip */}
              {hoveredPoint && (
                <div
                  style={{
                    left: `${(hoveredPoint.x / 1000) * 100}%`,
                    top: `${(hoveredPoint.y / 220) * 100}%`,
                  }}
                  className="absolute transform -translate-x-1/2 -translate-y-[calc(100%+14px)] bg-slate-900 text-white text-[10px] sm:text-xs font-bold rounded-lg px-2.5 py-1.5 shadow-xl border border-slate-800 pointer-events-none transition-all duration-100 z-10 flex flex-col items-center min-w-[70px]"
                >
                  <span className="text-[8px] text-slate-400 font-semibold">{hoveredPoint.date} ({hoveredPoint.day})</span>
                  <span className="text-indigo-400 font-extrabold mt-0.5">₹{hoveredPoint.amount.toFixed(0)}</span>
                  {/* Tooltip arrow */}
                  <div className="w-1.5 h-1.5 bg-slate-900 rotate-45 transform translate-y-1/2 absolute bottom-0 left-1/2 -translate-x-1/2 border-r border-b border-slate-800"></div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Section II: Ingestion Pipeline & Automation */}
      <div className="space-y-6 pt-6 border-t border-gray-100">
        <div className="flex items-center space-x-2">
          <span className="text-lg">🤖</span>
          <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest">
            Ingestion Pipeline & Automation
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
          {/* Bronze Metric Card */}
          <div className="bg-white border border-gray-100/90 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col justify-between group">
            <div>
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
            </div>
            <div className="mt-6 border-t border-gray-50 pt-4 text-xs font-semibold text-gray-500 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full"></span>
              Fetched from Google API
            </div>
          </div>

          {/* Silver Metric Card */}
          <div className="bg-white border border-gray-100/90 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col justify-between group">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-md uppercase tracking-wider">
                  🟦 Silver Layer
                </span>
                <span className="text-xs text-gray-455 font-bold uppercase">Staging</span>
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
            </div>
            <div className="mt-6 border-t border-gray-50 pt-4 text-xs font-semibold text-gray-500 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></span>
              LLM Extracted Details
            </div>
          </div>

          {/* Gold Metric Card */}
          <div className="bg-white border border-gray-100/90 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col justify-between group">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md uppercase tracking-wider">
                  🟩 Gold Layer
                </span>
                <span className="text-xs text-gray-455 font-bold uppercase">Ledger</span>
              </div>
              <div className="mt-6 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-gray-900 leading-none" data-testid="dashboard-gold-count">
                  {isLoading ? '...' : metrics.goldCount}
                </span>
                <span className="text-sm font-bold text-gray-400 uppercase">Approved</span>
              </div>
              <div className="mt-3 text-xs font-semibold text-emerald-650 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></span>
                Total amount: {metrics.goldTotalAmount.toFixed(2)} INR
              </div>
            </div>
            <div className="mt-6 border-t border-gray-55 pt-4">
              <Link 
                to="/transactions"
                className="w-full text-center block text-xs font-black py-2.5 rounded-xl border border-emerald-250/50 text-emerald-650 hover:text-emerald-700 bg-emerald-50/50 hover:bg-emerald-50 transition-all uppercase tracking-widest shadow-sm hover:shadow cursor-pointer"
              >
                View Full Ledger ➔
              </Link>
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
      </div>
    </div>
  );
};

export default Dashboard;
