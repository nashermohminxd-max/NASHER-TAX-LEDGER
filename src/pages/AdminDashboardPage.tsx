import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
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
import { ChangePasswordModal } from '@/components/ChangePasswordModal';
import { ClientWorkspaceView } from '@/components/ClientWorkspaceView';
import { useAuth } from '@/lib/authContext';
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

export const AdminDashboardPage: React.FC = () => {
  const { user, signOut, isSupabaseMode } = useAuth();
  const navigate = useNavigate();
  const { clientId } = useParams<{ clientId?: string }>();

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
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [includeSampleRows, setIncludeSampleRows] = useState(false);
  const [creating, setCreating] = useState(false);

  // Assign Login modal for existing client
  const [credTarget, setCredTarget] = useState<ClientDirectory | null>(null);
  const [credEmail, setCredEmail] = useState('');
  const [credPassword, setCredPassword] = useState('');
  const [showCredPassword, setShowCredPassword] = useState(false);
  const [savingCred, setSavingCred] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

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
      setNewPassword('');
      setShowNewPassword(false);
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
        password: credPassword || undefined,
      });
      setDirectories((prev) =>
        prev.map((d) =>
          d.id === credTarget.id ? { ...d, assignedEmail: credEmail.trim().toLowerCase() } : d
        )
      );
      setCredTarget(null);
      showToast(notice || `Updated login credentials for ${credTarget.companyName}.`);
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
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/80 bg-white shadow-2xs">
              <img
                src="/assets/aistudio/image_1a4227c8.png"
                alt="NPB CPA"
                referrerPolicy="no-referrer"
                className="absolute left-1/2 top-1/2 h-auto w-[113%] max-w-none -translate-x-[51.7%] -translate-y-[53%]"
              />
            </div>
            <div className="min-w-0 flex-1 flex flex-col justify-center text-center">
              <span className="block font-display text-sm font-extrabold tracking-tight leading-snug text-slate-900">
                NPB LEDGER
              </span>
              <span className="block text-[11px] font-medium leading-normal text-[#0B4DA2]">
                Admin Console
              </span>
            </div>
          </div>
        </div>

        <nav className="flex lg:flex-col gap-1 overflow-x-auto p-3 flex-1">
          <div
            className="flex items-center justify-between gap-2 rounded-xl bg-[#E7F0FC] px-3 py-2.5 text-xs font-semibold text-[#0B4DA2] whitespace-nowrap shrink-0"
          >
            <span className="flex items-center gap-2.5">
              <Users className="h-4 w-4 shrink-0" />
              Client Directories
            </span>
            <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[10px] text-[#0B4DA2]">
              {directories.length}
            </span>
          </div>
        </nav>

        <div className="hidden lg:block border-t border-slate-200/70 p-4 space-y-2.5">
          <div className="min-w-0 text-[11px] leading-normal text-slate-500">
            <div className="font-semibold text-slate-800 truncate leading-normal" title={user?.email}>
              {user?.email}
            </div>
            <div className="text-[10px] font-medium leading-normal text-[#0B4DA2]">
              {isSupabaseMode ? 'Cloud Session' : 'Preview Admin'}
            </div>
          </div>
          {user && (
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
        <header className="sticky top-0 z-30 border-b border-white/90 bg-white/70 backdrop-blur-2xl px-4 py-3.5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-base font-bold leading-snug text-slate-900">
                Master Client Directory
              </h1>
              <p className="text-xs leading-normal text-slate-500 break-words">
                Manage isolated taxpayer directories, client credentials, and workbook vaults.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#18181B] px-4 py-2 text-xs font-semibold leading-normal text-white shadow-2xs hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FolderPlus className="h-3.5 w-3.5 shrink-0" />
                <span>New Client Directory</span>
              </button>
              {user && (
                <button
                  type="button"
                  onClick={() => setShowChangePassword(true)}
                  aria-label="Change Password"
                  title="Change Password"
                  className="lg:hidden inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white/85 px-3 py-2 text-xs font-semibold leading-normal text-slate-700 shrink-0"
                >
                  <KeyRound className="h-3.5 w-3.5 shrink-0" />
                </button>
              )}
              <button
                type="button"
                onClick={() => void signOut()}
                aria-label="Sign Out"
                className="lg:hidden inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white/85 px-3 py-2 text-xs font-semibold leading-normal text-slate-700 shrink-0"
              >
                <LogOut className="h-3.5 w-3.5 shrink-0" />
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

          <div className="overflow-hidden rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
                  <div className="relative w-full sm:w-auto min-w-0">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search company, TIN, RDO, email..."
                      className="w-full sm:w-64 rounded-xl border border-slate-300/80 bg-white/85 py-1.5 pl-8 pr-3 text-xs leading-normal text-slate-900 focus:border-[#0B4DA2] focus:bg-white focus:outline-none"
                    />
                  </div>
                  <select
                    value={taxFilter}
                    onChange={(e) => setTaxFilter(e.target.value as 'ALL' | TaxClassification)}
                    className="rounded-xl border border-slate-300/80 bg-white/85 px-3 py-1.5 text-xs font-medium leading-normal text-slate-800 focus:border-[#0B4DA2] focus:outline-none"
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
                            <td className="px-4 py-3.5 max-w-[260px]">
                              <div className="font-display font-bold leading-normal text-slate-900 break-words">
                                {dir.companyName}
                              </div>
                              {dir.tradeName && (
                                <div className="text-[11px] leading-normal text-slate-500 break-words">{dir.tradeName}</div>
                              )}
                            </td>
                            <td className="px-3 py-3.5 whitespace-nowrap tabular-nums-mono text-slate-700">
                              <div className="leading-normal">{dir.tin || 'No TIN'}</div>
                              <div className="text-[10px] leading-normal text-slate-400">
                                RDO: {dir.rdoCode || '—'}
                              </div>
                            </td>
                            <td className="px-3 py-3.5 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold leading-normal ${
                                  dir.taxClassification === 'VAT'
                                    ? 'bg-[#E7F0FC] text-[#0B4DA2]'
                                    : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {dir.taxClassification === 'VAT' ? 'VAT (12%)' : 'NON-VAT'}
                              </span>
                            </td>
                            <td className="px-3 py-3.5 max-w-[240px]">
                              {dir.assignedEmail ? (
                                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] leading-normal text-slate-700 break-all">
                                  <ShieldCheck className="h-3.5 w-3.5 text-[#0B4DA2] shrink-0" />
                                  <span>{dir.assignedEmail}</span>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCredTarget(dir);
                                    setCredEmail('');
                                    setCredPassword('');
                                    setShowCredPassword(false);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold leading-normal text-amber-900 hover:bg-amber-100 whitespace-nowrap cursor-pointer"
                                >
                                  <KeyRound className="h-3 w-3 shrink-0" />
                                  <span>Assign Login</span>
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-3.5 min-w-[160px]">
                              <div className="flex justify-between gap-2 font-mono text-[11px] leading-normal text-slate-700">
                                <span>{formatFileSize(usage.bytes)}</span>
                                <span className="text-slate-400 whitespace-nowrap">{usage.count} file(s)</span>
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
                                  className="inline-flex items-center gap-1 rounded-xl bg-[#18181B] px-3 py-1.5 text-[11px] font-semibold leading-normal text-white hover:bg-slate-800 cursor-pointer"
                                >
                                  <Eye className="h-3 w-3 shrink-0" />
                                  <span>Inspect &amp; Audit</span>
                                  <ArrowUpRight className="h-3 w-3 shrink-0" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCredTarget(dir);
                                    setCredEmail(dir.assignedEmail ?? '');
                                    setCredPassword('');
                                    setShowCredPassword(false);
                                  }}
                                  title="Update client username or change password"
                                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 cursor-pointer"
                                >
                                  <KeyRound className="h-3.5 w-3.5" />
                                </button>
                                {directories.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => setDeleteTarget(dir)}
                                    title="Delete client directory"
                                    className="inline-flex items-center justify-center rounded-xl border border-rose-200 bg-white p-1.5 text-rose-600 hover:bg-rose-50 cursor-pointer"
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

          <div className="overflow-hidden rounded-2xl border border-white/90 bg-white/80 backdrop-blur-xl shadow-[0_8px_28px_-12px_rgba(11,77,162,0.1)]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 px-5 py-3.5">
                <h2 className="inline-flex items-center gap-2 font-display text-sm font-bold leading-snug text-slate-900">
                  <HardDrive className="h-4 w-4 text-[#0B4DA2] shrink-0" />
                  <span>Global .XLSX Vault — All Client Files ({vaultFiles.length})</span>
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
                        <th className="px-4 py-3 whitespace-nowrap">Client Directory</th>
                        <th className="px-3 py-3 whitespace-nowrap">Workbook Name</th>
                        <th className="px-3 py-3 whitespace-nowrap">Period</th>
                        <th className="px-3 py-3 text-right whitespace-nowrap">Size</th>
                        <th className="px-4 py-3 text-right whitespace-nowrap">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70">
                      {vaultFiles.map((file) => {
                        const owner = directories.find((d) => d.id === file.clientDirectoryId);
                        return (
                          <tr key={file.id} className="hover:bg-[#F5F9FE]/80 transition-colors">
                            <td className="px-4 py-3.5 max-w-[220px] font-semibold leading-normal text-slate-900 break-words">
                              {owner?.companyName ?? file.clientDirectoryId}
                            </td>
                            <td className="px-3 py-3.5 max-w-[320px]">
                              <div className="flex items-center gap-1.5 font-medium leading-normal text-slate-800 min-w-0">
                                <FileSpreadsheet className="h-3.5 w-3.5 text-[#0B4DA2] shrink-0" />
                                <span className="truncate leading-normal" title={file.fileName}>{file.fileName}</span>
                              </div>
                              <div className="font-mono text-[10px] leading-normal text-slate-400 break-all">
                                {file.storagePath}
                              </div>
                            </td>
                            <td className="px-3 py-3.5 whitespace-nowrap">
                              <span className="inline-flex items-center rounded-md bg-[#E7F0FC] px-2 py-0.5 font-mono text-[11px] font-semibold leading-normal text-[#0B4DA2]">
                                {file.taxPeriod}
                              </span>
                            </td>
                            <td className="px-3 py-3.5 text-right tabular-nums-mono whitespace-nowrap text-slate-800">
                              {formatFileSize(file.sizeBytes)}
                            </td>
                            <td className="px-4 py-3.5 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => navigate(`/admin/client/${file.clientDirectoryId}`)}
                                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium leading-normal text-slate-700 hover:bg-slate-50 cursor-pointer"
                                >
                                  Open Client
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      const blob = await downloadVaultXlsxBlob(file);
                                      triggerBlobDownload(blob, file.fileName);
                                    } catch (err) {
                                      showToast(
                                        err instanceof Error ? err.message : 'Unable to download workbook.',
                                        'error'
                                      );
                                    }
                                  }}
                                  className="inline-flex items-center justify-center rounded-xl bg-[#18181B] px-3 py-1.5 text-[11px] font-semibold leading-normal text-white hover:bg-slate-800 cursor-pointer"
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
                      <label className="block text-[11px] font-semibold leading-normal text-slate-700">
                        Username *
                      </label>
                      <input
                        type="text"
                        required={assignLogin}
                        autoComplete="username"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="client_username"
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs leading-normal text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold leading-normal text-slate-700">
                        Initial Password *
                      </label>
                      <div className="relative mt-1">
                        <input
                          type={showNewPassword ? 'text' : 'password'}
                          required={assignLogin}
                          minLength={8}
                          autoComplete="new-password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Min 8 characters"
                          className="w-full rounded-xl border border-slate-300 bg-white py-1.5 pl-2.5 pr-8 text-xs leading-normal text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword((v) => !v)}
                          aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center rounded-md p-0.5 text-slate-500 hover:bg-slate-100 cursor-pointer"
                        >
                          {showNewPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
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
            <h3 className="font-display text-base font-bold leading-snug text-slate-900">
              Client Portal Credentials
            </h3>
            <p className="mt-1 text-xs leading-normal text-slate-500 break-words">
              Assign or update login access strictly scoped to <strong>{credTarget.companyName}</strong>.
            </p>
            <form onSubmit={handleAssignCredsSubmit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold leading-normal text-slate-700">Username</label>
                <input
                  type="text"
                  required
                  autoComplete="username"
                  value={credEmail}
                  onChange={(e) => setCredEmail(e.target.value)}
                  placeholder="Enter client username..."
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs leading-normal text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold leading-normal text-slate-700">
                  {credTarget.assignedEmail ? 'Change Password' : 'Password'}
                </label>
                <div className="relative mt-1">
                  <input
                    type={showCredPassword ? 'text' : 'password'}
                    required={!credTarget.assignedEmail}
                    minLength={credPassword ? 8 : undefined}
                    autoComplete="new-password"
                    value={credPassword}
                    onChange={(e) => setCredPassword(e.target.value)}
                    placeholder={
                      credTarget.assignedEmail
                        ? 'Enter new password (leave blank to keep)...'
                        : 'Minimum 8 characters...'
                    }
                    className="w-full rounded-xl border border-slate-300 py-2 pl-3 pr-9 text-xs leading-normal text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCredPassword((v) => !v)}
                    aria-label={showCredPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center rounded-md p-1 text-slate-500 hover:bg-slate-100 cursor-pointer"
                  >
                    {showCredPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCredTarget(null)}
                  className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium leading-normal text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCred}
                  className="inline-flex items-center justify-center rounded-xl bg-[#18181B] px-4 py-1.5 text-xs font-semibold leading-normal text-white hover:bg-slate-800 cursor-pointer disabled:opacity-60"
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
            <h3 className="font-display text-sm font-bold leading-snug text-slate-900 break-words">
              Delete {deleteTarget.companyName}?
            </h3>
            <p className="mt-1.5 text-xs leading-normal text-slate-600">
              This removes the client directory, all ledger entries, TIN profiles, and stored .xlsx vault workbooks.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium leading-normal text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDeleteDirectory()}
                className="inline-flex items-center justify-center rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-semibold leading-normal text-white hover:bg-rose-700 cursor-pointer disabled:opacity-60"
              >
                {deleting ? 'Deleting...' : 'Delete Directory'}
              </button>
            </div>
          </div>
        </div>
      )}

      {user && (
        <ChangePasswordModal
          isOpen={showChangePassword}
          userId={user.id}
          usernameLabel={user.email}
          onClose={() => setShowChangePassword(false)}
          onSuccess={(msg) => showToast(msg)}
        />
      )}

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
