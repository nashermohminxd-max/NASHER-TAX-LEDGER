import { upgradePurchasesRows } from '@/data/seedData';
import { hashPassword, verifyPassword } from '@/lib/crypto';
import {
  AUTH_RATE_LIMIT,
  PASSWORD_CHANGE_RATE_LIMIT,
  assertWithinRateLimit,
  clearRateLimit,
  recordRateLimitFailure,
} from '@/lib/rateLimit';
import { createEphemeralSignUpClient, isSupabaseConfigured, supabase } from '@/lib/supabase';
import {
  assignCredentialsSchema,
  changePasswordSchema,
  clientDirectoryInputSchema,
  ledgerRowSchema,
  stripControlChars,
  vaultMetadataInputSchema,
} from '@/lib/validation';
import {
  VAULT_BUCKET,
  previewXlsxFirst20Rows,
  removeVaultStorageObject,
  sanitizeFilename,
  sanitizeSegment,
  uploadXlsxDirectToVault,
} from '@/lib/vaultService';
import type {
  ClientDirectory,
  TaxClassification,
  UserProfile,
  UserRole,
  VaultEntryScope,
  VaultXlsxFile,
} from '@/types/portal';
import type {
  AuditStatus,
  ClientProfile,
  LedgerEntryKind,
  LedgerRow,
  TinRecord,
} from '@/types/tax';
import {
  DEFAULT_ACCOUNT_TITLES,
  REGISTRY_KEYS,
  deleteClientWorkspaceStorage,
  getClientStorageKeys,
  initializeClientRegistry,
  loadClientWorkspace,
  safeLoadJson,
  safeSaveJson,
  seedEmptyClientWorkspace,
  slugifyClientName,
} from '@/utils/clientStorage';
import { extractYearFromDate, formatTin, normalizeTinDigits } from '@/utils/taxEngine';
import { buildFilingXlsxBlob } from '@/utils/xlsxExport';

const PORTAL_KEYS = {
  DIRECTORIES_META: 'nasher_portal_dir_meta_v1',
  USERS: 'nasher_portal_users_v1',
  VAULT_FILES: 'nasher_portal_vault_files_v1',
  EXPENSE_ROWS_PREFIX: 'nasher_portal_expenses_v1_',
} as const;

interface StoredPreviewUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  clientDirectoryId: string | null;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  updatedAt: string;
}

interface DirectoryMetaExtension {
  tradeName: string;
  taxClassification: TaxClassification;
  storageQuotaBytes: number;
}

const DEFAULT_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

function toUuidLikeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ----------------------------------------------------------------------------
// DB Row Mappers (Supabase <-> Frontend Types)
// ----------------------------------------------------------------------------

function mapDirectoryFromDb(row: Record<string, unknown>, assignedEmail?: string): ClientDirectory {
  return {
    id: String(row.id),
    slug: String(row.slug ?? ''),
    companyName: String(row.company_name ?? ''),
    tradeName: String(row.trade_name ?? ''),
    tin: String(row.tin ?? ''),
    rdoCode: String(row.rdo_code ?? ''),
    taxClassification: row.tax_classification === 'NON_VAT' ? 'NON_VAT' : 'VAT',
    storageQuotaBytes: Number(row.storage_quota_bytes ?? DEFAULT_QUOTA_BYTES),
    assignedEmail,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

function mapUserProfileFromDb(row: Record<string, unknown>): UserProfile {
  return {
    id: String(row.id),
    email: String(row.email ?? ''),
    fullName: String(row.full_name ?? ''),
    role: row.role === 'admin' ? 'admin' : 'client',
    clientDirectoryId: row.client_directory_id ? String(row.client_directory_id) : null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

function mapVaultFileFromDb(row: Record<string, unknown>): VaultXlsxFile {
  return {
    id: String(row.id),
    clientDirectoryId: String(row.client_directory_id),
    fileName: String(row.file_name ?? 'workbook.xlsx'),
    storagePath: String(row.storage_path ?? ''),
    bucketName: String(row.bucket_name ?? 'ledger-vault'),
    sizeBytes: Number(row.size_bytes ?? 0),
    taxYear: String(row.tax_year ?? '2026'),
    taxPeriod: String(row.tax_period ?? '2026-Q1'),
    entryScope: (row.entry_scope as VaultEntryScope) || 'GENERAL',
    sheetName: row.sheet_name ? String(row.sheet_name) : undefined,
    previewHeaders: Array.isArray(row.preview_headers)
      ? row.preview_headers.map((v) => String(v))
      : [],
    previewRows: Array.isArray(row.preview_rows)
      ? row.preview_rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c)) : []))
      : [],
    uploadedBy: String(row.uploaded_by ?? ''),
    uploadedByEmail: String(row.uploaded_by_email ?? ''),
    notes: String(row.notes ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

function mapLedgerRowFromDb(row: Record<string, unknown>): LedgerRow {
  const numOrNull = (val: unknown): number | null => {
    if (val === null || val === undefined || val === '') return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  };
  return {
    id: String(row.id),
    splitGroupId: row.split_group_id ? String(row.split_group_id) : undefined,
    entryKind: (row.entry_type as LedgerEntryKind) || 'SALES',
    auditStatus: (row.audit_status as AuditStatus) || 'PENDING',
    auditNote: row.audit_note ? String(row.audit_note) : '',
    date: String(row.tx_date ?? ''),
    month: String(row.filing_month ?? ''),
    branchTradeName: String(row.branch_trade_name ?? ''),
    payor: String(row.payor ?? ''),
    tin: String(row.tin ?? ''),
    address: String(row.address ?? ''),
    address2: String(row.address2 ?? ''),
    category: (row.category as LedgerRow['category']) || 'GOODS',
    privateOrGovt: row.private_or_govt === 'GOVT' ? 'GOVT' : 'PRIVATE',
    payeeClassification: (row.payee_classification as LedgerRow['payeeClassification']) || 'N/A',
    supportingDocs: String(row.supporting_docs ?? ''),
    referenceNo: String(row.reference_no ?? ''),
    particular: String(row.particular ?? ''),
    accountTitle: String(row.account_title ?? ''),
    withholdingAgent: row.withholding_agent === 'NO' ? 'NO' : 'YES',
    nonVatExempt: numOrNull(row.non_vat_exempt),
    grossOfVat: numOrNull(row.gross_of_vat),
    netOfVat: numOrNull(row.net_of_vat),
    vat: numOrNull(row.vat),
    total: numOrNull(row.total),
    wtGoods1: numOrNull(row.wt_goods_1),
    wtServices2: numOrNull(row.wt_services_2),
    wtRental5: numOrNull(row.wt_rental_5),
    wtVat5: numOrNull(row.wt_vat_5),
    actual: numOrNull(row.actual),
    remarks: String(row.remarks ?? ''),
    applyGovtVat5: Boolean(row.apply_govt_vat_5),
    manualOverride: Boolean(row.manual_override),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

function mapLedgerRowToDb(
  row: LedgerRow,
  clientDirectoryId: string,
  entryType: LedgerEntryKind,
  createdBy?: string
): Record<string, unknown> {
  return {
    id: row.id.startsWith('row-') ? toUuidLikeId() : row.id,
    client_directory_id: clientDirectoryId,
    entry_type: entryType,
    audit_status: row.auditStatus ?? 'PENDING',
    audit_note: row.auditNote ?? '',
    split_group_id: row.splitGroupId ?? null,
    tx_date: row.date ?? '',
    filing_month: row.month ?? '',
    filing_year: extractYearFromDate(row.date) || String(new Date().getFullYear()),
    branch_trade_name: row.branchTradeName ?? '',
    payor: row.payor ?? '',
    tin: row.tin ?? '',
    address: row.address ?? '',
    address2: row.address2 ?? '',
    category: row.category ?? 'GOODS',
    private_or_govt: row.privateOrGovt ?? 'PRIVATE',
    payee_classification: row.payeeClassification ?? 'N/A',
    supporting_docs: row.supportingDocs ?? '',
    reference_no: row.referenceNo ?? '',
    particular: row.particular ?? '',
    account_title: row.accountTitle ?? '',
    withholding_agent: row.withholdingAgent ?? 'YES',
    non_vat_exempt: row.nonVatExempt,
    gross_of_vat: row.grossOfVat,
    net_of_vat: row.netOfVat,
    vat: row.vat,
    total: row.total,
    wt_goods_1: row.wtGoods1,
    wt_services_2: row.wtServices2,
    wt_rental_5: row.wtRental5,
    wt_vat_5: row.wtVat5,
    actual: row.actual,
    remarks: row.remarks ?? '',
    apply_govt_vat_5: row.applyGovtVat5,
    manual_override: row.manualOverride,
    ...(createdBy ? { created_by: createdBy } : {}),
  };
}

function mapTinFromDb(row: Record<string, unknown>): TinRecord {
  return {
    id: String(row.id),
    tin: String(row.tin ?? ''),
    digits: String(row.digits ?? ''),
    payor: String(row.payor ?? ''),
    branchTradeName: String(row.branch_trade_name ?? ''),
    address: String(row.address ?? ''),
    address2: String(row.address2 ?? ''),
    defaultPrivateOrGovt: row.default_private_or_govt === 'GOVT' ? 'GOVT' : 'PRIVATE',
    defaultCategory: (row.default_category as TinRecord['defaultCategory']) || 'GOODS',
    defaultTaxStatus: row.default_tax_status === 'NON_VAT' ? 'NON_VAT' : 'VATABLE',
    defaultPayeeClassification:
      (row.default_payee_classification as TinRecord['defaultPayeeClassification']) || 'CORP',
    defaultAccountTitle: String(row.default_account_title ?? ''),
    defaultWithholdingAgent: row.default_withholding_agent === 'NO' ? 'NO' : 'YES',
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

// ----------------------------------------------------------------------------
// Preview Mode Seed & Helpers (Zero hardcoded credentials)
// ----------------------------------------------------------------------------

function ensurePreviewDirectoriesBootstrapped(): {
  clients: ClientProfile[];
  metaMap: Record<string, DirectoryMetaExtension>;
} {
  const registry = initializeClientRegistry();
  let clients = [...registry.clients];
  const metaMap = safeLoadJson<Record<string, DirectoryMetaExtension>>(
    PORTAL_KEYS.DIRECTORIES_META,
    {}
  );

  // Enrich default client with Philippine company metadata if empty
  const defaultClient = clients.find((c) => c.id === 'client-default');
  if (defaultClient && !defaultClient.tin) {
    defaultClient.name =
      defaultClient.name === 'MAIN CLIENT' ? 'NASHER TRADING CORPORATION' : defaultClient.name;
    defaultClient.tin = '008-412-650-000';
    defaultClient.rdo = '044';
    safeSaveJson(REGISTRY_KEYS.CLIENTS, clients);
  }

  if (defaultClient && !metaMap[defaultClient.id]) {
    metaMap[defaultClient.id] = {
      tradeName: 'NASHER TRADING MAIN BRANCH',
      taxClassification: 'VAT',
      storageQuotaBytes: DEFAULT_QUOTA_BYTES,
    };
  }

  // Seed a secondary client directory in preview mode if only 1 exists
  if (clients.length === 1 && !metaMap['client-northstar-opc']) {
    const now = new Date().toISOString();
    const second: ClientProfile = {
      id: 'client-northstar-opc',
      slug: 'northstar-logistics-opc',
      name: 'NORTHSTAR LOGISTICS OPC',
      tin: '009-781-334-000',
      rdo: '039',
      createdAt: now,
      updatedAt: now,
    };
    seedEmptyClientWorkspace(second.id, { includeSampleRows: false });
    clients = [...clients, second];
    safeSaveJson(REGISTRY_KEYS.CLIENTS, clients);
    metaMap[second.id] = {
      tradeName: 'NORTHSTAR FREIGHT & HAULING',
      taxClassification: 'NON_VAT',
      storageQuotaBytes: DEFAULT_QUOTA_BYTES,
    };
  }

  safeSaveJson(PORTAL_KEYS.DIRECTORIES_META, metaMap);

  // Seed sample vault workbook entry for immediate preview inspection if vault is empty
  const existingVault = safeLoadJson<VaultXlsxFile[] | null>(PORTAL_KEYS.VAULT_FILES, null);
  if (!existingVault) {
    const now = new Date().toISOString();
    const demoSample: VaultXlsxFile = {
      id: 'vault-demo-2026-q1',
      clientDirectoryId: defaultClient?.id ?? clients[0].id,
      fileName: 'SLP_SLSP_CONSOLIDATED_2026_Q1.xlsx',
      storagePath: `${defaultClient?.id ?? clients[0].id}/2026/2026-Q1/SLP_SLSP_CONSOLIDATED_2026_Q1.xlsx`,
      bucketName: 'ledger-vault',
      sizeBytes: 248_640,
      taxYear: '2026',
      taxPeriod: '2026-Q1',
      entryScope: 'SLP',
      sheetName: 'SALES_AND_PURCHASES',
      previewHeaders: [
        'DATE',
        'MONTH',
        'TAXPAYER / SUPPLIER',
        'TIN',
        'CATEGORY',
        'GROSS AMOUNT',
        'NET OF VAT',
        '12% VAT',
      ],
      previewRows: [
        ['1/15/2026', 'JANUARY', 'METRO MANILA HARDWARE CORP.', '000-412-890-000', 'GOODS', '56,000.00', '50,000.00', '6,000.00'],
        ['1/22/2026', 'JANUARY', 'MERALCO POWER UTILITIES', '000-101-528-000', 'SERVICES', '18,480.00', '16,500.00', '1,980.00'],
        ['2/04/2026', 'FEBRUARY', 'APEX PRIME PROPERTIES INC.', '004-889-210-000', 'RENTAL', '44,800.00', '40,000.00', '4,800.00'],
      ],
      uploadedBy: 'system',
      uploadedByEmail: 'system-seed',
      notes: 'Sample Q1 BIR Summary List of Sales & Purchases workbook',
      createdAt: now,
      updatedAt: now,
    };
    safeSaveJson(PORTAL_KEYS.VAULT_FILES, [demoSample]);
  }

  return { clients, metaMap };
}

const DEFAULT_PREVIEW_ADMIN_USERNAME = 'staff.npbservices';
const DEFAULT_PREVIEW_ADMIN_SALT = 'h2GHtYMLJSuMEWZqGdhdUw==';
const DEFAULT_PREVIEW_ADMIN_HASH = 'PJ99zkiGT4SNGM4EYX9JcqBTYccCkhv0oYyKZpEiW7w=';

function loadPreviewUsers(): StoredPreviewUser[] {
  const users = safeLoadJson<StoredPreviewUser[]>(PORTAL_KEYS.USERS, []);
  if (!users.some((u) => u.role === 'admin')) {
    const now = new Date().toISOString();
    const defaultAdmin: StoredPreviewUser = {
      id: 'admin-staff-npbservices',
      email: DEFAULT_PREVIEW_ADMIN_USERNAME,
      fullName: 'Noverben P. Bachiller, CPA',
      role: 'admin',
      clientDirectoryId: null,
      passwordHash: DEFAULT_PREVIEW_ADMIN_HASH,
      passwordSalt: DEFAULT_PREVIEW_ADMIN_SALT,
      createdAt: now,
      updatedAt: now,
    };
    const next = [defaultAdmin, ...users];
    safeSaveJson(PORTAL_KEYS.USERS, next);
    return next;
  }
  return users;
}

function savePreviewUsers(users: StoredPreviewUser[]): void {
  safeSaveJson(PORTAL_KEYS.USERS, users);
}

// ----------------------------------------------------------------------------
// Active Session & Authorization Context (RBAC + Tenant IDOR Guards)
// ----------------------------------------------------------------------------

let activeSessionUser: UserProfile | null = null;

export function setActiveSessionUser(user: UserProfile | null): void {
  activeSessionUser = user;
}

async function resolveCurrentSessionUser(): Promise<UserProfile | null> {
  if (isSupabaseConfigured && supabase) {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return null;
    if (activeSessionUser && activeSessionUser.id === data.user.id) {
      return activeSessionUser;
    }
    const { data: profileRow } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', data.user.id)
      .maybeSingle();
    if (!profileRow) return null;
    const mapped = mapUserProfileFromDb(profileRow as Record<string, unknown>);
    activeSessionUser = mapped;
    return mapped;
  }
  return activeSessionUser;
}

async function requireAuthenticatedUser(): Promise<UserProfile> {
  const user = await resolveCurrentSessionUser();
  if (!user) {
    throw new Error('Authentication required. Please sign in.');
  }
  return user;
}

async function requireAdminUser(): Promise<UserProfile> {
  const user = await requireAuthenticatedUser();
  if (user.role !== 'admin') {
    throw new Error('Administrator authorization required.');
  }
  return user;
}

async function requireDirectoryAccess(clientDirectoryId: string): Promise<UserProfile> {
  const user = await requireAuthenticatedUser();
  if (user.role === 'admin') return user;
  if (!user.clientDirectoryId || user.clientDirectoryId !== clientDirectoryId) {
    throw new Error('Unauthorized: access restricted to your assigned client directory.');
  }
  return user;
}

// ----------------------------------------------------------------------------
// Auth & User Profile Operations
// ----------------------------------------------------------------------------

export async function authenticatePreviewUser(
  identifier: string,
  password: string
): Promise<UserProfile> {
  const cleanId = stripControlChars(identifier).toLowerCase();
  const rateKey = `preview_login:${cleanId || 'anonymous'}`;
  assertWithinRateLimit(rateKey, AUTH_RATE_LIMIT);

  const users = loadPreviewUsers();
  const match = users.find(
    (u) =>
      u.email.toLowerCase() === cleanId ||
      u.email.toLowerCase().split('@')[0] === cleanId ||
      u.fullName.trim().toLowerCase() === cleanId
  );
  if (!match) {
    recordRateLimitFailure(rateKey, AUTH_RATE_LIMIT);
    throw new Error('Invalid username or password.');
  }
  const valid = await verifyPassword(password, match.passwordHash, match.passwordSalt);
  if (!valid) {
    recordRateLimitFailure(rateKey, AUTH_RATE_LIMIT);
    throw new Error('Invalid username or password.');
  }
  clearRateLimit(rateKey);
  const profile: UserProfile = {
    id: match.id,
    email: match.email,
    fullName: match.fullName,
    role: match.role,
    clientDirectoryId: match.clientDirectoryId,
    createdAt: match.createdAt,
    updatedAt: match.updatedAt,
  };
  activeSessionUser = profile;
  return profile;
}

export async function changeOwnPassword(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const parsed = changePasswordSchema.safeParse(params);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || 'Invalid password payload.');
  }
  const sessionUser = await requireAuthenticatedUser();
  if (sessionUser.id !== parsed.data.userId) {
    throw new Error('Unauthorized: you can only change your own password.');
  }
  const rateKey = `pw_change:${sessionUser.id}`;
  assertWithinRateLimit(rateKey, PASSWORD_CHANGE_RATE_LIMIT);

  if (!isSupabaseConfigured || !supabase) {
    const users = loadPreviewUsers();
    const idx = users.findIndex((u) => u.id === sessionUser.id);
    if (idx < 0) {
      throw new Error('User account not found.');
    }
    const valid = await verifyPassword(
      parsed.data.currentPassword,
      users[idx].passwordHash,
      users[idx].passwordSalt
    );
    if (!valid) {
      recordRateLimitFailure(rateKey, PASSWORD_CHANGE_RATE_LIMIT);
      throw new Error('Current password is incorrect.');
    }
    clearRateLimit(rateKey);
    const { hash, salt } = await hashPassword(parsed.data.newPassword);
    users[idx] = {
      ...users[idx],
      passwordHash: hash,
      passwordSalt: salt,
      updatedAt: new Date().toISOString(),
    };
    savePreviewUsers(users);
    return;
  }

  const { data: userData } = await supabase.auth.getUser();
  const authEmail = userData.user?.email;
  if (!authEmail || userData.user?.id !== sessionUser.id) {
    throw new Error('Unable to verify active session.');
  }
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email: authEmail,
    password: parsed.data.currentPassword,
  });
  if (verifyErr) {
    recordRateLimitFailure(rateKey, PASSWORD_CHANGE_RATE_LIMIT);
    throw new Error('Current password is incorrect.');
  }
  clearRateLimit(rateKey);
  const { error: updateErr } = await supabase.auth.updateUser({
    password: parsed.data.newPassword,
  });
  if (updateErr) {
    throw new Error(updateErr.message || 'Unable to update password.');
  }
}

export async function fetchUserProfileById(userId: string): Promise<UserProfile | null> {
  if (!isSupabaseConfigured || !supabase) {
    const users = loadPreviewUsers();
    const u = users.find((item) => item.id === userId);
    if (!u) return null;
    return {
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      clientDirectoryId: u.clientDirectoryId,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    };
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return mapUserProfileFromDb(data as Record<string, unknown>);
}

// ----------------------------------------------------------------------------
// Client Directories CRUD
// ----------------------------------------------------------------------------

export async function listClientDirectories(): Promise<ClientDirectory[]> {
  const sessionUser = await requireAuthenticatedUser();

  if (!isSupabaseConfigured || !supabase) {
    const { clients, metaMap } = ensurePreviewDirectoriesBootstrapped();
    const users = loadPreviewUsers();
    const visibleClients =
      sessionUser.role === 'admin'
        ? clients
        : clients.filter((c) => c.id === sessionUser.clientDirectoryId);
    return visibleClients.map((c) => {
      const meta = metaMap[c.id];
      const assigned = users.find((u) => u.clientDirectoryId === c.id && u.role === 'client');
      return {
        id: c.id,
        slug: c.slug,
        companyName: c.name,
        tradeName: meta?.tradeName ?? '',
        tin: c.tin ?? '',
        rdoCode: c.rdo ?? '',
        taxClassification: meta?.taxClassification ?? 'VAT',
        storageQuotaBytes: meta?.storageQuotaBytes ?? DEFAULT_QUOTA_BYTES,
        assignedEmail: assigned?.email,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      };
    });
  }

  const [{ data: dirs, error }, { data: profiles }] = await Promise.all([
    supabase.from('client_directories').select('*').order('created_at', { ascending: false }),
    sessionUser.role === 'admin'
      ? supabase.from('user_profiles').select('email, client_directory_id, role').eq('role', 'client')
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  if (error) {
    throw new Error(error.message);
  }

  const emailByDir = new Map<string, string>();
  (profiles ?? []).forEach((p) => {
    const rec = p as Record<string, unknown>;
    if (rec.client_directory_id && rec.email) {
      emailByDir.set(String(rec.client_directory_id), String(rec.email));
    }
  });

  return (dirs ?? []).map((d) => {
    const rec = d as Record<string, unknown>;
    return mapDirectoryFromDb(rec, emailByDir.get(String(rec.id)));
  });
}

export async function getClientDirectoryById(clientId: string): Promise<ClientDirectory | null> {
  await requireDirectoryAccess(clientId);
  if (!isSupabaseConfigured || !supabase) {
    const all = await listClientDirectories();
    return all.find((c) => c.id === clientId) ?? null;
  }

  const { data, error } = await supabase
    .from('client_directories')
    .select('*')
    .eq('id', clientId)
    .maybeSingle();

  if (error || !data) return null;
  return mapDirectoryFromDb(data as Record<string, unknown>);
}

export async function createClientDirectoryWithCredentials(params: {
  companyName: string;
  tradeName: string;
  tin: string;
  rdoCode: string;
  taxClassification: TaxClassification;
  assignLogin: boolean;
  email?: string;
  password?: string;
  includeSampleRows?: boolean;
}): Promise<{ directory: ClientDirectory; credentialNotice?: string }> {
  await requireAdminUser();
  const parsed = clientDirectoryInputSchema.safeParse(params);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || 'Invalid client directory data.');
  }

  const cleanCompany = parsed.data.companyName.toUpperCase();
  const cleanTrade = parsed.data.tradeName.toUpperCase();
  const formattedTin = formatTin(normalizeTinDigits(parsed.data.tin)) || parsed.data.tin;
  const cleanRdo = parsed.data.rdoCode.toUpperCase();
  const baseSlug = slugifyClientName(cleanCompany);

  if (parsed.data.assignLogin) {
    const username = (parsed.data.email ?? '').trim().toLowerCase();
    const pw = parsed.data.password ?? '';
    if (!username) {
      throw new Error('Provide a valid username for the client account.');
    }
    if (pw.length < 8) {
      throw new Error('Client login password must be at least 8 characters.');
    }
  }

  if (!isSupabaseConfigured || !supabase) {
    const { clients, metaMap } = ensurePreviewDirectoriesBootstrapped();
    const existingSlugs = new Set(clients.map((c) => c.slug));
    let uniqueSlug = baseSlug;
    let i = 2;
    while (existingSlugs.has(uniqueSlug)) {
      uniqueSlug = `${baseSlug}-${i++}`;
    }

    const now = new Date().toISOString();
    const newId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const profile: ClientProfile = {
      id: newId,
      slug: uniqueSlug,
      name: cleanCompany,
      tin: formattedTin,
      rdo: cleanRdo,
      createdAt: now,
      updatedAt: now,
    };

    seedEmptyClientWorkspace(newId, { includeSampleRows: Boolean(params.includeSampleRows) });
    safeSaveJson(REGISTRY_KEYS.CLIENTS, [profile, ...clients]);
    metaMap[newId] = {
      tradeName: cleanTrade,
      taxClassification: params.taxClassification,
      storageQuotaBytes: DEFAULT_QUOTA_BYTES,
    };
    safeSaveJson(PORTAL_KEYS.DIRECTORIES_META, metaMap);

    let assignedEmail: string | undefined;
    if (params.assignLogin && params.email && params.password) {
      const cleanEmail = params.email.trim().toLowerCase();
      const users = loadPreviewUsers();
      if (users.some((u) => u.email.toLowerCase() === cleanEmail)) {
        throw new Error(`A user with email ${cleanEmail} already exists.`);
      }
      const { hash, salt } = await hashPassword(params.password);
      users.unshift({
        id: toUuidLikeId(),
        email: cleanEmail,
        fullName: cleanCompany,
        role: 'client',
        clientDirectoryId: newId,
        passwordHash: hash,
        passwordSalt: salt,
        createdAt: now,
        updatedAt: now,
      });
      savePreviewUsers(users);
      assignedEmail = cleanEmail;
    }

    return {
      directory: {
        id: newId,
        slug: uniqueSlug,
        companyName: cleanCompany,
        tradeName: cleanTrade,
        tin: formattedTin,
        rdoCode: cleanRdo,
        taxClassification: params.taxClassification,
        storageQuotaBytes: DEFAULT_QUOTA_BYTES,
        assignedEmail,
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  // Supabase mode
  const uniqueSlug = `${baseSlug}-${Date.now().toString(36).slice(-4)}`;
  const { data: createdDir, error: dirError } = await supabase
    .from('client_directories')
    .insert({
      slug: uniqueSlug,
      company_name: cleanCompany,
      trade_name: cleanTrade,
      tin: formattedTin,
      rdo_code: cleanRdo,
      tax_classification: params.taxClassification,
    })
    .select('*')
    .single();

  if (dirError || !createdDir) {
    throw new Error(dirError?.message || 'Failed to create client directory in Supabase.');
  }

  const directory = mapDirectoryFromDb(createdDir as Record<string, unknown>);
  let credentialNotice: string | undefined;

  if (params.assignLogin && params.email && params.password) {
    const ephemeral = createEphemeralSignUpClient();
    if (!ephemeral) {
      throw new Error('Supabase client unavailable for user provisioning.');
    }
    const cleanInput = params.email.trim().toLowerCase();
    const authEmail = cleanInput.includes('@')
      ? cleanInput
      : `${cleanInput.replace(/[^a-z0-9._-]/g, '')}@npb-portal.local`;
    const { data: signUpData, error: signUpError } = await ephemeral.auth.signUp({
      email: authEmail,
      password: params.password,
      options: {
        data: {
          role: 'client',
          client_directory_id: directory.id,
          full_name: cleanCompany,
        },
      },
    });

    if (signUpError) {
      throw new Error(`Directory created, but client login setup failed: ${signUpError.message}`);
    }

    if (signUpData.user?.id) {
      const { error: upsertErr } = await supabase.from('user_profiles').upsert({
        id: signUpData.user.id,
        email: cleanInput,
        full_name: cleanCompany,
        role: 'client',
        client_directory_id: directory.id,
      });
      if (upsertErr) {
        throw new Error(`Directory created, but profile link failed: ${upsertErr.message}`);
      }
      directory.assignedEmail = cleanInput;
      if (!signUpData.session) {
        credentialNotice =
          'Client login created. If Supabase email confirmation is enabled, verify the email before first client login.';
      }
    }
  }

  return { directory, credentialNotice };
}

export async function assignClientLoginCredentials(params: {
  clientDirectoryId: string;
  companyName: string;
  email: string;
  password?: string;
}): Promise<string | undefined> {
  await requireAdminUser();
  const parsed = assignCredentialsSchema.safeParse(params);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || 'Enter a valid client username.');
  }
  const cleanUsername = parsed.data.email.toLowerCase();
  const nextPassword = parsed.data.password ?? '';

  if (!isSupabaseConfigured || !supabase) {
    const users = loadPreviewUsers();
    const now = new Date().toISOString();
    const existingIdx = users.findIndex(
      (u) => u.role === 'client' && u.clientDirectoryId === params.clientDirectoryId
    );
    const conflict = users.find(
      (u, idx) => idx !== existingIdx && u.email.toLowerCase() === cleanUsername
    );
    if (conflict) {
      throw new Error(`Username "${cleanUsername}" is already assigned to another account.`);
    }

    if (existingIdx >= 0) {
      if (nextPassword && nextPassword.length < 8) {
        throw new Error('Password must be at least 8 characters.');
      }
      let passwordHash = users[existingIdx].passwordHash;
      let passwordSalt = users[existingIdx].passwordSalt;
      if (nextPassword) {
        const hashed = await hashPassword(nextPassword);
        passwordHash = hashed.hash;
        passwordSalt = hashed.salt;
      }
      users[existingIdx] = {
        ...users[existingIdx],
        email: cleanUsername,
        role: 'client',
        clientDirectoryId: params.clientDirectoryId,
        fullName: params.companyName,
        passwordHash,
        passwordSalt,
        updatedAt: now,
      };
    } else {
      if (nextPassword.length < 8) {
        throw new Error('Password must be at least 8 characters.');
      }
      const { hash, salt } = await hashPassword(nextPassword);
      users.unshift({
        id: toUuidLikeId(),
        email: cleanUsername,
        fullName: params.companyName,
        role: 'client',
        clientDirectoryId: params.clientDirectoryId,
        passwordHash: hash,
        passwordSalt: salt,
        createdAt: now,
        updatedAt: now,
      });
    }
    savePreviewUsers(users);
    return undefined;
  }

  if (nextPassword.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  const ephemeral = createEphemeralSignUpClient();
  if (!ephemeral) throw new Error('Supabase client unavailable.');
  const authEmail = cleanUsername.includes('@')
    ? cleanUsername
    : `${cleanUsername.replace(/[^a-z0-9._-]/g, '')}@npb-portal.local`;
  const { data: signUpData, error: signUpError } = await ephemeral.auth.signUp({
    email: authEmail,
    password: nextPassword,
    options: {
      data: {
        role: 'client',
        client_directory_id: params.clientDirectoryId,
        full_name: params.companyName,
      },
    },
  });
  if (signUpError) throw new Error(signUpError.message);

  if (signUpData.user?.id) {
    const { error: upsertErr } = await supabase.from('user_profiles').upsert({
      id: signUpData.user.id,
      email: cleanUsername,
      full_name: params.companyName,
      role: 'client',
      client_directory_id: params.clientDirectoryId,
    });
    if (upsertErr) {
      throw new Error(`User created, but profile assignment failed: ${upsertErr.message}`);
    }
    if (!signUpData.session) {
      return 'Client user provisioned. Confirm email in Supabase if email verification is active.';
    }
  }
  return undefined;
}

export async function deleteClientDirectory(clientId: string): Promise<void> {
  await requireAdminUser();
  if (!isSupabaseConfigured || !supabase) {
    const { clients, metaMap } = ensurePreviewDirectoriesBootstrapped();
    const remaining = clients.filter((c) => c.id !== clientId);
    safeSaveJson(REGISTRY_KEYS.CLIENTS, remaining);
    delete metaMap[clientId];
    safeSaveJson(PORTAL_KEYS.DIRECTORIES_META, metaMap);
    deleteClientWorkspaceStorage(clientId);
    try {
      localStorage.removeItem(`${PORTAL_KEYS.EXPENSE_ROWS_PREFIX}${clientId}`);
    } catch {
      // ignore
    }
    const vaultFiles = safeLoadJson<VaultXlsxFile[]>(PORTAL_KEYS.VAULT_FILES, []);
    const toRemove = vaultFiles.filter((f) => f.clientDirectoryId === clientId);
    for (const f of toRemove) {
      await removeVaultStorageObject(f.storagePath);
    }
    safeSaveJson(
      PORTAL_KEYS.VAULT_FILES,
      vaultFiles.filter((f) => f.clientDirectoryId !== clientId)
    );
    return;
  }

  const { error } = await supabase.from('client_directories').delete().eq('id', clientId);
  if (error) throw new Error(error.message);
}

// ----------------------------------------------------------------------------
// Client Ledger, TIN Directory & Expenses Workspace Load / Save
// ----------------------------------------------------------------------------

export interface ClientLedgerBundle {
  salesRows: LedgerRow[];
  purchasesRows: LedgerRow[];
  expenseRows: LedgerRow[];
  tinDirectory: TinRecord[];
  accountTitles: string[];
  monthCover: string;
  yearCover: string;
}

export async function loadClientLedgerBundle(clientId: string): Promise<ClientLedgerBundle> {
  await requireDirectoryAccess(clientId);
  if (!isSupabaseConfigured || !supabase) {
    const ws = loadClientWorkspace(clientId);
    const expenseRows = upgradePurchasesRows(
      safeLoadJson<LedgerRow[]>(`${PORTAL_KEYS.EXPENSE_ROWS_PREFIX}${clientId}`, [])
    ).map((r) => ({ ...r, entryKind: 'EXPENSE' as const }));

    return {
      salesRows: ws.salesRows.map((r) => ({ ...r, entryKind: 'SALES' as const })),
      purchasesRows: ws.purchasesRows.map((r) => ({ ...r, entryKind: 'PURCHASES' as const })),
      expenseRows,
      tinDirectory: ws.tinDirectory,
      accountTitles: ws.accountTitles,
      monthCover: ws.monthCover,
      yearCover: ws.yearCover,
    };
  }

  const [{ data: entryData, error: entryError }, { data: tinData, error: tinError }] =
    await Promise.all([
      supabase
        .from('ledger_entries')
        .select('*')
        .eq('client_directory_id', clientId)
        .order('created_at', { ascending: false }),
      supabase
        .from('tin_directory')
        .select('*')
        .eq('client_directory_id', clientId)
        .order('updated_at', { ascending: false }),
    ]);

  if (entryError) throw new Error(entryError.message);
  if (tinError) throw new Error(tinError.message);

  const allEntries = (entryData ?? []).map((r) =>
    mapLedgerRowFromDb(r as Record<string, unknown>)
  );

  const keys = getClientStorageKeys(clientId);
  const savedMonth = safeLoadJson<string>(keys.MONTH_COVER, '');
  const savedYear = safeLoadJson<string>(keys.YEAR_COVER, '');
  const accountTitles = safeLoadJson<string[]>(keys.ACCOUNT_TITLES, DEFAULT_ACCOUNT_TITLES);
  const now = new Date();
  const monthNames = [
    'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
  ];

  return {
    salesRows: allEntries.filter((r) => r.entryKind === 'SALES'),
    purchasesRows: allEntries.filter((r) => r.entryKind === 'PURCHASES'),
    expenseRows: allEntries.filter((r) => r.entryKind === 'EXPENSE'),
    tinDirectory: (tinData ?? []).map((t) => mapTinFromDb(t as Record<string, unknown>)),
    accountTitles,
    monthCover: savedMonth || monthNames[now.getMonth()],
    yearCover: savedYear || String(now.getFullYear()),
  };
}

export async function saveClientLedgerRows(params: {
  clientId: string;
  entryKind: LedgerEntryKind;
  rows: LedgerRow[];
  userId?: string;
}): Promise<LedgerRow[]> {
  const { clientId, entryKind, rows, userId } = params;
  const sessionUser = await requireDirectoryAccess(clientId);
  const validated = rows.map((r) => {
    const res = ledgerRowSchema.safeParse(r);
    if (!res.success) {
      throw new Error(res.error.issues[0]?.message || 'Invalid ledger row data.');
    }
    return {
      ...res.data,
      entryKind,
      auditStatus:
        sessionUser.role === 'admin'
          ? (res.data.auditStatus ?? 'PENDING')
          : res.data.auditStatus === 'APPROVED'
          ? 'PENDING'
          : (res.data.auditStatus ?? 'PENDING'),
    } as LedgerRow;
  });

  if (!isSupabaseConfigured || !supabase) {
    const keys = getClientStorageKeys(clientId);
    if (entryKind === 'SALES') safeSaveJson(keys.SALES, validated);
    else if (entryKind === 'PURCHASES') safeSaveJson(keys.PURCHASES, validated);
    else safeSaveJson(`${PORTAL_KEYS.EXPENSE_ROWS_PREFIX}${clientId}`, validated);
    return validated;
  }

  // Upsert rows for this entryKind and client directory
  if (validated.length > 0) {
    const payload = validated.map((r) => mapLedgerRowToDb(r, clientId, entryKind, userId ?? sessionUser.id));
    const { error } = await supabase.from('ledger_entries').upsert(payload, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }
  return validated;
}

export async function upsertSingleLedgerRows(params: {
  clientId: string;
  entryKind: LedgerEntryKind;
  rows: LedgerRow[];
  userId?: string;
}): Promise<LedgerRow[]> {
  const sessionUser = await requireDirectoryAccess(params.clientId);
  const withIds = params.rows.map((r) => {
    const res = ledgerRowSchema.safeParse(r);
    if (!res.success) {
      throw new Error(res.error.issues[0]?.message || 'Invalid ledger entry.');
    }
    return {
      ...res.data,
      id: res.data.id.startsWith('row-') ? toUuidLikeId() : res.data.id,
      entryKind: params.entryKind,
      auditStatus:
        sessionUser.role === 'admin'
          ? (res.data.auditStatus ?? 'PENDING')
          : res.data.auditStatus === 'APPROVED'
          ? 'PENDING'
          : (res.data.auditStatus ?? 'PENDING'),
    } as LedgerRow;
  });

  if (!isSupabaseConfigured || !supabase) {
    return withIds;
  }

  const payload = withIds.map((r) =>
    mapLedgerRowToDb(r, params.clientId, params.entryKind, params.userId ?? sessionUser.id)
  );
  const { data, error } = await supabase
    .from('ledger_entries')
    .upsert(payload, { onConflict: 'id' })
    .select('*');

  if (error) throw new Error(error.message);
  return (data ?? []).map((d) => mapLedgerRowFromDb(d as Record<string, unknown>));
}

export async function deleteLedgerRowRemote(rowId: string): Promise<void> {
  const sessionUser = await requireAuthenticatedUser();
  if (!isSupabaseConfigured || !supabase) return;
  let query = supabase.from('ledger_entries').delete().eq('id', rowId);
  if (sessionUser.role !== 'admin') {
    if (!sessionUser.clientDirectoryId) {
      throw new Error('Unauthorized: no client directory assigned.');
    }
    query = query.eq('client_directory_id', sessionUser.clientDirectoryId);
  }
  const { error } = await query;
  if (error) throw new Error(error.message);
}

export async function clearLedgerRowsPeriodRemote(
  clientId: string,
  entryKind: LedgerEntryKind,
  idsToDelete: string[]
): Promise<void> {
  await requireDirectoryAccess(clientId);
  if (!isSupabaseConfigured || !supabase || idsToDelete.length === 0) return;
  const { error } = await supabase
    .from('ledger_entries')
    .delete()
    .eq('client_directory_id', clientId)
    .eq('entry_type', entryKind)
    .in('id', idsToDelete);
  if (error) throw new Error(error.message);
}

export async function updateLedgerAuditStatus(
  rowId: string,
  auditStatus: AuditStatus,
  auditNote = ''
): Promise<void> {
  await requireAdminUser();
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase
    .from('ledger_entries')
    .update({ audit_status: auditStatus, audit_note: stripControlChars(auditNote).slice(0, 500) })
    .eq('id', rowId);
  if (error) throw new Error(error.message);
}

// ----------------------------------------------------------------------------
// Large .XLSX Storage Vault Metadata Operations
// ----------------------------------------------------------------------------

export async function listVaultFiles(clientDirectoryId?: string): Promise<VaultXlsxFile[]> {
  const sessionUser = await requireAuthenticatedUser();
  const scopedClientId =
    sessionUser.role === 'admin' ? clientDirectoryId : sessionUser.clientDirectoryId ?? '__none__';

  if (clientDirectoryId && sessionUser.role !== 'admin' && clientDirectoryId !== sessionUser.clientDirectoryId) {
    throw new Error('Unauthorized: cannot list vault files for another client directory.');
  }

  if (!isSupabaseConfigured || !supabase) {
    ensurePreviewDirectoriesBootstrapped();
    const all = safeLoadJson<VaultXlsxFile[]>(PORTAL_KEYS.VAULT_FILES, []);
    return scopedClientId
      ? all.filter((f) => f.clientDirectoryId === scopedClientId)
      : all;
  }

  let query = supabase
    .from('xlsx_files')
    .select('*')
    .order('created_at', { ascending: false });

  if (scopedClientId) {
    query = query.eq('client_directory_id', scopedClientId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapVaultFileFromDb(row as Record<string, unknown>));
}

async function createVaultFileMetadata(
  input: Omit<VaultXlsxFile, 'id' | 'createdAt' | 'updatedAt'>
): Promise<VaultXlsxFile> {
  await requireDirectoryAccess(input.clientDirectoryId);
  const parsed = vaultMetadataInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || 'Invalid vault file metadata.');
  }
  const clean = parsed.data;
  if (!clean.storagePath.startsWith(`${sanitizeSegment(clean.clientDirectoryId, 'unassigned')}/`)) {
    throw new Error('Storage path does not match target client directory.');
  }

  const now = new Date().toISOString();
  if (!isSupabaseConfigured || !supabase) {
    const all = safeLoadJson<VaultXlsxFile[]>(PORTAL_KEYS.VAULT_FILES, []);
    const created: VaultXlsxFile = {
      ...clean,
      id: toUuidLikeId(),
      createdAt: now,
      updatedAt: now,
    };
    safeSaveJson(PORTAL_KEYS.VAULT_FILES, [created, ...all]);
    return created;
  }

  const { data, error } = await supabase
    .from('xlsx_files')
    .insert({
      client_directory_id: clean.clientDirectoryId,
      file_name: clean.fileName,
      storage_path: clean.storagePath,
      bucket_name: clean.bucketName,
      size_bytes: clean.sizeBytes,
      tax_year: clean.taxYear,
      tax_period: clean.taxPeriod,
      entry_scope: clean.entryScope,
      sheet_name: clean.sheetName ?? '',
      preview_headers: clean.previewHeaders,
      preview_rows: clean.previewRows,
      uploaded_by: clean.uploadedBy || null,
      uploaded_by_email: clean.uploadedByEmail,
      notes: clean.notes ?? '',
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to record .xlsx file metadata.');
  }

  return mapVaultFileFromDb(data as Record<string, unknown>);
}

async function deleteVaultFileRecord(file: VaultXlsxFile): Promise<void> {
  const sessionUser = await requireDirectoryAccess(file.clientDirectoryId);
  const isAutoManaged = file.storagePath.includes('/auto_');
  if (sessionUser.role !== 'admin' && !isAutoManaged) {
    throw new Error('Only administrators may permanently delete archived vault workbooks.');
  }
  await removeVaultStorageObject(file.storagePath, file.bucketName);

  if (!isSupabaseConfigured || !supabase) {
    const all = safeLoadJson<VaultXlsxFile[]>(PORTAL_KEYS.VAULT_FILES, []);
    safeSaveJson(
      PORTAL_KEYS.VAULT_FILES,
      all.filter((f) => f.id !== file.id)
    );
    return;
  }

  const { error } = await supabase.from('xlsx_files').delete().eq('id', file.id);
  if (error) throw new Error(error.message);
}

/**
 * Automatically generates and upserts (or removes if empty) a client's period
 * Sales or Expenses .xlsx workbook into Admin Storage (`ledger-vault` + `xlsx_files`).
 */
export async function syncLedgerPeriodToAdminVault(params: {
  client: ClientDirectory;
  entryKind: LedgerEntryKind;
  month: string;
  year: string;
  rowsForPeriod: LedgerRow[];
  userId?: string;
  userEmail?: string;
}): Promise<VaultXlsxFile | null> {
  const { client, entryKind, month, year, rowsForPeriod, userId, userEmail } = params;
  const kindLabel = entryKind === 'SALES' ? 'SALES' : 'EXPENSES';
  const entryScope: VaultEntryScope = entryKind === 'SALES' ? 'SALES' : 'EXPENSE';
  const fallbackYear = String(new Date().getFullYear());
  const cleanYear = sanitizeSegment((year || '').trim() || fallbackYear, fallbackYear);
  const cleanMonth = (month || 'GENERAL').trim().toUpperCase() || 'GENERAL';
  const taxPeriod = cleanMonth !== 'GENERAL' ? `${cleanMonth}-${cleanYear}` : cleanYear;
  const fileName = sanitizeFilename(`${client.slug}_${kindLabel}_${cleanMonth}_${cleanYear}.xlsx`);
  const storagePath = `${sanitizeSegment(client.id, 'unassigned')}/${cleanYear}/${sanitizeSegment(
    taxPeriod,
    'GENERAL'
  )}/auto_${fileName}`;

  let existing: VaultXlsxFile | undefined;
  if (!isSupabaseConfigured || !supabase) {
    ensurePreviewDirectoriesBootstrapped();
    const all = safeLoadJson<VaultXlsxFile[]>(PORTAL_KEYS.VAULT_FILES, []);
    existing = all.find(
      (f) => f.clientDirectoryId === client.id && f.storagePath === storagePath
    );
  } else {
    const { data: existingRow } = await supabase
      .from('xlsx_files')
      .select('*')
      .eq('client_directory_id', client.id)
      .eq('storage_path', storagePath)
      .maybeSingle();
    if (existingRow) {
      existing = mapVaultFileFromDb(existingRow as Record<string, unknown>);
    }
  }

  if (rowsForPeriod.length === 0) {
    if (!existing) return null;
    try {
      await deleteVaultFileRecord(existing);
      return null;
    } catch {
      // Client roles in Supabase RLS may not have DELETE permission on xlsx_files/storage;
      // fall through and overwrite the workbook with 0 data rows so Admin Storage stays accurate.
    }
  }

  const exportMode = entryKind === 'SALES' ? 'SALES' : 'PURCHASES';
  const blob = buildFilingXlsxBlob(exportMode, rowsForPeriod);
  const file = new File([blob], fileName, {
    type:
      blob.type ||
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const preview = await previewXlsxFirst20Rows(file);

  await uploadXlsxDirectToVault({
    file,
    storagePath,
    onProgress: () => {},
  });

  const notes = `Auto-saved ${kindLabel.toLowerCase()} (${rowsForPeriod.length} row${
    rowsForPeriod.length === 1 ? '' : 's'
  })`;

  if (existing) {
    const now = new Date().toISOString();
    if (!isSupabaseConfigured || !supabase) {
      const all = safeLoadJson<VaultXlsxFile[]>(PORTAL_KEYS.VAULT_FILES, []);
      const updated: VaultXlsxFile = {
        ...existing,
        fileName,
        sizeBytes: file.size,
        taxYear: cleanYear,
        taxPeriod,
        entryScope,
        sheetName: preview.sheetName,
        previewHeaders: preview.headers,
        previewRows: preview.rows.slice(0, 20),
        uploadedBy: userId ?? existing.uploadedBy,
        uploadedByEmail: userEmail ?? existing.uploadedByEmail,
        notes,
        updatedAt: now,
      };
      safeSaveJson(
        PORTAL_KEYS.VAULT_FILES,
        all.map((f) => (f.id === existing.id ? updated : f))
      );
      return updated;
    }

    const { data, error } = await supabase
      .from('xlsx_files')
      .update({
        file_name: fileName,
        size_bytes: file.size,
        tax_year: cleanYear,
        tax_period: taxPeriod,
        entry_scope: entryScope,
        sheet_name: preview.sheetName ?? '',
        preview_headers: preview.headers,
        preview_rows: preview.rows.slice(0, 20),
        uploaded_by: userId || null,
        uploaded_by_email: userEmail ?? '',
        notes,
      })
      .eq('id', existing.id)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Failed to update auto-saved .xlsx metadata.');
    }
    return mapVaultFileFromDb(data as Record<string, unknown>);
  }

  return createVaultFileMetadata({
    clientDirectoryId: client.id,
    fileName,
    storagePath,
    bucketName: VAULT_BUCKET,
    sizeBytes: file.size,
    taxYear: cleanYear,
    taxPeriod,
    entryScope,
    sheetName: preview.sheetName,
    previewHeaders: preview.headers,
    previewRows: preview.rows.slice(0, 20),
    uploadedBy: userId ?? '',
    uploadedByEmail: userEmail ?? '',
    notes,
  });
}
