import React, { useEffect, useRef, useState } from 'react';
import {
  Calculator,
  ChevronDown,
  ListPlus,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  EntityType,
  LedgerMode,
  LedgerRow,
  PayeeClassification,
  SplitLineDraft,
  TaxStatus,
  TransactionCategory,
  YesNo,
} from '../types/tax';
import {
  FILING_MONTHS,
  calculateRowTaxes,
  deriveMonthFromDate,
  formatAccounting,
  formatDateSlash,
  formatPlainInput,
  formatTin,
  getDefaultDateForCover,
  isValidTinDigits,
  normalizeTinDigits,
  parseAmount,
  round2,
  toIsoDateInput,
} from '../utils/taxEngine';

import { DEFAULT_ACCOUNT_TITLES } from '../utils/clientStorage';

interface EntryComposerProps {
  clientKey: string;
  mode: LedgerMode;
  modeLabel?: string;
  coveredMonth: string;
  coveredYear: string;
  accountTitles: string[];
  onUpdateAccountTitles: (titles: string[]) => void;
  autoCalcEnabled: boolean;
  onToggleAutoCalc: (val: boolean) => void;
  editingRow: LedgerRow | null;
  onCancelEdit: () => void;
  onSaveRows: (rows: LedgerRow[], replaceRowId?: string) => void;
}

function parseAccountTitleLines(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\r\n,;]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function createDraftLine(
  category: TransactionCategory = 'GOODS',
  privateOrGovt: EntityType = 'PRIVATE',
  taxStatus: TaxStatus = 'VATABLE',
  accountTitle = '',
  particular = ''
): SplitLineDraft {
  return {
    key: `line-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    category,
    taxStatus,
    rawAmount: '',
    applyGovtVat5: privateOrGovt === 'GOVT',
    manualOverride: false,
    particular,
    accountTitle,
    nonVatExempt: null,
    grossOfVat: null,
    netOfVat: null,
    vat: null,
    total: null,
    wtGoods1: null,
    wtServices2: null,
    wtRental5: null,
    wtVat5: null,
    rawActual: '',
    remarks: '',
  };
}

function draftFromRow(row: LedgerRow): SplitLineDraft {
  const isVatable = (row.grossOfVat ?? 0) > 0;
  return {
    key: row.id,
    category: row.category,
    taxStatus: isVatable ? 'VATABLE' : 'NON_VAT',
    rawAmount: formatPlainInput(isVatable ? row.grossOfVat : row.nonVatExempt),
    applyGovtVat5: row.applyGovtVat5,
    manualOverride: row.manualOverride,
    particular: row.particular ?? '',
    accountTitle: row.accountTitle ?? '',
    nonVatExempt: row.nonVatExempt,
    grossOfVat: row.grossOfVat,
    netOfVat: row.netOfVat,
    vat: row.vat,
    total: row.total,
    wtGoods1: row.wtGoods1,
    wtServices2: row.wtServices2,
    wtRental5: row.wtRental5,
    wtVat5: row.wtVat5,
    rawActual: formatPlainInput(row.actual),
    remarks: row.remarks,
  };
}

export const EntryComposer: React.FC<EntryComposerProps> = ({
  clientKey,
  mode,
  modeLabel,
  coveredMonth,
  coveredYear,
  accountTitles,
  onUpdateAccountTitles,
  autoCalcEnabled,
  onToggleAutoCalc,
  editingRow,
  onCancelEdit,
  onSaveRows,
}) => {
  const [entryType, setEntryType] = useState<'SINGLE' | 'SPLIT'>('SINGLE');
  const [date, setDate] = useState<string>(() => getDefaultDateForCover(coveredMonth, coveredYear));
  const [month, setMonth] = useState<string>(() =>
    coveredMonth !== 'ALL'
      ? coveredMonth
      : deriveMonthFromDate(toIsoDateInput(getDefaultDateForCover(coveredMonth, coveredYear))) || 'JANUARY'
  );
  const [tin, setTin] = useState<string>('');
  const [payor, setPayor] = useState<string>('');
  const [branchTradeName, setBranchTradeName] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [address2, setAddress2] = useState<string>('');
  const [privateOrGovt, setPrivateOrGovt] = useState<EntityType>('PRIVATE');

  // Purchases-specific header fields
  const [payeeClassification, setPayeeClassification] = useState<PayeeClassification>('CORP');
  const [supportingDocs, setSupportingDocs] = useState<string>('SALES INVOICE');
  const [referenceNo, setReferenceNo] = useState<string>('');
  const [withholdingAgent, setWithholdingAgent] = useState<YesNo>('YES');

  const [lines, setLines] = useState<SplitLineDraft[]>([createDraftLine('GOODS', 'PRIVATE', 'VATABLE')]);
  const [formError, setFormError] = useState<string>('');

  const [openAccountDropdownKey, setOpenAccountDropdownKey] = useState<string | null>(null);
  const [showAccountListModal, setShowAccountListModal] = useState(false);
  const [accountListTargetKey, setAccountListTargetKey] = useState<string | null>(null);
  const [newAccountInput, setNewAccountInput] = useState('');
  const [bulkAccountInput, setBulkAccountInput] = useState('');

  const tinInputRef = useRef<HTMLInputElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const accountDropdownRef = useRef<HTMLDivElement>(null);

  const entityLabel = mode === 'SALES' ? 'PAYOR' : 'PAYEE/SUPPLIER';
  const displayModeLabel = modeLabel ?? (mode === 'PURCHASES' ? 'EXPENSES' : 'SALES');

  // Reset form drafts whenever active client directory switches
  useEffect(() => {
    const nextDate = getDefaultDateForCover(coveredMonth, coveredYear);
    setDate(nextDate);
    setMonth(
      coveredMonth !== 'ALL'
        ? coveredMonth
        : deriveMonthFromDate(nextDate) || 'JANUARY'
    );
    setTin('');
    setPayor('');
    setBranchTradeName('');
    setAddress('');
    setAddress2('');
    setPrivateOrGovt('PRIVATE');
    setReferenceNo('');
    setOpenAccountDropdownKey(null);
    setShowAccountListModal(false);
    setLines([createDraftLine('GOODS', 'PRIVATE', 'VATABLE')]);
    setFormError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientKey]);

  // Sync default filing date & month when active Month Cover changes (without wiping typed lines)
  useEffect(() => {
    if (editingRow) return;
    const nextDate = getDefaultDateForCover(coveredMonth, coveredYear);
    setDate(nextDate);
    setMonth(
      coveredMonth !== 'ALL'
        ? coveredMonth
        : deriveMonthFromDate(nextDate) || 'JANUARY'
    );
  }, [coveredMonth, coveredYear, editingRow]);

  // Populate when editing an existing row
  useEffect(() => {
    if (editingRow) {
      setEntryType('SINGLE');
      setDate(editingRow.date);
      setMonth(editingRow.month);
      setTin(editingRow.tin);
      setPayor(editingRow.payor);
      setBranchTradeName(editingRow.branchTradeName);
      setAddress(editingRow.address);
      setAddress2(editingRow.address2 ?? '');
      setPrivateOrGovt(editingRow.privateOrGovt);
      setPayeeClassification(editingRow.payeeClassification ?? 'N/A');
      setSupportingDocs(editingRow.supportingDocs ?? '');
      setReferenceNo(editingRow.referenceNo ?? '');
      setWithholdingAgent(editingRow.withholdingAgent ?? 'YES');
      setLines([draftFromRow(editingRow)]);
      setFormError('');
    }
  }, [editingRow]);

  // Recompute lines when switching SALES <-> PURCHASES
  useEffect(() => {
    if (!editingRow) {
      setLines((prev) =>
        prev.map((ln) => {
          const safeCat: TransactionCategory =
            mode === 'SALES' && ln.category === 'N/A' ? 'GOODS' : ln.category;
          return recomputeDraftLine({ ...ln, category: safeCat }, privateOrGovt, withholdingAgent);
        })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (accountDropdownRef.current && !accountDropdownRef.current.contains(e.target as Node)) {
        setOpenAccountDropdownKey(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const addAccountTitleToList = (title: string) => {
    const clean = title.trim().toUpperCase();
    if (!clean) return;
    if (!accountTitles.includes(clean)) {
      onUpdateAccountTitles([...accountTitles, clean]);
    }
  };

  const removeAccountTitleFromList = (title: string) => {
    onUpdateAccountTitles(accountTitles.filter((t) => t !== title));
  };

  const recomputeDraftLine = (
    draft: SplitLineDraft,
    entityType: EntityType = privateOrGovt,
    whtAgent: YesNo = withholdingAgent
  ): SplitLineDraft => {
    if (!autoCalcEnabled || draft.manualOverride) return draft;
    const amt = parseAmount(draft.rawAmount);
    const calc = calculateRowTaxes({
      mode,
      category: draft.category,
      privateOrGovt: entityType,
      taxStatus: draft.taxStatus,
      amount: amt,
      applyGovtVat5: mode === 'SALES' && entityType === 'GOVT' ? draft.applyGovtVat5 : false,
      withholdingAgent: whtAgent,
    });
    return {
      ...draft,
      nonVatExempt: calc.nonVatExempt,
      grossOfVat: calc.grossOfVat,
      netOfVat: calc.netOfVat,
      vat: calc.vat,
      total: calc.total,
      wtGoods1: calc.wtGoods1,
      wtServices2: calc.wtServices2,
      wtRental5: calc.wtRental5,
      wtVat5: calc.wtVat5,
    };
  };

  const handleTinChange = (rawVal: string) => {
    setTin(formatTin(rawVal));
  };

  const updateLine = (key: string, patch: Partial<SplitLineDraft>, forceRecalc = false) => {
    setLines((prev) =>
      prev.map((ln) => {
        if (ln.key !== key) return ln;
        const merged = { ...ln, ...patch };
        if (forceRecalc || (autoCalcEnabled && !merged.manualOverride)) {
          return recomputeDraftLine(merged, privateOrGovt, withholdingAgent);
        }
        return merged;
      })
    );
  };

  const handleEntityTypeChange = (nextType: EntityType) => {
    setPrivateOrGovt(nextType);
    setLines((prev) =>
      prev.map((ln) =>
        recomputeDraftLine(
          { ...ln, applyGovtVat5: nextType === 'GOVT' },
          nextType,
          withholdingAgent
        )
      )
    );
  };

  const handleWithholdingAgentChange = (nextAgent: YesNo) => {
    setWithholdingAgent(nextAgent);
    setLines((prev) =>
      prev.map((ln) => recomputeDraftLine(ln, privateOrGovt, nextAgent))
    );
  };

  const handleComputeExpectedActual = (key: string) => {
    setLines((prev) =>
      prev.map((ln) => {
        if (ln.key !== key) return ln;
        const total = ln.total ?? 0;
        const totalWht =
          (ln.wtGoods1 ?? 0) +
          (ln.wtServices2 ?? 0) +
          (ln.wtRental5 ?? 0) +
          (ln.wtVat5 ?? 0);
        const expected = total > 0 ? round2(total - totalWht) : null;
        return {
          ...ln,
          rawActual: expected !== null ? expected.toFixed(2) : '',
        };
      })
    );
  };

  const handleAddSplitLine = () => {
    if (lines.length >= 3) return;
    const used = new Set(lines.map((l) => l.category));
    const nextCat: TransactionCategory = !used.has('SERVICES')
      ? 'SERVICES'
      : !used.has('RENTAL')
      ? 'RENTAL'
      : 'GOODS';
    setLines((prev) => [
      ...prev,
      createDraftLine(nextCat, privateOrGovt, 'VATABLE', prev[0]?.accountTitle ?? '', prev[0]?.particular ?? ''),
    ]);
  };

  const handleRemoveSplitLine = (key: string) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  const resetFormAfterSave = () => {
    const nextDate = getDefaultDateForCover(coveredMonth, coveredYear);
    setDate(nextDate);
    setMonth(
      coveredMonth !== 'ALL'
        ? coveredMonth
        : deriveMonthFromDate(nextDate) || 'JANUARY'
    );
    setTin('');
    setPayor('');
    setBranchTradeName('');
    setAddress('');
    setAddress2('');
    setPrivateOrGovt('PRIVATE');
    setReferenceNo('');
    setLines([createDraftLine('GOODS', 'PRIVATE', 'VATABLE')]);
    setFormError('');
    tinInputRef.current?.focus();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!date.trim()) {
      setFormError('Please enter a transaction date.');
      return;
    }
    if (!payor.trim()) {
      setFormError(`Please enter the ${entityLabel} name.`);
      return;
    }

    const validLines = lines.filter(
      (ln) =>
        parseAmount(ln.rawAmount) !== null ||
        (ln.total ?? 0) > 0 ||
        parseAmount(ln.rawActual) !== null
    );

    if (validLines.length === 0) {
      setFormError('Enter an amount on at least one transaction line.');
      amountInputRef.current?.focus();
      return;
    }

    const now = new Date().toISOString();
    const splitGroupId = validLines.length > 1 ? `split-${Date.now()}` : undefined;
    const formattedTin = formatTin(tin);

    const newRows: LedgerRow[] = validLines.map((ln, idx) => {
      const actualParsed = parseAmount(ln.rawActual);
      return {
        id: editingRow ? editingRow.id : `row-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        splitGroupId: editingRow?.splitGroupId ?? splitGroupId,
        date: formatDateSlash(date),
        month: (month || deriveMonthFromDate(date)).trim().toUpperCase(),
        branchTradeName: branchTradeName.trim().toUpperCase(),
        payor: payor.trim().toUpperCase(),
        tin: formattedTin,
        address: address.trim().toUpperCase(),
        address2: address2.trim().toUpperCase(),
        category: ln.category,
        privateOrGovt,
        payeeClassification: mode === 'PURCHASES' ? payeeClassification : undefined,
        supportingDocs: mode === 'PURCHASES' ? supportingDocs.trim().toUpperCase() : undefined,
        referenceNo: mode === 'PURCHASES' ? referenceNo.trim() : undefined,
        particular: mode === 'PURCHASES' ? ln.particular.trim().toUpperCase() : undefined,
        accountTitle: mode === 'PURCHASES' ? ln.accountTitle.trim().toUpperCase() : undefined,
        withholdingAgent: mode === 'PURCHASES' ? withholdingAgent : undefined,
        nonVatExempt: ln.nonVatExempt,
        grossOfVat: ln.grossOfVat,
        netOfVat: ln.netOfVat,
        vat: ln.vat,
        total: ln.total,
        wtGoods1: ln.wtGoods1,
        wtServices2: ln.wtServices2,
        wtRental5: ln.wtRental5,
        wtVat5: mode === 'SALES' ? ln.wtVat5 : null,
        actual: mode === 'SALES' ? actualParsed : null,
        remarks: mode === 'SALES' ? ln.remarks.trim() : '',
        applyGovtVat5: mode === 'SALES' && privateOrGovt === 'GOVT' ? ln.applyGovtVat5 : false,
        manualOverride: ln.manualOverride,
        createdAt: editingRow?.createdAt ?? now,
        updatedAt: now,
      };
    });

    if (mode === 'PURCHASES') {
      validLines.forEach((ln) => {
        const acct = ln.accountTitle.trim().toUpperCase();
        if (acct) addAccountTitleToList(acct);
      });
    }

    onSaveRows(newRows, editingRow?.id);
    if (editingRow) {
      onCancelEdit();
    } else {
      resetFormAfterSave();
    }
  };

  const tinDigits = normalizeTinDigits(tin);
  const categoryOptions: TransactionCategory[] =
    mode === 'PURCHASES'
      ? ['N/A', 'GOODS', 'SERVICES', 'RENTAL']
      : ['GOODS', 'SERVICES', 'RENTAL'];

  return (
    <section className="rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/70 px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            {editingRow ? `Edit ${displayModeLabel} Entry` : `Encode ${displayModeLabel} Transaction`}
          </h2>
          <span className="rounded-lg bg-[#E7F0FC] px-2.5 py-0.5 text-[11px] font-semibold text-[#0B4DA2]">
            Cover: {coveredMonth === 'ALL' ? (coveredYear === 'ALL' ? 'ALL MONTHS' : `ALL MONTHS ${coveredYear}`) : coveredYear === 'ALL' ? coveredMonth : `${coveredMonth} ${coveredYear}`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoCalcEnabled}
              onChange={(e) => {
                const next = e.target.checked;
                onToggleAutoCalc(next);
                if (next) {
                  setLines((prev) =>
                    prev.map((ln) =>
                      recomputeDraftLine({ ...ln, manualOverride: false }, privateOrGovt, withholdingAgent)
                    )
                  );
                }
              }}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span>Auto-Calculate VAT &amp; WHT</span>
          </label>

          {editingRow && (
            <button
              type="button"
              onClick={onCancelEdit}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
              Cancel Edit
            </button>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} autoComplete="off" className="p-5 space-y-5">
        {/* Shared Transaction Header */}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-12">
          {/* Date */}
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              DATE <span className="text-red-600">*</span>
            </label>
            <div className="flex gap-1">
              <input
                type="text"
                autoComplete="off"
                value={date}
                onChange={(e) => {
                  const val = e.target.value;
                  setDate(val);
                  const derived = deriveMonthFromDate(val);
                  if (derived) setMonth(derived);
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm tabular-nums-mono text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
              <input
                type="date"
                value={toIsoDateInput(date)}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const slash = formatDateSlash(e.target.value);
                  setDate(slash);
                  const derived = deriveMonthFromDate(e.target.value);
                  if (derived) setMonth(derived);
                }}
                aria-label="Pick date"
                className="w-9 shrink-0 rounded-lg border border-slate-300 bg-slate-50 px-1.5 text-xs text-slate-700 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Month */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between gap-1 mb-1">
              <label className="block text-xs font-medium text-slate-600">MONTH</label>
              {coveredMonth !== 'ALL' && month && month !== coveredMonth && (
                <span className="text-[10px] font-semibold text-amber-700">
                  Outside cover
                </span>
              )}
            </div>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value.toUpperCase())}
              aria-label="Filing month"
              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-medium text-slate-900 uppercase focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            >
              {!FILING_MONTHS.includes(month as (typeof FILING_MONTHS)[number]) && month && (
                <option value={month}>{month}</option>
              )}
              {FILING_MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* TIN */}
          <div className="lg:col-span-3">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-600">
                TIN
              </label>
              {tinDigits.length > 0 && !isValidTinDigits(tinDigits) && (
                <span className="text-[11px] font-medium text-amber-700">
                  {tinDigits.length}/9 or 12 digits
                </span>
              )}
            </div>
            <div>
              <input
                ref={tinInputRef}
                type="text"
                autoComplete="off"
                value={tin}
                onChange={(e) => handleTinChange(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums-mono text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
            </div>
          </div>

          {/* PAYOR / PAYEE/SUPPLIER */}
          <div className="lg:col-span-3">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {entityLabel} <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              autoComplete="off"
              value={payor}
              onChange={(e) => setPayor(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 uppercase focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          {/* Mode-specific Header Toggle: PRIVATE OR GOVT (Sales) OR CLASSIFICATION (Purchases) */}
          {mode === 'SALES' ? (
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                PRIVATE OR GOVT
              </label>
              <div className="grid grid-cols-2 rounded-lg border border-slate-300 bg-slate-50 p-0.5">
                {(['PRIVATE', 'GOVT'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleEntityTypeChange(type)}
                    className={`rounded-md py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                      privateOrGovt === type
                        ? type === 'GOVT'
                          ? 'bg-slate-900 text-white'
                          : 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1 truncate" title="CLASSIFICATION OF PAYEE/SUPPLIER (N/A, INDIVIDUAL OR CORP)">
                CLASSIFICATION
              </label>
              <select
                value={payeeClassification}
                onChange={(e) => setPayeeClassification(e.target.value as PayeeClassification)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                <option value="N/A">N/A</option>
                <option value="INDIVIDUAL">INDIVIDUAL</option>
                <option value="CORP">CORP</option>
              </select>
            </div>
          )}

          {/* BRANCH / TRADE NAME */}
          <div className={mode === 'PURCHASES' ? 'sm:col-span-1 lg:col-span-3' : 'sm:col-span-1 lg:col-span-4'}>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              BRANCH/ TRADE NAME
            </label>
            <input
              type="text"
              autoComplete="off"
              value={branchTradeName}
              onChange={(e) => setBranchTradeName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 uppercase focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          {/* ADDRESS 1: BARANGAY / MUNICIPALITY */}
          <div className={mode === 'PURCHASES' ? 'sm:col-span-1 lg:col-span-3' : 'sm:col-span-1 lg:col-span-4'}>
            <label className="block text-xs font-medium text-slate-600 mb-1 truncate">
              ADDRESS 1 (BARANGAY / MUNICIPALITY)
            </label>
            <input
              type="text"
              autoComplete="off"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 uppercase focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          {/* ADDRESS 2: CITY / DISTRICT */}
          <div className={mode === 'PURCHASES' ? 'sm:col-span-1 lg:col-span-2' : 'sm:col-span-1 lg:col-span-4'}>
            <label className="block text-xs font-medium text-slate-600 mb-1 truncate">
              ADDRESS 2 (CITY / DISTRICT)
            </label>
            <input
              type="text"
              autoComplete="off"
              value={address2}
              onChange={(e) => setAddress2(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 uppercase focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          {/* PURCHASES-only: SUPPORTING DOCS, REFERENCE NO., WITHHOLDING AGENT */}
          {mode === 'PURCHASES' && (
            <>
              <div className="lg:col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  SUPPORTING DOCS
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  value={supportingDocs}
                  onChange={(e) => setSupportingDocs(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 uppercase focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="lg:col-span-1">
                <label className="block text-xs font-medium text-slate-600 mb-1 truncate">
                  REFERENCE NO.
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm tabular-nums-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="lg:col-span-1">
                <label className="block text-xs font-medium text-slate-600 mb-1 truncate" title="WITHHOLDING AGENT (YES OR NO)">
                  WHT AGENT
                </label>
                <div className="grid grid-cols-2 rounded-lg border border-slate-300 bg-slate-50 p-0.5">
                  {(['YES', 'NO'] as const).map((yn) => (
                    <button
                      key={yn}
                      type="button"
                      onClick={() => handleWithholdingAgentChange(yn)}
                      className={`rounded-md py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                        withholdingAgent === yn
                          ? yn === 'YES'
                            ? 'bg-blue-700 text-white'
                            : 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {yn}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Line Items */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {entryType === 'SPLIT'
                ? `Split Invoice Breakdown (${lines.length} of 3 lines)`
                : 'Transaction Amounts & Tax Computation'}
            </h3>
            {entryType === 'SPLIT' && lines.length < 3 && (
              <button
                type="button"
                onClick={handleAddSplitLine}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Breakdown Line
              </button>
            )}
          </div>

          <div className="space-y-3">
            {lines.map((ln, idx) => {
              const totalWht =
                (ln.wtGoods1 ?? 0) +
                (ln.wtServices2 ?? 0) +
                (ln.wtRental5 ?? 0) +
                (ln.wtVat5 ?? 0);
              const expectedActual =
                ln.total !== null ? round2(ln.total - totalWht) : null;

              const activeEwtRateLabel =
                ln.category === 'GOODS'
                  ? '1%'
                  : ln.category === 'SERVICES'
                  ? '2%'
                  : ln.category === 'RENTAL'
                  ? '5%'
                  : 'N/A';

              return (
                <div
                  key={ln.key}
                  className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2.5">
                      {entryType === 'SPLIT' && (
                        <span className="text-xs font-semibold text-slate-500">
                          Line {idx + 1}
                        </span>
                      )}

                      {/* Category Selector */}
                      <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
                        {categoryOptions.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => updateLine(ln.key, { category: cat }, true)}
                            className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                              ln.category === cat
                                ? 'bg-blue-600 text-white'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>

                      {/* Tax Status Selector */}
                      <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
                        <button
                          type="button"
                          onClick={() => updateLine(ln.key, { taxStatus: 'VATABLE' }, true)}
                          className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                            ln.taxStatus === 'VATABLE'
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          VATable (12%)
                        </button>
                        <button
                          type="button"
                          onClick={() => updateLine(ln.key, { taxStatus: 'NON_VAT' }, true)}
                          className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                            ln.taxStatus === 'NON_VAT'
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Non-VAT / Exempt
                        </button>
                      </div>

                      {mode === 'SALES' && privateOrGovt === 'GOVT' && (
                        <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={ln.applyGovtVat5}
                            onChange={(e) =>
                              updateLine(ln.key, { applyGovtVat5: e.target.checked }, true)
                            }
                            className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                          />
                          Apply 5% Gov&apos;t Withholding VAT
                        </label>
                      )}

                      {mode === 'PURCHASES' && (
                        <span className="text-xs text-slate-500">
                          {withholdingAgent === 'YES' && ln.category !== 'N/A'
                            ? `Withholding ${activeEwtRateLabel} active`
                            : 'No EWT withheld'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={ln.manualOverride || !autoCalcEnabled}
                          disabled={!autoCalcEnabled}
                          onChange={(e) => {
                            const override = e.target.checked;
                            updateLine(ln.key, { manualOverride: override }, !override);
                          }}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-amber-600"
                        />
                        Manual Override
                      </label>

                      {entryType === 'SPLIT' && lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveSplitLine(ln.key)}
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                          title="Remove breakdown line"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* PURCHASES Particular & Account Title */}
                  {mode === 'PURCHASES' && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-amber-900 mb-1">
                          PARTICULAR
                        </label>
                        <input
                          type="text"
                          autoComplete="off"
                          value={ln.particular}
                          onChange={(e) => updateLine(ln.key, { particular: e.target.value })}
                          className="w-full rounded-lg border border-amber-300 bg-amber-50/40 px-3 py-1.5 text-xs text-slate-900 uppercase focus:border-blue-600 focus:bg-white focus:outline-none"
                        />
                      </div>
                      <div className="relative" ref={openAccountDropdownKey === ln.key ? accountDropdownRef : undefined}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <label className="block text-[11px] font-semibold text-amber-900">
                            ACCOUNT TITLE
                          </label>
                          <div className="flex items-center gap-2">
                            {ln.accountTitle.trim() &&
                              !accountTitles.includes(ln.accountTitle.trim().toUpperCase()) && (
                                <button
                                  type="button"
                                  onClick={() => addAccountTitleToList(ln.accountTitle)}
                                  className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 cursor-pointer"
                                  title="Save this Account Title to your list"
                                >
                                  <Plus className="h-3 w-3" />
                                  Save
                                </button>
                              )}
                            <button
                              type="button"
                              onClick={() => {
                                setBulkAccountInput(accountTitles.join('\n'));
                                setAccountListTargetKey(ln.key);
                                setShowAccountListModal(true);
                              }}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-900 cursor-pointer"
                              title="Put or edit your list of Account Titles"
                            >
                              <ListPlus className="h-3 w-3" />
                              Manage List ({accountTitles.length})
                            </button>
                          </div>
                        </div>
                        <div className="relative">
                          <input
                            type="text"
                            value={ln.accountTitle}
                            onFocus={() => setOpenAccountDropdownKey(ln.key)}
                            onChange={(e) => {
                              updateLine(ln.key, { accountTitle: e.target.value });
                              setOpenAccountDropdownKey(ln.key);
                            }}
                            placeholder="SELECT OR TYPE ACCOUNT TITLE"
                            className="w-full rounded-lg border border-amber-300 bg-amber-50/40 pl-3 pr-8 py-1.5 text-xs text-slate-900 uppercase focus:border-blue-600 focus:bg-white focus:outline-none"
                          />
                          <button
                            type="button"
                            tabIndex={-1}
                            onClick={() =>
                              setOpenAccountDropdownKey((prev) => (prev === ln.key ? null : ln.key))
                            }
                            aria-label="Toggle account title list"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900 cursor-pointer"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {openAccountDropdownKey === ln.key && (
                          <div className="absolute left-0 right-0 z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                            {(() => {
                              const q = ln.accountTitle.trim().toUpperCase();
                              const matches = q
                                ? accountTitles.filter((t) => t.includes(q))
                                : accountTitles;
                              return (
                                <>
                                  {matches.length === 0 ? (
                                    <div className="px-3 py-2 text-[11px] text-slate-500">
                                      No matching account title in list.
                                    </div>
                                  ) : (
                                    matches.map((title) => (
                                      <button
                                        key={title}
                                        type="button"
                                        onClick={() => {
                                          updateLine(ln.key, { accountTitle: title });
                                          setOpenAccountDropdownKey(null);
                                        }}
                                        className={`flex w-full items-center justify-between border-b border-slate-100 px-3 py-1.5 text-left text-xs last:border-b-0 hover:bg-amber-50 cursor-pointer ${
                                          ln.accountTitle.trim().toUpperCase() === title
                                            ? 'bg-amber-50/70 font-semibold text-slate-900'
                                            : 'text-slate-800'
                                        }`}
                                      >
                                        <span className="truncate">{title}</span>
                                      </button>
                                    ))
                                  )}
                                  {q && !accountTitles.includes(q) && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        addAccountTitleToList(q);
                                        updateLine(ln.key, { accountTitle: q });
                                        setOpenAccountDropdownKey(null);
                                      }}
                                      className="flex w-full items-center gap-1.5 border-t border-slate-200 bg-blue-50/70 px-3 py-2 text-left text-xs font-semibold text-blue-700 hover:bg-blue-100 cursor-pointer"
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                      Add &quot;{q}&quot; to Account Title list
                                    </button>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Numeric Fields Grid */}
                  <div
                    className={`grid grid-cols-2 gap-3 sm:grid-cols-4 ${
                      mode === 'SALES' ? 'lg:grid-cols-9' : 'lg:grid-cols-7'
                    }`}
                  >
                    <div className="col-span-2">
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        {ln.taxStatus === 'VATABLE' ? 'GROSS OF VAT' : 'NON-VAT / VAT EXEMPT'}
                      </label>
                      <input
                        ref={idx === 0 ? amountInputRef : undefined}
                        type="number"
                        step="0.01"
                        min="0"
                        value={ln.rawAmount}
                        onChange={(e) => updateLine(ln.key, { rawAmount: e.target.value })}
                        placeholder="0.00"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-right text-sm tabular-nums-mono font-semibold text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                      />
                    </div>

                    {/* NET OF VAT */}
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        NET OF VAT
                      </label>
                      {ln.manualOverride || !autoCalcEnabled ? (
                        <input
                          type="number"
                          step="0.01"
                          value={formatPlainInput(ln.netOfVat)}
                          onChange={(e) => updateLine(ln.key, { netOfVat: parseAmount(e.target.value) })}
                          placeholder="-"
                          className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-right text-xs tabular-nums-mono"
                        />
                      ) : (
                        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right text-xs tabular-nums-mono text-slate-700">
                          {formatAccounting(ln.netOfVat)}
                        </div>
                      )}
                    </div>

                    {/* VAT */}
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        VAT (12%)
                      </label>
                      {ln.manualOverride || !autoCalcEnabled ? (
                        <input
                          type="number"
                          step="0.01"
                          value={formatPlainInput(ln.vat)}
                          onChange={(e) => updateLine(ln.key, { vat: parseAmount(e.target.value) })}
                          placeholder="-"
                          className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-right text-xs tabular-nums-mono"
                        />
                      ) : (
                        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right text-xs tabular-nums-mono text-slate-700">
                          {formatAccounting(ln.vat)}
                        </div>
                      )}
                    </div>

                    {/* TOTAL */}
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        TOTAL
                      </label>
                      {ln.manualOverride || !autoCalcEnabled ? (
                        <input
                          type="number"
                          step="0.01"
                          value={formatPlainInput(ln.total)}
                          onChange={(e) => updateLine(ln.key, { total: parseAmount(e.target.value) })}
                          placeholder="-"
                          className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-right text-xs tabular-nums-mono font-semibold"
                        />
                      ) : (
                        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right text-xs tabular-nums-mono font-semibold text-slate-900">
                          {formatAccounting(ln.total)}
                        </div>
                      )}
                    </div>

                    {/* EWT (1% / 2% / 5%) */}
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        EWT ({activeEwtRateLabel})
                      </label>
                      {ln.manualOverride || !autoCalcEnabled ? (
                        <input
                          type="number"
                          step="0.01"
                          value={formatPlainInput(
                            ln.category === 'GOODS'
                              ? ln.wtGoods1
                              : ln.category === 'SERVICES'
                              ? ln.wtServices2
                              : ln.category === 'RENTAL'
                              ? ln.wtRental5
                              : null
                          )}
                          onChange={(e) => {
                            const val = parseAmount(e.target.value);
                            if (ln.category === 'GOODS') updateLine(ln.key, { wtGoods1: val });
                            else if (ln.category === 'SERVICES') updateLine(ln.key, { wtServices2: val });
                            else if (ln.category === 'RENTAL') updateLine(ln.key, { wtRental5: val });
                          }}
                          placeholder="-"
                          className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-right text-xs tabular-nums-mono"
                        />
                      ) : (
                        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right text-xs tabular-nums-mono text-slate-700">
                          {formatAccounting(
                            ln.category === 'GOODS'
                              ? ln.wtGoods1
                              : ln.category === 'SERVICES'
                              ? ln.wtServices2
                              : ln.category === 'RENTAL'
                              ? ln.wtRental5
                              : null
                          )}
                        </div>
                      )}
                    </div>

                    {/* NET PAYABLE READOUT IN PURCHASES */}
                    {mode === 'PURCHASES' && (
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1">
                          NET PAYABLE
                        </label>
                        <div className="rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-right text-xs tabular-nums-mono font-semibold text-slate-900">
                          {formatAccounting(expectedActual)}
                        </div>
                      </div>
                    )}

                    {/* SALES-only: WHT VAT (5%) & ACTUAL */}
                    {mode === 'SALES' && (
                      <>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">
                            WHT VAT (5%)
                          </label>
                          {ln.manualOverride || !autoCalcEnabled ? (
                            <input
                              type="number"
                              step="0.01"
                              value={formatPlainInput(ln.wtVat5)}
                              onChange={(e) => updateLine(ln.key, { wtVat5: parseAmount(e.target.value) })}
                              placeholder="-"
                              className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-right text-xs tabular-nums-mono"
                            />
                          ) : (
                            <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right text-xs tabular-nums-mono text-slate-700">
                              {formatAccounting(ln.wtVat5)}
                            </div>
                          )}
                        </div>

                        <div className="col-span-2">
                          <div className="flex items-center justify-between mb-1">
                            <label className="block text-[11px] font-medium text-slate-600">
                              ACTUAL
                            </label>
                            <button
                              type="button"
                              onClick={() => handleComputeExpectedActual(ln.key)}
                              disabled={expectedActual === null}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-900 disabled:text-slate-400 cursor-pointer"
                              title="Set ACTUAL = TOTAL - Total Withholding Taxes"
                            >
                              <Calculator className="h-3 w-3" />
                              Compute Expected ({formatAccounting(expectedActual)})
                            </button>
                          </div>
                          <input
                            type="number"
                            step="0.01"
                            value={ln.rawActual}
                            onChange={(e) => updateLine(ln.key, { rawActual: e.target.value })}
                            placeholder="Leave blank if uncollected"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-right text-xs tabular-nums-mono font-semibold text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                          />
                        </div>
                      </>
                    )}
                  </div>

                  {/* Remarks (Sales only) */}
                  {mode === 'SALES' && (
                    <div>
                      <input
                        type="text"
                        value={ln.remarks}
                        onChange={(e) => updateLine(ln.key, { remarks: e.target.value })}
                        placeholder="Remarks (e.g., SI # / OR # / 2307 reference)"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {formError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-medium text-red-700">
            {formError}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="text-xs text-slate-500">
            Press <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">Enter</kbd> to save quickly · Zero values export as <code className="font-mono">-</code>
          </div>
          <div className="flex items-center gap-2.5">
            {!editingRow && (
              <button
                type="button"
                onClick={resetFormAfterSave}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Clear Fields
              </button>
            )}
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-xl bg-[#18181B] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {editingRow
                ? 'Save Changes'
                : entryType === 'SPLIT'
                ? `Add ${lines.length} Split Rows to ${displayModeLabel}`
                : `Add to ${displayModeLabel} Ledger`}
            </button>
          </div>
        </div>
      </form>

      {/* Account Title List Manager Modal */}
      {showAccountListModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Account Title List ({accountTitles.length})
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Put or paste your chart of account titles below (saved offline on this device)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAccountListModal(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Quick single add */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newAccountInput}
                  onChange={(e) => setNewAccountInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const clean = newAccountInput.trim().toUpperCase();
                      if (!clean) return;
                      addAccountTitleToList(clean);
                      setBulkAccountInput((prev) => {
                        const existing = parseAccountTitleLines(prev);
                        return existing.includes(clean) ? prev : [...existing, clean].join('\n');
                      });
                      setNewAccountInput('');
                    }
                  }}
                  placeholder="Add single account title (e.g. SALARIES & WAGES)"
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 uppercase focus:border-blue-600 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    const clean = newAccountInput.trim().toUpperCase();
                    if (!clean) return;
                    addAccountTitleToList(clean);
                    setBulkAccountInput((prev) => {
                      const existing = parseAccountTitleLines(prev);
                      return existing.includes(clean) ? prev : [...existing, clean].join('\n');
                    });
                    setNewAccountInput('');
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </button>
              </div>

              {/* Bulk paste / edit list */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-700">
                    Paste or Edit Full List (one per line or comma-separated)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setBulkAccountInput(DEFAULT_ACCOUNT_TITLES.join('\n'));
                    }}
                    className="text-[11px] font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Load Defaults
                  </button>
                </div>
                <textarea
                  rows={7}
                  value={bulkAccountInput}
                  onChange={(e) => setBulkAccountInput(e.target.value)}
                  placeholder={'COST OF GOODS SOLD\nFUEL & OIL\nUTILITIES EXPENSE\nRENT EXPENSE'}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 uppercase font-mono leading-relaxed focus:border-blue-600 focus:outline-none"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onUpdateAccountTitles([]);
                      setBulkAccountInput('');
                    }}
                    className="text-xs font-medium text-red-600 hover:text-red-800 cursor-pointer"
                  >
                    Clear All
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const incoming = parseAccountTitleLines(bulkAccountInput);
                        if (incoming.length === 0) return;
                        onUpdateAccountTitles(Array.from(new Set([...accountTitles, ...incoming])));
                        setShowAccountListModal(false);
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Append to List
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const nextList = parseAccountTitleLines(bulkAccountInput);
                        onUpdateAccountTitles(nextList);
                        setShowAccountListModal(false);
                      }}
                      className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                    >
                      Save List ({parseAccountTitleLines(bulkAccountInput).length})
                    </button>
                  </div>
                </div>
              </div>

              {/* Saved items quick-remove list */}
              {accountTitles.length > 0 && (
                <div className="border-t border-slate-200 pt-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
                    Saved Account Titles
                  </div>
                  <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {accountTitles.map((title) => (
                      <div
                        key={title}
                        className="flex items-center justify-between px-3 py-1.5 text-xs text-slate-800 hover:bg-slate-50"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            const targetKey = accountListTargetKey ?? lines[0]?.key;
                            if (targetKey) updateLine(targetKey, { accountTitle: title });
                            setShowAccountListModal(false);
                          }}
                          className="text-left flex-1 truncate font-medium hover:text-blue-700 cursor-pointer"
                          title="Use this Account Title"
                        >
                          {title}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            removeAccountTitleFromList(title);
                            setBulkAccountInput((prev) =>
                              parseAccountTitleLines(prev)
                                .filter((t) => t !== title)
                                .join('\n')
                            );
                          }}
                          className="ml-2 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                          title="Remove from list"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
