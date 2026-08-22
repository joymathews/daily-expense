import React, { useState, useEffect } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { getActiveCycleRange } from '../utils/transaction-helper';
import { useUserCycles } from '../hooks/use-user-cycles';
import { CycleSelectorDropdown } from '../components/CycleSelectorDropdown';
import { filterTransactionsByCycle, getExpectedCycleEnd } from '../utils/cycle-helper';
import {
  calculateDiscretionarySpend,
  calculateRunRateForecast,
  calculateDayOfMonthPeaks,
  calculateDayOfWeekPeaks,
  detectRecurringBills,
  generateSavingsRecommendations,
  DEFAULT_INSIGHTS_CONFIG
} from '../utils/analytics-helper';
import type {
  RunRateForecastResult,
  DayPeakPoint,
  DayOfWeekPeakPoint,
  RecurringBillPrediction,
  SavingsRecommendation,
  InsightsConfig
} from '../utils/analytics-helper';

const FinancialInsights: React.FC = () => {
  const { cycles, activeCycle, selectedCycle, setSelectedCycle } = useUserCycles();

  const [transactions, setTransactions] = useState<any[]>([]);
  const [fixedCharges, setFixedCharges] = useState<any[]>([]);
  const [billingCycleStartDay, setBillingCycleStartDay] = useState(17);
  const [expectedSalary, setExpectedSalary] = useState(100000);
  const [primaryCurrency, setPrimaryCurrency] = useState('INR');
  const [isLoading, setIsLoading] = useState(true);
  
  // Filter state for insights list
  const [activeFilter, setActiveFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all');

  // Calibration config state
  const [config, setConfig] = useState<InsightsConfig>(() => {
    const saved = localStorage.getItem('insights_calibration_config');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return DEFAULT_INSIGHTS_CONFIG;
      }
    }
    return DEFAULT_INSIGHTS_CONFIG;
  });

  const [showCalibrationSettings, setShowCalibrationSettings] = useState(false);

  const updateConfig = (newVal: Partial<InsightsConfig>) => {
    setConfig(prev => {
      const updated = { ...prev, ...newVal };
      localStorage.setItem('insights_calibration_config', JSON.stringify(updated));
      return updated;
    });
  };

  const handleResetConfig = () => {
    setConfig(DEFAULT_INSIGHTS_CONFIG);
    localStorage.setItem('insights_calibration_config', JSON.stringify(DEFAULT_INSIGHTS_CONFIG));
  };

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
          console.error('Error loading insights data:', err);
          setIsLoading(false);
        });
    };

    loadData();
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-650 border-t-transparent"></div>
        <p className="text-gray-500 font-medium Outfit">Compiling personal financial insights...</p>
      </div>
    );
  }

  // Set up calculation parameters
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  
  const currentCycle = selectedCycle || activeCycle;
  const expectedEnd = currentCycle ? getExpectedCycleEnd(currentCycle.startDate, billingCycleStartDay) : todayStr;
  const cycleRange = currentCycle ? {
    start: currentCycle.startDate,
    end: currentCycle.endDate || expectedEnd
  } : getActiveCycleRange(billingCycleStartDay);

  const cycleFilteredTxs = filterTransactionsByCycle(transactions, currentCycle);

  const activeFixedCharges = (fixedCharges || []).filter((fc: any) => {
    return fc.startDate <= cycleRange.end && fc.endDate >= cycleRange.start;
  });
  const totalFixedCharges = activeFixedCharges.reduce((sum: number, fc: any) => sum + fc.amount, 0);

  const discretionarySpend = calculateDiscretionarySpend(cycleFilteredTxs, cycleRange.start, cycleRange.end);

  
  // Read target budget percent slider value (default 50)
  const savedPercent = localStorage.getItem('analytics_target_budget_percent');
  const targetBudgetPercent = savedPercent ? parseInt(savedPercent, 10) : 50;
  const targetBudget = (expectedSalary * targetBudgetPercent) / 100;

  const forecast: RunRateForecastResult = calculateRunRateForecast(
    discretionarySpend,
    expectedSalary,
    targetBudgetPercent,
    cycleRange,
    todayStr,
    totalFixedCharges
  );

  const dayOfMonthPeaks: DayPeakPoint[] = calculateDayOfMonthPeaks(transactions);
  const dayOfWeekPeaks: DayOfWeekPeakPoint[] = calculateDayOfWeekPeaks(transactions);


  // Scan multiple frequencies to detect all recurring subscriptions
  const billsMonthly = detectRecurringBills(transactions, todayStr, 'monthly');
  const billsWeekly = detectRecurringBills(transactions, todayStr, 'weekly');
  const billsBiweekly = detectRecurringBills(transactions, todayStr, 'biweekly');


  
  const allRecurringBillsMap: Record<string, RecurringBillPrediction> = {};
  [...billsMonthly, ...billsWeekly, ...billsBiweekly].forEach(b => {
    allRecurringBillsMap[b.merchant] = b;
  });
  const recurringBills = Object.values(allRecurringBillsMap);

  // Generate expanded recommendations list
  const recommendations: SavingsRecommendation[] = generateSavingsRecommendations(
    transactions,
    dayOfMonthPeaks,
    dayOfWeekPeaks,
    recurringBills,
    expectedSalary,
    totalFixedCharges,
    targetBudget,
    discretionarySpend,
    forecast.projectedTotal,
    cycleRange,
    todayStr,
    config
  );

  // Sum potential savings of active recommendations
  const totalPotentialSavings = recommendations.reduce((sum, r) => sum + r.potentialSavings, 0);

  // Filter recommendations based on active filter
  const filteredRecs = recommendations.filter(r => {
    if (activeFilter === 'all') return true;
    return r.impact === activeFilter;
  });

  const getImpactBadgeStyles = (impact: string) => {
    switch (impact) {
      case 'critical':
        return 'bg-red-50 text-red-700 border-red-100';
      case 'high':
        return 'bg-orange-50 text-orange-700 border-orange-100';
      case 'medium':
        return 'bg-indigo-50 text-indigo-700 border-indigo-100';
      case 'low':
        return 'bg-emerald-50 text-emerald-700 border-emerald-100';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-100';
    }
  };

  const getRecommendationIcon = (type: string) => {
    switch (type) {
      case 'recurring':
      case 'subscription_creep':
        return '🔄';
      case 'weekend':
        return '🏖️';
      case 'weekday':
        return '📅';
      case 'date_trap':
        return '⚠️';
      case 'run_rate_margin':
        return '📉';
      case 'category_cap':
        return '🏷️';
      case 'budget_split':
      case 'budget_drift':
        return '⚖️';
      case 'investment':
        return '📈';
      case 'fixed_burden':
        return '🏦';
      case 'large_expense':
        return '💳';
      default:
        return '💡';
    }
  };

  return (
    <div className="max-w-4xl w-full mx-auto space-y-8 select-none" data-testid="insights-workspace">
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight Outfit">💡 Smart Financial Insights</h1>
          <p className="text-xs text-gray-500 mt-1">
            Dynamic savings recommendations, habit corrections, and wealth strategies compiled from transaction history.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <CycleSelectorDropdown
            cycles={cycles}
            selectedCycle={selectedCycle}
            onSelectCycle={setSelectedCycle}
          />
          <button
            onClick={() => setShowCalibrationSettings(!showCalibrationSettings)}
            className="text-xs font-bold text-gray-655 hover:text-indigo-650 hover:bg-indigo-50/50 uppercase tracking-wider border border-gray-200 px-4 py-2 rounded-xl shadow-3xs transition-all duration-200 cursor-pointer flex items-center space-x-1.5 shrink-0"
            data-testid="toggle-calibration-btn"
          >
            <span>⚙️ Calibrate Insights</span>
          </button>
        </div>
      </div>

      {/* Calibration settings card */}
      {showCalibrationSettings && (
        <div className="bg-white border border-gray-150 rounded-2xl p-6 shadow-sm space-y-6" data-testid="calibration-panel">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <div>
              <h2 className="text-sm font-extrabold text-gray-900 Outfit">⚙️ Insight Calibration Settings</h2>
              <p className="text-3xs text-gray-400 mt-0.5 font-sans">
                Fine-tune mathematical triggers and limits used to identify financial recommendations.
              </p>
            </div>
            <button
              onClick={handleResetConfig}
              className="text-3xs font-extrabold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100/70 px-2.5 py-1.5 rounded-lg transition-all cursor-pointer"
              data-testid="reset-calibration-btn"
            >
              RESET TO DEFAULTS
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Category Splurge Limit */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-bold">
                <span className="text-gray-900 Outfit">Category Splurge Limit</span>
                <span className="text-indigo-600 font-extrabold bg-indigo-50/70 px-2 py-0.5 rounded border border-indigo-100/50" data-testid="value-category">{config.categoryPctThreshold}%</span>
              </div>
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={config.categoryPctThreshold}
                onChange={e => updateConfig({ categoryPctThreshold: parseInt(e.target.value, 10) })}
                className="w-full h-1 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                data-testid="slider-category"
              />
              <p className="text-[10px] leading-normal text-gray-400 font-sans">
                Flags a category if it consumes more than this % of card spend. Lowering this catches smaller category leaks; raising it focuses on top categories.
              </p>
            </div>

            {/* Merchant Visits Limit */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-bold">
                <span className="text-gray-900 Outfit">Merchant Visits Limit</span>
                <span className="text-indigo-600 font-extrabold bg-indigo-50/70 px-2 py-0.5 rounded border border-indigo-100/50" data-testid="value-merchant">{config.merchantVisitsThreshold} visits</span>
              </div>
              <input
                type="range"
                min="2"
                max="15"
                step="1"
                value={config.merchantVisitsThreshold}
                onChange={e => updateConfig({ merchantVisitsThreshold: parseInt(e.target.value, 10) })}
                className="w-full h-1 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                data-testid="slider-merchant"
              />
              <p className="text-[10px] leading-normal text-gray-400 font-sans">
                Flags a merchant if visited this many times in a cycle. Lowering this catches minor repeat patterns; raising it captures only heavy daily habits.
              </p>
            </div>

            {/* Weekend Spend Bias Limit */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-bold">
                <span className="text-gray-900 Outfit">Weekend Spend Bias Limit</span>
                <span className="text-indigo-600 font-extrabold bg-indigo-50/70 px-2 py-0.5 rounded border border-indigo-100/50" data-testid="value-weekend">{config.weekendPctThreshold}%</span>
              </div>
              <input
                type="range"
                min="20"
                max="80"
                step="5"
                value={config.weekendPctThreshold}
                onChange={e => updateConfig({ weekendPctThreshold: parseInt(e.target.value, 10) })}
                className="w-full h-1 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                data-testid="slider-weekend"
              />
              <p className="text-[10px] leading-normal text-gray-400 font-sans">
                Flags weekend splurging if Friday-Sunday spend exceeds this % of weekly total. Lowering this makes the weekend warning more sensitive.
              </p>
            </div>

            {/* Large Expense Limit */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-bold">
                <span className="text-gray-900 Outfit">Large Expense Limit</span>
                <span className="text-indigo-600 font-extrabold bg-indigo-50/70 px-2 py-0.5 rounded border border-indigo-100/50" data-testid="value-large-expense">{config.largeExpensePctThreshold}%</span>
              </div>
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={config.largeExpensePctThreshold}
                onChange={e => updateConfig({ largeExpensePctThreshold: parseInt(e.target.value, 10) })}
                className="w-full h-1 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                data-testid="slider-large-expense"
              />
              <p className="text-[10px] leading-normal text-gray-400 font-sans">
                Flags a single purchase if it exceeds this % of expected monthly salary. Lowering this flags smaller single luxury purchases.
              </p>
            </div>

            {/* Fixed Cost Warning Limit */}
            <div className="space-y-2 md:col-span-2">
              <div className="flex justify-between items-center text-xs font-bold">
                <span className="text-gray-900 Outfit">Fixed Cost Warning Limit</span>
                <span className="text-indigo-600 font-extrabold bg-indigo-50/70 px-2 py-0.5 rounded border border-indigo-100/50" data-testid="value-fixed-burden">{config.fixedBurdenPctThreshold}%</span>
              </div>
              <input
                type="range"
                min="20"
                max="70"
                step="5"
                value={config.fixedBurdenPctThreshold}
                onChange={e => updateConfig({ fixedBurdenPctThreshold: parseInt(e.target.value, 10) })}
                className="w-full h-1 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                data-testid="slider-fixed-burden"
              />
              <p className="text-[10px] leading-normal text-gray-400 font-sans">
                Warns you of cash flow strain if rent, loans, and EMIs consume more than this % of expected salary.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Potential Savings Banner */}
      {totalPotentialSavings > 0 && (
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-6 text-white shadow-md border border-indigo-500/20 flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0" data-testid="savings-banner">
          <div className="space-y-1 text-center md:text-left">
            <h2 className="text-lg font-bold text-white Outfit">Total Potential Cycle Savings</h2>
            <p className="text-xs text-indigo-100 font-medium">
              Capping leisure card spent and cleaning subscription drift can recover substantial surplus cash.
            </p>
          </div>
          <div className="text-center bg-white/10 px-6 py-3 rounded-xl border border-white/10 backdrop-blur-md shrink-0">
            <span className="text-2xs font-extrabold text-indigo-100 uppercase tracking-widest Outfit block">Potential Recovers / Cycle</span>
            <span className="text-2xl font-extrabold text-white Outfit block mt-0.5">
              ₹{totalPotentialSavings.toLocaleString('en-IN')}
            </span>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center space-x-1 overflow-x-auto pb-1" data-testid="insights-filter-tabs">
        {(['all', 'critical', 'high', 'medium', 'low'] as const).map(filter => {
          const count = recommendations.filter(r => filter === 'all' || r.impact === filter).length;
          return (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={`px-4 py-2 rounded-lg text-xs font-extrabold Outfit transition-all capitalize whitespace-nowrap ${
                activeFilter === filter
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-950 border border-gray-100'
              }`}
            >
              {filter} <span className="ml-1.5 opacity-60 bg-gray-100/10 px-1.5 py-0.5 rounded text-[10px]">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Recommendations Cards Grid */}
      {filteredRecs.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5" data-testid="insights-grid">
          {filteredRecs.map(rec => (
            <div
              key={rec.id}
              className="bg-white border border-gray-100 rounded-2xl p-5 flex flex-col justify-between hover:shadow-md transition-shadow duration-300 relative overflow-hidden"
              data-testid={`insight-card-${rec.type}`}
            >
              <div className="space-y-4">
                <div className="flex justify-between items-start space-x-3">
                  <div className="flex items-center space-x-2.5">
                    <span className="text-xl leading-none bg-gray-50 border border-gray-150/50 w-8 h-8 rounded-lg flex items-center justify-center shadow-3xs">
                      {getRecommendationIcon(rec.type)}
                    </span>
                    <h3 className="text-xs font-extrabold text-gray-950 Outfit leading-snug">
                      {rec.title}
                    </h3>
                  </div>
                  <span className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full border tracking-wide Outfit shrink-0 ${getImpactBadgeStyles(rec.impact)}`}>
                    {rec.impact}
                  </span>
                </div>

                <p className="text-xs text-gray-500 leading-relaxed font-sans font-medium">
                  {rec.description}
                </p>
              </div>

              {rec.potentialSavings > 0 && (
                <div className="mt-5 pt-4 border-t border-gray-50 flex items-center justify-between">
                  <span className="text-2xs font-extrabold text-gray-400 uppercase tracking-widest Outfit">Est. Cycle Recovery</span>
                  <span className="text-xs font-extrabold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100 Outfit">
                    +₹{rec.potentialSavings.toLocaleString('en-IN')}/cycle
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center space-y-4" data-testid="insights-empty-state">
          <div className="text-3xl">✨</div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-gray-900 Outfit">No Active Insights</h3>
            <p className="text-xs text-gray-400 font-sans max-w-xs mx-auto">
              Everything looks in balance! There are no matching opportunities in the selected filter right now.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancialInsights;
