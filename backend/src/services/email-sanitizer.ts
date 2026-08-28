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
          // Strip styles, scripts, convert block tags to newlines, and unescape entities for readable text
          return decoded
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<(br|p|div|tr|li|h[1-6])[^>]*>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .split('\n')
            .map(line => line.trim())
            .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0))
            .join('\n')
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
