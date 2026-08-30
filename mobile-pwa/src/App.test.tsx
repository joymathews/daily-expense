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
  useGoogleLogin: (options: any) => () => {
    if (options && options.onSuccess) {
      options.onSuccess({ access_token: 'mock-google-token' });
    }
  },
}));

describe('Mobile PWA Application Test Suite', () => {
  const globalFetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).__VITEST__ = true;
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
      if (urlStr.includes('/api/pipeline/raw-inputs') || urlStr.includes('/api/pipeline/raw-emails')) {
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
                  bronzeInputId: 'bronze-msg-101',
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
    it('displays connecting progress during server cold start and unlocks when healthy [FUNC-MOB-6] [NFR-MOB-2]', async () => {
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
    it('renders persistent top budget cap controller, real-time safe to spend today allowance and cycle run-rate [FUNC-MOB-1] [NFR-MOB-1] [NFR-MOB-3]', async () => {
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

      // Velocity, survival days, and estimated savings
      expect(screen.getByTestId('current-velocity-value')).toBeInTheDocument();
      expect(screen.getByTestId('remaining-days-value')).toBeInTheDocument();
      expect(screen.getByTestId('salary-surplus-cell')).toBeInTheDocument();
      expect(screen.getByTestId('projected-savings-amount')).toBeInTheDocument();
      expect(screen.getByTestId('target-savings-amount')).toBeInTheDocument();
    });
  });

  describe('[FUNC-MOB-2] / [FUNC-MOB-3] Ingestion Triage (Bronze -> Silver Flow)', () => {
    it('allows rejecting a Bronze raw email with deferred commit and restoring it in Deck Completion [FUNC-MOB-2]', async () => {
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

      // Tap Reject -> Transitions to Deck Complete screen with deferred rejection
      const rejectBtn = screen.getByTestId('reject-bronze-btn');
      fireEvent.click(rejectBtn);

      await waitFor(() => {
        expect(screen.getByTestId('deck-complete-card')).toBeInTheDocument();
      });
      expect(screen.getByText(/Marked for Rejection \(1\)/i)).toBeInTheDocument();

      // Test Restore action
      const restoreBtn = screen.getByTestId('restore-email-bronze-msg-101');
      fireEvent.click(restoreBtn);

      // Now 1 is ready for extraction
      expect(screen.getByText(/Ready for AI Extraction \(1\)/i)).toBeInTheDocument();

      // Confirm & Extract
      const extractBtn = screen.getByTestId('batch-extract-btn');
      fireEvent.click(extractBtn);

      await waitFor(() => {
        expect(screen.getByTestId('silver-extraction-card')).toBeInTheDocument();
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

      // Tap Finish Screening -> Deck Complete Screen appears -> Tap Extract All
      const acceptBtn = screen.getByTestId('accept-bronze-btn');
      fireEvent.click(acceptBtn);

      expect(screen.getByTestId('deck-complete-card')).toBeInTheDocument();
      const extractBtn = screen.getByTestId('batch-extract-btn');
      fireEvent.click(extractBtn);

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

      // View source email on dedicated page without reverting
      const viewSourceBtn = screen.getByTestId('view-source-email-btn');
      fireEvent.click(viewSourceBtn);
      expect(screen.getByTestId('source-email-reader-view')).toBeInTheDocument();
      expect(screen.getByTestId('source-email-message-body')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('back-to-edit-btn'));
      expect(screen.getByTestId('silver-extraction-card')).toBeInTheDocument();

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

    it('toggles fetch settings drawer on demand and supports batch extraction across multiple kept cards [FUNC-MOB-2] [FUNC-MOB-10] [NFR-MOB-4]', async () => {
      // Mock 2 raw emails in queue
      globalFetchMock.mockImplementation(async (url: string, init?: any) => {
        if (url.includes('/api/pipeline/raw-inputs')) {
          return {
            ok: true,
            json: async () => ({
              emails: [
                {
                  id: 'email_multi_1',
                  sender: 'alerts@hdfcbank.net',
                  title: 'INR 1,450 spent at Swiggy',
                  snippet: 'Swiggy transaction',
                  rawBody: 'Swiggy transaction full body',
                  receivedAt: '2026-08-30T10:00:00Z',
                  status: 'unprocessed',
                },
                {
                  id: 'email_multi_2',
                  sender: 'receipts@uber.com',
                  title: 'Trip with Uber INR 320',
                  snippet: 'Uber trip transaction',
                  rawBody: 'Uber trip transaction full body',
                  receivedAt: '2026-08-30T11:00:00Z',
                  status: 'unprocessed',
                },
              ],
            }),
          };
        }
        if (url.includes('/api/pipeline/extract')) {
          return {
            ok: true,
            json: async () => ({
              extracted: [
                {
                  id: 'silver_batch_1',
                  bronzeInputId: 'email_multi_1',
                  merchantRaw: 'Swiggy',
                  merchantNormalized: 'Swiggy',
                  amount: 1450,
                  currency: 'INR',
                  transactionDate: '2026-08-30',
                  inferredCategory: 'Food & Dining',
                  paymentMethod: 'Credit Card',
                  transactionType: 'expense',
                },
                {
                  id: 'silver_batch_2',
                  bronzeInputId: 'email_multi_2',
                  merchantRaw: 'Uber',
                  merchantNormalized: 'Uber',
                  amount: 320,
                  currency: 'INR',
                  transactionDate: '2026-08-30',
                  inferredCategory: 'Travel & Commute',
                  paymentMethod: 'Credit Card',
                  transactionType: 'expense',
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({}),
        };
      });

      render(
        <BrowserRouter>
          <IngestionTriage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('bronze-email-card')).toBeInTheDocument();
      });

      // Toggle fetch settings drawer open and closed
      const toggleDrawerBtn = screen.getByTestId('toggle-fetch-criteria-btn');
      expect(toggleDrawerBtn).toBeInTheDocument();
      fireEvent.click(toggleDrawerBtn);
      expect(screen.getByTestId('fetch-criteria-card')).toBeInTheDocument();

      // Screen card 1 -> Keep & Next
      const keepBtn = screen.getByTestId('accept-bronze-btn');
      fireEvent.click(keepBtn);

      // Screen card 2 -> Finish Screening
      fireEvent.click(screen.getByTestId('accept-bronze-btn'));

      // Deck completion screen appears
      expect(screen.getByTestId('deck-complete-card')).toBeInTheDocument();
      const batchExtractBtn = screen.getByTestId('batch-extract-btn');
      expect(batchExtractBtn).toHaveTextContent('Confirm & Extract (2 Receipts)');
      fireEvent.click(batchExtractBtn);

      // Verify transition to Silver verification card
      await waitFor(() => {
        expect(screen.getByTestId('silver-extraction-card')).toBeInTheDocument();
      });
      expect(screen.getByTestId('silver-merchant-input')).toHaveValue('Swiggy');
      expect(screen.getByTestId('silver-sender-address')).toHaveTextContent('alerts@hdfcbank.net');
    });

    it('displays prominent error banner and allows retry when AI extraction fails instead of showing empty drafts [BUG-021]', async () => {
      // Mock extract endpoint returning 503 error
      globalFetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/api/pipeline/raw-inputs')) {
          return {
            ok: true,
            json: async () => ({
              emails: [
                {
                  id: 'email_fail_1',
                  sender: 'alerts@hdfcbank.net',
                  title: 'INR 1,450 spent at Swiggy',
                  snippet: 'Swiggy transaction',
                  rawBody: 'Swiggy transaction full body',
                  receivedAt: '2026-08-30T10:00:00Z',
                  status: 'unprocessed',
                },
              ],
            }),
          };
        }
        if (url.includes('/api/pipeline/extract')) {
          return {
            ok: false,
            status: 503,
            json: async () => ({
              error: 'AI Engine (Ollama) is unavailable or warming up.',
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({}),
        };
      });

      render(
        <BrowserRouter>
          <IngestionTriage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('bronze-email-card')).toBeInTheDocument();
      });

      // Finish Screening
      fireEvent.click(screen.getByTestId('accept-bronze-btn'));

      expect(screen.getByTestId('deck-complete-card')).toBeInTheDocument();
      const extractBtn = screen.getByTestId('batch-extract-btn');
      fireEvent.click(extractBtn);

      // Verify error banner is displayed and user remains on deck complete screen (NOT redirected to empty Silver drafts)
      await waitFor(() => {
        expect(screen.getByTestId('extraction-error-banner')).toBeInTheDocument();
      });
      expect(screen.getByText(/AI Engine \(Ollama\) is unavailable/i)).toBeInTheDocument();
      expect(screen.queryByTestId('silver-extraction-card')).not.toBeInTheDocument();

      // Verify retry button is available
      expect(screen.getByTestId('batch-extract-btn')).toHaveTextContent(/Retry Extraction/i);
    });

    it('proactively pings LLM health probe in background and auto-retries on cold start [FUNC-MOB-11] [NFR-MOB-5]', async () => {
      let extractCallCount = 0;
      globalFetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/api/pipeline/raw-inputs')) {
          return {
            ok: true,
            json: async () => ({
              emails: [
                {
                  id: 'email_cold_1',
                  sender: 'alerts@hdfcbank.net',
                  title: 'INR 500 spent at Uber',
                  snippet: 'Uber trip',
                  rawBody: 'Uber trip full body',
                  receivedAt: '2026-08-30T10:00:00Z',
                  status: 'unprocessed',
                },
              ],
            }),
          };
        }
        if (url.includes('/api/pipeline/llm-status')) {
          return {
            ok: true,
            json: async () => ({ available: true }),
          };
        }
        if (url.includes('/api/pipeline/extract')) {
          extractCallCount++;
          if (extractCallCount === 1) {
            // First call returns 503 (cold start container warming up)
            return {
              ok: false,
              status: 503,
              json: async () => ({ code: 'LLM_SERVICE_UNAVAILABLE' }),
            };
          }
          // Second call (auto-retry) succeeds
          return {
            ok: true,
            json: async () => ({
              extracted: [
                {
                  id: 'silver_cold_1',
                  bronzeInputId: 'email_cold_1',
                  merchantRaw: 'Uber',
                  merchantNormalized: 'Uber',
                  amount: 500,
                  currency: 'INR',
                  transactionDate: '2026-08-30',
                  inferredCategory: 'Cabs & Transport',
                  paymentMethod: 'Credit Card',
                  transactionType: 'expense',
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({}),
        };
      });

      render(
        <BrowserRouter>
          <IngestionTriage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('bronze-email-card')).toBeInTheDocument();
      });

      // Verify proactive LLM status probe was sent in background on mount
      const statusCalls = globalFetchMock.mock.calls.filter((call) =>
        String(call[0]).includes('/api/pipeline/llm-status')
      );
      expect(statusCalls.length).toBeGreaterThan(0);

      // Finish screening to deck complete
      fireEvent.click(screen.getByTestId('accept-bronze-btn'));
      expect(screen.getByTestId('deck-complete-card')).toBeInTheDocument();

      // Trigger batch extract
      fireEvent.click(screen.getByTestId('batch-extract-btn'));

      // Verify it auto-retried and successfully transitioned to Silver card
      await waitFor(() => {
        expect(screen.getByTestId('silver-extraction-card')).toBeInTheDocument();
      }, { timeout: 8000 });

      expect(screen.getByTestId('silver-merchant-input')).toHaveValue('Uber');
      expect(extractCallCount).toBe(2);
    });

    it('automatically resumes at pending Silver review cards when returning to triage page and dynamically loads database categories [BUG-022] [FUNC-MOB-3]', async () => {
      globalFetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/api/pipeline/silver-transactions')) {
          return {
            ok: true,
            json: async () => ({
              transactions: [
                {
                  id: 'silver_pending_db_1',
                  bronzeInputId: 'bronze_prev_1',
                  merchantRaw: 'Zomato Online',
                  merchantNormalized: 'Zomato Online',
                  amount: 720,
                  currency: 'INR',
                  transactionDate: '2026-08-29',
                  inferredCategory: 'Custom Pet Supplies',
                  paymentMethod: 'Credit Card',
                  status: 'pending',
                },
              ],
            }),
          };
        }
        if (url.includes('/api/pipeline/gold-transactions')) {
          return {
            ok: true,
            json: async () => ({
              transactions: [
                {
                  id: 'gold_tx_1',
                  merchantNormalized: 'Gym Fee',
                  amount: 1500,
                  currency: 'INR',
                  transactionDate: '2026-08-20',
                  inferredCategory: 'Custom Fitness & Health',
                  paymentMethod: 'UPI',
                },
              ],
            }),
          };
        }
        if (url.includes('/api/pipeline/raw-inputs')) {
          return {
            ok: true,
            json: async () => ({
              emails: [],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({}),
        };
      });

      render(
        <BrowserRouter>
          <IngestionTriage />
        </BrowserRouter>
      );

      // Verify it immediately opens in Silver Review Phase directly (resuming unapproved batch)
      await waitFor(() => {
        expect(screen.getByTestId('silver-extraction-card')).toBeInTheDocument();
      });
      expect(screen.getByTestId('silver-merchant-input')).toHaveValue('Zomato Online');
      expect(screen.getByTestId('silver-amount-input')).toHaveValue(720);

      // Verify custom categories from DB are merged into category select options
      const categorySelect = screen.getByTestId('silver-category-select');
      expect(categorySelect).toBeInTheDocument();
      expect(categorySelect.textContent).toContain('Custom Pet Supplies');
      expect(categorySelect.textContent).toContain('Custom Fitness & Health');
    });

    it('allows traversing multi-item Silver queue with Prev and Next controls while preserving edits [FUNC-MOB-3]', async () => {
      globalFetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/api/pipeline/silver-transactions')) {
          return {
            ok: true,
            json: async () => ({
              transactions: [
                {
                  id: 'silver_q_1',
                  bronzeInputId: 'bronze_1',
                  merchantRaw: 'Swiggy Food',
                  merchantNormalized: 'Swiggy Food',
                  amount: 350,
                  currency: 'INR',
                  transactionDate: '2026-08-30',
                  inferredCategory: 'Food & Dining',
                  paymentMethod: 'UPI',
                  status: 'pending',
                },
                {
                  id: 'silver_q_2',
                  bronzeInputId: 'bronze_2',
                  merchantRaw: 'Uber India',
                  merchantNormalized: 'Uber India',
                  amount: 180,
                  currency: 'INR',
                  transactionDate: '2026-08-30',
                  inferredCategory: 'Travel & Commute',
                  paymentMethod: 'Credit Card',
                  status: 'pending',
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({}),
        };
      });

      render(
        <BrowserRouter>
          <IngestionTriage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('silver-extraction-card')).toBeInTheDocument();
      });

      // Initially on card 1
      expect(screen.getByTestId('silver-merchant-input')).toHaveValue('Swiggy Food');
      expect(screen.getByTestId('silver-prev-btn')).toBeDisabled();
      expect(screen.getByTestId('silver-next-btn')).not.toBeDisabled();

      // Edit merchant on card 1
      const merchantInput = screen.getByTestId('silver-merchant-input');
      fireEvent.change(merchantInput, { target: { value: 'Swiggy Instamart' } });

      // Tap Next -> Flips to card 2
      fireEvent.click(screen.getByTestId('silver-next-btn'));
      expect(screen.getByTestId('silver-merchant-input')).toHaveValue('Uber India');
      expect(screen.getByTestId('silver-next-btn')).toBeDisabled();
      expect(screen.getByTestId('silver-prev-btn')).not.toBeDisabled();

      // Tap Prev -> Flips back to card 1, preserving previous edit
      fireEvent.click(screen.getByTestId('silver-prev-btn'));
      expect(screen.getByTestId('silver-merchant-input')).toHaveValue('Swiggy Instamart');
    });

    it('renders Silver Stage badge, supports dropdown selection and on-the-fly custom category and payment creation [FUNC-MOB-3]', async () => {
      globalFetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/api/pipeline/silver-transactions')) {
          return {
            ok: true,
            json: async () => ({
              transactions: [
                {
                  id: 'silver_q_1',
                  bronzeInputId: 'bronze_1',
                  merchantRaw: 'Swiggy Food',
                  merchantNormalized: 'Swiggy Food',
                  amount: 350,
                  currency: 'INR',
                  transactionDate: '2026-08-30',
                  inferredCategory: 'Food & Dining',
                  paymentMethod: 'UPI',
                  status: 'pending',
                },
              ],
            }),
          };
        }
        if (url.includes('/api/ingestion/payment-methods')) {
          return {
            ok: true,
            json: async () => ({
              paymentMethods: [{ id: 'pm1', name: 'Axis Bank Forex Card' }],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({}),
        };
      });

      render(
        <BrowserRouter>
          <IngestionTriage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('silver-extraction-card')).toBeInTheDocument();
      });

      // Verify "Silver Stage" badge
      expect(screen.getByText(/Silver Stage 1 of 1/i)).toBeInTheDocument();

      // Verify DB payment method is merged into dropdown
      const pmSelect = screen.getByTestId('silver-payment-method-select');
      expect(pmSelect.textContent).toContain('Axis Bank Forex Card');

      // Test custom category creation via dropdown option
      const catDropdown = screen.getByTestId('silver-category-select');
      fireEvent.change(catDropdown, { target: { value: '__ADD_NEW__' } });
      const customCatInput = screen.getByTestId('silver-custom-category-input');
      fireEvent.change(customCatInput, { target: { value: 'Organic Gardening' } });
      fireEvent.click(screen.getByTestId('set-custom-category-btn'));

      const updatedCatSelect = screen.getByTestId('silver-category-select');
      expect(updatedCatSelect).toHaveValue('Organic Gardening');

      // Test custom payment method creation via dropdown option
      const pmDropdown = screen.getByTestId('silver-payment-method-select');
      fireEvent.change(pmDropdown, { target: { value: '__ADD_NEW__' } });
      const customPmInput = screen.getByTestId('silver-custom-method-input');
      fireEvent.change(customPmInput, { target: { value: 'Crypto Wallet' } });
      fireEvent.click(screen.getByTestId('set-custom-method-btn'));

      const updatedPmSelect = screen.getByTestId('silver-payment-method-select');
      expect(updatedPmSelect).toHaveValue('Crypto Wallet');
    });
  });

  describe('[FUNC-MOB-4] / [FUNC-MOB-5] / [FUNC-MOB-7] Gold Ledger & Current-Cycle Scoping', () => {
    it('renders confirmed ledger scoped strictly to current cycle up to current date [FUNC-MOB-7], allows editing, full-page source email view, and reverting to Silver', async () => {
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

      // Check full-page source email viewing
      const viewSourceBtn = screen.getByTestId('detail-view-source-btn');
      fireEvent.click(viewSourceBtn);
      expect(screen.getByTestId('source-email-reader-view')).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByTestId('source-email-message-body')).toHaveTextContent('Full email body details for Swiggy food delivery purchase');
      });
      fireEvent.click(screen.getByTestId('back-to-edit-btn'));
      expect(screen.getByTestId('transaction-detail-modal')).toBeInTheDocument();

      // Test back button
      const backBtn = screen.getByTestId('close-detail-modal-btn');
      fireEvent.click(backBtn);
      expect(screen.queryByTestId('transaction-detail-modal')).not.toBeInTheDocument();

      // Re-open and make edit & save
      fireEvent.click(screen.getByTestId('tx-row-gold-tx-1'));
      await waitFor(() => {
        expect(screen.getByTestId('transaction-detail-modal')).toBeInTheDocument();
      });

      const amountInput2 = screen.getByTestId('edit-tx-amount') as HTMLInputElement;
      fireEvent.change(amountInput2, { target: { value: '1500' } });
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

  describe('[FUNC-MOB-9] Top-Header Hamburger Navigation Drawer', () => {
    it('opens navigation drawer from header hamburger menu, supports navigation, close, and logout [FUNC-MOB-9] [NFR-MOB-1]', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('hamburger-menu-btn')).toBeInTheDocument();
      });

      // Drawer is initially closed
      expect(screen.queryByTestId('navigation-drawer-panel')).not.toBeInTheDocument();

      // Tap Hamburger icon to open drawer
      fireEvent.click(screen.getByTestId('hamburger-menu-btn'));

      // Drawer should now be visible
      await waitFor(() => {
        expect(screen.getByTestId('navigation-drawer-panel')).toBeInTheDocument();
      });

      expect(screen.getByTestId('nav-drawer-compass')).toBeInTheDocument();
      expect(screen.getByTestId('nav-drawer-triage')).toBeInTheDocument();
      expect(screen.getByTestId('nav-drawer-ledger')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-signout-btn')).toBeInTheDocument();

      // Click Close button
      fireEvent.click(screen.getByTestId('close-drawer-btn'));
      expect(screen.queryByTestId('navigation-drawer-panel')).not.toBeInTheDocument();

      // Re-open drawer and click a navigation item
      fireEvent.click(screen.getByTestId('hamburger-menu-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('nav-drawer-triage')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('nav-drawer-triage'));
      expect(screen.queryByTestId('navigation-drawer-panel')).not.toBeInTheDocument();
    });
  });
});

