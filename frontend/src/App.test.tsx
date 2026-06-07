import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import React from 'react';

describe('App Dashboard', () => {
  /**
   * [FUNC-SKEL-UI-2] The user must see a "Welcome to Daily Expense" message on the dashboard.
   */
  it('renders the welcome message', () => {
    render(<App />);
    // Note: I'll need to update App.tsx to actually show this message to pass the test.
    // For now, let's see what's in the default Vite App.tsx or just update it now.
    expect(screen.getByText(/Welcome to Daily Expense/i)).toBeInTheDocument();
  });
});
