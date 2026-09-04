import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SpendCalendar from './spend-calendar';

describe('SpendCalendar Component [FUNC-DASH-CAL-1]', () => {
  const mockSpendMap = {
    '2026-07-05': 120000, // today (1200 INR)
    '2026-07-06': 50000,
    '2026-07-15': 300000, // max spend
    '2026-07-20': 0
  };

  it('renders correctly showing month name, year, and day grids', () => {
    render(
      <SpendCalendar
        dailySpendMap={mockSpendMap}
        today="2026-07-05"
      />
    );

    // Displays the correct initial month
    expect(screen.getByText('July 2026')).toBeInTheDocument();

    // Check calendar headers
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Sun')).toBeInTheDocument();

    // Verify day numbers are rendered (July has 31 days)
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('31')).toBeInTheDocument();
  });

  it('allows month navigation using next and previous buttons', () => {
    render(
      <SpendCalendar
        dailySpendMap={mockSpendMap}
        today="2026-07-05"
      />
    );

    expect(screen.getByText('July 2026')).toBeInTheDocument();

    // Click previous month
    const prevBtn = screen.getByRole('button', { name: /previous month/i });
    fireEvent.click(prevBtn);
    expect(screen.getByText('June 2026')).toBeInTheDocument();

    // Click next month twice to get to August
    const nextBtn = screen.getByRole('button', { name: /next month/i });
    fireEvent.click(nextBtn); // Back to July
    fireEvent.click(nextBtn); // August
    expect(screen.getByText('August 2026')).toBeInTheDocument();
  });

  it('triggers onDayClick callback when clicking on a day cell', () => {
    const handleDayClick = vi.fn();
    render(
      <SpendCalendar
        dailySpendMap={mockSpendMap}
        today="2026-07-05"
        onDayClick={handleDayClick}
      />
    );

    const day5Cell = screen.getByText('5');
    fireEvent.click(day5Cell);

    expect(handleDayClick).toHaveBeenCalledWith('2026-07-05');
  });

  it('highlights today with a rings indicator', () => {
    const { container } = render(
      <SpendCalendar
        dailySpendMap={mockSpendMap}
        today="2026-07-05"
      />
    );

    // Today is July 5th. Verify it has ring style
    const todayCell = container.querySelector('.ring-2.ring-indigo-500');
    expect(todayCell).toBeInTheDocument();
    expect(todayCell?.textContent).toContain('5');
  });

  /**
   * [FUNC-DASH-CAL-PERF-1] On-Demand Lazy Calendar Month Querying
   */
  it('triggers onMonthChange callback with next year and month indices on navigation [FUNC-DASH-CAL-PERF-1]', () => {
    const handleMonthChange = vi.fn();
    render(
      <SpendCalendar
        dailySpendMap={mockSpendMap}
        today="2026-07-05"
        onMonthChange={handleMonthChange}
      />
    );

    const prevBtn = screen.getByRole('button', { name: /previous month/i });
    fireEvent.click(prevBtn);

    // June 2026 (year: 2026, month: 5 (0-indexed))
    expect(handleMonthChange).toHaveBeenCalledWith(2026, 5);
  });
});

