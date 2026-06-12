import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import App from './App';

// Mock Amplify and Authenticator
vi.mock('@aws-amplify/ui-react', async () => {
  const actual = await vi.importActual('@aws-amplify/ui-react');
  return {
    ...actual,
    Authenticator: ({ children }: any) => {
      const isAuthenticated = (globalThis as any).isAuthenticated;
      if (isAuthenticated) {
        return (
          <div data-testid="mocked-authenticator-auth">
            {children({ 
              signOut: (globalThis as any).mockSignOut, 
              user: { signInDetails: { loginId: 'testuser@example.com' } } 
            })}
          </div>
        );
      }
      return <div data-testid="mocked-authenticator-unauth">Sign In Form Mock</div>;
    }
  };
});

// Mock aws-amplify/auth for JWT inclusion in API calls
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: {
      idToken: {
        toString: () => 'valid-token'
      }
    }
  })
}));

// Mock @react-oauth/google
vi.mock('@react-oauth/google', async () => {
  return {
    GoogleOAuthProvider: ({ children }: any) => <div>{children}</div>,
    useGoogleLogin: (options: any) => {
      return () => {
        if (options && options.onSuccess) {
          options.onSuccess({ access_token: 'mock-token' });
        }
      };
    }
  };
});

describe('Requirement Traceability Matrix Verification', () => {
  beforeEach(() => {
    (globalThis as any).isAuthenticated = true;
    (globalThis as any).mockSignOut = vi.fn();
    vi.clearAllMocks();
  });

  /**
   * [FUNC-AUTH-1] The user must be challenged for credentials.
   * [FUNC-AUTH-2] The system must remain inaccessible to unauthenticated users.
   * [NFR-SEC-1] Identity Management: Trusted centralized identity provider.
   */
  it('enforces authentication gate and uses identity provider', async () => {
    (globalThis as any).isAuthenticated = false;
    render(<App />);
    expect(screen.getByTestId('mocked-authenticator-unauth')).toBeInTheDocument();
    expect(screen.queryByText(/HI/i)).not.toBeInTheDocument();
  });

  /**
   * [FUNC-SKEL-UI-1] Access dashboard via browser.
   * [FUNC-SKEL-UI-2] Personalized greeting and branding.
   * [FUNC-SKEL-UI-3] High-density responsive interface.
   * [NFR-PERF-2] Dynamic Layout / Responsive design.
   */
  it('renders dashboard with branding and personalized greeting', () => {
    render(<App />);
    // Select specifically from the navbar or header to justify branding
    expect(screen.getAllByText(/DAILY EXPENSE/i).length).toBeGreaterThan(0);
    // User login ID is testuser@example.com -> split is 'testuser'
    expect(screen.getByText(/HI,/i)).toBeInTheDocument();
    expect(screen.getByText(/testuser/i)).toBeInTheDocument();
    
    // NFR-PERF-2: Check for responsive classes in the main container
    const mainContainer = screen.getByText(/HI,/i).closest('.min-h-screen');
    expect(mainContainer).toHaveClass('selection:bg-blue-100');
  });

  /**
   * [FUNC-AUTH-3] Ability to securely terminate session (Log Out).
   */
  it('allows the user to log out securely', () => {
    render(<App />);
    const signOutBtn = screen.getByText(/Sign Out/i);
    fireEvent.click(signOutBtn);
    expect((globalThis as any).mockSignOut).toHaveBeenCalled();
  });

  /**
   * [FUNC-GMAIL-1] Navigation: Navigate to Gmail Fetcher service.
   */
  it('provides navigation to the Gmail service', () => {
    render(<App />);
    const gmailLink = screen.getByRole('link', { name: /Gmail Fetch/i });
    fireEvent.click(gmailLink);
    expect(screen.getByText(/Fetcher/i)).toBeInTheDocument();
  });

  /**
   * [FUNC-GMAIL-2] Configuration: filters for Sender (multi), Start Date, and End Date.
   * [FUNC-GMAIL-3] Authentication: Authorize via OAuth2 popup.
   * [NFR-GMAIL-1] Session Security: Ephemeral tokens.
   */
  it('supports Gmail configuration and OAuth authentication', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));

    expect(screen.getByPlaceholderText(/Add sender email.../i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/receipt.../i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Start Date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/End Date/i)).toBeInTheDocument();
    expect(screen.getByText(/Authorize & Fetch/i)).toBeInTheDocument();
  });

  /**
   * [FUNC-GMAIL-4] Display: Show fetched data in high-density table.
   * [FUNC-GMAIL-7] Separate Presentation: The system must display the two lists of emails in separate tabs.
   */
  it('displays transaction results table headers and tabs', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));
    expect(screen.getByText(/Transactions/i)).toBeInTheDocument();
    expect(screen.getByText(/Non-Transactional \(For Review\)/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Sender/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Details/i)).toBeInTheDocument();
  });

  /**
   * [FUNC-GMAIL-8] Manual Review: The system must allow user to move emails from non-transaction to transaction section.
   */
  it('allows the user to manually review and move emails to transaction section', async () => {
    // Mock the fetch call
    const mockEmails = [
      { id: '1', sender: 'sender@test.com', subject: 'Inv 123', date: '2023-01-01', snippet: 'Paid amount rs. 100', body: 'Full billing content for Inv 123', hasTransaction: true },
      { id: '2', sender: 'newsletter@test.com', subject: 'Weekly Update', date: '2023-01-02', snippet: 'Hello there', body: 'Full newsletter body content', hasTransaction: false }
    ];
    
    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/gmail/fetch-list')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messageIds: mockEmails.map(e => e.id) }),
        });
      }
      if (url.includes('/api/gmail/fetch-detail')) {
        const bodyObj = JSON.parse(init.body);
        const email = mockEmails.find(e => e.id === bodyObj.messageId);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'fetched', email }),
        });
      }
      if (url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ emails: mockEmails }),
        });
      }
      if (url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });
      }
      if (url.includes('/api/gmail/gold-transactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    
    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));

    // Input filters to pass check
    fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2023-01-01' } });
    fireEvent.change(screen.getByLabelText(/End Date/i), { target: { value: '2023-01-31' } });
    
    // Add a sender
    const senderInput = screen.getByPlaceholderText(/Add sender email.../i);
    fireEvent.change(senderInput, { target: { value: 'sender@test.com' } });
    fireEvent.keyDown(senderInput, { key: 'Enter', code: 'Enter' });

    // Click Authorize & Fetch
    fireEvent.click(screen.getByText(/Authorize & Fetch/i));

    // Wait for the mock to resolve and check elements
    // Transactions tab should be active by default. It should contain 'Inv 123'
    expect(await screen.findByText('Inv 123')).toBeInTheDocument();
    expect(screen.queryByText('Weekly Update')).not.toBeInTheDocument();

    // Badges should show counts
    expect(screen.getByText('Transactions').querySelector('span')?.textContent).toBe('1');
    expect(screen.getByText('Non-Transactional (For Review)').querySelector('span')?.textContent).toBe('1');

    // Click on the Non-Transactional tab
    fireEvent.click(screen.getByText('Non-Transactional (For Review)'));

    // It should display 'Weekly Update'
    expect(screen.getByText('Weekly Update')).toBeInTheDocument();
    expect(screen.queryByText('Inv 123')).not.toBeInTheDocument();

    // Click on 'Mark Tx' for 'Weekly Update'
    const markBtn = screen.getByText('Mark Tx');
    fireEvent.click(markBtn);

    // After clicking, the item should disappear from non-transaction tab
    expect(screen.queryByText('Weekly Update')).not.toBeInTheDocument();

    // Badges should update: Transactions=2, Non-Transactional=0
    expect(screen.getByText('Transactions').querySelector('span')?.textContent).toBe('2');
    expect(screen.getByText('Non-Transactional (For Review)').querySelector('span')?.textContent).toBe('0');

    // Click back to Transactions tab
    fireEvent.click(screen.getByText('Transactions'));
    expect(screen.getByText('Inv 123')).toBeInTheDocument();
    expect(screen.getByText('Weekly Update')).toBeInTheDocument();
    
    // Now verify moving it back to Non-Transactional
    // Click 'Unmark Tx' for 'Inv 123'
    const markNonBtn = screen.getAllByText('Unmark Tx')[0];
    fireEvent.click(markNonBtn);

    // It should disappear from Transactions tab
    expect(screen.queryByText('Inv 123')).not.toBeInTheDocument();

    // Badges should update: Transactions=1, Non-Transactional=1
    expect(screen.getByText('Transactions').querySelector('span')?.textContent).toBe('1');
    expect(screen.getByText('Non-Transactional (For Review)').querySelector('span')?.textContent).toBe('1');

    // Click to Non-Transactional tab and verify it's there
    fireEvent.click(screen.getByText('Non-Transactional (For Review)'));
    expect(screen.getByText('Inv 123')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-9] Email Detail View: Displays modal with full email content when clicked.
   * [FUNC-GMAIL-10] Modal Action Override: Clicking override buttons inside the modal updates classifications.
   */
  it('opens a modal displaying full content when clicking an email, and allows overrides', async () => {
    // Mock the fetch call
    const mockEmails = [
      { id: '1', sender: 'sender@test.com', subject: 'Inv 123', date: '2023-01-01', snippet: 'Paid amount rs. 100', body: 'Full billing content for Inv 123', hasTransaction: true }
    ];
    
    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/gmail/fetch-list')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messageIds: mockEmails.map(e => e.id) }),
        });
      }
      if (url.includes('/api/gmail/fetch-detail')) {
        const bodyObj = JSON.parse(init.body);
        const email = mockEmails.find(e => e.id === bodyObj.messageId);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'fetched', email }),
        });
      }
      if (url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ emails: mockEmails }),
        });
      }
      if (url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });
      }
      if (url.includes('/api/gmail/gold-transactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    
    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));

    // Input filters to pass check
    fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2023-01-01' } });
    fireEvent.change(screen.getByLabelText(/End Date/i), { target: { value: '2023-01-31' } });
    
    // Add a sender
    const senderInput = screen.getByPlaceholderText(/Add sender email.../i);
    fireEvent.change(senderInput, { target: { value: 'sender@test.com' } });
    fireEvent.keyDown(senderInput, { key: 'Enter', code: 'Enter' });

    // Click Authorize & Fetch
    fireEvent.click(screen.getByText(/Authorize & Fetch/i));

    // Wait for email to appear
    const subjectCell = await screen.findByText('Inv 123');
    expect(subjectCell).toBeInTheDocument();

    // Verify modal is not open initially
    expect(screen.queryByTestId('email-detail-modal')).not.toBeInTheDocument();

    // Click on the email subject to open the modal
    fireEvent.click(subjectCell);

    // Modal should now be open
    const modal = screen.getByTestId('email-detail-modal');
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByText('Full billing content for Inv 123')).toBeInTheDocument();

    // The email is currently transactional. Verify it has the status badge and the demotion button
    expect(within(modal).getByText('Status:')).toBeInTheDocument();
    expect(within(modal).getByText('Transactional')).toBeInTheDocument();
    const unmarkBtn = within(modal).getByRole('button', { name: 'Unmark Tx' });
    expect(unmarkBtn).toBeInTheDocument();

    // Click 'Unmark Tx' inside the modal
    fireEvent.click(unmarkBtn);

    // The modal's status badge should update to 'Non-Transactional' and button should update to 'Mark Tx'
    expect(within(modal).queryByText('Transactional')).not.toBeInTheDocument();
    expect(within(modal).getByText('Non-Transactional')).toBeInTheDocument();
    expect(within(modal).getByRole('button', { name: 'Mark Tx' })).toBeInTheDocument();

    // Verify badges in the parent layout reflect the demotion (Transactions=0, Non-Transactional=1)
    expect(screen.getByText('Transactions').querySelector('span')?.textContent).toBe('0');
    expect(screen.getByText('Non-Transactional (For Review)').querySelector('span')?.textContent).toBe('1');

    // Click 'Close' to dismiss modal
    fireEvent.click(within(modal).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('email-detail-modal')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-12] Staging Review Queue: Displays staging parameters.
   * [FUNC-GMAIL-13] Review and Final Ledger Approval: Click "Approve & Save" to promote.
   */
  it('displays the staging review queue and allows the user to edit and approve transactions', async () => {
    // Mock the fetch call to return an email with an extracted pending transaction
    const mockEmails = [
      {
        id: 'email_staging_123',
        sender: 'rides@uber.com',
        subject: 'Your Ride Details',
        date: '2023-01-15',
        snippet: 'Paid USD 14.50',
        body: 'Full Uber ride details',
        hasTransaction: true,
        extracted: {
          id: 'silver_pending_555',
          merchant: 'Uber Inc',
          amount: 14.50,
          currency: 'USD',
          date: '2023-01-15',
          category: 'Transport',
          status: 'pending'
        }
      }
    ];

    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/gmail/fetch-list')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messageIds: mockEmails.map(e => e.id) }),
        });
      }
      if (url.includes('/api/gmail/fetch-detail')) {
        const bodyObj = JSON.parse(init.body);
        const email = mockEmails.find(e => e.id === bodyObj.messageId);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'fetched', email }),
        });
      }
      if (url === '/api/gmail/approve') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'approved' }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));

    // Input filters to pass check
    fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2023-01-01' } });
    fireEvent.change(screen.getByLabelText(/End Date/i), { target: { value: '2023-01-31' } });
    
    // Add a sender
    const senderInput = screen.getByPlaceholderText(/Add sender email.../i);
    fireEvent.change(senderInput, { target: { value: 'rides@uber.com' } });
    fireEvent.keyDown(senderInput, { key: 'Enter', code: 'Enter' });

    // Click Authorize & Fetch
    fireEvent.click(screen.getByText(/Authorize & Fetch/i));

    // Wait for email to appear and click it
    const subjectCell = await screen.findByText('Your Ride Details');
    expect(subjectCell).toBeInTheDocument();
    fireEvent.click(subjectCell);

    // Modal should open
    const modal = screen.getByTestId('email-detail-modal');
    expect(modal).toBeInTheDocument();

    // Verify staging form renders with pre-filled inputs
    expect(within(modal).getByText('Staging Area (LLM Extracted Details)')).toBeInTheDocument();
    const merchantInput = within(modal).getByLabelText('Merchant');
    const amountInput = within(modal).getByLabelText('Amount');
    const categoryInput = within(modal).getByLabelText('Category');
    const dateInput = within(modal).getByLabelText('Date');

    expect(merchantInput).toHaveValue('Uber Inc');
    expect(amountInput).toHaveValue(14.50);
    expect(categoryInput).toHaveValue('Transport');
    expect(dateInput).toHaveValue('2023-01-15');

    // User edits the details
    fireEvent.change(merchantInput, { target: { value: 'Uber Ride Co.' } });
    fireEvent.change(amountInput, { target: { value: '14.99' } });
    fireEvent.change(categoryInput, { target: { value: 'Travel' } });

    // Click Approve & Save
    const approveBtn = within(modal).getByRole('button', { name: 'Approve & Save' });
    fireEvent.click(approveBtn);

    // Verify the approve API was called with the modified parameters
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/gmail/approve', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"merchant":"Uber Ride Co."')
      }));
    });
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/gmail/approve', expect.objectContaining({
        body: expect.stringContaining('"amount":14.99')
      }));
    });
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/gmail/approve', expect.objectContaining({
        body: expect.stringContaining('"category":"Travel"')
      }));
    });

    // Verify modal status badge updates to 'Approved Ledger' and displays read-only details
    expect(await within(modal).findByText('Approved Ledger')).toBeInTheDocument();
    expect(within(modal).getByText('Uber Ride Co.')).toBeInTheDocument();

    // Click close to dismiss
    fireEvent.click(within(modal).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('email-detail-modal')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-21] Processed Emails Visibility: Distinct visual status or indicator for processed emails and disabled action button.
   * [NFR-USAB-1] Ingestion Status Feedback: Status display for raw emails.
   */
  it('displays processed badge and disables extraction/checkbox for already processed emails', async () => {
    // Mock the fetch calls
    const mockEmails = [
      { id: '1', sender: 'sender@test.com', subject: 'Inv 123', date: '2023-01-01', snippet: 'Paid Rs. 100', body: 'Full billing content for Inv 123', hasTransaction: true },
      { id: '2', sender: 'sender@test.com', subject: 'Inv 456', date: '2023-01-02', snippet: 'Paid Rs. 200', body: 'Full billing content for Inv 456', hasTransaction: true }
    ];
    // Inv 123 is processed (exists in silverTransactions)
    const mockSilver = [
      { id: 'silver_1', rawEmailId: '1', merchantRaw: 'Merchant A', amount: 100, currency: 'INR', transactionDate: '2023-01-01', status: 'pending' }
    ];
    
    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/gmail/fetch-list')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messageIds: mockEmails.map(e => e.id) }),
        });
      }
      if (url.includes('/api/gmail/fetch-detail')) {
        const bodyObj = JSON.parse(init.body);
        const email = mockEmails.find(e => e.id === bodyObj.messageId);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'fetched', email }),
        });
      }
      if (url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ emails: mockEmails }),
        });
      }
      if (url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: mockSilver }),
        });
      }
      if (url.includes('/api/gmail/gold-transactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    
    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));

    // Input filters to pass check
    fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2023-01-01' } });
    fireEvent.change(screen.getByLabelText(/End Date/i), { target: { value: '2023-01-31' } });
    
    // Add a sender
    const senderInput = screen.getByPlaceholderText(/Add sender email.../i);
    fireEvent.change(senderInput, { target: { value: 'sender@test.com' } });
    fireEvent.keyDown(senderInput, { key: 'Enter', code: 'Enter' });

    // Click Authorize & Fetch
    fireEvent.click(screen.getByText(/Authorize & Fetch/i));

    // Wait for the emails to appear
    expect(await screen.findByText('Inv 123')).toBeInTheDocument();
    expect(screen.getByText('Inv 456')).toBeInTheDocument();

    // Check that Inv 123 has "Processed" badge or indicator
    expect(screen.getAllByText(/Processed/i).length).toBeGreaterThan(0);

    // Get the rows for both emails
    const row1 = screen.getByText('Inv 123').closest('tr')!;
    const row2 = screen.getByText('Inv 456').closest('tr')!;

    // In row1, the extract action button should be labeled as "Processed" and disabled
    expect(within(row1).getByRole('button', { name: 'Processed' })).toBeDisabled();
    expect(within(row1).getByText('✓ Processed')).toBeInTheDocument();
    expect(within(row1).queryByRole('button', { name: 'Extract' })).not.toBeInTheDocument();

    // In row2, the extract action should still be available
    expect(within(row2).getByRole('button', { name: 'Extract' })).toBeInTheDocument();

    // The checkbox in row1 should be disabled
    const checkbox1 = within(row1).getByRole('checkbox');
    expect(checkbox1).toBeDisabled();

    // The checkbox in row2 should not be disabled
    const checkbox2 = within(row2).getByRole('checkbox');
    expect(checkbox2).not.toBeDisabled();

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-22] Silver Batch Approval: Approve multiple staging transactions in a single batch operation.
   * [NFR-PERF-4] Batch Approval Efficiency: Perform batch approval and update local state atomically.
   */
  it('allows the user to batch approve multiple silver transactions', async () => {
    const mockSilver = [
      { id: 'silver_1', rawEmailId: '1', merchantRaw: 'Uber Inc', amount: 14.50, currency: 'USD', transactionDate: '2023-01-15', inferredCategory: 'Transport', status: 'pending' },
      { id: 'silver_2', rawEmailId: '2', merchantRaw: 'Starbucks', amount: 4.50, currency: 'USD', transactionDate: '2023-01-16', inferredCategory: 'Food', status: 'pending' }
    ];

    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: mockSilver }),
        });
      }
      if (url.includes('/api/gmail/gold-transactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });
      }
      if (url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ emails: [] }),
        });
      }
      if (url.includes('/api/gmail/approve-batch')) {
        expect(init.method).toBe('POST');
        const body = JSON.parse(init.body);
        expect(body.silverIds).toEqual(['silver_1', 'silver_2']);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'approved', approvedIds: ['silver_1', 'silver_2'] }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));

    // Click on Silver tab
    fireEvent.click(screen.getByRole('button', { name: /Silver/i }));

    // Wait for the Silver staging records to appear
    expect(await screen.findByText('Uber Inc')).toBeInTheDocument();
    expect(screen.getByText('Starbucks')).toBeInTheDocument();

    // Checkboxes should exist. Check both row checkboxes.
    const row1 = screen.getByText('Uber Inc').closest('tr')!;
    const row2 = screen.getByText('Starbucks').closest('tr')!;

    const checkbox1 = within(row1).getByRole('checkbox');
    const checkbox2 = within(row2).getByRole('checkbox');

    fireEvent.click(checkbox1);
    fireEvent.click(checkbox2);

    // The batch approval button "Approve Selected" should appear
    const approveSelectedBtn = screen.getByRole('button', { name: /Approve Selected/i });
    expect(approveSelectedBtn).toBeInTheDocument();

    // Click batch approve
    fireEvent.click(approveSelectedBtn);

    // Verify batch approval endpoint was called
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/gmail/approve-batch', expect.any(Object));
    });

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-23] Bronze Ingestion Status Filter: Filter raw emails in Bronze view by processed or unprocessed status.
   * [NFR-USAB-2] Ingestion Status Filtering Usability: Instant filter response in UI.
   */
  it('allows the user to filter bronze emails by processed and unprocessed status', async () => {
    // Mock the fetch calls
    const mockEmails = [
      { id: '1', sender: 'sender@test.com', subject: 'Inv 123 (Processed)', date: '2023-01-01', snippet: 'Paid Rs. 100', body: 'Full billing content for Inv 123', hasTransaction: true },
      { id: '2', sender: 'sender@test.com', subject: 'Inv 456 (Unprocessed)', date: '2023-01-02', snippet: 'Paid Rs. 200', body: 'Full billing content for Inv 456', hasTransaction: true }
    ];
    // Inv 123 is processed (exists in silverTransactions)
    const mockSilver = [
      { id: 'silver_1', rawEmailId: '1', merchantRaw: 'Merchant A', amount: 100, currency: 'INR', transactionDate: '2023-01-01', status: 'pending' }
    ];

    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/gmail/fetch-list')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messageIds: mockEmails.map(e => e.id) }),
        });
      }
      if (url.includes('/api/gmail/fetch-detail')) {
        const bodyObj = JSON.parse(init.body);
        const email = mockEmails.find(e => e.id === bodyObj.messageId);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'fetched', email }),
        });
      }
      if (url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: mockSilver }),
        });
      }
      if (url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ emails: mockEmails }),
        });
      }
      if (url.includes('/api/gmail/gold-transactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));

    // Input filters to pass check
    fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2023-01-01' } });
    fireEvent.change(screen.getByLabelText(/End Date/i), { target: { value: '2023-01-31' } });
    
    // Add a sender
    const senderInput = screen.getByPlaceholderText(/Add sender email.../i);
    fireEvent.change(senderInput, { target: { value: 'sender@test.com' } });
    fireEvent.keyDown(senderInput, { key: 'Enter', code: 'Enter' });

    // Click Authorize & Fetch
    fireEvent.click(screen.getByText(/Authorize & Fetch/i));

    // Wait for the emails to appear
    expect(await screen.findByText('Inv 123 (Processed)')).toBeInTheDocument();
    expect(screen.getByText('Inv 456 (Unprocessed)')).toBeInTheDocument();

    // Verify filter dropdown exists with options
    const selectFilter = screen.getByLabelText(/Filter:/i);
    expect(selectFilter).toBeInTheDocument();
    expect(selectFilter).toHaveValue('all');

    // Filter by Unprocessed only
    fireEvent.change(selectFilter, { target: { value: 'unprocessed' } });
    expect(screen.queryByText('Inv 123 (Processed)')).not.toBeInTheDocument();
    expect(screen.getByText('Inv 456 (Unprocessed)')).toBeInTheDocument();

    // Filter by Processed only
    fireEvent.change(selectFilter, { target: { value: 'processed' } });
    expect(screen.getByText('Inv 123 (Processed)')).toBeInTheDocument();
    expect(screen.queryByText('Inv 456 (Unprocessed)')).not.toBeInTheDocument();

    // Filter back to All
    fireEvent.change(selectFilter, { target: { value: 'all' } });
    expect(screen.getByText('Inv 123 (Processed)')).toBeInTheDocument();
    expect(screen.getByText('Inv 456 (Unprocessed)')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-24] Payment Method Extraction
   * [FUNC-GMAIL-25] Staging Payment Review & Editing
   * [FUNC-GMAIL-26] Verified Ledger Method Display & Correction
   */
  it('supports displaying, editing, and displaying in gold table the transaction payment method', async () => {
    // Mock emails
    const mockEmails = [
      { id: '1', sender: 'sender@test.com', subject: 'Inv 123', date: '2023-01-01', snippet: 'Paid Rs. 100', body: 'Full billing content', hasTransaction: true }
    ];
    // Staging contains paymentMethod UPI
    const mockSilver = [
      { id: 'silver_1', rawEmailId: '1', merchantRaw: 'Merchant A', amount: 100, currency: 'INR', transactionDate: '2023-01-01', status: 'pending', paymentMethod: 'UPI' }
    ];
    const mockGold = [
      { id: 'gold_1', pendingTxId: 'silver_2', userId: 'user1', merchant: 'Merchant B', amount: 200, currency: 'INR', transactionDate: '2023-01-02', category: 'Food', paymentMethod: 'HDFC credit card' }
    ];

    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/gmail/fetch-list')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messageIds: mockEmails.map(e => e.id) }),
        });
      }
      if (url.includes('/api/gmail/fetch-detail')) {
        const bodyObj = JSON.parse(init.body);
        const email = mockEmails.find(e => e.id === bodyObj.messageId);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'fetched', email }),
        });
      }
      if (url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ emails: mockEmails }),
        });
      }
      if (url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: mockSilver }),
        });
      }
      if (url.includes('/api/gmail/gold-transactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: mockGold }),
        });
      }
      if (url.includes('/api/gmail/approve')) {
        const body = JSON.parse(init.body);
        expect(body.paymentMethod).toBe('UPI Edited');
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'approved' }),
        });
      }
      if (url.includes('/api/gmail/gold-transactions/gold_1')) {
        const body = JSON.parse(init.body);
        expect(body.paymentMethod).toBe('HDFC credit card Edited');
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    
    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));

    // Input filters to pass check
    fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2023-01-01' } });
    fireEvent.change(screen.getByLabelText(/End Date/i), { target: { value: '2023-01-31' } });
    
    // Add a sender
    const senderInput = screen.getByPlaceholderText(/Add sender email.../i);
    fireEvent.change(senderInput, { target: { value: 'sender@test.com' } });
    fireEvent.keyDown(senderInput, { key: 'Enter', code: 'Enter' });

    // Click Authorize & Fetch
    fireEvent.click(screen.getByText(/Authorize & Fetch/i));

    // Click Silver tab
    fireEvent.click(screen.getByRole('button', { name: /Silver/i }));

    // Wait for staging table and check that payment method 'UPI' is displayed (SilverStagingList)
    expect(await screen.findByText('UPI')).toBeInTheDocument();

    // Click Review on Silver transaction
    const reviewButtons = screen.getAllByRole('button', { name: /Review/i });
    fireEvent.click(reviewButtons[0]);

    // Check modal displays payment method input with value UPI
    const paymentMethodInput = screen.getByLabelText(/Payment Method/i);
    expect(paymentMethodInput).toHaveValue('UPI');

    // Edit the payment method
    fireEvent.change(paymentMethodInput, { target: { value: 'UPI Edited' } });
    
    // Click Approve & Save
    fireEvent.click(screen.getByRole('button', { name: /Approve & Save/i }));

    // Click Gold tab
    fireEvent.click(screen.getByRole('button', { name: /Gold/i }));

    // Check that payment method 'HDFC credit card' is displayed in Gold table
    expect(await screen.findByText('HDFC credit card')).toBeInTheDocument();

    // Now check gold correction modal
    const correctButtons = screen.getAllByRole('button', { name: /Correct/i });
    fireEvent.click(correctButtons[0]);

    // Check modal displays gold transaction payment method input with value HDFC credit card
    const pmInputGold = screen.getByLabelText(/Payment Method/i);
    expect(pmInputGold).toHaveValue('HDFC credit card');

    // Edit gold payment method
    fireEvent.change(pmInputGold, { target: { value: 'HDFC credit card Edited' } });

    // Save Corrections
    fireEvent.click(screen.getByRole('button', { name: /Save Corrections/i }));

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-27] Ingestion Progress Tracking
   * [NFR-GMAIL-4] Progress Feedback Responsiveness
   */
  it('displays started, fetching progress percent, current subject, and completion status in UI progress widget', async () => {
    const mockEmails = [
      { id: 'p1', sender: 'sender@test.com', subject: 'Receipt Uber', date: '2023-01-01', snippet: 'Paid $10', body: 'Body 1', hasTransaction: true },
      { id: 'p2', sender: 'sender@test.com', subject: 'Receipt Market', date: '2023-01-02', snippet: 'Paid $20', body: 'Body 2', hasTransaction: true }
    ];

    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/gmail/fetch-list')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messageIds: ['p1', 'p2'] }),
        });
      }
      if (url.includes('/api/gmail/fetch-detail')) {
        const bodyObj = JSON.parse(init.body);
        const email = mockEmails.find(e => e.id === bodyObj.messageId);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'fetched', email }),
        });
      }
      if (url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: mockEmails }) });
      }
      if (url.includes('/api/gmail/silver-transactions') || url.includes('/api/gmail/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    
    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));

    // Input filters to pass check
    fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2023-01-01' } });
    fireEvent.change(screen.getByLabelText(/End Date/i), { target: { value: '2023-01-31' } });
    
    // Add a sender
    const senderInput = screen.getByPlaceholderText(/Add sender email.../i);
    fireEvent.change(senderInput, { target: { value: 'sender@test.com' } });
    fireEvent.keyDown(senderInput, { key: 'Enter', code: 'Enter' });

    // Click Authorize & Fetch
    fireEvent.click(screen.getByText(/Authorize & Fetch/i));

    // 1. Should display progress widget
    const progressWidget = await screen.findByTestId('ingestion-progress-widget');
    expect(progressWidget).toBeInTheDocument();

    // 2. Expect progress texts
    expect(screen.getByText(/Ingestion Completed Successfully/i)).toBeInTheDocument();
    expect(screen.getByText(/Loaded 2 raw receipt email/i)).toBeInTheDocument();

    // 3. Click dismiss
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
    expect(screen.queryByTestId('ingestion-progress-widget')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});

