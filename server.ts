import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchWikiImageBytes,
  getManualCardMappingsList,
  getSyncedWikiDirectory,
  getWikiBanList,
  getWikiCardDetail,
  getWikiSet,
  hydrateWikiCardsBatch,
  resolveWikiCardImageMetadata,
  runMissingArtworkDiagnostic,
  searchWikiCards,
} from './server/wikiService.ts';
import {
  compareCatalogWithWiki,
  discoverAllWikiSets,
  executeCatalogImport,
  getCatalogDashboardSnapshot,
  getImportedCatalogPayload,
  reprocessAndRetryCatalogEntries,
  runCatalogScanBatch,
  scanWikiSetByCode,
  setDiscoveredCardApproval,
  validateCatalogImport,
} from './server/catalogSyncService.ts';
import {
  getValidationDashboardSnapshot,
  mergeFirestoreValidationRecords,
  runManualValidationJob,
  startManualValidationScheduler,
  validateSingleMappingByKey,
  type ArtworkValidationRecord,
} from './server/manualUrlValidator.ts';
import { artworkValidationRouter } from './server/controllers/artworkValidationController.ts';
import type { BattleSpiritsCard } from './src/types/card.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.status(200).json({ ok: true, service: 'spiritsdex', timestamp: new Date().toISOString() });
  });

  app.get('/api/wiki/directory', (_req, res) => {
    const { sets, syncedAt } = getSyncedWikiDirectory();
    res.json({ sets, syncedAt });
  });

  app.get('/api/wiki/banlist', async (_req, res) => {
    try {
      const banlist = await getWikiBanList();
      res.json(banlist);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load banlist';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/wiki/sets/:setCode', async (req, res) => {
    try {
      const setCode = req.params.setCode;
      const hydrateLimit = Math.min(1000, Math.max(20, Number(req.query.hydrate || 180)));
      const data = await getWikiSet(setCode, hydrateLimit);
      res.json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load wiki set';
      res.status(404).json({ error: message });
    }
  });

  app.get('/api/wiki/card', async (req, res) => {
    try {
      const title = String(req.query.title || '').trim();
      if (!title) {
        res.status(400).json({ error: 'Missing title parameter' });
        return;
      }
      const card = await getWikiCardDetail(title, {
        name: req.query.name ? String(req.query.name) : undefined,
        cardNumber: req.query.cardNumber ? String(req.query.cardNumber) : undefined,
        setCode: req.query.setCode ? String(req.query.setCode) : undefined,
        setName: req.query.setName ? String(req.query.setName) : undefined,
        isRevival:
          req.query.isRevival === 'true'
            ? true
            : req.query.isRevival === 'false'
            ? false
            : undefined,
      });
      res.json({ card });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load card details';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/wiki/hydrate', async (req, res) => {
    try {
      const cards = Array.isArray(req.body?.cards)
        ? (req.body.cards as BattleSpiritsCard[])
        : [];
      const hydrated = await hydrateWikiCardsBatch(cards.slice(0, 100));
      res.json({ cards: hydrated });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to hydrate cards';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/wiki/search', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const format =
        req.query.format === 'Standard' || req.query.format === 'Eternal'
          ? req.query.format
          : 'All';
      if (!q) {
        res.json({ cards: [] });
        return;
      }
      const cards = await searchWikiCards(q, format);
      res.json({ cards });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Wiki search failed';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/wiki/manual-mappings', (_req, res) => {
    const mappings = getManualCardMappingsList();
    res.json({ count: mappings.length, mappings });
  });

  app.get('/api/wiki/artwork-diagnostics', async (req, res) => {
    try {
      const setCode = req.query.set ? String(req.query.set).trim() : undefined;
      const limitRaw = req.query.limit ? Number(req.query.limit) : setCode ? 300 : 120;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(2500, limitRaw) : 120;
      const onlyMissing = req.query.onlyMissing === 'true' || req.query.onlyMissing === '1';
      const report = await runMissingArtworkDiagnostic({
        setCode,
        limit,
        onlyMissing,
      });
      res.json(report);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Artwork diagnostic failed';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/wiki/image-url', async (req, res) => {
    const file = String(req.query.file || '').trim();
    const fallback = req.query.fallback ? String(req.query.fallback).trim() : undefined;
    const title = req.query.title ? String(req.query.title).trim() : undefined;
    const name = req.query.name ? String(req.query.name).trim() : undefined;
    const jpName =
      req.query.jp || req.query.jpName
        ? String(req.query.jp || req.query.jpName).trim()
        : undefined;
    const setCode =
      req.query.set || req.query.setCode
        ? String(req.query.set || req.query.setCode).trim()
        : undefined;
    const id = req.query.id ? String(req.query.id).trim() : undefined;
    const isRevival =
      req.query.rv === '1' || req.query.rv === 'true' || req.query.isRevival === 'true';
    const rawStage = String(req.query.stage || 'all').trim();
    const stage =
      rawStage === 'exact' ||
      rawStage === 'normalized' ||
      rawStage === 'set_number' ||
      rawStage === 'japanese'
        ? rawStage
        : 'all';

    if (!file && !fallback && !title && !name && !jpName) {
      res.status(400).json({ ok: false, error: 'Missing image lookup parameters' });
      return;
    }

    const meta = await resolveWikiCardImageMetadata({
      id,
      fileName: file || undefined,
      cardNumber: fallback,
      wikiTitle: title,
      name,
      jpName,
      setCode,
      isRevival: isRevival || undefined,
      stage,
    });
    res.setHeader('Cache-Control', 'public, max-age=43200');
    res.json(meta);
  });

  app.get('/api/wiki/image', async (req, res) => {
    const file = String(req.query.file || '').trim();
    const fallback = req.query.fallback ? String(req.query.fallback).trim() : undefined;
    const title = req.query.title ? String(req.query.title).trim() : undefined;
    const name = req.query.name ? String(req.query.name).trim() : undefined;
    const jpName =
      req.query.jp || req.query.jpName
        ? String(req.query.jp || req.query.jpName).trim()
        : undefined;
    const setCode =
      req.query.set || req.query.setCode
        ? String(req.query.set || req.query.setCode).trim()
        : undefined;
    const id = req.query.id ? String(req.query.id).trim() : undefined;
    const isRevival =
      req.query.rv === '1' || req.query.rv === 'true' || req.query.isRevival === 'true';

    if (!file && !fallback && !title && !name && !jpName) {
      res.status(400).end();
      return;
    }

    const result = await fetchWikiImageBytes({
      id,
      fileName: file || undefined,
      cardNumber: fallback,
      wikiTitle: title,
      name,
      jpName,
      setCode,
      isRevival: isRevival || undefined,
    });
    if (!result) {
      res.status(404).end();
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.send(result.buffer);
  });

  // --- Public Imported Catalog Feed (additive non-destructive Wiki additions) ---
  app.get('/api/catalog/imported', (_req, res) => {
    try {
      const payload = getImportedCatalogPayload();
      res.setHeader('Cache-Control', 'no-cache');
      res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load imported catalog';
      res.status(500).json({ error: message });
    }
  });

  // --- Admin Wiki Catalog Discovery, Comparison & Safe Import Routes ---
  app.get('/api/admin/catalog/status', (req, res) => {
    try {
      const snapshot = getCatalogDashboardSnapshot({
        setFilter: req.query.setFilter ? String(req.query.setFilter) : undefined,
        classification: req.query.classification ? String(req.query.classification) : undefined,
        setCode: req.query.setCode ? String(req.query.setCode) : undefined,
        onlyMissingArtwork:
          req.query.onlyMissingArtwork === 'true' || req.query.onlyMissingArtwork === '1',
        onlyIncomplete:
          req.query.onlyIncomplete === 'true' || req.query.onlyIncomplete === '1',
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json(snapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load catalog status';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/admin/catalog/discover-sets', async (_req, res) => {
    try {
      const result = await discoverAllWikiSets();
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Set discovery failed';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/admin/catalog/scan', async (req, res) => {
    try {
      const singleSetCode =
        typeof req.body?.setCode === 'string' && req.body.setCode.trim()
          ? req.body.setCode.trim()
          : '';
      if (singleSetCode) {
        const result = await scanWikiSetByCode(singleSetCode);
        res.json({
          mode: 'single_set',
          ...result,
          overview: getCatalogDashboardSnapshot().overview,
        });
        return;
      }

      const rawMode = String(req.body?.mode || 'all');
      const mode: 'all' | 'resume' | 'retry_failed' =
        rawMode === 'resume' || rawMode === 'retry_failed' ? rawMode : 'all';
      const rawScope = String(req.body?.scope || 'all');
      const scope: 'all' | 'promo_special' =
        rawScope === 'promo_special' ? 'promo_special' : 'all';
      const maxSetsPerRun =
        typeof req.body?.maxSetsPerRun === 'number' && req.body.maxSetsPerRun > 0
          ? Math.min(200, Math.floor(req.body.maxSetsPerRun))
          : 15;
      const setCodes = Array.isArray(req.body?.setCodes)
        ? req.body.setCodes.slice(0, 200).map((s: unknown) => String(s))
        : undefined;

      const result = await runCatalogScanBatch({
        mode,
        scope,
        maxSetsPerRun,
        setCodes,
      });
      res.json({ mode, scope, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Catalog scan failed';
      const status = /already running/i.test(message) ? 409 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/admin/catalog/compare', (_req, res) => {
    try {
      const result = compareCatalogWithWiki();
      res.json({ overview: result.overview, totalCompared: result.entries.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Catalog comparison failed';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/admin/catalog/review', (req, res) => {
    try {
      const discoveryKey = String(req.body?.discoveryKey || '').trim();
      const approved = Boolean(req.body?.approved);
      if (!discoveryKey) {
        res.status(400).json({ error: 'Missing discoveryKey' });
        return;
      }
      const updated = setDiscoveredCardApproval(discoveryKey, approved);
      if (!updated) {
        res.status(404).json({ error: 'Discovered card entry not found' });
        return;
      }
      res.json({ entry: updated, overview: getCatalogDashboardSnapshot().overview });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update review approval';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/admin/catalog/validate-import', (req, res) => {
    try {
      const discoveryKeys = Array.isArray(req.body?.discoveryKeys)
        ? req.body.discoveryKeys.map((k: unknown) => String(k))
        : undefined;
      const setCodes = Array.isArray(req.body?.setCodes)
        ? req.body.setCodes.map((s: unknown) => String(s))
        : undefined;
      const report = validateCatalogImport({
        discoveryKeys,
        setCodes,
        includeMissing: req.body?.includeMissing !== false,
        includeApprovedUpdates: req.body?.includeApprovedUpdates !== false,
      });
      res.json(report);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import validation failed';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/admin/catalog/import', (req, res) => {
    try {
      const discoveryKeys = Array.isArray(req.body?.discoveryKeys)
        ? req.body.discoveryKeys.map((k: unknown) => String(k))
        : undefined;
      const setCodes = Array.isArray(req.body?.setCodes)
        ? req.body.setCodes.map((s: unknown) => String(s))
        : undefined;
      const result = executeCatalogImport({
        discoveryKeys,
        setCodes,
        includeMissing: req.body?.includeMissing !== false,
        includeApprovedUpdates: req.body?.includeApprovedUpdates !== false,
      });
      res.json({
        ...result,
        overview: getCatalogDashboardSnapshot().overview,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Catalog import failed';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/admin/catalog/reprocess', async (req, res) => {
    try {
      const setCodes = Array.isArray(req.body?.setCodes)
        ? req.body.setCodes.map((s: unknown) => String(s))
        : undefined;
      const result = await reprocessAndRetryCatalogEntries({
        setCodes,
        autoImport: Boolean(req.body?.autoImport),
        rehydrateSynthetic: req.body?.rehydrateSynthetic !== false,
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Catalog reprocessing failed';
      res.status(500).json({ error: message });
    }
  });

  // --- Admin Manual Artwork URL Background Validation Routes ---
  app.get('/api/admin/validation/status', (req, res) => {
    try {
      const snapshot = getValidationDashboardSnapshot({
        status: req.query.status ? String(req.query.status) : undefined,
        q: req.query.q ? String(req.query.q) : undefined,
      });
      res.json(snapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load validation status';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/admin/validation/run', async (req, res) => {
    try {
      const retryFailedOnly = Boolean(req.body?.retryFailedOnly);
      const resumeInterrupted = Boolean(req.body?.resumeInterrupted);
      const mappingKeys = Array.isArray(req.body?.mappingKeys)
        ? req.body.mappingKeys.map((k: unknown) => String(k))
        : undefined;
      const result = await runManualValidationJob({
        mappingKeys,
        retryFailedOnly,
        resumeInterrupted,
        triggerSource: retryFailedOnly ? 'retry_failed' : resumeInterrupted ? 'resume' : 'manual',
      });
      res.json({
        ...result,
        scheduler: getValidationDashboardSnapshot().scheduler,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Manual URL validation failed';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/admin/validation/check-one', async (req, res) => {
    try {
      const mappingKey = String(req.body?.mappingKey || '').trim();
      if (!mappingKey) {
        res.status(400).json({ error: 'Missing mappingKey' });
        return;
      }
      const record = await validateSingleMappingByKey(mappingKey);
      if (!record) {
        res.status(404).json({ error: 'Manual mapping entry not found' });
        return;
      }
      const snapshot = getValidationDashboardSnapshot();
      res.json({ record, summary: snapshot.summary });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Single URL check failed';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/admin/validation/rehydrate', (req, res) => {
    try {
      const records = Array.isArray(req.body?.records)
        ? (req.body.records as ArtworkValidationRecord[])
        : [];
      const result = mergeFirestoreValidationRecords(records);
      res.json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to rehydrate validation state';
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.use(artworkValidationRouter);

  // Return structured JSON 404 for unknown /api/* paths before SPA HTML fallback
  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: 'API route not found' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });

    // HMR is disabled in this environment; serve Vite client exports cleanly
    // without initiating a failing WebSocket connection to :24678.
    app.get('/@vite/client', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.send(`
const sheetsMap = new Map();
const linkSheetsMap = new Map();
if ("document" in globalThis) {
  document.querySelectorAll("style[data-vite-dev-id]").forEach((el) => {
    sheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
}
let lastInsertedStyle;
export function updateStyle(id, content) {
  if (linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => { lastInsertedStyle = undefined; }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement("afterend", style);
    }
    lastInsertedStyle = style;
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  if (linkSheetsMap.has(id)) {
    document.querySelectorAll(\`link[rel="stylesheet"][data-vite-dev-id="\${CSS.escape(id)}"]\`).forEach((el) => el.remove());
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  const noop = () => {};
  return {
    get data() { return {}; },
    accept: noop,
    acceptExports: noop,
    dispose: noop,
    prune: noop,
    decline: noop,
    invalidate: noop,
    on: noop,
    off: noop,
    send: noop,
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== "." && url[0] !== "/") return url;
  const pathname = url.replace(/[?#].*$/, "");
  const { search, hash } = new URL(url, "http://vite.dev");
  return \`\${pathname}?\${queryToInject}\${search ? "&" + search.slice(1) : ""}\${hash || ""}\`;
}
const BaseHTMLElement = typeof HTMLElement !== "undefined" ? HTMLElement : Object;
export class ErrorOverlay extends BaseHTMLElement {}
`);
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BattleSpirits Wiki server running on http://0.0.0.0:${PORT}`);
    if (process.env.DISABLE_VALIDATION_SCHEDULER !== '1') {
      startManualValidationScheduler();
    }
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
