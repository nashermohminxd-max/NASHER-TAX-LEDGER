import type {
  LedgerMode,
  LedgerRow,
  PayeeClassification,
  TinRecord,
  TransactionCategory,
  YesNo,
} from '../types/tax';
import { calculateRowTaxes } from '../utils/taxEngine';

const NOW = '2026-09-15T08:00:00.000Z';

export const SEED_TIN_DIRECTORY: TinRecord[] = [
  {
    id: 'tin-000412890000',
    tin: '000-412-890-000',
    digits: '000412890000',
    payor: 'PLGU ZAMBOANGA SIBUGAY',
    branchTradeName: 'G POWER',
    address: 'CAPITOL COMPOUND, IPIL',
    address2: 'ZAMBOANGA SIBUGAY',
    defaultPrivateOrGovt: 'GOVT',
    defaultCategory: 'GOODS',
    defaultTaxStatus: 'VATABLE',
    defaultPayeeClassification: 'N/A',
    defaultAccountTitle: 'TAXES & LICENSES',
    defaultWithholdingAgent: 'NO',
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'tin-001845221000',
    tin: '001-845-221-000',
    digits: '001845221000',
    payor: 'ZAMBOANGA PENINSULA TRADING CORP.',
    branchTradeName: 'ZPTC MAIN',
    address: 'POBLACION, IPIL',
    address2: 'ZAMBOANGA SIBUGAY',
    defaultPrivateOrGovt: 'PRIVATE',
    defaultCategory: 'SERVICES',
    defaultTaxStatus: 'VATABLE',
    defaultPayeeClassification: 'CORP',
    defaultAccountTitle: 'REPAIRS & MAINTENANCE',
    defaultWithholdingAgent: 'YES',
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'tin-000319774000',
    tin: '000-319-774-000',
    digits: '000319774000',
    payor: 'LGU MUNICIPALITY OF IPIL',
    branchTradeName: 'IPIL MUNICIPAL HALL',
    address: 'DON ANDRES, IPIL',
    address2: 'ZAMBOANGA SIBUGAY',
    defaultPrivateOrGovt: 'GOVT',
    defaultCategory: 'GOODS',
    defaultTaxStatus: 'VATABLE',
    defaultPayeeClassification: 'N/A',
    defaultAccountTitle: 'TAXES & LICENSES',
    defaultWithholdingAgent: 'NO',
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'tin-004921650000',
    tin: '004-921-650-000',
    digits: '004921650000',
    payor: 'DIPOLOG AGRI-SUPPLY INC.',
    branchTradeName: 'DIPOLOG BRANCH',
    address: 'MIPUTAK',
    address2: 'DIPOLOG CITY',
    defaultPrivateOrGovt: 'PRIVATE',
    defaultCategory: 'GOODS',
    defaultTaxStatus: 'NON_VAT',
    defaultPayeeClassification: 'CORP',
    defaultAccountTitle: 'COST OF GOODS SOLD',
    defaultWithholdingAgent: 'YES',
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'tin-000168231000',
    tin: '000-168-231-000',
    digits: '000168231000',
    payor: 'PETRON CORPORATION',
    branchTradeName: 'PETRON IPIL STATION',
    address: 'VETERANS VILLAGE, IPIL',
    address2: 'ZAMBOANGA SIBUGAY',
    defaultPrivateOrGovt: 'PRIVATE',
    defaultCategory: 'GOODS',
    defaultTaxStatus: 'VATABLE',
    defaultPayeeClassification: 'CORP',
    defaultAccountTitle: 'FUEL & OIL',
    defaultWithholdingAgent: 'YES',
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'tin-002774510000',
    tin: '002-774-510-000',
    digits: '002774510000',
    payor: 'ZAMBOANGA SIBUGAY II ELECTRIC COOP.',
    branchTradeName: 'ZAMSURECO II',
    address: 'TAWAY, IPIL',
    address2: 'ZAMBOANGA SIBUGAY',
    defaultPrivateOrGovt: 'PRIVATE',
    defaultCategory: 'SERVICES',
    defaultTaxStatus: 'VATABLE',
    defaultPayeeClassification: 'CORP',
    defaultAccountTitle: 'UTILITIES EXPENSE',
    defaultWithholdingAgent: 'YES',
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'tin-005612889001',
    tin: '005-612-889-001',
    digits: '005612889001',
    payor: 'PAGADIAN OFFICE SOLUTIONS',
    branchTradeName: 'POS COMMERCIAL',
    address: 'SAN FRANCISCO DISTRICT',
    address2: 'PAGADIAN CITY',
    defaultPrivateOrGovt: 'PRIVATE',
    defaultCategory: 'GOODS',
    defaultTaxStatus: 'VATABLE',
    defaultPayeeClassification: 'INDIVIDUAL',
    defaultAccountTitle: 'OFFICE SUPPLIES',
    defaultWithholdingAgent: 'NO',
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'tin-142889310000',
    tin: '142-889-310-000',
    digits: '142889310000',
    payor: 'SANTOS COMMERCIAL PROPERTIES',
    branchTradeName: 'IPIL WAREHOUSE BLDG',
    address: 'POBLACION, IPIL',
    address2: 'ZAMBOANGA SIBUGAY',
    defaultPrivateOrGovt: 'PRIVATE',
    defaultCategory: 'RENTAL',
    defaultTaxStatus: 'NON_VAT',
    defaultPayeeClassification: 'INDIVIDUAL',
    defaultAccountTitle: 'RENT EXPENSE',
    defaultWithholdingAgent: 'YES',
    createdAt: NOW,
    updatedAt: NOW,
  },
];

function makeSeedRow(
  id: string,
  params: {
    mode?: LedgerMode;
    splitGroupId?: string;
    date: string;
    month: string;
    branchTradeName: string;
    payor: string;
    tin: string;
    address: string;
    address2: string;
    category: TransactionCategory;
    privateOrGovt: 'PRIVATE' | 'GOVT';
    payeeClassification?: PayeeClassification;
    supportingDocs?: string;
    referenceNo?: string;
    particular?: string;
    accountTitle?: string;
    withholdingAgent?: YesNo;
    taxStatus: 'VATABLE' | 'NON_VAT';
    amount: number;
    applyGovtVat5: boolean;
    actual?: number | null;
    remarks?: string;
  }
): LedgerRow {
  const mode = params.mode ?? 'SALES';
  const calc = calculateRowTaxes({
    mode,
    category: params.category,
    privateOrGovt: params.privateOrGovt,
    taxStatus: params.taxStatus,
    amount: params.amount,
    applyGovtVat5: params.applyGovtVat5,
    withholdingAgent: params.withholdingAgent ?? 'YES',
  });

  return {
    id,
    splitGroupId: params.splitGroupId,
    date: params.date,
    month: params.month,
    branchTradeName: params.branchTradeName,
    payor: params.payor,
    tin: params.tin,
    address: params.address,
    address2: params.address2,
    category: params.category,
    privateOrGovt: params.privateOrGovt,
    payeeClassification: params.payeeClassification,
    supportingDocs: params.supportingDocs,
    referenceNo: params.referenceNo,
    particular: params.particular,
    accountTitle: params.accountTitle,
    withholdingAgent: params.withholdingAgent,
    nonVatExempt: calc.nonVatExempt,
    grossOfVat: calc.grossOfVat,
    netOfVat: calc.netOfVat,
    vat: calc.vat,
    total: calc.total,
    wtGoods1: calc.wtGoods1,
    wtServices2: calc.wtServices2,
    wtRental5: calc.wtRental5,
    wtVat5: calc.wtVat5,
    actual: mode === 'SALES' ? (params.actual !== undefined ? params.actual : calc.expectedActual) : null,
    remarks: params.remarks ?? '',
    applyGovtVat5: params.applyGovtVat5,
    manualOverride: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

export const SEED_SALES_ROWS: LedgerRow[] = [
  makeSeedRow('seed-s-1', {
    splitGroupId: 'split-plgu-0902',
    date: '9/2/2026',
    month: 'SEPTEMBER',
    branchTradeName: 'G POWER',
    payor: 'PLGU ZAMBOANGA SIBUGAY',
    tin: '000-412-890-000',
    address: 'CAPITOL COMPOUND, IPIL',
    address2: 'ZAMBOANGA SIBUGAY',
    category: 'GOODS',
    privateOrGovt: 'GOVT',
    taxStatus: 'NON_VAT',
    amount: 15000,
    applyGovtVat5: true,
    remarks: 'SI #4021 — Hardware & electrical supplies',
  }),
  makeSeedRow('seed-s-2', {
    splitGroupId: 'split-plgu-0902',
    date: '9/2/2026',
    month: 'SEPTEMBER',
    branchTradeName: 'G POWER',
    payor: 'PLGU ZAMBOANGA SIBUGAY',
    tin: '000-412-890-000',
    address: 'CAPITOL COMPOUND, IPIL',
    address2: 'ZAMBOANGA SIBUGAY',
    category: 'SERVICES',
    privateOrGovt: 'GOVT',
    taxStatus: 'VATABLE',
    amount: 20000,
    applyGovtVat5: true,
    remarks: 'SI #4021 — Installation & preventive maintenance',
  }),
  makeSeedRow('seed-s-3', {
    splitGroupId: 'split-plgu-0902',
    date: '9/2/2026',
    month: 'SEPTEMBER',
    branchTradeName: 'G POWER',
    payor: 'PLGU ZAMBOANGA SIBUGAY',
    tin: '000-412-890-000',
    address: 'CAPITOL COMPOUND, IPIL',
    address2: 'ZAMBOANGA SIBUGAY',
    category: 'RENTAL',
    privateOrGovt: 'PRIVATE',
    taxStatus: 'NON_VAT',
    amount: 15000,
    applyGovtVat5: false,
    remarks: 'SI #4021 — Generator unit rental',
  }),
  makeSeedRow('seed-s-4', {
    date: '9/10/2026',
    month: 'SEPTEMBER',
    branchTradeName: 'ZPTC MAIN',
    payor: 'ZAMBOANGA PENINSULA TRADING CORP.',
    tin: '001-845-221-000',
    address: 'POBLACION, IPIL',
    address2: 'ZAMBOANGA SIBUGAY',
    category: 'SERVICES',
    privateOrGovt: 'PRIVATE',
    taxStatus: 'VATABLE',
    amount: 56000,
    applyGovtVat5: false,
    actual: 55000,
    remarks: 'OR #1184 — BIR Form 2307 received',
  }),
  makeSeedRow('seed-s-5', {
    date: '8/24/2026',
    month: 'AUGUST',
    branchTradeName: 'IPIL MUNICIPAL HALL',
    payor: 'LGU MUNICIPALITY OF IPIL',
    tin: '000-319-774-000',
    address: 'DON ANDRES, IPIL',
    address2: 'ZAMBOANGA SIBUGAY',
    category: 'GOODS',
    privateOrGovt: 'GOVT',
    taxStatus: 'VATABLE',
    amount: 44800,
    applyGovtVat5: true,
    remarks: 'SI #3988 — LGU procurement batch',
  }),
  makeSeedRow('seed-s-6', {
    date: '8/18/2026',
    month: 'AUGUST',
    branchTradeName: 'DIPOLOG BRANCH',
    payor: 'DIPOLOG AGRI-SUPPLY INC.',
    tin: '004-921-650-000',
    address: 'MIPUTAK',
    address2: 'DIPOLOG CITY',
    category: 'GOODS',
    privateOrGovt: 'PRIVATE',
    taxStatus: 'NON_VAT',
    amount: 18500,
    applyGovtVat5: false,
    actual: null,
    remarks: 'Pending check collection',
  }),
];

export const SEED_PURCHASES_ROWS: LedgerRow[] = [
  makeSeedRow('seed-p-1', {
    mode: 'PURCHASES',
    date: '9/4/2026',
    month: 'SEPTEMBER',
    branchTradeName: 'PETRON IPIL STATION',
    payor: 'PETRON CORPORATION',
    payeeClassification: 'CORP',
    tin: '000-168-231-000',
    address: 'VETERANS VILLAGE, IPIL',
    address2: 'ZAMBOANGA SIBUGAY',
    supportingDocs: 'SALES INVOICE',
    referenceNo: 'SI-0088412',
    particular: 'DIESEL FUEL FOR DELIVERY FLEET',
    accountTitle: 'FUEL & OIL',
    category: 'GOODS',
    withholdingAgent: 'YES',
    privateOrGovt: 'PRIVATE',
    taxStatus: 'VATABLE',
    amount: 11200,
    applyGovtVat5: false,
  }),
  makeSeedRow('seed-p-2', {
    mode: 'PURCHASES',
    date: '9/9/2026',
    month: 'SEPTEMBER',
    branchTradeName: 'ZAMSURECO II',
    payor: 'ZAMBOANGA SIBUGAY II ELECTRIC COOP.',
    payeeClassification: 'CORP',
    tin: '002-774-510-000',
    address: 'TAWAY, IPIL',
    address2: 'ZAMBOANGA SIBUGAY',
    supportingDocs: 'SOA / BILL',
    referenceNo: 'SOA-2026-0911',
    particular: 'SEPTEMBER ELECTRICITY CONSUMPTION',
    accountTitle: 'UTILITIES EXPENSE',
    category: 'SERVICES',
    withholdingAgent: 'YES',
    privateOrGovt: 'PRIVATE',
    taxStatus: 'VATABLE',
    amount: 16800,
    applyGovtVat5: false,
  }),
  makeSeedRow('seed-p-3', {
    mode: 'PURCHASES',
    date: '9/12/2026',
    month: 'SEPTEMBER',
    branchTradeName: 'IPIL WAREHOUSE BLDG',
    payor: 'SANTOS COMMERCIAL PROPERTIES',
    payeeClassification: 'INDIVIDUAL',
    tin: '142-889-310-000',
    address: 'POBLACION, IPIL',
    address2: 'ZAMBOANGA SIBUGAY',
    supportingDocs: 'OFFICIAL RECEIPT',
    referenceNo: 'OR-001092',
    particular: 'MONTHLY WAREHOUSE LEASE',
    accountTitle: 'RENT EXPENSE',
    category: 'RENTAL',
    withholdingAgent: 'YES',
    privateOrGovt: 'PRIVATE',
    taxStatus: 'NON_VAT',
    amount: 15000,
    applyGovtVat5: false,
  }),
  makeSeedRow('seed-p-4', {
    mode: 'PURCHASES',
    date: '8/28/2026',
    month: 'AUGUST',
    branchTradeName: 'POS COMMERCIAL',
    payor: 'PAGADIAN OFFICE SOLUTIONS',
    payeeClassification: 'INDIVIDUAL',
    tin: '005-612-889-001',
    address: 'SAN FRANCISCO DISTRICT',
    address2: 'PAGADIAN CITY',
    supportingDocs: 'SALES INVOICE',
    referenceNo: 'SI-0004410',
    particular: 'PRINTER TONER & BOND PAPER SUPPLIES',
    accountTitle: 'OFFICE SUPPLIES',
    category: 'GOODS',
    withholdingAgent: 'NO',
    privateOrGovt: 'PRIVATE',
    taxStatus: 'VATABLE',
    amount: 22400,
    applyGovtVat5: false,
  }),
  makeSeedRow('seed-p-5', {
    mode: 'PURCHASES',
    date: '8/20/2026',
    month: 'AUGUST',
    branchTradeName: 'IPIL MUNICIPAL HALL',
    payor: 'LGU MUNICIPALITY OF IPIL',
    payeeClassification: 'N/A',
    tin: '000-319-774-000',
    address: 'DON ANDRES, IPIL',
    address2: 'ZAMBOANGA SIBUGAY',
    supportingDocs: 'OFFICIAL RECEIPT',
    referenceNo: 'OR-991042',
    particular: 'SANITARY & FIRE INSPECTION RENEWAL FEE',
    accountTitle: 'TAXES & LICENSES',
    category: 'N/A',
    withholdingAgent: 'NO',
    privateOrGovt: 'GOVT',
    taxStatus: 'NON_VAT',
    amount: 4500,
    applyGovtVat5: false,
  }),
];

function splitLegacyAddress(addr: string): { address: string; address2: string } {
  const parts = (addr || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return { address: addr || '', address2: '' };
  const last = parts.pop() || '';
  return { address: parts.join(', '), address2: last };
}

export function upgradeSalesRows(rows: LedgerRow[]): LedgerRow[] {
  const seedMap = new Map(SEED_SALES_ROWS.map((r) => [r.id, r]));
  return rows.map((r) => {
    const seedMatch = seedMap.get(r.id);
    if (seedMatch && r.address2 === undefined) {
      return seedMatch;
    }
    if (r.address2 === undefined) {
      const split = splitLegacyAddress(r.address);
      return { ...r, address: split.address, address2: split.address2 };
    }
    return r;
  });
}

export function upgradePurchasesRows(rows: LedgerRow[]): LedgerRow[] {
  const seedMap = new Map(SEED_PURCHASES_ROWS.map((r) => [r.id, r]));
  return rows.map((r) => {
    const seedMatch = seedMap.get(r.id);
    if (seedMatch && (!r.accountTitle || r.address2 === undefined)) {
      return seedMatch;
    }
    const split = r.address2 === undefined ? splitLegacyAddress(r.address) : { address: r.address, address2: r.address2 };
    return {
      ...r,
      address: split.address,
      address2: split.address2,
      payeeClassification: r.payeeClassification ?? 'N/A',
      supportingDocs: r.supportingDocs ?? '',
      referenceNo: r.referenceNo ?? '',
      particular: r.particular ?? r.remarks ?? '',
      accountTitle: r.accountTitle ?? '',
      withholdingAgent:
        r.withholdingAgent ??
        ((r.wtGoods1 ?? 0) + (r.wtServices2 ?? 0) + (r.wtRental5 ?? 0) > 0 ? 'YES' : 'NO'),
    };
  });
}

export function upgradeTinRecords(records: TinRecord[]): TinRecord[] {
  const seedMap = new Map(SEED_TIN_DIRECTORY.map((r) => [r.id, r]));
  return records.map((t) => {
    const seedMatch = seedMap.get(t.id);
    if (seedMatch && t.address2 === undefined) {
      return seedMatch;
    }
    if (t.address2 === undefined) {
      const split = splitLegacyAddress(t.address);
      return { ...t, address: split.address, address2: split.address2 };
    }
    return t;
  });
}
