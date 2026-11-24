import fs from 'node:fs';
import path from 'node:path';
import type { BattleSpiritsCard, ProductSet } from '../src/types/card.ts';
import {
  evaluateCardCompleteness,
  extractArtworkFileParam,
  hasMeaningfulEffects,
  isLikelyNonCardWikiTitle,
  isPlaceholderArtworkUrl,
  isSentinelEffectText,
  sanitizeEffectsArray,
  type CardCompletenessHints,
} from '../src/utils/cardCompletion.ts';
import {
  batchFetchWikiPages,
  batchVerifyWikiFilesExist,
  cleanWikitextInline,
  extractTaggedCardTableBlocks,
  fetchWikiJson,
  hydrateCardFromWikitext,
  parseTemplateFields,
  type WikiPageBundle,
} from './wikiService.ts';
import {
  expandWikiFileCandidates,
  isCardArtworkFile,
  scoreWikiCandidatePage,
} from './wikiCardLookup.ts';
import { findManualCardMapping } from './manualCardMappings.ts';
import {
  getActiveCatalogState,
  isSyntheticCardNumber,
  normalizeSetCode,
  reprocessAndRetryCatalogEntries,
  saveCatalogScanState,
  validateCatalogImport,
  type CatalogDependencies,
  type CatalogScanState,
  type DiscoveredCardEntry,
  type ImportExecutionResult,
  type RejectedCatalogCard,
} from './catalogSyncService.ts';

export type RepairMode =
  | 'all_incomplete'
  | 'artwork_only'
  | 'effects_only'
  | 'retry_matching'
  | 'reprocess_rejected'
  | 'resume';

export interface CatalogAuditSampleRecord {
  id: string;
  cardNumber: string;
  name: string;
  setCode: string;
  wikiTitle?: string;
  artworkImage?: string;
  artworkStatus?: string;
  effectStatus?: string;
  metadataStatus?: string;
  completionStatus?: string;
  isWikiLoaded?: boolean;
  issueSummary: string;
  source: 'public_cards' | 'imported_state' | 'discovered_rejected';
}

export interface CatalogAuditAffectedSet {
  setCode: string;
  setName: string;
  totalCards: number;
  affectedCount: number;
  missingArtworkCount: number;
  missingEffectCount: number;
  missingMetadataCount: number;
  mismatchedCount: number;
}

export interface CatalogAuditReport {
  auditedAt: string;
  verifiedArtworkOnline: boolean;
  totalInspectedCards: number;
  publicCardsCount: number;
  importedStateCount: number;
  discoveredEntriesCount: number;
  completeVerifiedCount: number;
  partialCount: number;
  incompleteCount: number;
  needsReviewCount: number;
  categories: {
    missingArtworkUrl: number;
    placeholderArtwork: number;
    brokenArtworkUrl: number;
    missingEffectText: number;
    unavailableEffectText: number;
    vanillaNoPrintedEffect: number;
    missingMetadata: number;
    mismatchedWikiPage: number;
    skippedOrRejectedEntries: number;
    incompleteDespiteSuccess: number;
  };
  rejectedBreakdown: {
    totalRejected: number;
    recoverable: number;
    confirmedDuplicates: number;
    unrecoverableOrNeedsReview: number;
  };
  affectedSets: CatalogAuditAffectedSet[];
  samples: Record<keyof CatalogAuditReport['categories'], CatalogAuditSampleRecord[]>;
}

export interface CatalogRepairState {
  jobStatus: 'idle' | 'running' | 'paused' | 'completed';
  mode: RepairMode | null;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  totalQueueCount: number;
  processedCount: number;
  remainingIds: string[];
  stats: {
    repairedCards: number;
    repairedArtwork: number;
    repairedEffects: number;
    repairedMetadata: number;
    repairedMatches: number;
    recoveredRejected: number;
    flaggedManualReview: number;
    markedUnavailable: number;
    manualMappingsPreserved: number;
    stillUnresolved: number;
  };
  lastAuditReport?: CatalogAuditReport;
  lastErrors: Array<{ cardId: string; cardNumber: string; message: string; timestamp: string }>;
}

export interface RepairDependencies {
  stateFilePath?: string;
  publicCardsJsonPath?: string;
  repairStatePath?: string;
  existingCardsProvider?: () => BattleSpiritsCard[];
  batchFetchPagesFn?: (titles: string[]) => Promise<Map<string, WikiPageBundle>>;
  batchVerifyFilesFn?: (fileNames: string[]) => Promise<Map<string, string | null>>;
  fetchWikiJsonFn?: (params: Record<string, string>) => Promise<Record<string, unknown>>;
}

export interface CatalogRepairBatchResult {
  mode: RepairMode;
  batchProcessedCount: number;
  remainingCount: number;
  jobStatus: CatalogRepairState['jobStatus'];
  stats: CatalogRepairState['stats'];
  repairedSampleIds: string[];
  reprocessResult?: {
    reprocessedCount: number;
    recoveredToReadyCount: number;
    addedCardsCount: number;
  };
  repairState: CatalogRepairState;
}

const DEFAULT_RUNTIME_DIR =
  process.env.CATALOG_RUNTIME_DIR || path.join('/tmp', 'spiritsdex-runtime');
const DEFAULT_REPAIR_STATE_FILE = path.join(
  DEFAULT_RUNTIME_DIR,
  'catalog-repair-state.json'
);

interface PublicCardsJsonFile {
  version?: number;
  generatedAt?: string;
  banList?: unknown;
  sets?: ProductSet[];
  cards: BattleSpiritsCard[];
}

function getDefaultPublicCardsPath(overridePath?: string): string {
  return overridePath || path.resolve(process.cwd(), 'public', 'cards.json');
}

function getRepairStatePath(overridePath?: string): string {
  return overridePath || DEFAULT_REPAIR_STATE_FILE;
}

function createEmptyRepairState(): CatalogRepairState {
  return {
    jobStatus: 'idle',
    mode: null,
    startedAt: null,
    updatedAt: null,
    completedAt: null,
    totalQueueCount: 0,
    processedCount: 0,
    remainingIds: [],
    stats: {
      repairedCards: 0,
      repairedArtwork: 0,
      repairedEffects: 0,
      repairedMetadata: 0,
      repairedMatches: 0,
      recoveredRejected: 0,
      flaggedManualReview: 0,
      markedUnavailable: 0,
      manualMappingsPreserved: 0,
      stillUnresolved: 0,
    },
    lastErrors: [],
  };
}

export function loadCatalogRepairState(repairStatePath?: string): CatalogRepairState {
  const target = getRepairStatePath(repairStatePath);
  try {
    if (fs.existsSync(target)) {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as Partial<CatalogRepairState>;
      const empty = createEmptyRepairState();
      return {
        ...empty,
        ...parsed,
        stats: {
          ...empty.stats,
          ...(parsed.stats || {}),
        },
        remainingIds: Array.isArray(parsed.remainingIds) ? parsed.remainingIds : [],
        lastErrors: Array.isArray(parsed.lastErrors) ? parsed.lastErrors : [],
      };
    }
  } catch {
    // ignore corrupt state file
  }
  return createEmptyRepairState();
}

export function saveCatalogRepairState(
  state: CatalogRepairState,
  repairStatePath?: string
): void {
  const target = getRepairStatePath(repairStatePath);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    state.updatedAt = new Date().toISOString();
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, target);
  } catch {
    // non-fatal
  }
}

function readPublicCardsFile(publicCardsJsonPath?: string): PublicCardsJsonFile | null {
  const target = getDefaultPublicCardsPath(publicCardsJsonPath);
  try {
    if (!fs.existsSync(target)) return null;
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as PublicCardsJsonFile;
    if (!parsed || !Array.isArray(parsed.cards)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePublicCardsFile(
  payload: PublicCardsJsonFile,
  publicCardsJsonPath?: string
): void {
  const target = getDefaultPublicCardsPath(publicCardsJsonPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, target);
}

function buildCatalogDeps(deps?: RepairDependencies): CatalogDependencies {
  const existingCardsProvider =
    deps?.existingCardsProvider ||
    (deps?.publicCardsJsonPath
      ? () => readPublicCardsFile(deps.publicCardsJsonPath)?.cards || []
      : undefined);
  return {
    stateFilePath: deps?.stateFilePath,
    fetchWikiJsonFn: deps?.fetchWikiJsonFn,
    batchFetchPagesFn: deps?.batchFetchPagesFn,
    existingCardsProvider,
  };
}

function buildInspectedCardPool(
  deps?: RepairDependencies,
  setCodeFilter?: Set<string> | null
): {
  publicPayload: PublicCardsJsonFile | null;
  publicIndexById: Map<string, number>;
  state: CatalogScanState;
  pool: Array<{ card: BattleSpiritsCard; source: 'public_cards' | 'imported_state' }>;
  publicCardsCount: number;
  importedStateCount: number;
} {
  const state = getActiveCatalogState(deps?.stateFilePath);
  const publicPayload = deps?.existingCardsProvider
    ? { cards: deps.existingCardsProvider() }
    : readPublicCardsFile(deps?.publicCardsJsonPath);

  const publicCards = publicPayload?.cards || [];
  const publicIndexById = new Map<string, number>();
  const unified = new Map<
    string,
    { card: BattleSpiritsCard; source: 'public_cards' | 'imported_state' }
  >();

  for (let i = 0; i < publicCards.length; i++) {
    const c = publicCards[i];
    if (!c || !c.id) continue;
    publicIndexById.set(c.id, i);
    unified.set(c.id, { card: c, source: 'public_cards' });
  }

  const importedList = Object.values(state.importedCards || {});
  for (const c of importedList) {
    if (!c || !c.id) continue;
    const prev = unified.get(c.id);
    if (!prev) {
      unified.set(c.id, { card: c, source: 'imported_state' });
    } else if (
      c.lastRepairedAt &&
      (!prev.card.lastRepairedAt || c.lastRepairedAt > prev.card.lastRepairedAt)
    ) {
      unified.set(c.id, { card: c, source: 'public_cards' });
    }
  }

  const pool = Array.from(unified.values()).filter(({ card }) => {
    if (!setCodeFilter || setCodeFilter.size === 0) return true;
    const sc = normalizeSetCode(card.setCode || '');
    return setCodeFilter.has(sc) || setCodeFilter.has((card.setCode || '').trim().toUpperCase());
  });

  return {
    publicPayload,
    publicIndexById,
    state,
    pool,
    publicCardsCount: publicCards.length,
    importedStateCount: importedList.length,
  };
}

function getCardBasicMissingFields(card: BattleSpiritsCard): string[] {
  const missing: string[] = [];
  if (!card.cardNumber?.trim() || isSyntheticCardNumber(card.cardNumber)) {
    missing.push('cardNumber');
  }
  if (!card.name?.trim() && !card.jpName?.trim()) missing.push('name');
  if (!card.setCode?.trim()) missing.push('setCode');
  if (
    !card.isToken &&
    card.type !== 'Magic' &&
    card.type !== 'Nexus' &&
    (!card.families || card.families.length === 0)
  ) {
    missing.push('families');
  }
  if (!card.jpName?.trim()) missing.push('jpName');
  return missing;
}

function isCardSuspectedMismatched(card: BattleSpiritsCard): boolean {
  if (card.needsManualReview) return true;
  if (isLikelyNonCardWikiTitle(card.wikiTitle || card.name)) return true;
  if (!card.wikiTitle?.trim() && !card.isWikiLoaded) return true;
  return false;
}

function isCardEligibleForRepairMode(
  card: BattleSpiritsCard,
  mode: RepairMode
): boolean {
  const hasRealEffects = hasMeaningfulEffects(card.effects);
  const missingEffects =
    !hasRealEffects &&
    card.effectStatus !== 'no_printed_effect' &&
    card.effectStatus !== 'unavailable';
  const hasSentinel =
    Array.isArray(card.effects) &&
    card.effects.some((e) => !e?.text?.trim() || isSentinelEffectText(e.text));

  const artRaw = (card.artworkImage || '').trim();
  const isPlaceholder = isPlaceholderArtworkUrl(artRaw);
  const missingOrBrokenArt =
    !artRaw ||
    isPlaceholder ||
    card.artworkStatus === 'broken' ||
    card.artworkStatus === 'placeholder' ||
    card.artworkStatus === 'missing';
  const unverifiedLocalArt =
    !card.artworkVerified &&
    card.artworkStatus !== 'unavailable' &&
    Boolean(extractArtworkFileParam(artRaw));

  const missingFamilies =
    !card.isToken &&
    card.type !== 'Magic' &&
    card.type !== 'Nexus' &&
    (!card.families || card.families.length === 0);
  const missingJpOrIllust = !card.jpName?.trim();

  if (mode === 'artwork_only') {
    return (
      (missingOrBrokenArt || unverifiedLocalArt) &&
      card.artworkStatus !== 'unavailable'
    );
  }
  if (mode === 'effects_only') {
    return missingEffects || hasSentinel || missingFamilies;
  }
  if (mode === 'retry_matching') {
    return (
      !card.isWikiLoaded ||
      !card.wikiTitle?.trim() ||
      Boolean(card.needsManualReview) ||
      isLikelyNonCardWikiTitle(card.wikiTitle || card.name) ||
      card.completionStatus === 'incomplete' ||
      card.completionStatus === 'needs_review' ||
      missingOrBrokenArt ||
      missingEffects
    );
  }
  if (mode === 'reprocess_rejected') {
    return false;
  }

  // 'all_incomplete'
  return (
    card.completionStatus !== 'complete' ||
    !card.isWikiLoaded ||
    missingOrBrokenArt ||
    unverifiedLocalArt ||
    missingEffects ||
    hasSentinel ||
    missingFamilies ||
    missingJpOrIllust ||
    Boolean(card.needsManualReview) ||
    isLikelyNonCardWikiTitle(card.wikiTitle || card.name)
  );
}

/**
 * PHASE 1: Full non-destructive catalog audit across public/cards.json,
 * catalog-sync-state.json importedCards, and discoveredCards (including rejected entries).
 */
export async function auditCatalogRecords(
  options?: {
    setCodes?: string[];
    verifyArtworkOnline?: boolean;
    maxOnlineVerifyCount?: number;
    sampleLimit?: number;
  },
  deps?: RepairDependencies
): Promise<CatalogAuditReport> {
  const setFilter = options?.setCodes?.length
    ? new Set(options.setCodes.map((s) => normalizeSetCode(s)))
    : null;
  const sampleLimit = Math.max(5, Math.min(100, options?.sampleLimit ?? 25));

  const { state, pool, publicCardsCount, importedStateCount } = buildInspectedCardPool(
    deps,
    setFilter
  );

  // Optional live MediaWiki file existence verification for unverified /api/wiki/image?file=... URLs
  const verifiedFileMap = new Map<string, string | null>();
  if (options?.verifyArtworkOnline) {
    const verifyFn = deps?.batchVerifyFilesFn || batchVerifyWikiFilesExist;
    const filesToCheck: string[] = [];
    const seenFiles = new Set<string>();
    const maxCheck = options.maxOnlineVerifyCount ?? 1500;

    for (const { card } of pool) {
      if (filesToCheck.length >= maxCheck) break;
      if (card.artworkVerified || isPlaceholderArtworkUrl(card.artworkImage)) continue;
      const param = extractArtworkFileParam(card.artworkImage);
      if (param && !seenFiles.has(param.toLowerCase())) {
        seenFiles.add(param.toLowerCase());
        filesToCheck.push(param);
      }
    }

    if (filesToCheck.length > 0) {
      const checked = await verifyFn(filesToCheck);
      for (const [k, v] of checked.entries()) {
        verifiedFileMap.set(k, v);
      }
    }
  }

  const samples: CatalogAuditReport['samples'] = {
    missingArtworkUrl: [],
    placeholderArtwork: [],
    brokenArtworkUrl: [],
    missingEffectText: [],
    unavailableEffectText: [],
    vanillaNoPrintedEffect: [],
    missingMetadata: [],
    mismatchedWikiPage: [],
    skippedOrRejectedEntries: [],
    incompleteDespiteSuccess: [],
  };

  const categories: CatalogAuditReport['categories'] = {
    missingArtworkUrl: 0,
    placeholderArtwork: 0,
    brokenArtworkUrl: 0,
    missingEffectText: 0,
    unavailableEffectText: 0,
    vanillaNoPrintedEffect: 0,
    missingMetadata: 0,
    mismatchedWikiPage: 0,
    skippedOrRejectedEntries: 0,
    incompleteDespiteSuccess: 0,
  };

  const pushSample = (
    cat: keyof CatalogAuditReport['categories'],
    rec: CatalogAuditSampleRecord
  ) => {
    categories[cat]++;
    if (samples[cat].length < sampleLimit) {
      samples[cat].push(rec);
    }
  };

  const setIssueMap = new Map<string, CatalogAuditAffectedSet>();
  const ensureSetRow = (card: BattleSpiritsCard): CatalogAuditAffectedSet => {
    const code = (card.setCode || 'UNKNOWN').trim().toUpperCase();
    let row = setIssueMap.get(code);
    if (!row) {
      row = {
        setCode: code,
        setName: card.setName || code,
        totalCards: 0,
        affectedCount: 0,
        missingArtworkCount: 0,
        missingEffectCount: 0,
        missingMetadataCount: 0,
        mismatchedCount: 0,
      };
      setIssueMap.set(code, row);
    }
    return row;
  };

  let completeVerifiedCount = 0;
  let partialCount = 0;
  let incompleteCount = 0;
  let needsReviewCount = 0;

  for (const { card, source } of pool) {
    const setRow = ensureSetRow(card);
    setRow.totalCards++;

    const artRaw = (card.artworkImage || '').trim();
    const isPlaceholder = isPlaceholderArtworkUrl(artRaw);
    const artFileParam = extractArtworkFileParam(artRaw).toLowerCase();
    const onlineChecked =
      artFileParam && verifiedFileMap.has(artFileParam)
        ? verifiedFileMap.get(artFileParam)
        : undefined;

    const evaluated = evaluateCardCompleteness(card, {
      artworkFileExists:
        onlineChecked !== undefined
          ? Boolean(onlineChecked)
          : card.artworkVerified
          ? true
          : undefined,
      isNonCardPage: isLikelyNonCardWikiTitle(card.wikiTitle || card.name),
    });

    if (evaluated.completionStatus === 'complete') completeVerifiedCount++;
    else if (evaluated.completionStatus === 'partial') partialCount++;
    else if (evaluated.completionStatus === 'needs_review') needsReviewCount++;
    else incompleteCount++;

    let cardAffected = false;
    let missingArtFlag = false;
    let missingEffFlag = false;
    let missingMetaFlag = false;
    let mismatchedFlag = false;

    const makeSample = (issueSummary: string): CatalogAuditSampleRecord => ({
      id: card.id,
      cardNumber: card.cardNumber,
      name: card.name,
      setCode: card.setCode,
      wikiTitle: card.wikiTitle,
      artworkImage: card.artworkImage,
      artworkStatus: evaluated.artworkStatus,
      effectStatus: evaluated.effectStatus,
      metadataStatus: evaluated.metadataStatus,
      completionStatus: evaluated.completionStatus,
      isWikiLoaded: card.isWikiLoaded,
      issueSummary,
      source,
    });

    // Artwork categories
    if (isPlaceholder || evaluated.artworkStatus === 'placeholder') {
      pushSample(
        'placeholderArtwork',
        makeSample(`Placeholder/icon artwork URL (${artRaw || 'placeholder'})`)
      );
      cardAffected = true;
      missingArtFlag = true;
    } else if (evaluated.artworkStatus === 'broken' || onlineChecked === null) {
      pushSample(
        'brokenArtworkUrl',
        makeSample(`Broken artwork reference (${artFileParam || artRaw})`)
      );
      cardAffected = true;
      missingArtFlag = true;
    } else if (
      !artRaw ||
      evaluated.artworkStatus === 'missing' ||
      evaluated.artworkStatus === 'unavailable'
    ) {
      pushSample(
        'missingArtworkUrl',
        makeSample(
          evaluated.artworkStatus === 'unavailable'
            ? 'Artwork unavailable on Wiki'
            : !artRaw
            ? 'Empty artworkImage URL'
            : 'Unverified local artwork URL'
        )
      );
      cardAffected = true;
      missingArtFlag = true;
    }

    // Effect text categories
    const hasSentinel =
      Array.isArray(card.effects) &&
      card.effects.some((e) => !e?.text?.trim() || isSentinelEffectText(e.text));

    if (evaluated.effectStatus === 'no_printed_effect') {
      pushSample(
        'vanillaNoPrintedEffect',
        makeSample('Vanilla / No printed effect category')
      );
    } else if (evaluated.effectStatus === 'unavailable') {
      pushSample(
        'unavailableEffectText',
        makeSample('English effect text unavailable on Wiki')
      );
      cardAffected = true;
      missingEffFlag = true;
    } else if (!hasMeaningfulEffects(card.effects) || hasSentinel) {
      pushSample(
        'missingEffectText',
        makeSample(
          hasSentinel
            ? 'Contains sentinel/placeholder effect text'
            : 'Missing English effect text'
        )
      );
      cardAffected = true;
      missingEffFlag = true;
    }

    // Metadata category
    const missingMeta = getCardBasicMissingFields(card);
    if (missingMeta.length > 0) {
      pushSample(
        'missingMetadata',
        makeSample(`Missing metadata field(s): ${missingMeta.join(', ')}`)
      );
      cardAffected = true;
      missingMetaFlag = true;
    }

    // Wiki match / non-card category
    if (isCardSuspectedMismatched(card)) {
      pushSample(
        'mismatchedWikiPage',
        makeSample(
          isLikelyNonCardWikiTitle(card.wikiTitle || card.name)
            ? `Non-card Wiki title "${card.wikiTitle || card.name}"`
            : 'Missing verified Wiki page match / unhydrated'
        )
      );
      cardAffected = true;
      mismatchedFlag = true;
    }

    // Falsely marked complete / wiki-loaded despite missing required fields
    const lacksRequiredEffects =
      !hasMeaningfulEffects(card.effects) &&
      evaluated.effectStatus !== 'no_printed_effect';
    const lacksUsableArt = !artRaw || isPlaceholder || evaluated.artworkStatus === 'broken';
    const lacksCoreMeta =
      !card.isToken &&
      card.type !== 'Magic' &&
      card.type !== 'Nexus' &&
      (!card.families || card.families.length === 0);

    if (
      (card.isWikiLoaded || card.completionStatus === 'complete') &&
      (lacksRequiredEffects || lacksUsableArt || lacksCoreMeta || isLikelyNonCardWikiTitle(card.wikiTitle || card.name))
    ) {
      const reasons: string[] = [];
      if (lacksUsableArt) reasons.push('artwork');
      if (lacksRequiredEffects) reasons.push('effects');
      if (lacksCoreMeta) reasons.push('families');
      if (isLikelyNonCardWikiTitle(card.wikiTitle || card.name)) reasons.push('nonCardTitle');
      pushSample(
        'incompleteDespiteSuccess',
        makeSample(`Marked loaded/complete despite missing: ${reasons.join(', ')}`)
      );
      cardAffected = true;
    }

    if (cardAffected) {
      setRow.affectedCount++;
      if (missingArtFlag) setRow.missingArtworkCount++;
      if (missingEffFlag) setRow.missingEffectCount++;
      if (missingMetaFlag) setRow.missingMetadataCount++;
      if (mismatchedFlag) setRow.mismatchedCount++;
    }
  }

  // Audit skipped / rejected entries in state.discoveredCards
  const catalogDeps = buildCatalogDeps(deps);
  const validation = validateCatalogImport(
    options?.setCodes?.length ? { setCodes: options.setCodes } : undefined,
    catalogDeps
  );
  const discoveredList = Object.values(state.discoveredCards || {});
  const rejectedKeySet = new Set<string>(validation.rejectedCards.map((r) => r.discoveryKey));

  for (const r of validation.rejectedCards) {
    pushSample('skippedOrRejectedEntries', {
      id: r.discoveryKey,
      cardNumber: r.cardNumber,
      name: r.name,
      setCode: r.normalizedSetCode || r.originalSetCode,
      wikiTitle: r.wikiTitle,
      issueSummary: `${r.diagnosticCategory}: ${r.reason}`,
      source: 'discovered_rejected',
    });
  }

  for (const entry of discoveredList) {
    if (entry.imported) continue;
    if (rejectedKeySet.has(entry.discoveryKey)) continue;
    if (
      setFilter &&
      !setFilter.has(normalizeSetCode(entry.sourceSetCode)) &&
      !setFilter.has(entry.sourceSetCode.toUpperCase())
    ) {
      continue;
    }
    if (entry.classification === 'uncertain' || entry.classification === 'potential_duplicate') {
      pushSample('skippedOrRejectedEntries', {
        id: entry.discoveryKey,
        cardNumber: entry.card.cardNumber,
        name: entry.card.name,
        setCode: entry.sourceSetCode,
        wikiTitle: entry.sourceWikiTitle,
        issueSummary: `${entry.classification} (${entry.matchSignals.join(', ')})`,
        source: 'discovered_rejected',
      });
    }
  }

  const affectedSets = Array.from(setIssueMap.values())
    .filter((s) => s.affectedCount > 0)
    .sort((a, b) => b.affectedCount - a.affectedCount);

  const report: CatalogAuditReport = {
    auditedAt: new Date().toISOString(),
    verifiedArtworkOnline: Boolean(options?.verifyArtworkOnline),
    totalInspectedCards: pool.length,
    publicCardsCount,
    importedStateCount,
    discoveredEntriesCount: discoveredList.length,
    completeVerifiedCount,
    partialCount,
    incompleteCount,
    needsReviewCount,
    categories,
    rejectedBreakdown: {
      totalRejected: validation.rejectedCards.length,
      recoverable: validation.rejectedCards.filter((r) => r.recoverable).length,
      confirmedDuplicates: validation.confirmedDuplicatesCount,
      unrecoverableOrNeedsReview: validation.rejectedCards.filter((r) => !r.recoverable).length,
    },
    affectedSets: affectedSets.slice(0, 60),
    samples,
  };

  const repairState = loadCatalogRepairState(deps?.repairStatePath);
  repairState.lastAuditReport = report;
  saveCatalogRepairState(repairState, deps?.repairStatePath);

  return report;
}

/**
 * Checks whether a fetched Wiki page bundle represents the specific printing/card
 * rather than an unrelated or different-set printing sharing a card name.
 */
function doesWikiBundleMatchCardPrinting(
  card: BattleSpiritsCard,
  wikiTitle: string,
  bundle: WikiPageBundle
): { matched: boolean; reason?: string; confidence: number } {
  const blocks = extractTaggedCardTableBlocks(bundle.wikitext || '');
  if (blocks.length === 0) {
    return { matched: false, reason: 'no CardTable template', confidence: 0 };
  }

  const scored = scoreWikiCandidatePage(
    {
      title: wikiTitle,
      wikitext: bundle.wikitext,
      pageImages: bundle.pageImages || [],
    },
    {
      cardNumber: card.cardNumber,
      name: card.name,
      jpName: card.jpName,
      setCode: card.setCode,
      wikiTitle: card.wikiTitle || wikiTitle,
      isRevival: card.isRevival,
    }
  );

  const rawNum = (card.cardNumber || '').trim().toUpperCase();
  const baseNum = rawNum.replace(/\s*\([AB]\)$/i, '').trim();
  const compactNum = baseNum.replace(/[^A-Z0-9]/g, '');
  const targetSet = normalizeSetCode(card.setCode || '');

  // If the card has a real non-synthetic cardNumber and the page explicitly lists cardNumbers,
  // verify that either our cardNumber OR our normalized setCode is actually on this page
  // (so e.g. Johnny Bepp 26RCB02-057 never borrows SD50-CP01 if 26RCB02 is absent).
  if (compactNum && !isSyntheticCardNumber(rawNum) && scored.meta.cardNumbersInPage.length > 0) {
    const pageHasCardNum =
      scored.meta.cardNumbersInPage.some(
        (n) => n.replace(/[^A-Z0-9]/g, '').toUpperCase() === compactNum
      ) ||
      bundle.wikitext.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(compactNum) ||
      (bundle.pageImages || []).some((img) =>
        img.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(compactNum)
      );

    const pageHasSet = Boolean(
      targetSet &&
        scored.meta.sets.some((s) => normalizeSetCode(s) === targetSet)
    );

    if (!pageHasCardNum && !pageHasSet) {
      return {
        matched: false,
        reason: `printing mismatch (${rawNum}/${targetSet} absent on ${wikiTitle}; page has ${scored.meta.cardNumbersInPage.slice(0, 3).join(', ')})`,
        confidence: Math.max(0, scored.score),
      };
    }
  }

  if (!scored.accepted) {
    return {
      matched: false,
      reason: scored.reasons.join('; ') || 'candidate score below threshold',
      confidence: Math.max(0, scored.score),
    };
  }

  return { matched: true, confidence: Math.min(100, scored.score) };
}

/**
 * Searches Battle Spirits Wiki by card number / name / jpName when direct wikiTitle lookup
 * failed or returned a non-card / mismatched page.
 */
async function discoverMatchingWikiTitleForCard(
  card: BattleSpiritsCard,
  fetchWikiJsonFn: (params: Record<string, string>) => Promise<Record<string, unknown>>,
  batchFetchFn: (titles: string[]) => Promise<Map<string, WikiPageBundle>>
): Promise<{ title: string; bundle: WikiPageBundle; confidence: number } | null> {
  const queries: string[] = [];
  const rawNum = (card.cardNumber || '').trim();
  const baseNum = rawNum.replace(/\s*\([AB]\)$/i, '').trim();
  if (baseNum && !isSyntheticCardNumber(baseNum)) {
    queries.push(`"${baseNum}"`);
  }
  const cleanName = (card.name || '')
    .replace(/\s*\(Revival\)\s*/gi, '')
    .replace(/\s*\([AB]\)$/i, '')
    .trim();
  if (cleanName && !isLikelyNonCardWikiTitle(cleanName)) {
    queries.push(cleanName);
  }
  if (card.jpName?.trim()) {
    queries.push(card.jpName.trim());
  }

  const candidateTitles: string[] = [];
  const seenTitles = new Set<string>();
  const addTitle = (t: string) => {
    const clean = (t || '').trim();
    if (!clean || isLikelyNonCardWikiTitle(clean) || seenTitles.has(clean.toLowerCase())) return;
    seenTitles.add(clean.toLowerCase());
    candidateTitles.push(clean);
  };

  for (const q of queries.slice(0, 3)) {
    try {
      const json = (await fetchWikiJsonFn({
        action: 'query',
        list: 'search',
        srsearch: q,
        srnamespace: '0',
        srlimit: '8',
      })) as { query?: { search?: Array<{ title?: string }> } };

      for (const hit of json.query?.search || []) {
        if (hit.title) addTitle(hit.title);
      }
    } catch {
      // ignore individual search failure
    }
    if (candidateTitles.length >= 10) break;
  }

  if (candidateTitles.length === 0) return null;

  const fetched = await batchFetchFn(candidateTitles.slice(0, 10));
  let best: { title: string; bundle: WikiPageBundle; confidence: number } | null = null;

  for (const title of candidateTitles.slice(0, 10)) {
    const bundle = fetched.get(title);
    if (!bundle?.wikitext) continue;
    const check = doesWikiBundleMatchCardPrinting(card, title, bundle);
    if (!check.matched) continue;
    if (!best || check.confidence > best.confidence) {
      best = { title, bundle, confidence: check.confidence };
    }
  }

  return best;
}

function collectCandidateArtworkFilesForCard(
  card: BattleSpiritsCard,
  bundle?: WikiPageBundle
): string[] {
  const candidates: string[] = [];
  const push = (val?: string) => {
    const clean = (val || '').replace(/^File:/i, '').trim();
    if (!clean || !isCardArtworkFile(clean)) return;
    if (!candidates.some((c) => c.toLowerCase() === clean.toLowerCase())) {
      candidates.push(clean);
    }
  };

  const manual = findManualCardMapping(card);
  if (manual?.fileName) {
    push(manual.fileName);
  }

  const existingParam = extractArtworkFileParam(card.artworkImage);
  if (existingParam && !isPlaceholderArtworkUrl(card.artworkImage)) {
    for (const expanded of expandWikiFileCandidates(existingParam, card.cardNumber, {
      isSideB: /\(B\)$/i.test(card.cardNumber || ''),
      isRevival: card.isRevival,
    })) {
      push(expanded);
    }
  }

  if (bundle?.wikitext) {
    const blocks = extractTaggedCardTableBlocks(bundle.wikitext);
    const chosen =
      (card.isRevival ? blocks.find((b) => b.isRevival) : blocks.find((b) => !b.isRevival)) ||
      blocks[0];
    if (chosen) {
      const fields = parseTemplateFields(chosen.block);
      const rawImg = cleanWikitextInline(
        fields.image || fields.image1 || fields.aimage || fields.altimage || fields.secretimage || ''
      ).trim();
      if (rawImg) {
        for (const expanded of expandWikiFileCandidates(rawImg, card.cardNumber, {
          isSideB: /\(B\)$/i.test(card.cardNumber || ''),
          isRevival: card.isRevival,
        })) {
          push(expanded);
        }
      }
    }
  }

  // Also examine pageImages on the verified card page matching cardNumber
  const compactNum = (card.cardNumber || '')
    .trim()
    .toUpperCase()
    .replace(/\s*\([AB]\)$/i, '')
    .replace(/[^A-Z0-9]/g, '');
  if (bundle?.pageImages && bundle.pageImages.length > 0) {
    const numMatchedImages = compactNum
      ? bundle.pageImages.filter((f) =>
          f.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(compactNum)
        )
      : [];
    for (const f of [...numMatchedImages, ...bundle.pageImages]) {
      for (const expanded of expandWikiFileCandidates(f, card.cardNumber, {
        isSideB: /\(B\)$/i.test(card.cardNumber || ''),
        isRevival: card.isRevival,
      })) {
        push(expanded);
      }
    }
  }

  // Last fallback: cardNumber standard naming (without fabricating URLs unless verified on Wiki)
  if (card.cardNumber && !isSyntheticCardNumber(card.cardNumber)) {
    for (const expanded of expandWikiFileCandidates(undefined, card.cardNumber, {
      isSideB: /\(B\)$/i.test(card.cardNumber),
      isRevival: card.isRevival,
    })) {
      push(expanded);
    }
  }

  return candidates.slice(0, 18);
}

/**
 * PHASE 4 & 5: Non-destructive, targeted, resumable batch repair engine.
 * Processes a batch of cards, verifies Wiki pages & artwork filenames via batch MediaWiki APIs,
 * strips sentinel effect strings, protects ManualWikiMapping entries, flags non-card pages,
 * and persists updated records to public/cards.json & catalog-sync-state.json.
 */
export async function runCatalogRepairBatch(
  options?: {
    mode?: RepairMode;
    setCodes?: string[];
    batchSize?: number;
    updatePublicCardsJson?: boolean;
    autoImportRecovered?: boolean;
  },
  deps?: RepairDependencies
): Promise<CatalogRepairBatchResult> {
  const mode: RepairMode = options?.mode || 'all_incomplete';
  const batchSize = Math.max(1, Math.min(500, options?.batchSize ?? 120));
  const updatePublic = options?.updatePublicCardsJson !== false;
  const setFilter = options?.setCodes?.length
    ? new Set(options.setCodes.map((s) => normalizeSetCode(s)))
    : null;

  const batchFetchFn = deps?.batchFetchPagesFn || batchFetchWikiPages;
  const batchVerifyFn = deps?.batchVerifyFilesFn || batchVerifyWikiFilesExist;
  const fetchJsonFn = deps?.fetchWikiJsonFn || fetchWikiJson;

  const repairState = loadCatalogRepairState(deps?.repairStatePath);
  const { publicPayload, publicIndexById, state, pool } = buildInspectedCardPool(
    deps,
    setFilter
  );
  const poolById = new Map(pool.map((p) => [p.card.id, p]));

  // Build or resume repair queue
  if (mode !== 'resume' || repairState.remainingIds.length === 0) {
    const queueIds = pool
      .filter(({ card }) => isCardEligibleForRepairMode(card, mode))
      .map(({ card }) => card.id);

    repairState.jobStatus = 'running';
    repairState.mode = mode;
    repairState.startedAt = new Date().toISOString();
    repairState.completedAt = null;
    repairState.totalQueueCount = queueIds.length;
    repairState.processedCount = 0;
    repairState.remainingIds = queueIds;
    repairState.stats = createEmptyRepairState().stats;
    repairState.lastErrors = [];
  } else {
    repairState.jobStatus = 'running';
  }

  const nowIso = new Date().toISOString();
  const batchIds = repairState.remainingIds.slice(0, batchSize);
  const batchCards = batchIds
    .map((id) => poolById.get(id)?.card)
    .filter((c): c is BattleSpiritsCard => Boolean(c));

  const repairedSampleIds: string[] = [];
  let publicCardsDirty = false;
  let syncStateDirty = false;

  // Step 1: Collect titles to fetch in one batched Wiki query
  const needWikiFetch = mode !== 'reprocess_rejected';
  const titlesToFetch: string[] = [];
  const lookupTitleByCardId = new Map<string, string>();
  if (needWikiFetch && batchCards.length > 0) {
    const seen = new Set<string>();
    for (const card of batchCards) {
      const manual = findManualCardMapping(card);
      const rawTitle = (manual?.wikiTitle || card.wikiTitle || card.name || '').trim();
      if (rawTitle && !isLikelyNonCardWikiTitle(rawTitle)) {
        lookupTitleByCardId.set(card.id, rawTitle);
        if (!seen.has(rawTitle)) {
          seen.add(rawTitle);
          titlesToFetch.push(rawTitle);
        }
      }
    }
  }

  const fetchedBundles =
    titlesToFetch.length > 0
      ? await batchFetchFn(titlesToFetch)
      : new Map<string, WikiPageBundle>();

  // Pre-verify which cards need search discovery, and run discovery concurrently (worker pool of 8)
  const searchCache = new Map<string, Record<string, unknown>>();
  const cachedFetchJson = async (params: Record<string, string>) => {
    const cacheKey = JSON.stringify(params);
    const cached = searchCache.get(cacheKey);
    if (cached) return cached;
    const res = await fetchJsonFn(params);
    searchCache.set(cacheKey, res);
    return res;
  };

  const discoveredByCardId = new Map<
    string,
    { title: string; bundle: WikiPageBundle; confidence: number }
  >();
  const discoveryQueue: BattleSpiritsCard[] = [];

  for (const card of batchCards) {
    const manual = findManualCardMapping(card);
    if (manual) continue;
    const lookupTitle = lookupTitleByCardId.get(card.id);
    const candidateBundle = lookupTitle ? fetchedBundles.get(lookupTitle) : undefined;
    let needsSearch = !candidateBundle?.wikitext;
    if (candidateBundle?.wikitext) {
      const check = doesWikiBundleMatchCardPrinting(
        card,
        lookupTitle || card.wikiTitle || card.name,
        candidateBundle
      );
      if (!check.matched) needsSearch = true;
    }
    if (
      needsSearch &&
      (mode === 'retry_matching' ||
        mode === 'all_incomplete' ||
        mode === 'effects_only' ||
        mode === 'artwork_only' ||
        mode === 'resume')
    ) {
      discoveryQueue.push(card);
    }
  }

  if (discoveryQueue.length > 0) {
    let cursor = 0;
    const concurrency = Math.min(8, discoveryQueue.length);
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= discoveryQueue.length) break;
          const card = discoveryQueue[idx];
          const discovered = await discoverMatchingWikiTitleForCard(
            card,
            cachedFetchJson,
            batchFetchFn
          );
          if (discovered) {
            discoveredByCardId.set(card.id, discovered);
          }
        }
      })
    );
  }

  // Step 2: Hydrate/re-match cards in memory and gather candidate artwork files for batch verification
  const stagedCards: Array<{
    original: BattleSpiritsCard;
    updated: BattleSpiritsCard;
    bundle?: WikiPageBundle;
    hints: CardCompletenessHints;
    manual: ReturnType<typeof findManualCardMapping>;
    candidateArtFiles: string[];
  }> = [];
  const allFilesToVerify = new Set<string>();

  for (const card of batchCards) {
    const manual = findManualCardMapping(card);
    if (manual) {
      repairState.stats.manualMappingsPreserved++;
    }

    const baseSanitizedEffects = sanitizeEffectsArray(card.effects);
    let working: BattleSpiritsCard = {
      ...card,
      effects: baseSanitizedEffects,
    };

    const lookupTitle = lookupTitleByCardId.get(card.id);
    let matchedBundle = lookupTitle ? fetchedBundles.get(lookupTitle) : undefined;
    let hints: CardCompletenessHints = {};

    // Verify if the fetched Wiki bundle actually belongs to this card printing
    if (matchedBundle?.wikitext) {
      const check = doesWikiBundleMatchCardPrinting(
        card,
        lookupTitle || card.wikiTitle || card.name,
        matchedBundle
      );
      if (manual) {
        // Respect manual Wiki title association
        hints.hasCardTable = extractTaggedCardTableBlocks(matchedBundle.wikitext).length > 0;
        hints.wikiMatchConfidence = 100;
      } else if (!check.matched) {
        matchedBundle = undefined;
      } else {
        hints.hasCardTable = true;
        hints.wikiMatchConfidence = check.confidence;
      }
    }

    // Apply pre-discovered Wiki page match if needed
    if (!matchedBundle && !manual) {
      const discovered = discoveredByCardId.get(card.id);
      if (discovered) {
        matchedBundle = discovered.bundle;
        working.wikiTitle = discovered.title;
        working.wikiUrl = `https://battle-spirits.fandom.com/wiki/${encodeURIComponent(
          discovered.title.replace(/\s+/g, '_')
        )}`;
        hints.hasCardTable = true;
        hints.wikiMatchConfidence = discovered.confidence;
        if (card.wikiTitle !== discovered.title) {
          repairState.stats.repairedMatches++;
        }
      }
    }

    if (matchedBundle?.wikitext) {
      const hydrated = hydrateCardFromWikitext(
        working,
        matchedBundle.wikitext,
        matchedBundle.pageImages || []
      );
      if (!hydrated.isWikiLoaded) {
        // Page has wikitext without CardTable
        const isNonCard =
          Boolean(matchedBundle.wikitext.trim()) ||
          isLikelyNonCardWikiTitle(working.wikiTitle || working.name);
        hints.hasCardTable = false;
        hints.isNonCardPage = isNonCard;
        working = {
          ...working,
          isWikiLoaded: false,
          needsManualReview: isNonCard,
        };
        if (isNonCard) repairState.stats.flaggedManualReview++;
      } else {
        hints.hasCardTable = true;
        hints.hasNoPrintedEffectCategory = hydrated.effectStatus === 'no_printed_effect';
        hints.hasJpEffectOnly =
          hydrated.effectStatus === 'unavailable' && !hasMeaningfulEffects(hydrated.effects);

        const nextEffects =
          baseSanitizedEffects.length > 0
            ? baseSanitizedEffects
            : hasMeaningfulEffects(hydrated.effects)
            ? hydrated.effects
            : [];

        const nextFamilies =
          mode === 'artwork_only' && working.families?.length > 0
            ? working.families
            : hydrated.families?.length > 0
            ? hydrated.families
            : working.families || [];

        // Keep manual artwork untouched; otherwise upgrade missing/placeholder/broken artwork
        const existingArtUsable =
          Boolean(working.artworkImage?.trim()) &&
          !isPlaceholderArtworkUrl(working.artworkImage) &&
          working.artworkStatus !== 'broken';
        const nextArt = manual
          ? card.artworkImage
          : existingArtUsable
          ? working.artworkImage
          : hydrated.artworkImage && !isPlaceholderArtworkUrl(hydrated.artworkImage)
          ? hydrated.artworkImage
          : '';

        working = {
          ...working,
          jpName: working.jpName || hydrated.jpName || '',
          illustrator: working.illustrator || hydrated.illustrator || '',
          flavorText: working.flavorText || hydrated.flavorText || '',
          families: nextFamilies,
          effects: nextEffects,
          levels: working.levels?.length ? working.levels : hydrated.levels,
          colors: hydrated.colors?.length ? hydrated.colors : working.colors,
          color: hydrated.color || working.color,
          secondaryColor: hydrated.secondaryColor ?? working.secondaryColor,
          cost:
            Number.isFinite(working.cost) && working.cost > 0
              ? working.cost
              : hydrated.cost,
          keywords: hydrated.keywords?.length ? hydrated.keywords : working.keywords,
          galleryImages:
            hydrated.galleryImages?.length
              ? hydrated.galleryImages
              : working.galleryImages,
          artworkImage: nextArt,
          wikiTitle: manual?.wikiTitle || hydrated.wikiTitle || working.wikiTitle,
          isWikiLoaded: true,
          effectStatus: hydrated.effectStatus,
          effectVerified: hydrated.effectVerified,
        };
      }
    } else {
      // Genuine miss on Wiki: do NOT mark isWikiLoaded=true or completionStatus='complete'
      const nonCard = isLikelyNonCardWikiTitle(working.wikiTitle || working.name);
      hints.wikitextEmpty = !nonCard;
      hints.isNonCardPage = nonCard;
      if (!manual && isPlaceholderArtworkUrl(working.artworkImage)) {
        working.artworkImage = '';
      }
      working = {
        ...working,
        isWikiLoaded: false,
        needsManualReview: nonCard || Boolean(working.needsManualReview),
      };
      if (nonCard) repairState.stats.flaggedManualReview++;
      else repairState.stats.markedUnavailable++;
    }

    const candidateArtFiles =
      manual?.artworkUrl && /^https?:\/\//i.test(manual.artworkUrl)
        ? []
        : collectCandidateArtworkFilesForCard(working, matchedBundle);
    for (const f of candidateArtFiles) {
      allFilesToVerify.add(f);
    }

    stagedCards.push({
      original: card,
      updated: working,
      bundle: matchedBundle,
      hints,
      manual,
      candidateArtFiles,
    });
  }

  // Step 3: Batch verify all candidate artwork files against Wiki MediaWiki imageinfo
  const verifiedFilesMap =
    allFilesToVerify.size > 0
      ? await batchVerifyFn(Array.from(allFilesToVerify))
      : new Map<string, string | null>();

  // Step 4: Finalize each staged card's artwork, completeness status & persist changes
  for (const item of stagedCards) {
    const { original, hints, manual, candidateArtFiles, bundle } = item;
    let updated = item.updated;

    if (manual?.artworkUrl && /^https?:\/\//i.test(manual.artworkUrl)) {
      updated.artworkImage = manual.artworkUrl;
      hints.artworkFileExists = true;
    } else if (candidateArtFiles.length > 0) {
      const hitFile = candidateArtFiles.find((f) =>
        Boolean(verifiedFilesMap.get(f.toLowerCase()))
      );
      if (hitFile) {
        const nextUrl = `/api/wiki/image?file=${encodeURIComponent(hitFile)}`;
        if (
          !manual &&
          (!updated.artworkImage ||
            isPlaceholderArtworkUrl(updated.artworkImage) ||
            updated.artworkStatus === 'broken' ||
            updated.artworkStatus !== 'verified' ||
            extractArtworkFileParam(updated.artworkImage).toLowerCase() !==
              hitFile.toLowerCase())
        ) {
          updated.artworkImage = nextUrl;
        }
        hints.artworkFileExists = true;
      } else {
        hints.artworkFileExists = false;
        const hadExistingFileParam = Boolean(extractArtworkFileParam(original.artworkImage));
        hints.artworkFailureReason =
          !bundle?.wikitext || !hadExistingFileParam
            ? 'unavailable_on_wiki'
            : 'broken_url';
        if (!manual && isPlaceholderArtworkUrl(updated.artworkImage)) {
          updated.artworkImage = '';
        }
      }
    } else {
      hints.artworkFileExists = false;
      hints.artworkFailureReason = 'unavailable_on_wiki';
      if (!manual && isPlaceholderArtworkUrl(updated.artworkImage)) {
        updated.artworkImage = '';
      }
    }

    const comp = evaluateCardCompleteness(updated, hints);
    updated = {
      ...updated,
      ...comp,
      recordSaved: true,
      lastAuditAt: nowIso,
      lastRepairedAt: nowIso,
    };

    // Track concrete improvements
    const artRecovered =
      (!original.artworkVerified && comp.artworkVerified) ||
      (isPlaceholderArtworkUrl(original.artworkImage) && comp.artworkVerified) ||
      (!original.artworkImage && Boolean(updated.artworkImage) && comp.artworkVerified);
    const effRecovered =
      !hasMeaningfulEffects(original.effects) &&
      (hasMeaningfulEffects(updated.effects) || comp.effectStatus === 'no_printed_effect');
    const metaRecovered =
      ((!original.families || original.families.length === 0) &&
        Boolean(updated.families?.length)) ||
      (!original.jpName && Boolean(updated.jpName));

    if (artRecovered) repairState.stats.repairedArtwork++;
    if (effRecovered) repairState.stats.repairedEffects++;
    if (metaRecovered) repairState.stats.repairedMetadata++;
    if (artRecovered || effRecovered || metaRecovered || comp.completionStatus === 'complete') {
      repairState.stats.repairedCards++;
      if (repairedSampleIds.length < 30) repairedSampleIds.push(updated.id);
    } else if (comp.completionStatus !== 'complete') {
      repairState.stats.stillUnresolved++;
    }

    // Write back into publicPayload & state.importedCards
    const pubIdx = publicIndexById.get(updated.id);
    if (publicPayload && pubIdx !== undefined) {
      publicPayload.cards[pubIdx] = updated;
      publicCardsDirty = true;
    }
    if (state.importedCards[updated.id]) {
      state.importedCards[updated.id] = updated;
      syncStateDirty = true;
    }
    // Sync matching discoveredCards entries so catalog comparisons reflect repaired card fields
    for (const d of Object.values(state.discoveredCards)) {
      if (d.matchedExistingId === updated.id || d.card.id === updated.id) {
        d.card = {
          ...d.card,
          jpName: updated.jpName || d.card.jpName,
          illustrator: updated.illustrator || d.card.illustrator,
          flavorText: updated.flavorText || d.card.flavorText,
          families: updated.families?.length ? updated.families : d.card.families,
          effects: updated.effects?.length ? updated.effects : d.card.effects,
          artworkImage: updated.artworkImage || d.card.artworkImage,
          wikiTitle: updated.wikiTitle || d.card.wikiTitle,
          isWikiLoaded: updated.isWikiLoaded,
          artworkVerified: updated.artworkVerified,
          artworkStatus: updated.artworkStatus,
          effectVerified: updated.effectVerified,
          effectStatus: updated.effectStatus,
          metadataVerified: updated.metadataVerified,
          metadataStatus: updated.metadataStatus,
          completionStatus: updated.completionStatus,
          lastRepairedAt: nowIso,
        };
        const fileParam = extractArtworkFileParam(d.card.artworkImage);
        if (fileParam) {
          d.rawArtworkFile = fileParam;
          d.hasArtworkHint = true;
        }
        syncStateDirty = true;
      }
    }
  }

  // Step 5: Handle rejected/skipped discovered entries when requested
  let reprocessResult:
    | {
        reprocessedCount: number;
        recoveredToReadyCount: number;
        addedCardsCount: number;
      }
    | undefined;

  if (mode === 'reprocess_rejected' || options?.autoImportRecovered) {
    // Flag non-card titles inside discoveredCards before reprocessing
    for (const entry of Object.values(state.discoveredCards)) {
      if (entry.imported) continue;
      if (isLikelyNonCardWikiTitle(entry.sourceWikiTitle || entry.card.wikiTitle || entry.card.name)) {
        entry.card = {
          ...entry.card,
          isWikiLoaded: false,
          needsManualReview: true,
          completionStatus: 'needs_review',
        };
        entry.approvedForImport = false;
        syncStateDirty = true;
      }
    }
    if (syncStateDirty) {
      saveCatalogScanState(state, deps?.stateFilePath);
      syncStateDirty = false;
    }

    const repRes = await reprocessAndRetryCatalogEntries(
      {
        setCodes: options?.setCodes,
        autoImport: Boolean(options?.autoImportRecovered || mode === 'reprocess_rejected'),
        rehydrateSynthetic: true,
      },
      buildCatalogDeps(deps)
    );
    const addedCardsCount = repRes.importResult?.addedCardsCount ?? 0;
    repairState.stats.recoveredRejected += repRes.recoveredToReadyCount + addedCardsCount;
    reprocessResult = {
      reprocessedCount: repRes.reprocessedCount,
      recoveredToReadyCount: repRes.recoveredToReadyCount,
      addedCardsCount,
    };
  }

  if (syncStateDirty) {
    saveCatalogScanState(state, deps?.stateFilePath);
  }
  if (updatePublic && publicCardsDirty && publicPayload && !deps?.existingCardsProvider) {
    writePublicCardsFile(publicPayload, deps?.publicCardsJsonPath);
  }

  // Advance queue & checkpoint
  const processedSet = new Set(batchIds);
  repairState.remainingIds = repairState.remainingIds.filter((id) => !processedSet.has(id));
  repairState.processedCount += batchIds.length;
  repairState.jobStatus =
    repairState.remainingIds.length > 0 ? 'paused' : 'completed';
  if (repairState.jobStatus === 'completed') {
    repairState.completedAt = new Date().toISOString();
  }
  saveCatalogRepairState(repairState, deps?.repairStatePath);

  return {
    mode,
    batchProcessedCount: batchIds.length,
    remainingCount: repairState.remainingIds.length,
    jobStatus: repairState.jobStatus,
    stats: { ...repairState.stats },
    repairedSampleIds,
    reprocessResult,
    repairState,
  };
}

export function getCatalogRepairStatus(deps?: RepairDependencies): CatalogRepairState {
  return loadCatalogRepairState(deps?.repairStatePath);
}

export function resetCatalogRepairStateForTests(repairStatePath?: string): void {
  const target = getRepairStatePath(repairStatePath);
  try {
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } catch {
    // ignore
  }
}

export type { ImportExecutionResult, RejectedCatalogCard, DiscoveredCardEntry };
