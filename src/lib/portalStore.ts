import {
  SEED_PURCHASES_ROWS,
  SEED_SALES_ROWS,
  SEED_TIN_DIRECTORY,
  upgradePurchasesRows,
  upgradeSalesRows,
  upgradeTinRecords,
} from '@/data/seedData';
import { hashPassword, verifyPassword } from '@/lib/crypto';
import { createEphemeralSignUpClient, isSupabaseConfigured, supabase } from '@/lib/supabase';
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

function loadPreviewUsers(): StoredPreviewUser[] {
  return safeLoadJson<StoredPreviewUser[]>(PORTAL_KEYS.USERS, []);
}

function savePreviewUsers(users: StoredPreviewUser[]): void {
  safeSaveJson(PORTAL_KEYS.USERS, users);
}

// ----------------------------------------------------------------------------
// Auth & User Profile Operations
// ----------------------------------------------------------------------------

export async function hasAnyAdminAccount(): Promise<boolean> {
  if (isSupabaseConfigured && supabase) {
    return true; // Supabase project admins sign in directly
  }
  const users = loadPreviewUsers();
  return users.some((u) => u.role === 'admin');
}

export async function registerFirstPreviewAdmin(params: {
  email: string;
  password: string;
  fullName: string;
}): Promise<UserProfile> {
  if (isSupabaseConfigured) {
    throw new Error('First-run local setup is disabled when connected to Supabase.');
  }
  const users = loadPreviewUsers();
  if (users.some((u) => u.role === 'admin')) {
    throw new Error('An administrator account already exists. Please sign in.');
  }
  const cleanEmail = params.email.trim().toLowerCase();
  if (!cleanEmail || !params.password || params.password.length < 8) {
    throw new Error('Enter a valid email and a password of at least 8 characters.');
  }
  const { hash, salt } = await hashPassword(params.password);
  const now = new Date().toISOString();
  const created: StoredPreviewUser = {
    id: toUuidLikeId(),
    email: cleanEmail,
    fullName: params.fullName.trim() || 'Lead Tax Administrator',
    role: 'admin',
    clientDirectoryId: null,
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: now,
    updatedAt: now,
  };
  savePreviewUsers([created, ...users]);
  return {
    id: created.id,
    email: created.email,
    fullName: created.fullName,
    role: created.role,
    clientDirectoryId: created.clientDirectoryId,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

export async function authenticatePreviewUser(
  email: string,
  password: string
): Promise<UserProfile> {
  const cleanEmail = email.trim().toLowerCase();
  const users = loadPreviewUsers();
  const match = users.find((u) => u.email.toLowerCase() === cleanEmail);
  if (!match) {
    throw new Error('Invalid email or password.');
  }
  const valid = await verifyPassword(password, match.passwordHash, match.passwordSalt);
  if (!valid) {
    throw new Error('Invalid email or password.');
  }
  return {
    id: match.id,
    email: match.email,
    fullName: match.fullName,
    role: match.role,
    clientDirectoryId: match.clientDirectoryId,
    createdAt: match.createdAt,
    updatedAt: match.updatedAt,
  };
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

export async function listClientUsers(): Promise<UserProfile[]> {
  if (!isSupabaseConfigured || !supabase) {
    return loadPreviewUsers().map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      clientDirectoryId: u.clientDirectoryId,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapUserProfileFromDb);
}

// ----------------------------------------------------------------------------
// Client Directories CRUD
// ----------------------------------------------------------------------------

export async function listClientDirectories(): Promise<ClientDirectory[]> {
  if (!isSupabaseConfigured || !supabase) {
    const { clients, metaMap } = ensurePreviewDirectoriesBootstrapped();
    const users = loadPreviewUsers();
    return clients.map((c) => {
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
    supabase.from('user_profiles').select('email, client_directory_id, role').eq('role', 'client'),
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
  const cleanCompany = params.companyName.trim().toUpperCase();
  const cleanTrade = params.tradeName.trim().toUpperCase();
  const formattedTin = formatTin(normalizeTinDigits(params.tin)) || params.tin.trim();
  const cleanRdo = params.rdoCode.trim().toUpperCase();
  const baseSlug = slugifyClientName(cleanCompany);

  if (params.assignLogin) {
    const email = (params.email ?? '').trim().toLowerCase();
    const pw = params.password ?? '';
    if (!email || !email.includes('@')) {
      throw new Error('Provide a valid login email for the client account.');
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
    const cleanEmail = params.email.trim().toLowerCase();
    const { data: signUpData, error: signUpError } = await ephemeral.auth.signUp({
      email: cleanEmail,
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
      await supabase.from('user_profiles').upsert({
        id: signUpData.user.id,
        email: cleanEmail,
        full_name: cleanCompany,
        role: 'client',
        client_directory_id: directory.id,
      });
      directory.assignedEmail = cleanEmail;
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
  password: string;
}): Promise<string | undefined> {
  const cleanEmail = params.email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Enter a valid client email address.');
  }
  if (params.password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }

  if (!isSupabaseConfigured || !supabase) {
    const users = loadPreviewUsers();
    const now = new Date().toISOString();
    const { hash, salt } = await hashPassword(params.password);
    const existingIdx = users.findIndex((u) => u.email.toLowerCase() === cleanEmail);
    if (existingIdx >= 0) {
      users[existingIdx] = {
        ...users[existingIdx],
        role: 'client',
        clientDirectoryId: params.clientDirectoryId,
        fullName: params.companyName,
        passwordHash: hash,
        passwordSalt: salt,
        updatedAt: now,
      };
    } else {
      users.unshift({
        id: toUuidLikeId(),
        email: cleanEmail,
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

  const ephemeral = createEphemeralSignUpClient();
  if (!ephemeral) throw new Error('Supabase client unavailable.');
  const { data: signUpData, error: signUpError } = await ephemeral.auth.signUp({
    email: cleanEmail,
    password: params.password,
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
    await supabase.from('user_profiles').upsert({
      id: signUpData.user.id,
      email: cleanEmail,
      full_name: params.companyName,
      role: 'client',
      client_directory_id: params.clientDirectoryId,
    });
    if (!signUpData.session) {
      return 'Client user provisioned. Confirm email in Supabase if email verification is active.';
    }
  }
  return undefined;
}

export async function deleteClientDirectory(clientId: string): Promise<void> {
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
  const normalized = rows.map((r) => ({ ...r, entryKind }));

  if (!isSupabaseConfigured || !supabase) {
    const keys = getClientStorageKeys(clientId);
    if (entryKind === 'SALES') safeSaveJson(keys.SALES, normalized);
    else if (entryKind === 'PURCHASES') safeSaveJson(keys.PURCHASES, normalized);
    else safeSaveJson(`${PORTAL_KEYS.EXPENSE_ROWS_PREFIX}${clientId}`, normalized);
    return normalized;
  }

  // Upsert rows for this entryKind and client directory
  if (normalized.length > 0) {
    const payload = normalized.map((r) => mapLedgerRowToDb(r, clientId, entryKind, userId));
    const { error } = await supabase.from('ledger_entries').upsert(payload, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }
  return normalized;
}

export async function upsertSingleLedgerRows(params: {
  clientId: string;
  entryKind: LedgerEntryKind;
  rows: LedgerRow[];
  userId?: string;
}): Promise<LedgerRow[]> {
  const withIds = params.rows.map((r) => ({
    ...r,
    id: r.id.startsWith('row-') ? toUuidLikeId() : r.id,
    entryKind: params.entryKind,
  }));

  if (!isSupabaseConfigured || !supabase) {
    return withIds;
  }

  const payload = withIds.map((r) =>
    mapLedgerRowToDb(r, params.clientId, params.entryKind, params.userId)
  );
  const { data, error } = await supabase
    .from('ledger_entries')
    .upsert(payload, { onConflict: 'id' })
    .select('*');

  if (error) throw new Error(error.message);
  return (data ?? []).map((d) => mapLedgerRowFromDb(d as Record<string, unknown>));
}

export async function deleteLedgerRowRemote(rowId: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.from('ledger_entries').delete().eq('id', rowId);
  if (error) throw new Error(error.message);
}

export async function clearLedgerRowsPeriodRemote(
  clientId: string,
  entryKind: LedgerEntryKind,
  idsToDelete: string[]
): Promise<void> {
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
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase
    .from('ledger_entries')
    .update({ audit_status: auditStatus, audit_note: auditNote })
    .eq('id', rowId);
  if (error) throw new Error(error.message);
}

export async function saveClientTinDirectory(
  clientId: string,
  records: TinRecord[]
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    const keys = getClientStorageKeys(clientId);
    safeSaveJson(keys.TINS, records);
    return;
  }

  if (records.length === 0) return;
  const payload = records
    .filter((r) => Boolean(r.digits))
    .map((r) => ({
      client_directory_id: clientId,
      tin: r.tin,
      digits: r.digits,
      payor: r.payor,
      branch_trade_name: r.branchTradeName,
      address: r.address,
      address2: r.address2 ?? '',
      default_private_or_govt: r.defaultPrivateOrGovt,
      default_category: r.defaultCategory,
      default_tax_status: r.defaultTaxStatus,
      default_payee_classification: r.defaultPayeeClassification ?? 'CORP',
      default_account_title: r.defaultAccountTitle ?? '',
      default_withholding_agent: r.defaultWithholdingAgent ?? 'YES',
    }));

  if (payload.length === 0) return;
  const { error } = await supabase
    .from('tin_directory')
    .upsert(payload, { onConflict: 'client_directory_id,digits' });
  if (error) throw new Error(error.message);
}

export async function deleteClientTinRecordRemote(clientId: string, record: TinRecord): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase
    .from('tin_directory')
    .delete()
    .eq('client_directory_id', clientId)
    .eq('digits', record.digits);
  if (error) throw new Error(error.message);
}

export async function seedSampleRowsForClient(clientId: string): Promise<{
  salesRows: LedgerRow[];
  purchasesRows: LedgerRow[];
  tinDirectory: TinRecord[];
}> {
  const salesRows = SEED_SALES_ROWS.map((r) => ({
    ...r,
    id: toUuidLikeId(),
    entryKind: 'SALES' as const,
  }));
  const purchasesRows = SEED_PURCHASES_ROWS.map((r) => ({
    ...r,
    id: toUuidLikeId(),
    entryKind: 'PURCHASES' as const,
  }));
  const tinDirectory = SEED_TIN_DIRECTORY;

  if (!isSupabaseConfigured || !supabase) {
    const keys = getClientStorageKeys(clientId);
    safeSaveJson(keys.SALES, salesRows);
    safeSaveJson(keys.PURCHASES, purchasesRows);
    safeSaveJson(keys.TINS, tinDirectory);
    return { salesRows, purchasesRows, tinDirectory };
  }

  await upsertSingleLedgerRows({ clientId, entryKind: 'SALES', rows: salesRows });
  await upsertSingleLedgerRows({ clientId, entryKind: 'PURCHASES', rows: purchasesRows });
  await saveClientTinDirectory(clientId, tinDirectory);
  return { salesRows, purchasesRows, tinDirectory };
}

// ----------------------------------------------------------------------------
// Large .XLSX Storage Vault Metadata Operations
// ----------------------------------------------------------------------------

export async function listVaultFiles(clientDirectoryId?: string): Promise<VaultXlsxFile[]> {
  if (!isSupabaseConfigured || !supabase) {
    ensurePreviewDirectoriesBootstrapped();
    const all = safeLoadJson<VaultXlsxFile[]>(PORTAL_KEYS.VAULT_FILES, []);
    return clientDirectoryId
      ? all.filter((f) => f.clientDirectoryId === clientDirectoryId)
      : all;
  }

  let query = supabase
    .from('xlsx_files')
    .select('*')
    .order('created_at', { ascending: false });

  if (clientDirectoryId) {
    query = query.eq('client_directory_id', clientDirectoryId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapVaultFileFromDb(row as Record<string, unknown>));
}

export async function createVaultFileMetadata(
  input: Omit<VaultXlsxFile, 'id' | 'createdAt' | 'updatedAt'>
): Promise<VaultXlsxFile> {
  const now = new Date().toISOString();
  if (!isSupabaseConfigured || !supabase) {
    const all = safeLoadJson<VaultXlsxFile[]>(PORTAL_KEYS.VAULT_FILES, []);
    const created: VaultXlsxFile = {
      ...input,
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
      client_directory_id: input.clientDirectoryId,
      file_name: input.fileName,
      storage_path: input.storagePath,
      bucket_name: input.bucketName,
      size_bytes: input.sizeBytes,
      tax_year: input.taxYear,
      tax_period: input.taxPeriod,
      entry_scope: input.entryScope,
      sheet_name: input.sheetName ?? '',
      preview_headers: input.previewHeaders,
      preview_rows: input.previewRows,
      uploaded_by: input.uploadedBy || null,
      uploaded_by_email: input.uploadedByEmail,
      notes: input.notes ?? '',
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to record .xlsx file metadata.');
  }

  return mapVaultFileFromDb(data as Record<string, unknown>);
}

export async function deleteVaultFileRecord(file: VaultXlsxFile): Promise<void> {
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
