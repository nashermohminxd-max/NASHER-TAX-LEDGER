import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-[#F4F8FD] hover:text-[#0B4DA2] whitespace-nowrap shrink-0 cursor-pointer"
        title="Install TaxLedger for offline desktop or mobile access"
      >
        <Download className="h-3.5 w-3.5" />
        Install App
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-[#F4F8FD] hover:text-[#0B4DA2] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Share className="h-3.5 w-3.5" />
          Install iOS
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B2240]/30 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-[24px] border-2 border-white bg-white/95 p-6 shadow-2xl shadow-[#0B4DA2]/15 backdrop-blur-xl">
              <div className="flex items-start justify-between gap-4">
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Install NPB Tax Ledger on iOS
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
                  aria-label="Close install guide"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ol className="mt-3 space-y-2 text-sm text-slate-600">
                <li>1. Tap the <strong>Share</strong> icon in your Safari toolbar.</li>
                <li>2. Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                <li>3. Tap <strong>Add</strong> to launch offline anytime.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-[#18181B] py-2.5 text-sm font-semibold text-white hover:bg-black cursor-pointer"
              >
                Got It
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
