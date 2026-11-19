import React, { useMemo, useRef, useState } from 'react';
import {
  Plus,
  Minus,
  Copy,
  Check,
  Trash2,
  FolderPlus,
  AlertTriangle,
  Download,
  Loader2,
  FileText,
  ClipboardPaste,
  X,
  FileDown,
  FileJson,
  FileSpreadsheet,
  Share2,
  Link2,
  Shuffle,
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Pencil,
  Search,
  LayoutGrid,
  List,
  Maximize2,
  Cloud,
} from 'lucide-react';
import {
  BattleSpiritsCard,
  BattleSymbolKind,
  CardColor,
  CardType,
  Deck,
  DeckEntry,
  DeckFolder,
  GameFormat,
} from '../types/card';
import { ALL_COLORS, ALL_TYPES, COLOR_META } from '../data/theme';
import { CardArtwork } from './CardArtwork';
import { SymbolIcon } from './SymbolIcon';
import { DeckCompositionChart } from './DeckCompositionChart';
import { DeckCostChart } from './DeckCostChart';
import { DeckStatsPanel } from './DeckStatsPanel';
import { DeckD3Charts } from './DeckD3Charts';
import { TestHandPanel } from './TestHandPanel';
import { useWikiImagePrefetch } from '../hooks/useWikiImagePrefetch';
import { buildShareDeckUrl } from '../utils/deckShare';
import { getMaxCardCopies, isTokenCard } from '../utils/cardRules';
import {
  buildImportedDeckEntries,
  parseDecklistText,
} from '../utils/decklistImport';

interface DeckBuilderViewProps {
  decks: Deck[];
  folders?: DeckFolder[];
  activeDeckId: string;
  cardsById: Record<string, BattleSpiritsCard>;
  onSelectDeck: (deckId: string) => void;
  onCreateDeck: (
    name: string,
    format: GameFormat,
    archetype: string,
    folderId?: string
  ) => void;
  onCreateFolder?: (name: string, color?: CardColor) => string;
  onRenameFolder?: (folderId: string, name: string, color?: CardColor) => void;
  onDeleteFolder?: (folderId: string) => void;
  onMoveDeckToFolder?: (deckId: string, folderId?: string) => void;
  onChangeDeckFormat: (deckId: string, format: GameFormat) => void;
  onRemoveIllegalCards: (deckId: string) => void;
  onDeleteDeck: (deckId: string) => void;
  onUpdateCardQty: (cardId: string, delta: number) => void;
  onImportDeckEntries: (options: {
    mode: 'replace' | 'merge' | 'new';
    entries: DeckEntry[];
    newDeckName?: string;
    newDeckFormat?: GameFormat;
    newDeckArchetype?: string;
    newDeckFolderId?: string;
  }) => void;
  onInspectCard: (card: BattleSpiritsCard) => void;
  onBrowseCatalog: () => void;
  cloudUserEmail?: string | null;
  cloudSyncing?: boolean;
  onSignInGoogle?: () => void;
  onSyncNow?: () => void;
  onNotify?: (message: string) => void;
}

export const DeckBuilderView: React.FC<DeckBuilderViewProps> = ({
  decks,
  folders = [],
  activeDeckId,
  cardsById,
  onSelectDeck,
  onCreateDeck,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveDeckToFolder,
  onChangeDeckFormat,
  onRemoveIllegalCards,
  onDeleteDeck,
  onUpdateCardQty,
  onImportDeckEntries,
  onInspectCard,
  onBrowseCatalog,
  cloudUserEmail,
  cloudSyncing = false,
  onSignInGoogle,
  onSyncNow,
  onNotify,
}) => {
  const [creating, setCreating] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [newDeckFormat, setNewDeckFormat] = useState<GameFormat>('Standard');
  const [newArchetype, setNewArchetype] = useState('');
  const [newDeckFolderId, setNewDeckFolderId] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMode, setImportMode] = useState<'replace' | 'merge' | 'new'>('replace');
  const [importDeckName, setImportDeckName] = useState('');
  const [importDeckFormat, setImportDeckFormat] = useState<GameFormat | null>(null);
  const [importDeckFolderId, setImportDeckFolderId] = useState<string>('');
  const importTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const [showTextExport, setShowTextExport] = useState(false);
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [lastExportedFormat, setLastExportedFormat] = useState<'json' | 'csv' | null>(null);
  const [textFormatMode, setTextFormatMode] = useState<'grouped' | 'compact'>('grouped');
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [testingHand, setTestingHand] = useState(false);

  const [selectedFolderFilter, setSelectedFolderFilter] = useState<string>('all');
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Record<string, boolean>>({});
  const [deckSearchQuery, setDeckSearchQuery] = useState('');
  const [folderFormMode, setFolderFormMode] = useState<'closed' | 'create' | 'rename'>('closed');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderFormName, setFolderFormName] = useState('');
  const [folderFormColor, setFolderFormColor] = useState<CardColor | ''>('Red');
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);
  const [rosterViewMode, setRosterViewMode] = useState<'list' | 'images'>('list');
  const [fullDeckGalleryOpen, setFullDeckGalleryOpen] = useState(false);

  const activeDeck = decks.find((d) => d.id === activeDeckId) || decks[0];
  const activeFormat: GameFormat = activeDeck?.format || 'Eternal';
  const allCardsList = useMemo(() => Object.values(cardsById), [cardsById]);

  const folderIdsSet = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);
  const effectiveFolderFilter =
    selectedFolderFilter === 'all' ||
    selectedFolderFilter === 'uncategorized' ||
    folderIdsSet.has(selectedFolderFilter)
      ? selectedFolderFilter
      : 'all';

  const folderGroups = useMemo(() => {
    const q = deckSearchQuery.trim().toLowerCase();
    const matchesSearch = (d: Deck) => {
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        (d.archetype || '').toLowerCase().includes(q) ||
        (d.category || '').toLowerCase().includes(q)
      );
    };

    const groups: {
      id: string;
      name: string;
      color?: CardColor;
      decks: Deck[];
      isUncategorized?: boolean;
    }[] = [];

    for (const folder of folders) {
      const inFolder = decks.filter((d) => d.folderId === folder.id && matchesSearch(d));
      groups.push({
        id: folder.id,
        name: folder.name,
        color: folder.color,
        decks: inFolder,
      });
    }

    const uncategorized = decks.filter(
      (d) => (!d.folderId || !folderIdsSet.has(d.folderId)) && matchesSearch(d)
    );
    if (uncategorized.length > 0 || folders.length === 0) {
      groups.push({
        id: 'uncategorized',
        name: folders.length > 0 ? 'Uncategorized' : 'Saved Decks',
        decks: uncategorized,
        isUncategorized: true,
      });
    }

    return {
      allGroups: groups,
      uncategorizedCount: decks.filter((d) => !d.folderId || !folderIdsSet.has(d.folderId))
        .length,
    };
  }, [decks, folders, folderIdsSet, deckSearchQuery]);

  const visibleFolderGroups = useMemo(() => {
    if (effectiveFolderFilter === 'all') return folderGroups.allGroups;
    return folderGroups.allGroups.filter((g) => g.id === effectiveFolderFilter);
  }, [folderGroups.allGroups, effectiveFolderFilter]);

  const activeFolderObj =
    effectiveFolderFilter !== 'all' && effectiveFolderFilter !== 'uncategorized'
      ? folders.find((f) => f.id === effectiveFolderFilter) || null
      : null;

  const effectiveImportMode: 'replace' | 'merge' | 'new' = activeDeck ? importMode : 'new';
  const targetImportFormat: GameFormat =
    effectiveImportMode === 'new' ? importDeckFormat || activeFormat : activeFormat;

  const importPreview = useMemo(() => {
    if (!importText.trim()) return null;
    return parseDecklistText(importText, allCardsList, targetImportFormat);
  }, [importText, allCardsList, targetImportFormat]);

  const resolvedNewImportFormat: GameFormat =
    importDeckFormat || importPreview?.detectedFormat || 'Eternal';

  const safeDeckEntries = Array.isArray(activeDeck?.entries) ? activeDeck.entries : [];
  const resolvedEntries = activeDeck
    ? safeDeckEntries
        .filter((entry): entry is DeckEntry => Boolean(entry && typeof entry.cardId === 'string'))
        .map((entry) => ({
          ...entry,
          quantity: Math.max(0, Math.round(Number(entry.quantity) || 0)),
          card: cardsById[entry.cardId],
        }))
        .filter((item): item is { cardId: string; quantity: number; card: BattleSpiritsCard } =>
          Boolean(item.card && item.quantity > 0)
        )
    : [];

  const getMaxCopies = (card: BattleSpiritsCard) => getMaxCardCopies(card);

  const formatIllegalEntries = resolvedEntries.filter(
    ({ card }) =>
      activeFormat === 'Standard' && !(card.formats || ['Eternal']).includes('Standard')
  );

  const restrictionViolations = resolvedEntries.filter(
    ({ card, quantity }) => quantity > getMaxCopies(card)
  );

  const hasViolations = formatIllegalEntries.length > 0 || restrictionViolations.length > 0;

  const totalCards = resolvedEntries.reduce((sum, item) => sum + item.quantity, 0);
  const targetMin = 40;
  const progressPct = Math.min(100, Math.round((totalCards / targetMin) * 100));

  const [selectedCostBucket, setSelectedCostBucket] = useState<number | null>(null);

  const deckCardsForPrefetch = useMemo(
    () => resolvedEntries.map((entry) => entry.card),
    [resolvedEntries]
  );

  useWikiImagePrefetch({
    cards: deckCardsForPrefetch,
    currentIndex: 0,
    lookahead: fullDeckGalleryOpen ? 16 : 8,
    lookbehind: 0,
    enabled:
      deckCardsForPrefetch.length > 0 &&
      (rosterViewMode === 'images' || fullDeckGalleryOpen),
  });

  const typeCounts = ALL_TYPES.reduce((acc, type) => {
    acc[type] = resolvedEntries
      .filter((e) => e.card.type === type)
      .reduce((sum, e) => sum + e.quantity, 0);
    return acc;
  }, {} as Record<CardType, number>);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newDeckName.trim();
    if (!trimmed) return;
    onCreateDeck(
      trimmed,
      newDeckFormat,
      newArchetype.trim() || `${newDeckFormat} Build`,
      newDeckFolderId || undefined
    );
    setNewDeckName('');
    setNewArchetype('');
    setNewDeckFolderId('');
    setCreating(false);
  };

  const handleFolderFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = folderFormName.trim();
    if (!trimmed) return;
    const chosenColor = folderFormColor || undefined;
    if (folderFormMode === 'rename' && editingFolderId) {
      onRenameFolder?.(editingFolderId, trimmed, chosenColor);
    } else if (folderFormMode === 'create' && onCreateFolder) {
      const createdId = onCreateFolder(trimmed, chosenColor);
      if (createdId) {
        setSelectedFolderFilter(createdId);
      }
    }
    setFolderFormName('');
    setEditingFolderId(null);
    setFolderFormMode('closed');
  };

  const buildDecklistText = (mode: 'grouped' | 'compact' = textFormatMode) => {
    if (!activeDeck) return '';
    if (mode === 'compact') {
      return [
        `// ${activeDeck.name} (${activeFormat} · ${totalCards} cards)`,
        ...resolvedEntries.map(
          ({ card, quantity }) => `${quantity} ${card.cardNumber} ${card.name}`
        ),
      ].join('\n');
    }

    const sections: string[] = [
      `// ${activeDeck.name} [${activeFormat}] (${totalCards} cards)`,
    ];
    for (const type of ALL_TYPES) {
      const items = resolvedEntries.filter((e) => e.card.type === type);
      if (items.length === 0) continue;
      const typeQty = items.reduce((s, e) => s + e.quantity, 0);
      sections.push('');
      sections.push(`// ${type} (${typeQty})`);
      for (const { card, quantity } of items) {
        sections.push(`${quantity}x ${card.name} [${card.cardNumber}]`);
      }
    }
    return sections.join('\n');
  };

  const copyTextToClipboard = async (text: string): Promise<boolean> => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // fall through to textarea fallback for sandboxed iframes
      }
    }
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  };

  const handleCopyList = async () => {
    if (!activeDeck || resolvedEntries.length === 0) return;
    const text = buildDecklistText(textFormatMode);
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopied(true);
      onNotify?.(`Copied ${activeDeck.name} deck list to clipboard`);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setShowTextExport(true);
      onNotify?.('Select and copy the deck list text below');
    }
  };

  const handleDownloadImage = async () => {
    if (!activeDeck || resolvedEntries.length === 0 || downloading) return;
    setDownloading(true);
    try {
      const { exportDecklistImage } = await import('../utils/deckImageExporter');
      const filename = await exportDecklistImage(activeDeck, resolvedEntries);
      setDownloaded(true);
      onNotify?.(`Saved ${filename}`);
      setTimeout(() => setDownloaded(false), 2400);
    } catch {
      onNotify?.('Could not generate decklist image');
    } finally {
      setDownloading(false);
    }
  };

  const handleExportDeckFile = async (fileFormat: 'json' | 'csv') => {
    if (!activeDeck || resolvedEntries.length === 0) return;
    try {
      const { exportDeckAsFile } = await import('../utils/deckDataExporter');
      const filename = exportDeckAsFile(activeDeck, resolvedEntries, fileFormat);
      setLastExportedFormat(fileFormat);
      onNotify?.(`Exported ${filename}`);
      setTimeout(() => setLastExportedFormat(null), 2400);
    } catch {
      onNotify?.(`Could not export ${fileFormat.toUpperCase()} file`);
    }
  };

  const handleShareDeck = async () => {
    if (!activeDeck || resolvedEntries.length === 0) return;
    const url = buildShareDeckUrl(activeDeck, resolvedEntries);
    setShareUrl(url);
    setShowExportOptions(false);
    setShowTextExport(false);
    const ok = await copyTextToClipboard(url);
    if (ok) {
      setShareCopied(true);
      onNotify?.(`Copied shareable link for "${activeDeck.name}"`);
      setTimeout(() => setShareCopied(false), 2600);
    } else {
      onNotify?.('Shareable deck link generated below');
    }
  };

  const handlePasteFromClipboard = async () => {
    if (navigator.clipboard?.readText) {
      try {
        const clip = await navigator.clipboard.readText();
        if (clip.trim()) {
          setImportText(clip);
          onNotify?.('Pasted deck list from clipboard');
          return;
        }
      } catch {
        // clipboard read denied inside iframe; focus textarea instead
      }
    }
    importTextareaRef.current?.focus();
    onNotify?.('Paste your deck list text directly into the box');
  };

  const handleApplyImport = () => {
    if (!importPreview || importPreview.aggregatedEntries.length === 0) return;

    const existingEntries = activeDeck ? activeDeck.entries : [];
    const { entries, cappedCards } = buildImportedDeckEntries(
      importPreview.aggregatedEntries,
      existingEntries,
      effectiveImportMode
    );

    const resolvedFormat: GameFormat =
      effectiveImportMode === 'new' ? resolvedNewImportFormat : activeFormat;

    const resolvedName =
      importDeckName.trim() ||
      importPreview.detectedDeckName ||
      `Imported ${resolvedFormat} Deck`;

    onImportDeckEntries({
      mode: effectiveImportMode,
      entries,
      newDeckName: resolvedName,
      newDeckFormat: resolvedFormat,
      newDeckArchetype: 'Imported List',
      newDeckFolderId: importDeckFolderId || undefined,
    });

    if (cappedCards.length > 0) {
      onNotify?.(
        `Applied restriction/3-copy cap to: ${cappedCards.slice(0, 3).join(', ')}${
          cappedCards.length > 3 ? ` +${cappedCards.length - 3} more` : ''
        }`
      );
    }

    setImportText('');
    setImportDeckName('');
    setImportDeckFormat(null);
    setImportDeckFolderId('');
    setImporting(false);
  };

  const deckStatusLabel = hasViolations
    ? 'Format / Copy Violation'
    : totalCards >= 40
    ? `Legal (${activeFormat === 'Standard' ? 'STD' : 'ETN'})`
    : `Need ${40 - totalCards} more`;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl font-bold text-slate-900">Deck Builder</h1>
            {cloudUserEmail ? (
              <button
                type="button"
                onClick={onSyncNow}
                disabled={cloudSyncing}
                className="min-h-[28px] px-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold inline-flex items-center gap-1.5 cursor-pointer hover:bg-emerald-100 disabled:opacity-60"
                title={`Synced with ${cloudUserEmail}`}
              >
                {cloudSyncing ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Cloud className="w-3 h-3" />
                )}
                <span>{cloudSyncing ? 'Syncing Cloud...' : 'Saved to Google Cloud'}</span>
              </button>
            ) : (
              onSignInGoogle && (
                <button
                  type="button"
                  onClick={onSignInGoogle}
                  className="min-h-[28px] px-2.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-[11px] font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Cloud className="w-3 h-3 text-slate-500" />
                  <span>Sign in with Google to Back Up Decks</span>
                </button>
              )
            )}
          </div>
          <p className="text-sm text-slate-500">
            Build for Standard (Block A cards only) or Eternal (all-era cards), 40+ cards, max 3 copies unless restricted.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {activeDeck && (
            <button
              type="button"
              onClick={() => {
                setTestingHand((v) => !v);
                setImporting(false);
                setCreating(false);
              }}
              aria-pressed={testingHand}
              className={`min-h-[44px] px-4 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer border whitespace-nowrap ${
                testingHand
                  ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                  : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Shuffle className="w-4 h-4" />
              <span>Test Hand</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setImporting((v) => !v);
              setCreating(false);
              setTestingHand(false);
              setFolderFormMode('closed');
              if (!activeDeck) setImportMode('new');
              if (activeFolderObj) setImportDeckFolderId(activeFolderObj.id);
            }}
            className={`min-h-[44px] px-4 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer border whitespace-nowrap ${
              importing
                ? 'bg-red-50 text-red-700 border-red-200'
                : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <ClipboardPaste className="w-4 h-4" />
            <span>Import List</span>
          </button>
          {onCreateFolder && (
            <button
              type="button"
              onClick={() => {
                setFolderFormMode((prev) => (prev === 'create' ? 'closed' : 'create'));
                setEditingFolderId(null);
                setFolderFormName('');
                setFolderFormColor('Red');
                setCreating(false);
                setImporting(false);
                setTestingHand(false);
              }}
              className={`min-h-[44px] px-4 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer border whitespace-nowrap ${
                folderFormMode === 'create'
                  ? 'bg-slate-100 text-slate-900 border-slate-300'
                  : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Folder className="w-4 h-4" />
              <span>New Folder</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setCreating((v) => !v);
              setImporting(false);
              setTestingHand(false);
              setFolderFormMode('closed');
              if (activeFolderObj) setNewDeckFolderId(activeFolderObj.id);
            }}
            className="min-h-[44px] px-4 rounded-xl bg-slate-900 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors shrink-0 cursor-pointer whitespace-nowrap"
          >
            <FolderPlus className="w-4 h-4" />
            <span>New Deck</span>
          </button>
        </div>
      </div>

      {importing && (
        <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Import Deck List from Text
              </h2>
              <p className="text-xs text-slate-500">
                Paste a deck list using Card Name + Number (e.g.{' '}
                <code className="font-mono text-slate-700">3x Petristar [26RBS01-001]</code> or{' '}
                <code className="font-mono text-slate-700">3 26RBS01-001 Petristar</code>) to match against the database.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setImporting(false)}
              className="min-h-[36px] min-w-[36px] rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              aria-label="Close import panel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Import Mode + Target Deck Settings */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-5">
              <div className="text-xs font-semibold text-slate-600 mb-1">Import Target</div>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
                {(
                  [
                    { id: 'replace' as const, label: 'Replace Deck', disabled: !activeDeck },
                    { id: 'merge' as const, label: 'Merge Into', disabled: !activeDeck },
                    { id: 'new' as const, label: 'New Deck', disabled: false },
                  ]
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={opt.disabled}
                    onClick={() => setImportMode(opt.id)}
                    className={`min-h-[36px] px-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      effectiveImportMode === opt.id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {effectiveImportMode === 'new' ? (
              <>
                <div className="sm:col-span-3">
                  <label
                    htmlFor="import-deck-name"
                    className="block text-xs font-semibold text-slate-600 mb-1"
                  >
                    New Deck Name
                  </label>
                  <input
                    id="import-deck-name"
                    type="text"
                    value={importDeckName}
                    onChange={(e) => setImportDeckName(e.target.value)}
                    placeholder={importPreview?.detectedDeckName || 'e.g., Imported Red Dragon'}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label
                    htmlFor="import-deck-folder"
                    className="block text-xs font-semibold text-slate-600 mb-1"
                  >
                    Folder
                  </label>
                  <select
                    id="import-deck-folder"
                    value={importDeckFolderId}
                    onChange={(e) => setImportDeckFolderId(e.target.value)}
                    className="w-full min-h-[44px] px-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="">Uncategorized</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-xs font-semibold text-slate-600 mb-1">Format</div>
                  <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
                    {(['Standard', 'Eternal'] as GameFormat[]).map((fmt) => {
                      const activeFmt = resolvedNewImportFormat;
                      return (
                        <button
                          key={fmt}
                          type="button"
                          onClick={() => setImportDeckFormat(fmt)}
                          className={`min-h-[36px] px-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                            activeFmt === fmt
                              ? fmt === 'Standard'
                                ? 'bg-sky-700 text-white shadow-sm'
                                : 'bg-amber-700 text-white shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {fmt === 'Standard' ? 'STD' : 'ETN'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="sm:col-span-7 flex items-center min-h-[44px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                {effectiveImportMode === 'replace' ? (
                  <span>
                    Will replace cards in{' '}
                    <strong className="text-slate-900">{activeDeck?.name}</strong> ({activeFormat})
                  </span>
                ) : (
                  <span>
                    Will add matched cards to{' '}
                    <strong className="text-slate-900">{activeDeck?.name}</strong> (enforcing copy limits)
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Paste Textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="decklist-import-textarea"
                className="text-xs font-semibold text-slate-700"
              >
                Deck List Text
              </label>
              <div className="flex items-center gap-2">
                {importText && (
                  <button
                    type="button"
                    onClick={() => setImportText('')}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={handlePasteFromClipboard}
                  className="min-h-[32px] px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  <span>Paste Clipboard</span>
                </button>
              </div>
            </div>
            <textarea
              ref={importTextareaRef}
              id="decklist-import-textarea"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={6}
              placeholder={`// Example formats:\n3x Petristar [26RBS01-001]\n3 RP26-01 The ThunderEmperorDragon Siegwurm\n2x Flame Dance (26RBS01-085)\n3x Blizzard Wall [BSC22-144]`}
              className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50/50 font-mono text-xs text-slate-800 leading-relaxed focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          {/* Live Automatic Match Preview */}
          {importPreview && importPreview.totalParsedLines > 0 && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-900">
                  Match Preview:{' '}
                  <span className="font-mono text-emerald-700 tabular-nums">
                    {importPreview.totalMatchedCards} cards
                  </span>{' '}
                  ({importPreview.matchedLines.length} matched
                  {importPreview.unmatchedLines.length > 0 && (
                    <span className="text-amber-700">
                      , {importPreview.unmatchedLines.length} unmatched
                    </span>
                  )}
                  )
                </div>
              </div>

              {importPreview.matchedLines.length > 0 && (
                <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white">
                  {importPreview.matchedLines.map((line) => {
                    const card = line.matchedCard!;
                    const isIllegalStd =
                      targetImportFormat === 'Standard' &&
                      !(card.formats || ['Eternal']).includes('Standard');
                    return (
                      <div
                        key={`match-${line.lineNumber}`}
                        className="px-3 py-2 flex items-center justify-between gap-3 text-xs"
                      >
                        <button
                          type="button"
                          onClick={() => onInspectCard(card)}
                          className="min-w-0 flex-1 flex items-center gap-2 text-left cursor-pointer hover:underline"
                        >
                          <SymbolIcon color={card.color} size="xs" variant="gem" />
                          <span className="font-semibold text-slate-900 truncate">
                            {card.name}
                          </span>
                          <span className="font-mono text-[11px] text-slate-500 shrink-0">
                            {card.cardNumber}
                          </span>
                          {isTokenCard(card) ? (
                            <span className="text-[11px] font-semibold text-slate-600 shrink-0">
                              (Token · Outside Deck)
                            </span>
                          ) : isIllegalStd && (
                            <span className="text-[11px] font-semibold text-amber-700 shrink-0">
                              (ETN Only)
                            </span>
                          )}
                        </button>
                        <div className="flex items-center gap-2.5 shrink-0">
                          <span className="text-[11px] text-slate-500">
                            {line.confidence === 'exact-number'
                              ? 'By Number'
                              : line.confidence === 'exact-name'
                              ? 'By Name'
                              : 'Fuzzy Name'}
                          </span>
                          <span className="font-mono font-bold text-slate-900 tabular-nums">
                            ×{line.quantity}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {importPreview.unmatchedLines.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-1.5">
                  <div className="text-xs font-semibold text-amber-900">
                    Unmatched Lines ({importPreview.unmatchedLines.length})
                  </div>
                  <ul className="space-y-1 text-[11px] text-amber-900/90 font-mono">
                    {importPreview.unmatchedLines.map((line) => (
                      <li key={`unmatched-${line.lineNumber}`} className="truncate">
                        Line {line.lineNumber}: {line.rawText}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setImporting(false)}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApplyImport}
              disabled={!importPreview || importPreview.totalMatchedCards === 0}
              className="min-h-[44px] px-5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
            >
              {effectiveImportMode === 'new'
                ? `Create Deck (${importPreview?.totalMatchedCards || 0} Cards)`
                : effectiveImportMode === 'merge'
                ? `Add ${importPreview?.totalMatchedCards || 0} Cards`
                : `Import ${importPreview?.totalMatchedCards || 0} Cards`}
            </button>
          </div>
        </div>
      )}

      {folderFormMode !== 'closed' && (
        <form
          onSubmit={handleFolderFormSubmit}
          className="p-4 rounded-2xl bg-white border border-slate-200 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
        >
          <div className="sm:col-span-5">
            <label
              htmlFor="deck-folder-name"
              className="block text-xs font-semibold text-slate-600 mb-1"
            >
              {folderFormMode === 'rename' ? 'Rename Folder / Category' : 'New Folder / Category Name'}
            </label>
            <input
              id="deck-folder-name"
              type="text"
              value={folderFormName}
              onChange={(e) => setFolderFormName(e.target.value)}
              placeholder="e.g., Tournament Meta, Dragon Brews, Testing"
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
              required
            />
          </div>

          <div className="sm:col-span-4">
            <div className="block text-xs font-semibold text-slate-600 mb-1">
              Folder Color Accent
            </div>
            <div className="flex flex-wrap items-center gap-1.5 min-h-[44px]">
              {ALL_COLORS.map((c) => {
                const selected = folderFormColor === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFolderFormColor(c)}
                    className={`min-h-[36px] min-w-[36px] rounded-xl border inline-flex items-center justify-center cursor-pointer transition-all ${
                      selected
                        ? 'border-slate-900 ring-2 ring-slate-900/20 bg-slate-50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                    title={c}
                    aria-label={`Folder color ${c}`}
                  >
                    <span
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: COLOR_META[c].hex }}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="sm:col-span-3 flex gap-2">
            <button
              type="submit"
              className="flex-1 min-h-[44px] px-4 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer"
            >
              {folderFormMode === 'rename' ? 'Save Folder' : 'Create Folder'}
            </button>
            <button
              type="button"
              onClick={() => {
                setFolderFormMode('closed');
                setEditingFolderId(null);
              }}
              className="min-h-[44px] px-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {creating && (
        <form
          onSubmit={handleCreateSubmit}
          className="p-4 rounded-2xl bg-white border border-slate-200 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
        >
          <div className="sm:col-span-3">
            <label htmlFor="new-deck-name" className="block text-xs font-semibold text-slate-600 mb-1">
              Deck Name
            </label>
            <input
              id="new-deck-name"
              type="text"
              value={newDeckName}
              onChange={(e) => setNewDeckName(e.target.value)}
              placeholder="e.g., Olym Thunderbolt Control"
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
              required
            />
          </div>
          <div className="sm:col-span-2">
            <div className="block text-xs font-semibold text-slate-600 mb-1">Format</div>
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
              {(['Standard', 'Eternal'] as GameFormat[]).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setNewDeckFormat(fmt)}
                  className={`min-h-[36px] px-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    newDeckFormat === fmt
                      ? fmt === 'Standard'
                        ? 'bg-sky-700 text-white shadow-sm'
                        : 'bg-amber-700 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {fmt === 'Standard' ? 'STD' : 'ETN'}
                </button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-3">
            <label htmlFor="new-deck-arch" className="block text-xs font-semibold text-slate-600 mb-1">
              Archetype
            </label>
            <input
              id="new-deck-arch"
              type="text"
              value={newArchetype}
              onChange={(e) => setNewArchetype(e.target.value)}
              placeholder="e.g., Contract Saga"
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="new-deck-folder" className="block text-xs font-semibold text-slate-600 mb-1">
              Folder
            </label>
            <select
              id="new-deck-folder"
              value={newDeckFolderId}
              onChange={(e) => setNewDeckFolderId(e.target.value)}
              className="w-full min-h-[44px] px-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-600"
            >
              <option value="">Uncategorized</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2 flex gap-2">
            <button
              type="submit"
              className="flex-1 min-h-[44px] px-4 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="min-h-[44px] px-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Deck Folders & Category Organizer */}
      {(decks.length > 0 || folders.length > 0) && (
        <div className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 flex-1 min-w-0">
              <button
                type="button"
                onClick={() => {
                  setSelectedFolderFilter('all');
                  setConfirmDeleteFolderId(null);
                }}
                className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                  effectiveFolderFilter === 'all'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                All Decks ({decks.length})
              </button>

              {folders.map((folder) => {
                const countInFolder = decks.filter((d) => d.folderId === folder.id).length;
                const active = effectiveFolderFilter === folder.id;
                const dotColor = folder.color ? COLOR_META[folder.color]?.hex : '#64748b';
                return (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => {
                      setSelectedFolderFilter(folder.id);
                      setConfirmDeleteFolderId(null);
                    }}
                    className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 border inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                      active
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: dotColor }}
                    />
                    <span>{folder.name}</span>
                    <span
                      className={`font-mono text-[11px] tabular-nums ${
                        active ? 'text-slate-300' : 'text-slate-400'
                      }`}
                    >
                      ({countInFolder})
                    </span>
                  </button>
                );
              })}

              {(folderGroups.uncategorizedCount > 0 || folders.length > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFolderFilter('uncategorized');
                    setConfirmDeleteFolderId(null);
                  }}
                  className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                    effectiveFolderFilter === 'uncategorized'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  Uncategorized ({folderGroups.uncategorizedCount})
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {decks.length >= 4 && (
                <div className="relative flex-1 sm:w-48">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={deckSearchQuery}
                    onChange={(e) => setDeckSearchQuery(e.target.value)}
                    placeholder="Filter decks..."
                    aria-label="Filter deck lists"
                    className="w-full min-h-[38px] pl-8 pr-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              )}

              {activeFolderObj && (
                <div className="flex items-center gap-1 shrink-0">
                  {onRenameFolder && (
                    <button
                      type="button"
                      onClick={() => {
                        setFolderFormMode('rename');
                        setEditingFolderId(activeFolderObj.id);
                        setFolderFormName(activeFolderObj.name);
                        setFolderFormColor(activeFolderObj.color || 'Red');
                        setCreating(false);
                      }}
                      className="min-h-[38px] px-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                      aria-label={`Rename folder ${activeFolderObj.name}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Rename</span>
                    </button>
                  )}
                  {onDeleteFolder && (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteFolderId(activeFolderObj.id)}
                      className="min-h-[38px] px-2.5 rounded-xl border border-slate-200 bg-white hover:bg-red-50 hover:border-red-200 text-xs font-semibold text-slate-600 hover:text-red-700 inline-flex items-center gap-1 cursor-pointer"
                      aria-label={`Delete folder ${activeFolderObj.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {confirmDeleteFolderId && activeFolderObj?.id === confirmDeleteFolderId && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-red-900">
                Remove folder &ldquo;{activeFolderObj.name}&rdquo;? Decks inside will stay saved under Uncategorized.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteFolderId(null)}
                  className="min-h-[34px] px-3 rounded-lg bg-white border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDeleteFolder?.(activeFolderObj.id);
                    setConfirmDeleteFolderId(null);
                    setSelectedFolderFilter('all');
                  }}
                  className="min-h-[34px] px-3 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 cursor-pointer"
                >
                  Remove Folder
                </button>
              </div>
            </div>
          )}

          {/* Grouped Folder Sections & Deck Cards */}
          <div className="space-y-3">
            {visibleFolderGroups.map((group) => {
              const isCollapsed = Boolean(collapsedFolderIds[group.id]) && effectiveFolderFilter === 'all';
              const dotHex = group.color ? COLOR_META[group.color]?.hex : '#94a3b8';

              return (
                <div
                  key={group.id}
                  className="rounded-xl border border-slate-200/90 bg-slate-50/50 overflow-hidden"
                >
                  <div className="px-3 py-2 bg-slate-100/70 border-b border-slate-200/70 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedFolderIds((prev) => ({
                          ...prev,
                          [group.id]: !prev[group.id],
                        }))
                      }
                      className="flex items-center gap-2 text-left min-w-0 flex-1 cursor-pointer"
                      aria-expanded={!isCollapsed}
                    >
                      {effectiveFolderFilter === 'all' &&
                        (isCollapsed ? (
                          <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                        ))}
                      {isCollapsed ? (
                        <Folder className="w-4 h-4 shrink-0" style={{ color: dotHex }} />
                      ) : (
                        <FolderOpen className="w-4 h-4 shrink-0" style={{ color: dotHex }} />
                      )}
                      <span className="text-xs font-bold text-slate-800 truncate">
                        {group.name}
                      </span>
                      <span className="font-mono text-[11px] font-semibold text-slate-500 tabular-nums shrink-0">
                        {group.decks.length} {group.decks.length === 1 ? 'deck' : 'decks'}
                      </span>
                    </button>

                    {!group.isUncategorized && (
                      <button
                        type="button"
                        onClick={() => {
                          setCreating(true);
                          setImporting(false);
                          setTestingHand(false);
                          setFolderFormMode('closed');
                          setNewDeckFolderId(group.id);
                        }}
                        className="text-[11px] font-semibold text-red-700 hover:underline shrink-0 cursor-pointer"
                      >
                        + Add Deck
                      </button>
                    )}
                  </div>

                  {!isCollapsed && (
                    <div className="p-2.5">
                      {group.decks.length === 0 ? (
                        <div className="py-3 px-2 text-xs text-slate-500 text-center">
                          {deckSearchQuery.trim()
                            ? `No decks matching "${deckSearchQuery.trim()}" in this folder.`
                            : 'Empty folder — create a new deck or move an existing deck here.'}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {group.decks.map((deck) => {
                            const isSelected = deck.id === activeDeck?.id;
                            const entriesList = Array.isArray(deck.entries) ? deck.entries : [];
                            const count = entriesList.reduce(
                              (s, e) => s + (Number(e?.quantity) || 0),
                              0
                            );
                            const fmtShort =
                              (deck.format || 'Eternal') === 'Standard' ? 'STD' : 'ETN';
                            return (
                              <button
                                key={deck.id}
                                type="button"
                                onClick={() => {
                                  onSelectDeck(deck.id);
                                  setSelectedCostBucket(null);
                                  setConfirmDeleteId(null);
                                  setShareUrl(null);
                                }}
                                className={`min-h-[44px] px-3.5 py-2.5 rounded-xl text-left border transition-colors cursor-pointer ${
                                  isSelected
                                    ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                                    : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-bold truncate">{deck.name}</span>
                                  <span
                                    className={`font-mono text-[10px] font-bold shrink-0 ${
                                      isSelected
                                        ? 'text-slate-300'
                                        : fmtShort === 'STD'
                                        ? 'text-sky-700'
                                        : 'text-amber-700'
                                    }`}
                                  >
                                    {fmtShort}
                                  </span>
                                </div>
                                <div
                                  className={`mt-0.5 text-[11px] font-mono tabular-nums truncate ${
                                    isSelected ? 'text-slate-300' : 'text-slate-500'
                                  }`}
                                >
                                  {count}/40+ cards · {deck.archetype}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!activeDeck && (
        <div className="p-8 rounded-2xl bg-white border border-slate-200 text-center space-y-3">
          <h2 className="font-display text-lg font-bold text-slate-900">No Decks Yet</h2>
          <p className="text-sm text-slate-500">
            Create a Standard or Eternal deck to start adding Battle Spirits cards.
          </p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="min-h-[44px] px-5 rounded-xl bg-slate-900 text-white text-xs font-semibold inline-flex items-center gap-2 hover:bg-slate-800 cursor-pointer"
          >
            <FolderPlus className="w-4 h-4" />
            <span>Create New Deck</span>
          </button>
        </div>
      )}

      {activeDeck && testingHand && (
        <TestHandPanel
          deckId={activeDeck.id}
          deckName={activeDeck.name}
          resolvedEntries={resolvedEntries}
          onInspectCard={onInspectCard}
          onClose={() => setTestingHand(false)}
        />
      )}

      {activeDeck && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-5 space-y-4">
            <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-bold text-slate-900 truncate">
                    {activeDeck.name}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {activeDeck.archetype} · Updated {activeDeck.updatedAt}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <div className="font-mono text-xl font-bold tabular-nums text-slate-900">
                    {totalCards}
                    <span className="text-sm font-normal text-slate-400"> / 40+</span>
                  </div>
                  <div
                    className={`text-[11px] font-semibold ${
                      hasViolations
                        ? 'text-amber-700'
                        : totalCards >= 40
                        ? 'text-emerald-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {deckStatusLabel}
                  </div>
                </div>
              </div>

              {/* Deck Format & Folder Controls */}
              <div className="space-y-2.5 pt-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-slate-600">Target Format</span>
                  <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
                    {(['Standard', 'Eternal'] as GameFormat[]).map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => onChangeDeckFormat(activeDeck.id, fmt)}
                        className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                          activeFormat === fmt
                            ? fmt === 'Standard'
                              ? 'bg-sky-700 text-white shadow-sm'
                              : 'bg-amber-700 text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                </div>

                {onMoveDeckToFolder && (
                  <div className="flex items-center justify-between gap-3">
                    <label
                      htmlFor="active-deck-folder-select"
                      className="text-xs font-semibold text-slate-600 shrink-0"
                    >
                      Folder / Category
                    </label>
                    <select
                      id="active-deck-folder-select"
                      value={
                        activeDeck.folderId && folderIdsSet.has(activeDeck.folderId)
                          ? activeDeck.folderId
                          : ''
                      }
                      onChange={(e) =>
                        onMoveDeckToFolder(activeDeck.id, e.target.value || undefined)
                      }
                      className="min-h-[38px] max-w-[210px] px-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-600"
                    >
                      <option value="">Uncategorized</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {hasViolations && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-2.5 text-xs text-amber-950">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      {formatIllegalEntries.length > 0 && (
                        <p>
                          <span className="font-semibold">
                            {formatIllegalEntries.length} card
                            {formatIllegalEntries.length === 1 ? '' : 's'} not legal in Standard:
                          </span>{' '}
                          {formatIllegalEntries.map((e) => e.card.name).join(', ')}.
                        </p>
                      )}
                      {restrictionViolations.length > 0 && (
                        <p>
                          <span className="font-semibold">Restriction limit exceeded:</span>{' '}
                          {restrictionViolations
                            .map((e) =>
                              isTokenCard(e.card)
                                ? `${e.card.name} (Token — outside deck)`
                                : `${e.card.name} (${e.card.restriction})`
                            )
                            .join(', ')}
                          .
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onRemoveIllegalCards(activeDeck.id)}
                      className="min-h-[36px] px-3 rounded-lg bg-amber-700 text-white font-semibold hover:bg-amber-800 cursor-pointer"
                    >
                      Fix / Remove Illegal
                    </button>
                    {formatIllegalEntries.length > 0 && activeFormat === 'Standard' && (
                      <button
                        type="button"
                        onClick={() => onChangeDeckFormat(activeDeck.id, 'Eternal')}
                        className="min-h-[36px] px-3 rounded-lg bg-white border border-amber-300 text-amber-900 font-semibold hover:bg-amber-100 cursor-pointer"
                      >
                        Switch to Eternal
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    totalCards >= 40 && !hasViolations ? 'bg-emerald-600' : 'bg-red-600'
                  }`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              <DeckStatsPanel resolvedEntries={resolvedEntries} totalCards={totalCards} />

              <DeckCostChart
                resolvedEntries={resolvedEntries}
                totalCards={totalCards}
                selectedCostBucket={selectedCostBucket}
                onSelectCostBucket={setSelectedCostBucket}
              />

              <DeckD3Charts
                resolvedEntries={resolvedEntries}
                totalCards={totalCards}
                selectedCostBucket={selectedCostBucket}
                onSelectCostBucket={setSelectedCostBucket}
                showCostCurve={false}
              />

              <DeckCompositionChart typeCounts={typeCounts} totalCards={totalCards} />

              <div className="space-y-2.5 pt-2 border-t border-slate-100">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadImage}
                    disabled={resolvedEntries.length === 0 || downloading}
                    className="flex-1 min-w-[140px] min-h-[44px] px-4 rounded-xl bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 hover:bg-red-700 disabled:opacity-45 cursor-pointer whitespace-nowrap"
                  >
                    {downloading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : downloaded ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    <span>
                      {downloading
                        ? 'Generating PNG...'
                        : downloaded
                        ? 'Image Saved'
                        : 'Download Decklist'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyList}
                    disabled={resolvedEntries.length === 0}
                    className="flex-1 min-w-[140px] min-h-[44px] px-4 rounded-xl bg-slate-900 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 hover:bg-slate-800 disabled:opacity-45 cursor-pointer whitespace-nowrap"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{copied ? 'Copied Deck List' : 'Copy Deck List'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleShareDeck}
                    disabled={resolvedEntries.length === 0}
                    className={`min-h-[44px] px-3.5 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-45 ${
                      shareUrl
                        ? 'border-sky-700 bg-sky-700 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                    aria-label="Generate shareable link for this deck"
                  >
                    {shareCopied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                    <span>{shareCopied ? 'Link Copied' : 'Share Deck'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowExportOptions((v) => !v);
                      setShowTextExport(false);
                      setShareUrl(null);
                    }}
                    disabled={resolvedEntries.length === 0}
                    className={`min-h-[44px] px-3.5 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-45 ${
                      showExportOptions
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                    aria-expanded={showExportOptions}
                    aria-label="Export deck as JSON or CSV file"
                  >
                    <FileDown className="w-4 h-4" />
                    <span>Export Deck</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowTextExport((v) => !v);
                      setShowExportOptions(false);
                      setShareUrl(null);
                    }}
                    disabled={resolvedEntries.length === 0}
                    className="min-h-[44px] px-3 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-45 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                    aria-expanded={showTextExport}
                    aria-label="Preview text deck list format"
                  >
                    <FileText className="w-4 h-4" />
                    <span>{showTextExport ? 'Hide Text' : 'Text Format'}</span>
                  </button>
                </div>

                {shareUrl && resolvedEntries.length > 0 && (
                  <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-950">
                        <Link2 className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                        <span>Shareable Deck Link Ready</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShareUrl(null)}
                        className="min-h-[28px] min-w-[28px] rounded-lg text-sky-700 hover:bg-sky-100 flex items-center justify-center cursor-pointer"
                        aria-label="Close share deck link"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-[11px] text-sky-900/80">
                      Anyone who opens this link will be prompted to import &ldquo;{activeDeck.name}&rdquo; automatically.
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={shareUrl}
                        onFocus={(e) => e.target.select()}
                        aria-label="Shareable deck URL"
                        className="flex-1 min-w-0 min-h-[38px] px-2.5 rounded-lg bg-white border border-sky-200 font-mono text-[11px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                      <button
                        type="button"
                        onClick={handleShareDeck}
                        className="min-h-[38px] px-3 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                      >
                        {shareCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{shareCopied ? 'Copied' : 'Copy Link'}</span>
                      </button>
                    </div>
                  </div>
                )}

                {showExportOptions && resolvedEntries.length > 0 && (
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-slate-800">
                          Export Deck for Offline Storage
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Download {activeDeck.name} ({totalCards} cards) as JSON backup or CSV spreadsheet.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowExportOptions(false)}
                        className="min-h-[32px] min-w-[32px] rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 flex items-center justify-center cursor-pointer"
                        aria-label="Close export options"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleExportDeckFile('json')}
                        className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-800 text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {lastExportedFormat === 'json' ? (
                          <Check className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <FileJson className="w-4 h-4 text-amber-600" />
                        )}
                        <span>
                          {lastExportedFormat === 'json' ? 'JSON Downloaded' : 'Download JSON (.json)'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportDeckFile('csv')}
                        className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-800 text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {lastExportedFormat === 'csv' ? (
                          <Check className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                        )}
                        <span>
                          {lastExportedFormat === 'csv' ? 'CSV Downloaded' : 'Download CSV (.csv)'}
                        </span>
                      </button>
                    </div>
                  </div>
                )}

                {showTextExport && resolvedEntries.length > 0 && (
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-600">
                        Export Format
                      </span>
                      <div className="inline-flex items-center gap-1 p-0.5 bg-slate-200/80 rounded-lg">
                        {[
                          { id: 'grouped' as const, label: 'Name + [Number]' },
                          { id: 'compact' as const, label: 'Qty Number Name' },
                        ].map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setTextFormatMode(opt.id)}
                            className={`min-h-[28px] px-2.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                              textFormatMode === opt.id
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <textarea
                      readOnly
                      value={buildDecklistText(textFormatMode)}
                      rows={Math.min(10, Math.max(4, resolvedEntries.length + 3))}
                      onFocus={(e) => e.target.select()}
                      aria-label="Exportable Battle Spirits deck list text"
                      className="w-full p-2.5 rounded-lg bg-white border border-slate-200 font-mono text-[11px] text-slate-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-red-600"
                    />
                  </div>
                )}

                {confirmDeleteId === activeDeck.id ? (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-red-900">
                      Delete &ldquo;{activeDeck.name}&rdquo;?
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="min-h-[36px] px-3 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteId(null);
                          onDeleteDeck(activeDeck.id);
                        }}
                        className="min-h-[36px] px-3 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer"
                      >
                        Confirm Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(activeDeck.id)}
                    className="w-full min-h-[44px] px-4 rounded-xl border border-slate-200 text-slate-600 hover:text-red-700 hover:border-red-200 hover:bg-red-50 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Delete Deck</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  Deck Roster ({resolvedEntries.length} unique)
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  {resolvedEntries.length > 0 && (
                    <>
                      <div
                        role="group"
                        aria-label="Deck roster view mode"
                        className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl"
                      >
                        <button
                          type="button"
                          onClick={() => setRosterViewMode('list')}
                          className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                            rosterViewMode === 'list'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <List className="w-3.5 h-3.5" />
                          <span>List</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setRosterViewMode('images')}
                          className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                            rosterViewMode === 'images'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <LayoutGrid className="w-3.5 h-3.5" />
                          <span>Full Images</span>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFullDeckGalleryOpen(true)}
                        className="min-h-[38px] px-3 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        title="Open full visual card decklist"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">View Full Visual</span>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={onBrowseCatalog}
                    className="min-h-[40px] px-3 rounded-xl text-xs font-semibold text-red-700 hover:bg-red-50 cursor-pointer whitespace-nowrap"
                  >
                    + Add Cards
                  </button>
                </div>
              </div>

              {resolvedEntries.length === 0 ? (
                <div className="p-8 text-center space-y-3">
                  <p className="text-sm text-slate-500">
                    This deck is currently empty. Add cards from the search view or import a text deck list.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={onBrowseCatalog}
                      className="min-h-[44px] px-5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer"
                    >
                      Search Card Database
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setImportMode('replace');
                        setImporting(true);
                        setTimeout(() => importTextareaRef.current?.focus(), 60);
                      }}
                      className="min-h-[44px] px-4 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 inline-flex items-center gap-2 cursor-pointer"
                    >
                      <ClipboardPaste className="w-4 h-4" />
                      <span>Import Deck List</span>
                    </button>
                  </div>
                </div>
              ) : rosterViewMode === 'images' ? (
                <div className="p-3 sm:p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {resolvedEntries.map(({ card, quantity }) => {
                    const maxCopies = getMaxCopies(card);
                    const cardFormats = card.formats || ['Eternal'];
                    const isIllegalInStd =
                      activeFormat === 'Standard' && !cardFormats.includes('Standard');
                    const isOverRestricted = quantity > maxCopies;

                    return (
                      <div
                        key={card.id}
                        className={`rounded-2xl border overflow-hidden flex flex-col bg-white ${
                          isIllegalInStd || isOverRestricted
                            ? 'border-amber-300 ring-1 ring-amber-200'
                            : 'border-slate-200'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onInspectCard(card)}
                          className="relative aspect-[5/7] w-full bg-slate-950 overflow-hidden cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                          title={`Inspect ${card.name}`}
                        >
                          <CardArtwork
                            card={card}
                            fit="contain"
                            className="w-full h-full bg-slate-950"
                          />
                          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-slate-950/90 text-white font-mono text-xs font-bold tabular-nums shadow-md border border-white/15">
                            ×{quantity}
                          </div>
                        </button>
                        <div className="p-2 flex flex-col gap-1.5 bg-white border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => onInspectCard(card)}
                            className="text-left text-xs font-semibold text-slate-900 truncate hover:text-red-700 cursor-pointer"
                          >
                            {card.name}
                          </button>
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-mono text-[10px] text-slate-500 truncate">
                              {card.cardNumber}
                            </span>
                            <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden shrink-0">
                              <button
                                type="button"
                                onClick={() => onUpdateCardQty(card.id, -1)}
                                className="min-h-[30px] min-w-[30px] flex items-center justify-center text-slate-700 hover:bg-slate-100 cursor-pointer"
                                aria-label={`Remove one ${card.name}`}
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="px-1.5 font-mono text-[11px] font-bold tabular-nums">
                                {quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() => onUpdateCardQty(card.id, 1)}
                                disabled={quantity >= maxCopies}
                                className="min-h-[30px] min-w-[30px] flex items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-35 cursor-pointer"
                                aria-label={`Add one ${card.name}`}
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {resolvedEntries.map(({ card, quantity }) => {
                    const meta = COLOR_META[card.color] || COLOR_META.Red;
                    const cardFormats = card.formats || ['Eternal'];
                    const maxCopies = getMaxCopies(card);
                    const isIllegalInStd =
                      activeFormat === 'Standard' && !cardFormats.includes('Standard');
                    const isOverRestricted = quantity > maxCopies;

                    const reductionEntries = (
                      Object.entries(card.reduction || {}) as [BattleSymbolKind, number][]
                    ).filter(([, n]) => n > 0);
                    const rawRowColors =
                      card.colors && card.colors.length > 0
                        ? card.colors
                        : card.secondaryColor
                        ? [card.color, card.secondaryColor]
                        : [card.color];
                    const rowColors = Array.from(
                      new Set(rawRowColors.filter((c) => Boolean(c && COLOR_META[c])))
                    );
                    if (rowColors.length === 0) rowColors.push('Red');

                    return (
                      <li
                        key={card.id}
                        className={`px-3 sm:px-4 py-2.5 flex items-center justify-between gap-3 ${
                          isIllegalInStd || isOverRestricted ? 'bg-amber-50/50' : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onInspectCard(card)}
                          className="min-w-0 flex-1 flex items-center gap-3 text-left min-h-[44px] cursor-pointer"
                        >
                          <div
                            className="w-9 h-9 rounded-lg flex flex-col items-center justify-center font-mono text-xs font-bold text-white shrink-0 tabular-nums"
                            style={{ backgroundColor: meta.hex }}
                          >
                            <span>{card.cost}</span>
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 truncate flex items-center gap-1.5">
                              {rowColors.slice(0, 3).map((c) => (
                                <SymbolIcon key={c} color={c} size="xs" variant="gem" />
                              ))}
                              <span className="truncate">{card.name}</span>
                            </div>
                            <div className="text-xs text-slate-500 flex flex-wrap items-center gap-1">
                              <span className="font-mono">{card.cardNumber}</span>
                              <span>·</span>
                              <span className={`font-semibold ${meta.text}`}>
                                {rowColors.length > 2
                                  ? `${rowColors.length}-Color`
                                  : rowColors.join('/')}
                              </span>
                              <span>{card.subtypeLabel || card.type}</span>
                              {reductionEntries.length > 0 && (
                                <>
                                  <span>·</span>
                                  <span className="inline-flex items-center gap-0.5 align-middle">
                                    {reductionEntries.map(([rColor, count]) =>
                                      Array.from({ length: Math.min(count, 4) }).map((_, i) => (
                                        <SymbolIcon
                                          key={`${rColor}-${i}`}
                                          color={rColor}
                                          size="xs"
                                          variant="reduction"
                                        />
                                      ))
                                    )}
                                  </span>
                                </>
                              )}
                              <span>·</span>
                              <span>{card.rarity}</span>
                              <span>·</span>
                              <span
                                className={
                                  isIllegalInStd
                                    ? 'text-amber-700 font-semibold'
                                    : cardFormats.includes('Standard')
                                    ? 'text-sky-700 font-semibold'
                                    : 'text-amber-700 font-semibold'
                                }
                              >
                                {isIllegalInStd
                                  ? 'ETN Only (Illegal in STD)'
                                  : cardFormats.includes('Standard')
                                  ? 'STD/ETN'
                                  : 'ETN'}
                              </span>
                              {card.restriction && card.restriction !== 'Unlimited' && (
                                <>
                                  <span> · </span>
                                  <span className="text-red-700 font-semibold">
                                    {card.restriction}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden shrink-0 bg-white">
                          <button
                            type="button"
                            onClick={() => onUpdateCardQty(card.id, -1)}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-700 hover:bg-slate-100 cursor-pointer"
                            aria-label={`Remove one ${card.name}`}
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <span className="px-2 font-mono text-sm font-bold tabular-nums min-w-[1.75rem] text-center">
                            {quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => onUpdateCardQty(card.id, 1)}
                            disabled={quantity >= maxCopies}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-35 cursor-pointer"
                            aria-label={`Add one ${card.name}`}
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Full-Image Decklist Viewer */}
      {fullDeckGalleryOpen && activeDeck && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/92 backdrop-blur-md flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-labelledby="full-deck-gallery-title"
          onClick={() => setFullDeckGalleryOpen(false)}
        >
          <div
            className="px-4 sm:px-6 py-3.5 border-b border-white/10 flex items-center justify-between gap-3 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-w-0">
              <h2
                id="full-deck-gallery-title"
                className="font-display text-base sm:text-lg font-bold text-white truncate"
              >
                {activeDeck.name}
              </h2>
              <p className="text-xs text-slate-400 font-mono tabular-nums">
                {activeDeck.format} · {totalCards} total cards · {resolvedEntries.length} unique
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFullDeckGalleryOpen(false)}
              className="min-h-[40px] min-w-[40px] rounded-xl bg-white/10 text-white hover:bg-white/20 flex items-center justify-center shrink-0 cursor-pointer"
              aria-label="Close full image decklist"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div
            className="flex-1 overflow-y-auto p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="max-w-7xl mx-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
              {resolvedEntries.map(({ card, quantity }) => (
                <button
                  key={`full-${card.id}`}
                  type="button"
                  onClick={() => {
                    setFullDeckGalleryOpen(false);
                    onInspectCard(card);
                  }}
                  className="group relative aspect-[5/7] rounded-2xl overflow-hidden bg-slate-900 border border-white/10 hover:border-white/35 transition-all cursor-pointer text-left"
                >
                  <CardArtwork
                    card={card}
                    fit="contain"
                    className="w-full h-full bg-slate-950"
                  />
                  <div className="absolute top-2 right-2 px-2.5 py-0.5 rounded-lg bg-slate-950/90 text-white font-mono text-xs font-bold tabular-nums shadow-lg border border-white/15">
                    ×{quantity}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
