import { google, gmail_v1 } from 'googleapis';
import { EmailSanitizer } from './email-sanitizer';
import { EmailClassifier } from './email-classifier';

export interface GmailFetchFilters {
  sender: string[];
  startDate: string;
  endDate: string;
  subject?: string;
}

export interface FormattedEmail {
  id: string;
  sender: string;
  subject: string;
  date: string;
  snippet: string;
  body: string;
  hasTransaction: boolean;
}

export class GmailService {
  private gmailClient?: gmail_v1.Gmail;

  constructor(gmailClient?: gmail_v1.Gmail) {
    this.gmailClient = gmailClient;
  }

  /**
   * Helper to retrieve either the injected client or instantiate a new one.
   */
  private getGmailClient(accessToken: string): gmail_v1.Gmail {
    if (this.gmailClient) {
      return this.gmailClient;
    }
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return google.gmail({ version: 'v1', auth });
  }

  /**
   * [FUNC-GMAIL-6] [NFR-GMAIL-2] Categorizes email as transactional or not based on subject.
   * Exposes dependency delegation for backward compatibility.
   */
  isTransaction(subject: string, snippet: string): boolean {
    return EmailClassifier.isTransaction(subject);
  }

  /**
   * Recursively extracts and decodes the plain text body from the Gmail message payload.
   * Exposes dependency delegation for backward compatibility.
   */
  extractBody(part: any): string {
    return EmailSanitizer.extractBody(part);
  }

  /**
   * [FUNC-GMAIL-4] Fetches emails based on filters using the provided ephemeral access token.
   */
  async fetchEmails(accessToken: string, filters: GmailFetchFilters): Promise<FormattedEmail[]> {
    const gmail = this.getGmailClient(accessToken);
    
    // Construct search query
    // Date format for Gmail: YYYY/MM/DD
    const formatDate = (dateStr: string) => dateStr.replace(/-/g, '/');
    
    let query = '';
    
    if (filters.sender && filters.sender.length > 0) {
      const senderQuery = filters.sender.map(s => `from:${s}`).join(' OR ');
      query += `(${senderQuery}) `;
    }
    
    if (filters.startDate) {
      query += `after:${formatDate(filters.startDate)} `;
    }
    
    if (filters.endDate) {
      query += `before:${formatDate(filters.endDate)} `;
    }

    if (filters.subject) {
      query += `subject:${filters.subject} `;
    }
    
    try {
      let allMessages: any[] = [];
      let pageToken: string | undefined = undefined;

      // [FUNC-GMAIL-5] Loop through all pages of results
      do {
        const response: any = await gmail.users.messages.list({
          userId: 'me',
          q: query.trim(),
          maxResults: 100, // Increase per-page limit for efficiency [NFR-PERF-3]
          pageToken: pageToken,
        });

        if (response.data.messages) {
          allMessages = allMessages.concat(response.data.messages);
        }
        pageToken = response.data.nextPageToken || undefined;
      } while (pageToken);

      const formattedEmails: FormattedEmail[] = [];

      // [NFR-PERF-3] Process messages. In a real production app with massive volumes, 
      // we might batch this further, but for a daily expense tracker, sequential 
      // or Promise.all on the accumulated list is acceptable for now.
      for (const message of allMessages) {
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: message.id!,
        });

        const headers = msg.data.payload?.headers || [];
        const sender = headers.find(h => h.name?.toLowerCase() === 'from')?.value || 'Unknown';
        const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '(No Subject)';
        const date = headers.find(h => h.name?.toLowerCase() === 'date')?.value || 'Unknown';
        const snippet = msg.data.snippet || '';
        const hasTransaction = this.isTransaction(subject, snippet);
        const rawBody = this.extractBody(msg.data.payload);
        const body = rawBody || snippet;

        formattedEmails.push({
          id: message.id!,
          sender,
          subject,
          date,
          snippet,
          body,
          hasTransaction,
        });
      }

      return formattedEmails;

    } catch (error) {
      console.error('Error fetching from Gmail API:', error);
      throw new Error('Failed to fetch messages from Gmail');
    }
  }

  /**
   * [FUNC-GMAIL-27] Retrieves message IDs matching the filters.
   */
  async fetchMessageIds(accessToken: string, filters: GmailFetchFilters): Promise<string[]> {
    const gmail = this.getGmailClient(accessToken);
    const formatDate = (dateStr: string) => dateStr.replace(/-/g, '/');
    let query = '';
    
    if (filters.sender && filters.sender.length > 0) {
      const senderQuery = filters.sender.map(s => `from:${s}`).join(' OR ');
      query += `(${senderQuery}) `;
    }
    
    if (filters.startDate) {
      query += `after:${formatDate(filters.startDate)} `;
    }
    
    if (filters.endDate) {
      query += `before:${formatDate(filters.endDate)} `;
    }

    if (filters.subject) {
      query += `subject:${filters.subject} `;
    }

    try {
      let allMessages: any[] = [];
      let pageToken: string | undefined = undefined;

      do {
        const response: any = await gmail.users.messages.list({
          userId: 'me',
          q: query.trim(),
          maxResults: 100,
          pageToken: pageToken,
        });

        if (response.data.messages) {
          allMessages = allMessages.concat(response.data.messages);
        }
        pageToken = response.data.nextPageToken || undefined;
      } while (pageToken);

      return allMessages.map(m => m.id!);
    } catch (error) {
      console.error('Error listing messages from Gmail API:', error);
      throw new Error('Failed to list messages from Gmail');
    }
  }

  /**
   * [FUNC-GMAIL-27] Fetches full email details for a single message ID.
   */
  async fetchEmailDetail(accessToken: string, messageId: string): Promise<FormattedEmail> {
    const gmail = this.getGmailClient(accessToken);
    try {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
      });

      const headers = msg.data.payload?.headers || [];
      const sender = headers.find(h => h.name?.toLowerCase() === 'from')?.value || 'Unknown';
      const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '(No Subject)';
      const date = headers.find(h => h.name?.toLowerCase() === 'date')?.value || 'Unknown';
      const snippet = msg.data.snippet || '';
      const hasTransaction = this.isTransaction(subject, snippet);
      const rawBody = this.extractBody(msg.data.payload);
      const body = rawBody || snippet;

      return {
        id: messageId,
        sender,
        subject,
        date,
        snippet,
        body,
        hasTransaction,
      };
    } catch (error) {
      console.error(`Error getting details for message ${messageId}:`, error);
      throw new Error(`Failed to fetch message details for ${messageId}`);
    }
  }
}
