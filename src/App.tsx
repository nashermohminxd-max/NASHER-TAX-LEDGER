import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ClipboardCopy,
  Download,
  FileSpreadsheet,
  FolderPlus,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  WifiOff,
} from 'lucide-react';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { ClientDirectoryModal } from './components/ClientDirectoryModal';
import { EntryComposer } from './components/EntryComposer';
import { LedgerTable } from './components/LedgerTable';
import { PWAInstallButton } from './components/PWAInstallButton';
import { TinDirectoryView } from './components/TinDirectoryView';
import {
  SEED_PURCHASES_ROWS,
  SEED_SALES_ROWS,
  SEED_TIN_DIRECTORY,
  upgradePurchasesRows,
  upgradeSalesRows,
  upgradeTinRecords,
} from './data/seedData';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import type {
  ClientProfile,
  ClientWorkspaceBackup,
  LedgerMode,
  LedgerRow,
  TinRecord,
} from './types/tax';
import {
  DEFAULT_ACCOUNT_TITLES,
  REGISTRY_KEYS,
  deleteClientWorkspaceStorage,
  getClientStorageKeys,
  initializeClientRegistry,
  loadClientWorkspace,
  makeUniqueClientSlug,
  safeLoadJson,
  safeSaveJson,
  seedEmptyClientWorkspace,
  syncClientSlugToUrl,
} from './utils/clientStorage';
import {
  exportFilingCsv,
  importFilingCsv,
  triggerFileDownload,
} from './utils/csvCodec';
import {
  computeLedgerTotals,
  formatAccounting,
  getRowExpectedActual,
  nextCategoryCycle,
  recalculateExistingRow,
} from './utils/taxEngine';
import {
  buildFilingXlsxBlob,
  copyFilingTableForGoogleSheets,
  downloadXlsxBlob,
} from './utils/xlsxExport';

type ActiveView = 'LEDGER' | 'TIN_DIRECTORY' | 'ANALYTICS';

export default function App() {
  const isOnline = useOnlineStatus();

  const initialRegistry = useMemo(() => initializeClientRegistry(), []);
  const initialWorkspace = useMemo(
    () => loadClientWorkspace(initialRegistry.activeClientId),
    [initialRegistry.activeClientId]
  );

  const [clients, setClients] = useState<ClientProfile[]>(initialRegistry.clients);
  const [activeClientId, setActiveClientId] = useState<string>(initialRegistry.activeClientId);

  const activeClient = useMemo(
    () => clients.find((c) => c.id === activeClientId) ?? clients[0],
    [clients, activeClientId]
  );

  const [activeView, setActiveView] = useState<ActiveView>('LEDGER');
  const [mode, setMode] = useState<LedgerMode>('SALES');
  const [autoCalcEnabled, setAutoCalcEnabled] = useState<boolean>(() =>
    safeLoadJson<boolean>(REGISTRY_KEYS.AUTOCALC, true)
  );

  const [salesRows, setSalesRows] = useState<LedgerRow[]>(initialWorkspace.salesRows);
  const [purchasesRows, setPurchasesRows] = useState<LedgerRow[]>(initialWorkspace.purchasesRows);
  const [tinDirectory, setTinDirectory] = useState<TinRecord[]>(initialWorkspace.tinDirectory);
  const [accountTitles, setAccountTitles] = useState<string[]>(initialWorkspace.accountTitles);

  const [showComposer, setShowComposer] = useState<boolean>(true);
  const [editingRow, setEditingRow] = useState<LedgerRow | null>(null);
  const [needsReviewOnly, setNeedsReviewOnly] = useState<boolean>(false);
  const [confirmClearModal, setConfirmClearModal] = useState<'CLEAR_LEDGER' | 'RESET_SAMPLE' | null>(null);
  const [showClientModal, setShowClientModal] = useState<boolean>(false);
  const [showClientMenu, setShowClientMenu] = useState<boolean>(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const csvInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const clientMenuRef = useRef<HTMLDivElement>(null);

  // Close quick client switcher dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (clientMenuRef.current && !clientMenuRef.current.contains(e.target as Node)) {
        setShowClientMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Persist client registry & active client + sync URL slug
  useEffect(() => {
    safeSaveJson(REGISTRY_KEYS.CLIENTS, clients);
  }, [clients]);

  useEffect(() => {
    safeSaveJson(REGISTRY_KEYS.ACTIVE_CLIENT, activeClientId);
    if (activeClient?.slug) {
      syncClientSlugToUrl(activeClient.slug);
    }
  }, [activeClientId, activeClient?.slug]);

  // Persist active client's segregated directory data
  useEffect(() => {
    const keys = getClientStorageKeys(activeClientId);
    safeSaveJson(keys.SALES, salesRows);
  }, [activeClientId, salesRows]);

  useEffect(() => {
    const keys = getClientStorageKeys(activeClientId);
    safeSaveJson(keys.PURCHASES, purchasesRows);
  }, [activeClientId, purchasesRows]);

  useEffect(() => {
    const keys = getClientStorageKeys(activeClientId);
    safeSaveJson(keys.TINS, tinDirectory);
  }, [activeClientId, tinDirectory]);

  useEffect(() => {
    const keys = getClientStorageKeys(activeClientId);
    safeSaveJson(keys.ACCOUNT_TITLES, accountTitles);
  }, [activeClientId, accountTitles]);

  useEffect(() => {
    safeSaveJson(REGISTRY_KEYS.AUTOCALC, autoCalcEnabled);
  }, [autoCalcEnabled]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3200);
  };

  const switchClientDirectory = (targetClientId: string) => {
    if (targetClientId === activeClientId) return;
    const target = clients.find((c) => c.id === targetClientId);
    if (!target) return;
    const nextWs = loadClientWorkspace(targetClientId);
    setActiveClientId(targetClientId);
    setSalesRows(nextWs.salesRows);
    setPurchasesRows(nextWs.purchasesRows);
    setTinDirectory(nextWs.tinDirectory);
    setAccountTitles(nextWs.accountTitles);
    setEditingRow(null);
    setNeedsReviewOnly(false);
    setShowClientMenu(false);
    showToast(`Switched to ${target.name} directory.`);
  };

  const handleCreateClient = (params: {
    name: string;
    tin: string;
    rdo: string;
    includeSampleRows: boolean;
  }) => {
    const now = new Date().toISOString();
    const id = `client-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const slug = makeUniqueClientSlug(params.name, clients);
    const created: ClientProfile = {
      id,
      slug,
      name: params.name,
      tin: params.tin,
      rdo: params.rdo,
      createdAt: now,
      updatedAt: now,
    };
    seedEmptyClientWorkspace(id, { includeSampleRows: params.includeSampleRows });
    setClients((prev) => [...prev, created]);
    const ws = loadClientWorkspace(id);
    setActiveClientId(id);
    setSalesRows(ws.salesRows);
    setPurchasesRows(ws.purchasesRows);
    setTinDirectory(ws.tinDirectory);
    setAccountTitles(ws.accountTitles);
    setEditingRow(null);
    setNeedsReviewOnly(false);
    setShowClientModal(false);
    showToast(`Created segregated directory for ${created.name}.`);
  };

  const handleUpdateClient = (updated: ClientProfile) => {
    const uniqueSlug = makeUniqueClientSlug(updated.name, clients, updated.id);
    const nextClient: ClientProfile = { ...updated, slug: uniqueSlug };
    setClients((prev) => prev.map((c) => (c.id === updated.id ? nextClient : c)));
    showToast(`Updated ${nextClient.name}.`);
  };

  const handleDeleteClient = (clientId: string) => {
    if (clients.length <= 1) return;
    const target = clients.find((c) => c.id === clientId);
    const remaining = clients.filter((c) => c.id !== clientId);
    setClients(remaining);
    deleteClientWorkspaceStorage(clientId);
    if (clientId === activeClientId && remaining[0]) {
      const nextWs = loadClientWorkspace(remaining[0].id);
      setActiveClientId(remaining[0].id);
      setSalesRows(nextWs.salesRows);
      setPurchasesRows(nextWs.purchasesRows);
      setTinDirectory(nextWs.tinDirectory);
      setAccountTitles(nextWs.accountTitles);
      setEditingRow(null);
    }
    showToast(`Deleted client directory ${target?.name ?? ''}.`);
  };

  const handleImportClientBackup = (backup: ClientWorkspaceBackup) => {
    const now = new Date().toISOString();
    const id = `client-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const name = (backup.client.name || 'IMPORTED CLIENT').trim().toUpperCase();
    const slug = makeUniqueClientSlug(name, clients);
    const created: ClientProfile = {
      id,
      slug,
      name,
      tin: backup.client.tin || '',
      rdo: backup.client.rdo || '',
      createdAt: now,
      updatedAt: now,
    };
    const keys = getClientStorageKeys(id);
    safeSaveJson(keys.SALES, upgradeSalesRows(backup.salesRows ?? []));
    safeSaveJson(keys.PURCHASES, upgradePurchasesRows(backup.purchasesRows ?? []));
    safeSaveJson(keys.TINS, upgradeTinRecords(backup.tinDirectory ?? []));
    safeSaveJson(
      keys.ACCOUNT_TITLES,
      Array.isArray(backup.accountTitles) && backup.accountTitles.length > 0
        ? backup.accountTitles
        : DEFAULT_ACCOUNT_TITLES
    );
    setClients((prev) => [...prev, created]);
    const ws = loadClientWorkspace(id);
    setActiveClientId(id);
    setSalesRows(ws.salesRows);
    setPurchasesRows(ws.purchasesRows);
    setTinDirectory(ws.tinDirectory);
    setAccountTitles(ws.accountTitles);
    setEditingRow(null);
    setShowClientModal(false);
    showToast(`Imported client directory ${created.name}.`);
  };

  const currentRows = mode === 'SALES' ? salesRows : purchasesRows;
  const setCurrentRows = mode === 'SALES' ? setSalesRows : setPurchasesRows;

  const currentTotals = useMemo(() => computeLedgerTotals(currentRows, mode), [currentRows, mode]);

  const upsertTinRecord = (record: TinRecord) => {
    setTinDirectory((prev) => {
      const idx = prev.findIndex(
        (t) => t.id === record.id || (record.digits && t.digits === record.digits)
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...record, updatedAt: new Date().toISOString() };
        return next;
      }
      return [record, ...prev];
    });
  };

  const bulkMergeTins = (incoming: TinRecord[]) => {
    if (incoming.length === 0) return;
    setTinDirectory((prev) => {
      const byDigits = new Map<string, TinRecord>();
      prev.forEach((t) => {
        if (t.digits) byDigits.set(t.digits, t);
      });
      incoming.forEach((t) => {
        if (!t.digits) return;
        const existing = byDigits.get(t.digits);
        if (existing) {
          byDigits.set(t.digits, {
            ...existing,
            payor: t.payor || existing.payor,
            branchTradeName: t.branchTradeName || existing.branchTradeName,
            address: t.address || existing.address,
            address2: t.address2 || existing.address2,
            updatedAt: new Date().toISOString(),
          });
        } else {
          byDigits.set(t.digits, t);
        }
      });
      return Array.from(byDigits.values());
    });
  };

  const handleSaveRows = (
    newRows: LedgerRow[],
    tinToUpsert?: TinRecord | null,
    replaceRowId?: string
  ) => {
    if (replaceRowId) {
      setCurrentRows((prev) =>
        prev.map((r) => (r.id === replaceRowId ? newRows[0] : r))
      );
      showToast('Updated transaction row.');
    } else {
      setCurrentRows((prev) => [...newRows, ...prev]);
      showToast(
        newRows.length > 1
          ? `Added ${newRows.length} split rows to ${mode} ledger.`
          : `Added transaction to ${mode} ledger.`
      );
    }

    if (tinToUpsert) {
      upsertTinRecord(tinToUpsert);
    }
  };

  const handleDuplicateNextCategory = (row: LedgerRow) => {
    const nextCat = nextCategoryCycle(row.category, mode);
    const now = new Date().toISOString();
    const duplicated: LedgerRow = {
      ...row,
      id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      category: nextCat,
      nonVatExempt: null,
      grossOfVat: null,
      netOfVat: null,
      vat: null,
      total: null,
      wtGoods1: null,
      wtServices2: null,
      wtRental5: null,
      wtVat5: null,
      actual: null,
      remarks: row.remarks,
      createdAt: now,
      updatedAt: now,
    };

    // Insert directly after the source row and open it in composer for fast keyboard entry
    setCurrentRows((prev) => {
      const idx = prev.findIndex((r) => r.id === row.id);
      if (idx < 0) return [duplicated, ...prev];
      const next = [...prev];
      next.splice(idx + 1, 0, duplicated);
      return next;
    });
    setEditingRow(duplicated);
    setShowComposer(true);
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    showToast(`Duplicated row as ${nextCat} — enter amount to complete.`);
  };

  const handleDeleteRow = (id: string) => {
    setCurrentRows((prev) => prev.filter((r) => r.id !== id));
    if (editingRow?.id === id) setEditingRow(null);
    showToast('Removed transaction row.');
  };

  const handleFixMathRow = (row: LedgerRow) => {
    const fixed = recalculateExistingRow(row, mode);
    setCurrentRows((prev) => prev.map((r) => (r.id === row.id ? fixed : r)));
    showToast('Recalculated VAT & Withholding Taxes using BIR rules.');
  };

  const handleComputeActualRow = (row: LedgerRow) => {
    const expected = getRowExpectedActual(row, mode);
    if (expected === null) return;
    setCurrentRows((prev) =>
      prev.map((r) =>
        r.id === row.id ? { ...r, actual: expected, updatedAt: new Date().toISOString() } : r
      )
    );
    showToast(`Set ACTUAL to ₱${formatAccounting(expected)}.`);
  };

  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = importFilingCsv(text, mode);
      if (result.rows.length === 0) {
        showToast('No transaction rows detected in CSV file.', 'error');
        e.target.value = '';
        return;
      }

      const targetMode = result.detectedMode ?? mode;
      if (targetMode === 'SALES') {
        setSalesRows((prev) => [...result.rows, ...prev]);
      } else {
        setPurchasesRows((prev) => [...result.rows, ...prev]);
      }
      setMode(targetMode);
      bulkMergeTins(result.extractedTins);
      setActiveView('LEDGER');
      showToast(
        `Imported ${result.rows.length} ${targetMode} rows and indexed ${result.extractedTins.length} TINs.`
      );
    } catch {
      showToast('Unable to parse CSV file.', 'error');
    }
    e.target.value = '';
  };

  const handleExportCsv = () => {
    const csv = exportFilingCsv(mode, currentRows);
    const stamp = new Date().toISOString().slice(0, 10);
    const prefix = activeClient?.slug ? `${activeClient.slug}_` : '';
    triggerFileDownload(`${prefix}FORMAT_FOR_FILING_${mode}_${stamp}.csv`, csv);
    showToast(`Exported ${currentRows.length} ${mode} rows for ${activeClient?.name ?? 'client'}.`);
  };

  const handleExportXlsx = () => {
    const blob = buildFilingXlsxBlob(mode, currentRows);
    const stamp = new Date().toISOString().slice(0, 10);
    const prefix = activeClient?.slug ? `${activeClient.slug}_` : '';
    downloadXlsxBlob(`${prefix}FORMAT_FOR_FILING_${mode}_${stamp}.xlsx`, blob);
    showToast(`Exported ${currentRows.length} ${mode} rows for Google Sheets (.xlsx).`);
  };

  const handleCopyForSheets = async () => {
    try {
      await copyFilingTableForGoogleSheets(mode, currentRows);
      showToast(`Copied ${mode} table — paste (Ctrl+V) directly into Google Sheets.`);
    } catch {
      showToast('Clipboard copy failed. Use Export .xlsx instead.', 'error');
    }
  };

  const handleMergeTinDuplicates = (digitsKey: string) => {
    setTinDirectory((prev) => {
      const matches = prev.filter((t) => t.digits === digitsKey);
      if (matches.length <= 1) return prev;
      const merged: TinRecord = matches.reduce((acc, cur) => ({
        ...acc,
        payor: cur.payor || acc.payor,
        branchTradeName: cur.branchTradeName || acc.branchTradeName,
        address: cur.address || acc.address,
        address2: cur.address2 || acc.address2,
        updatedAt: new Date().toISOString(),
      }));
      return [merged, ...prev.filter((t) => t.digits !== digitsKey)];
    });
    showToast('Merged duplicate TIN profiles.');
  };

  const handleConfirmModalAction = () => {
    if (confirmClearModal === 'CLEAR_LEDGER') {
      setCurrentRows([]);
      setEditingRow(null);
      showToast(`Cleared all ${mode} ledger rows.`);
    } else if (confirmClearModal === 'RESET_SAMPLE') {
      setSalesRows(SEED_SALES_ROWS);
      setPurchasesRows(SEED_PURCHASES_ROWS);
      setTinDirectory(SEED_TIN_DIRECTORY);
      setEditingRow(null);
      showToast('Restored Philippine sample Sales, Purchases, and TIN data.');
    }
    setConfirmClearModal(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar Contract: 3 zones (Brand — Nav Links — Primary Action) */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-4 py-3 sm:px-6">
          {/* Zone 1: Single-line Brand Title */}
          <a
            href="#ledger"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('LEDGER');
            }}
            className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            NASHER TAX LEDGER
          </a>

          {/* Zone 2: Clean Text Navigation Links */}
          <nav className="flex items-center gap-6 overflow-x-auto text-sm font-medium">
            <button
              type="button"
              onClick={() => setActiveView('LEDGER')}
              className={`border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeView === 'LEDGER'
                  ? 'border-blue-700 text-slate-900 font-semibold'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Ledger
            </button>
            <button
              type="button"
              onClick={() => setActiveView('TIN_DIRECTORY')}
              className={`border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeView === 'TIN_DIRECTORY'
                  ? 'border-blue-700 text-slate-900 font-semibold'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              TIN Directory ({tinDirectory.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveView('ANALYTICS')}
              className={`border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeView === 'ANALYTICS'
                  ? 'border-blue-700 text-slate-900 font-semibold'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Analytics
            </button>
          </nav>

          {/* Zone 3: Primary Action */}
          <div className="flex items-center gap-2.5 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              onClick={handleExportXlsx}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              title="Download formatted .xlsx ready for Google Sheets with merged headers and highlights"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Export Google Sheets (.xlsx)
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 sm:px-6 space-y-5">
        {/* Workspace Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Client Segregated Directory Switcher */}
            <div className="relative" ref={clientMenuRef}>
              <button
                type="button"
                onClick={() => setShowClientMenu((v) => !v)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 cursor-pointer"
                title="Switch or manage segregated client directories"
              >
                <Building2 className="h-3.5 w-3.5 text-blue-700 shrink-0" />
                <span className="max-w-[190px] truncate">{activeClient?.name ?? 'MAIN CLIENT'}</span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-500 shrink-0" />
              </button>

              {showClientMenu && (
                <div className="absolute left-0 z-40 mt-1.5 w-72 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
                  <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Client Directories ({clients.length})
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                    {clients.map((c) => {
                      const isCurrent = c.id === activeClientId;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => switchClientDirectory(c.id)}
                          className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-slate-50 cursor-pointer ${
                            isCurrent ? 'bg-blue-50/70 font-semibold text-blue-800' : 'text-slate-800'
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <div className="truncate">{c.name}</div>
                            {(c.tin || c.rdo) && (
                              <div className="text-[10px] text-slate-500 truncate tabular-nums-mono">
                                {[c.tin, c.rdo].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </div>
                          {isCurrent && (
                            <span className="text-[10px] font-semibold text-blue-700 shrink-0">
                              Active
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="border-t border-slate-200 bg-slate-50 p-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowClientMenu(false);
                        setShowClientModal(true);
                      }}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                    >
                      <FolderPlus className="h-3.5 w-3.5" />
                      Manage / New Client Directory
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* SALES / PURCHASES Mode Toggle */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('SALES');
                  setEditingRow(null);
                  setNeedsReviewOnly(false);
                }}
                className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  mode === 'SALES'
                    ? 'bg-blue-700 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                SALES ({salesRows.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('PURCHASES');
                  setEditingRow(null);
                  setNeedsReviewOnly(false);
                }}
                className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  mode === 'PURCHASES'
                    ? 'bg-blue-700 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                PURCHASES ({purchasesRows.length})
              </button>
            </div>

            <span className="hidden xl:inline text-xs text-slate-500">
              Isolated Client Storage · BIR RELIEF TIN Recall
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv"
              onChange={handleCsvImport}
              className="hidden"
            />
            {activeView === 'LEDGER' && (
              <button
                type="button"
                onClick={() => {
                  setEditingRow(null);
                  setShowComposer((v) => !v);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                {showComposer ? 'Hide Encoder' : 'Encode Entry'}
              </button>
            )}
            <button
              type="button"
              onClick={handleCopyForSheets}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
              title="Copy formatted table with headers and highlights to paste into Google Sheets"
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
              Copy for Sheets
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => csvInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5" />
              Import CSV
            </button>
            <button
              type="button"
              onClick={() => setConfirmClearModal('RESET_SAMPLE')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
              title="Restore sample Philippine data"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset Sample
            </button>
            {activeView === 'LEDGER' && currentRows.length > 0 && (
              <button
                type="button"
                onClick={() => setConfirmClearModal('CLEAR_LEDGER')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear {mode}
              </button>
            )}
          </div>
        </div>

        {/* Active View Content */}
        {activeView === 'LEDGER' && (
          <div className="space-y-5">
            {/* Summary Totals Strip */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-[11px] font-medium text-slate-500">NON-VAT / EXEMPT</div>
                <div className="mt-0.5 tabular-nums-mono text-base font-bold text-slate-900">
                  {formatAccounting(currentTotals.nonVatExempt)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-[11px] font-medium text-slate-500">GROSS OF VAT</div>
                <div className="mt-0.5 tabular-nums-mono text-base font-bold text-slate-900">
                  {formatAccounting(currentTotals.grossOfVat)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-[11px] font-medium text-slate-500">
                  {mode === 'SALES' ? 'OUTPUT VAT' : 'INPUT VAT'}
                </div>
                <div className="mt-0.5 tabular-nums-mono text-base font-bold text-slate-900">
                  {formatAccounting(currentTotals.vat)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-[11px] font-medium text-slate-500">TOTAL WITHHOLDING</div>
                <div className="mt-0.5 tabular-nums-mono text-base font-bold text-slate-900">
                  {formatAccounting(currentTotals.totalWithholding)}
                </div>
              </div>
              {mode === 'SALES' ? (
                <>
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-[11px] font-medium text-slate-500">ACTUAL COLLECTED</div>
                    <div className="mt-0.5 tabular-nums-mono text-base font-bold text-slate-900">
                      {formatAccounting(currentTotals.actual)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-[11px] font-medium text-slate-500">VARIANCE (EXP vs ACT)</div>
                    <div
                      className={`mt-0.5 tabular-nums-mono text-base font-bold ${
                        Math.abs(currentTotals.variance) > 0.01
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      {formatAccounting(currentTotals.variance)}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-[11px] font-medium text-slate-500">TOTAL PURCHASES</div>
                    <div className="mt-0.5 tabular-nums-mono text-base font-bold text-slate-900">
                      {formatAccounting(currentTotals.total)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-[11px] font-medium text-slate-500">NET PAYABLE (TOTAL - EWT)</div>
                    <div className="mt-0.5 tabular-nums-mono text-base font-bold text-emerald-700">
                      {formatAccounting(currentTotals.expectedNet)}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Encoding Workspace */}
            {showComposer && (
              <div ref={composerRef}>
                <EntryComposer
                  clientKey={activeClientId}
                  mode={mode}
                  tinDirectory={tinDirectory}
                  existingRows={[...salesRows, ...purchasesRows]}
                  accountTitles={accountTitles}
                  onUpdateAccountTitles={setAccountTitles}
                  autoCalcEnabled={autoCalcEnabled}
                  onToggleAutoCalc={setAutoCalcEnabled}
                  editingRow={editingRow}
                  onCancelEdit={() => setEditingRow(null)}
                  onSaveRows={handleSaveRows}
                  onUpdateTinProfile={(rec) => {
                    upsertTinRecord(rec);
                    showToast(`Updated Master TIN profile for ${rec.payor}.`);
                  }}
                />
              </div>
            )}

            {/* Ledger Table */}
            <LedgerTable
              mode={mode}
              rows={currentRows}
              onEditRow={(row) => {
                setEditingRow(row);
                setShowComposer(true);
                composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }}
              onDuplicateNextCategory={handleDuplicateNextCategory}
              onDeleteRow={handleDeleteRow}
              onFixMathRow={handleFixMathRow}
              onComputeActualRow={handleComputeActualRow}
              onStartNewEntry={() => {
                setEditingRow(null);
                setShowComposer(true);
                composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }}
              onImportCsvClick={() => csvInputRef.current?.click()}
              needsReviewOnly={needsReviewOnly}
              onToggleNeedsReviewOnly={setNeedsReviewOnly}
            />
          </div>
        )}

        {activeView === 'TIN_DIRECTORY' && (
          <TinDirectoryView
            clientName={activeClient?.name ?? 'MAIN CLIENT'}
            clientSlug={activeClient?.slug ?? 'main-client'}
            records={tinDirectory}
            onUpsertRecord={(rec) => {
              upsertTinRecord(rec);
              showToast(`Saved ${rec.tin} to ${activeClient?.name ?? 'client'} TIN Directory.`);
            }}
            onDeleteRecord={(id) => {
              setTinDirectory((prev) => prev.filter((r) => r.id !== id));
              showToast('Removed TIN profile.');
            }}
            onBulkImport={(recs) => {
              bulkMergeTins(recs);
              showToast(`Imported ${recs.length} TIN profiles.`);
            }}
            onMergeDuplicates={handleMergeTinDuplicates}
          />
        )}

        {activeView === 'ANALYTICS' && (
          <AnalyticsDashboard
            activeMode={mode}
            salesRows={salesRows}
            purchasesRows={purchasesRows}
            onInspectFlaggedRows={(targetMode) => {
              setMode(targetMode);
              setNeedsReviewOnly(true);
              setActiveView('LEDGER');
            }}
          />
        )}
      </main>

      {/* Segregated Client Directory Manager Modal */}
      <ClientDirectoryModal
        isOpen={showClientModal}
        clients={clients}
        activeClientId={activeClientId}
        onClose={() => setShowClientModal(false)}
        onSelectClient={switchClientDirectory}
        onCreateClient={handleCreateClient}
        onUpdateClient={handleUpdateClient}
        onDeleteClient={handleDeleteClient}
        onImportClientBackup={handleImportClientBackup}
      />

      {/* Confirmation Dialog (Replaces native window.confirm for iframe safety) */}
      {confirmClearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="font-display text-base font-semibold text-slate-900">
              {confirmClearModal === 'CLEAR_LEDGER'
                ? `Clear all ${mode} rows?`
                : 'Restore sample data?'}
            </h3>
            <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
              {confirmClearModal === 'CLEAR_LEDGER'
                ? `This removes all ${currentRows.length} entries from the ${mode} ledger. Your TIN Master Directory will remain intact.`
                : 'This restores the pre-seeded Philippine Sales, Purchases, and TIN Master Directory sample rows.'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmClearModal(null)}
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmModalAction}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer ${
                  confirmClearModal === 'CLEAR_LEDGER'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-blue-700 hover:bg-blue-800'
                }`}
              >
                {confirmClearModal === 'CLEAR_LEDGER' ? 'Clear Rows' : 'Restore Sample'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Offline Banner (shown only when actually offline) */}
      {!isOnline && (
        <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-medium text-white shadow-lg">
          <WifiOff className="h-3.5 w-3.5" />
          Offline Mode — All changes saved locally on this device
        </div>
      )}

      {/* Transient Feedback Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-medium text-white shadow-lg ${
            toast.type === 'error' ? 'bg-red-700' : 'bg-slate-900'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertCircle className="h-4 w-4 text-red-200" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
