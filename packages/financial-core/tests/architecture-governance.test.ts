import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import * as financialCore from '../src';

describe('Architectural Governance: Financial Core Domain Isolation [FUNC-ANALYSIS-21] [NFR-ARCH-3]', () => {
  const rootDir = path.resolve(__dirname, '../../..');
  const frontendPagesDir = path.join(rootDir, 'frontend', 'src', 'pages');
  const mobilePagesDir = path.join(rootDir, 'mobile-pwa', 'src', 'pages');

  const requiredCoreExports = [
    'calculateDiscretionarySpend',
    'calculateDaySpend',
    'calculateRunRateForecast',
    'calculateDailyAllowance',
    'calculateNetSavings',
    'filterActiveFixedCharges',
    'calculateTotalFixedCharges',
    'calculateCategorySpend',
    'getTopSpendingCategories',
    'calculateCurrencyTotals',
    'calculateCycleSpendTotal',
    'buildDailySpendMap',
    'buildDailyTransactionsMap',
    'calculateDailySpendSeries',
    'calculateTargetBudget',
    'calculateEffectiveBudgetLimit',
    'calculateBudgetPercentConsumed',
    'calculateAverageDailySpend',
    'calculatePeakAverages',
    'calculatePeakPercentDeviation',
    'getPeakPercentDeviationText',
    'orderDOMPeaksByBillingCycle',
    'getActiveCycleRange',
    'getExpectedCycleEnd',
    'filterTransactionsByCycle',
  ];

  it('exports all mandatory financial domain calculation contracts from @daily-expense/financial-core [FUNC-ANALYSIS-21]', () => {
    for (const exportName of requiredCoreExports) {
      expect((financialCore as Record<string, unknown>)[exportName], `Missing core export: ${exportName}`).toBeDefined();
      expect(typeof (financialCore as Record<string, unknown>)[exportName]).toBe('function');
    }
  });

  it('enforces that frontend and mobile UI layers do not define forbidden duplicate inline calculation functions [NFR-ARCH-3]', () => {
    const pageDirs = [frontendPagesDir, mobilePagesDir];
    const scannedFiles: string[] = [];

    for (const dir of pageDirs) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx') || (f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx')));

      for (const file of files) {
        const fullPath = path.join(dir, file);
        scannedFiles.push(fullPath);
        const content = fs.readFileSync(fullPath, 'utf8');

        for (const funcName of requiredCoreExports) {
          // Check for local re-declarations (e.g. `const calculateRunRateForecast = ` or `function calculateRunRateForecast`)
          const hasLocalDeclaration = new RegExp(`(const|let|var|function)\\s+${funcName}\\s*(=|\\()`).test(content);
          expect(
            hasLocalDeclaration,
            `Architectural violation in ${path.relative(rootDir, fullPath)}: Duplicate inline definition of '${funcName}' found. Must be imported from @daily-expense/financial-core.`
          ).toBe(false);
        }
      }
    }

    expect(scannedFiles.length).toBeGreaterThan(0);
  });

  it('enforces that mobile-pwa and frontend consumption imports use @daily-expense/financial-core or designated re-export utilities [FUNC-ANALYSIS-21] [NFR-ARCH-3]', () => {
    const summaryCompassPath = path.join(mobilePagesDir, 'SummaryCompass.tsx');
    const goldLedgerPath = path.join(mobilePagesDir, 'GoldLedger.tsx');

    if (fs.existsSync(summaryCompassPath)) {
      const content = fs.readFileSync(summaryCompassPath, 'utf8');
      expect(content).toContain("@daily-expense/financial-core");
    }

    if (fs.existsSync(goldLedgerPath)) {
      const content = fs.readFileSync(goldLedgerPath, 'utf8');
      expect(content).toContain("@daily-expense/financial-core");
    }
  });
});
