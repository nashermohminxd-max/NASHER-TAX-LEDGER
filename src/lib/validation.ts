import { z } from 'zod';

const SAFE_TEXT_REGEX = /^[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F]*$/;

export function stripControlChars(value: string): string {
  return (value || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

export function stripDangerousKeysDeep<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((item) => stripDangerousKeysDeep(item)) as unknown as T;
  }
  if (input !== null && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = stripDangerousKeysDeep(v);
    }
    return out as T;
  }
  return input;
}

const safeString = (maxLen = 500) =>
  z
    .string()
    .max(maxLen, `Text must not exceed ${maxLen} characters.`)
    .regex(SAFE_TEXT_REGEX, 'Input contains invalid control characters.')
    .transform((s) => s.trim());

export const loginCredentialsSchema = z.object({
  identifier: safeString(160).refine((s) => s.length >= 1, 'Username is required.'),
  password: z
    .string()
    .min(1, 'Password is required.')
    .max(256, 'Password exceeds maximum length.'),
});

export const adminBootstrapSchema = z.object({
  email: safeString(160).refine((s) => s.length >= 2, 'Username must be at least 2 characters.'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(256, 'Password exceeds maximum length.'),
  fullName: safeString(160),
});

export const changePasswordSchema = z.object({
  userId: safeString(128).refine((s) => s.length >= 1, 'User ID is required.'),
  currentPassword: z.string().min(1, 'Current password is required.').max(256),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters.')
    .max(256, 'New password exceeds maximum length.'),
});

export const clientDirectoryInputSchema = z.object({
  companyName: safeString(200).refine((s) => s.length >= 1, 'Company name is required.'),
  tradeName: safeString(200).default(''),
  tin: safeString(32).default(''),
  rdoCode: safeString(24).default(''),
  taxClassification: z.enum(['VAT', 'NON_VAT']),
  assignLogin: z.boolean(),
  email: safeString(160).optional(),
  password: z.string().max(256).optional(),
  includeSampleRows: z.boolean().optional(),
});

export const assignCredentialsSchema = z.object({
  clientDirectoryId: safeString(128).refine((s) => s.length >= 1, 'Client directory ID is required.'),
  companyName: safeString(200),
  email: safeString(160).refine((s) => s.length >= 2, 'Enter a valid client username.'),
  password: z.string().max(256).optional(),
});

const finiteAmountOrNull = z
  .number()
  .finite()
  .min(-1e12, 'Amount out of valid range.')
  .max(1e12, 'Amount out of valid range.')
  .nullable();

export const ledgerRowSchema = z.object({
  id: safeString(128),
  splitGroupId: safeString(128).optional(),
  entryKind: z.enum(['SALES', 'PURCHASES', 'EXPENSE']).optional(),
  auditStatus: z.enum(['PENDING', 'APPROVED', 'FLAGGED']).optional(),
  auditNote: safeString(500).optional(),
  date: safeString(32),
  month: safeString(24),
  branchTradeName: safeString(200),
  payor: safeString(250),
  tin: safeString(32),
  address: safeString(300),
  address2: safeString(300).optional(),
  category: z.enum(['N/A', 'GOODS', 'SERVICES', 'RENTAL']),
  privateOrGovt: z.enum(['PRIVATE', 'GOVT']),
  payeeClassification: z.enum(['N/A', 'INDIVIDUAL', 'CORP']).optional(),
  supportingDocs: safeString(120).optional(),
  referenceNo: safeString(120).optional(),
  particular: safeString(300).optional(),
  accountTitle: safeString(150).optional(),
  withholdingAgent: z.enum(['YES', 'NO']).optional(),
  nonVatExempt: finiteAmountOrNull,
  grossOfVat: finiteAmountOrNull,
  netOfVat: finiteAmountOrNull,
  vat: finiteAmountOrNull,
  total: finiteAmountOrNull,
  wtGoods1: finiteAmountOrNull,
  wtServices2: finiteAmountOrNull,
  wtRental5: finiteAmountOrNull,
  wtVat5: finiteAmountOrNull,
  actual: finiteAmountOrNull,
  remarks: safeString(500),
  applyGovtVat5: z.boolean(),
  manualOverride: z.boolean(),
  createdAt: safeString(64),
  updatedAt: safeString(64),
});

export const tinRecordSchema = z.object({
  id: safeString(128),
  tin: safeString(32),
  digits: safeString(16),
  payor: safeString(250),
  branchTradeName: safeString(200),
  address: safeString(300),
  address2: safeString(300).optional(),
  defaultPrivateOrGovt: z.enum(['PRIVATE', 'GOVT']),
  defaultCategory: z.enum(['N/A', 'GOODS', 'SERVICES', 'RENTAL']),
  defaultTaxStatus: z.enum(['VATABLE', 'NON_VAT']),
  defaultPayeeClassification: z.enum(['N/A', 'INDIVIDUAL', 'CORP']).optional(),
  defaultAccountTitle: safeString(150).optional(),
  defaultWithholdingAgent: z.enum(['YES', 'NO']).optional(),
  createdAt: safeString(64),
  updatedAt: safeString(64),
});

export const clientWorkspaceBackupSchema = z.object({
  version: z.number().int().min(1).max(10),
  exportedAt: safeString(64),
  client: z.object({
    id: safeString(128),
    slug: safeString(128),
    name: safeString(200),
    tin: safeString(32).optional(),
    rdo: safeString(24).optional(),
    createdAt: safeString(64),
    updatedAt: safeString(64),
  }),
  salesRows: z.array(ledgerRowSchema).max(25000),
  purchasesRows: z.array(ledgerRowSchema).max(25000),
  tinDirectory: z.array(tinRecordSchema).max(10000).default([]),
  accountTitles: z.array(safeString(150)).max(500).default([]),
});

export const vaultMetadataInputSchema = z.object({
  clientDirectoryId: safeString(128).refine((s) => s.length >= 1),
  fileName: safeString(255).refine((s) => s.length >= 1 && !s.includes('..') && !/[\\/]/.test(s)),
  storagePath: safeString(512).refine(
    (s) => s.length >= 1 && !s.includes('..') && !s.startsWith('/'),
    'Invalid storage path.'
  ),
  bucketName: safeString(64).refine((s) => s === 'ledger-vault', 'Invalid storage bucket.'),
  sizeBytes: z.number().int().min(0).max(5 * 1024 * 1024 * 1024),
  taxYear: safeString(16),
  taxPeriod: safeString(64),
  entryScope: z.enum(['GENERAL', 'SALES', 'PURCHASES', 'EXPENSE', 'SLP']),
  sheetName: safeString(128).optional(),
  previewHeaders: z.array(safeString(200)).max(100),
  previewRows: z.array(z.array(safeString(500)).max(100)).max(25),
  uploadedBy: safeString(128),
  uploadedByEmail: safeString(160),
  notes: safeString(500).optional(),
});
