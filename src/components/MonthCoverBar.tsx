import React, { useMemo, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
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
  onAddYear?: (year: string) => void;
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
  onAddYear,
}) => {
  const [addingYear, setAddingYear] = useState(false);
  const [newYearInput, setNewYearInput] = useState('');

  const handleConfirmAddYear = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newYearInput.replace(/\D/g, '').slice(0, 4);
    if (!/^\d{4}$/.test(cleaned)) return;
    onAddYear?.(cleaned);
    onChangeYearCover(cleaned);
    setNewYearInput('');
    setAddingYear(false);
  };
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Left: Month Cover Label & Year Selector */}
        <div className="flex flex-wrap items-start gap-2.5 shrink-0">
          <div className="inline-flex items-center gap-1.5 py-1 text-xs font-semibold leading-normal text-slate-800 whitespace-nowrap">
            <Calendar className="h-3.5 w-3.5 text-[#0B4DA2] shrink-0" />
            <span>Month Cover</span>
          </div>

          <div className="flex flex-col items-start gap-1.5">
            <div className="flex items-center gap-2">
              <select
                value={yearCover}
                onChange={(e) => {
                  if (e.target.value === '__ADD_YEAR__') {
                    setAddingYear(true);
                    return;
                  }
                  onChangeYearCover(e.target.value);
                }}
                aria-label="Select filing year"
                className="rounded-xl border border-slate-300/80 bg-white/85 px-2.5 py-1 text-xs font-semibold leading-normal tabular-nums-mono text-slate-800 focus:border-[#0B4DA2] focus:outline-none cursor-pointer"
              >
                {availableYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
                <option value="ALL">All Years</option>
                {onAddYear && <option value="__ADD_YEAR__">+ Add Year...</option>}
              </select>

              <div className="inline-flex items-center rounded-xl border border-slate-200/90 bg-[#F4F8FD] p-0.5">
                <button
                  type="button"
                  onClick={() => stepMonth(-1)}
                  title="Previous month"
                  aria-label="Previous month"
                  className="inline-flex items-center justify-center rounded-lg p-1 text-slate-600 hover:bg-white hover:text-[#0B4DA2] cursor-pointer"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => stepMonth(1)}
                  title="Next month"
                  aria-label="Next month"
                  className="inline-flex items-center justify-center rounded-lg p-1 text-slate-600 hover:bg-white hover:text-[#0B4DA2] cursor-pointer"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {onAddYear && (
              <div className="flex items-center gap-1.5">
                {addingYear ? (
                  <form onSubmit={handleConfirmAddYear} className="flex items-center gap-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      autoFocus
                      value={newYearInput}
                      onChange={(e) => setNewYearInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="2031"
                      aria-label="New filing year"
                      className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold leading-normal tabular-nums-mono text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={!/^\d{4}$/.test(newYearInput)}
                      className="inline-flex items-center justify-center rounded-lg bg-[#0B4DA2] px-2 py-0.5 text-[11px] font-semibold leading-normal text-white hover:bg-[#093D82] disabled:opacity-40 cursor-pointer"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddingYear(false);
                        setNewYearInput('');
                      }}
                      className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium leading-normal text-slate-600 hover:bg-slate-50 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingYear(true)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200/90 bg-white/90 px-2 py-0.5 text-[11px] font-semibold leading-normal text-[#0B4DA2] hover:bg-[#E7F0FC] transition-colors cursor-pointer"
                  >
                    <Plus className="h-3 w-3 shrink-0" />
                    <span>Add Year</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Center: 12-Month Strip + All */}
        <div className="flex flex-wrap items-center gap-1 w-full sm:w-auto sm:flex-1 min-w-0">
          <button
            type="button"
            onClick={() => onChangeMonthCover('ALL')}
            className={`inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-[11px] font-semibold leading-normal transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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
                className={`inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold leading-normal transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isSelected
                    ? 'border-[#0B4DA2] bg-[#0B4DA2] text-white shadow-xs'
                    : hasRows
                    ? 'border-[#C5DAF5] bg-[#E7F0FC] text-[#0B4DA2] hover:bg-[#D7E7FA]'
                    : hasOther
                    ? 'border-slate-200 bg-slate-100/90 text-slate-700 hover:border-[#0B4DA2]/35 hover:bg-[#E7F0FC] hover:text-[#0B4DA2]'
                    : 'border-slate-200/80 bg-white/90 text-slate-700 hover:border-[#0B4DA2]/40 hover:bg-[#E7F0FC] hover:text-[#0B4DA2]'
                }`}
              >
                <span>{MONTH_SHORT_LABELS[m]}</span>
                {hasRows && (
                  <span
                    className={`inline-flex items-center justify-center rounded px-1 py-0.2 text-[10px] leading-normal tabular-nums-mono ${
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
          <span className="inline-flex items-center rounded-lg bg-[#F4F8FD] px-2.5 py-1 leading-normal text-[#0B4DA2] whitespace-nowrap">
            Covering: {coverLabel}
          </span>
        </div>
      </div>
    </div>
  );
};
