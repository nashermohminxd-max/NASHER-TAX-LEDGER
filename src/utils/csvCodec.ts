import type {
  EntityType,
  LedgerMode,
  LedgerRow,
  PayeeClassification,
  TaxStatus,
  TinRecord,
  TransactionCategory,
  YesNo,
} from '../types/tax';
import { stripControlChars } from '../lib/validation';
import {
  deriveMonthFromDate,
  formatAccounting,
  formatTin,
  normalizeTinDigits,
  parseAmount,
} from './taxEngine';

const MAX_CSV_CHARS = 10 * 1024 * 1024;
const MAX_CSV_ROWS = 25_000;

export function neutralizeSpreadsheetFormula(val: string): string {
  const s = val ?? '';
  if (!s) return s;
  // Preserve literal dash placeholder and plain negative numeric values
  if (s === '-' || /^-\d[\d,]*(\.\d+)?$/.test(s)) {
    return s;
  }
  const first = s[0];
  if (
    first === '=' ||
    first === '+' ||
    first === '-' ||
    first === '@' ||
    first === '\t' ||
    first === '\r'
  ) {
    return `'${s}`;
  }
  return s;
}

function parseCsvMatrix(csvText: string): string[][] {
  if (csvText.length > MAX_CSV_CHARS) {
    throw new Error('CSV file exceeds the maximum 10 MB size limit.');
  }
  const clean = csvText.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field.trim());
        field = '';
      } else if (ch === '\r' && next === '\n') {
        row.push(field.trim());
        if (rows.length >= MAX_CSV_ROWS) {
          throw new Error(`CSV exceeds maximum limit of ${MAX_CSV_ROWS.toLocaleString()} rows.`);
        }
        rows.push(row);
        row = [];
        field = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        row.push(field.trim());
        if (rows.length >= MAX_CSV_ROWS) {
          throw new Error(`CSV exceeds maximum limit of ${MAX_CSV_ROWS.toLocaleString()} rows.`);
        }
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (rows.length >= MAX_CSV_ROWS) {
      throw new Error(`CSV exceeds maximum limit of ${MAX_CSV_ROWS.toLocaleString()} rows.`);
    }
    rows.push(row);
  }

  return rows;
}

function escapeCsvCell(val: string): string {
  const safe = neutralizeSpreadsheetFormula(val);
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n') || safe.includes('\r')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function normalizeHeader(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

export interface ImportedLedgerResult {
  detectedMode: LedgerMode | null;
  rows: LedgerRow[];
  extractedTins: TinRecord[];
}

export function importFilingCsv(
  csvText: string,
  fallbackMode: LedgerMode
): ImportedLedgerResult {
  const matrix = parseCsvMatrix(csvText);
  if (matrix.length === 0) {
    return { detectedMode: null, rows: [], extractedTins: [] };
  }

  let detectedMode: LedgerMode | null = null;
  let headerRowIdx = -1;

  for (let r = 0; r < Math.min(10, matrix.length); r++) {
    const rowNorm = matrix[r].map(normalizeHeader);
    if (rowNorm.includes('PURCHASES') || rowNorm.some((c) => c.includes('PAYEE/SUPPLIER') || c.includes('WITHHOLDING AGENT'))) {
      detectedMode = 'PURCHASES';
    } else if (rowNorm[0] === 'SALES') {
      detectedMode = 'SALES';
    }

    if (
      rowNorm.includes('DATE') &&
      (rowNorm.includes('PAYOR') || rowNorm.some((c) => c.includes('PAYEE') || c.includes('SUPPLIER')))
    ) {
      headerRowIdx = r;
      break;
    }
  }

  const mode = detectedMode ?? fallbackMode;
  const mainHdr = headerRowIdx >= 0 ? matrix[headerRowIdx].map(normalizeHeader) : [];
  const prevHdr1 = headerRowIdx > 0 ? matrix[headerRowIdx - 1].map(normalizeHeader) : [];
  const prevHdr2 = headerRowIdx > 1 ? matrix[headerRowIdx - 2].map(normalizeHeader) : [];
  const nextHdr1 = headerRowIdx >= 0 && headerRowIdx + 1 < matrix.length ? matrix[headerRowIdx + 1].map(normalizeHeader) : [];
  const nextIsSubheader = nextHdr1.some((h) => h === '1%' || h === '2%' || h === '5%');

  const findCol = (
    pred: (h: string, p1: string, p2: string, idx: number) => boolean,
    fallback: number
  ): number => {
    for (let c = 0; c < Math.max(mainHdr.length, prevHdr1.length, prevHdr2.length, nextHdr1.length); c++) {
      const subOrMain = nextIsSubheader ? nextHdr1[c] || mainHdr[c] || '' : mainHdr[c] || '';
      const parentOrPrev = nextIsSubheader ? mainHdr[c] || prevHdr1[c] || '' : prevHdr1[c] || '';
      if (pred(subOrMain, parentOrPrev, prevHdr2[c] || '', c)) return c;
    }
    return fallback;
  };

  const isPurchasesLayout =
    mode === 'PURCHASES' ||
    mainHdr.some((h) => h.includes('PAYEE/SUPPLIER') || h.includes('WITHHOLDING AGENT') || h.includes('ACCOUNT TITLE'));

  const findAddress2Col = (addrIdx: number, fallbackIdx: number): number => {
    const explicit = findCol(
      (h, p1) =>
        h.includes('CITY') ||
        h.includes('DISTRICT') ||
        h.includes('ADDRESS 2') ||
        p1.includes('CITY') ||
        p1.includes('DISTRICT') ||
        p1.includes('ADDRESS 2'),
      -1
    );
    if (explicit >= 0 && explicit !== addrIdx) return explicit;
    if (addrIdx >= 0 && (mainHdr[addrIdx + 1] ?? '') === '' && (prevHdr1[addrIdx + 1] ?? '') === '') {
      return addrIdx + 1;
    }
    return fallbackIdx;
  };

  const pAddr1 = findCol((h, p1) => h.startsWith('ADDRESS') || h.includes('BRGY') || h.includes('BARANGAY') || h.includes('MUNICIPALITY') || p1.startsWith('ADDRESS') || p1.includes('BRGY'), 6);
  const pAddr2 = findAddress2Col(pAddr1, -1);

  const sAddr1 = findCol((h, p1) => h.startsWith('ADDRESS') || h.includes('BRGY') || h.includes('BARANGAY') || h.includes('MUNICIPALITY') || p1.startsWith('ADDRESS') || p1.includes('BRGY'), 5);
  const sAddr2 = findAddress2Col(sAddr1, 6);

  const colMap = isPurchasesLayout
    ? {
        date: findCol((h, p1) => h === 'DATE' || p1 === 'DATE', 0),
        month: findCol((h, p1) => h === 'MONTH' || p1 === 'MONTH', 1),
        branch: findCol((h, p1) => h.includes('BRANCH') || h.includes('TRADE NAME') || p1.includes('BRANCH'), 2),
        payor: findCol((h, p1) => h.includes('PAYEE') || h.includes('SUPPLIER') || h === 'PAYOR' || p1.includes('PAYEE'), 3),
        classification: findCol((h, p1) => h.includes('CLASSIFICATION') || p1.includes('CLASSIFICATION'), 4),
        tin: findCol((h, p1) => h === 'TIN' || p1 === 'TIN', 5),
        address: pAddr1,
        address2: pAddr2,
        supportingDocs: findCol((h, p1) => h.includes('SUPPORTING') || p1.includes('SUPPORTING'), 8),
        referenceNo: findCol((h, p1) => h.includes('REFERENCE') || p1.includes('REFERENCE'), 9),
        particular: findCol((h, p1) => h.includes('PARTICULAR') || p1.includes('PARTICULAR'), 10),
        accountTitle: findCol((h, p1) => h.includes('ACCOUNT TITLE') || p1.includes('ACCOUNT TITLE'), 11),
        category: findCol((h, p1) => h.includes('GOODS, SERVICES') || p1.includes('GOODS, SERVICES'), 12),
        withholdingAgent: findCol((h, p1) => h.includes('WITHHOLDING AGENT') || p1.includes('WITHHOLDING AGENT'), 13),
        privateOrGovt: -1,
        nonVatExempt: findCol((h, p1) => h.includes('NON-VAT') || p1.includes('NON-VAT'), 14),
        grossOfVat: findCol((h, p1) => h.includes('GROSS OF VAT') || p1.includes('GROSS OF VAT'), 15),
        netOfVat: findCol((h, p1) => h.includes('NET OF VAT') || p1.includes('NET OF VAT'), 16),
        vat: findCol((h, p1) => h === 'VAT' || p1 === 'VAT', 17),
        total: findCol((h, p1) => h === 'TOTAL' || p1 === 'TOTAL', 18),
        wtGoods1: findCol((h, p1) => h === '1%' || p1 === 'GOODS', 19),
        wtServices2: findCol((h, p1) => h === '2%' || p1 === 'SERVICES', 20),
        wtRental5: findCol((h, p1) => (h === '5%' && p1 === 'RENTAL') || p1 === 'RENTAL' || h === '5%', 21),
        wtVat5: -1,
        actual: -1,
        remarks: -1,
      }
    : {
        date: findCol((h, p1) => h === 'DATE' || p1 === 'DATE', 0),
        month: findCol((h, p1) => h === 'MONTH' || p1 === 'MONTH', 1),
        branch: findCol((h, p1) => h.includes('BRANCH') || h.includes('TRADE NAME') || p1.includes('BRANCH'), 2),
        payor: findCol((h, p1) => h === 'PAYOR' || p1 === 'PAYOR' || h.includes('SUPPLIER') || h.includes('PAYEE'), 3),
        classification: -1,
        tin: findCol((h, p1) => h === 'TIN' || p1 === 'TIN', 4),
        address: sAddr1,
        address2: sAddr2,
        supportingDocs: -1,
        referenceNo: -1,
        particular: -1,
        accountTitle: -1,
        category: findCol((h, p1) => h.includes('GOODS, SERVICES') || p1.includes('GOODS, SERVICES'), 7),
        withholdingAgent: -1,
        privateOrGovt: findCol((h, p1) => h.includes('PRIVATE') || p1.includes('PRIVATE'), 8),
        nonVatExempt: findCol((h, p1) => h.includes('NON-VAT') || p1.includes('NON-VAT'), 9),
        grossOfVat: findCol((h, p1) => h.includes('GROSS OF VAT') || p1.includes('GROSS OF VAT'), 10),
        netOfVat: findCol((h, p1) => h.includes('NET OF VAT') || p1.includes('NET OF VAT'), 11),
        vat: findCol((h, p1) => h === 'VAT' || p1 === 'VAT', 12),
        total: findCol((h, p1) => h === 'TOTAL' || p1 === 'TOTAL', 13),
        wtGoods1: findCol((h, p1) => h === '1%' || p1 === 'GOODS', 14),
        wtServices2: findCol((h, p1) => h === '2%' || p1 === 'SERVICES', 15),
        wtRental5: findCol((h, p1) => (h === '5%' && p1 === 'RENTAL') || p1 === 'RENTAL', 16),
        wtVat5: findCol((h, p1) => (h === '5%' && p1 === 'VAT') || p1 === 'VAT', 17),
        actual: findCol((h, p1, p2) => h === 'ACTUAL' || p1 === 'ACTUAL' || p2 === 'ACTUAL', 18),
        remarks: findCol((h, p1, p2) => h === 'REMARKS' || p1 === 'REMARKS' || p2 === 'REMARKS', 19),
      };

  const startRow = headerRowIdx >= 0 ? headerRowIdx + (nextIsSubheader ? 2 : 1) : 0;
  const importedRows: LedgerRow[] = [];
  const tinMap = new Map<string, TinRecord>();
  const now = new Date().toISOString();

  let lastHeader = {
    date: '',
    month: '',
    branchTradeName: '',
    payor: '',
    tin: '',
    address: '',
    address2: '',
  };

  for (let r = startRow; r < matrix.length; r++) {
    const cells = matrix[r];
    if (!cells || cells.every((c) => !c || c === '-')) continue;

    const getCell = (idx: number) => (idx >= 0 ? stripControlChars(cells[idx] || '') : '');

    const rawDate = getCell(colMap.date);
    const rawMonth = getCell(colMap.month);
    const rawBranch = getCell(colMap.branch);
    const rawPayor = getCell(colMap.payor);
    const rawTin = getCell(colMap.tin);
    const rawAddress = getCell(colMap.address);
    const rawAddress2 = getCell(colMap.address2);
    const rawCategory = normalizeHeader(getCell(colMap.category));
    const rawPrivGovt = normalizeHeader(getCell(colMap.privateOrGovt));
    const rawClass = normalizeHeader(getCell(colMap.classification));
    const rawAgent = normalizeHeader(getCell(colMap.withholdingAgent));

    const nonVatExempt = parseAmount(getCell(colMap.nonVatExempt));
    const grossOfVat = parseAmount(getCell(colMap.grossOfVat));
    const netOfVat = parseAmount(getCell(colMap.netOfVat));
    const vat = parseAmount(getCell(colMap.vat));
    const total = parseAmount(getCell(colMap.total));
    const wtGoods1 = parseAmount(getCell(colMap.wtGoods1));
    const wtServices2 = parseAmount(getCell(colMap.wtServices2));
    const wtRental5 = parseAmount(getCell(colMap.wtRental5));
    const wtVat5 = parseAmount(getCell(colMap.wtVat5));
    const actual = parseAmount(getCell(colMap.actual));
    const remarks = stripControlChars(getCell(colMap.remarks));

    const hasTransactionData =
      rawDate !== '' ||
      rawPayor !== '' ||
      rawCategory !== '' ||
      nonVatExempt !== null ||
      grossOfVat !== null ||
      total !== null ||
      actual !== null;

    if (!hasTransactionData) continue;

    const hasOwnHeader = Boolean(rawDate || rawPayor || rawBranch || rawTin);
    const date = rawDate || (hasOwnHeader ? '' : lastHeader.date);
    const month = (rawMonth || deriveMonthFromDate(date) || (hasOwnHeader ? '' : lastHeader.month)).toUpperCase();
    const branchTradeName = rawBranch || (hasOwnHeader ? '' : lastHeader.branchTradeName);
    const payor = rawPayor || (hasOwnHeader ? '' : lastHeader.payor);
    const tin = formatTin(rawTin || (hasOwnHeader ? '' : lastHeader.tin));
    const address = rawAddress || (hasOwnHeader ? '' : lastHeader.address);
    const address2 = rawAddress2 || (hasOwnHeader ? '' : lastHeader.address2);

    if (rawDate || rawPayor) {
      lastHeader = { date, month, branchTradeName, payor, tin, address, address2 };
    }

    const category: TransactionCategory =
      rawCategory === 'N/A'
        ? 'N/A'
        : rawCategory === 'SERVICES'
        ? 'SERVICES'
        : rawCategory === 'RENTAL'
        ? 'RENTAL'
        : 'GOODS';

    const privateOrGovt: EntityType = rawPrivGovt === 'GOVT' ? 'GOVT' : 'PRIVATE';
    const applyGovtVat5 = privateOrGovt === 'GOVT' && (wtVat5 ?? 0) > 0;

    const payeeClassification: PayeeClassification | undefined = isPurchasesLayout
      ? rawClass.includes('IND')
        ? 'INDIVIDUAL'
        : rawClass.includes('CORP')
        ? 'CORP'
        : 'N/A'
      : undefined;

    const withholdingAgent: YesNo | undefined = isPurchasesLayout
      ? rawAgent === 'NO'
        ? 'NO'
        : rawAgent === 'YES'
        ? 'YES'
        : (wtGoods1 ?? 0) + (wtServices2 ?? 0) + (wtRental5 ?? 0) > 0
        ? 'YES'
        : 'NO'
      : undefined;

    const row: LedgerRow = {
      id: `imp-${Date.now()}-${r}-${Math.random().toString(36).slice(2, 7)}`,
      date,
      month,
      branchTradeName,
      payor,
      tin,
      address,
      address2,
      category,
      privateOrGovt,
      payeeClassification,
      supportingDocs: isPurchasesLayout ? getCell(colMap.supportingDocs).trim().toUpperCase() : undefined,
      referenceNo: isPurchasesLayout ? getCell(colMap.referenceNo).trim() : undefined,
      particular: isPurchasesLayout ? getCell(colMap.particular).trim().toUpperCase() : undefined,
      accountTitle: isPurchasesLayout ? getCell(colMap.accountTitle).trim().toUpperCase() : undefined,
      withholdingAgent,
      nonVatExempt,
      grossOfVat,
      netOfVat,
      vat,
      total,
      wtGoods1,
      wtServices2,
      wtRental5,
      wtVat5,
      actual,
      remarks,
      applyGovtVat5,
      manualOverride: false,
      createdAt: now,
      updatedAt: now,
    };

    importedRows.push(row);

    const digits = normalizeTinDigits(tin);
    if (digits && payor) {
      const taxStatus: TaxStatus = (grossOfVat ?? 0) > 0 ? 'VATABLE' : 'NON_VAT';
      tinMap.set(digits, {
        id: `tin-${digits}`,
        tin: formatTin(digits),
        digits,
        payor,
        branchTradeName,
        address,
        address2,
        defaultPrivateOrGovt: privateOrGovt,
        defaultCategory: category,
        defaultTaxStatus: taxStatus,
        defaultPayeeClassification: payeeClassification,
        defaultAccountTitle: row.accountTitle,
        defaultWithholdingAgent: withholdingAgent,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return {
    detectedMode: isPurchasesLayout ? 'PURCHASES' : detectedMode ?? fallbackMode,
    rows: importedRows,
    extractedTins: Array.from(tinMap.values()),
  };
}

/**
 * Exports either the 20-column SALES layout or the exact 22-column PURCHASES layout.
 */
export function exportFilingCsv(mode: LedgerMode, rows: LedgerRow[]): string {
  if (mode === 'PURCHASES') {
    const header1 = [
      'PURCHASES',
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      'WITHHOLDING TAX',
      '',
      '',
    ];
    const header2 = [
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      'GOODS',
      'SERVICES',
      'RENTAL',
    ];
    const header3 = [
      'DATE',
      'MONTH',
      'BRANCH/ TRADE NAME',
      'PAYEE/SUPPLIER',
      'CLASSIFICATION OF PAYEE/SUPPLIER (N/A, INDIVIDUAL OR CORP)',
      'TIN',
      'ADDRESS (BARANGAY / MUNICIPALITY)',
      'ADDRESS (CITY / DISTRICT)',
      'SUPPORTING DOCS',
      'REFERENCE NO.',
      'PARTICULAR',
      'ACCOUNT TITLE',
      'N/A, GOODS, SERVICES OR RENTAL',
      'WITHHOLDING AGENT (YES OR NO)',
      'NON-VAT/VAT EXEMPT',
      'GROSS OF VAT',
      'NET OF VAT',
      'VAT',
      'TOTAL',
      '1%',
      '2%',
      '5%',
    ];

    const dataLines = rows.map((r) => [
      r.date,
      r.month,
      r.branchTradeName,
      r.payor,
      r.payeeClassification ?? 'N/A',
      r.tin,
      r.address,
      r.address2 ?? '',
      r.supportingDocs ?? '',
      r.referenceNo ?? '',
      r.particular ?? '',
      r.accountTitle ?? '',
      r.category,
      r.withholdingAgent ?? 'NO',
      formatAccounting(r.nonVatExempt),
      formatAccounting(r.grossOfVat),
      formatAccounting(r.netOfVat),
      formatAccounting(r.vat),
      formatAccounting(r.total),
      formatAccounting(r.wtGoods1),
      formatAccounting(r.wtServices2),
      formatAccounting(r.wtRental5),
    ]);

    return '\uFEFF' + [header1, header2, header3, ...dataLines].map((line) => line.map(escapeCsvCell).join(',')).join('\r\n');
  }

  const header1 = [
    'SALES',
    '', '', '', '', '', '', '', '', '', '', '', '', '',
    'WITHHOLDING TAX',
    '', '', '',
    'ACTUAL',
    'REMARKS',
  ];
  const header2 = [
    '', '', '', '', '', '', '', '', '', '', '', '', '', '',
    'GOODS',
    'SERVICES',
    'RENTAL',
    'VAT',
    '', '',
  ];
  const header3 = [
    'DATE',
    'MONTH',
    'BRANCH/ TRADE NAME',
    'PAYOR',
    'TIN',
    'ADDRESS (BARANGAY / MUNICIPALITY)',
    'ADDRESS (CITY / DISTRICT)',
    'GOODS, SERVICES OR RENTAL',
    'PRIVATE OR GOVT',
    'NON-VAT/VAT EXEMPT',
    'GROSS OF VAT',
    'NET OF VAT',
    'VAT',
    'TOTAL',
    '1%',
    '2%',
    '5%',
    '5%',
    '',
    '',
  ];

  const dataLines = rows.map((r) => [
    r.date,
    r.month,
    r.branchTradeName,
    r.payor,
    r.tin,
    r.address,
    r.address2 ?? '',
    r.category,
    r.privateOrGovt,
    formatAccounting(r.nonVatExempt),
    formatAccounting(r.grossOfVat),
    formatAccounting(r.netOfVat),
    formatAccounting(r.vat),
    formatAccounting(r.total),
    formatAccounting(r.wtGoods1),
    formatAccounting(r.wtServices2),
    formatAccounting(r.wtRental5),
    formatAccounting(r.wtVat5),
    formatAccounting(r.actual),
    r.remarks,
  ]);

  return '\uFEFF' + [header1, header2, header3, ...dataLines].map((line) => line.map(escapeCsvCell).join(',')).join('\r\n');
}

export function triggerFileDownload(filename: string, content: string, mimeType = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
