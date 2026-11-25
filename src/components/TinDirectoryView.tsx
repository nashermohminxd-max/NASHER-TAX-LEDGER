import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  Edit3,
  GitMerge,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { EntityType, TaxStatus, TinRecord, TransactionCategory } from '../types/tax';
import {
  exportTinDirectoryCsv,
  importTinDirectoryCsv,
  triggerFileDownload,
} from '../utils/csvCodec';
import { formatTin, isValidTinDigits, normalizeTinDigits } from '../utils/taxEngine';

interface TinDirectoryViewProps {
  clientName: string;
  clientSlug: string;
  records: TinRecord[];
  onUpsertRecord: (record: TinRecord) => void;
  onDeleteRecord: (id: string) => void;
  onBulkImport: (records: TinRecord[]) => void;
  onMergeDuplicates: (digitsKey: string) => void;
}

export const TinDirectoryView: React.FC<TinDirectoryViewProps> = ({
  clientName,
  clientSlug,
  records,
  onUpsertRecord,
  onDeleteRecord,
  onBulkImport,
  onMergeDuplicates,
}) => {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TinRecord | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRecord, setNewRecord] = useState({
    tin: '',
    payor: '',
    branchTradeName: '',
    address: '',
    address2: '',
    defaultPrivateOrGovt: 'PRIVATE' as EntityType,
    defaultCategory: 'GOODS' as TransactionCategory,
    defaultTaxStatus: 'VATABLE' as TaxStatus,
  });
  const [statusMessage, setStatusMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Detect exact normalized-digit duplicates or shared 9-digit root TINs
  const duplicateGroups = useMemo(() => {
    const byDigits = new Map<string, TinRecord[]>();
    records.forEach((rec) => {
      const key = rec.digits || normalizeTinDigits(rec.tin);
      if (!key) return;
      const list = byDigits.get(key) ?? [];
      list.push(rec);
      byDigits.set(key, list);
    });
    const exactDupKeys = new Set<string>();
    byDigits.forEach((list, k) => {
      if (list.length > 1) exactDupKeys.add(k);
    });
    return exactDupKeys;
  }, [records]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = normalizeTinDigits(search);
    return records.filter((r) => {
      if (!q) return true;
      if (qDigits && r.digits.includes(qDigits)) return true;
      return (
        r.payor.toLowerCase().includes(q) ||
        r.branchTradeName.toLowerCase().includes(q) ||
        r.address.toLowerCase().includes(q) ||
        (r.address2 ?? '').toLowerCase().includes(q) ||
        r.tin.toLowerCase().includes(q)
      );
    });
  }, [records, search]);

  const startEdit = (rec: TinRecord) => {
    setEditingId(rec.id);
    setDraft({ ...rec });
  };

  const saveEdit = () => {
    if (!draft) return;
    const digits = normalizeTinDigits(draft.tin);
    onUpsertRecord({
      ...draft,
      tin: formatTin(digits),
      digits,
      payor: draft.payor.trim().toUpperCase(),
      branchTradeName: draft.branchTradeName.trim().toUpperCase(),
      address: draft.address.trim().toUpperCase(),
      address2: (draft.address2 ?? '').trim().toUpperCase(),
      updatedAt: new Date().toISOString(),
    });
    setEditingId(null);
    setDraft(null);
  };

  const handleAddNew = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = normalizeTinDigits(newRecord.tin);
    if (!digits || !newRecord.payor.trim()) return;
    const now = new Date().toISOString();
    onUpsertRecord({
      id: `tin-${digits}-${Date.now()}`,
      tin: formatTin(digits),
      digits,
      payor: newRecord.payor.trim().toUpperCase(),
      branchTradeName: newRecord.branchTradeName.trim().toUpperCase(),
      address: newRecord.address.trim().toUpperCase(),
      address2: newRecord.address2.trim().toUpperCase(),
      defaultPrivateOrGovt: newRecord.defaultPrivateOrGovt,
      defaultCategory: newRecord.defaultCategory,
      defaultTaxStatus: newRecord.defaultTaxStatus,
      createdAt: now,
      updatedAt: now,
    });
    setNewRecord({
      tin: '',
      payor: '',
      branchTradeName: '',
      address: '',
      address2: '',
      defaultPrivateOrGovt: 'PRIVATE',
      defaultCategory: 'GOODS',
      defaultTaxStatus: 'VATABLE',
    });
    setShowAddForm(false);
    setStatusMessage('Saved TIN profile to directory.');
    setTimeout(() => setStatusMessage(''), 2500);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    let parsed: TinRecord[] = [];
    if (file.name.toLowerCase().endsWith('.json')) {
      try {
        const json = JSON.parse(text);
        if (Array.isArray(json)) {
          const now = new Date().toISOString();
          parsed = json
            .filter((x) => x && (x.tin || x.digits) && x.payor)
            .map((x, idx) => {
              const digits = normalizeTinDigits(x.digits || x.tin);
              return {
                id: x.id || `tin-${digits}-${idx}`,
                tin: formatTin(digits),
                digits,
                payor: String(x.payor || '').toUpperCase(),
                branchTradeName: String(x.branchTradeName || '').toUpperCase(),
                address: String(x.address || '').toUpperCase(),
                address2: String(x.address2 || '').toUpperCase(),
                defaultPrivateOrGovt: x.defaultPrivateOrGovt === 'GOVT' ? 'GOVT' : 'PRIVATE',
                defaultCategory:
                  x.defaultCategory === 'SERVICES' || x.defaultCategory === 'RENTAL'
                    ? x.defaultCategory
                    : 'GOODS',
                defaultTaxStatus: x.defaultTaxStatus === 'NON_VAT' ? 'NON_VAT' : 'VATABLE',
                createdAt: x.createdAt || now,
                updatedAt: now,
              };
            });
        }
      } catch {
        setStatusMessage('Invalid JSON file.');
      }
    } else {
      parsed = importTinDirectoryCsv(text);
    }

    if (parsed.length > 0) {
      onBulkImport(parsed);
      setStatusMessage(`Imported ${parsed.length} TIN profiles.`);
      setTimeout(() => setStatusMessage(''), 3000);
    }
    e.target.value = '';
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              {clientName} — BIR RELIEF TIN Master Directory
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {records.length} indexed profiles · Isolated to {clientName} for instant &quot;If Nibalik Na&quot; auto-fill
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json"
              onChange={handleImportFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5" />
              Import CSV / JSON
            </button>
            <button
              type="button"
              onClick={() =>
                triggerFileDownload(
                  `${clientSlug}-tin-master-directory.csv`,
                  exportTinDirectoryCsv(records)
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() =>
                triggerFileDownload(
                  `${clientSlug}-tin-master-directory.json`,
                  JSON.stringify(records, null, 2),
                  'application/json'
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Export JSON
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              New TIN Profile
            </button>
          </div>
        </div>

        {/* Search & Duplicate Banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search TIN digits, payor, branch, or address..."
              className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            {statusMessage && (
              <span className="font-medium text-emerald-700">{statusMessage}</span>
            )}
            {duplicateGroups.size > 0 && (
              <div className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1 text-amber-900">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                <span>{duplicateGroups.size} duplicate TIN group(s) detected</span>
                {Array.from(duplicateGroups).map((digitsKey) => (
                  <button
                    key={digitsKey}
                    type="button"
                    onClick={() => onMergeDuplicates(digitsKey)}
                    className="inline-flex items-center gap-1 rounded bg-amber-200/80 px-2 py-0.5 text-[11px] font-semibold text-amber-950 hover:bg-amber-300 cursor-pointer"
                  >
                    <GitMerge className="h-3 w-3" />
                    Merge {formatTin(digitsKey)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Add Form */}
        {showAddForm && (
          <form
            onSubmit={handleAddNew}
            className="border-b border-slate-200 bg-blue-50/40 px-5 py-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                Add TIN Master Record
              </h3>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
              <input
                type="text"
                required
                value={newRecord.tin}
                onChange={(e) => setNewRecord({ ...newRecord, tin: formatTin(e.target.value) })}
                placeholder="TIN (000-000-000-000)"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs tabular-nums-mono"
              />
              <input
                type="text"
                required
                value={newRecord.payor}
                onChange={(e) => setNewRecord({ ...newRecord, payor: e.target.value })}
                placeholder="PAYOR / SUPPLIER NAME"
                className="lg:col-span-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs uppercase"
              />
              <input
                type="text"
                value={newRecord.branchTradeName}
                onChange={(e) => setNewRecord({ ...newRecord, branchTradeName: e.target.value })}
                placeholder="BRANCH / TRADE NAME"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs uppercase"
              />
              <input
                type="text"
                value={newRecord.address}
                onChange={(e) => setNewRecord({ ...newRecord, address: e.target.value })}
                placeholder="ADDRESS 1 (BRGY / MUNICIPALITY)"
                className="lg:col-span-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs uppercase"
              />
              <input
                type="text"
                value={newRecord.address2}
                onChange={(e) => setNewRecord({ ...newRecord, address2: e.target.value })}
                placeholder="ADDRESS 2 (CITY / DISTRICT)"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs uppercase"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={newRecord.defaultPrivateOrGovt}
                  onChange={(e) =>
                    setNewRecord({
                      ...newRecord,
                      defaultPrivateOrGovt: e.target.value as EntityType,
                    })
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="PRIVATE">Default: PRIVATE</option>
                  <option value="GOVT">Default: GOVT</option>
                </select>
                <select
                  value={newRecord.defaultCategory}
                  onChange={(e) =>
                    setNewRecord({
                      ...newRecord,
                      defaultCategory: e.target.value as TransactionCategory,
                    })
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="GOODS">Default: GOODS</option>
                  <option value="SERVICES">Default: SERVICES</option>
                  <option value="RENTAL">Default: RENTAL</option>
                </select>
                <select
                  value={newRecord.defaultTaxStatus}
                  onChange={(e) =>
                    setNewRecord({
                      ...newRecord,
                      defaultTaxStatus: e.target.value as TaxStatus,
                    })
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="VATABLE">Default: VATABLE</option>
                  <option value="NON_VAT">Default: NON-VAT/EXEMPT</option>
                </select>
              </div>
              <button
                type="submit"
                className="rounded-lg bg-blue-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
              >
                Save Profile
              </button>
            </div>
          </form>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100 text-slate-700">
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap">TIN</th>
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap">PAYOR / SUPPLIER</th>
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap">BRANCH / TRADE NAME</th>
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap">BRGY / MUNICIPALITY</th>
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap">CITY / DISTRICT</th>
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap">DEFAULTS</th>
                <th className="px-4 py-2.5 text-center font-semibold whitespace-nowrap">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-slate-500">
                    No TIN profiles match your search.
                  </td>
                </tr>
              ) : (
                filtered.map((rec) => {
                  const isEditing = editingId === rec.id && draft;
                  const isDup = duplicateGroups.has(rec.digits);
                  const validLen = isValidTinDigits(rec.digits);

                  if (isEditing && draft) {
                    return (
                      <tr key={rec.id} className="bg-blue-50/40">
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={draft.tin}
                            onChange={(e) =>
                              setDraft({ ...draft, tin: formatTin(e.target.value) })
                            }
                            className="w-36 rounded border border-blue-300 bg-white px-2 py-1 text-xs tabular-nums-mono"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={draft.payor}
                            onChange={(e) => setDraft({ ...draft, payor: e.target.value })}
                            className="w-full min-w-[160px] rounded border border-blue-300 bg-white px-2 py-1 text-xs uppercase"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={draft.branchTradeName}
                            onChange={(e) =>
                              setDraft({ ...draft, branchTradeName: e.target.value })
                            }
                            className="w-full min-w-[120px] rounded border border-blue-300 bg-white px-2 py-1 text-xs uppercase"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={draft.address}
                            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                            placeholder="Brgy / Municipality"
                            className="w-full min-w-[150px] rounded border border-blue-300 bg-white px-2 py-1 text-xs uppercase"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={draft.address2 ?? ''}
                            onChange={(e) => setDraft({ ...draft, address2: e.target.value })}
                            placeholder="City / District"
                            className="w-full min-w-[140px] rounded border border-blue-300 bg-white px-2 py-1 text-xs uppercase"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <select
                              value={draft.defaultPrivateOrGovt}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  defaultPrivateOrGovt: e.target.value as EntityType,
                                })
                              }
                              className="rounded border border-blue-300 bg-white px-1.5 py-1 text-[11px]"
                            >
                              <option value="PRIVATE">PRIVATE</option>
                              <option value="GOVT">GOVT</option>
                            </select>
                            <select
                              value={draft.defaultCategory}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  defaultCategory: e.target.value as TransactionCategory,
                                })
                              }
                              className="rounded border border-blue-300 bg-white px-1.5 py-1 text-[11px]"
                            >
                              <option value="GOODS">GOODS</option>
                              <option value="SERVICES">SERVICES</option>
                              <option value="RENTAL">RENTAL</option>
                            </select>
                            <select
                              value={draft.defaultTaxStatus}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  defaultTaxStatus: e.target.value as TaxStatus,
                                })
                              }
                              className="rounded border border-blue-300 bg-white px-1.5 py-1 text-[11px]"
                            >
                              <option value="VATABLE">VATABLE</option>
                              <option value="NON_VAT">NON-VAT</option>
                            </select>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={saveEdit}
                              className="rounded bg-emerald-600 p-1 text-white hover:bg-emerald-700 cursor-pointer"
                              title="Save"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(null);
                                setDraft(null);
                              }}
                              className="rounded border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-100 cursor-pointer"
                              title="Cancel"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr
                      key={rec.id}
                      className={`hover:bg-slate-50 ${isDup ? 'bg-amber-50/40' : ''}`}
                    >
                      <td className="px-4 py-2.5 tabular-nums-mono whitespace-nowrap font-semibold text-slate-900">
                        <div className="flex items-center gap-1.5">
                          <span>{rec.tin}</span>
                          {!validLen && (
                            <span
                              title="TIN should be 9 or 12 digits"
                              className="text-amber-600"
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                            </span>
                          )}
                          {isDup && (
                            <span className="text-[11px] font-medium text-amber-700">
                              (Duplicate)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{rec.payor}</td>
                      <td className="px-4 py-2.5 text-slate-700">{rec.branchTradeName || '-'}</td>
                      <td className="px-4 py-2.5 max-w-[180px] truncate text-slate-600" title={rec.address}>
                        {rec.address || '-'}
                      </td>
                      <td className="px-4 py-2.5 max-w-[160px] truncate text-slate-600" title={rec.address2 ?? ''}>
                        {rec.address2 || '-'}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        <span>{rec.defaultPrivateOrGovt}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{rec.defaultCategory}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{rec.defaultTaxStatus === 'VATABLE' ? 'VATable' : 'Non-VAT'}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(rec)}
                            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                            title="Edit TIN profile"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteRecord(rec.id)}
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                            title="Delete TIN profile"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
