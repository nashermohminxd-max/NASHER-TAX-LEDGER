import { unzipSync, zipSync, strFromU8, strToU8, type Zippable } from 'fflate';
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
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .replace(/\.\./g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

export function sanitizeFilename(fileName: string): string {
  const base = (fileName || 'workbook.xlsx')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .split(/[\\/]/)
    .pop() ?? 'workbook.xlsx';
  const cleaned = base
    .replace(/\.\./g, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, '_')
    .trim();
  return cleaned || 'workbook.xlsx';
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

async function saveLocalVaultBlob(storagePath: string, blob: Blob): Promise<void> {
  const db = await openBlobDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(blob, storagePath);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed saving workbook to local IndexedDB'));
  });
}

async function loadLocalVaultBlob(storagePath: string): Promise<Blob | null> {
  const db = await openBlobDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(storagePath);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('Failed reading workbook from local IndexedDB'));
  });
}

async function deleteLocalVaultBlob(storagePath: string): Promise<void> {
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

function parseCellRefColIndex(ref: string): number {
  const match = /^([A-Z]+)/i.exec(ref);
  if (!match) return -1;
  const letters = match[1].toUpperCase();
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

function parseXmlDocument(xmlText: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(xmlText, 'application/xml');
}

function extractSharedStrings(xmlText: string): string[] {
  const doc = parseXmlDocument(xmlText);
  const items = doc.getElementsByTagName('si');
  const out: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const tNodes = items[i].getElementsByTagName('t');
    let text = '';
    for (let j = 0; j < tNodes.length; j++) {
      text += tNodes[j].textContent ?? '';
    }
    out.push(text);
  }
  return out;
}

function parseWorksheetFirst21Rows(xmlText: string, sharedStrings: string[]): string[][] {
  const doc = parseXmlDocument(xmlText);
  const rowNodes = doc.getElementsByTagName('row');
  const rows: string[][] = [];

  for (let r = 0; r < rowNodes.length && rows.length < 21; r++) {
    const rowEl = rowNodes[r];
    const cellNodes = rowEl.getElementsByTagName('c');
    const rowArr: string[] = [];
    let hasContent = false;

    for (let c = 0; c < cellNodes.length; c++) {
      const cell = cellNodes[c];
      const ref = cell.getAttribute('r') ?? '';
      const colIdx = parseCellRefColIndex(ref);
      const targetIdx = colIdx >= 0 ? colIdx : rowArr.length;
      if (targetIdx > 150) continue; // cap columns to prevent memory exhaustion

      const cellType = cell.getAttribute('t') ?? '';
      let val = '';

      if (cellType === 'inlineStr') {
        const tNodes = cell.getElementsByTagName('t');
        for (let k = 0; k < tNodes.length; k++) {
          val += tNodes[k].textContent ?? '';
        }
      } else {
        const vNode = cell.getElementsByTagName('v')[0];
        const rawVal = vNode?.textContent ?? '';
        if (cellType === 's') {
          const idx = parseInt(rawVal, 10);
          val = Number.isInteger(idx) && idx >= 0 && idx < sharedStrings.length ? sharedStrings[idx] : '';
        } else if (cellType === 'b') {
          val = rawVal === '1' ? 'TRUE' : 'FALSE';
        } else {
          val = rawVal;
        }
      }

      const trimmed = val.trim();
      if (trimmed) hasContent = true;
      while (rowArr.length <= targetIdx) rowArr.push('');
      rowArr[targetIdx] = trimmed;
    }

    if (hasContent) {
      rows.push(rowArr);
    }
  }

  return rows;
}

/**
 * Pure-browser OOXML (.xlsx / .xlsm) parser built on `fflate` + native `DOMParser`
 * extracting ONLY the first 20 data rows (+ header row), immune to SheetJS Prototype Pollution & ReDoS.
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
          `File size (${formatFileSize(fileOrBlob.size)}) exceeds the 150 MB in-browser preview cap. Direct cloud upload and download still work at full multi-GB size.`,
        ],
      ],
      totalEstimatedRows: 0,
    };
  }

  const buffer = await fileOrBlob.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Check ZIP magic header (PK\x03\x04); legacy binary .xls files don't use ZIP OOXML
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return {
      sheetName: 'Workbook',
      sheetNames: ['Workbook'],
      headers: ['Notice'],
      rows: [['Preview is supported for .xlsx / .xlsm OpenXML workbooks. Binary .xls files are stored directly.']],
      totalEstimatedRows: 0,
    };
  }

  const zipEntries = unzipSync(bytes, {
    filter: (entry) => {
      const name = entry.name.toLowerCase();
      return (
        entry.originalSize <= 64 * 1024 * 1024 &&
        (name === 'xl/workbook.xml' ||
          name === 'xl/_rels/workbook.xml.rels' ||
          name === 'xl/sharedstrings.xml' ||
          (name.startsWith('xl/worksheets/') && name.endsWith('.xml')))
      );
    },
  });

  const getEntryText = (targetPath: string): string | null => {
    const exact = zipEntries[targetPath];
    if (exact) return strFromU8(exact);
    const lowerTarget = targetPath.toLowerCase();
    for (const [key, data] of Object.entries(zipEntries)) {
      if (key.toLowerCase() === lowerTarget) return strFromU8(data);
    }
    return null;
  };

  const workbookXml = getEntryText('xl/workbook.xml');
  const relsXml = getEntryText('xl/_rels/workbook.xml.rels');

  const sheetMap: { name: string; path: string }[] = [];
  if (workbookXml) {
    const relTargets = new Map<string, string>();
    if (relsXml) {
      const relDoc = parseXmlDocument(relsXml);
      const rels = relDoc.getElementsByTagName('Relationship');
      for (let i = 0; i < rels.length; i++) {
        const id = rels[i].getAttribute('Id') ?? '';
        const target = rels[i].getAttribute('Target') ?? '';
        if (id && target) {
          const normalized = target.startsWith('/')
            ? target.slice(1)
            : target.startsWith('xl/')
            ? target
            : `xl/${target.replace(/^\.\//, '')}`;
          relTargets.set(id, normalized);
        }
      }
    }

    const wbDoc = parseXmlDocument(workbookXml);
    const sheets = wbDoc.getElementsByTagName('sheet');
    for (let i = 0; i < sheets.length; i++) {
      const name = sheets[i].getAttribute('name') || `Sheet${i + 1}`;
      const rId =
        sheets[i].getAttribute('r:id') ??
        sheets[i].getAttributeNS(
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
          'id'
        ) ??
        '';
      const target = relTargets.get(rId) || `xl/worksheets/sheet${i + 1}.xml`;
      sheetMap.push({ name, path: target });
    }
  }

  if (sheetMap.length === 0) {
    const fallbackSheet = Object.keys(zipEntries)
      .filter((k) => k.toLowerCase().startsWith('xl/worksheets/') && k.toLowerCase().endsWith('.xml'))
      .sort()[0];
    if (!fallbackSheet) {
      return {
        sheetName: '',
        sheetNames: [],
        headers: [],
        rows: [],
        totalEstimatedRows: 0,
      };
    }
    sheetMap.push({ name: 'Sheet1', path: fallbackSheet });
  }

  const sheetNames = sheetMap.map((s) => s.name);
  const chosen =
    (preferredSheet && sheetMap.find((s) => s.name === preferredSheet)) || sheetMap[0];

  const sharedStringsXml = getEntryText('xl/sharedStrings.xml');
  const sharedStrings = sharedStringsXml ? extractSharedStrings(sharedStringsXml) : [];
  const sheetXml = getEntryText(chosen.path);

  if (!sheetXml) {
    return {
      sheetName: chosen.name,
      sheetNames,
      headers: [],
      rows: [],
      totalEstimatedRows: 0,
    };
  }

  const cleanRows = parseWorksheetFirst21Rows(sheetXml, sharedStrings);
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
  return {
    sheetName: chosen.name,
    sheetNames,
    headers,
    rows: dataRows,
    totalEstimatedRows: dataRows.length,
  };
}

function xmlEsc(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colRef(colIdx0: number, row1: number): string {
  let n = colIdx0 + 1;
  let col = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return `${col}${row1}`;
}

function buildFallbackWorkbookBlob(sheetName: string, rows: string[][]): Blob {
  const safeSheet = xmlEsc((sheetName || 'Sheet1').slice(0, 31));
  const rowsXml = rows
    .map(
      (r, rIdx) =>
        `<row r="${rIdx + 1}">${r
          .map(
            (val, cIdx) =>
              `<c r="${colRef(cIdx, rIdx + 1)}" t="inlineStr"><is><t>${xmlEsc(val)}</t></is></c>`
          )
          .join('')}</row>`
    )
    .join('');

  const files: Zippable = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets></workbook>`
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`
    ),
  };

  const zipped = zipSync(files, { level: 0 });
  return new Blob([new Uint8Array(zipped)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
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

  if (!storagePath || storagePath.includes('..') || storagePath.startsWith('/')) {
    throw new Error('Invalid storage path.');
  }

  if (!isSupabaseConfigured || !supabase) {
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

    return buildFallbackWorkbookBlob(fileRecord.sheetName || 'Sheet1', [
      fileRecord.previewHeaders,
      ...fileRecord.previewRows,
    ]);
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
  const safeName = sanitizeFilename(fileName);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName;
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
