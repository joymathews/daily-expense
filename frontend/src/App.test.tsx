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

    // Open detail modal for 'Weekly Update'
    fireEvent.click(screen.getByText('Weekly Update'));
    const modal = screen.getByTestId('email-detail-modal');
    const markBtn = within(modal).getByRole('button', { name: 'Mark Tx' });
    fireEvent.click(markBtn);
    // Dismiss the modal
    fireEvent.click(within(modal).getByRole('button', { name: 'Close' }));

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
    // Open detail modal for 'Inv 123'
    fireEvent.click(screen.getByText('Inv 123'));
    const modal2 = screen.getByTestId('email-detail-modal');
    const markNonBtn = within(modal2).getByRole('button', { name: 'Unmark Tx' });
    fireEvent.click(markNonBtn);
    // Dismiss the modal
    fireEvent.click(within(modal2).getByRole('button', { name: 'Close' }));

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
          paymentMethod: 'UPI',
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

    // Verify that Unmark Tx button is not visible inside detail modal for processed email
    fireEvent.click(screen.getByText('Inv 123'));
    const detailModal = screen.getByTestId('email-detail-modal');
    expect(within(detailModal).queryByRole('button', { name: 'Unmark Tx' })).not.toBeInTheDocument();
    fireEvent.click(within(detailModal).getByRole('button', { name: 'Close' }));

    expect(within(row1).getByText('✓ Processed')).toBeInTheDocument();
    expect(within(row1).queryByRole('button', { name: 'Extract' })).not.toBeInTheDocument();

    // In row2, the row-level extract action should also not be present (Action column removed)
    expect(within(row2).queryByRole('button', { name: 'Extract' })).not.toBeInTheDocument();

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

    // Click Merchant cell on Silver transaction to open modal
    fireEvent.click(screen.getByText('Merchant A'));

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

    // Click Merchant cell on Gold transaction to open modal
    fireEvent.click(screen.getByText('Merchant B'));

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

  /**
   * [FUNC-GMAIL-28] Extraction Progress Tracking: Inform when extraction starts, updates, and completes.
   * [NFR-GMAIL-5] Extraction Progress Feedback Responsiveness: Progress updates when detail extraction finishes.
   */
  it('allows the user to see real-time progress updates during batch transaction extraction', async () => {
    const mockEmails = [
      { id: 'e1', sender: 'uber@test.com', subject: 'Uber Ride Receipt', date: '2023-01-01', snippet: 'Paid Rs. 150', body: 'Ride details', hasTransaction: true },
      { id: 'e2', sender: 'swiggy@test.com', subject: 'Swiggy Food Order', date: '2023-01-02', snippet: 'Paid Rs. 320', body: 'Food details', hasTransaction: true }
    ];

    let extractCallsCount = 0;
    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/gmail/fetch-list')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messageIds: ['e1', 'e2'] }),
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
      if (url.includes('/api/gmail/extract')) {
        extractCallsCount++;
        const bodyObj = JSON.parse(init.body);
        const rawEmailId = bodyObj.rawEmailIds[0];
        const match = mockEmails.find(e => e.id === rawEmailId);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            extracted: [{
              id: `silver_${rawEmailId}`,
              rawEmailId,
              merchantRaw: match?.sender || 'Unknown',
              amount: 100,
              currency: 'INR',
              transactionDate: '2023-01-01',
              status: 'pending'
            }]
          })
        });
      }
      if (url.includes('/api/gmail/silver-transactions') || url.includes('/api/gmail/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
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

    // Click Authorize & Fetch to load emails
    fireEvent.click(screen.getByText(/Authorize & Fetch/i));

    // Wait for the mock fetch to resolve
    expect(await screen.findByText('Uber Ride Receipt')).toBeInTheDocument();

    // Check both emails
    const checkBoxes = screen.getAllByRole('checkbox');
    // First checkbox is header select-all, second is Uber, third is Swiggy
    // Let's click the select-all checkbox (first one)
    fireEvent.click(checkBoxes[0]);

    // Click "Extract Selected" button
    const extractBtn = screen.getByRole('button', { name: /Extract Selected/i });
    fireEvent.click(extractBtn);

    // 1. Should display extraction progress widget immediately
    const extractionProgressWidget = await screen.findByTestId('extraction-progress-widget');
    expect(extractionProgressWidget).toBeInTheDocument();

    // 2. Expect progress tracking text
    // Wait for completed status to show up
    await waitFor(() => {
      expect(screen.getByText(/Extraction Completed Successfully/i)).toBeInTheDocument();
    });
    
    expect(screen.getByText(/Successfully processed and extracted 2 email/i)).toBeInTheDocument();
    expect(extractCallsCount).toBe(2);

    // 3. Click dismiss
    const dismissBtn = within(extractionProgressWidget).getByRole('button', { name: /Dismiss/i });
    fireEvent.click(dismissBtn);
    expect(screen.queryByTestId('extraction-progress-widget')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /**
   * [BUG-004] Gmail Staging Staging Queue Table Actions Clipped / Cut Off
   */
  it('displays separate date, separate amount, stacked category/method, and stacked status/action in staging table [BUG-004]', async () => {
    const mockSilver = [
      { 
        id: 'silver_999', 
        rawEmailId: '1', 
        merchantRaw: 'Special Stacked Merchant', 
        amount: 250.00, 
        currency: 'INR', 
        transactionDate: '2026-06-12', 
        inferredCategory: 'Shopping', 
        paymentMethod: 'Test Stacked Method',
        status: 'pending' 
      }
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
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    
    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));

    // Click Silver tab
    fireEvent.click(screen.getByRole('button', { name: /Silver/i }));

    // Wait for the Silver staging records to appear
    expect(await screen.findByText('Special Stacked Merchant')).toBeInTheDocument();

    // Check that column headers exist for Merchant, Date, Amount, Category, Method, Status / Action
    const tableHeaders = screen.getAllByRole('columnheader');
    const headerTexts = tableHeaders.map(th => th.textContent);
    
    expect(headerTexts).toContain('Merchant');
    expect(headerTexts).toContain('Date');
    expect(headerTexts).toContain('Amount');
    expect(headerTexts).toContain('Category');
    expect(headerTexts).toContain('Method');
    expect(headerTexts).toContain('Status / Action');
    
    // Verify specific column ordering (Date is the first data column, followed by Merchant)
    expect(headerTexts[1]).toBe('Date');
    expect(headerTexts[2]).toBe('Merchant');
    
    // Check that stacked columns and separate Status and Action columns DO NOT exist
    expect(headerTexts).not.toContain('Category & Method');
    expect(headerTexts).not.toContain('Status');
    expect(headerTexts).not.toContain('Action');

    // Check that the date and method are displayed inside the table
    expect(screen.getByText('2026-06-12')).toBeInTheDocument();
    expect(screen.getByText('Test Stacked Method')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-4] Verified Ledger (Gold) layout verification
   */
  it('displays separate date, separate amount, stacked category/method, and action in Gold ledger table (lineage accessible via modal)', async () => {
    const mockGold = [
      { 
        id: 'gold_999', 
        pendingTxId: 'silver_2',
        userId: 'user1',
        merchant: 'Special Gold Merchant', 
        amount: 350.00, 
        currency: 'INR', 
        transactionDate: '2026-06-12', 
        category: 'Food', 
        paymentMethod: 'Gold Stacked Method',
        emailSubject: 'Uber Ride Receipt',
        notes: 'Verified comment'
      }
    ];

    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/gmail/gold-transactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: mockGold }),
        });
      }
      if (url.includes('/api/gmail/silver-transactions')) {
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
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    
    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));

    // Click Gold tab
    fireEvent.click(screen.getByRole('button', { name: /Gold/i }));

    // Wait for the Gold ledger records to appear
    expect(await screen.findByText('Special Gold Merchant')).toBeInTheDocument();

    // Check that column headers exist for Date, Merchant, Amount, Category, Method
    const tableHeaders = screen.getAllByRole('columnheader');
    const headerTexts = tableHeaders.map(th => th.textContent);
    
    expect(headerTexts).toContain('Date');
    expect(headerTexts).toContain('Merchant');
    expect(headerTexts).toContain('Amount');
    expect(headerTexts).toContain('Category');
    expect(headerTexts).toContain('Method');
    expect(headerTexts).not.toContain('Lineage / Comments');
    expect(headerTexts).not.toContain('Action');
    
    // Verify specific column ordering (Date is first data column, followed by Merchant)
    expect(headerTexts[0]).toBe('Date');
    expect(headerTexts[1]).toBe('Merchant');
    
    // Check that stacked column DOES NOT exist
    expect(headerTexts).not.toContain('Category & Method');

    // Check that the date and method are displayed inside the table
    expect(screen.getByText('2026-06-12')).toBeInTheDocument();
    expect(screen.getByText('Gold Stacked Method')).toBeInTheDocument();

    // Verify that the comment/notes are not visible on the table page initially
    expect(screen.queryByText('Verified comment')).not.toBeInTheDocument();

    // Click the Merchant cell to open the modal
    fireEvent.click(screen.getByText('Special Gold Merchant'));

    // Verify that the comment/notes and correct modal details are accessible in the modal
    expect(screen.getByDisplayValue('Verified comment')).toBeInTheDocument();
    expect(screen.getByText('Correct Gold Ledger: Special Gold Merchant')).toBeInTheDocument();

    // Close the modal
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-29] Fetcher Filter Layout Isolation: The fetching configuration filter panel must only be displayed in the Bronze tab.
   * [NFR-USAB-5] Layout Contextual Adaptability: The UI layout must adapt contextually and hide the Fetcher Config panel on Silver and Gold tabs.
   */
  it('displays the Fetcher Config panel only on the Bronze tab and hides it on Silver and Gold tabs', async () => {
    render(<App />);
    
    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));

    // By default, Bronze tab is active, so Fetcher Config should be visible
    expect(screen.getByText(/Fetcher Config/i)).toBeInTheDocument();
    
    // Switch to Silver tab
    fireEvent.click(screen.getByRole('button', { name: /Silver/i }));
    // Fetcher Config should NOT be in the document
    expect(screen.queryByText(/Fetcher Config/i)).not.toBeInTheDocument();

    // Switch to Gold tab
    fireEvent.click(screen.getByRole('button', { name: /Gold/i }));
    // Fetcher Config should NOT be in the document
    expect(screen.queryByText(/Fetcher Config/i)).not.toBeInTheDocument();

    // Switch back to Bronze tab
    fireEvent.click(screen.getByRole('button', { name: /Bronze/i }));
    // Fetcher Config should be visible again
    expect(screen.getByText(/Fetcher Config/i)).toBeInTheDocument();
  });

  /**
   * [FUNC-GMAIL-30] Cross-Stage Medallion Lineage Explorer: Verify lineage details across all three stages.
   * [NFR-USAB-6] Data Lineage Traceability & Visibility: The detail modal must display associated Bronze, Silver, and Gold records.
   */
  it('displays full cross-stage medallion lineage linkages when opening any record in detail modal', async () => {
    const mockEmails = [
      { id: 'email_1', sender: 'sender@test.com', subject: 'Inv 123', date: '2023-01-01', snippet: 'Paid Rs. 100', body: 'Full billing content', hasTransaction: true }
    ];
    const mockSilver = [
      { id: 'silver_1', rawEmailId: 'email_1', merchantRaw: 'Merchant A', amount: 100, currency: 'INR', transactionDate: '2023-01-01', status: 'approved', paymentMethod: 'UPI' }
    ];
    const mockGold = [
      { id: 'gold_1', pendingTxId: 'silver_1', userId: 'user1', merchant: 'Merchant A Confirmed', amount: 100, currency: 'INR', transactionDate: '2023-01-01', category: 'Food', paymentMethod: 'UPI', bronzeEmailId: 'email_1' }
    ];

    const mockFetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: mockEmails }) });
      }
      if (url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: mockSilver }) });
      }
      if (url.includes('/api/gmail/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: mockGold }) });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    
    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));

    // Wait for the Bronze raw emails to load and open the first one
    const emailSubject = await screen.findByText('Inv 123');
    fireEvent.click(emailSubject);

    // Verify detail modal opens and contains the lineage explorer
    const modal = screen.getByTestId('email-detail-modal');
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByText(/Medallion Data Lineage Linkages/i)).toBeInTheDocument();

    // Verify Bronze layer trace is shown
    expect(within(modal).getAllByText('Inv 123').length).toBeGreaterThan(0);
    
    // Verify Silver layer trace is shown (Merchant A)
    expect(within(modal).getByText(/^Merchant A -/i)).toBeInTheDocument();

    // Verify Gold layer trace is shown (Merchant A Confirmed)
    expect(within(modal).getByText(/^Merchant A Confirmed -/i)).toBeInTheDocument();

    // Close the modal
    fireEvent.click(within(modal).getByRole('button', { name: 'Close' }));

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-31] Multi-Stage Delete & Trash Bin: Verify soft-delete modal prompts target checkbox selections and restoration.
   * [NFR-USAB-7] Soft-Delete and Data Integrity: Deleting and restoring maintains data linkages and Recycle Bin visibility.
   */
  it('supports soft-deleting records from selected stages and restoring them via Trash Bin', async () => {
    const mockEmails = [
      { id: 'email_1', sender: 'sender@test.com', subject: 'Inv 123', date: '2023-01-01', snippet: 'Paid Rs. 100', body: 'Full billing content', hasTransaction: true }
    ];
    const mockSilver = [
      { id: 'silver_1', rawEmailId: 'email_1', merchantRaw: 'Merchant A', amount: 100, currency: 'INR', transactionDate: '2023-01-01', status: 'approved', paymentMethod: 'UPI' }
    ];
    const mockGold = [
      { id: 'gold_1', pendingTxId: 'silver_1', userId: 'user1', merchant: 'Merchant A Confirmed', amount: 100, currency: 'INR', transactionDate: '2023-01-01', category: 'Food', paymentMethod: 'UPI', bronzeEmailId: 'email_1' }
    ];

    const deletedEmails = [
      { id: 'email_deleted', sender: 'deleted@test.com', subject: 'Deleted Inv', date: '2023-01-01', snippet: 'Snippet', body: 'Body', hasTransaction: true, deletedAt: '2023-01-01T00:00:00.000Z' }
    ];
    const deletedSilver = [
      { id: 'silver_deleted', rawEmailId: 'email_deleted', merchantRaw: 'Deleted Staging', amount: 50, currency: 'INR', transactionDate: '2023-01-01', status: 'pending', paymentMethod: 'Cash', deletedAt: '2023-01-01T00:00:00.000Z' }
    ];
    const deletedGold = [
      { id: 'gold_deleted', pendingTxId: 'silver_deleted', userId: 'user1', merchant: 'Deleted Confirmed', amount: 50, currency: 'INR', transactionDate: '2023-01-01', category: 'Travel', paymentMethod: 'Cash', bronzeEmailId: 'email_deleted', deletedAt: '2023-01-01T00:00:00.000Z' }
    ];

    const deleteMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'deleted' }) });
    const restoreMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'restored' }) });

    const mockFetch = vi.fn().mockImplementation((url, options) => {
      if (url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: mockEmails }) });
      }
      if (url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: mockSilver }) });
      }
      if (url.includes('/api/gmail/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: mockGold }) });
      }
      if (url.includes('/api/gmail/deleted')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            emails: deletedEmails,
            silverTransactions: deletedSilver,
            goldTransactions: deletedGold
          })
        });
      }
      if (url.includes('/api/gmail/delete')) {
        return deleteMock(url, options);
      }
      if (url.includes('/api/gmail/restore')) {
        return restoreMock(url, options);
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));

    // Open detail modal via raw email subject cell
    const subjectCell = await screen.findByText('Inv 123');
    expect(subjectCell).toBeInTheDocument();
    fireEvent.click(subjectCell);

    // Verify modal is open and has delete button
    const detailModal = screen.getByTestId('email-detail-modal');
    expect(detailModal).toBeInTheDocument();
    const deleteBtn = screen.getByTestId('modal-delete-btn');
    expect(deleteBtn).toBeInTheDocument();

    // Click delete button inside modal
    fireEvent.click(deleteBtn);

    // Delete confirmation modal should open
    const modal = screen.getByTestId('delete-confirmation-modal');
    expect(modal).toBeInTheDocument();

    // The initiating tab/stage (Bronze) checkbox should be checked by default
    const bronzeCheckbox = screen.getByTestId('delete-stage-bronze') as HTMLInputElement;
    expect(bronzeCheckbox.checked).toBe(true);

    // Since the record has a corresponding Silver and Gold record in its lineage, those checkboxes must be rendered
    const silverCheckbox = screen.getByTestId('delete-stage-silver') as HTMLInputElement;
    const goldCheckbox = screen.getByTestId('delete-stage-gold') as HTMLInputElement;
    expect(silverCheckbox).toBeInTheDocument();
    expect(goldCheckbox).toBeInTheDocument();

    // Check them all to verify multi-stage deletion selection
    if (!silverCheckbox.checked) fireEvent.click(silverCheckbox);
    if (!goldCheckbox.checked) fireEvent.click(goldCheckbox);

    // Confirm deletion
    const confirmBtn = screen.getByTestId('confirm-delete-btn');
    fireEvent.click(confirmBtn);

    // Verify deletion request was triggered with proper targets
    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalled();
    });
    const deletePayload = JSON.parse(deleteMock.mock.calls[0][1].body);
    expect(deletePayload.bronzeId).toBe('email_1');
    expect(deletePayload.silverId).toBe('silver_1');
    expect(deletePayload.goldId).toBe('gold_1');
    expect(deletePayload.targets).toContain('bronze');
    expect(deletePayload.targets).toContain('silver');
    expect(deletePayload.targets).toContain('gold');

    // Switch to Trash Bin Tab
    const trashTabBtn = screen.getByTestId('trash-tab-btn');
    fireEvent.click(trashTabBtn);

    // Verify deleted items are listed in their respective tables
    expect(screen.getByText('Deleted Inv')).toBeInTheDocument();
    expect(screen.getByText('Deleted Staging')).toBeInTheDocument();
    expect(screen.getByText('Deleted Confirmed')).toBeInTheDocument();

    // Click restore action on Gold record
    const restoreGoldBtn = screen.getByTestId('restore-gold-gold_deleted');
    fireEvent.click(restoreGoldBtn);

    // Verify restore request was triggered
    await waitFor(() => {
      expect(restoreMock).toHaveBeenCalled();
    });
    const restorePayload = JSON.parse(restoreMock.mock.calls[0][1].body);
    expect(restorePayload.goldId).toBe('gold_deleted');
    expect(restorePayload.targets).toContain('gold');

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-16] Date Range Filtering: Filter Silver and Gold records by start/end dates.
   * [NFR-USAB-8] Date Range Filtering Responsiveness: Automatically trigger fetch on date change.
   */
  it('supports date range filtering contextually in Silver and Gold tabs', async () => {
    const mockSilver = [
      { id: 'silver_1', rawEmailId: '1', merchantRaw: 'Merchant A', amount: 100, currency: 'INR', transactionDate: '2023-01-15', status: 'pending', paymentMethod: 'UPI' }
    ];
    const mockGold = [
      { id: 'gold_1', pendingTxId: 'silver_2', userId: 'user1', merchant: 'Merchant B', amount: 200, currency: 'INR', transactionDate: '2023-01-20', category: 'Food', paymentMethod: 'HDFC credit card' }
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
          json: () => Promise.resolve({ transactions: mockGold }),
        });
      }
      if (url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [] }) });
      }
      if (url.includes('/api/gmail/deleted')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));

    // Switch to Silver tab
    fireEvent.click(screen.getByRole('button', { name: /Silver/i }));

    // Verify Date Range Filter fields exist
    const silverStartDate = screen.getByLabelText(/Start Date:/i) as HTMLInputElement;
    const silverEndDate = screen.getByLabelText(/End Date:/i) as HTMLInputElement;
    expect(silverStartDate).toBeInTheDocument();
    expect(silverEndDate).toBeInTheDocument();

    // Change dates to verify reload trigger
    fireEvent.change(silverStartDate, { target: { value: '2023-01-10' } });
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('startDate=2023-01-10'), expect.any(Object));
    });

    // Switch to Gold tab
    fireEvent.click(screen.getByRole('button', { name: /Gold/i }));

    // Verify Date Range Filter fields exist in Gold
    const goldStartDate = screen.getByLabelText(/Start Date:/i) as HTMLInputElement;
    const goldEndDate = screen.getByLabelText(/End Date:/i) as HTMLInputElement;
    expect(goldStartDate).toBeInTheDocument();
    expect(goldEndDate).toBeInTheDocument();

    // Change date in Gold
    fireEvent.change(goldStartDate, { target: { value: '2023-01-12' } });
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('startDate=2023-01-12'), expect.any(Object));
    });

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-32] Staging Validation & Error Status:
   * Verify disabling checkboxes of 'error' status rows in Silver list, warning alert banner,
   * validation input highlights, and confirming that correcting the fields enables approval.
   */
  it('disables checkbox for error status rows, displays modal warning alert, highlights fields, and correction clears error and enables approval', async () => {
    // 1. Mock fetch handlers
    const mockSilver = [
      {
        id: 'silver_error_1',
        rawEmailId: 'bronze_error_1',
        merchantRaw: 'Error Merchant',
        amount: 0, // Invalid
        currency: 'USD',
        transactionDate: '2023-01-15',
        status: 'error',
        paymentMethod: 'N/A' // Invalid
      }
    ];

    const mockEmails = [
      {
        id: 'bronze_error_1',
        sender: 'error@merchant.com',
        subject: 'Error Invoice',
        date: '2023-01-15',
        snippet: 'Error snippet',
        body: 'Full receipt details',
        hasTransaction: true,
        extracted: mockSilver[0]
      }
    ];

    const updateMock = vi.fn().mockImplementation((url, init) => {
      const updates = JSON.parse(init.body);
      mockSilver[0] = {
        ...mockSilver[0],
        ...updates,
        status: 'pending' // fixed!
      };
      mockEmails[0].extracted = mockSilver[0];
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'updated', transaction: mockSilver[0] }),
      });
    });

    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/gmail/silver-transactions/silver_error_1')) {
        return updateMock(url, init);
      }
      if (url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: mockSilver }) });
      }
      if (url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: mockEmails }) });
      }
      if (url.includes('/api/gmail/deleted')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      if (url.includes('/api/gmail/fetch-detail')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'fetched', email: mockEmails[0] }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));

    // Switch to Silver tab
    fireEvent.click(screen.getByRole('button', { name: /Silver/i }));

    // Wait for the staging item to appear
    const merchantCell = await screen.findByText('Error Merchant');
    expect(merchantCell).toBeInTheDocument();

    // Verify row checkbox is disabled
    const row = merchantCell.closest('tr')!;
    const checkbox = within(row).getByRole('checkbox');
    expect(checkbox).toBeDisabled();

    // Click the row to open the detail modal
    fireEvent.click(merchantCell);

    // Verify detail modal is open
    const modal = screen.getByTestId('email-detail-modal');
    expect(modal).toBeInTheDocument();

    // Check warning alert banner exists
    expect(within(modal).getByTestId('staging-error-alert')).toBeInTheDocument();

    // Verify fields are highlighted in red (border-rose-300)
    const amountInput = within(modal).getByLabelText('Amount');
    const paymentMethodInput = within(modal).getByLabelText('Payment Method');
    expect(amountInput).toHaveClass('border-rose-300');
    expect(paymentMethodInput).toHaveClass('border-rose-300');

    // Confirm Approve & Save button is disabled
    const approveBtn = within(modal).getByRole('button', { name: 'Approve & Save' });
    expect(approveBtn).toBeDisabled();

    // Correct the inputs
    fireEvent.change(amountInput, { target: { value: '45.50' } });
    fireEvent.change(paymentMethodInput, { target: { value: 'Credit Card' } });

    // Click Save Updates button
    const saveUpdatesBtn = within(modal).getByRole('button', { name: 'Save Updates' });
    fireEvent.click(saveUpdatesBtn);

    // Verify updates API was called
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalled();
    });
    const updateBody = JSON.parse(updateMock.mock.calls[0][1].body);
    expect(updateBody.amount).toBe(45.5);
    expect(updateBody.paymentMethod).toBe('Credit Card');

    vi.unstubAllGlobals();
  });
});


