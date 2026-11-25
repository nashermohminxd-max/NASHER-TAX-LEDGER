import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  CopyPlus,
  Edit3,
  FileSpreadsheet,
  Filter,
  Search,
  Trash2,
  Wrench,
} from 'lucide-react';
import type {
  EntityType,
  LedgerMode,
  LedgerRow,
  PayeeClassification,
  TransactionCategory,
  YesNo,
} from '../types/tax';
import {
  auditRow,
  computeLedgerTotals,
  formatAccounting,
  getRowExpectedActual,
} from '../utils/taxEngine';

interface LedgerTableProps {
  mode: LedgerMode;
  rows: LedgerRow[];
  onEditRow: (row: LedgerRow) => void;
  onDuplicateNextCategory: (row: LedgerRow) => void;
  onDeleteRow: (id: string) => void;
  onFixMathRow: (row: LedgerRow) => void;
  onComputeActualRow: (row: LedgerRow) => void;
  onStartNewEntry: () => void;
  onImportCsvClick: () => void;
  needsReviewOnly: boolean;
  onToggleNeedsReviewOnly: (val: boolean) => void;
}

export const LedgerTable: React.FC<LedgerTableProps> = ({
  mode,
  rows,
  onEditRow,
  onDuplicateNextCategory,
  onDeleteRow,
  onFixMathRow,
  onComputeActualRow,
  onStartNewEntry,
  onImportCsvClick,
  needsReviewOnly,
  onToggleNeedsReviewOnly,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [monthFilter, setMonthFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | TransactionCategory>('ALL');
  const [entityFilter, setEntityFilter] = useState<'ALL' | EntityType>('ALL');
  const [classFilter, setClassFilter] = useState<'ALL' | PayeeClassification>('ALL');
  const [agentFilter, setAgentFilter] = useState<'ALL' | YesNo>('ALL');
  const [mobileView, setMobileView] = useState<'CARDS' | 'GRID'>('CARDS');

  const entityHeader = mode === 'SALES' ? 'PAYOR' : 'PAYEE/SUPPLIER';

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.month.trim()) set.add(r.month.trim().toUpperCase());
    });
    return Array.from(set);
  }, [rows]);

  const rowAudits = useMemo(() => {
    const map = new Map<string, ReturnType<typeof auditRow>>();
    rows.forEach((r) => {
      map.set(r.id, auditRow(r, mode));
    });
    return map;
  }, [rows, mode]);

  const totalFlagged = useMemo(() => {
    let count = 0;
    rowAudits.forEach((issues) => {
      if (issues.length > 0) count++;
    });
    return count;
  }, [rowAudits]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (monthFilter !== 'ALL' && r.month.toUpperCase() !== monthFilter) return false;
      if (categoryFilter !== 'ALL' && r.category !== categoryFilter) return false;
      if (mode === 'SALES' && entityFilter !== 'ALL' && r.privateOrGovt !== entityFilter) return false;
      if (mode === 'PURCHASES' && classFilter !== 'ALL' && (r.payeeClassification ?? 'N/A') !== classFilter) return false;
      if (mode === 'PURCHASES' && agentFilter !== 'ALL' && (r.withholdingAgent ?? 'NO') !== agentFilter) return false;
      if (needsReviewOnly && (rowAudits.get(r.id)?.length ?? 0) === 0) return false;
      if (q) {
        const hay = `${r.date} ${r.month} ${r.branchTradeName} ${r.payor} ${r.tin} ${r.address} ${r.address2 ?? ''} ${r.remarks} ${r.particular ?? ''} ${r.accountTitle ?? ''} ${r.referenceNo ?? ''} ${r.supportingDocs ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    rows,
    mode,
    searchQuery,
    monthFilter,
    categoryFilter,
    entityFilter,
    classFilter,
    agentFilter,
    needsReviewOnly,
    rowAudits,
  ]);

  const filteredTotals = useMemo(() => computeLedgerTotals(filteredRows, mode), [filteredRows, mode]);

  const clearFilters = () => {
    setSearchQuery('');
    setMonthFilter('ALL');
    setCategoryFilter('ALL');
    setEntityFilter('ALL');
    setClassFilter('ALL');
    setAgentFilter('ALL');
    onToggleNeedsReviewOnly(false);
  };

  const hasActiveFilters =
    searchQuery !== '' ||
    monthFilter !== 'ALL' ||
    categoryFilter !== 'ALL' ||
    (mode === 'SALES' && entityFilter !== 'ALL') ||
    (mode === 'PURCHASES' && (classFilter !== 'ALL' || agentFilter !== 'ALL')) ||
    needsReviewOnly;

  const categoryFilterOptions: ('ALL' | TransactionCategory)[] =
    mode === 'PURCHASES'
      ? ['ALL', 'N/A', 'GOODS', 'SERVICES', 'RENTAL']
      : ['ALL', 'GOODS', 'SERVICES', 'RENTAL'];

  return (
    <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[240px]">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                mode === 'PURCHASES'
                  ? 'Search payee, TIN, ref no., particular, account...'
                  : 'Search payor, TIN, branch, remarks...'
              }
              className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            aria-label="Filter by month"
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none"
          >
            <option value="ALL">All Months</option>
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
            {categoryFilterOptions.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  categoryFilter === cat
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {cat === 'ALL' ? 'All Categories' : cat}
              </button>
            ))}
          </div>

          {mode === 'SALES' ? (
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
              {(['ALL', 'PRIVATE', 'GOVT'] as const).map((ent) => (
                <button
                  key={ent}
                  type="button"
                  onClick={() => setEntityFilter(ent)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    entityFilter === ent
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {ent === 'ALL' ? 'All Entities' : ent}
                </button>
              ))}
            </div>
          ) : (
            <>
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value as 'ALL' | PayeeClassification)}
                aria-label="Filter by classification"
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none"
              >
                <option value="ALL">All Classifications</option>
                <option value="N/A">N/A</option>
                <option value="INDIVIDUAL">INDIVIDUAL</option>
                <option value="CORP">CORP</option>
              </select>

              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value as 'ALL' | YesNo)}
                aria-label="Filter by withholding agent"
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none"
              >
                <option value="ALL">WHT Agent: All</option>
                <option value="YES">WHT Agent: YES</option>
                <option value="NO">WHT Agent: NO</option>
              </select>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onToggleNeedsReviewOnly(!needsReviewOnly)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              needsReviewOnly
                ? 'border-amber-400 bg-amber-50 text-amber-900'
                : totalFlagged > 0
                ? 'border-amber-200 bg-amber-50/60 text-amber-800 hover:bg-amber-100'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            Needs Review ({totalFlagged})
          </button>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 cursor-pointer"
            >
              Reset Filters
            </button>
          )}

          {/* Mobile View Switcher */}
          <div className="inline-flex md:hidden rounded-lg bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setMobileView('CARDS')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                mobileView === 'CARDS' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Cards
            </button>
            <button
              type="button"
              onClick={() => setMobileView('GRID')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                mobileView === 'GRID' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Full Grid
            </button>
          </div>
        </div>
      </div>

      {/* Empty States */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <FileSpreadsheet className="h-10 w-10 text-slate-300" />
          <h3 className="mt-3 font-display text-base font-semibold text-slate-900">
            No {mode.toLowerCase()} transactions recorded yet
          </h3>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            Encode your first invoice above using BIR RELIEF TIN recall, or import an existing CSV filing sheet.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onStartNewEntry}
              className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
            >
              Encode First Entry
            </button>
            <button
              type="button"
              onClick={onImportCsvClick}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Import Filing CSV
            </button>
          </div>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
          <Search className="h-8 w-8 text-slate-300" />
          <h3 className="mt-3 font-display text-sm font-semibold text-slate-900">
            No matching rows found
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Adjust your search query, month, or audit filter to view ledger entries.
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-4 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Clear All Filters
          </button>
        </div>
      ) : (
        <>
          {/* Mobile Cards View */}
          {mobileView === 'CARDS' && (
            <div className="divide-y divide-slate-200 md:hidden">
              {filteredRows.map((row) => {
                const issues = rowAudits.get(row.id) ?? [];
                const hasMathFix = issues.some((i) => i.canAutoFix);
                const expectedActual = getRowExpectedActual(row, mode);
                return (
                  <div key={row.id} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs text-slate-500">
                          <span className="tabular-nums-mono font-medium text-slate-700">{row.date || '-'}</span>
                          <span aria-hidden="true"> · </span>
                          <span>{row.month || '-'}</span>
                          <span aria-hidden="true"> · </span>
                          <span className="font-semibold text-slate-700">{row.category}</span>
                          <span aria-hidden="true"> · </span>
                          <span>
                            {mode === 'SALES'
                              ? row.privateOrGovt
                              : `${row.payeeClassification ?? 'N/A'} · WHT ${row.withholdingAgent ?? 'NO'}`}
                          </span>
                        </div>
                        <div className="mt-0.5 font-display text-sm font-semibold text-slate-900">
                          {row.payor || '(Missing Name)'}
                        </div>
                        <div className="text-xs text-slate-500">
                          {row.branchTradeName && <span>{row.branchTradeName} · </span>}
                          <span className="tabular-nums-mono">{row.tin || 'No TIN'}</span>
                        </div>
                        {(row.address || row.address2) && (
                          <div className="text-[11px] text-slate-500 truncate max-w-[260px]">
                            {[row.address, row.address2].filter(Boolean).join(', ')}
                          </div>
                        )}
                        {mode === 'PURCHASES' && (row.accountTitle || row.particular) && (
                          <div className="mt-1 text-xs text-slate-700">
                            <span className="font-semibold">{row.accountTitle || '-'}</span>
                            {row.particular && <span> · {row.particular}</span>}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] text-slate-500">TOTAL</div>
                        <div className="tabular-nums-mono text-sm font-bold text-slate-900">
                          {formatAccounting(row.total)}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2.5 text-xs">
                      <div>
                        <div className="text-[10px] text-slate-500">NET OF VAT</div>
                        <div className="tabular-nums-mono font-medium text-slate-800">{formatAccounting(row.netOfVat)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500">VAT</div>
                        <div className="tabular-nums-mono font-medium text-slate-800">{formatAccounting(row.vat)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500">
                          {mode === 'SALES' ? 'ACTUAL' : 'NET PAYABLE'}
                        </div>
                        <div className="tabular-nums-mono font-semibold text-slate-900">
                          {formatAccounting(mode === 'SALES' ? row.actual : expectedActual)}
                        </div>
                      </div>
                    </div>

                    {issues.length > 0 && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
                        {issues.map((iss) => iss.message).join(' · ')}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                      {hasMathFix && (
                        <button
                          type="button"
                          onClick={() => onFixMathRow(row)}
                          className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900"
                        >
                          <Wrench className="h-3 w-3" />
                          Fix Math
                        </button>
                      )}
                      {mode === 'SALES' && row.actual === null && expectedActual !== null && (
                        <button
                          type="button"
                          onClick={() => onComputeActualRow(row)}
                          className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                        >
                          <Calculator className="h-3 w-3" />
                          Set Actual
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDuplicateNextCategory(row)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700"
                      >
                        <CopyPlus className="h-3 w-3" />
                        Next Cat
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditRow(row)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700"
                      >
                        <Edit3 className="h-3 w-3" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteRow(row.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Desktop & Grid View */}
          <div className={`${mobileView === 'CARDS' ? 'hidden md:block' : 'block'} overflow-x-auto ledger-scroll`}>
            {mode === 'PURCHASES' ? (
              /* EXACT 22-COLUMN PURCHASES SCHEMA (WITH TWO ADDRESS COLUMNS) */
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  {/* Row 1: PURCHASES (19 cols) | WITHHOLDING TAX (3 cols) */}
                  <tr className="bg-white text-slate-950">
                    <th
                      colSpan={19}
                      className="border border-slate-400 px-3 py-2 text-center text-sm font-bold tracking-wide"
                    >
                      PURCHASES
                    </th>
                    <th
                      colSpan={3}
                      className="border border-slate-400 px-3 py-1.5 text-center text-xs font-bold tracking-wide"
                    >
                      WITHHOLDING TAX
                    </th>
                    <th
                      rowSpan={3}
                      className="border border-slate-400 bg-slate-50 px-3 py-2 text-center text-[11px] font-bold tracking-wide align-middle"
                    >
                      ACTIONS
                    </th>
                  </tr>

                  {/* Row 2: Cols 1-19 vertically merged (rowSpan=2), Cols 20-22 GOODS / SERVICES / RENTAL */}
                  <tr className="bg-white text-slate-950">
                    <th rowSpan={2} className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold align-bottom whitespace-nowrap">
                      DATE
                    </th>
                    <th rowSpan={2} className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold align-bottom whitespace-nowrap">
                      MONTH
                    </th>
                    <th rowSpan={2} className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold align-bottom whitespace-nowrap">
                      BRANCH/ TRADE NAME
                    </th>
                    <th rowSpan={2} className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold align-bottom whitespace-nowrap">
                      PAYEE/SUPPLIER
                    </th>
                    <th rowSpan={2} className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold align-bottom min-w-[170px] leading-tight">
                      CLASSIFICATION OF PAYEE/SUPPLIER (N/A, INDIVIDUAL OR CORP)
                    </th>
                    <th rowSpan={2} className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold align-bottom whitespace-nowrap">
                      TIN
                    </th>
                    <th rowSpan={2} className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold align-bottom whitespace-nowrap leading-tight">
                      ADDRESS<br />(BRGY / MUN.)
                    </th>
                    <th rowSpan={2} className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold align-bottom whitespace-nowrap leading-tight">
                      ADDRESS<br />(CITY / DIST.)
                    </th>
                    <th rowSpan={2} className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold align-bottom whitespace-nowrap">
                      SUPPORTING DOCS
                    </th>
                    <th rowSpan={2} className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold align-bottom whitespace-nowrap">
                      REFERENCE NO.
                    </th>
                    <th
                      rowSpan={2}
                      style={{ backgroundColor: '#FFFF00' }}
                      className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold text-black align-bottom whitespace-nowrap"
                    >
                      PARTICULAR
                    </th>
                    <th
                      rowSpan={2}
                      style={{ backgroundColor: '#FFFF00' }}
                      className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold text-black align-bottom whitespace-nowrap"
                    >
                      ACCOUNT TITLE
                    </th>
                    <th rowSpan={2} className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold align-bottom whitespace-nowrap">
                      N/A, GOODS, SERVICES OR RENTAL
                    </th>
                    <th rowSpan={2} className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold align-bottom min-w-[130px] leading-tight">
                      WITHHOLDING AGENT (YES OR NO)
                    </th>
                    <th rowSpan={2} className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold align-bottom whitespace-nowrap">
                      NON-VAT/VAT EXEMPT
                    </th>
                    <th rowSpan={2} className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold align-bottom whitespace-nowrap">
                      GROSS OF VAT
                    </th>
                    <th rowSpan={2} className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold align-bottom whitespace-nowrap">
                      NET OF VAT
                    </th>
                    <th rowSpan={2} className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold align-bottom whitespace-nowrap">
                      VAT
                    </th>
                    <th rowSpan={2} className="border border-slate-400 px-2.5 py-2 text-center text-[11px] font-bold align-bottom whitespace-nowrap">
                      TOTAL
                    </th>
                    <th className="border border-slate-400 px-2.5 py-1.5 text-center text-[11px] font-bold whitespace-nowrap">
                      GOODS
                    </th>
                    <th className="border border-slate-400 px-2.5 py-1.5 text-center text-[11px] font-bold whitespace-nowrap">
                      SERVICES
                    </th>
                    <th className="border border-slate-400 px-2.5 py-1.5 text-center text-[11px] font-bold whitespace-nowrap">
                      RENTAL
                    </th>
                  </tr>

                  {/* Row 3: 1% | 2% | 5% */}
                  <tr className="bg-white text-slate-950">
                    <th className="border border-slate-400 px-2.5 py-1.5 text-center text-[11px] font-bold whitespace-nowrap">
                      1%
                    </th>
                    <th className="border border-slate-400 px-2.5 py-1.5 text-center text-[11px] font-bold whitespace-nowrap">
                      2%
                    </th>
                    <th className="border border-slate-400 px-2.5 py-1.5 text-center text-[11px] font-bold whitespace-nowrap">
                      5%
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200">
                  {filteredRows.map((row) => {
                    const issues = rowAudits.get(row.id) ?? [];
                    const hasError = issues.some((i) => i.severity === 'error');
                    const hasMathFix = issues.some((i) => i.canAutoFix);

                    return (
                      <tr
                        key={row.id}
                        className={`h-10 transition-colors hover:bg-blue-50/40 ${
                          issues.length > 0 ? 'bg-amber-50/35' : 'bg-white'
                        }`}
                      >
                        <td className="px-2.5 py-2 tabular-nums-mono whitespace-nowrap text-slate-800">
                          {row.date || '-'}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap font-medium text-slate-700">
                          {row.month || '-'}
                        </td>
                        <td className="px-2.5 py-2 max-w-[140px] truncate text-slate-700" title={row.branchTradeName}>
                          {row.branchTradeName || '-'}
                        </td>
                        <td className="px-2.5 py-2 max-w-[190px] truncate font-medium text-slate-900" title={row.payor}>
                          {row.payor || '-'}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap text-slate-700">
                          {row.payeeClassification ?? 'N/A'}
                        </td>
                        <td className="px-2.5 py-2 tabular-nums-mono whitespace-nowrap text-slate-700">
                          {row.tin || '-'}
                        </td>
                        <td className="px-2.5 py-2 max-w-[170px] truncate text-slate-600" title={row.address}>
                          {row.address || '-'}
                        </td>
                        <td className="px-2.5 py-2 max-w-[150px] truncate text-slate-600" title={row.address2 ?? ''}>
                          {row.address2 || '-'}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap text-slate-700">
                          {row.supportingDocs || '-'}
                        </td>
                        <td className="px-2.5 py-2 tabular-nums-mono whitespace-nowrap text-slate-700">
                          {row.referenceNo || '-'}
                        </td>
                        <td className="bg-amber-50/30 px-2.5 py-2 max-w-[190px] truncate text-slate-800" title={row.particular}>
                          {row.particular || '-'}
                        </td>
                        <td className="bg-amber-50/30 px-2.5 py-2 max-w-[150px] truncate font-medium text-slate-900" title={row.accountTitle}>
                          {row.accountTitle || '-'}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap font-medium text-slate-800">
                          {row.category}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 whitespace-nowrap font-semibold text-slate-700">
                          {row.withholdingAgent ?? 'NO'}
                        </td>

                        <td className="px-2.5 py-2 text-right tabular-nums-mono whitespace-nowrap text-slate-800">
                          {formatAccounting(row.nonVatExempt)}
                        </td>
                        <td className="px-2.5 py-2 text-right tabular-nums-mono whitespace-nowrap text-slate-800">
                          {formatAccounting(row.grossOfVat)}
                        </td>
                        <td className="px-2.5 py-2 text-right tabular-nums-mono whitespace-nowrap text-slate-700">
                          {formatAccounting(row.netOfVat)}
                        </td>
                        <td className="px-2.5 py-2 text-right tabular-nums-mono whitespace-nowrap text-slate-700">
                          {formatAccounting(row.vat)}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-right tabular-nums-mono whitespace-nowrap font-semibold text-slate-900">
                          {formatAccounting(row.total)}
                        </td>

                        <td className="bg-slate-50/50 px-2.5 py-2 text-right tabular-nums-mono whitespace-nowrap text-slate-700">
                          {formatAccounting(row.wtGoods1)}
                        </td>
                        <td className="bg-slate-50/50 px-2.5 py-2 text-right tabular-nums-mono whitespace-nowrap text-slate-700">
                          {formatAccounting(row.wtServices2)}
                        </td>
                        <td className="border-r border-slate-200 bg-slate-50/50 px-2.5 py-2 text-right tabular-nums-mono whitespace-nowrap text-slate-700">
                          {formatAccounting(row.wtRental5)}
                        </td>

                        {/* Actions & Audit */}
                        <td className="px-2.5 py-1.5 whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            {issues.length > 0 ? (
                              <span
                                title={issues.map((i) => i.message).join('\n')}
                                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                                  hasError ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                <AlertTriangle className="h-3 w-3" />
                                {issues.length}
                              </span>
                            ) : (
                              <span title="Audit passed" className="text-emerald-600 px-1">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </span>
                            )}

                            {hasMathFix && (
                              <button
                                type="button"
                                onClick={() => onFixMathRow(row)}
                                title="Auto-fix VAT & Withholding Tax math"
                                className="rounded p-1 text-amber-700 hover:bg-amber-100 cursor-pointer"
                              >
                                <Wrench className="h-3.5 w-3.5" />
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => onDuplicateNextCategory(row)}
                              title="Duplicate Row (Next Category)"
                              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-blue-700 cursor-pointer"
                            >
                              <CopyPlus className="h-3.5 w-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => onEditRow(row)}
                              title="Edit row"
                              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => onDeleteRow(row.id)}
                              title="Delete row"
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold text-slate-900">
                    <td colSpan={14} className="border-r border-slate-200 px-3 py-2.5 text-xs">
                      TOTAL ({filteredTotals.rowCount} {filteredTotals.rowCount === 1 ? 'row' : 'rows'})
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums-mono whitespace-nowrap">
                      {formatAccounting(filteredTotals.nonVatExempt)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums-mono whitespace-nowrap">
                      {formatAccounting(filteredTotals.grossOfVat)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums-mono whitespace-nowrap">
                      {formatAccounting(filteredTotals.netOfVat)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums-mono whitespace-nowrap">
                      {formatAccounting(filteredTotals.vat)}
                    </td>
                    <td className="border-r border-slate-200 px-2.5 py-2.5 text-right tabular-nums-mono whitespace-nowrap">
                      {formatAccounting(filteredTotals.total)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums-mono whitespace-nowrap">
                      {formatAccounting(filteredTotals.wtGoods1)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums-mono whitespace-nowrap">
                      {formatAccounting(filteredTotals.wtServices2)}
                    </td>
                    <td className="border-r border-slate-200 px-2.5 py-2.5 text-right tabular-nums-mono whitespace-nowrap">
                      {formatAccounting(filteredTotals.wtRental5)}
                    </td>
                    <td className="px-2.5 py-2.5 text-xs text-slate-600 whitespace-nowrap">
                      Net Payable: <span className="tabular-nums-mono font-semibold text-slate-900">{formatAccounting(filteredTotals.expectedNet)}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              /* EXACT 20-COLUMN SALES SCHEMA (WITH TWO ADDRESS COLUMNS) */
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th colSpan={9} className="border-r border-slate-700 px-3 py-2 text-[11px] font-semibold tracking-wide">
                      SALES LEDGER RECORD
                    </th>
                    <th colSpan={5} className="border-r border-slate-700 px-3 py-2 text-center text-[11px] font-semibold tracking-wide">
                      VAT &amp; EXEMPT BREAKDOWN
                    </th>
                    <th colSpan={4} className="border-r border-slate-700 bg-slate-800 px-3 py-2 text-center text-[11px] font-semibold tracking-wide">
                      WITHHOLDING TAX
                    </th>
                    <th className="border-r border-slate-700 px-3 py-2 text-right text-[11px] font-semibold tracking-wide">
                      ACTUAL
                    </th>
                    <th className="border-r border-slate-700 px-3 py-2 text-[11px] font-semibold tracking-wide">
                      REMARKS
                    </th>
                    <th className="px-3 py-2 text-center text-[11px] font-semibold tracking-wide">
                      ACTIONS
                    </th>
                  </tr>

                  <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                    <th className="px-2.5 py-2 font-semibold whitespace-nowrap">DATE</th>
                    <th className="px-2.5 py-2 font-semibold whitespace-nowrap">MONTH</th>
                    <th className="px-2.5 py-2 font-semibold whitespace-nowrap">BRANCH/ TRADE NAME</th>
                    <th className="px-2.5 py-2 font-semibold whitespace-nowrap">{entityHeader}</th>
                    <th className="px-2.5 py-2 font-semibold whitespace-nowrap">TIN</th>
                    <th className="px-2.5 py-2 font-semibold whitespace-nowrap">BRGY / MUNICIPALITY</th>
                    <th className="px-2.5 py-2 font-semibold whitespace-nowrap">CITY / DISTRICT</th>
                    <th className="px-2.5 py-2 font-semibold whitespace-nowrap">GOODS, SERVICES OR RENTAL</th>
                    <th className="border-r border-slate-200 px-2.5 py-2 font-semibold whitespace-nowrap">PRIVATE OR GOVT</th>
                    <th className="px-2.5 py-2 text-right font-semibold whitespace-nowrap">NON-VAT/VAT EXEMPT</th>
                    <th className="px-2.5 py-2 text-right font-semibold whitespace-nowrap">GROSS OF VAT</th>
                    <th className="px-2.5 py-2 text-right font-semibold whitespace-nowrap">NET OF VAT</th>
                    <th className="px-2.5 py-2 text-right font-semibold whitespace-nowrap">VAT</th>
                    <th className="border-r border-slate-200 px-2.5 py-2 text-right font-semibold whitespace-nowrap">TOTAL</th>
                    <th className="bg-slate-50 px-2.5 py-2 text-right font-semibold whitespace-nowrap">
                      GOODS <span className="text-slate-500">(1%)</span>
                    </th>
                    <th className="bg-slate-50 px-2.5 py-2 text-right font-semibold whitespace-nowrap">
                      SERVICES <span className="text-slate-500">(2%)</span>
                    </th>
                    <th className="bg-slate-50 px-2.5 py-2 text-right font-semibold whitespace-nowrap">
                      RENTAL <span className="text-slate-500">(5%)</span>
                    </th>
                    <th className="border-r border-slate-200 bg-slate-50 px-2.5 py-2 text-right font-semibold whitespace-nowrap">
                      VAT <span className="text-slate-500">(5%)</span>
                    </th>
                    <th className="border-r border-slate-200 px-2.5 py-2 text-right font-semibold whitespace-nowrap">
                      COLLECTED
                    </th>
                    <th className="border-r border-slate-200 px-2.5 py-2 font-semibold whitespace-nowrap">NOTES</th>
                    <th className="px-2.5 py-2 text-center font-semibold whitespace-nowrap">AUDIT &amp; TOOLS</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200">
                  {filteredRows.map((row) => {
                    const issues = rowAudits.get(row.id) ?? [];
                    const hasError = issues.some((i) => i.severity === 'error');
                    const hasMathFix = issues.some((i) => i.canAutoFix);
                    const expectedActual = getRowExpectedActual(row, 'SALES');

                    return (
                      <tr
                        key={row.id}
                        className={`h-10 transition-colors hover:bg-blue-50/40 ${
                          issues.length > 0 ? 'bg-amber-50/35' : 'bg-white'
                        }`}
                      >
                        <td className="px-2.5 py-2 tabular-nums-mono whitespace-nowrap text-slate-800">
                          {row.date || '-'}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap font-medium text-slate-700">
                          {row.month || '-'}
                        </td>
                        <td className="px-2.5 py-2 max-w-[140px] truncate text-slate-700" title={row.branchTradeName}>
                          {row.branchTradeName || '-'}
                        </td>
                        <td className="px-2.5 py-2 max-w-[200px] truncate font-medium text-slate-900" title={row.payor}>
                          {row.payor || '-'}
                        </td>
                        <td className="px-2.5 py-2 tabular-nums-mono whitespace-nowrap text-slate-700">
                          {row.tin || '-'}
                        </td>
                        <td className="px-2.5 py-2 max-w-[170px] truncate text-slate-600" title={row.address}>
                          {row.address || '-'}
                        </td>
                        <td className="px-2.5 py-2 max-w-[150px] truncate text-slate-600" title={row.address2 ?? ''}>
                          {row.address2 || '-'}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap font-medium text-slate-800">
                          {row.category}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 whitespace-nowrap font-medium text-slate-700">
                          {row.privateOrGovt}
                        </td>

                        <td className="px-2.5 py-2 text-right tabular-nums-mono whitespace-nowrap text-slate-800">
                          {formatAccounting(row.nonVatExempt)}
                        </td>
                        <td className="px-2.5 py-2 text-right tabular-nums-mono whitespace-nowrap text-slate-800">
                          {formatAccounting(row.grossOfVat)}
                        </td>
                        <td className="px-2.5 py-2 text-right tabular-nums-mono whitespace-nowrap text-slate-700">
                          {formatAccounting(row.netOfVat)}
                        </td>
                        <td className="px-2.5 py-2 text-right tabular-nums-mono whitespace-nowrap text-slate-700">
                          {formatAccounting(row.vat)}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-right tabular-nums-mono whitespace-nowrap font-semibold text-slate-900">
                          {formatAccounting(row.total)}
                        </td>

                        <td className="bg-slate-50/50 px-2.5 py-2 text-right tabular-nums-mono whitespace-nowrap text-slate-700">
                          {formatAccounting(row.wtGoods1)}
                        </td>
                        <td className="bg-slate-50/50 px-2.5 py-2 text-right tabular-nums-mono whitespace-nowrap text-slate-700">
                          {formatAccounting(row.wtServices2)}
                        </td>
                        <td className="bg-slate-50/50 px-2.5 py-2 text-right tabular-nums-mono whitespace-nowrap text-slate-700">
                          {formatAccounting(row.wtRental5)}
                        </td>
                        <td className="border-r border-slate-200 bg-slate-50/50 px-2.5 py-2 text-right tabular-nums-mono whitespace-nowrap text-slate-700">
                          {formatAccounting(row.wtVat5)}
                        </td>

                        <td className="border-r border-slate-200 px-2.5 py-2 text-right tabular-nums-mono whitespace-nowrap font-semibold text-slate-900">
                          <div className="flex items-center justify-end gap-1.5">
                            <span>{formatAccounting(row.actual)}</span>
                            {row.actual === null && expectedActual !== null && (
                              <button
                                type="button"
                                onClick={() => onComputeActualRow(row)}
                                title={`Compute Expected Actual (${formatAccounting(expectedActual)})`}
                                className="rounded p-0.5 text-blue-600 hover:bg-blue-50 cursor-pointer"
                              >
                                <Calculator className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </td>

                        <td className="border-r border-slate-200 px-2.5 py-2 max-w-[180px] truncate text-slate-600" title={row.remarks}>
                          {row.remarks || '-'}
                        </td>

                        <td className="px-2.5 py-1.5 whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            {issues.length > 0 ? (
                              <span
                                title={issues.map((i) => i.message).join('\n')}
                                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                                  hasError ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                <AlertTriangle className="h-3 w-3" />
                                {issues.length}
                              </span>
                            ) : (
                              <span title="Audit passed" className="text-emerald-600 px-1">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </span>
                            )}

                            {hasMathFix && (
                              <button
                                type="button"
                                onClick={() => onFixMathRow(row)}
                                title="Auto-fix VAT & Withholding Tax math"
                                className="rounded p-1 text-amber-700 hover:bg-amber-100 cursor-pointer"
                              >
                                <Wrench className="h-3.5 w-3.5" />
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => onDuplicateNextCategory(row)}
                              title="Duplicate Row (Next Category)"
                              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-blue-700 cursor-pointer"
                            >
                              <CopyPlus className="h-3.5 w-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => onEditRow(row)}
                              title="Edit row"
                              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => onDeleteRow(row.id)}
                              title="Delete row"
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold text-slate-900">
                    <td colSpan={9} className="border-r border-slate-200 px-3 py-2.5 text-xs">
                      TOTAL ({filteredTotals.rowCount} {filteredTotals.rowCount === 1 ? 'row' : 'rows'})
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums-mono whitespace-nowrap">
                      {formatAccounting(filteredTotals.nonVatExempt)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums-mono whitespace-nowrap">
                      {formatAccounting(filteredTotals.grossOfVat)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums-mono whitespace-nowrap">
                      {formatAccounting(filteredTotals.netOfVat)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums-mono whitespace-nowrap">
                      {formatAccounting(filteredTotals.vat)}
                    </td>
                    <td className="border-r border-slate-200 px-2.5 py-2.5 text-right tabular-nums-mono whitespace-nowrap">
                      {formatAccounting(filteredTotals.total)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums-mono whitespace-nowrap">
                      {formatAccounting(filteredTotals.wtGoods1)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums-mono whitespace-nowrap">
                      {formatAccounting(filteredTotals.wtServices2)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums-mono whitespace-nowrap">
                      {formatAccounting(filteredTotals.wtRental5)}
                    </td>
                    <td className="border-r border-slate-200 px-2.5 py-2.5 text-right tabular-nums-mono whitespace-nowrap">
                      {formatAccounting(filteredTotals.wtVat5)}
                    </td>
                    <td className="border-r border-slate-200 px-2.5 py-2.5 text-right tabular-nums-mono whitespace-nowrap">
                      {formatAccounting(filteredTotals.actual)}
                    </td>
                    <td colSpan={2} className="px-3 py-2.5 text-xs text-slate-600 whitespace-nowrap">
                      Expected Net: <span className="tabular-nums-mono font-semibold text-slate-900">{formatAccounting(filteredTotals.expectedNet)}</span>
                      <span aria-hidden="true"> · </span>
                      Variance: <span className={`tabular-nums-mono font-semibold ${Math.abs(filteredTotals.variance) > 0.01 ? 'text-amber-700' : 'text-emerald-700'}`}>{formatAccounting(filteredTotals.variance)}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  );
};
