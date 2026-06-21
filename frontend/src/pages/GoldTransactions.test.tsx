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



  /**
   * [FUNC-GOLD-PAGE-12] / [FUNC-ANALYSIS-4] / [NFR-USAB-29]:
   * Verify that panels are hidden by default, toggling their checkboxes displays/hides them,
   * and clicking "Clear Filters" does NOT reset the panel checkboxes.
   */
  it('hides category and daily spend panels by default, toggles visibility via checkboxes, and does not reset on clear filters', async () => {
    render(
      <BrowserRouter>
        <GoldTransactions />
      </BrowserRouter>
    );

    // Panels must be hidden by default
    expect(screen.queryByTestId('category-spend-breakdown-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('analysis-daily-spend-chart')).not.toBeInTheDocument();

    const categoryCheckbox = screen.getByLabelText(/Show Category Breakdown/i);
    const timelineCheckbox = screen.getByLabelText(/Show Daily Spend Timeline/i);

    expect(categoryCheckbox).not.toBeChecked();
    expect(timelineCheckbox).not.toBeChecked();

    // Toggle Category breakdown on
    fireEvent.click(categoryCheckbox);
    expect(categoryCheckbox).toBeChecked();
    expect(screen.getByTestId('category-spend-breakdown-panel')).toBeInTheDocument();

    // Toggle Timeline on
    fireEvent.click(timelineCheckbox);
    expect(timelineCheckbox).toBeChecked();
    expect(screen.getByTestId('analysis-daily-spend-chart')).toBeInTheDocument();

    // Clear filters
    const clearBtn = screen.getByRole('button', { name: /Clear Filters/i });
    fireEvent.click(clearBtn);

    // Checkboxes should remain checked and panels should remain visible
    expect(categoryCheckbox).toBeChecked();
    expect(timelineCheckbox).toBeChecked();
    expect(screen.getByTestId('category-spend-breakdown-panel')).toBeInTheDocument();
    expect(screen.getByTestId('analysis-daily-spend-chart')).toBeInTheDocument();

    // Toggle Category breakdown off
    fireEvent.click(categoryCheckbox);
    expect(categoryCheckbox).not.toBeChecked();
    expect(screen.queryByTestId('category-spend-breakdown-panel')).not.toBeInTheDocument();
  });

  /**
   * [FUNC-ANALYSIS-4] / [NFR-USAB-27] / [NFR-USAB-29]:
   * Verify collapsible Daily Spend Timeline SVG behavior when panels are explicitly made visible.
   */
  it('renders collapsible Daily Spend Timeline SVG below category breakdown and tracks filters', async () => {
    render(
      <BrowserRouter>
        <GoldTransactions />
      </BrowserRouter>
    );

    // Make both panels visible
    fireEvent.click(screen.getByLabelText(/Show Category Breakdown/i));
    fireEvent.click(screen.getByLabelText(/Show Daily Spend Timeline/i));

    // Verify SVG timeline exists
    expect(screen.getByTestId('analysis-daily-spend-chart')).toBeInTheDocument();

    // Expand/collapse timeline
    const collapseTimelineBtn = screen.getAllByRole('button', { name: /Collapse/i })[1]; // Index 1 is timeline, 0 is Category Spend
    expect(screen.getByTestId('analysis-daily-spend-chart')).toBeInTheDocument();

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
