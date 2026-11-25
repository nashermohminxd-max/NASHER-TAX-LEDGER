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
        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
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
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Share className="h-3.5 w-3.5" />
          Install iOS
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Install PH TaxLedger on iOS
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
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
                className="mt-5 w-full rounded-lg bg-slate-900 py-2 text-sm font-medium text-white hover:bg-slate-800"
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
