import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import FinancialInsights from './FinancialInsights';

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

// Mock window.fetch
const mockTransactions = [
  {
    id: 'tx-1',
    merchant: 'Zomato Food Delivery',
    amount: 15000,
    currency: 'INR',
    transactionDate: '2026-06-20',
    category: 'Online Food Order',
    transactionType: 'expense',
    paymentMethod: 'HDFC Credit Card'
  },
  {
    id: 'tx-2',
    merchant: 'Netflix Subscription',
    amount: 800,
    currency: 'INR',
    transactionDate: '2026-06-25',
    category: 'Entertainment',
    transactionType: 'expense',
    paymentMethod: 'HDFC Credit Card'
  },
  {
    id: 'tx-3',
    merchant: 'Uber Rides',
    amount: 1200,
    currency: 'INR',
    transactionDate: '2026-06-22',
    category: 'Cabs & Transport',
    transactionType: 'expense',
    paymentMethod: 'HDFC Credit Card'
  }
];

const mockFixedCharges = [
  {
    id: 'fc-1',
    merchant: 'House Rent',
    amount: 30000,
    startDate: '2026-06-01',
    endDate: '2026-12-31',
    category: 'Rent'
  }
];

const mockPrefs = {
  billingCycleStartDay: 17,
  expectedSalary: 100000
};

describe('Financial Insights Workspace Page', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/api/pipeline/gold-transactions')) {
        return Promise.resolve({
          json: () => Promise.resolve({ transactions: mockTransactions })
        });
      }
      if (url.includes('/api/pipeline/user-preferences')) {
        return Promise.resolve({
          json: () => Promise.resolve(mockPrefs)
        });
      }
      if (url.includes('/api/pipeline/fixed-charges')) {
        return Promise.resolve({
          json: () => Promise.resolve({ fixedCharges: mockFixedCharges })
        });
      }
      return Promise.reject(new Error('Unknown Endpoint'));
    }));
  });

  it('renders the insights workspace with headers, banners and filters', async () => {
    render(
      <BrowserRouter>
        <FinancialInsights />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('💡 Smart Financial Insights')).toBeInTheDocument();
    });

    expect(screen.getByTestId('savings-banner')).toBeInTheDocument();
    expect(screen.getByTestId('insights-filter-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('insights-grid')).toBeInTheDocument();
  });

  it('allows filtering insights by impact level tabs', async () => {
    render(
      <BrowserRouter>
        <FinancialInsights />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('💡 Smart Financial Insights')).toBeInTheDocument();
    });

    // Locate the critical tag button and click it
    const criticalTab = screen.getByRole('button', { name: /critical/i });
    fireEvent.click(criticalTab);

    // Verify filter displays only matching impact cards (or empty state if none)
    expect(screen.queryByTestId('insight-card-recurring')).not.toBeInTheDocument();
  });
});
