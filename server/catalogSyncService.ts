import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  BattleSpiritsCard,
  CardColor,
  GameFormat,
  ProductSet,
  SetCategory,
} from '../src/types/card.ts';
import { getManualWikiMapping } from '../src/utils/ManualWikiMapping.ts';
import {
  batchFetchWikiPages,
  cleanWikitextInline,
  defaultVariant,
  enrichSetMetadata,
  ensureBanListLoaded,
  extractTaggedCardTableBlocks,
  fetchWikiJson,
  getSyncedWikiDirectory,
  hydrateCardFromWikitext,
  normalizeColor,
  normalizeRarity,
  normalizeType,
  parseSetTableRows,
  parseTemplateFields,
  resolveCardRestriction,
  upsertStoredSetMetadata,
  WIKI_BASE,
  type WikiPageBundle,
} from './wikiService.ts';

export type SetScanStatus = 'pending' | 'scanning' | 'completed' | 'failed';
export type ComparisonClassification =
  | 'matched'
  | 'missing'
  | 'uncertain'
  | 'potential_duplicate'
  | 'updated_metadata';

export interface DiscoveredSetRecord extends ProductSet {
  sources: string[];
  isNumberOnly: boolean;
  inSpiritsdex: boolean;
  scanStatus: SetScanStatus;
  lastScanAt: string | null;
  lastError: string | null;
  discoveredCount: number;
  existingCount: number;
  missingCount: number;
  updatedCount: number;
  uncertainCount: number;
  duplicateCount: number;
  incompleteCount: number;
  missingArtworkCount: number;
}

export interface DiscoveredCardEntry {
  discoveryKey: string;
  card: BattleSpiritsCard;
  sourceSetCode: string;
  sourceWikiTitle: string;
  alternateNames: string[];
  rawArtworkFile: string;
  hasArtworkHint: boolean;
  incompleteFields: string[];
  parseWarnings: string[];
  classification: ComparisonClassification;
  matchedExistingId?: string;
  matchSignals: string[];
  matchConfidence: number;
  metadataDeltas: string[];
  approvedForImport: boolean;
  imported: boolean;
  importedAt?: string | null;
}

export interface CatalogScanErrorLog {
  setCode: string;
  page?: string;
  message: string;
  timestamp: string;
}

export interface CatalogScanState {
  jobStatus: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  totalSetsToScan: number;
  scannedSetsCount: number;
  currentSetCode: string | null;
  pendingSetCodes: string[];
  failedSetCodes: string[];
  errorLogs: CatalogScanErrorLog[];
  sets: Record<string, DiscoveredSetRecord>;
  discoveredCards: Record<string, DiscoveredCardEntry>;
  importedCards: Record<string, BattleSpiritsCard>;
}

export interface CatalogDependencies {
  fetchWikiJsonFn?: (params: Record<string, string>) => Promise<Record<string, unknown>>;
  batchFetchPagesFn?: (titles: string[]) => Promise<Map<string, WikiPageBundle>>;
  existingCardsProvider?: () => BattleSpiritsCard[];
  stateFilePath?: string;
}

export interface CatalogOverviewSummary {
  totalWikiSetsDiscovered: number;
  totalSetsInSpiritsdex: number;
  setsScanned: number;
  setsPending: number;
  setsFailed: number;
  numberOnlySetsCount: number;
  totalWikiCardsDiscovered: number;
  existingCardsMatched: number;
  missingCards: number;
  updatedMetadataCards: number;
  cardsPendingReview: number;
  potentialDuplicates: number;
  incompleteMetadataCards: number;
  missingArtworkCards: number;
  importedCardsCount: number;
  jobStatus: CatalogScanState['jobStatus'];
  currentSetCode: string | null;
  scannedSetsCount: number;
  totalSetsToScan: number;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
}

export interface ImportValidationReport {
  valid: boolean;
  willAddSets: number;
  willAddCards: number;
  willUpdateMetadata: number;
  skippedUncertain: number;
  skippedDuplicates: number;
  skippedAlreadyImported: number;
  manualMappingsProtected: number;
  warnings: string[];
  selectedKeys: string[];
}

export interface ImportExecutionResult {
  addedSetsCount: number;
  addedCardsCount: number;
  updatedMetadataCount: number;
  skippedCount: number;
  importedCards: BattleSpiritsCard[];
  importedSets: ProductSet[];
}

const DEFAULT_RUNTIME_DIR =
  process.env.SPIRITSDEX_RUNTIME_DIR || '/tmp/spiritsdex-runtime';
const DEFAULT_STATE_FILE = path.join(DEFAULT_RUNTIME_DIR, 'catalog-sync-state.json');

const ALL_COLORS: CardColor[] = ['Red', 'Purple', 'White', 'Yellow', 'Green', 'Blue'];
const CARD_SETS_IGNORE_TITLES = new Set([
  'Card Sets',
  'Banned and Restricted Cards',
  'Battle Spirits Wiki',
  'Main Page',
  'Special:Search',
]);

let scanMutex = false;

function ensureDirForFile(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function normalizeCompareText(raw?: string): string {
  return (raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D`´]/g, "'")
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCompareCompact(raw?: string): string {
  return normalizeCompareText(raw).replace(/[^a-z0-9\p{L}\p{N}]/gu, '');
}

export function normalizeCardNumForCompare(raw?: string): string {
  return (raw || '')
    .trim()
    .toUpperCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, '');
}

export function sanitizeSetCode(rawTitle: string): string {
  const cleaned = rawTitle
    .trim()
    .replace(/^Category:/i, '')
    .replace(/^Standard Promo Cards\//i, 'STD-PROMO-')
    .replace(/^Promo Cards\//i, 'PROMO-');

  const directCode = cleaned.match(
    /^(?:26R[A-Z]{2,4}\d{1,3}|BS\d{1,3}|SD\d{1,3}|CBX?\d{1,3}|BSC\d{1,3}|PB\d{1,3}|PC\d{1,3}|LM\d{1,3}|EX\d{1,3}|HK[A-Z]{2}\d{1,3}|RP\d{2}-STD|PX\d{2}-STD|TOKENS|REVIVAL|\d{1,4})$/i
  );
  if (directCode) {
    const code = directCode[0].toUpperCase();
    return code;
  }

  const embedded = cleaned.match(
    /\b(26R[A-Z]{2,4}\d{1,3}|BS\d{2,3}|SD\d{2,3}|CBX?\d{2,3}|BSC\d{2,3}|PB\d{2,3}|PC\d{2,3}|HK(?:BP|SP)\d+)\b/i
  );
  if (embedded) {
    return embedded[1].toUpperCase();
  }

  const slug = cleaned
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || `SET-${crypto.createHash('sha1').update(rawTitle).digest('hex').slice(0, 8).toUpperCase()}`;
}

export function isNumberOnlySetIdentifier(setCode: string, name?: string): boolean {
  const code = setCode.trim().toUpperCase();
  if (/^\d+$/.test(code)) return true;
  if (/^(?:BS|SD|CB|BSC|PB|PC|LM|EX)\d+$/i.test(code)) {
    const cleanName = (name || '').trim().toUpperCase();
    return !cleanName || cleanName === code;
  }
  return false;
}

function inferSetCategoryAndFormats(
  sectionHeading: string,
  setCode: string,
  wikiTitle: string
): {
  category: SetCategory;
  formats: GameFormat[];
  productType: ProductSet['productType'];
  blockLabel: string;
} {
  const h = sectionHeading.toLowerCase();
  const upper = setCode.toUpperCase();
  const lowerTitle = wikiTitle.toLowerCase();

  const isStandard =
    h.includes('standard') ||
    /^26R/i.test(upper) ||
    upper === 'RP26-STD' ||
    upper === 'PX26-STD' ||
    lowerTitle.includes('standard promo');
  const formats: GameFormat[] = isStandard ? ['Standard', 'Eternal'] : ['Eternal'];

  if (h.includes('starter') || h.includes('mega') || h.includes('trial') || /^SD\d/i.test(upper) || /^26RSD/i.test(upper)) {
    return {
      category: isStandard ? 'Standard Starter' : 'Starter Deck',
      formats,
      productType: lowerTitle.includes('mega') ? 'Mega Deck' : 'Starter Deck',
      blockLabel: isStandard ? 'Standard Format Starter' : 'Eternal Starter / Mega Deck',
    };
  }
  if (h.includes('collab') || /^CB/i.test(upper) || /^26RCB/i.test(upper)) {
    return {
      category: 'Collab Booster',
      formats,
      productType: 'Collab Booster',
      blockLabel: isStandard ? 'Standard Collab' : 'Collab Booster',
    };
  }
  if (h.includes('promo') || lowerTitle.includes('promo')) {
    return {
      category: 'Promo',
      formats,
      productType: 'Promo Set',
      blockLabel: isStandard ? 'Standard Promo' : 'Eternal Promo',
    };
  }
  if (h.includes('premium') || /^PB\d/i.test(upper)) {
    return {
      category: 'Premium Bandai',
      formats,
      productType: 'Premium Bandai',
      blockLabel: 'Premium / Box Set',
    };
  }
  if (/^PC\d/i.test(upper)) {
    return {
      category: 'Premium Card Set',
      formats,
      productType: 'Premium Card Set',
      blockLabel: 'Premium Card Set',
    };
  }
  if (h.includes('supplementary') || h.includes('diva') || /^BSC\d/i.test(upper) || /^26RDB/i.test(upper)) {
    return {
      category: 'Supplementary',
      formats,
      productType: 'Supplementary Set',
      blockLabel: isStandard ? 'Standard Supplementary' : 'Supplementary Set',
    };
  }
  if (h.includes('candy') || h.includes('wafer')) {
    return {
      category: 'Promo',
      formats,
      productType: 'Promo Set',
      blockLabel: 'Candy Toy / Wafer Set',
    };
  }
  return {
    category: isStandard ? 'Standard Booster' : 'Booster',
    formats,
    productType: 'Booster Set',
    blockLabel: isStandard ? 'Standard Format (Block A+)' : 'Eternal Booster',
  };
}

export function loadCatalogScanState(stateFilePath = DEFAULT_STATE_FILE): CatalogScanState {
  try {
    if (fs.existsSync(stateFilePath)) {
      const parsed = JSON.parse(fs.readFileSync(stateFilePath, 'utf8')) as Partial<CatalogScanState>;
      const state: CatalogScanState = {
        jobStatus: parsed.jobStatus || 'idle',
        startedAt: parsed.startedAt || null,
        updatedAt: parsed.updatedAt || null,
        completedAt: parsed.completedAt || null,
        totalSetsToScan: Number(parsed.totalSetsToScan) || 0,
        scannedSetsCount: Number(parsed.scannedSetsCount) || 0,
        currentSetCode: parsed.currentSetCode || null,
        pendingSetCodes: Array.isArray(parsed.pendingSetCodes) ? parsed.pendingSetCodes : [],
        failedSetCodes: Array.isArray(parsed.failedSetCodes) ? parsed.failedSetCodes : [],
        errorLogs: Array.isArray(parsed.errorLogs) ? parsed.errorLogs.slice(-200) : [],
        sets: parsed.sets && typeof parsed.sets === 'object' ? parsed.sets : {},
        discoveredCards:
          parsed.discoveredCards && typeof parsed.discoveredCards === 'object'
            ? parsed.discoveredCards
            : {},
        importedCards:
          parsed.importedCards && typeof parsed.importedCards === 'object'
            ? parsed.importedCards
            : {},
      };
      // Reset stale "running" status across process restarts to "paused" so admin can cleanly resume
      if (state.jobStatus === 'running') {
        state.jobStatus = state.pendingSetCodes.length > 0 ? 'paused' : 'completed';
      }
      return state;
    }
  } catch {
    // ignore corrupt cache file and initialize clean state
  }

  return {
    jobStatus: 'idle',
    startedAt: null,
    updatedAt: null,
    completedAt: null,
    totalSetsToScan: 0,
    scannedSetsCount: 0,
    currentSetCode: null,
    pendingSetCodes: [],
    failedSetCodes: [],
    errorLogs: [],
    sets: {},
    discoveredCards: {},
    importedCards: {},
  };
}

export function saveCatalogScanState(
  state: CatalogScanState,
  stateFilePath = DEFAULT_STATE_FILE
): void {
  ensureDirForFile(stateFilePath);
  state.updatedAt = new Date().toISOString();
  const tmpPath = `${stateFilePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state), 'utf8');
  fs.renameSync(tmpPath, stateFilePath);
}

let inMemoryState: CatalogScanState | null = null;

export function getActiveCatalogState(stateFilePath = DEFAULT_STATE_FILE): CatalogScanState {
  if (!inMemoryState) {
    inMemoryState = loadCatalogScanState(stateFilePath);
    // Register any previously imported/discovered sets in active wikiService directory
    for (const s of Object.values(inMemoryState.sets)) {
      if (s.inSpiritsdex || s.discoveredCount > 0) {
        upsertStoredSetMetadata(s);
      }
    }
  }
  return inMemoryState;
}

export function resetCachedStateForTests(stateFilePath?: string): void {
  inMemoryState = stateFilePath ? loadCatalogScanState(stateFilePath) : null;
  scanMutex = false;
}

function getBaselineSpiritsdexCards(deps?: CatalogDependencies): BattleSpiritsCard[] {
  if (deps?.existingCardsProvider) {
    return deps.existingCardsProvider();
  }
  const map = new Map<string, BattleSpiritsCard>();
  try {
    const cardsJsonPath = path.resolve(process.cwd(), 'public', 'cards.json');
    if (fs.existsSync(cardsJsonPath)) {
      const parsed = JSON.parse(fs.readFileSync(cardsJsonPath, 'utf8')) as {
        cards?: BattleSpiritsCard[];
      };
      if (Array.isArray(parsed.cards)) {
        for (const c of parsed.cards) {
          if (c && c.id) map.set(c.id, c);
        }
      }
    }
  } catch {
    // ignore read error; runtime imported cards still apply
  }
  const state = getActiveCatalogState(deps?.stateFilePath);
  for (const c of Object.values(state.importedCards)) {
    if (c && c.id && !map.has(c.id)) {
      map.set(c.id, c);
    }
  }
  return Array.from(map.values());
}

/**
 * Fully paginates a MediaWiki query list (categorymembers, allpages) without arbitrary limits.
 */
async function fetchPaginatedCategoryMembers(
  cmtitle: string,
  fetchFn: (params: Record<string, string>) => Promise<Record<string, unknown>>,
  cmnamespace = '0'
): Promise<string[]> {
  const titles: string[] = [];
  let cmcontinue = '';
  const visitedCursors = new Set<string>();

  do {
    if (cmcontinue) {
      if (visitedCursors.has(cmcontinue)) break;
      visitedCursors.add(cmcontinue);
    }
    const params: Record<string, string> = {
      action: 'query',
      list: 'categorymembers',
      cmtitle,
      cmlimit: '500',
      cmnamespace,
    };
    if (cmcontinue) params.cmcontinue = cmcontinue;

    const res = (await fetchFn(params)) as {
      continue?: { cmcontinue?: string };
      query?: { categorymembers?: { title?: string }[] };
    };
    for (const item of res.query?.categorymembers || []) {
      const t = (item.title || '').trim();
      if (t && !CARD_SETS_IGNORE_TITLES.has(t)) {
        titles.push(t);
      }
    }
    cmcontinue = res.continue?.cmcontinue || '';
  } while (cmcontinue);

  return titles;
}

async function fetchPaginatedAllPagesPrefix(
  apprefix: string,
  fetchFn: (params: Record<string, string>) => Promise<Record<string, unknown>>
): Promise<string[]> {
  const titles: string[] = [];
  let apcontinue = '';
  const visited = new Set<string>();

  do {
    if (apcontinue) {
      if (visited.has(apcontinue)) break;
      visited.add(apcontinue);
    }
    const params: Record<string, string> = {
      action: 'query',
      list: 'allpages',
      apprefix,
      aplimit: '500',
      apnamespace: '0',
    };
    if (apcontinue) params.apcontinue = apcontinue;

    const res = (await fetchFn(params)) as {
      continue?: { apcontinue?: string };
      query?: { allpages?: { title?: string }[] };
    };
    for (const item of res.query?.allpages || []) {
      const t = (item.title || '').trim();
      if (t && !CARD_SETS_IGNORE_TITLES.has(t)) {
        titles.push(t);
      }
    }
    apcontinue = res.continue?.apcontinue || '';
  } while (apcontinue);

  return titles;
}

export function parseCardSetsIndexWikitext(
  wikitext: string
): Array<{
  setCode: string;
  wikiTitle: string;
  subtitleName?: string;
  sectionHeading: string;
  source: string;
}> {
  const results: Array<{
    setCode: string;
    wikiTitle: string;
    subtitleName?: string;
    sectionHeading: string;
    source: string;
  }> = [];
  const seen = new Set<string>();

  const lines = wikitext.split('\n');
  let currentHeading = 'Booster Sets';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const hdr = line.match(/^={2,4}\s*([^=]+?)\s*={2,4}$/);
    if (hdr) {
      currentHeading = hdr[1].trim();
      continue;
    }

    // Match table caption cells like `! align="center" |'''[[26RBS01]]'''<Br>The Genesis Pulse`
    if (line.startsWith('!') || line.startsWith('|')) {
      const cells = line.split(/!!|\|\||!/).map((c) => c.trim()).filter(Boolean);
      for (const cell of cells) {
        const linkM = cell.match(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/);
        if (!linkM) continue;
        const target = linkM[1].trim();
        if (
          !target ||
          /^(?:File|Image|Category|Template|Special):/i.test(target) ||
          /^BSS\d+/i.test(target) ||
          CARD_SETS_IGNORE_TITLES.has(target)
        ) {
          continue;
        }
        // Extract explicit subtitle if listed cleanly after <br> without inventing names
        let subtitle: string | undefined;
        const brParts = cell.split(/<br\s*\/?>/i);
        if (brParts.length > 1) {
          const cleanedSub = cleanWikitextInline(brParts.slice(1).join(' — ')).trim();
          if (cleanedSub && cleanedSub.length >= 2 && cleanedSub.toUpperCase() !== target.toUpperCase()) {
            subtitle = cleanedSub;
          }
        }
        const setCode = sanitizeSetCode(target);
        if (!setCode || setCode === 'BSS01' || seen.has(target.toLowerCase())) continue;
        seen.add(target.toLowerCase());
        results.push({
          setCode,
          wikiTitle: target,
          subtitleName: subtitle,
          sectionHeading: currentHeading,
          source: 'wiki:Card Sets',
        });
      }
      continue;
    }

    // Bullet lists at bottom of Card Sets (`* [[HKBP1]] - Best Pack 1`, `* [[Call of the Core]]`)
    if (line.startsWith('*')) {
      const linkM = line.match(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/);
      if (!linkM) continue;
      const target = linkM[1].trim();
      if (
        !target ||
        /^(?:File|Image|Category|Template|Special):/i.test(target) ||
        /^BSS\d+/i.test(target) ||
        CARD_SETS_IGNORE_TITLES.has(target)
      ) {
        continue;
      }
      const afterLink = line.slice((linkM.index || 0) + linkM[0].length);
      const trailMatch = afterLink.match(/^\s*[-–:]\s*(.+)$/);
      const subtitle = trailMatch ? cleanWikitextInline(trailMatch[1]).trim() : undefined;
      const setCode = sanitizeSetCode(target);
      if (!setCode || setCode === 'BSS01' || seen.has(target.toLowerCase())) continue;
      seen.add(target.toLowerCase());
      results.push({
        setCode,
        wikiTitle: target,
        subtitleName: subtitle || undefined,
        sectionHeading: currentHeading,
        source: 'wiki:Card Sets',
      });
    }
  }

  return results;
}

/**
 * Discovers ALL Battle Spirits Wiki sets across index pages, paginated categories,
 * promo subpages, and existing Spiritsdex sets (preserving number-only sets).
 */
export async function discoverAllWikiSets(
  deps?: CatalogDependencies
): Promise<{
  totalDiscovered: number;
  newlyDiscoveredCount: number;
  numberOnlyCount: number;
  sets: DiscoveredSetRecord[];
  errors: CatalogScanErrorLog[];
}> {
  const fetchFn = deps?.fetchWikiJsonFn || fetchWikiJson;
  const state = getActiveCatalogState(deps?.stateFilePath);
  const existingDirectory = getSyncedWikiDirectory().sets;
  const existingDirByCode = new Map(
    existingDirectory.map((s) => [s.setCode.toUpperCase(), s])
  );
  const baselineCards = getBaselineSpiritsdexCards(deps);
  const baselineSetCodes = new Set(
    baselineCards.map((c) => (c.setCode || '').trim().toUpperCase()).filter(Boolean)
  );

  const errors: CatalogScanErrorLog[] = [];
  const discoveredByCode = new Map<string, DiscoveredSetRecord>();

  const registerDiscovered = (
    input: Partial<ProductSet> & { setCode: string; wikiTitle: string },
    sourceLabel: string,
    inSpiritsdexHint: boolean
  ) => {
    const code = input.setCode.trim().toUpperCase();
    if (!code || code === 'BSS01') return;

    const existing = state.sets[code] || discoveredByCode.get(code);
    const dirMatch = existingDirByCode.get(code);
    const fallbackDisplayName =
      (input.name && input.name.trim()) ||
      (dirMatch?.name && dirMatch.name.trim()) ||
      code;
    const isNumOnly = isNumberOnlySetIdentifier(code, fallbackDisplayName);
    const inDex = Boolean(inSpiritsdexHint || dirMatch || baselineSetCodes.has(code));

    if (!existing) {
      const rec: DiscoveredSetRecord = {
        setCode: code,
        wikiTitle: input.wikiTitle || dirMatch?.wikiTitle || code,
        category: input.category || dirMatch?.category || 'Booster',
        name: fallbackDisplayName,
        jpName: input.jpName || dirMatch?.jpName || '',
        productType: input.productType || dirMatch?.productType || 'Booster Set',
        releaseDate: input.releaseDate || dirMatch?.releaseDate || 'Wiki Listing',
        formats:
          input.formats && input.formats.length > 0
            ? input.formats
            : dirMatch?.formats || ['Eternal'],
        blockLabel: input.blockLabel || dirMatch?.blockLabel || 'Wiki Set',
        tagline:
          input.tagline ||
          dirMatch?.tagline ||
          `${fallbackDisplayName}${fallbackDisplayName !== code ? ` (${code})` : ''} — Discovered from Battle Spirits Wiki.`,
        featuredCardId:
          input.featuredCardId || dirMatch?.featuredCardId || `${code.toLowerCase()}-001`,
        colors: input.colors || dirMatch?.colors || ALL_COLORS,
        totalCardsInSet: dirMatch?.totalCardsInSet || 0,
        wikiUrl:
          input.wikiUrl ||
          dirMatch?.wikiUrl ||
          `${WIKI_BASE}${encodeURIComponent((input.wikiTitle || code).replace(/ /g, '_'))}`,
        sources: [sourceLabel],
        isNumberOnly: isNumOnly,
        inSpiritsdex: inDex,
        scanStatus: 'pending',
        lastScanAt: null,
        lastError: null,
        discoveredCount: 0,
        existingCount: 0,
        missingCount: 0,
        updatedCount: 0,
        uncertainCount: 0,
        duplicateCount: 0,
        incompleteCount: 0,
        missingArtworkCount: 0,
      };
      discoveredByCode.set(code, rec);
    } else {
      const mergedSources = Array.from(new Set([...(existing.sources || []), sourceLabel]));
      const hasDescriptiveExisting =
        existing.name &&
        existing.name.toUpperCase() !== code &&
        !/^(?:Booster Set |Starter \/ Mega Deck )/i.test(existing.name);
      const chosenName = hasDescriptiveExisting
        ? existing.name
        : input.name && input.name.toUpperCase() !== code
        ? input.name
        : existing.name || code;

      const updated: DiscoveredSetRecord = {
        ...existing,
        wikiTitle: existing.wikiTitle || input.wikiTitle || code,
        name: chosenName,
        isNumberOnly: isNumberOnlySetIdentifier(code, chosenName),
        inSpiritsdex: existing.inSpiritsdex || inDex,
        sources: mergedSources,
      };
      discoveredByCode.set(code, updated);
    }
  };

  // Seed existing Spiritsdex directory sets (so pre-existing + number-only sets stay represented)
  for (const s of existingDirectory) {
    registerDiscovered(
      { ...s, wikiTitle: s.wikiTitle || s.setCode },
      'spiritsdex:directory',
      true
    );
  }
  for (const code of baselineSetCodes) {
    if (!discoveredByCode.has(code)) {
      registerDiscovered({ setCode: code, wikiTitle: code, name: code }, 'spiritsdex:cards', true);
    }
  }

  // Source 1: Wiki "Card Sets" master index page
  try {
    const csRes = (await fetchFn({
      action: 'query',
      titles: 'Card Sets',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      redirects: '1',
    })) as {
      query?: {
        pages?: Record<string, { revisions?: { slots?: { main?: { '*'?: string } } }[] }>;
      };
    };
    const csPage = Object.values(csRes.query?.pages || {})[0];
    const csWt = csPage?.revisions?.[0]?.slots?.main?.['*'] || '';
    if (csWt) {
      const parsedLinks = parseCardSetsIndexWikitext(csWt);
      for (const item of parsedLinks) {
        const meta = inferSetCategoryAndFormats(
          item.sectionHeading,
          item.setCode,
          item.wikiTitle
        );
        registerDiscovered(
          {
            setCode: item.setCode,
            wikiTitle: item.wikiTitle,
            name: item.subtitleName || item.wikiTitle,
            category: meta.category,
            formats: meta.formats,
            productType: meta.productType,
            blockLabel: meta.blockLabel,
          },
          item.source,
          false
        );
      }
    }
  } catch (err) {
    errors.push({
      setCode: 'DISCOVERY',
      page: 'Card Sets',
      message: err instanceof Error ? err.message : 'Failed to fetch Card Sets index',
      timestamp: new Date().toISOString(),
    });
  }

  // Source 2: Paginated Wiki Set Categories (cmcontinue exhausted completely)
  const categoryQueries: Array<{ title: string; sectionHint: string }> = [
    { title: 'Category:Booster Sets', sectionHint: 'Booster Sets' },
    { title: 'Category:Starter Decks', sectionHint: 'Starter Decks' },
    { title: 'Category:Structure Decks', sectionHint: 'Starter Decks' },
    { title: 'Category:Supplementary Sets', sectionHint: 'Supplementary Sets' },
    { title: 'Category:Collab Boosters', sectionHint: 'Collaboration Booster Sets' },
    { title: 'Category:English Sets', sectionHint: 'English Booster Packs' },
    { title: 'Category:Hong Kong Sets', sectionHint: 'Hong Kong Booster Packs' },
    { title: 'Category:Japanese Sets', sectionHint: 'Booster Sets' },
    { title: 'Category:Sets', sectionHint: 'Booster Sets' },
    { title: 'Category:Card Sets', sectionHint: 'Booster Sets' },
  ];

  for (const cat of categoryQueries) {
    try {
      const members = await fetchPaginatedCategoryMembers(cat.title, fetchFn, '0');
      for (const title of members) {
        if (CARD_SETS_IGNORE_TITLES.has(title) || /^BSS\d+/i.test(title)) continue;
        const code = sanitizeSetCode(title);
        const meta = inferSetCategoryAndFormats(cat.sectionHint, code, title);
        registerDiscovered(
          {
            setCode: code,
            wikiTitle: title,
            name: title,
            category: meta.category,
            formats: meta.formats,
            productType: meta.productType,
            blockLabel: meta.blockLabel,
          },
          `wiki:${cat.title}`,
          false
        );
      }
    } catch (err) {
      errors.push({
        setCode: 'DISCOVERY',
        page: cat.title,
        message: err instanceof Error ? err.message : `Failed to crawl ${cat.title}`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Source 3: Paginated Promo subpages
  for (const prefix of ['Promo Cards', 'Standard Promo Cards']) {
    try {
      const promoPages = await fetchPaginatedAllPagesPrefix(prefix, fetchFn);
      for (const title of promoPages) {
        const code = sanitizeSetCode(title);
        const isStd = title.toLowerCase().includes('standard');
        registerDiscovered(
          {
            setCode: code,
            wikiTitle: title,
            name: title,
            category: 'Promo',
            formats: isStd ? ['Standard', 'Eternal'] : ['Eternal'],
            productType: 'Promo Set',
            blockLabel: isStd ? 'Standard Promo' : 'Eternal Promo',
          },
          `wiki:allpages:${prefix}`,
          false
        );
      }
    } catch (err) {
      errors.push({
        setCode: 'DISCOVERY',
        page: `allpages:${prefix}`,
        message: err instanceof Error ? err.message : `Failed to crawl promo pages (${prefix})`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  let newlyDiscoveredCount = 0;
  for (const [code, rec] of discoveredByCode.entries()) {
    if (!state.sets[code]) {
      newlyDiscoveredCount++;
    }
    state.sets[code] = rec;
    upsertStoredSetMetadata(rec);
  }
  state.errorLogs = [...state.errorLogs, ...errors].slice(-200);
  saveCatalogScanState(state, deps?.stateFilePath);

  const allSets = Object.values(state.sets);
  return {
    totalDiscovered: allSets.length,
    newlyDiscoveredCount,
    numberOnlyCount: allSets.filter((s) => s.isNumberOnly).length,
    sets: allSets,
    errors,
  };
}

/**
 * Fallback parser for unusual Wiki set page structures:
 * bulleted lists, 2-column tables, or gallery captions.
 */
export function parseUnusualSetListings(
  wikitext: string,
  setMeta: ProductSet
): Array<{ card: BattleSpiritsCard; parseWarning?: string }> {
  const results: Array<{ card: BattleSpiritsCard; parseWarning?: string }> = [];
  const seen = new Set<string>();

  const addEntry = (rawNum: string, rawTitle: string, displayNameRaw?: string, warning?: string) => {
    const wikiTitle = rawTitle.trim();
    if (!wikiTitle || /^(?:File|Image|Category|Template|Special):/i.test(wikiTitle)) return;
    const cleanNum = rawNum.trim().replace(/\s+/g, '') || `${setMeta.setCode}-WIKI`;
    const isRevival =
      /\(revival\)/i.test(displayNameRaw || '') ||
      /\(revival\)/i.test(wikiTitle) ||
      /(?:^|-)RV[A-Z0-9]*\d/i.test(cleanNum);
    const key = `${setMeta.setCode}|${cleanNum.toUpperCase()}|${wikiTitle.toLowerCase()}|${isRevival ? 'rv' : 'orig'}`;
    if (seen.has(key)) return;
    seen.add(key);

    const displayName = (displayNameRaw || wikiTitle).trim();
    const id = `${setMeta.setCode.toLowerCase()}-${cleanNum
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')}-${wikiTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 24)}${isRevival ? '-rv' : ''}`;

    results.push({
      parseWarning: warning,
      card: {
        id,
        cardNumber: cleanNum,
        name: displayName,
        jpName: '',
        color: setMeta.colors?.[0] || 'Red',
        type: 'Spirit',
        rarity: setMeta.category === 'Promo' ? 'P' : 'C',
        setCode: setMeta.setCode,
        setName: setMeta.name || setMeta.setCode,
        formats: setMeta.formats?.length ? setMeta.formats : ['Eternal'],
        blockIcon: setMeta.blockLabel || 'Wiki',
        restriction: resolveCardRestriction(cleanNum, displayName, isRevival),
        isRevival,
        cost: 0,
        reduction: {},
        symbols: {},
        families: [],
        effects: [],
        keywords: [],
        flavorText: '',
        illustrator: '',
        artworkImage: '',
        artVariant: defaultVariant('Spirit', setMeta.colors?.[0] || 'Red'),
        wikiTitle,
        wikiUrl: `${WIKI_BASE}${encodeURIComponent(wikiTitle.replace(/ /g, '_'))}`,
        isWikiLoaded: false,
        rulings: [],
      },
    });
  };

  for (const rawLine of wikitext.split('\n')) {
    const line = rawLine.trim();
    // Bullet / numbered list patterns: `* BS01-001 [[Card]]`, `* [[Card]] (P20-01)`, `* [[Card]]`
    if (/^[*#]/.test(line) && line.includes('[[')) {
      const linkM = line.match(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/);
      if (!linkM) continue;
      const before = cleanWikitextInline(line.slice(1, linkM.index)).trim();
      const after = cleanWikitextInline(line.slice((linkM.index || 0) + linkM[0].length)).trim();
      const numMatch =
        before.match(/\b([A-Z0-9]{1,8}-[A-Z0-9]{1,8}|\d{1,3})\b/i) ||
        after.match(/\b([A-Z0-9]{1,8}-[A-Z0-9]{1,8})\b/i);
      const cardNumber = numMatch
        ? numMatch[1].includes('-')
          ? numMatch[1].toUpperCase()
          : `${setMeta.setCode}-${numMatch[1]}`
        : `${setMeta.setCode}-${String(results.length + 1).padStart(3, '0')}`;
      addEntry(cardNumber, linkM[1], linkM[2] || linkM[1], 'Parsed from bullet/list structure');
      continue;
    }

    // Template rows such as `{{SetRow|BS01-001|Drake Knight|Spirit|Red|C}}`
    const tmplRow = line.match(/^\{\{\s*(?:SetRow|CardRow)\s*\|([^}]+)\}\}/i);
    if (tmplRow) {
      const parts = tmplRow[1].split('|').map((p) => cleanWikitextInline(p).trim());
      if (parts[0] && parts[1]) {
        addEntry(parts[0], parts[1], parts[1], 'Parsed from SetRow/CardRow template');
      }
      continue;
    }

    // Gallery entries inside <gallery>: `BS01-001.jpg|[[Card Name]]`
    if (/^[A-Z0-9_-]+\.(?:png|jpe?g|webp|gif)\|/i.test(line) && line.includes('[[')) {
      const linkM = line.match(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/);
      const numM = line.match(/^([A-Z0-9]+-[A-Z0-9]+)/i);
      if (linkM && numM) {
        addEntry(numM[1].toUpperCase(), linkM[1], linkM[2] || linkM[1], 'Parsed from gallery block');
      }
    }
  }

  return results;
}

function evaluateIncompleteMetadata(card: BattleSpiritsCard, rawArtHint: string): string[] {
  const missing: string[] = [];
  if (!card.jpName?.trim()) missing.push('jpName');
  if (!card.illustrator?.trim()) missing.push('illustrator');
  if (!card.flavorText?.trim()) missing.push('flavorText');
  if (
    !card.effects?.length ||
    (card.effects.length === 1 &&
      card.effects[0]?.text === 'No English effect text listed on this card.')
  ) {
    missing.push('effects');
  }
  if (!rawArtHint) missing.push('artwork');
  return missing;
}

/**
 * Builds deterministic index keys over existing Spiritsdex cards for 7-signal comparison.
 */
function buildComparisonIndex(existingCards: BattleSpiritsCard[]) {
  const byNumber = new Map<string, BattleSpiritsCard[]>();
  const byName = new Map<string, BattleSpiritsCard[]>();
  const byCompactName = new Map<string, BattleSpiritsCard[]>();
  const byJpName = new Map<string, BattleSpiritsCard[]>();
  const byWikiTitle = new Map<string, BattleSpiritsCard[]>();

  const pushMap = (map: Map<string, BattleSpiritsCard[]>, k: string, c: BattleSpiritsCard) => {
    if (!k) return;
    const arr = map.get(k);
    if (arr) arr.push(c);
    else map.set(k, [c]);
  };

  for (const c of existingCards) {
    const numKey = normalizeCardNumForCompare(c.cardNumber);
    if (numKey && numKey !== 'WIKI') pushMap(byNumber, numKey, c);

    const nmKey = normalizeCompareText(c.name.replace(/\s*\(revival\)\s*$/i, ''));
    pushMap(byName, nmKey, c);

    const compKey = normalizeCompareCompact(c.name.replace(/\s*\(revival\)\s*$/i, ''));
    pushMap(byCompactName, compKey, c);

    if (c.jpName) pushMap(byJpName, normalizeCompareCompact(c.jpName), c);
    if (c.wikiTitle) pushMap(byWikiTitle, normalizeCompareText(c.wikiTitle), c);
  }

  return { byNumber, byName, byCompactName, byJpName, byWikiTitle };
}

export function classifyDiscoveredCard(
  entry: Omit<
    DiscoveredCardEntry,
    | 'classification'
    | 'matchedExistingId'
    | 'matchSignals'
    | 'matchConfidence'
    | 'metadataDeltas'
    | 'approvedForImport'
  >,
  index: ReturnType<typeof buildComparisonIndex>,
  seenDiscoveryKeysInSet: Map<string, number>
): {
  classification: ComparisonClassification;
  matchedExistingId?: string;
  matchSignals: string[];
  matchConfidence: number;
  metadataDeltas: string[];
} {
  const card = entry.card;
  const numKey = normalizeCardNumForCompare(card.cardNumber);
  const nameKey = normalizeCompareText(card.name.replace(/\s*\(revival\)\s*$/i, ''));
  const compactKey = normalizeCompareCompact(card.name.replace(/\s*\(revival\)\s*$/i, ''));
  const jpKey = normalizeCompareCompact(card.jpName);
  const wikiKey = normalizeCompareText(card.wikiTitle || entry.sourceWikiTitle);
  const setKey = (card.setCode || '').trim().toUpperCase();

  // Check duplicate signal among discovered entries first
  const dupSignature = `${numKey}|${Boolean(card.isRevival)}`;
  if ((seenDiscoveryKeysInSet.get(dupSignature) || 0) > 1) {
    return {
      classification: 'potential_duplicate',
      matchSignals: ['duplicate_card_number_in_scan'],
      matchConfidence: 50,
      metadataDeltas: [],
    };
  }

  const candidateScores = new Map<string, { card: BattleSpiritsCard; signals: string[]; score: number }>();
  const addCandidate = (c: BattleSpiritsCard, signal: string, weight: number) => {
    const prev = candidateScores.get(c.id);
    if (!prev) {
      candidateScores.set(c.id, { card: c, signals: [signal], score: weight });
    } else {
      if (!prev.signals.includes(signal)) prev.signals.push(signal);
      prev.score += weight;
    }
  };

  // Signal 1: Exact card number / identifier
  for (const c of index.byNumber.get(numKey) || []) {
    if (Boolean(c.isRevival) === Boolean(card.isRevival)) {
      addCandidate(c, 'cardNumber', 55);
    } else {
      addCandidate(c, 'cardNumber_version_mismatch', 20);
    }
  }
  // Signal 2: Exact official / normalized name
  for (const c of index.byName.get(nameKey) || []) {
    if (Boolean(c.isRevival) === Boolean(card.isRevival)) {
      addCandidate(c, 'officialName', 35);
    } else {
      addCandidate(c, 'officialName_version_mismatch', 15);
    }
  }
  // Signal 3: Japanese name
  if (jpKey) {
    for (const c of index.byJpName.get(jpKey) || []) {
      addCandidate(c, 'jpName', 30);
    }
  }
  // Signal 4: Set code + Signal 5: Normalized compact name
  for (const c of index.byCompactName.get(compactKey) || []) {
    addCandidate(c, 'normalizedName', 20);
    if ((c.setCode || '').trim().toUpperCase() === setKey) {
      addCandidate(c, 'setCode', 20);
    }
  }
  // Signal 6: Wiki title
  for (const c of index.byWikiTitle.get(wikiKey) || []) {
    if (Boolean(c.isRevival) === Boolean(card.isRevival)) {
      addCandidate(c, 'wikiTitle', 25);
    }
  }
  // Signal 7: Alternate names
  for (const alt of entry.alternateNames || []) {
    const altCompact = normalizeCompareCompact(alt);
    for (const c of index.byCompactName.get(altCompact) || []) {
      addCandidate(c, 'alternateName', 20);
    }
  }

  const ranked = Array.from(candidateScores.values()).sort((a, b) => b.score - a.score);
  if (ranked.length === 0) {
    return {
      classification: 'missing',
      matchSignals: [],
      matchConfidence: 0,
      metadataDeltas: [],
    };
  }

  const top = ranked[0];
  const second = ranked[1];

  // Multiple existing cards with nearly tied non-exact scores -> potential_duplicate
  if (
    second &&
    Math.abs(top.score - second.score) <= 10 &&
    top.score >= 45 &&
    !top.signals.includes('cardNumber')
  ) {
    return {
      classification: 'potential_duplicate',
      matchedExistingId: top.card.id,
      matchSignals: top.signals,
      matchConfidence: Math.min(100, top.score),
      metadataDeltas: [],
    };
  }

  // Partial or ambiguous match (e.g., same cardNumber without name confirmation OR same name in different set without cardNumber match)
  const hasStrongNumber = top.signals.includes('cardNumber');
  const hasStrongName =
    top.signals.includes('officialName') ||
    top.signals.includes('wikiTitle') ||
    top.signals.includes('jpName') ||
    top.signals.includes('alternateName');

  if (!(hasStrongNumber && (hasStrongName || top.card.setCode.toUpperCase() === setKey))) {
    if (hasStrongNumber || top.score >= 30) {
      return {
        classification: 'uncertain',
        matchedExistingId: top.card.id,
        matchSignals: top.signals,
        matchConfidence: Math.min(95, top.score),
        metadataDeltas: [],
      };
    }
    return {
      classification: 'missing',
      matchSignals: [],
      matchConfidence: 0,
      metadataDeltas: [],
    };
  }

  // Matched existing card: detect non-destructive metadata enrichments
  const deltas: string[] = [];
  if (!top.card.jpName?.trim() && card.jpName?.trim()) deltas.push('jpName');
  if (!top.card.illustrator?.trim() && card.illustrator?.trim()) deltas.push('illustrator');
  if (!top.card.flavorText?.trim() && card.flavorText?.trim()) deltas.push('flavorText');
  if (
    (!top.card.effects || top.card.effects.length === 0) &&
    card.effects &&
    card.effects.length > 0 &&
    card.effects[0]?.text !== 'No English effect text listed on this card.'
  ) {
    deltas.push('effects');
  }
  if ((!top.card.families || top.card.families.length === 0) && card.families?.length > 0) {
    deltas.push('families');
  }
  if ((top.card.cost === 0 || top.card.cost === undefined) && card.cost > 0) {
    deltas.push('cost');
  }

  return {
    classification: deltas.length > 0 ? 'updated_metadata' : 'matched',
    matchedExistingId: top.card.id,
    matchSignals: top.signals,
    matchConfidence: Math.min(100, top.score),
    metadataDeltas: deltas,
  };
}

/**
 * Re-compares all currently discovered cards against Spiritsdex baseline + imported catalog
 * and updates per-set counters.
 */
export function compareCatalogWithWiki(deps?: CatalogDependencies): {
  overview: CatalogOverviewSummary;
  entries: DiscoveredCardEntry[];
} {
  const state = getActiveCatalogState(deps?.stateFilePath);
  const existingCards = getBaselineSpiritsdexCards(deps);
  const index = buildComparisonIndex(existingCards);

  const dupCounts = new Map<string, number>();
  for (const entry of Object.values(state.discoveredCards)) {
    const sig = `${normalizeCardNumForCompare(entry.card.cardNumber)}|${Boolean(entry.card.isRevival)}`;
    dupCounts.set(sig, (dupCounts.get(sig) || 0) + 1);
  }

  // Reset per-set counts
  for (const s of Object.values(state.sets)) {
    s.discoveredCount = 0;
    s.existingCount = 0;
    s.missingCount = 0;
    s.updatedCount = 0;
    s.uncertainCount = 0;
    s.duplicateCount = 0;
    s.incompleteCount = 0;
    s.missingArtworkCount = 0;
  }

  for (const entry of Object.values(state.discoveredCards)) {
    const res = classifyDiscoveredCard(entry, index, dupCounts);
    entry.classification = res.classification;
    entry.matchedExistingId = res.matchedExistingId;
    entry.matchSignals = res.matchSignals;
    entry.matchConfidence = res.matchConfidence;
    entry.metadataDeltas = res.metadataDeltas;

    if (entry.imported) {
      entry.classification = 'matched';
    }

    const setRec = state.sets[entry.sourceSetCode];
    if (setRec) {
      setRec.discoveredCount++;
      if (entry.classification === 'matched') setRec.existingCount++;
      else if (entry.classification === 'missing') setRec.missingCount++;
      else if (entry.classification === 'updated_metadata') {
        setRec.existingCount++;
        setRec.updatedCount++;
      } else if (entry.classification === 'uncertain') setRec.uncertainCount++;
      else if (entry.classification === 'potential_duplicate') setRec.duplicateCount++;

      if (entry.incompleteFields.length > 0) setRec.incompleteCount++;
      if (!entry.hasArtworkHint) setRec.missingArtworkCount++;
    }
  }

  saveCatalogScanState(state, deps?.stateFilePath);
  return {
    overview: getCatalogOverview(deps),
    entries: Object.values(state.discoveredCards),
  };
}

/**
 * Scans a single Wiki set independently of artwork resolution.
 * Full pagination for categories/subpages, preserves incomplete & artwork-less cards.
 */
export async function scanWikiSetByCode(
  setCodeInput: string,
  deps?: CatalogDependencies
): Promise<{
  set: DiscoveredSetRecord;
  discoveredCount: number;
  warnings: string[];
}> {
  const fetchFn = deps?.fetchWikiJsonFn || fetchWikiJson;
  const batchFetchFn = deps?.batchFetchPagesFn || batchFetchWikiPages;
  const state = getActiveCatalogState(deps?.stateFilePath);
  const code = setCodeInput.trim().toUpperCase();

  if (!state.sets[code]) {
    await discoverAllWikiSets(deps);
  }
  const setRec = state.sets[code];
  if (!setRec) {
    throw new Error(`Unknown set code: ${setCodeInput}`);
  }

  await ensureBanListLoaded().catch(() => null);

  setRec.scanStatus = 'scanning';
  setRec.lastError = null;
  state.currentSetCode = code;
  saveCatalogScanState(state, deps?.stateFilePath);

  const warnings: string[] = [];

  try {
    const rawCardsMap = new Map<string, { card: BattleSpiritsCard; warning?: string }>();
    const addRaw = (c: BattleSpiritsCard, warning?: string) => {
      const dedupeKey = `${c.cardNumber.toUpperCase()}|${(c.wikiTitle || c.name).toLowerCase()}|${c.isRevival ? 'rv' : 'orig'}`;
      if (!rawCardsMap.has(dedupeKey)) {
        rawCardsMap.set(dedupeKey, { card: c, warning });
      }
    };

    const wikiTitle = setRec.wikiTitle || setRec.setCode;
    let wikitext = '';

    const pageRes = (await fetchFn({
      action: 'query',
      titles: wikiTitle,
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      redirects: '1',
    })) as {
      query?: {
        pages?: Record<
          string,
          { missing?: string; revisions?: { slots?: { main?: { '*'?: string } } }[] }
        >;
      };
    };
    const pageObj = Object.values(pageRes.query?.pages || {})[0];
    wikitext = pageObj?.revisions?.[0]?.slots?.main?.['*'] || '';

    if (wikitext) {
      for (const rowCard of parseSetTableRows(wikitext, setRec)) {
        addRaw(rowCard);
      }
      if (rawCardsMap.size === 0) {
        for (const loose of parseUnusualSetListings(wikitext, setRec)) {
          addRaw(loose.card, loose.parseWarning);
        }
      }
      const enriched = enrichSetMetadata(setRec, wikitext, Array.from(rawCardsMap.values()).map((v) => v.card));
      setRec.name = enriched.name || setRec.name;
      setRec.releaseDate = enriched.releaseDate || setRec.releaseDate;
      setRec.tagline = enriched.tagline || setRec.tagline;
      setRec.colors = enriched.colors || setRec.colors;
      setRec.isNumberOnly = isNumberOnlySetIdentifier(setRec.setCode, setRec.name);
    }

    // Fallback/supplemental category enumeration (`Category:<SetCode>` or `Category:<WikiTitle>`) with FULL pagination
    if (rawCardsMap.size === 0 || code === 'TOKENS' || code === 'REVIVAL') {
      const catCandidates =
        code === 'REVIVAL'
          ? ['Category:Revival Cards']
          : code === 'TOKENS'
          ? ['Category:Token Cards', "Category:Can't put in deck"]
          : [`Category:${code}`, `Category:${wikiTitle}`];

      for (const catName of catCandidates) {
        try {
          const catMembers = await fetchPaginatedCategoryMembers(catName, fetchFn, '0');
          for (const title of catMembers) {
            const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const isRev = code === 'REVIVAL' || /\(revival\)/i.test(title);
            const fallbackCard: BattleSpiritsCard = {
              id: `${code.toLowerCase()}-${slug}${isRev ? '-rv' : ''}`,
              cardNumber: `${code}-${slug.slice(0, 8).toUpperCase()}`,
              name: title.replace(/\s*\([^)]+\)\s*$/, ''),
              jpName: '',
              color: setRec.colors?.[0] || 'Red',
              type: 'Spirit',
              rarity: setRec.category === 'Promo' ? 'P' : 'C',
              setCode: code,
              setName: setRec.name || code,
              formats: setRec.formats?.length ? setRec.formats : ['Eternal'],
              blockIcon: setRec.blockLabel || 'Wiki',
              restriction: 'Unlimited',
              isRevival: isRev,
              isToken: code === 'TOKENS',
              cost: 0,
              reduction: {},
              symbols: {},
              families: [],
              effects: [],
              keywords: [],
              flavorText: '',
              illustrator: '',
              artworkImage: '',
              artVariant: defaultVariant('Spirit', setRec.colors?.[0] || 'Red'),
              wikiTitle: title,
              wikiUrl: `${WIKI_BASE}${encodeURIComponent(title.replace(/ /g, '_'))}`,
              isWikiLoaded: false,
              rulings: [],
            };
            addRaw(fallbackCard, `Discovered from ${catName}`);
          }
        } catch (catErr) {
          warnings.push(
            `Category lookup failed (${catName}): ${
              catErr instanceof Error ? catErr.message : 'unknown error'
            }`
          );
        }
      }
    }

    // Batch-fetch ALL individual card pages (no arbitrary cap) in 50-item chunks
    const rawList = Array.from(rawCardsMap.values());
    const allTitles = Array.from(
      new Set(
        rawList.map((r) => r.card.wikiTitle).filter((t): t is string => Boolean(t))
      )
    );
    const bundles = allTitles.length > 0 ? await batchFetchFn(allTitles) : new Map<string, WikiPageBundle>();

    // Remove previous entries belonging exclusively to this scanned set before storing fresh scan entries
    for (const [k, existingEntry] of Object.entries(state.discoveredCards)) {
      if (existingEntry.sourceSetCode === code && !existingEntry.imported) {
        delete state.discoveredCards[k];
      }
    }

    for (const { card: rawCard, warning } of rawList) {
      const bundle = rawCard.wikiTitle ? bundles.get(rawCard.wikiTitle) : undefined;
      let hydrated = rawCard;
      const altNames: string[] = [];
      let rawArtFile = '';

      try {
        if (bundle?.wikitext) {
          hydrated = hydrateCardFromWikitext(
            { ...rawCard, setName: setRec.name || setRec.setCode },
            bundle.wikitext,
            bundle.pageImages || []
          );
          const blocks = extractTaggedCardTableBlocks(bundle.wikitext);
          if (blocks[0]) {
            const fields = parseTemplateFields(blocks[0].block);
            const rawImg = cleanWikitextInline(fields.image || '').trim();
            if (rawImg && /\.(?:png|jpe?g|webp|gif)/i.test(rawImg)) {
              rawArtFile = rawImg;
            }
            for (const altKey of ['altname', 'alt', 'othername', 'engname', 'name']) {
              const val = cleanWikitextInline(fields[altKey] || '').trim();
              if (val && val !== hydrated.name) altNames.push(val);
            }
          }
        }
      } catch (cardErr) {
        warnings.push(
          `Partial parse for "${rawCard.name}": ${
            cardErr instanceof Error ? cardErr.message : 'unknown'
          }`
        );
      }

      // Preserve JP-only name safely if English display name missing
      if (!hydrated.name?.trim() && hydrated.jpName?.trim()) {
        hydrated = { ...hydrated, name: hydrated.jpName.trim() };
      }

      if (!rawArtFile && bundle?.pageImages && bundle.pageImages.length > 0) {
        const usablePageImg = bundle.pageImages.find((f) =>
          /\.(?:png|jpe?g|webp|gif)$/i.test(f)
        );
        if (usablePageImg) rawArtFile = usablePageImg;
      }
      if (!rawArtFile && hydrated.galleryImages && hydrated.galleryImages.length > 0) {
        const gUrl = hydrated.galleryImages[0].url || '';
        if (/^https?:\/\//i.test(gUrl)) {
          rawArtFile = gUrl;
        }
      }

      const incompleteFields = evaluateIncompleteMetadata(hydrated, rawArtFile);
      const discoveryKey = `${code}::${normalizeCardNumForCompare(hydrated.cardNumber)}::${hydrated.isRevival ? 'rv' : 'orig'}::${(hydrated.wikiTitle || hydrated.name).toLowerCase().replace(/[^a-z0-9\p{L}\p{N}]+/gu, '-')}`;
      const existingEntry = state.discoveredCards[discoveryKey];

      state.discoveredCards[discoveryKey] = {
        discoveryKey,
        card: hydrated,
        sourceSetCode: code,
        sourceWikiTitle: hydrated.wikiTitle || hydrated.name,
        alternateNames: Array.from(new Set(altNames)),
        rawArtworkFile: rawArtFile,
        hasArtworkHint: Boolean(rawArtFile),
        incompleteFields,
        parseWarnings: warning ? [warning] : [],
        classification: existingEntry?.imported ? 'matched' : 'missing',
        matchedExistingId: existingEntry?.matchedExistingId,
        matchSignals: existingEntry?.matchSignals || [],
        matchConfidence: existingEntry?.matchConfidence || 0,
        metadataDeltas: existingEntry?.metadataDeltas || [],
        approvedForImport: existingEntry?.approvedForImport ?? false,
        imported: existingEntry?.imported ?? false,
        importedAt: existingEntry?.importedAt ?? null,
      };
    }

    setRec.scanStatus = 'completed';
    setRec.lastScanAt = new Date().toISOString();
    setRec.lastError = null;
    setRec.totalCardsInSet = Math.max(setRec.totalCardsInSet || 0, rawList.length);
    state.failedSetCodes = state.failedSetCodes.filter((c) => c !== code);
    state.pendingSetCodes = state.pendingSetCodes.filter((c) => c !== code);
    upsertStoredSetMetadata(setRec);

    compareCatalogWithWiki(deps);
    return {
      set: state.sets[code],
      discoveredCount: rawList.length,
      warnings,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Set scan failed';
    setRec.scanStatus = 'failed';
    setRec.lastScanAt = new Date().toISOString();
    setRec.lastError = msg;
    state.pendingSetCodes = state.pendingSetCodes.filter((c) => c !== code);
    if (!state.failedSetCodes.includes(code)) {
      state.failedSetCodes.push(code);
    }
    state.errorLogs.push({
      setCode: code,
      page: setRec.wikiTitle,
      message: msg,
      timestamp: new Date().toISOString(),
    });
    state.errorLogs = state.errorLogs.slice(-200);
    saveCatalogScanState(state, deps?.stateFilePath);
    throw err;
  } finally {
    state.currentSetCode = null;
    saveCatalogScanState(state, deps?.stateFilePath);
  }
}

export async function runCatalogScanBatch(
  options: {
    mode: 'all' | 'resume' | 'retry_failed';
    setCodes?: string[];
    maxSetsPerRun?: number;
  },
  deps?: CatalogDependencies
): Promise<{
  overview: CatalogOverviewSummary;
  processedSets: string[];
  failedSets: string[];
}> {
  if (scanMutex) {
    throw new Error('A catalog scan job is already running');
  }
  scanMutex = true;

  const state = getActiveCatalogState(deps?.stateFilePath);
  try {
    if (options.mode === 'all' || Object.keys(state.sets).length === 0) {
      await discoverAllWikiSets(deps);
    }

    let queue: string[] = [];
    if (options.setCodes && options.setCodes.length > 0) {
      queue = options.setCodes.map((s) => s.trim().toUpperCase()).filter((s) => Boolean(state.sets[s]));
    } else if (options.mode === 'retry_failed') {
      queue = Array.from(
        new Set([
          ...state.failedSetCodes,
          ...Object.values(state.sets)
            .filter((s) => s.scanStatus === 'failed')
            .map((s) => s.setCode),
        ])
      );
    } else if (options.mode === 'resume' && state.pendingSetCodes.length > 0) {
      queue = [...state.pendingSetCodes];
    } else {
      queue = Object.values(state.sets)
        .filter((s) => (options.mode === 'all' ? true : s.scanStatus === 'pending'))
        .map((s) => s.setCode);
    }

    state.jobStatus = 'running';
    if (!state.startedAt || options.mode === 'all') {
      state.startedAt = new Date().toISOString();
      state.completedAt = null;
    }
    state.pendingSetCodes = [...queue];
    state.totalSetsToScan =
      options.mode === 'resume'
        ? Math.max(state.totalSetsToScan, state.scannedSetsCount + queue.length)
        : queue.length;
    if (options.mode === 'all') {
      state.scannedSetsCount = 0;
    }
    saveCatalogScanState(state, deps?.stateFilePath);

    const limit =
      typeof options.maxSetsPerRun === 'number' && options.maxSetsPerRun > 0
        ? Math.min(queue.length, options.maxSetsPerRun)
        : queue.length;
    const toProcess = queue.slice(0, limit);
    const processedSets: string[] = [];
    const failedSets: string[] = [];

    for (const code of toProcess) {
      try {
        await scanWikiSetByCode(code, deps);
        processedSets.push(code);
        state.scannedSetsCount++;
      } catch {
        failedSets.push(code);
      }
      saveCatalogScanState(state, deps?.stateFilePath);
    }

    state.jobStatus = state.pendingSetCodes.length > 0 ? 'paused' : 'completed';
    if (state.jobStatus === 'completed') {
      state.completedAt = new Date().toISOString();
    }
    saveCatalogScanState(state, deps?.stateFilePath);

    return {
      overview: getCatalogOverview(deps),
      processedSets,
      failedSets,
    };
  } finally {
    scanMutex = false;
  }
}

export function setDiscoveredCardApproval(
  discoveryKey: string,
  approved: boolean,
  deps?: CatalogDependencies
): DiscoveredCardEntry | null {
  const state = getActiveCatalogState(deps?.stateFilePath);
  const entry = state.discoveredCards[discoveryKey];
  if (!entry) return null;
  entry.approvedForImport = approved;
  saveCatalogScanState(state, deps?.stateFilePath);
  return entry;
}

export function validateCatalogImport(
  options?: {
    discoveryKeys?: string[];
    includeMissing?: boolean;
    includeApprovedUpdates?: boolean;
  },
  deps?: CatalogDependencies
): ImportValidationReport {
  const state = getActiveCatalogState(deps?.stateFilePath);
  const includeMissing = options?.includeMissing ?? true;
  const includeApprovedUpdates = options?.includeApprovedUpdates ?? true;

  const candidates = options?.discoveryKeys?.length
    ? options.discoveryKeys
        .map((k) => state.discoveredCards[k])
        .filter((e): e is DiscoveredCardEntry => Boolean(e))
    : Object.values(state.discoveredCards);

  const selectedKeys: string[] = [];
  const selectedSetCodes = new Set<string>();
  const warnings: string[] = [];
  let willAddCards = 0;
  let willUpdateMetadata = 0;
  let skippedUncertain = 0;
  let skippedDuplicates = 0;
  let skippedAlreadyImported = 0;
  let manualMappingsProtected = 0;

  for (const entry of candidates) {
    if (entry.imported) {
      skippedAlreadyImported++;
      continue;
    }

    const explicitListProvided = Boolean(options?.discoveryKeys?.length);
    const hasManualMapping = Boolean(getManualWikiMapping(entry.card));
    if (hasManualMapping) manualMappingsProtected++;

    if (entry.classification === 'potential_duplicate' && !entry.approvedForImport) {
      skippedDuplicates++;
      continue;
    }
    if (entry.classification === 'uncertain' && !entry.approvedForImport) {
      skippedUncertain++;
      continue;
    }

    if (entry.classification === 'missing') {
      if (!includeMissing && !explicitListProvided && !entry.approvedForImport) continue;
      if (!entry.card.id || !entry.card.cardNumber || !entry.card.name || !entry.card.setCode) {
        warnings.push(`Skipped invalid card missing required identifier: ${entry.discoveryKey}`);
        continue;
      }
      willAddCards++;
      selectedKeys.push(entry.discoveryKey);
      selectedSetCodes.add(entry.sourceSetCode);
    } else if (entry.classification === 'updated_metadata') {
      if ((includeApprovedUpdates && entry.approvedForImport) || explicitListProvided) {
        willUpdateMetadata++;
        selectedKeys.push(entry.discoveryKey);
        selectedSetCodes.add(entry.sourceSetCode);
      }
    } else if (entry.approvedForImport) {
      willAddCards++;
      selectedKeys.push(entry.discoveryKey);
      selectedSetCodes.add(entry.sourceSetCode);
    }
  }

  let willAddSets = 0;
  for (const code of selectedSetCodes) {
    const s = state.sets[code];
    if (s && !s.inSpiritsdex) willAddSets++;
  }

  return {
    valid: warnings.length === 0 || selectedKeys.length > 0,
    willAddSets,
    willAddCards,
    willUpdateMetadata,
    skippedUncertain,
    skippedDuplicates,
    skippedAlreadyImported,
    manualMappingsProtected,
    warnings,
    selectedKeys,
  };
}

/**
 * Idempotent, non-destructive import of verified missing cards & approved metadata updates.
 * Never deletes existing cards, never merges unapproved uncertain matches, and never overwrites ManualWikiMapping.
 */
export function executeCatalogImport(
  options?: {
    discoveryKeys?: string[];
    includeMissing?: boolean;
    includeApprovedUpdates?: boolean;
  },
  deps?: CatalogDependencies
): ImportExecutionResult {
  const state = getActiveCatalogState(deps?.stateFilePath);
  const validation = validateCatalogImport(options, deps);
  const existingCards = getBaselineSpiritsdexCards(deps);
  const existingById = new Map(existingCards.map((c) => [c.id, c]));

  let addedSetsCount = 0;
  let addedCardsCount = 0;
  let updatedMetadataCount = 0;
  const importedCards: BattleSpiritsCard[] = [];
  const importedSets: ProductSet[] = [];
  const touchedSets = new Set<string>();
  const nowIso = new Date().toISOString();

  for (const key of validation.selectedKeys) {
    const entry = state.discoveredCards[key];
    if (!entry || entry.imported) continue;

    // Protect existing verified records & manual mappings
    const manual = getManualWikiMapping(entry.card);
    if (entry.classification === 'updated_metadata' && entry.matchedExistingId) {
      const targetExisting = existingById.get(entry.matchedExistingId) || state.importedCards[entry.matchedExistingId];
      if (targetExisting) {
        const enriched: BattleSpiritsCard = {
          ...targetExisting,
          jpName: targetExisting.jpName || entry.card.jpName || '',
          illustrator: targetExisting.illustrator || entry.card.illustrator || '',
          flavorText: targetExisting.flavorText || entry.card.flavorText || '',
          families:
            targetExisting.families?.length > 0 ? targetExisting.families : entry.card.families || [],
          effects:
            targetExisting.effects?.length > 0 ? targetExisting.effects : entry.card.effects || [],
          cost: targetExisting.cost > 0 ? targetExisting.cost : entry.card.cost ?? 0,
          // Always preserve manual mapping artwork or existing verified artwork
          artworkImage: manual ? targetExisting.artworkImage : targetExisting.artworkImage || entry.card.artworkImage,
          wikiTitle: manual?.wikiTitle || targetExisting.wikiTitle || entry.card.wikiTitle,
        };
        state.importedCards[enriched.id] = enriched;
        existingById.set(enriched.id, enriched);
        importedCards.push(enriched);
        updatedMetadataCount++;
      }
    } else {
      // Safe insert missing card without overwriting existing id
      let candidateId = entry.card.id;
      if (existingById.has(candidateId) && entry.classification !== 'matched') {
        candidateId = `${candidateId}-${crypto.createHash('sha1').update(entry.discoveryKey).digest('hex').slice(0, 6)}`;
      }
      if (!existingById.has(candidateId) && !state.importedCards[candidateId]) {
        const finalCard: BattleSpiritsCard = {
          ...entry.card,
          id: candidateId,
          wikiTitle: manual?.wikiTitle || entry.card.wikiTitle,
        };
        state.importedCards[finalCard.id] = finalCard;
        existingById.set(finalCard.id, finalCard);
        importedCards.push(finalCard);
        addedCardsCount++;
      }
    }

    entry.imported = true;
    entry.importedAt = nowIso;
    entry.classification = 'matched';
    touchedSets.add(entry.sourceSetCode);
  }

  for (const code of touchedSets) {
    const s = state.sets[code];
    if (!s) continue;
    if (!s.inSpiritsdex) {
      s.inSpiritsdex = true;
      addedSetsCount++;
    }
    upsertStoredSetMetadata(s);
    importedSets.push(s);
  }

  compareCatalogWithWiki(deps);
  return {
    addedSetsCount,
    addedCardsCount,
    updatedMetadataCount,
    skippedCount: validation.skippedUncertain + validation.skippedDuplicates + validation.skippedAlreadyImported,
    importedCards,
    importedSets,
  };
}

export function getCatalogOverview(deps?: CatalogDependencies): CatalogOverviewSummary {
  const state = getActiveCatalogState(deps?.stateFilePath);
  const setsList = Object.values(state.sets);
  const cardsList = Object.values(state.discoveredCards);

  return {
    totalWikiSetsDiscovered: setsList.length,
    totalSetsInSpiritsdex: setsList.filter((s) => s.inSpiritsdex).length,
    setsScanned: setsList.filter((s) => s.scanStatus === 'completed').length,
    setsPending: setsList.filter((s) => s.scanStatus === 'pending' || s.scanStatus === 'scanning').length,
    setsFailed: setsList.filter((s) => s.scanStatus === 'failed').length,
    numberOnlySetsCount: setsList.filter((s) => s.isNumberOnly).length,
    totalWikiCardsDiscovered: cardsList.length,
    existingCardsMatched: cardsList.filter((c) => c.classification === 'matched').length,
    missingCards: cardsList.filter((c) => c.classification === 'missing').length,
    updatedMetadataCards: cardsList.filter((c) => c.classification === 'updated_metadata').length,
    cardsPendingReview: cardsList.filter(
      (c) =>
        !c.imported &&
        (c.classification === 'uncertain' ||
          c.classification === 'potential_duplicate' ||
          c.classification === 'updated_metadata')
    ).length,
    potentialDuplicates: cardsList.filter((c) => c.classification === 'potential_duplicate').length,
    incompleteMetadataCards: cardsList.filter((c) => c.incompleteFields.length > 0).length,
    missingArtworkCards: cardsList.filter((c) => !c.hasArtworkHint).length,
    importedCardsCount: Object.keys(state.importedCards).length,
    jobStatus: state.jobStatus,
    currentSetCode: state.currentSetCode,
    scannedSetsCount: state.scannedSetsCount,
    totalSetsToScan: state.totalSetsToScan,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    completedAt: state.completedAt,
  };
}

export function getCatalogDashboardSnapshot(
  options?: {
    setFilter?: string;
    classification?: string;
    setCode?: string;
    onlyMissingArtwork?: boolean;
    onlyIncomplete?: boolean;
    limit?: number;
    offset?: number;
  },
  deps?: CatalogDependencies
) {
  const state = getActiveCatalogState(deps?.stateFilePath);
  const overview = getCatalogOverview(deps);

  let sets = Object.values(state.sets);
  if (options?.setFilter && options.setFilter !== 'all') {
    if (options.setFilter === 'number_only') {
      sets = sets.filter((s) => s.isNumberOnly);
    } else if (options.setFilter === 'missing_from_db') {
      sets = sets.filter((s) => !s.inSpiritsdex || s.missingCount > 0);
    } else {
      sets = sets.filter((s) => s.scanStatus === options.setFilter);
    }
  }
  sets.sort((a, b) => a.setCode.localeCompare(b.setCode));

  let entries = Object.values(state.discoveredCards);
  if (options?.setCode) {
    const sc = options.setCode.trim().toUpperCase();
    entries = entries.filter((e) => e.sourceSetCode === sc);
  }
  if (options?.classification && options.classification !== 'all') {
    entries = entries.filter((e) => e.classification === options.classification);
  }
  if (options?.onlyMissingArtwork) {
    entries = entries.filter((e) => !e.hasArtworkHint);
  }
  if (options?.onlyIncomplete) {
    entries = entries.filter((e) => e.incompleteFields.length > 0);
  }

  const totalEntries = entries.length;
  const offset = Math.max(0, options?.offset || 0);
  const limit = Math.min(500, Math.max(10, options?.limit || 100));
  const pagedEntries = entries.slice(offset, offset + limit);

  return {
    overview,
    sets,
    cards: pagedEntries,
    totalFilteredCards: totalEntries,
    errorLogs: state.errorLogs.slice(-50).reverse(),
  };
}

export function getImportedCatalogPayload(deps?: CatalogDependencies): {
  cards: BattleSpiritsCard[];
  sets: ProductSet[];
} {
  const state = getActiveCatalogState(deps?.stateFilePath);
  const sets = Object.values(state.sets).filter((s) => s.inSpiritsdex);
  const cards = Object.values(state.importedCards);
  return { cards, sets };
}
