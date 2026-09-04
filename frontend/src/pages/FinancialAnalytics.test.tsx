import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import FinancialAnalytics from './FinancialAnalytics';
import {
  calculateDiscretionarySpend,
  calculateRunRateForecast,
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
    const todayStr = '2026-06-27'; // June 17 to June 26 = 10 completed days before today, 19 remaining days after today
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
    expect(result.remainingDays).toBe(19);
    expect(result.dailyVelocity).toBe(2000);
    expect(result.projectedSpend).toBe(58000); // 20000 + (2000 * 19)
    expect(result.isExceeding).toBe(true);
    // targetBudget 30000 / velocity 2000 = 15 days from start (June 17 + 15 days = July 2)
    expect(result.exhaustionDate).toBe('2026-07-02');
    expect(result.recommendedDailyRate).toBeCloseTo(526.32, 1); // remaining budget 10000 / remaining days 19
  });

  it('correctly adjusts recommended daily rate when target budget is unsustainable', () => {
    const cycleRange = { start: '2026-06-17', end: '2026-07-16' }; // 30 days
    const todayStr = '2026-06-28'; // 11 completed days before today, 18 remaining days after today
    const discretionarySpend = 22000;
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
    expect(result.elapsedDays).toBe(11);
    expect(result.remainingDays).toBe(18);
    // Remaining budget should be based on sustainableCap (40000) minus discretionarySpend (22000) = 18000
    // Recommended daily rate = 18000 / 18 days = 1000
    expect(result.recommendedDailyRate).toBe(1000);
  });
});

describe('Financial Analytics Page Integration and UI Rendering', () => {
  const globalFetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date('2026-08-22T00:00:00.000Z'));
    global.fetch = globalFetchMock;
    
    // Default fetch mocks
    globalFetchMock.mockImplementation((url: any) => {
      const urlString = typeof url === 'string' ? url : (url?.url || String(url));
      if (urlString.includes('/api/pipeline/gold-transactions')) {
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
      if (urlString.includes('/api/pipeline/user-preferences')) {
        return Promise.resolve({
          json: () => Promise.resolve({
            billingCycleStartDay: 17,
            expectedSalary: 100000
          })
        });
      }
      if (urlString.includes('/api/pipeline/user-cycles')) {
        return Promise.resolve({
          json: () => Promise.resolve({
            cycles: [
              {
                id: 'default-2026-06-17',
                cycleName: 'Jun 17 – Jul 16, 2026',
                startType: 'default',
                startDate: '2026-06-17',
                startTimestamp: '2026-06-17T00:00:00.000Z',
                endDate: '2026-07-16',
                endTimestamp: '2026-07-16T23:59:59.999Z',
                totalDays: 30,
                isCurrent: true,
              }
            ],
            activeCycle: {
              id: 'default-2026-06-17',
              cycleName: 'Jun 17 – Jul 16, 2026',
              startType: 'default',
              startDate: '2026-06-17',
              startTimestamp: '2026-06-17T00:00:00.000Z',
              endDate: '2026-07-16',
              endTimestamp: '2026-07-16T23:59:59.999Z',
              totalDays: 30,
              isCurrent: true,
            }
          })
        });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * [FUNC-ANALYSIS-10] / [FUNC-ANALYSIS-11] / [FUNC-ANALYSIS-12]:
   * Verify the default landing view fetches correctly and loads page headers, slider control, and projected forecasts.
   */
  it('renders title, loads ledger data, displays interactive budget slider, and displays projected forecasts [FUNC-ANALYSIS-16] [NFR-ANALYSIS-11] [NFR-ANALYSIS-9]', async () => {
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
    await waitFor(() => {
      expect(screen.getByTestId('discretionary-spent-value')).toHaveTextContent('₹800.00');
    });
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
});
