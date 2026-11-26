import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  FolderPlus,
  HardDrive,
  KeyRound,
  Loader2,
  LogOut,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { ClientWorkspaceView } from '@/components/ClientWorkspaceView';
import { useAuth } from '@/lib/authContext';
import { generateTempPassword } from '@/lib/crypto';
import {
  assignClientLoginCredentials,
  createClientDirectoryWithCredentials,
  deleteClientDirectory,
  getClientDirectoryById,
  listClientDirectories,
  listVaultFiles,
} from '@/lib/portalStore';
import { downloadVaultXlsxBlob, formatFileSize, triggerBlobDownload } from '@/lib/vaultService';
import type { ClientDirectory, TaxClassification, VaultXlsxFile } from '@/types/portal';
import { formatTin } from '@/utils/taxEngine';

type AdminTab = 'DIRECTORIES' | 'VAULT';

export const AdminDashboardPage: React.FC = () => {
  const { user, signOut, isSupabaseMode } = useAuth();
  const navigate = useNavigate();
  const { clientId } = useParams<{ clientId?: string }>();

  const [tab, setTab] = useState<AdminTab>('DIRECTORIES');
  const [directories, setDirectories] = useState<ClientDirectory[]>([]);
  const [vaultFiles, setVaultFiles] = useState<VaultXlsxFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [taxFilter, setTaxFilter] = useState<'ALL' | TaxClassification>('ALL');

  // Drill-down client state when route is /admin/client/:clientId
  const [drillDownClient, setDrillDownClient] = useState<ClientDirectory | null>(null);
  const [drillDownLoading, setDrillDownLoading] = useState(false);

  // Create Client Directory modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCompany, setNewCompany] = useState('');
  const [newTradeName, setNewTradeName] = useState('');
  const [newTin, setNewTin] = useState('');
  const [newRdo, setNewRdo] = useState('');
  const [newTaxClass, setNewTaxClass] = useState<TaxClassification>('VAT');
  const [assignLogin, setAssignLogin] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState(() => generateTempPassword(12));
  const [includeSampleRows, setIncludeSampleRows] = useState(false);
  const [creating, setCreating] = useState(false);

  // Assign Login modal for existing client
  const [credTarget, setCredTarget] = useState<ClientDirectory | null>(null);
  const [credEmail, setCredEmail] = useState('');
  const [credPassword, setCredPassword] = useState('');
  const [savingCred, setSavingCred] = useState(false);

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<ClientDirectory | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadMasterData = useCallback(async () => {
    setLoading(true);
    try {
      const [dirs, files] = await Promise.all([listClientDirectories(), listVaultFiles()]);
      setDirectories(dirs);
      setVaultFiles(files);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to load admin data.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadMasterData();
  }, [loadMasterData]);

  useEffect(() => {
    if (!clientId) {
      setDrillDownClient(null);
      return;
    }
    const existing = directories.find((d) => d.id === clientId);
    if (existing) {
      setDrillDownClient(existing);
      return;
    }
    setDrillDownLoading(true);
    getClientDirectoryById(clientId)
      .then((found) => setDrillDownClient(found))
      .finally(() => setDrillDownLoading(false));
  }, [clientId, directories]);

  const storageByClient = useMemo(() => {
    const map = new Map<string, { bytes: number; count: number }>();
    vaultFiles.forEach((f) => {
      const cur = map.get(f.clientDirectoryId) ?? { bytes: 0, count: 0 };
      cur.bytes += f.sizeBytes || 0;
      cur.count += 1;
      map.set(f.clientDirectoryId, cur);
    });
    return map;
  }, [vaultFiles]);

  const totalStorageBytes = useMemo(
    () => vaultFiles.reduce((sum, f) => sum + (f.sizeBytes || 0), 0),
    [vaultFiles]
  );

  const filteredDirectories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return directories.filter((d) => {
      if (taxFilter !== 'ALL' && d.taxClassification !== taxFilter) return false;
      if (q) {
        const hay = `${d.companyName} ${d.tradeName} ${d.tin} ${d.rdoCode} ${d.assignedEmail ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [directories, searchQuery, taxFilter]);

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompany.trim()) return;
    setCreating(true);
    try {
      const { directory, credentialNotice } = await createClientDirectoryWithCredentials({
        companyName: newCompany,
        tradeName: newTradeName,
        tin: newTin,
        rdoCode: newRdo,
        taxClassification: newTaxClass,
        assignLogin,
        email: newEmail,
        password: newPassword,
        includeSampleRows,
      });
      setDirectories((prev) => [directory, ...prev]);
      setShowCreateModal(false);
      setNewCompany('');
      setNewTradeName('');
      setNewTin('');
      setNewRdo('');
      setNewEmail('');
      setNewPassword(generateTempPassword(12));
      showToast(credentialNotice || `Created ${directory.companyName} directory.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to create client.', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleAssignCredsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!credTarget) return;
    setSavingCred(true);
    try {
      const notice = await assignClientLoginCredentials({
        clientDirectoryId: credTarget.id,
        companyName: credTarget.companyName,
        email: credEmail,
        password: credPassword,
      });
      setDirectories((prev) =>
        prev.map((d) =>
          d.id === credTarget.id ? { ...d, assignedEmail: credEmail.trim().toLowerCase() } : d
        )
      );
      setCredTarget(null);
      showToast(notice || `Assigned login credentials for ${credTarget.companyName}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to assign credentials.', 'error');
    } finally {
      setSavingCred(false);
    }
  };

  const handleDeleteDirectory = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteClientDirectory(deleteTarget.id);
      setDirectories((prev) => prev.filter((d) => d.id !== deleteTarget.id));
      setVaultFiles((prev) => prev.filter((f) => f.clientDirectoryId !== deleteTarget.id));
      showToast(`Deleted directory ${deleteTarget.companyName}.`);
      setDeleteTarget(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to delete directory.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Drill-down Admin Inspection View
  if (clientId) {
    if (drillDownLoading) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-[#DCEBFB] via-[#EEF5FC] to-[#F8FBFF] flex items-center justify-center p-4">
          <div className="flex items-center gap-2.5 rounded-2xl border border-white/90 bg-white/80 px-5 py-3.5 text-sm font-medium text-slate-700 shadow-sm backdrop-blur-xl">
            <Loader2 className="h-4 w-4 animate-spin text-[#0B4DA2]" />
            Opening client directory...
          </div>
        </div>
      );
    }
    if (!drillDownClient) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-[#DCEBFB] via-[#EEF5FC] to-[#F8FBFF] flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-sm rounded-2xl border border-white/90 bg-white/85 p-8 shadow-sm backdrop-blur-xl">
            <Building2 className="mx-auto h-10 w-10 text-[#0B4DA2]/40" />
            <h2 className="mt-3 font-display text-lg font-bold text-slate-900">
              Client Directory Not Found
            </h2>
            <button
              type="button"
              onClick={() => navigate('/admin')}
              className="mt-4 rounded-xl bg-[#18181B] px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
            >
              Return to Admin Dashboard
            </button>
          </div>
        </div>
      );
    }
    return (
      <ClientWorkspaceView
        client={drillDownClient}
        isAdminMode
        onBackToAdmin={() => {
          void loadMasterData();
          navigate('/admin');
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#DCEBFB] via-[#EEF5FC] to-[#F8FBFF] text-slate-900 flex flex-col lg:flex-row">
      {/* Minimalist Frosted Admin Sidebar */}
      <aside className="w-full lg:w-64 lg:shrink-0 bg-white/75 backdrop-blur-2xl text-slate-800 border-b lg:border-b-0 lg:border-r border-white/90 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200/70">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200/80 bg-white p-1 shadow-2xs">
              <img
                src="/assets/aistudio/image_e6df563a.png"
                alt="NPB CPA"
                referrerPolicy="no-referrer"
                className="h-full w-full object-contain"
              />
            </div>
            <div className="min-w-0">
              <span className="block font-display text-sm font-extrabold tracking-tight text-slate-900 truncate">
                NPB TAX LEDGER
              </span>
              <span className="block text-[11px] font-medium text-[#0B4DA2]">
                Admin Console
              </span>
            </div>
          </div>
        </div>

        <nav className="flex lg:flex-col gap-1 overflow-x-auto p-3 flex-1">
          <button
            type="button"
            onClick={() => setTab('DIRECTORIES')}
            className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              tab === 'DIRECTORIES'
                ? 'bg-[#E7F0FC] text-[#0B4DA2]'
                : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Users className="h-4 w-4" />
              Client Directories
            </span>
            <span
              className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
                tab === 'DIRECTORIES' ? 'bg-white text-[#0B4DA2]' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {directories.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTab('VAULT')}
            className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              tab === 'VAULT'
                ? 'bg-[#E7F0FC] text-[#0B4DA2]'
                : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <HardDrive className="h-4 w-4" />
              Global .XLSX Vault
            </span>
            <span
              className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
                tab === 'VAULT' ? 'bg-white text-[#0B4DA2]' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {vaultFiles.length}
            </span>
          </button>
        </nav>

        <div className="hidden lg:block border-t border-slate-200/70 p-4 space-y-3">
          <div className="text-[11px] text-slate-500">
            <div className="font-semibold text-slate-800 truncate">{user?.email}</div>
            <div className="text-[10px] font-medium text-[#0B4DA2]">
              {isSupabaseMode ? 'Cloud Session' : 'Preview Admin'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200/90 bg-white/80 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-white hover:text-slate-900 transition-colors cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 border-b border-white/90 bg-white/70 backdrop-blur-2xl px-4 py-3.5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-base font-bold text-slate-900">
                {tab === 'DIRECTORIES' && 'Master Client Directory'}
                {tab === 'VAULT' && 'Cross-Client .XLSX Storage Vault'}
              </h1>
              <p className="text-xs text-slate-500">
                Manage isolated taxpayer directories, client credentials, and workbook vaults.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#18181B] px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                New Client Directory
              </button>
              <button
                type="button"
                onClick={() => void signOut()}
                className="lg:hidden inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/85 px-3 py-2 text-xs font-semibold text-slate-700"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 space-y-5 max-w-[1440px] w-full mx-auto">
          {/* Minimalist KPI Cards */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl p-4 shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Registered Clients
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900">
                {directories.length}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {directories.filter((d) => d.assignedEmail).length} with active login credentials
              </div>
            </div>

            <div className="rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl p-4 shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Tax Classification Split
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900">
                {directories.filter((d) => d.taxClassification === 'VAT').length} VAT /{' '}
                {directories.filter((d) => d.taxClassification === 'NON_VAT').length} Non-VAT
              </div>
              <div className="mt-1 text-[11px] text-slate-500">BIR 12% VAT & Percentage Tax</div>
            </div>

            <div className="rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl p-4 shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Vault Workbooks
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900">
                {vaultFiles.length}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Direct-to-cloud .xlsx files stored
              </div>
            </div>

            <div className="rounded-2xl border border-[#BBD6F2] bg-[#EBF3FC]/85 backdrop-blur-xl p-4 shadow-[0_8px_28px_-12px_rgba(11,77,162,0.12)]">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#0B4DA2]">
                Total Vault Storage
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-[#0B4DA2]">
                {formatFileSize(totalStorageBytes)}
              </div>
              <div className="mt-1 text-[11px] text-slate-600">
                Multi-GB Storage Bucket (ledger-vault)
              </div>
            </div>
          </div>

          {tab === 'DIRECTORIES' && (
            <div className="overflow-hidden rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search company, TIN, RDO, email..."
                      className="w-64 rounded-xl border border-slate-300/80 bg-white/85 py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-[#0B4DA2] focus:bg-white focus:outline-none"
                    />
                  </div>
                  <select
                    value={taxFilter}
                    onChange={(e) => setTaxFilter(e.target.value as 'ALL' | TaxClassification)}
                    className="rounded-xl border border-slate-300/80 bg-white/85 px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-[#0B4DA2] focus:outline-none"
                  >
                    <option value="ALL">All Classifications</option>
                    <option value="VAT">VAT Registered</option>
                    <option value="NON_VAT">Non-VAT</option>
                  </select>
                </div>
              </div>

              {loading ? (
                <div className="flex items-center justify-center gap-2 py-14 text-xs text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin text-[#0B4DA2]" />
                  Loading client directories...
                </div>
              ) : filteredDirectories.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                  <Building2 className="h-10 w-10 text-slate-300" />
                  <h3 className="mt-3 font-display text-sm font-semibold text-slate-900">
                    No matching client directories
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Create a new client directory and assign credentials to get started.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200/80 bg-[#F4F8FD]/90 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                        <th className="px-4 py-3">Company / Trade Name</th>
                        <th className="px-3 py-3">TIN & RDO</th>
                        <th className="px-3 py-3">Classification</th>
                        <th className="px-3 py-3">Assigned Client Login</th>
                        <th className="px-3 py-3">Vault Storage</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70">
                      {filteredDirectories.map((dir) => {
                        const usage = storageByClient.get(dir.id) ?? { bytes: 0, count: 0 };
                        const pct = Math.min(
                          100,
                          dir.storageQuotaBytes > 0 ? (usage.bytes / dir.storageQuotaBytes) * 100 : 0
                        );
                        return (
                          <tr key={dir.id} className="hover:bg-[#F5F9FE]/80 transition-colors">
                            <td className="px-4 py-3.5">
                              <div className="font-display font-bold text-slate-900">
                                {dir.companyName}
                              </div>
                              {dir.tradeName && (
                                <div className="text-[11px] text-slate-500">{dir.tradeName}</div>
                              )}
                            </td>
                            <td className="px-3 py-3.5 whitespace-nowrap font-mono text-slate-700">
                              <div>{dir.tin || 'No TIN'}</div>
                              <div className="text-[10px] text-slate-400">
                                RDO: {dir.rdoCode || '—'}
                              </div>
                            </td>
                            <td className="px-3 py-3.5 whitespace-nowrap">
                              <span
                                className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                                  dir.taxClassification === 'VAT'
                                    ? 'bg-[#E7F0FC] text-[#0B4DA2]'
                                    : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {dir.taxClassification === 'VAT' ? 'VAT (12%)' : 'NON-VAT'}
                              </span>
                            </td>
                            <td className="px-3 py-3.5 whitespace-nowrap">
                              {dir.assignedEmail ? (
                                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-700">
                                  <ShieldCheck className="h-3.5 w-3.5 text-[#0B4DA2]" />
                                  {dir.assignedEmail}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCredTarget(dir);
                                    setCredEmail('');
                                    setCredPassword(generateTempPassword(12));
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 cursor-pointer"
                                >
                                  <KeyRound className="h-3 w-3" />
                                  Assign Login
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-3.5 min-w-[160px]">
                              <div className="flex justify-between font-mono text-[11px] text-slate-700">
                                <span>{formatFileSize(usage.bytes)}</span>
                                <span className="text-slate-400">{usage.count} file(s)</span>
                              </div>
                              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70">
                                <div
                                  className="h-full rounded-full bg-[#0B4DA2]"
                                  style={{ width: `${Math.max(usage.bytes > 0 ? 4 : 0, pct)}%` }}
                                />
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => navigate(`/admin/client/${dir.id}`)}
                                  className="inline-flex items-center gap-1 rounded-xl bg-[#18181B] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 cursor-pointer"
                                >
                                  <Eye className="h-3 w-3" />
                                  Inspect & Audit
                                  <ArrowUpRight className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCredTarget(dir);
                                    setCredEmail(dir.assignedEmail ?? '');
                                    setCredPassword(generateTempPassword(12));
                                  }}
                                  title="Assign or reset client login"
                                  className="rounded-xl border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 cursor-pointer"
                                >
                                  <KeyRound className="h-3.5 w-3.5" />
                                </button>
                                {directories.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => setDeleteTarget(dir)}
                                    title="Delete client directory"
                                    className="rounded-xl border border-rose-200 bg-white p-1.5 text-rose-600 hover:bg-rose-50 cursor-pointer"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'VAULT' && (
            <div className="overflow-hidden rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
              <div className="border-b border-slate-200/70 px-5 py-3.5">
                <h2 className="font-display text-sm font-bold text-slate-900">
                  All Client .XLSX Vault Files ({vaultFiles.length})
                </h2>
              </div>
              {vaultFiles.length === 0 ? (
                <div className="py-14 text-center text-xs text-slate-500">
                  No .xlsx workbooks uploaded across client directories yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200/80 bg-[#F4F8FD]/90 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                        <th className="px-4 py-3">Client Directory</th>
                        <th className="px-3 py-3">Workbook Name</th>
                        <th className="px-3 py-3">Period</th>
                        <th className="px-3 py-3 text-right">Size</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70">
                      {vaultFiles.map((file) => {
                        const owner = directories.find((d) => d.id === file.clientDirectoryId);
                        return (
                          <tr key={file.id} className="hover:bg-[#F5F9FE]/80 transition-colors">
                            <td className="px-4 py-3.5 font-semibold text-slate-900">
                              {owner?.companyName ?? file.clientDirectoryId}
                            </td>
                            <td className="px-3 py-3.5">
                              <div className="flex items-center gap-1.5 font-medium text-slate-800">
                                <FileSpreadsheet className="h-3.5 w-3.5 text-[#0B4DA2]" />
                                {file.fileName}
                              </div>
                              <div className="font-mono text-[10px] text-slate-400">
                                {file.storagePath}
                              </div>
                            </td>
                            <td className="px-3 py-3.5">
                              <span className="rounded-md bg-[#E7F0FC] px-2 py-0.5 font-mono text-[11px] font-semibold text-[#0B4DA2]">
                                {file.taxPeriod}
                              </span>
                            </td>
                            <td className="px-3 py-3.5 text-right font-mono text-slate-800">
                              {formatFileSize(file.sizeBytes)}
                            </td>
                            <td className="px-4 py-3.5 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => navigate(`/admin/client/${file.clientDirectoryId}`)}
                                  className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                                >
                                  Open Client
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const blob = await downloadVaultXlsxBlob(file);
                                    triggerBlobDownload(blob, file.fileName);
                                  }}
                                  className="rounded-xl bg-[#18181B] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 cursor-pointer"
                                >
                                  Download
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Create Client Directory + Credentials Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-[24px] border-2 border-white bg-white/95 backdrop-blur-xl p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-3">
              <h3 className="font-display text-base font-bold text-slate-900">
                Create New Client Directory
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateClient} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Company / Registered Taxpayer Name *
                </label>
                <input
                  type="text"
                  required
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  placeholder="e.g. MANILA PRIME BUILDERS INC."
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold uppercase text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Trade Name</label>
                  <input
                    type="text"
                    value={newTradeName}
                    onChange={(e) => setNewTradeName(e.target.value)}
                    placeholder="e.g. PRIME BUILDERS"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs uppercase text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Tax Classification
                  </label>
                  <select
                    value={newTaxClass}
                    onChange={(e) => setNewTaxClass(e.target.value as TaxClassification)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
                  >
                    <option value="VAT">VAT Registered (12%)</option>
                    <option value="NON_VAT">Non-VAT Taxpayer</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">TIN</label>
                  <input
                    type="text"
                    value={newTin}
                    onChange={(e) => setNewTin(formatTin(e.target.value))}
                    placeholder="000-123-456-000"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">RDO Code</label>
                  <input
                    type="text"
                    value={newRdo}
                    onChange={(e) => setNewRdo(e.target.value)}
                    placeholder="044"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-[#BBD6F2] bg-[#EBF3FC]/70 p-3.5 space-y-3">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assignLogin}
                    onChange={(e) => setAssignLogin(e.target.checked)}
                    className="rounded border-slate-300 text-[#0B4DA2] focus:ring-[#0B4DA2]"
                  />
                  Assign Client Portal Login Credentials Now
                </label>

                {assignLogin && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Client Email *
                      </label>
                      <input
                        type="email"
                        required={assignLogin}
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="accounting@client.ph"
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Initial Password *
                      </label>
                      <div className="mt-1 flex gap-1">
                        <input
                          type="text"
                          required={assignLogin}
                          minLength={8}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setNewPassword(generateTempPassword(12))}
                          className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                        >
                          Gen
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSampleRows}
                  onChange={(e) => setIncludeSampleRows(e.target.checked)}
                  className="rounded border-slate-300 text-[#0B4DA2]"
                />
                Pre-load Philippine BIR sample rows & TIN directory
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-xl bg-[#18181B] px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-60"
                >
                  {creating ? 'Creating...' : 'Create Client Directory'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign / Update Login Credentials Modal */}
      {credTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-[24px] border-2 border-white bg-white p-6 shadow-2xl">
            <h3 className="font-display text-base font-bold text-slate-900">
              Client Portal Credentials
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Assign login access strictly scoped to <strong>{credTarget.companyName}</strong>.
            </p>
            <form onSubmit={handleAssignCredsSubmit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Client Email</label>
                <input
                  type="email"
                  required
                  value={credEmail}
                  onChange={(e) => setCredEmail(e.target.value)}
                  placeholder="client@company.ph"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Password</label>
                <div className="mt-1 flex gap-1.5">
                  <input
                    type="text"
                    required
                    minLength={8}
                    value={credPassword}
                    onChange={(e) => setCredPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setCredPassword(generateTempPassword(12))}
                    className="rounded-xl border border-slate-300 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Generate
                  </button>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCredTarget(null)}
                  className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCred}
                  className="rounded-xl bg-[#18181B] px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-60"
                >
                  {savingCred ? 'Saving...' : 'Save Credentials'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Directory Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl border-2 border-white bg-white p-5 shadow-2xl">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Delete {deleteTarget.companyName}?
            </h3>
            <p className="mt-1.5 text-xs text-slate-600">
              This removes the client directory, all ledger entries, TIN profiles, and stored .xlsx vault workbooks.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDeleteDirectory()}
                className="rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 cursor-pointer disabled:opacity-60"
              >
                {deleting ? 'Deleting...' : 'Delete Directory'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-xl border border-slate-800 bg-[#18181B] px-4 py-2.5 text-xs font-medium text-white shadow-xl">
          {toast.type === 'error' ? (
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-sky-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
};
