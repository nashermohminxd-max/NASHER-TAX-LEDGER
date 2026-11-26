import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  CloudUpload,
  Download,
  Eye,
  FileSpreadsheet,
  FolderLock,
  HardDrive,
  Loader2,
  Search,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { createVaultFileMetadata, deleteVaultFileRecord, listVaultFiles } from '@/lib/portalStore';
import {
  VAULT_BUCKET,
  buildVaultStoragePath,
  downloadVaultXlsxBlob,
  formatFileSize,
  isValidSpreadsheetFile,
  previewXlsxFirst20Rows,
  triggerBlobDownload,
  uploadXlsxDirectToVault,
} from '@/lib/vaultService';
import type { ClientDirectory, VaultEntryScope, VaultXlsxFile, XlsxPreviewData } from '@/types/portal';

interface UploadQueueItem {
  id: string;
  file: File;
  taxYear: string;
  taxPeriod: string;
  entryScope: VaultEntryScope;
  notes: string;
  status: 'QUEUED' | 'PARSING' | 'UPLOADING' | 'DONE' | 'ERROR';
  progress: number;
  loadedBytes: number;
  error?: string;
  preview?: XlsxPreviewData;
}

interface XlsxVaultPanelProps {
  client: ClientDirectory;
  isAdminMode?: boolean;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
}

const PERIOD_PRESETS = [
  '2026-Q1',
  '2026-Q2',
  '2026-Q3',
  '2026-Q4',
  'ANNUAL-2026',
];

export const XlsxVaultPanel: React.FC<XlsxVaultPanelProps> = ({
  client,
  isAdminMode = false,
  onNotify,
}) => {
  const { user, isSupabaseMode } = useAuth();
  const [files, setFiles] = useState<VaultXlsxFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const [taxYear, setTaxYear] = useState('2026');
  const [taxPeriod, setTaxPeriod] = useState('2026-Q1');
  const [entryScope, setEntryScope] = useState<VaultEntryScope>('GENERAL');
  const [notes, setNotes] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [periodFilter, setPeriodFilter] = useState('ALL');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<VaultXlsxFile | null>(null);

  const [previewModal, setPreviewModal] = useState<{
    title: string;
    subtitle: string;
    data: XlsxPreviewData;
    sourceBlob?: Blob;
  } | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshFiles = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listVaultFiles(client.id);
      setFiles(list);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Unable to load XLSX vault.', 'error');
    } finally {
      setLoading(false);
    }
  }, [client.id, onNotify]);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  const totalUsedBytes = useMemo(
    () => files.reduce((sum, f) => sum + (f.sizeBytes || 0), 0),
    [files]
  );
  const usagePercent = Math.min(
    100,
    client.storageQuotaBytes > 0 ? (totalUsedBytes / client.storageQuotaBytes) * 100 : 0
  );

  const availablePeriods = useMemo(() => {
    const set = new Set<string>();
    files.forEach((f) => {
      if (f.taxPeriod) set.add(f.taxPeriod);
    });
    return Array.from(set).sort();
  }, [files]);

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return files.filter((f) => {
      if (periodFilter !== 'ALL' && f.taxPeriod !== periodFilter) return false;
      if (q) {
        const hay = `${f.fileName} ${f.taxYear} ${f.taxPeriod} ${f.entryScope} ${f.notes ?? ''} ${f.storagePath}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [files, periodFilter, searchQuery]);

  const stageSelectedFiles = async (selected: FileList | File[]) => {
    const incoming = Array.from(selected);
    const valid = incoming.filter(isValidSpreadsheetFile);
    const invalidCount = incoming.length - valid.length;
    if (invalidCount > 0) {
      onNotify?.(
        `Skipped ${invalidCount} non-Excel file(s). Only .xlsx, .xls, or .xlsm workbooks are allowed.`,
        'error'
      );
    }
    if (valid.length === 0) return;

    const newItems: UploadQueueItem[] = [];
    for (const file of valid) {
      const itemId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      let preview: XlsxPreviewData | undefined;
      try {
        preview = await previewXlsxFirst20Rows(file);
      } catch {
        preview = undefined;
      }
      newItems.push({
        id: itemId,
        file,
        taxYear: taxYear.trim() || '2026',
        taxPeriod: taxPeriod.trim() || '2026-Q1',
        entryScope,
        notes: notes.trim(),
        status: 'QUEUED',
        progress: 0,
        loadedBytes: 0,
        preview,
      });
    }

    setQueue((prev) => [...prev, ...newItems]);
  };

  const uploadSingleQueueItem = async (item: UploadQueueItem) => {
    const storagePath = buildVaultStoragePath(
      client.id,
      item.taxYear,
      item.taxPeriod,
      item.file.name
    );

    setQueue((prev) =>
      prev.map((q) =>
        q.id === item.id ? { ...q, status: 'UPLOADING', progress: 1, error: undefined } : q
      )
    );

    try {
      let preview = item.preview;
      if (!preview) {
        preview = await previewXlsxFirst20Rows(item.file);
      }

      await uploadXlsxDirectToVault({
        file: item.file,
        storagePath,
        onProgress: (percent, loadedBytes) => {
          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id ? { ...q, progress: percent, loadedBytes } : q
            )
          );
        },
      });

      const saved = await createVaultFileMetadata({
        clientDirectoryId: client.id,
        fileName: item.file.name,
        storagePath,
        bucketName: VAULT_BUCKET,
        sizeBytes: item.file.size,
        taxYear: item.taxYear,
        taxPeriod: item.taxPeriod,
        entryScope: item.entryScope,
        sheetName: preview.sheetName,
        previewHeaders: preview.headers,
        previewRows: preview.rows.slice(0, 20),
        uploadedBy: user?.id ?? '',
        uploadedByEmail: user?.email ?? '',
        notes: item.notes,
      });

      setFiles((prev) => [saved, ...prev]);
      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id
            ? { ...q, status: 'DONE', progress: 100, loadedBytes: item.file.size, preview }
            : q
        )
      );
      onNotify?.(`Uploaded ${item.file.name} directly to ${client.companyName} vault.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed.';
      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, status: 'ERROR', error: msg } : q))
      );
      onNotify?.(msg, 'error');
    }
  };

  const handleUploadAllQueued = async () => {
    const pending = queue.filter((q) => q.status === 'QUEUED' || q.status === 'ERROR');
    for (const item of pending) {
      await uploadSingleQueueItem(item);
    }
  };

  const handlePreviewStoredFile = async (fileRecord: VaultXlsxFile) => {
    // Use stored fast preview first, or parse live workbook from storage if empty
    if (fileRecord.previewHeaders.length > 0 && fileRecord.previewRows.length > 0) {
      setPreviewModal({
        title: fileRecord.fileName,
        subtitle: `${fileRecord.taxPeriod} · ${formatFileSize(fileRecord.sizeBytes)} · First ${fileRecord.previewRows.length} rows`,
        data: {
          sheetName: fileRecord.sheetName || 'Sheet1',
          sheetNames: [fileRecord.sheetName || 'Sheet1'],
          headers: fileRecord.previewHeaders,
          rows: fileRecord.previewRows,
          totalEstimatedRows: fileRecord.previewRows.length,
        },
      });
      return;
    }

    setPreviewLoadingId(fileRecord.id);
    try {
      const blob = await downloadVaultXlsxBlob(fileRecord);
      const data = await previewXlsxFirst20Rows(blob);
      setPreviewModal({
        title: fileRecord.fileName,
        subtitle: `${fileRecord.taxPeriod} · ${formatFileSize(fileRecord.sizeBytes)}`,
        data,
        sourceBlob: blob,
      });
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Unable to preview workbook.', 'error');
    } finally {
      setPreviewLoadingId(null);
    }
  };

  const handleSwitchPreviewSheet = async (sheetName: string) => {
    if (!previewModal?.sourceBlob) return;
    const data = await previewXlsxFirst20Rows(previewModal.sourceBlob, sheetName);
    setPreviewModal({ ...previewModal, data });
  };

  const handleDownloadFile = async (fileRecord: VaultXlsxFile) => {
    setDownloadingId(fileRecord.id);
    try {
      const blob = await downloadVaultXlsxBlob(fileRecord);
      triggerBlobDownload(blob, fileRecord.fileName);
      onNotify?.(`Downloaded ${fileRecord.fileName}.`);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Download failed.', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDeleteFile = async (fileRecord: VaultXlsxFile) => {
    setDeletingId(fileRecord.id);
    try {
      await deleteVaultFileRecord(fileRecord);
      setFiles((prev) => prev.filter((f) => f.id !== fileRecord.id));
      setConfirmDeleteFile(null);
      onNotify?.(`Removed ${fileRecord.fileName} from vault.`);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Unable to delete file.', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const queuedPendingCount = queue.filter((q) => q.status === 'QUEUED' || q.status === 'ERROR').length;

  return (
    <div className="space-y-5">
      {/* Storage Header & Quota Summary */}
      <div className="rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl p-5 shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-lg bg-[#E7F0FC] px-2.5 py-1 text-xs font-semibold text-[#0B4DA2]">
              <FolderLock className="h-3.5 w-3.5" />
              Direct Browser-to-Cloud Storage Vault · Zero Vercel 4.5MB Payload Limit
            </div>
            <h2 className="mt-2.5 font-display text-lg font-bold text-slate-900">
              {client.companyName} — .XLSX Filing Vault
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Isolated path:{' '}
              <code className="rounded-md bg-[#F4F8FD] px-1.5 py-0.5 font-mono text-[11px] text-[#0B4DA2]">
                {VAULT_BUCKET}/{client.id}/{taxYear}/{taxPeriod}/&lt;filename&gt;.xlsx
              </code>
              {!isSupabaseMode && (
                <span className="ml-2 text-slate-500 font-medium">
                  (Local IndexedDB vault active — connect Supabase env vars for multi-GB cloud sync)
                </span>
              )}
            </p>
          </div>

          <div className="min-w-[240px] rounded-xl border border-[#BBD6F2] bg-[#EBF3FC]/75 px-4 py-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
              <span className="inline-flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5 text-[#0B4DA2]" />
                Vault Usage
              </span>
              <span className="tabular-nums-mono text-slate-900">
                {formatFileSize(totalUsedBytes)} / {formatFileSize(client.storageQuotaBytes)}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/90">
              <div
                className="h-full rounded-full bg-[#0B4DA2] transition-all"
                style={{ width: `${Math.max(2, usagePercent)}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-slate-600">
              <span>{files.length} workbook(s) stored</span>
              <span>Up to 5 GB per file</span>
            </div>
          </div>
        </div>
      </div>

      {/* Upload Config + Drag-and-Drop Zone */}
      <div className="rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl p-5 space-y-4 shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              Tax Year
            </label>
            <input
              type="text"
              value={taxYear}
              onChange={(e) => setTaxYear(e.target.value)}
              placeholder="2026"
              className="mt-1 w-full rounded-xl border border-slate-300/80 bg-white/90 px-3 py-2 text-xs font-semibold tabular-nums-mono text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              Tax Period Tag
            </label>
            <input
              type="text"
              list="vault-period-presets"
              value={taxPeriod}
              onChange={(e) => setTaxPeriod(e.target.value)}
              placeholder="2026-Q1"
              className="mt-1 w-full rounded-xl border border-slate-300/80 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
            />
            <datalist id="vault-period-presets">
              {PERIOD_PRESETS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              Workbook Scope
            </label>
            <select
              value={entryScope}
              onChange={(e) => setEntryScope(e.target.value as VaultEntryScope)}
              className="mt-1 w-full rounded-xl border border-slate-300/80 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
            >
              <option value="GENERAL">General Audit Workbook</option>
              <option value="SALES">Sales Ledger</option>
              <option value="EXPENSE">Expenses Ledger</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              Filing Notes (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. BIR Form 2550Q attachment"
              className="mt-1 w-full rounded-xl border border-slate-300/80 bg-white/90 px-3 py-2 text-xs text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
            />
          </div>
        </div>

        {/* Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files?.length) {
              void stageSelectedFiles(e.dataTransfer.files);
            }
          }}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-9 text-center transition-colors ${
            isDragging
              ? 'border-[#0B4DA2] bg-[#E7F0FC]/80'
              : 'border-slate-300/85 bg-[#F4F8FD]/70 hover:border-[#0B4DA2] hover:bg-[#E7F0FC]/50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.xlsm"
            multiple
            onChange={(e) => {
              if (e.target.files?.length) {
                void stageSelectedFiles(e.target.files);
              }
              e.target.value = '';
            }}
            className="hidden"
          />
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#E7F0FC] text-[#0B4DA2]">
            <UploadCloud className="h-5 w-5" />
          </div>
          <p className="mt-3 font-display text-sm font-semibold text-slate-900">
            Drag & drop multi-file .xlsx workbooks here, or click to browse
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Supports 500MB+ / multi-GB Excel files via direct browser-to-cloud streaming & SheetJS 20-row preview
          </p>
        </div>

        {/* Upload Queue */}
        {queue.length > 0 && (
          <div className="rounded-xl border border-slate-200/80 bg-[#F4F8FD]/80 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-800">
                Staged Workbooks ({queue.length})
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQueue((prev) => prev.filter((q) => q.status === 'UPLOADING'))}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  Clear Finished
                </button>
                {queuedPendingCount > 0 && (
                  <button
                    type="button"
                    onClick={handleUploadAllQueued}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#18181B] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                  >
                    <CloudUpload className="h-3.5 w-3.5" />
                    Upload {queuedPendingCount} File{queuedPendingCount > 1 ? 's' : ''}
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {queue.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 text-[#0B4DA2] shrink-0" />
                        <span className="truncate text-xs font-semibold text-slate-900">
                          {item.file.name}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                          {formatFileSize(item.file.size)}
                        </span>
                        <span className="rounded bg-[#E7F0FC] px-1.5 py-0.5 text-[10px] font-semibold text-[#0B4DA2]">
                          {item.taxPeriod}
                        </span>
                      </div>

                      {item.status === 'ERROR' && item.error && (
                        <p className="mt-1 text-[11px] font-medium text-rose-700">{item.error}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {item.preview && (
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewModal({
                              title: `Pre-Upload Preview — ${item.file.name}`,
                              subtitle: `${item.taxPeriod} · ${formatFileSize(item.file.size)} · First ${item.preview!.rows.length} rows`,
                              data: item.preview!,
                              sourceBlob: item.file,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                        >
                          <Eye className="h-3 w-3" />
                          Preview 20 Rows
                        </button>
                      )}

                      {item.status === 'QUEUED' || item.status === 'ERROR' ? (
                        <button
                          type="button"
                          onClick={() => uploadSingleQueueItem(item)}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#18181B] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 cursor-pointer"
                        >
                          <CloudUpload className="h-3 w-3" />
                          {item.status === 'ERROR' ? 'Retry' : 'Upload'}
                        </button>
                      ) : item.status === 'DONE' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0B4DA2]">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Uploaded
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0B4DA2]" />
                          {item.progress}%
                        </span>
                      )}

                      {item.status !== 'UPLOADING' && (
                        <button
                          type="button"
                          onClick={() => setQueue((prev) => prev.filter((q) => q.id !== item.id))}
                          aria-label="Remove from queue"
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {(item.status === 'UPLOADING' || item.status === 'DONE') && (
                    <div className="mt-2">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-[#0B4DA2] transition-all"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      <div className="mt-1 flex justify-between text-[10px] tabular-nums-mono text-slate-500">
                        <span>
                          {formatFileSize(item.loadedBytes)} / {formatFileSize(item.file.size)}
                        </span>
                        <span>{item.progress}%</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Stored Vault Workbooks Table */}
      <div className="overflow-hidden rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-5 py-3.5">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900">
              Stored .XLSX Archive ({filteredFiles.length})
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search filename or tag..."
                className="w-52 rounded-xl border border-slate-300/80 bg-white/90 py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
              />
            </div>

            <select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value)}
              className="rounded-xl border border-slate-300/80 bg-white/90 px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-[#0B4DA2] focus:outline-none"
            >
              <option value="ALL">All Tax Periods</option>
              {availablePeriods.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin text-[#0B4DA2]" />
            Loading vault records...
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
            <FileSpreadsheet className="h-10 w-10 text-slate-300" />
            <h4 className="mt-3 font-display text-sm font-semibold text-slate-900">
              No .xlsx workbooks in this client vault yet
            </h4>
            <p className="mt-1 max-w-md text-xs text-slate-500">
              Drop multi-hundred-MB or multi-GB Excel filing workbooks above to archive them securely inside{' '}
              <span className="font-mono text-slate-700">{client.id}</span>.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200/80 bg-[#F4F8FD]/90 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  <th className="px-4 py-3">Workbook Name</th>
                  <th className="px-3 py-3">Tax Period</th>
                  <th className="px-3 py-3">Scope</th>
                  <th className="px-3 py-3 text-right">Size</th>
                  <th className="px-3 py-3">Uploaded</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70">
                {filteredFiles.map((file) => (
                  <tr key={file.id} className="hover:bg-[#F5F9FE]/80 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 text-[#0B4DA2] shrink-0" />
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate max-w-[280px]">
                            {file.fileName}
                          </div>
                          <div className="font-mono text-[10px] text-slate-400 truncate max-w-[280px]">
                            {file.storagePath}
                          </div>
                          {file.notes && (
                            <div className="mt-0.5 text-[11px] text-slate-500 truncate max-w-[280px]">
                              {file.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="rounded-md bg-[#E7F0FC] px-2 py-0.5 font-mono text-[11px] font-semibold text-[#0B4DA2]">
                        {file.taxPeriod}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                        {file.entryScope}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono whitespace-nowrap font-medium text-slate-800">
                      {formatFileSize(file.sizeBytes)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-slate-500">
                      <div>{new Date(file.createdAt).toLocaleDateString()}</div>
                      {file.uploadedByEmail && (
                        <div className="text-[10px] text-slate-400">{file.uploadedByEmail}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handlePreviewStoredFile(file)}
                          disabled={previewLoadingId === file.id}
                          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                        >
                          {previewLoadingId === file.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Eye className="h-3 w-3" />
                          )}
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadFile(file)}
                          disabled={downloadingId === file.id}
                          className="inline-flex items-center gap-1 rounded-xl bg-[#18181B] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                        >
                          {downloadingId === file.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Download className="h-3 w-3" />
                          )}
                          Download
                        </button>
                        {isAdminMode && (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteFile(file)}
                            title="Delete from vault"
                            className="rounded-xl border border-rose-200 bg-white p-1.5 text-rose-600 hover:bg-rose-50 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SheetJS 20-Row Preview Modal */}
      {previewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-xs">
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-[24px] border-2 border-white bg-white shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 px-5 py-3.5">
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900">
                  {previewModal.title}
                </h3>
                <p className="text-xs text-slate-500">{previewModal.subtitle}</p>
              </div>
              <div className="flex items-center gap-2">
                {previewModal.sourceBlob && previewModal.data.sheetNames.length > 1 && (
                  <select
                    value={previewModal.data.sheetName}
                    onChange={(e) => handleSwitchPreviewSheet(e.target.value)}
                    className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800"
                  >
                    {previewModal.data.sheetNames.map((name) => (
                      <option key={name} value={name}>
                        Sheet: {name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewModal(null)}
                  className="rounded-xl border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4">
              {previewModal.data.rows.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  No data rows detected in sheet "{previewModal.data.sheetName}".
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="bg-[#0B4DA2] text-white">
                        <th className="border-r border-white/20 px-2.5 py-2 font-mono text-[10px] text-white/80">
                          #
                        </th>
                        {previewModal.data.headers.map((h, idx) => (
                          <th
                            key={`${h}-${idx}`}
                            className="border-r border-white/20 px-3 py-2 text-[11px] font-semibold whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {previewModal.data.rows.slice(0, 20).map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-[#F4F8FD]">
                          <td className="border-r border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-[10px] text-slate-500">
                            {rIdx + 1}
                          </td>
                          {previewModal.data.headers.map((_, cIdx) => (
                            <td
                              key={cIdx}
                              className="border-r border-slate-100 px-3 py-1.5 whitespace-nowrap text-slate-800 max-w-[240px] truncate"
                              title={row[cIdx] ?? ''}
                            >
                              {row[cIdx] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeleteFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl border-2 border-white bg-white p-5 shadow-2xl">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Delete workbook from vault?
            </h3>
            <p className="mt-1.5 text-xs text-slate-600">
              Permanently remove <span className="font-semibold">{confirmDeleteFile.fileName}</span> ({formatFileSize(confirmDeleteFile.sizeBytes)}) from {client.companyName}?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteFile(null)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingId === confirmDeleteFile.id}
                onClick={() => handleDeleteFile(confirmDeleteFile)}
                className="rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 cursor-pointer disabled:opacity-50"
              >
                {deletingId === confirmDeleteFile.id ? 'Deleting...' : 'Delete File'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
