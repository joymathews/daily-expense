import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import React from 'react';
import GoldTransactions from './GoldTransactions';
import { useGmailIntegration } from '../hooks/use-gmail-integration';

vi.mock('../hooks/use-gmail-integration', () => ({
  useGmailIntegration: vi.fn(),
}));

describe('GoldTransactions Page Relocated Widgets', () => {
  const mockSetStartDate = vi.fn();
  const mockSetEndDate = vi.fn();
  const mockUpdateGoldTransaction = vi.fn();
  const mockUpdateSilverTransaction = vi.fn();
  const mockRevertOrDeleteRecord = vi.fn();
  const mockFetchLlmLog = vi.fn();

  const defaultMockHookValue = {
    startDate: '',
    setStartDate: mockSetStartDate,
    endDate: '',
    setEndDate: mockSetEndDate,
    rawEmails: [],
    silverTransactions: [],
    goldTransactions: [
      {
        id: 'tx-1',
        merchant: 'Mutual Fund India',
        amount: 25000,
        currency: 'INR',
        transactionDate: '2026-06-18',
        category: 'Investment',
        paymentMethod: 'NetBanking',
        sourceType: 'manual',
        transactionType: 'expense',
      },
      {
        id: 'tx-2',
        merchant: 'Uber Rides',
        amount: 500,
        currency: 'INR',
        transactionDate: '2026-06-20',
        category: 'Cabs & Transport',
        paymentMethod: 'Paytm',
        sourceType: 'email',
        transactionType: 'expense',
      },
      {
        id: 'tx-3',
        merchant: 'Starbucks',
        amount: 1500,
        currency: 'INR',
        transactionDate: '2026-06-22',
        category: 'Restaurant & Dining',
        paymentMethod: 'Credit Card',
        sourceType: 'email',
        transactionType: 'expense',
      },
      {
        id: 'tx-4',
        merchant: 'Salary Offset Refund',
        amount: 1000,
        currency: 'INR',
        transactionDate: '2026-06-21',
        category: 'Restaurant & Dining',
        paymentMethod: 'Credit Card',
        sourceType: 'email',
        transactionType: 'refund',
      },
      {
        id: 'tx-5',
        merchant: 'Personal Transfer',
        amount: 5000,
        currency: 'INR',
        transactionDate: '2026-06-21',
        category: 'Other',
        paymentMethod: 'Unknown',
        sourceType: 'manual',
        transactionType: 'transfer',
      }
    ],
    updateGoldTransaction: mockUpdateGoldTransaction,
    updateSilverTransaction: mockUpdateSilverTransaction,
    revertOrDeleteRecord: mockRevertOrDeleteRecord,
    paymentMethods: [],
    isLoading: false,
    fetchLlmLog: mockFetchLlmLog,
    billingCycleStartDay: 17,
    expectedSalary: 100000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useGmailIntegration).mockReturnValue(defaultMockHookValue as any);
  });

  it('renders Salary Allocation Breakdown widget above filters and evaluates cycles correctly', () => {
    render(
      <BrowserRouter>
        <GoldTransactions />
      </BrowserRouter>
    );

    // Verify widget title
    expect(screen.getByText(/Salary Allocation Breakdown/i)).toBeInTheDocument();
    
    // Active Cycle range verify: 17th to 17th next month
    // Since today is June 20, 2026, active cycle starts 2026-06-17 and ends 2026-07-17
    expect(screen.getByText(/Active Cycle: 2026-06-17 to 2026-07-17/i)).toBeInTheDocument();

    // Verify mutual fund progress bar
    expect(screen.getByTestId('bucket-mutual-funds-bar')).toBeInTheDocument();
    
    // Verify values calculated:
    // Expected salary: 100000
    // Mutual fund category = 'Investment' -> tx-1 (25000) -> 25%
    // Consumption: Uber (500) + Starbucks (1500) - Refund (1000) = 1000 -> 1%
    // (Note: Transfer tx-5 is excluded from consumption and MF)
    // Savings: 100000 - 25000 - 1000 = 74000 -> 74%
    expect(screen.getByText(/₹25000.00 \(25.0%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/₹1000.00 \(1.0%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/₹74000.00 \(74.0%\)/i)).toBeInTheDocument();
  });

  it('renders collapsible Daily Spend Timeline SVG below category breakdown and tracks filters', async () => {
    render(
      <BrowserRouter>
        <GoldTransactions />
      </BrowserRouter>
    );

    // Verify SVG timeline exists
    expect(screen.getByText(/Daily Spend Timeline/i)).toBeInTheDocument();
    expect(screen.getByTestId('analysis-daily-spend-chart')).toBeInTheDocument();

    // Expand/collapse timeline
    const collapseTimelineBtn = screen.getAllByRole('button', { name: /Collapse/i })[1]; // Index 1 is timeline, 0 is Category Spend
    expect(screen.getByText(/Daily Spend Timeline/i)).toBeInTheDocument();

    // Collapse
    fireEvent.click(collapseTimelineBtn);
    // Grid lines and labels should be hidden
    expect(screen.queryByText('18 Jun')).not.toBeInTheDocument();

    // Expand back
    const expandTimelineBtn = screen.getByRole('button', { name: /Expand/i });
    fireEvent.click(expandTimelineBtn);
    expect(screen.getByText('18 Jun')).toBeInTheDocument();
  });
});
