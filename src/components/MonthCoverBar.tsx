import React, { useMemo } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import type { LedgerMode, LedgerRow } from '../types/tax';
import {
  FILING_MONTHS,
  MONTH_SHORT_LABELS,
  getRowFilingMonth,
  getRowFilingYear,
  type FilingMonth,
} from '../utils/taxEngine';

interface MonthCoverBarProps {
  mode: LedgerMode;
  monthCover: string;
  yearCover: string;
  availableYears: string[];
  modeRows: LedgerRow[];
  otherModeRows: LedgerRow[];
  onChangeMonthCover: (month: string) => void;
  onChangeYearCover: (year: string) => void;
}

export const MonthCoverBar: React.FC<MonthCoverBarProps> = ({
  mode,
  monthCover,
  yearCover,
  availableYears,
  modeRows,
  otherModeRows,
  onChangeMonthCover,
  onChangeYearCover,
}) => {
  const monthCounts = useMemo(() => {
    const counts = new Map<string, { active: number; other: number }>();
    FILING_MONTHS.forEach((m) => counts.set(m, { active: 0, other: 0 }));

    const matchesYear = (r: LedgerRow) => {
      if (yearCover === 'ALL') return true;
      const ry = getRowFilingYear(r);
      return !ry || ry === yearCover;
    };

    modeRows.forEach((r) => {
      if (!matchesYear(r)) return;
      const m = getRowFilingMonth(r);
      const entry = counts.get(m);
      if (entry) entry.active += 1;
    });

    otherModeRows.forEach((r) => {
      if (!matchesYear(r)) return;
      const m = getRowFilingMonth(r);
      const entry = counts.get(m);
      if (entry) entry.other += 1;
    });

    return counts;
  }, [modeRows, otherModeRows, yearCover]);

  const yearTotalActive = useMemo(() => {
    let sum = 0;
    monthCounts.forEach((v) => {
      sum += v.active;
    });
    return sum;
  }, [monthCounts]);

  const stepMonth = (delta: -1 | 1) => {
    if (monthCover === 'ALL') {
      onChangeMonthCover(delta > 0 ? FILING_MONTHS[0] : FILING_MONTHS[11]);
      return;
    }
    const idx = FILING_MONTHS.indexOf(monthCover as FilingMonth);
    if (idx < 0) {
      onChangeMonthCover(FILING_MONTHS[0]);
      return;
    }
    const nextIdx = (idx + delta + 12) % 12;
    onChangeMonthCover(FILING_MONTHS[nextIdx]);
  };

  const coverLabel =
    monthCover === 'ALL'
      ? yearCover === 'ALL'
        ? 'ALL MONTHS & YEARS'
        : `ALL MONTHS · ${yearCover}`
      : yearCover === 'ALL'
      ? `${monthCover} · ALL YEARS`
      : `${monthCover} ${yearCover}`;

  return (
    <div className="rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl px-4 py-2.5 shadow-[0_6px_22px_-12px_rgba(11,77,162,0.1)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Month Cover Label & Year Selector */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
            <Calendar className="h-3.5 w-3.5 text-[#0B4DA2]" />
            <span>Month Cover</span>
          </div>

          <select
            value={yearCover}
            onChange={(e) => onChangeYearCover(e.target.value)}
            aria-label="Select filing year"
            className="rounded-xl border border-slate-300/80 bg-white/85 px-2.5 py-1 text-xs font-semibold tabular-nums-mono text-slate-800 focus:border-[#0B4DA2] focus:outline-none cursor-pointer"
          >
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
            <option value="ALL">All Years</option>
          </select>

          <div className="inline-flex items-center rounded-xl border border-slate-200/90 bg-[#F4F8FD] p-0.5">
            <button
              type="button"
              onClick={() => stepMonth(-1)}
              title="Previous month"
              aria-label="Previous month"
              className="rounded-lg p-1 text-slate-600 hover:bg-white hover:text-[#0B4DA2] cursor-pointer"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => stepMonth(1)}
              title="Next month"
              aria-label="Next month"
              className="rounded-lg p-1 text-slate-600 hover:bg-white hover:text-[#0B4DA2] cursor-pointer"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Center: 12-Month Strip + All */}
        <div className="flex flex-wrap items-center gap-1 flex-1 min-w-[260px]">
          <button
            type="button"
            onClick={() => onChangeMonthCover('ALL')}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              monthCover === 'ALL'
                ? 'bg-[#18181B] text-white'
                : 'bg-[#F4F8FD] text-slate-700 hover:bg-[#E7F0FC] hover:text-[#0B4DA2]'
            }`}
          >
            ALL ({yearTotalActive})
          </button>

          {FILING_MONTHS.map((m) => {
            const count = monthCounts.get(m) ?? { active: 0, other: 0 };
            const isSelected = monthCover === m;
            const hasRows = count.active > 0;
            const hasOther = count.other > 0;

            return (
              <button
                key={m}
                type="button"
                onClick={() => onChangeMonthCover(m)}
                title={`${m}${yearCover !== 'ALL' ? ` ${yearCover}` : ''}: ${count.active} ${mode === 'SALES' ? 'SALES' : 'EXPENSES'} rows, ${count.other} ${mode === 'SALES' ? 'EXPENSES' : 'SALES'} rows`}
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-[#0B4DA2] text-white shadow-xs'
                    : hasRows
                    ? 'bg-[#E7F0FC] text-[#0B4DA2] hover:bg-[#D7E7FA]'
                    : hasOther
                    ? 'bg-slate-100/80 text-slate-600 hover:bg-slate-200/70'
                    : 'text-slate-400 hover:bg-slate-100/70 hover:text-slate-700'
                }`}
              >
                <span>{MONTH_SHORT_LABELS[m]}</span>
                {hasRows && (
                  <span
                    className={`rounded px-1 text-[10px] tabular-nums-mono ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-white/90 text-[#0B4DA2]'
                    }`}
                  >
                    {count.active}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right: Active Cover Readout */}
        <div className="hidden lg:flex items-center gap-2 shrink-0 text-[11px] font-semibold text-slate-600">
          <span className="rounded-lg bg-[#F4F8FD] px-2.5 py-1 text-[#0B4DA2]">
            Covering: {coverLabel}
          </span>
        </div>
      </div>
    </div>
  );
};
