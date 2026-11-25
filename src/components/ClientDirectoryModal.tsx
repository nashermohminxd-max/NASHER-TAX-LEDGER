import React, { useMemo, useRef, useState } from 'react';
import {
  Building2,
  Check,
  Download,
  Edit3,
  FolderOpen,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { ClientProfile, ClientWorkspaceBackup } from '../types/tax';
import {
  buildClientWorkspaceBackup,
  getClientDirectoryStats,
} from '../utils/clientStorage';
import { triggerFileDownload } from '../utils/csvCodec';
import { formatTin } from '../utils/taxEngine';

interface ClientDirectoryModalProps {
  isOpen: boolean;
  clients: ClientProfile[];
  activeClientId: string;
  onClose: () => void;
  onSelectClient: (clientId: string) => void;
  onCreateClient: (params: {
    name: string;
    tin: string;
    rdo: string;
    includeSampleRows: boolean;
  }) => void;
  onUpdateClient: (client: ClientProfile) => void;
  onDeleteClient: (clientId: string) => void;
  onImportClientBackup: (backup: ClientWorkspaceBackup) => void;
}

export const ClientDirectoryModal: React.FC<ClientDirectoryModalProps> = ({
  isOpen,
  clients,
  activeClientId,
  onClose,
  onSelectClient,
  onCreateClient,
  onUpdateClient,
  onDeleteClient,
  onImportClientBackup,
}) => {
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newTin, setNewTin] = useState('');
  const [newRdo, setNewRdo] = useState('');
  const [includeSampleRows, setIncludeSampleRows] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTin, setEditTin] = useState('');
  const [editRdo, setEditRdo] = useState('');

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState('');

  const backupInputRef = useRef<HTMLInputElement>(null);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.tin ?? '').toLowerCase().includes(q) ||
        (c.rdo ?? '').toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q)
    );
  }, [clients, search]);

  if (!isOpen) return null;

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatusError('');
    if (!newName.trim()) {
      setStatusError('Please enter a client / company name.');
      return;
    }
    onCreateClient({
      name: newName.trim().toUpperCase(),
      tin: newTin.trim() ? formatTin(newTin) : '',
      rdo: newRdo.trim().toUpperCase(),
      includeSampleRows,
    });
    setNewName('');
    setNewTin('');
    setNewRdo('');
    setIncludeSampleRows(false);
  };

  const handleImportBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatusError('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ClientWorkspaceBackup;
      if (!parsed || !parsed.client || !Array.isArray(parsed.salesRows) || !Array.isArray(parsed.purchasesRows)) {
        setStatusError('Invalid client directory backup file.');
        e.target.value = '';
        return;
      }
      onImportClientBackup(parsed);
    } catch {
      setStatusError('Could not read client backup JSON file.');
    }
    e.target.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Client Directories ({clients.length})
              </h2>
              <p className="text-[11px] text-slate-500">
                Every client has its own isolated Sales, Purchases, TIN Directory, and Account Titles list
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={backupInputRef}
              type="file"
              accept=".json"
              onChange={handleImportBackupFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => backupInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5" />
              Import Client Backup
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {/* Create New Client Directory */}
          <form
            onSubmit={handleCreateSubmit}
            className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3"
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">
              Create New Segregated Client Directory
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12">
              <div className="sm:col-span-6">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="CLIENT / BUSINESS NAME (e.g. ABC TRADING CORP.)"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 uppercase focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-3">
                <input
                  type="text"
                  value={newTin}
                  onChange={(e) => setNewTin(formatTin(e.target.value))}
                  placeholder="CLIENT TIN (OPTIONAL)"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs tabular-nums-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-3">
                <input
                  type="text"
                  value={newRdo}
                  onChange={(e) => setNewRdo(e.target.value)}
                  placeholder="RDO (e.g. RDO 092)"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 uppercase focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeSampleRows}
                  onChange={(e) => setIncludeSampleRows(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                />
                Include sample PH transactions (uncheck for blank directory)
              </label>

              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Create Client Directory
              </button>
            </div>

            {statusError && (
              <div className="text-xs font-medium text-red-700">{statusError}</div>
            )}
          </form>

          {/* Client List Search */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search client directories by name, TIN, or RDO..."
                  className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 overflow-hidden">
              {filteredClients.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-slate-500">
                  No client directories match your search.
                </div>
              ) : (
                filteredClients.map((client) => {
                  const isActive = client.id === activeClientId;
                  const stats = getClientDirectoryStats(client.id);
                  const isEditing = editingId === client.id;
                  const isConfirmDelete = confirmDeleteId === client.id;

                  return (
                    <div
                      key={client.id}
                      className={`p-3.5 transition-colors ${
                        isActive ? 'bg-blue-50/50' : 'bg-white hover:bg-slate-50/80'
                      }`}
                    >
                      {isEditing ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="Client name"
                            className="flex-1 min-w-[180px] rounded border border-blue-300 bg-white px-2.5 py-1 text-xs uppercase"
                          />
                          <input
                            type="text"
                            value={editTin}
                            onChange={(e) => setEditTin(formatTin(e.target.value))}
                            placeholder="Client TIN"
                            className="w-36 rounded border border-blue-300 bg-white px-2.5 py-1 text-xs tabular-nums-mono"
                          />
                          <input
                            type="text"
                            value={editRdo}
                            onChange={(e) => setEditRdo(e.target.value)}
                            placeholder="RDO"
                            className="w-24 rounded border border-blue-300 bg-white px-2.5 py-1 text-xs uppercase"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (!editName.trim()) return;
                              onUpdateClient({
                                ...client,
                                name: editName.trim().toUpperCase(),
                                tin: editTin.trim() ? formatTin(editTin) : '',
                                rdo: editRdo.trim().toUpperCase(),
                                updatedAt: new Date().toISOString(),
                              });
                              setEditingId(null);
                            }}
                            className="rounded bg-emerald-600 p-1.5 text-white hover:bg-emerald-700 cursor-pointer"
                            title="Save changes"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100 cursor-pointer"
                            title="Cancel"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-display text-sm font-semibold text-slate-900 truncate">
                                {client.name}
                              </span>
                              {isActive && (
                                <span className="text-[11px] font-semibold text-blue-700">
                                  · Active Workspace
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                              {client.tin && (
                                <span className="tabular-nums-mono">TIN: {client.tin}</span>
                              )}
                              {client.rdo && <span>RDO: {client.rdo}</span>}
                              <span>
                                {stats.salesCount} Sales · {stats.purchasesCount} Purchases · {stats.tinCount} TINs
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            {!isActive && (
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectClient(client.id);
                                  onClose();
                                }}
                                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                              >
                                <FolderOpen className="h-3.5 w-3.5" />
                                Open
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                const backup = buildClientWorkspaceBackup(client);
                                triggerFileDownload(
                                  `${client.slug}-backup-${new Date().toISOString().slice(0, 10)}.json`,
                                  JSON.stringify(backup, null, 2),
                                  'application/json'
                                );
                              }}
                              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                              title="Download full client directory backup (.json)"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(client.id);
                                setEditName(client.name);
                                setEditTin(client.tin ?? '');
                                setEditRdo(client.rdo ?? '');
                                setConfirmDeleteId(null);
                              }}
                              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                              title="Rename / edit client info"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            {clients.length > 1 &&
                              (isConfirmDelete ? (
                                <div className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1">
                                  <span className="text-[11px] font-medium text-red-800">Delete?</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onDeleteClient(client.id);
                                      setConfirmDeleteId(null);
                                    }}
                                    className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-red-700 cursor-pointer"
                                  >
                                    Yes
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="rounded px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-white cursor-pointer"
                                  >
                                    No
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(client.id)}
                                  className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                                  title="Delete client directory"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
