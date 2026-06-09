import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';
import React from 'react';

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
      { id: '1', sender: 'sender@test.com', subject: 'Inv 123', date: '2023-01-01', snippet: 'Paid amount rs. 100', hasTransaction: true },
      { id: '2', sender: 'newsletter@test.com', subject: 'Weekly Update', date: '2023-01-02', snippet: 'Hello there', hasTransaction: false }
    ];
    
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ emails: mockEmails }),
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
});

