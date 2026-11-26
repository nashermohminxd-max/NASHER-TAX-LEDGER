import React, { useEffect, useState } from 'react';
import { FolderLock, Loader2, LogOut } from 'lucide-react';
import { ClientWorkspaceView } from '@/components/ClientWorkspaceView';
import { useAuth } from '@/lib/authContext';
import { getClientDirectoryById } from '@/lib/portalStore';
import type { ClientDirectory } from '@/types/portal';

export const ClientPortalPage: React.FC = () => {
  const { user, signOut } = useAuth();
  const [directory, setDirectory] = useState<ClientDirectory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const targetId = user?.clientDirectoryId;
    if (!targetId) {
      setDirectory(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    getClientDirectoryById(targetId)
      .then((found) => {
        if (active) setDirectory(found);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user?.clientDirectoryId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#DCEBFB] via-[#EEF5FC] to-[#F8FBFF] flex items-center justify-center p-4">
        <div className="flex items-center gap-2.5 rounded-2xl border border-white/90 bg-white/80 px-5 py-3.5 text-sm font-medium text-slate-700 shadow-sm backdrop-blur-xl">
          <Loader2 className="h-4 w-4 animate-spin text-[#0B4DA2]" />
          Loading your assigned tax directory...
        </div>
      </div>
    );
  }

  if (!directory) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#DCEBFB] via-[#EEF5FC] to-[#F8FBFF] flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md rounded-[24px] border-2 border-white/95 bg-white/80 p-8 shadow-[0_20px_50px_-15px_rgba(11,77,162,0.18)] backdrop-blur-2xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#E8F1FC] text-[#0B4DA2]">
            <FolderLock className="h-6 w-6" />
          </div>
          <h1 className="mt-4 font-display text-lg font-bold leading-snug text-slate-900">
            No Client Directory Assigned
          </h1>
          <p className="mt-2 text-xs text-slate-600 leading-relaxed break-words">
            Your account (<span className="break-all font-medium">{user?.email}</span>) is not yet linked to a taxpayer directory. Ask your NPB CPA Administrator to assign your client directory in the Admin Portal.
          </p>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-[#18181B] px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return <ClientWorkspaceView client={directory} isAdminMode={false} />;
};
