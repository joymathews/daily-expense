import { describe, it, expect } from 'vitest';
import { formatToUserTimezone } from './date-formatter';

describe('formatToUserTimezone', () => {
  /**
   * [FUNC-GMAIL-50] Timezone-Aware Ingestion Date and Time Rendering: handles empty or invalid inputs.
   */
  it('should return N/A for undefined, N/A, or Unknown', () => {
    expect(formatToUserTimezone()).toBe('N/A');
    expect(formatToUserTimezone(undefined)).toBe('N/A');
    expect(formatToUserTimezone('N/A')).toBe('N/A');
    expect(formatToUserTimezone('Unknown')).toBe('N/A');
  });

  /**
   * [FUNC-GMAIL-50] Timezone-Aware Ingestion Date and Time Rendering: handles malformed data cleanly.
   */
  it('should return raw input for invalid date strings', () => {
    expect(formatToUserTimezone('not-a-date')).toBe('not-a-date');
  });

  /**
   * [FUNC-GMAIL-50] Timezone-Aware Ingestion Date and Time Rendering
   * [NFR-USAB-25] Local Timezone Formatting Latency: parses UTC ISO to standard locale-formatted dates.
   */
  it('should format a valid ISO UTC date string correctly compared to standard toLocaleDateString', () => {
    const isoString = '2026-06-19T15:21:43.000Z';
    const expected = new Date(isoString).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    expect(formatToUserTimezone(isoString)).toBe(expected);
  });

  /**
   * [FUNC-GMAIL-50] Timezone-Aware Ingestion Date and Time Rendering: parses UTC ISO to local time formatted strings.
   * [NFR-USAB-25] Local Timezone Formatting Latency
   */
  it('should include time when includeTime is true', () => {
    const isoString = '2026-06-19T15:21:43.000Z';
    const expected = new Date(isoString).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(formatToUserTimezone(isoString, true)).toBe(expected);
  });
});
