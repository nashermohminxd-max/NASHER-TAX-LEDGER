import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import type { LedgerMode, LedgerRow } from '../types/tax';
import {
  FILING_MONTHS,
  MONTH_SHORT_LABELS,
  auditRow,
  computeLedgerTotals,
  formatAccounting,
  getRowFilingMonth,
  getRowTotalWithholding,
  round2,
  rowMatchesPeriod,
  sortMonthsChronologically,
  type FilingMonth,
} from '../utils/taxEngine';

interface AnalyticsDashboardProps {
  activeMode: LedgerMode;
  salesRows: LedgerRow[];
  purchasesRows: LedgerRow[];
  monthCover: string;
  yearCover: string;
  onSelectMonthCover?: (month: string) => void;
  onInspectFlaggedRows: (mode: LedgerMode) => void;
}

type AnalysisScope = 'SALES' | 'PURCHASES' | 'COMBINED';

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  activeMode,
  salesRows,
  purchasesRows,
  monthCover,
  yearCover,
  onSelectMonthCover,
  onInspectFlaggedRows,
}) => {
  const [scope, setScope] = useState<AnalysisScope>(activeMode);
  const [periodFilterMode, setPeriodFilterMode] = useState<'COVERED' | 'ALL'>('COVERED');

  const activeMonthFilter = periodFilterMode === 'COVERED' ? monthCover : 'ALL';
  const activeYearFilter = yearCover;

  const periodSalesRows = useMemo(
    () => salesRows.filter((r) => rowMatchesPeriod(r, activeMonthFilter, activeYearFilter)),
    [salesRows, activeMonthFilter, activeYearFilter]
  );

  const periodPurchasesRows = useMemo(
    () => purchasesRows.filter((r) => rowMatchesPeriod(r, activeMonthFilter, activeYearFilter)),
    [purchasesRows, activeMonthFilter, activeYearFilter]
  );

  const yearOnlySalesRows = useMemo(
    () => salesRows.filter((r) => rowMatchesPeriod(r, 'ALL', activeYearFilter)),
    [salesRows, activeYearFilter]
  );

  const yearOnlyPurchasesRows = useMemo(
    () => purchasesRows.filter((r) => rowMatchesPeriod(r, 'ALL', activeYearFilter)),
    [purchasesRows, activeYearFilter]
  );

  const scopedRows = useMemo(() => {
    if (scope === 'SALES') return periodSalesRows;
    if (scope === 'PURCHASES') return periodPurchasesRows;
    return [...periodSalesRows, ...periodPurchasesRows];
  }, [scope, periodSalesRows, periodPurchasesRows]);

  const yearScopedRows = useMemo(() => {
    if (scope === 'SALES') return yearOnlySalesRows;
    if (scope === 'PURCHASES') return yearOnlyPurchasesRows;
    return [...yearOnlySalesRows, ...yearOnlyPurchasesRows];
  }, [scope, yearOnlySalesRows, yearOnlyPurchasesRows]);

  const totals = useMemo(() => {
    if (scope === 'SALES') return computeLedgerTotals(periodSalesRows, 'SALES');
    if (scope === 'PURCHASES') return computeLedgerTotals(periodPurchasesRows, 'PURCHASES');
    const s = computeLedgerTotals(periodSalesRows, 'SALES');
    const p = computeLedgerTotals(periodPurchasesRows, 'PURCHASES');
    return {
      rowCount: s.rowCount + p.rowCount,
      flaggedCount: s.flaggedCount + p.flaggedCount,
      nonVatExempt: round2(s.nonVatExempt + p.nonVatExempt),
      grossOfVat: round2(s.grossOfVat + p.grossOfVat),
      netOfVat: round2(s.netOfVat + p.netOfVat),
      vat: round2(s.vat + p.vat),
      total: round2(s.total + p.total),
      wtGoods1: round2(s.wtGoods1 + p.wtGoods1),
      wtServices2: round2(s.wtServices2 + p.wtServices2),
      wtRental5: round2(s.wtRental5 + p.wtRental5),
      wtVat5: s.wtVat5,
      totalWithholding: round2(s.totalWithholding + p.totalWithholding),
      expectedNet: round2(s.expectedNet + p.expectedNet),
      actual: s.actual,
      variance: s.variance,
    };
  }, [scope, periodSalesRows, periodPurchasesRows]);

  const salesTotals = useMemo(() => computeLedgerTotals(periodSalesRows, 'SALES'), [periodSalesRows]);
  const purchasesTotals = useMemo(
    () => computeLedgerTotals(periodPurchasesRows, 'PURCHASES'),
    [periodPurchasesRows]
  );
  const modeForCalc: LedgerMode = scope === 'PURCHASES' ? 'PURCHASES' : 'SALES';

  const byMonth = useMemo(() => {
    const map = new Map<string, LedgerRow[]>();
    yearScopedRows.forEach((r) => {
      const m = getRowFilingMonth(r) || '(UNSPECIFIED)';
      const list = map.get(m) ?? [];
      list.push(r);
      map.set(m, list);
    });
    const orderedMonths = sortMonthsChronologically(Array.from(map.keys()));
    return orderedMonths.map((month) => ({
      month,
      ...computeLedgerTotals(map.get(month) ?? [], modeForCalc),
    }));
  }, [yearScopedRows, modeForCalc]);

  const byCategory = useMemo(() => {
    const cats = scope === 'SALES' ? (['GOODS', 'SERVICES', 'RENTAL'] as const) : (['N/A', 'GOODS', 'SERVICES', 'RENTAL'] as const);
    return cats.map((cat) => {
      const rows = scopedRows.filter((r) => r.category === cat);
      return {
        category: cat,
        ...computeLedgerTotals(rows, modeForCalc),
      };
    });
  }, [scopedRows, scope, modeForCalc]);

  const byClassificationOrEntity = useMemo(() => {
    if (scope === 'PURCHASES') {
      const classes = ['CORP', 'INDIVIDUAL', 'N/A'] as const;
      return classes.map((cls) => {
        const rows = periodPurchasesRows.filter((r) => (r.payeeClassification ?? 'N/A') === cls);
        return { label: cls, ...computeLedgerTotals(rows, 'PURCHASES') };
      });
    }
    const ents = ['PRIVATE', 'GOVT'] as const;
    return ents.map((ent) => {
      const rows = scopedRows.filter((r) => r.privateOrGovt === ent);
      return { label: ent, ...computeLedgerTotals(rows, 'SALES') };
    });
  }, [scope, scopedRows, periodPurchasesRows]);

  const byAccountTitle = useMemo(() => {
    if (scope !== 'PURCHASES') return [];
    const map = new Map<string, LedgerRow[]>();
    periodPurchasesRows.forEach((r) => {
      const acct = (r.accountTitle || '(UNASSIGNED)').trim().toUpperCase();
      const list = map.get(acct) ?? [];
      list.push(r);
      map.set(acct, list);
    });
    return Array.from(map.entries())
      .map(([accountTitle, rows]) => ({
        accountTitle,
        ...computeLedgerTotals(rows, 'PURCHASES'),
      }))
      .sort((a, b) => b.total - a.total);
  }, [scope, periodPurchasesRows]);

  const topEntities = useMemo(() => {
    const map = new Map<
      string,
      { name: string; tin: string; count: number; total: number; wht: number }
    >();
    scopedRows.forEach((r) => {
      const key = `${r.payor.trim()}|${r.tin.trim()}`;
      const existing = map.get(key) ?? {
        name: r.payor || '(Unnamed)',
        tin: r.tin || '-',
        count: 0,
        total: 0,
        wht: 0,
      };
      existing.count += 1;
      existing.total = round2(existing.total + (r.total ?? 0));
      existing.wht = round2(existing.wht + getRowTotalWithholding(r, modeForCalc));
      map.set(key, existing);
    });
    return Array.from(map.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [scopedRows, modeForCalc]);

  const flaggedDetails = useMemo(() => {
    const list: { row: LedgerRow; mode: LedgerMode; issues: ReturnType<typeof auditRow> }[] = [];
    if (scope === 'SALES' || scope === 'COMBINED') {
      periodSalesRows.forEach((r) => {
        const issues = auditRow(r, 'SALES');
        if (issues.length > 0) list.push({ row: r, mode: 'SALES', issues });
      });
    }
    if (scope === 'PURCHASES' || scope === 'COMBINED') {
      periodPurchasesRows.forEach((r) => {
        const issues = auditRow(r, 'PURCHASES');
        if (issues.length > 0) list.push({ row: r, mode: 'PURCHASES', issues });
      });
    }
    return list;
  }, [scope, periodSalesRows, periodPurchasesRows]);

  const netVatPayable = round2(salesTotals.vat - purchasesTotals.vat);
  const coveredLabel =
    monthCover === 'ALL'
      ? yearCover === 'ALL'
        ? 'All Months'
        : `All Months ${yearCover}`
      : yearCover === 'ALL'
      ? monthCover
      : `${MONTH_SHORT_LABELS[monthCover as FilingMonth] ?? monthCover} ${yearCover}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold leading-snug text-slate-900">
            Tax Filing Analyzer &amp; Audit Summary
          </h2>
          <p className="text-xs leading-normal text-slate-500 break-words">
            Live BIR VAT, Withholding Tax, and account breakdown ·{' '}
            <span className="font-semibold text-slate-700">
              {activeMonthFilter === 'ALL'
                ? activeYearFilter === 'ALL'
                  ? 'All Months & Years'
                  : `Full Year ${activeYearFilter}`
                : `${activeMonthFilter}${activeYearFilter !== 'ALL' ? ` ${activeYearFilter}` : ''}`}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 max-w-full">
          {monthCover !== 'ALL' && (
            <div className="inline-flex flex-wrap max-w-full rounded-xl border border-white/90 bg-white/80 backdrop-blur-md p-1">
              <button
                type="button"
                onClick={() => setPeriodFilterMode('COVERED')}
                className={`inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold leading-normal transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  periodFilterMode === 'COVERED'
                    ? 'bg-[#0B4DA2] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {coveredLabel}
              </button>
              <button
                type="button"
                onClick={() => setPeriodFilterMode('ALL')}
                className={`inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold leading-normal transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  periodFilterMode === 'ALL'
                    ? 'bg-[#18181B] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All Months ({yearCover === 'ALL' ? 'All' : yearCover})
              </button>
            </div>
          )}

          <div className="inline-flex flex-wrap max-w-full rounded-xl border border-white/90 bg-white/80 backdrop-blur-md p-1">
            {(['SALES', 'PURCHASES', 'COMBINED'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold leading-normal transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  scope === s
                    ? 'bg-[#0B4DA2] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {s === 'COMBINED' ? 'Combined Filing' : s === 'PURCHASES' ? 'EXPENSES' : 'SALES'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0 rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl p-4 shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
          <div className="text-xs font-medium leading-normal text-slate-500">Total Gross &amp; Exempt</div>
          <div className="mt-1 tabular-nums-mono text-2xl font-bold leading-normal text-slate-900 break-words">
            ₱{formatAccounting(totals.total)}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-normal text-slate-500">
            <span className="tabular-nums-mono">VATable: {formatAccounting(totals.grossOfVat)}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums-mono">Non-VAT: {formatAccounting(totals.nonVatExempt)}</span>
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl p-4 shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
          <div className="text-xs font-medium leading-normal text-slate-500">
            {scope === 'SALES'
              ? 'Output VAT (12%)'
              : scope === 'PURCHASES'
              ? 'Input VAT (12%)'
              : 'Total VAT Volume'}
          </div>
          <div className="mt-1 tabular-nums-mono text-2xl font-bold leading-normal text-slate-900 break-words">
            ₱{formatAccounting(totals.vat)}
          </div>
          <div className="mt-2 text-xs leading-normal text-slate-500">
            Net of VAT Base: <span className="tabular-nums-mono font-medium text-slate-700">{formatAccounting(totals.netOfVat)}</span>
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl p-4 shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
          <div className="text-xs font-medium leading-normal text-slate-500">Total Withholding Taxes</div>
          <div className="mt-1 tabular-nums-mono text-2xl font-bold leading-normal text-slate-900 break-words">
            ₱{formatAccounting(totals.totalWithholding)}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-normal text-slate-500 tabular-nums-mono">
            <span>1%: {formatAccounting(totals.wtGoods1)}</span>
            <span>·</span>
            <span>2%: {formatAccounting(totals.wtServices2)}</span>
            <span>·</span>
            <span>5%R: {formatAccounting(totals.wtRental5)}</span>
            {scope !== 'PURCHASES' && (
              <>
                <span>·</span>
                <span>5%V: {formatAccounting(totals.wtVat5)}</span>
              </>
            )}
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl p-4 shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
          <div className="text-xs font-medium leading-normal text-slate-500">
            {scope === 'PURCHASES' ? 'Net Payable (Total - EWT)' : 'Actual vs. Expected Net'}
          </div>
          <div className="mt-1 tabular-nums-mono text-2xl font-bold leading-normal text-slate-900 break-words">
            ₱{formatAccounting(scope === 'PURCHASES' ? totals.expectedNet : totals.actual)}
          </div>
          {scope === 'PURCHASES' ? (
            <div className="mt-2 text-xs leading-normal text-slate-500">
              Across {totals.rowCount} purchase entries
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-normal">
              <span className="text-slate-500">
                Expected: <span className="tabular-nums-mono">{formatAccounting(totals.expectedNet)}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span
                className={`tabular-nums-mono font-semibold ${
                  Math.abs(totals.variance) > 0.01 ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                Var: {formatAccounting(totals.variance)}
              </span>
            </div>
          )}
        </div>
      </div>

      {scope === 'COMBINED' && (
        <div className="rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl p-5 shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
          <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
            Sales vs. Purchases VAT Reconciliation
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
            <div className="rounded-xl bg-[#F4F8FD] p-3.5">
              <div className="text-slate-500">Output VAT (Sales)</div>
              <div className="mt-1 tabular-nums-mono text-lg font-bold text-slate-900">
                ₱{formatAccounting(salesTotals.vat)}
              </div>
              <div className="mt-1 text-slate-500">
                From {salesTotals.rowCount} sales rows · Creditable WHT: {formatAccounting(salesTotals.totalWithholding)}
              </div>
            </div>
            <div className="rounded-xl bg-[#F4F8FD] p-3.5">
              <div className="text-slate-500">Input VAT (Purchases)</div>
              <div className="mt-1 tabular-nums-mono text-lg font-bold text-slate-900">
                ₱{formatAccounting(purchasesTotals.vat)}
              </div>
              <div className="mt-1 text-slate-500">
                From {purchasesTotals.rowCount} purchase rows · EWT Payable: {formatAccounting(purchasesTotals.totalWithholding)}
              </div>
            </div>
            <div className="rounded-xl bg-[#0B4DA2] p-3.5 text-white">
              <div className="text-sky-100">
                {netVatPayable >= 0 ? 'Net VAT Payable (Output - Input)' : 'Excess Input VAT Credit'}
              </div>
              <div className="mt-1 tabular-nums-mono text-lg font-bold">
                ₱{formatAccounting(Math.abs(netVatPayable))}
              </div>
              <div className="mt-1 text-sky-100">
                Estimated BIR Form 2550M/Q position
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Breakdown Tables Grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl overflow-hidden shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
          <div className="border-b border-slate-200/70 px-5 py-3.5">
            <h3 className="font-display text-sm font-semibold text-slate-900">Summary by Month</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200/80 bg-[#F4F8FD]/90 text-slate-600">
                  <th className="px-4 py-2 font-semibold">MONTH</th>
                  <th className="px-3 py-2 text-right font-semibold">ROWS</th>
                  <th className="px-3 py-2 text-right font-semibold">NET / EXEMPT</th>
                  <th className="px-3 py-2 text-right font-semibold">VAT</th>
                  <th className="px-3 py-2 text-right font-semibold">WHT</th>
                  <th className="px-4 py-2 text-right font-semibold">TOTAL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {byMonth.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      No monthly data available.
                    </td>
                  </tr>
                ) : (
                  byMonth.map((m) => {
                    const isCovered = monthCover !== 'ALL' && m.month === monthCover;
                    const isValidMonth = FILING_MONTHS.includes(m.month as FilingMonth);
                    return (
                      <tr
                        key={m.month}
                        onClick={() => {
                          if (onSelectMonthCover && isValidMonth) {
                            onSelectMonthCover(m.month);
                            setPeriodFilterMode('COVERED');
                          }
                        }}
                        className={`${
                          isCovered ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                        } ${onSelectMonthCover && isValidMonth ? 'cursor-pointer' : ''}`}
                      >
                        <td className="px-4 py-2.5 font-semibold text-slate-900">
                          <span className="inline-flex items-center gap-1.5">
                            {m.month}
                            {isCovered && (
                              <span className="rounded bg-blue-700 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                Cover
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums-mono text-slate-600">{m.rowCount}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums-mono text-slate-700">
                          {formatAccounting(m.netOfVat + m.nonVatExempt)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums-mono text-slate-700">
                          {formatAccounting(m.vat)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums-mono text-slate-700">
                          {formatAccounting(m.totalWithholding)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums-mono font-semibold text-slate-900">
                          {formatAccounting(m.total)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl shadow-sm shadow-[#0B4DA2]/[0.04] overflow-hidden">
            <div className="border-b border-slate-200/70 px-5 py-3.5">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Summary by Category
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200/70 bg-[#F4F8FD]/90 text-slate-600">
                    <th className="px-4 py-2.5 font-semibold">CATEGORY</th>
                    <th className="px-3 py-2.5 text-right font-semibold">ROWS</th>
                    <th className="px-3 py-2.5 text-right font-semibold">VAT</th>
                    <th className="px-3 py-2.5 text-right font-semibold">TOTAL WHT</th>
                    <th className="px-4 py-2.5 text-right font-semibold">TOTAL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60">
                  {byCategory.map((c) => (
                    <tr key={c.category} className="hover:bg-[#F4F8FD]/60 transition-colors">
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{c.category}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums-mono text-slate-600">{c.rowCount}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums-mono text-slate-700">
                        {formatAccounting(c.vat)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums-mono text-slate-700">
                        {formatAccounting(c.totalWithholding)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums-mono font-semibold text-slate-900">
                        {formatAccounting(c.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl shadow-sm shadow-[#0B4DA2]/[0.04] overflow-hidden">
            <div className="border-b border-slate-200/70 px-5 py-3.5">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                {scope === 'PURCHASES'
                  ? 'Summary by Payee Classification'
                  : 'Summary by Private vs. Government'}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200/70 bg-[#F4F8FD]/90 text-slate-600">
                    <th className="px-4 py-2.5 font-semibold">
                      {scope === 'PURCHASES' ? 'CLASSIFICATION' : 'ENTITY TYPE'}
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">ROWS</th>
                    <th className="px-3 py-2.5 text-right font-semibold">TOTAL WHT</th>
                    <th className="px-4 py-2.5 text-right font-semibold">TOTAL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60">
                  {byClassificationOrEntity.map((e) => (
                    <tr key={e.label} className="hover:bg-[#F4F8FD]/60 transition-colors">
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{e.label}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums-mono text-slate-600">{e.rowCount}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums-mono text-slate-700">
                        {formatAccounting(e.totalWithholding)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums-mono font-semibold text-slate-900">
                        {formatAccounting(e.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Purchases Account Title Breakdown */}
      {scope === 'PURCHASES' && (
        <div className="rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl shadow-sm shadow-[#0B4DA2]/[0.04] overflow-hidden">
          <div className="border-b border-slate-200/70 px-5 py-3.5">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Expenses Breakdown by Account Title
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200/70 bg-[#F4F8FD]/90 text-slate-600">
                  <th className="px-4 py-2.5 font-semibold">ACCOUNT TITLE</th>
                  <th className="px-3 py-2.5 text-right font-semibold">ROWS</th>
                  <th className="px-3 py-2.5 text-right font-semibold">NET / EXEMPT</th>
                  <th className="px-3 py-2.5 text-right font-semibold">INPUT VAT</th>
                  <th className="px-3 py-2.5 text-right font-semibold">EWT</th>
                  <th className="px-4 py-2.5 text-right font-semibold">TOTAL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60">
                {byAccountTitle.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      No account titles encoded yet.
                    </td>
                  </tr>
                ) : (
                  byAccountTitle.map((acct) => (
                    <tr key={acct.accountTitle} className="hover:bg-[#F4F8FD]/60 transition-colors">
                      <td className="px-4 py-2.5 font-semibold leading-normal text-slate-900 break-words">{acct.accountTitle}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums-mono whitespace-nowrap text-slate-600">{acct.rowCount}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums-mono whitespace-nowrap text-slate-700">
                        {formatAccounting(acct.netOfVat + acct.nonVatExempt)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums-mono whitespace-nowrap text-slate-700">
                        {formatAccounting(acct.vat)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums-mono whitespace-nowrap text-slate-700">
                        {formatAccounting(acct.totalWithholding)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums-mono whitespace-nowrap font-semibold text-slate-900">
                        {formatAccounting(acct.total)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top Payors & Encoder Audit Checks */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl shadow-sm shadow-[#0B4DA2]/[0.04] overflow-hidden">
          <div className="border-b border-slate-200/70 px-5 py-3.5">
            <h3 className="font-display text-sm font-semibold leading-snug text-slate-900">
              {scope === 'PURCHASES' ? 'Top Payees / Suppliers' : 'Top Payors / Suppliers'}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200/70 bg-[#F4F8FD]/90 text-slate-600">
                  <th className="px-4 py-2.5 font-semibold whitespace-nowrap">NAME &amp; TIN</th>
                  <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">TXNS</th>
                  <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">WHT</th>
                  <th className="px-4 py-2.5 text-right font-semibold whitespace-nowrap">TOTAL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60">
                {topEntities.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                      No payors or suppliers encoded yet.
                    </td>
                  </tr>
                ) : (
                  topEntities.map((item, i) => (
                    <tr key={`${item.name}-${i}`} className="hover:bg-[#F4F8FD]/60 transition-colors">
                      <td className="px-4 py-2.5 max-w-[240px]">
                        <div className="font-semibold leading-normal text-slate-900 break-words">{item.name}</div>
                        <div className="tabular-nums-mono text-[11px] leading-normal text-slate-500">{item.tin}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums-mono whitespace-nowrap text-slate-600">
                        {item.count}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums-mono whitespace-nowrap text-slate-700">
                        {formatAccounting(item.wht)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums-mono whitespace-nowrap font-semibold text-slate-900">
                        {formatAccounting(item.total)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Encoder Audit Checks */}
        <div className="rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl shadow-sm shadow-[#0B4DA2]/[0.04] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 px-5 py-3.5">
            <h3 className="font-display text-sm font-semibold leading-snug text-slate-900">
              Encoder Audit Checks
            </h3>
            {flaggedDetails.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold leading-normal text-amber-800 whitespace-nowrap">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <span>{flaggedDetails.length} row(s) need review</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-semibold leading-normal text-[#0B4DA2] whitespace-nowrap">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>All rows pass validation</span>
              </span>
            )}
          </div>

          {flaggedDetails.length === 0 ? (
            <div className="px-5 py-10 text-center text-xs leading-normal text-slate-500">
              No missing TINs, invalid TIN lengths, missing addresses, or tax calculation discrepancies detected.
            </div>
          ) : (
            <div className="divide-y divide-slate-200/60 max-h-80 overflow-y-auto">
              {flaggedDetails.map((item) => (
                <div
                  key={item.row.id}
                  className="flex items-center justify-between gap-3 px-5 py-3 text-xs hover:bg-[#F4F8FD]/60 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold leading-normal text-slate-900 truncate">
                      {item.mode} · {item.row.date || '-'} · {item.row.payor || '(Missing Name)'}
                    </div>
                    <div className="mt-0.5 leading-normal text-amber-800 break-words">
                      {item.issues.map((iss) => iss.message).join(' · ')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onInspectFlaggedRows(item.mode)}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200/90 bg-white px-2.5 py-1 text-xs font-medium leading-normal text-slate-700 hover:bg-[#F4F8FD] hover:text-[#0B4DA2] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <span>Review</span>
                    <ArrowRight className="h-3 w-3 shrink-0" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
