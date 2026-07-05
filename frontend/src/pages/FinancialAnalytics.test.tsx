import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import FinancialAnalytics from './FinancialAnalytics';
import {
  calculateDiscretionarySpend,
  calculateRunRateForecast,
  calculateDayOfMonthPeaks,
  calculateDayOfWeekPeaks,
  detectRecurringBills
} from '../utils/analytics-helper';

// Mock Amplify Auth Session
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: {
      idToken: {
        toString: () => 'mock-jwt-token'
      }
    }
  })
}));

describe('Financial Analytics Utility Computations', () => {
  const mockTransactions = [
    {
      id: 'tx-1',
      merchant: 'Mutual Fund India',
      amount: 10000,
      currency: 'INR',
      transactionDate: '2026-06-18',
      category: 'Investment',
      transactionType: 'expense'
    },
    {
      id: 'tx-2',
      merchant: 'Zomato Food Delivery',
      amount: 500,
      currency: 'INR',
      transactionDate: '2026-06-20',
      category: 'Online Food Order',
      transactionType: 'expense'
    },
    {
      id: 'tx-3',
      merchant: 'Starbucks Coffee',
      amount: 1500,
      currency: 'INR',
      transactionDate: '2026-06-22',
      category: 'Restaurant & Dining',
      transactionType: 'expense'
    },
    {
      id: 'tx-4',
      merchant: 'Uber Rides',
      amount: 800,
      currency: 'INR',
      transactionDate: '2026-06-25',
      category: 'Cabs & Transport',
      transactionType: 'expense'
    },
    {
      id: 'tx-5',
      merchant: 'Uber Rides',
      amount: 900,
      currency: 'INR',
      transactionDate: '2026-07-25', // exactly 30 days gap
      category: 'Cabs & Transport',
      transactionType: 'expense'
    },
    {
      id: 'tx-6',
      merchant: 'Self Transfer',
      amount: 5000,
      currency: 'INR',
      transactionDate: '2026-06-21',
      category: 'Other',
      transactionType: 'transfer'
    },
    {
      id: 'tx-7',
      merchant: 'Starbucks Refund',
      amount: 300,
      currency: 'INR',
      transactionDate: '2026-06-23',
      category: 'Restaurant & Dining',
      transactionType: 'refund'
    }
  ];

  /**
   * [FUNC-ANALYSIS-12]: Verify that discretionary spend accurately excludes transfers, investments and fixed charges.
   */
  it('correctly calculates discretionary spend in range', () => {
    // Should include:
    // tx-2 (500), tx-3 (1500), tx-4 (800), tx-7 (-300) = 2500
    // Excluded:
    // tx-1 (Investment category)
    // tx-5 (Out of date range: 2026-06-17 to 2026-07-16)
    // tx-6 (transfer type)
    const result = calculateDiscretionarySpend(
      mockTransactions,
      '2026-06-17',
      '2026-07-16'
    );
    expect(result).toBe(2500);
  });

  it('excludes direct bank debits (UPI, Debit Cards) from discretionary spend', () => {
    const mixedTransactions = [
      {
        id: 'm-1',
        merchant: 'Uber Rides',
        amount: 800,
        currency: 'INR',
        transactionDate: '2026-06-20',
        category: 'Cabs & Transport',
        transactionType: 'expense',
        paymentMethod: 'HDFC Credit Card'
      },
      {
        id: 'm-2',
        merchant: 'Zomato Food',
        amount: 500,
        currency: 'INR',
        transactionDate: '2026-06-22',
        category: 'Online Food Order',
        transactionType: 'expense',
        paymentMethod: 'UPI'
      },
      {
        id: 'm-3',
        merchant: 'Grocery Store',
        amount: 1000,
        currency: 'INR',
        transactionDate: '2026-06-25',
        category: 'Groceries',
        transactionType: 'expense',
        paymentMethod: 'SBI Debit Card'
      }
    ];

    const result = calculateDiscretionarySpend(
      mixedTransactions,
      '2026-06-17',
      '2026-07-16'
    );
    // Should only sum 'HDFC Credit Card' (800). 'UPI' (500) and 'SBI Debit Card' (1000) are excluded
    expect(result).toBe(800);
  });

  /**
   * [FUNC-ANALYSIS-12]: Verify that budget run-rate forecast correctly projects end-of-cycle totals.
   */
  it('correctly forecasts cycle run rate and exhaustion date when exceeding', () => {
    const cycleRange = { start: '2026-06-17', end: '2026-07-16' }; // 30 days
    const todayStr = '2026-06-26'; // Day 10 of cycle (elapsedDays = 10, remainingDays = 20)
    const discretionarySpend = 20000; // spent in 10 days ($2000/day velocity)
    const expectedSalary = 100000;
    const targetBudgetPercent = 30; // budget = $30,000
    
    const result = calculateRunRateForecast(
      discretionarySpend,
      expectedSalary,
      targetBudgetPercent,
      cycleRange,
      todayStr
    );

    expect(result.targetBudget).toBe(30000);
    expect(result.elapsedDays).toBe(10);
    expect(result.remainingDays).toBe(20);
    expect(result.dailyVelocity).toBe(2000);
    expect(result.projectedSpend).toBe(60000); // 2000 * 30 days
    expect(result.isExceeding).toBe(true);
    // targetBudget 30000 / velocity 2000 = 15 days from start (June 17 + 15 days = July 2)
    expect(result.exhaustionDate).toBe('2026-07-02');
    expect(result.recommendedDailyRate).toBe(500); // remaining budget 10000 / remaining days 20
  });

  it('correctly adjusts recommended daily rate when target budget is unsustainable', () => {
    const cycleRange = { start: '2026-06-17', end: '2026-07-16' }; // 30 days
    const todayStr = '2026-06-27'; // Day 11 of cycle (elapsedDays = 11, remainingDays = 19)
    const discretionarySpend = 20000;
    const expectedSalary = 100000;
    const targetBudgetPercent = 100; // Cap set to 100% = $100,000 (unsustainable!)
    const totalFixedCharges = 60000; // Sustainable cap = 100000 - 60000 = 40000

    const result = calculateRunRateForecast(
      discretionarySpend,
      expectedSalary,
      targetBudgetPercent,
      cycleRange,
      todayStr,
      totalFixedCharges
    );

    expect(result.targetBudget).toBe(100000);
    expect(result.sustainableCap).toBe(40000);
    // Remaining budget should be based on sustainableCap (40000) minus discretionarySpend (20000) = 20000
    // Recommended daily rate = 20000 / 19 days = ~1052.63
    expect(result.recommendedDailyRate).toBeCloseTo(1052.63, 1);
  });

  /**
   * [FUNC-ANALYSIS-13]: Verify Day of the Month peaks calculations.
   */
  it('correctly groups expenditures by day of the month', () => {
    const peaks = calculateDayOfMonthPeaks(mockTransactions);
    // tx-2 is on 20th: amount = 500
    expect(peaks.find(p => p.day === 20)?.amount).toBe(500);
    // tx-3 is on 22nd (1500) and tx-7 is refund on 23rd (-300)
    expect(peaks.find(p => p.day === 22)?.amount).toBe(1500);
    expect(peaks.find(p => p.day === 23)?.amount).toBe(-300);
    // Non-discretionary are ignored (tx-1 on 18th is Investment)
  });

  it('correctly calculates weekend spend amount for day of month peaks', () => {
    const peaks = calculateDayOfMonthPeaks(mockTransactions);
    const p20 = peaks.find(p => p.day === 20);
    expect(p20?.amount).toBe(500);
    expect(p20?.weekendAmount).toBe(500); // 2026-06-20 is a Saturday
    
    const p22 = peaks.find(p => p.day === 22);
    expect(p22?.amount).toBe(1500);
    expect(p22?.weekendAmount).toBe(0); // Monday is not a weekend
  });

  /**
   * [FUNC-ANALYSIS-13]: Verify Day of the Week peaks calculations.
   */
  it('correctly groups expenditures by day of the week', () => {
    const peaks = calculateDayOfWeekPeaks(mockTransactions);
    // 2026-06-20 is Saturday. tx-2 (500) + tx-5 (900) = 1400
    const sat = peaks.find(p => p.dayName === 'Sat');
    expect(sat?.amount).toBe(1400);
    expect(peaks[0].dayName).toBe('Mon');
    expect(peaks[6].dayName).toBe('Sun');
  });

  /**
   * [FUNC-ANALYSIS-14]: Verify that recurring bills are detected properly.
   */
  it('detects recurring bills and predicts next date', () => {
    const recurring = detectRecurringBills(mockTransactions);
    // Uber Rides has tx-4 (2026-06-25) and tx-5 (2026-07-25), exactly 30 days gap
    expect(recurring.length).toBe(1);
    expect(recurring[0].merchant).toBe('Uber Rides');
    expect(recurring[0].frequencyDays).toBe(30);
    // Next prediction is 2026-07-25 + 30 days = 2026-08-24
    expect(recurring[0].predictedNextDate).toBe('2026-08-24');
  });

  it('prunes predicted recurring bills that are overdue by more than 10 days', () => {
    // Next predicted date is 2026-08-24.
    // If today is 2026-09-05 (12 days overdue), it should be pruned.
    const recurringPruned = detectRecurringBills(mockTransactions, '2026-09-05');
    expect(recurringPruned.length).toBe(0);

    // If today is 2026-08-28 (4 days overdue), it should NOT be pruned.
    const recurringNotPruned = detectRecurringBills(mockTransactions, '2026-08-28');
    expect(recurringNotPruned.length).toBe(1);
  });

  it('correctly normalizes and groups dirty/fragmented merchant names together', () => {
    const dirtyTransactions = [
      {
        id: 'd-1',
        merchant: 'Netflix.com GBR',
        amount: 649,
        currency: 'INR',
        transactionDate: '2026-05-01',
        category: 'Entertainment & Subscriptions',
        transactionType: 'expense'
      },
      {
        id: 'd-2',
        merchant: 'Netflix* Mems 649',
        amount: 649,
        currency: 'INR',
        transactionDate: '2026-06-01',
        category: 'Entertainment & Subscriptions',
        transactionType: 'expense'
      },
      {
        id: 'd-3',
        merchant: 'Netflix 9912 Internet',
        amount: 649,
        currency: 'INR',
        transactionDate: '2026-07-01',
        category: 'Entertainment & Subscriptions',
        transactionType: 'expense'
      }
    ];

    const recurring = detectRecurringBills(dirtyTransactions);
    // Should group all three into a single prediction matching "Netflix 9912 Internet" (the latest raw merchant name)
    expect(recurring.length).toBe(1);
    expect(recurring[0].merchant).toBe('Netflix 9912 Internet');
    expect(recurring[0].frequencyDays).toBe(31); // average of 31 and 30 days
  });

  it('detects weekly recurring bills when weekly filter is selected', () => {
    const weeklyTransactions = [
      {
        id: 'w-1',
        merchant: 'Weekly Fruit Basket',
        amount: 300,
        currency: 'INR',
        transactionDate: '2026-06-01',
        category: 'Groceries',
        transactionType: 'expense'
      },
      {
        id: 'w-2',
        merchant: 'Weekly Fruit Basket',
        amount: 300,
        currency: 'INR',
        transactionDate: '2026-06-08',
        category: 'Groceries',
        transactionType: 'expense'
      },
      {
        id: 'w-3',
        merchant: 'Weekly Fruit Basket',
        amount: 300,
        currency: 'INR',
        transactionDate: '2026-06-15',
        category: 'Groceries',
        transactionType: 'expense'
      }
    ];

    const recurring = detectRecurringBills(weeklyTransactions, undefined, 'weekly');
    expect(recurring.length).toBe(1);
    expect(recurring[0].merchant).toBe('Weekly Fruit Basket');
    expect(recurring[0].frequencyDays).toBe(7);
    expect(recurring[0].predictedNextDate).toBe('2026-06-22');
  });

  it('prunes weekly recurring bills when they are overdue by more than 3 days', () => {
    const weeklyTransactions = [
      {
        id: 'w-1',
        merchant: 'Weekly Fruit Basket',
        amount: 300,
        currency: 'INR',
        transactionDate: '2026-06-01',
        category: 'Groceries',
        transactionType: 'expense'
      },
      {
        id: 'w-2',
        merchant: 'Weekly Fruit Basket',
        amount: 300,
        currency: 'INR',
        transactionDate: '2026-06-08',
        category: 'Groceries',
        transactionType: 'expense'
      }
    ];

    // Predicted next date is 2026-06-15.
    // If today is 2026-06-19 (4 days overdue), it should be pruned for weekly.
    const recurringPruned = detectRecurringBills(weeklyTransactions, '2026-06-19', 'weekly');
    expect(recurringPruned.length).toBe(0);

    // If today is 2026-06-17 (2 days overdue), it should NOT be pruned.
    const recurringNotPruned = detectRecurringBills(weeklyTransactions, '2026-06-17', 'weekly');
    expect(recurringNotPruned.length).toBe(1);
  });
});

describe('Financial Analytics Page Integration and UI Rendering', () => {
  const globalFetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = globalFetchMock;
    
    // Default fetch mocks
    globalFetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/pipeline/gold-transactions')) {
        return Promise.resolve({
          json: () => Promise.resolve({
            transactions: [
              {
                id: 't-1',
                merchant: 'Uber Rides',
                amount: 800,
                currency: 'INR',
                transactionDate: '2026-06-20',
                category: 'Cabs & Transport',
                transactionType: 'expense'
              },
              {
                id: 't-2',
                merchant: 'Uber Rides',
                amount: 900,
                currency: 'INR',
                transactionDate: '2026-07-20', // recurring monthly interval
                category: 'Cabs & Transport',
                transactionType: 'expense'
              }
            ]
          })
        });
      }
      if (url.includes('/api/pipeline/user-preferences')) {
        return Promise.resolve({
          json: () => Promise.resolve({
            billingCycleStartDay: 17,
            expectedSalary: 100000
          })
        });
      }
      if (url.includes('/api/pipeline/fixed-charges')) {
        return Promise.resolve({
          json: () => Promise.resolve({
            fixedCharges: []
          })
        });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
  });

  /**
   * [FUNC-ANALYSIS-10] / [FUNC-ANALYSIS-11] / [FUNC-ANALYSIS-12]:
   * Verify the default landing view fetches correctly and loads page headers, slider control, and projected forecasts.
   */
  it('renders title, loads ledger data, displays interactive budget slider, and displays projected forecasts', async () => {
    render(
      <BrowserRouter>
        <FinancialAnalytics />
      </BrowserRouter>
    );

    // Should display loading state first
    expect(screen.getByText(/Analyzing transaction history/i)).toBeInTheDocument();

    // Wait for content load
    await waitFor(() => {
      expect(screen.getByText('Financial Analytics & Predictions')).toBeInTheDocument();
    });

    // Check sliders and limits
    const slider = screen.getByTestId('target-budget-slider') as HTMLInputElement;
    expect(slider).toBeInTheDocument();
    // Default target budget is 50% of expectedSalary 100000 = ₹50,000.00
    expect(screen.getByTestId('target-budget-amount')).toHaveTextContent('₹50,000.00');
    expect(screen.getByTestId('projected-savings-amount')).toHaveTextContent('Surplus:');
    expect(screen.getByTestId('net-savings-forecast')).toBeInTheDocument();
    expect(screen.getByTestId('net-savings-target')).toBeInTheDocument();
    expect(screen.getByTestId('active-fixed-charges-amount')).toBeInTheDocument();

    // Run-rate panel should render discretionary spent correctly
    // Uber rides inside cycle range (2026-06-17 to 2026-07-16) is just t-1 (800)
    // (t-2 is on 2026-07-20 which is out of range)
    expect(screen.getByTestId('discretionary-spent-value')).toHaveTextContent('₹800.00');

    // Should detect the recurring Uber bill
    expect(screen.getByText('Predicted Recurring Bills & Subscriptions')).toBeInTheDocument();
    const rows = screen.getAllByTestId('recurring-bill-row');
    expect(rows.length).toBe(1);
    expect(screen.getByText('Uber Rides')).toBeInTheDocument();
    // Allow either '19 Aug 2026' or 'Aug 19, 2026' depending on environment locale
    const nextDateText = screen.getByTestId('predicted-next-date').textContent;
    expect(nextDateText).toMatch(/19 Aug 2026|Aug 19, 2026/);
  });

  /**
   * [FUNC-ANALYSIS-11] / [NFR-ANALYSIS-8]:
   * Verify that sliding the budget target adjusts target totals and updates forecast warnings dynamically.
   */
  it('updates target amounts and updates forecast alerts dynamically when slider changes value', async () => {
    render(
      <BrowserRouter>
        <FinancialAnalytics />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Financial Analytics & Predictions')).toBeInTheDocument();
    });

    const slider = screen.getByTestId('target-budget-slider') as HTMLInputElement;
    
    // Trigger slider reduction to 10% (budget cap = ₹10,000)
    fireEvent.change(slider, { target: { value: '10' } });
    expect(screen.getByTestId('target-budget-amount')).toHaveTextContent('₹10,000.00');
    expect(screen.getByTestId('projected-savings-amount')).toHaveTextContent(/Surplus|Overspend/);
    expect(screen.getByTestId('net-savings-forecast')).toBeInTheDocument();
    expect(screen.getByTestId('net-savings-target')).toBeInTheDocument();
    expect(screen.getByTestId('active-fixed-charges-amount')).toBeInTheDocument();

    // Verify forecast layout alert exists
    expect(screen.getByTestId('forecast-callout')).toBeInTheDocument();
  });

  it('opens calculation breakdown modal when clicking on calculated forecast buttons', async () => {
    render(
      <BrowserRouter>
        <FinancialAnalytics />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Financial Analytics & Predictions')).toBeInTheDocument();
    });

    const forecastBtn = screen.getByTestId('net-savings-forecast');
    fireEvent.click(forecastBtn);

    // Verify modal is open
    expect(screen.getByTestId('calc-explanation-modal')).toBeInTheDocument();
    expect(screen.getByTestId('modal-title')).toHaveTextContent('Projected Salary Surplus Breakdown');

    // Close modal
    const closeBtn = screen.getByTestId('close-modal-button');
    fireEvent.click(closeBtn);
    expect(screen.queryByTestId('calc-explanation-modal')).not.toBeInTheDocument();
  });

  it('opens recurrence logic explanation modal when clicking on a merchant name', async () => {
    render(
      <BrowserRouter>
        <FinancialAnalytics />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Financial Analytics & Predictions')).toBeInTheDocument();
    });

    const merchantBtn = screen.getByTestId('explain-merchant-button');
    fireEvent.click(merchantBtn);

    // Verify modal is open
    expect(screen.getByTestId('recurrence-explanation-modal')).toBeInTheDocument();
    expect(screen.getByTestId('recurrence-modal-title')).toHaveTextContent('Why is "Uber Rides" flagged?');

    // Close modal
    const closeBtn = screen.getByTestId('close-recurrence-modal-button');
    fireEvent.click(closeBtn);
    expect(screen.queryByTestId('recurrence-explanation-modal')).not.toBeInTheDocument();
  });

  it('updates recurring list state when clicking on frequency filter tabs', async () => {
    render(
      <BrowserRouter>
        <FinancialAnalytics />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Financial Analytics & Predictions')).toBeInTheDocument();
    });

    const weeklyTab = screen.getByTestId('filter-weekly');
    fireEvent.click(weeklyTab);

    // Verify correct description content is displayed
    expect(screen.getByText(/Weekly outflows/i)).toBeInTheDocument();
  });

  it('displays horizontal average reference lines for both periodicity charts', async () => {
    render(
      <BrowserRouter>
        <FinancialAnalytics />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Financial Analytics & Predictions')).toBeInTheDocument();
    });

    expect(screen.getByTestId('dom-average-line')).toBeInTheDocument();
    expect(screen.getByTestId('dow-average-line')).toBeInTheDocument();
  });
});
