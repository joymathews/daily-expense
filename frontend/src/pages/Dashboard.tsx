import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
import {
  computeSalaryAllocation,
  getDatesInRange,
  getActiveCycleRange,
  filterActiveFixedCharges,
  calculateCategorySpend,
  getTopSpendingCategories,
  calculateCycleSpendTotal,
  buildDailySpendMap,
  buildDailyTransactionsMap,
  calculateDailySpendSeries,
  calculateAverageDailySpend,
} from '../utils/transaction-helper';
import { useUserCycles } from '../hooks/use-user-cycles';
import { CycleSelectorDropdown } from '../components/CycleSelectorDropdown';
import { CycleOverrideModal } from '../components/CycleOverrideModal';
import { filterTransactionsByCycle, getExpectedCycleEnd } from '../utils/cycle-helper';
import SpendCalendar from '../components/spend-calendar';
import { getApiUrl } from '../utils/api-config';

interface DashboardProps {
  userEmail: string;
}

const Dashboard: React.FC<DashboardProps> = ({ userEmail }) => {
  const [llmAccuracyStats, setLlmAccuracyStats] = useState<any>(null);
  const { cycles, activeCycle, selectedCycle, setSelectedCycle, setCycleOverride, removeCycleOverride } = useUserCycles();
  const [isCycleModalOpen, setIsCycleModalOpen] = useState(false);

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
  const [goldTransactions, setGoldTransactions] = useState<any[]>([]);
  const [prefsStartDay, setPrefsStartDay] = useState<number>(17);
  const [uniquePaymentMethods, setUniquePaymentMethods] = useState<string[]>([]);
  const [selectedPaymentMethods, setSelectedPaymentMethods] = useState<string[]>([]);
  const [activeSeries, setActiveSeries] = useState({
    current: true,
  });
  const [selectedOffsets, setSelectedOffsets] = useState<number[]>([1]);
  const [historicalCyclesMap, setHistoricalCyclesMap] = useState<Record<string, any[]>>({});
  const [isCycleDropdownOpen, setIsCycleDropdownOpen] = useState(false);
  const [chartViewMode, setChartViewMode] = useState<'daily' | 'cumulative'>('cumulative');
  const [hoveredCompPoint, setHoveredCompPoint] = useState<any | null>(null);
  const [salaryAllocation, setSalaryAllocation] = useState({
    mutualFundSpend: 0,
    mutualFundPercent: 0,
    consumptionSpend: 0,
    consumptionPercent: 0,
    totalSaved: 0,
    unspentPercent: 0,
    bankDebitTotal: 0,
  });
  const [billingCycleRange, setBillingCycleRange] = useState({ start: '', end: '' });
  const [activeFixedCharges, setActiveFixedCharges] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hoveredPoint, setHoveredPoint] = useState<{ day: string; date: string; amount: number; x: number; y: number } | null>(null);
  const [topOverallCategories, setTopOverallCategories] = useState<{ category: string; currency: string; amount: number }[]>([]);
  const [topCycleCategories, setTopCycleCategories] = useState<{ category: string; currency: string; amount: number }[]>([]);
  const [dailySpendMap, setDailySpendMap] = useState<Record<string, number>>({});
  const [dailyTransactionsMap, setDailyTransactionsMap] = useState<Record<string, any[]>>({});
  const [todayDateString, setTodayDateString] = useState('');
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);

  const [rawLedgerData, setRawLedgerData] = useState<{ goldTxs: any[]; prefs: any; fixedChargesList: any[] } | null>(null);

  useEffect(() => {
    if (!rawLedgerData) return;
    const { goldTxs, prefs, fixedChargesList } = rawLedgerData;
    const currentCycle = selectedCycle || activeCycle;
    const cycleStartDay = prefs.billingCycleStartDay ?? 17;
    const expectedSalary = prefs.expectedSalary ?? 100000;
    const range = currentCycle ? {
      start: currentCycle.startDate,
      end: currentCycle.endDate || getActiveCycleRange(cycleStartDay).end
    } : getActiveCycleRange(cycleStartDay);

    setBillingCycleRange(range);

    const cycleFilteredTxs = filterTransactionsByCycle(goldTxs, currentCycle);
    const allocation = computeSalaryAllocation(cycleFilteredTxs, range, expectedSalary, fixedChargesList);
    setSalaryAllocation(allocation);

    const activeFCs = filterActiveFixedCharges(fixedChargesList, range);
    setActiveFixedCharges(activeFCs);

    const todayStr = new Date().toISOString().split('T')[0];
    const trendEndLimit = todayStr < range.start ? range.start : (todayStr > range.end ? range.end : todayStr);
    const cycleDates = getDatesInRange(range.start, trendEndLimit);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const trendData = cycleDates.map((dateStr: string) => {
      const dateParts = dateStr.split('-').map(Number);
      const d = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
      const dayName = dayNames[d.getDay()];
      const formattedDate = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
      const amount = calculateCycleSpendTotal(goldTxs.filter((tx: any) => tx.transactionDate === dateStr));

      return {
        day: dayName,
        date: formattedDate,
        amount: Math.max(0, amount),
      };
    });
    setWeeklyTrendData(trendData);
  }, [selectedCycle, activeCycle, rawLedgerData]);

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

      // [FUNC-DASH-PERF-1], [FUNC-PIPE-STATS-1], [NFR-PERF-11], [NFR-PERF-12]
      // Fetch user preferences, fixed charges, summary stats, LLM accuracy stats, and gold transactions in parallel
      Promise.all([
        fetch(getApiUrl('/api/pipeline/user-preferences'), { headers: authHeaders }).then(res => res.json()).catch(() => ({ billingCycleStartDay: 17, expectedSalary: 100000 })),
        fetch(getApiUrl('/api/pipeline/fixed-charges'), { headers: authHeaders }).then(res => res.json()).catch(() => ({ fixedCharges: [] })),
        fetch(getApiUrl('/api/pipeline/summary-stats'), { headers: authHeaders }).then(res => res.json()).catch(() => null),
        fetch(getApiUrl('/api/pipeline/llm-accuracy-stats'), { headers: authHeaders }).then(res => res.json()).catch(() => null),
        fetch(getApiUrl('/api/pipeline/gold-transactions'), { headers: authHeaders }).then(res => res.json()).catch(() => ({ transactions: [] })),
      ])
        .then(([prefs, fcData, statsData, llmData, gold]) => {
          const goldTxs = gold.transactions || [];
          const cycleStartDay = prefs.billingCycleStartDay ?? 17;
          const fixedChargesList = fcData.fixedCharges || [];
          setRawLedgerData({ goldTxs, prefs, fixedChargesList });
          setGoldTransactions(goldTxs);
          setPrefsStartDay(cycleStartDay);

          if (llmData && (llmData.stats || llmData.overallAccuracy !== undefined)) {
            setLlmAccuracyStats(llmData.stats || llmData);
          }

          const pms = Array.from(new Set(goldTxs.map((tx: any) => tx.paymentMethod || 'Unknown').filter(Boolean))) as string[];
          pms.sort((a, b) => a.localeCompare(b));
          setUniquePaymentMethods(pms);
          setSelectedPaymentMethods(pms);

          const todayObj = new Date();
          const todayStr = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, '0')}-${String(todayObj.getDate()).padStart(2, '0')}`;
          setTodayDateString(todayStr);

          const total = calculateCycleSpendTotal(goldTxs.filter((tx: any) => tx.transactionDate <= todayStr));

          if (statsData?.stats) {
            setMetrics(statsData.stats);
          } else {
            // Graceful fallback for test environments or older backends where summary-stats is not available
            Promise.all([
              fetch(getApiUrl('/api/pipeline/raw-inputs'), { headers: authHeaders }).then(res => res.json()).catch(() => ({ emails: [] })),
              fetch(getApiUrl('/api/pipeline/silver-transactions'), { headers: authHeaders }).then(res => res.json()).catch(() => ({ transactions: [] })),
            ]).then(([raw, silver]) => {
              const rawEmails = raw.emails || [];
              const silverTxs = silver.transactions || [];
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
            });
          }

          const currCycleForTrend = selectedCycle || activeCycle;
          const expectedTrendEnd = currCycleForTrend ? getExpectedCycleEnd(currCycleForTrend.startDate, cycleStartDay) : todayStr;
          const range = currCycleForTrend 
            ? { start: currCycleForTrend.startDate, end: currCycleForTrend.endDate || expectedTrendEnd }
            : getActiveCycleRange(cycleStartDay);

          const spendMap = buildDailySpendMap(goldTxs);
          setDailySpendMap(spendMap);

          const txMap = buildDailyTransactionsMap(goldTxs);
          setDailyTransactionsMap(txMap);

          const overallCategoryMap = calculateCategorySpend(goldTxs);
          const cycleTxs = goldTxs.filter((tx: any) => tx.transactionDate >= range.start && tx.transactionDate <= range.end);
          const cycleCategoryMap = calculateCategorySpend(cycleTxs);

          setTopOverallCategories(getTopSpendingCategories(overallCategoryMap, 3));
          setTopCycleCategories(getTopSpendingCategories(cycleCategoryMap, 3));

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
  const averageDailySpend = calculateAverageDailySpend(totalTrendSpend, weeklyTrendData.length);

  const todayStr = React.useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const availableCycles = React.useMemo(() => {
    return cycles
      .filter(c => !c.isCurrent && c.startDate <= todayStr)
      .map((c, idx) => ({
        offset: idx + 1,
        cycleId: c.id,
        cycle: c,
        range: { start: c.startDate, end: c.endDate || todayStr },
        label: c.cycleName,
      }));
  }, [cycles, todayStr]);

  // [FUNC-COMP-PERF-1] On-demand lazy fetching and local caching for historical comparison cycles
  useEffect(() => {
    const fetchHistoricalCycles = async () => {
      let authHeaders = {};
      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString();
        if (token) authHeaders = { 'Authorization': `Bearer ${token}` };
      } catch (err) {
        console.warn('Failed to fetch auth session:', err);
      }

      for (const offset of selectedOffsets) {
        const matchingItem = availableCycles.find(a => a.offset === offset);
        if (matchingItem && !historicalCyclesMap[matchingItem.cycleId]) {
          const url = `/api/pipeline/gold-transactions?startDate=${encodeURIComponent(matchingItem.range.start)}&endDate=${encodeURIComponent(matchingItem.range.end)}`;
          try {
            const res = await fetch(getApiUrl(url), { headers: authHeaders });
            if (res.ok) {
              const data = await res.json();
              setHistoricalCyclesMap(prev => ({
                ...prev,
                [matchingItem.cycleId]: data.transactions || []
              }));
            }
          } catch (e) {
            console.warn('Failed to fetch historical cycle data:', e);
          }
        }
      }
    };

    fetchHistoricalCycles();
  }, [selectedOffsets, availableCycles]);

  const comparisonChartData = React.useMemo(() => {
    try {
      if (goldTransactions.length === 0) {
        return {
          currentSpends: [],
          historicalData: [],
          maxVal: 100,
          daysCount: 30,
          currentTotal: 0,
          error: null
        };
      }

      const currCycle = selectedCycle || activeCycle;
      const currentStart = currCycle?.startDate || todayStr;
      const currentEnd = currCycle?.endDate || todayStr;
      const currentDates = getDatesInRange(currentStart, currentEnd);

      const getDailySpends = (datesList: string[], isCurrent: boolean, cycleObj?: any, customTxs?: any[]) => {
        const sourceTxs = customTxs || goldTransactions;
        const cycleTxs = cycleObj ? filterTransactionsByCycle(sourceTxs, cycleObj) : sourceTxs;
        const series = calculateDailySpendSeries(cycleTxs, datesList, {
          selectedPaymentMethods,
          isCumulative: chartViewMode === 'cumulative',
          todayLimit: isCurrent ? todayStr : undefined,
        });

        return { spends: series.spends, total: series.total };
      };

      const currentData = getDailySpends(currentDates, true, currCycle);

      const historicalData = selectedOffsets.map((offset) => {
        const matchingItem = availableCycles.find(a => a.offset === offset);
        if (!matchingItem) return null;
        const dates = getDatesInRange(matchingItem.range.start, matchingItem.range.end);
        const cachedTxs = historicalCyclesMap[matchingItem.cycleId];
        const daily = getDailySpends(dates, false, matchingItem.cycle, cachedTxs || goldTransactions);

        return {
          offset,
          range: matchingItem.range,
          spends: daily.spends,
          total: daily.total,
          label: matchingItem.label
        };
      }).filter(Boolean) as any[];

      const maxDays = Math.max(
        currentDates.length,
        ...historicalData.map(h => h.spends.length),
        28
      );

      const allAmounts: number[] = [];
      if (activeSeries.current) {
        currentData.spends.forEach((d: { date: string; amount: number | null }) => { if (d.amount !== null) allAmounts.push(d.amount); });
      }
      historicalData.forEach(h => {
        h.spends.forEach((d: { date: string; amount: number | null }) => { if (d.amount !== null) allAmounts.push(d.amount); });
      });
      const maxVal = Math.max(...allAmounts, 100);

      return {
        currentSpends: currentData.spends,
        historicalData,
        maxVal,
        daysCount: maxDays,
        currentTotal: currentData.total,
        error: null
      };
    } catch (err: any) {
      console.error("Error in comparison chart memo:", err);
      return {
        currentSpends: [],
        historicalData: [],
        maxVal: 100,
        daysCount: 30,
        currentTotal: 0,
        error: err.message || String(err)
      };
    }
  }, [goldTransactions, prefsStartDay, selectedPaymentMethods, activeSeries, selectedOffsets, chartViewMode, todayStr, selectedCycle, activeCycle, availableCycles]);

  const compStepX = comparisonChartData.daysCount > 1 ? 890 / (comparisonChartData.daysCount - 1) : 890;

  const validCurrentPoints = activeSeries.current
    ? comparisonChartData.currentSpends
        .map((pt: { date: string; amount: number | null }, idx: number) => ({ x: 60 + idx * compStepX, y: pt.amount !== null ? 200 - (pt.amount / comparisonChartData.maxVal) * 180 : null }))
        .filter((pt: { x: number; y: number | null }): pt is { x: number; y: number } => pt.y !== null)
    : [];

  const currentLinePath = validCurrentPoints.map((c: { x: number; y: number }, i: number) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
  const currentAreaPath = validCurrentPoints.length > 0
    ? `${currentLinePath} L ${validCurrentPoints[validCurrentPoints.length - 1].x} 200 L ${validCurrentPoints[0].x} 200 Z`
    : '';

  const HISTORICAL_COLORS = [
    { border: '#f59e0b', strokeDash: '4 4' },
    { border: '#06b6d4', strokeDash: '2 2' },
    { border: '#10b981', strokeDash: '1 1' },
    { border: '#ec4899', strokeDash: 'none' },
    { border: '#8b5cf6', strokeDash: '3 3' },
    { border: '#f97316', strokeDash: '5 5' },
  ];

  const historicalSeries = React.useMemo(() => {
    return (comparisonChartData.historicalData || []).map((series, index) => {
      const colorInfo = HISTORICAL_COLORS[index % HISTORICAL_COLORS.length];
      const points = series.spends.map((pt: { date: string; amount: number | null }, idx: number) => ({
        x: 60 + idx * compStepX,
        y: pt.amount !== null ? 200 - (pt.amount / comparisonChartData.maxVal) * 180 : null
      }));
      const validPoints = points.filter((pt: { x: number; y: number | null }): pt is { x: number; y: number } => pt.y !== null);
      
      const linePath = validPoints.map((c: { x: number; y: number }, i: number) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
      
      let areaPath = '';
      if (validPoints.length > 0) {
        areaPath = `${linePath} L ${validPoints[validPoints.length - 1].x} 200 L ${validPoints[0].x} 200 Z`;
      }

      return {
        ...series,
        index,
        colorInfo,
        validPoints,
        linePath,
        areaPath
      };
    });
  }, [comparisonChartData.historicalData, compStepX, comparisonChartData.maxVal]);

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
        <div className="flex flex-wrap items-center gap-3 self-start md:self-auto">
          <CycleSelectorDropdown
            cycles={cycles}
            selectedCycle={selectedCycle}
            onSelectCycle={setSelectedCycle}
          />
          <button
            type="button"
            onClick={() => setIsCycleModalOpen(true)}
            className="px-3 py-1.5 rounded-xl border border-indigo-200 bg-indigo-50/60 text-indigo-700 text-xs font-extrabold uppercase tracking-wide hover:bg-indigo-100 transition-all cursor-pointer shadow-sm"
          >
            ✏️ Customize Start Date
          </button>
          <div className="flex items-center space-x-3 bg-white border border-gray-100 rounded-xl px-4 py-2 shadow-sm">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-bold text-gray-600 uppercase tracking-widest">
              Cognito Session: Active
            </span>
          </div>
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

                {/* Pre-existing bank balance spent footnote */}
                {salaryAllocation.bankDebitTotal > 0 && (
                  <div className="mt-3.5 pt-3.5 border-t border-gray-105 flex items-center space-x-1.5 text-2xs text-gray-400 font-medium font-sans text-left" data-testid="bank-outflow-footnote">
                    <span>🏦</span>
                    <span>
                      Instant Bank Outflows: <span className="font-bold text-gray-600">₹{salaryAllocation.bankDebitTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> spent via UPI/Debit from pre-existing bank balances (not counted against expected salary allocation).
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Category Spend Breakdown (Top 3 Current vs All-time) */}
        {!isLoading && metrics.goldCount > 0 && (
          <div className="bg-white border border-gray-100/90 rounded-2xl p-6 shadow-sm flex flex-col justify-between" data-testid="dashboard-category-breakdown">
            <div>
              <h3 className="text-sm font-bold text-gray-905 uppercase tracking-wider mb-2 flex items-center gap-2">
                <span>🏷️</span> Category Spend Highlights
              </h3>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-5">
                Top 3 Category Spending (Current Cycle vs All-time)
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-2">
                {/* Current Cycle Column */}
                <div className="space-y-4 text-left">
                  <div className="flex items-center justify-between border-b border-gray-50 pb-2">
                    <span className="text-[10px] font-black text-indigo-650 bg-indigo-50 px-2 py-0.5 rounded uppercase tracking-wider">
                      Current Cycle Top 3
                    </span>
                    <span className="text-[10px] text-gray-450 font-bold uppercase">
                      Spend
                    </span>
                  </div>
                  {topCycleCategories.length === 0 ? (
                    <p className="text-xs font-semibold text-gray-400 uppercase italic py-4">No cycle expenses logged</p>
                  ) : (
                    <div className="space-y-3.5">
                      {topCycleCategories.map((item, idx) => {
                        const maxVal = topCycleCategories[0].amount || 1;
                        const percent = (item.amount / maxVal) * 100;
                        return (
                          <div key={idx} className="group">
                            <div className="flex justify-between items-center text-xs mb-1">
                              <span className="font-bold text-gray-650 group-hover:text-indigo-650 transition-colors uppercase tracking-wider">
                                {idx + 1}. {item.category}
                              </span>
                              <span className="font-black text-gray-950 Outfit">
                                {item.currency === 'INR' ? `₹${item.amount.toFixed(2)}` : `${item.currency} ${item.amount.toFixed(2)}`}
                              </span>
                            </div>
                            <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                              <div 
                                className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Overall Column */}
                <div className="space-y-4 text-left">
                  <div className="flex items-center justify-between border-b border-gray-50 pb-2">
                    <span className="text-[10px] font-black text-rose-600 bg-rose-50 px-2 py-0.5 rounded uppercase tracking-wider">
                      All-Time Top 3
                    </span>
                    <span className="text-[10px] text-gray-455 font-bold uppercase">
                      Spend
                    </span>
                  </div>
                  {topOverallCategories.length === 0 ? (
                    <p className="text-xs font-semibold text-gray-400 uppercase italic py-4">No expenses logged</p>
                  ) : (
                    <div className="space-y-3.5">
                      {topOverallCategories.map((item, idx) => {
                        const maxVal = topOverallCategories[0].amount || 1;
                        const percent = (item.amount / maxVal) * 100;
                        return (
                          <div key={idx} className="group">
                            <div className="flex justify-between items-center text-xs mb-1">
                              <span className="font-bold text-gray-655 group-hover:text-rose-650 transition-colors uppercase tracking-wider">
                                {idx + 1}. {item.category}
                              </span>
                              <span className="font-black text-gray-955 Outfit">
                                {item.currency === 'INR' ? `₹${item.amount.toFixed(2)}` : `${item.currency} ${item.amount.toFixed(2)}`}
                              </span>
                            </div>
                            <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                              <div 
                                className="bg-rose-500 h-full rounded-full transition-all duration-300"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Spending Calendar */}
        {!isLoading && todayDateString && (
          <div className="bg-white border border-gray-100/90 rounded-2xl p-6 shadow-sm" data-testid="spend-calendar-panel">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-gray-50 pb-4 mb-4">
              <div>
                <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider flex items-center gap-2">
                  <span>📅</span> Daily Spending Calendar
                </h3>
                <p className="text-xs text-gray-400 font-semibold uppercase mt-0.5">Monthly Spend Heatmap</p>
              </div>
            </div>
            <SpendCalendar
              dailySpendMap={dailySpendMap}
              today={todayDateString}
              onDayClick={setSelectedCalendarDate}
            />
          </div>
        )}

        {/* Day Transaction Popup Modal */}
        {selectedCalendarDate && (() => {
          const dayTxs = dailyTransactionsMap[selectedCalendarDate] ?? [];
          const [year, mon, day] = selectedCalendarDate.split('-');
          const dayLabel = `${day}/${mon}/${year}`;
          const dayTotal = calculateCycleSpendTotal(dayTxs);

          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              role="dialog"
              aria-modal="true"
              aria-label={`Transactions for ${dayLabel}`}
              onClick={() => setSelectedCalendarDate(null)}
            >
              {/* Backdrop */}
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

              {/* Modal panel */}
              <div
                className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                  <div>
                    <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider flex items-center gap-2">
                      <span>📅</span> {dayLabel}
                    </h3>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-0.5">
                      {dayTxs.length} {dayTxs.length === 1 ? 'transaction' : 'transactions'}
                    </p>
                  </div>
                  <button
                    id="calendar-day-modal-close"
                    aria-label="Close day transactions"
                    onClick={() => setSelectedCalendarDate(null)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Transaction list */}
                <div className="overflow-y-auto flex-1 px-6 py-3 space-y-2">
                  {dayTxs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <span className="text-3xl mb-2">🔍</span>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">No transactions on this day</p>
                    </div>
                  ) : (
                    dayTxs.map((tx: any, idx: number) => {
                      const isRefund = tx.transactionType === 'refund';
                      const signed = isRefund ? -tx.amount : tx.amount;
                      return (
                        <div
                          key={tx.id ?? idx}
                          className="flex items-center justify-between gap-3 p-3 rounded-xl bg-gray-50 hover:bg-indigo-50/40 transition-colors border border-gray-100"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-black text-gray-800 truncate">{tx.merchant || 'Unknown'}</p>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              {tx.category && (
                                <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                                  {tx.category}
                                </span>
                              )}
                              {tx.paymentMethod && (
                                <span className="text-[9px] font-bold text-gray-500 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                                  {tx.paymentMethod}
                                </span>
                              )}
                              {isRefund && (
                                <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                                  Refund
                                </span>
                              )}
                            </div>
                          </div>
                          <span className={`text-sm font-black tabular-nums shrink-0 ${
                            isRefund ? 'text-emerald-600' : 'text-gray-900'
                          }`}>
                            {isRefund ? '-' : ''}₹{Math.abs(signed).toFixed(2)}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Footer total */}
                {dayTxs.length > 0 && (
                  <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Total Spend</span>
                    <span className="text-base font-black text-indigo-600">₹{dayTotal.toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

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

        {/* Comparison Trend Graph Card */}
        <div className="w-full bg-white border border-gray-100/90 rounded-2xl p-6 shadow-sm flex flex-col justify-between" data-testid="comparison-trend-panel">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-50 pb-4 mb-4">
            <div>
              <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider">Cycle Comparison Trend</h3>
              <p className="text-xs text-gray-400 font-semibold uppercase mt-0.5">Comparative Billing Cycle Ledger Visualizer</p>
            </div>
            
            {/* View Mode selection: Daily vs Cumulative */}
            <div className="flex bg-gray-100 p-0.5 rounded-xl border border-gray-200/40 self-start sm:self-auto shadow-inner">
              <button
                type="button"
                onClick={() => setChartViewMode('daily')}
                className={`px-3 py-1.5 rounded-lg text-2xs font-extrabold uppercase tracking-wider transition-all duration-150 ${
                  chartViewMode === 'daily'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                data-testid="mode-daily-btn"
              >
                Daily Spend
              </button>
              <button
                type="button"
                onClick={() => setChartViewMode('cumulative')}
                className={`px-3 py-1.5 rounded-lg text-2xs font-extrabold uppercase tracking-wider transition-all duration-150 ${
                  chartViewMode === 'cumulative'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                data-testid="mode-cumulative-btn"
              >
                Cumulative Spend
              </button>
            </div>
          </div>

          {/* Series & Filters Section */}
          <div className="flex flex-col gap-4 mb-6 text-left">
            {/* Series Checkboxes & Dropdown */}
            <div className="flex flex-wrap gap-4 items-center">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Show Cycles:</span>
              <label className="inline-flex items-center gap-2 cursor-pointer group select-none">
                <input
                  type="checkbox"
                  checked={activeSeries.current}
                  onChange={(e) => setActiveSeries({ ...activeSeries, current: e.target.checked })}
                  className="rounded border-gray-300 text-indigo-650 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                  data-testid="checkbox-series-current"
                />
                <span className="text-xs font-bold text-gray-700 group-hover:text-indigo-650 transition-colors uppercase tracking-wider">
                  ● Current Cycle (₹{comparisonChartData.currentTotal.toFixed(0)})
                </span>
              </label>

              {/* Dynamic Dropdown Trigger */}
              <div className="relative inline-block text-left" data-testid="cycle-dropdown-container">
                <button
                  type="button"
                  onClick={() => setIsCycleDropdownOpen(!isCycleDropdownOpen)}
                  className="inline-flex justify-between items-center gap-2 px-3 py-1.5 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50 transition-all shadow-sm cursor-pointer min-w-[220px]"
                  data-testid="cycle-dropdown-btn"
                >
                  <span>Overlay Historical Cycles ({selectedOffsets.length})</span>
                  <svg className={`w-4 h-4 text-gray-400 transform transition-transform duration-200 ${isCycleDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isCycleDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsCycleDropdownOpen(false)}></div>
                    <div
                      className="absolute left-0 mt-1.5 w-64 rounded-xl bg-white border border-gray-150 shadow-xl z-20 max-h-60 overflow-y-auto py-2 flex flex-col text-left"
                      data-testid="cycle-dropdown-menu"
                    >
                      {availableCycles.length === 0 ? (
                        <span className="text-2xs text-gray-400 font-bold px-3 py-1.5 uppercase">No historical data available</span>
                      ) : (
                        availableCycles.map((cycle) => {
                          const isChecked = selectedOffsets.includes(cycle.offset);
                          return (
                            <label
                              key={cycle.offset}
                              className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer select-none transition-colors"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    if (!selectedOffsets.includes(cycle.offset)) {
                                      setSelectedOffsets([...selectedOffsets, cycle.offset]);
                                    }
                                  } else {
                                    setSelectedOffsets(selectedOffsets.filter(o => o !== cycle.offset));
                                  }
                                }}
                                className="rounded border-gray-300 text-indigo-650 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                                data-testid={`checkbox-offset-${cycle.offset}`}
                              />
                              <span className="text-2xs font-extrabold text-gray-750 uppercase tracking-wide">
                                {cycle.label}
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Dynamic Historical Legend Display */}
            {historicalSeries.length > 0 && (
              <div className="flex flex-wrap gap-4 items-center border-t border-gray-50 pt-2.5">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Active Overlays:</span>
                {historicalSeries.map((series) => (
                  <div key={series.offset} className="flex items-center gap-1.5 text-2xs font-extrabold text-gray-600 uppercase tracking-wider" data-testid={`legend-offset-${series.offset}`}>
                    <span className="text-sm leading-none font-extrabold" style={{ color: series.colorInfo.border }}>
                      {series.colorInfo.strokeDash === 'none' ? '■' : series.colorInfo.strokeDash === '4 4' ? '⬡' : '▲'}
                    </span>
                    <span>
                      {series.label} (₹{series.total.toFixed(0)})
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Payment Method Pills */}
            {uniquePaymentMethods.length > 0 && (
              <div className="flex flex-col gap-1.5 border-t border-gray-50 pt-3">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Filter Payment Methods:</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedPaymentMethods(uniquePaymentMethods)}
                      className="text-2xs font-extrabold text-indigo-600 hover:text-indigo-750 uppercase tracking-wider cursor-pointer"
                      data-testid="pms-select-all"
                    >
                      Select All
                    </button>
                    <span className="text-gray-300 text-2xs">|</span>
                    <button
                      type="button"
                      onClick={() => setSelectedPaymentMethods([])}
                      className="text-2xs font-extrabold text-gray-400 hover:text-gray-600 uppercase tracking-wider cursor-pointer"
                      data-testid="pms-clear-all"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-1">
                  {uniquePaymentMethods.map((pm) => {
                    const isSelected = selectedPaymentMethods.includes(pm);
                    return (
                      <button
                        key={pm}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setSelectedPaymentMethods(selectedPaymentMethods.filter((item) => item !== pm));
                          } else {
                            setSelectedPaymentMethods([...selectedPaymentMethods, pm]);
                          }
                        }}
                        className={`px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide border transition-all duration-150 cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm'
                            : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}
                        data-testid={`pm-pill-${pm.split(' ').join('-').toLowerCase()}`}
                      >
                        {pm}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* SVG Multi-Line Chart */}
          {goldTransactions.length === 0 ? (
            <div className="h-56 flex flex-col items-center justify-center text-center py-6">
              <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mb-3 text-gray-400 border border-gray-100">
                📊
              </div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                No verified data to compare
              </p>
            </div>
          ) : (
            <div className="w-full relative mt-2">
              <svg viewBox="0 0 1000 240" className="w-full h-64 overflow-visible select-none">
                {/* Gradients */}
                <defs>
                  <linearGradient id="compCurrentGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="compColorGrad-0" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.1" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="compColorGrad-1" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.1" />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="compColorGrad-2" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.1" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="compColorGrad-3" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#ec4899" stopOpacity="0.1" />
                    <stop offset="100%" stopColor="#ec4899" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="compColorGrad-4" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.1" />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="compColorGrad-5" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#f97316" stopOpacity="0.1" />
                    <stop offset="100%" stopColor="#f97316" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* SVG Chart Grid Lines & Axes */}
                <line x1={60} y1={20} x2={950} y2={20} stroke="#f1f5f9" strokeWidth="1" />
                <line x1={60} y1={110} x2={950} y2={110} stroke="#f1f5f9" strokeWidth="1" />
                <line x1={60} y1={200} x2={950} y2={200} stroke="#cbd5e1" strokeWidth="1.5" />

                {/* Left Y Axis line */}
                <line x1={60} y1={20} x2={60} y2={200} stroke="#cbd5e1" strokeWidth="1" />

                {/* Left Y Axis Ticks */}
                <line x1={55} y1={20} x2={60} y2={20} stroke="#cbd5e1" strokeWidth="1" />
                <line x1={55} y1={110} x2={60} y2={110} stroke="#cbd5e1" strokeWidth="1" />
                <line x1={55} y1={200} x2={60} y2={200} stroke="#cbd5e1" strokeWidth="1" />

                {/* Y Axis Values */}
                <text x={50} y={23} textAnchor="end" fill="#64748b" className="text-[9px] font-bold font-sans">
                  ₹{comparisonChartData.maxVal.toFixed(0)}
                </text>
                <text x={50} y={113} textAnchor="end" fill="#64748b" className="text-[9px] font-bold font-sans">
                  ₹{(comparisonChartData.maxVal / 2).toFixed(0)}
                </text>
                <text x={50} y={203} textAnchor="end" fill="#64748b" className="text-[9px] font-bold font-sans">
                  ₹0
                </text>

                {/* X Axis Ticks and Labels */}
                {(() => {
                  const tickIndexes = [0, 4, 9, 14, 19, 24, Math.min(29, comparisonChartData.daysCount - 1)].filter(
                    (val, idx, self) => self.indexOf(val) === idx && val < comparisonChartData.daysCount
                  );

                  return tickIndexes.map((idxVal) => {
                    const tickX = 60 + idxVal * compStepX;
                    const curPoint = comparisonChartData.currentSpends[idxVal];
                    return (
                      <g key={idxVal}>
                        <line x1={tickX} y1="200" x2={tickX} y2="204" stroke="#cbd5e1" strokeWidth="1" />
                        <text
                          x={tickX}
                          y="216"
                          textAnchor="middle"
                          fill="#475569"
                          className="text-[9px] font-extrabold font-sans"
                        >
                          Day {idxVal + 1}
                        </text>
                        {curPoint && (
                          <text
                            x={tickX}
                            y="227"
                            textAnchor="middle"
                            fill="#94a3b8"
                            className="text-[8px] font-bold font-sans"
                          >
                            {curPoint.date}
                          </text>
                        )}
                      </g>
                    );
                  });
                })()}

                {/* Render Areas */}
                {historicalSeries.map((series) => (
                  series.areaPath && (
                    <path
                      key={`area-${series.offset}`}
                      d={series.areaPath}
                      fill={`url(#compColorGrad-${series.index % HISTORICAL_COLORS.length})`}
                    />
                  )
                ))}
                {activeSeries.current && currentAreaPath && <path d={currentAreaPath} fill="url(#compCurrentGrad)" />}

                {/* Render Lines */}
                {historicalSeries.map((series) => (
                  series.linePath && (
                    <path
                      key={`line-${series.offset}`}
                      d={series.linePath}
                      fill="none"
                      stroke={series.colorInfo.border}
                      strokeWidth="2.5"
                      strokeDasharray={series.colorInfo.strokeDash}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )
                ))}
                {activeSeries.current && currentLinePath && (
                  <path
                    d={currentLinePath}
                    fill="none"
                    stroke="#6366f1"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {/* Guide Line & Points on Hover */}
                {hoveredCompPoint && (
                  <>
                    <line
                      x1={60 + hoveredCompPoint.index * compStepX}
                      y1={20}
                      x2={60 + hoveredCompPoint.index * compStepX}
                      y2={200}
                      stroke="#94a3b8"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                    {activeSeries.current && hoveredCompPoint.currentY !== null && (
                      <circle
                        cx={60 + hoveredCompPoint.index * compStepX}
                        cy={hoveredCompPoint.currentY}
                        r="5.5"
                        fill="#ffffff"
                        stroke="#6366f1"
                        strokeWidth="3"
                      />
                    )}
                    {hoveredCompPoint.histPoints.map((hp: any, sIdx: number) => (
                      hp.y !== null && (
                        <circle
                          key={sIdx}
                          cx={60 + hoveredCompPoint.index * compStepX}
                          cy={hp.y}
                          r="5"
                          fill="#ffffff"
                          stroke={hp.color}
                          strokeWidth="2.5"
                        />
                      )
                    ))}
                  </>
                )}

                {/* Invisible Hover Zone Rectangles */}
                {Array.from({ length: comparisonChartData.daysCount }).map((_, idx) => {
                  const zoneX = 60 + idx * compStepX;
                  const currentVal = comparisonChartData.currentSpends[idx];
                  const currentY = (currentVal && currentVal.amount !== null) ? 200 - (currentVal.amount / comparisonChartData.maxVal) * 180 : null;

                  const histYValues = historicalSeries.map(series => {
                    const pt = series.spends[idx];
                    return (pt && pt.amount !== null) ? 200 - (pt.amount / comparisonChartData.maxVal) * 180 : null;
                  });

                  return (
                    <rect
                      key={idx}
                      x={zoneX - compStepX / 2}
                      y={20}
                      width={compStepX}
                      height={180}
                      fill="transparent"
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredCompPoint({
                        index: idx,
                        x: zoneX,
                        currentY,
                        currentVal,
                        histPoints: historicalSeries.map((series, sIdx) => ({
                          label: series.label,
                          color: series.colorInfo.border,
                          val: series.spends[idx],
                          y: histYValues[sIdx]
                        }))
                      })}
                      onMouseLeave={() => setHoveredCompPoint(null)}
                    />
                  );
                })}
              </svg>

              {/* Dynamic HTML Tooltip */}
              {hoveredCompPoint && (
                <div
                  style={{
                    left: `${(hoveredCompPoint.x / 1000) * 100}%`,
                    top: '30%',
                  }}
                  className="absolute transform -translate-x-1/2 -translate-y-1/2 bg-slate-900 text-white text-[10px] sm:text-xs font-bold rounded-xl p-3 shadow-2xl border border-slate-800 pointer-events-none transition-all duration-100 z-10 flex flex-col gap-1.5 min-w-[180px] text-left"
                >
                  <div className="border-b border-slate-800 pb-1 font-black text-center text-xs text-indigo-400">
                    Day {hoveredCompPoint.index + 1}
                  </div>
                  {activeSeries.current && hoveredCompPoint.currentVal && hoveredCompPoint.currentVal.amount !== null && (
                    <div className="flex justify-between gap-4 items-center">
                      <span className="text-slate-400 font-medium">Current ({hoveredCompPoint.currentVal.date}):</span>
                      <span className="font-extrabold text-indigo-300">₹{hoveredCompPoint.currentVal.amount.toFixed(2)}</span>
                    </div>
                  )}
                  {hoveredCompPoint.histPoints.map((hp: any, sIdx: number) => (
                    hp.val && hp.val.amount !== null && (
                      <div key={sIdx} className="flex justify-between gap-4 items-center">
                        <span className="text-slate-400 font-medium">{hp.label}:</span>
                        <span className="font-extrabold" style={{ color: hp.color }}>₹{hp.val.amount.toFixed(2)}</span>
                      </div>
                    )
                  ))}
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

        {/* Cycle Override Configuration Modal */}
        <CycleOverrideModal
          isOpen={isCycleModalOpen}
          onClose={() => setIsCycleModalOpen(false)}
          cycle={selectedCycle || activeCycle}
          transactions={(goldTransactions || []).map((tx: any) => ({
            id: tx.id,
            merchant: tx.merchant,
            amount: tx.amount,
            currency: tx.currency,
            transactionDate: tx.transactionDate,
            sourceReceivedAt: tx.sourceReceivedAt,
            category: tx.category,
          }))}
          onSaveOverride={async (payload) => {
            await setCycleOverride(payload);
          }}
          onResetDefault={async (cycleId) => {
            await removeCycleOverride(cycleId);
          }}
        />
      </div>
    </div>
  );
};

export default Dashboard;
