import React, { useEffect, useState } from 'react';
import {
  Check,
  Cloud,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  User as UserIcon,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { ALL_COLORS, COLOR_META } from '../data/theme';
import type { BattleSpiritsCard, CardColor, ProductSet } from '../types/card';
import { RulingsView } from './RulingsView';
import { PWAInstallButton } from './PWAControls';
import { SymbolIcon } from './SymbolIcon';
import { AdminCatalogSection } from './AdminCatalogSection';

interface SettingsViewProps {
  currentUser: User | null;
  authReady: boolean;
  signingIn: boolean;
  cloudSyncing: boolean;
  deckCount: number;
  folderCount: number;
  initialBio?: string;
  initialFavoriteColor?: CardColor;
  onSignInGoogle: () => void;
  onSignOutGoogle: () => void;
  onSyncNow: () => void;
  onSaveProfile: (bio: string, favoriteColor: CardColor) => Promise<boolean>;
  onCatalogImported?: (sets: ProductSet[], cards: BattleSpiritsCard[]) => void;
  onNotify?: (message: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  currentUser,
  authReady,
  signingIn,
  cloudSyncing,
  deckCount,
  folderCount,
  initialBio = '',
  initialFavoriteColor = 'Red',
  onSignInGoogle,
  onSignOutGoogle,
  onSyncNow,
  onSaveProfile,
  onCatalogImported,
  onNotify,
}) => {
  const [bio, setBio] = useState(initialBio);
  const [favoriteColor, setFavoriteColor] = useState<CardColor>(initialFavoriteColor);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    setBio(initialBio);
  }, [initialBio]);

  useEffect(() => {
    setFavoriteColor(initialFavoriteColor);
  }, [initialFavoriteColor]);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || savingProfile) return;
    setSavingProfile(true);
    setProfileSaved(false);
    try {
      const ok = await onSaveProfile(bio, favoriteColor);
      if (ok) {
        setProfileSaved(true);
        window.setTimeout(() => setProfileSaved(false), 2400);
      }
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-4 border-b border-slate-200/80">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 mb-1">
            <SettingsIcon className="w-3.5 h-3.5" />
            <span>Profile, Sync &amp; Official Rules</span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900">
            Settings
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Manage your Google Cloud account, deck backup, and official Battle Spirits rules.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <span
            className={`min-h-[36px] px-3 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 ${
              isOnline
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            {isOnline ? (
              <>
                <Wifi className="w-3.5 h-3.5" />
                <span>Online</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5" />
                <span>Offline Ready</span>
              </>
            )}
          </span>
          <PWAInstallButton />
        </div>
      </section>

      {/* Account, Profile & Cloud Sync Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Account & Profile Card */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {currentUser?.photoURL ? (
                <img
                  src={currentUser.photoURL}
                  alt={currentUser.displayName || 'Player'}
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-2xl object-cover border border-slate-200 shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                  <UserIcon className="w-6 h-6 text-slate-500" />
                </div>
              )}

              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold text-slate-900 truncate">
                  {currentUser
                    ? currentUser.displayName || 'Battle Spirits Player'
                    : 'Player Profile & Cloud Account'}
                </h2>
                <p className="text-xs text-slate-500 truncate">
                  {currentUser
                    ? currentUser.email || 'Signed in with Google'
                    : authReady
                    ? 'Sign in with Google to save decks and folders across devices'
                    : 'Checking authentication status...'}
                </p>
              </div>
            </div>

            {currentUser ? (
              <button
                type="button"
                onClick={onSignOutGoogle}
                className="min-h-[40px] px-3.5 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log Out</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignInGoogle}
                disabled={signingIn || !authReady}
                className="min-h-[44px] px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-2 shrink-0 cursor-pointer disabled:opacity-50 transition-colors"
              >
                {signingIn ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )}
                <span>{signingIn ? 'Signing in...' : 'Sign in with Google'}</span>
              </button>
            )}
          </div>

          {currentUser ? (
            <form onSubmit={handleProfileSubmit} className="space-y-4 pt-2 border-t border-slate-100">
              <div className="space-y-1.5">
                <label
                  htmlFor="settings-profile-bio"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Builder Bio / Notes
                </label>
                <textarea
                  id="settings-profile-bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={240}
                  rows={2}
                  placeholder="Share your favorite Battle Spirits archetype, format, or testing notes..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-600 focus:bg-white"
                />
              </div>

              <div className="space-y-1.5">
                <span className="block text-xs font-semibold text-slate-700">
                  Signature Core Color
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {ALL_COLORS.map((c) => {
                    const active = favoriteColor === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setFavoriteColor(c)}
                        className={`min-h-[38px] px-3 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                          active
                            ? 'bg-slate-900 border-slate-900 text-white'
                            : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <SymbolIcon color={c} size="xs" variant="gem" />
                        <span className={active ? 'text-white' : COLOR_META[c].text}>{c}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-[11px] text-slate-500">
                  Synced to your Firebase profile document.
                </span>
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="min-h-[40px] px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                >
                  {savingProfile ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : profileSaved ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  )}
                  <span>{profileSaved ? 'Profile Saved' : 'Save Profile'}</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs text-slate-600 leading-relaxed">
              Your decks and card catalog remain 100% usable locally and offline without signing in. Sign in with Google whenever you want automatic cloud backup for your deck lists and folders.
            </div>
          )}
        </div>

        {/* Cloud Sync & Offline Database Info Card */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cloud className="w-4 h-4 text-sky-600" />
                <h2 className="font-display text-base font-bold text-slate-900">
                  Deck Library &amp; Cloud Sync
                </h2>
              </div>
              {cloudSyncing && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Syncing...</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-center">
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
                <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
                  {deckCount}
                </div>
                <div className="text-[11px] font-medium text-slate-500">Saved Decks</div>
              </div>
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
                <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
                  {folderCount}
                </div>
                <div className="text-[11px] font-medium text-slate-500">Deck Folders</div>
              </div>
            </div>

            {currentUser ? (
              <button
                type="button"
                onClick={onSyncNow}
                disabled={cloudSyncing}
                className="w-full min-h-[44px] px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${cloudSyncing ? 'animate-spin' : ''}`} />
                <span>Backup {deckCount} Decks to Google Cloud</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignInGoogle}
                disabled={signingIn || !authReady}
                className="w-full min-h-[44px] px-4 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 transition-colors"
              >
                <LogIn className="w-4 h-4" />
                <span>Sign in to Enable Cloud Backup</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Admin Catalog Sync, Comparison, Safe Import & Manual Artwork URL Validation */}
      <AdminCatalogSection
        currentUser={currentUser}
        onCatalogImported={onCatalogImported}
        onNotify={onNotify}
      />

      {/* Official Rules, Format Guide, Turn Sequence & Reduction Cost Calculator */}
      <section className="pt-2 border-t border-slate-200">
        <RulingsView />
      </section>
    </div>
  );
};
