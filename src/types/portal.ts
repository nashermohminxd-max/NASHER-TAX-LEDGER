export type UserRole = 'admin' | 'client';

export type TaxClassification = 'VAT' | 'NON_VAT';

export type VaultEntryScope = 'GENERAL' | 'SALES' | 'PURCHASES' | 'EXPENSE' | 'SLP';

export interface ClientDirectory {
  id: string;
  slug: string;
  companyName: string;
  tradeName: string;
  tin: string;
  rdoCode: string;
  taxClassification: TaxClassification;
  storageQuotaBytes: number;
  assignedEmail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  clientDirectoryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VaultXlsxFile {
  id: string;
  clientDirectoryId: string;
  fileName: string;
  storagePath: string;
  bucketName: string;
  sizeBytes: number;
  taxYear: string;
  taxPeriod: string;
  entryScope: VaultEntryScope;
  sheetName?: string;
  previewHeaders: string[];
  previewRows: string[][];
  uploadedBy: string;
  uploadedByEmail: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface XlsxPreviewData {
  sheetName: string;
  sheetNames: string[];
  headers: string[];
  rows: string[][];
  totalEstimatedRows: number;
}
