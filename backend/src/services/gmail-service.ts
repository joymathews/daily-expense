import { google } from 'googleapis';

export interface GmailFetchFilters {
  sender?: string;
  subject?: string;
}

export interface FormattedEmail {
  id: string;
  sender: string;
  subject: string;
  date: string;
  snippet: string;
}

export class GmailService {
  /**
   * [FUNC-GMAIL-4] Fetches emails based on filters using the provided ephemeral access token.
   */
  async fetchEmails(accessToken: string, filters: GmailFetchFilters): Promise<FormattedEmail[]> {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    
    const gmail = google.gmail({ version: 'v1', auth });
    
    // Construct search query
    let query = '';
    if (filters.sender) query += `from:${filters.sender} `;
    if (filters.subject) query += `subject:${filters.subject} `;
    
    try {
      const listResponse = await gmail.users.messages.list({
        userId: 'me',
        q: query.trim(),
        maxResults: 10,
      });

      const messages = listResponse.data.messages || [];
      const formattedEmails: FormattedEmail[] = [];

      for (const message of messages) {
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: message.id!,
        });

        const headers = msg.data.payload?.headers || [];
        const sender = headers.find(h => h.name?.toLowerCase() === 'from')?.value || 'Unknown';
        const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '(No Subject)';
        const date = headers.find(h => h.name?.toLowerCase() === 'date')?.value || 'Unknown';

        formattedEmails.push({
          id: message.id!,
          sender,
          subject,
          date,
          snippet: msg.data.snippet || '',
        });
      }

      return formattedEmails;
    } catch (error) {
      console.error('Error fetching from Gmail API:', error);
      throw new Error('Failed to fetch messages from Gmail');
    }
  }
}
