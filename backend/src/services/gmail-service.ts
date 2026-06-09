import { google } from 'googleapis';

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
  hasTransaction: boolean;
}

export class GmailService {
  /**
   * [FUNC-GMAIL-6] [NFR-GMAIL-2] Categorizes email as transactional or not based on subject.
   */
  isTransaction(subject: string, snippet: string): boolean {
    if (subject.toLowerCase().includes('otp')) {
      return false;
    }
    return true;
  }

  /**
   * [FUNC-GMAIL-4] Fetches emails based on filters using the provided ephemeral access token.
   */
  async fetchEmails(accessToken: string, filters: GmailFetchFilters): Promise<FormattedEmail[]> {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    
    const gmail = google.gmail({ version: 'v1', auth });
    
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

        formattedEmails.push({
          id: message.id!,
          sender,
          subject,
          date,
          snippet,
          hasTransaction,
        });
      }

      return formattedEmails;

    } catch (error) {
      console.error('Error fetching from Gmail API:', error);
      throw new Error('Failed to fetch messages from Gmail');
    }
  }
}
