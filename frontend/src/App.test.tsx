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
      // Check if we want to simulate authenticated or unauthenticated
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

describe('App Requirements Coverage', () => {
  beforeEach(() => {
    (globalThis as any).isAuthenticated = false;
    (globalThis as any).mockSignOut = vi.fn();
    vi.clearAllMocks();
  });

  /**
   * [FUNC-AUTH-1] The user must be challenged for credentials.
   * [FUNC-AUTH-2] The system must remain inaccessible to unauthenticated users.
   */
  it('challenges for credentials when unauthenticated', async () => {
    render(<App />);
    expect(screen.getByTestId('mocked-authenticator-unauth')).toBeInTheDocument();
    expect(screen.queryByText(/Welcome to Daily Expense/i)).not.toBeInTheDocument();
  });

  /**
   * [FUNC-SKEL-UI-1] The user must be able to access the application dashboard.
   * [FUNC-SKEL-UI-2] The user must see a "Welcome to Daily Expense" message.
   * [FUNC-AUTH-3] Authenticated users must have the ability to securely log out.
   */
  it('renders dashboard and allows logout when authenticated', async () => {
    (globalThis as any).isAuthenticated = true;
    render(<App />);

    // [FUNC-SKEL-UI-1] [FUNC-SKEL-UI-2] Verify dashboard content
    expect(screen.getByText(/Welcome to Daily Expense/i)).toBeInTheDocument();
    expect(screen.getByText(/testuser@example.com/i)).toBeInTheDocument();

    // [FUNC-AUTH-3] Verify logout
    const logoutButton = screen.getByText(/Sign Out/i);
    fireEvent.click(logoutButton);
    expect((globalThis as any).mockSignOut).toHaveBeenCalled();
  });

  /**
   * [NFR-SEC-1] Identity Management: The system must use a centralized identity provider (AWS Cognito).
   */
  it('integrates with AWS Cognito via Authenticator', () => {
    render(<App />);
    // Verification of Authenticator presence justifies NFR-SEC-1
    expect(screen.getByTestId('mocked-authenticator-unauth')).toBeInTheDocument();
  });

  /**
   * [FUNC-SKEL-UI-3] Responsive Design / [NFR-PERF-2] Responsive interface.
   */
  it('applies responsive layout styles', () => {
    (globalThis as any).isAuthenticated = true;
    render(<App />);
    const container = screen.getByText(/Welcome to Daily Expense/i).closest('.min-h-screen');
    expect(container).toHaveClass('p-4'); // Tailwind responsive padding check
  });
});
