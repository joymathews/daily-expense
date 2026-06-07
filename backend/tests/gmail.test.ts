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
   * This backend test verifies the fetch route correctly interacts with Gmail API mocks.
   */
  it('should fetch and format emails from Gmail', async () => {
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
        filters: { sender: 'test', subject: 'receipt' }
      });

    expect(response.status).toBe(200);
    expect(response.body.emails).toHaveLength(1);
    expect(response.body.emails[0]).toEqual({
      id: 'msg1',
      sender: 'sender@test.com',
      subject: 'Test Subject',
      date: '2023-01-01',
      snippet: 'Test Snippet'
    });
  });

  it('should return 400 if accessToken is missing', async () => {
    const response = await request(app)
      .post('/api/gmail/fetch')
      .send({ filters: {} });
    
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('required');
  });
});
