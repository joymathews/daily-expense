import React, { useState } from 'react';

interface SpendCalendarProps {
  /** Map of "YYYY-MM-DD" → total spend amount for that day */
  dailySpendMap: Record<string, number>;
  /** Today's date as "YYYY-MM-DD" */
  today: string;
  /** Called when the user clicks a day cell; receives the date string "YYYY-MM-DD" */
  onDayClick?: (dateKey: string) => void;
  /** Called when the visible month changes; receives year and 0-indexed month */
  onMonthChange?: (year: number, month: number) => void;
}

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function resolveHeatClass(amount: number, maxAmount: number): string {
  if (amount <= 0 || maxAmount <= 0) return 'bg-gray-50 border-gray-100';
  const ratio = amount / maxAmount;
  if (ratio <= 0.25) return 'bg-indigo-100 border-indigo-200';
  if (ratio <= 0.50) return 'bg-indigo-200 border-indigo-300';
  if (ratio <= 0.75) return 'bg-indigo-300 border-indigo-400';
  return 'bg-indigo-500 border-indigo-600';
}

function resolveAmountTextClass(amount: number, maxAmount: number): string {
  if (amount <= 0 || maxAmount <= 0) return 'text-gray-300';
  const ratio = amount / maxAmount;
  if (ratio <= 0.50) return 'text-indigo-600';
  return 'text-white';
}

function buildCalendarGrid(year: number, month: number): (number | null)[] {
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const grid: (number | null)[] = Array(firstDayOfWeek).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    grid.push(day);
  }
  return grid;
}

const SpendCalendar: React.FC<SpendCalendarProps> = ({ dailySpendMap, today, onDayClick, onMonthChange }) => {
  const todayParts = today.split('-').map(Number);
  const [calYear, setCalYear] = useState(todayParts[0]);
  const [calMonth, setCalMonth] = useState(todayParts[1] - 1); // 0-indexed

  const navigateToPreviousMonth = () => {
    let nextY = calYear;
    let nextM = calMonth;
    if (calMonth === 0) {
      nextY = calYear - 1;
      nextM = 11;
    } else {
      nextM = calMonth - 1;
    }
    setCalYear(nextY);
    setCalMonth(nextM);
    onMonthChange?.(nextY, nextM);
  };

  const navigateToNextMonth = () => {
    let nextY = calYear;
    let nextM = calMonth;
    if (calMonth === 11) {
      nextY = calYear + 1;
      nextM = 0;
    } else {
      nextM = calMonth + 1;
    }
    setCalYear(nextY);
    setCalMonth(nextM);
    onMonthChange?.(nextY, nextM);
  };

  const grid = buildCalendarGrid(calYear, calMonth);

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const monthlyMaxSpend = (() => {
    let max = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const key = formatDateKey(calYear, calMonth, day);
      const amount = dailySpendMap[key] ?? 0;
      if (amount > max) max = amount;
    }
    return max;
  })();

  const [hoveredDay, setHoveredDay] = useState<number | null>(null);

  const isCurrentMonthDisplayed =
    calYear === todayParts[0] && calMonth === todayParts[1] - 1;
  const todayDay = todayParts[2];

  return (
    <div className="w-full">
      {/* Month Navigation Header */}
      <div className="flex items-center justify-between mb-4">
        <button
          id="spend-calendar-prev-month"
          aria-label="Previous month"
          onClick={navigateToPreviousMonth}
          className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors duration-150"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <span className="text-xs font-black text-gray-700 uppercase tracking-widest">
          {MONTH_NAMES[calMonth]} {calYear}
        </span>

        <button
          id="spend-calendar-next-month"
          aria-label="Next month"
          onClick={navigateToNextMonth}
          className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors duration-150"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAY_HEADERS.map(header => (
          <div
            key={header}
            className="text-center text-[9px] font-black text-gray-400 uppercase tracking-widest py-1"
          >
            {header}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {grid.map((day, cellIndex) => {
          if (day === null) {
            return <div key={`empty-${cellIndex}`} className="h-14 rounded-lg" />;
          }

          const dateKey = formatDateKey(calYear, calMonth, day);
          const amount = dailySpendMap[dateKey] ?? 0;
          const isFutureDay = isCurrentMonthDisplayed && day > todayDay;
          const isToday = isCurrentMonthDisplayed && day === todayDay;

          const heatClass = isFutureDay
            ? 'bg-gray-50 border-gray-100'
            : resolveHeatClass(amount, monthlyMaxSpend);

          const amountTextClass = isFutureDay
            ? 'text-gray-200'
            : resolveAmountTextClass(amount, monthlyMaxSpend);

          const dayNumberClass = isFutureDay
            ? 'text-gray-300'
            : amount > 0 && monthlyMaxSpend > 0 && amount / monthlyMaxSpend > 0.5
              ? 'text-white/80'
              : 'text-gray-500';

          const isClickable = !!onDayClick && !isFutureDay;

          return (
            <div
              key={dateKey}
              data-testid={`calendar-day-${dateKey}`}
              className={[
                'relative h-14 rounded-lg border flex flex-col items-center justify-center',
                'transition-all duration-150 hover:scale-105 hover:shadow-md hover:z-10',
                isClickable ? 'cursor-pointer' : 'cursor-default',
                heatClass,
                isToday ? 'ring-2 ring-indigo-500 ring-offset-1' : '',
              ].join(' ')}
              onMouseEnter={() => setHoveredDay(day)}
              onMouseLeave={() => setHoveredDay(null)}
              onClick={() => isClickable && onDayClick(dateKey)}
            >
              {/* Day number */}
              <span className={`text-[10px] font-black leading-none mb-0.5 ${dayNumberClass}`}>
                {day}
              </span>

              {/* Amount label */}
              {amount > 0 && !isFutureDay && (
                <span className={`text-[9px] font-bold leading-none ${amountTextClass}`}>
                  {amount >= 1000 ? `₹${(amount / 1000).toFixed(1)}k` : `₹${amount.toFixed(0)}`}
                </span>
              )}

              {/* Hover Tooltip */}
              {hoveredDay === day && (
                <div
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20
                             bg-slate-900 text-white text-[10px] font-bold rounded-lg
                             px-2.5 py-1.5 shadow-xl border border-slate-800
                             pointer-events-none whitespace-nowrap flex flex-col items-center"
                >
                  <span className="text-slate-400 text-[8px] font-semibold">
                    {String(day).padStart(2, '0')}/{String(calMonth + 1).padStart(2, '0')}/{calYear}
                  </span>
                  <span className={isFutureDay ? 'text-gray-400' : 'text-indigo-300 font-extrabold mt-0.5'}>
                    {isFutureDay ? 'Future date' : amount > 0 ? `₹${amount.toFixed(2)}` : 'No spend'}
                  </span>
                  {/* Tooltip arrow */}
                  <div className="w-1.5 h-1.5 bg-slate-900 rotate-45 absolute -bottom-[3px] left-1/2 -translate-x-1/2 border-r border-b border-slate-800" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Heat legend */}
      <div className="flex items-center justify-end gap-2 mt-3">
        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Less</span>
        <div className="flex gap-0.5">
          {['bg-gray-100', 'bg-indigo-100', 'bg-indigo-200', 'bg-indigo-300', 'bg-indigo-500'].map((cls, i) => (
            <div key={i} className={`w-3 h-3 rounded-sm ${cls}`} />
          ))}
        </div>
        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">More</span>
      </div>
    </div>
  );
};

export default SpendCalendar;
