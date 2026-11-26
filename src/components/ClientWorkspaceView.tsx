import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  BookOpen,
  Building2,
  CheckCircle2,
  FileSpreadsheet,
  KeyRound,
  LogOut,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { AnalyticsDashboard } from '@/components/AnalyticsDashboard';
import { ChangePasswordModal } from '@/components/ChangePasswordModal';
import { EntryComposer } from '@/components/EntryComposer';
import { ExportMonthModal, type ExportFormat } from '@/components/ExportMonthModal';
import { LedgerTable } from '@/components/LedgerTable';
import { MonthCoverBar } from '@/components/MonthCoverBar';
import { PWAInstallButton } from '@/components/PWAInstallButton';
import { useAuth } from '@/lib/authContext';
import {
  clearLedgerRowsPeriodRemote,
  deleteLedgerRowRemote,
  listVaultFiles,
  loadClientLedgerBundle,
  saveClientLedgerRows,
  syncLedgerPeriodToAdminVault,
  updateLedgerAuditStatus,
  upsertSingleLedgerRows,
} from '@/lib/portalStore';
import type { ClientDirectory } from '@/types/portal';
import type {
  AuditStatus,
  LedgerEntryKind,
  LedgerMode,
  LedgerRow,
} from '@/types/tax';
import { getClientStorageKeys, safeLoadJson, safeSaveJson } from '@/utils/clientStorage';
import { exportFilingCsv, importFilingCsv, triggerFileDownload } from '@/utils/csvCodec';
import {
  FILING_MONTHS,
  collectAvailableYears,
  computeLedgerTotals,
  formatAccounting,
  getLatestPeriodFromRows,
  getRowExpectedActual,
  getRowFilingMonth,
  getRowFilingYear,
  nextCategoryCycle,
  recalculateExistingRow,
  round2,
  rowMatchesPeriod,
} from '@/utils/taxEngine';
import {
  buildFilingXlsxBlob,
  copyFilingTableForGoogleSheets,
  downloadXlsxBlob,
} from '@/utils/xlsxExport';

type WorkspaceSection = 'LEDGER' | 'ANALYTICS';

interface ClientWorkspaceViewProps {
  client: ClientDirectory;
  isAdminMode?: boolean;
  onBackToAdmin?: () => void;
}

export const ClientWorkspaceView: React.FC<ClientWorkspaceViewProps> = ({
  client,
  isAdminMode = false,
  onBackToAdmin,
}) => {
  const { user, signOut, isSupabaseMode } = useAuth();

  const [section, setSection] = useState<WorkspaceSection>('LEDGER');
  const [ledgerTab, setLedgerTab] = useState<LedgerEntryKind>('SALES');
  const [loading, setLoading] = useState(true);

  const [salesRows, setSalesRows] = useState<LedgerRow[]>([]);
  const [expenseRows, setExpenseRows] = useState<LedgerRow[]>([]);
  const [accountTitles, setAccountTitles] = useState<string[]>([]);
  const [monthCover, setMonthCover] = useState<string>('JANUARY');
  const [yearCover, setYearCover] = useState<string>('2026');
  const [customYears, setCustomYears] = useState<string[]>([]);
  const [autoCalcEnabled, setAutoCalcEnabled] = useState<boolean>(true);

  const [showComposer, setShowComposer] = useState<boolean>(true);
  const [editingRow, setEditingRow] = useState<LedgerRow | null>(null);
  const [needsReviewOnly, setNeedsReviewOnly] = useState<boolean>(false);
  const [exportModalFormat, setExportModalFormat] = useState<ExportFormat | null>(null);
  const [confirmAction, setConfirmAction] = useState<'CLEAR_LEDGER' | null>(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const csvInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const salesRowsRef = useRef<LedgerRow[]>([]);
  const expenseRowsRef = useRef<LedgerRow[]>([]);
  const monthCoverRef = useRef<string>(monthCover);
  const yearCoverRef = useRef<string>(yearCover);
  const vaultSyncChainRef = useRef<Promise<void>>(Promise.resolve());

  monthCoverRef.current = monthCover;
  yearCoverRef.current = yearCover;

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3400);
  }, []);

  const resolveRowPeriod = useCallback(
    (
      row: Pick<LedgerRow, 'month' | 'date'>,
      fallbackMonthOverride?: string,
      fallbackYearOverride?: string
    ): { month: string; year: string } => {
      const activeYear = fallbackYearOverride ?? yearCoverRef.current;
      const activeMonth = fallbackMonthOverride ?? monthCoverRef.current;
      const fallbackYear =
        activeYear && activeYear !== 'ALL' ? activeYear : String(new Date().getFullYear());
      const fallbackMonth =
        activeMonth && activeMonth !== 'ALL'
          ? activeMonth
          : FILING_MONTHS[new Date().getMonth()];
      const month = getRowFilingMonth(row) || fallbackMonth;
      const year = getRowFilingYear(row) || fallbackYear;
      return { month, year };
    },
    []
  );

  const syncPeriodsToAdminVault = useCallback(
    (
      targetKind: LedgerEntryKind,
      nextAllRowsForKind: LedgerRow[],
      touchedRows: LedgerRow[],
      fallbackMonthOverride?: string,
      fallbackYearOverride?: string
    ): Promise<void> => {
      const periodMap = new Map<string, { month: string; year: string }>();
      touchedRows.forEach((row) => {
        const p = resolveRowPeriod(row, fallbackMonthOverride, fallbackYearOverride);
        periodMap.set(`${p.month}::${p.year}`, p);
      });
      if (periodMap.size === 0) return Promise.resolve();

      const periods = Array.from(periodMap.values());
      const task = vaultSyncChainRef.current
        .catch(() => undefined)
        .then(async () => {
          for (const { month, year } of periods) {
            const rowsForPeriod = nextAllRowsForKind.filter((r) => {
              const p = resolveRowPeriod(r, fallbackMonthOverride, fallbackYearOverride);
              return p.month === month && p.year === year;
            });
            await syncLedgerPeriodToAdminVault({
              client,
              entryKind: targetKind,
              month,
              year,
              rowsForPeriod,
              userId: user?.id,
              userEmail: user?.email,
            });
          }
        });

      vaultSyncChainRef.current = task;
      return task;
    },
    [client, resolveRowPeriod, user?.id, user?.email]
  );

  const syncPeriodsRef = useRef(syncPeriodsToAdminVault);
  syncPeriodsRef.current = syncPeriodsToAdminVault;

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadClientLedgerBundle(client.id)
      .then((bundle) => {
        if (!active) return;
        salesRowsRef.current = bundle.salesRows;
        expenseRowsRef.current = bundle.expenseRows;
        monthCoverRef.current = bundle.monthCover;
        yearCoverRef.current = bundle.yearCover;
        setSalesRows(bundle.salesRows);
        setExpenseRows(bundle.expenseRows);
        setAccountTitles(bundle.accountTitles);
        setMonthCover(bundle.monthCover);
        setYearCover(bundle.yearCover);
        setCustomYears(safeLoadJson<string[]>(`${client.id}_custom_years_v1`, []));
        setEditingRow(null);
        setNeedsReviewOnly(false);

        // Ensure any previously recorded Sales/Expenses periods missing an auto-saved workbook sync to Admin Storage
        if (bundle.salesRows.length > 0 || bundle.expenseRows.length > 0) {
          void listVaultFiles(client.id)
            .then(async (existingFiles) => {
              if (!active) return;
              const hasAutoFile = (kind: LedgerEntryKind, month: string, year: string) => {
                const scope = kind === 'SALES' ? 'SALES' : 'EXPENSE';
                const taxPeriod = `${month}-${year}`;
                return existingFiles.some(
                  (f) =>
                    f.storagePath.includes('/auto_') &&
                    f.entryScope === scope &&
                    f.taxPeriod === taxPeriod
                );
              };

              const missingSales = bundle.salesRows.filter((r) => {
                const p = resolveRowPeriod(r, bundle.monthCover, bundle.yearCover);
                return !hasAutoFile('SALES', p.month, p.year);
              });
              if (missingSales.length > 0) {
                await syncPeriodsRef.current(
                  'SALES',
                  bundle.salesRows,
                  missingSales,
                  bundle.monthCover,
                  bundle.yearCover
                );
              }

              const missingExpenses = bundle.expenseRows.filter((r) => {
                const p = resolveRowPeriod(r, bundle.monthCover, bundle.yearCover);
                return !hasAutoFile('EXPENSE', p.month, p.year);
              });
              if (missingExpenses.length > 0) {
                await syncPeriodsRef.current(
                  'EXPENSE',
                  bundle.expenseRows,
                  missingExpenses,
                  bundle.monthCover,
                  bundle.yearCover
                );
              }
            })
            .catch(() => {
              // ignore background reconciliation errors
            });
        }
      })
      .catch((err) => {
        if (active) showToast(err instanceof Error ? err.message : 'Failed loading workspace.', 'error');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [client.id, resolveRowPeriod, showToast]);

  useEffect(() => {
    if (loading) return;
    const keys = getClientStorageKeys(client.id);
    safeSaveJson(keys.MONTH_COVER, monthCover);
  }, [client.id, monthCover, loading]);

  useEffect(() => {
    if (loading) return;
    const keys = getClientStorageKeys(client.id);
    safeSaveJson(keys.YEAR_COVER, yearCover);
  }, [client.id, yearCover, loading]);

  useEffect(() => {
    if (loading) return;
    const keys = getClientStorageKeys(client.id);
    safeSaveJson(keys.ACCOUNT_TITLES, accountTitles);
  }, [client.id, accountTitles, loading]);

  useEffect(() => {
    if (loading) return;
    safeSaveJson(`${client.id}_custom_years_v1`, customYears);
  }, [client.id, customYears, loading]);

  const taxMode: LedgerMode = ledgerTab === 'SALES' ? 'SALES' : 'PURCHASES';

  const allModeRows = useMemo(() => {
    if (ledgerTab === 'SALES') return salesRows;
    return expenseRows;
  }, [ledgerTab, salesRows, expenseRows]);

  const applyModeRowsUpdate = useCallback(
    (targetKind: LedgerEntryKind, updater: (prev: LedgerRow[]) => LedgerRow[]): LedgerRow[] => {
      const prev = targetKind === 'SALES' ? salesRowsRef.current : expenseRowsRef.current;
      const next = updater(prev);
      if (targetKind === 'SALES') {
        salesRowsRef.current = next;
        setSalesRows(next);
      } else {
        expenseRowsRef.current = next;
        setExpenseRows(next);
      }
      if (!isSupabaseMode) {
        void saveClientLedgerRows({ clientId: client.id, entryKind: targetKind, rows: next });
      }
      return next;
    },
    [client.id, isSupabaseMode]
  );

  const setActiveTabRows = useCallback(
    (updater: (prev: LedgerRow[]) => LedgerRow[]) => applyModeRowsUpdate(ledgerTab, updater),
    [applyModeRowsUpdate, ledgerTab]
  );

  const availableYears = useMemo(
    () => collectAvailableYears([...salesRows, ...expenseRows], customYears),
    [salesRows, expenseRows, customYears]
  );

  const handleAddYear = useCallback((year: string) => {
    const clean = year.trim();
    if (!/^\d{4}$/.test(clean)) return;
    setCustomYears((prev) => (prev.includes(clean) ? prev : [...prev, clean]));
  }, []);

  const monthlySalesRows = useMemo(
    () => salesRows.filter((r) => rowMatchesPeriod(r, monthCover, yearCover)),
    [salesRows, monthCover, yearCover]
  );

  const monthlyExpenseRows = useMemo(
    () => expenseRows.filter((r) => rowMatchesPeriod(r, monthCover, yearCover)),
    [expenseRows, monthCover, yearCover]
  );

  const currentRows = useMemo(() => {
    if (ledgerTab === 'SALES') return monthlySalesRows;
    return monthlyExpenseRows;
  }, [ledgerTab, monthlySalesRows, monthlyExpenseRows]);

  const salesSummary = useMemo(() => computeLedgerTotals(monthlySalesRows, 'SALES'), [monthlySalesRows]);
  const expensesSummary = useMemo(
    () => computeLedgerTotals(monthlyExpenseRows, 'PURCHASES'),
    [monthlyExpenseRows]
  );
  const netVatPayable = useMemo(
    () => round2(salesSummary.vat - expensesSummary.vat),
    [salesSummary.vat, expensesSummary.vat]
  );

  const handleSaveRows = async (
    newRows: LedgerRow[],
    replaceRowId?: string
  ) => {
    try {
      const tagged = newRows.map((r) => ({
        ...r,
        entryKind: ledgerTab,
        auditStatus: r.auditStatus ?? 'PENDING',
      }));
      const persisted = await upsertSingleLedgerRows({
        clientId: client.id,
        entryKind: ledgerTab,
        rows: tagged,
        userId: user?.id,
      });

      if (replaceRowId) {
        const previousRow = (
          ledgerTab === 'SALES' ? salesRowsRef.current : expenseRowsRef.current
        ).find((r) => r.id === replaceRowId);
        const nextRows = setActiveTabRows((prev) =>
          prev.map((r) => (r.id === replaceRowId ? persisted[0] : r))
        );
        const touched = previousRow ? [previousRow, persisted[0]] : [persisted[0]];
        await syncPeriodsToAdminVault(ledgerTab, nextRows, touched);
        showToast('Updated entry & auto-saved to Admin Storage.');
      } else {
        const nextRows = setActiveTabRows((prev) => [...persisted, ...prev]);
        const firstSaved = persisted[0];
        const savedMonth = firstSaved ? getRowFilingMonth(firstSaved) : '';
        const savedYear = firstSaved ? getRowFilingYear(firstSaved) : '';
        if (monthCover !== 'ALL' && savedMonth && savedMonth !== monthCover) {
          setMonthCover(savedMonth);
        }
        if (yearCover !== 'ALL' && savedYear && savedYear !== yearCover) {
          setYearCover(savedYear);
        }
        await syncPeriodsToAdminVault(ledgerTab, nextRows, persisted);
        showToast(
          persisted.length > 1
            ? `Saved ${persisted.length} split entries (${ledgerTab === 'EXPENSE' ? 'EXPENSES' : 'SALES'}) & synced to Admin Storage.`
            : `Saved entry (${ledgerTab === 'EXPENSE' ? 'EXPENSES' : 'SALES'}) & synced to Admin Storage.`
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to save entry.', 'error');
    }
  };

  const handleDuplicateNextCategory = async (row: LedgerRow) => {
    const nextCat = nextCategoryCycle(row.category, taxMode);
    const now = new Date().toISOString();
    const duplicated: LedgerRow = {
      ...row,
      id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      entryKind: ledgerTab,
      auditStatus: 'PENDING',
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
      createdAt: now,
      updatedAt: now,
    };
    setActiveTabRows((prev) => {
      const idx = prev.findIndex((r) => r.id === row.id);
      if (idx < 0) return [duplicated, ...prev];
      const next = [...prev];
      next.splice(idx + 1, 0, duplicated);
      return next;
    });
    setEditingRow(duplicated);
    setShowComposer(true);
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    showToast(`Duplicated row as ${nextCat} — enter amount to save.`);
  };

  const handleDeleteRow = async (id: string) => {
    try {
      const targetRow = (
        ledgerTab === 'SALES' ? salesRowsRef.current : expenseRowsRef.current
      ).find((r) => r.id === id);
      await deleteLedgerRowRemote(id);
      const nextRows = setActiveTabRows((prev) => prev.filter((r) => r.id !== id));
      if (editingRow?.id === id) setEditingRow(null);
      if (targetRow) {
        await syncPeriodsToAdminVault(ledgerTab, nextRows, [targetRow]);
      }
      showToast('Deleted entry & updated Admin Storage.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to delete entry.', 'error');
    }
  };

  const handleFixMathRow = async (row: LedgerRow) => {
    try {
      const fixed = recalculateExistingRow(row, taxMode);
      await upsertSingleLedgerRows({
        clientId: client.id,
        entryKind: ledgerTab,
        rows: [fixed],
        userId: user?.id,
      });
      const nextRows = setActiveTabRows((prev) => prev.map((r) => (r.id === row.id ? fixed : r)));
      await syncPeriodsToAdminVault(ledgerTab, nextRows, [fixed]);
      showToast('Recalculated VAT & Withholding Taxes and updated Admin Storage.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to recalculate entry.', 'error');
    }
  };

  const handleComputeActualRow = async (row: LedgerRow) => {
    const expected = getRowExpectedActual(row, taxMode);
    if (expected === null) return;
    try {
      const updated: LedgerRow = { ...row, actual: expected, updatedAt: new Date().toISOString() };
      await upsertSingleLedgerRows({
        clientId: client.id,
        entryKind: ledgerTab,
        rows: [updated],
        userId: user?.id,
      });
      const nextRows = setActiveTabRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
      await syncPeriodsToAdminVault(ledgerTab, nextRows, [updated]);
      showToast(`Set ACTUAL to ₱${formatAccounting(expected)} & updated Admin Storage.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to update ACTUAL amount.', 'error');
    }
  };

  const handleSetAuditStatus = async (rowId: string, status: AuditStatus) => {
    try {
      const targetRow = (
        ledgerTab === 'SALES' ? salesRowsRef.current : expenseRowsRef.current
      ).find((r) => r.id === rowId);
      await updateLedgerAuditStatus(rowId, status);
      const nextRows = setActiveTabRows((prev) =>
        prev.map((r) =>
          r.id === rowId ? { ...r, auditStatus: status, updatedAt: new Date().toISOString() } : r
        )
      );
      if (targetRow) {
        await syncPeriodsToAdminVault(ledgerTab, nextRows, [targetRow]);
      }
      showToast(`Marked entry as ${status}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed updating audit status.', 'error');
    }
  };

  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast('CSV file exceeds the 10 MB size limit.', 'error');
      e.target.value = '';
      return;
    }
    try {
      const text = await file.text();
      const result = importFilingCsv(text, taxMode);
      if (result.rows.length === 0) {
        showToast('No transaction rows detected in CSV file.', 'error');
        e.target.value = '';
        return;
      }

      const targetKind: LedgerEntryKind =
        result.detectedMode === 'SALES' ? 'SALES' : 'EXPENSE';

      const persisted = await upsertSingleLedgerRows({
        clientId: client.id,
        entryKind: targetKind,
        rows: result.rows.map((r) => ({ ...r, entryKind: targetKind })),
        userId: user?.id,
      });

      const nextRows = applyModeRowsUpdate(targetKind, (prev) => [...persisted, ...prev]);

      const latest = getLatestPeriodFromRows(persisted);
      setMonthCover(latest.month);
      setYearCover(latest.year);
      setLedgerTab(targetKind);
      setSection('LEDGER');
      await syncPeriodsToAdminVault(targetKind, nextRows, persisted, latest.month, latest.year);
      showToast(
        `Imported ${persisted.length} ${
          targetKind === 'EXPENSE' ? 'EXPENSES' : 'SALES'
        } rows & saved to Admin Storage.`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to parse CSV file.', 'error');
    }
    e.target.value = '';
  };

  const handleExecuteExport = async (params: {
    format: ExportFormat;
    mode: LedgerMode;
    rows: LedgerRow[];
    periodLabel: string;
    filenameTag: string;
  }) => {
    const prefix = `${client.slug}_`;
    if (params.format === 'CSV') {
      const csv = exportFilingCsv(params.mode, params.rows);
      triggerFileDownload(
        `${prefix}FORMAT_FOR_FILING_${params.mode}_${params.filenameTag}.csv`,
        csv
      );
      showToast(`Exported ${params.rows.length} ${params.mode === 'PURCHASES' ? 'EXPENSES' : 'SALES'} rows (${params.periodLabel}).`);
      return;
    }
    if (params.format === 'XLSX') {
      const blob = buildFilingXlsxBlob(params.mode, params.rows);
      downloadXlsxBlob(
        `${prefix}FORMAT_FOR_FILING_${params.mode}_${params.filenameTag}.xlsx`,
        blob
      );
      showToast(`Exported ${params.rows.length} ${params.mode === 'PURCHASES' ? 'EXPENSES' : 'SALES'} rows (${params.periodLabel}).`);
      return;
    }
    try {
      await copyFilingTableForGoogleSheets(params.mode, params.rows);
      showToast(`Copied ${params.rows.length} rows (${params.periodLabel}) for Google Sheets.`);
    } catch {
      showToast('Clipboard copy failed. Use Export .xlsx instead.', 'error');
    }
  };

  const handleConfirmModalAction = async () => {
    try {
      if (confirmAction === 'CLEAR_LEDGER') {
        const toRemove = allModeRows.filter((r) => rowMatchesPeriod(r, monthCover, yearCover));
        await clearLedgerRowsPeriodRemote(
          client.id,
          ledgerTab,
          toRemove.map((r) => r.id)
        );
        const nextRows = setActiveTabRows((prev) =>
          prev.filter((r) => !rowMatchesPeriod(r, monthCover, yearCover))
        );
        setEditingRow(null);
        await syncPeriodsToAdminVault(ledgerTab, nextRows, toRemove);
        showToast(
          `Cleared ${toRemove.length} ${
            ledgerTab === 'EXPENSE' ? 'EXPENSES' : 'SALES'
          } rows for ${monthCover} & updated Admin Storage.`
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to clear period rows.', 'error');
    } finally {
      setConfirmAction(null);
    }
  };

  const navItems: { id: WorkspaceSection; label: string; icon: React.ReactNode; badge?: string | number }[] = [
    {
      id: 'LEDGER',
      label: 'Ledger Entries',
      icon: <BookOpen className="h-4 w-4" />,
      badge: salesRows.length + expenseRows.length,
    },
    {
      id: 'ANALYTICS',
      label: 'Monthly Analytics',
      icon: <BarChart3 className="h-4 w-4" />,
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#DCEBFB] via-[#EEF5FC] to-[#F8FBFF] text-slate-900 flex flex-col lg:flex-row">
      {/* Minimalist Frosted Sidebar */}
      <aside className="w-full lg:w-64 lg:shrink-0 border-b lg:border-b-0 lg:border-r border-white/90 bg-white/75 backdrop-blur-2xl text-slate-800 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200/70">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/80 bg-white shadow-2xs">
                <img
                  src="/assets/aistudio/_72398019-0A06-4C5A-A7ED-05B462ABEA26__a9cdb4ac.png"
                  alt="NPB CPA"
                  referrerPolicy="no-referrer"
                  className="absolute left-1/2 top-1/2 h-auto w-[113%] max-w-none -translate-x-[51.7%] -translate-y-[53%]"
                />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block font-display text-sm font-extrabold tracking-tight leading-normal text-slate-900 truncate">
                  NPB TAX LEDGER
                </span>
                <span className="block text-[11px] font-medium leading-normal text-[#0B4DA2]">
                  {client.taxClassification === 'VAT' ? 'VAT (12%) · ' : 'Non-VAT · '}
                  {isAdminMode ? 'Audit' : 'Client'}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-3.5 rounded-xl bg-[#F4F8FD]/90 p-3 border border-[#D4E4F7]">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider leading-normal text-[#0B4DA2]">
              <Building2 className="h-3 w-3 shrink-0" />
              <span>{isAdminMode ? 'Admin Audit View' : 'Assigned Directory'}</span>
            </div>
            <div className="mt-1 font-display text-xs font-bold leading-normal text-slate-900 break-words">
              {client.companyName}
            </div>
            <div className="mt-0.5 font-mono text-[11px] leading-normal text-slate-500 break-words">
              TIN: {client.tin || 'Unset'} {client.rdoCode ? `· RDO ${client.rdoCode}` : ''}
            </div>
          </div>

          {isAdminMode && onBackToAdmin && (
            <button
              type="button"
              onClick={onBackToAdmin}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200/90 bg-white/85 px-3 py-2 text-xs font-semibold leading-normal text-slate-700 hover:bg-white hover:text-[#0B4DA2] transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
              <span>Back to Admin Directory</span>
            </button>
          )}
        </div>

        <nav className="flex lg:flex-col gap-1 overflow-x-auto p-3 flex-1">
          {navItems.map((item) => {
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`flex items-center justify-between gap-2.5 rounded-xl px-3 py-2.5 text-xs font-semibold leading-normal transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[#E7F0FC] text-[#0B4DA2]'
                    : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
                }`}
              >
                <span className="inline-flex items-center gap-2.5">
                  {item.icon}
                  <span>{item.label}</span>
                </span>
                {item.badge !== undefined && (
                  <span
                    className={`inline-flex items-center justify-center rounded-md px-1.5 py-0.5 font-mono text-[10px] leading-normal ${
                      active ? 'bg-white text-[#0B4DA2]' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="hidden lg:block border-t border-slate-200/70 p-4 space-y-2.5">
          <div className="min-w-0 text-[11px] leading-normal text-slate-500">
            <div className="font-semibold text-slate-800 truncate leading-normal" title={user?.email}>
              {user?.email}
            </div>
            <div className="uppercase tracking-wider text-[10px] font-medium leading-normal text-[#0B4DA2]">
              Role: {user?.role}
            </div>
          </div>
          {!isAdminMode && user && (
            <button
              type="button"
              onClick={() => setShowChangePassword(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200/90 bg-white/80 px-3 py-2 text-xs font-medium leading-normal text-slate-700 hover:bg-white hover:text-[#0B4DA2] transition-colors cursor-pointer"
            >
              <KeyRound className="h-3.5 w-3.5 shrink-0" />
              <span>Change Password</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200/90 bg-white/80 px-3 py-2 text-xs font-medium leading-normal text-slate-700 hover:bg-white hover:text-slate-900 transition-colors cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Frosted Top Action Bar */}
        <header className="sticky top-0 z-30 border-b border-white/90 bg-white/70 backdrop-blur-2xl px-4 py-3.5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-base font-bold leading-snug text-slate-900">
                {section === 'LEDGER' && 'BIR Sales & Expenses Ledger'}
                {section === 'ANALYTICS' && 'Monthly Tax & Cashflow Analytics'}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <PWAInstallButton />
              <button
                type="button"
                onClick={() => setExportModalFormat('XLSX')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#18181B] px-4 py-2 text-xs font-semibold leading-normal text-white shadow-2xs hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
                <span>Export Month (.xlsx)</span>
              </button>
              {!isAdminMode && user && (
                <button
                  type="button"
                  onClick={() => setShowChangePassword(true)}
                  aria-label="Change Password"
                  title="Change Password"
                  className="lg:hidden inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/85 px-3 py-2 text-xs font-semibold leading-normal text-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <KeyRound className="h-3.5 w-3.5 shrink-0" />
                  <span>Password</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void signOut()}
                className="lg:hidden inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/85 px-3 py-2 text-xs font-semibold leading-normal text-slate-700 whitespace-nowrap shrink-0"
              >
                <LogOut className="h-3.5 w-3.5 shrink-0" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 space-y-5 max-w-[1440px] w-full mx-auto min-w-0">
          {isAdminMode && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#BBD6F2] bg-[#EBF3FC]/85 backdrop-blur-md px-4 py-2.5 text-xs leading-normal text-slate-800">
              <div className="flex items-start sm:items-center gap-2 font-medium min-w-0">
                <ShieldAlert className="h-4 w-4 text-[#0B4DA2] shrink-0 mt-0.5 sm:mt-0" />
                <span className="break-words">
                  <strong>Admin Audit Mode:</strong> Inspecting{' '}
                  <strong>{client.companyName}</strong>. You can approve/flag entries, edit rows,
                  or manage their .xlsx vault.
                </span>
              </div>
            </div>
          )}

          {loading ? (
            <div className="rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl py-20 text-center text-sm text-slate-500">
              Loading {client.companyName} ledger workspace...
            </div>
          ) : (
            <>
              {section === 'LEDGER' && (
                <div className="space-y-5">
                  {/* Live BIR Summary Cards (Sales, Purchases, Net VAT Payable, EWT) */}
                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="min-w-0 rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl p-4 shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide leading-normal text-slate-500 truncate">
                          Total Sales ({monthCover})
                        </span>
                        <span className="text-[11px] tabular-nums-mono leading-normal text-[#0B4DA2] whitespace-nowrap shrink-0">
                          {monthlySalesRows.length} rows
                        </span>
                      </div>
                      <div className="mt-1.5 tabular-nums-mono text-xl font-bold leading-normal text-slate-900 break-words">
                        ₱{formatAccounting(salesSummary.total) === '-' ? '0.00' : formatAccounting(salesSummary.total)}
                      </div>
                      <div className="mt-1 text-[11px] leading-normal text-slate-500 tabular-nums-mono break-words">
                        Output VAT: ₱{formatAccounting(salesSummary.vat) === '-' ? '0.00' : formatAccounting(salesSummary.vat)}
                      </div>
                    </div>

                    <div className="min-w-0 rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl p-4 shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide leading-normal text-slate-500 truncate">
                          Total Expenses ({monthCover})
                        </span>
                        <span className="text-[11px] tabular-nums-mono leading-normal text-slate-500 whitespace-nowrap shrink-0">
                          {monthlyExpenseRows.length} rows
                        </span>
                      </div>
                      <div className="mt-1.5 tabular-nums-mono text-xl font-bold leading-normal text-slate-900 break-words">
                        ₱{formatAccounting(expensesSummary.total) === '-' ? '0.00' : formatAccounting(expensesSummary.total)}
                      </div>
                      <div className="mt-1 text-[11px] leading-normal text-slate-500 tabular-nums-mono break-words">
                        Input VAT: ₱{formatAccounting(expensesSummary.vat) === '-' ? '0.00' : formatAccounting(expensesSummary.vat)}
                      </div>
                    </div>

                    <div className="min-w-0 rounded-2xl border border-[#BBD6F2] bg-[#EBF3FC]/85 backdrop-blur-xl p-4 shadow-[0_8px_28px_-12px_rgba(11,77,162,0.12)]">
                      <div className="text-[11px] font-semibold uppercase tracking-wide leading-normal text-[#0B4DA2]">
                        Net VAT Payable (Out - In)
                      </div>
                      <div
                        className={`mt-1.5 tabular-nums-mono text-xl font-bold leading-normal break-words ${
                          netVatPayable < 0 ? 'text-emerald-700' : 'text-[#0B4DA2]'
                        }`}
                      >
                        {netVatPayable < 0 ? '(Credit) ' : ''}₱
                        {formatAccounting(Math.abs(netVatPayable)) === '-'
                          ? '0.00'
                          : formatAccounting(Math.abs(netVatPayable))}
                      </div>
                      <div className="mt-1 text-[11px] leading-normal text-slate-600">
                        {client.taxClassification === 'NON_VAT'
                          ? 'Non-VAT Taxpayer (Percentage Tax Basis)'
                          : netVatPayable < 0
                          ? 'Excess Input VAT Credit Carryover'
                          : 'Due for BIR Form 2550M / 2550Q'}
                      </div>
                    </div>

                    <div className="min-w-0 rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl p-4 shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
                      <div className="text-[11px] font-semibold uppercase tracking-wide leading-normal text-slate-500">
                        Withholding Taxes (EWT)
                      </div>
                      <div className="mt-1.5 tabular-nums-mono text-xl font-bold leading-normal text-slate-900 break-words">
                        ₱
                        {formatAccounting(
                          round2(salesSummary.totalWithholding + expensesSummary.totalWithholding)
                        ) === '-'
                          ? '0.00'
                          : formatAccounting(
                              round2(salesSummary.totalWithholding + expensesSummary.totalWithholding)
                            )}
                      </div>
                      <div className="mt-1 text-[11px] leading-normal text-slate-500 tabular-nums-mono break-words">
                        Sales CWT: ₱{formatAccounting(salesSummary.totalWithholding) === '-' ? '0.00' : formatAccounting(salesSummary.totalWithholding)}
                      </div>
                    </div>
                  </div>

                  {/* Toolbar: Sales / Expenses Toggle */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="inline-flex rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl p-1 shadow-2xs">
                      {(
                        [
                          { id: 'SALES', label: `SALES (${monthlySalesRows.length})` },
                          { id: 'EXPENSE', label: `EXPENSES (${monthlyExpenseRows.length})` },
                        ] as { id: LedgerEntryKind; label: string }[]
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => {
                            setLedgerTab(tab.id);
                            setEditingRow(null);
                            setNeedsReviewOnly(false);
                          }}
                          className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                            ledgerTab === tab.id
                              ? 'bg-[#0B4DA2] text-white shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={csvInputRef}
                        type="file"
                        accept=".csv"
                        onChange={handleCsvImport}
                        className="hidden"
                      />
                      {currentRows.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setConfirmAction('CLEAR_LEDGER')}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white/85 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Clear Period
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Month Cover Bar */}
                  <MonthCoverBar
                    mode={taxMode}
                    monthCover={monthCover}
                    yearCover={yearCover}
                    availableYears={availableYears}
                    modeRows={allModeRows}
                    otherModeRows={ledgerTab === 'SALES' ? expenseRows : salesRows}
                    onChangeMonthCover={(m) => {
                      setMonthCover(m);
                      setEditingRow(null);
                      setNeedsReviewOnly(false);
                      setShowComposer(true);
                    }}
                    onChangeYearCover={(y) => {
                      setYearCover(y);
                      setEditingRow(null);
                      setNeedsReviewOnly(false);
                      setShowComposer(true);
                    }}
                    onAddYear={handleAddYear}
                  />

                  {/* Fast BIR Encoder */}
                  {showComposer && (
                    <div ref={composerRef}>
                      <EntryComposer
                        clientKey={`${client.id}-${ledgerTab}`}
                        mode={taxMode}
                        modeLabel={ledgerTab === 'EXPENSE' ? 'EXPENSES' : 'SALES'}
                        coveredMonth={monthCover}
                        coveredYear={yearCover}
                        onChangeCoveredMonth={setMonthCover}
                        onChangeCoveredYear={(yr) => {
                          if (!availableYears.includes(yr)) {
                            handleAddYear(yr);
                          }
                          setYearCover(yr);
                        }}
                        accountTitles={accountTitles}
                        knownRows={taxMode === 'SALES' ? salesRows : expenseRows}
                        onUpdateAccountTitles={setAccountTitles}
                        autoCalcEnabled={autoCalcEnabled}
                        onToggleAutoCalc={setAutoCalcEnabled}
                        editingRow={editingRow}
                        onCancelEdit={() => setEditingRow(null)}
                        onSaveRows={handleSaveRows}
                      />
                    </div>
                  )}

                  {/* High-Contrast Searchable & Auditable Ledger Table */}
                  <LedgerTable
                    mode={taxMode}
                    entryKindLabel={ledgerTab === 'EXPENSE' ? 'EXPENSES' : ledgerTab}
                    rows={currentRows}
                    monthCover={monthCover}
                    yearCover={yearCover}
                    totalModeRowCount={allModeRows.length}
                    isAdminMode={isAdminMode}
                    onSetAuditStatus={handleSetAuditStatus}
                    onShowAllMonths={() => setMonthCover('ALL')}
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

              {section === 'ANALYTICS' && (
                <div className="space-y-4">
                  <MonthCoverBar
                    mode={taxMode}
                    monthCover={monthCover}
                    yearCover={yearCover}
                    availableYears={availableYears}
                    modeRows={allModeRows}
                    otherModeRows={ledgerTab === 'SALES' ? expenseRows : salesRows}
                    onChangeMonthCover={setMonthCover}
                    onChangeYearCover={setYearCover}
                    onAddYear={handleAddYear}
                  />
                  <AnalyticsDashboard
                    activeMode={taxMode}
                    salesRows={salesRows}
                    purchasesRows={expenseRows}
                    monthCover={monthCover}
                    yearCover={yearCover}
                    onSelectMonthCover={setMonthCover}
                    onInspectFlaggedRows={(targetMode) => {
                      setLedgerTab(targetMode === 'SALES' ? 'SALES' : 'EXPENSE');
                      setNeedsReviewOnly(true);
                      setSection('LEDGER');
                    }}
                  />
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Export Month Modal */}
      <ExportMonthModal
        isOpen={exportModalFormat !== null}
        initialFormat={exportModalFormat ?? 'XLSX'}
        initialMode={taxMode}
        activeMonthCover={monthCover}
        activeYearCover={yearCover}
        availableYears={availableYears}
        clientSlug={client.slug}
        clientName={client.companyName}
        salesRows={salesRows}
        purchasesRows={expenseRows}
        onClose={() => setExportModalFormat(null)}
        onExecuteExport={handleExecuteExport}
      />

      {/* Confirmation Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl border-2 border-white bg-white p-5 shadow-2xl">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Clear {ledgerTab === 'EXPENSE' ? 'EXPENSES' : 'SALES'} rows for {monthCover}?
            </h3>
            <p className="mt-1.5 text-xs text-slate-600">
              Removes {currentRows.length} entries from {monthCover}. Other periods remain untouched.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmModalAction()}
                className="rounded-xl px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer bg-rose-600 hover:bg-rose-700"
              >
                Clear Rows
              </button>
            </div>
          </div>
        </div>
      )}

      {!isAdminMode && user && (
        <ChangePasswordModal
          isOpen={showChangePassword}
          userId={user.id}
          usernameLabel={user.email}
          onClose={() => setShowChangePassword(false)}
          onSuccess={(msg) => showToast(msg)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-xl border border-slate-800 bg-[#18181B] px-4 py-2.5 text-xs font-medium leading-normal text-white shadow-xl">
          {toast.type === 'error' ? (
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-sky-400 shrink-0" />
          )}
          <span className="break-words">{toast.message}</span>
        </div>
      )}
    </div>
  );
};
