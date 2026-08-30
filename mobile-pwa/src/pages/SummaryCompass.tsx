import React, { useState, useEffect } from 'react';
import {
  calculateDiscretionarySpend,
  calculateDaySpend,
  calculateRunRateForecast,
  calculateDailyAllowance,
  calculateNetSavings,
  getActiveCycleRange,
  getExpectedCycleEnd,
  filterTransactionsByCycle,
  formatCurrency,
  formatDate,
  FinancialTransaction,
  UserCycle,
  FixedCharge,
} from '@daily-expense/financial-core';
import { getApiUrl, getAuthHeaders } from '../api-config';

export const SummaryCompass: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [preferences, setPreferences] = useState<{ billingCycleStartDay: number; expectedSalary: number }>({
    billingCycleStartDay: 17,
    expectedSalary: 100000,
  });
  const [activeCycle, setActiveCycle] = useState<UserCycle | null>(null);
  const [fixedCharges, setFixedCharges] = useState<FixedCharge[]>([]);
  const [targetBudgetPercent, setTargetBudgetPercent] = useState<number>(() => {
    const saved = localStorage.getItem('analytics_target_budget_percent');
    return saved ? parseInt(saved, 10) : 50;
  });

  const handleBudgetChange = (val: number) => {
    setTargetBudgetPercent(val);
    localStorage.setItem('analytics_target_budget_percent', String(val));
  };

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const loadData = async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();

      const [txRes, prefRes, cycleRes, fcRes] = await Promise.allSettled([
        fetch(getApiUrl('/api/pipeline/gold-transactions'), { headers }).then((r) => r.json()),
        fetch(getApiUrl('/api/pipeline/user-preferences'), { headers }).then((r) => r.json()),
        fetch(getApiUrl('/api/pipeline/user-cycles'), { headers }).then((r) => r.json()),
        fetch(getApiUrl('/api/pipeline/fixed-charges'), { headers }).then((r) => r.json()),
      ]);

      if (txRes.status === 'fulfilled' && Array.isArray(txRes.value?.transactions)) {
        setTransactions(txRes.value.transactions);
      }
      if (prefRes.status === 'fulfilled' && prefRes.value?.billingCycleStartDay) {
        setPreferences(prefRes.value);
      }
      if (cycleRes.status === 'fulfilled' && cycleRes.value?.activeCycle) {
        setActiveCycle(cycleRes.value.activeCycle);
      }
      if (fcRes.status === 'fulfilled' && Array.isArray(fcRes.value?.fixedCharges)) {
        setFixedCharges(fcRes.value.fixedCharges);
      }
    } catch (_err) {
      // Error handled gracefully
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Compute Cycle Range
  const cycleRange = activeCycle
    ? {
        start: activeCycle.startDate,
        end: activeCycle.endDate || getExpectedCycleEnd(activeCycle.startDate, preferences.billingCycleStartDay),
      }
    : getActiveCycleRange(preferences.billingCycleStartDay, today);

  // Filter Transactions by Cycle
  const cycleTxs = activeCycle ? filterTransactionsByCycle(transactions, activeCycle) : transactions;

  // Active Fixed Charges
  const totalFixedCharges = fixedCharges
    .filter((fc) => fc.startDate <= cycleRange.end && fc.endDate >= cycleRange.start)
    .reduce((sum, fc) => sum + (Number(fc.amount) || 0), 0);

  // Spend Calculations
  const discretionarySpent = calculateDiscretionarySpend(cycleTxs, cycleRange.start, cycleRange.end);
  const spentToday = calculateDaySpend(cycleTxs, todayStr);

  // Run-Rate Forecast
  const forecast = calculateRunRateForecast(
    discretionarySpent,
    preferences.expectedSalary,
    targetBudgetPercent,
    cycleRange,
    todayStr,
    totalFixedCharges
  );

  const effectiveLimit = Math.min(forecast.targetBudget, forecast.sustainableCap || forecast.targetBudget);

  // Real-Time Net Salary Surplus (Savings)
  const { netSavingsTarget, netSavingsProjected } = calculateNetSavings(
    preferences.expectedSalary,
    totalFixedCharges,
    effectiveLimit,
    forecast.projectedSpend
  );

  // Real-Time Daily Allowance (Safe to spend today)
  const dailyAllowance = calculateDailyAllowance(
    discretionarySpent,
    spentToday,
    effectiveLimit,
    cycleRange,
    todayStr
  );

  const percentConsumed = effectiveLimit > 0 ? Math.min(100, Math.round((discretionarySpent / effectiveLimit) * 100)) : 0;

  return (
    <div className="max-w-md mx-auto px-4 pt-3 pb-20 space-y-3" data-testid="mobile-summary-compass">
      
      {/* Header with Integrated Budget Cap Slider */}
      <div className="flex items-center justify-between gap-2.5 pt-1" data-testid="compass-top-bar">
        <div className="flex-shrink-0">
          <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600 block leading-none">Cycle Overview</span>
          <h1 className="text-xl font-extrabold text-slate-900 Outfit">Compass</h1>
        </div>

        {/* Compact Integrated Budget Goal Cap Slider */}
        <div className="flex-1 bg-white border border-slate-200/80 rounded-xl px-2.5 py-1.5 shadow-2xs" data-testid="budget-cap-card">
          <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 mb-0.5">
            <span>Goal Cap:</span>
            <span className="text-indigo-600 font-extrabold Outfit">{targetBudgetPercent}%</span>
          </div>
          <input
            type="range"
            min="10"
            max="100"
            step="5"
            value={targetBudgetPercent}
            onChange={(e) => handleBudgetChange(Number(e.target.value))}
            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            data-testid="target-budget-slider"
          />
        </div>

        {/* Sync Button */}
        <button
          onClick={loadData}
          disabled={loading}
          className="p-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs flex items-center justify-center active:scale-95 shadow-2xs hover:bg-slate-50 cursor-pointer flex-shrink-0"
          data-testid="refresh-compass-btn"
        >
          <span className={loading ? 'animate-spin inline-block' : ''}>🔄</span>
        </button>
      </div>

      {/* Hero Card: Safe to Spend Today */}
      <div
        className={`relative overflow-hidden rounded-2xl p-4 sm:p-5 border shadow-sm transition-all ${
          dailyAllowance.isTodayOverspent
            ? 'bg-gradient-to-br from-rose-950 via-slate-900 to-slate-900 border-rose-500/40 text-white'
            : 'bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 border-indigo-500/20 text-white'
        }`}
        data-testid="safe-spend-today-card"
      >
        <div className="flex items-center justify-between text-xs font-semibold text-slate-300 mb-1">
          <span className="tracking-wider text-[10px] font-extrabold uppercase text-indigo-300">SAFE TO SPEND TODAY</span>
          <span className="text-[10px] uppercase font-bold text-slate-300 bg-white/10 px-2 py-0.5 rounded-full">
            {formatDate(todayStr)}
          </span>
        </div>

        {/* Big Hero Number */}
        <div className="flex items-baseline space-x-2 my-1">
          <span className={`text-3xl sm:text-4xl font-black tracking-tight Outfit ${
            dailyAllowance.isTodayOverspent ? 'text-rose-400' : 'text-emerald-400'
          }`} data-testid="available-today-amount">
            {formatCurrency(dailyAllowance.availableToSpendToday)}
          </span>
          {dailyAllowance.isTodayOverspent && (
            <span className="text-[10px] font-bold text-rose-300 bg-rose-900/60 px-1.5 py-0.5 rounded border border-rose-700">
              Overspent by {formatCurrency(dailyAllowance.overspentTodayAmount)}
            </span>
          )}
        </div>

        {/* Today's Context Subtext */}
        <p className="text-[11px] text-slate-300 leading-tight">
          {spentToday > 0 ? (
            <>Spent <span className="font-bold text-white">{formatCurrency(spentToday)}</span> of your <span className="font-bold text-white">{formatCurrency(dailyAllowance.dailySafeAllowance)}</span> allowance today.</>
          ) : (
            <>Full daily allowance of <span className="font-bold text-white">{formatCurrency(dailyAllowance.dailySafeAllowance)}</span> available today.</>
          )}
        </p>

        <div className="mt-3 pt-2.5 border-t border-white/10 grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <span className="text-slate-300 block text-3xs uppercase font-medium">Target Pace</span>
            <span className="font-extrabold text-emerald-300 Outfit text-xs" data-testid="future-daily-rate">
              {formatCurrency(dailyAllowance.recommendedFutureDailyRate)} / day
            </span>
          </div>
          <div className="text-right">
            <span className="text-slate-300 block text-3xs uppercase font-medium">Projected Total</span>
            <span
              className={`font-extrabold Outfit text-xs ${
                forecast.isExceeding ? 'text-rose-400' : 'text-emerald-300'
              }`}
              data-testid="projected-spend-amount"
            >
              {formatCurrency(forecast.projectedSpend)} {forecast.isExceeding ? `(Over by ${formatCurrency(forecast.projectedSpend - effectiveLimit)})` : '(Safe)'}
            </span>
          </div>
        </div>
      </div>

      {/* Unified Cycle Cockpit Card */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 space-y-3 shadow-xs" data-testid="cycle-progress-card">
        
        {/* Cycle Boundaries Header & Cap % */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Cycle Consumption</h3>
            <span className="text-3xs text-slate-400 font-medium">
              {formatDate(cycleRange.start)} &ndash; {formatDate(cycleRange.end)}
            </span>
          </div>
          <span className="text-xs font-black text-indigo-600 Outfit bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md">
            {percentConsumed}% Cap
          </span>
        </div>

        {/* Visual Progress Bar */}
        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200/60">
          <div
            className={`h-full transition-all duration-500 rounded-full ${
              forecast.isExceeding ? 'bg-gradient-to-r from-rose-500 to-amber-500' : 'bg-gradient-to-r from-indigo-500 to-emerald-500'
            }`}
            style={{ width: `${percentConsumed}%` }}
          ></div>
        </div>

        {/* Consolidated 2x2 Grid */}
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
          
          {/* Cell 1: Current Speed */}
          <div className="bg-slate-50/70 rounded-xl p-2.5 border border-slate-150">
            <span className="text-3xs font-bold uppercase tracking-wider text-slate-400 block">Current Speed</span>
            <span className="text-sm font-extrabold text-slate-900 Outfit block" data-testid="current-velocity-value">
              {formatCurrency(forecast.dailyVelocity)}
            </span>
            <span className="text-3xs text-slate-400 block font-medium">/ day ({forecast.elapsedDays}d elapsed)</span>
          </div>

          {/* Cell 2: Cycle Survival */}
          <div className="bg-slate-50/70 rounded-xl p-2.5 border border-slate-150">
            <span className="text-3xs font-bold uppercase tracking-wider text-slate-400 block">Cycle Survival</span>
            <span className="text-sm font-extrabold text-slate-900 Outfit block" data-testid="remaining-days-value">
              {forecast.remainingDays} days left
            </span>
            <span className="text-3xs text-indigo-600 block font-semibold">Ends {formatDate(cycleRange.end)}</span>
          </div>

          {/* Cell 3: Total Spent */}
          <div className="bg-slate-50/70 rounded-xl p-2.5 border border-slate-150">
            <span className="text-3xs font-bold uppercase tracking-wider text-slate-400 block">Total Spent</span>
            <span className="font-extrabold text-slate-900 Outfit text-sm block" data-testid="discretionary-spent-amount">
              {formatCurrency(discretionarySpent)}
            </span>
            <span className="text-3xs text-slate-400 block font-medium">Of {formatCurrency(effectiveLimit)} cap</span>
          </div>

          {/* Cell 4: Estimated Salary Surplus */}
          <div className="bg-slate-50/70 rounded-xl p-2.5 border border-slate-150" data-testid="salary-surplus-cell">
            <span className="text-3xs font-bold uppercase tracking-wider text-slate-400 block">Est. Savings</span>
            <span
              className={`font-extrabold Outfit text-sm block ${
                netSavingsProjected >= 0 ? 'text-emerald-600' : 'text-rose-600'
              }`}
              data-testid="projected-savings-amount"
            >
              {formatCurrency(netSavingsProjected)}
            </span>
            <span className="text-3xs text-slate-400 block font-medium" data-testid="target-savings-amount">
              Goal: {formatCurrency(netSavingsTarget)}
            </span>
          </div>

        </div>

      </div>

    </div>
  );
};
