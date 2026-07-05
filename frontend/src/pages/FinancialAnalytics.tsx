import React, { useState, useEffect } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { getActiveCycleRange } from '../utils/transaction-helper';
import {
  calculateDiscretionarySpend,
  calculateRunRateForecast,
  calculateDayOfMonthPeaks,
  calculateDayOfWeekPeaks,
  detectRecurringBills,
  getDaysDiff
} from '../utils/analytics-helper';
import type {
  RunRateForecastResult,
  DayPeakPoint,
  DayOfWeekPeakPoint,
  RecurringBillPrediction,
  DetectionFrequency
} from '../utils/analytics-helper';

// Helpers for recurring bills formatting
const getRelativeDueText = (predictedNextDate: string, todayStr: string) => {
  const today = new Date(todayStr);
  const next = new Date(predictedNextDate);
  const diffTime = next.getTime() - today.getTime();
  const diff = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diff < 0) {
    return { text: `Overdue by ${Math.abs(diff)}d`, status: 'overdue' };
  } else if (diff === 0) {
    return { text: 'Due Today', status: 'today' };
  } else if (diff <= 5) {
    return { text: `Due in ${diff}d`, status: 'soon' };
  } else {
    return { text: `Due in ${diff}d`, status: 'upcoming' };
  }
};

const getBillingProgress = (lastDateStr: string, predictedNextDate: string, todayStr: string) => {
  const last = new Date(lastDateStr).getTime();
  const next = new Date(predictedNextDate).getTime();
  const current = new Date(todayStr).getTime();
  if (next <= last) return 0;
  const total = next - last;
  const elapsed = current - last;
  const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
  return Math.round(pct);
};

const FinancialAnalytics: React.FC = () => {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [fixedCharges, setFixedCharges] = useState<any[]>([]);
  const [billingCycleStartDay, setBillingCycleStartDay] = useState(17);
  const [expectedSalary, setExpectedSalary] = useState(100000);
  const [primaryCurrency, setPrimaryCurrency] = useState('INR');
  
  // Slider State (default target consumption limit is 50%)
  const [targetBudgetPercent, setTargetBudgetPercent] = useState<number>(() => {
    const saved = localStorage.getItem('analytics_target_budget_percent');
    return saved ? parseInt(saved, 10) : 50;
  });

  const [isLoading, setIsLoading] = useState(true);
  const [calcExplanationType, setCalcExplanationType] = useState<'target' | 'actual' | null>(null);
  const [selectedBillForExplanation, setSelectedBillForExplanation] = useState<RecurringBillPrediction | null>(null);
  const [detectionFrequency, setDetectionFrequency] = useState<DetectionFrequency>('monthly');
  const [hoveredDOM, setHoveredDOM] = useState<DayPeakPoint | null>(null);
  const [hoveredDOW, setHoveredDOW] = useState<DayOfWeekPeakPoint | null>(null);

  // Load backend data
  useEffect(() => {
    const loadData = async () => {
      let authHeaders = {};
      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString();
        if (token) {
          authHeaders = { 'Authorization': `Bearer ${token}` };
        }
      } catch (err) {
        console.warn('Failed to fetch auth session:', err);
      }

      Promise.all([
        fetch('/api/pipeline/gold-transactions', { headers: authHeaders }).then(res => res.json()).catch(() => ({ transactions: [] })),
        fetch('/api/pipeline/user-preferences', { headers: authHeaders }).then(res => res.json()).catch(() => ({ billingCycleStartDay: 17, expectedSalary: 100000 })),
        fetch('/api/pipeline/fixed-charges', { headers: authHeaders }).then(res => res.json()).catch(() => ({ fixedCharges: [] })),
      ])
        .then(([gold, prefs, fc]) => {
          const goldTxs = gold.transactions || [];
          setTransactions(goldTxs);
          setBillingCycleStartDay(prefs.billingCycleStartDay ?? 17);
          setExpectedSalary(prefs.expectedSalary ?? 100000);
          setFixedCharges(fc.fixedCharges || []);

          if (goldTxs.length > 0) {
            const counts: Record<string, number> = {};
            goldTxs.forEach((tx: any) => {
              if (tx.currency) counts[tx.currency] = (counts[tx.currency] || 0) + 1;
            });
            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            if (sorted.length > 0) {
              setPrimaryCurrency(sorted[0][0]);
            }
          }
          setIsLoading(false);
        })
        .catch(err => {
          console.error('Error loading analytics data:', err);
          setIsLoading(false);
        });
    };

    loadData();
  }, []);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    setTargetBudgetPercent(value);
    localStorage.setItem('analytics_target_budget_percent', String(value));
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-650 border-t-transparent"></div>
        <p className="text-gray-500 font-medium Outfit">Analyzing transaction history...</p>
      </div>
    );
  }

  // Get active cycle range
  const cycleRange = getActiveCycleRange(billingCycleStartDay);
  
  // Format today's date safely in local time
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Compute active fixed charges and net savings forecast
  const activeFixedCharges = (fixedCharges || []).filter((fc: any) => {
    return fc.startDate <= cycleRange.end && fc.endDate >= cycleRange.start;
  });
  const totalFixedCharges = activeFixedCharges.reduce((sum: number, fc: any) => sum + fc.amount, 0);

  // Computations
  const discretionarySpent = calculateDiscretionarySpend(transactions, cycleRange.start, cycleRange.end);
  const forecast: RunRateForecastResult = calculateRunRateForecast(
    discretionarySpent,
    expectedSalary,
    targetBudgetPercent,
    cycleRange,
    todayStr,
    totalFixedCharges
  );

  const dayOfMonthPeaks: DayPeakPoint[] = calculateDayOfMonthPeaks(transactions);
  const dayOfWeekPeaks: DayOfWeekPeakPoint[] = calculateDayOfWeekPeaks(transactions);
  const recurringBills: RecurringBillPrediction[] = detectRecurringBills(transactions, todayStr, detectionFrequency);

  // Calculate monthly burden total (normalizing weekly/quarterly charges to a monthly rate)
  const monthlyBurdenTotal = recurringBills.reduce((sum, bill) => sum + (bill.averageAmount * (30 / bill.frequencyDays)), 0);
  const monthlyBurdenPercent = expectedSalary > 0 ? (monthlyBurdenTotal / expectedSalary) * 100 : 0;

  // Currency formatting helper
  const formatCurrency = (val: number) => {
    if (primaryCurrency === 'INR') {
      return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `${primaryCurrency} ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatDate = (dateStr: string) => {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // Find max peak for DOM graph scaling
  const maxDOMAmount = Math.max(...dayOfMonthPeaks.map(p => p.amount), 1);
  const maxDOWAmount = Math.max(...dayOfWeekPeaks.map(p => p.amount), 1);

  // Order Day of Month peaks chronologically by billing cycle
  const cycleOrderedDOMPeaks = [
    ...dayOfMonthPeaks.filter(p => p.day >= billingCycleStartDay),
    ...dayOfMonthPeaks.filter(p => p.day < billingCycleStartDay)
  ];

  // Calculate average daily outflows
  const totalDOMAmount = dayOfMonthPeaks.reduce((sum, p) => sum + p.amount, 0);
  const avgDOMAmount = totalDOMAmount / 31;

  const totalDOWAmount = dayOfWeekPeaks.reduce((sum, p) => sum + p.amount, 0);
  const avgDOWAmount = totalDOWAmount / 7;

  // Percentage variance calculation helper
  const getPercentDiffText = (amount: number, avg: number) => {
    if (avg <= 0) return '';
    const diffPct = Math.round(((amount - avg) / avg) * 100);
    if (diffPct === 0) return ' (Avg)';
    return ` (${diffPct > 0 ? '+' : ''}${diffPct}% vs Avg)`;
  };

  // Weekend bias format helper
  const getWeekendBiasText = (amount: number, weekendAmount: number) => {
    if (amount <= 0 || weekendAmount <= 0) return '';
    const biasPct = Math.min(100, Math.max(0, Math.round((weekendAmount / amount) * 100)));
    if (biasPct <= 10) return '';
    return ` • ${biasPct}% weekend spend`;
  };

  // Compute days difference between exhaustion and cycle end date
  const daysBeforeEnd = forecast.exhaustionDate
    ? Math.max(0, getDaysDiff(forecast.exhaustionDate, cycleRange.end) - 1)
    : 0;

  const netSavingsTarget = expectedSalary - totalFixedCharges - forecast.targetBudget;
  const netSavingsProjected = expectedSalary - totalFixedCharges - forecast.projectedSpend;

  return (
    <div className="max-w-7xl mx-auto space-y-8 w-full px-2 sm:px-0">
      
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-2 md:space-y-0">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent Outfit">
            Financial Analytics & Predictions
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Predictive forecasts, recurring bill patterns, and peak outflow analysis computed from your ledger history.
          </p>
        </div>
        <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-2 text-indigo-850 text-xs font-bold Outfit">
          Billing Cycle: {formatDate(cycleRange.start)} &ndash; {formatDate(cycleRange.end)}
        </div>
      </div>

      {/* Top Section Grid: Configurator and Stats Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Slider Card */}
        <div className="lg:col-span-1 bg-white/75 backdrop-blur-md border border-gray-100 shadow-sm rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-black text-gray-900 Outfit">Deferred Card Spend Goal</h2>
            <p className="text-xs text-gray-500 mt-1 mb-6">
              Adjust your target limit for Credit & RuPay card consumption spending this cycle (calculated against your Expected Monthly Salary: <span className="font-bold">{formatCurrency(expectedSalary)}</span>).
            </p>
            
            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-gray-650">Card Spend Limit</span>
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">of Monthly Salary</span>
                </div>
                <span className="text-xl font-extrabold text-indigo-600 Outfit">
                  {targetBudgetPercent}%
                </span>
              </div>
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={targetBudgetPercent}
                onChange={handleSliderChange}
                className="w-full h-2 bg-indigo-50 rounded-lg appearance-none cursor-pointer accent-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                data-testid="target-budget-slider"
              />
              <div className="flex justify-between text-2xs text-gray-400 font-bold tracking-wide">
                <span>10%</span>
                <span>50% (Default)</span>
                <span>100%</span>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-4 border-t border-gray-50 flex flex-col space-y-2 text-xs">
            <div className="flex justify-between items-center text-gray-400 font-medium">
              <span>Expected Salary:</span>
              <span className="font-bold text-gray-650 Outfit">{formatCurrency(expectedSalary)}</span>
            </div>
            <div className="flex justify-between items-center text-gray-400 font-medium border-b border-gray-50 pb-1">
              <span>Active Fixed Charges:</span>
              <span className="font-bold text-gray-650 Outfit" data-testid="active-fixed-charges-amount">
                {formatCurrency(totalFixedCharges)}
              </span>
            </div>
            <div className="flex justify-between items-center pt-1">
              <span className="text-gray-555 font-medium">Goal Amount (Card Cap):</span>
              <span className="font-extrabold text-gray-950 Outfit" data-testid="target-budget-amount">
                {formatCurrency(forecast.targetBudget)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500 font-medium">Card Spend Outlook:</span>
              <span className={`font-extrabold Outfit text-sm ${forecast.isExceeding ? 'text-rose-650' : 'text-emerald-700'}`} data-testid="projected-savings-amount">
                {forecast.isExceeding 
                  ? `Overspend: ${formatCurrency(forecast.projectedSpend - forecast.targetBudget)}`
                  : `Surplus: ${formatCurrency(forecast.targetBudget - forecast.projectedSpend)}`
                }
              </span>
            </div>
            <div className="flex justify-between items-center mt-1 pt-1 border-t border-gray-50/50">
              <span className="text-gray-500 font-medium flex items-center">
                Target Salary Surplus:
                {netSavingsTarget < 0 && (
                  <span className="ml-1.5 bg-rose-50 border border-rose-100 text-rose-600 text-[9px] font-extrabold px-1.5 py-0.5 rounded shadow-2xs Outfit uppercase tracking-wider animate-pulse" data-testid="target-deficit-warning-badge">
                    ⚠️ Deficit Risk
                  </span>
                )}
                <span className="group relative ml-1 cursor-help text-gray-400 hover:text-gray-600">
                  ℹ️
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 bg-gray-900 text-white text-3xs p-2 rounded shadow leading-normal z-25">
                    Remaining savings from next salary if you spend exactly up to your target card budget limit.
                  </span>
                </span>
              </span>
              <button
                onClick={() => setCalcExplanationType('target')}
                className={`font-bold Outfit text-xs px-1.5 py-0.5 rounded transition-colors ${
                  netSavingsTarget < 0 
                    ? 'text-rose-650 hover:bg-rose-50' 
                    : 'text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50/50'
                }`}
                data-testid="net-savings-target"
                title="Click to view calculation breakdown"
              >
                {formatCurrency(netSavingsTarget)} ↗
              </button>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-indigo-900 font-extrabold flex items-center">
                Projected Salary Surplus:
                <span className="group relative ml-1 cursor-help text-indigo-400 hover:text-indigo-650">
                  ℹ️
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 bg-gray-900 text-white text-3xs p-2 rounded shadow leading-normal z-25">
                    Expected savings from next salary based on credit card run-rate.
                  </span>
                </span>
              </span>
              <button
                onClick={() => setCalcExplanationType('actual')}
                className={`font-extrabold Outfit text-base px-2 py-0.5 rounded transition-all shadow-2xs ${
                  netSavingsProjected < 0 
                    ? 'text-rose-650 hover:bg-rose-50' 
                    : 'text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50/50 border border-emerald-100'
                }`}
                data-testid="net-savings-forecast"
                title="Click to view calculation breakdown"
              >
                {formatCurrency(netSavingsProjected)} ↗
              </button>
            </div>
          </div>
        </div>

        {/* Forecast Card */}
        <div className="lg:col-span-2 bg-white/75 backdrop-blur-md border border-gray-100 shadow-sm rounded-2xl p-6 grid grid-cols-2 sm:grid-cols-4 gap-6">
          <div className="flex flex-col justify-center">
            <span className="text-2xs font-extrabold text-gray-400 uppercase tracking-widest">Card Spent</span>
            <span className="text-xl font-black text-gray-900 Outfit mt-1" data-testid="discretionary-spent-value">
              {formatCurrency(discretionarySpent)}
            </span>
            <span className="text-2xs text-gray-400 mt-0.5">This cycle to date</span>
          </div>
          
          <div className="flex flex-col justify-center">
            <span className="text-2xs font-extrabold text-gray-400 uppercase tracking-widest">Current Run-Rate</span>
            <span className="text-xl font-black text-gray-900 Outfit mt-1" data-testid="daily-velocity-value">
              {formatCurrency(forecast.dailyVelocity)}/day
            </span>
            <span className="text-2xs text-gray-400 mt-0.5">Average speed ({forecast.elapsedDays}d elapsed)</span>
          </div>

          <div className="flex flex-col justify-center">
            <span className="text-2xs font-extrabold text-gray-400 uppercase tracking-widest">Projected Card Outlay</span>
            <span className={`text-xl font-black Outfit mt-1 ${forecast.isExceeding ? 'text-rose-600' : 'text-emerald-600'}`} data-testid="projected-spend-value">
              {formatCurrency(forecast.projectedSpend)}
            </span>
            <span className="text-2xs text-gray-400 mt-0.5">Estimated end total</span>
          </div>

          <div className="flex flex-col justify-center">
            <span className="text-2xs font-extrabold text-gray-400 uppercase tracking-widest">Cycle Survival</span>
            <span className="text-xl font-black text-gray-900 Outfit mt-1">
              {forecast.remainingDays} days
            </span>
            <span className="text-2xs text-gray-400 mt-0.5">Remaining in cycle</span>
          </div>
        </div>

      </div>

      {/* Callout Action Warning / Success Box */}
      <div className={`border rounded-2xl p-6 shadow-sm backdrop-blur-sm transition-all duration-300 ${
        forecast.isExceeding 
          ? 'bg-rose-50/70 border-rose-100 text-rose-950' 
          : netSavingsTarget < 0
            ? 'bg-amber-50/70 border-amber-100 text-amber-950'
            : 'bg-emerald-50/70 border-emerald-100 text-emerald-950'
      }`} data-testid="forecast-callout">
        {forecast.isExceeding ? (
          forecast.projectedSpend > forecast.sustainableCap ? (
            <div className="flex items-start space-x-3">
              <div className="p-2 bg-rose-100 rounded-lg text-rose-700 mt-0.5 shadow-sm">
                🚨
              </div>
              <div>
                <h3 className="font-extrabold text-base Outfit">Projected Deficit Risk</h3>
                <p className="text-xs text-rose-900/90 mt-1 leading-relaxed">
                  At your current run-rate of <span className="font-bold">{formatCurrency(forecast.dailyVelocity)}/day</span>, your projected card outlay of <span className="font-bold">{formatCurrency(forecast.projectedSpend)}</span> combined with your fixed charges (<span className="font-bold">{formatCurrency(totalFixedCharges)}</span>) exceeds your expected salary. This will result in a deficit of <span className="font-bold text-rose-750">{formatCurrency(forecast.projectedSpend + totalFixedCharges - expectedSalary)}</span>.
                </p>
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-4 bg-white/50 rounded-xl p-3 border border-rose-100/60 max-w-2xl text-xs text-rose-950">
                  <span className="font-semibold uppercase tracking-wider text-3xs text-rose-700">Required Action</span>
                  <span>
                    Reduce card spending strictly to <span className="font-extrabold text-rose-800" data-testid="recommended-rate-value">{formatCurrency(forecast.recommendedDailyRate)}/day</span> for the remaining {forecast.remainingDays} days to eliminate the deficit risk.
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-start space-x-3">
              <div className="p-2 bg-rose-100 rounded-lg text-rose-700 mt-0.5 shadow-sm">
                ⚠️
              </div>
              <div>
                <h3 className="font-extrabold text-base Outfit">Budget Exhaustion Warning</h3>
                <p className="text-xs text-rose-900/90 mt-1 leading-relaxed">
                  At your current run-rate of <span className="font-bold">{formatCurrency(forecast.dailyVelocity)}/day</span>, you are projected to exhaust your target card budget of <span className="font-bold">{formatCurrency(forecast.targetBudget)}</span> on <span className="font-bold underline text-rose-800" data-testid="exhaustion-date-text">{forecast.exhaustionDate ? formatDate(forecast.exhaustionDate) : 'N/A'}</span>. This is approximately <span className="font-bold">{daysBeforeEnd} days</span> before the current cycle ends.
                </p>
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-4 bg-white/50 rounded-xl p-3 border border-rose-100/60 max-w-2xl text-xs text-rose-950">
                  <span className="font-semibold uppercase tracking-wider text-3xs text-rose-700">Recommended Action</span>
                  <span>
                    Reduce card spending to <span className="font-extrabold text-indigo-750" data-testid="recommended-rate-value">{formatCurrency(forecast.recommendedDailyRate)}/day</span> for the remaining {forecast.remainingDays} days to stay strictly within target.
                  </span>
                </div>
              </div>
            </div>
          )
        ) : (
          netSavingsTarget < 0 ? (
            <div className="flex items-start space-x-3">
              <div className="p-2 bg-amber-100 rounded-lg text-amber-700 mt-0.5 shadow-sm">
                ⚠️
              </div>
              <div>
                <h3 className="font-extrabold text-base Outfit">Deferred Card Cap Too High</h3>
                <p className="text-xs text-amber-900/90 mt-1 leading-relaxed">
                  Your configured card spend limit of <span className="font-bold">{formatCurrency(forecast.targetBudget)}</span> plus fixed charges (<span className="font-bold">{formatCurrency(totalFixedCharges)}</span>) exceeds your expected salary. Although your current spending is safe, spending up to your target cap will cause a deficit.
                </p>
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-4 bg-white/50 rounded-xl p-3 border border-amber-250/60 max-w-2xl text-xs text-amber-950">
                  <span className="font-semibold uppercase tracking-wider text-3xs text-amber-700">Sustainable Margin</span>
                  <span>
                    Keep card spending strictly below <span className="font-extrabold text-indigo-750" data-testid="recommended-rate-value">{formatCurrency(forecast.recommendedDailyRate)}/day</span> to avoid running into a deficit.
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-start space-x-3">
              <div className="p-2 bg-emerald-100 rounded-lg text-emerald-700 mt-0.5 shadow-sm">
                🎉
              </div>
              <div>
                <h3 className="font-extrabold text-base Outfit">Budget Outlook Safe</h3>
                <p className="text-xs text-emerald-900/90 mt-1 leading-relaxed">
                  You are spending responsibly! You are projected to finish the billing cycle with an estimated card budget surplus of <span className="font-extrabold text-emerald-800" data-testid="surplus-value">{formatCurrency(forecast.targetBudget - forecast.projectedSpend)}</span> under your cap.
                </p>
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-4 bg-white/50 rounded-xl p-3 border border-emerald-100/60 max-w-2xl text-xs text-emerald-950">
                  <span className="font-semibold uppercase tracking-wider text-3xs text-emerald-700">Healthy Margin</span>
                  <span>
                    You have a maximum spending limit of <span className="font-extrabold text-indigo-750" data-testid="recommended-rate-value">{formatCurrency(forecast.recommendedDailyRate)}/day</span> remaining for this cycle.
                  </span>
                </div>
              </div>
            </div>
          )
        )}
      </div>

      {/* Outflow Peaks (Periodicity) charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Day of Month Peaks */}
        <div className="bg-white/75 backdrop-blur-md border border-gray-100 shadow-sm rounded-2xl p-6">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-base font-extrabold text-gray-900 Outfit">Outflow Peaks by Day of Month</h3>
              <p className="text-2xs text-gray-400 mt-0.5 mb-6">
                Aggregated historical spending across days 1–31 to identify monthly peaks.
              </p>
            </div>
            {hoveredDOM ? (
              <div className="bg-indigo-50 border border-indigo-100 text-indigo-700 text-3xs font-extrabold px-2 py-1 rounded-lg Outfit animate-pulse" data-testid="dom-hover-badge">
                Day {hoveredDOM.day}: {formatCurrency(hoveredDOM.amount)}{getPercentDiffText(hoveredDOM.amount, avgDOMAmount)}{getWeekendBiasText(hoveredDOM.amount, hoveredDOM.weekendAmount)}
              </div>
            ) : (
              <div className="text-3xs text-gray-350 px-2 py-1 select-none">
                Hover bars to inspect
              </div>
            )}
          </div>

          <div className="h-44 relative pt-4">
            {/* Average Reference Line */}
            {maxDOMAmount > 0 && avgDOMAmount > 0 && (
              <div 
                className="absolute left-0 right-0 border-t border-dashed border-indigo-400/40 pointer-events-none z-10 flex items-center justify-between font-sans"
                style={{ bottom: `calc(1.5rem + ${(avgDOMAmount / maxDOMAmount) * 80}%)` }}
                data-testid="dom-average-line"
              >
                <span className="bg-indigo-50/90 text-[8px] font-bold text-indigo-500 px-1 rounded-r border border-indigo-100/50 shadow-3xs Outfit uppercase">
                  AVG: {formatCurrency(avgDOMAmount)}
                </span>
              </div>
            )}

            <div className="h-36 flex items-end justify-between space-x-0.5 sm:space-x-1 select-none overflow-x-auto pb-1 relative z-0">
              {cycleOrderedDOMPeaks.map(p => {
                const heightPct = maxDOMAmount > 0 ? (p.amount / maxDOMAmount) * 80 : 0;
                const isWeekendSkewed = p.amount > 0 && (p.weekendAmount / p.amount) >= 0.7;
                return (
                  <div key={p.day} className="flex-1 flex flex-col justify-end items-center min-w-[8px] h-full">
                    <div
                      className="w-full bg-indigo-100 hover:bg-indigo-600 rounded-t transition-all duration-300 relative group cursor-pointer"
                      style={{ height: `${Math.max(4, heightPct)}%` }}
                      onMouseEnter={() => setHoveredDOM(p)}
                      onMouseLeave={() => setHoveredDOM(null)}
                      data-testid={`dom-bar-${p.day}`}
                    >
                      {isWeekendSkewed && (
                        <div 
                          className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shadow-3xs" 
                          title="Weekend-skewed spending date (>70% on Fri-Sun)" 
                          data-testid={`weekend-marker-${p.day}`}
                        />
                      )}
                    </div>
                    <span className="text-[9px] text-gray-400 font-bold mt-1.5">{p.day}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex justify-between text-3xs text-gray-400 font-semibold mt-1 tracking-wider uppercase">
            <span>Cycle Start (Day {billingCycleStartDay})</span>
            <span>Cycle End (Day {billingCycleStartDay === 1 ? 31 : billingCycleStartDay - 1})</span>
          </div>
          <div className="text-[9px] text-gray-400 mt-2.5 pt-1.5 border-t border-gray-100/50 flex items-center space-x-1 Outfit select-none">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
            <span>Indicates calendar dates where &gt;70% of historical spending occurred on weekends (Fri–Sun).</span>
          </div>
        </div>

        {/* Day of Week Peaks */}
        <div className="bg-white/75 backdrop-blur-md border border-gray-100 shadow-sm rounded-2xl p-6">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-base font-extrabold text-gray-900 Outfit">Weekly Spend Patterns</h3>
              <p className="text-2xs text-gray-400 mt-0.5 mb-6">
                Aggregated historical spending by day of week.
              </p>
            </div>
            {hoveredDOW ? (
              <div className="bg-purple-50 border border-purple-100 text-purple-700 text-3xs font-extrabold px-2 py-1 rounded-lg Outfit animate-pulse" data-testid="dow-hover-badge">
                {hoveredDOW.dayName}: {formatCurrency(hoveredDOW.amount)}{getPercentDiffText(hoveredDOW.amount, avgDOWAmount)}
              </div>
            ) : (
              <div className="text-3xs text-gray-350 px-2 py-1 select-none">
                Hover bars to inspect
              </div>
            )}
          </div>

          <div className="h-44 relative pt-4">
            {/* Average Reference Line */}
            {maxDOWAmount > 0 && avgDOWAmount > 0 && (
              <div 
                className="absolute left-0 right-0 border-t border-dashed border-purple-400/40 pointer-events-none z-10 flex items-center justify-between font-sans"
                style={{ bottom: `calc(1.5rem + ${(avgDOWAmount / maxDOWAmount) * 80}%)` }}
                data-testid="dow-average-line"
              >
                <span className="bg-purple-50/90 text-[8px] font-bold text-purple-500 px-1 rounded-r border border-purple-100/50 shadow-3xs Outfit uppercase">
                  AVG: {formatCurrency(avgDOWAmount)}
                </span>
              </div>
            )}

            <div className="h-36 flex items-end justify-around select-none pb-1 relative z-0">
              {dayOfWeekPeaks.map(p => {
                const heightPct = maxDOWAmount > 0 ? (p.amount / maxDOWAmount) * 80 : 0;
                return (
                  <div key={p.dayName} className="w-10 flex flex-col justify-end items-center h-full">
                    <div
                      className="w-6 bg-purple-100 hover:bg-purple-600 rounded-t transition-all duration-300 relative group cursor-pointer"
                      style={{ height: `${Math.max(4, heightPct)}%` }}
                      onMouseEnter={() => setHoveredDOW(p)}
                      onMouseLeave={() => setHoveredDOW(null)}
                      data-testid={`dow-bar-${p.dayName}`}
                    />
                    <span className="text-xs text-gray-500 font-bold mt-2 Outfit">{p.dayName}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Predicted Recurring Outflows */}
      <div className="bg-white/75 backdrop-blur-md border border-gray-100 shadow-sm rounded-2xl p-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
          <div className="space-y-1">
            <h3 className="text-base font-extrabold text-gray-900 Outfit">Predicted Recurring Bills & Subscriptions</h3>
            <p className="text-2xs text-gray-400">
              {detectionFrequency === 'weekly' && 'Weekly outflows (6–8 days intervals) automatically identified from transaction logs.'}
              {detectionFrequency === 'biweekly' && 'Bi-weekly outflows (13–15 days intervals) automatically identified from transaction logs.'}
              {detectionFrequency === 'monthly' && 'Monthly outflows (25–35 days intervals) automatically identified from transaction logs.'}
              {detectionFrequency === 'quarterly' && 'Quarterly outflows (85–95 days intervals) automatically identified from transaction logs.'}
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-4">
            <div className="bg-gray-100 p-0.5 rounded-lg flex space-x-0.5 border border-gray-200/50 text-2xs font-bold Outfit" data-testid="frequency-filter-group">
              {(['weekly', 'biweekly', 'monthly', 'quarterly'] as DetectionFrequency[]).map(freq => (
                <button
                  key={freq}
                  onClick={() => setDetectionFrequency(freq)}
                  className={`px-3 py-1.5 rounded-md transition-all ${
                    detectionFrequency === freq
                      ? 'bg-white text-indigo-700 shadow-xs'
                      : 'text-gray-500 hover:text-gray-800 hover:bg-white/40'
                  }`}
                  data-testid={`filter-${freq}`}
                >
                  {freq === 'weekly' && 'Weekly'}
                  {freq === 'biweekly' && 'Bi-Weekly'}
                  {freq === 'monthly' && 'Monthly'}
                  {freq === 'quarterly' && 'Quarterly'}
                </button>
              ))}
            </div>

            {recurringBills.length > 0 && (
              <div className="flex items-center space-x-4 bg-indigo-50/50 border border-indigo-100/50 rounded-xl px-4 py-2">
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-500">Monthly Commitment</span>
                  <span className="text-sm font-black text-indigo-950 Outfit mt-0.5">
                    {formatCurrency(monthlyBurdenTotal)}/mo
                  </span>
                </div>
                <div className="h-6 w-px bg-indigo-200/50"></div>
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-500">Salary Share</span>
                  <span className="text-sm font-black text-indigo-950 Outfit mt-0.5">
                    {monthlyBurdenPercent.toFixed(1)}%
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {recurringBills.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-xs border border-dashed border-gray-150 rounded-xl bg-gray-50/20">
            No recurring {detectionFrequency} payment patterns identified yet. Try changing the frequency filter above or ingest more transactions.
          </div>
        ) : (
          <div className="overflow-hidden border border-gray-100/80 rounded-xl shadow-xs">
            <table className="w-full text-left border-collapse bg-white">
              <thead>
                <tr className="bg-gray-50/50 border-b border-gray-100 text-3xs font-extrabold uppercase tracking-widest text-gray-400">
                  <th className="px-6 py-3.5">Merchant</th>
                  <th className="px-6 py-3.5">Est. Billing Amount</th>
                  <th className="px-6 py-3.5">Billing Period Progress</th>
                  <th className="px-6 py-3.5">Frequency</th>
                  <th className="px-6 py-3.5 text-right">Status & Next Occurrence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 text-xs">
                {recurringBills.map(bill => {
                  const relative = getRelativeDueText(bill.predictedNextDate, todayStr);
                  const progress = getBillingProgress(bill.lastDate, bill.predictedNextDate, todayStr);
                  
                  return (
                    <tr key={bill.merchant} className="hover:bg-gray-50/40 transition-colors" data-testid="recurring-bill-row">
                      <td className="px-6 py-4 flex items-center space-x-2">
                        <button
                          onClick={() => setSelectedBillForExplanation(bill)}
                          className="font-extrabold text-gray-900 Outfit hover:text-indigo-650 underline decoration-dotted hover:decoration-solid transition-colors text-left"
                          title="Click to see why this was detected"
                          data-testid="explain-merchant-button"
                        >
                          {bill.merchant}
                        </button>
                        <span className="bg-indigo-50 text-indigo-750 text-[10px] font-black uppercase px-2 py-0.5 rounded-full tracking-wider border border-indigo-100/60 shadow-2xs">
                          {detectionFrequency === 'weekly' && 'Weekly'}
                          {detectionFrequency === 'biweekly' && 'Bi-Weekly'}
                          {detectionFrequency === 'monthly' && 'Monthly'}
                          {detectionFrequency === 'quarterly' && 'Quarterly'}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-semibold text-gray-650 Outfit">
                        {formatCurrency(bill.averageAmount)}
                      </td>
                      <td className="px-6 py-4 min-w-[140px] max-w-[200px]">
                        <div className="flex items-center space-x-2">
                          <div className="flex-grow w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                            <div 
                              className={`h-1.5 rounded-full transition-all duration-300 ${
                                relative.status === 'overdue' ? 'bg-rose-500' :
                                relative.status === 'today' ? 'bg-amber-500' :
                                relative.status === 'soon' ? 'bg-amber-400' : 'bg-indigo-500'
                              }`}
                              style={{ width: `${progress}%` }}
                            ></div>
                          </div>
                          <span className="text-[10px] font-extrabold text-gray-400 min-w-[28px] text-right Outfit">{progress}%</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-500">
                        Every {bill.frequencyDays} days
                      </td>
                      <td className="px-6 py-4 text-right flex flex-col items-end space-y-1">
                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md tracking-wider border shadow-2xs ${
                          relative.status === 'overdue' ? 'bg-rose-50 border-rose-200 text-rose-700' :
                          relative.status === 'today' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                          relative.status === 'soon' ? 'bg-amber-50/50 border-amber-250 text-amber-850' :
                          'bg-indigo-50 border-indigo-200 text-indigo-700'
                        }`}>
                          {relative.text}
                        </span>
                        <span className="text-2xs text-gray-400 font-medium font-mono" data-testid="predicted-next-date">
                          {formatDate(bill.predictedNextDate)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {calcExplanationType && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4" data-testid="calc-modal-backdrop">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-150 max-w-md w-full p-6 space-y-6 animate-in fade-in zoom-in-95 duration-200" data-testid="calc-explanation-modal">
            <div className="flex justify-between items-start">
              <h3 className="text-lg font-black text-gray-900 Outfit" data-testid="modal-title">
                {calcExplanationType === 'target' ? 'Target Salary Surplus Breakdown' : 'Projected Salary Surplus Breakdown'}
              </h3>
              <button 
                onClick={() => setCalcExplanationType(null)}
                className="text-gray-400 hover:text-gray-600 font-extrabold text-sm"
                data-testid="close-modal-button"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4">
              <p className="text-xs text-gray-500 leading-relaxed font-sans">
                Here is the step-by-step mathematical breakdown using your actual cycle details:
              </p>
              
              <div className="bg-gray-50 rounded-xl p-4 space-y-3 font-mono text-xs">
                <div className="flex justify-between text-emerald-700 font-bold">
                  <span>Expected Monthly Salary</span>
                  <span>+ {formatCurrency(expectedSalary)}</span>
                </div>
                
                <div className="flex justify-between text-rose-600 font-medium">
                  <span>Active Fixed Charges (Rent/EMIs)</span>
                  <span>- {formatCurrency(totalFixedCharges)}</span>
                </div>
                
                {calcExplanationType === 'target' ? (
                  <div className="flex justify-between text-rose-600 border-b border-gray-200 pb-2 font-medium">
                    <span>Deferred Card Spend Goal ({targetBudgetPercent}%)</span>
                    <span>- {formatCurrency(forecast.targetBudget)}</span>
                  </div>
                ) : (
                  <div className="flex justify-between text-rose-600 border-b border-gray-200 pb-2 flex-col space-y-1 font-medium">
                    <div className="flex justify-between">
                      <span>Projected Card Spend</span>
                      <span>- {formatCurrency(forecast.projectedSpend)}</span>
                    </div>
                    <span className="text-[10px] text-gray-400 text-right leading-none font-sans mt-0.5">
                      (Based on speed of {formatCurrency(forecast.dailyVelocity)}/day)
                    </span>
                  </div>
                )}
                
                <div className="flex justify-between text-gray-900 font-black text-sm pt-1">
                  <span>{calcExplanationType === 'target' ? 'Target Salary Surplus' : 'Projected Salary Surplus'}</span>
                  <span>
                    {calcExplanationType === 'target' 
                      ? formatCurrency(netSavingsTarget) 
                      : formatCurrency(netSavingsProjected)
                    }
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-gray-400 leading-relaxed font-sans">
                {calcExplanationType === 'target' 
                  ? "This represents your absolute minimum savings buffer if you spend exactly up to your self-imposed card spending limit."
                  : "This represents your realistic trajectory. Based on what you have spent so far, this is the cash you are expected to save next month."
                }
              </p>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setCalcExplanationType(null)}
                className="bg-indigo-650 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-xs"
              >
                Close breakdown
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedBillForExplanation && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4" data-testid="recurrence-modal-backdrop">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-150 max-w-md w-full p-6 space-y-6 animate-in fade-in zoom-in-95 duration-200" data-testid="recurrence-explanation-modal">
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-500">Recurrence Detection Logic</span>
                <h3 className="text-lg font-black text-gray-900 Outfit" data-testid="recurrence-modal-title">
                  Why is "{selectedBillForExplanation.merchant}" flagged?
                </h3>
              </div>
              <button 
                onClick={() => setSelectedBillForExplanation(null)}
                className="text-gray-400 hover:text-gray-600 font-extrabold text-sm"
                data-testid="close-recurrence-modal-button"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4 text-xs text-gray-600 leading-relaxed font-sans">
              <div>
                <p className="font-semibold text-gray-800">1. Historical Transaction Dates detected:</p>
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 mt-1.5 flex flex-wrap gap-1.5 font-mono text-[10px]">
                  {selectedBillForExplanation.allDates.map(date => (
                    <span key={date} className="bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-700 shadow-2xs">
                      {formatDate(date)}
                    </span>
                  ))}
                </div>
                <p className="text-3xs text-gray-400 mt-1">
                  We found {selectedBillForExplanation.historyCount} payments in total.
                </p>
              </div>

              <div>
                <p className="font-semibold text-gray-800">2. Recurring Cycle Calculation:</p>
                <p className="mt-1">
                  The interval spacing between these consecutive payments is:
                </p>
                <div className="flex items-center space-x-2 mt-1.5">
                  <span className="bg-indigo-50 text-indigo-700 font-mono text-[10px] font-bold border border-indigo-100 rounded px-2 py-1">
                    {selectedBillForExplanation.allIntervals.join(' days, ') + ' days'}
                  </span>
                </div>
                <p className="mt-1.5">
                  This averages to a consistent spacing interval of <span className="font-bold text-indigo-650">{selectedBillForExplanation.frequencyDays} days</span>. This matches our system subscription target profile (**25 to 35 days**).
                </p>
              </div>

              <div className="border-t border-gray-50 pt-3">
                <p className="font-semibold text-gray-800">3. Next Billing Prediction:</p>
                <div className="bg-indigo-50/50 border border-indigo-100/50 rounded-xl p-3 mt-2 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Last Payment Date:</span>
                    <span className="font-bold font-mono text-gray-800">{formatDate(selectedBillForExplanation.lastDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Predicted Interval:</span>
                    <span className="font-bold font-mono text-gray-800">+ {selectedBillForExplanation.frequencyDays} days</span>
                  </div>
                  <div className="flex justify-between border-t border-indigo-100/50 pt-1 mt-1 font-bold text-indigo-950">
                    <span>Predicted Next Date:</span>
                    <span className="font-mono">{formatDate(selectedBillForExplanation.predictedNextDate)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setSelectedBillForExplanation(null)}
                className="bg-indigo-650 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-xs"
              >
                Got it, close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default FinancialAnalytics;
