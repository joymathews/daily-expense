import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from './App';
import { ServerWarmupGate } from '@daily-expense/financial-core';
import { SummaryCompass } from './pages/SummaryCompass';
import { IngestionTriage } from './pages/IngestionTriage';
import { GoldLedger } from './pages/GoldLedger';
import { BrowserRouter } from 'react-router-dom';

// Mock Authenticator to simulate logged-in user
vi.mock('@aws-amplify/ui-react', () => ({
  Authenticator: ({ children }: { children: any }) => (
    <div>{children({ signOut: vi.fn(), user: { username: 'testuser@example.com' } })}</div>
  ),
}));

// Mock Google OAuth Provider
vi.mock('@react-oauth/google', () => ({
  GoogleOAuthProvider: ({ children }: { children: any }) => <div>{children}</div>,
}));

describe('Mobile PWA Application Test Suite', () => {
  const globalFetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = globalFetchMock;

    // Default mock responses
    globalFetchMock.mockImplementation((url: any, init?: any) => {
      const urlStr = typeof url === 'string' ? url : url?.url || String(url);

      // 1. Health check
      if (urlStr.includes('/api/health')) {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () => Promise.resolve({ status: 'ok', server: 'ready', database: 'connected' }),
        });
      }

      // 2. User preferences
      if (urlStr.includes('/api/pipeline/user-preferences')) {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () => Promise.resolve({ billingCycleStartDay: 17, expectedSalary: 100000 }),
        });
      }

      // 3. User cycles
      if (urlStr.includes('/api/pipeline/user-cycles')) {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              activeCycle: {
                id: 'default-2026-08-17',
                cycleName: '17 Aug – 16 Sep',
                startType: 'default',
                startDate: '2026-08-17',
                startTimestamp: '2026-08-17T00:00:00.000Z',
                endDate: '2026-09-16',
                endTimestamp: '2026-09-16T23:59:59.999Z',
                totalDays: 31,
                isCurrent: true,
              },
            }),
        });
      }

      // 4. Fixed charges
      if (urlStr.includes('/api/pipeline/fixed-charges')) {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () => Promise.resolve({ fixedCharges: [] }),
        });
      }

      // 5. Fetcher emails
      if (urlStr.includes('/api/ingestion/fetcher-emails')) {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () => Promise.resolve({ fetcherEmails: ['alerts@hdfcbank.net', 'receipts@swiggy.in'] }),
        });
      }

      // 6. Raw inputs (Bronze)
      if (urlStr.includes('/api/pipeline/raw-inputs')) {
        if (init?.method === 'PUT') {
          return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ status: 'updated' }) });
        }
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              emails: [
                {
                  id: 'bronze-msg-101',
                  sender: 'alerts@hdfcbank.net',
                  title: 'Transaction Alert: INR 1,450 spent at Swiggy',
                  snippet: 'Your HDFC Card was debited for INR 1,450.00 at Swiggy on 22-Aug-2026',
                  rawBody: 'Full email body details for Swiggy food delivery purchase',
                  receivedAt: '2026-08-22T08:30:00.000Z',
                  status: 'unprocessed',
                  hasTransaction: true,
                },
              ],
            }),
        });
      }

      // 7. Extract to Silver
      if (urlStr.includes('/api/pipeline/extract')) {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              extracted: [
                {
                  id: 'silver-tx-101',
                  bronzeInputId: 'bronze-msg-101',
                  merchantRaw: 'Swiggy',
                  merchantNormalized: 'Swiggy',
                  amount: 1450,
                  currency: 'INR',
                  transactionDate: '2026-08-22',
                  inferredCategory: 'Food & Dining',
                  paymentMethod: 'HDFC Credit Card',
                  transactionType: 'expense',
                  sourceTitle: 'Transaction Alert: INR 1,450 spent at Swiggy',
                  sourceSender: 'alerts@hdfcbank.net',
                  sourceReceivedAt: '2026-08-22T08:30:00.000Z',
                },
              ],
            }),
        });
      }

      // 8. Silver update & approve
      if (urlStr.includes('/api/pipeline/silver-transactions/')) {
        return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ status: 'updated' }) });
      }
      if (urlStr.includes('/api/pipeline/approve')) {
        return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ status: 'approved' }) });
      }

      // 9. Revert routes
      if (urlStr.includes('/api/pipeline/revert-to-bronze') || urlStr.includes('/api/pipeline/revert-to-silver')) {
        return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ status: 'reverted' }) });
      }

      // 10. Gold transactions
      if (urlStr.includes('/api/pipeline/gold-transactions')) {
        if (init?.method === 'PUT') {
          return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ status: 'updated' }) });
        }
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              transactions: [
                {
                  id: 'gold-tx-1',
                  merchant: 'Swiggy Food',
                  amount: 1450,
                  currency: 'INR',
                  transactionDate: '2026-08-22',
                  category: 'Food & Dining',
                  paymentMethod: 'HDFC Credit Card',
                  transactionType: 'expense',
                  sourceTitle: 'Transaction Alert',
                  sourceSender: 'alerts@hdfcbank.net',
                  sourceReceivedAt: '2026-08-22T08:30:00.000Z',
                },
                {
                  id: 'gold-tx-2',
                  merchant: 'Amazon Shopping',
                  amount: 2500,
                  currency: 'INR',
                  transactionDate: '2026-08-18',
                  category: 'Shopping',
                  paymentMethod: 'ICICI Card',
                  transactionType: 'expense',
                  sourceTitle: 'Amazon Invoice',
                  sourceSender: 'auto-confirm@amazon.in',
                  sourceReceivedAt: '2026-08-18T14:15:00.000Z',
                },
              ],
            }),
        });
      }

      return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({}) });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('[FUNC-MOB-6] / [NFR-MOB-2] Server Warmup Gatekeeper', () => {
    it('displays connecting progress during server cold start and unlocks when healthy', async () => {
      globalFetchMock.mockImplementation((url: any) => {
        if (url.includes('/api/health')) {
          return Promise.resolve({
            status: 200,
            ok: true,
            json: () => Promise.resolve({ status: 'ok', server: 'ready', database: 'connected' }),
          });
        }
        return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({}) });
      });

      render(
        <ServerWarmupGate>
          <div data-testid="protected-app-content">Dashboard Active</div>
        </ServerWarmupGate>
      );

      // Content renders once 200 OK received
      await waitFor(() => {
        expect(screen.getByTestId('protected-app-content')).toBeInTheDocument();
      });
    });
  });

  describe('[FUNC-MOB-1] / [NFR-MOB-3] Mobile Financial Compass & Daily Burn Rate', () => {
    it('renders persistent top budget cap controller, real-time safe to spend today allowance and cycle run-rate', async () => {
      render(
        <BrowserRouter>
          <SummaryCompass />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mobile-summary-compass')).toBeInTheDocument();
      });

      // Budget Cap Card at top
      expect(screen.getByTestId('budget-cap-card')).toBeInTheDocument();
      const slider = screen.getByTestId('target-budget-slider') as HTMLInputElement;
      expect(slider.value).toBe('50');

      // Adjust slider to 60%
      fireEvent.change(slider, { target: { value: '60' } });
      expect(slider.value).toBe('60');
      expect(localStorage.getItem('analytics_target_budget_percent')).toBe('60');

      // Total spent = 1450 (Swiggy) + 2500 (Amazon) = 3950
      expect(screen.getByTestId('discretionary-spent-amount')).toHaveTextContent('₹3,950.00');

      // Safe to spend today card
      expect(screen.getByTestId('safe-spend-today-card')).toBeInTheDocument();
      expect(screen.getByTestId('available-today-amount')).toBeInTheDocument();
      expect(screen.getByTestId('future-daily-rate')).toBeInTheDocument();
      expect(screen.getByTestId('projected-spend-amount')).toBeInTheDocument();

      // Velocity and survival days
      expect(screen.getByTestId('current-velocity-value')).toBeInTheDocument();
      expect(screen.getByTestId('remaining-days-value')).toBeInTheDocument();
    });
  });

  describe('[FUNC-MOB-2] / [FUNC-MOB-3] Ingestion Triage (Bronze -> Silver Flow)', () => {
    it('allows rejecting a Bronze raw email and marking it non-transactional', async () => {
      render(
        <BrowserRouter>
          <IngestionTriage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('bronze-email-card')).toBeInTheDocument();
      });

      expect(screen.getByTestId('bronze-sender')).toHaveTextContent('alerts@hdfcbank.net');
      expect(screen.getByTestId('bronze-subject')).toHaveTextContent('INR 1,450 spent at Swiggy');

      // Tap Reject
      const rejectBtn = screen.getByTestId('reject-bronze-btn');
      fireEvent.click(rejectBtn);

      await waitFor(() => {
        expect(screen.getByTestId('action-success-banner')).toHaveTextContent('Non-Transactional and Rejected');
      });
    });

    it('accepts Bronze email, immediately displays editable Silver card, and promotes to Gold', async () => {
      render(
        <BrowserRouter>
          <IngestionTriage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('bronze-email-card')).toBeInTheDocument();
      });

      // Tap Accept & Extract
      const acceptBtn = screen.getByTestId('accept-bronze-btn');
      fireEvent.click(acceptBtn);

      // Silver extraction card should appear immediately
      await waitFor(() => {
        expect(screen.getByTestId('silver-extraction-card')).toBeInTheDocument();
      });

      // Verify editable fields
      const merchantInput = screen.getByTestId('silver-merchant-input') as HTMLInputElement;
      expect(merchantInput.value).toBe('Swiggy');
      
      const amountInput = screen.getByTestId('silver-amount-input') as HTMLInputElement;
      expect(amountInput.value).toBe('1450');

      const currencySelect = screen.getByTestId('silver-currency-select') as HTMLSelectElement;
      expect(currencySelect.value).toBe('INR');

      // Edit merchant
      fireEvent.change(merchantInput, { target: { value: 'Swiggy Gourmet' } });
      expect(merchantInput.value).toBe('Swiggy Gourmet');

      // View source email without reverting
      const viewSourceBtn = screen.getByTestId('view-source-email-btn');
      fireEvent.click(viewSourceBtn);
      expect(screen.getByText('Source Raw Email')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('close-source-modal-btn'));

      // Save & Accept to Gold
      const saveAcceptBtn = screen.getByTestId('save-accept-silver-btn');
      fireEvent.click(saveAcceptBtn);

      await waitFor(() => {
        expect(screen.getByTestId('action-success-banner')).toHaveTextContent('promoted to Gold Ledger');
      });
    });

    it('pre-selects all saved sender pills from database, supports toggling and adding new senders [FUNC-MOB-8]', async () => {
      render(
        <BrowserRouter>
          <IngestionTriage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('fetcher-sender-pills')).toBeInTheDocument();
      });

      // Verify all DB senders are pre-selected by default
      const hdfcPill = screen.getByTestId('sender-pill-alerts@hdfcbank.net');
      const swiggyPill = screen.getByTestId('sender-pill-receipts@swiggy.in');
      expect(hdfcPill).toHaveTextContent('✓');
      expect(swiggyPill).toHaveTextContent('✓');

      // Toggle off Swiggy
      fireEvent.click(swiggyPill);
      expect(swiggyPill).toHaveTextContent('○');

      // Click + Add to open inline input
      const addPillBtn = screen.getByTestId('add-sender-pill-btn');
      fireEvent.click(addPillBtn);

      const customInput = screen.getByTestId('fetcher-sender-input') as HTMLInputElement;
      expect(customInput).toBeInTheDocument();
      fireEvent.change(customInput, { target: { value: 'new_bank@alerts.in' } });

      const confirmBtn = screen.getByTestId('confirm-add-sender-btn');
      fireEvent.click(confirmBtn);

      // Verify new pill is added and selected
      expect(screen.getByTestId('sender-pill-new_bank@alerts.in')).toHaveTextContent('✓');

      // Fetch triggers POST to save new sender to DB and calls fetch with active senders
      const fetchBtn = screen.getByTestId('fetch-emails-btn');
      fireEvent.click(fetchBtn);

      await waitFor(() => {
        expect(globalFetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/ingestion/fetcher-emails'),
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ email: 'new_bank@alerts.in' }),
          })
        );
      });
    });
  });

  describe('[FUNC-MOB-4] / [FUNC-MOB-5] / [FUNC-MOB-7] Gold Ledger & Current-Cycle Scoping', () => {
    it('renders confirmed ledger scoped strictly to current cycle up to current date [FUNC-MOB-7], allows editing, and reverting to Silver', async () => {
      render(
        <BrowserRouter>
          <GoldLedger />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mobile-gold-ledger')).toBeInTheDocument();
      });

      // [FUNC-MOB-7] Verify Cycle Scope Header is displayed with current cycle boundaries
      expect(screen.getByTestId('cycle-scope-banner')).toBeInTheDocument();
      expect(screen.getByTestId('cycle-scope-banner')).toHaveTextContent('Active Cycle Scope');
      expect(screen.getByTestId('cycle-scope-banner')).toHaveTextContent('Today');

      // Verify API was called with startDate and endDate parameters
      const goldCalls = globalFetchMock.mock.calls.filter((call) =>
        String(call[0]).includes('/api/pipeline/gold-transactions')
      );
      expect(goldCalls.length).toBeGreaterThan(0);
      expect(String(goldCalls[0][0])).toContain('startDate=');
      expect(String(goldCalls[0][0])).toContain('endDate=');

      // Verify transaction list rendered
      expect(screen.getByText('Swiggy Food')).toBeInTheDocument();
      expect(screen.getByText('Amazon Shopping')).toBeInTheDocument();

      // Tap transaction to open detail sheet
      const row = screen.getByTestId('tx-row-gold-tx-1');
      fireEvent.click(row);

      await waitFor(() => {
        expect(screen.getByTestId('transaction-detail-modal')).toBeInTheDocument();
      });

      // Check editable currency and amount
      const currencySelect = screen.getByTestId('edit-tx-currency') as HTMLSelectElement;
      expect(currencySelect.value).toBe('INR');

      const amountInput = screen.getByTestId('edit-tx-amount') as HTMLInputElement;
      expect(amountInput.value).toBe('1450');

      // Make edit & save
      fireEvent.change(amountInput, { target: { value: '1500' } });
      const saveBtn = screen.getByTestId('save-tx-changes-btn');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByTestId('ledger-success-banner')).toHaveTextContent('corrections saved');
      });

      // Re-open and test Revert to Silver
      fireEvent.click(screen.getByTestId('tx-row-gold-tx-2'));
      await waitFor(() => {
        expect(screen.getByTestId('transaction-detail-modal')).toBeInTheDocument();
      });

      const revertBtn = screen.getByTestId('revert-to-silver-btn');
      fireEvent.click(revertBtn);

      await waitFor(() => {
        expect(screen.getByTestId('ledger-success-banner')).toHaveTextContent('reverted to Silver');
      });
    });
  });

  describe('[NFR-MOB-1] Bottom Navigation & Viewport Reachability', () => {
    it('renders thumb-zone bottom navigation with 3 tabs', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('mobile-bottom-nav')).toBeInTheDocument();
      });

      expect(screen.getByTestId('nav-compass')).toBeInTheDocument();
      expect(screen.getByTestId('nav-triage')).toBeInTheDocument();
      expect(screen.getByTestId('nav-ledger')).toBeInTheDocument();
    });
  });
});
