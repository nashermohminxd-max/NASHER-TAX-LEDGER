import type {
  AuditIssue,
  EntityType,
  LedgerMode,
  LedgerRow,
  LedgerTotals,
  TaxStatus,
  TinRecord,
  TransactionCategory,
  YesNo,
} from '../types/tax';

const MONTHS = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
] as const;

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function normalizeTinDigits(raw: string): string {
  return (raw || '').replace(/\D/g, '').slice(0, 12);
}

export function formatTin(raw: string): string {
  const digits = normalizeTinDigits(raw);
  if (!digits) return '';
  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += 3) {
    groups.push(digits.slice(i, i + 3));
  }
  return groups.join('-');
}

export function isValidTinDigits(digits: string): boolean {
  return digits.length === 9 || digits.length === 12;
}

export function deriveMonthFromDate(dateStr: string): string {
  const trimmed = (dateStr || '').trim();
  if (!trimmed) return '';

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (isoMatch) {
    const monthIdx = parseInt(isoMatch[2], 10) - 1;
    if (monthIdx >= 0 && monthIdx < 12) return MONTHS[monthIdx];
  }

  const slashMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(trimmed);
  if (slashMatch) {
    const monthIdx = parseInt(slashMatch[1], 10) - 1;
    if (monthIdx >= 0 && monthIdx < 12) return MONTHS[monthIdx];
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return MONTHS[parsed.getMonth()];
  }

  return '';
}

export function formatDateSlash(dateStr: string): string {
  const trimmed = (dateStr || '').trim();
  if (!trimmed) return '';
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (isoMatch) {
    return `${parseInt(isoMatch[2], 10)}/${parseInt(isoMatch[3], 10)}/${isoMatch[1]}`;
  }
  return trimmed;
}

export function toIsoDateInput(dateStr: string): string {
  const trimmed = (dateStr || '').trim();
  if (!trimmed) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const slashMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(trimmed);
  if (slashMatch) {
    const m = slashMatch[1].padStart(2, '0');
    const d = slashMatch[2].padStart(2, '0');
    const y = slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3];
    return `${y}-${m}-${d}`;
  }
  return '';
}

export function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw === 0) return null;
    return round2(raw);
  }
  const cleaned = raw.replace(/,/g, '').replace(/₱/g, '').trim();
  if (!cleaned || cleaned === '-') return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num === 0) return null;
  return round2(num);
}

export function formatAccounting(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val) || round2(val) === 0) {
    return '-';
  }
  return round2(val).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPlainInput(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val) || round2(val) === 0) {
    return '';
  }
  return round2(val).toFixed(2);
}

export interface TaxCalculationInput {
  mode?: LedgerMode;
  category: TransactionCategory;
  privateOrGovt: EntityType;
  taxStatus: TaxStatus;
  amount: number | null;
  applyGovtVat5: boolean;
  withholdingAgent?: YesNo; // Used in PURCHASES mode
}

export interface TaxCalculationResult {
  nonVatExempt: number | null;
  grossOfVat: number | null;
  netOfVat: number | null;
  vat: number | null;
  total: number | null;
  wtGoods1: number | null;
  wtServices2: number | null;
  wtRental5: number | null;
  wtVat5: number | null;
  expectedActual: number | null;
}

export function calculateRowTaxes(input: TaxCalculationInput): TaxCalculationResult {
  const {
    mode = 'SALES',
    category,
    privateOrGovt,
    taxStatus,
    amount,
    applyGovtVat5,
    withholdingAgent = 'YES',
  } = input;
  const cleanAmount = amount !== null && Number.isFinite(amount) && amount > 0 ? round2(amount) : null;

  let nonVatExempt: number | null = null;
  let grossOfVat: number | null = null;
  let netOfVat: number | null = null;
  let vat: number | null = null;
  let total: number | null = null;
  let taxBase = 0;

  if (cleanAmount !== null) {
    if (taxStatus === 'VATABLE') {
      grossOfVat = cleanAmount;
      netOfVat = round2(cleanAmount / 1.12);
      vat = round2(cleanAmount - netOfVat);
      total = cleanAmount;
      taxBase = netOfVat;
    } else {
      nonVatExempt = cleanAmount;
      total = cleanAmount;
      taxBase = nonVatExempt;
    }
  }

  let wtGoods1: number | null = null;
  let wtServices2: number | null = null;
  let wtRental5: number | null = null;
  let wtVat5: number | null = null;

  const shouldApplyEwt =
    taxBase > 0 &&
    category !== 'N/A' &&
    (mode === 'SALES' || withholdingAgent === 'YES');

  if (shouldApplyEwt) {
    if (category === 'GOODS') wtGoods1 = round2(taxBase * 0.01);
    if (category === 'SERVICES') wtServices2 = round2(taxBase * 0.02);
    if (category === 'RENTAL') wtRental5 = round2(taxBase * 0.05);

    if (mode === 'SALES' && privateOrGovt === 'GOVT' && applyGovtVat5) {
      wtVat5 = round2(taxBase * 0.05);
    }
  }

  const totalWht =
    (wtGoods1 ?? 0) + (wtServices2 ?? 0) + (wtRental5 ?? 0) + (wtVat5 ?? 0);
  const expectedActual = total !== null ? round2(total - totalWht) : null;

  return {
    nonVatExempt,
    grossOfVat,
    netOfVat,
    vat,
    total,
    wtGoods1,
    wtServices2,
    wtRental5,
    wtVat5,
    expectedActual,
  };
}

export function getRowTotalWithholding(
  row: Pick<LedgerRow, 'wtGoods1' | 'wtServices2' | 'wtRental5' | 'wtVat5'>,
  mode: LedgerMode = 'SALES'
): number {
  return round2(
    (row.wtGoods1 ?? 0) +
      (row.wtServices2 ?? 0) +
      (row.wtRental5 ?? 0) +
      (mode === 'SALES' ? (row.wtVat5 ?? 0) : 0)
  );
}

export function getRowExpectedActual(row: LedgerRow, mode: LedgerMode = 'SALES'): number | null {
  if (row.total === null) return null;
  return round2(row.total - getRowTotalWithholding(row, mode));
}

export function recalculateExistingRow(row: LedgerRow, mode: LedgerMode = 'SALES'): LedgerRow {
  const isVatable = (row.grossOfVat ?? 0) > 0;
  const amount = isVatable ? row.grossOfVat : row.nonVatExempt;
  const calc = calculateRowTaxes({
    mode,
    category: row.category,
    privateOrGovt: row.privateOrGovt,
    taxStatus: isVatable ? 'VATABLE' : 'NON_VAT',
    amount,
    applyGovtVat5: mode === 'SALES' && row.privateOrGovt === 'GOVT' ? row.applyGovtVat5 : false,
    withholdingAgent: row.withholdingAgent ?? 'YES',
  });

  return {
    ...row,
    nonVatExempt: calc.nonVatExempt,
    grossOfVat: calc.grossOfVat,
    netOfVat: calc.netOfVat,
    vat: calc.vat,
    total: calc.total,
    wtGoods1: calc.wtGoods1,
    wtServices2: calc.wtServices2,
    wtRental5: calc.wtRental5,
    wtVat5: calc.wtVat5,
    manualOverride: false,
    updatedAt: new Date().toISOString(),
  };
}

export function auditRow(row: LedgerRow, mode: LedgerMode = 'SALES'): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const digits = normalizeTinDigits(row.tin);

  if (!row.date.trim()) {
    issues.push({
      code: 'MISSING_DATE',
      severity: 'error',
      field: 'date',
      message: 'Missing transaction date',
    });
  }

  if (!row.month.trim()) {
    issues.push({
      code: 'MISSING_MONTH',
      severity: 'warning',
      field: 'month',
      message: 'Missing filing month',
    });
  }

  if (!row.payor.trim()) {
    issues.push({
      code: 'MISSING_PAYOR',
      severity: 'error',
      field: 'payor',
      message: mode === 'SALES' ? 'Missing payor name' : 'Missing payee/supplier name',
    });
  }

  if (!digits) {
    issues.push({
      code: 'MISSING_TIN',
      severity: 'error',
      field: 'tin',
      message: 'Missing TIN (required for BIR RELIEF)',
    });
  } else if (!isValidTinDigits(digits)) {
    issues.push({
      code: 'INVALID_TIN_LENGTH',
      severity: 'error',
      field: 'tin',
      message: `TIN has ${digits.length} digits (must be 9 or 12 digits)`,
    });
  }

  if (!row.address.trim() && !(row.address2 ?? '').trim()) {
    issues.push({
      code: 'MISSING_ADDRESS',
      severity: 'warning',
      field: 'address',
      message: 'Missing registered address',
    });
  }

  if (mode === 'PURCHASES' && row.withholdingAgent === 'YES' && row.category === 'N/A') {
    issues.push({
      code: 'WHT_CATEGORY_NA',
      severity: 'warning',
      field: 'category',
      message: 'Withholding Agent is YES, but category is set to N/A',
    });
  }

  const isVatable = (row.grossOfVat ?? 0) > 0;
  const expected = calculateRowTaxes({
    mode,
    category: row.category,
    privateOrGovt: row.privateOrGovt,
    taxStatus: isVatable ? 'VATABLE' : 'NON_VAT',
    amount: isVatable ? row.grossOfVat : row.nonVatExempt,
    applyGovtVat5: mode === 'SALES' && row.privateOrGovt === 'GOVT' ? row.applyGovtVat5 : false,
    withholdingAgent: row.withholdingAgent ?? 'YES',
  });

  if (isVatable && row.grossOfVat !== null) {
    const netPlusVat = round2((row.netOfVat ?? 0) + (row.vat ?? 0));
    if (Math.abs(netPlusVat - row.grossOfVat) > 0.05) {
      issues.push({
        code: 'MATH_VAT_MISMATCH',
        severity: 'error',
        field: 'vat',
        message: `Net + VAT (${formatAccounting(netPlusVat)}) does not equal Gross (${formatAccounting(row.grossOfVat)})`,
        canAutoFix: true,
      });
    }
    if (row.total !== null && Math.abs(row.total - row.grossOfVat) > 0.05) {
      issues.push({
        code: 'MATH_TOTAL_MISMATCH',
        severity: 'warning',
        field: 'total',
        message: `Total (${formatAccounting(row.total)}) differs from Gross of VAT (${formatAccounting(row.grossOfVat)})`,
        canAutoFix: true,
      });
    }
  } else if (row.nonVatExempt !== null && row.total !== null) {
    if (Math.abs(row.total - row.nonVatExempt) > 0.05) {
      issues.push({
        code: 'MATH_TOTAL_MISMATCH',
        severity: 'warning',
        field: 'total',
        message: `Total (${formatAccounting(row.total)}) differs from Non-VAT (${formatAccounting(row.nonVatExempt)})`,
        canAutoFix: true,
      });
    }
  }

  const expectedTotalWht =
    (expected.wtGoods1 ?? 0) +
    (expected.wtServices2 ?? 0) +
    (expected.wtRental5 ?? 0) +
    (mode === 'SALES' ? (expected.wtVat5 ?? 0) : 0);
  const actualTotalWht = getRowTotalWithholding(row, mode);
  if ((row.total ?? 0) > 0 && Math.abs(expectedTotalWht - actualTotalWht) > 0.05) {
    issues.push({
      code: 'MATH_WHT_MISMATCH',
      severity: 'warning',
      field: 'withholding',
      message: `Withholding tax (${formatAccounting(actualTotalWht)}) differs from BIR rule (${formatAccounting(expectedTotalWht)})`,
      canAutoFix: true,
    });
  }

  return issues;
}

export function computeLedgerTotals(rows: LedgerRow[], mode: LedgerMode = 'SALES'): LedgerTotals {
  let nonVatExempt = 0;
  let grossOfVat = 0;
  let netOfVat = 0;
  let vat = 0;
  let total = 0;
  let wtGoods1 = 0;
  let wtServices2 = 0;
  let wtRental5 = 0;
  let wtVat5 = 0;
  let expectedNet = 0;
  let actual = 0;
  let flaggedCount = 0;

  for (const row of rows) {
    nonVatExempt += row.nonVatExempt ?? 0;
    grossOfVat += row.grossOfVat ?? 0;
    netOfVat += row.netOfVat ?? 0;
    vat += row.vat ?? 0;
    total += row.total ?? 0;
    wtGoods1 += row.wtGoods1 ?? 0;
    wtServices2 += row.wtServices2 ?? 0;
    wtRental5 += row.wtRental5 ?? 0;
    if (mode === 'SALES') {
      wtVat5 += row.wtVat5 ?? 0;
    }
    expectedNet += getRowExpectedActual(row, mode) ?? 0;
    actual += row.actual ?? 0;
    if (auditRow(row, mode).length > 0) {
      flaggedCount += 1;
    }
  }

  const totalWithholding = round2(wtGoods1 + wtServices2 + wtRental5 + wtVat5);
  const roundedExpected = round2(expectedNet);
  const roundedActual = round2(actual);

  return {
    rowCount: rows.length,
    flaggedCount,
    nonVatExempt: round2(nonVatExempt),
    grossOfVat: round2(grossOfVat),
    netOfVat: round2(netOfVat),
    vat: round2(vat),
    total: round2(total),
    wtGoods1: round2(wtGoods1),
    wtServices2: round2(wtServices2),
    wtRental5: round2(wtRental5),
    wtVat5: round2(wtVat5),
    totalWithholding,
    expectedNet: roundedExpected,
    actual: roundedActual,
    variance: round2(roundedExpected - roundedActual),
  };
}

export function findTinMatch(
  rawTin: string,
  directory: TinRecord[],
  fallbackRows: LedgerRow[] = []
): { record: TinRecord | null; source: 'directory' | 'history' | null } {
  const digits = normalizeTinDigits(rawTin);
  if (digits.length < 9) return { record: null, source: null };

  const exactDir = directory.find((t) => t.digits === digits);
  if (exactDir) return { record: exactDir, source: 'directory' };

  const base9 = digits.slice(0, 9);
  const branchMatch = directory.find((t) => t.digits.slice(0, 9) === base9);
  if (branchMatch && (digits.length === 9 || digits === `${base9}000` || branchMatch.digits === base9)) {
    return { record: branchMatch, source: 'directory' };
  }

  const histRow = fallbackRows.find((r) => normalizeTinDigits(r.tin) === digits && r.payor.trim() !== '');
  if (histRow) {
    return {
      source: 'history',
      record: {
        id: `hist-${digits}`,
        tin: formatTin(digits),
        digits,
        payor: histRow.payor,
        branchTradeName: histRow.branchTradeName,
        address: histRow.address,
        address2: histRow.address2 ?? '',
        defaultPrivateOrGovt: histRow.privateOrGovt,
        defaultCategory: histRow.category,
        defaultTaxStatus: (histRow.grossOfVat ?? 0) > 0 ? 'VATABLE' : 'NON_VAT',
        defaultPayeeClassification: histRow.payeeClassification,
        defaultAccountTitle: histRow.accountTitle,
        defaultWithholdingAgent: histRow.withholdingAgent,
        createdAt: histRow.createdAt,
        updatedAt: histRow.updatedAt,
      },
    };
  }

  return { record: null, source: null };
}

export function nextCategoryCycle(
  current: TransactionCategory,
  mode: LedgerMode = 'SALES'
): TransactionCategory {
  if (mode === 'PURCHASES' && current === 'N/A') return 'GOODS';
  if (current === 'GOODS') return 'SERVICES';
  if (current === 'SERVICES') return 'RENTAL';
  return 'GOODS';
}
