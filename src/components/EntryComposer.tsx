import React, { useEffect, useRef, useState } from 'react';
import {
  Calculator,
  Calendar,
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
  evaluateFormulaExpression,
  extractYearFromDate,
  formatAccounting,
  formatDateSlash,
  formatPlainInput,
  formatTin,
  getDefaultDateForCover,
  isFormulaExpression,
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
  onChangeCoveredMonth?: (month: string) => void;
  onChangeCoveredYear?: (year: string) => void;
  accountTitles: string[];
  knownRows?: LedgerRow[];
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

function getActiveEwtAmount(ln: Pick<SplitLineDraft, 'category' | 'wtGoods1' | 'wtServices2' | 'wtRental5'>): number | null {
  if (ln.category === 'GOODS') return ln.wtGoods1;
  if (ln.category === 'SERVICES') return ln.wtServices2;
  if (ln.category === 'RENTAL') return ln.wtRental5;
  return null;
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
    rawRealAmount: '',
    rawNonVat: '',
    rawAmount: '',
    rawNetOfVat: '',
    rawVat: '',
    rawTotal: '',
    rawEwt: '',
    rawWtVat5: '',
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
  const realSum = round2((row.nonVatExempt ?? 0) + (row.grossOfVat ?? 0));
  const ewtVal = getActiveEwtAmount(row);
  return {
    key: row.id,
    category: row.category,
    taxStatus: isVatable ? 'VATABLE' : 'NON_VAT',
    rawRealAmount: realSum > 0 ? formatPlainInput(realSum) : '',
    rawNonVat: formatPlainInput(row.nonVatExempt),
    rawAmount: formatPlainInput(row.grossOfVat),
    rawNetOfVat: formatPlainInput(row.netOfVat),
    rawVat: formatPlainInput(row.vat),
    rawTotal: formatPlainInput(row.total),
    rawEwt: formatPlainInput(ewtVal),
    rawWtVat5: formatPlainInput(row.wtVat5),
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

function computePurchasesEwt(
  category: TransactionCategory,
  whtAgent: YesNo,
  nonVat: number | null,
  netOfVat: number | null
): { wtGoods1: number | null; wtServices2: number | null; wtRental5: number | null; rawEwt: string } {
  const taxBase = round2((nonVat ?? 0) + (netOfVat ?? 0));
  if (taxBase <= 0 || whtAgent !== 'YES' || category === 'N/A') {
    return { wtGoods1: null, wtServices2: null, wtRental5: null, rawEwt: '' };
  }
  const wtGoods1 = category === 'GOODS' ? round2(taxBase * 0.01) : null;
  const wtServices2 = category === 'SERVICES' ? round2(taxBase * 0.02) : null;
  const wtRental5 = category === 'RENTAL' ? round2(taxBase * 0.05) : null;
  const activeVal = wtGoods1 ?? wtServices2 ?? wtRental5;
  return {
    wtGoods1,
    wtServices2,
    wtRental5,
    rawEwt: formatPlainInput(activeVal),
  };
}

export const EntryComposer: React.FC<EntryComposerProps> = ({
  clientKey,
  mode,
  modeLabel,
  coveredMonth,
  coveredYear,
  onChangeCoveredMonth,
  onChangeCoveredYear,
  accountTitles,
  knownRows = [],
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
  const [tinAutofilled, setTinAutofilled] = useState<boolean>(false);

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
    setTinAutofilled(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientKey]);

  // Sync default filing date & month when active Month Cover changes (without wiping typed lines or valid matching dates)
  useEffect(() => {
    if (editingRow) return;
    setDate((prevDate) => {
      const prevMonth = deriveMonthFromDate(prevDate);
      const prevYear = extractYearFromDate(prevDate);
      const targetMonth = coveredMonth !== 'ALL' ? coveredMonth : prevMonth || 'JANUARY';
      const monthMatches = prevMonth === targetMonth;
      const yearMatches = coveredYear === 'ALL' || prevYear === coveredYear;
      if (monthMatches && yearMatches) return prevDate;
      return getDefaultDateForCover(coveredMonth, coveredYear);
    });
    setMonth((prevMonth) => {
      if (coveredMonth !== 'ALL') return coveredMonth;
      return prevMonth || deriveMonthFromDate(getDefaultDateForCover(coveredMonth, coveredYear)) || 'JANUARY';
    });
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
      setTinAutofilled(false);
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
    const nonVatAmt = parseAmount(draft.rawNonVat);
    const grossAmt = parseAmount(draft.rawAmount);
    const calc = calculateRowTaxes({
      mode,
      category: draft.category,
      privateOrGovt: entityType,
      nonVatAmount: nonVatAmt,
      grossAmount: grossAmt,
      applyGovtVat5: mode === 'SALES' && entityType === 'GOVT' ? draft.applyGovtVat5 : false,
      withholdingAgent: whtAgent,
    });
    const activeEwt =
      draft.category === 'GOODS'
        ? calc.wtGoods1
        : draft.category === 'SERVICES'
        ? calc.wtServices2
        : draft.category === 'RENTAL'
        ? calc.wtRental5
        : null;
    return {
      ...draft,
      taxStatus: grossAmt !== null ? 'VATABLE' : 'NON_VAT',
      nonVatExempt: calc.nonVatExempt,
      grossOfVat: calc.grossOfVat,
      netOfVat: calc.netOfVat,
      vat: calc.vat,
      total: calc.total,
      rawNetOfVat: formatPlainInput(calc.netOfVat),
      rawVat: formatPlainInput(calc.vat),
      rawTotal: formatPlainInput(calc.total),
      wtGoods1: calc.wtGoods1,
      wtServices2: calc.wtServices2,
      wtRental5: calc.wtRental5,
      wtVat5: calc.wtVat5,
      rawEwt: formatPlainInput(activeEwt),
      rawWtVat5: formatPlainInput(calc.wtVat5),
    };
  };

  const findMatchingTinRow = (digits: string): LedgerRow | undefined => {
    if (!isValidTinDigits(digits) || knownRows.length === 0) return undefined;
    const candidates = knownRows.filter((r) => Boolean(r.payor?.trim()));
    const sorted = [...candidates].sort((a, b) =>
      (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
    );
    const exact = sorted.find((r) => normalizeTinDigits(r.tin) === digits);
    if (exact) return exact;
    if (digits.length === 9) {
      return sorted.find((r) => {
        const rd = normalizeTinDigits(r.tin);
        return rd.length === 12 && rd.endsWith('000') && rd.slice(0, 9) === digits;
      });
    }
    return undefined;
  };

  const handleTinChange = (rawVal: string) => {
    const formatted = formatTin(rawVal);
    setTin(formatted);
    const digits = normalizeTinDigits(formatted);
    if (editingRow || !isValidTinDigits(digits)) {
      setTinAutofilled(false);
      return;
    }
    const matched = findMatchingTinRow(digits);
    if (!matched) {
      setTinAutofilled(false);
      return;
    }
    setPayor(matched.payor || '');
    setBranchTradeName(matched.branchTradeName || '');
    setAddress(matched.address || '');
    setAddress2(matched.address2 || '');
    if (mode === 'SALES' && matched.privateOrGovt) {
      handleEntityTypeChange(matched.privateOrGovt);
    }
    if (mode === 'PURCHASES') {
      if (matched.payeeClassification) {
        setPayeeClassification(matched.payeeClassification);
      }
      if (matched.withholdingAgent) {
        handleWithholdingAgentChange(matched.withholdingAgent);
      }
    }
    setTinAutofilled(true);
  };

  const prepareLineForManualBackward = (ln: SplitLineDraft): SplitLineDraft => {
    const activeEwt = getActiveEwtAmount(ln);
    if (mode !== 'PURCHASES') {
      return {
        ...ln,
        manualOverride: true,
        rawNetOfVat: formatPlainInput(ln.netOfVat),
        rawVat: formatPlainInput(ln.vat),
        rawTotal: formatPlainInput(ln.total),
        rawEwt: formatPlainInput(activeEwt),
        rawWtVat5: formatPlainInput(ln.wtVat5),
      };
    }
    const exVatTotal = round2((ln.nonVatExempt ?? 0) + (ln.netOfVat ?? 0));
    const realSum = round2((ln.nonVatExempt ?? 0) + (ln.grossOfVat ?? 0));
    const nextTotal = exVatTotal > 0 ? exVatTotal : ln.total;
    return {
      ...ln,
      manualOverride: true,
      total: nextTotal,
      rawTotal: formatPlainInput(nextTotal),
      rawVat: formatPlainInput(ln.vat),
      rawNetOfVat: formatPlainInput(ln.netOfVat),
      rawEwt: formatPlainInput(activeEwt),
      rawRealAmount: realSum > 0 ? formatPlainInput(realSum) : (ln.rawRealAmount ?? ''),
    };
  };

  const handleToggleLineManualOverride = (key: string, override: boolean) => {
    setLines((prev) =>
      prev.map((ln) => {
        if (ln.key !== key) return ln;
        if (override) {
          return prepareLineForManualBackward(ln);
        }
        return recomputeDraftLine({ ...ln, manualOverride: false }, privateOrGovt, withholdingAgent);
      })
    );
  };

  const updateLine = (key: string, patch: Partial<SplitLineDraft>) => {
    setLines((prev) =>
      prev.map((ln) => {
        if (ln.key !== key) return ln;
        const merged = { ...ln, ...patch };
        if (autoCalcEnabled && !merged.manualOverride) {
          return recomputeDraftLine(merged, privateOrGovt, withholdingAgent);
        }
        if (mode === 'PURCHASES' && patch.category !== undefined) {
          const ewt = computePurchasesEwt(
            merged.category,
            withholdingAgent,
            merged.nonVatExempt,
            merged.netOfVat
          );
          return { ...merged, ...ewt };
        }
        if (mode === 'SALES' && patch.category !== undefined) {
          return { ...merged, rawEwt: formatPlainInput(getActiveEwtAmount(merged)) };
        }
        return merged;
      })
    );
  };

  const commitFormulaInput = (raw: string, applyValue: (resolved: string) => void): boolean => {
    if (!isFormulaExpression(raw)) return false;
    const evaluated = evaluateFormulaExpression(raw);
    if (evaluated === null) return false;
    applyValue(evaluated === 0 ? '0.00' : evaluated.toFixed(2));
    return true;
  };

  const handleFormulaKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    applyValue: (resolved: string) => void
  ) => {
    if (e.key === 'Enter' && isFormulaExpression(e.currentTarget.value)) {
      e.preventDefault();
      commitFormulaInput(e.currentTarget.value, applyValue);
    }
  };

  const handleFormulaBlur = (
    e: React.FocusEvent<HTMLInputElement>,
    applyValue: (resolved: string) => void
  ) => {
    commitFormulaInput(e.currentTarget.value, applyValue);
  };

  const handleRealAmountChange = (ln: SplitLineDraft, val: string) => {
    const realAmt = parseAmount(val);
    const nonVatAmt = parseAmount(ln.rawNonVat);
    const isManualPurchases = ln.manualOverride || !autoCalcEnabled;

    if (val.trim() === '') {
      if (isManualPurchases) {
        updateLine(ln.key, {
          rawRealAmount: '',
          rawAmount: '',
          grossOfVat: null,
          netOfVat: null,
          rawNetOfVat: '',
          total: null,
          rawTotal: '',
          wtGoods1: null,
          wtServices2: null,
          wtRental5: null,
          rawEwt: '',
        });
      } else {
        updateLine(ln.key, {
          rawRealAmount: '',
          rawAmount: '',
          grossOfVat: null,
        });
      }
      return;
    }

    if (isManualPurchases) {
      if (realAmt !== null) {
        const grossVal = round2(Math.max(0, realAmt - (nonVatAmt ?? 0)));
        const netVal = round2(Math.max(0, grossVal - (ln.vat ?? 0)));
        const nextTotal = round2(Math.max(0, realAmt - (ln.vat ?? 0)));
        const ewt = computePurchasesEwt(ln.category, withholdingAgent, nonVatAmt, netVal);
        updateLine(ln.key, {
          rawRealAmount: val,
          grossOfVat: grossVal > 0 ? grossVal : null,
          rawAmount: formatPlainInput(grossVal),
          netOfVat: netVal > 0 ? netVal : null,
          rawNetOfVat: formatPlainInput(netVal),
          total: nextTotal > 0 ? nextTotal : null,
          rawTotal: formatPlainInput(nextTotal),
          ...ewt,
        });
      } else {
        updateLine(ln.key, { rawRealAmount: val });
      }
      return;
    }

    const grossVal = realAmt !== null ? round2(Math.max(0, realAmt - (nonVatAmt ?? 0))) : 0;
    updateLine(ln.key, {
      rawRealAmount: val,
      rawAmount: grossVal > 0 ? grossVal.toFixed(2) : '',
      grossOfVat: grossVal > 0 ? grossVal : null,
    });
  };

  const handleNonVatChange = (ln: SplitLineDraft, val: string) => {
    const nonVatAmt = parseAmount(val);
    const isManualPurchases = mode === 'PURCHASES' && (ln.manualOverride || !autoCalcEnabled);

    if (isManualPurchases) {
      const netVal = ln.netOfVat;
      const vatVal = ln.vat;
      const grossVal =
        netVal !== null || vatVal !== null
          ? round2((netVal ?? 0) + (vatVal ?? 0))
          : ln.grossOfVat;
      const nextTotal =
        nonVatAmt !== null || netVal !== null ? round2((nonVatAmt ?? 0) + (netVal ?? 0)) : null;
      const realAmt =
        nonVatAmt !== null || grossVal !== null ? round2((nonVatAmt ?? 0) + (grossVal ?? 0)) : null;
      const ewt = computePurchasesEwt(ln.category, withholdingAgent, nonVatAmt, netVal);
      updateLine(ln.key, {
        rawNonVat: val,
        nonVatExempt: nonVatAmt,
        grossOfVat: grossVal && grossVal > 0 ? grossVal : null,
        rawAmount: formatPlainInput(grossVal),
        total: nextTotal && nextTotal > 0 ? nextTotal : null,
        rawTotal: formatPlainInput(nextTotal),
        rawRealAmount: formatPlainInput(realAmt),
        ...ewt,
      });
      return;
    }

    if (mode === 'PURCHASES' && (ln.rawRealAmount ?? '').trim() !== '') {
      const realAmt = parseAmount(ln.rawRealAmount);
      const grossVal = realAmt !== null ? round2(Math.max(0, realAmt - (nonVatAmt ?? 0))) : 0;
      updateLine(ln.key, {
        rawNonVat: val,
        nonVatExempt: nonVatAmt,
        rawAmount: grossVal > 0 ? grossVal.toFixed(2) : '',
        grossOfVat: grossVal > 0 ? grossVal : null,
      });
      return;
    }

    updateLine(ln.key, {
      rawNonVat: val,
      nonVatExempt: nonVatAmt,
    });
  };

  const handleGrossAmountChange = (ln: SplitLineDraft, val: string) => {
    const grossAmt = parseAmount(val);
    const nonVatAmt = parseAmount(ln.rawNonVat);
    const isManualPurchases = mode === 'PURCHASES' && (ln.manualOverride || !autoCalcEnabled);

    if (isManualPurchases) {
      const netVal = grossAmt !== null ? round2(Math.max(0, grossAmt - (ln.vat ?? 0))) : null;
      const nextTotal =
        nonVatAmt !== null || netVal !== null ? round2((nonVatAmt ?? 0) + (netVal ?? 0)) : null;
      const realSum =
        nonVatAmt !== null || grossAmt !== null ? round2((nonVatAmt ?? 0) + (grossAmt ?? 0)) : null;
      const ewt = computePurchasesEwt(ln.category, withholdingAgent, nonVatAmt, netVal);
      updateLine(ln.key, {
        rawAmount: val,
        grossOfVat: grossAmt,
        netOfVat: netVal,
        rawNetOfVat: formatPlainInput(netVal),
        total: nextTotal,
        rawTotal: formatPlainInput(nextTotal),
        rawRealAmount: formatPlainInput(realSum),
        ...ewt,
      });
      return;
    }

    if (mode === 'PURCHASES' && (ln.rawRealAmount ?? '').trim() !== '') {
      const realSum = round2((nonVatAmt ?? 0) + (grossAmt ?? 0));
      updateLine(ln.key, {
        rawAmount: val,
        grossOfVat: grossAmt,
        rawRealAmount: realSum > 0 ? formatPlainInput(realSum) : '',
      });
      return;
    }

    updateLine(ln.key, {
      rawAmount: val,
      grossOfVat: grossAmt,
    });
  };

  const handleNetOfVatChange = (ln: SplitLineDraft, val: string) => {
    const netVal = parseAmount(val);
    if (mode === 'PURCHASES') {
      const nonVatAmt = parseAmount(ln.rawNonVat);
      const vatVal = ln.vat;
      const nextTotal =
        nonVatAmt !== null || netVal !== null ? round2((nonVatAmt ?? 0) + (netVal ?? 0)) : null;
      const realAmt =
        vatVal !== null || nextTotal !== null ? round2((vatVal ?? 0) + (nextTotal ?? 0)) : null;
      const grossVal = realAmt !== null ? round2(Math.max(0, realAmt - (nonVatAmt ?? 0))) : null;
      const ewt = computePurchasesEwt(ln.category, withholdingAgent, nonVatAmt, netVal);
      updateLine(ln.key, {
        rawNetOfVat: val,
        netOfVat: netVal,
        total: nextTotal,
        rawTotal: formatPlainInput(nextTotal),
        rawRealAmount: formatPlainInput(realAmt),
        grossOfVat: grossVal && grossVal > 0 ? grossVal : null,
        rawAmount: formatPlainInput(grossVal),
        ...ewt,
      });
      return;
    }
    updateLine(ln.key, { rawNetOfVat: val, netOfVat: netVal });
  };

  const handleVatChange = (ln: SplitLineDraft, val: string) => {
    const vatVal = parseAmount(val);
    if (mode === 'PURCHASES') {
      const nonVatAmt = parseAmount(ln.rawNonVat);
      if (vatVal === null) {
        const nextTotal = nonVatAmt !== null ? round2(nonVatAmt) : null;
        const ewt = computePurchasesEwt(ln.category, withholdingAgent, nonVatAmt, null);
        updateLine(ln.key, {
          rawVat: val,
          vat: null,
          netOfVat: null,
          rawNetOfVat: '',
          grossOfVat: null,
          rawAmount: '',
          total: nextTotal,
          rawTotal: formatPlainInput(nextTotal),
          rawRealAmount: formatPlainInput(nextTotal),
          ...ewt,
        });
        return;
      }

      const netVal = round2(vatVal / 0.12);
      const grossVal = round2(netVal + vatVal);
      const nextTotal = round2((nonVatAmt ?? 0) + netVal);
      const realAmt = round2(vatVal + nextTotal);
      const ewt = computePurchasesEwt(ln.category, withholdingAgent, nonVatAmt, netVal);
      updateLine(ln.key, {
        rawVat: val,
        vat: vatVal,
        netOfVat: netVal,
        rawNetOfVat: formatPlainInput(netVal),
        grossOfVat: grossVal,
        rawAmount: formatPlainInput(grossVal),
        total: nextTotal,
        rawTotal: formatPlainInput(nextTotal),
        rawRealAmount: formatPlainInput(realAmt),
        ...ewt,
      });
      return;
    }
    updateLine(ln.key, { rawVat: val, vat: vatVal });
  };

  const handleTotalChange = (ln: SplitLineDraft, val: string) => {
    const totalVal = parseAmount(val);
    if (mode === 'PURCHASES') {
      const vatVal = ln.vat;
      const nonVatAmt = parseAmount(ln.rawNonVat);
      if (vatVal !== null || totalVal !== null) {
        const realAmt = round2((vatVal ?? 0) + (totalVal ?? 0));
        const grossVal = round2(Math.max(0, realAmt - (nonVatAmt ?? 0)));
        const netVal = round2(Math.max(0, grossVal - (vatVal ?? 0)));
        const ewt = computePurchasesEwt(ln.category, withholdingAgent, nonVatAmt, netVal);
        updateLine(ln.key, {
          rawTotal: val,
          total: totalVal,
          rawRealAmount: formatPlainInput(realAmt),
          grossOfVat: grossVal > 0 ? grossVal : null,
          rawAmount: formatPlainInput(grossVal),
          netOfVat: netVal > 0 ? netVal : null,
          rawNetOfVat: formatPlainInput(netVal),
          ...ewt,
        });
      } else {
        const ewt = computePurchasesEwt(ln.category, withholdingAgent, nonVatAmt, null);
        updateLine(ln.key, {
          rawTotal: val,
          total: null,
          rawRealAmount: '',
          grossOfVat: null,
          rawAmount: '',
          netOfVat: null,
          rawNetOfVat: '',
          ...ewt,
        });
      }
      return;
    }
    updateLine(ln.key, { rawTotal: val, total: totalVal });
  };

  const handleEwtChange = (ln: SplitLineDraft, val: string) => {
    const parsed = parseAmount(val);
    if (ln.category === 'GOODS') updateLine(ln.key, { rawEwt: val, wtGoods1: parsed });
    else if (ln.category === 'SERVICES') updateLine(ln.key, { rawEwt: val, wtServices2: parsed });
    else if (ln.category === 'RENTAL') updateLine(ln.key, { rawEwt: val, wtRental5: parsed });
    else updateLine(ln.key, { rawEwt: val });
  };

  const handleWtVat5Change = (ln: SplitLineDraft, val: string) => {
    updateLine(ln.key, { rawWtVat5: val, wtVat5: parseAmount(val) });
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
      prev.map((ln) => {
        if (!autoCalcEnabled || ln.manualOverride) {
          if (mode === 'PURCHASES') {
            return {
              ...ln,
              ...computePurchasesEwt(ln.category, nextAgent, ln.nonVatExempt, ln.netOfVat),
            };
          }
          return ln;
        }
        return recomputeDraftLine(ln, privateOrGovt, nextAgent);
      })
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
    setTinAutofilled(false);
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
        parseAmount(ln.rawNonVat) !== null ||
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
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <h2 className="font-display text-sm font-semibold leading-snug text-slate-900">
            {editingRow ? `Edit ${displayModeLabel} Entry` : `Encode ${displayModeLabel} Transaction`}
          </h2>
          <span className="inline-flex items-center rounded-lg bg-[#E7F0FC] px-2.5 py-0.5 text-[11px] font-semibold leading-normal text-[#0B4DA2] whitespace-nowrap">
            Cover: {coveredMonth === 'ALL' ? (coveredYear === 'ALL' ? 'ALL MONTHS' : `ALL MONTHS ${coveredYear}`) : coveredYear === 'ALL' ? coveredMonth : `${coveredMonth} ${coveredYear}`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-xs font-medium leading-normal text-slate-700 cursor-pointer select-none">
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
                } else if (mode === 'PURCHASES') {
                  setLines((prev) =>
                    prev.map((ln) => {
                      const prepared = prepareLineForManualBackward(ln);
                      return { ...prepared, manualOverride: ln.manualOverride };
                    })
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
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium leading-normal text-slate-700 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <X className="h-3.5 w-3.5 shrink-0" />
              <span>Cancel Edit</span>
            </button>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} autoComplete="off" className="p-5 space-y-5">
        {/* Shared Transaction Header */}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-12 items-end">
          {/* Date */}
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium leading-normal text-slate-600 mb-1">
              DATE <span className="text-red-600">*</span>
            </label>
            <div className="flex items-stretch gap-1">
              <input
                type="text"
                autoComplete="off"
                value={date}
                onChange={(e) => {
                  const val = e.target.value;
                  setDate(val);
                  const derived = deriveMonthFromDate(val);
                  if (derived) {
                    setMonth(derived);
                    if (!editingRow) onChangeCoveredMonth?.(derived);
                  }
                  const derivedYear = extractYearFromDate(val);
                  if (!editingRow && derivedYear && /^\d{4}$/.test(derivedYear)) {
                    onChangeCoveredYear?.(derivedYear);
                  }
                }}
                className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm leading-normal tabular-nums-mono text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
              <div className="relative flex w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/15 transition-colors">
                <Calendar className="h-4 w-4 pointer-events-none" />
                <input
                  type="date"
                  value={toIsoDateInput(date)}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const slash = formatDateSlash(e.target.value);
                    setDate(slash);
                    const derived = deriveMonthFromDate(e.target.value);
                    if (derived) {
                      setMonth(derived);
                      if (!editingRow) onChangeCoveredMonth?.(derived);
                    }
                    const derivedYear = extractYearFromDate(e.target.value);
                    if (!editingRow && derivedYear && /^\d{4}$/.test(derivedYear)) {
                      onChangeCoveredYear?.(derivedYear);
                    }
                  }}
                  onClick={(e) => {
                    try {
                      e.currentTarget.showPicker?.();
                    } catch {
                      // fallback to native input click
                    }
                  }}
                  aria-label="Pick date"
                  title="Pick date"
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </div>
            </div>
          </div>

          {/* Month */}
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium leading-normal text-slate-600 mb-1">MONTH</label>
            <select
              value={month}
              onChange={(e) => {
                const nextMonth = e.target.value.toUpperCase();
                setMonth(nextMonth);
                if (!editingRow) {
                  setDate(getDefaultDateForCover(nextMonth, coveredYear));
                  onChangeCoveredMonth?.(nextMonth);
                }
              }}
              aria-label="Filing month"
              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-medium leading-normal text-slate-900 uppercase focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
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
            <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
              <label className="block text-xs font-medium leading-normal text-slate-600">
                TIN
              </label>
              {tinDigits.length > 0 && !isValidTinDigits(tinDigits) ? (
                <span className="text-[11px] font-medium leading-normal text-amber-700">
                  {tinDigits.length}/9 or 12 digits
                </span>
              ) : tinAutofilled ? (
                <span className="text-[11px] font-medium leading-normal text-[#0B4DA2]">
                  Autofilled
                </span>
              ) : null}
            </div>
            <div>
              <input
                ref={tinInputRef}
                type="text"
                autoComplete="off"
                value={tin}
                onChange={(e) => handleTinChange(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-normal tabular-nums-mono text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
            </div>
          </div>

          {/* PAYOR / PAYEE/SUPPLIER */}
          <div className="lg:col-span-3">
            <label className="block text-xs font-medium leading-normal text-slate-600 mb-1">
              {entityLabel} <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              autoComplete="off"
              value={payor}
              onChange={(e) => setPayor(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-normal text-slate-900 uppercase focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          {/* Mode-specific Header Toggle: PRIVATE OR GOVT (Sales) OR CLASSIFICATION (Purchases) */}
          {mode === 'SALES' ? (
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium leading-normal text-slate-600 mb-1">
                PRIVATE OR GOVT
              </label>
              <div className="grid grid-cols-2 rounded-lg border border-slate-300 bg-slate-50 p-0.5">
                {(['PRIVATE', 'GOVT'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleEntityTypeChange(type)}
                    className={`inline-flex items-center justify-center rounded-md py-1.5 text-xs font-semibold leading-normal transition-colors cursor-pointer ${
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
              <label className="block text-xs font-medium leading-normal text-slate-600 mb-1" title="CLASSIFICATION OF PAYEE/SUPPLIER (N/A, INDIVIDUAL OR CORP)">
                CLASSIFICATION
              </label>
              <select
                value={payeeClassification}
                onChange={(e) => setPayeeClassification(e.target.value as PayeeClassification)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold leading-normal text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                <option value="N/A">N/A</option>
                <option value="INDIVIDUAL">INDIVIDUAL</option>
                <option value="CORP">CORP</option>
              </select>
            </div>
          )}

          {/* BRANCH / TRADE NAME */}
          <div className="sm:col-span-1 lg:col-span-4">
            <label className="block text-xs font-medium leading-normal text-slate-600 mb-1">
              BRANCH/ TRADE NAME
            </label>
            <input
              type="text"
              autoComplete="off"
              value={branchTradeName}
              onChange={(e) => setBranchTradeName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-normal text-slate-900 uppercase focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          {/* ADDRESS 1: BARANGAY / MUNICIPALITY */}
          <div className="sm:col-span-1 lg:col-span-4">
            <label className="block text-xs font-medium leading-normal text-slate-600 mb-1">
              ADDRESS 1 (BARANGAY / MUNICIPALITY)
            </label>
            <input
              type="text"
              autoComplete="off"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-normal text-slate-900 uppercase focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          {/* ADDRESS 2: CITY / DISTRICT */}
          <div className="sm:col-span-1 lg:col-span-4">
            <label className="block text-xs font-medium leading-normal text-slate-600 mb-1">
              ADDRESS 2 (CITY / DISTRICT)
            </label>
            <input
              type="text"
              autoComplete="off"
              value={address2}
              onChange={(e) => setAddress2(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-normal text-slate-900 uppercase focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          {/* PURCHASES-only: SUPPORTING DOCS, REFERENCE NO., WITHHOLDING AGENT */}
          {mode === 'PURCHASES' && (
            <>
              <div className="sm:col-span-1 lg:col-span-4">
                <label className="block text-xs font-medium leading-normal text-slate-600 mb-1">
                  SUPPORTING DOCS
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  value={supportingDocs}
                  onChange={(e) => setSupportingDocs(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-normal text-slate-900 uppercase focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="sm:col-span-1 lg:col-span-4">
                <label className="block text-xs font-medium leading-normal text-slate-600 mb-1">
                  REFERENCE NO.
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-normal tabular-nums-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="sm:col-span-1 lg:col-span-4">
                <label className="block text-xs font-medium leading-normal text-slate-600 mb-1" title="WITHHOLDING AGENT (YES OR NO)">
                  WITHHOLDING AGENT
                </label>
                <div className="grid grid-cols-2 rounded-lg border border-slate-300 bg-slate-50 p-0.5">
                  {(['YES', 'NO'] as const).map((yn) => (
                    <button
                      key={yn}
                      type="button"
                      onClick={() => handleWithholdingAgentChange(yn)}
                      className={`inline-flex items-center justify-center rounded-md py-1.5 text-xs font-semibold leading-normal transition-colors cursor-pointer ${
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
              const payableBase =
                mode === 'PURCHASES' && (ln.nonVatExempt !== null || ln.grossOfVat !== null)
                  ? round2((ln.nonVatExempt ?? 0) + (ln.grossOfVat ?? 0))
                  : ln.total;
              const expectedActual =
                payableBase !== null && (ln.total !== null || payableBase > 0)
                  ? round2(payableBase - totalWht)
                  : null;

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
                      <div className="inline-flex flex-wrap max-w-full rounded-md border border-slate-300 bg-white p-0.5">
                        {categoryOptions.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => updateLine(ln.key, { category: cat })}
                            className={`inline-flex items-center justify-center rounded px-2.5 py-1 text-xs font-semibold leading-normal whitespace-nowrap transition-colors cursor-pointer ${
                              ln.category === cat
                                ? 'bg-blue-600 text-white'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>

                      {mode === 'SALES' && privateOrGovt === 'GOVT' && (
                        <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={ln.applyGovtVat5}
                            onChange={(e) =>
                              updateLine(ln.key, { applyGovtVat5: e.target.checked })
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
                      <label
                        title={
                          mode === 'PURCHASES'
                            ? 'Backward formula: add VAT + TOTAL to compute REAL AMOUNT, then deduct NON-VAT for GROSS AMOUNT'
                            : 'Manually edit computed VAT and withholding fields'
                        }
                        className={`inline-flex items-center gap-1.5 text-xs cursor-pointer ${
                          mode === 'PURCHASES' && (ln.manualOverride || !autoCalcEnabled)
                            ? 'font-semibold text-amber-800'
                            : 'text-slate-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={ln.manualOverride || !autoCalcEnabled}
                          disabled={!autoCalcEnabled}
                          onChange={(e) => handleToggleLineManualOverride(ln.key, e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-amber-600"
                        />
                        <span>Manual Override</span>
                        {mode === 'PURCHASES' && (ln.manualOverride || !autoCalcEnabled) && (
                          <span className="text-[11px] font-medium text-amber-700">
                            (VAT + TOTAL → Real)
                          </span>
                        )}
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
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                          <label className="block text-[11px] font-semibold leading-normal text-amber-900">
                            ACCOUNT TITLE
                          </label>
                          <div className="flex items-center gap-2">
                            {ln.accountTitle.trim() &&
                              !accountTitles.includes(ln.accountTitle.trim().toUpperCase()) && (
                                <button
                                  type="button"
                                  onClick={() => addAccountTitleToList(ln.accountTitle)}
                                  className="inline-flex items-center gap-0.5 text-[11px] font-semibold leading-normal text-emerald-700 hover:text-emerald-900 whitespace-nowrap cursor-pointer"
                                  title="Save this Account Title to your list"
                                >
                                  <Plus className="h-3 w-3 shrink-0" />
                                  <span>Save</span>
                                </button>
                              )}
                            <button
                              type="button"
                              onClick={() => {
                                setBulkAccountInput(accountTitles.join('\n'));
                                setAccountListTargetKey(ln.key);
                                setShowAccountListModal(true);
                              }}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold leading-normal text-blue-700 hover:text-blue-900 whitespace-nowrap cursor-pointer"
                              title="Put or edit your list of Account Titles"
                            >
                              <ListPlus className="h-3 w-3 shrink-0" />
                              <span>Manage List ({accountTitles.length})</span>
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
                            className="w-full rounded-lg border border-amber-300 bg-amber-50/40 pl-3 pr-8 py-1.5 text-xs leading-normal text-slate-900 uppercase focus:border-blue-600 focus:bg-white focus:outline-none"
                          />
                          <button
                            type="button"
                            tabIndex={-1}
                            onClick={() =>
                              setOpenAccountDropdownKey((prev) => (prev === ln.key ? null : ln.key))
                            }
                            aria-label="Toggle account title list"
                            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-slate-500 hover:text-slate-900 cursor-pointer"
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
                                    <div className="px-3 py-2 text-[11px] leading-normal text-slate-500">
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
                                        className={`flex w-full items-center justify-between border-b border-slate-100 px-3 py-1.5 text-left text-xs leading-normal last:border-b-0 hover:bg-amber-50 cursor-pointer ${
                                          ln.accountTitle.trim().toUpperCase() === title
                                            ? 'bg-amber-50/70 font-semibold text-slate-900'
                                            : 'text-slate-800'
                                        }`}
                                      >
                                        <span className="truncate leading-normal">{title}</span>
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
                                      className="flex w-full items-center gap-1.5 border-t border-slate-200 bg-blue-50/70 px-3 py-2 text-left text-xs font-semibold leading-normal text-blue-700 hover:bg-blue-100 cursor-pointer"
                                    >
                                      <Plus className="h-3.5 w-3.5 shrink-0" />
                                      <span className="min-w-0 break-words">Add &quot;{q}&quot; to Account Title list</span>
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
                    className={
                      mode === 'PURCHASES'
                        ? 'grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8 items-end'
                        : 'grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-12 items-end'
                    }
                  >
                    {mode === 'PURCHASES' && (
                      <div className="col-span-2 sm:col-span-1">
                        <label
                          title="Helper calculation field only (not exported to Excel / XLSX) · Supports =5+5 formulas"
                          className="block text-[11px] font-semibold leading-normal text-blue-800 mb-1"
                        >
                          REAL AMOUNT
                        </label>
                        <input
                          ref={idx === 0 ? amountInputRef : undefined}
                          type="text"
                          inputMode="decimal"
                          title="Enter amount or formula like =5+5 (press Enter or Tab to compute)"
                          value={ln.rawRealAmount ?? ''}
                          onChange={(e) => handleRealAmountChange(ln, e.target.value)}
                          onKeyDown={(e) => handleFormulaKeyDown(e, (v) => handleRealAmountChange(ln, v))}
                          onBlur={(e) => handleFormulaBlur(e, (v) => handleRealAmountChange(ln, v))}
                          placeholder="0.00 or =5+5"
                          className="w-full rounded-lg border border-blue-300 bg-blue-50/40 px-2.5 py-1.5 text-right text-sm leading-normal tabular-nums-mono font-semibold text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                        />
                      </div>
                    )}

                    <div className={mode === 'PURCHASES' ? 'col-span-1' : 'col-span-2 sm:col-span-2 lg:col-span-2'}>
                      <label className="block text-[11px] font-medium leading-normal text-slate-600 mb-1">
                        NON-VAT / VAT EXEMPT
                      </label>
                      <input
                        ref={mode === 'SALES' && idx === 0 ? amountInputRef : undefined}
                        type="text"
                        inputMode="decimal"
                        title="Enter amount or formula like =5+5 (press Enter or Tab to compute)"
                        value={ln.rawNonVat}
                        onChange={(e) => handleNonVatChange(ln, e.target.value)}
                        onKeyDown={(e) => handleFormulaKeyDown(e, (v) => handleNonVatChange(ln, v))}
                        onBlur={(e) => handleFormulaBlur(e, (v) => handleNonVatChange(ln, v))}
                        placeholder="0.00"
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-right text-sm leading-normal tabular-nums-mono font-semibold text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                      />
                    </div>

                    <div className={mode === 'PURCHASES' ? 'col-span-1' : 'col-span-2 sm:col-span-2 lg:col-span-2'}>
                      <label className="block text-[11px] font-medium leading-normal text-slate-600 mb-1">
                        GROSS AMOUNT
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        title="Enter amount or formula like =5+5 (press Enter or Tab to compute)"
                        value={ln.rawAmount}
                        onChange={(e) => handleGrossAmountChange(ln, e.target.value)}
                        onKeyDown={(e) => handleFormulaKeyDown(e, (v) => handleGrossAmountChange(ln, v))}
                        onBlur={(e) => handleFormulaBlur(e, (v) => handleGrossAmountChange(ln, v))}
                        placeholder="0.00"
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-right text-sm leading-normal tabular-nums-mono font-semibold text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                      />
                    </div>

                    {/* NET OF VAT */}
                    <div className={mode === 'PURCHASES' ? 'col-span-1' : 'lg:col-span-1'}>
                      <label className="block text-[11px] font-medium leading-normal text-slate-500 mb-1">
                        NET OF VAT
                      </label>
                      {ln.manualOverride || !autoCalcEnabled ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          title="Enter amount or formula like =5+5 (press Enter or Tab to compute)"
                          value={ln.rawNetOfVat ?? formatPlainInput(ln.netOfVat)}
                          onChange={(e) => handleNetOfVatChange(ln, e.target.value)}
                          onKeyDown={(e) => handleFormulaKeyDown(e, (v) => handleNetOfVatChange(ln, v))}
                          onBlur={(e) => handleFormulaBlur(e, (v) => handleNetOfVatChange(ln, v))}
                          placeholder="-"
                          className="min-h-[34px] w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-right text-xs leading-normal tabular-nums-mono"
                        />
                      ) : (
                        <div className="min-h-[34px] flex items-center justify-end rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right text-xs leading-normal tabular-nums-mono text-slate-700">
                          {formatAccounting(ln.netOfVat)}
                        </div>
                      )}
                    </div>

                    {/* VAT */}
                    <div className={mode === 'PURCHASES' ? 'col-span-1' : 'lg:col-span-1'}>
                      <label className="block text-[11px] font-medium leading-normal text-slate-500 mb-1">
                        VAT (12%)
                      </label>
                      {ln.manualOverride || !autoCalcEnabled ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          title={
                            mode === 'PURCHASES'
                              ? 'Backward formula: NET = VAT / 0.12, GROSS = NET + VAT, TOTAL = NON-VAT + NET, REAL AMOUNT = VAT + TOTAL · Supports =5+5'
                              : 'Enter amount or formula like =5+5 (press Enter or Tab to compute)'
                          }
                          value={ln.rawVat ?? formatPlainInput(ln.vat)}
                          onChange={(e) => handleVatChange(ln, e.target.value)}
                          onKeyDown={(e) => handleFormulaKeyDown(e, (v) => handleVatChange(ln, v))}
                          onBlur={(e) => handleFormulaBlur(e, (v) => handleVatChange(ln, v))}
                          placeholder="-"
                          className="min-h-[34px] w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-right text-xs leading-normal tabular-nums-mono"
                        />
                      ) : (
                        <div className="min-h-[34px] flex items-center justify-end rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right text-xs leading-normal tabular-nums-mono text-slate-700">
                          {formatAccounting(ln.vat)}
                        </div>
                      )}
                    </div>

                    {/* TOTAL */}
                    <div className={mode === 'PURCHASES' ? 'col-span-1' : 'lg:col-span-2'}>
                      <label className="block text-[11px] font-medium leading-normal text-slate-500 mb-1">
                        TOTAL
                      </label>
                      {ln.manualOverride || !autoCalcEnabled ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          title="Enter amount or formula like =5+5 (press Enter or Tab to compute)"
                          value={ln.rawTotal ?? formatPlainInput(ln.total)}
                          onChange={(e) => handleTotalChange(ln, e.target.value)}
                          onKeyDown={(e) => handleFormulaKeyDown(e, (v) => handleTotalChange(ln, v))}
                          onBlur={(e) => handleFormulaBlur(e, (v) => handleTotalChange(ln, v))}
                          placeholder="-"
                          className="min-h-[34px] w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-right text-xs leading-normal tabular-nums-mono font-semibold"
                        />
                      ) : (
                        <div className="min-h-[34px] flex items-center justify-end rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right text-xs leading-normal tabular-nums-mono font-semibold text-slate-900">
                          {formatAccounting(ln.total)}
                        </div>
                      )}
                    </div>

                    {/* EWT (1% / 2% / 5%) */}
                    <div className={mode === 'PURCHASES' ? 'col-span-1' : 'lg:col-span-1'}>
                      <label className="block text-[11px] font-medium leading-normal text-slate-500 mb-1">
                        EWT ({activeEwtRateLabel})
                      </label>
                      {ln.manualOverride || !autoCalcEnabled ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          title="Enter amount or formula like =5+5 (press Enter or Tab to compute)"
                          value={ln.rawEwt ?? formatPlainInput(getActiveEwtAmount(ln))}
                          onChange={(e) => handleEwtChange(ln, e.target.value)}
                          onKeyDown={(e) => handleFormulaKeyDown(e, (v) => handleEwtChange(ln, v))}
                          onBlur={(e) => handleFormulaBlur(e, (v) => handleEwtChange(ln, v))}
                          placeholder="-"
                          className="min-h-[34px] w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-right text-xs leading-normal tabular-nums-mono"
                        />
                      ) : (
                        <div className="min-h-[34px] flex items-center justify-end rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right text-xs leading-normal tabular-nums-mono text-slate-700">
                          {formatAccounting(getActiveEwtAmount(ln))}
                        </div>
                      )}
                    </div>

                    {/* NET PAYABLE READOUT IN PURCHASES */}
                    {mode === 'PURCHASES' && (
                      <div className="col-span-1">
                        <label className="block text-[11px] font-medium leading-normal text-slate-500 mb-1">
                          NET PAYABLE
                        </label>
                        <div className="min-h-[34px] flex items-center justify-end rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-right text-xs leading-normal tabular-nums-mono font-semibold text-slate-900">
                          {formatAccounting(expectedActual)}
                        </div>
                      </div>
                    )}

                    {/* SALES-only: WHT VAT (5%) & ACTUAL */}
                    {mode === 'SALES' && (
                      <>
                        <div>
                          <label className="block text-[11px] font-medium leading-normal text-slate-500 mb-1">
                            WHT VAT (5%)
                          </label>
                          {ln.manualOverride || !autoCalcEnabled ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              title="Enter amount or formula like =5+5 (press Enter or Tab to compute)"
                              value={ln.rawWtVat5 ?? formatPlainInput(ln.wtVat5)}
                              onChange={(e) => handleWtVat5Change(ln, e.target.value)}
                              onKeyDown={(e) => handleFormulaKeyDown(e, (v) => handleWtVat5Change(ln, v))}
                              onBlur={(e) => handleFormulaBlur(e, (v) => handleWtVat5Change(ln, v))}
                              placeholder="-"
                              className="min-h-[34px] w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-right text-xs leading-normal tabular-nums-mono"
                            />
                          ) : (
                            <div className="min-h-[34px] flex items-center justify-end rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right text-xs leading-normal tabular-nums-mono text-slate-700">
                              {formatAccounting(ln.wtVat5)}
                            </div>
                          )}
                        </div>

                        <div className="col-span-2">
                          <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                            <label className="block text-[11px] font-medium leading-normal text-slate-600">
                              ACTUAL
                            </label>
                            <button
                              type="button"
                              onClick={() => handleComputeExpectedActual(ln.key)}
                              disabled={expectedActual === null}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold leading-normal text-blue-700 hover:text-blue-900 disabled:text-slate-400 whitespace-nowrap cursor-pointer"
                              title="Set ACTUAL = TOTAL - Total Withholding Taxes"
                            >
                              <Calculator className="h-3 w-3 shrink-0" />
                              <span>Compute Expected ({formatAccounting(expectedActual)})</span>
                            </button>
                          </div>
                          <input
                            type="text"
                            inputMode="decimal"
                            title="Enter amount or formula like =5+5 (press Enter or Tab to compute)"
                            value={ln.rawActual}
                            onChange={(e) => updateLine(ln.key, { rawActual: e.target.value })}
                            onKeyDown={(e) =>
                              handleFormulaKeyDown(e, (v) => updateLine(ln.key, { rawActual: v }))
                            }
                            onBlur={(e) =>
                              handleFormulaBlur(e, (v) => updateLine(ln.key, { rawActual: v }))
                            }
                            placeholder="Leave blank if uncollected"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-right text-xs leading-normal tabular-nums-mono font-semibold text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
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
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs leading-normal text-slate-800 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {formError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-medium leading-normal text-red-700">
            {formError}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="text-xs leading-normal text-slate-500">
            Press <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">Enter</kbd> to save quickly · Zero values export as <code className="font-mono">-</code>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {!editingRow && (
              <button
                type="button"
                onClick={resetFormAfterSave}
                className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium leading-normal text-slate-700 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
              >
                Clear Fields
              </button>
            )}
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-xl bg-[#18181B] px-4 py-2 text-xs font-semibold leading-normal text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span>
                {editingRow
                  ? 'Save Changes'
                  : entryType === 'SPLIT'
                  ? `Add ${lines.length} Split Rows to ${displayModeLabel}`
                  : `Add to ${displayModeLabel} Ledger`}
              </span>
            </button>
          </div>
        </div>
      </form>

      {/* Account Title List Manager Modal */}
      {showAccountListModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-sm font-semibold leading-snug text-slate-900">
                  Account Title List ({accountTitles.length})
                </h3>
                <p className="text-[11px] leading-normal text-slate-500 mt-0.5 break-words">
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
                          className="text-left flex-1 min-w-0 truncate leading-normal font-medium hover:text-blue-700 cursor-pointer"
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
