/**
 * Formats a UTC date string into the user's local timezone date string.
 * Uses a standard format matching the rest of the application (e.g. "Jun 19, 2026").
 * 
 * [FUNC-GMAIL-50], [NFR-USAB-25]
 * 
 * @param dateStr ISO 8601 UTC date string, RFC date string, or other date string
 * @param includeTime Whether to include local time formatting or just date
 * @returns Formatted local date string (e.g. "Jun 19, 2026") or "N/A"
 */
export const formatToUserTimezone = (dateStr?: string, includeTime = false): string => {
  if (!dateStr || dateStr === 'N/A' || dateStr === 'Unknown') return 'N/A';
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) return dateStr;
  
  if (includeTime) {
    return parsed.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};
