const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Standard currency formatter supporting INR formatting and international currency codes.
 */
export const formatCurrency = (amount: number, currency: string = 'INR'): string => {
  const val = Number(amount) || 0;
  if (currency === 'INR' || currency === '₹') {
    return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${currency} ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/**
 * Formats YYYY-MM-DD date string to readable format (e.g. 17 Aug '26).
 */
export const formatCycleDisplayDate = (dateStr: string): string => {
  if (!dateStr) return '';
  const parts = dateStr.split('-').map(Number);
  if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return dateStr;
  const monthName = MONTH_NAMES[parts[1] - 1] || parts[1];
  const shortYear = String(parts[0]).slice(2);
  return `${parts[2]} ${monthName} '${shortYear}`;
};

/**
 * Formats YYYY-MM-DD to localized date display.
 */
export const formatDate = (dateStr: string): string => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
