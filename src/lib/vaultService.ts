import * as XLSX from 'xlsx';
import type { VaultXlsxFile, XlsxPreviewData } from '@/types/portal';
import { isSupabaseConfigured, supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase';

export const VAULT_BUCKET = 'ledger-vault';
const MAX_BROWSER_PREVIEW_BYTES = 150 * 1024 * 1024; // 150 MB safe browser ArrayBuffer cap
const IDB_NAME = 'nasher_tax_ledger_vault_v1';
const IDB_STORE = 'xlsx_blobs';

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, exp);
  return `${val >= 10 || exp === 0 ? val.toFixed(1) : val.toFixed(2)} ${units[exp]}`;
}

export function sanitizeSegment(raw: string, fallback: string): string {
  const cleaned = (raw || '')
    .trim()
    .replace(/\.\./g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

export function sanitizeFilename(fileName: string): string {
  const base = (fileName || 'workbook.xlsx').split(/[\\/]/).pop() ?? 'workbook.xlsx';
  const cleaned = base.replace(/[^a-zA-Z0-9._ -]+/g, '_').trim();
  return cleaned || 'workbook.xlsx';
}

export function isValidSpreadsheetFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.xlsm');
}

/**
 * Generates the isolated per-client path required by Supabase Storage RLS policies:
 * {client_directory_id}/{tax_year}/{period}/{filename}.xlsx
 */
export function buildVaultStoragePath(
  clientDirectoryId: string,
  taxYear: string,
  taxPeriod: string,
  fileName: string
): string {
  const safeClient = sanitizeSegment(clientDirectoryId, 'unassigned');
  const safeYear = sanitizeSegment(taxYear, String(new Date().getFullYear()));
  const safePeriod = sanitizeSegment(taxPeriod, 'GENERAL');
  const safeFile = sanitizeFilename(fileName);
  const stamp = Date.now().toString(36);
  return `${safeClient}/${safeYear}/${safePeriod}/${stamp}_${safeFile}`;
}

function openBlobDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Unable to open vault IndexedDB'));
  });
}

export async function saveLocalVaultBlob(storagePath: string, blob: Blob): Promise<void> {
  const db = await openBlobDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(blob, storagePath);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed saving workbook to local IndexedDB'));
  });
}

export async function loadLocalVaultBlob(storagePath: string): Promise<Blob | null> {
  const db = await openBlobDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(storagePath);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('Failed reading workbook from local IndexedDB'));
  });
}

export async function deleteLocalVaultBlob(storagePath: string): Promise<void> {
  try {
    const db = await openBlobDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(storagePath);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore cleanup errors
  }
}

/**
 * Uses SheetJS (xlsx) client-side to parse ONLY the first 20 data rows (+ header row)
 * so previewing large workbooks stays fast and responsive.
 */
export async function previewXlsxFirst20Rows(
  fileOrBlob: File | Blob,
  preferredSheet?: string
): Promise<XlsxPreviewData> {
  if (fileOrBlob.size > MAX_BROWSER_PREVIEW_BYTES) {
    return {
      sheetName: 'Large Workbook',
      sheetNames: ['Large Workbook'],
      headers: ['Notice'],
      rows: [
        [
          `File size (${formatFileSize(fileOrBlob.size)}) exceeds the 150 MB in-browser SheetJS preview cap. Direct cloud upload and download still work at full multi-GB size.`,
        ],
      ],
      totalEstimatedRows: 0,
    };
  }

  const buffer = await fileOrBlob.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: 'array',
    sheetRows: 21,
    dense: true,
  });

  const sheetNames = workbook.SheetNames;
  if (sheetNames.length === 0) {
    return {
      sheetName: '',
      sheetNames: [],
      headers: [],
      rows: [],
      totalEstimatedRows: 0,
    };
  }

  const targetSheetName =
    preferredSheet && sheetNames.includes(preferredSheet) ? preferredSheet : sheetNames[0];
  const sheet = workbook.Sheets[targetSheetName];
  const rawAoA = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });

  const cleanRows = rawAoA
    .slice(0, 21)
    .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '').trim()) : []));

  const maxCols = cleanRows.reduce((max, r) => Math.max(max, r.length), 0);
  const normalizedRows = cleanRows.map((r) => {
    const padded = [...r];
    while (padded.length < maxCols) padded.push('');
    return padded;
  });

  const headers =
    normalizedRows[0] && normalizedRows[0].some(Boolean)
      ? normalizedRows[0].map((h, i) => h || `Column ${i + 1}`)
      : Array.from({ length: maxCols }, (_, i) => `Column ${i + 1}`);

  const dataRows = normalizedRows.slice(1, 21);
  const rangeRef = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
  const totalEstimatedRows = rangeRef ? Math.max(0, rangeRef.e.r) : dataRows.length;

  return {
    sheetName: targetSheetName,
    sheetNames,
    headers,
    rows: dataRows,
    totalEstimatedRows,
  };
}

/**
 * Uploads directly from the browser to Supabase Storage (`ledger-vault`) via XHR
 * so real-time byte progress is tracked and Vercel's 4.5MB serverless limit is completely bypassed.
 * In local preview mode (when Supabase env vars are absent), streams into IndexedDB with simulated progress.
 */
export async function uploadXlsxDirectToVault(params: {
  file: File;
  storagePath: string;
  onProgress: (percent: number, loadedBytes: number) => void;
}): Promise<void> {
  const { file, storagePath, onProgress } = params;

  if (!isSupabaseConfigured || !supabase) {
    // Local preview IndexedDB fallback with smooth progress reporting
    const steps = 8;
    for (let i = 1; i < steps; i++) {
      await new Promise((r) => setTimeout(r, 45));
      const pct = Math.round((i / steps) * 85);
      onProgress(pct, Math.round((file.size * pct) / 100));
    }
    await saveLocalVaultBlob(storagePath, file);
    onProgress(100, file.size);
    return;
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) {
    throw new Error('Authentication session expired. Please sign in again before uploading.');
  }

  const encodedPath = storagePath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${VAULT_BUCKET}/${encodedPath}`;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint, true);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('apikey', supabaseAnonKey);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.setRequestHeader(
      'Content-Type',
      file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        const pct = Math.min(99, Math.round((evt.loaded / evt.total) * 100));
        onProgress(pct, evt.loaded);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100, file.size);
        resolve();
      } else {
        let message = `Storage upload failed (${xhr.status})`;
        try {
          const body = JSON.parse(xhr.responseText) as { message?: string; error?: string };
          if (body.message || body.error) {
            message = body.message ?? body.error ?? message;
          }
        } catch {
          // ignore JSON parse failure
        }
        reject(new Error(message));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during direct cloud storage upload.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(file);
  });
}

export async function downloadVaultXlsxBlob(fileRecord: VaultXlsxFile): Promise<Blob> {
  if (!isSupabaseConfigured || !supabase) {
    const localBlob = await loadLocalVaultBlob(fileRecord.storagePath);
    if (localBlob) return localBlob;

    // Fallback: reconstruct workbook from stored preview headers/rows if pre-seeded demo entry
    const wb = XLSX.utils.book_new();
    const aoa = [fileRecord.previewHeaders, ...fileRecord.previewRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, fileRecord.sheetName || 'Sheet1');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  const { data, error } = await supabase.storage
    .from(fileRecord.bucketName || VAULT_BUCKET)
    .download(fileRecord.storagePath);
  if (error || !data) {
    throw new Error(error?.message || 'Unable to download workbook from Supabase Storage.');
  }
  return data;
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function removeVaultStorageObject(storagePath: string, bucket = VAULT_BUCKET): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    await deleteLocalVaultBlob(storagePath);
    return;
  }
  const { error } = await supabase.storage.from(bucket).remove([storagePath]);
  if (error) {
    throw new Error(error.message);
  }
}
