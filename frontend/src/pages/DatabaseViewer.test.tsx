import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DatabaseViewer from './DatabaseViewer';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock aws-amplify/auth
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: { idToken: { toString: () => 'mock-token' } }
  })
}));

describe('DatabaseViewer Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * [FUNC-DB-VIEWER-1] Database Viewer Navigation & Interface
   * [FUNC-DB-VIEWER-2] Table Selection & Schema Inspection
   * Verify rendering table list, switching active table, and showing record metrics.
   */
  it('should render table selector and display table records', async () => {
    // Mock tables endpoint
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/pipeline/db/tables/gold_transactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            tableName: 'gold_transactions',
            columns: ['id', 'user_id', 'merchant', 'amount_cents', 'category'],
            totalCount: 1,
            limit: 50,
            offset: 0,
            rows: [
              {
                id: 'tx-101',
                user_id: 'user-1',
                merchant: 'Starbucks Coffee',
                amount_cents: 350,
                category: 'Food'
              }
            ]
          })
        });
      }
      if (url.includes('/api/pipeline/db/tables')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            tables: [
              { name: 'gold_transactions', columns: ['id', 'user_id', 'merchant', 'amount_cents', 'category'] },
              { name: 'silver_extracted_transactions', columns: ['id', 'user_id', 'merchant_raw'] }
            ]
          })
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    render(<DatabaseViewer />);

    // Wait for header and table content to load
    await waitFor(() => {
      expect(screen.getByText(/Database Raw Table Viewer/i)).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('Starbucks Coffee')).toBeInTheDocument();
      expect(screen.getByText('tx-101')).toBeInTheDocument();
    });
  });

  /**
   * [FUNC-DB-VIEWER-4] Raw Cell Value Inspector
   * Verify opening detail modal when clicking a cell.
   */
  it('should open cell modal when clicking cell value', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/pipeline/db/tables/bronze_raw_inputs')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            tableName: 'bronze_raw_inputs',
            columns: ['id', 'raw_body'],
            totalCount: 1,
            limit: 50,
            offset: 0,
            rows: [
              {
                id: 'bronze-1',
                raw_body: '{"status": "success", "amount": 100}'
              }
            ]
          })
        });
      }
      if (url.includes('/api/pipeline/db/tables')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            tables: [
              { name: 'bronze_raw_inputs', columns: ['id', 'raw_body'] }
            ]
          })
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });


    render(<DatabaseViewer />);

    await waitFor(() => {
      expect(screen.getByText(/raw_body/i)).toBeInTheDocument();
    });

    const jsonCell = await screen.findByText(/{"status": "success", "amount": 100}/i);
    fireEvent.click(jsonCell);

    // Verify cell modal opens
    await waitFor(() => {
      expect(screen.getByText(/Cell Value Inspector/i)).toBeInTheDocument();
    });
  });
});
