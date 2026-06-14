export const STANDARD_CATEGORIES = [
  'Groceries',
  'Cabs & Transport',
  'Travel',
  'Utilities',
  'Internet & Telecom',
  'Entertainment Subscriptions',
  'Cloud & Software Services',
  'Shopping',
  'Restaurant & Dining',
  'Online Food Order',
  'Medical & Healthcare',
  'Other'
];

export function normalizeCategory(category: string | undefined | null): string {
  if (!category) return 'Other';
  const trimmed = category.trim();
  if (!trimmed) return 'Other';

  // 1. Check case-insensitive match against standard categories
  const matchedStandard = STANDARD_CATEGORIES.find(
    c => c.toLowerCase() === trimmed.toLowerCase()
  );
  if (matchedStandard) {
    return matchedStandard;
  }

  // 2. Map common variations to standard categories to prevent duplicates
  const lower = trimmed.toLowerCase();
  if (lower === 'grocery' || lower === 'grocery shopping') return 'Groceries';
  if (lower === 'cab' || lower === 'cabs' || lower === 'taxi' || lower === 'transport') return 'Cabs & Transport';
  if (lower === 'travel') return 'Travel';
  if (
    lower === 'utility' ||
    lower === 'utility bill' ||
    lower === 'gas' ||
    lower === 'electricity' ||
    lower === 'water' ||
    lower === 'maintenance' ||
    lower === 'maintenance charge' ||
    lower === 'maintenance charges'
  ) {
    return 'Utilities';
  }
  if (lower === 'internet' || lower === 'telecom' || lower === 'wifi' || lower === 'recharge') {
    return 'Internet & Telecom';
  }
  if (
    lower === 'subscription' ||
    lower === 'netflix' ||
    lower === 'spotify' ||
    lower === 'prime' ||
    lower === 'youtube'
  ) {
    return 'Entertainment Subscriptions';
  }
  if (
    lower === 'aws' ||
    lower === 'azure' ||
    lower === 'cloud' ||
    lower === 'software' ||
    lower === 'saas' ||
    lower === 'medium'
  ) {
    return 'Cloud & Software Services';
  }
  if (lower === 'shop' || lower === 'retail') return 'Shopping';
  if (lower === 'dining' || lower === 'restaurant' || lower === 'cafe' || lower === 'food') {
    return 'Restaurant & Dining';
  }
  if (lower === 'zomato' || lower === 'swiggy' || lower === 'food delivery' || lower === 'online food') {
    return 'Online Food Order';
  }
  if (lower === 'medical' || lower === 'healthcare' || lower === 'pharmacy' || lower === 'medicine') {
    return 'Medical & Healthcare';
  }

  // 3. Otherwise, capitalize to Title Case to prevent duplicates like "travel" vs "Travel"
  return trimmed
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
