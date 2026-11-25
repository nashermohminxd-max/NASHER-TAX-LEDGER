import {
  SEED_PURCHASES_ROWS,
  SEED_SALES_ROWS,
  SEED_TIN_DIRECTORY,
  upgradePurchasesRows,
  upgradeSalesRows,
  upgradeTinRecords,
} from '../data/seedData';
import type {
  ClientProfile,
  ClientWorkspaceBackup,
  LedgerRow,
  TinRecord,
} from '../types/tax';

export const DEFAULT_ACCOUNT_TITLES = [
  'COST OF GOODS SOLD',
  'FUEL & OIL',
  'UTILITIES EXPENSE',
  'RENT EXPENSE',
  'OFFICE SUPPLIES',
  'REPAIRS & MAINTENANCE',
  'PROFESSIONAL FEES',
  'FREIGHT & DELIVERY',
  'COMMUNICATION EXPENSE',
  'TAXES & LICENSES',
  'REPRESENTATION EXPENSE',
  'MISCELLANEOUS EXPENSE',
];

const LEGACY_KEYS = {
  SALES: 'ph_taxledger_sales_v1',
  PURCHASES: 'ph_taxledger_purchases_v1',
  TINS: 'ph_taxledger_tin_directory_v1',
  ACCOUNT_TITLES: 'ph_taxledger_account_titles_v1',
} as const;

export const REGISTRY_KEYS = {
  CLIENTS: 'ph_taxledger_clients_v1',
  ACTIVE_CLIENT: 'ph_taxledger_active_client_v1',
  AUTOCALC: 'ph_taxledger_autocalc_v1',
} as const;

export function getClientStorageKeys(clientId: string) {
  return {
    SALES: `ph_taxledger_c_${clientId}_sales_v1`,
    PURCHASES: `ph_taxledger_c_${clientId}_purchases_v1`,
    TINS: `ph_taxledger_c_${clientId}_tins_v1`,
    ACCOUNT_TITLES: `ph_taxledger_c_${clientId}_accounts_v1`,
  };
}

export function slugifyClientName(name: string): string {
  const base = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'client';
}

export function makeUniqueClientSlug(name: string, existing: ClientProfile[], excludeId?: string): string {
  const base = slugifyClientName(name);
  const used = new Set(existing.filter((c) => c.id !== excludeId).map((c) => c.slug));
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function safeLoadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function safeSaveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore localStorage quota errors
  }
}

export interface ClientDirectoryStats {
  salesCount: number;
  purchasesCount: number;
  tinCount: number;
}

export function getClientDirectoryStats(clientId: string): ClientDirectoryStats {
  const keys = getClientStorageKeys(clientId);
  const sales = safeLoadJson<LedgerRow[]>(keys.SALES, []);
  const purchases = safeLoadJson<LedgerRow[]>(keys.PURCHASES, []);
  const tins = safeLoadJson<TinRecord[]>(keys.TINS, []);
  return {
    salesCount: Array.isArray(sales) ? sales.length : 0,
    purchasesCount: Array.isArray(purchases) ? purchases.length : 0,
    tinCount: Array.isArray(tins) ? tins.length : 0,
  };
}

export function initializeClientRegistry(): {
  clients: ClientProfile[];
  activeClientId: string;
} {
  const existingClients = safeLoadJson<ClientProfile[]>(REGISTRY_KEYS.CLIENTS, []);
  if (Array.isArray(existingClients) && existingClients.length > 0) {
    const urlSlug = resolveClientSlugFromUrl();
    const byUrl = urlSlug
      ? existingClients.find((c) => c.slug === urlSlug || c.id === urlSlug)
      : undefined;
    const savedActiveId = safeLoadJson<string>(REGISTRY_KEYS.ACTIVE_CLIENT, '');
    const active =
      byUrl ??
      existingClients.find((c) => c.id === savedActiveId) ??
      existingClients[0];
    return {
      clients: existingClients,
      activeClientId: active.id,
    };
  }

  // First-time setup: create default client & migrate any legacy single-tenant data
  const now = new Date().toISOString();
  const defaultClient: ClientProfile = {
    id: 'client-default',
    slug: 'main-client',
    name: 'MAIN CLIENT',
    tin: '',
    rdo: '',
    createdAt: now,
    updatedAt: now,
  };

  const keys = getClientStorageKeys(defaultClient.id);
  const legacySales = safeLoadJson<LedgerRow[] | null>(LEGACY_KEYS.SALES, null);
  const legacyPurchases = safeLoadJson<LedgerRow[] | null>(LEGACY_KEYS.PURCHASES, null);
  const legacyTins = safeLoadJson<TinRecord[] | null>(LEGACY_KEYS.TINS, null);
  const legacyAccounts = safeLoadJson<string[] | null>(LEGACY_KEYS.ACCOUNT_TITLES, null);

  safeSaveJson(keys.SALES, upgradeSalesRows(legacySales ?? SEED_SALES_ROWS));
  safeSaveJson(keys.PURCHASES, upgradePurchasesRows(legacyPurchases ?? SEED_PURCHASES_ROWS));
  safeSaveJson(keys.TINS, upgradeTinRecords(legacyTins ?? SEED_TIN_DIRECTORY));
  safeSaveJson(keys.ACCOUNT_TITLES, legacyAccounts ?? DEFAULT_ACCOUNT_TITLES);
  safeSaveJson(REGISTRY_KEYS.CLIENTS, [defaultClient]);
  safeSaveJson(REGISTRY_KEYS.ACTIVE_CLIENT, defaultClient.id);

  return {
    clients: [defaultClient],
    activeClientId: defaultClient.id,
  };
}

export function loadClientWorkspace(clientId: string): {
  salesRows: LedgerRow[];
  purchasesRows: LedgerRow[];
  tinDirectory: TinRecord[];
  accountTitles: string[];
} {
  const keys = getClientStorageKeys(clientId);
  return {
    salesRows: upgradeSalesRows(safeLoadJson<LedgerRow[]>(keys.SALES, [])),
    purchasesRows: upgradePurchasesRows(safeLoadJson<LedgerRow[]>(keys.PURCHASES, [])),
    tinDirectory: upgradeTinRecords(safeLoadJson<TinRecord[]>(keys.TINS, [])),
    accountTitles: safeLoadJson<string[]>(keys.ACCOUNT_TITLES, DEFAULT_ACCOUNT_TITLES),
  };
}

export function seedEmptyClientWorkspace(
  clientId: string,
  options?: {
    copyTinsFrom?: TinRecord[];
    copyAccountsFrom?: string[];
    includeSampleRows?: boolean;
  }
): void {
  const keys = getClientStorageKeys(clientId);
  safeSaveJson(keys.SALES, options?.includeSampleRows ? SEED_SALES_ROWS : []);
  safeSaveJson(keys.PURCHASES, options?.includeSampleRows ? SEED_PURCHASES_ROWS : []);
  safeSaveJson(
    keys.TINS,
    options?.copyTinsFrom ?? (options?.includeSampleRows ? SEED_TIN_DIRECTORY : [])
  );
  safeSaveJson(keys.ACCOUNT_TITLES, options?.copyAccountsFrom ?? DEFAULT_ACCOUNT_TITLES);
}

export function deleteClientWorkspaceStorage(clientId: string): void {
  const keys = getClientStorageKeys(clientId);
  try {
    localStorage.removeItem(keys.SALES);
    localStorage.removeItem(keys.PURCHASES);
    localStorage.removeItem(keys.TINS);
    localStorage.removeItem(keys.ACCOUNT_TITLES);
  } catch {
    // ignore
  }
}

export function buildClientWorkspaceBackup(client: ClientProfile): ClientWorkspaceBackup {
  const data = loadClientWorkspace(client.id);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    client,
    ...data,
  };
}

export function resolveClientSlugFromUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('client');
    if (q) return q.trim().toLowerCase();
    const match = window.location.pathname.match(/^\/client\/([^/]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]).trim().toLowerCase();
  } catch {
    // ignore
  }
  return '';
}

export function syncClientSlugToUrl(slug: string): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('client', slug);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // ignore
  }
}
