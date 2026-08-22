import { PaymentMappingRule, PaymentMethod } from '../db/transaction-repository';

/**
 * Domain Service responsible for matching raw payment method strings against
 * user-configured mapping rules and payment methods.
 * Pure business logic decoupled from data access infrastructure.
 */
export class PaymentStandardizationService {
  /**
   * Evaluates a raw payment method string against user mapping rules and payment methods.
   */
  static standardize(
    rawPaymentMethod: string | undefined,
    rules: PaymentMappingRule[],
    methods: PaymentMethod[]
  ): string {
    if (!rawPaymentMethod || rawPaymentMethod.trim() === '' || rawPaymentMethod === 'Unknown' || rawPaymentMethod === 'N/A') {
      return 'Unknown';
    }

    const trimmedRaw = rawPaymentMethod.trim();
    const lowerRaw = trimmedRaw.toLowerCase();

    // 1. Evaluate user mapping rules (supports +, & or , for AND combinations)
    let bestRule: PaymentMappingRule | null = null;
    let maxPartsCount = 0;
    let bestPatternLength = 0;

    for (const rule of rules) {
      if (rule.aliasPattern) {
        const parts = rule.aliasPattern.split(/[+&,]/).map((p: string) => p.trim().toLowerCase()).filter(Boolean);
        if (parts.length > 0) {
          const allMatch = parts.every((part: string) => lowerRaw.includes(part));
          if (allMatch) {
            const partsCount = parts.length;
            const patternLength = rule.aliasPattern.length;
            // Pick rule with more parts, or tie-break on pattern length
            if (partsCount > maxPartsCount || (partsCount === maxPartsCount && patternLength > bestPatternLength)) {
              bestRule = rule;
              maxPartsCount = partsCount;
              bestPatternLength = patternLength;
            }
          }
        }
      }
    }

    if (bestRule) {
      return bestRule.paymentMethodName || 'Unknown';
    }

    // 2. If no rule matches, check if it matches any standardized method name exactly (case-insensitive)
    const exactMatch = methods.find(m => m.name.toLowerCase() === lowerRaw);
    if (exactMatch) {
      return exactMatch.name;
    }

    // 3. Fallback: check if any standardized method name is contained in the raw string
    const partialMatch = methods.find(m => lowerRaw.includes(m.name.toLowerCase()));
    if (partialMatch) {
      return partialMatch.name;
    }

    return trimmedRaw; // Fallback to raw if no match
  }
}
