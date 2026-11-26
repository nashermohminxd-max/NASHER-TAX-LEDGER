export type LedgerMode = 'SALES' | 'PURCHASES';

export type TransactionCategory = 'N/A' | 'GOODS' | 'SERVICES' | 'RENTAL';

export type EntityType = 'PRIVATE' | 'GOVT';

export type PayeeClassification = 'N/A' | 'INDIVIDUAL' | 'CORP';

export type YesNo = 'YES' | 'NO';

export type TaxStatus = 'VATABLE' | 'NON_VAT';

export type AuditStatus = 'PENDING' | 'APPROVED' | 'FLAGGED';

export type LedgerEntryKind = 'SALES' | 'PURCHASES' | 'EXPENSE';

export interface LedgerRow {
  id: string;
  splitGroupId?: string;
  entryKind?: LedgerEntryKind;
  auditStatus?: AuditStatus;
  auditNote?: string;
  date: string;
  month: string;
  branchTradeName: string;
  payor: string; // PAYOR in Sales mode, PAYEE/SUPPLIER in Purchases/Expense mode
  tin: string;
  address: string; // Barangay / Municipality
  address2?: string; // City / District
  category: TransactionCategory; // Sales: GOODS|SERVICES|RENTAL; Purchases: N/A|GOODS|SERVICES|RENTAL
  privateOrGovt: EntityType; // Used in Sales mode

  // Purchases-specific schema fields
  payeeClassification?: PayeeClassification;
  supportingDocs?: string;
  referenceNo?: string;
  particular?: string;
  accountTitle?: string;
  withholdingAgent?: YesNo;

  // Monetary & Tax columns
  nonVatExempt: number | null;
  grossOfVat: number | null;
  netOfVat: number | null;
  vat: number | null;
  total: number | null;
  wtGoods1: number | null;
  wtServices2: number | null;
  wtRental5: number | null;
  wtVat5: number | null; // Sales only
  actual: number | null; // Sales only
  remarks: string; // Sales only

  applyGovtVat5: boolean;
  manualOverride: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TinRecord {
  id: string;
  tin: string; // Formatted with dashes e.g. 000-412-890-000
  digits: string; // Normalized digits-only key
  payor: string;
  branchTradeName: string;
  address: string; // Barangay / Municipality
  address2?: string; // City / District
  defaultPrivateOrGovt: EntityType;
  defaultCategory: TransactionCategory;
  defaultTaxStatus: TaxStatus;
  defaultPayeeClassification?: PayeeClassification;
  defaultAccountTitle?: string;
  defaultWithholdingAgent?: YesNo;
  createdAt: string;
  updatedAt: string;
}

export interface AuditIssue {
  code:
    | 'MISSING_TIN'
    | 'INVALID_TIN_LENGTH'
    | 'MISSING_ADDRESS'
    | 'MISSING_DATE'
    | 'MISSING_MONTH'
    | 'MISSING_PAYOR'
    | 'MATH_VAT_MISMATCH'
    | 'MATH_TOTAL_MISMATCH'
    | 'MATH_WHT_MISMATCH'
    | 'WHT_CATEGORY_NA';
  severity: 'error' | 'warning';
  field: string;
  message: string;
  canAutoFix?: boolean;
}

export interface LedgerTotals {
  rowCount: number;
  flaggedCount: number;
  nonVatExempt: number;
  grossOfVat: number;
  netOfVat: number;
  vat: number;
  total: number;
  wtGoods1: number;
  wtServices2: number;
  wtRental5: number;
  wtVat5: number;
  totalWithholding: number;
  expectedNet: number;
  actual: number;
  variance: number;
}

export interface SplitLineDraft {
  key: string;
  category: TransactionCategory;
  taxStatus: TaxStatus;
  rawNonVat: string;
  rawAmount: string;
  applyGovtVat5: boolean;
  manualOverride: boolean;
  particular: string;
  accountTitle: string;
  nonVatExempt: number | null;
  grossOfVat: number | null;
  netOfVat: number | null;
  vat: number | null;
  total: number | null;
  wtGoods1: number | null;
  wtServices2: number | null;
  wtRental5: number | null;
  wtVat5: number | null;
  rawActual: string;
  remarks: string;
}

export interface ClientProfile {
  id: string;
  slug: string;
  name: string;
  tin?: string;
  rdo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientWorkspaceBackup {
  version: 1;
  exportedAt: string;
  client: ClientProfile;
  salesRows: LedgerRow[];
  purchasesRows: LedgerRow[];
  tinDirectory: TinRecord[];
  accountTitles: string[];
}

