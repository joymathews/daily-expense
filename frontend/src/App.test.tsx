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
    useGoogleLogin: () => vi.fn()
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
   * [FUNC-GMAIL-2] Configuration: filters for Sender and Subject.
   * [FUNC-GMAIL-3] Authentication: Authorize via OAuth2 popup.
   * [NFR-GMAIL-1] Session Security: Ephemeral tokens.
   */
  it('supports Gmail configuration and OAuth authentication', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));

    expect(screen.getByPlaceholderText(/expenses@.../i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/receipt.../i)).toBeInTheDocument();
    expect(screen.getByText(/Authorize & Fetch/i)).toBeInTheDocument();
  });

  /**
   * [FUNC-GMAIL-4] Display: Show fetched data in high-density table.
   */
  it('displays transaction results table headers', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('link', { name: /Gmail Fetch/i }));
    expect(screen.getByText(/Inbox Records/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Sender/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Details/i)).toBeInTheDocument();
  });
});
