import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  ClipboardCopy,
  Download,
  FileSpreadsheet,
  Layers,
  Loader2,
  X,
} from 'lucide-react';
import type { LedgerMode, LedgerRow } from '../types/tax';
import {
  FILING_MONTHS,
  MONTH_SHORT_LABELS,
  formatAccounting,
  getRowFilingMonth,
  getRowFilingYear,
  round2,
  type FilingMonth,
} from '../utils/taxEngine';

export type ExportFormat = 'XLSX' | 'CSV' | 'COPY_SHEETS';
export type ExportLedgerScope = 'CONSOLIDATED' | 'SALES' | 'PURCHASES';

export interface ExportClientOption {
  id: string;
  companyName: string;
}

interface ExportMonthModalProps {
  isOpen: boolean;
  initialFormat: ExportFormat;
  initialMode: LedgerMode;
  initialScope?: ExportLedgerScope;
  activeMonthCover: string;
  activeYearCover: string;
  initialQuarter?: 1 | 2 | 3 | 4;
  availableYears: string[];
  clientSlug: string;
  clientName: string;
  clientOptions?: ExportClientOption[];
  selectedClientId?: string;
  onChangeClient?: (clientId: string) => void;
  loadingClientData?: boolean;
  salesRows: LedgerRow[];
  purchasesRows: LedgerRow[];
  onClose: () => void;
  onExecuteExport: (params: {
    format: ExportFormat;
    scope: ExportLedgerScope;
    salesRows: LedgerRow[];
    purchasesRows: LedgerRow[];
    periodLabel: string;
    filenameTag: string;
  }) => Promise<void> | void;
}

const QUARTERS: { num: 1 | 2 | 3 | 4; short: string; label: string; months: FilingMonth[] }[] = [
  { num: 1, short: 'Q1', label: 'Q1 (Jan–Mar)', months: ['JANUARY', 'FEBRUARY', 'MARCH'] },
  { num: 2, short: 'Q2', label: 'Q2 (Apr–Jun)', months: ['APRIL', 'MAY', 'JUNE'] },
  { num: 3, short: 'Q3', label: 'Q3 (Jul–Sep)', months: ['JULY', 'AUGUST', 'SEPTEMBER'] },
  { num: 4, short: 'Q4', label: 'Q4 (Oct–Dec)', months: ['OCTOBER', 'NOVEMBER', 'DECEMBER'] },
];

export const ExportMonthModal: React.FC<ExportMonthModalProps> = ({
  isOpen,
  initialFormat,
  initialMode,
  initialScope,
  activeMonthCover,
  activeYearCover,
  initialQuarter,
  availableYears,
  clientSlug,
  clientName,
  clientOptions,
  selectedClientId,
  onChangeClient,
  loadingClientData = false,
  salesRows,
  purchasesRows,
  onClose,
  onExecuteExport,
}) => {
  const resolvedDefaultScope: ExportLedgerScope =
    initialScope ?? (initialFormat === 'XLSX' ? 'CONSOLIDATED' : initialMode);

  const [format, setFormat] = useState<ExportFormat>(
    resolvedDefaultScope === 'CONSOLIDATED' ? 'XLSX' : initialFormat
  );
  const [exportScope, setExportScope] = useState<ExportLedgerScope>(resolvedDefaultScope);
  const [yearFilter, setYearFilter] = useState<string>(activeYearCover);
  const [allMonthsMode, setAllMonthsMode] = useState<boolean>(activeMonthCover === 'ALL');
  const [multiSelect, setMultiSelect] = useState<boolean>(Boolean(initialQuarter));
  const [selectedMonths, setSelectedMonths] = useState<FilingMonth[]>(() => {
    if (initialQuarter) {
      return QUARTERS.find((q) => q.num === initialQuarter)?.months ?? [...FILING_MONTHS];
    }
    return activeMonthCover !== 'ALL' && FILING_MONTHS.includes(activeMonthCover as FilingMonth)
      ? [activeMonthCover as FilingMonth]
      : [...FILING_MONTHS];
  });

  useEffect(() => {
    if (!isOpen) return;
    const nextScope: ExportLedgerScope =
      initialScope ?? (initialFormat === 'XLSX' ? 'CONSOLIDATED' : initialMode);
    setExportScope(nextScope);
    setFormat(nextScope === 'CONSOLIDATED' ? 'XLSX' : initialFormat);
    setYearFilter(activeYearCover);

    if (initialQuarter) {
      const qMonths = QUARTERS.find((q) => q.num === initialQuarter)?.months;
      if (qMonths) {
        setAllMonthsMode(false);
        setMultiSelect(true);
        setSelectedMonths(qMonths);
        return;
      }
    }

    setMultiSelect(false);
    if (activeMonthCover === 'ALL' || !FILING_MONTHS.includes(activeMonthCover as FilingMonth)) {
      setAllMonthsMode(true);
      setSelectedMonths([...FILING_MONTHS]);
    } else {
      setAllMonthsMode(false);
      setSelectedMonths([activeMonthCover as FilingMonth]);
    }
  }, [isOpen, initialFormat, initialMode, initialScope, activeMonthCover, activeYearCover, initialQuarter]);

  const filterRowsByYear = (rows: LedgerRow[]) => {
    if (yearFilter === 'ALL') return rows;
    return rows.filter((r) => {
      const ry = getRowFilingYear(r);
      return !ry || ry === yearFilter;
    });
  };

  const yearFilteredSales = useMemo(
    () => filterRowsByYear(salesRows),
    [salesRows, yearFilter]
  );
  const yearFilteredPurchases = useMemo(
    () => filterRowsByYear(purchasesRows),
    [purchasesRows, yearFilter]
  );

  const monthStats = useMemo(() => {
    const map = new Map<
      FilingMonth,
      { salesCount: number; purchasesCount: number; salesTotal: number; purchasesTotal: number }
    >();
    FILING_MONTHS.forEach((m) =>
      map.set(m, { salesCount: 0, purchasesCount: 0, salesTotal: 0, purchasesTotal: 0 })
    );

    yearFilteredSales.forEach((r) => {
      const m = getRowFilingMonth(r) as FilingMonth;
      const cur = map.get(m);
      if (cur) {
        cur.salesCount += 1;
        cur.salesTotal = round2(cur.salesTotal + (r.total ?? 0));
      }
    });

    yearFilteredPurchases.forEach((r) => {
      const m = getRowFilingMonth(r) as FilingMonth;
      const cur = map.get(m);
      if (cur) {
        cur.purchasesCount += 1;
        cur.purchasesTotal = round2(cur.purchasesTotal + (r.total ?? 0));
      }
    });

    return map;
  }, [yearFilteredSales, yearFilteredPurchases]);

  const matchingSalesRows = useMemo(() => {
    if (exportScope === 'PURCHASES') return [];
    if (allMonthsMode) return yearFilteredSales;
    const allowed = new Set<string>(selectedMonths);
    return yearFilteredSales.filter((r) => allowed.has(getRowFilingMonth(r)));
  }, [exportScope, yearFilteredSales, allMonthsMode, selectedMonths]);

  const matchingPurchasesRows = useMemo(() => {
    if (exportScope === 'SALES') return [];
    if (allMonthsMode) return yearFilteredPurchases;
    const allowed = new Set<string>(selectedMonths);
    return yearFilteredPurchases.filter((r) => allowed.has(getRowFilingMonth(r)));
  }, [exportScope, yearFilteredPurchases, allMonthsMode, selectedMonths]);

  const matchingTotalRowsCount = matchingSalesRows.length + matchingPurchasesRows.length;

  const matchingSalesTotal = useMemo(
    () => round2(matchingSalesRows.reduce((s, r) => s + (r.total ?? 0), 0)),
    [matchingSalesRows]
  );
  const matchingPurchasesTotal = useMemo(
    () => round2(matchingPurchasesRows.reduce((s, r) => s + (r.total ?? 0), 0)),
    [matchingPurchasesRows]
  );

  const matchedQuarter = useMemo(() => {
    if (allMonthsMode || selectedMonths.length !== 3) return null;
    return QUARTERS.find((q) => q.months.every((m) => selectedMonths.includes(m))) ?? null;
  }, [allMonthsMode, selectedMonths]);

  const periodSummary = useMemo(() => {
    const yearSuffix = yearFilter === 'ALL' ? 'ALL_YEARS' : yearFilter;
    if (allMonthsMode || selectedMonths.length === 12) {
      return {
        label: yearFilter === 'ALL' ? 'ALL MONTHS & YEARS' : `ALL MONTHS ${yearFilter}`,
        tag: `ALL_MONTHS_${yearSuffix}`,
      };
    }
    if (selectedMonths.length === 0) {
      return {
        label: 'No month selected',
        tag: yearSuffix,
      };
    }
    if (matchedQuarter) {
      return {
        label:
          yearFilter === 'ALL'
            ? matchedQuarter.label
            : `${matchedQuarter.label} ${yearFilter}`,
        tag: `${matchedQuarter.short}_${yearSuffix}`,
      };
    }
    if (selectedMonths.length === 1) {
      const m = selectedMonths[0];
      return {
        label: yearFilter === 'ALL' ? m : `${m} ${yearFilter}`,
        tag: `${m}_${yearSuffix}`,
      };
    }
    const ordered = FILING_MONTHS.filter((m) => selectedMonths.includes(m));
    const shortList = ordered.map((m) => MONTH_SHORT_LABELS[m]).join('-');
    return {
      label: `${ordered.map((m) => MONTH_SHORT_LABELS[m]).join(', ')}${yearFilter !== 'ALL' ? ` ${yearFilter}` : ''}`,
      tag: `${shortList}_${yearSuffix}`,
    };
  }, [allMonthsMode, selectedMonths, yearFilter, matchedQuarter]);

  if (!isOpen) return null;

  const handleClickMonth = (m: FilingMonth) => {
    setAllMonthsMode(false);
    if (!multiSelect) {
      setSelectedMonths([m]);
      return;
    }
    setSelectedMonths((prev) =>
      prev.includes(m) ? prev.filter((item) => item !== m) : [...prev, m]
    );
  };

  const handleSelectAllMonths = () => {
    setAllMonthsMode(true);
    setSelectedMonths([...FILING_MONTHS]);
  };

  const handleSelectQuarter = (months: FilingMonth[]) => {
    setAllMonthsMode(false);
    setMultiSelect(true);
    setSelectedMonths(months);
  };

  const handleSelectScope = (scope: ExportLedgerScope) => {
    setExportScope(scope);
    if (scope === 'CONSOLIDATED') {
      setFormat('XLSX');
    }
  };

  const handleSelectFormat = (nextFormat: ExportFormat) => {
    setFormat(nextFormat);
    if (nextFormat !== 'XLSX' && exportScope === 'CONSOLIDATED') {
      setExportScope('SALES');
    }
  };

  const fileExtension = format === 'XLSX' ? 'xlsx' : format === 'CSV' ? 'csv' : null;
  const scopeFilenamePart =
    exportScope === 'CONSOLIDATED' ? 'SALES_AND_PURCHASES' : exportScope;
  const previewFilename = fileExtension
    ? `${clientSlug ? `${clientSlug}_` : ''}FORMAT_FOR_FILING_${scopeFilenamePart}_${periodSummary.tag}.${fileExtension}`
    : null;

  const handleSubmit = async () => {
    if (matchingTotalRowsCount === 0 || loadingClientData) return;
    await onExecuteExport({
      format,
      scope: exportScope,
      salesRows: matchingSalesRows,
      purchasesRows: matchingPurchasesRows,
      periodLabel: periodSummary.label,
      filenameTag: periodSummary.tag,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-xs">
      <div className="w-full max-w-3xl rounded-[24px] border-2 border-white bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200/80 px-5 py-4">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#0B4DA2] text-white">
              <Calendar className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-sm font-semibold leading-snug text-slate-900">
                Choose Month or Quarter to Export
              </h2>
              <p className="text-[11px] leading-normal text-slate-500 break-words">
                {clientName} · Export consolidated Sales &amp; Purchases (separate sheets) or individual ledgers
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export modal"
            className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 space-y-5">
          {clientOptions && clientOptions.length > 0 && onChangeClient && (
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide leading-normal text-slate-500 mb-1.5">
                Client Directory
              </label>
              <select
                value={selectedClientId ?? ''}
                onChange={(e) => onChangeClient(e.target.value)}
                aria-label="Select client directory"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
              >
                {clientOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.companyName}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Format, Sheet Mode & Year Row */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 items-end">
            <div className="sm:col-span-5">
              <label className="block text-[11px] font-semibold uppercase tracking-wide leading-normal text-slate-500 mb-1.5">
                Export Format
              </label>
              <div className="grid grid-cols-3 rounded-xl border border-slate-200 bg-[#F4F8FD] p-0.5">
                <button
                  type="button"
                  onClick={() => handleSelectFormat('XLSX')}
                  className={`inline-flex items-center justify-center rounded-lg px-2 py-1.5 text-xs font-semibold leading-normal whitespace-nowrap transition-colors cursor-pointer ${
                    format === 'XLSX'
                      ? 'bg-[#18181B] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  .xlsx Sheets
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectFormat('CSV')}
                  className={`inline-flex items-center justify-center rounded-lg px-2 py-1.5 text-xs font-semibold leading-normal whitespace-nowrap transition-colors cursor-pointer ${
                    format === 'CSV'
                      ? 'bg-[#18181B] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  .csv Filing
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectFormat('COPY_SHEETS')}
                  className={`inline-flex items-center justify-center rounded-lg px-2 py-1.5 text-xs font-semibold leading-normal whitespace-nowrap transition-colors cursor-pointer ${
                    format === 'COPY_SHEETS'
                      ? 'bg-[#18181B] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Copy Table
                </button>
              </div>
            </div>

            <div className="sm:col-span-5">
              <label className="block text-[11px] font-semibold uppercase tracking-wide leading-normal text-slate-500 mb-1.5">
                Workbook Sheets
              </label>
              <div className="grid grid-cols-3 rounded-xl border border-slate-200 bg-[#F4F8FD] p-0.5">
                <button
                  type="button"
                  onClick={() => handleSelectScope('CONSOLIDATED')}
                  title="One .xlsx file with SALES and PURCHASES on separate sheets"
                  className={`inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold leading-normal whitespace-nowrap transition-colors cursor-pointer ${
                    exportScope === 'CONSOLIDATED'
                      ? 'bg-[#0B4DA2] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Layers className="h-3 w-3 shrink-0" />
                  <span>Both (2 Sheets)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectScope('SALES')}
                  className={`inline-flex items-center justify-center rounded-lg px-2 py-1.5 text-xs font-semibold leading-normal whitespace-nowrap transition-colors cursor-pointer ${
                    exportScope === 'SALES'
                      ? 'bg-[#0B4DA2] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  SALES ({salesRows.length})
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectScope('PURCHASES')}
                  className={`inline-flex items-center justify-center rounded-lg px-2 py-1.5 text-xs font-semibold leading-normal whitespace-nowrap transition-colors cursor-pointer ${
                    exportScope === 'PURCHASES'
                      ? 'bg-[#0B4DA2] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  PURCHASES ({purchasesRows.length})
                </button>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wide leading-normal text-slate-500 mb-1.5">
                Year
              </label>
              <select
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
                aria-label="Export year"
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold leading-normal tabular-nums-mono text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                {availableYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
                <option value="ALL">All Years</option>
              </select>
            </div>
          </div>

          {loadingClientData ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-[#F4F8FD] py-10 text-xs font-medium text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin text-[#0B4DA2]" />
              Loading Sales &amp; Purchases ledger rows...
            </div>
          ) : (
            <>
              {/* Quick Month & Quarter Presets */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {activeMonthCover !== 'ALL' &&
                      FILING_MONTHS.includes(activeMonthCover as FilingMonth) && (
                        <button
                          type="button"
                          onClick={() => {
                            setAllMonthsMode(false);
                            setMultiSelect(false);
                            setSelectedMonths([activeMonthCover as FilingMonth]);
                          }}
                          className={`rounded-md border px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                            !allMonthsMode &&
                            selectedMonths.length === 1 &&
                            selectedMonths[0] === activeMonthCover
                              ? 'border-blue-600 bg-blue-50 text-blue-800'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          Current Cover ({MONTH_SHORT_LABELS[activeMonthCover as FilingMonth]})
                        </button>
                      )}

                    <button
                      type="button"
                      onClick={handleSelectAllMonths}
                      className={`rounded-md border px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                        allMonthsMode
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      All Months (
                      {exportScope === 'CONSOLIDATED'
                        ? yearFilteredSales.length + yearFilteredPurchases.length
                        : exportScope === 'SALES'
                        ? yearFilteredSales.length
                        : yearFilteredPurchases.length}
                      )
                    </button>

                    {QUARTERS.map((q) => {
                      const isQSelected =
                        !allMonthsMode &&
                        selectedMonths.length === 3 &&
                        q.months.every((m) => selectedMonths.includes(m));
                      return (
                        <button
                          key={q.label}
                          type="button"
                          onClick={() => handleSelectQuarter(q.months)}
                          className={`rounded-md border px-2 py-1 text-[11px] font-semibold cursor-pointer ${
                            isQSelected
                              ? 'border-[#0B4DA2] bg-[#E7F0FC] text-[#0B4DA2]'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {q.label}
                        </button>
                      );
                    })}
                  </div>

                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={multiSelect}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setMultiSelect(next);
                        if (!next && selectedMonths.length > 1) {
                          setAllMonthsMode(false);
                          setSelectedMonths([selectedMonths[0]]);
                        }
                      }}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                    />
                    Multi-month
                  </label>
                </div>

                {/* 12-Month Grid */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {FILING_MONTHS.map((m) => {
                    const stats = monthStats.get(m) ?? {
                      salesCount: 0,
                      purchasesCount: 0,
                      salesTotal: 0,
                      purchasesTotal: 0,
                    };
                    const rowCount =
                      exportScope === 'CONSOLIDATED'
                        ? stats.salesCount + stats.purchasesCount
                        : exportScope === 'SALES'
                        ? stats.salesCount
                        : stats.purchasesCount;
                    const displayTotal =
                      exportScope === 'CONSOLIDATED'
                        ? round2(stats.salesTotal + stats.purchasesTotal)
                        : exportScope === 'SALES'
                        ? stats.salesTotal
                        : stats.purchasesTotal;
                    const isSelected = allMonthsMode || selectedMonths.includes(m);
                    const hasRows = rowCount > 0;

                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleClickMonth(m)}
                        className={`flex flex-col items-start rounded-xl border p-2.5 text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'border-[#0B4DA2] bg-[#EBF3FC] ring-1 ring-[#0B4DA2]'
                            : hasRows
                            ? 'border-slate-200 bg-white hover:border-slate-300 hover:bg-[#F4F8FD]'
                            : 'border-slate-200/80 bg-slate-50/50 text-slate-400 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between gap-1 min-w-0">
                          <span
                            className={`text-xs font-bold leading-normal truncate ${
                              isSelected
                                ? 'text-[#0B4DA2]'
                                : hasRows
                                ? 'text-slate-900'
                                : 'text-slate-500'
                            }`}
                          >
                            {m}
                          </span>
                          {isSelected && (
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#0B4DA2] text-white">
                              <Check className="h-2.5 w-2.5" />
                            </span>
                          )}
                        </div>
                        {exportScope === 'CONSOLIDATED' ? (
                          <div className="mt-1 flex w-full items-baseline justify-between gap-1 text-[10px] leading-normal tabular-nums-mono">
                            <span className={hasRows ? 'font-semibold text-slate-700' : 'text-slate-400'}>
                              S:{stats.salesCount} · P:{stats.purchasesCount}
                            </span>
                            <span className="font-medium text-slate-600 break-all">
                              {displayTotal > 0 ? `₱${formatAccounting(displayTotal)}` : '-'}
                            </span>
                          </div>
                        ) : (
                          <div className="mt-1 flex flex-wrap w-full items-baseline justify-between gap-1 text-[11px] leading-normal">
                            <span
                              className={
                                hasRows ? 'font-semibold text-slate-700' : 'text-slate-400'
                              }
                            >
                              {rowCount} {rowCount === 1 ? 'row' : 'rows'}
                            </span>
                            <span className="tabular-nums-mono font-medium text-slate-600 break-all">
                              {displayTotal > 0 ? `₱${formatAccounting(displayTotal)}` : '-'}
                            </span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Export Preview Summary */}
              <div className="rounded-xl border border-slate-200 bg-[#F4F8FD] px-3.5 py-2.5 text-xs leading-normal space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 break-words">
                    {exportScope === 'CONSOLIDATED'
                      ? 'CONSOLIDATED (Sheet 1: SALES · Sheet 2: PURCHASES)'
                      : exportScope}{' '}
                    · {periodSummary.label}
                  </span>
                  <span className="tabular-nums-mono font-bold text-[#0B4DA2]">
                    {exportScope === 'CONSOLIDATED'
                      ? `Sales: ${matchingSalesRows.length} (₱${formatAccounting(matchingSalesTotal)}) · Purchases: ${matchingPurchasesRows.length} (₱${formatAccounting(matchingPurchasesTotal)})`
                      : `${matchingTotalRowsCount} ${matchingTotalRowsCount === 1 ? 'row' : 'rows'} · ₱${formatAccounting(
                          exportScope === 'SALES' ? matchingSalesTotal : matchingPurchasesTotal
                        )}`}
                  </span>
                </div>
                {previewFilename && (
                  <div className="text-[11px] leading-normal text-slate-500 break-all tabular-nums-mono">
                    File: {previewFilename}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 bg-[#F4F8FD]/70 px-5 py-3.5">
          <div className="text-[11px] text-slate-500">
            {loadingClientData
              ? 'Loading ledger entries...'
              : matchingTotalRowsCount === 0
              ? 'No transactions found for the selected month or quarter.'
              : exportScope === 'CONSOLIDATED'
              ? 'Exports 1 .xlsx workbook with SALES and PURCHASES on separate sheets.'
              : 'Ready to export with official BIR header layout.'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={matchingTotalRowsCount === 0 || loadingClientData}
              onClick={handleSubmit}
              className="inline-flex items-center gap-2 rounded-xl bg-[#18181B] px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 cursor-pointer"
            >
              {format === 'XLSX' ? (
                <FileSpreadsheet className="h-3.5 w-3.5" />
              ) : format === 'CSV' ? (
                <Download className="h-3.5 w-3.5" />
              ) : (
                <ClipboardCopy className="h-3.5 w-3.5" />
              )}
              {format === 'XLSX'
                ? exportScope === 'CONSOLIDATED'
                  ? `Export Consolidated .xlsx (${matchingTotalRowsCount})`
                  : `Export .xlsx (${matchingTotalRowsCount})`
                : format === 'CSV'
                ? `Export .csv (${matchingTotalRowsCount})`
                : `Copy for Sheets (${matchingTotalRowsCount})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
