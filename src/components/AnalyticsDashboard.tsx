import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import type { LedgerMode, LedgerRow } from '../types/tax';
import {
  auditRow,
  computeLedgerTotals,
  formatAccounting,
  getRowTotalWithholding,
  round2,
} from '../utils/taxEngine';

interface AnalyticsDashboardProps {
  activeMode: LedgerMode;
  salesRows: LedgerRow[];
  purchasesRows: LedgerRow[];
  onInspectFlaggedRows: (mode: LedgerMode) => void;
}

type AnalysisScope = 'SALES' | 'PURCHASES' | 'COMBINED';

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  activeMode,
  salesRows,
  purchasesRows,
  onInspectFlaggedRows,
}) => {
  const [scope, setScope] = useState<AnalysisScope>(activeMode);

  const scopedRows = useMemo(() => {
    if (scope === 'SALES') return salesRows;
    if (scope === 'PURCHASES') return purchasesRows;
    return [...salesRows, ...purchasesRows];
  }, [scope, salesRows, purchasesRows]);

  const totals = useMemo(() => {
    if (scope === 'SALES') return computeLedgerTotals(salesRows, 'SALES');
    if (scope === 'PURCHASES') return computeLedgerTotals(purchasesRows, 'PURCHASES');
    const s = computeLedgerTotals(salesRows, 'SALES');
    const p = computeLedgerTotals(purchasesRows, 'PURCHASES');
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
  }, [scope, salesRows, purchasesRows]);

  const salesTotals = useMemo(() => computeLedgerTotals(salesRows, 'SALES'), [salesRows]);
  const purchasesTotals = useMemo(() => computeLedgerTotals(purchasesRows, 'PURCHASES'), [purchasesRows]);
  const modeForCalc: LedgerMode = scope === 'PURCHASES' ? 'PURCHASES' : 'SALES';

  const byMonth = useMemo(() => {
    const map = new Map<string, LedgerRow[]>();
    scopedRows.forEach((r) => {
      const m = r.month.trim().toUpperCase() || '(UNSPECIFIED)';
      const list = map.get(m) ?? [];
      list.push(r);
      map.set(m, list);
    });
    return Array.from(map.entries()).map(([month, rows]) => ({
      month,
      ...computeLedgerTotals(rows, modeForCalc),
    }));
  }, [scopedRows, modeForCalc]);

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
        const rows = purchasesRows.filter((r) => (r.payeeClassification ?? 'N/A') === cls);
        return { label: cls, ...computeLedgerTotals(rows, 'PURCHASES') };
      });
    }
    const ents = ['PRIVATE', 'GOVT'] as const;
    return ents.map((ent) => {
      const rows = scopedRows.filter((r) => r.privateOrGovt === ent);
      return { label: ent, ...computeLedgerTotals(rows, 'SALES') };
    });
  }, [scope, scopedRows, purchasesRows]);

  const byAccountTitle = useMemo(() => {
    if (scope !== 'PURCHASES') return [];
    const map = new Map<string, LedgerRow[]>();
    purchasesRows.forEach((r) => {
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
  }, [scope, purchasesRows]);

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
      salesRows.forEach((r) => {
        const issues = auditRow(r, 'SALES');
        if (issues.length > 0) list.push({ row: r, mode: 'SALES', issues });
      });
    }
    if (scope === 'PURCHASES' || scope === 'COMBINED') {
      purchasesRows.forEach((r) => {
        const issues = auditRow(r, 'PURCHASES');
        if (issues.length > 0) list.push({ row: r, mode: 'PURCHASES', issues });
      });
    }
    return list;
  }, [scope, salesRows, purchasesRows]);

  const netVatPayable = round2(salesTotals.vat - purchasesTotals.vat);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Tax Filing Analyzer &amp; Audit Summary
          </h2>
          <p className="text-xs text-slate-500">
            Live BIR VAT, Withholding Tax, and account breakdown across encoded records
          </p>
        </div>

        <div className="inline-flex rounded-lg bg-slate-200/70 p-1">
          {(['SALES', 'PURCHASES', 'COMBINED'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                scope === s
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {s === 'COMBINED' ? 'Combined Filing' : s}
            </button>
          ))}
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Total Gross &amp; Exempt</div>
          <div className="mt-1 tabular-nums-mono text-2xl font-bold text-slate-900">
            ₱{formatAccounting(totals.total)}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
            <span>VATable: {formatAccounting(totals.grossOfVat)}</span>
            <span aria-hidden="true">·</span>
            <span>Non-VAT: {formatAccounting(totals.nonVatExempt)}</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            {scope === 'SALES'
              ? 'Output VAT (12%)'
              : scope === 'PURCHASES'
              ? 'Input VAT (12%)'
              : 'Total VAT Volume'}
          </div>
          <div className="mt-1 tabular-nums-mono text-2xl font-bold text-slate-900">
            ₱{formatAccounting(totals.vat)}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Net of VAT Base: <span className="tabular-nums-mono font-medium text-slate-700">{formatAccounting(totals.netOfVat)}</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Total Withholding Taxes</div>
          <div className="mt-1 tabular-nums-mono text-2xl font-bold text-slate-900">
            ₱{formatAccounting(totals.totalWithholding)}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 tabular-nums-mono">
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

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            {scope === 'PURCHASES' ? 'Net Payable (Total - EWT)' : 'Actual vs. Expected Net'}
          </div>
          <div className="mt-1 tabular-nums-mono text-2xl font-bold text-slate-900">
            ₱{formatAccounting(scope === 'PURCHASES' ? totals.expectedNet : totals.actual)}
          </div>
          {scope === 'PURCHASES' ? (
            <div className="mt-2 text-xs text-slate-500">
              Across {totals.rowCount} purchase entries
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-2 text-xs">
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
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
            Sales vs. Purchases VAT Reconciliation
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
            <div className="rounded-lg bg-slate-50 p-3.5">
              <div className="text-slate-500">Output VAT (Sales)</div>
              <div className="mt-1 tabular-nums-mono text-lg font-bold text-slate-900">
                ₱{formatAccounting(salesTotals.vat)}
              </div>
              <div className="mt-1 text-slate-500">
                From {salesTotals.rowCount} sales rows · Creditable WHT: {formatAccounting(salesTotals.totalWithholding)}
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3.5">
              <div className="text-slate-500">Input VAT (Purchases)</div>
              <div className="mt-1 tabular-nums-mono text-lg font-bold text-slate-900">
                ₱{formatAccounting(purchasesTotals.vat)}
              </div>
              <div className="mt-1 text-slate-500">
                From {purchasesTotals.rowCount} purchase rows · EWT Payable: {formatAccounting(purchasesTotals.totalWithholding)}
              </div>
            </div>
            <div className="rounded-lg bg-slate-900 p-3.5 text-white">
              <div className="text-slate-300">
                {netVatPayable >= 0 ? 'Net VAT Payable (Output - Input)' : 'Excess Input VAT Credit'}
              </div>
              <div className="mt-1 tabular-nums-mono text-lg font-bold">
                ₱{formatAccounting(Math.abs(netVatPayable))}
              </div>
              <div className="mt-1 text-slate-300">
                Estimated BIR Form 2550M/Q position
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Breakdown Tables Grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-3.5">
            <h3 className="font-display text-sm font-semibold text-slate-900">Summary by Month</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
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
                  byMonth.map((m) => (
                    <tr key={m.month} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{m.month}</td>
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-3.5">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Summary by Category
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="px-4 py-2 font-semibold">CATEGORY</th>
                    <th className="px-3 py-2 text-right font-semibold">ROWS</th>
                    <th className="px-3 py-2 text-right font-semibold">VAT</th>
                    <th className="px-3 py-2 text-right font-semibold">TOTAL WHT</th>
                    <th className="px-4 py-2 text-right font-semibold">TOTAL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {byCategory.map((c) => (
                    <tr key={c.category} className="hover:bg-slate-50">
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

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-3.5">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                {scope === 'PURCHASES'
                  ? 'Summary by Payee Classification'
                  : 'Summary by Private vs. Government'}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="px-4 py-2 font-semibold">
                      {scope === 'PURCHASES' ? 'CLASSIFICATION' : 'ENTITY TYPE'}
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">ROWS</th>
                    <th className="px-3 py-2 text-right font-semibold">TOTAL WHT</th>
                    <th className="px-4 py-2 text-right font-semibold">TOTAL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {byClassificationOrEntity.map((e) => (
                    <tr key={e.label} className="hover:bg-slate-50">
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
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-3.5">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Purchases Breakdown by Account Title
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="px-4 py-2 font-semibold">ACCOUNT TITLE</th>
                  <th className="px-3 py-2 text-right font-semibold">ROWS</th>
                  <th className="px-3 py-2 text-right font-semibold">NET / EXEMPT</th>
                  <th className="px-3 py-2 text-right font-semibold">INPUT VAT</th>
                  <th className="px-3 py-2 text-right font-semibold">EWT</th>
                  <th className="px-4 py-2 text-right font-semibold">TOTAL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {byAccountTitle.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      No account titles encoded yet.
                    </td>
                  </tr>
                ) : (
                  byAccountTitle.map((acct) => (
                    <tr key={acct.accountTitle} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{acct.accountTitle}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums-mono text-slate-600">{acct.rowCount}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums-mono text-slate-700">
                        {formatAccounting(acct.netOfVat + acct.nonVatExempt)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums-mono text-slate-700">
                        {formatAccounting(acct.vat)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums-mono text-slate-700">
                        {formatAccounting(acct.totalWithholding)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums-mono font-semibold text-slate-900">
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
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-3.5">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              {scope === 'PURCHASES' ? 'Top Payees / Suppliers' : 'Top Payors / Suppliers'}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="px-4 py-2 font-semibold">NAME &amp; TIN</th>
                  <th className="px-3 py-2 text-right font-semibold">TXNS</th>
                  <th className="px-3 py-2 text-right font-semibold">WHT</th>
                  <th className="px-4 py-2 text-right font-semibold">TOTAL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {topEntities.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                      No payors or suppliers encoded yet.
                    </td>
                  </tr>
                ) : (
                  topEntities.map((item, i) => (
                    <tr key={`${item.name}-${i}`} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-900">{item.name}</div>
                        <div className="tabular-nums-mono text-[11px] text-slate-500">{item.tin}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums-mono text-slate-600">
                        {item.count}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums-mono text-slate-700">
                        {formatAccounting(item.wht)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums-mono font-semibold text-slate-900">
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
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Encoder Audit Checks
            </h3>
            {flaggedDetails.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                {flaggedDetails.length} row(s) need review
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                All rows pass validation
              </span>
            )}
          </div>

          {flaggedDetails.length === 0 ? (
            <div className="px-5 py-10 text-center text-xs text-slate-500">
              No missing TINs, invalid TIN lengths, missing addresses, or tax calculation discrepancies detected.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 max-h-80 overflow-y-auto">
              {flaggedDetails.map((item) => (
                <div
                  key={item.row.id}
                  className="flex items-center justify-between gap-3 px-5 py-3 text-xs hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">
                      {item.mode} · {item.row.date || '-'} · {item.row.payor || '(Missing Name)'}
                    </div>
                    <div className="mt-0.5 text-amber-800">
                      {item.issues.map((iss) => iss.message).join(' · ')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onInspectFlaggedRows(item.mode)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Review
                    <ArrowRight className="h-3 w-3" />
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
