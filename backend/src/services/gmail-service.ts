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
  body: string;
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
   * Recursively extracts and decodes the plain text body from the Gmail message payload,
   * stripping HTML tag noise if it is an HTML-only part.
   */
  extractBody(part: any): string {
    if (!part) return '';
    
    // If the part contains the body data directly
    if (part.body && part.body.data) {
      try {
        const base64Data = part.body.data;
        const decoded = Buffer.from(base64Data, 'base64').toString('utf-8');
        
        if (part.mimeType === 'text/html') {
          // Strip styles, scripts, and HTML tags to obtain safe, clean text
          return decoded
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        }
        return decoded;
      } catch (err) {
        console.error('Failed to decode body part:', err);
        return '';
      }
    }
    
    // If the part has subparts, recursively process them
    if (part.parts) {
      let plainText = '';
      let htmlText = '';
      
      for (const subPart of part.parts) {
        const text = this.extractBody(subPart);
        if (text) {
          if (subPart.mimeType === 'text/plain') {
            plainText = text;
          } else if (subPart.mimeType === 'text/html') {
            htmlText = text;
          } else {
            plainText = plainText || text;
          }
        }
      }
      return plainText || htmlText;
    }
    
    return '';
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
}
