import request from 'supertest';
import { app } from '../src/app';
import { google } from 'googleapis';

// Mock googleapis
jest.mock('googleapis', () => {
  const mList = jest.fn();
  const mGet = jest.fn();
  return {
    google: {
      auth: {
        OAuth2: jest.fn().mockImplementation(() => ({
          setCredentials: jest.fn(),
        })),
      },
      gmail: jest.fn().mockImplementation(() => ({
        users: {
          messages: {
            list: mList,
            get: mGet,
          },
        },
      })),
    },
  };
});

describe('Gmail API Integration', () => {
  const gmail = google.gmail('v1');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * [FUNC-GMAIL-4] The system must display fetched emails.
   * [FUNC-GMAIL-2] Configuration: filters for multi-sender, start date, and end date.
   * This backend test verifies the fetch route correctly interacts with Gmail API mocks.
   */
  it('should fetch and format emails from Gmail with multi-sender and date range', async () => {
    // Mock list response
    (gmail.users.messages.list as jest.Mock).mockResolvedValue({
      data: { messages: [{ id: 'msg1' }] }
    });

    // Mock get response
    (gmail.users.messages.get as jest.Mock).mockResolvedValue({
      data: {
        id: 'msg1',
        snippet: 'Test Snippet',
        payload: {
          headers: [
            { name: 'From', value: 'sender@test.com' },
            { name: 'Subject', value: 'Test Subject' },
            { name: 'Date', value: '2023-01-01' }
          ]
        }
      }
    });

    const response = await request(app)
      .post('/api/gmail/fetch')
      .send({
        accessToken: 'mock-token',
        filters: { 
          sender: ['test@example.com', 'receipts@store.com'], 
          startDate: '2023-01-01', 
          endDate: '2023-01-31', 
          subject: 'receipt' 
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.emails).toHaveLength(1);
    
    // Verify query construction (internal check)
    expect(gmail.users.messages.list).toHaveBeenCalledWith(expect.objectContaining({
      q: expect.stringContaining('(from:test@example.com OR from:receipts@store.com)')
    }));
    expect(gmail.users.messages.list).toHaveBeenCalledWith(expect.objectContaining({
      q: expect.stringContaining('after:2023/01/01')
    }));
    expect(gmail.users.messages.list).toHaveBeenCalledWith(expect.objectContaining({
      q: expect.stringContaining('before:2023/01/31')
    }));
  });

  /**
   * [FUNC-GMAIL-5] Pagination: Retrieve all emails across multiple pages.
   */
  it('should fetch all emails across multiple pages using pagination', async () => {
    // Mock 1st page response with token
    (gmail.users.messages.list as jest.Mock)
      .mockResolvedValueOnce({
        data: { 
          messages: [{ id: 'page1-msg1' }], 
          nextPageToken: 'token-for-page-2' 
        }
      })
      // Mock 2nd page response without token
      .mockResolvedValueOnce({
        data: { 
          messages: [{ id: 'page2-msg1' }] 
        }
      });

    // Mock individual get calls
    (gmail.users.messages.get as jest.Mock).mockImplementation(({ id }) => {
      return Promise.resolve({
        data: {
          id,
          snippet: `Snippet for ${id}`,
          payload: {
            headers: [
              { name: 'From', value: 'sender@test.com' },
              { name: 'Subject', value: `Subject for ${id}` },
              { name: 'Date', value: '2023-01-01' }
            ]
          }
        }
      });
    });

    const response = await request(app)
      .post('/api/gmail/fetch')
      .send({
        accessToken: 'mock-token',
        filters: { 
          sender: ['test@example.com'], 
          startDate: '2023-01-01', 
          endDate: '2023-01-31' 
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.emails).toHaveLength(2);
    expect(response.body.emails[0].id).toBe('page1-msg1');
    expect(response.body.emails[1].id).toBe('page2-msg1');
    
    // Verify list called twice
    expect(gmail.users.messages.list).toHaveBeenCalledTimes(2);
    expect(gmail.users.messages.list).toHaveBeenNthCalledWith(1, expect.objectContaining({ pageToken: undefined }));
    expect(gmail.users.messages.list).toHaveBeenLastCalledWith(expect.objectContaining({ pageToken: 'token-for-page-2' }));
  });

  /**
   * [NFR-SEC-4] Input Validation: Ensure mandatory fields are present.
   */
  it('should return 400 if sender list is empty or missing', async () => {
    const response = await request(app)
      .post('/api/gmail/fetch')
      .send({ 
        accessToken: 'mock-token',
        filters: { sender: [], startDate: '2023-01-01', endDate: '2023-01-31' } 
      });
    
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('sender');
  });

  /**
   * [NFR-SEC-4] Input Validation: Ensure date range is present.
   */
  it('should return 400 if date range is missing', async () => {
    const response = await request(app)
      .post('/api/gmail/fetch')
      .send({ 
        accessToken: 'mock-token',
        filters: { sender: ['test@example.com'] } 
      });
    
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/start.*end.*required/i);
  });

  it('should return 400 if accessToken is missing', async () => {
    const response = await request(app)
      .post('/api/gmail/fetch')
      .send({ filters: {} });
    
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('required');
  });
});
