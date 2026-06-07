import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import React from 'react';

describe('App Authentication Gate', () => {
  /**
   * [FUNC-AUTH-1] The user must be challenged for credentials.
   * [FUNC-AUTH-2] The system must remain inaccessible to unauthenticated users.
   */
  it('challenges for credentials when unauthenticated', async () => {
    render(<App />);
    
    // Use findAllByText since Amplify renders multiple "Sign In" elements (tab and button)
    const signInElements = await screen.findAllByText(/Sign In/i);
    expect(signInElements.length).toBeGreaterThan(0);
    
    // Dashboard content should NOT be visible
    expect(screen.queryByText(/Welcome to Daily Expense/i)).not.toBeInTheDocument();
  });
});
