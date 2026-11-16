import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

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
        className="min-h-[36px] lg:min-h-[40px] px-3 rounded-xl bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 hover:bg-red-700 transition-colors cursor-pointer"
        aria-label="Install SpiritsDex app for offline access"
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">Install App</span>
        <span className="sm:hidden">Install</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="min-h-[36px] lg:min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 hover:bg-slate-50 transition-colors cursor-pointer"
          aria-label="How to install SpiritsDex on iOS"
        >
          <Smartphone className="w-3.5 h-3.5 shrink-0 text-red-600" />
          <span className="hidden sm:inline">Install on iOS</span>
          <span className="sm:hidden">Install</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
            onClick={() => setShowIOSGuide(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3
                    id="ios-install-title"
                    className="font-display text-base font-bold text-slate-900"
                  >
                    Install SpiritsDex on iOS
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Save to your Home Screen for offline card &amp; deck browsing.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="min-h-[36px] min-w-[36px] rounded-xl text-slate-500 hover:bg-slate-100 flex items-center justify-center shrink-0 cursor-pointer"
                  aria-label="Close install instructions"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="mt-3 space-y-2 text-xs text-slate-700 list-decimal list-inside">
                <li>
                  Tap the <strong className="text-slate-900">Share</strong> button in Safari&apos;s toolbar.
                </li>
                <li>
                  Scroll down and choose{' '}
                  <strong className="text-slate-900">Add to Home Screen</strong>.
                </li>
                <li>
                  Tap <strong className="text-slate-900">Add</strong> in the top corner.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full min-h-[40px] rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer"
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

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-16 lg:bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg border border-amber-500/40"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Offline Mode — Browsing cached cards &amp; decks</span>
    </div>
  );
};
