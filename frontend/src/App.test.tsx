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
    const gmailLink = screen.getByRole('link', { name: /Data Ingestion/i });
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
    fireEvent.click(screen.getByRole('link', { name: /Data Ingestion/i }));

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
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));
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
      if (url.includes('fetch-list')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messageIds: mockEmails.map(e => e.id) }),
        });
      }
      if (url.includes('fetch-detail')) {
        const bodyObj = JSON.parse(init.body);
        const email = mockEmails.find(e => e.id === bodyObj.messageId);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'fetched', email }),
        });
      }
      if ((url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ emails: mockEmails }),
        });
      }
      if ((url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });
      }
      if ((url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    
    // Navigate to Ingestion page
    fireEvent.click(screen.getByRole('link', { name: /Data Ingestion/i }));

    // Input filters to pass check
    fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2023-01-01' } });
    fireEvent.change(screen.getByLabelText(/End Date/i), { target: { value: '2023-01-31' } });
    
    // Add a sender
    const senderInput = screen.getByPlaceholderText(/Add sender email.../i);
    fireEvent.change(senderInput, { target: { value: 'sender@test.com' } });
    fireEvent.keyDown(senderInput, { key: 'Enter', code: 'Enter' });

    // Click Authorize & Fetch
    fireEvent.click(screen.getByText(/Authorize & Fetch/i));

    // Navigate to Pipeline
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

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
      if (url.includes('fetch-list')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messageIds: mockEmails.map(e => e.id) }),
        });
      }
      if (url.includes('fetch-detail')) {
        const bodyObj = JSON.parse(init.body);
        const email = mockEmails.find(e => e.id === bodyObj.messageId);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'fetched', email }),
        });
      }
      if ((url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ emails: mockEmails }),
        });
      }
      if ((url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });
      }
      if ((url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    
    // Navigate to Ingestion page
    fireEvent.click(screen.getByRole('link', { name: /Data Ingestion/i }));

    // Input filters to pass check
    fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2023-01-01' } });
    fireEvent.change(screen.getByLabelText(/End Date/i), { target: { value: '2023-01-31' } });
    
    // Add a sender
    const senderInput = screen.getByPlaceholderText(/Add sender email.../i);
    fireEvent.change(senderInput, { target: { value: 'sender@test.com' } });
    fireEvent.keyDown(senderInput, { key: 'Enter', code: 'Enter' });

    // Click Authorize & Fetch
    fireEvent.click(screen.getByText(/Authorize & Fetch/i));

    // Navigate to Pipeline
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

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
      if (url.includes('fetch-list')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messageIds: mockEmails.map(e => e.id) }),
        });
      }
      if (url.includes('fetch-detail')) {
        const bodyObj = JSON.parse(init.body);
        const email = mockEmails.find(e => e.id === bodyObj.messageId);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'fetched', email }),
        });
      }
      if (url.includes('/api/pipeline/raw-inputs') || url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: mockEmails }) });
      }
      if (url.includes('/api/pipeline/silver-transactions') || url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            transactions: [
              {
                id: 'silver_pending_555',
                bronzeInputId: 'email_staging_123',
                rawEmailId: 'email_staging_123',
                sourceType: 'email',
                merchantRaw: 'Uber Inc',
                merchantNormalized: 'Uber Inc',
                amount: 14.50,
                currency: 'USD',
                transactionDate: '2023-01-15',
                inferredCategory: 'Transport',
                paymentMethod: 'UPI',
                status: 'pending'
              }
            ]
          })
        });
      }
      if (url.includes('/api/pipeline/gold-transactions') || url.includes('/api/gmail/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/pipeline/deleted') || url.includes('/api/gmail/deleted')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      if (url.includes('/api/pipeline/approve') || url.includes('/api/gmail/approve')) {
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
    fireEvent.click(screen.getByRole('link', { name: /Data Ingestion/i }));

    // Input filters to pass check
    fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2023-01-01' } });
    fireEvent.change(screen.getByLabelText(/End Date/i), { target: { value: '2023-01-31' } });
    
    // Add a sender
    const senderInput = screen.getByPlaceholderText(/Add sender email.../i);
    fireEvent.change(senderInput, { target: { value: 'rides@uber.com' } });
    fireEvent.keyDown(senderInput, { key: 'Enter', code: 'Enter' });

    // Click Authorize & Fetch
    fireEvent.click(screen.getByText(/Authorize & Fetch/i));
    // Navigate to Pipeline
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

    // Click on Silver staging list tab
    fireEvent.click(screen.getByRole('button', { name: /Silver/i }));

    // Wait for Uber Inc to appear and click it
    const subjectCell = await screen.findByText('Uber Inc');
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
      expect(mockFetch).toHaveBeenCalledWith('/api/pipeline/approve', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"merchant":"Uber Ride Co."')
      }));
    });
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/pipeline/approve', expect.objectContaining({
        body: expect.stringContaining('"amount":14.99')
      }));
    });
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/pipeline/approve', expect.objectContaining({
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
   * [FUNC-GMAIL-21] Processed Inputs Visibility: Processed raw inputs are completely hidden from the Bronze list view.
   * [NFR-USAB-1] Ingestion Status Feedback: Status display for raw emails.
   */
  it('excludes processed emails from the bronze list view entirely and updates sub-tab counts accordingly', async () => {
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
      if (url.includes('fetch-list')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messageIds: mockEmails.map(e => e.id) }),
        });
      }
      if (url.includes('fetch-detail')) {
        const bodyObj = JSON.parse(init.body);
        const email = mockEmails.find(e => e.id === bodyObj.messageId);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'fetched', email }),
        });
      }
      if ((url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ emails: mockEmails }),
        });
      }
      if ((url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: mockSilver }),
        });
      }
      if ((url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    
    // Navigate to Ingestion page
    fireEvent.click(screen.getByRole('link', { name: /Data Ingestion/i }));

    // Input filters to pass check
    fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2023-01-01' } });
    fireEvent.change(screen.getByLabelText(/End Date/i), { target: { value: '2023-01-31' } });
    
    // Add a sender
    const senderInput = screen.getByPlaceholderText(/Add sender email.../i);
    fireEvent.change(senderInput, { target: { value: 'sender@test.com' } });
    fireEvent.keyDown(senderInput, { key: 'Enter', code: 'Enter' });

    // Click Authorize & Fetch
    fireEvent.click(screen.getByText(/Authorize & Fetch/i));

    // Navigate to Pipeline
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

    // Wait for the emails to appear - Inv 456 (unprocessed) must be visible
    expect(await screen.findByText('Inv 456')).toBeInTheDocument();
    
    // Inv 123 (processed) must NOT be visible
    expect(screen.queryByText('Inv 123')).not.toBeInTheDocument();

    // The count badge on the Transactions tab should be 1 (counting only unprocessed)
    expect(screen.getByText('Transactions').querySelector('span')?.textContent).toBe('1');

    // Get row for Inv 456 and verify its checkbox is enabled
    const row2 = screen.getByText('Inv 456').closest('tr')!;
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
      if ((url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: mockSilver }),
        });
      }
      if ((url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });
      }
      if ((url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ emails: [] }),
        });
      }
      if ((url.includes('/api/pipeline/approve-batch') || url.includes('/api/pipeline/approve-batch'))) {
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
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

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
      expect(mockFetch).toHaveBeenCalledWith('/api/pipeline/approve-batch', expect.any(Object));
    });

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-23] Bronze Ingestion Status Filter: Filter raw emails in Bronze view by unprocessed or rejected status.
   * [NFR-USAB-2] Ingestion Status Filtering Usability: Instant filter response in UI.
   */
  it('allows the user to filter bronze emails by unprocessed and rejected status', async () => {
    // Mock the fetch calls
    const mockEmails = [
      { id: '1', sender: 'sender@test.com', subject: 'Inv 123 (Unprocessed)', date: '2023-01-01', snippet: 'Paid Rs. 100', body: 'Full billing content for Inv 123', hasTransaction: true, status: 'unprocessed' as const },
      { id: '2', sender: 'sender@test.com', subject: 'Inv 456 (Rejected)', date: '2023-01-02', snippet: 'Paid Rs. 200', body: 'Full billing content for Inv 456', hasTransaction: true, status: 'rejected' as const },
      { id: '3', sender: 'sender@test.com', subject: 'Inv 789 (Processed)', date: '2023-01-03', snippet: 'Paid Rs. 300', body: 'Full billing content for Inv 789', hasTransaction: true, status: 'processed' as const }
    ];
    
    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('fetch-list')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messageIds: mockEmails.map(e => e.id) }),
        });
      }
      if (url.includes('fetch-detail')) {
        const bodyObj = JSON.parse(init.body);
        const email = mockEmails.find(e => e.id === bodyObj.messageId);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'fetched', email }),
        });
      }
      if ((url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });
      }
      if ((url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ emails: mockEmails }),
        });
      }
      if ((url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions'))) {
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
    fireEvent.click(screen.getByRole('link', { name: /Data Ingestion/i }));

    // Input filters to pass check
    fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2023-01-01' } });
    fireEvent.change(screen.getByLabelText(/End Date/i), { target: { value: '2023-01-31' } });
    
    // Add a sender
    const senderInput = screen.getByPlaceholderText(/Add sender email.../i);
    fireEvent.change(senderInput, { target: { value: 'sender@test.com' } });
    fireEvent.keyDown(senderInput, { key: 'Enter', code: 'Enter' });

    // Click Authorize & Fetch
    fireEvent.click(screen.getByText(/Authorize & Fetch/i));
    // Navigate to Pipeline
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

    // Wait for the emails to appear
    expect(await screen.findByText('Inv 123 (Unprocessed)')).toBeInTheDocument();
    expect(screen.getByText('Inv 456 (Rejected)')).toBeInTheDocument();
    
    // Inv 789 (Processed) must be hidden
    expect(screen.queryByText('Inv 789 (Processed)')).not.toBeInTheDocument();

    // Verify filter dropdown exists with options
    const selectFilter = screen.getByLabelText(/Filter:/i);
    expect(selectFilter).toBeInTheDocument();
    expect(selectFilter).toHaveValue('all');

    // Filter by Unprocessed only
    fireEvent.change(selectFilter, { target: { value: 'unprocessed' } });
    expect(screen.getByText('Inv 123 (Unprocessed)')).toBeInTheDocument();
    expect(screen.queryByText('Inv 456 (Rejected)')).not.toBeInTheDocument();

    // Filter by Rejected only
    fireEvent.change(selectFilter, { target: { value: 'rejected' } });
    expect(screen.queryByText('Inv 123 (Unprocessed)')).not.toBeInTheDocument();
    expect(screen.getByText('Inv 456 (Rejected)')).toBeInTheDocument();

    // Filter back to All
    fireEvent.change(selectFilter, { target: { value: 'all' } });
    expect(screen.getByText('Inv 123 (Unprocessed)')).toBeInTheDocument();
    expect(screen.getByText('Inv 456 (Rejected)')).toBeInTheDocument();
    expect(screen.queryByText('Inv 789 (Processed)')).not.toBeInTheDocument();

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
      if (url.includes('fetch-list')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messageIds: mockEmails.map(e => e.id) }),
        });
      }
      if (url.includes('fetch-detail')) {
        const bodyObj = JSON.parse(init.body);
        const email = mockEmails.find(e => e.id === bodyObj.messageId);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'fetched', email }),
        });
      }
      if ((url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ emails: mockEmails }),
        });
      }
      if ((url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: mockSilver }),
        });
      }
      if ((url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: mockGold }),
        });
      }
      if (url.includes('/api/pipeline/approve')) {
        const body = JSON.parse(init.body);
        expect(body.paymentMethod).toBe('UPI Edited');
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'approved' }),
        });
      }
      if (url.includes('/gold-transactions/gold_1')) {
        const body = JSON.parse(init.body);
        expect(body.paymentMethod).toBe('HDFC credit card Edited');
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    
    // Navigate to Ingestion page
    fireEvent.click(screen.getByRole('link', { name: /Data Ingestion/i }));

    // Input filters to pass check
    fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2023-01-01' } });
    fireEvent.change(screen.getByLabelText(/End Date/i), { target: { value: '2023-01-31' } });
    
    // Add a sender
    const senderInput = screen.getByPlaceholderText(/Add sender email.../i);
    fireEvent.change(senderInput, { target: { value: 'sender@test.com' } });
    fireEvent.keyDown(senderInput, { key: 'Enter', code: 'Enter' });

    // Click Authorize & Fetch
    fireEvent.click(screen.getByText(/Authorize & Fetch/i));

    // Navigate to Pipeline
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

    // Click Silver tab
    fireEvent.click(screen.getByRole('button', { name: /Silver/i }));

    // Wait for staging table and check that payment method 'UPI' is displayed (SilverStagingList)
    expect(await screen.findByText('UPI')).toBeInTheDocument();

    // Click Merchant cell on Silver transaction to open modal
    fireEvent.click(screen.getByText('Merchant A'));

    // Check modal displays payment method input with value UPI
    const paymentMethodInput = screen.getByLabelText('Payment Method', { selector: 'select' });
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
    const pmInputGold = screen.getByLabelText('Payment Method', { selector: 'select' });
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
      if (url.includes('fetch-list')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messageIds: ['p1', 'p2'] }),
        });
      }
      if (url.includes('fetch-detail')) {
        const bodyObj = JSON.parse(init.body);
        const email = mockEmails.find(e => e.id === bodyObj.messageId);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'fetched', email }),
        });
      }
      if ((url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs'))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: mockEmails }) });
      }
      if ((url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions')) || (url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions'))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    
    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Data Ingestion/i }));

    // Input filters to pass check
    fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2023-01-01' } });
    fireEvent.change(screen.getByLabelText(/End Date/i), { target: { value: '2023-01-31' } });
    
    // Add a sender
    const senderInput = screen.getByPlaceholderText(/Add sender email.../i);
    fireEvent.change(senderInput, { target: { value: 'sender@test.com' } });
    fireEvent.keyDown(senderInput, { key: 'Enter', code: 'Enter' });

    // Click Authorize & Fetch
    fireEvent.click(screen.getByText(/Authorize & Fetch/i));
    // Navigate to Pipeline
    fireEvent.click(screen.getByRole('link', { name: /Data Ingestion/i }));

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
      if (url.includes('fetch-list')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messageIds: ['e1', 'e2'] }),
        });
      }
      if (url.includes('fetch-detail')) {
        const bodyObj = JSON.parse(init.body);
        const email = mockEmails.find(e => e.id === bodyObj.messageId);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'fetched', email }),
        });
      }
      if ((url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs'))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: mockEmails }) });
      }
      if ((url.includes('/api/pipeline/extract') || url.includes('/api/pipeline/extract'))) {
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
      if ((url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions')) || (url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions'))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    
    // Navigate to Ingestion page
    fireEvent.click(screen.getByRole('link', { name: /Data Ingestion/i }));

    // Input filters to pass check
    fireEvent.change(screen.getByLabelText(/Start Date/i), { target: { value: '2023-01-01' } });
    fireEvent.change(screen.getByLabelText(/End Date/i), { target: { value: '2023-01-31' } });
    
    // Add a sender
    const senderInput = screen.getByPlaceholderText(/Add sender email.../i);
    fireEvent.change(senderInput, { target: { value: 'sender@test.com' } });
    fireEvent.keyDown(senderInput, { key: 'Enter', code: 'Enter' });

    // Click Authorize & Fetch to load emails
    fireEvent.click(screen.getByText(/Authorize & Fetch/i));

    // Navigate to Pipeline
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

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
    
    expect(screen.getByText(/Successfully processed and extracted 2/i)).toBeInTheDocument();
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
      if ((url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: mockSilver }),
        });
      }
      if ((url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });
      }
      if ((url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs'))) {
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
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

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
    
    // Verify specific column ordering (Date is the first data column, followed by Source, then Merchant)
    expect(headerTexts[1]).toBe('Date');
    expect(headerTexts[2]).toBe('Source');
    expect(headerTexts[3]).toBe('Merchant');
    
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
      if ((url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: mockGold }),
        });
      }
      if ((url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });
      }
      if ((url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs'))) {
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
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

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
    
    // Verify specific column ordering (Date is first data column, followed by Source, then Merchant)
    expect(headerTexts[0]).toBe('Date');
    expect(headerTexts[1]).toBe('Source');
    expect(headerTexts[2]).toBe('Merchant');
    
    // Check that stacked column DOES NOT exist
    expect(headerTexts).not.toContain('Category & Method');

    // Check that the date and method are displayed inside the table
    expect(screen.getByText('2026-06-12')).toBeInTheDocument();
    expect(screen.getByText('Gold Stacked Method')).toBeInTheDocument();

    // Verify that the comment/notes are visible on the table page since Notes is a column
    expect(screen.getByText('Verified comment')).toBeInTheDocument();

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
  it('displays the Fetcher Config panel only on the Gmail Ingestion tab and hides it on Direct Ledger Entry tab', async () => {
    render(<App />);
    
    // Navigate to Ingestion page
    fireEvent.click(screen.getByRole('link', { name: /Data Ingestion/i }));

    // By default, Gmail Ingestion tab is active, so Fetcher Config should be visible
    expect(screen.getByText(/Fetcher Config/i)).toBeInTheDocument();
    
    // Switch to Direct Ledger Entry tab
    fireEvent.click(screen.getByRole('button', { name: /Direct Ledger Entry/i }));
    // Fetcher Config should NOT be in the document
    expect(screen.queryByText(/Fetcher Config/i)).not.toBeInTheDocument();

    // Switch back to Gmail Ingestion tab
    fireEvent.click(screen.getByRole('button', { name: /Gmail Ingestion/i }));
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
      { id: 'gold_1', pendingTxId: 'silver_1', userId: 'user1', merchant: 'Merchant A Confirmed', amount: 100, currency: 'INR', transactionDate: '2023-01-01', category: 'Food', paymentMethod: 'UPI', bronzeInputId: 'email_1' }
    ];

    const mockFetch = vi.fn().mockImplementation((url) => {
      if ((url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs'))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: mockEmails }) });
      }
      if ((url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions'))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: mockSilver }) });
      }
      if ((url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions'))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: mockGold }) });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    
    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

    // Click on Gold tab to view confirmed ledger records
    fireEvent.click(screen.getByRole('button', { name: /Gold/i }));

    // Wait for the Gold transaction to load and click on the merchant name
    const goldMerchant = await screen.findByText('Merchant A Confirmed');
    fireEvent.click(goldMerchant);

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

    // Verify Silver pre-correction card and raw body are hidden by default
    expect(within(modal).queryByTestId('lineage-silver-card')).not.toBeInTheDocument();
    expect(within(modal).queryByText('Full billing content')).not.toBeInTheDocument();

    // Click the Trace Lineage button to expand
    const toggleBtn = within(modal).getByRole('button', { name: /Trace Lineage: View Staging & Raw Source/i });
    expect(toggleBtn).toBeInTheDocument();
    fireEvent.click(toggleBtn);

    // Verify Silver pre-correction card and raw body are now visible
    const silverStagingCard = within(modal).getByTestId('lineage-silver-card');
    expect(silverStagingCard).toBeInTheDocument();
    expect(within(silverStagingCard).getByText('Merchant A')).toBeInTheDocument();
    expect(within(silverStagingCard).getByText('100.00 INR')).toBeInTheDocument();
    expect(within(silverStagingCard).getByText('UPI')).toBeInTheDocument();
    expect(within(modal).getByText('Full billing content')).toBeInTheDocument();

    // Click the Collapse button to hide again
    const collapseBtn = within(modal).getByRole('button', { name: /Collapse Lineage Trace/i });
    expect(collapseBtn).toBeInTheDocument();
    fireEvent.click(collapseBtn);

    // Verify they are hidden again
    expect(within(modal).queryByTestId('lineage-silver-card')).not.toBeInTheDocument();
    expect(within(modal).queryByText('Full billing content')).not.toBeInTheDocument();

    // Close the modal
    fireEvent.click(within(modal).getByRole('button', { name: 'Close' }));

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-31] Pipeline Reversion & Raw Email Deletion: Verify revert-to-silver, revert-to-bronze, delete/restore Bronze.
   * [NFR-USAB-7] Soft-Delete and Data Integrity: Reverting and deleting records must never cause database referential integrity failures.
   */
  it('supports reverting Gold, reverting Silver, and soft-deleting/restoring Bronze raw emails', async () => {
    const mockEmails = [
      { id: 'email_1', sender: 'sender@test.com', subject: 'Inv 123', date: '2023-01-01', snippet: 'Paid Rs. 100', body: 'Full billing content', hasTransaction: true },
      { id: 'email_2', sender: 'sender@test.com', subject: 'Inv 456', date: '2023-01-01', snippet: 'Paid Rs. 200', body: 'Billing content 2', hasTransaction: true },
      { id: 'email_unprocessed', sender: 'sender@test.com', subject: 'Inv Unprocessed', date: '2023-01-02', snippet: 'Snippet', body: 'Body content', hasTransaction: true }
    ];
    const mockSilver = [
      { id: 'silver_1', rawEmailId: 'email_1', merchantRaw: 'Merchant A', amount: 100, currency: 'INR', transactionDate: '2023-01-01', status: 'pending', paymentMethod: 'UPI' },
      { id: 'silver_2', rawEmailId: 'email_2', merchantRaw: 'Merchant B', amount: 200, currency: 'INR', transactionDate: '2023-01-01', status: 'pending', paymentMethod: 'UPI' }
    ];
    const mockGold = [
      { id: 'gold_1', pendingTxId: 'silver_1', userId: 'user1', merchant: 'Merchant A Confirmed', amount: 100, currency: 'INR', transactionDate: '2023-01-01', category: 'Food', paymentMethod: 'UPI', bronzeInputId: 'email_1' }
    ];

    const deletedEmails = [
      { id: 'email_deleted', sender: 'deleted@test.com', subject: 'Deleted Inv', date: '2023-01-01', snippet: 'Snippet', body: 'Body', hasTransaction: true, deletedAt: '2023-01-01T00:00:00.000Z' }
    ];

    const revertGoldMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'reverted' }) });
    const revertSilverMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'reverted' }) });
    const deleteMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'deleted' }) });
    const restoreMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'restored' }) });

    const mockFetch = vi.fn().mockImplementation((url, options) => {
      if ((url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs'))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: mockEmails }) });
      }
      if ((url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions'))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: mockSilver }) });
      }
      if ((url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions'))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: mockGold }) });
      }
      if ((url.includes('/api/gmail/deleted') || url.includes('/api/pipeline/deleted'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            emails: deletedEmails,
            silverTransactions: [],
            goldTransactions: []
          })
        });
      }
      if ((url.includes('/api/gmail/revert-to-silver') || url.includes('/api/pipeline/revert-to-silver'))) {
        return revertGoldMock(url, options);
      }
      if ((url.includes('/api/gmail/revert-to-bronze') || url.includes('/api/pipeline/revert-to-bronze'))) {
        return revertSilverMock(url, options);
      }
      if ((url.includes('/api/gmail/delete') || url.includes('/api/pipeline/delete'))) {
        return deleteMock(url, options);
      }
      if ((url.includes('/api/gmail/restore') || url.includes('/api/pipeline/restore'))) {
        return restoreMock(url, options);
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

    // --- 1. Test Delete Bronze Raw Email ---
    const subjectCell = await screen.findByText('Inv Unprocessed');
    expect(subjectCell).toBeInTheDocument();
    fireEvent.click(subjectCell);

    // Verify modal is open and has delete button showing 'Delete'
    const detailModal = screen.getByTestId('email-detail-modal');
    expect(detailModal).toBeInTheDocument();
    const deleteBtn = screen.getByTestId('modal-delete-btn');
    expect(deleteBtn).toHaveTextContent('Delete');

    // Click delete
    fireEvent.click(deleteBtn);

    // Confirmation modal should show "Delete Raw Email"
    expect(screen.getByTestId('delete-confirmation-modal')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Delete Raw Email/i })).toBeInTheDocument();

    // Confirm delete
    fireEvent.click(screen.getByTestId('confirm-delete-btn'));

    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalled();
    });
    const deletePayload = JSON.parse(deleteMock.mock.calls[0][1].body);
    expect(deletePayload.bronzeId).toBe('email_unprocessed');

    // --- 2. Test Revert Silver Staging ---
    // Switch to Silver tab
    fireEvent.click(screen.getByRole('button', { name: /Silver/i }));
    const merchantSilver = await screen.findByText('Merchant B');
    fireEvent.click(merchantSilver);

    // Detail modal opens for Silver. Verify delete button shows 'Revert to Raw'
    const deleteBtnSilver = screen.getByTestId('modal-delete-btn');
    expect(deleteBtnSilver).toHaveTextContent('Revert to Raw');

    // Click revert
    fireEvent.click(deleteBtnSilver);

    // Confirmation modal should show "Revert to Raw Email"
    expect(screen.getByRole('heading', { name: /Revert to Raw Email/i })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-delete-btn'));

    await waitFor(() => {
      expect(revertSilverMock).toHaveBeenCalled();
    });
    const revertSilverPayload = JSON.parse(revertSilverMock.mock.calls[0][1].body);
    expect(revertSilverPayload.silverId).toBe('silver_2');

    // --- 3. Test Revert Gold Ledger ---
    // Switch to Gold tab
    fireEvent.click(screen.getByRole('button', { name: /Gold/i }));
    const merchantGold = await screen.findByText('Merchant A Confirmed');
    fireEvent.click(merchantGold);

    // Detail modal opens for Gold. Verify delete button shows 'Revert to Staging'
    const deleteBtnGold = screen.getByTestId('modal-delete-btn');
    expect(deleteBtnGold).toHaveTextContent('Revert to Staging');

    // Click revert
    fireEvent.click(deleteBtnGold);

    // Confirmation modal should show "Revert to Staging"
    expect(screen.getByRole('heading', { name: /Revert to Staging/i })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-delete-btn'));

    await waitFor(() => {
      expect(revertGoldMock).toHaveBeenCalled();
    });
    const revertGoldPayload = JSON.parse(revertGoldMock.mock.calls[0][1].body);
    expect(revertGoldPayload.goldId).toBe('gold_1');

    // --- 4. Test Trash Bin ---
    // Switch to Trash Bin Tab
    const trashTabBtn = screen.getByTestId('trash-tab-btn');
    fireEvent.click(trashTabBtn);

    // Verify only deleted Bronze email is listed
    expect(screen.getByText('Deleted Inv')).toBeInTheDocument();
    // Silver and Gold deleted tables are removed, so these should NOT be present
    expect(screen.queryByText('Deleted Staging')).not.toBeInTheDocument();
    expect(screen.queryByText('Deleted Confirmed')).not.toBeInTheDocument();

    // Click restore action on Bronze record
    const restoreBronzeBtn = screen.getByTestId('restore-bronze-email_deleted');
    fireEvent.click(restoreBronzeBtn);

    // Verify restore request was triggered
    await waitFor(() => {
      expect(restoreMock).toHaveBeenCalled();
    });
    const restorePayload = JSON.parse(restoreMock.mock.calls[0][1].body);
    expect(restorePayload.bronzeId).toBe('email_deleted');

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
      if ((url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: mockSilver }),
        });
      }
      if ((url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: mockGold }),
        });
      }
      if ((url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs'))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [] }) });
      }
      if ((url.includes('/api/gmail/deleted') || url.includes('/api/pipeline/deleted'))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

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
      if (url.includes('/api/ingestion/payment-methods')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentMethods: [{ id: 'm1', name: 'Credit Card' }, { id: 'm2', name: 'UPI' }] }) });
      }
      if (url.includes('/api/ingestion/payment-rules')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentRules: [] }) });
      }
      if (url.includes('/silver-transactions/silver_error_1')) {
        return updateMock(url, init);
      }
      if ((url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions'))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: mockSilver }) });
      }
      if ((url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs'))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: mockEmails }) });
      }
      if ((url.includes('/api/gmail/deleted') || url.includes('/api/pipeline/deleted'))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      if (url.includes('fetch-detail')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'fetched', email: mockEmails[0] }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

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

  /**
   * [FUNC-GMAIL-17] On-Demand Ingestion & Batch Extraction
   * Verify single-email on-demand extraction option in detail modal (for transactional raw emails, and hidden for non-transactional ones).
   */
  it('displays the Extract button in the details modal only for unprocessed transactional raw emails', async () => {
    const mockEmails = [
      { id: 'email_tx', sender: 'tx@test.com', subject: 'Receipt 1', date: '2023-01-01', snippet: 'Snippet 1', body: 'Body 1', hasTransaction: true },
      { id: 'email_nontx', sender: 'nontx@test.com', subject: 'Spam 1', date: '2023-01-02', snippet: 'Snippet 2', body: 'Body 2', hasTransaction: false }
    ];

    const extractMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ extracted: [] }) });

    const mockFetch = vi.fn().mockImplementation((url, options) => {
      if ((url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs'))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: mockEmails }) });
      }
      if ((url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions'))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if ((url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions'))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if ((url.includes('/api/gmail/deleted') || url.includes('/api/pipeline/deleted'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] })
        });
      }
      if ((url.includes('/api/pipeline/extract') || url.includes('/api/pipeline/extract'))) {
        return extractMock(url, options);
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    // Navigate to Gmail Fetch page
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

    // --- 1. Test Transactional Email ---
    const txEmailCell = await screen.findByText('Receipt 1');
    expect(txEmailCell).toBeInTheDocument();
    fireEvent.click(txEmailCell);

    // Verify modal is open and has "Extract" button
    const detailModal = screen.getByTestId('email-detail-modal');
    expect(detailModal).toBeInTheDocument();
    const extractBtn = within(detailModal).getByTestId('modal-extract-btn');
    expect(extractBtn).toBeInTheDocument();

    // Click extract
    fireEvent.click(extractBtn);

    // Verify API is called with the correct rawEmailId
    await waitFor(() => {
      expect(extractMock).toHaveBeenCalled();
    });
    const extractPayload = JSON.parse(extractMock.mock.calls[0][1].body);
    expect(extractPayload.rawEmailIds).toEqual(['email_tx']);

    // Verify modal closed
    expect(screen.queryByTestId('email-detail-modal')).not.toBeInTheDocument();

    // --- 2. Test Non-Transactional Email ---
    // Switch sub-tab to non-transaction
    fireEvent.click(screen.getByRole('button', { name: /Non-Transactional/i }));
    const nonTxEmailCell = await screen.findByText('Spam 1');
    expect(nonTxEmailCell).toBeInTheDocument();
    fireEvent.click(nonTxEmailCell);

    // Verify modal is open but does NOT have "Extract" button
    const detailModalNonTx = screen.getByTestId('email-detail-modal');
    expect(detailModalNonTx).toBeInTheDocument();
    expect(within(detailModalNonTx).queryByTestId('modal-extract-btn')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-CORE-2] Direct Manual Transaction Entry Validation.
   * Verify that the manual transaction form enforces validation rules and submits successfully.
   */
  it('validates and submits manual direct ledger entries successfully without redirecting', async () => {
    const addMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'added' }) });
    const mockFetch = vi.fn().mockImplementation((url, options) => {
      if (url.includes('/api/ingestion/payment-methods')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentMethods: [{ id: 'm1', name: 'UPI' }] }) });
      }
      if (url.includes('/api/ingestion/payment-rules')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentRules: [] }) });
      }
      if (url.includes('/api/pipeline/add-transaction')) {
        return addMock(url, options);
      }
      if (url.includes('/api/pipeline/raw-inputs') || url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [] }) });
      }
      if (url.includes('/api/pipeline/silver-transactions') || url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/pipeline/gold-transactions') || url.includes('/api/gmail/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/pipeline/deleted') || url.includes('/api/gmail/deleted')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] })
        });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    // Navigate to Data Ingestion page
    fireEvent.click(screen.getByRole('link', { name: /Data Ingestion/i }));

    // Click on Direct Ledger Entry tab
    fireEvent.click(screen.getByRole('button', { name: /Direct Ledger Entry/i }));

    // Attempt to submit empty form -> checks validation error
    const submitBtn = screen.getByRole('button', { name: /Save Transaction/i });
    fireEvent.click(submitBtn);
    expect(await screen.findByText(/Merchant name is required/i)).toBeInTheDocument();

    // Enter merchant name, but invalid amount -> checks validation error
    const merchantInput = screen.getByLabelText(/Merchant Name \*/i) as HTMLInputElement;
    fireEvent.change(merchantInput, { target: { value: 'Test Merchant' } });
    const amountInput = screen.getByLabelText(/Amount \*/i) as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: '-10' } });
    fireEvent.click(submitBtn);
    expect(await screen.findByText(/Amount must be a positive number/i)).toBeInTheDocument();

    // Fix amount, select payment method and submit successfully
    const paymentMethodSelect = screen.getByLabelText(/Payment Method \*/i);
    fireEvent.change(paymentMethodSelect, { target: { value: 'UPI' } });
    fireEvent.change(amountInput, { target: { value: '150.50' } });
    fireEvent.click(submitBtn);

    // Verify success banner is shown and input fields are cleared
    expect(await screen.findByText(/Successfully added transaction for Test Merchant/i)).toBeInTheDocument();
    expect(merchantInput.value).toBe('');
    expect(amountInput.value).toBe('');

    // Verify POST was called with the correct payload
    expect(addMock).toHaveBeenCalled();
    const addPayload = JSON.parse(addMock.mock.calls[0][1].body);
    expect(addPayload.merchant).toBe('Test Merchant');
    expect(addPayload.amount).toBe(150.5);
    expect(addPayload.currency).toBe('INR');
    expect(addPayload.paymentMethod).toBe('UPI');

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-31] / [NFR-USAB-7] Manual Gold Deletion & Trash Bin Restoration:
   * Verify soft-deleting a manual Gold entry via modal and restoring it from Trash Bin.
   */
  it('supports soft-deleting manual Gold transactions and restoring them from the Trash Bin', async () => {
    const mockManualTx = {
      id: 'gold_manual_123',
      sourceType: 'manual',
      merchant: 'Organic Store',
      amount: 25.50,
      currency: 'INR',
      transactionDate: '2023-01-15',
      category: 'Food',
      paymentMethod: 'UPI'
    };

    let goldList = [mockManualTx];
    let deletedGoldList: any[] = [];

    const deleteMock = vi.fn().mockImplementation(() => {
      goldList = [];
      deletedGoldList = [{ ...mockManualTx, deletedAt: '2023-01-15T12:00:00Z' }];
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'reverted' }) });
    });

    const restoreMock = vi.fn().mockImplementation(() => {
      goldList = [mockManualTx];
      deletedGoldList = [];
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'restored' }) });
    });

    const mockFetch = vi.fn().mockImplementation((url, options) => {
      if (url.includes('/api/pipeline/gold-transactions') || url.includes('/api/gmail/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: goldList }) });
      }
      if (url.includes('/api/pipeline/revert-to-silver')) {
        return deleteMock();
      }
      if (url.includes('/api/pipeline/restore')) {
        return restoreMock();
      }
      if (url.includes('/api/pipeline/deleted')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: deletedGoldList })
        });
      }
      // fallback other pipeline mocks to prevent errors
      if (url.includes('/api/pipeline/raw-inputs') || url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [] }) });
      }
      if (url.includes('/api/pipeline/silver-transactions') || url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });

    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    // Navigate to Pipeline
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

    // Switch to Gold tab
    fireEvent.click(screen.getByRole('button', { name: /Gold/i }));

    // Click the manual entry merchant cell to open details
    const merchantCell = await screen.findByText('Organic Store');
    fireEvent.click(merchantCell);

    // Modal should open
    const modal = screen.getByTestId('email-detail-modal');
    expect(modal).toBeInTheDocument();

    // Verify the delete button says "Delete" (since it's a manual entry) and click it
    const deleteBtn = within(modal).getByTestId('modal-delete-btn');
    expect(deleteBtn).toHaveTextContent('Delete');
    fireEvent.click(deleteBtn);

    // Confirmation modal should open, showing manual deletion title
    const confirmModal = screen.getByTestId('delete-confirmation-modal');
    expect(confirmModal).toBeInTheDocument();
    expect(within(confirmModal).getByText(/Delete Manual Transaction/i)).toBeInTheDocument();

    // Confirm deletion
    const confirmBtn = within(confirmModal).getByTestId('confirm-delete-btn');
    fireEvent.click(confirmBtn);

    // Verify revert endpoint was hit
    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalled();
    });

    // Switch to Trash Bin tab
    fireEvent.click(screen.getByRole('button', { name: /Trash Bin/i }));

    // Verify manual transaction is listed in Gold: Deleted Manual Transactions table
    expect(await screen.findByText('Gold: Deleted Manual Transactions (1)')).toBeInTheDocument();
    const tableRowMerchant = screen.getByText('Organic Store');
    expect(tableRowMerchant).toBeInTheDocument();

    // Click the restore button next to it
    const restoreBtn = screen.getByTestId(`restore-gold-gold_manual_123`);
    fireEvent.click(restoreBtn);

    // Verify restore endpoint was hit
    await waitFor(() => {
      expect(restoreMock).toHaveBeenCalled();
    });

    // Verify the table has updated (count becomes 0)
    expect(await screen.findByText('Gold: Deleted Manual Transactions (0)')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-33] / [FUNC-GMAIL-35] / [NFR-USAB-10] Payment Standardization Tab and Dropdown:
   * Verify rendering the Payment Standardization tab, adding methods/rules, and dynamic select dropdown inside Direct entry form.
   */
  it('supports managing payment methods & rules under standardization tab and dynamic manual entry dropdown selection', async () => {
    const mockMethods = [
      { id: 'm-1', name: 'UPI' },
      { id: 'm-2', name: 'HDFC Credit Card' }
    ];
    const mockRules = [
      { id: 'r-1', aliasPattern: 'upi', paymentMethodId: 'm-1', paymentMethodName: 'UPI' }
    ];

    const addMethodMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ paymentMethod: { id: 'm-3', name: 'PayPal' } })
    });
    const addRuleMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ paymentRule: { id: 'r-2', aliasPattern: 'paypal', paymentMethodId: 'm-3' } })
    });
    const retroactiveMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message: 'Success', updatedSilverCount: 1, updatedGoldCount: 0 })
    });

    const mockFetch = vi.fn().mockImplementation((url, options) => {
      if (url.includes('/api/ingestion/payment-methods')) {
        if (options && options.method === 'POST') {
          return addMethodMock(url, options);
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentMethods: mockMethods }) });
      }
      if (url.includes('/api/ingestion/payment-rules')) {
        if (options && options.method === 'POST') {
          return addRuleMock(url, options);
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentRules: mockRules }) });
      }
      if (url.includes('/api/ingestion/standardize-retroactive')) {
        return retroactiveMock(url, options);
      }
      // other fallback mocks
      if (url.includes('/api/pipeline/raw-inputs') || url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [] }) });
      }
      if (url.includes('/api/pipeline/silver-transactions') || url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/pipeline/gold-transactions') || url.includes('/api/gmail/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/pipeline/deleted') || url.includes('/api/gmail/deleted')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    // 1. Navigate to Ingestion control page
    fireEvent.click(screen.getByRole('link', { name: /Data Ingestion/i }));

    // 2. Select Payment Standardization tab
    fireEvent.click(screen.getByRole('button', { name: /Payment Standardization/i }));

    // 3. Verify page renders seeded payment methods and rules
    expect((await screen.findAllByText('UPI')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('HDFC Credit Card').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pattern:').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/"upi"/i).length).toBeGreaterThan(0);

    // 4. Click Apply Rules Retroactively and check trigger
    const applyBtn = screen.getByRole('button', { name: /Apply Rules Retroactively/i });
    fireEvent.click(applyBtn);
    await waitFor(() => {
      expect(retroactiveMock).toHaveBeenCalled();
    });

    // 5. Select Direct Ledger Entry tab and check that payment method dropdown option list matches
    fireEvent.click(screen.getByRole('button', { name: /Direct Ledger Entry/i }));
    const selectDropdown = screen.getByLabelText(/Payment Method \*/i);
    expect(selectDropdown).toBeInTheDocument();
    expect(within(selectDropdown).getByText('Select Payment Method')).toBeInTheDocument();
    expect(within(selectDropdown).getByText('UPI')).toBeInTheDocument();
    expect(within(selectDropdown).getByText('HDFC Credit Card')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GOLD-PAGE-1] / [FUNC-GOLD-PAGE-2] / [FUNC-GOLD-PAGE-3] / [FUNC-GOLD-PAGE-6] / [NFR-USAB-12]:
   * Verify navigation, high-density listing, and metrics aggregation on the Gold Transactions page.
   */
  it('provides navigation to the Transactions page and displays ledger items with currency totals summary', async () => {
    const mockGold = [
      { id: 'gold-1', silverTxId: 'silver-1', userId: 'user-1', sourceType: 'email', merchant: 'Supermarket A', amount: 50.00, currency: 'INR', transactionDate: '2026-06-10', category: 'Food', notes: 'Weekly groceries', paymentMethod: 'UPI' },
      { id: 'gold-2', silverTxId: null, userId: 'user-1', sourceType: 'manual', merchant: 'Taxi Ride', amount: 15.50, currency: 'USD', transactionDate: '2026-06-11', category: 'Transport', notes: 'Business trip', paymentMethod: 'Cash' }
    ];

    const mockFetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/pipeline/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: mockGold }) });
      }
      if (url.includes('/api/pipeline/raw-inputs') || url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [] }) });
      }
      if (url.includes('/api/pipeline/silver-transactions') || url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/pipeline/deleted') || url.includes('/api/gmail/deleted')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      if (url.includes('/api/ingestion/payment-methods')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentMethods: [] }) });
      }
      if (url.includes('/api/ingestion/payment-rules')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentRules: [] }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    // Click on the Navbar link to go to /transactions
    const transLink = screen.getByRole('link', { name: /Ledger/i });
    expect(transLink).toBeInTheDocument();
    fireEvent.click(transLink);

    // Verify page headers
    expect(await screen.findByText('Gold Ledger Transactions')).toBeInTheDocument();

    // Verify presence of table rows
    expect(screen.getByText('Supermarket A')).toBeInTheDocument();
    expect(screen.getByText('Taxi Ride')).toBeInTheDocument();

    // Verify high density display columns
    expect(screen.getByText('Weekly groceries')).toBeInTheDocument();
    expect(screen.getByText('Business trip')).toBeInTheDocument();

    // Verify totals summary widget elements
    expect(screen.getAllByText('INR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('50.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('USD').length).toBeGreaterThan(0);
    expect(screen.getAllByText('15.50').length).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GOLD-PAGE-4] / [FUNC-GOLD-PAGE-5] / [NFR-USAB-11]:
   * Verify searching, filtering, and sorting of Gold ledger items on the Transactions page.
   */
  it('allows searching, filtering, and sorting of gold ledger items', async () => {
    const mockGold = [
      { id: 'gold-1', silverTxId: 'silver-1', userId: 'user-1', sourceType: 'email', merchant: 'Apple Store', amount: 999.00, currency: 'USD', transactionDate: '2026-06-10', category: 'Gadgets', notes: 'iPhone purchase', paymentMethod: 'Credit Card' },
      { id: 'gold-2', silverTxId: null, userId: 'user-1', sourceType: 'manual', merchant: 'Coffee Shop', amount: 5.50, currency: 'USD', transactionDate: '2026-06-12', category: 'Food', notes: 'Latte', paymentMethod: 'UPI' }
    ];

    const mockFetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/pipeline/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: mockGold }) });
      }
      if (url.includes('/api/pipeline/raw-inputs') || url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [] }) });
      }
      if (url.includes('/api/pipeline/silver-transactions') || url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/pipeline/deleted') || url.includes('/api/gmail/deleted')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      if (url.includes('/api/ingestion/payment-methods')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentMethods: [] }) });
      }
      if (url.includes('/api/ingestion/payment-rules')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentRules: [] }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: /Ledger/i }));

    // Verify Apple Store and Coffee Shop are visible initially
    expect(await screen.findByText('Apple Store')).toBeInTheDocument();
    expect(screen.getByText('Coffee Shop')).toBeInTheDocument();

    // 1. Test keyword search
    const searchInput = screen.getByPlaceholderText(/Search by keyword/i);
    fireEvent.change(searchInput, { target: { value: 'apple' } });

    // Apple Store should remain, Coffee Shop should disappear
    expect(screen.getByText('Apple Store')).toBeInTheDocument();
    expect(screen.queryByText('Coffee Shop')).not.toBeInTheDocument();

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } });
    expect(screen.getByText('Coffee Shop')).toBeInTheDocument();

    // 2. Test sorting: sorting dropdown
    const sortSelect = screen.getByLabelText(/Sort By:/i);
    expect(sortSelect).toBeInTheDocument();

    // Sort by Amount Ascending
    fireEvent.change(sortSelect, { target: { value: 'amountAsc' } });
    // Verify first row is Coffee Shop (5.50) and second is Apple Store (999.00)
    let rows = screen.getAllByRole('row').slice(1); // skip header
    expect(rows[0]).toHaveTextContent('Coffee Shop');
    expect(rows[1]).toHaveTextContent('Apple Store');

    // Sort by Amount Descending
    fireEvent.change(sortSelect, { target: { value: 'amountDesc' } });
    rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Apple Store');
    expect(rows[1]).toHaveTextContent('Coffee Shop');

    // Sort by Category Ascending (Food < Gadgets)
    fireEvent.change(sortSelect, { target: { value: 'categoryAsc' } });
    rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Coffee Shop');
    expect(rows[1]).toHaveTextContent('Apple Store');

    // Sort by Category Descending (Gadgets > Food)
    fireEvent.change(sortSelect, { target: { value: 'categoryDesc' } });
    rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Apple Store');
    expect(rows[1]).toHaveTextContent('Coffee Shop');

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GOLD-PAGE-7] / [FUNC-GMAIL-18]:
   * Verify that clicking the merchant opens the edit/correction modal, and updating values calls the API successfully.
   */
  it('allows editing a gold transaction details from the Transactions page list', async () => {
    const mockGold = [
      { id: 'gold-1', silverTxId: 'silver-1', userId: 'user-1', sourceType: 'email', merchant: 'Old Merchant', amount: 50.00, currency: 'INR', transactionDate: '2026-06-10', category: 'Food', notes: 'groceries', paymentMethod: 'UPI' }
    ];

    const updateMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'updated' }) });

    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/pipeline/gold-transactions/gold-1')) {
        return updateMock(url, init);
      }
      if (url.includes('/api/pipeline/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: mockGold }) });
      }
      if (url.includes('/api/pipeline/raw-inputs') || url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [] }) });
      }
      if (url.includes('/api/pipeline/silver-transactions') || url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/pipeline/deleted') || url.includes('/api/gmail/deleted')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      if (url.includes('/api/ingestion/payment-methods')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentMethods: [] }) });
      }
      if (url.includes('/api/ingestion/payment-rules')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentRules: [] }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: /Ledger/i }));

    // Wait for Merchant to appear and click it
    const merchantCell = await screen.findByText('Old Merchant');
    fireEvent.click(merchantCell);

    // Modal should open
    const modal = screen.getByTestId('email-detail-modal');
    expect(modal).toBeInTheDocument();

    // Verify values in form
    const merchantInput = within(modal).getByLabelText('Merchant');
    expect(merchantInput).toHaveValue('Old Merchant');

    // Change merchant name and submit
    fireEvent.change(merchantInput, { target: { value: 'New Merchant' } });
    const saveBtn = within(modal).getByRole('button', { name: 'Save Corrections' });
    fireEvent.click(saveBtn);

    // Verify the PUT request was made
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/pipeline/gold-transactions/gold-1'),
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"merchant":"New Merchant"')
        })
      );
    });

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-36] / [BUG-007]:
   * Verify that rejecting a staging transaction updates its status to 'rejected',
   * excludes it from the pending count, displays it as rejected, and updates the dashboard.
   */
  it('allows the user to reject a staging transaction from the detail view modal and updates counts', async () => {
    const mockEmail = {
      id: 'raw-1',
      sender: 'test@sender.com',
      subject: 'Staging Receipt',
      date: '2026-06-12',
      snippet: 'Amount is 45.00 USD',
      body: 'Body text here',
      hasTransaction: true,
      extracted: {
        id: 'silver-1',
        merchant: 'Staging Merchant',
        amount: 45.00,
        currency: 'USD',
        date: '2026-06-12',
        category: 'Shopping',
        status: 'pending' as const,
        paymentMethod: 'Credit Card',
      }
    };

    const mockSilver = [
      {
        id: 'silver-1',
        rawEmailId: 'raw-1',
        bronzeInputId: 'raw-1',
        sourceType: 'email',
        merchantRaw: 'Staging Merchant',
        merchantNormalized: 'Staging Merchant',
        amount: 45.00,
        currency: 'USD',
        transactionDate: '2026-06-12',
        inferredCategory: 'Shopping',
        status: 'pending' as const,
        paymentMethod: 'Credit Card',
        emailSubject: 'Staging Receipt',
        emailSender: 'test@sender.com',
        emailReceivedAt: '2026-06-12',
      }
    ];

    const updateMock = vi.fn().mockImplementation((url, init) => {
      try {
        const body = JSON.parse(init.body);
        if (body.status) {
          mockSilver[0].status = body.status;
          mockEmail.extracted.status = body.status;
        }
      } catch (e) {}
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'updated' })
      });
    });

    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/pipeline/silver-transactions/silver-1') || url.includes('/api/gmail/silver-transactions/silver-1')) {
        return updateMock(url, init);
      }
      if (url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [mockEmail] }) });
      }
      if (url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: mockSilver }) });
      }
      if (url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/gmail/deleted') || url.includes('/api/pipeline/deleted')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      if (url.includes('/api/ingestion/payment-methods')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentMethods: [{ id: 'pm-1', name: 'Credit Card' }] }) });
      }
      if (url.includes('/api/ingestion/payment-rules')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentRules: [] }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    window.history.pushState({}, 'Dashboard', '/');
    render(<App />);

    // First, verify dashboard pending and rejected state initially
    // Since mockSilver has 1 pending, silverCount should be 1
    const silverCountEl = await screen.findByTestId('dashboard-silver-count');
    expect(silverCountEl).toHaveTextContent('1');
    expect(screen.queryByTestId('dashboard-rejected-badge')).not.toBeInTheDocument();

    // Navigate to Pipeline page
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

    // Click Silver tab button to switch to the Silver staging table
    const silverTabBtn = await screen.findByRole('button', { name: /Silver/i });
    fireEvent.click(silverTabBtn);

    // Wait for silver transaction table to render and check the count display in the header
    const pendingItemsCountHeader = await screen.findByText(/1 Pending Items/i);
    expect(pendingItemsCountHeader).toBeInTheDocument();

    // Click on the Merchant field in the Silver table to open the detail modal
    const merchantCell = await screen.findByText('Staging Merchant');
    fireEvent.click(merchantCell);

    // Modal should open, check if Reject button is present
    const modal = screen.getByTestId('email-detail-modal');
    expect(modal).toBeInTheDocument();
    
    const rejectBtn = within(modal).getByTestId('modal-reject-btn');
    expect(rejectBtn).toBeInTheDocument();

    // Click reject button
    fireEvent.click(rejectBtn);

    // Verify update silver transaction endpoint was called with status 'rejected'
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/pipeline/silver-transactions/silver-1'),
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"status":"rejected"')
        })
      );
    });



    // Click Dismiss or close button in modal to close it (if not auto-closed)
    const dismissBtn = within(modal).getByRole('button', { name: /Dismiss/i });
    fireEvent.click(dismissBtn);

    // Wait for the visible counts in the header to update: 0 Pending Items | 1 Rejected
    await waitFor(() => {
      expect(screen.getByText(/0 Pending Items/i)).toBeInTheDocument();
      expect(screen.getByText(/1 Rejected/i)).toBeInTheDocument();
    });

    // Check that the status badge of the row is now "rejected"
    expect(screen.getByText('rejected')).toBeInTheDocument();

    // Navigate back to Dashboard and verify metrics
    fireEvent.click(screen.getByRole('link', { name: /Dashboard/i }));

    // Dashboard should now show 0 Pending staging items, and "1 Rejected" badge
    const updatedSilverCountEl = await screen.findByTestId('dashboard-silver-count');
    expect(updatedSilverCountEl).toHaveTextContent('0');

    const rejectedBadge = screen.getByTestId('dashboard-rejected-badge');
    expect(rejectedBadge).toBeInTheDocument();
    expect(rejectedBadge).toHaveTextContent('1 Rejected');

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-37] Bronze Pipeline Statuses: processed, unprocessed, rejected. Reject raw input, updates database.
   * [NFR-USAB-14] Bronze Rejection Action Responsiveness: updates instantly in details modal and list.
   */
  it('allows the user to reject and restore a raw Bronze input and updates dashboard counts', async () => {
    const mockEmail = {
      id: 'bronze-raw-1',
      sender: 'test@sender.com',
      subject: 'Bronze Raw Receipt',
      date: '2026-06-12T10:00:00Z',
      snippet: 'Raw snippet text here',
      body: 'Raw email body content here',
      hasTransaction: true,
      status: 'unprocessed' as const,
    };

    const updateMock = vi.fn().mockImplementation((url, init) => {
      try {
        const body = JSON.parse(init.body);
        if (body.status) {
          mockEmail.status = body.status;
          // [FUNC-GMAIL-48] Rejection also marks the record as non-transactional
          if (body.status === 'rejected') {
            (mockEmail as any).hasTransaction = false;
          } else if (body.status === 'unprocessed') {
            (mockEmail as any).hasTransaction = true;
          }
        }
      } catch (e) {}
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'updated' })
      });
    });

    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/pipeline/raw-inputs/bronze-raw-1')) {
        return updateMock(url, init);
      }
      if (url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [mockEmail] }) });
      }
      if (url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/gmail/deleted') || url.includes('/api/pipeline/deleted')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      if (url.includes('/api/ingestion/payment-methods')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentMethods: [{ id: 'pm-1', name: 'Credit Card' }] }) });
      }
      if (url.includes('/api/ingestion/payment-rules')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentRules: [] }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    window.history.pushState({}, 'Dashboard', '/');
    render(<App />);

    // Verify initial dashboard status breakdown counts
    const bronzeCountEl = await screen.findByTestId('dashboard-bronze-count');
    expect(bronzeCountEl).toHaveTextContent('1');
    expect(screen.getByTestId('dashboard-bronze-unprocessed')).toHaveTextContent('1 Unprocessed');
    expect(screen.getByTestId('dashboard-bronze-processed')).toHaveTextContent('0 Processed');
    expect(screen.getByTestId('dashboard-bronze-rejected')).toHaveTextContent('0 Rejected');

    // Navigate to Pipeline page
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

    // Click on the raw email row to open detail modal
    const emailCell = await screen.findByText('Bronze Raw Receipt');
    fireEvent.click(emailCell);

    // Modal should open, check if Reject button is present and status is Transactional
    const modal = screen.getByTestId('email-detail-modal');
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByText('Transactional')).toBeInTheDocument();

    const rejectBtn = within(modal).getByTestId('modal-bronze-reject-btn');
    expect(rejectBtn).toBeInTheDocument();

    // Click reject button
    fireEvent.click(rejectBtn);

    // Verify API called with status 'rejected'
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/pipeline/raw-inputs/bronze-raw-1'),
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"status":"rejected"')
        })
      );
    });

    // Modal status badge updates to 'Rejected' and displays 'Restore to Unprocessed' button
    expect(within(modal).getByText('Rejected')).toBeInTheDocument();
    const restoreBtn = within(modal).getByTestId('modal-restore-btn');
    expect(restoreBtn).toBeInTheDocument();

    // Close detail modal
    fireEvent.click(within(modal).getByRole('button', { name: /Dismiss/i }));

    // [FUNC-GMAIL-48] After rejection, the row must disappear from the Transactions sub-tab
    await waitFor(() => {
      expect(screen.queryByText('Bronze Raw Receipt')).not.toBeInTheDocument();
    });

    // Navigate to Non-Transactional sub-tab to verify the record appears there with rejected filter
    const nonTransactionalTab = screen.getByRole('button', { name: /Non-Transactional/i });
    fireEvent.click(nonTransactionalTab);

    // Filter by rejected should show the rejected email in the Non-Transactional sub-tab
    const filterSelect = screen.getByLabelText(/Filter:/i);
    fireEvent.change(filterSelect, { target: { value: 'rejected' } });
    expect(await screen.findByText('Bronze Raw Receipt')).toBeInTheDocument();

    // Re-open detail modal and restore
    fireEvent.click(screen.getByText('Bronze Raw Receipt'));
    const modal2 = screen.getByTestId('email-detail-modal');
    const restoreBtn2 = within(modal2).getByTestId('modal-restore-btn');
    fireEvent.click(restoreBtn2);

    // Verify API called with status 'unprocessed'
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/pipeline/raw-inputs/bronze-raw-1'),
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"status":"unprocessed"')
        })
      );
    });

    // Close detail modal
    fireEvent.click(within(modal2).getByRole('button', { name: /Dismiss/i }));

    // Navigate back to Dashboard and verify metrics
    fireEvent.click(screen.getByRole('link', { name: /Dashboard/i }));

    // Dashboard should show 1 Unprocessed item again
    const updatedUnprocessedEl = await screen.findByTestId('dashboard-bronze-unprocessed');
    expect(updatedUnprocessedEl).toHaveTextContent('1 Unprocessed');
    expect(screen.getByTestId('dashboard-bronze-rejected')).toHaveTextContent('0 Rejected');

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-38] Bronze Batch Rejection: select multiple unprocessed inputs, click Reject Selected, updates status.
   * [NFR-USAB-15] Bronze Batch Rejection Responsiveness: updates instantly in list and dashboard.
   */
  it('allows the user to reject multiple raw Bronze inputs in a batch operation', async () => {
    const mockEmails = [
      {
        id: 'bronze-raw-10',
        sender: 'test1@sender.com',
        subject: 'Bronze Raw 10',
        date: '2026-06-12T10:00:00Z',
        snippet: 'Snippet 10',
        body: 'Body 10',
        hasTransaction: true,
        status: 'unprocessed' as const,
      },
      {
        id: 'bronze-raw-20',
        sender: 'test2@sender.com',
        subject: 'Bronze Raw 20',
        date: '2026-06-12T11:00:00Z',
        snippet: 'Snippet 20',
        body: 'Body 20',
        hasTransaction: true,
        status: 'unprocessed' as const,
      }
    ];

    const rejectBatchMock = vi.fn().mockImplementation((url, init) => {
      try {
        const body = JSON.parse(init.body);
        if (body.rawEmailIds) {
          body.rawEmailIds.forEach((id: string) => {
            const match = mockEmails.find(e => e.id === id);
            if (match) {
              match.status = 'rejected';
            }
          });
        }
      } catch (e) {}
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'rejected', rejectedIds: ['bronze-raw-10', 'bronze-raw-20'] })
      });
    });

    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/pipeline/reject-batch')) {
        return rejectBatchMock(url, init);
      }
      if (url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: mockEmails }) });
      }
      if (url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/gmail/deleted') || url.includes('/api/pipeline/deleted')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      if (url.includes('/api/ingestion/payment-methods')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentMethods: [] }) });
      }
      if (url.includes('/api/ingestion/payment-rules')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentRules: [] }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    window.history.pushState({}, 'Dashboard', '/');
    render(<App />);

    // Verify initial dashboard counts
    const bronzeCountEl = await screen.findByTestId('dashboard-bronze-count');
    expect(bronzeCountEl).toHaveTextContent('2');
    expect(screen.getByTestId('dashboard-bronze-unprocessed')).toHaveTextContent('2 Unprocessed');

    // Navigate to Pipeline page
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

    // Wait for the emails to load in the list
    expect(await screen.findByText('Bronze Raw 10')).toBeInTheDocument();
    expect(screen.getByText('Bronze Raw 20')).toBeInTheDocument();

    // Select both checkboxes
    const row1 = screen.getByText('Bronze Raw 10').closest('tr')!;
    const row2 = screen.getByText('Bronze Raw 20').closest('tr')!;
    const checkbox1 = within(row1).getByRole('checkbox');
    const checkbox2 = within(row2).getByRole('checkbox');

    fireEvent.click(checkbox1);
    fireEvent.click(checkbox2);

    // Verify Reject Selected button is visible
    const rejectBtn = screen.getByTestId('batch-reject-btn');
    expect(rejectBtn).toBeInTheDocument();
    expect(rejectBtn).toHaveTextContent('Reject Selected (2)');

    // Click batch reject button
    fireEvent.click(rejectBtn);

    // Verify reject-batch API was called
    await waitFor(() => {
      expect(rejectBatchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/pipeline/reject-batch'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"rawEmailIds":["bronze-raw-10","bronze-raw-20"]')
        })
      );
    });

    // [FUNC-GMAIL-48] After rejection, both records must disappear from the Transactions sub-tab
    // (they are now non-transactional and move to the Non-Transactional sub-tab)
    await waitFor(() => {
      expect(screen.queryByText('Bronze Raw 10')).not.toBeInTheDocument();
      expect(screen.queryByText('Bronze Raw 20')).not.toBeInTheDocument();
    });

    // Non-Transactional tab should now show count 2
    const nonTransactionalTab = screen.getByRole('button', { name: /Non-Transactional/i });
    expect(nonTransactionalTab.textContent).toContain('2');

    // Navigate back to Dashboard and verify metrics
    fireEvent.click(screen.getByRole('link', { name: /Dashboard/i }));

    // Dashboard should now show 0 Unprocessed and 2 Rejected
    const updatedUnprocessedEl = await screen.findByTestId('dashboard-bronze-unprocessed');
    expect(updatedUnprocessedEl).toHaveTextContent('0 Unprocessed');
    expect(screen.getByTestId('dashboard-bronze-rejected')).toHaveTextContent('2 Rejected');

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-48] Reject Implies Non-Transactional Classification:
   * After the user rejects a Bronze raw input, it must immediately move
   * from the Transactions sub-tab to the Non-Transactional sub-tab.
   */
  it('moves a rejected Bronze input from Transactions to Non-Transactional sub-tab immediately', async () => {
    const mockEmails = [
      {
        id: 'func48-email-1',
        sender: 'bank@hdfc.com',
        subject: 'HDFC Transaction Alert',
        date: '2026-06-15T10:00:00Z',
        snippet: 'Your card was charged INR 500',
        body: 'Full email body content',
        hasTransaction: true,
        status: 'unprocessed' as const,
      }
    ];

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      // Simulate PUT /api/pipeline/raw-inputs/:id with status=rejected
      if (url.includes('/api/pipeline/raw-inputs/func48-email-1') && init?.method === 'PUT') {
        const body = JSON.parse(init.body as string);
        if (body.status === 'rejected') {
          const email = mockEmails.find(e => e.id === 'func48-email-1');
          if (email) {
            email.status = 'rejected';
            (email as any).hasTransaction = false;
          }
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'updated' }) });
      }
      if (url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: mockEmails }) });
      }
      if (url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/gmail/deleted') || url.includes('/api/pipeline/deleted')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      if (url.includes('/api/ingestion/payment-methods')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentMethods: [] }) });
      }
      if (url.includes('/api/ingestion/payment-rules')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentRules: [] }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    window.history.pushState({}, 'Pipeline', '/pipeline');
    render(<App />);

    // Confirm the email appears in the Transactions sub-tab
    expect(await screen.findByText('HDFC Transaction Alert')).toBeInTheDocument();

    // The Transactions badge should show 1
    const transactionTab = screen.getByRole('button', { name: /Transactions/i });
    expect(transactionTab.textContent).toContain('1');

    // Reject the email via checkbox + batch reject
    const emailRow = screen.getByText('HDFC Transaction Alert').closest('tr')!;
    const checkbox = within(emailRow).getByRole('checkbox');
    fireEvent.click(checkbox);

    const rejectBtn = screen.getByTestId('batch-reject-btn');
    fireEvent.click(rejectBtn);

    // After rejection, the record should be gone from the Transactions sub-tab
    await waitFor(() => {
      expect(screen.queryByText('HDFC Transaction Alert')).not.toBeInTheDocument();
    });

    // Non-Transactional tab should now show 1
    const nonTransactionalTab = screen.getByRole('button', { name: /Non-Transactional/i });
    expect(nonTransactionalTab.textContent).toContain('1');

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-39] Refund Ingestion & Ledger Offsets: Ingest, staging review with link dropdown, ledger rendering with negative sign, dashboard balancing.
   * [NFR-USAB-16] Refund Balancing and Layout Consistency.
   */
  it('supports extracting, reviewing, linking, and offsetting refund transactions', async () => {
    // 1. Setup mock data
    const mockEmails = [
      {
        id: 'refund-email-id',
        sender: 'support@store.com',
        subject: 'Refund Confirmation',
        date: '2026-06-12T12:00:00Z',
        snippet: 'We refunded you USD 50.00',
        body: 'Full refund details for purchase reversal.',
        hasTransaction: true,
        status: 'unprocessed' as const,
        extracted: {
          id: 'silver-refund-id',
          merchant: 'Store',
          amount: 50.00,
          currency: 'USD',
          date: '2026-06-12',
          category: 'Shopping',
          paymentMethod: 'Credit Card',
          status: 'pending' as const,
          transactionType: 'refund' as const,
        }
      }
    ];

    const mockGold = [
      {
        id: 'gold-purchase-id',
        pendingTxId: 'silver-purchase-id',
        userId: 'user-1',
        sourceType: 'email',
        merchant: 'Store',
        amount: 120.00,
        currency: 'USD',
        transactionDate: '2026-06-10',
        category: 'Shopping',
        paymentMethod: 'Credit Card',
        transactionType: 'expense' as const,
      }
    ];

    const approveMock = vi.fn().mockImplementation((url, init) => {
      const body = JSON.parse(init.body);
      expect(body.transactionType).toBe('refund');
      expect(body.parentTransactionId).toBe('gold-purchase-id');
      
      mockEmails[0].status = 'processed';
      mockEmails[0].extracted.status = 'approved';
      mockGold.push({
        id: 'gold-refund-id',
        pendingTxId: 'silver-refund-id',
        userId: 'user-1',
        sourceType: 'email',
        merchant: 'Store',
        amount: 50.00,
        currency: 'USD',
        transactionDate: '2026-06-12',
        category: 'Shopping',
        paymentMethod: 'Credit Card',
        transactionType: 'refund' as const,
        parentTransactionId: 'gold-purchase-id',
      });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'approved' })
      });
    });

    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/pipeline/approve')) {
        return approveMock(url, init);
      }
      if (url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: mockEmails }) });
      }
      if (url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions')) {
        const staging = mockEmails[0].status === 'processed' ? [] : [
          {
            id: 'silver-refund-id',
            bronzeInputId: 'refund-email-id',
            rawEmailId: 'refund-email-id',
            sourceType: 'email',
            merchantRaw: 'Store',
            amount: 50.00,
            currency: 'USD',
            transactionDate: '2026-06-12',
            inferredCategory: 'Shopping',
            status: mockEmails[0].extracted.status,
            paymentMethod: 'Credit Card',
            transactionType: 'refund',
          }
        ];
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: staging }) });
      }
      if (url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: mockGold }) });
      }
      if (url.includes('/api/pipeline/deleted')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      if (url.includes('/api/ingestion/payment-methods')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentMethods: [{ id: 'pm-1', name: 'Credit Card' }] }) });
      }
      if (url.includes('/api/ingestion/payment-rules')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentRules: [] }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    window.history.pushState({}, 'Dashboard', '/');
    render(<App />);

    // 2. Dashboard verification: Net Expense = 120.00 INR
    const initialGoldCount = await screen.findByTestId('dashboard-gold-count');
    expect(initialGoldCount).toHaveTextContent('1');
    expect(screen.getByText(/Total amount:/i)).toHaveTextContent('Total amount: 120.00 INR');

    // 3. Navigate to Pipeline page
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

    // Click on Silver staging list tab
    fireEvent.click(screen.getByRole('button', { name: /Silver/i }));

    // Staging table must contain the refund row and the Refund Badge
    expect(await screen.findByText('Store')).toBeInTheDocument();
    expect(screen.getByText('Refund')).toBeInTheDocument();

    // Click on merchant name to open Detail Modal
    fireEvent.click(screen.getByText('Store'));

    const modal = screen.getByTestId('email-detail-modal');
    expect(modal).toBeInTheDocument();

    // The Type select dropdown must be visible and value set to "refund"
    const typeSelect = within(modal).getByLabelText('Transaction Type');
    expect(typeSelect).toHaveValue('refund');

    // Link Purchase dropdown must be visible
    const parentSelect = within(modal).getByLabelText('Link to Purchase (Reversal)');
    expect(parentSelect).toBeInTheDocument();

    // Choose the original purchase
    fireEvent.change(parentSelect, { target: { value: 'gold-purchase-id' } });

    // Click Approve & Save to promote refund to Gold ledger
    const approveBtn = within(modal).getByRole('button', { name: 'Approve & Save' });
    fireEvent.click(approveBtn);

    // Verify approve API payload
    await waitFor(() => {
      expect(approveMock).toHaveBeenCalled();
    });

    // Dismiss the modal
    fireEvent.click(within(modal).getByRole('button', { name: 'Close' }));

    // 4. Navigate to Gold Transactions Page and verify negative rendering
    fireEvent.click(screen.getByRole('link', { name: /Ledger/i }));

    // Ledger table should contain the refund row and the negative amount
    expect(await screen.findByText('-50.00')).toBeInTheDocument();

    // The currency totals widget should offset the refund: 120 - 50 = 70 USD
    expect(screen.getByText('70.00')).toBeInTheDocument();

    // 5. Navigate back to Dashboard and verify the balanced Net Expense total (70.00 INR)
    fireEvent.click(screen.getByRole('link', { name: /Dashboard/i }));
    const updatedGoldCount = await screen.findByTestId('dashboard-gold-count');
    expect(updatedGoldCount).toHaveTextContent('2');
    expect(screen.getByText(/Total amount:/i)).toHaveTextContent('Total amount: 70.00 INR');

    vi.unstubAllGlobals();
  });

  /**
   * [BUG-008] Delete Signature Mismatch for Manual Gold Ledger Entries on Ledger Page
   */
  it('supports deleting manual Gold transactions directly from the Ledger page details modal [BUG-008]', async () => {
    const mockManualTx = {
      id: 'gold_manual_999',
      userId: 'user-1',
      sourceType: 'manual',
      merchant: 'Manual Merchant B',
      amount: 150.00,
      currency: 'USD',
      transactionDate: '2026-06-12',
      category: 'Shopping',
      paymentMethod: 'Cash',
      notes: 'Manual payment notes'
    };

    let goldList = [mockManualTx];
    const deleteMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'reverted' }) });

    const mockFetch = vi.fn().mockImplementation((url, options) => {
      if (url.includes('/api/pipeline/gold-transactions') || url.includes('/api/gmail/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: goldList }) });
      }
      if (url.includes('/api/pipeline/revert-to-silver')) {
        return deleteMock(url, options);
      }
      if (url.includes('/api/ingestion/payment-methods')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentMethods: [] }) });
      }
      if (url.includes('/api/ingestion/payment-rules')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ rules: [] }) });
      }
      // fallback other pipeline mocks
      if (url.includes('/api/pipeline/raw-inputs') || url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [] }) });
      }
      if (url.includes('/api/pipeline/silver-transactions') || url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/pipeline/deleted')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });

    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    // Navigate to Ledger page
    fireEvent.click(screen.getByRole('link', { name: /Ledger/i }));

    // Click the manual entry merchant cell to open details
    const merchantCell = await screen.findByText('Manual Merchant B');
    fireEvent.click(merchantCell);

    // Modal should open
    const modal = screen.getByTestId('email-detail-modal');
    expect(modal).toBeInTheDocument();

    // Verify the delete button says "Delete" (since it's a manual entry) and click it
    const deleteBtn = within(modal).getByTestId('modal-delete-btn');
    expect(deleteBtn).toHaveTextContent('Delete');
    fireEvent.click(deleteBtn);

    // Confirmation modal should open, showing manual deletion title
    const confirmModal = screen.getByTestId('delete-confirmation-modal');
    expect(confirmModal).toBeInTheDocument();
    expect(within(confirmModal).getByText(/Delete Manual Transaction/i)).toBeInTheDocument();

    // Confirm deletion
    const confirmBtn = within(confirmModal).getByTestId('confirm-delete-btn');
    fireEvent.click(confirmBtn);

    // Verify delete endpoint was hit with correct goldId
    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalled();
    });
    const deletePayload = JSON.parse(deleteMock.mock.calls[0][1].body);
    expect(deletePayload.goldId).toBe('gold_manual_999');

    vi.unstubAllGlobals();
  });

  it('displays LLM parser performance metrics on the Dashboard and shows side-by-side comparison inside the lineage detail modal [FUNC-GOLD-PAGE-9] [FUNC-GOLD-PAGE-10] [FUNC-GMAIL-40]', async () => {
    const mockFetch = vi.fn((url: string, options?: any) => {
      if (url.includes('/api/gmail/raw-emails') || url.includes('/api/pipeline/raw-inputs')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            emails: [
              {
                id: 'bronze_log_123',
                sender: 'receipts@uber.com',
                subject: 'Your Ride with Uber',
                date: '2026-06-12T10:00:00Z',
                snippet: 'Charged USD 15.50',
                body: 'Ride details: Uber, USD 15.50, Payment: Credit Card',
                hasTransaction: true,
                status: 'processed'
              }
            ]
          })
        });
      }
      if (url.includes('/api/gmail/silver-transactions') || url.includes('/api/pipeline/silver-transactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            transactions: [
              {
                id: 'silver_tx_123',
                rawEmailId: 'bronze_log_123',
                bronzeInputId: 'bronze_log_123',
                merchantRaw: 'Uber',
                merchantNormalized: 'Uber',
                amount: 15.50,
                currency: 'USD',
                transactionDate: '2026-06-12',
                inferredCategory: 'Transport',
                status: 'approved',
                paymentMethod: 'Credit Card',
                transactionType: 'expense'
              },
              {
                id: 'silver_tx_456',
                rawEmailId: 'bronze_log_123',
                bronzeInputId: 'bronze_log_123',
                merchantRaw: 'Uber Staging',
                merchantNormalized: 'Uber Staging',
                amount: 15.50,
                currency: 'USD',
                transactionDate: '2026-06-12',
                inferredCategory: 'Transport',
                status: 'pending',
                paymentMethod: 'Credit Card',
                transactionType: 'expense'
              }
            ]
          })
        });
      }
      if (url.includes('/api/gmail/gold-transactions') || url.includes('/api/pipeline/gold-transactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            transactions: [
              {
                id: 'gold_tx_123',
                pendingTxId: 'silver_tx_123',
                bronzeInputId: 'bronze_log_123',
                merchant: 'Uber Corrected',
                amount: 15.50,
                currency: 'USD',
                transactionDate: '2026-06-12',
                category: 'Taxi',
                paymentMethod: 'Credit Card',
                transactionType: 'expense',
                sourceType: 'email'
              }
            ]
          })
        });
      }
      if (url.includes('/api/pipeline/llm-accuracy-stats')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            stats: {
              overallAccuracy: 75,
              merchantAccuracy: 50,
              amountAccuracy: 100,
              categoryAccuracy: 50,
              paymentMethodAccuracy: 100,
              totalTested: 4
            }
          })
        });
      }
      if (url.includes('/api/pipeline/llm-logs/bronze_log_123')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            log: {
              id: 'llm_log_123',
              userId: 'user-123',
              bronzeInputId: 'bronze_log_123',
              extractedMerchant: 'Uber',
              extractedAmount: 15.50,
              extractedCurrency: 'USD',
              extractedDate: '2026-06-12',
              extractedCategory: 'Transport',
              extractedPaymentMethod: 'Credit Card',
              extractedTransactionType: 'expense',
              confidenceScore: 0.95
            }
          })
        });
      }
      if (url.includes('/api/ingestion/payment-methods')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentMethods: [] }) });
      }
      if (url.includes('/api/ingestion/payment-rules')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ rules: [] }) });
      }
      if (url.includes('/api/pipeline/deleted')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });

    vi.stubGlobal('fetch', mockFetch);

    window.history.pushState({}, 'Dashboard', '/');
    render(<App />);

    const overallAcc = await screen.findByTestId('llm-overall-accuracy');
    expect(overallAcc).toHaveTextContent('75%');
    expect(screen.getByTestId('llm-merchant-accuracy')).toHaveTextContent('50%');
    expect(screen.getByTestId('llm-amount-accuracy')).toHaveTextContent('100%');
    expect(screen.getByTestId('llm-category-accuracy')).toHaveTextContent('50%');
    expect(screen.getByTestId('llm-payment-accuracy')).toHaveTextContent('100%');

    // Navigate to Ledger page to open modal
    fireEvent.click(screen.getByRole('link', { name: /Ledger/i }));

    const merchantCell = await screen.findByText('Uber Corrected');
    fireEvent.click(merchantCell);

    const modal = screen.getByTestId('email-detail-modal');
    expect(modal).toBeInTheDocument();

    const traceBtn = screen.getByRole('button', { name: /Trace Lineage/i });
    expect(traceBtn).toBeInTheDocument();
    fireEvent.click(traceBtn);

    const auditHeading = await screen.findByText(/LLM Extraction Audit/i);
    expect(auditHeading).toBeInTheDocument();

    expect(screen.getAllByText('Taxi').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Transport').length).toBeGreaterThan(0);
    expect(screen.getAllByText('📝 Corrected')).toHaveLength(2);

    // Close Gold modal
    const closeBtn = screen.getByRole('button', { name: /Close/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByTestId('email-detail-modal')).not.toBeInTheDocument();

    // Navigate to Pipeline
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

    // Switch to Silver tab
    const silverTab = await screen.findByRole('button', { name: /Silver \(Staging Queue\)/i });
    fireEvent.click(silverTab);

    // Open pending staging item
    const silverMerchantCell = await screen.findByText('Uber Staging');
    fireEvent.click(silverMerchantCell);

    // Assert read-only LLM preview card is rendered and correct
    expect(screen.getByTestId('email-detail-modal')).toBeInTheDocument();
    const stagingLlmPreview = await screen.findByTestId('silver-llm-extracted-preview');
    expect(stagingLlmPreview).toBeInTheDocument();
    expect(stagingLlmPreview).toHaveTextContent('Uber');
    expect(stagingLlmPreview).toHaveTextContent('15.50 USD');
    expect(stagingLlmPreview).toHaveTextContent('Transport');
    expect(stagingLlmPreview).toHaveTextContent('Credit Card');

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GOLD-PAGE-11] / [NFR-USAB-22]:
   * Verify that users can filter transactions by Category, Payment Method, and Ingestion Source.
   * Verify that filtering dynamically updates the high-density table view and recalculates currency totals.
   */
  it('supports filtering gold ledger transactions by category, payment method, and ingestion source with responsive UI updates', async () => {
    const mockGold = [
      { id: 'gold-1', silverTxId: 'silver-1', userId: 'user-1', sourceType: 'email', merchant: 'Supermarket A', amount: 50.00, currency: 'INR', transactionDate: '2026-06-10', category: 'Food', notes: 'groceries', paymentMethod: 'UPI' },
      { id: 'gold-2', silverTxId: null, userId: 'user-1', sourceType: 'manual', merchant: 'Taxi Ride', amount: 15.50, currency: 'USD', transactionDate: '2026-06-11', category: 'Transport', notes: 'Business trip', paymentMethod: 'Cash' },
      { id: 'gold-3', silverTxId: 'silver-3', userId: 'user-1', sourceType: 'email', merchant: 'Restaurant B', amount: 20.00, currency: 'INR', transactionDate: '2026-06-12', category: 'Food', notes: 'Dinner', paymentMethod: 'Cash' }
    ];

    const mockFetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/pipeline/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: mockGold }) });
      }
      if (url.includes('/api/pipeline/raw-inputs') || url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [] }) });
      }
      if (url.includes('/api/pipeline/silver-transactions') || url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/pipeline/deleted') || url.includes('/api/gmail/deleted')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      if (url.includes('/api/ingestion/payment-methods')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentMethods: [] }) });
      }
      if (url.includes('/api/ingestion/payment-rules')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentRules: [] }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    window.history.pushState({}, 'Dashboard', '/');
    render(<App />);

    // Navigate to Ledger page
    fireEvent.click(screen.getByRole('link', { name: /Ledger/i }));

    // Verify all 3 transactions are initially visible
    expect(await screen.findByText('Supermarket A')).toBeInTheDocument();
    expect(screen.getByText('Taxi Ride')).toBeInTheDocument();
    expect(screen.getByText('Restaurant B')).toBeInTheDocument();

    // Verify initial currency totals
    expect(screen.getByText('70.00')).toBeInTheDocument(); // INR total (50 + 20)
    expect(screen.getAllByText('15.50').length).toBeGreaterThan(0); // USD total

    // 1. Filter by Category: Food
    const categoryBtn = screen.getByLabelText(/Category:/i);
    fireEvent.click(categoryBtn);
    
    const foodCheckbox = screen.getByRole('checkbox', { name: 'Food' });
    fireEvent.click(foodCheckbox);

    // Supermarket A and Restaurant B should remain, Taxi Ride should disappear
    expect(screen.getByText('Supermarket A')).toBeInTheDocument();
    expect(screen.getByText('Restaurant B')).toBeInTheDocument();
    expect(screen.queryByText('Taxi Ride')).not.toBeInTheDocument();

    // Verify updated currency totals (INR 70.00 visible, USD 15.50 should be gone)
    expect(screen.getByText('70.00')).toBeInTheDocument();
    expect(screen.queryByText('15.50')).not.toBeInTheDocument();

    // 2. Filter by Payment Method: Cash (while Category is still Food)
    const methodBtn = screen.getByLabelText(/Payment Method:/i);
    fireEvent.click(methodBtn);
    
    const cashCheckbox = screen.getByRole('checkbox', { name: 'Cash' });
    fireEvent.click(cashCheckbox);

    // Restaurant B (Food + Cash) should remain, Supermarket A (Food + UPI) should disappear
    expect(screen.getByText('Restaurant B')).toBeInTheDocument();
    expect(screen.queryByText('Supermarket A')).not.toBeInTheDocument();

    // Verify currency totals (INR 20.00 visible)
    expect(screen.getAllByText('20.00').length).toBeGreaterThan(0);
    expect(screen.queryByText('70.00')).not.toBeInTheDocument();

    // 3. Reset filters (uncheck Food & Cash)
    fireEvent.click(foodCheckbox);
    fireEvent.click(categoryBtn); // close category dropdown
    
    fireEvent.click(cashCheckbox);
    fireEvent.click(methodBtn); // close method dropdown

    // Verify all visible again
    expect(screen.getByText('Supermarket A')).toBeInTheDocument();
    expect(screen.getByText('Taxi Ride')).toBeInTheDocument();
    expect(screen.getByText('Restaurant B')).toBeInTheDocument();

    // 4. Test multi-select options for Payment Method (Cash + UPI)
    fireEvent.click(methodBtn);
    const cashCheckboxMulti = screen.getByRole('checkbox', { name: 'Cash' });
    const upiCheckboxMulti = screen.getByRole('checkbox', { name: 'UPI' });
    
    // Check both Cash and UPI
    fireEvent.click(cashCheckboxMulti);
    fireEvent.click(upiCheckboxMulti);
    
    // All 3 should be visible
    expect(screen.getByText('Supermarket A')).toBeInTheDocument();
    expect(screen.getByText('Taxi Ride')).toBeInTheDocument();
    expect(screen.getByText('Restaurant B')).toBeInTheDocument();
    
    // Uncheck UPI -> Supermarket A should disappear, Taxi Ride & Restaurant B should remain
    fireEvent.click(upiCheckboxMulti);
    expect(screen.getByText('Taxi Ride')).toBeInTheDocument();
    expect(screen.getByText('Restaurant B')).toBeInTheDocument();
    expect(screen.queryByText('Supermarket A')).not.toBeInTheDocument();
    
    // Uncheck Cash to reset
    fireEvent.click(cashCheckboxMulti);
    fireEvent.click(methodBtn); // close method dropdown

    // 5. Filter by Source: Manual Entry
    const sourceBtn = screen.getByLabelText(/Source:/i);
    fireEvent.click(sourceBtn);
    const manualCheckbox = screen.getByRole('checkbox', { name: 'Manual Entry' });
    fireEvent.click(manualCheckbox);

    // Taxi Ride (manual) should remain, Supermarket A & Restaurant B (email) should disappear
    expect(screen.getByText('Taxi Ride')).toBeInTheDocument();
    expect(screen.queryByText('Supermarket A')).not.toBeInTheDocument();
    expect(screen.queryByText('Restaurant B')).not.toBeInTheDocument();

    // Verify totals (USD 15.50 visible)
    expect(screen.getAllByText('15.50').length).toBeGreaterThan(0);
    expect(screen.queryByText('70.00')).not.toBeInTheDocument();

    // Uncheck Manual Entry, check Email Ingested
    fireEvent.click(manualCheckbox);
    const emailCheckbox = screen.getByRole('checkbox', { name: 'Email Ingested' });
    fireEvent.click(emailCheckbox);

    // Supermarket A & Restaurant B should remain, Taxi Ride should disappear
    expect(screen.getByText('Supermarket A')).toBeInTheDocument();
    expect(screen.getByText('Restaurant B')).toBeInTheDocument();
    expect(screen.queryByText('Taxi Ride')).not.toBeInTheDocument();
    
    // Reset source filter
    fireEvent.click(emailCheckbox);
    fireEvent.click(sourceBtn); // close source dropdown

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-45] / [NFR-USAB-23]:
   * Verify that users can review and correct the currency code in the Silver staging review modal
   * and that saving promotes the transaction with the updated currency code.
   */
  it('supports reviewing and correcting currency code in the Silver staging review modal', async () => {
    const mockEmail = {
      id: 'email-1',
      sender: 'rides@uber.com',
      subject: 'Uber Ride Receipt',
      date: '2026-06-12T10:00:00Z',
      snippet: 'Uber transaction snippet',
      body: 'Charged USD 15.50 for ride.',
      hasTransaction: true,
      status: 'unprocessed'
    };

    const mockSilver = {
      id: 'silver-1',
      bronzeInputId: 'email-1',
      rawEmailId: 'email-1',
      sourceType: 'email',
      merchantRaw: 'Uber',
      merchantNormalized: 'Uber',
      amount: 15.50,
      currency: 'USD',
      transactionDate: '2026-06-12',
      inferredCategory: 'Transport',
      paymentMethod: 'Credit Card',
      status: 'pending'
    };

    const updateSilverMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'updated' }) });
    const approveMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'approved' }) });

    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/pipeline/silver-transactions/silver-1')) {
        return updateSilverMock(url, init);
      }
      if (url.includes('/api/pipeline/approve')) {
        return approveMock(url, init);
      }
      if (url.includes('/api/pipeline/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/pipeline/raw-inputs') || url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [mockEmail] }) });
      }
      if (url.includes('/api/pipeline/silver-transactions') || url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [mockSilver] }) });
      }
      if (url.includes('/api/pipeline/deleted') || url.includes('/api/gmail/deleted')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      if (url.includes('/api/ingestion/payment-methods')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentMethods: [{ id: 'm1', name: 'Credit Card' }] }) });
      }
      if (url.includes('/api/ingestion/payment-rules')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentRules: [] }) });
      }
      if (url.includes('/api/pipeline/llm-accuracy-stats')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ stats: { overallAccuracy: 100, fields: {} } }) });
      }
      if (url.includes('/api/pipeline/llm-logs')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ log: null }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    window.history.pushState({}, 'Dashboard', '/');
    render(<App />);

    // Go to Transaction Pipeline staging queue
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

    // Open pending Silver item by clicking Silver tab first
    const silverTabBtn = await screen.findByRole('button', { name: /Silver \(Staging Queue\)/i });
    fireEvent.click(silverTabBtn);

    const silverMerchantCell = await screen.findByText('Uber');
    fireEvent.click(silverMerchantCell);

    // Verify modal is open and has correct default values
    expect(screen.getByTestId('email-detail-modal')).toBeInTheDocument();
    expect(screen.getByLabelText(/Merchant/i)).toHaveValue('Uber');
    expect(screen.getByLabelText(/Amount/i)).toHaveValue(15.5);
    expect(screen.getByLabelText('Currency', { selector: 'input' })).toHaveValue('USD');

    // Change amount to 10.50 and currency to EUR
    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: '10.5' } });
    fireEvent.change(screen.getByLabelText('Currency', { selector: 'input' }), { target: { value: 'EUR' } });

    // Save Changes first
    const saveBtn = screen.getByRole('button', { name: /Save Updates/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateSilverMock).toHaveBeenCalled();
    });

    // Check payload passed to updateSilverTransaction API has currency EUR and amount 10.5
    const lastUpdateCallArgs = JSON.parse(updateSilverMock.mock.calls[0][1].body);
    expect(lastUpdateCallArgs.amount).toBe(10.5);
    expect(lastUpdateCallArgs.currency).toBe('EUR');

    // Click Approve & Promote
    const approveBtn = screen.getByRole('button', { name: /Approve & Save/i });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(approveMock).toHaveBeenCalled();
    });

    // Check payload passed to approveTransaction API contains currency EUR and amount 10.5
    const lastApproveCallArgs = JSON.parse(approveMock.mock.calls[0][1].body);
    expect(lastApproveCallArgs.amount).toBe(10.5);
    expect(lastApproveCallArgs.currency).toBe('EUR');

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-45] / [NFR-USAB-23]:
   * Verify that users can review and correct the currency code in the Gold ledger detail/correction modal,
   * and saving persists the corrected currency to the Gold table record.
   */
  it('supports reviewing and correcting currency code in the Gold ledger detail corrections modal', async () => {
    const mockGold = {
      id: 'gold-1',
      pendingTxId: 'silver-1',
      userId: 'user-1',
      sourceType: 'email',
      merchant: 'Taxi',
      amount: 20.00,
      currency: 'INR',
      transactionDate: '2026-06-11',
      category: 'Transport',
      notes: 'taxi ride',
      paymentMethod: 'Cash'
    };

    const updateGoldMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'updated' }) });

    const mockFetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/pipeline/gold-transactions/gold-1')) {
        return updateGoldMock(url, init);
      }
      if (url.includes('/api/pipeline/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [mockGold] }) });
      }
      if (url.includes('/api/pipeline/raw-inputs') || url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [] }) });
      }
      if (url.includes('/api/pipeline/silver-transactions') || url.includes('/api/gmail/silver-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: [] }) });
      }
      if (url.includes('/api/pipeline/deleted') || url.includes('/api/gmail/deleted')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      if (url.includes('/api/ingestion/payment-methods')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentMethods: [{ id: 'm1', name: 'Cash' }] }) });
      }
      if (url.includes('/api/ingestion/payment-rules')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentRules: [] }) });
      }
      if (url.includes('/api/pipeline/llm-accuracy-stats')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ stats: { overallAccuracy: 100, fields: {} } }) });
      }
      if (url.includes('/api/pipeline/llm-logs')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ log: null }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    window.history.pushState({}, 'Dashboard', '/');
    render(<App />);

    // Go to Gold Ledger page
    fireEvent.click(screen.getByRole('link', { name: /Ledger/i }));

    // Expect Taxi in list
    expect(await screen.findByText('Taxi')).toBeInTheDocument();

    // Click merchant cell to open edit modal
    fireEvent.click(screen.getByText('Taxi'));

    // Expect modal is open
    expect(screen.getByTestId('email-detail-modal')).toBeInTheDocument();
    expect(screen.getByLabelText('Currency', { selector: 'input' })).toHaveValue('INR');

    // Modify currency value to USD
    fireEvent.change(screen.getByLabelText('Currency', { selector: 'input' }), { target: { value: 'USD' } });

    // Click Save Changes button
    const saveBtn = screen.getByRole('button', { name: /Save Corrections/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateGoldMock).toHaveBeenCalled();
    });

    // Verify updated currency code is passed in body updates
    const lastUpdateCallArgs = JSON.parse(updateGoldMock.mock.calls[0][1].body);
    expect(lastUpdateCallArgs.currency).toBe('USD');

    vi.unstubAllGlobals();
  });

  /**
   * [FUNC-GMAIL-46] / [FUNC-GMAIL-47] / [NFR-USAB-24]:
   * Verify uniform filtering (keyword search, sort, Category, Method, Source, Currency) and
   * the dedicated Currency column display in Silver staging, Gold pipeline queue, and Gold ledger pages.
   */
  it('displays dedicated currency columns and filters by currency code across Silver, Gold pipeline, and Gold ledger tables', async () => {
    const mockSilver = [
      {
        id: 'silver-1',
        bronzeInputId: 'email-1',
        rawEmailId: 'email-1',
        sourceType: 'email',
        merchantRaw: 'Uber',
        merchantNormalized: 'Uber',
        amount: 15.50,
        currency: 'USD',
        transactionDate: '2026-06-12',
        inferredCategory: 'Transport',
        paymentMethod: 'Credit Card',
        status: 'pending',
        emailSubject: 'Uber Ride Receipt'
      },
      {
        id: 'silver-2',
        bronzeInputId: 'email-2',
        rawEmailId: 'email-2',
        sourceType: 'manual',
        merchantRaw: 'Groceries',
        merchantNormalized: 'Groceries',
        amount: 45.00,
        currency: 'INR',
        transactionDate: '2026-06-13',
        inferredCategory: 'Groceries',
        paymentMethod: 'Cash',
        status: 'pending',
        emailSubject: ''
      }
    ];

    const mockGold = [
      {
        id: 'gold-1',
        pendingTxId: 'silver-1',
        userId: 'user-1',
        sourceType: 'email',
        merchant: 'Uber',
        amount: 15.50,
        currency: 'USD',
        transactionDate: '2026-06-12',
        category: 'Transport',
        notes: 'uber ride',
        paymentMethod: 'Credit Card'
      },
      {
        id: 'gold-2',
        pendingTxId: 'silver-2',
        userId: 'user-1',
        sourceType: 'manual',
        merchant: 'Groceries',
        amount: 45.00,
        currency: 'INR',
        transactionDate: '2026-06-13',
        category: 'Groceries',
        notes: 'weekly groceries',
        paymentMethod: 'Cash'
      }
    ];

    const mockFetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/pipeline/silver-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: mockSilver }) });
      }
      if (url.includes('/api/pipeline/gold-transactions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ transactions: mockGold }) });
      }
      if (url.includes('/api/pipeline/raw-inputs') || url.includes('/api/gmail/raw-emails')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [] }) });
      }
      if (url.includes('/api/pipeline/deleted') || url.includes('/api/gmail/deleted')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ emails: [], silverTransactions: [], goldTransactions: [] }) });
      }
      if (url.includes('/api/ingestion/payment-methods')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentMethods: [] }) });
      }
      if (url.includes('/api/ingestion/payment-rules')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ paymentRules: [] }) });
      }
      if (url.includes('/api/pipeline/llm-accuracy-stats')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ stats: { overallAccuracy: 100, fields: {} } }) });
      }
      if (url.includes('/api/pipeline/llm-logs')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ log: null }) });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
    vi.stubGlobal('fetch', mockFetch);

    window.history.pushState({}, 'Dashboard', '/');
    render(<App />);

    // 1. Navigate to Medallion Transaction Pipeline
    fireEvent.click(screen.getByRole('link', { name: /Transaction Pipeline/i }));

    // 2. Select Silver tab
    const silverTabBtn = await screen.findByRole('button', { name: /Silver \(Staging Queue\)/i });
    fireEvent.click(silverTabBtn);

    // Verify both items are rendered
    expect(await screen.findByText('Uber')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByText('Groceries').length).toBeGreaterThan(0);
 
    // Verify Amount and separate Currency columns are rendered
    expect(screen.getAllByText('15.50').length).toBeGreaterThan(0);
    expect(screen.getByText('45.00')).toBeInTheDocument();
    expect(screen.getAllByText('USD').length).toBeGreaterThan(0);
    expect(screen.getAllByText('INR').length).toBeGreaterThan(0);
 
    // Filter Silver by Currency = INR
    const silverCurrencyBtn = screen.getByLabelText('Currency:');
    fireEvent.click(silverCurrencyBtn);
    const inrCheckbox = screen.getByLabelText('INR');
    fireEvent.click(inrCheckbox);
 
    // After filtering by INR, Uber (USD) should be gone, Groceries (INR) should be present
    await waitFor(() => {
      expect(screen.queryByText('Uber')).not.toBeInTheDocument();
      expect(within(screen.getByRole('table')).getAllByText('Groceries').length).toBeGreaterThan(0);
    });
 
    // Reset currency filter by unchecking
    fireEvent.click(inrCheckbox);
    fireEvent.click(silverCurrencyBtn); // close dropdown
 
    // 3. Switch to Gold Pipeline Tab
    const goldTabBtn = screen.getByRole('button', { name: /Gold \(Confirmed Ledger\)/i });
    fireEvent.click(goldTabBtn);
 
    // Verify both items in gold pipeline table
    expect(await screen.findByText('Uber')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByText('Groceries').length).toBeGreaterThan(0);
 
    // Filter Gold Pipeline by Category = Transport
    const goldCategoryBtn = screen.getByLabelText('Category:');
    fireEvent.click(goldCategoryBtn);
    const transportCheckbox = screen.getByLabelText('Transport');
    fireEvent.click(transportCheckbox);
 
    // After filtering by Transport, Groceries should be gone from the table
    await waitFor(() => {
      expect(within(screen.getByRole('table')).queryByText('Groceries')).not.toBeInTheDocument();
      expect(screen.getAllByText('Uber').length).toBeGreaterThan(0);
    });
 
    // Reset categories filter by unchecking
    fireEvent.click(transportCheckbox);
    fireEvent.click(goldCategoryBtn); // close dropdown
 
    // 4. Navigate to main Ledger page
    fireEvent.click(screen.getByRole('link', { name: /Ledger/i }));
 
    // Verify items and columns are correct in Ledger table
    expect(await screen.findByText('Uber')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByText('Groceries').length).toBeGreaterThan(0);
 
    // Filter Ledger page by Currency = USD
    const ledgerCurrencyBtn = screen.getByLabelText('Currency:');
    fireEvent.click(ledgerCurrencyBtn);
    const usdCheckbox = screen.getByLabelText('USD');
    fireEvent.click(usdCheckbox);
 
    // After filtering, Groceries (INR) is gone from the table
    await waitFor(() => {
      expect(within(screen.getByRole('table')).queryByText('Groceries')).not.toBeInTheDocument();
      expect(screen.getAllByText('Uber').length).toBeGreaterThan(0);
    });

    vi.unstubAllGlobals();
  });
});



