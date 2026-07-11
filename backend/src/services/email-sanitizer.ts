import { logger } from '../utils/logger';

/**
 * [FUNC-GMAIL-9] Decodes base64 email body content and strips HTML styling and markup.
 */
export class EmailSanitizer {
  static extractBody(part: any): string {
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
        logger.error({ err }, 'Failed to decode body part');
        return '';
      }
    }
    
    // If the part has subparts, recursively process them
    if (part.parts) {
      let plainText = '';
      let htmlText = '';
      
      for (const subPart of part.parts) {
        const text = EmailSanitizer.extractBody(subPart);
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
}
