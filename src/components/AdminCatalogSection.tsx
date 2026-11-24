import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Database,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Square,
  XCircle,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { BattleSpiritsCard, ProductSet } from '../types/card';
import { useAdmin } from '../hooks/useAdmin';
import {
  type ClientArtworkValidationRecord,
  fetchValidationRecordsFromFirestore,
  publishCatalogAdditionsToFirestore,
  syncValidationRecordsToFirestore,
} from '../utils/catalogCloudSync';
import { isCloudWriteCooldownActive } from '../utils/cloudSync';

type AdminSubTab = 'overview' | 'review' | 'validation';

interface SourceCoverageBucketRow {
  sourceType: string;
  label: string;
  setsDiscovered: number;
  setsScanned: number;
  setsPending: number;
  setsFailed: number;
  cardsDiscovered: number;
  cardsMatched: number;
  cardsMissing: number;
  cardsImportable: number;
  status: 'complete' | 'partial' | 'pending' | 'failed' | 'unscanned';
}

interface CatalogOverview {
  totalWikiSetsDiscovered: number;
  totalSetsInSpiritsdex: number;
  setsScanned: number;
  setsPending: number;
  setsFailed: number;
  numberOnlySetsCount: number;
  promoSetsDiscovered?: number;
  promoSetsScanned?: number;
  promoCardsFound?: number;
  promoCardsMissing?: number;
  totalWikiCardsDiscovered: number;
  existingCardsMatched: number;
  missingCards: number;
  updatedMetadataCards: number;
  cardsPendingReview: number;
  potentialDuplicates: number;
  incompleteMetadataCards: number;
  missingArtworkCards: number;
  importedCardsCount: number;
  coverageComplete?: boolean;
  coverageWarning?: string | null;
  sourceCoverage?: SourceCoverageBucketRow[];
  jobStatus: string;
  currentSetCode: string | null;
  scannedSetsCount: number;
  totalSetsToScan: number;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
}

interface DiscoveredSetRow extends ProductSet {
  sources: string[];
  aliases?: string[];
  isNumberOnly: boolean;
  inSpiritsdex: boolean;
  scanStatus: 'pending' | 'scanning' | 'completed' | 'failed';
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

interface DiscoveredCardRow {
  discoveryKey: string;
  card: BattleSpiritsCard;
  sourceSetCode: string;
  sourceWikiTitle: string;
  hasArtworkHint: boolean;
  incompleteFields: string[];
  classification: 'matched' | 'missing' | 'uncertain' | 'potential_duplicate' | 'updated_metadata';
  matchSignals: string[];
  matchConfidence: number;
  metadataDeltas: string[];
  approvedForImport: boolean;
  imported: boolean;
}

interface ValidationSummary {
  total: number;
  healthy: number;
  broken: number;
  redirected: number;
  temporarily_unavailable: number;
  unverified: number;
}

interface ValidationSchedulerInfo {
  intervalHours: number;
  inProcessTimerActive: boolean;
  lastScheduledRunAt: string | null;
  nextScheduledRunAt: string | null;
  cloudRunExternalCronEndpoint: string;
  cronSecretConfigured: boolean;
}

type RejectionDiagnosticCategory =
  | 'confirmed_duplicate'
  | 'invalid_or_unsafe'
  | 'insufficient_identifying_info'
  | 'unsupported_identifier'
  | 'wiki_extraction_error'
  | 'database_write_failure'
  | 'permission_failure'
  | 'temporary_retryable'
  | 'unexpected_error';

interface RejectedCatalogCardRow {
  discoveryKey: string;
  cardNumber: string;
  name: string;
  wikiTitle: string;
  originalSetCode: string;
  normalizedSetCode: string;
  reason: string;
  diagnosticCategory?: RejectionDiagnosticCategory;
  recoverable?: boolean;
  recommendedAction?: string;
  missingFields: string[];
  duplicateMatch?: string;
  classification: string;
}

interface FailedImportDiagnosticRow {
  discoveryKey: string;
  cardNumber: string;
  name: string;
  reason: string;
  diagnosticCategory?: RejectionDiagnosticCategory;
  recoverable?: boolean;
  recommendedAction?: string;
}

interface ImportValidationPreview {
  valid: boolean;
  willAddSets: number;
  willAddCards: number;
  willUpdateMetadata: number;
  skippedUncertain: number;
  skippedDuplicates: number;
  skippedAlreadyImported: number;
  confirmedDuplicatesCount?: number;
  skippedInvalid?: number;
  manualMappingsProtected: number;
  warnings: string[];
  rejectedCards?: RejectedCatalogCardRow[];
}

type RepairModeOption =
  | 'all_incomplete'
  | 'artwork_only'
  | 'effects_only'
  | 'retry_matching'
  | 'reprocess_rejected'
  | 'resume';

interface CatalogAuditSummary {
  auditedAt: string;
  verifiedArtworkOnline: boolean;
  totalInspectedCards: number;
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
}

interface CatalogRepairSummaryState {
  jobStatus: 'idle' | 'running' | 'paused' | 'completed';
  mode: RepairModeOption | null;
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
  lastAuditReport?: CatalogAuditSummary;
}

interface AdminCatalogSectionProps {
  currentUser: User | null;
  authReady?: boolean;
  onCatalogImported?: (sets: ProductSet[], cards: BattleSpiritsCard[]) => void;
  onNotify?: (message: string) => void;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderStatusBadge(status: string) {
  switch (status) {
    case 'completed':
    case 'healthy':
    case 'matched':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold">
          <CheckCircle2 className="w-3 h-3" />
          <span>{status}</span>
        </span>
      );
    case 'redirected':
    case 'updated_metadata':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-50 border border-sky-200 text-sky-800 text-[11px] font-semibold">
          <span>{status.replace('_', ' ')}</span>
        </span>
      );
    case 'broken':
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 border border-red-200 text-red-800 text-[11px] font-semibold">
          <XCircle className="w-3 h-3" />
          <span>{status}</span>
        </span>
      );
    case 'temporarily_unavailable':
    case 'uncertain':
    case 'potential_duplicate':
    case 'missing':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-semibold">
          <AlertTriangle className="w-3 h-3" />
          <span>{status.replace(/_/g, ' ')}</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-semibold">
          <span>{status}</span>
        </span>
      );
  }
}

export const AdminCatalogSection: React.FC<AdminCatalogSectionProps> = ({
  currentUser,
  authReady = true,
  onCatalogImported,
  onNotify,
}) => {
  const { isAdmin, loading: adminLoading } = useAdmin(currentUser, authReady);
  const [subTab, setSubTab] = useState<AdminSubTab>('overview');
  const [expanded, setExpanded] = useState(false);
  const isAdminCloud = Boolean(currentUser && !adminLoading && isAdmin);

  // Catalog state
  const [overview, setOverview] = useState<CatalogOverview | null>(null);
  const [sets, setSets] = useState<DiscoveredSetRow[]>([]);
  const [reviewCards, setReviewCards] = useState<DiscoveredCardRow[]>([]);
  const [totalFilteredCards, setTotalFilteredCards] = useState(0);
  const [errorLogs, setErrorLogs] = useState<
    Array<{ setCode: string; page?: string; message: string; timestamp: string }>
  >([]);
  const [setFilter, setSetFilter] = useState('all');
  const [setSearchQuery, setSetSearchQuery] = useState('');
  const [showAllSets, setShowAllSets] = useState(false);
  const [cardClassification, setCardClassification] = useState('all');
  const [selectedSetCodeFilter, setSelectedSetCodeFilter] = useState('');
  const [onlyMissingArt, setOnlyMissingArt] = useState(false);
  const [onlyIncompleteMeta, setOnlyIncompleteMeta] = useState(false);
  const [validationPreview, setValidationPreview] = useState<ImportValidationPreview | null>(null);
  const [rejectedCards, setRejectedCards] = useState<RejectedCatalogCardRow[]>([]);
  const [confirmedDuplicatesCount, setConfirmedDuplicatesCount] = useState<number>(0);
  const [diagnosticFilter, setDiagnosticFilter] = useState<string>('all');
  const [failedImports, setFailedImports] = useState<FailedImportDiagnosticRow[]>([]);
  const [cloudSyncFailures, setCloudSyncFailures] = useState<{
    sets: Array<{ setCode: string; error: string }>;
    cards: Array<{ cardId: string; error: string }>;
    failures?: Array<{
      id: string;
      entityType: 'set' | 'card';
      error: string;
      diagnosticCategory: string;
      recoverable: boolean;
      recommendedAction: string;
    }>;
  } | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [autoScanning, setAutoScanning] = useState(false);
  const [importingSetCode, setImportingSetCode] = useState<string | null>(null);
  const [scanningSetCode, setScanningSetCode] = useState<string | null>(null);
  const stopAutoScanRef = useRef(false);
  const rehydratedValidationRef = useRef(false);

  // Validation state
  const [valSummary, setValSummary] = useState<ValidationSummary | null>(null);
  const [valRecords, setValRecords] = useState<ClientArtworkValidationRecord[]>([]);
  const [valScheduler, setValScheduler] = useState<ValidationSchedulerInfo | null>(null);
  const [valPendingCount, setValPendingCount] = useState(0);
  const [deadLinkRecords, setDeadLinkRecords] = useState<ClientArtworkValidationRecord[]>([]);
  const [valStatusFilter, setValStatusFilter] = useState('all');
  const [valQuery, setValQuery] = useState('');
  const [valBusy, setValBusy] = useState(false);
  const [checkingKey, setCheckingKey] = useState<string | null>(null);

  // Audit & Repair state
  const [auditReport, setAuditReport] = useState<CatalogAuditSummary | null>(null);
  const [repairState, setRepairState] = useState<CatalogRepairSummaryState | null>(null);
  const [repairBusy, setRepairBusy] = useState(false);

  const adminFetch = useCallback(
    async (url: string, init: RequestInit = {}) => {
      if (!currentUser || adminLoading || !isAdmin) {
        throw new Error('Verified administrator authentication required');
      }
      const idToken = await currentUser.getIdToken();
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${idToken}`);
      return fetch(url, { ...init, headers });
    },
    [currentUser, adminLoading, isAdmin]
  );

  // Synchronously fail closed and wipe cached admin diagnostics whenever user logs out or changes
  useEffect(() => {
    if (!currentUser || adminLoading || !isAdmin) {
      setExpanded(false);
      setOverview(null);
      setSets([]);
      setReviewCards([]);
      setTotalFilteredCards(0);
      setErrorLogs([]);
      setValidationPreview(null);
      setRejectedCards([]);
      setFailedImports([]);
      setCloudSyncFailures(null);
      setValSummary(null);
      setValRecords([]);
      setValScheduler(null);
      setDeadLinkRecords([]);
      setAuditReport(null);
      setRepairState(null);
      rehydratedValidationRef.current = false;
    }
  }, [currentUser, adminLoading, isAdmin]);

  const loadCatalogStatus = useCallback(async () => {
    if (!isAdminCloud) return;
    try {
      const qs = new URLSearchParams();
      if (setFilter !== 'all') qs.set('setFilter', setFilter);
      if (cardClassification !== 'all') qs.set('classification', cardClassification);
      if (selectedSetCodeFilter.trim()) qs.set('setCode', selectedSetCodeFilter.trim());
      if (onlyMissingArt) qs.set('onlyMissingArtwork', 'true');
      if (onlyIncompleteMeta) qs.set('onlyIncomplete', 'true');
      qs.set('limit', '120');

      const res = await adminFetch(`/api/admin/catalog/status?${qs.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      setOverview(data.overview || null);
      setSets(Array.isArray(data.sets) ? data.sets : []);
      setReviewCards(Array.isArray(data.cards) ? data.cards : []);
      setTotalFilteredCards(Number(data.totalFilteredCards || 0));
      setErrorLogs(Array.isArray(data.errorLogs) ? data.errorLogs : []);
    } catch {
      // ignore transient network errors
    }
  }, [isAdminCloud, adminFetch, setFilter, cardClassification, selectedSetCodeFilter, onlyMissingArt, onlyIncompleteMeta]);

  const loadBrokenHealthAlert = useCallback(async () => {
    if (!isAdminCloud) return;
    try {
      const res = await adminFetch('/api/admin/validation/status?status=broken');
      if (!res.ok) return;
      const data = await res.json();
      setValSummary((prev) => data.summary || prev);
      setValScheduler((prev) => data.scheduler || prev);
      setDeadLinkRecords(Array.isArray(data.records) ? data.records : []);
    } catch {
      // ignore offline
    }
  }, [isAdminCloud, adminFetch]);

  const loadValidationStatus = useCallback(async () => {
    if (!isAdminCloud) return;
    try {
      const qs = new URLSearchParams();
      if (valStatusFilter !== 'all') qs.set('status', valStatusFilter);
      if (valQuery.trim()) qs.set('q', valQuery.trim());
      const res = await adminFetch(`/api/admin/validation/status?${qs.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      setValSummary(data.summary || null);
      setValRecords(Array.isArray(data.records) ? data.records : []);
      setValScheduler(data.scheduler || null);
      setValPendingCount(Array.isArray(data.cycle?.pendingKeys) ? data.cycle.pendingKeys.length : 0);
      if (valStatusFilter === 'all' && !valQuery.trim()) {
        const brokenList = Array.isArray(data.records)
          ? data.records.filter((r: ClientArtworkValidationRecord) => r.status === 'broken')
          : [];
        setDeadLinkRecords(brokenList);
      } else {
        void loadBrokenHealthAlert();
      }
    } catch {
      // ignore
    }
  }, [isAdminCloud, adminFetch, valStatusFilter, valQuery, loadBrokenHealthAlert]);

  useEffect(() => {
    if (!isAdminCloud) return;
    void loadBrokenHealthAlert();
  }, [isAdminCloud, loadBrokenHealthAlert]);

  const loadRepairStatus = useCallback(async () => {
    if (!isAdminCloud) return;
    try {
      const res = await adminFetch('/api/admin/catalog/repair/status');
      if (!res.ok) return;
      const data = (await res.json()) as CatalogRepairSummaryState;
      setRepairState(data);
      if (data.lastAuditReport) {
        setAuditReport(data.lastAuditReport);
      }
    } catch {
      // ignore transient error
    }
  }, [isAdminCloud, adminFetch]);

  useEffect(() => {
    if (!expanded || !isAdminCloud) return;
    void loadCatalogStatus();
    void loadValidationStatus();
    void loadRepairStatus();
  }, [expanded, isAdminCloud, loadCatalogStatus, loadValidationStatus, loadRepairStatus]);

  // Rehydrate Firestore validation records into server state on admin open
  useEffect(() => {
    if (!expanded || !isAdminCloud || rehydratedValidationRef.current) return;
    rehydratedValidationRef.current = true;
    void fetchValidationRecordsFromFirestore().then(async (cloudRecords) => {
      if (!cloudRecords.length) return;
      try {
        await adminFetch('/api/admin/validation/rehydrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: cloudRecords }),
        });
        await loadValidationStatus();
      } catch {
        // non-fatal
      }
    });
  }, [expanded, isAdminCloud, adminFetch, loadValidationStatus]);

  const filteredSets = useMemo(() => {
    const q = setSearchQuery.trim().toLowerCase();
    if (!q) return sets;
    const qCompact = q.replace(/[\s-]+/g, '');
    return sets.filter((s) => {
      const code = (s.setCode || '').toLowerCase();
      const name = (s.name || '').toLowerCase();
      const jpName = (s.jpName || '').toLowerCase();
      const aliases = (s.aliases || []).join(' ').toLowerCase();
      const hay = `${code} ${name} ${jpName} ${aliases}`;
      const hayCompact = hay.replace(/[\s-]+/g, '');
      return hay.includes(q) || (qCompact.length >= 2 && hayCompact.includes(qCompact));
    });
  }, [sets, setSearchQuery]);

  const displayedSets = useMemo(() => {
    if (showAllSets || setSearchQuery.trim()) {
      return filteredSets;
    }
    return filteredSets.slice(0, 120);
  }, [filteredSets, showAllSets, setSearchQuery]);

  const handleDiscoverSets = async () => {
    setCatalogBusy(true);
    try {
      const res = await adminFetch('/api/admin/catalog/discover-sets', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Discovery failed');
      onNotify?.(
        `Discovered ${data.totalDiscovered} Wiki sets (${data.addedCount} new, ${data.numberOnlyCount} number-only)`
      );
      await loadCatalogStatus();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Wiki set discovery failed');
    } finally {
      setCatalogBusy(false);
    }
  };

  const handleScanBatch = async (mode: 'all' | 'resume' | 'retry_failed') => {
    setCatalogBusy(true);
    try {
      const res = await adminFetch('/api/admin/catalog/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, maxSetsPerRun: 12 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scan failed');
      const processed = Array.isArray(data.processedSets) ? data.processedSets.length : 0;
      const failed = Array.isArray(data.failedSets) ? data.failedSets.length : 0;
      onNotify?.(
        `Scanned ${processed} set(s)${failed > 0 ? ` (${failed} failed)` : ''} · ${data.overview?.missingCards ?? 0} missing cards detected`
      );
      await loadCatalogStatus();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Catalog scan failed');
    } finally {
      setCatalogBusy(false);
    }
  };

  const handleScanPromosSpecial = async () => {
    setCatalogBusy(true);
    try {
      const res = await adminFetch('/api/admin/catalog/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'all', scope: 'promo_special', maxSetsPerRun: 40 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'PX & Promo scan failed');
      const processed = Array.isArray(data.processedSets) ? data.processedSets.length : 0;
      const failed = Array.isArray(data.failedSets) ? data.failedSets.length : 0;
      onNotify?.(
        `Scanned ${processed} PX/promo source(s)${failed > 0 ? ` (${failed} failed)` : ''} · ${data.overview?.promoCardsMissing ?? 0} missing promo cards detected`
      );
      await loadCatalogStatus();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'PX & Promo scan failed');
    } finally {
      setCatalogBusy(false);
    }
  };

  const handleScanSingleSet = async (setCode: string) => {
    setScanningSetCode(setCode);
    try {
      const res = await adminFetch('/api/admin/catalog/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to scan ${setCode}`);
      onNotify?.(`Scanned ${setCode}: ${data.discoveredCount} cards discovered`);
      await loadCatalogStatus();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : `Scan failed for ${setCode}`);
    } finally {
      setScanningSetCode(null);
    }
  };

  const handleScanAllAuto = async () => {
    stopAutoScanRef.current = false;
    setAutoScanning(true);
    setCatalogBusy(true);
    let totalProcessed = 0;
    let totalFailed = 0;
    try {
      let nextMode: 'all' | 'resume' =
        (overview?.setsPending ?? 0) > 0 && (overview?.setsScanned ?? 0) > 0 ? 'resume' : 'all';

      for (let round = 0; round < 60; round++) {
        if (stopAutoScanRef.current) {
          onNotify?.(`Auto-scan paused after ${totalProcessed} set(s). Click Resume Scan to continue.`);
          break;
        }
        const res = await adminFetch('/api/admin/catalog/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: nextMode, maxSetsPerRun: 12 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Auto-scan failed');
        const processed = Array.isArray(data.processedSets) ? data.processedSets.length : 0;
        const failed = Array.isArray(data.failedSets) ? data.failedSets.length : 0;
        totalProcessed += processed;
        totalFailed += failed;
        await loadCatalogStatus();
        const pendingLeft = Number(data.overview?.setsPending ?? 0);
        if (pendingLeft === 0 || (processed === 0 && failed === 0)) {
          onNotify?.(
            `Auto-scan finished: ${totalProcessed} set(s) scanned${totalFailed > 0 ? `, ${totalFailed} failed` : ''} · ${data.overview?.missingCards ?? 0} missing cards detected`
          );
          break;
        }
        nextMode = 'resume';
      }
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Auto-scan failed');
    } finally {
      setAutoScanning(false);
      setCatalogBusy(false);
    }
  };

  const handleStopAutoScan = () => {
    stopAutoScanRef.current = true;
  };

  const handleRunAudit = async (verifyOnline = false) => {
    setRepairBusy(true);
    try {
      const res = await adminFetch(
        `/api/admin/catalog/audit?verifyArtworkOnline=${verifyOnline ? 'true' : 'false'}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Catalog audit failed');
      setAuditReport(data);
      onNotify?.(
        `Catalog Audit: ${data.totalInspectedCards} cards · ${data.completeVerifiedCount} complete, ${data.categories?.missingArtworkUrl ?? 0} missing art, ${data.categories?.missingEffectText ?? 0} missing effect`
      );
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Catalog audit failed');
    } finally {
      setRepairBusy(false);
    }
  };

  const handleRunRepairBatch = async (mode: RepairModeOption) => {
    setRepairBusy(true);
    try {
      const res = await adminFetch('/api/admin/catalog/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          batchSize: 120,
          updatePublicCardsJson: true,
          autoImportRecovered: mode === 'reprocess_rejected',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Repair batch failed');
      if (data.repairState) setRepairState(data.repairState);
      onNotify?.(
        `Repair (${mode}): processed ${data.batchProcessedCount}, repaired ${data.stats?.repairedCards ?? 0}, ${data.remainingCount ?? 0} remaining`
      );
      await Promise.all([loadCatalogStatus(), loadRepairStatus()]);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Catalog repair failed');
    } finally {
      setRepairBusy(false);
    }
  };

  const handleCompareCatalog = async () => {
    setCatalogBusy(true);
    try {
      const res = await adminFetch('/api/admin/catalog/compare', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Compare failed');
      onNotify?.(
        `Compared ${data.totalCompared} cards · ${data.overview?.missingCards ?? 0} missing, ${data.overview?.cardsPendingReview ?? 0} pending review`
      );
      await loadCatalogStatus();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Catalog comparison failed');
    } finally {
      setCatalogBusy(false);
    }
  };

  const handleToggleApproval = async (discoveryKey: string, approved: boolean) => {
    try {
      const res = await adminFetch('/api/admin/catalog/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discoveryKey, approved }),
      });
      if (!res.ok) return;
      await loadCatalogStatus();
    } catch {
      // ignore
    }
  };

  const handleValidateImport = async () => {
    setCatalogBusy(true);
    try {
      const res = await adminFetch('/api/admin/catalog/validate-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeMissing: true, includeApprovedUpdates: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Validation failed');
      setValidationPreview(data);
      setRejectedCards(Array.isArray(data.rejectedCards) ? data.rejectedCards : []);
      setConfirmedDuplicatesCount(Number(data.confirmedDuplicatesCount || 0));
      setFailedImports([]);
      onNotify?.(
        `Validation ready: +${data.willAddCards} cards, +${data.willAddSets} sets (${Number(data.confirmedDuplicatesCount || 0)} already in DB, ${(data.rejectedCards || []).length} flagged)`
      );
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Import validation failed');
    } finally {
      setCatalogBusy(false);
    }
  };

  const syncAdditionsWithCloud = async (
    importedSets: ProductSet[],
    importedCards: BattleSpiritsCard[]
  ): Promise<string> => {
    if (!isAdminCloud || !currentUser || (importedSets.length === 0 && importedCards.length === 0)) {
      return '';
    }
    try {
      const synced = await publishCatalogAdditionsToFirestore(
        currentUser.uid,
        importedSets,
        importedCards
      );
      if (synced.failedSets.length > 0 || synced.failedCards.length > 0) {
        setCloudSyncFailures({
          sets: synced.failedSets,
          cards: synced.failedCards,
          failures: Array.isArray(synced.failures) ? synced.failures : [],
        });
        return ` & synced ${synced.pushedCards} cards / ${synced.pushedSets} sets to Cloud (${synced.failedCards.length} card / ${synced.failedSets.length} set failures)`;
      }
      setCloudSyncFailures(null);
      return ` & synced ${synced.pushedCards} cards / ${synced.pushedSets} sets to Cloud`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Firestore write error';
      setCloudSyncFailures({
        sets: [],
        cards: [],
        failures: [
          {
            id: 'batch-sync',
            entityType: 'card',
            error: msg,
            diagnosticCategory: 'database_write_failure',
            recoverable: true,
            recommendedAction: 'Ensure Admin sign-in is active and click Retry Failed Cloud Sync.',
          },
        ],
      });
      return ` (local import succeeded; Cloud sync error: ${msg})`;
    }
  };

  const handleReprocessAndRetry = async () => {
    setCatalogBusy(true);
    try {
      const res = await adminFetch('/api/admin/catalog/reprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoImport: true, rehydrateSynthetic: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reprocess failed');

      const importResult = data.importResult;
      if (importResult) {
        const importedSets: ProductSet[] = Array.isArray(importResult.importedSets)
          ? importResult.importedSets
          : [];
        const importedCards: BattleSpiritsCard[] = Array.isArray(importResult.importedCards)
          ? importResult.importedCards
          : [];
        if (importedSets.length > 0 || importedCards.length > 0) {
          onCatalogImported?.(importedSets, importedCards);
        }
        setRejectedCards(
          Array.isArray(importResult.rejectedCards) ? importResult.rejectedCards : []
        );
        setFailedImports(
          Array.isArray(importResult.failedImports) ? importResult.failedImports : []
        );
        setConfirmedDuplicatesCount(
          Number(importResult.confirmedDuplicatesCount ?? data.confirmedDuplicatesCount ?? 0)
        );
        const cloudMsg = await syncAdditionsWithCloud(importedSets, importedCards);
        onNotify?.(
          `Reprocessed ${data.reprocessedCount} entries (${data.recoveredToReadyCount} recovered) · imported ${importResult.addedCardsCount} cards${cloudMsg}`
        );
      } else {
        setRejectedCards(
          Array.isArray(data.validation?.rejectedCards) ? data.validation.rejectedCards : []
        );
        setConfirmedDuplicatesCount(Number(data.confirmedDuplicatesCount || 0));
        setValidationPreview(data.validation || null);
        onNotify?.(
          `Reprocessed ${data.reprocessedCount} entries · ${data.recoveredToReadyCount} recovered`
        );
      }
      await loadCatalogStatus();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Reprocess failed');
    } finally {
      setCatalogBusy(false);
    }
  };

  const handleExecuteImport = async (setCodes?: string[]) => {
    setCatalogBusy(true);
    if (setCodes?.length === 1) setImportingSetCode(setCodes[0]);
    try {
      const res = await adminFetch('/api/admin/catalog/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          includeMissing: true,
          includeApprovedUpdates: true,
          ...(setCodes && setCodes.length > 0 ? { setCodes } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');

      const importedSets: ProductSet[] = Array.isArray(data.importedSets) ? data.importedSets : [];
      const importedCards: BattleSpiritsCard[] = Array.isArray(data.importedCards)
        ? data.importedCards
        : [];

      onCatalogImported?.(importedSets, importedCards);
      setRejectedCards(Array.isArray(data.rejectedCards) ? data.rejectedCards : []);
      setConfirmedDuplicatesCount(Number(data.confirmedDuplicatesCount || 0));
      setFailedImports(Array.isArray(data.failedImports) ? data.failedImports : []);

      const cloudMsg = await syncAdditionsWithCloud(importedSets, importedCards);

      onNotify?.(
        `Imported ${data.addedCardsCount} cards (${data.updatedMetadataCount} updated, ${data.addedSetsCount} sets)${cloudMsg}`
      );
      setValidationPreview(null);
      await loadCatalogStatus();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Catalog import failed');
    } finally {
      setCatalogBusy(false);
      setImportingSetCode(null);
    }
  };

  const handleSyncAllImportedToCloud = async () => {
    if (!isAdminCloud || !currentUser) return;
    setCatalogBusy(true);
    try {
      const res = await fetch('/api/catalog/imported');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to read imported catalog');
      const importedSets: ProductSet[] = Array.isArray(data.sets) ? data.sets : [];
      const importedCards: BattleSpiritsCard[] = Array.isArray(data.cards) ? data.cards : [];
      if (importedSets.length === 0 && importedCards.length === 0) {
        onNotify?.('No imported sets or cards yet to sync to Firestore');
        return;
      }
      const synced = await publishCatalogAdditionsToFirestore(
        currentUser.uid,
        importedSets,
        importedCards
      );
      if (synced.failedSets.length > 0 || synced.failedCards.length > 0) {
        setCloudSyncFailures({
          sets: synced.failedSets,
          cards: synced.failedCards,
          failures: Array.isArray(synced.failures) ? synced.failures : [],
        });
        onNotify?.(
          `Synced ${synced.pushedCards} cards / ${synced.pushedSets} sets (${synced.failedCards.length} card / ${synced.failedSets.length} set failures)`
        );
      } else {
        setCloudSyncFailures(null);
        onNotify?.(`Synced all ${synced.pushedCards} cards & ${synced.pushedSets} sets to Firestore`);
      }
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Cloud sync failed');
    } finally {
      setCatalogBusy(false);
    }
  };

  const handleRunValidation = async (opts: {
    retryFailedOnly?: boolean;
    resumeInterrupted?: boolean;
  }) => {
    setValBusy(true);
    try {
      const res = await adminFetch('/api/admin/validation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Validation run failed');
      onNotify?.(
        `Validation complete: ${data.summary?.healthy ?? 0} healthy, ${data.summary?.broken ?? 0} broken, ${data.summary?.redirected ?? 0} redirected`
      );
      if (isAdminCloud && !isCloudWriteCooldownActive() && Array.isArray(data.records) && data.records.length > 0) {
        void syncValidationRecordsToFirestore(data.records).catch(() => {});
      }
      await loadValidationStatus();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Manual URL validation failed');
    } finally {
      setValBusy(false);
    }
  };

  const handleCheckSingleUrl = async (mappingKey: string) => {
    setCheckingKey(mappingKey);
    try {
      const res = await adminFetch('/api/admin/validation/check-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappingKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Single URL check failed');
      if (isAdminCloud && !isCloudWriteCooldownActive() && data.record) {
        void syncValidationRecordsToFirestore([data.record]).catch(() => {});
      }
      await loadValidationStatus();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Single check failed');
    } finally {
      setCheckingKey(null);
    }
  };

  const handleSyncValidationCloud = async () => {
    if (!isAdminCloud || valRecords.length === 0) return;
    setValBusy(true);
    try {
      const res = await syncValidationRecordsToFirestore(valRecords);
      onNotify?.(
        res.failedKeys.length > 0
          ? `Synced ${res.syncedCount} validation record(s) (${res.failedKeys.length} failed)`
          : `Synced ${res.syncedCount} validation status record(s) to Firestore`
      );
    } catch {
      onNotify?.('Failed to sync validation status to Firestore');
    } finally {
      setValBusy(false);
    }
  };

  // Strict fail-closed component guard: never render any Admin Tools DOM for non-admins or logged-out visitors
  if (!currentUser || adminLoading || !isAdmin) {
    return null;
  }

  return (
    <section className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
            <Database className="w-3.5 h-3.5" />
            <span>Catalog Maintenance &amp; Artwork Link Health</span>
          </div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Wiki Catalog Sync &amp; Manual Artwork Validation
          </h2>
          <p className="text-xs text-slate-500">
            Discover Battle Spirits Wiki sets cleanly, compare missing cards without overwriting
            existing records or ManualWikiMapping, and monitor manual artwork URL health.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-h-[40px] px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shrink-0 cursor-pointer transition-colors"
        >
          {expanded ? 'Hide Admin Tools' : 'Open Admin Tools'}
        </button>
      </div>

      {/* Prominent Dead-Link Alert in Settings whenever any manual artwork URL is broken */}
      {((valSummary?.broken ?? 0) > 0 || deadLinkRecords.length > 0) && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-950 space-y-2.5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-red-900">
                  Dead Manual Artwork Link Alert ({deadLinkRecords.length || valSummary?.broken || 0} broken)
                </div>
                <p className="text-[11px] text-red-800 mt-0.5">
                  One or more manual artwork mappings failed validation with a permanent HTTP error or missing Wiki file. Original mappings remain preserved cleanly until updated.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={valBusy}
                onClick={() => void handleRunValidation({ retryFailedOnly: true })}
                className="min-h-[34px] px-3 rounded-xl bg-white border border-red-200 hover:bg-red-100 text-red-800 text-[11px] font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Retry Failed Links</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setExpanded(true);
                  setSubTab('validation');
                  setValStatusFilter('broken');
                }}
                className="min-h-[34px] px-3 rounded-xl bg-red-700 hover:bg-red-800 text-white text-[11px] font-semibold cursor-pointer"
              >
                Inspect Broken Links
              </button>
            </div>
          </div>

          {deadLinkRecords.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {deadLinkRecords.slice(0, 8).map((rec) => (
                <span
                  key={rec.mappingKey}
                  className="px-2 py-1 rounded-lg bg-white border border-red-200 text-[11px] font-mono text-red-900"
                >
                  {rec.cardNumber || rec.cardName}
                  {rec.httpStatus > 0 ? ` (HTTP ${rec.httpStatus})` : ''}
                </span>
              ))}
              {deadLinkRecords.length > 8 && (
                <span className="px-2 py-1 text-[11px] text-red-800 font-semibold">
                  +{deadLinkRecords.length - 8} more
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {expanded && (
        <div className="space-y-5 pt-3 border-t border-slate-100">
          {/* Sub-tab navigation */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
              {(
                [
                  { id: 'overview', label: 'Overview & Sets' },
                  { id: 'review', label: 'Review Queue' },
                  { id: 'validation', label: 'Manual Artwork URLs' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSubTab(tab.id)}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    subTab === tab.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
              <span>
                {`Cloud Admin Verified (${currentUser.email || currentUser.uid})`}
              </span>
            </div>
          </div>

          {/* 1. OVERVIEW & SETS */}
          {subTab === 'overview' && (
            <div className="space-y-4">
              {/* Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                {[
                  { label: 'Wiki Sets Discovered', val: overview?.totalWikiSetsDiscovered ?? 0 },
                  { label: 'Sets in Spiritsdex', val: overview?.totalSetsInSpiritsdex ?? 0 },
                  { label: 'Sets Scanned', val: overview?.setsScanned ?? 0 },
                  { label: 'Sets Pending', val: overview?.setsPending ?? 0 },
                  { label: 'Sets Failed', val: overview?.setsFailed ?? 0 },
                  { label: 'Number-Only Sets', val: overview?.numberOnlySetsCount ?? 0 },
                  { label: 'Wiki Cards Found', val: overview?.totalWikiCardsDiscovered ?? 0 },
                  { label: 'Existing Matched', val: overview?.existingCardsMatched ?? 0 },
                  { label: 'Missing Cards', val: overview?.missingCards ?? 0 },
                  { label: 'Pending Review', val: overview?.cardsPendingReview ?? 0 },
                  { label: 'Potential Duplicates', val: overview?.potentialDuplicates ?? 0 },
                  { label: 'Missing Artwork', val: overview?.missingArtworkCards ?? 0 },
                ].map((m) => (
                  <div
                    key={m.label}
                    className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80"
                  >
                    <div className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                      {m.val}
                    </div>
                    <div className="text-[11px] font-medium text-slate-500 leading-tight mt-0.5">
                      {m.label}
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Bar */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={catalogBusy}
                  onClick={() => void handleDiscoverSets()}
                  className="min-h-[38px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {catalogBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                  <span>Discover Wiki Sets</span>
                </button>

                <button
                  type="button"
                  disabled={catalogBusy}
                  onClick={() => void handleScanBatch('all')}
                  className="min-h-[38px] px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Scan Batch (12)</span>
                </button>

                <button
                  type="button"
                  disabled={catalogBusy}
                  onClick={() => void handleScanPromosSpecial()}
                  className="min-h-[38px] px-3.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Scan PX &amp; Promos</span>
                </button>

                {autoScanning ? (
                  <button
                    type="button"
                    onClick={handleStopAutoScan}
                    className="min-h-[38px] px-3.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>Stop Auto-Scan</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={catalogBusy}
                    onClick={() => void handleScanAllAuto()}
                    className="min-h-[38px] px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Scan All Sets</span>
                  </button>
                )}

                {(overview?.setsPending ?? 0) > 0 && (
                  <button
                    type="button"
                    disabled={catalogBusy}
                    onClick={() => void handleScanBatch('resume')}
                    className="min-h-[38px] px-3.5 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Resume Scan ({overview?.setsPending})</span>
                  </button>
                )}

                {(overview?.setsFailed ?? 0) > 0 && (
                  <button
                    type="button"
                    disabled={catalogBusy}
                    onClick={() => void handleScanBatch('retry_failed')}
                    className="min-h-[38px] px-3.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retry Failed Scans ({overview?.setsFailed})</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={catalogBusy}
                  onClick={() => void handleCompareCatalog()}
                  className="min-h-[38px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <span>Compare Catalog</span>
                </button>

                <button
                  type="button"
                  disabled={catalogBusy}
                  onClick={() => void handleValidateImport()}
                  className="min-h-[38px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <span>Validate Import</span>
                </button>

                <button
                  type="button"
                  disabled={catalogBusy}
                  onClick={() => void handleReprocessAndRetry()}
                  className="min-h-[38px] px-3.5 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-xs font-semibold text-amber-950 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reprocess &amp; Retry Recoverable</span>
                </button>

                <button
                  type="button"
                  disabled={catalogBusy || (overview?.missingCards ?? 0) + (overview?.cardsPendingReview ?? 0) === 0}
                  onClick={() => void handleExecuteImport()}
                  className="min-h-[38px] px-3.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <CloudUpload className="w-3.5 h-3.5" />
                  <span>Import Verified Cards</span>
                </button>

                {isAdminCloud && (
                  <button
                    type="button"
                    disabled={catalogBusy}
                    onClick={() => void handleSyncAllImportedToCloud()}
                    className="min-h-[38px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <CloudUpload className="w-3.5 h-3.5" />
                    <span>Sync Imported to Cloud</span>
                  </button>
                )}
              </div>

              {autoScanning && overview && overview.totalSetsToScan > 0 && (
                <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 space-y-1.5">
                  <div className="flex items-center justify-between font-semibold">
                    <span>
                      Auto-scanning all discovered sets ({overview.setsScanned}/
                      {overview.totalWikiSetsDiscovered})
                    </span>
                    <span className="font-mono">{overview.setsPending} pending</span>
                  </div>
                  <div className="h-2 rounded-full bg-emerald-200 overflow-hidden">
                    <div
                      className="h-full bg-emerald-700 transition-all"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            (overview.setsScanned /
                              Math.max(1, overview.totalWikiSetsDiscovered)) *
                              100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Catalog Audit Breakdown & Targeted Resumable Repair Controls */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      Catalog Completeness Audit &amp; Non-Destructive Repair Engine
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Audits artwork, English effect text, metadata, Wiki matches &amp; rejected entries with ManualWikiMapping protection.
                    </div>
                  </div>
                  {repairState && repairState.jobStatus !== 'idle' && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-700 shrink-0">
                      <span className="capitalize">{repairState.jobStatus}</span>
                      <span>·</span>
                      <span className="font-mono tabular-nums">
                        {repairState.processedCount}/{repairState.totalQueueCount}
                      </span>
                    </span>
                  )}
                </div>

                {auditReport && (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                    {[
                      { label: 'Verified Complete', val: auditReport.completeVerifiedCount },
                      { label: 'Missing / Unverified Art', val: auditReport.categories.missingArtworkUrl + auditReport.categories.brokenArtworkUrl + auditReport.categories.placeholderArtwork },
                      { label: 'Missing / Sentinel Effect', val: auditReport.categories.missingEffectText },
                      { label: 'Missing Metadata', val: auditReport.categories.missingMetadata },
                      { label: 'Skipped / Rejected', val: auditReport.categories.skippedOrRejectedEntries },
                    ].map((stat) => (
                      <div
                        key={stat.label}
                        className="p-2.5 rounded-xl bg-white border border-slate-200/80"
                      >
                        <div className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                          {stat.val}
                        </div>
                        <div className="text-[10px] font-medium text-slate-500 leading-tight mt-0.5">
                          {stat.label}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={repairBusy || catalogBusy}
                    onClick={() => void handleRunAudit(false)}
                    className="min-h-[36px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {repairBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                    <span>Audit Catalog</span>
                  </button>

                  <button
                    type="button"
                    disabled={repairBusy || catalogBusy}
                    onClick={() => void handleRunRepairBatch('all_incomplete')}
                    className="min-h-[36px] px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Repair All Incomplete</span>
                  </button>

                  <button
                    type="button"
                    disabled={repairBusy || catalogBusy}
                    onClick={() => void handleRunRepairBatch('artwork_only')}
                    className="min-h-[36px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>Repair Artwork Only</span>
                  </button>

                  <button
                    type="button"
                    disabled={repairBusy || catalogBusy}
                    onClick={() => void handleRunRepairBatch('effects_only')}
                    className="min-h-[36px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <span>Repair Effects Only</span>
                  </button>

                  <button
                    type="button"
                    disabled={repairBusy || catalogBusy}
                    onClick={() => void handleRunRepairBatch('retry_matching')}
                    className="min-h-[36px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retry Unmatched Wiki</span>
                  </button>

                  <button
                    type="button"
                    disabled={repairBusy || catalogBusy}
                    onClick={() => void handleRunRepairBatch('reprocess_rejected')}
                    className="min-h-[36px] px-3 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-xs font-semibold text-amber-950 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <span>Reprocess Rejected</span>
                  </button>

                  {repairState && repairState.remainingIds.length > 0 && (
                    <button
                      type="button"
                      disabled={repairBusy || catalogBusy}
                      onClick={() => void handleRunRepairBatch('resume')}
                      className="min-h-[36px] px-3 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Resume Repair ({repairState.remainingIds.length})</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Honest Source-Coverage Accounting Breakdown */}
              {overview && Array.isArray(overview.sourceCoverage) && overview.sourceCoverage.length > 0 && (
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-slate-900">
                        Wiki Source Coverage Breakdown (PX, Promo, Campaign, Event &amp; Regular Sets)
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Promo &amp; special sets scanned: {overview.promoSetsScanned ?? 0}/
                        {overview.promoSetsDiscovered ?? 0} · Promo cards found:{' '}
                        {overview.promoCardsFound ?? 0} ({overview.promoCardsMissing ?? 0} missing)
                      </div>
                    </div>
                    {overview.coverageComplete ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>All Discovered Sources Scanned</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-semibold shrink-0">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Partial Coverage (Incomplete)</span>
                      </span>
                    )}
                  </div>

                  {overview.coverageWarning && (
                    <div
                      role="status"
                      className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-950 flex items-start gap-2"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                      <span>{overview.coverageWarning}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    {overview.sourceCoverage.map((bucket) => (
                      <div
                        key={bucket.sourceType}
                        className="p-2.5 rounded-xl bg-white border border-slate-200/80 space-y-1 text-[11px]"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="font-semibold text-slate-900 truncate">{bucket.label}</span>
                          {renderStatusBadge(bucket.status)}
                        </div>
                        <div className="font-mono text-slate-600 flex items-center justify-between tabular-nums">
                          <span>Sets: {bucket.setsScanned}/{bucket.setsDiscovered}</span>
                          <span>
                            Cards: {bucket.cardsDiscovered}
                            {bucket.cardsMissing > 0 ? ` (+${bucket.cardsMissing})` : ''}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {validationPreview && (
                <div className="p-3.5 rounded-2xl bg-sky-50 border border-sky-200 text-xs text-sky-950 space-y-1">
                  <div className="font-semibold">
                    Import Dry-Run Validation: +{validationPreview.willAddCards} ready to import, +
                    {validationPreview.willAddSets} new sets, {validationPreview.willUpdateMetadata}{' '}
                    metadata enrichments
                  </div>
                  <div className="text-[11px] text-sky-800">
                    Already in DB (Confirmed Existing):{' '}
                    {validationPreview.confirmedDuplicatesCount ??
                      validationPreview.skippedAlreadyImported}{' '}
                    · Flagged for Diagnostics:{' '}
                    {validationPreview.rejectedCards?.length ??
                      validationPreview.skippedUncertain +
                        validationPreview.skippedDuplicates +
                        (validationPreview.skippedInvalid || 0)}{' '}
                    ({validationPreview.skippedUncertain} uncertain,{' '}
                    {validationPreview.skippedDuplicates} conflict/duplicate,{' '}
                    {validationPreview.skippedInvalid || 0} invalid) · Protected:{' '}
                    {validationPreview.manualMappingsProtected} ManualWikiMapping
                  </div>
                </div>
              )}

              {cloudSyncFailures &&
                (cloudSyncFailures.sets.length > 0 ||
                  cloudSyncFailures.cards.length > 0 ||
                  (cloudSyncFailures.failures?.length ?? 0) > 0) && (
                  <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-950 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">
                        Cloud Sync Failures ({cloudSyncFailures.sets.length} sets,{' '}
                        {cloudSyncFailures.cards.length} cards)
                      </span>
                      <button
                        type="button"
                        disabled={catalogBusy}
                        onClick={() => void handleSyncAllImportedToCloud()}
                        className="px-2.5 py-1 rounded-lg bg-red-700 hover:bg-red-800 text-white text-[11px] font-semibold cursor-pointer"
                      >
                        Retry Failed Cloud Sync
                      </button>
                    </div>
                    <div className="max-h-32 overflow-y-auto text-[11px] space-y-1">
                      {cloudSyncFailures.failures && cloudSyncFailures.failures.length > 0
                        ? cloudSyncFailures.failures.slice(0, 25).map((f, idx) => (
                            <div
                              key={`cf-${f.entityType}-${f.id}-${idx}`}
                              className="p-1.5 rounded-lg bg-white border border-red-200/80 space-y-0.5"
                            >
                              <div className="font-mono font-semibold text-red-900">
                                [{f.entityType.toUpperCase()} {f.id}] {f.diagnosticCategory}{' '}
                                {f.recoverable ? '(recoverable)' : '(schema fix needed)'}
                              </div>
                              <div className="text-red-800">{f.error}</div>
                              <div className="text-[10px] text-slate-600">
                                Action: {f.recommendedAction}
                              </div>
                            </div>
                          ))
                        : (
                          <>
                            {cloudSyncFailures.sets.slice(0, 10).map((f) => (
                              <div key={`fs-${f.setCode}`} className="font-mono">
                                [SET {f.setCode}] {f.error}
                              </div>
                            ))}
                            {cloudSyncFailures.cards.slice(0, 15).map((f) => (
                              <div key={`fc-${f.cardId}`} className="font-mono">
                                [CARD {f.cardId}] {f.error}
                              </div>
                            ))}
                          </>
                        )}
                    </div>
                  </div>
                )}

              {(rejectedCards.length > 0 || failedImports.length > 0) && (
                <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-950 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold">
                        Skipped / Rejected Card Diagnostics ({rejectedCards.length + failedImports.length})
                      </span>
                      {confirmedDuplicatesCount > 0 && (
                        <span className="ml-2 text-[11px] text-amber-800">
                          ({confirmedDuplicatesCount} already-in-DB matches excluded cleanly)
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={catalogBusy}
                        onClick={() => void handleReprocessAndRetry()}
                        className="px-2.5 py-1 rounded-lg bg-amber-800 hover:bg-amber-900 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Reprocess &amp; Retry Recoverable</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRejectedCards([]);
                          setFailedImports([]);
                          setDiagnosticFilter('all');
                        }}
                        className="text-[11px] underline text-amber-800 cursor-pointer"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {[
                      { id: 'all', label: `All (${rejectedCards.length + failedImports.length})` },
                      {
                        id: 'recoverable',
                        label: `Recoverable (${rejectedCards.filter((r) => r.recoverable !== false).length + failedImports.filter((f) => f.recoverable !== false).length})`,
                      },
                      {
                        id: 'confirmed_duplicate',
                        label: `Duplicate (${rejectedCards.filter((r) => r.diagnosticCategory === 'confirmed_duplicate').length})`,
                      },
                      {
                        id: 'insufficient_identifying_info',
                        label: `Needs Review (${rejectedCards.filter((r) => (r.diagnosticCategory || 'insufficient_identifying_info') === 'insufficient_identifying_info').length})`,
                      },
                      {
                        id: 'invalid_or_unsafe',
                        label: `Invalid/Unsafe (${rejectedCards.filter((r) => r.diagnosticCategory === 'invalid_or_unsafe' || r.diagnosticCategory === 'unsupported_identifier').length})`,
                      },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setDiagnosticFilter(f.id)}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border cursor-pointer ${
                          diagnosticFilter === f.id
                            ? 'bg-amber-900 border-amber-900 text-white'
                            : 'bg-white border-amber-200 text-amber-900 hover:bg-amber-100'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="max-h-56 overflow-y-auto divide-y divide-amber-200/70">
                    {failedImports
                      .filter((f) => {
                        if (diagnosticFilter === 'all') return true;
                        if (diagnosticFilter === 'recoverable') return f.recoverable !== false;
                        return (f.diagnosticCategory || 'database_write_failure') === diagnosticFilter;
                      })
                      .map((f) => (
                        <div key={`fi-${f.discoveryKey}`} className="py-1.5 text-[11px] space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono font-bold">{f.cardNumber}</span>
                            <span className="font-semibold">{f.name}</span>
                            <span className="px-1.5 py-0.2 rounded-md bg-red-100 border border-red-200 text-red-900 font-mono text-[10px]">
                              {f.diagnosticCategory || 'database_write_failure'}
                            </span>
                            {f.recoverable !== false && (
                              <span className="px-1.5 py-0.2 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-semibold">
                                Recoverable
                              </span>
                            )}
                          </div>
                          <div className="text-red-800">{f.reason}</div>
                          {f.recommendedAction && (
                            <div className="text-[10px] text-amber-900">
                              Action: {f.recommendedAction}
                            </div>
                          )}
                        </div>
                      ))}
                    {rejectedCards
                      .filter((r) => {
                        const cat = r.diagnosticCategory || 'insufficient_identifying_info';
                        if (diagnosticFilter === 'all') return true;
                        if (diagnosticFilter === 'recoverable') return r.recoverable !== false;
                        if (diagnosticFilter === 'invalid_or_unsafe') {
                          return cat === 'invalid_or_unsafe' || cat === 'unsupported_identifier';
                        }
                        return cat === diagnosticFilter;
                      })
                      .slice(0, 60)
                      .map((r) => (
                        <div
                          key={`rc-${r.discoveryKey}`}
                          className="py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono font-bold">{r.cardNumber || '—'}</span>
                              <span className="font-semibold">{r.name || r.wikiTitle}</span>
                              <span className="text-slate-600">
                                ({r.originalSetCode}
                                {r.normalizedSetCode && r.normalizedSetCode !== r.originalSetCode
                                  ? ` -> ${r.normalizedSetCode}`
                                  : ''}
                                )
                              </span>
                              {r.diagnosticCategory && (
                                <span className="px-1.5 py-0.2 rounded-md bg-white border border-amber-300 text-amber-950 font-mono text-[10px]">
                                  {r.diagnosticCategory}
                                </span>
                              )}
                              {r.recoverable && (
                                <span className="px-1.5 py-0.2 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-semibold">
                                  Recoverable
                                </span>
                              )}
                            </div>
                            <div className="text-amber-900">
                              {r.reason}
                              {r.missingFields.length > 0
                                ? ` [missing: ${r.missingFields.join(', ')}]`
                                : ''}
                              {r.duplicateMatch ? ` [match: ${r.duplicateMatch}]` : ''}
                            </div>
                            {r.recommendedAction && (
                              <div className="text-[10px] text-slate-600">
                                Action: {r.recommendedAction}
                              </div>
                            )}
                          </div>
                          {(r.classification === 'uncertain' ||
                            r.classification === 'potential_duplicate') && (
                            <button
                              type="button"
                              onClick={() => void handleToggleApproval(r.discoveryKey, true)}
                              className="px-2 py-1 rounded-lg bg-white border border-amber-300 hover:bg-amber-100 text-[11px] font-semibold text-amber-950 cursor-pointer shrink-0"
                            >
                              Approve
                            </button>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Set Filters & Table */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: 'all', label: 'All Sets' },
                    { id: 'promo_special', label: 'PX & Promos' },
                    { id: 'pending', label: 'Pending' },
                    { id: 'completed', label: 'Scanned' },
                    { id: 'failed', label: 'Failed' },
                    { id: 'number_only', label: 'Number-Only' },
                    { id: 'missing_from_db', label: 'Has Missing Cards' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSetFilter(f.id)}
                      className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-semibold border cursor-pointer ${
                        setFilter === f.id
                          ? 'bg-slate-900 border-slate-900 text-white'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="search"
                    value={setSearchQuery}
                    onChange={(e) => setSetSearchQuery(e.target.value)}
                    placeholder="Find set (e.g. BS23, PX25, PX26, 26RSD01)..."
                    className="min-h-[32px] w-48 px-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-900"
                  />
                  {filteredSets.length > 120 && !setSearchQuery.trim() && (
                    <button
                      type="button"
                      onClick={() => setShowAllSets((v) => !v)}
                      className="min-h-[30px] px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700 cursor-pointer"
                    >
                      {showAllSets ? 'Collapse (120)' : `Show All (${filteredSets.length})`}
                    </button>
                  )}
                  <span className="text-[11px] font-mono text-slate-500">
                    {displayedSets.length}/{filteredSets.length} sets shown
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-200 max-h-80">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] font-semibold text-slate-600 sticky top-0 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Set</th>
                      <th className="py-2.5 px-3">Sources</th>
                      <th className="py-2.5 px-3 text-right">Discovered</th>
                      <th className="py-2.5 px-3 text-right">Matched</th>
                      <th className="py-2.5 px-3 text-right">Missing</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Last Scan</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayedSets.map((s) => (
                      <tr key={s.setCode} className="hover:bg-slate-50/70">
                        <td className="py-2 px-3">
                          <div className="font-mono font-bold text-slate-900 flex items-center gap-1.5">
                            <span>{s.setCode}</span>
                            {s.isNumberOnly && (
                              <span className="px-1.5 py-0.2 rounded bg-slate-200 text-[10px] font-semibold text-slate-700">
                                #
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate max-w-[200px]">
                            {s.name}
                          </div>
                          {s.lastError && (
                            <div className="text-[10px] text-red-700 truncate max-w-[200px]">
                              {s.lastError}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 text-[11px] text-slate-500 max-w-[160px] truncate">
                          {(s.sources || []).join(', ')}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {s.discoveredCount}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {s.existingCount}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-amber-800">
                          {s.missingCount}
                        </td>
                        <td className="py-2 px-3">{renderStatusBadge(s.scanStatus)}</td>
                        <td className="py-2 px-3 text-[11px] text-slate-500 whitespace-nowrap">
                          {formatDateTime(s.lastScanAt)}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap space-x-1.5">
                          <button
                            type="button"
                            disabled={scanningSetCode === s.setCode}
                            onClick={() => void handleScanSingleSet(s.setCode)}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-800 cursor-pointer disabled:opacity-50"
                          >
                            {scanningSetCode === s.setCode
                              ? 'Scanning...'
                              : s.scanStatus === 'failed'
                              ? 'Retry'
                              : 'Scan'}
                          </button>
                          {s.missingCount > 0 && (
                            <button
                              type="button"
                              disabled={catalogBusy || importingSetCode === s.setCode}
                              onClick={() => void handleExecuteImport([s.setCode])}
                              className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-[11px] font-semibold text-white cursor-pointer disabled:opacity-50"
                            >
                              {importingSetCode === s.setCode ? 'Importing...' : `Import (${s.missingCount})`}
                            </button>
                          )}
                          {s.discoveredCount > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSetCodeFilter(s.setCode);
                                setSubTab('review');
                              }}
                              className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-[11px] font-semibold text-white cursor-pointer"
                            >
                              Inspect
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {errorLogs.length > 0 && (
                <div className="p-3 rounded-2xl bg-red-50 border border-red-200 space-y-1">
                  <div className="text-xs font-semibold text-red-900">
                    Recent Scan Error Logs ({errorLogs.length})
                  </div>
                  <div className="max-h-28 overflow-y-auto space-y-1 text-[11px] text-red-800 font-mono">
                    {errorLogs.slice(0, 15).map((log, i) => (
                      <div key={`${log.setCode}-${i}`}>
                        [{log.setCode}] {log.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2. REVIEW QUEUE */}
          {subTab === 'review' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Filter by comparison classification"
                    value={cardClassification}
                    onChange={(e) => setCardClassification(e.target.value)}
                    className="min-h-[36px] px-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800"
                  >
                    <option value="all">All Classifications</option>
                    <option value="missing">Missing</option>
                    <option value="updated_metadata">Updated Metadata</option>
                    <option value="uncertain">Uncertain</option>
                    <option value="potential_duplicate">Potential Duplicate</option>
                    <option value="matched">Matched</option>
                  </select>

                  <input
                    type="text"
                    value={selectedSetCodeFilter}
                    onChange={(e) => setSelectedSetCodeFilter(e.target.value.toUpperCase())}
                    placeholder="Filter Set (e.g. BS75)"
                    className="min-h-[36px] w-36 px-3 rounded-xl border border-slate-200 bg-white text-xs text-slate-900"
                  />

                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onlyMissingArt}
                      onChange={(e) => setOnlyMissingArt(e.target.checked)}
                    />
                    <span>Missing Artwork Only</span>
                  </label>

                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onlyIncompleteMeta}
                      onChange={(e) => setOnlyIncompleteMeta(e.target.checked)}
                    />
                    <span>Incomplete Only</span>
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={catalogBusy}
                    onClick={() => void handleValidateImport()}
                    className="min-h-[36px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer"
                  >
                    Validate Import
                  </button>
                  <button
                    type="button"
                    disabled={catalogBusy}
                    onClick={() => void handleExecuteImport()}
                    className="min-h-[36px] px-3.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    Import Verified Cards
                  </button>
                </div>
              </div>

              <div className="text-[11px] text-slate-500 font-mono">
                Showing {reviewCards.length} of {totalFilteredCards} discovered cards
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-200 max-h-96">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] font-semibold text-slate-600 sticky top-0 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Card</th>
                      <th className="py-2.5 px-3">Set</th>
                      <th className="py-2.5 px-3">Classification</th>
                      <th className="py-2.5 px-3">Signals / Flags</th>
                      <th className="py-2.5 px-3 text-right">Approval</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reviewCards.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">
                          No discovered cards match current filters. Run &ldquo;Scan Wiki&rdquo; in
                          Overview &amp; Sets first.
                        </td>
                      </tr>
                    ) : (
                      reviewCards.map((entry) => (
                        <tr key={entry.discoveryKey} className="hover:bg-slate-50/70">
                          <td className="py-2 px-3">
                            <div className="font-semibold text-slate-900">
                              {entry.card.name}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500">
                              {entry.card.cardNumber}
                              {entry.card.jpName ? ` · ${entry.card.jpName}` : ''}
                            </div>
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-700">
                            {entry.sourceSetCode}
                          </td>
                          <td className="py-2 px-3">
                            {renderStatusBadge(entry.classification)}
                          </td>
                          <td className="py-2 px-3 text-[11px] text-slate-600 space-y-0.5">
                            {entry.matchSignals.length > 0 && (
                              <div>
                                {entry.matchSignals.join(', ')} ({entry.matchConfidence}%)
                              </div>
                            )}
                            {entry.metadataDeltas.length > 0 && (
                              <div className="text-sky-700">
                                Updates: {entry.metadataDeltas.join(', ')}
                              </div>
                            )}
                            {!entry.hasArtworkHint && (
                              <div className="text-amber-700">No artwork file detected yet</div>
                            )}
                            {entry.incompleteFields.length > 0 && (
                              <div className="text-slate-500">
                                Incomplete: {entry.incompleteFields.join(', ')}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            {entry.imported ? (
                              <span className="text-[11px] font-semibold text-emerald-700">
                                Imported
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleToggleApproval(
                                    entry.discoveryKey,
                                    !entry.approvedForImport
                                  )
                                }
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer ${
                                  entry.approvedForImport
                                    ? 'bg-emerald-600 border-emerald-600 text-white'
                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                                }`}
                              >
                                {entry.approvedForImport ? 'Approved' : 'Approve'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 3. MANUAL ARTWORK URL VALIDATION */}
          {subTab === 'validation' && (
            <div className="space-y-4">
              {/* Summary Counts */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                {[
                  { label: 'Total Manual URLs', val: valSummary?.total ?? 0 },
                  { label: 'Healthy', val: valSummary?.healthy ?? 0 },
                  { label: 'Broken', val: valSummary?.broken ?? 0 },
                  { label: 'Redirected', val: valSummary?.redirected ?? 0 },
                  {
                    label: 'Temp Unavailable',
                    val: valSummary?.temporarily_unavailable ?? 0,
                  },
                  { label: 'Unverified', val: valSummary?.unverified ?? 0 },
                ].map((m) => (
                  <div
                    key={m.label}
                    className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80"
                  >
                    <div className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                      {m.val}
                    </div>
                    <div className="text-[11px] font-medium text-slate-500 mt-0.5">
                      {m.label}
                    </div>
                  </div>
                ))}
              </div>

              {/* Honest Scheduler Status */}
              {valScheduler && (
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs text-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-slate-900">
                      Scheduled Validation: Daily at 00:00 WIB (17:00 UTC) via GitHub Actions
                    </span>{' '}
                    (In-process timer: every {valScheduler.intervalHours}h,{' '}
                    {valScheduler.inProcessTimerActive ? 'active' : 'inactive'}). Webhook:{' '}
                    <code className="font-mono text-[11px] bg-white px-1.5 py-0.5 rounded border border-slate-200">
                      {valScheduler.cloudRunExternalCronEndpoint}
                    </code>{' '}
                    <span className="text-[11px] text-slate-500">
                      ({valScheduler.cronSecretConfigured ? 'X-Validation-Cron-Secret enabled' : 'Secret not set on server'})
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 shrink-0">
                    Last: {formatDateTime(valScheduler.lastScheduledRunAt)} · Next:{' '}
                    {formatDateTime(valScheduler.nextScheduledRunAt)}
                  </div>
                </div>
              )}

              {/* Actions & Filters */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={valBusy}
                    onClick={() => void handleRunValidation({})}
                    className="min-h-[38px] px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {valBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ImageIcon className="w-3.5 h-3.5" />
                    )}
                    <span>Run Validation Now</span>
                  </button>

                  <button
                    type="button"
                    disabled={valBusy}
                    onClick={() => void handleRunValidation({ retryFailedOnly: true })}
                    className="min-h-[38px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retry Failed Links</span>
                  </button>

                  {valPendingCount > 0 && (
                    <button
                      type="button"
                      disabled={valBusy}
                      onClick={() => void handleRunValidation({ resumeInterrupted: true })}
                      className="min-h-[38px] px-3.5 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <span>Resume Interrupted ({valPendingCount})</span>
                    </button>
                  )}

                  {isAdminCloud && valRecords.length > 0 && (
                    <button
                      type="button"
                      disabled={valBusy}
                      onClick={() => void handleSyncValidationCloud()}
                      className="min-h-[38px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <CloudUpload className="w-3.5 h-3.5" />
                      <span>Sync to Firestore</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="search"
                    value={valQuery}
                    onChange={(e) => setValQuery(e.target.value)}
                    placeholder="Filter name, number, set..."
                    className="min-h-[36px] w-44 px-3 rounded-xl border border-slate-200 bg-white text-xs text-slate-900"
                  />
                  <select
                    aria-label="Filter validation status"
                    value={valStatusFilter}
                    onChange={(e) => setValStatusFilter(e.target.value)}
                    className="min-h-[36px] px-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800"
                  >
                    <option value="all">All Statuses</option>
                    <option value="healthy">Healthy</option>
                    <option value="broken">Broken</option>
                    <option value="redirected">Redirected</option>
                    <option value="temporarily_unavailable">Temp Unavailable</option>
                    <option value="unverified">Unverified</option>
                  </select>
                </div>
              </div>

              {/* Validation Records Table */}
              <div className="overflow-x-auto rounded-2xl border border-slate-200 max-h-96">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] font-semibold text-slate-600 sticky top-0 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Card</th>
                      <th className="py-2.5 px-3">Original Target</th>
                      <th className="py-2.5 px-3">Status / HTTP</th>
                      <th className="py-2.5 px-3">Final URL / Reason</th>
                      <th className="py-2.5 px-3">Checked / Last OK</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {valRecords.map((rec) => (
                      <tr key={rec.mappingKey} className="hover:bg-slate-50/70">
                        <td className="py-2 px-3">
                          <div className="font-semibold text-slate-900">{rec.cardName}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {rec.cardNumber}
                            {rec.setCode ? ` · ${rec.setCode}` : ''}
                          </div>
                        </td>
                        <td className="py-2 px-3 max-w-[200px]">
                          <div className="truncate font-mono text-[11px] text-slate-700">
                            {rec.fileName || rec.wikiTitle || rec.originalUrl}
                          </div>
                          <div className="text-[10px] text-slate-400">{rec.mappingType}</div>
                        </td>
                        <td className="py-2 px-3 space-y-1">
                          <div>{renderStatusBadge(rec.status)}</div>
                          {rec.httpStatus > 0 && (
                            <div className="font-mono text-[10px] text-slate-500">
                              HTTP {rec.httpStatus}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 max-w-[220px] text-[11px]">
                          {rec.finalUrl && (
                            <div className="truncate font-mono text-slate-600">
                              {rec.finalUrl}
                            </div>
                          )}
                          {rec.failureReason && (
                            <div className="truncate text-amber-800">{rec.failureReason}</div>
                          )}
                        </td>
                        <td className="py-2 px-3 text-[11px] text-slate-500 whitespace-nowrap">
                          <div>Checked: {formatDateTime(rec.lastCheckedAt)}</div>
                          <div>OK: {formatDateTime(rec.lastSuccessAt)}</div>
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap space-x-1.5">
                          <button
                            type="button"
                            disabled={checkingKey === rec.mappingKey}
                            onClick={() => void handleCheckSingleUrl(rec.mappingKey)}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-800 cursor-pointer disabled:opacity-50"
                          >
                            {checkingKey === rec.mappingKey ? 'Checking...' : 'Validate'}
                          </button>
                          {rec.originalUrl && (
                            <a
                              href={rec.originalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
