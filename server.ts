import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildWikiDirectory,
  fetchWikiImageBytes,
  getWikiBanList,
  getWikiCardDetail,
  getWikiSet,
  hydrateWikiCardsBatch,
  searchWikiCards,
} from './server/wikiService.ts';
import type { BattleSpiritsCard } from './src/types/card.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/wiki/directory', (_req, res) => {
    const sets = buildWikiDirectory();
    res.json({ sets });
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

  app.get('/api/wiki/image', async (req, res) => {
    const file = String(req.query.file || '').trim();
    const fallback = req.query.fallback ? String(req.query.fallback) : undefined;
    if (!file && !fallback) {
      res.status(400).end();
      return;
    }

    const result = await fetchWikiImageBytes(file, fallback);
    if (!result) {
      res.status(404).end();
      return;
    }

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(result.buffer);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
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
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
