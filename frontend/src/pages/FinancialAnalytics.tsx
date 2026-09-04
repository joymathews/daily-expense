import React, { useState, useEffect } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { getActiveCycleRange } from '../utils/transaction-helper';
import { useUserCycles } from '../hooks/use-user-cycles';
import { CycleSelectorDropdown } from '../components/CycleSelectorDropdown';
import { filterTransactionsByCycle, getExpectedCycleEnd } from '../utils/cycle-helper';
import { getApiUrl } from '../utils/api-config';
import {
  calculateDiscretionarySpend,
  calculateDaySpend,
  calculateRunRateForecast,
  calculateNetSavings,
  getDaysDiff,
  calculateTotalFixedCharges,
} from '../utils/analytics-helper';

import type {
  RunRateForecastResult,
} from '../utils/analytics-helper';

const FinancialAnalytics: React.FC = () => {
  const { cycles, activeCycle, selectedCycle, setSelectedCycle } = useUserCycles();
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

  // Load backend data
  useEffect(() => {
    let authHeaders = {};
    const loadData = async () => {
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
        fetch(getApiUrl('/api/pipeline/gold-transactions'), { headers: authHeaders }).then(res => res.json()).catch(() => ({ transactions: [] })),
        fetch(getApiUrl('/api/pipeline/user-preferences'), { headers: authHeaders }).then(res => res.json()).catch(() => ({ billingCycleStartDay: 17, expectedSalary: 100000 })),
        fetch(getApiUrl('/api/pipeline/fixed-charges'), { headers: authHeaders }).then(res => res.json()).catch(() => ({ fixedCharges: [] })),
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
    const val = parseInt(e.target.value, 10);
    setTargetBudgetPercent(val);
    localStorage.setItem('analytics_target_budget_percent', val.toString());
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-650 border-t-transparent"></div>
        <p className="text-gray-500 font-medium Outfit">Analyzing transaction history...</p>
      </div>
    );
  }

  // Format today's date safely in local time
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Derive active billing cycle boundaries
  const currentCycle = selectedCycle || activeCycle;
  const expectedEnd = currentCycle ? getExpectedCycleEnd(currentCycle.startDate, billingCycleStartDay) : todayStr;
  const cycleRange = currentCycle ? {
    start: currentCycle.startDate,
    end: currentCycle.endDate || expectedEnd
  } : getActiveCycleRange(billingCycleStartDay);

  const cycleFilteredTxs = currentCycle ? filterTransactionsByCycle(transactions, currentCycle) : transactions;

  // Filter discretionary spending inside cycle
  const discretionarySpent = calculateDiscretionarySpend(cycleFilteredTxs, cycleRange.start, cycleRange.end);
  const spentToday = calculateDaySpend(cycleFilteredTxs, todayStr);
  const totalFixedCharges = calculateTotalFixedCharges(fixedCharges, cycleRange);

  const forecast: RunRateForecastResult = calculateRunRateForecast(
    discretionarySpent,
    expectedSalary,
    targetBudgetPercent,
    cycleRange,
    todayStr,
    totalFixedCharges,
    spentToday
  );

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

  // Compute days difference between exhaustion and cycle end date
  const daysBeforeEnd = forecast.exhaustionDate
    ? Math.max(0, getDaysDiff(forecast.exhaustionDate, cycleRange.end) - 1)
    : 0;

  const { netSavingsTarget, netSavingsProjected } = calculateNetSavings(
    expectedSalary,
    totalFixedCharges,
    forecast.targetBudget,
    forecast.projectedSpend
  );

  return (
    <div className="max-w-7xl mx-auto space-y-8 w-full px-2 sm:px-0">
      
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-2 md:space-y-0">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent Outfit">
            Financial Analytics & Predictions
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Predictive forecasts, burn-rate metrics, and card spending analysis computed from your ledger history.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CycleSelectorDropdown
            cycles={cycles}
            selectedCycle={selectedCycle}
            onSelectCycle={setSelectedCycle}
          />
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-2 text-indigo-850 text-xs font-bold Outfit">
            Billing Cycle: {formatDate(cycleRange.start)} &ndash; {formatDate(cycleRange.end)}
          </div>
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

    </div>
  );
};

export default FinancialAnalytics;
